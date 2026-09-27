-- Almas Shahr accounting — core v0.11: year-end closing and next year's opening (ACC-10, ACC-11, W-19).
-- Reverse-engineered from Holoo's 1404 closing vouchers (E22) and proven by migration/year_end_parity.py:
--   temporary closing (Holoo Sanad_State 2, «بستن حساب‌های موقت»):
--     1. periodic inventory (D-02): the balances of opening inventory (106…) and of purchases / purchase returns /
--        purchase discounts (801…, 802…, 803…) move into cost of goods sold (503);
--     2. ending inventory: Dr ending inventory (105) / Cr cost of goods sold — the valuation is an INPUT of the close
--        (Holoo: stock × purchase price, E06.2); the new system records who gave it and from what source;
--     3. every income-statement account (cost of goods sold included) is closed to the P&L account of the year.
--   permanent closing (Holoo Sanad_State 3, «اختتامیه»): every balance-sheet and memo account, per party, is closed
--     against the closing-balance account (006) in exactly two lines (total debit, total credit).
--   opening of the next year («افتتاحیه»): the mirror image of the permanent closing against the opening-balance
--     account (005), generated from it — never typed by hand (W-19: in Holoo the opening was rewritten 12 times).
-- One pure rule, core.year_end_lines, is used for posting and for the parity with Holoo.

INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('closing_cogs_sources',        '106,801,802,803', NULL, '^[0-9A-Z]{1,12}(,[0-9A-Z]{1,12})*$', 'E22'),
  ('account_cogs',                '503',     NULL, '^[0-9A-Z]{3,12}$', 'E22'),
  ('account_ending_inventory',    '105',     NULL, '^[0-9A-Z]{3,12}$', 'E22'),
  ('account_closing_balance',     '006',     NULL, '^[0-9A-Z]{3,12}$', 'E22'),
  ('account_opening_balance',     '005',     NULL, '^[0-9A-Z]{3,12}$', 'E22');

CREATE TABLE core.year_end_close (
  fiscal_year_id int PRIMARY KEY REFERENCES core.fiscal_year, ending_inventory numeric(20,0) NOT NULL CHECK (ending_inventory >= 0),
  inventory_source text NOT NULL CHECK (length(btrim(inventory_source)) >= 3),     -- e.g. «شمارش پایان سال + ارزش‌گذاری …»
  pl_account_id int NOT NULL REFERENCES core.account, temporary_entry_id bigint REFERENCES core.journal_entry,
  permanent_entry_id bigint REFERENCES core.journal_entry, opening_entry_id bigint REFERENCES core.journal_entry,
  next_fiscal_year_id int REFERENCES core.fiscal_year,
  closed_by text NOT NULL, closed_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL);

-- balances of a year per (account, party), closing entries excluded
CREATE FUNCTION core.pre_closing_balance(p_year text)
RETURNS TABLE (account_id int, party_id int, balance numeric) LANGUAGE sql STABLE AS $$
  SELECT l.account_id, l.party_id, sum(l.debit - l.credit) FROM core.year_lines(p_year) l
  WHERE l.kind <> 'closing' GROUP BY 1, 2 HAVING sum(l.debit - l.credit) <> 0 $$;

