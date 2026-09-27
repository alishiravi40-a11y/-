-- Almas Shahr accounting — core v0.8: open items, settlement (allocation of receipts to invoices) and aging.
-- Holoo has no allocation at all (TRE-07, W-17): a party only has a balance; which receipt paid which invoice is
-- never recorded, so neither the status of an invoice nor the age of a debt can be known. Here every line on a
-- sub-ledger account (account.requires_party) is an OPEN ITEM and a settlement links one debit item to one credit
-- item of the same account and party.
--
-- Invariants (enforced here, proven in migration/tests/test_receivables.py and on the whole FY1404 ledger):
--   * a settlement never exceeds what is still open on either side;
--   * settlements are append-only; an allocation is undone by a settlement_undo row (reason + permission), never deleted;
--   * for every (account, party) and every date: Σ open debits − Σ open credits = ledger balance.
--   * closing entries (kind 'closing', Holoo Sanad_State 2/3) are never items: moving a balance to the closing account
--     settles nothing (Holoo's own balance function Calc_BedBes_UseInFuncDate also leaves them out). An opening entry is
--     an item only when the previous year's detail is NOT in this database (e.g. the migrated 1404 opening); otherwise
--     the original items of that year stay open and the carried-forward lump would count them twice.
-- The due date of an item is its effective date + the party's payment terms (Holoo CUSTOMER.MohlatTasvieh: 0 for
-- 32,695 of 32,696 parties in 1404).

INSERT INTO core.permission (code, description) VALUES
  ('ar.allocate', 'allocate receipts/credits to invoices (settlement)'),
  ('ar.unallocate', 'undo a settlement (with reason)');

CREATE INDEX IF NOT EXISTS journal_line_account_party ON core.journal_line (account_id, party_id);

-- is this entry part of the sub-ledger (see header)?
CREATE FUNCTION core.in_subledger(p_kind text, p_fiscal_year int) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_kind <> 'closing' AND NOT (p_kind = 'opening' AND EXISTS (
    SELECT 1 FROM core.fiscal_year y JOIN core.fiscal_year prev ON prev.ends_on = y.starts_on - 1
    JOIN core.journal_entry pe ON pe.fiscal_year_id = prev.id WHERE y.id = p_fiscal_year)) $$;

CREATE TABLE core.settlement (
  id bigserial PRIMARY KEY, account_id int NOT NULL REFERENCES core.account, party_id int NOT NULL REFERENCES core.party,
  debit_entry_id bigint NOT NULL, debit_line_no int NOT NULL, credit_entry_id bigint NOT NULL, credit_line_no int NOT NULL,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  -- manual: chosen by a user; fifo: the oldest open items, run by a user; reversal_pair: an entry and its reversal;
  -- legacy_fifo: DERIVED for data migrated from Holoo, which never recorded allocation (an assumption, not a fact)
  method text NOT NULL CHECK (method IN ('manual', 'fifo', 'reversal_pair', 'legacy_fifo')),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), note text,
  FOREIGN KEY (debit_entry_id, debit_line_no) REFERENCES core.journal_line (entry_id, line_no),
  FOREIGN KEY (credit_entry_id, credit_line_no) REFERENCES core.journal_line (entry_id, line_no));
CREATE INDEX settlement_debit ON core.settlement (debit_entry_id, debit_line_no);
CREATE INDEX settlement_credit ON core.settlement (credit_entry_id, credit_line_no);
CREATE INDEX settlement_party ON core.settlement (account_id, party_id);

CREATE TABLE core.settlement_undo (
  settlement_id bigint PRIMARY KEY REFERENCES core.settlement, undone_by text NOT NULL, undone_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3));

CREATE VIEW core.settlement_active AS
SELECT s.* FROM core.settlement s WHERE NOT EXISTS (SELECT 1 FROM core.settlement_undo u WHERE u.settlement_id = s.id);

-- every line on a sub-ledger account of a posted entry, with what is still open
CREATE VIEW core.open_item AS
SELECT l.entry_id, l.line_no, l.account_id, l.party_id, e.effective_date,
       e.effective_date + coalesce(p.payment_terms_days, 0) AS due_date,
       CASE WHEN l.debit > 0 THEN 'debit' ELSE 'credit' END AS side, greatest(l.debit, l.credit) AS amount,
       coalesce(sd.amt, 0) + coalesce(sc.amt, 0) AS settled,
       greatest(l.debit, l.credit) - coalesce(sd.amt, 0) - coalesce(sc.amt, 0) AS open_amount,
       e.source, e.source_ref, e.kind, e.reverses_id
FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft' AND core.in_subledger(e.kind, e.fiscal_year_id)
JOIN core.account a ON a.id = l.account_id AND a.requires_party
LEFT JOIN core.party p ON p.id = l.party_id
LEFT JOIN LATERAL (SELECT sum(amount) amt FROM core.settlement_active s WHERE s.debit_entry_id = l.entry_id AND s.debit_line_no = l.line_no) sd ON l.debit > 0
LEFT JOIN LATERAL (SELECT sum(amount) amt FROM core.settlement_active s WHERE s.credit_entry_id = l.entry_id AND s.credit_line_no = l.line_no) sc ON l.credit > 0;

CREATE FUNCTION core.item_open(p_entry bigint, p_line int) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT greatest(l.debit, l.credit) - coalesce((SELECT sum(amount) FROM core.settlement_active s
         WHERE (s.debit_entry_id, s.debit_line_no) = (l.entry_id, l.line_no) OR (s.credit_entry_id, s.credit_line_no) = (l.entry_id, l.line_no)), 0)
  FROM core.journal_line l WHERE l.entry_id = p_entry AND l.line_no = p_line $$;

CREATE FUNCTION core.trg_settlement_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d core.journal_line; c core.journal_line; od numeric; oc numeric; rp boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'settlements are append-only; undo with core.undo_settlement'; END IF;
  -- one writer per sub-ledger (account, party) at a time: no double allocation under concurrency
  PERFORM pg_advisory_xact_lock(NEW.account_id, NEW.party_id);
  SELECT * INTO d FROM core.journal_line WHERE entry_id = NEW.debit_entry_id AND line_no = NEW.debit_line_no;
  SELECT * INTO c FROM core.journal_line WHERE entry_id = NEW.credit_entry_id AND line_no = NEW.credit_line_no;
  SELECT requires_party INTO rp FROM core.account WHERE id = NEW.account_id;
  IF NOT rp THEN RAISE EXCEPTION 'settlement only on sub-ledger (party) accounts'; END IF;
  IF d.debit = 0 OR c.credit = 0 THEN RAISE EXCEPTION 'a settlement links a debit item to a credit item'; END IF;
  IF (d.account_id, d.party_id) IS DISTINCT FROM (NEW.account_id, NEW.party_id)
     OR (c.account_id, c.party_id) IS DISTINCT FROM (NEW.account_id, NEW.party_id) THEN
    RAISE EXCEPTION 'both items must be on the same account and party'; END IF;
  IF EXISTS (SELECT 1 FROM core.journal_entry WHERE id IN (NEW.debit_entry_id, NEW.credit_entry_id) AND status = 'draft') THEN
    RAISE EXCEPTION 'only posted entries can be settled'; END IF;
  IF EXISTS (SELECT 1 FROM core.journal_entry WHERE id IN (NEW.debit_entry_id, NEW.credit_entry_id) AND NOT core.in_subledger(kind, fiscal_year_id)) THEN
    RAISE EXCEPTION 'closing (or carried-forward opening) entries are not open items and settle nothing'; END IF;
  od := core.item_open(NEW.debit_entry_id, NEW.debit_line_no); oc := core.item_open(NEW.credit_entry_id, NEW.credit_line_no);
  IF NEW.amount > od OR NEW.amount > oc THEN
    RAISE EXCEPTION 'settlement % exceeds the open amount (debit %, credit %)', NEW.amount, od, oc; END IF;
  IF NEW.method IN ('manual', 'fifo') THEN PERFORM core.require_permission(NEW.created_by, 'ar.allocate'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_rules BEFORE INSERT OR UPDATE OR DELETE ON core.settlement FOR EACH ROW EXECUTE FUNCTION core.trg_settlement_rules();
CREATE TRIGGER settlement_undo_immutable BEFORE UPDATE OR DELETE ON core.settlement_undo FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

CREATE FUNCTION core.allocate(p_debit_entry bigint, p_debit_line int, p_credit_entry bigint, p_credit_line int, p_amount numeric,
                              p_user text, p_note text DEFAULT NULL) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO core.settlement (account_id, party_id, debit_entry_id, debit_line_no, credit_entry_id, credit_line_no, amount, method, created_by, note)
  SELECT l.account_id, l.party_id, p_debit_entry, p_debit_line, p_credit_entry, p_credit_line, p_amount, 'manual', p_user, p_note
  FROM core.journal_line l WHERE l.entry_id = p_debit_entry AND l.line_no = p_debit_line RETURNING id $$;

CREATE FUNCTION core.undo_settlement(p_id bigint, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'ar.unallocate');
  INSERT INTO core.settlement_undo (settlement_id, undone_by, reason) VALUES (p_id, p_user, p_reason);
END $$;

-- Automatic allocation of one sub-ledger: first each reversal against the entry it reverses, then oldest open debit
-- against oldest open credit (by effective date, then recording order). Returns the number of settlements created.
CREATE FUNCTION core.allocate_fifo(p_account int, p_party int, p_user text, p_method text DEFAULT 'fifo') RETURNS int LANGUAGE plpgsql AS $$
DECLARE deb record; cre record; n int := 0; x numeric; di int := 1; ci int := 1;
        ds bigint[]; dl int[]; da numeric[]; cs bigint[]; cl int[]; ca numeric[];
BEGIN
  IF p_method NOT IN ('fifo', 'legacy_fifo') THEN RAISE EXCEPTION 'method % is not automatic', p_method; END IF;
  -- 1. reversal pairs: the reversing line settles the line it mirrors
  FOR deb IN
    SELECT o.entry_id oe, o.line_no ol, r.entry_id re, r.line_no rl, o.side, least(o.open_amount, r.open_amount) amt
    FROM core.open_item r JOIN core.open_item o ON o.entry_id = r.reverses_id AND o.account_id = r.account_id AND o.party_id = r.party_id
         AND o.side <> r.side AND o.amount = r.amount
    WHERE r.account_id = p_account AND r.party_id = p_party AND r.reverses_id IS NOT NULL AND r.open_amount > 0 AND o.open_amount > 0
  LOOP
    INSERT INTO core.settlement (account_id, party_id, debit_entry_id, debit_line_no, credit_entry_id, credit_line_no, amount, method, created_by)
    VALUES (p_account, p_party, CASE WHEN deb.side = 'debit' THEN deb.oe ELSE deb.re END, CASE WHEN deb.side = 'debit' THEN deb.ol ELSE deb.rl END,
            CASE WHEN deb.side = 'debit' THEN deb.re ELSE deb.oe END, CASE WHEN deb.side = 'debit' THEN deb.rl ELSE deb.ol END,
            deb.amt, 'reversal_pair', p_user);
    n := n + 1;
  END LOOP;
  -- 2. FIFO over what is left
  SELECT array_agg(entry_id ORDER BY effective_date, entry_id, line_no), array_agg(line_no ORDER BY effective_date, entry_id, line_no),
         array_agg(open_amount ORDER BY effective_date, entry_id, line_no)
    INTO ds, dl, da FROM core.open_item WHERE account_id = p_account AND party_id = p_party AND side = 'debit' AND open_amount > 0;
  SELECT array_agg(entry_id ORDER BY effective_date, entry_id, line_no), array_agg(line_no ORDER BY effective_date, entry_id, line_no),
         array_agg(open_amount ORDER BY effective_date, entry_id, line_no)
    INTO cs, cl, ca FROM core.open_item WHERE account_id = p_account AND party_id = p_party AND side = 'credit' AND open_amount > 0;
  WHILE di <= coalesce(array_length(ds, 1), 0) AND ci <= coalesce(array_length(cs, 1), 0) LOOP
    x := least(da[di], ca[ci]);
    INSERT INTO core.settlement (account_id, party_id, debit_entry_id, debit_line_no, credit_entry_id, credit_line_no, amount, method, created_by)
    VALUES (p_account, p_party, ds[di], dl[di], cs[ci], cl[ci], x, p_method, p_user);
    n := n + 1; da[di] := da[di] - x; ca[ci] := ca[ci] - x;
    IF da[di] = 0 THEN di := di + 1; END IF;
    IF ca[ci] = 0 THEN ci := ci + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

-- Open items as of a date: only items and settlements whose BOTH sides are effective by then (a later receipt never
-- makes an earlier date look settled). Settlements undone after the date still count as undone (current knowledge).
CREATE FUNCTION core.open_items_at(p_as_of date)
RETURNS TABLE (entry_id bigint, line_no int, account_id int, party_id int, effective_date date, due_date date, side text,
               amount numeric, open_amount numeric, source text, source_ref text) LANGUAGE sql STABLE AS $$
  WITH it AS (
    SELECT l.entry_id, l.line_no, l.account_id, l.party_id, e.effective_date, e.effective_date + coalesce(p.payment_terms_days, 0) due_date,
           CASE WHEN l.debit > 0 THEN 'debit' ELSE 'credit' END side, greatest(l.debit, l.credit) amount, e.source, e.source_ref
    FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft' AND e.effective_date <= p_as_of
         AND core.in_subledger(e.kind, e.fiscal_year_id)
    JOIN core.account a ON a.id = l.account_id AND a.requires_party LEFT JOIN core.party p ON p.id = l.party_id),
  st AS (
    SELECT s.debit_entry_id, s.debit_line_no, s.credit_entry_id, s.credit_line_no, s.amount FROM core.settlement_active s
    JOIN core.journal_entry d ON d.id = s.debit_entry_id AND d.effective_date <= p_as_of
    JOIN core.journal_entry c ON c.id = s.credit_entry_id AND c.effective_date <= p_as_of),
  used AS (
    SELECT debit_entry_id e, debit_line_no l, sum(amount) amt FROM st GROUP BY 1, 2
    UNION ALL SELECT credit_entry_id, credit_line_no, sum(amount) FROM st GROUP BY 1, 2)
  SELECT it.entry_id, it.line_no, it.account_id, it.party_id, it.effective_date, it.due_date, it.side, it.amount,
         it.amount - coalesce(u.amt, 0), it.source, it.source_ref
  FROM it LEFT JOIN used u ON u.e = it.entry_id AND u.l = it.line_no
  WHERE it.amount - coalesce(u.amt, 0) > 0 $$;

-- Aging per (account, party) as of a date. Buckets are days past due of the OPEN debit items; open credit items are
-- «unapplied credit» (a receipt not yet matched, an advance, an overpayment). net = ledger balance by construction.
CREATE FUNCTION core.aging(p_as_of date)
RETURNS TABLE (account_id int, party_id int, not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d91_180 numeric,
               d181_365 numeric, over_365 numeric, open_debit numeric, unapplied_credit numeric, net numeric,
               oldest_open_due date) LANGUAGE sql STABLE AS $$
  SELECT account_id, party_id,
    sum(open_amount) FILTER (WHERE side = 'debit' AND p_as_of - due_date <= 0),
    sum(open_amount) FILTER (WHERE side = 'debit' AND p_as_of - due_date BETWEEN 1 AND 30),
    sum(open_amount) FILTER (WHERE side = 'debit' AND p_as_of - due_date BETWEEN 31 AND 60),
    sum(open_amount) FILTER (WHERE side = 'debit' AND p_as_of - due_date BETWEEN 61 AND 90),
    sum(open_amount) FILTER (WHERE side = 'debit' AND p_as_of - due_date BETWEEN 91 AND 180),
    sum(open_amount) FILTER (WHERE side = 'debit' AND p_as_of - due_date BETWEEN 181 AND 365),
    sum(open_amount) FILTER (WHERE side = 'debit' AND p_as_of - due_date > 365),
    coalesce(sum(open_amount) FILTER (WHERE side = 'debit'), 0), coalesce(sum(open_amount) FILTER (WHERE side = 'credit'), 0),
    coalesce(sum(open_amount) FILTER (WHERE side = 'debit'), 0) - coalesce(sum(open_amount) FILTER (WHERE side = 'credit'), 0),
    min(due_date) FILTER (WHERE side = 'debit')
  FROM core.open_items_at(p_as_of) GROUP BY account_id, party_id $$;

-- control: the aging must equal the ledger balance of every sub-ledger, closing entries excluded (any row is a defect)
CREATE FUNCTION core.aging_control(p_as_of date)
RETURNS TABLE (account_id int, party_id int, aging_net numeric, ledger_balance numeric) LANGUAGE sql STABLE AS $$
  WITH b AS (SELECT l.account_id, l.party_id, sum(l.debit - l.credit) bal FROM core.journal_line l
             JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft' AND e.effective_date <= p_as_of
                  AND core.in_subledger(e.kind, e.fiscal_year_id)
             JOIN core.account a ON a.id = l.account_id AND a.requires_party GROUP BY 1, 2)
  SELECT coalesce(a.account_id, b.account_id), coalesce(a.party_id, b.party_id), coalesce(a.net, 0), coalesce(b.bal, 0)
  FROM core.aging(p_as_of) a FULL JOIN b ON b.account_id = a.account_id AND b.party_id = a.party_id
  WHERE coalesce(a.net, 0) <> coalesce(b.bal, 0) $$;

-- status of every document that created a debit on a party (an invoice, a cheque returned, ...)
CREATE VIEW core.receivable_document_status AS
SELECT o.entry_id, o.line_no, o.account_id, o.party_id, o.source, o.source_ref, o.effective_date, o.due_date, o.amount, o.settled, o.open_amount,
       CASE WHEN o.open_amount = 0 THEN 'settled' WHEN o.settled > 0 THEN 'partial' ELSE 'open' END AS status,
       greatest(current_date - o.due_date, 0) AS days_past_due_today,
       (SELECT max(least(greatest(ce.effective_date, o.effective_date), current_date)) FROM core.settlement_active s
        JOIN core.journal_entry ce ON ce.id = s.credit_entry_id
        WHERE s.debit_entry_id = o.entry_id AND s.debit_line_no = o.line_no AND o.open_amount = 0) AS settled_on
FROM core.open_item o WHERE o.side = 'debit';
