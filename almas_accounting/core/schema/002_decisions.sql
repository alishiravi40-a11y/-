-- Almas Shahr accounting — core data model v0.2: owner decisions D-01, D-02, D-05, D-06 (and open D-11).
-- Applied after 001_core.sql. Every rule is enforced by the database and proven in core/tests/test_decisions.py.
-- Note: the DB guards below stop accidental/direct changes from any client; the deployment must also REVOKE direct
-- UPDATE on core.period / core.fiscal_year / core.setting / core.user_permission from the application role, so the
-- controlled functions (SECURITY DEFINER in production) are the only path.

-- ============ Users and permissions ============
CREATE TABLE core.app_user (
  username text PRIMARY KEY, display_name text, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE core.permission (code text PRIMARY KEY, description text NOT NULL);
INSERT INTO core.permission VALUES
  ('security.admin',   'grant and revoke permissions'),
  ('settings.change',  'change system settings (core.setting)'),
  ('period.close',     'move a fiscal year / period to closing or closed (D-05)'),
  ('period.reopen',    'reopen a closing/closed fiscal year or period (D-05)'),
  ('sales.below_cost', 'finalize a sales invoice with lines below purchase price (D-06)');
CREATE TABLE core.user_permission (
  username text NOT NULL REFERENCES core.app_user, permission text NOT NULL REFERENCES core.permission,
  granted_by text NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(), reason text,
  PRIMARY KEY (username, permission));

CREATE FUNCTION core.has_permission(p_user text, p_perm text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM core.user_permission up JOIN core.app_user u USING (username)
                 WHERE up.username = p_user AND up.permission = p_perm AND u.active) $$;

CREATE FUNCTION core.require_permission(p_user text, p_perm text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT core.has_permission(p_user, p_perm) THEN
    RAISE EXCEPTION 'permission denied: user % lacks %', p_user, p_perm USING ERRCODE = 'insufficient_privilege'; END IF;
END $$;

CREATE FUNCTION core.require_reason(p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'a reason is required'; END IF;
END $$;

CREATE FUNCTION core.grant_permission(p_user text, p_perm text, p_by text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_by, 'security.admin'); PERFORM core.require_reason(p_reason);
  INSERT INTO core.user_permission (username, permission, granted_by, reason) VALUES (p_user, p_perm, p_by, p_reason)
  ON CONFLICT DO NOTHING;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason)
  VALUES (p_by, 'grant', 'user_permission', p_user || ':' || p_perm, jsonb_build_object('permission', p_perm), p_reason);
END $$;

CREATE FUNCTION core.revoke_permission(p_user text, p_perm text, p_by text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_by, 'security.admin'); PERFORM core.require_reason(p_reason);
  DELETE FROM core.user_permission WHERE username = p_user AND permission = p_perm;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, reason)
  VALUES (p_by, 'revoke', 'user_permission', p_user || ':' || p_perm, jsonb_build_object('permission', p_perm), p_reason);
END $$;

-- ============ Settings (D-01, D-02, D-11) ============
CREATE TABLE core.setting (
  key text PRIMARY KEY, value text NOT NULL, allowed text[] NOT NULL, decision text NOT NULL,
  updated_by text NOT NULL DEFAULT 'install', updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (value = ANY (allowed)));
INSERT INTO core.setting (key, value, allowed, decision) VALUES
  -- D-01: keep Holoo's VAT behaviour: tax/levy amounts are stored as given, never computed from a guessed rate
  ('vat_mode', 'holoo_compatible', '{holoo_compatible}', 'D-01'),
  -- D-02: periodic inventory accounting: sales post no COGS entry; COGS is computed at year close
  ('inventory_accounting', 'periodic', '{periodic}', 'D-02'),
  -- D-11 (open): which purchase price defines "below cost". undecided = below EITHER basis needs permission
  ('below_cost_basis', 'undecided', '{undecided,moving_average,last_purchase,max}', 'D-11');

CREATE FUNCTION core.setting_value(p_key text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT value FROM core.setting WHERE key = p_key $$;

CREATE FUNCTION core.change_setting(p_key text, p_value text, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE old text;
BEGIN
  PERFORM core.require_permission(p_user, 'settings.change'); PERFORM core.require_reason(p_reason);
  SELECT value INTO old FROM core.setting WHERE key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown setting %', p_key; END IF;
  PERFORM set_config('almas.controlled_change', 'on', true);
  UPDATE core.setting SET value = p_value, updated_by = p_user, updated_at = now() WHERE key = p_key;
  PERFORM set_config('almas.controlled_change', 'off', true);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after, reason)
  VALUES (p_user, 'change', 'setting', p_key, jsonb_build_object('value', old), jsonb_build_object('value', p_value), p_reason);
END $$;

CREATE FUNCTION core.trg_controlled_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('almas.controlled_change', true), 'off') <> 'on' THEN
    RAISE EXCEPTION '% is changed only through its controlled function', TG_TABLE_NAME; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER setting_controlled BEFORE UPDATE OR DELETE ON core.setting FOR EACH ROW EXECUTE FUNCTION core.trg_controlled_only();

-- ============ D-05: several fiscal years open at once; close/reopen only by permission + reason + audit ============
ALTER TABLE core.fiscal_year ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed'));

CREATE FUNCTION core.trg_status_controlled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND coalesce(current_setting('almas.controlled_change', true), 'off') <> 'on' THEN
    RAISE EXCEPTION '% status is changed only through core.change_%_status (permission + reason + audit)', TG_TABLE_NAME, TG_TABLE_NAME; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_year_status_controlled BEFORE UPDATE ON core.fiscal_year FOR EACH ROW EXECUTE FUNCTION core.trg_status_controlled();
CREATE TRIGGER period_status_controlled BEFORE UPDATE ON core.period FOR EACH ROW EXECUTE FUNCTION core.trg_status_controlled();

-- which permission a status transition needs
CREATE FUNCTION core.status_permission(p_old text, p_new text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_old = p_new THEN NULL
              WHEN (p_old = 'open') OR (p_old = 'closing' AND p_new = 'closed') THEN 'period.close'
              ELSE 'period.reopen' END $$;

CREATE FUNCTION core.change_period_status(p_period int, p_new text, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p core.period; y core.fiscal_year; perm text;
BEGIN
  SELECT * INTO p FROM core.period WHERE id = p_period FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown period %', p_period; END IF;
  SELECT * INTO y FROM core.fiscal_year WHERE id = p.fiscal_year_id;
  perm := core.status_permission(p.status, p_new);
  IF perm IS NULL THEN RAISE EXCEPTION 'period % is already %', p.code, p_new; END IF;
  PERFORM core.require_permission(p_user, perm); PERFORM core.require_reason(p_reason);
  IF perm = 'period.reopen' AND y.status = 'closed' THEN
    RAISE EXCEPTION 'fiscal year % is closed: reopen the year first', y.code; END IF;
  PERFORM set_config('almas.controlled_change', 'on', true);
  UPDATE core.period SET status = p_new WHERE id = p_period;
  PERFORM set_config('almas.controlled_change', 'off', true);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after, reason)
  VALUES (p_user, CASE perm WHEN 'period.close' THEN 'close' ELSE 'reopen' END, 'period', p.code,
          jsonb_build_object('status', p.status), jsonb_build_object('status', p_new), p_reason);
END $$;

CREATE FUNCTION core.change_fiscal_year_status(p_year int, p_new text, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE y core.fiscal_year; perm text;
BEGIN
  SELECT * INTO y FROM core.fiscal_year WHERE id = p_year FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown fiscal year %', p_year; END IF;
  perm := core.status_permission(y.status, p_new);
  IF perm IS NULL THEN RAISE EXCEPTION 'fiscal year % is already %', y.code, p_new; END IF;
  PERFORM core.require_permission(p_user, perm); PERFORM core.require_reason(p_reason);
  IF p_new = 'closed' AND EXISTS (SELECT 1 FROM core.period WHERE fiscal_year_id = p_year AND status <> 'closed') THEN
    RAISE EXCEPTION 'fiscal year % still has periods that are not closed', y.code; END IF;
  IF p_new = 'closed' AND EXISTS (SELECT 1 FROM core.journal_entry WHERE fiscal_year_id = p_year AND status = 'draft') THEN
    RAISE EXCEPTION 'fiscal year % still has draft entries', y.code; END IF;
  PERFORM set_config('almas.controlled_change', 'on', true);
  UPDATE core.fiscal_year SET status = p_new WHERE id = p_year;
  PERFORM set_config('almas.controlled_change', 'off', true);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after, reason)
  VALUES (p_user, CASE perm WHEN 'period.close' THEN 'close' ELSE 'reopen' END, 'fiscal_year', y.code,
          jsonb_build_object('status', y.status), jsonb_build_object('status', p_new), p_reason);
END $$;

-- a period can never belong to two years' date ranges: it must lie inside its own year
CREATE FUNCTION core.trg_period_in_year() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y core.fiscal_year;
BEGIN
  SELECT * INTO y FROM core.fiscal_year WHERE id = NEW.fiscal_year_id;
  IF NEW.starts_on < y.starts_on OR NEW.ends_on > y.ends_on THEN
    RAISE EXCEPTION 'period % lies outside fiscal year %', NEW.code, y.code; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER period_in_year BEFORE INSERT OR UPDATE ON core.period FOR EACH ROW EXECUTE FUNCTION core.trg_period_in_year();

-- Entry rules v0.2: v0.1 rules + the entry's period must belong to the entry's fiscal year (full per-year separation)
-- + the year's own status is enforced as well as the period's.
CREATE OR REPLACE FUNCTION core.trg_entry_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p core.period; y core.fiscal_year; eff text;
BEGIN
  SELECT * INTO p FROM core.period WHERE id = NEW.period_id;
  IF p.fiscal_year_id <> NEW.fiscal_year_id THEN
    RAISE EXCEPTION 'period % does not belong to fiscal year %', p.code, NEW.fiscal_year_id; END IF;
  SELECT * INTO y FROM core.fiscal_year WHERE id = NEW.fiscal_year_id;
  IF NEW.effective_date NOT BETWEEN p.starts_on AND p.ends_on THEN
    RAISE EXCEPTION 'effective_date % is outside period %', NEW.effective_date, p.code; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'approved', 'final') THEN
    IF NEW.status = 'draft' OR NEW.effective_date <> OLD.effective_date OR NEW.period_id <> OLD.period_id
       OR NEW.kind <> OLD.kind OR NEW.fiscal_year_id <> OLD.fiscal_year_id THEN
      RAISE EXCEPTION 'posted entry % is immutable; use a reversal', OLD.id; END IF;
  END IF;
  IF NEW.status <> 'draft' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    -- the stricter of year and period status applies
    eff := CASE WHEN 'closed' IN (p.status, y.status) THEN 'closed'
                WHEN 'closing' IN (p.status, y.status) THEN 'closing' ELSE 'open' END;
    IF eff = 'closed' THEN RAISE EXCEPTION 'period % is closed', p.code; END IF;
    IF eff = 'closing' AND NEW.kind NOT IN ('adjustment', 'closing', 'reversal') THEN
      RAISE EXCEPTION 'period % is closing: only adjustment entries are allowed', p.code; END IF;
    IF (SELECT coalesce(SUM(debit), 0) - coalesce(SUM(credit), 0) FROM core.journal_line WHERE entry_id = NEW.id) <> 0
       OR NOT EXISTS (SELECT 1 FROM core.journal_line WHERE entry_id = NEW.id) THEN
      RAISE EXCEPTION 'entry % is not balanced or has no lines', NEW.id; END IF;
    NEW.posted_at := coalesce(NEW.posted_at, now());
  END IF;
  RETURN NEW;
END $$;

-- per-year reports (separation of reports per fiscal year)
CREATE VIEW core.trial_balance_by_year AS
SELECT y.code AS fiscal_year, a.code, a.name, SUM(l.debit) debit, SUM(l.credit) credit, SUM(l.debit - l.credit) balance
FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft'
JOIN core.fiscal_year y ON y.id = e.fiscal_year_id JOIN core.account a ON a.id = l.account_id
GROUP BY y.code, a.code, a.name;

-- ============ Items and sales invoices (D-01, D-02, D-06, D-11) ============
CREATE TABLE core.item (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL, unit text,
  holoo_a_code text, holoo_source_db text, active boolean NOT NULL DEFAULT true);

CREATE TABLE core.sales_invoice (
  id bigserial PRIMARY KEY, fiscal_year_id int NOT NULL REFERENCES core.fiscal_year,
  number bigint, invoice_date date NOT NULL, party_id int REFERENCES core.party,
  channel text NOT NULL DEFAULT 'store',                              -- store | web | ...
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  below_cost_acknowledged boolean NOT NULL DEFAULT false,             -- the seller saw the below-cost warning
  below_cost_reason text,                                             -- why the seller sells below cost
  created_by text NOT NULL REFERENCES core.app_user, created_at timestamptz NOT NULL DEFAULT now(),
  finalized_by text REFERENCES core.app_user, finalized_at timestamptz,
  UNIQUE (fiscal_year_id, number));

-- Cost snapshots are captured on the line at sale time (as Holoo does: FACTART.Buy_Price / EndBuy_PriceK), so later
-- purchases never rewrite the evidence behind an authorization. NULL = basis unknown for this item at that time.
CREATE TABLE core.sales_invoice_line (
  invoice_id bigint NOT NULL REFERENCES core.sales_invoice ON DELETE CASCADE, line_no int NOT NULL,
  item_id int NOT NULL REFERENCES core.item, quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(20,0) NOT NULL CHECK (unit_price >= 0), discount numeric(20,0) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  vat_amount numeric(20,0) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),     -- D-01: stored as given, never computed
  levy_amount numeric(20,0) NOT NULL DEFAULT 0 CHECK (levy_amount >= 0),   -- D-01
  unit_cost_moving_average numeric(20,2),                                  -- D-11 basis 1 (Holoo FACTART.Buy_Price)
  unit_cost_last_purchase numeric(20,2),                                   -- D-11 basis 2 (Holoo FACTART.EndBuy_PriceK)
  PRIMARY KEY (invoice_id, line_no), CHECK (discount <= quantity * unit_price));

