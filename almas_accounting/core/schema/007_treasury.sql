-- Almas Shahr accounting — core v0.7: cash boxes, bank-account configuration, cheque location model, treasury documents.
-- Reverse-engineered from Holoo (E18) and proven by migration/cheque_parity.py and migration/treasury_parity.py.
--
-- Cheque model: a cheque always SITS somewhere (an account, plus a party when that account is a person control).
-- Every event records explicitly FROM where and TO where the cheque (or, for issued cheques, the liability) moves;
-- the voucher of an event is always: debit TO, credit FROM (amount = cheque amount).
-- Holoo kept this implicit (and recorded «00000» = nobody as the counterparty of 597 events, W-32); here it is data.

CREATE TABLE core.cashbox (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL,
  cash_account_id int REFERENCES core.account, cheque_account_id int REFERENCES core.account,   -- «اسناد دریافتنی نزد صندوق»
  is_main boolean NOT NULL DEFAULT false, holoo_id int);

ALTER TABLE core.company_bank_account
  ADD COLUMN collection_account_id int REFERENCES core.account,        -- Holoo ACOUND_N.Dar_*: cheques deposited for collection
  ADD COLUMN payable_cheque_account_id int REFERENCES core.account,    -- Holoo ACOUND_N.Par_*: notes payable of issued cheques
  ADD COLUMN fee_account_id int REFERENCES core.account,               -- Holoo ACOUND_N.Wage_*: bank fees
  ADD COLUMN is_pos boolean NOT NULL DEFAULT false, ADD COLUMN holoo_id int;

ALTER TABLE core.cheque
  ADD COLUMN bank_account_id int REFERENCES core.company_bank_account,  -- issued cheques: our account they are drawn on
  ADD COLUMN legacy_source_db text, ALTER COLUMN due_date DROP NOT NULL;

ALTER TABLE core.cheque_event
  ADD COLUMN event_type text CHECK (event_type IN (
      'opening_position',                          -- position carried from the previous year (state = where it was)
      'received', 'deposited_for_collection', 'collected', 'returned_from_bank', 'moved_between_cashboxes',
      'returned_to_payer', 'endorsed_to_party', 'returned_by_endorsee', 'cashed',
      'issued', 'paid_by_bank', 'settled_otherwise')),
  ADD COLUMN from_account_id int REFERENCES core.account, ADD COLUMN from_party_id int REFERENCES core.party,
  ADD COLUMN to_account_id int REFERENCES core.account, ADD COLUMN to_party_id int REFERENCES core.party,
  ADD COLUMN cashbox_id int REFERENCES core.cashbox, ADD COLUMN bank_account_id int REFERENCES core.company_bank_account,
  ADD COLUMN legacy_source_db text, ADD COLUMN legacy_event_id bigint, ADD COLUMN legacy_voucher int;
CREATE UNIQUE INDEX cheque_event_legacy ON core.cheque_event (legacy_source_db, legacy_event_id) WHERE legacy_event_id IS NOT NULL;

-- location chain: for received cheques, an event must start where the previous (non-reversed) event ended
CREATE FUNCTION core.trg_cheque_event_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev core.cheque_event; dirn text;
BEGIN
  IF NEW.event_type IS NULL OR NEW.reverses_event_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.from_account_id IS NULL OR NEW.to_account_id IS NULL THEN
    RAISE EXCEPTION 'cheque event needs from and to accounts (who holds the cheque must be explicit, W-32)'; END IF;
  IF EXISTS (SELECT 1 FROM core.account a WHERE a.id IN (NEW.from_account_id, NEW.to_account_id) AND a.requires_party
             AND ((a.id = NEW.from_account_id AND NEW.from_party_id IS NULL) OR (a.id = NEW.to_account_id AND NEW.to_party_id IS NULL))) THEN
    RAISE EXCEPTION 'cheque event on a person control account needs the party'; END IF;
  SELECT direction INTO dirn FROM core.cheque WHERE id = NEW.cheque_id;
  SELECT * INTO prev FROM core.cheque_event e WHERE e.cheque_id = NEW.cheque_id AND e.event_type IS NOT NULL AND e.reverses_event_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM core.cheque_event r WHERE r.reverses_event_id = e.id)
   ORDER BY e.effective_date DESC, e.id DESC LIMIT 1;
  IF FOUND AND dirn = 'in' AND (prev.to_account_id, prev.to_party_id) IS DISTINCT FROM (NEW.from_account_id, NEW.from_party_id) THEN
    RAISE EXCEPTION 'cheque % is at account % but the event moves it from %', NEW.cheque_id, prev.to_account_id, NEW.from_account_id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cheque_event_chain BEFORE INSERT ON core.cheque_event FOR EACH ROW EXECUTE FUNCTION core.trg_cheque_event_chain();

