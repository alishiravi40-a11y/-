-- Almas Shahr accounting — core v0.6: posting rules for commercial documents (sales, sales returns, purchases,
-- purchase returns, waste) — reverse-engineered from Holoo (E17) and proven by migration/posting_parity.py.
--
-- One PURE rule, core.document_posting_lines(doc jsonb), used both by posting and by the Holoo parity test.
-- doc = {kind, party_id, party_account_id, expense_account_id (waste), vat_amount, levy_amount, vat_account_id,
--        lines: [{account_id, amount}]  -- counter account per line (revenue / return / purchase / purchase-return),
--        payments: [{account_id, amount}] -- settlement at the moment of the document (cash box, bank, POS, cheque)}
-- D-01: VAT/levy are posted only when present (Holoo 1404: always zero) and require an explicit account.
-- D-02: periodic inventory — no COGS line on sales; purchases go to the purchases account.

ALTER TABLE core.party ADD COLUMN default_receivable_account_id int REFERENCES core.account,
                       ADD COLUMN default_payable_account_id int REFERENCES core.account;
ALTER TABLE core.item ADD COLUMN revenue_account_id int REFERENCES core.account;       -- e.g. shipping → «درآمد حمل»

INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('account_sales',            '9010001', NULL, '^[0-9A-Z]{3,12}$', 'E17'),
  ('account_sales_return',     '9020001', NULL, '^[0-9A-Z]{3,12}$', 'E17'),
  ('account_purchases',        '8010001', NULL, '^[0-9A-Z]{3,12}$', 'E17'),
  ('account_purchase_return',  '8020001', NULL, '^[0-9A-Z]{3,12}$', 'E17'),
  ('account_waste_expense',    '6010006', NULL, '^[0-9A-Z]{3,12}$', 'E17'),
  ('account_customers',        '1030008', NULL, '^[0-9A-Z]{3,12}$', 'E17'),        -- default receivable control (D-03)
  ('account_vat_payable',      '',        NULL, '^$|^[0-9A-Z]{3,12}$', 'D-01');     -- empty until VAT is actually charged

CREATE FUNCTION core.setting_account(p_key text) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT id FROM core.account WHERE code = core.setting_value(p_key) $$;

CREATE FUNCTION core.document_posting_lines(doc jsonb)
RETURNS TABLE (line_no int, account_id int, party_id int, debit numeric, credit numeric, role text) LANGUAGE plpgsql STABLE AS $$
DECLARE k text := doc->>'kind'; tot numeric; paid numeric; vat numeric := coalesce((doc->>'vat_amount')::numeric, 0);
        levy numeric := coalesce((doc->>'levy_amount')::numeric, 0); dir int; pty int := (doc->>'party_id')::int;
        pacc int := (doc->>'party_account_id')::int;
BEGIN
  IF k NOT IN ('sale', 'sale_return', 'purchase', 'purchase_return', 'waste') THEN RAISE EXCEPTION 'unknown document kind %', k; END IF;
  SELECT coalesce(sum((l->>'amount')::numeric), 0) INTO tot FROM jsonb_array_elements(doc->'lines') l;
  SELECT coalesce(sum((p->>'amount')::numeric), 0) INTO paid FROM jsonb_array_elements(coalesce(doc->'payments', '[]')) p;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(doc->'lines') l WHERE (l->>'amount')::numeric < 0)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(doc->'payments', '[]')) p WHERE (p->>'amount')::numeric <= 0) THEN
    RAISE EXCEPTION 'negative line or non-positive payment'; END IF;
  IF (vat > 0 OR levy > 0) AND doc->>'vat_account_id' IS NULL THEN RAISE EXCEPTION 'VAT/levy present but no VAT account (D-01)'; END IF;
  tot := tot + vat + levy;
  IF paid > tot THEN RAISE EXCEPTION 'payments % exceed document total %', paid, tot; END IF;
  -- dir = +1: the party is debited (sale, purchase return); -1: the party is credited (purchase, sale return)
  dir := CASE WHEN k IN ('sale', 'purchase_return') THEN 1 ELSE -1 END;
  IF k = 'waste' THEN
    RETURN QUERY
      SELECT 1, (doc->>'expense_account_id')::int, NULL::int, tot, 0::numeric, 'counter'::text WHERE tot > 0
      UNION ALL
      SELECT (1 + row_number() OVER (ORDER BY (l->>'account_id')::int))::int, (l->>'account_id')::int, NULL::int, 0::numeric, sum((l->>'amount')::numeric), 'counter'
      FROM jsonb_array_elements(doc->'lines') l GROUP BY (l->>'account_id')::int HAVING sum((l->>'amount')::numeric) > 0;
    RETURN;
  END IF;
  IF pacc IS NULL OR pty IS NULL THEN RAISE EXCEPTION 'party and party account are required for %', k; END IF;
  RETURN QUERY
    WITH x AS (
      SELECT 1 AS ord, pacc AS acc, pty AS par, tot AS amt, dir AS side, 'party_invoice'::text AS r WHERE tot > 0
      UNION ALL
      SELECT 2, (l->>'account_id')::int, NULL::int, sum((l->>'amount')::numeric), -dir, 'counter'
      FROM jsonb_array_elements(doc->'lines') l GROUP BY (l->>'account_id')::int HAVING sum((l->>'amount')::numeric) > 0
      UNION ALL
      SELECT 3, (doc->>'vat_account_id')::int, NULL::int, vat + levy, -dir, 'vat' WHERE vat + levy > 0
      UNION ALL
      SELECT 4, pacc, pty, paid, -dir, 'party_settlement' WHERE paid > 0
      UNION ALL
      SELECT 5, (p->>'account_id')::int, NULL::int, sum((p->>'amount')::numeric), dir, 'settlement_instrument'
      FROM jsonb_array_elements(coalesce(doc->'payments', '[]')) p GROUP BY (p->>'account_id')::int)
    SELECT (row_number() OVER (ORDER BY ord, acc))::int, acc, par,
           CASE WHEN side = 1 THEN amt ELSE 0 END, CASE WHEN side = -1 THEN amt ELSE 0 END, r FROM x;