-- Below-cost evaluation of one line, honouring core.setting('below_cost_basis').
-- net unit price = (quantity * unit_price - discount) / quantity, excluding VAT/levy.
CREATE VIEW core.sales_line_cost_check AS
SELECT l.invoice_id, l.line_no, l.item_id, l.quantity,
       round((l.quantity * l.unit_price - l.discount) / l.quantity, 2) AS net_unit_price,
       l.unit_cost_moving_average, l.unit_cost_last_purchase,
       s.value AS basis,
       (l.unit_cost_moving_average IS NOT NULL AND (l.quantity * l.unit_price - l.discount) / l.quantity < l.unit_cost_moving_average) AS below_moving_average,
       (l.unit_cost_last_purchase  IS NOT NULL AND (l.quantity * l.unit_price - l.discount) / l.quantity < l.unit_cost_last_purchase) AS below_last_purchase,
       CASE s.value WHEN 'moving_average' THEN l.unit_cost_moving_average
                    WHEN 'last_purchase'  THEN l.unit_cost_last_purchase
                    ELSE greatest(l.unit_cost_moving_average, l.unit_cost_last_purchase) END AS reference_cost
FROM core.sales_invoice_line l CROSS JOIN (SELECT value FROM core.setting WHERE key = 'below_cost_basis') s;

