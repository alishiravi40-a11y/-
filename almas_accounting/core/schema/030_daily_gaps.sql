-- Almas Shahr accounting — core v0.30: what daily work still needed SQL or the command line, as catalogued operations:
-- setting up warehouses, cash boxes and bank accounts; the company profile for printed documents; the list and the full
-- view of invoices and returns; importing a bank statement; queueing a Holoo backup import. Same rules as everywhere:
-- permission in the database, audit, nothing deleted.

INSERT INTO core.permission VALUES
  ('setup.manage', 'define warehouses, cash boxes and the company''s bank accounts'),
  ('bank.statement_import', 'import a bank statement file');

-- ---------- company profile (printed on invoices and reports; filled by the owner, never guessed) ----------
INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('company_title', 'الماس شهر', NULL, '^.{1,200}$', 'print'),
  ('company_national_id', '', NULL, '^$|^[0-9]{10,11}$', 'print'),
  ('company_economic_code', '', NULL, '^$|^[0-9]{10,14}$', 'print'),
  ('company_address', '', NULL, '^.{0,250}$', 'print'),
  ('company_phone', '', NULL, '^.{0,60}$', 'print');

CREATE FUNCTION core.company_profile() RETURNS TABLE (title text, national_id text, economic_code text, address text, phone text) LANGUAGE sql STABLE AS $$
  SELECT core.setting_value('company_title'), core.setting_value('company_national_id'), core.setting_value('company_economic_code'),
         core.setting_value('company_address'), core.setting_value('company_phone') $$;

-- ---------- warehouses, cash boxes, bank accounts ----------
-- a money account must be its own leaf ledger account: on the balance sheet, without parties, used by nothing else
CREATE FUNCTION core.money_ledger_account(p_code text, p_self_cashbox int, p_self_bank int, p_label text) RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE a core.account;
BEGIN
  IF nullif(btrim(p_code), '') IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM core.account WHERE code = btrim(p_code);
  IF NOT FOUND THEN RAISE EXCEPTION 'حساب % (%) وجود ندارد؛ نخست آن را در «سرفصل حساب‌ها» بسازید', p_code, p_label; END IF;
  IF NOT a.is_leaf THEN RAISE EXCEPTION 'حساب % (%) حساب معین آخر نیست', p_code, p_label; END IF;
  IF a.requires_party THEN RAISE EXCEPTION 'حساب % (%) حساب اشخاص است و برای صندوق یا بانک مناسب نیست', p_code, p_label; END IF;
  IF a.statement <> 'balance_sheet' THEN RAISE EXCEPTION 'حساب % (%) حساب ترازنامه‌ای نیست', p_code, p_label; END IF;
  IF EXISTS (SELECT 1 FROM core.cashbox c WHERE a.id IN (c.cash_account_id, c.cheque_account_id) AND c.id IS DISTINCT FROM p_self_cashbox)
     OR EXISTS (SELECT 1 FROM core.company_bank_account b WHERE a.id IN (b.gl_account_id, b.collection_account_id, b.payable_cheque_account_id)
                AND b.id IS DISTINCT FROM p_self_bank) THEN
    RAISE EXCEPTION 'حساب % (%) به صندوق یا حساب بانکی دیگری وصل است', p_code, p_label; END IF;
  RETURN a.id;
END $$;

-- changing the ledger account behind a cash box / bank account would re-label its history: only while the old one has no postings
CREATE FUNCTION core.require_unused_account(p_old int, p_new int, p_label text) RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_old IS NOT NULL AND p_old IS DISTINCT FROM p_new AND EXISTS (SELECT 1 FROM core.journal_line WHERE account_id = p_old) THEN
    RAISE EXCEPTION 'حساب % گردش دارد و عوض نمی‌شود؛ برای حساب تازه، صندوق یا حساب بانکی تازه تعریف کنید', p_label; END IF;
END $$;

