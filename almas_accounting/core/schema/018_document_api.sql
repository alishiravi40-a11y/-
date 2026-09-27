-- Almas Shahr accounting — core v0.18: the life cycle of every document as catalogued operations.
--
-- A person (through the UI) and an AI agent create, finalize and post documents ONLY through these functions — never by
-- writing tables — so every step passes the same rules, permissions and audit. Each function does one step, returns the
-- document id, and is safe to repeat where repeating makes sense (posting). Lines and payments come as JSON arrays so a
-- whole draft is created in one call. Numbers are assigned at finalization, gapless per fiscal year (W-05).

INSERT INTO core.permission (code, description) VALUES
  ('sales.create', 'create sales invoice drafts'), ('sales.finalize', 'finalize sales invoices'),
  ('purchase.create', 'create purchase invoice drafts'), ('return.create', 'create return drafts'),
  ('treasury.post', 'post receipts, payments, transfers and bank fees');

CREATE FUNCTION core.fiscal_year_of(p_date date) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT id FROM core.fiscal_year WHERE p_date BETWEEN starts_on AND ends_on $$;

-- gapless number per fiscal year and document kind, taken under a lock at finalization
CREATE FUNCTION core.next_number(p_kind text, p_year int) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('number:' || p_kind), p_year);
  EXECUTE format('SELECT coalesce(max(number), 0) + 1 FROM core.%I WHERE fiscal_year_id = $1', p_kind) INTO n USING p_year;
  RETURN n;
END $$;

-- ---------- sales invoices ----------
-- p_lines: [{item_id, quantity, unit_price, discount?, warehouse_id?, vat_amount?}]  p_payments: [{method, account_id, amount, reference?}]
CREATE FUNCTION core.create_sales_invoice(p_date date, p_party int, p_lines jsonb, p_payments jsonb, p_user text, p_channel text DEFAULT 'store')
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; y int := core.fiscal_year_of(p_date);
BEGIN
  PERFORM core.require_permission(p_user, 'sales.create');
  IF y IS NULL THEN RAISE EXCEPTION 'no fiscal year for %', p_date; END IF;
  IF jsonb_array_length(coalesce(p_lines, '[]')) = 0 THEN RAISE EXCEPTION 'an invoice needs at least one line'; END IF;
  INSERT INTO core.sales_invoice (fiscal_year_id, invoice_date, party_id, channel, created_by) VALUES (y, p_date, p_party, p_channel, p_user) RETURNING sales_invoice.id INTO v_id;
  INSERT INTO core.sales_invoice_line (invoice_id, line_no, item_id, quantity, unit_price, discount, warehouse_id, vat_amount)
  SELECT v_id, n, (l->>'item_id')::int, (l->>'quantity')::numeric, (l->>'unit_price')::numeric, coalesce((l->>'discount')::numeric, 0),
         (l->>'warehouse_id')::int, coalesce((l->>'vat_amount')::numeric, 0)
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY x(l, n);
  INSERT INTO core.sales_invoice_payment (invoice_id, seq, method, account_id, amount, reference)
  SELECT v_id, n, p->>'method', (p->>'account_id')::int, (p->>'amount')::numeric, p->>'reference'
  FROM jsonb_array_elements(coalesce(p_payments, '[]')) WITH ORDINALITY x(p, n);
  RETURN v_id;
END $$;

-- finalize (below-cost rules of 002/003 apply) and post (voucher + stock, 015) in one call
CREATE FUNCTION core.finalize_sales_invoice(p_invoice bigint, p_user text, p_acknowledge_below_cost boolean DEFAULT false,
                                            p_below_cost_reason text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE y int;
BEGIN
  PERFORM core.require_permission(p_user, 'sales.finalize');
  SELECT fiscal_year_id INTO y FROM core.sales_invoice WHERE id = p_invoice;
  UPDATE core.sales_invoice SET status = 'final', finalized_by = p_user, number = coalesce(number, core.next_number('sales_invoice', y)),
         below_cost_acknowledged = p_acknowledge_below_cost, below_cost_reason = p_below_cost_reason
  WHERE id = p_invoice AND status = 'draft';
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM core.sales_invoice WHERE id = p_invoice AND status = 'final') THEN
    RAISE EXCEPTION 'sales invoice % not found', p_invoice; END IF;
  PERFORM core.post_sales_invoice(p_invoice, p_user);
  RETURN p_invoice;
