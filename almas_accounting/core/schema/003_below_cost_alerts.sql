-- Almas Shahr accounting — core data model v0.3: owner decisions D-11 and D-12 (1405/07).
-- Applied after 002_decisions.sql. Proven by core/tests/test_alerts.py; e-mail delivery by almas_accounting/notifier.
--
-- D-11  The below-cost control uses the LAST PURCHASE PRICE of the item. Moving average stays for COGS/profit/reports.
-- D-12  The web shop may sell below last purchase price and is never stopped for that reason. Instead, per invoice with
--       at least one such line: ONE alert (all lines + differences inside), internal record kept with its review state,
--       and one e-mail to recipients configured by a manager (not hard-coded). Review window: ~24 h before shipping.

-- ============ Settings: free-text settings with a validation pattern ============
ALTER TABLE core.setting ALTER COLUMN allowed DROP NOT NULL, ADD COLUMN pattern text;
ALTER TABLE core.setting DROP CONSTRAINT setting_check;
ALTER TABLE core.setting ADD CONSTRAINT setting_value_valid
  CHECK ((allowed IS NULL OR value = ANY (allowed)) AND (pattern IS NULL OR value ~ pattern) AND (allowed IS NOT NULL OR pattern IS NOT NULL));

INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  -- D-12: comma-separated recipients; empty = none configured yet (alerts are still recorded and flagged as undelivered)
  ('below_cost_alert_emails', '', NULL, '^$|^[^@\s,]+@[^@\s,]+\.[^@\s,]+(\s*,\s*[^@\s,]+@[^@\s,]+\.[^@\s,]+)*$', 'D-12'),
  -- D-12: review window before shipping (hours)
  ('below_cost_review_hours', '24', NULL, '^[1-9][0-9]{0,2}$', 'D-12'),
  -- D-12: web-channel policy for below-cost sales
  ('web_below_cost_policy', 'allow_with_alert', '{allow_with_alert}', NULL, 'D-12');

-- D-11: owner decision — last purchase price. Recorded as an audited, controlled change.
SELECT set_config('almas.controlled_change', 'on', true);
UPDATE core.setting SET value = 'last_purchase', updated_by = 'owner-decision-D-11', updated_at = now() WHERE key = 'below_cost_basis';
SELECT set_config('almas.controlled_change', 'off', true);
INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after, reason)
VALUES ('owner-decision-D-11', 'change', 'setting', 'below_cost_basis', '{"value": "undecided"}', '{"value": "last_purchase"}',
        'Owner decision D-11 (1405/07): below-cost control uses the last purchase price of the item');

INSERT INTO core.permission VALUES
  ('sales.below_cost_review', 'review below-cost alerts and record the outcome (D-12)');

-- ============ Service accounts (web shop) ============
ALTER TABLE core.app_user ADD COLUMN is_service boolean NOT NULL DEFAULT false;   -- machine account, e.g. web shop

-- ============ D-11: last purchase price comes from purchase history of the item (all warehouses) ============
-- Holoo keeps EndBuy_PriceK per item code, and item codes are per warehouse: stock received only by transfer
-- had NO last purchase price (4,944 of the 4,947 blank sale lines in 1404). Here the item is the model (D-04),
-- so the last purchase of the model in any warehouse applies (owner decision D-13: the whole company, regardless of
-- the warehouse of purchase or later transfers).
CREATE TABLE core.purchase_price (
  id bigserial PRIMARY KEY, item_id int NOT NULL REFERENCES core.item, purchase_date date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), unit_cost numeric(20,2) NOT NULL CHECK (unit_cost >= 0),
  source text NOT NULL,                                   -- purchase invoice ref / 'holoo:<db>:K:<fac_code>' / opening
  reverses_id bigint REFERENCES core.purchase_price);     -- a voided purchase is reversed, never deleted
CREATE INDEX purchase_price_item_date ON core.purchase_price (item_id, purchase_date DESC, id DESC);
CREATE TRIGGER purchase_price_immutable BEFORE UPDATE OR DELETE ON core.purchase_price FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

CREATE FUNCTION core.last_purchase_price(p_item int, p_date date) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT p.unit_cost FROM core.purchase_price p
  WHERE p.item_id = p_item AND p.purchase_date <= p_date AND p.reverses_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM core.purchase_price r WHERE r.reverses_id = p.id)
  ORDER BY p.purchase_date DESC, p.id DESC LIMIT 1 $$;

-- snapshot on the line at entry time (the evidence behind the alert never changes afterwards)
CREATE FUNCTION core.trg_sales_line_last_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_cost_last_purchase IS NULL THEN
    NEW.unit_cost_last_purchase := core.last_purchase_price(NEW.item_id,
                                     (SELECT invoice_date FROM core.sales_invoice WHERE id = NEW.invoice_id));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sales_line_last_purchase BEFORE INSERT ON core.sales_invoice_line
  FOR EACH ROW EXECUTE FUNCTION core.trg_sales_line_last_purchase();

