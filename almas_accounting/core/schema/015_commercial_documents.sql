-- Almas Shahr accounting — core v0.15: purchase invoices, and sales / purchase invoices connected to inventory.
--
-- Posting a final invoice is ONE transaction that writes everything the invoice means, from one source of truth:
--   * the voucher (006 posting rule — proven identical to Holoo on 20,828 documents);
--   * the stock movements (012) — a sale that would make stock negative is refused (W-11), so the invoice is not posted;
--   * for purchases, the purchase price history used by the below-cost control (003, D-11/D-13).
-- A final invoice is immutable; a mistake is corrected by a return document (not by editing — W-03, W-05).
-- Posting is idempotent (document_posting) and records who posted it. Services carry no stock (W-38).
-- A purchase line's unit cost = (quantity × price − line discount) / quantity + the invoice's extra costs spread per
-- unit (Holoo: HazFactK / Sum_Few, E23). Extra costs are part of the purchase cost and are posted to purchases.

INSERT INTO core.permission (code, description) VALUES ('purchase.finalize', 'finalize purchase invoices'),
                                                       ('document.post', 'post final invoices to the ledger and stock');
INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('account_suppliers', '', NULL, '^$|^[0-9A-Z]{3,12}$', 'D-03');     -- default payable control; empty = each supplier must have its own

ALTER TABLE core.sales_invoice_line ADD COLUMN warehouse_id int REFERENCES core.warehouse;

CREATE TABLE core.purchase_invoice (
  id bigserial PRIMARY KEY, fiscal_year_id int NOT NULL REFERENCES core.fiscal_year,
  number bigint, invoice_date date NOT NULL, party_id int NOT NULL REFERENCES core.party,
  supplier_invoice_no text, extra_cost numeric(20,0) NOT NULL DEFAULT 0 CHECK (extra_cost >= 0),    -- freight etc. on the invoice
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  created_by text NOT NULL REFERENCES core.app_user, created_at timestamptz NOT NULL DEFAULT now(),
  finalized_by text REFERENCES core.app_user, finalized_at timestamptz, UNIQUE (fiscal_year_id, number));
CREATE TABLE core.purchase_invoice_line (
  invoice_id bigint NOT NULL REFERENCES core.purchase_invoice ON DELETE CASCADE, line_no int NOT NULL,
  item_id int NOT NULL REFERENCES core.item, warehouse_id int REFERENCES core.warehouse,
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0), unit_price numeric(20,0) NOT NULL CHECK (unit_price >= 0),
  discount numeric(20,0) NOT NULL DEFAULT 0 CHECK (discount >= 0), PRIMARY KEY (invoice_id, line_no),
  CHECK (discount <= quantity * unit_price));
CREATE TABLE core.purchase_invoice_payment (
  invoice_id bigint NOT NULL REFERENCES core.purchase_invoice, seq int NOT NULL, method text NOT NULL CHECK (method IN ('cash', 'bank', 'cheque')),
  account_id int NOT NULL REFERENCES core.account, amount numeric(20,0) NOT NULL CHECK (amount > 0), reference text, PRIMARY KEY (invoice_id, seq));

CREATE FUNCTION core.trg_purchase_invoice_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE y core.fiscal_year; p core.period;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'final purchase invoice % cannot be deleted', OLD.id; END IF;
    RETURN OLD; END IF;
  SELECT * INTO y FROM core.fiscal_year WHERE id = NEW.fiscal_year_id;
  IF NEW.invoice_date NOT BETWEEN y.starts_on AND y.ends_on THEN
    RAISE EXCEPTION 'invoice date % is outside fiscal year %', NEW.invoice_date, y.code; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'final' THEN
    RAISE EXCEPTION 'final purchase invoice % is immutable; issue a purchase return', OLD.id; END IF;
  IF NEW.status = 'final' THEN
    IF NEW.finalized_by IS NULL THEN RAISE EXCEPTION 'finalized_by is required'; END IF;
    PERFORM core.require_permission(NEW.finalized_by, 'purchase.finalize');
    SELECT * INTO p FROM core.period WHERE fiscal_year_id = y.id AND NEW.invoice_date BETWEEN starts_on AND ends_on;
    IF y.status <> 'open' OR p.status IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'period of invoice date % is not open', NEW.invoice_date; END IF;
    IF NOT EXISTS (SELECT 1 FROM core.purchase_invoice_line WHERE invoice_id = NEW.id) THEN RAISE EXCEPTION 'invoice % has no lines', NEW.id; END IF;
    NEW.finalized_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_invoice_rules BEFORE INSERT OR UPDATE OR DELETE ON core.purchase_invoice FOR EACH ROW EXECUTE FUNCTION core.trg_purchase_invoice_rules();