CREATE VIEW core.sales_line_below_cost AS
SELECT c.*, round((c.reference_cost - c.net_unit_price) * c.quantity, 0) AS shortfall_amount,
       (c.reference_cost IS NULL) AS cost_unknown
FROM core.sales_line_cost_check c
WHERE CASE c.basis WHEN 'moving_average' THEN c.below_moving_average
                   WHEN 'last_purchase'  THEN c.below_last_purchase
                   ELSE c.below_moving_average OR c.below_last_purchase END;   -- undecided | max

-- D-06 control 1: warnings shown while the invoice is still a draft (the UI reads this view)
CREATE VIEW core.sales_invoice_warnings AS
SELECT i.id AS invoice_id, b.line_no, 'below_cost'::text AS warning, b.basis, b.net_unit_price,
       b.unit_cost_moving_average, b.unit_cost_last_purchase, b.reference_cost, b.shortfall_amount,
       core.has_permission(i.created_by, 'sales.below_cost') AS creator_may_finalize
FROM core.sales_invoice i JOIN core.sales_line_below_cost b ON b.invoice_id = i.id
WHERE i.status = 'draft'
UNION ALL
SELECT i.id, c.line_no, 'cost_basis_missing', c.basis, c.net_unit_price, c.unit_cost_moving_average,
       c.unit_cost_last_purchase, NULL, NULL, NULL