END $$;

-- Posting: one journal entry per document (idempotent by source/source_ref); the entry passes all core entry rules.
CREATE TABLE core.document_posting (
  source text NOT NULL, source_ref text NOT NULL, entry_id bigint NOT NULL REFERENCES core.journal_entry,
  posted_by text NOT NULL, posted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (source, source_ref));

CREATE FUNCTION core.post_document(doc jsonb, p_date date, p_source text, p_source_ref text, p_user text, p_description text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE eid bigint; per core.period;
BEGIN
  SELECT entry_id INTO eid FROM core.document_posting WHERE source = p_source AND source_ref = p_source_ref;
  IF FOUND THEN RETURN eid; END IF;                                          -- idempotent
  SELECT * INTO per FROM core.period WHERE p_date BETWEEN starts_on AND ends_on;
  IF NOT FOUND THEN RAISE EXCEPTION 'no period for %', p_date; END IF;
  INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, source, source_ref, description, created_by)
  VALUES (per.fiscal_year_id, per.id, p_date, p_source, p_source_ref, p_description, p_user) RETURNING id INTO eid;
  INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, credit, description)
  SELECT eid, l.line_no, l.account_id, l.party_id, l.debit, l.credit, l.role FROM core.document_posting_lines(doc) l;
  UPDATE core.journal_entry SET status = 'posted', posted_by = p_user WHERE id = eid;
  INSERT INTO core.document_posting (source, source_ref, entry_id, posted_by) VALUES (p_source, p_source_ref, eid, p_user);
  RETURN eid;
END $$;

-- Sales invoices of the new system: payments at the moment of sale, then posting from the invoice itself
CREATE TABLE core.sales_invoice_payment (
  invoice_id bigint NOT NULL REFERENCES core.sales_invoice, seq int NOT NULL, method text NOT NULL CHECK (method IN ('cash', 'card', 'bank', 'cheque')),
  account_id int NOT NULL REFERENCES core.account, amount numeric(20,0) NOT NULL CHECK (amount > 0), reference text,
  PRIMARY KEY (invoice_id, seq));
CREATE TRIGGER sales_payment_rules BEFORE INSERT OR UPDATE OR DELETE ON core.sales_invoice_payment
  FOR EACH ROW EXECUTE FUNCTION core.trg_sales_line_rules();                -- same freeze rule as invoice lines

CREATE FUNCTION core.sales_invoice_document(p_invoice bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'kind', 'sale', 'party_id', i.party_id,
    'party_account_id', coalesce(pa.default_receivable_account_id, core.setting_account('account_customers')),
    'vat_amount', (SELECT coalesce(sum(vat_amount), 0) FROM core.sales_invoice_line WHERE invoice_id = i.id),
    'levy_amount', (SELECT coalesce(sum(levy_amount), 0) FROM core.sales_invoice_line WHERE invoice_id = i.id),
    'vat_account_id', core.setting_account('account_vat_payable'),
    'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('account_id', coalesce(it.revenue_account_id, core.setting_account('account_sales')),
                                                          'amount', l.quantity * l.unit_price - l.discount)), '[]')
              FROM core.sales_invoice_line l JOIN core.item it ON it.id = l.item_id WHERE l.invoice_id = i.id),
    'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('account_id', p.account_id, 'amount', p.amount)), '[]')
                 FROM core.sales_invoice_payment p WHERE p.invoice_id = i.id))
  FROM core.sales_invoice i LEFT JOIN core.party pa ON pa.id = i.party_id WHERE i.id = p_invoice $$;

CREATE FUNCTION core.post_sales_invoice(p_invoice bigint, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE i core.sales_invoice;
BEGIN
  SELECT * INTO i FROM core.sales_invoice WHERE id = p_invoice;
  IF i.status <> 'final' THEN RAISE EXCEPTION 'invoice % is not final', p_invoice; END IF;
  RETURN core.post_document(core.sales_invoice_document(p_invoice), i.invoice_date, 'sales_invoice', p_invoice::text, p_user,
                            'Sales invoice ' || coalesce(i.number::text, i.id::text));
END $$;
