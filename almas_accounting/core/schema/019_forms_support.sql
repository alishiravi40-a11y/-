-- Almas Shahr accounting — core v0.19: read operations the forms need (find an invoice, what is returnable, the voucher
-- of a document, a party's sub-ledgers). Read-only and catalogued, so the UI and an AI agent see exactly the same data.

-- find final invoices by number or party name (for returns and for looking up a document)
CREATE FUNCTION core.find_invoices(p_kind text, p_query text, p_limit int DEFAULT 20)
RETURNS TABLE (invoice_id bigint, number bigint, invoice_date date, party_id int, party_name text, total numeric, posted boolean) LANGUAGE sql STABLE AS $$
  SELECT i.id, i.number, i.invoice_date, i.party_id, p.name,
         (SELECT round(sum(l.quantity * l.unit_price - l.discount)) FROM core.sales_invoice_line l WHERE l.invoice_id = i.id),
         EXISTS (SELECT 1 FROM core.document_posting d WHERE d.source = 'sales_invoice' AND d.source_ref = i.id::text)
  FROM core.sales_invoice i LEFT JOIN core.party p ON p.id = i.party_id
  WHERE p_kind = 'sales' AND i.status = 'final' AND (i.number::text = p_query OR p.name ILIKE '%' || p_query || '%')
  UNION ALL
  SELECT i.id, i.number, i.invoice_date, i.party_id, p.name,
         (SELECT round(sum(l.quantity * l.unit_price - l.discount)) FROM core.purchase_invoice_line l WHERE l.invoice_id = i.id),
         EXISTS (SELECT 1 FROM core.document_posting d WHERE d.source = 'purchase_invoice' AND d.source_ref = i.id::text)
  FROM core.purchase_invoice i JOIN core.party p ON p.id = i.party_id
  WHERE p_kind = 'purchase' AND i.status = 'final' AND (i.number::text = p_query OR p.name ILIKE '%' || p_query || '%')
  ORDER BY 3 DESC, 1 DESC LIMIT least(p_limit, 100) $$;

-- the lines of an invoice with what is still returnable
CREATE FUNCTION core.returnable_lines(p_kind text, p_invoice bigint)
RETURNS TABLE (line_no int, item_id int, item_name text, quantity numeric, returnable numeric, net_unit_price numeric) LANGUAGE sql STABLE AS $$
  SELECT a.line_no, a.item_id, i.name, a.quantity, a.returnable, round(a.net_unit_price)
  FROM core.returnable_line a JOIN core.item i ON i.id = a.item_id
  WHERE a.kind = CASE p_kind WHEN 'sales' THEN 'sales_return' ELSE 'purchase_return' END AND a.invoice_id = p_invoice ORDER BY a.line_no $$;

-- the voucher of any posted document (source as in document_posting: sales_invoice, purchase_invoice, return, treasury)
CREATE FUNCTION core.document_voucher(p_source text, p_ref text)
RETURNS TABLE (entry_id bigint, number bigint, effective_date date, line_no int, account_code text, account_name text, party_name text,
               debit numeric, credit numeric, description text) LANGUAGE sql STABLE AS $$
  SELECT e.id, e.number, e.effective_date, l.line_no, a.code, a.name, p.name, l.debit, l.credit, l.description
  FROM core.document_posting d JOIN core.journal_entry e ON e.id = d.entry_id JOIN core.journal_line l ON l.entry_id = e.id
  JOIN core.account a ON a.id = l.account_id LEFT JOIN core.party p ON p.id = l.party_id
  WHERE d.source = p_source AND d.source_ref = p_ref ORDER BY l.line_no $$;

-- a party's sub-ledgers (account × party) with balance and what is open, for settlement
CREATE FUNCTION core.party_subledgers(p_party int)
RETURNS TABLE (account_id int, account_code text, account_name text, balance numeric, open_debit numeric, open_credit numeric) LANGUAGE sql STABLE AS $$
  SELECT o.account_id, a.code, a.name, sum(CASE side WHEN 'debit' THEN amount ELSE -amount END),
         sum(open_amount) FILTER (WHERE side = 'debit'), sum(open_amount) FILTER (WHERE side = 'credit')
  FROM core.open_item o JOIN core.account a ON a.id = o.account_id WHERE o.party_id = p_party GROUP BY 1, 2, 3 ORDER BY 2 $$;

INSERT INTO core.operation_catalog VALUES
  ('invoices.find', 'read', 'core.find_invoices(text,text,integer)', 'find final sales or purchase invoices by number or party', NULL, 'none', '—', 'SAL-01', true),
  ('invoices.returnable', 'read', 'core.returnable_lines(text,bigint)', 'lines of an invoice with the quantity still returnable', NULL, 'none', '—', 'E11, E17', true),
  ('documents.voucher', 'read', 'core.document_voucher(text,text)', 'the journal lines of a posted document, with account and party names', NULL, 'none', '—', 'E17', true),
  ('ar.party_subledgers', 'read', 'core.party_subledgers(integer)', 'a party''s accounts with balance and open items, for settlement', NULL, 'none', '—', 'TRE-07', true);