FROM core.sales_invoice i JOIN core.sales_line_cost_check c ON c.invoice_id = i.id
WHERE i.status = 'draft' AND (c.unit_cost_moving_average IS NULL OR c.unit_cost_last_purchase IS NULL);

-- D-06 control 2: permanent, immutable history of every authorized below-cost sale (management reports + audit)
CREATE TABLE core.below_cost_event (
  id bigserial PRIMARY KEY, invoice_id bigint NOT NULL REFERENCES core.sales_invoice, line_no int NOT NULL,
  item_id int NOT NULL REFERENCES core.item, authorized_by text NOT NULL REFERENCES core.app_user,
  at timestamptz NOT NULL DEFAULT now(), basis text NOT NULL, quantity numeric(18,3) NOT NULL,
  net_unit_price numeric(20,2) NOT NULL, unit_cost_moving_average numeric(20,2), unit_cost_last_purchase numeric(20,2),
  reference_cost numeric(20,2), shortfall_amount numeric(20,0), below_moving_average boolean NOT NULL,
  below_last_purchase boolean NOT NULL, reason text);
CREATE FUNCTION core.trg_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is immutable', TG_TABLE_NAME; END $$;
CREATE TRIGGER below_cost_event_immutable BEFORE UPDATE OR DELETE ON core.below_cost_event FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