END $$;

-- ---------- purchase invoices ----------
CREATE FUNCTION core.create_purchase_invoice(p_date date, p_party int, p_lines jsonb, p_payments jsonb, p_user text,
                                             p_supplier_invoice_no text DEFAULT NULL, p_extra_cost numeric DEFAULT 0) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; y int := core.fiscal_year_of(p_date);
BEGIN
  PERFORM core.require_permission(p_user, 'purchase.create');
  IF y IS NULL THEN RAISE EXCEPTION 'no fiscal year for %', p_date; END IF;
  IF jsonb_array_length(coalesce(p_lines, '[]')) = 0 THEN RAISE EXCEPTION 'an invoice needs at least one line'; END IF;
  INSERT INTO core.purchase_invoice (fiscal_year_id, invoice_date, party_id, supplier_invoice_no, extra_cost, created_by)
  VALUES (y, p_date, p_party, p_supplier_invoice_no, coalesce(p_extra_cost, 0), p_user) RETURNING purchase_invoice.id INTO v_id;
  INSERT INTO core.purchase_invoice_line (invoice_id, line_no, item_id, warehouse_id, quantity, unit_price, discount)
  SELECT v_id, n, (l->>'item_id')::int, (l->>'warehouse_id')::int, (l->>'quantity')::numeric, (l->>'unit_price')::numeric, coalesce((l->>'discount')::numeric, 0)
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY x(l, n);
  INSERT INTO core.purchase_invoice_payment (invoice_id, seq, method, account_id, amount, reference)
  SELECT v_id, n, p->>'method', (p->>'account_id')::int, (p->>'amount')::numeric, p->>'reference'
  FROM jsonb_array_elements(coalesce(p_payments, '[]')) WITH ORDINALITY x(p, n);
  RETURN v_id;
END $$;

CREATE FUNCTION core.finalize_purchase_invoice(p_invoice bigint, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE y int;
BEGIN
  SELECT fiscal_year_id INTO y FROM core.purchase_invoice WHERE id = p_invoice;
  UPDATE core.purchase_invoice SET status = 'final', finalized_by = p_user, number = coalesce(number, core.next_number('purchase_invoice', y))
  WHERE id = p_invoice AND status = 'draft';
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM core.purchase_invoice WHERE id = p_invoice AND status = 'final') THEN
    RAISE EXCEPTION 'purchase invoice % not found', p_invoice; END IF;
  PERFORM core.post_purchase_invoice(p_invoice, p_user);
  RETURN p_invoice;
END $$;