-- the voucher lines of one event: debit TO, credit FROM
CREATE FUNCTION core.cheque_event_lines(p_event bigint)
RETURNS TABLE (line_no int, account_id int, party_id int, debit numeric, credit numeric, role text) LANGUAGE sql STABLE AS $$
  SELECT 1, e.to_account_id, e.to_party_id, c.amount, 0::numeric, 'cheque_to:' || e.event_type FROM core.cheque_event e JOIN core.cheque c ON c.id = e.cheque_id WHERE e.id = p_event
  UNION ALL
  SELECT 2, e.from_account_id, e.from_party_id, 0::numeric, c.amount, 'cheque_from:' || e.event_type FROM core.cheque_event e JOIN core.cheque c ON c.id = e.cheque_id WHERE e.id = p_event $$;

-- where every cheque is now (derived from its last live event)
CREATE VIEW core.cheque_location AS
SELECT DISTINCT ON (c.id) c.id AS cheque_id, c.direction, c.number, c.amount, c.due_date, e.event_type AS last_event, e.effective_date AS since,
       e.to_account_id AS account_id, e.to_party_id AS party_id
FROM core.cheque c JOIN core.cheque_event e ON e.cheque_id = c.id AND e.event_type IS NOT NULL AND e.reverses_event_id IS NULL
 AND NOT EXISTS (SELECT 1 FROM core.cheque_event r WHERE r.reverses_event_id = e.id)
ORDER BY c.id, e.effective_date DESC, e.id DESC;

-- post a set of cheque events as one journal entry (a Holoo voucher can hold many cheques)
CREATE FUNCTION core.post_cheque_events(p_events bigint[], p_date date, p_source_ref text, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE eid bigint; per core.period;
BEGIN
  SELECT entry_id INTO eid FROM core.document_posting WHERE source = 'cheque' AND source_ref = p_source_ref;
  IF FOUND THEN RETURN eid; END IF;
  SELECT * INTO per FROM core.period WHERE p_date BETWEEN starts_on AND ends_on;
  INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, source, source_ref, created_by)
  VALUES (per.fiscal_year_id, per.id, p_date, 'cheque', p_source_ref, p_user) RETURNING id INTO eid;
  INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, credit, description)
  SELECT eid, row_number() OVER (), l.account_id, l.party_id, l.debit, l.credit, l.role
  FROM unnest(p_events) ev(id) CROSS JOIN LATERAL core.cheque_event_lines(ev.id) l;
  UPDATE core.journal_entry SET status = 'posted', posted_by = p_user WHERE id = eid;
  UPDATE core.cheque_event SET journal_entry_id = eid WHERE id = ANY (p_events) AND journal_entry_id IS NULL;
  INSERT INTO core.document_posting (source, source_ref, entry_id, posted_by) VALUES ('cheque', p_source_ref, eid, p_user);
  RETURN eid;
END $$;

-- cheque events are immutable (001), but the posting link is set once, by post_cheque_events
CREATE OR REPLACE FUNCTION core.trg_cheque_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.journal_entry_id IS NULL AND NEW.journal_entry_id IS NOT NULL
     AND (to_jsonb(NEW) - 'journal_entry_id') = (to_jsonb(OLD) - 'journal_entry_id') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'cheque events are immutable; record a reversing event instead';
END $$;

