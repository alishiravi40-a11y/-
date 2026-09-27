-- Almas Shahr accounting — core v0.16: sales returns and purchase returns (the only way to correct a final invoice).
--
-- Holoo (E11, E17): a sales return (Y) brings stock back at the cost on the return line, a purchase return (X) takes
-- stock out at the moving average, and both are posted with the proven rule of 006 (sale_return / purchase_return).
-- NEW: a return always refers to its original invoice, never returns more than what is left of a line, is final and
-- immutable once finalized, and posting writes voucher + stock in one transaction. A sales return brings the goods
-- back at the cost they LEFT with (derived from the original movement), so the margin of the returned sale is undone
-- exactly. A refund of money is a treasury payment (007), not part of the return.

INSERT INTO core.permission (code, description) VALUES ('return.finalize', 'finalize sales and purchase returns');

CREATE TABLE core.return_document (
  id bigserial PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('sales_return', 'purchase_return')),
  sales_invoice_id bigint REFERENCES core.sales_invoice, purchase_invoice_id bigint REFERENCES core.purchase_invoice,
  fiscal_year_id int NOT NULL REFERENCES core.fiscal_year, return_date date NOT NULL, reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  created_by text NOT NULL REFERENCES core.app_user, created_at timestamptz NOT NULL DEFAULT now(),
  finalized_by text REFERENCES core.app_user, finalized_at timestamptz,
  CHECK ((kind = 'sales_return') = (sales_invoice_id IS NOT NULL) AND (kind = 'purchase_return') = (purchase_invoice_id IS NOT NULL)));
CREATE TABLE core.return_line (
  return_id bigint NOT NULL REFERENCES core.return_document ON DELETE CASCADE, original_line_no int NOT NULL,
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0), PRIMARY KEY (return_id, original_line_no));

-- what is still returnable on every line of every invoice (finalized returns only)
CREATE VIEW core.returnable_line AS
SELECT 'sales_return'::text AS kind, l.invoice_id, l.line_no, l.item_id, l.warehouse_id, l.quantity,
       l.quantity - coalesce((SELECT sum(r.quantity) FROM core.return_line r JOIN core.return_document d ON d.id = r.return_id
                              WHERE d.sales_invoice_id = l.invoice_id AND r.original_line_no = l.line_no AND d.status = 'final'), 0) AS returnable,
       (l.quantity * l.unit_price - l.discount) / l.quantity AS net_unit_price
FROM core.sales_invoice_line l
UNION ALL
SELECT 'purchase_return', l.invoice_id, l.line_no, l.item_id, l.warehouse_id, l.quantity,
       l.quantity - coalesce((SELECT sum(r.quantity) FROM core.return_line r JOIN core.return_document d ON d.id = r.return_id
                              WHERE d.purchase_invoice_id = l.invoice_id AND r.original_line_no = l.line_no AND d.status = 'final'), 0),
       (l.quantity * l.unit_price - l.discount) / l.quantity
FROM core.purchase_invoice_line l;

CREATE FUNCTION core.trg_return_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE orig_status text; posted boolean; bad text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'final return % cannot be deleted', OLD.id; END IF;
    RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'final' THEN RAISE EXCEPTION 'final return % is immutable', OLD.id; END IF;
  IF NEW.status = 'final' THEN
    IF NEW.finalized_by IS NULL THEN RAISE EXCEPTION 'finalized_by is required'; END IF;
    PERFORM core.require_permission(NEW.finalized_by, 'return.finalize');
    posted := EXISTS (SELECT 1 FROM core.document_posting WHERE source = CASE NEW.kind WHEN 'sales_return' THEN 'sales_invoice' ELSE 'purchase_invoice' END
                      AND source_ref = coalesce(NEW.sales_invoice_id, NEW.purchase_invoice_id)::text);
    IF NOT posted THEN RAISE EXCEPTION 'the original invoice must be posted before it can be returned'; END IF;
    IF NOT EXISTS (SELECT 1 FROM core.return_line WHERE return_id = NEW.id) THEN RAISE EXCEPTION 'return % has no lines', NEW.id; END IF;
    SELECT string_agg(r.original_line_no::text, ',') INTO bad FROM core.return_line r
    LEFT JOIN core.returnable_line a ON a.kind = NEW.kind AND a.invoice_id = coalesce(NEW.sales_invoice_id, NEW.purchase_invoice_id)
         AND a.line_no = r.original_line_no
    WHERE r.return_id = NEW.id AND (a.line_no IS NULL OR r.quantity > a.returnable);
    IF bad IS NOT NULL THEN RAISE EXCEPTION 'return exceeds what is left of original line(s) %', bad; END IF;
    NEW.finalized_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER return_rules BEFORE INSERT OR UPDATE OR DELETE ON core.return_document FOR EACH ROW EXECUTE FUNCTION core.trg_return_rules();