CREATE FUNCTION core.year_end_lines(p_year text, p_ending_inventory numeric, p_pl_account int)
RETURNS TABLE (stage text, line_no int, account_id int, party_id int, debit numeric, credit numeric, role text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE cogs int := core.setting_account('account_cogs'); endinv int := core.setting_account('account_ending_inventory');
        cls int := core.setting_account('account_closing_balance'); src text[] := string_to_array(core.setting_value('closing_cogs_sources'), ',');
BEGIN
  IF cogs IS NULL OR endinv IS NULL OR cls IS NULL OR p_pl_account IS NULL THEN RAISE EXCEPTION 'closing accounts are not configured'; END IF;
  IF p_ending_inventory IS NULL OR p_ending_inventory < 0 THEN RAISE EXCEPTION 'ending inventory valuation is required'; END IF;
  RETURN QUERY
  WITH b AS (SELECT * FROM core.pre_closing_balance(p_year)),
  acc AS (SELECT a.id, a.code, a.statement FROM core.account a),
  -- 1. COGS sources → COGS
  t1 AS (SELECT b.account_id, b.party_id, -b.balance AS amt, 'cogs_source'::text AS r FROM b JOIN acc ON acc.id = b.account_id
         WHERE EXISTS (SELECT 1 FROM unnest(src) s WHERE acc.code LIKE s || '%') AND b.account_id <> cogs),
  t1c AS (SELECT cogs AS account_id, NULL::int AS party_id, -coalesce(sum(amt), 0) AS amt, 'cogs_build'::text AS r FROM t1),
  -- 2. ending inventory
  t2 AS (SELECT endinv AS account_id, NULL::int AS party_id, p_ending_inventory AS amt, 'ending_inventory'::text AS r WHERE p_ending_inventory > 0
         UNION ALL SELECT cogs, NULL, -p_ending_inventory, 'ending_inventory' WHERE p_ending_inventory > 0),
  -- balances after steps 1–2
  after12 AS (SELECT account_id, party_id, sum(amt) bal FROM (
                SELECT account_id, party_id, balance amt FROM b UNION ALL SELECT account_id, party_id, amt FROM t1
                UNION ALL SELECT account_id, party_id, amt FROM t1c UNION ALL SELECT account_id, party_id, amt FROM t2) z
              GROUP BY 1, 2),
  -- 3. income statement → P&L of the year
  t3 AS (SELECT a.account_id, a.party_id, -a.bal AS amt, 'close_income_statement'::text AS r FROM after12 a JOIN acc ON acc.id = a.account_id
         WHERE acc.statement = 'income_statement' AND a.bal <> 0),
  t3p AS (SELECT p_pl_account AS account_id, NULL::int AS party_id, -coalesce(sum(amt), 0) AS amt, 'profit_or_loss'::text AS r FROM t3),
  tmp AS (SELECT * FROM t1 UNION ALL SELECT * FROM t1c UNION ALL SELECT * FROM t2 UNION ALL SELECT * FROM t3 UNION ALL SELECT * FROM t3p),
  tmpn AS (SELECT account_id, party_id, sum(amt) amt, min(r) r FROM tmp GROUP BY 1, 2 HAVING sum(amt) <> 0),
  -- balances after the temporary closing → permanent closing against 006
  after_t AS (SELECT account_id, party_id, sum(amt) bal FROM (
                SELECT account_id, party_id, balance amt FROM b UNION ALL SELECT account_id, party_id, amt FROM tmpn) z
              GROUP BY 1, 2 HAVING sum(amt) <> 0),
  perm AS (SELECT a.account_id, a.party_id, -a.bal AS amt, 'close_balance'::text AS r FROM after_t a JOIN acc ON acc.id = a.account_id
           WHERE acc.statement IN ('balance_sheet', 'memo') AND a.account_id <> cls)
  SELECT 'temporary', (row_number() OVER (ORDER BY t.r, t.account_id, t.party_id))::int, t.account_id, t.party_id,
         greatest(t.amt, 0), greatest(-t.amt, 0), t.r FROM tmpn t
  UNION ALL
  SELECT 'permanent', (row_number() OVER (ORDER BY p.account_id, p.party_id))::int, p.account_id, p.party_id,
         greatest(p.amt, 0), greatest(-p.amt, 0), p.r FROM perm p
  UNION ALL
  SELECT 'permanent', 1000000, cls, NULL, (SELECT coalesce(sum(-amt), 0) FROM perm WHERE amt < 0), 0, 'closing_balance_debit'
  WHERE EXISTS (SELECT 1 FROM perm WHERE amt < 0)
  UNION ALL
  SELECT 'permanent', 1000001, cls, NULL, 0, (SELECT coalesce(sum(amt), 0) FROM perm WHERE amt > 0), 'closing_balance_credit'
  WHERE EXISTS (SELECT 1 FROM perm WHERE amt > 0);
END $$;

CREATE FUNCTION core._post_lines(p_year int, p_date date, p_kind text, p_ref text, p_user text, p_desc text, p_lines jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE eid bigint; per int;
BEGIN
  SELECT id INTO per FROM core.period WHERE fiscal_year_id = p_year AND p_date BETWEEN starts_on AND ends_on;
  INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, kind, source, source_ref, description, created_by)
  VALUES (p_year, per, p_date, p_kind, 'year_end', p_ref, p_desc, p_user) RETURNING id INTO eid;
  INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, credit, description)
  SELECT eid, row_number() OVER (), (x->>'account_id')::int, (x->>'party_id')::int, (x->>'debit')::numeric, (x->>'credit')::numeric, x->>'role'
  FROM jsonb_array_elements(p_lines) x WHERE (x->>'debit')::numeric > 0 OR (x->>'credit')::numeric > 0;
  UPDATE core.journal_entry SET status = 'posted', posted_by = p_user WHERE id = eid;
  RETURN eid;
END $$;