-- missing-basis warning now concerns only the decisive basis (last purchase)
CREATE OR REPLACE VIEW core.sales_invoice_warnings AS
SELECT i.id AS invoice_id, b.line_no, 'below_cost'::text AS warning, b.basis, b.net_unit_price,
       b.unit_cost_moving_average, b.unit_cost_last_purchase, b.reference_cost, b.shortfall_amount,
       core.has_permission(i.created_by, 'sales.below_cost') AS creator_may_finalize
FROM core.sales_invoice i JOIN core.sales_line_below_cost b ON b.invoice_id = i.id
WHERE i.status = 'draft'
UNION ALL
SELECT i.id, c.line_no, 'cost_basis_missing', c.basis, c.net_unit_price, c.unit_cost_moving_average,
       c.unit_cost_last_purchase, NULL, NULL, NULL
FROM core.sales_invoice i JOIN core.sales_line_cost_check c ON c.invoice_id = i.id
WHERE i.status = 'draft' AND c.reference_cost IS NULL;

-- ============ D-12: one alert per invoice + e-mail outbox ============
CREATE TABLE core.below_cost_alert (
  id bigserial PRIMARY KEY, invoice_id bigint NOT NULL UNIQUE REFERENCES core.sales_invoice,   -- ONE alert per invoice
  created_at timestamptz NOT NULL DEFAULT now(), review_due_at timestamptz NOT NULL,
  channel text NOT NULL, basis text NOT NULL, lines int NOT NULL CHECK (lines > 0), total_shortfall numeric(20,0) NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed_ok', 'reviewed_action')),
  reviewed_by text REFERENCES core.app_user, reviewed_at timestamptz, review_note text);

CREATE FUNCTION core.trg_alert_controlled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'below-cost alerts are never deleted'; END IF;
  IF coalesce(current_setting('almas.controlled_change', true), 'off') <> 'on'
     OR NEW.invoice_id <> OLD.invoice_id OR NEW.lines <> OLD.lines OR NEW.total_shortfall <> OLD.total_shortfall
     OR NEW.created_at <> OLD.created_at OR NEW.basis <> OLD.basis THEN
    RAISE EXCEPTION 'below-cost alert % changes only through core.review_below_cost_alert', OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER below_cost_alert_controlled BEFORE UPDATE OR DELETE ON core.below_cost_alert
  FOR EACH ROW EXECUTE FUNCTION core.trg_alert_controlled();

-- Outbox: exactly one e-mail per alert. Recipients are read from the setting at SEND time, so a manager can set or
-- change them later and undelivered alerts go to the new address. The sent message is stored verbatim for audit.
CREATE TABLE core.notification_outbox (
  id bigserial PRIMARY KEY, kind text NOT NULL, ref_id bigint NOT NULL, channel text NOT NULL DEFAULT 'email',
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text,
  sent_at timestamptz, recipients text[], subject text, body text,
  UNIQUE (kind, ref_id, channel));
CREATE FUNCTION core.trg_outbox_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'notification history is never deleted'; END IF;
  IF NEW.kind <> OLD.kind OR NEW.ref_id <> OLD.ref_id OR NEW.channel <> OLD.channel OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'notification % identity is immutable', OLD.id; END IF;
  IF OLD.status = 'sent' THEN RAISE EXCEPTION 'sent notification % is immutable', OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_rules BEFORE UPDATE OR DELETE ON core.notification_outbox FOR EACH ROW EXECUTE FUNCTION core.trg_outbox_rules();