CREATE FUNCTION core.trg_return_line_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM core.return_document WHERE id = coalesce(NEW.return_id, OLD.return_id)) = 'final' THEN
    RAISE EXCEPTION 'lines of final return % are immutable', coalesce(NEW.return_id, OLD.return_id); END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER return_line_rules BEFORE INSERT OR UPDATE OR DELETE ON core.return_line FOR EACH ROW EXECUTE FUNCTION core.trg_return_line_rules();

-- post a final return: voucher (006 rule) + stock, all or nothing, idempotent
CREATE FUNCTION core.post_return(p_return bigint, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE r core.return_document; party int; pacc int; doc jsonb; eid bigint; inv bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'document.post');
  SELECT * INTO r FROM core.return_document WHERE id = p_return;
  IF r.status IS DISTINCT FROM 'final' THEN RAISE EXCEPTION 'return % is not final', p_return; END IF;
  IF EXISTS (SELECT 1 FROM core.document_posting WHERE source = 'return' AND source_ref = p_return::text) THEN
    RETURN (SELECT entry_id FROM core.document_posting WHERE source = 'return' AND source_ref = p_return::text); END IF;
  inv := coalesce(r.sales_invoice_id, r.purchase_invoice_id);
  IF r.kind = 'sales_return' THEN
    SELECT i.party_id, coalesce(p.default_receivable_account_id, core.setting_account('account_customers')) INTO party, pacc
    FROM core.sales_invoice i LEFT JOIN core.party p ON p.id = i.party_id WHERE i.id = inv;
  ELSE
    SELECT i.party_id, coalesce(p.default_payable_account_id, core.setting_account('account_suppliers')) INTO party, pacc
    FROM core.purchase_invoice i JOIN core.party p ON p.id = i.party_id WHERE i.id = inv;
  END IF;
  doc := jsonb_build_object('kind', CASE r.kind WHEN 'sales_return' THEN 'sale_return' ELSE 'purchase_return' END,
           'party_id', party, 'party_account_id', pacc,
           'lines', (SELECT jsonb_agg(jsonb_build_object(
                        'account_id', core.setting_account(CASE r.kind WHEN 'sales_return' THEN 'account_sales_return' ELSE 'account_purchase_return' END),
                        'amount', round(l.quantity * a.net_unit_price)))
                     FROM core.return_line l JOIN core.returnable_line a ON a.kind = r.kind AND a.invoice_id = inv AND a.line_no = l.original_line_no
                     WHERE l.return_id = p_return));
  eid := core.post_document(doc, r.return_date, 'return', p_return::text, p_user, r.kind || ' of invoice ' || inv || ': ' || r.reason);
  INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, effective_time, qty, unit_price, source, source_ref, created_by)
  SELECT a.item_id, a.warehouse_id, CASE r.kind WHEN 'sales_return' THEN 'sale_return' ELSE 'purchase_return' END, r.return_date,
         (r.finalized_at AT TIME ZONE 'UTC')::time, l.quantity,
         -- a sales return comes back at the cost the goods left with (the original sale movement's derived cost)
         CASE WHEN r.kind = 'sales_return' THEN (SELECT k.unit_cost FROM core.stock_movement m
                                                 CROSS JOIN LATERAL core.item_kardex(m.item_id) k
                                                 WHERE m.source_ref = 'sales_invoice:' || inv || ':' || l.original_line_no AND k.movement_id = m.id) END,
         'return', 'return:' || p_return || ':' || l.original_line_no, p_user
  FROM core.return_line l JOIN core.returnable_line a ON a.kind = r.kind AND a.invoice_id = inv AND a.line_no = l.original_line_no
  JOIN core.item it ON it.id = a.item_id
  WHERE l.return_id = p_return AND NOT it.is_service;
  RETURN eid;
END $$;

INSERT INTO core.operation_catalog VALUES
  ('return.post', 'write', 'core.post_return(bigint,text)', 'post a final sales or purchase return: voucher + stock', 'document.post',
   'one journal entry and stock movements (all or nothing, idempotent); never more than what is left of the original', 'a new sale / purchase', 'E11, E17', true);