-- ============ Treasury documents (receipt / payment / transfer / bank fee) ============
-- doc = {kind, money_account_id (own cash box or bank account GL), counter: [{account_id, party_id, amount}],
--        fees: [{account_id, amount}], discounts: [{account_id, amount}]}
-- receipt:  Dr money (counter − discounts) / Cr each counter, Dr discount (cash discount given, «تخفیفات نقدی فروش»)
-- payment:  Dr each counter / Cr money (counter − discounts), Cr discount (cash discount received, «تخفیفات نقدی خرید»)
-- transfer / bank_fee: Dr each counter / Cr money (transfer = counter is another own cash/bank account; bank_fee = fee account)
-- fees (any kind): Dr fee account / Cr money account (the bank that charged it)
INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('account_purchase_cash_discount', '8030001', NULL, '^[0-9A-Z]{3,12}$', 'E19'),
  ('account_sales_cash_discount',    '9030001', NULL, '^[0-9A-Z]{3,12}$', 'E19');

CREATE FUNCTION core.treasury_posting_lines(doc jsonb)
RETURNS TABLE (line_no int, account_id int, party_id int, debit numeric, credit numeric, role text) LANGUAGE plpgsql STABLE AS $$
DECLARE k text := doc->>'kind'; m int := (doc->>'money_account_id')::int; tot numeric; fee numeric; disc numeric;
BEGIN
  IF k NOT IN ('receipt', 'payment', 'transfer', 'bank_fee') THEN RAISE EXCEPTION 'unknown treasury kind %', k; END IF;
  IF m IS NULL THEN RAISE EXCEPTION 'money account is required'; END IF;
  SELECT coalesce(sum((c->>'amount')::numeric), 0) INTO tot FROM jsonb_array_elements(coalesce(doc->'counter', '[]')) c;
  SELECT coalesce(sum((f->>'amount')::numeric), 0) INTO fee FROM jsonb_array_elements(coalesce(doc->'fees', '[]')) f;
  SELECT coalesce(sum((d->>'amount')::numeric), 0) INTO disc FROM jsonb_array_elements(coalesce(doc->'discounts', '[]')) d;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(doc->'counter', '[]') || coalesce(doc->'fees', '[]') || coalesce(doc->'discounts', '[]')) c
             WHERE (c->>'amount')::numeric <= 0) THEN
    RAISE EXCEPTION 'amounts must be positive'; END IF;
  IF disc > 0 AND k NOT IN ('receipt', 'payment') THEN RAISE EXCEPTION 'a discount belongs to a receipt or a payment'; END IF;
  IF disc > tot THEN RAISE EXCEPTION 'discount % exceeds the settled amount %', disc, tot; END IF;
  IF k = 'transfer' AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(doc->'counter', '[]')) c
                                WHERE (c->>'account_id')::int = m OR c->>'party_id' IS NOT NULL) THEN
    RAISE EXCEPTION 'transfer is between own accounts: no party, different accounts'; END IF;
  RETURN QUERY
  WITH x AS (
    SELECT 1 ord, m acc, NULL::int par, tot - disc amt, 1 side, 'money_in'::text r WHERE k = 'receipt' AND tot - disc > 0
    UNION ALL SELECT 2, (c->>'account_id')::int, (c->>'party_id')::int, (c->>'amount')::numeric, -1, 'counter'
      FROM jsonb_array_elements(coalesce(doc->'counter', '[]')) c WHERE k = 'receipt'
    UNION ALL SELECT 2, (c->>'account_id')::int, (c->>'party_id')::int, (c->>'amount')::numeric, 1, 'counter'
      FROM jsonb_array_elements(coalesce(doc->'counter', '[]')) c WHERE k IN ('payment', 'transfer', 'bank_fee')
    UNION ALL SELECT 1, m, NULL, tot - disc, -1, 'money_out' WHERE k IN ('payment', 'transfer', 'bank_fee') AND tot - disc > 0
    UNION ALL SELECT 3, (d->>'account_id')::int, NULL, (d->>'amount')::numeric, CASE WHEN k = 'receipt' THEN 1 ELSE -1 END, 'cash_discount'
      FROM jsonb_array_elements(coalesce(doc->'discounts', '[]')) d
    UNION ALL SELECT 4, (f->>'account_id')::int, NULL, (f->>'amount')::numeric, 1, 'fee' FROM jsonb_array_elements(coalesce(doc->'fees', '[]')) f
    UNION ALL SELECT 5, m, NULL, fee, -1, 'fee_paid' WHERE fee > 0)
  SELECT (row_number() OVER (ORDER BY ord, acc))::int, acc, par, CASE WHEN side = 1 THEN amt ELSE 0 END, CASE WHEN side = -1 THEN amt ELSE 0 END, r FROM x;