CREATE FUNCTION core.trg_purchase_line_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM core.purchase_invoice WHERE id = coalesce(NEW.invoice_id, OLD.invoice_id)) = 'final' THEN
    RAISE EXCEPTION 'lines of final purchase invoice % are immutable', coalesce(NEW.invoice_id, OLD.invoice_id); END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER purchase_line_rules BEFORE INSERT OR UPDATE OR DELETE ON core.purchase_invoice_line FOR EACH ROW EXECUTE FUNCTION core.trg_purchase_line_rules();
CREATE TRIGGER purchase_payment_rules BEFORE INSERT OR UPDATE OR DELETE ON core.purchase_invoice_payment FOR EACH ROW EXECUTE FUNCTION core.trg_purchase_line_rules();

-- unit cost of every purchase line: net price + extra costs per unit (the rule of 012 / E23)
CREATE VIEW core.purchase_line_cost AS
SELECT l.invoice_id, l.line_no, l.item_id, l.warehouse_id, l.quantity,
       round((l.quantity * l.unit_price - l.discount) / l.quantity, 4) AS net_unit_price,
       CASE WHEN q.total_qty > 0 THEN round(i.extra_cost / q.total_qty, 4) ELSE 0 END AS extra_cost_per_unit
FROM core.purchase_invoice_line l JOIN core.purchase_invoice i ON i.id = l.invoice_id
JOIN core.item it ON it.id = l.item_id
CROSS JOIN LATERAL (SELECT sum(x.quantity) total_qty FROM core.purchase_invoice_line x JOIN core.item xi ON xi.id = x.item_id
                    WHERE x.invoice_id = l.invoice_id AND NOT xi.is_service) q;

CREATE FUNCTION core.purchase_invoice_document(p_invoice bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'kind', 'purchase', 'party_id', i.party_id,
    'party_account_id', coalesce(pa.default_payable_account_id, core.setting_account('account_suppliers')),
    'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('account_id', core.setting_account('account_purchases'),
                                                          'amount', l.quantity * l.unit_price - l.discount)), '[]')
              FROM core.purchase_invoice_line l WHERE l.invoice_id = i.id)
             || CASE WHEN i.extra_cost > 0 THEN jsonb_build_array(jsonb_build_object('account_id', core.setting_account('account_purchases'),
                                                                                    'amount', i.extra_cost)) ELSE '[]'::jsonb END,
    'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('account_id', p.account_id, 'amount', p.amount)), '[]')
                 FROM core.purchase_invoice_payment p WHERE p.invoice_id = i.id))
  FROM core.purchase_invoice i JOIN core.party pa ON pa.id = i.party_id WHERE i.id = p_invoice $$;