-- close a year: the year must be in status 'closing' (D-05: only with permission, audited); posts both closing entries
CREATE FUNCTION core.close_fiscal_year(p_year text, p_ending_inventory numeric, p_inventory_source text, p_pl_account int,
                                       p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE y core.fiscal_year; t bigint; p bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'period.close'); PERFORM core.require_reason(p_reason);
  SELECT * INTO y FROM core.fiscal_year WHERE code = p_year;
  IF y.status <> 'closing' THEN RAISE EXCEPTION 'fiscal year % must be in status closing (is %)', p_year, y.status; END IF;
  IF EXISTS (SELECT 1 FROM core.year_end_close WHERE fiscal_year_id = y.id) THEN RAISE EXCEPTION 'fiscal year % is already closed', p_year; END IF;
  IF EXISTS (SELECT 1 FROM core.year_lines(p_year) WHERE kind = 'closing') THEN
    RAISE EXCEPTION 'fiscal year % already holds closing entries (e.g. migrated from Holoo)', p_year; END IF;
  t := core._post_lines(y.id, y.ends_on, 'closing', 'year_end:' || p_year || ':temporary', p_user, 'Temporary closing ' || p_year,
         (SELECT jsonb_agg(to_jsonb(l)) FROM core.year_end_lines(p_year, p_ending_inventory, p_pl_account) l WHERE stage = 'temporary'));
  p := core._post_lines(y.id, y.ends_on, 'closing', 'year_end:' || p_year || ':permanent', p_user, 'Closing ' || p_year,
         (SELECT jsonb_agg(to_jsonb(l)) FROM core.year_end_lines(p_year, p_ending_inventory, p_pl_account) l WHERE stage = 'permanent'));
  INSERT INTO core.year_end_close (fiscal_year_id, ending_inventory, inventory_source, pl_account_id, temporary_entry_id, permanent_entry_id, closed_by, reason)
  VALUES (y.id, p_ending_inventory, p_inventory_source, p_pl_account, t, p, p_user, p_reason);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason)
  VALUES (p_user, 'close', 'fiscal_year', p_year, jsonb_build_object('ending_inventory', p_ending_inventory, 'temporary', t, 'permanent', p), p_reason);
END $$;

-- opening of the next year = mirror of the permanent closing against 005; generated, never typed
CREATE FUNCTION core.open_next_fiscal_year(p_year text, p_next text, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c core.year_end_close; n core.fiscal_year; e bigint; opn int := core.setting_account('account_opening_balance');
        cls int := core.setting_account('account_closing_balance');
BEGIN
  PERFORM core.require_permission(p_user, 'period.close');
  SELECT yc.* INTO c FROM core.year_end_close yc JOIN core.fiscal_year y ON y.id = yc.fiscal_year_id WHERE y.code = p_year;
  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal year % is not closed', p_year; END IF;
  IF c.opening_entry_id IS NOT NULL THEN RETURN c.opening_entry_id; END IF;          -- idempotent
  SELECT * INTO n FROM core.fiscal_year WHERE code = p_next;
  IF n.starts_on IS DISTINCT FROM (SELECT ends_on + 1 FROM core.fiscal_year WHERE id = c.fiscal_year_id) THEN
    RAISE EXCEPTION 'fiscal year % does not follow %', p_next, p_year; END IF;
  e := core._post_lines(n.id, n.starts_on, 'opening', 'year_end:' || p_year || ':opening', p_user, 'Opening ' || p_next || ' from closing ' || p_year,
         (SELECT jsonb_agg(jsonb_build_object('account_id', CASE WHEN l.account_id = cls THEN opn ELSE l.account_id END, 'party_id', l.party_id,
                                              'debit', l.credit, 'credit', l.debit, 'role', 'opening') ORDER BY l.line_no)
          FROM core.journal_line l WHERE l.entry_id = c.permanent_entry_id));
  UPDATE core.year_end_close SET opening_entry_id = e, next_fiscal_year_id = n.id WHERE fiscal_year_id = c.fiscal_year_id;
  RETURN e;
END $$;
-- the opening is locked: any other entry of kind 'opening' in a year that has a generated one is refused
CREATE FUNCTION core.trg_single_opening() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'opening' AND EXISTS (SELECT 1 FROM core.journal_entry x WHERE x.fiscal_year_id = NEW.fiscal_year_id AND x.kind = 'opening' AND x.id <> NEW.id
                                      AND x.status <> 'draft' AND NOT EXISTS (SELECT 1 FROM core.journal_entry r WHERE r.reverses_id = x.id)) THEN
    RAISE EXCEPTION 'fiscal year already has an opening entry; correct the closed year through a controlled reopening (W-19)'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER single_opening BEFORE INSERT ON core.journal_entry FOR EACH ROW EXECUTE FUNCTION core.trg_single_opening();