-- D-06 control 3: finalization gate. Without 'sales.below_cost' a below-cost invoice cannot be finalized;
-- with it, the warning must have been acknowledged and every line is recorded in below_cost_event + audit.
CREATE FUNCTION core.trg_sales_invoice_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y core.fiscal_year; p core.period; n int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'final invoice % cannot be deleted', OLD.id; END IF;
    RETURN OLD; END IF;
  SELECT * INTO y FROM core.fiscal_year WHERE id = NEW.fiscal_year_id;
  IF NEW.invoice_date NOT BETWEEN y.starts_on AND y.ends_on THEN
    RAISE EXCEPTION 'invoice date % is outside fiscal year %', NEW.invoice_date, y.code; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'final' THEN
    RAISE EXCEPTION 'final invoice % is immutable; issue a return/credit note', OLD.id; END IF;
  IF NEW.status = 'final' THEN
    IF NEW.finalized_by IS NULL THEN RAISE EXCEPTION 'finalized_by is required'; END IF;
    SELECT * INTO p FROM core.period WHERE fiscal_year_id = y.id AND NEW.invoice_date BETWEEN starts_on AND ends_on;
    IF y.status <> 'open' OR p.status IS DISTINCT FROM 'open' THEN
      RAISE EXCEPTION 'period of invoice date % is not open', NEW.invoice_date; END IF;
    IF NOT EXISTS (SELECT 1 FROM core.sales_invoice_line WHERE invoice_id = NEW.id) THEN
      RAISE EXCEPTION 'invoice % has no lines', NEW.id; END IF;
    SELECT count(*) INTO n FROM core.sales_line_below_cost WHERE invoice_id = NEW.id;
    IF n > 0 THEN
      IF NOT core.has_permission(NEW.finalized_by, 'sales.below_cost') THEN
        RAISE EXCEPTION 'below-cost sale not permitted: user % lacks sales.below_cost (% line(s))', NEW.finalized_by, n
          USING ERRCODE = 'insufficient_privilege'; END IF;
      IF NOT NEW.below_cost_acknowledged THEN
        RAISE EXCEPTION 'below-cost warning on % line(s) must be acknowledged before finalizing', n; END IF;
      INSERT INTO core.below_cost_event (invoice_id, line_no, item_id, authorized_by, basis, quantity, net_unit_price,
             unit_cost_moving_average, unit_cost_last_purchase, reference_cost, shortfall_amount,
             below_moving_average, below_last_purchase, reason)
      SELECT invoice_id, line_no, item_id, NEW.finalized_by, basis, quantity, net_unit_price, unit_cost_moving_average,
             unit_cost_last_purchase, reference_cost, shortfall_amount, below_moving_average, below_last_purchase,
             NEW.below_cost_reason
      FROM core.sales_line_below_cost WHERE invoice_id = NEW.id;
      INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason)
      SELECT NEW.finalized_by, 'below_cost_sale', 'sales_invoice', NEW.id::text,
             jsonb_agg(to_jsonb(b) ORDER BY b.line_no), NEW.below_cost_reason
      FROM core.sales_line_below_cost b WHERE b.invoice_id = NEW.id;
    END IF;
    NEW.finalized_at := now();
  END IF;
  RETURN NEW;