END $$;

-- ============ Guarantee instruments (memo / off-balance: «چک‌های امانی») ============
-- Holoo books a guarantee cheque as Dr 0010002 / Cr 0020002 (received) and the reverse on return, with NO party:
-- whose guarantee it is lives only in the line description (W-35). Here the guarantor is required; a record
-- imported from Holoo may lack it only while it carries its legacy voucher (to be completed by the user).
CREATE TABLE core.guarantee_instrument (
  id bigserial PRIMARY KEY, direction text NOT NULL CHECK (direction IN ('received', 'given')),
  instrument text NOT NULL DEFAULT 'cheque' CHECK (instrument IN ('cheque', 'promissory_note', 'other')),
  party_id int REFERENCES core.party, number text, bank_code text, amount numeric(20,0) NOT NULL CHECK (amount > 0),
  purpose text, memo_account_id int NOT NULL REFERENCES core.account, memo_counter_account_id int NOT NULL REFERENCES core.account,
  legacy_source_db text, legacy_voucher int,
  CHECK (party_id IS NOT NULL OR legacy_voucher IS NOT NULL));
CREATE TABLE core.guarantee_event (
  id bigserial PRIMARY KEY, guarantee_id bigint NOT NULL REFERENCES core.guarantee_instrument,
  event_type text NOT NULL CHECK (event_type IN ('taken', 'released')),   -- taken = received / given; released = returned
  effective_date date NOT NULL, journal_entry_id bigint REFERENCES core.journal_entry, legacy_voucher int, note text);
CREATE FUNCTION core.trg_guarantee_event_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last text;
BEGIN
  SELECT event_type INTO last FROM core.guarantee_event WHERE guarantee_id = NEW.guarantee_id ORDER BY effective_date DESC, id DESC LIMIT 1;
  IF coalesce(last, 'released') = NEW.event_type THEN
    RAISE EXCEPTION 'guarantee % is already %', NEW.guarantee_id, coalesce(last, 'not taken'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guarantee_event_rules BEFORE INSERT ON core.guarantee_event FOR EACH ROW EXECUTE FUNCTION core.trg_guarantee_event_rules();

-- taken: Dr memo / Cr memo counter; released: the reverse (both lines carry the guarantor)
CREATE FUNCTION core.guarantee_event_lines(p_event bigint)
RETURNS TABLE (line_no int, account_id int, party_id int, debit numeric, credit numeric, role text) LANGUAGE sql STABLE AS $$
  SELECT 1, CASE WHEN e.event_type = 'taken' THEN g.memo_account_id ELSE g.memo_counter_account_id END, g.party_id, g.amount, 0::numeric, 'guarantee_' || e.event_type
  FROM core.guarantee_event e JOIN core.guarantee_instrument g ON g.id = e.guarantee_id WHERE e.id = p_event
  UNION ALL
  SELECT 2, CASE WHEN e.event_type = 'taken' THEN g.memo_counter_account_id ELSE g.memo_account_id END, g.party_id, 0::numeric, g.amount, 'guarantee_' || e.event_type
  FROM core.guarantee_event e JOIN core.guarantee_instrument g ON g.id = e.guarantee_id WHERE e.id = p_event $$;

CREATE VIEW core.guarantee_open AS
SELECT g.*, e.effective_date AS taken_on FROM core.guarantee_instrument g
JOIN LATERAL (SELECT * FROM core.guarantee_event x WHERE x.guarantee_id = g.id ORDER BY effective_date DESC, id DESC LIMIT 1) e ON e.event_type = 'taken';