-- ---------- returns ----------
-- p_lines: [{original_line_no, quantity}]
CREATE FUNCTION core.create_return(p_kind text, p_invoice bigint, p_date date, p_reason text, p_lines jsonb, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; y int := core.fiscal_year_of(p_date);
BEGIN
  PERFORM core.require_permission(p_user, 'return.create');
  INSERT INTO core.return_document (kind, sales_invoice_id, purchase_invoice_id, fiscal_year_id, return_date, reason, created_by)
  VALUES (p_kind, CASE WHEN p_kind = 'sales_return' THEN p_invoice END, CASE WHEN p_kind = 'purchase_return' THEN p_invoice END, y, p_date, p_reason, p_user)
  RETURNING return_document.id INTO v_id;
  INSERT INTO core.return_line (return_id, original_line_no, quantity)
  SELECT v_id, (l->>'original_line_no')::int, (l->>'quantity')::numeric FROM jsonb_array_elements(p_lines) l;
  RETURN v_id;
END $$;

CREATE FUNCTION core.finalize_return(p_return bigint, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  UPDATE core.return_document SET status = 'final', finalized_by = p_user WHERE id = p_return AND status = 'draft';
  PERFORM core.post_return(p_return, p_user);
  RETURN p_return;
END $$;

-- ---------- treasury documents (receipt / payment / transfer / bank fee) ----------
-- doc as in core.treasury_posting_lines (007, proven identical to Holoo on 7,762 vouchers)
CREATE FUNCTION core.post_treasury(p_doc jsonb, p_date date, p_user text, p_description text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE eid bigint; per core.period; ref text := 'treasury:' || md5(p_doc::text || p_date || p_user || clock_timestamp()::text);
BEGIN
  PERFORM core.require_permission(p_user, 'treasury.post');
  SELECT * INTO per FROM core.period WHERE p_date BETWEEN starts_on AND ends_on;
  IF NOT FOUND THEN RAISE EXCEPTION 'no period for %', p_date; END IF;
  INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, source, source_ref, description, created_by)
  VALUES (per.fiscal_year_id, per.id, p_date, 'treasury', ref, coalesce(p_description, p_doc->>'kind'), p_user) RETURNING id INTO eid;
  INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, credit, description)
  SELECT eid, l.line_no, l.account_id, l.party_id, l.debit, l.credit, l.role FROM core.treasury_posting_lines(p_doc) l;
  UPDATE core.journal_entry SET status = 'posted', posted_by = p_user WHERE id = eid;
  INSERT INTO core.document_posting (source, source_ref, entry_id, posted_by) VALUES ('treasury', ref, eid, p_user);
  RETURN eid;
END $$;


-- simple forms: receive from / pay to a party; the database, not the form, finds the party's control account
CREATE FUNCTION core.receive_from_party(p_party int, p_money_account int, p_amount numeric, p_date date, p_user text, p_description text DEFAULT NULL)
RETURNS bigint LANGUAGE sql AS $$
  SELECT core.post_treasury(jsonb_build_object('kind', 'receipt', 'money_account_id', p_money_account,
           'counter', jsonb_build_array(jsonb_build_object('account_id',
               (SELECT coalesce(default_receivable_account_id, core.setting_account('account_customers')) FROM core.party WHERE id = p_party),
               'party_id', p_party, 'amount', p_amount))), p_date, p_user, coalesce(p_description, 'receipt')) $$;
CREATE FUNCTION core.pay_to_party(p_party int, p_money_account int, p_amount numeric, p_date date, p_user text, p_description text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE acc int;
BEGIN
  SELECT coalesce(default_payable_account_id, core.setting_account('account_suppliers')) INTO acc FROM core.party WHERE id = p_party;
  IF acc IS NULL THEN RAISE EXCEPTION 'party % has no payable account and account_suppliers is not set', p_party; END IF;
  RETURN core.post_treasury(jsonb_build_object('kind', 'payment', 'money_account_id', p_money_account,
           'counter', jsonb_build_array(jsonb_build_object('account_id', acc, 'party_id', p_party, 'amount', p_amount))), p_date, p_user,
           coalesce(p_description, 'payment'));
END $$;

-- ---------- lookups for forms (read) ----------
CREATE FUNCTION core.find_parties(p_query text, p_limit int DEFAULT 20)
RETURNS TABLE (party_id int, name text, national_id text, mobile text) LANGUAGE sql STABLE AS $$
  SELECT p.id, p.name, p.national_id, p.mobile FROM core.party p
  WHERE p.merged_into_id IS NULL AND (p.name ILIKE '%' || p_query || '%' OR p.national_id = p_query OR p.mobile = p_query)
  ORDER BY p.name LIMIT least(p_limit, 100) $$;
CREATE FUNCTION core.find_items(p_query text, p_limit int DEFAULT 20)
RETURNS TABLE (item_id int, code text, name text, is_service boolean) LANGUAGE sql STABLE AS $$
  SELECT i.id, i.code, i.name, i.is_service FROM core.item i WHERE i.active AND (i.name ILIKE '%' || p_query || '%' OR i.code = p_query)
  ORDER BY i.name LIMIT least(p_limit, 100) $$;
CREATE FUNCTION core.list_warehouses() RETURNS TABLE (warehouse_id int, code text, name text) LANGUAGE sql STABLE AS $$
  SELECT id, code, name FROM core.warehouse WHERE active ORDER BY name $$;
-- accounts money can be received into / paid from: cash boxes and bank accounts
CREATE FUNCTION core.list_money_accounts() RETURNS TABLE (account_id int, code text, name text, kind text) LANGUAGE sql STABLE AS $$
  SELECT a.id, a.code, coalesce(c.name, b.title, a.name), CASE WHEN c.id IS NOT NULL THEN 'cash' ELSE 'bank' END
  FROM core.account a LEFT JOIN core.cashbox c ON c.cash_account_id = a.id LEFT JOIN core.company_bank_account b ON b.gl_account_id = a.id
  WHERE c.id IS NOT NULL OR b.id IS NOT NULL ORDER BY 4, 3 $$;
-- aging with the party's name (for people)
CREATE FUNCTION core.aging_report(p_as_of date)
RETURNS TABLE (party_id int, party_name text, account_code text, not_due numeric, overdue_1_90 numeric, overdue_over_90 numeric,
               unapplied_credit numeric, net numeric, oldest_open_due date) LANGUAGE sql STABLE AS $$
  SELECT a.party_id, p.name, ac.code, coalesce(a.not_due, 0), coalesce(a.d1_30, 0) + coalesce(a.d31_60, 0) + coalesce(a.d61_90, 0),
         coalesce(a.d91_180, 0) + coalesce(a.d181_365, 0) + coalesce(a.over_365, 0), a.unapplied_credit, a.net, a.oldest_open_due
  FROM core.aging(p_as_of) a JOIN core.party p ON p.id = a.party_id JOIN core.account ac ON ac.id = a.account_id
  WHERE a.net <> 0 ORDER BY a.net DESC $$;

INSERT INTO core.operation_catalog VALUES
  ('sales.create', 'write', 'core.create_sales_invoice(date,integer,jsonb,jsonb,text,text)', 'create a sales invoice draft with its lines and payments', 'sales.create',
   'one draft invoice (editable until finalized)', 'a draft can be deleted', 'D-06, E17', true),
  ('sales.finalize', 'write', 'core.finalize_sales_invoice(bigint,text,boolean,text)', 'finalize and post a sales invoice (gapless number, below-cost rules, voucher + stock)', 'sales.finalize',
   'final, numbered, posted invoice', 'sales return (return.create)', 'D-06, D-11, W-05, W-11', true),
  ('purchase.create', 'write', 'core.create_purchase_invoice(date,integer,jsonb,jsonb,text,text,numeric)', 'create a purchase invoice draft with its lines and payments', 'purchase.create',
   'one draft invoice', 'a draft can be deleted', 'E17', true),
  ('purchase.finalize', 'write', 'core.finalize_purchase_invoice(bigint,text)', 'finalize and post a purchase invoice (voucher + stock + purchase price)', 'purchase.finalize',
   'final, numbered, posted invoice', 'purchase return (return.create)', 'E17, E23, D-11', true),
  ('return.create', 'write', 'core.create_return(text,bigint,date,text,jsonb,text)', 'create a sales or purchase return draft for a posted invoice', 'return.create',
   'one draft return', 'a draft can be deleted', 'E11, E17', true),
  ('return.finalize', 'write', 'core.finalize_return(bigint,text)', 'finalize and post a return (voucher + stock)', 'return.finalize',
   'final, posted return; never more than what is left of the original', 'a new sale / purchase', 'E11, E17', true),
  ('treasury.post', 'write', 'core.post_treasury(jsonb,date,text,text)', 'post a receipt, payment, transfer or bank fee (with fees and cash discounts)', 'treasury.post',
   'one posted journal entry', 'a reversal entry (core.reverse_entry)', 'E19 (= Holoo 7,762/7,762)', true),
  ('treasury.receive', 'write', 'core.receive_from_party(integer,integer,numeric,date,text,text)', 'receive money from a party into a cash box or bank', 'treasury.post',
   'one posted receipt', 'a reversal entry', 'E19', true),
  ('treasury.pay', 'write', 'core.pay_to_party(integer,integer,numeric,date,text,text)', 'pay money to a party from a cash box or bank', 'treasury.post',
   'one posted payment', 'a reversal entry', 'E19', true),
  ('parties.find', 'read', 'core.find_parties(text,integer)', 'find parties by name, national id or mobile', NULL, 'none', '—', 'D-18', true),
  ('items.find', 'read', 'core.find_items(text,integer)', 'find items (models) by name or code', NULL, 'none', '—', 'D-13', true),
  ('warehouses.list', 'read', 'core.list_warehouses()', 'warehouses', NULL, 'none', '—', 'INV-02', true),
  ('money_accounts.list', 'read', 'core.list_money_accounts()', 'cash boxes and bank accounts money can move through', NULL, 'none', '—', 'TRE-01, TRE-02', true),
  ('ar.aging_report', 'read', 'core.aging_report(date)', 'aging per party with names', NULL, 'none', '—', 'E21', true);