END $$;
-- The history rows are written inside the finalizing statement: if finalization fails, they roll back with it.
CREATE TRIGGER sales_invoice_rules BEFORE INSERT OR UPDATE OR DELETE ON core.sales_invoice
  FOR EACH ROW EXECUTE FUNCTION core.trg_sales_invoice_rules();

CREATE FUNCTION core.trg_sales_line_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM core.sales_invoice WHERE id = coalesce(NEW.invoice_id, OLD.invoice_id)) = 'final' THEN
    RAISE EXCEPTION 'lines of final invoice % are immutable', coalesce(NEW.invoice_id, OLD.invoice_id); END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER sales_line_rules BEFORE INSERT OR UPDATE OR DELETE ON core.sales_invoice_line
  FOR EACH ROW EXECUTE FUNCTION core.trg_sales_line_rules();

-- Management report: every below-cost sale with who authorized it (D-06 control 2)
CREATE VIEW core.below_cost_report AS
SELECT e.at::date AS day, y.code AS fiscal_year, i.number AS invoice_number, i.channel, e.line_no, it.code AS item_code,
       it.name AS item_name, e.quantity, e.net_unit_price, e.unit_cost_moving_average, e.unit_cost_last_purchase,
       e.basis, e.shortfall_amount, e.authorized_by, e.reason
FROM core.below_cost_event e JOIN core.sales_invoice i ON i.id = e.invoice_id
JOIN core.fiscal_year y ON y.id = i.fiscal_year_id JOIN core.item it ON it.id = e.item_id;