CREATE FUNCTION core.warehouse_save(p_warehouse int, p_code text, p_name text, p_active boolean, p_user text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE wid int; old core.warehouse;
BEGIN
  PERFORM core.require_permission(p_user, 'setup.manage');
  IF nullif(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'نام انبار لازم است'; END IF;
  IF p_warehouse IS NULL THEN
    INSERT INTO core.warehouse (code, name) VALUES (coalesce(nullif(btrim(p_code), ''), 'W' || (SELECT count(*) + 1 FROM core.warehouse)), btrim(p_name))
    RETURNING id INTO wid;
  ELSE
    SELECT * INTO old FROM core.warehouse WHERE id = p_warehouse;
    IF NOT FOUND THEN RAISE EXCEPTION 'انبار % وجود ندارد', p_warehouse; END IF;
    IF NOT coalesce(p_active, true) AND EXISTS (SELECT 1 FROM core.inventory_valuation(current_date) v WHERE v.warehouse_id = p_warehouse AND v.qty <> 0) THEN
      RAISE EXCEPTION 'انبار «%» موجودی دارد و غیرفعال نمی‌شود؛ نخست موجودی را منتقل کنید', old.name; END IF;
    UPDATE core.warehouse SET name = btrim(p_name), active = coalesce(p_active, true) WHERE id = p_warehouse;
    wid := p_warehouse;
  END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after)
  VALUES (p_user, CASE WHEN p_warehouse IS NULL THEN 'create' ELSE 'change' END, 'warehouse', wid::text, to_jsonb(old),
          (SELECT to_jsonb(w) FROM core.warehouse w WHERE id = wid));
  RETURN wid;
END $$;

CREATE FUNCTION core.cashbox_save(p_cashbox int, p_name text, p_cash_account_code text, p_cheque_account_code text, p_user text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE cid int; old core.cashbox; ca int; ch int;
BEGIN
  PERFORM core.require_permission(p_user, 'setup.manage');
  IF nullif(btrim(p_name), '') IS NULL THEN RAISE EXCEPTION 'نام صندوق لازم است'; END IF;
  ca := core.money_ledger_account(p_cash_account_code, p_cashbox, NULL, 'حساب وجه نقد');
  IF ca IS NULL THEN RAISE EXCEPTION 'حساب وجه نقد صندوق لازم است'; END IF;
  ch := core.money_ledger_account(p_cheque_account_code, p_cashbox, NULL, 'حساب چک‌های دریافتنی');
  IF ca = ch THEN RAISE EXCEPTION 'حساب نقد و حساب چک صندوق باید جدا باشند'; END IF;
  IF p_cashbox IS NULL THEN
    INSERT INTO core.cashbox (code, name, cash_account_id, cheque_account_id) VALUES ('C' || nextval('core.cashbox_id_seq'), btrim(p_name), ca, ch)
    RETURNING id INTO cid;
  ELSE
    SELECT * INTO old FROM core.cashbox WHERE id = p_cashbox;
    IF NOT FOUND THEN RAISE EXCEPTION 'صندوق % وجود ندارد', p_cashbox; END IF;
    PERFORM core.require_unused_account(old.cash_account_id, ca, 'نقد این صندوق');
    PERFORM core.require_unused_account(old.cheque_account_id, ch, 'چک این صندوق');
    UPDATE core.cashbox SET name = btrim(p_name), cash_account_id = ca, cheque_account_id = ch WHERE id = p_cashbox;
    cid := p_cashbox;
  END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after)
  VALUES (p_user, CASE WHEN p_cashbox IS NULL THEN 'create' ELSE 'change' END, 'cashbox', cid::text, to_jsonb(old),
          (SELECT to_jsonb(c) FROM core.cashbox c WHERE id = cid));
  RETURN cid;
END $$;

CREATE FUNCTION core.bank_account_save(p_bank_account int, p_bank_code text, p_account_no text, p_title text, p_gl_account_code text,
  p_collection_account_code text, p_payable_cheque_account_code text, p_fee_account_code text, p_is_pos boolean, p_user text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE bid int; old core.company_bank_account; gl int; col int; pay int; fee int;
BEGIN
  PERFORM core.require_permission(p_user, 'setup.manage');
  IF nullif(btrim(p_title), '') IS NULL OR nullif(btrim(p_bank_code), '') IS NULL OR nullif(btrim(p_account_no), '') IS NULL THEN
    RAISE EXCEPTION 'عنوان، بانک و شماره حساب لازم است'; END IF;
  gl := core.money_ledger_account(p_gl_account_code, NULL, p_bank_account, 'حساب بانک در دفتر');
  IF gl IS NULL THEN RAISE EXCEPTION 'حساب این بانک در دفتر لازم است'; END IF;
  col := core.money_ledger_account(p_collection_account_code, NULL, p_bank_account, 'چک‌های در جریان وصول');
  pay := core.money_ledger_account(p_payable_cheque_account_code, NULL, p_bank_account, 'اسناد پرداختنی');
  IF nullif(btrim(p_fee_account_code), '') IS NOT NULL THEN
    SELECT id INTO fee FROM core.account WHERE code = btrim(p_fee_account_code) AND is_leaf AND NOT requires_party;
    IF fee IS NULL THEN RAISE EXCEPTION 'حساب کارمزد % معین آخر بدون شخص نیست', p_fee_account_code; END IF;
  END IF;
  IF gl IN (col, pay) OR col = pay THEN RAISE EXCEPTION 'حساب‌های یک بانک باید از هم جدا باشند'; END IF;
  IF p_bank_account IS NULL THEN
    INSERT INTO core.company_bank_account (bank_code, account_no, title, gl_account_id, collection_account_id, payable_cheque_account_id, fee_account_id, is_pos)
    VALUES (btrim(p_bank_code), btrim(p_account_no), btrim(p_title), gl, col, pay, fee, coalesce(p_is_pos, false)) RETURNING id INTO bid;
  ELSE
    SELECT * INTO old FROM core.company_bank_account WHERE id = p_bank_account;
    IF NOT FOUND THEN RAISE EXCEPTION 'حساب بانکی % وجود ندارد', p_bank_account; END IF;
    PERFORM core.require_unused_account(old.gl_account_id, gl, 'این بانک');
    PERFORM core.require_unused_account(old.collection_account_id, col, 'در جریان وصول این بانک');
    PERFORM core.require_unused_account(old.payable_cheque_account_id, pay, 'اسناد پرداختنی این بانک');
    UPDATE core.company_bank_account SET bank_code = btrim(p_bank_code), account_no = btrim(p_account_no), title = btrim(p_title), gl_account_id = gl,
           collection_account_id = col, payable_cheque_account_id = pay, fee_account_id = fee, is_pos = coalesce(p_is_pos, false) WHERE id = p_bank_account;
    bid := p_bank_account;
  END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after)
  VALUES (p_user, CASE WHEN p_bank_account IS NULL THEN 'create' ELSE 'change' END, 'company_bank_account', bid::text, to_jsonb(old),
          (SELECT to_jsonb(b) FROM core.company_bank_account b WHERE id = bid));
  RETURN bid;
END $$;

CREATE FUNCTION core.setup_overview() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'warehouses', (SELECT coalesce(jsonb_agg(jsonb_build_object('warehouse_id', w.id, 'code', w.code, 'name', w.name, 'active', w.active,
                     'items_in_stock', (SELECT count(*) FROM core.inventory_valuation(current_date) v WHERE v.warehouse_id = w.id AND v.qty <> 0)) ORDER BY w.code), '[]')
                   FROM core.warehouse w),
    'cashboxes', (SELECT coalesce(jsonb_agg(jsonb_build_object('cashbox_id', c.id, 'code', c.code, 'name', c.name, 'cash_account', a.code, 'cash_account_name', a.name,
                     'cheque_account', b.code, 'is_main', c.is_main) ORDER BY c.name), '[]')
                  FROM core.cashbox c LEFT JOIN core.account a ON a.id = c.cash_account_id LEFT JOIN core.account b ON b.id = c.cheque_account_id),
    'bank_accounts', (SELECT coalesce(jsonb_agg(jsonb_build_object('bank_account_id', k.id, 'title', k.title, 'bank_code', k.bank_code, 'account_no', k.account_no,
                     'gl_account', g.code, 'collection_account', c.code, 'payable_cheque_account', p.code, 'fee_account', f.code, 'is_pos', k.is_pos,
                     'statement_lines', (SELECT count(*) FROM core.bank_statement_line s WHERE s.company_bank_account_id = k.id)) ORDER BY k.title), '[]')
                      FROM core.company_bank_account k LEFT JOIN core.account g ON g.id = k.gl_account_id LEFT JOIN core.account c ON c.id = k.collection_account_id
                      LEFT JOIN core.account p ON p.id = k.payable_cheque_account_id LEFT JOIN core.account f ON f.id = k.fee_account_id)) $$;