-- ============ Finalization gate v0.3 (replaces v0.2) ============
-- store/interactive users: D-06 unchanged (permission + acknowledged warning).
-- web channel finalized by a service account: D-12 allow_with_alert (never blocked for being below cost).
-- every finalized below-cost invoice: below_cost_event per line + ONE below_cost_alert + ONE queued e-mail + audit.
CREATE OR REPLACE FUNCTION core.trg_sales_invoice_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y core.fiscal_year; p core.period; n int; svc boolean; web_ok boolean; aid bigint;
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
      SELECT is_service INTO svc FROM core.app_user WHERE username = NEW.finalized_by;
      web_ok := NEW.channel = 'web' AND svc AND core.setting_value('web_below_cost_policy') = 'allow_with_alert';
      IF NOT web_ok THEN
        IF NOT core.has_permission(NEW.finalized_by, 'sales.below_cost') THEN
          RAISE EXCEPTION 'below-cost sale not permitted: user % lacks sales.below_cost (% line(s))', NEW.finalized_by, n
            USING ERRCODE = 'insufficient_privilege'; END IF;
        IF NOT NEW.below_cost_acknowledged THEN
          RAISE EXCEPTION 'below-cost warning on % line(s) must be acknowledged before finalizing', n; END IF;
      END IF;
      INSERT INTO core.below_cost_event (invoice_id, line_no, item_id, authorized_by, basis, quantity, net_unit_price,
             unit_cost_moving_average, unit_cost_last_purchase, reference_cost, shortfall_amount,
             below_moving_average, below_last_purchase, reason)
      SELECT invoice_id, line_no, item_id, NEW.finalized_by, basis, quantity, net_unit_price, unit_cost_moving_average,
             unit_cost_last_purchase, reference_cost, shortfall_amount, below_moving_average, below_last_purchase,
             coalesce(NEW.below_cost_reason, CASE WHEN web_ok THEN 'web channel (D-12 allow_with_alert)' END)
      FROM core.sales_line_below_cost WHERE invoice_id = NEW.id;
      INSERT INTO core.below_cost_alert (invoice_id, review_due_at, channel, basis, lines, total_shortfall)
      SELECT NEW.id, now() + make_interval(hours => core.setting_value('below_cost_review_hours')::int), NEW.channel,
             min(basis), count(*), sum(shortfall_amount)
      FROM core.sales_line_below_cost WHERE invoice_id = NEW.id
      RETURNING id INTO aid;
      INSERT INTO core.notification_outbox (kind, ref_id) VALUES ('below_cost_alert', aid);
      INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason)
      SELECT NEW.finalized_by, 'below_cost_sale', 'sales_invoice', NEW.id::text,
             jsonb_build_object('alert_id', aid, 'web_policy', web_ok, 'lines', jsonb_agg(to_jsonb(b) ORDER BY b.line_no)),
             NEW.below_cost_reason
      FROM core.sales_line_below_cost b WHERE b.invoice_id = NEW.id;
    END IF;
    NEW.finalized_at := now();
  END IF;
  RETURN NEW;
END $$;

-- ============ Review of an alert (permission + audit) ============
CREATE FUNCTION core.review_below_cost_alert(p_alert bigint, p_outcome text, p_user text, p_note text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE a core.below_cost_alert;
BEGIN
  PERFORM core.require_permission(p_user, 'sales.below_cost_review'); PERFORM core.require_reason(p_note);
  IF p_outcome NOT IN ('reviewed_ok', 'reviewed_action') THEN RAISE EXCEPTION 'invalid outcome %', p_outcome; END IF;
  SELECT * INTO a FROM core.below_cost_alert WHERE id = p_alert FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown alert %', p_alert; END IF;
  IF a.status <> 'open' THEN RAISE EXCEPTION 'alert % is already %', p_alert, a.status; END IF;
  PERFORM set_config('almas.controlled_change', 'on', true);
  UPDATE core.below_cost_alert SET status = p_outcome, reviewed_by = p_user, reviewed_at = now(), review_note = p_note WHERE id = p_alert;
  PERFORM set_config('almas.controlled_change', 'off', true);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after, reason)
  VALUES (p_user, 'review', 'below_cost_alert', p_alert::text, jsonb_build_object('status', a.status),
          jsonb_build_object('status', p_outcome), p_note);
END $$;

-- ============ Views for the e-mail, the UI and management reports ============
CREATE VIEW core.below_cost_alert_line AS
SELECT a.id AS alert_id, e.line_no, it.code AS item_code, it.name AS item_name, e.quantity, e.net_unit_price,
       e.unit_cost_last_purchase, e.unit_cost_last_purchase - e.net_unit_price AS unit_difference, e.shortfall_amount,
       e.unit_cost_moving_average
FROM core.below_cost_alert a JOIN core.below_cost_event e ON e.invoice_id = a.invoice_id JOIN core.item it ON it.id = e.item_id;

CREATE VIEW core.below_cost_alert_status AS
SELECT a.*, i.number AS invoice_number, i.invoice_date, i.party_id, pa.name AS party_name, i.finalized_by,
       o.status AS email_status, o.sent_at AS email_sent_at, o.attempts AS email_attempts, o.last_error AS email_last_error,
       (a.status = 'open' AND now() > a.review_due_at) AS review_overdue,
       (o.status IS DISTINCT FROM 'sent') AS email_undelivered
FROM core.below_cost_alert a JOIN core.sales_invoice i ON i.id = a.invoice_id
LEFT JOIN core.party pa ON pa.id = i.party_id
LEFT JOIN core.notification_outbox o ON o.kind = 'below_cost_alert' AND o.ref_id = a.id AND o.channel = 'email';