-- post a final purchase invoice: voucher + stock + purchase price, all or nothing
CREATE FUNCTION core.post_purchase_invoice(p_invoice bigint, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE i core.purchase_invoice; eid bigint; doc jsonb;
BEGIN
  PERFORM core.require_permission(p_user, 'document.post');
  SELECT * INTO i FROM core.purchase_invoice WHERE id = p_invoice;
  IF i.status IS DISTINCT FROM 'final' THEN RAISE EXCEPTION 'purchase invoice % is not final', p_invoice; END IF;
  IF EXISTS (SELECT 1 FROM core.document_posting WHERE source = 'purchase_invoice' AND source_ref = p_invoice::text) THEN
    RETURN (SELECT entry_id FROM core.document_posting WHERE source = 'purchase_invoice' AND source_ref = p_invoice::text); END IF;
  doc := core.purchase_invoice_document(p_invoice);
  IF doc->>'party_account_id' IS NULL THEN RAISE EXCEPTION 'supplier % has no payable account and account_suppliers is not set', i.party_id; END IF;
  IF EXISTS (SELECT 1 FROM core.purchase_invoice_line l JOIN core.item it ON it.id = l.item_id
             WHERE l.invoice_id = p_invoice AND NOT it.is_service AND l.warehouse_id IS NULL) THEN
    RAISE EXCEPTION 'every goods line needs a warehouse'; END IF;
  eid := core.post_document(doc, i.invoice_date, 'purchase_invoice', p_invoice::text, p_user, 'Purchase invoice ' || coalesce(i.number::text, i.id::text));
  INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, effective_time, qty, unit_price, extra_cost_per_unit,
                                   source, source_ref, created_by)
  SELECT c.item_id, c.warehouse_id, 'purchase', i.invoice_date, (i.finalized_at AT TIME ZONE 'UTC')::time, c.quantity, c.net_unit_price,
         c.extra_cost_per_unit, 'purchase_invoice', 'purchase_invoice:' || p_invoice || ':' || c.line_no, p_user
  FROM core.purchase_line_cost c JOIN core.item it ON it.id = c.item_id WHERE c.invoice_id = p_invoice AND NOT it.is_service;
  INSERT INTO core.purchase_price (item_id, purchase_date, unit_cost, source)
  SELECT c.item_id, i.invoice_date, c.net_unit_price + c.extra_cost_per_unit, 'purchase_invoice:' || p_invoice || ':' || c.line_no
  FROM core.purchase_line_cost c JOIN core.item it ON it.id = c.item_id WHERE c.invoice_id = p_invoice AND NOT it.is_service;
  RETURN eid;
END $$;

-- sales invoices: the same voucher as before (006), plus the stock leaving the warehouse of each goods line
CREATE OR REPLACE FUNCTION core.post_sales_invoice(p_invoice bigint, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE i core.sales_invoice; eid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'document.post');
  SELECT * INTO i FROM core.sales_invoice WHERE id = p_invoice;
  IF i.status <> 'final' THEN RAISE EXCEPTION 'invoice % is not final', p_invoice; END IF;
  IF EXISTS (SELECT 1 FROM core.document_posting WHERE source = 'sales_invoice' AND source_ref = p_invoice::text) THEN
    RETURN (SELECT entry_id FROM core.document_posting WHERE source = 'sales_invoice' AND source_ref = p_invoice::text); END IF;
  IF EXISTS (SELECT 1 FROM core.sales_invoice_line l JOIN core.item it ON it.id = l.item_id
             WHERE l.invoice_id = p_invoice AND NOT it.is_service AND l.warehouse_id IS NULL) THEN
    RAISE EXCEPTION 'every goods line needs a warehouse'; END IF;
  eid := core.post_document(core.sales_invoice_document(p_invoice), i.invoice_date, 'sales_invoice', p_invoice::text, p_user,
                            'Sales invoice ' || coalesce(i.number::text, i.id::text));
  INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, effective_time, qty, source, source_ref, created_by)
  SELECT l.item_id, l.warehouse_id, 'sale', i.invoice_date, (i.finalized_at AT TIME ZONE 'UTC')::time, l.quantity,
         'sales_invoice', 'sales_invoice:' || p_invoice || ':' || l.line_no, p_user
  FROM core.sales_invoice_line l JOIN core.item it ON it.id = l.item_id WHERE l.invoice_id = p_invoice AND NOT it.is_service;
  RETURN eid;
END $$;

INSERT INTO core.operation_catalog VALUES
  ('purchase.post', 'write', 'core.post_purchase_invoice(bigint,text)', 'post a final purchase invoice: voucher + stock + purchase price', 'document.post',
   'one journal entry, stock movements and purchase prices (all or nothing, idempotent)', 'purchase return document; posted entries are reversed, never edited', 'E17, E23, D-11', true),
  ('sales.post', 'write', 'core.post_sales_invoice(bigint,text)', 'post a final sales invoice: voucher + stock leaving the warehouse', 'document.post',
   'one journal entry and stock movements; refused if stock would go negative (W-11)', 'sales return document', 'E17, W-11', true);