-- ---------- invoices and returns: the list and the whole document (what is printed) ----------
CREATE FUNCTION core.invoices_list(p_kind text, p_from date, p_to date, p_query text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS TABLE (kind text, document_id bigint, number bigint, doc_date date, party_id int, party_name text, total numeric, status text, entry_id bigint)
LANGUAGE sql STABLE AS $$
  WITH d AS (
    SELECT 'sales'::text k, i.id, i.number, i.invoice_date dd, i.party_id, i.status,
           (SELECT sum(l.quantity * l.unit_price - l.discount + coalesce(l.vat_amount, 0) + coalesce(l.levy_amount, 0)) FROM core.sales_invoice_line l WHERE l.invoice_id = i.id) t,
           'sales_invoice' src
    FROM core.sales_invoice i WHERE p_kind IN ('sales', 'all')
    UNION ALL
    SELECT 'purchase', i.id, i.number, i.invoice_date, i.party_id, i.status,
           (SELECT sum(l.quantity * l.unit_price - l.discount) FROM core.purchase_invoice_line l WHERE l.invoice_id = i.id) + coalesce(i.extra_cost, 0), 'purchase_invoice'
    FROM core.purchase_invoice i WHERE p_kind IN ('purchase', 'all')
    UNION ALL
    SELECT r.kind, r.id, r.id, r.return_date, coalesce(s.party_id, p.party_id), r.status, NULL, 'return'
    FROM core.return_document r LEFT JOIN core.sales_invoice s ON s.id = r.sales_invoice_id LEFT JOIN core.purchase_invoice p ON p.id = r.purchase_invoice_id
    WHERE p_kind IN ('return', 'all'))
  SELECT d.k, d.id, d.number, d.dd, d.party_id, pa.name, round(d.t), d.status,
         (SELECT dp.entry_id FROM core.document_posting dp WHERE dp.source = d.src AND dp.source_ref = d.id::text)
  FROM d LEFT JOIN core.party pa ON pa.id = d.party_id
  WHERE d.dd BETWEEN coalesce(p_from, '-infinity') AND coalesce(p_to, 'infinity')
    AND (nullif(btrim(p_query), '') IS NULL OR d.number::text = btrim(p_query) OR pa.name ILIKE '%' || btrim(p_query) || '%')
  ORDER BY d.dd DESC, d.id DESC LIMIT least(coalesce(p_limit, 200), 1000) $$;

CREATE FUNCTION core.invoice_detail(p_kind text, p_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE h jsonb; lines jsonb; pays jsonb; src text; v_party int; inv_kind text; orig bigint;
BEGIN
  IF p_kind = 'sales' THEN
    SELECT to_jsonb(i) INTO h FROM core.sales_invoice i WHERE id = p_id; src := 'sales_invoice';
    SELECT coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'item_code', it.code, 'item_name', it.name, 'unit', it.unit, 'warehouse', w.name,
             'quantity', l.quantity, 'unit_price', l.unit_price, 'discount', l.discount, 'vat', coalesce(l.vat_amount, 0), 'levy', coalesce(l.levy_amount, 0),
             'amount', l.quantity * l.unit_price - l.discount + coalesce(l.vat_amount, 0) + coalesce(l.levy_amount, 0)) ORDER BY l.line_no), '[]')
      INTO lines FROM core.sales_invoice_line l JOIN core.item it ON it.id = l.item_id LEFT JOIN core.warehouse w ON w.id = l.warehouse_id WHERE l.invoice_id = p_id;
    SELECT coalesce(jsonb_agg(jsonb_build_object('method', y.method, 'account', a.name, 'amount', y.amount, 'reference', y.reference) ORDER BY y.seq), '[]')
      INTO pays FROM core.sales_invoice_payment y LEFT JOIN core.account a ON a.id = y.account_id WHERE y.invoice_id = p_id;
  ELSIF p_kind = 'purchase' THEN
    SELECT to_jsonb(i) INTO h FROM core.purchase_invoice i WHERE id = p_id; src := 'purchase_invoice';
    SELECT coalesce(jsonb_agg(jsonb_build_object('line_no', l.line_no, 'item_code', it.code, 'item_name', it.name, 'unit', it.unit, 'warehouse', w.name,
             'quantity', l.quantity, 'unit_price', l.unit_price, 'discount', l.discount, 'vat', 0, 'levy', 0,
             'amount', l.quantity * l.unit_price - l.discount) ORDER BY l.line_no), '[]')
      INTO lines FROM core.purchase_invoice_line l JOIN core.item it ON it.id = l.item_id LEFT JOIN core.warehouse w ON w.id = l.warehouse_id WHERE l.invoice_id = p_id;
    SELECT coalesce(jsonb_agg(jsonb_build_object('method', y.method, 'account', a.name, 'amount', y.amount, 'reference', y.reference) ORDER BY y.seq), '[]')
      INTO pays FROM core.purchase_invoice_payment y LEFT JOIN core.account a ON a.id = y.account_id WHERE y.invoice_id = p_id;
  ELSIF p_kind IN ('return', 'sales_return', 'purchase_return') THEN
    SELECT to_jsonb(r), r.kind, coalesce(r.sales_invoice_id, r.purchase_invoice_id) INTO h, inv_kind, orig FROM core.return_document r WHERE id = p_id;
    src := 'return';
    SELECT coalesce(jsonb_agg(jsonb_build_object('line_no', rl.original_line_no, 'item_code', it.code, 'item_name', it.name, 'unit', it.unit,
             'quantity', rl.quantity, 'unit_price', round(a.net_unit_price), 'discount', 0, 'vat', 0, 'levy', 0, 'amount', round(rl.quantity * a.net_unit_price))
             ORDER BY rl.original_line_no), '[]')
      INTO lines FROM core.return_line rl JOIN core.returnable_line a ON a.kind = inv_kind AND a.invoice_id = orig AND a.line_no = rl.original_line_no
      JOIN core.item it ON it.id = a.item_id WHERE rl.return_id = p_id;
    pays := '[]';
    h := h || jsonb_build_object('invoice_date', h->>'return_date', 'number', p_id, 'original_invoice', orig,
               'original_number', (SELECT number FROM core.sales_invoice WHERE id = orig AND inv_kind = 'sales_return'
                                   UNION ALL SELECT number FROM core.purchase_invoice WHERE id = orig AND inv_kind = 'purchase_return'),
               'party_id', (SELECT party_id FROM core.sales_invoice WHERE id = orig AND inv_kind = 'sales_return'
                            UNION ALL SELECT party_id FROM core.purchase_invoice WHERE id = orig AND inv_kind = 'purchase_return'));
  ELSE RAISE EXCEPTION 'نوع مدرک % شناخته نیست', p_kind;
  END IF;
  IF h IS NULL THEN RETURN NULL; END IF;
  v_party := (h->>'party_id')::int;
  RETURN jsonb_build_object('kind', coalesce(inv_kind, p_kind), 'header', h, 'lines', lines, 'payments', pays,
    'party', (SELECT jsonb_build_object('party_id', id, 'name', name, 'national_id', national_id, 'economic_code', economic_code, 'mobile', mobile)
              FROM core.party WHERE id = v_party),
    'totals', jsonb_build_object(
       'gross', (SELECT coalesce(sum((l->>'quantity')::numeric * (l->>'unit_price')::numeric), 0) FROM jsonb_array_elements(lines) l),
       'discount', (SELECT coalesce(sum((l->>'discount')::numeric), 0) FROM jsonb_array_elements(lines) l),
       'vat', (SELECT coalesce(sum((l->>'vat')::numeric + (l->>'levy')::numeric), 0) FROM jsonb_array_elements(lines) l),
       'extra_cost', coalesce((h->>'extra_cost')::numeric, 0),
       'net', (SELECT coalesce(sum((l->>'amount')::numeric), 0) FROM jsonb_array_elements(lines) l) + coalesce((h->>'extra_cost')::numeric, 0),
       'paid', (SELECT coalesce(sum((y->>'amount')::numeric), 0) FROM jsonb_array_elements(pays) y)),
    'entry', (SELECT jsonb_build_object('entry_id', e.id, 'number', e.number) FROM core.document_posting dp JOIN core.journal_entry e ON e.id = dp.entry_id
              WHERE dp.source = src AND dp.source_ref = p_id::text),
    'returns', CASE WHEN p_kind IN ('sales', 'purchase') THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('return_id', r.id, 'date', r.return_date, 'status', r.status) ORDER BY r.id), '[]')
               FROM core.return_document r WHERE (p_kind = 'sales' AND r.sales_invoice_id = p_id) OR (p_kind = 'purchase' AND r.purchase_invoice_id = p_id)) END);
