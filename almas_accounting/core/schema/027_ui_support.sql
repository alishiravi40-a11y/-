-- Almas Shahr accounting — core v0.27: read operations that make every number traceable from the UI (drill-down),
-- and a single search box. No rules: windows on the existing core.

CREATE FUNCTION core.fiscal_years_list() RETURNS TABLE (fiscal_year_id int, code text, starts_on date, ends_on date, status text) LANGUAGE sql STABLE AS $$
  SELECT id, code, starts_on, ends_on, status FROM core.fiscal_year ORDER BY starts_on DESC $$;

-- the ledger of an account (any level: its descendants are included) and optionally one party, by account CODE
CREATE FUNCTION core.account_ledger_code(p_year text, p_code text, p_party int, p_from date, p_to date)
RETURNS TABLE (seq bigint, effective_date date, entry_id bigint, number bigint, line_no int, debit numeric, credit numeric, running_balance numeric,
               description text, account_code text, party_name text) LANGUAGE sql STABLE AS $$
  SELECT l.seq, l.effective_date, l.entry_id, l.number, l.line_no, l.debit, l.credit, l.running_balance, l.description, a.code, p.name
  FROM core.account_ledger(p_year, (SELECT id FROM core.account WHERE code = p_code), p_party, p_from, p_to, false) l
  JOIN core.journal_line jl ON jl.entry_id = l.entry_id AND jl.line_no = l.line_no JOIN core.account a ON a.id = jl.account_id
  LEFT JOIN core.party p ON p.id = jl.party_id ORDER BY l.seq $$;

-- bank reconciliation workspace: what is not yet matched on each side
CREATE FUNCTION core.bank_open_lines(p_bank_account int, p_from date, p_to date)
RETURNS TABLE (side text, ref text, value_date date, amount numeric, description text) LANGUAGE sql STABLE AS $$
  SELECT 'bank', statement_line_id::text, value_date, net, description FROM core.bank_statement_recon
  WHERE company_bank_account_id = p_bank_account AND group_id IS NULL AND value_date BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'book', entry_id || ':' || line_no, effective_date, net, description FROM core.bank_book_line
  WHERE company_bank_account_id = p_bank_account AND group_id IS NULL AND effective_date BETWEEN p_from AND p_to
  ORDER BY 3, 1 $$;

-- one item: stock, average cost and value per warehouse (from its kardex — derived, never stored), and its last movements
CREATE FUNCTION core.item_detail(p_item int) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH k AS (SELECT * FROM core.item_kardex(p_item, NULL)),
  last AS (SELECT DISTINCT ON (warehouse_id) warehouse_id, qty_after, avg_cost_after FROM k ORDER BY warehouse_id, effective_date DESC, effective_time DESC, movement_id DESC)
  SELECT jsonb_build_object(
    'item', (SELECT to_jsonb(i) FROM core.item i WHERE id = p_item),
    'stock', (SELECT coalesce(jsonb_agg(jsonb_build_object('warehouse', w.name, 'qty', l.qty_after, 'avg_cost', round(l.avg_cost_after), 'value', round(l.qty_after * l.avg_cost_after))), '[]')
              FROM last l JOIN core.warehouse w ON w.id = l.warehouse_id WHERE l.qty_after <> 0),
    'movements', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', effective_date, 'kind', kind, 'warehouse', (SELECT name FROM core.warehouse WHERE id = k.warehouse_id),
                                                               'qty', qty, 'unit_cost', round(unit_cost), 'qty_after', qty_after) ORDER BY effective_date DESC, movement_id DESC), '[]')
                  FROM (SELECT * FROM k ORDER BY effective_date DESC, movement_id DESC LIMIT 50) k)) $$;

-- one search box for everything: people, goods, vouchers, invoices, cheques
CREATE FUNCTION core.global_search(p_query text, p_limit int DEFAULT 8)
RETURNS TABLE (kind text, id text, title text, detail text) LANGUAGE sql STABLE AS $$
  (SELECT 'party', id::text, name, coalesce(national_id, mobile, '') FROM core.party
   WHERE merged_into_id IS NULL AND length(btrim(p_query)) >= 2 AND (name ILIKE '%' || p_query || '%' OR national_id = btrim(p_query) OR mobile = btrim(p_query))
   ORDER BY name LIMIT p_limit)
  UNION ALL
  (SELECT 'item', id::text, name, code FROM core.item WHERE length(btrim(p_query)) >= 2 AND (name ILIKE '%' || p_query || '%' OR code = btrim(p_query)) ORDER BY name LIMIT p_limit)
  UNION ALL
  (SELECT 'entry', id::text, 'سند ' || number, coalesce(description, '') || ' — ' || effective_date FROM core.journal_entry
   WHERE status <> 'draft' AND btrim(p_query) ~ '^[0-9]{1,12}$' AND number = btrim(p_query)::bigint ORDER BY effective_date DESC LIMIT p_limit)
  UNION ALL
  (SELECT 'sales_invoice', id::text, 'فاکتور فروش ' || number, invoice_date::text FROM core.sales_invoice
   WHERE btrim(p_query) ~ '^[0-9]{1,12}$' AND number = btrim(p_query)::bigint LIMIT p_limit)
  UNION ALL
  (SELECT 'cheque', id::text, 'چک ' || number, amount::text FROM core.cheque WHERE length(btrim(p_query)) >= 3 AND number = btrim(p_query) LIMIT p_limit) $$;

INSERT INTO core.operation_catalog (operation, kind, function_signature, purpose, permission, effect, undo, basis, ai_allowed, agent_allowed) VALUES
  ('years.list', 'read', 'core.fiscal_years_list()', 'fiscal years', NULL, 'none', '—', 'D-05', true, false),
  ('ledger.by_code', 'read', 'core.account_ledger_code(text,text,integer,date,date)', 'ledger of an account (any level) or of one party, by account code',
   NULL, 'none', '—', 'E20', true, false),
  ('bank.open_lines', 'read', 'core.bank_open_lines(integer,date,date)', 'bank statement and book lines not yet reconciled', NULL, 'none', '—', 'W-36', true, false),
  ('items.detail', 'read', 'core.item_detail(integer)', 'one item: stock, average cost, value per warehouse and last movements', NULL, 'none', '—', 'E23', true, false),
  ('search', 'read', 'core.global_search(text,integer)', 'find people, goods, vouchers, invoices and cheques from one box', NULL, 'none', '—', 'UX', true, false);