END $$;

-- ---------- bank statement import (the file is read by the server; the lines arrive here) ----------
-- line: {date (ISO), jdate, time, doc_no, branch, deposit, withdrawal, balance, deposit_id, description[, natural_key]}
-- Idempotent: the same file (SHA-256) is a no-op; overlapping statements add only new lines (natural key, as beta/statement_import).
-- Installment / bank-share classification applies only to accounts of a Beta scheme (their matching stays a person's decision).
CREATE FUNCTION core.bank_statement_import(p_account int, p_file_name text, p_sha256 text, p_lines jsonb, p_user text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE fid bigint; ln jsonb; cls text; lid bigint; isnew boolean; beta boolean; nk text; prev jsonb; chain boolean := true;
        st jsonb := jsonb_build_object('new_lines', 0, 'known_lines', 0); byc jsonb := '{}'; inst bigint[] := '{}';
BEGIN
  PERFORM core.require_permission(p_user, 'bank.statement_import');
  IF NOT EXISTS (SELECT 1 FROM core.company_bank_account WHERE id = p_account) THEN RAISE EXCEPTION 'حساب بانکی % وجود ندارد', p_account; END IF;
  IF jsonb_array_length(coalesce(p_lines, '[]')) = 0 THEN RAISE EXCEPTION 'در فایل هیچ ردیف صورت‌حسابی پیدا نشد'; END IF;
  IF EXISTS (SELECT 1 FROM core.import_file WHERE kind = 'bank_statement' AND sha256 = p_sha256) THEN
    RETURN jsonb_build_object('status', 'duplicate', 'message', 'این فایل پیش‌تر وارد شده است؛ چیزی تغییر نکرد');
  END IF;
  beta := EXISTS (SELECT 1 FROM core.beta_scheme WHERE company_bank_account_id = p_account);
  INSERT INTO core.import_file (kind, sha256, file_name, company_bank_account_id, imported_by)
  VALUES ('bank_statement', p_sha256, p_file_name, p_account, p_user) RETURNING id INTO fid;
  FOR ln IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF (coalesce((ln->>'deposit')::numeric, 0) > 0) = (coalesce((ln->>'withdrawal')::numeric, 0) > 0) THEN
      RAISE EXCEPTION 'ردیف تاریخ % باید دقیقاً یکی از واریز یا برداشت را داشته باشد', ln->>'jdate'; END IF;
    IF prev IS NOT NULL AND ln->>'balance' IS NOT NULL AND prev->>'balance' IS NOT NULL
       AND (prev->>'balance')::numeric + coalesce((ln->>'deposit')::numeric, 0) - coalesce((ln->>'withdrawal')::numeric, 0) <> (ln->>'balance')::numeric
       AND (ln->>'balance')::numeric + coalesce((prev->>'deposit')::numeric, 0) - coalesce((prev->>'withdrawal')::numeric, 0) <> (prev->>'balance')::numeric THEN
      chain := false; END IF;
    prev := ln;
    cls := CASE WHEN coalesce((ln->>'deposit')::numeric, 0) > 0 THEN
                  CASE WHEN beta AND coalesce(ln->>'description', '') LIKE '%قسط%' THEN 'installment' ELSE 'other_deposit' END
                WHEN beta AND coalesce(ln->>'description', '') ~ 'REFA|رفاه' THEN 'bank_share_candidate'
                WHEN (ln->>'withdrawal')::numeric < 1000000 AND coalesce(ln->>'description', '') ~ 'کارمزد|هزینه|پیامک|پرینت|صورتحساب' THEN 'bank_fee'
                ELSE 'other_withdrawal' END;
    nk := coalesce(ln->>'natural_key', concat_ws('|', coalesce(ln->>'doc_no', ''), coalesce(ln->>'jdate', ln->>'date'), coalesce(ln->>'time', ''),
                                                  coalesce(ln->>'deposit', '0'), coalesce(ln->>'withdrawal', '0'), coalesce(ln->>'balance', 'None')));
    INSERT INTO core.bank_statement_line (company_bank_account_id, value_date, value_time, doc_no, branch, deposit, withdrawal, balance, deposit_id,
                                          description, natural_key, first_file_id, last_file_id, classification, match_status)
    VALUES (p_account, (ln->>'date')::date, nullif(ln->>'time', ''), nullif(ln->>'doc_no', ''), nullif(ln->>'branch', ''),
            coalesce((ln->>'deposit')::numeric, 0), coalesce((ln->>'withdrawal')::numeric, 0), (ln->>'balance')::numeric, nullif(ln->>'deposit_id', ''),
            ln->>'description', nk, fid, fid, cls, CASE WHEN cls IN ('installment', 'bank_share_candidate') THEN 'unmatched' ELSE 'not_applicable' END)
    ON CONFLICT (company_bank_account_id, natural_key) DO UPDATE SET last_file_id = EXCLUDED.last_file_id
    RETURNING id, (xmax = 0) INTO lid, isnew;
    IF NOT isnew THEN st := jsonb_set(st, '{known_lines}', to_jsonb((st->>'known_lines')::int + 1)); CONTINUE; END IF;
    st := jsonb_set(st, '{new_lines}', to_jsonb((st->>'new_lines')::int + 1));
    byc := jsonb_set(byc, ARRAY[cls], to_jsonb(coalesce((byc->>cls)::int, 0) + 1));
    IF cls = 'bank_share_candidate' THEN
      INSERT INTO core.bank_share_withdrawal (company_bank_account_id, amount, value_date, bank_doc_no, statement_line_id, note, created_by)
      VALUES (p_account, (ln->>'withdrawal')::numeric, (ln->>'date')::date, nullif(ln->>'doc_no', ''), lid, 'Q-2 candidate from statement import', p_user);
      UPDATE core.bank_statement_line SET match_status = 'needs_review' WHERE id = lid;
    ELSIF cls = 'installment' THEN inst := inst || lid;
    END IF;
  END LOOP;
  st := st || jsonb_build_object('status', 'imported', 'file_id', fid, 'sha256', p_sha256, 'lines', jsonb_array_length(p_lines),
                                 'balance_chain_ok', chain, 'by_class', byc, 'installment_line_ids', to_jsonb(inst));
  UPDATE core.import_file SET stats = st WHERE id = fid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after)
  VALUES (p_user, 'import', 'bank_statement', fid::text, st - 'installment_line_ids');
  RETURN st;
END $$;

CREATE FUNCTION core.bank_statement_files(p_account int DEFAULT NULL)
RETURNS TABLE (file_id bigint, bank_account text, file_name text, imported_by text, imported_at timestamptz, new_lines int, known_lines int, balance_chain_ok boolean)
LANGUAGE sql STABLE AS $$
  SELECT f.id, b.title, f.file_name, f.imported_by, f.imported_at, (f.stats->>'new_lines')::int, (f.stats->>'known_lines')::int, (f.stats->>'balance_chain_ok')::boolean
  FROM core.import_file f JOIN core.company_bank_account b ON b.id = f.company_bank_account_id
  WHERE f.kind = 'bank_statement' AND (p_account IS NULL OR f.company_bank_account_id = p_account) ORDER BY f.id DESC LIMIT 100 $$;

-- ---------- automatic bank matching (the rules of E20, strictest first; only UNAMBIGUOUS matches, the rest stays for a person) ----------
--   exact: same amount and date; window: same amount within bank_recon_date_window_days; same_day_sum: one line on one side equals
--   the sum of all open lines of that date and direction on the other side. Every group goes through core.reconcile.
CREATE FUNCTION core.bank_auto_reconcile(p_account int, p_user text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE w int; pass record; r record; n_exact int := 0; n_window int := 0; n_sum int := 0;
BEGIN
  PERFORM core.require_permission(p_user, 'bank.reconcile');
  w := core.setting_value('bank_recon_date_window_days')::int;
  FOR pass IN SELECT * FROM (VALUES ('exact', 0), ('window', w)) v(method, days) LOOP
    FOR r IN
      WITH st AS (SELECT statement_line_id sid, value_date d, net n FROM core.bank_statement_recon
                  WHERE company_bank_account_id = p_account AND group_id IS NULL AND net <> 0),
      bk AS (SELECT entry_id, line_no, effective_date d, net n FROM core.bank_book_line WHERE company_bank_account_id = p_account AND group_id IS NULL),
      c AS (SELECT st.sid, bk.entry_id, bk.line_no FROM st JOIN bk ON bk.n = st.n AND abs(bk.d - st.d) <= pass.days)
      SELECT c.sid, c.entry_id, c.line_no FROM c
      WHERE (SELECT count(*) FROM c c2 WHERE c2.sid = c.sid) = 1 AND (SELECT count(*) FROM c c3 WHERE c3.entry_id = c.entry_id AND c3.line_no = c.line_no) = 1
    LOOP
      PERFORM core.reconcile(p_account, ARRAY[r.sid], jsonb_build_array(jsonb_build_array(r.entry_id, r.line_no)), pass.method, p_user);
      IF pass.method = 'exact' THEN n_exact := n_exact + 1; ELSE n_window := n_window + 1; END IF;
    END LOOP;
  END LOOP;
  FOR r IN
    WITH st AS (SELECT statement_line_id sid, value_date d, net n FROM core.bank_statement_recon
                WHERE company_bank_account_id = p_account AND group_id IS NULL AND net <> 0),
    bk AS (SELECT entry_id, line_no, effective_date d, net n FROM core.bank_book_line WHERE company_bank_account_id = p_account AND group_id IS NULL),
    sd AS (SELECT d, n > 0 pos, array_agg(sid) ids, sum(n) tot, count(*) k FROM st GROUP BY 1, 2),
    bd AS (SELECT d, n > 0 pos, jsonb_agg(jsonb_build_array(entry_id, line_no)) keys, sum(n) tot, count(*) k FROM bk GROUP BY 1, 2)
    SELECT sd.ids, bd.keys FROM sd JOIN bd USING (d, pos) WHERE sd.tot = bd.tot AND ((sd.k = 1 AND bd.k >= 2) OR (bd.k = 1 AND sd.k >= 2))
  LOOP
    PERFORM core.reconcile(p_account, r.ids, r.keys, 'same_day_sum', p_user);
    n_sum := n_sum + 1;
  END LOOP;
  RETURN jsonb_build_object('exact', n_exact, 'window', n_window, 'same_day_sum', n_sum,
    'statement_open', (SELECT count(*) FROM core.bank_statement_recon WHERE company_bank_account_id = p_account AND group_id IS NULL AND net <> 0),
    'book_open', (SELECT count(*) FROM core.bank_book_line WHERE company_bank_account_id = p_account AND group_id IS NULL));
END $$;

-- the reconciliation groups of an account (to undo one)
CREATE FUNCTION core.bank_recon_groups(p_account int, p_from date, p_to date)
RETURNS TABLE (group_id bigint, method text, amount numeric, statement_date date, created_by text, created_at timestamptz, note text) LANGUAGE sql STABLE AS $$
  SELECT g.id, g.method, g.statement_net, (SELECT min(s.value_date) FROM core.bank_recon_statement r JOIN core.bank_statement_line s ON s.id = r.statement_line_id
                                          WHERE r.group_id = g.id), g.created_by, g.created_at, g.note
  FROM core.bank_recon_live g WHERE g.company_bank_account_id = p_account
    AND EXISTS (SELECT 1 FROM core.bank_recon_statement r JOIN core.bank_statement_line s ON s.id = r.statement_line_id
                WHERE r.group_id = g.id AND s.value_date BETWEEN p_from AND p_to)
  ORDER BY g.id DESC LIMIT 500 $$;

-- ---------- a new fiscal year from the application (the Jalali month boundaries come from the caller's calendar) ----------
-- 12 contiguous periods; the year must directly follow the last existing year (no gap, no overlap)
CREATE FUNCTION core.fiscal_year_create(p_code text, p_period_starts date[], p_ends_on date, p_user text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE fid int; last_end date; i int;
BEGIN
  PERFORM core.require_permission(p_user, 'period.close');
  IF p_code !~ '^[0-9]{4}$' THEN RAISE EXCEPTION 'کد سال باید چهار رقم باشد (مثل ۱۴۰۶)'; END IF;
  IF EXISTS (SELECT 1 FROM core.fiscal_year WHERE code = p_code) THEN RAISE EXCEPTION 'سال مالی % از پیش وجود دارد', p_code; END IF;
  IF coalesce(array_length(p_period_starts, 1), 0) <> 12 THEN RAISE EXCEPTION 'سال مالی دوازده دوره ماهانه دارد'; END IF;
  FOR i IN 2..12 LOOP
    IF p_period_starts[i] <= p_period_starts[i - 1] OR p_period_starts[i] - p_period_starts[i - 1] NOT BETWEEN 29 AND 31 THEN
      RAISE EXCEPTION 'آغاز ماه % با ماه قبل پیوسته نیست', i; END IF;
  END LOOP;
  IF p_ends_on - p_period_starts[12] NOT BETWEEN 28 AND 30 THEN RAISE EXCEPTION 'پایان سال با آغاز اسفند نمی‌خواند'; END IF;
  SELECT max(ends_on) INTO last_end FROM core.fiscal_year;
  IF last_end IS NOT NULL AND p_period_starts[1] <> last_end + 1 THEN
    RAISE EXCEPTION 'سال تازه باید درست پس از آخرین سال (پایان %) شروع شود', last_end; END IF;
  INSERT INTO core.fiscal_year (code, starts_on, ends_on) VALUES (p_code, p_period_starts[1], p_ends_on) RETURNING id INTO fid;
  FOR i IN 1..12 LOOP
    INSERT INTO core.period (fiscal_year_id, code, starts_on, ends_on)
    VALUES (fid, p_code || '-' || lpad(i::text, 2, '0'), p_period_starts[i], CASE WHEN i < 12 THEN p_period_starts[i + 1] - 1 ELSE p_ends_on END);
  END LOOP;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after)
  VALUES (p_user, 'create', 'fiscal_year', p_code, jsonb_build_object('starts_on', p_period_starts[1], 'ends_on', p_ends_on));
  RETURN fid;
END $$;

-- year-end helpers for the screen: status, whether it is closed, and the stock valuation offered as the ending-inventory input
CREATE FUNCTION core.years_overview() RETURNS TABLE (fiscal_year_id int, code text, starts_on date, ends_on date, status text, open_periods bigint,
  closed boolean, opening_generated boolean, kardex_valuation numeric) LANGUAGE sql STABLE AS $$
  SELECT y.id, y.code, y.starts_on, y.ends_on, y.status, (SELECT count(*) FROM core.period p WHERE p.fiscal_year_id = y.id AND p.status <> 'closed'),
         EXISTS (SELECT 1 FROM core.year_end_close c WHERE c.fiscal_year_id = y.id),
         EXISTS (SELECT 1 FROM core.year_end_close c WHERE c.fiscal_year_id = y.id AND c.opening_entry_id IS NOT NULL),
         (SELECT round(sum(v.value)) FROM core.inventory_valuation(y.ends_on) v)
  FROM core.fiscal_year y ORDER BY y.starts_on DESC $$;

-- ---------- the item card also says which movement is a warehouse transfer made here (so it can be reversed from the screen) ----------
CREATE OR REPLACE FUNCTION core.item_detail(p_item int) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH k AS (SELECT * FROM core.item_kardex(p_item, NULL)),
  last AS (SELECT DISTINCT ON (warehouse_id) warehouse_id, qty_after, avg_cost_after FROM k ORDER BY warehouse_id, effective_date DESC, effective_time DESC, movement_id DESC)
  SELECT jsonb_build_object(
    'item', (SELECT to_jsonb(i) FROM core.item i WHERE id = p_item),
    'stock', (SELECT coalesce(jsonb_agg(jsonb_build_object('warehouse', w.name, 'qty', l.qty_after, 'avg_cost', round(l.avg_cost_after), 'value', round(l.qty_after * l.avg_cost_after))), '[]')
              FROM last l JOIN core.warehouse w ON w.id = l.warehouse_id WHERE l.qty_after <> 0),
    'movements', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', k.effective_date, 'kind', k.kind, 'warehouse', (SELECT name FROM core.warehouse WHERE id = k.warehouse_id),
                                                               'qty', k.qty, 'unit_cost', round(k.unit_cost), 'qty_after', k.qty_after,
                                                               'transfer_id', CASE WHEN m.source = 'transfer' AND k.kind = 'transfer_out' THEN m.transfer_id END)
                                                ORDER BY k.effective_date DESC, k.movement_id DESC), '[]')
                  FROM (SELECT * FROM k ORDER BY effective_date DESC, movement_id DESC LIMIT 50) k JOIN core.stock_movement m ON m.id = k.movement_id)) $$;

-- ---------- a party's allocations (which receipt settled which invoice), to see and undo one from the screen ----------
CREATE FUNCTION core.party_settlements(p_party int)
RETURNS TABLE (settlement_id bigint, account_code text, debit_date date, debit_voucher bigint, debit_description text, credit_date date, credit_voucher bigint,
               credit_description text, amount numeric, method text, created_by text, created_at timestamptz) LANGUAGE sql STABLE AS $$
  SELECT s.id, a.code, de.effective_date, de.number, coalesce(dl.description, de.description), ce.effective_date, ce.number, coalesce(cl.description, ce.description),
         s.amount, s.method, s.created_by, s.created_at
  FROM core.settlement_active s JOIN core.account a ON a.id = s.account_id
  JOIN core.journal_entry de ON de.id = s.debit_entry_id JOIN core.journal_line dl ON dl.entry_id = s.debit_entry_id AND dl.line_no = s.debit_line_no
  JOIN core.journal_entry ce ON ce.id = s.credit_entry_id JOIN core.journal_line cl ON cl.entry_id = s.credit_entry_id AND cl.line_no = s.credit_line_no
  WHERE s.party_id = p_party ORDER BY de.effective_date DESC, s.id DESC LIMIT 500 $$;

-- ---------- Holoo backup import from the application: a queued request, run by the server's import worker ----------
ALTER TABLE core.holoo_import_batch DROP CONSTRAINT holoo_import_batch_status_check;
ALTER TABLE core.holoo_import_batch ADD CONSTRAINT holoo_import_batch_status_check
  CHECK (status IN ('queued', 'running', 'reconciled', 'differences', 'failed', 'refused'));
CREATE FUNCTION core.import_queue(p_file_name text, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE b bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'holoo.import');
  IF p_file_name !~ '^[A-Za-z0-9._-]+$' THEN RAISE EXCEPTION 'نام فایل نامعتبر است'; END IF;
  IF EXISTS (SELECT 1 FROM core.holoo_import_batch WHERE status IN ('queued', 'running')) THEN
    RAISE EXCEPTION 'یک ورود Backup در صف یا در حال اجراست؛ پس از پایان آن دوباره بفرستید'; END IF;
  INSERT INTO core.holoo_import_batch (triggered_by, input_files, status) VALUES (p_user, ARRAY[p_file_name], 'queued') RETURNING id INTO b;
  RETURN b;
END $$;

INSERT INTO core.operation_catalog (operation, kind, function_signature, purpose, permission, effect, undo, basis, ai_allowed, agent_allowed) VALUES
  ('company.profile', 'read', 'core.company_profile()', 'the company''s name and identifiers printed on documents', NULL, 'none', '—', 'print', true, false),
  ('setup.overview', 'read', 'core.setup_overview()', 'warehouses, cash boxes and bank accounts with their ledger accounts', NULL, 'none', '—', 'setup', true, false),
  ('setup.warehouse_save', 'write', 'core.warehouse_save(integer,text,text,boolean,text)', 'create or rename a warehouse, or deactivate an empty one', 'setup.manage',
   'one warehouse; audited', 'save again', 'setup', true, false),
  ('setup.cashbox_save', 'write', 'core.cashbox_save(integer,text,text,text,text)', 'create or change a cash box and its ledger accounts', 'setup.manage',
   'one cash box; audited; an account with postings is not replaced', 'save again', 'setup', true, false),
  ('setup.bank_account_save', 'write', 'core.bank_account_save(integer,text,text,text,text,text,text,text,boolean,text)',
   'create or change one of the company''s bank accounts and its ledger accounts', 'setup.manage',
   'one bank account; audited; an account with postings is not replaced', 'save again', 'setup', true, false),
  ('invoices.list', 'read', 'core.invoices_list(text,date,date,text,integer)', 'sales / purchase invoices and returns in a date range, by number or party', NULL,
   'none', '—', 'E17', true, false),
  ('invoices.detail', 'read', 'core.invoice_detail(text,bigint)', 'one invoice or return as printed: party, lines, totals, payments, its voucher and returns', NULL,
   'none', '—', 'E17', true, false),
  ('bank.statement_import', 'write', 'core.bank_statement_import(integer,text,text,jsonb,text)',
   'import the lines of a bank statement file (idempotent per file and per line)', 'bank.statement_import',
   'new statement lines, never changed afterwards; audited', 'lines are facts of the bank: not deleted; reconciliation groups can be undone', 'E16, E20', true, false),
  ('bank.statement_files', 'read', 'core.bank_statement_files(integer)', 'imported bank statement files', NULL, 'none', '—', 'E16', true, false),
  ('bank.auto_reconcile', 'write', 'core.bank_auto_reconcile(integer,text)', 'match statement and book lines automatically where the match is unambiguous',
   'bank.reconcile', 'reconciliation groups (method exact / window / same_day_sum)', 'bank.unreconcile, one group at a time', 'E20', true, false),
  ('bank.recon_groups', 'read', 'core.bank_recon_groups(integer,date,date)', 'reconciliation groups of a bank account in a period', NULL, 'none', '—', 'E20', true, false),
  ('years.overview', 'read', 'core.years_overview()', 'fiscal years with status, closing state and the kardex valuation at year end', NULL, 'none', '—', 'E22', true, false),
  ('years.create', 'write', 'core.fiscal_year_create(text,date[],date,text)', 'create the next fiscal year with its twelve monthly periods', 'period.close',
   'one fiscal year and 12 open periods; audited', 'an empty year is harmless; it is not deleted', 'D-05', false, false),
  ('years.change_status', 'write', 'core.change_fiscal_year_status(integer,text,text,text)', 'open / start closing / close / reopen a fiscal year', NULL,
   'the year''s status; audited with reason', 'the opposite change (period.reopen)', 'D-05', false, false),
  ('ar.settlements', 'read', 'core.party_settlements(integer)', 'a party''s active allocations: which credit settled which debit', NULL, 'none', '—', 'W-17', true, false),
  ('imports.queue', 'write', 'core.import_queue(text,text)', 'queue an uploaded Holoo backup for import by the server', 'holoo.import',
   'one queued import batch', 'a queued batch that never starts is closed as failed by the next import', 'D-07', true, false);
