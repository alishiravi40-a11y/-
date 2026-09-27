-- Almas Shahr accounting — core v0.26: the everyday operations of a real accounting office, all catalogued, permissioned,
-- audited and reversible — so the UI, the API and an AI agent use the same doors. Proven by migration/tests/test_daily_operations.py.
--   people & accounts · manual vouchers and their reversal · voucher numbering · lineage of every voucher and number ·
--   cheques received / issued and their moves · items and stock transfers · periods · users, permissions, settings · dashboard.
-- Nothing is ever deleted: a posted voucher, a cheque event or a stock movement is corrected by its reversal, with a reason.

INSERT INTO core.permission (code, description) VALUES
  ('party.manage',     'create and edit people / companies (identity changes are audited)'),
  ('account.manage',   'add accounts to the chart of accounts'),
  ('journal.post',     'post manual vouchers'),
  ('journal.reverse',  'reverse a posted voucher (with a reason)'),
  ('cheque.manage',    'receive, issue and move cheques'),
  ('item.manage',      'create and edit goods and services'),
  ('inventory.manage', 'transfer stock between warehouses and reverse stock movements');

-- ============ Every posted voucher has a number (gapless per fiscal year; Holoo numbers are kept as they were) ============
CREATE FUNCTION core.trg_entry_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'draft' AND NEW.number IS NULL AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    NEW.number := core.next_number('journal_entry', NEW.fiscal_year_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entry_number BEFORE INSERT OR UPDATE ON core.journal_entry FOR EACH ROW EXECUTE FUNCTION core.trg_entry_number();

-- ============ People and companies ============
CREATE FUNCTION core.party_save(p_party int, p_name text, p_national_id text, p_mobile text, p_economic_code text, p_legal_kind text, p_user text,
  p_city_code int DEFAULT NULL) RETURNS int LANGUAGE plpgsql AS $$
DECLARE old core.party; pid int := p_party; nid text := nullif(btrim(translate(coalesce(p_national_id, ''), '۰۱۲۳۴۵۶۷۸۹', '0123456789')), '');
BEGIN
  PERFORM core.require_permission(p_user, 'party.manage');
  IF btrim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'نام لازم است'; END IF;
  IF nid IS NOT NULL THEN
    nid := lpad(nid, CASE WHEN coalesce(p_legal_kind, 'person') = 'company' THEN 11 ELSE 10 END, '0');
    IF coalesce(p_legal_kind, 'person') = 'person' AND NOT core.valid_national_id(nid) THEN RAISE EXCEPTION 'کد ملی معتبر نیست'; END IF;
    IF EXISTS (SELECT 1 FROM core.party WHERE national_id = nid AND id IS DISTINCT FROM pid) THEN
      RAISE EXCEPTION 'این کد ملی متعلق به پرونده دیگری است (%); ادغام فقط با بررسی و مجوز party.merge', (SELECT id FROM core.party WHERE national_id = nid); END IF;
  END IF;
  IF pid IS NULL THEN
    INSERT INTO core.party (name, name_key, national_id, mobile, economic_code, legal_kind, city_code)
    VALUES (btrim(p_name), regexp_replace(p_name, '\s', '', 'g'), nid, nullif(btrim(p_mobile), ''), nullif(btrim(p_economic_code), ''),
            coalesce(p_legal_kind, 'person'), p_city_code) RETURNING id INTO pid;
    INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'create', 'party', pid::text,
      jsonb_build_object('name', p_name, 'national_id', nid));
  ELSE
    SELECT * INTO old FROM core.party WHERE id = pid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'party % not found', pid; END IF;
    IF old.merged_into_id IS NOT NULL THEN RAISE EXCEPTION 'party % was merged into %', pid, old.merged_into_id; END IF;
    -- identity (D-18): a verified national id is not replaced here — only set when missing
    IF old.national_id IS NOT NULL AND nid IS DISTINCT FROM old.national_id THEN
      RAISE EXCEPTION 'کد ملی تأییدشده این پرونده تغییر نمی‌کند (D-18)؛ برای اصلاح، پرونده صحیح را بسازید و ادغام را بررسی کنید'; END IF;
    UPDATE core.party SET name = btrim(p_name), name_key = regexp_replace(p_name, '\s', '', 'g'), national_id = coalesce(old.national_id, nid),
           mobile = nullif(btrim(p_mobile), ''), economic_code = nullif(btrim(p_economic_code), ''), legal_kind = coalesce(p_legal_kind, old.legal_kind),
           city_code = coalesce(p_city_code, old.city_code) WHERE id = pid;
    INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after) VALUES (p_user, 'update', 'party', pid::text,
      jsonb_build_object('name', old.name, 'national_id', old.national_id, 'mobile', old.mobile, 'economic_code', old.economic_code),
      jsonb_build_object('name', p_name, 'national_id', coalesce(old.national_id, nid), 'mobile', p_mobile, 'economic_code', p_economic_code));
  END IF;
  RETURN pid;
END $$;

-- people with their balance (all posted, non-closing lines; a balance > 0 is owed to Almas)
CREATE FUNCTION core.party_list(p_query text DEFAULT NULL, p_limit int DEFAULT 50)
RETURNS TABLE (party_id int, name text, national_id text, mobile text, balance numeric, last_activity date) LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT * FROM core.party WHERE merged_into_id IS NULL
               AND (p_query IS NULL OR btrim(p_query) = '' OR name ILIKE '%' || p_query || '%' OR national_id = p_query OR mobile = p_query)
             ORDER BY name LIMIT least(coalesce(p_limit, 50), 500))
  SELECT p.id, p.name, p.national_id, p.mobile, coalesce(sum(l.debit - l.credit), 0), max(e.effective_date)
  FROM p LEFT JOIN core.journal_line l ON l.party_id = p.id
  LEFT JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft' AND e.kind <> 'closing'
  WHERE l.entry_id IS NULL OR e.id IS NOT NULL
  GROUP BY p.id, p.name, p.national_id, p.mobile ORDER BY p.name $$;

-- one person, everything about it: identity, roles, balance per account, cheques, Beta contracts, recent vouchers
CREATE FUNCTION core.party_profile(p_party int) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'party', (SELECT to_jsonb(p) - 'name_key' FROM core.party p WHERE id = p_party),
    'roles', (SELECT to_jsonb(r) FROM core.party_roles r WHERE party_id = p_party),
    'accounts', (SELECT coalesce(jsonb_agg(jsonb_build_object('account_code', a.code, 'account_name', a.name, 'balance', s.bal) ORDER BY a.code), '[]')
                 FROM (SELECT l.account_id, sum(l.debit - l.credit) bal FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id
                       WHERE l.party_id = p_party AND e.status <> 'draft' AND e.kind <> 'closing' GROUP BY 1) s JOIN core.account a ON a.id = s.account_id),
    'cheques', (SELECT coalesce(jsonb_agg(jsonb_build_object('cheque_id', c.id, 'direction', c.direction, 'number', c.number, 'amount', c.amount,
                                                             'due_date', c.due_date, 'state', s.state) ORDER BY c.due_date DESC), '[]')
                FROM core.cheque c JOIN core.cheque_status s ON s.cheque_id = c.id WHERE c.party_id = p_party AND s.kind = 'tracked'
                  AND s.state NOT IN ('collected', 'paid_by_bank', 'cashed', 'settled_otherwise')),
    'beta_contracts', (SELECT coalesce(jsonb_agg(jsonb_build_object('contract_id', contract_id, 'total', total_amount, 'outstanding', outstanding_amount,
                                                                    'overdue', overdue_count)), '[]') FROM core.contract_status WHERE party_id = p_party),
    'recent', (SELECT coalesce(jsonb_agg(x ORDER BY (x->>'date') DESC), '[]') FROM (
                 SELECT jsonb_build_object('entry_id', e.id, 'number', e.number, 'date', e.effective_date, 'description', coalesce(l.description, e.description),
                                           'debit', l.debit, 'credit', l.credit) x
                 FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft'
                 WHERE l.party_id = p_party ORDER BY e.effective_date DESC, e.id DESC LIMIT 20) z)) $$;

-- ============ Chart of accounts ============
CREATE FUNCTION core.account_tree(p_as_of date DEFAULT NULL)
RETURNS TABLE (account_id int, code text, name text, level smallint, parent_code text, is_leaf boolean, nature text, requires_party boolean,
               active boolean, balance numeric) LANGUAGE sql STABLE AS $$
  WITH b AS (SELECT x.ancestor_id, sum(l.debit - l.credit) bal FROM core.journal_line l
             JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft' AND e.kind <> 'closing'
               AND (p_as_of IS NULL OR e.effective_date <= p_as_of)
             JOIN core.account_ancestor x ON x.account_id = l.account_id GROUP BY 1)
  SELECT a.id, a.code, a.name, a.level, p.code, a.is_leaf, a.nature, a.requires_party, a.active, coalesce(b.bal, 0)
  FROM core.account a LEFT JOIN core.account p ON p.id = a.parent_id LEFT JOIN b ON b.ancestor_id = a.id ORDER BY a.code $$;

CREATE FUNCTION core.account_create(p_parent_code text, p_code text, p_name text, p_nature text, p_requires_party boolean, p_user text,
  p_statement text DEFAULT NULL) RETURNS int LANGUAGE plpgsql AS $$
DECLARE par core.account; aid int;
BEGIN
  PERFORM core.require_permission(p_user, 'account.manage');
  SELECT * INTO par FROM core.account WHERE code = p_parent_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'حساب مادر % وجود ندارد', p_parent_code; END IF;
  IF par.level >= 4 THEN RAISE EXCEPTION 'حساب سطح ۴ زیرحساب نمی‌پذیرد'; END IF;
  IF par.is_leaf THEN
    IF EXISTS (SELECT 1 FROM core.journal_line WHERE account_id = par.id) THEN
      RAISE EXCEPTION 'حساب % گردش دارد و نمی‌تواند حساب مادر شود؛ حساب جدید را کنار آن بسازید', par.code; END IF;
    UPDATE core.account SET is_leaf = false WHERE id = par.id;
  END IF;
  IF p_code NOT LIKE par.code || '%' THEN RAISE EXCEPTION 'کد حساب باید با کد حساب مادر (%) شروع شود', par.code; END IF;
  INSERT INTO core.account (code, name, parent_id, level, is_leaf, nature, statement, requires_party)
  VALUES (p_code, btrim(p_name), par.id, par.level + 1, true, coalesce(p_nature, par.nature), coalesce(p_statement, par.statement), coalesce(p_requires_party, par.requires_party))
  RETURNING id INTO aid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'create', 'account', p_code, jsonb_build_object('name', p_name, 'parent', p_parent_code));
  RETURN aid;
END $$;

-- ============ Manual vouchers ============
-- p_lines: [{account_code | account_id, party_id?, debit | credit, description?}]  One call = one balanced, posted voucher, or nothing.
-- p_idempotency_key: the same key returns the same voucher (a double click or a retried request never posts twice).
CREATE FUNCTION core.journal_post_manual(p_date date, p_description text, p_lines jsonb, p_user text, p_idempotency_key text DEFAULT NULL,
  p_kind text DEFAULT 'normal') RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE eid bigint; per core.period; ref text := coalesce(nullif(btrim(p_idempotency_key), ''), 'manual:' || gen_random_uuid());
BEGIN
  PERFORM core.require_permission(p_user, 'journal.post');
  SELECT entry_id INTO eid FROM core.document_posting WHERE source = 'manual' AND source_ref = ref;
  IF FOUND THEN RETURN eid; END IF;
  IF p_kind NOT IN ('normal', 'adjustment') THEN RAISE EXCEPTION 'سند دستی عادی یا اصلاحی است'; END IF;
  IF jsonb_array_length(coalesce(p_lines, '[]')) < 2 THEN RAISE EXCEPTION 'سند دست‌کم دو ردیف لازم دارد'; END IF;
  SELECT * INTO per FROM core.period WHERE p_date BETWEEN starts_on AND ends_on;
  IF NOT FOUND THEN RAISE EXCEPTION 'برای تاریخ % دوره مالی تعریف نشده است', p_date; END IF;
  INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, kind, source, source_ref, description, created_by)
  VALUES (per.fiscal_year_id, per.id, p_date, p_kind, 'manual', ref, p_description, p_user) RETURNING id INTO eid;
  INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, credit, description)
  SELECT eid, n, coalesce((l->>'account_id')::int, (SELECT id FROM core.account WHERE code = l->>'account_code')),
         nullif(l->>'party_id', '')::int, coalesce(nullif(l->>'debit', '')::numeric, 0), coalesce(nullif(l->>'credit', '')::numeric, 0), nullif(l->>'description', '')
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(l, n);
  IF EXISTS (SELECT 1 FROM core.journal_line WHERE entry_id = eid AND account_id IS NULL) THEN RAISE EXCEPTION 'حساب یکی از ردیف‌ها پیدا نشد'; END IF;
  UPDATE core.journal_entry SET status = 'posted', posted_by = p_user WHERE id = eid;          -- balance, period, leaf, party: checked here
  INSERT INTO core.document_posting (source, source_ref, entry_id, posted_by) VALUES ('manual', ref, eid, p_user);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'post', 'journal_entry', eid::text,
    jsonb_build_object('date', p_date, 'lines', jsonb_array_length(p_lines), 'total', (SELECT sum(debit) FROM core.journal_line WHERE entry_id = eid)));
  RETURN eid;
END $$;

-- reversal is the only correction of a posted voucher. A voucher that belongs to a document is corrected through that document
-- (a return for an invoice), and a voucher imported from Holoo through the next Holoo backup — never by hand here.
CREATE FUNCTION core.journal_reverse(p_entry bigint, p_date date, p_reason text, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE e core.journal_entry; nid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'journal.reverse'); PERFORM core.require_reason(p_reason);
  SELECT * INTO e FROM core.journal_entry WHERE id = p_entry;
  IF NOT FOUND THEN RAISE EXCEPTION 'سند % وجود ندارد', p_entry; END IF;
  IF e.source = 'holoo' THEN RAISE EXCEPTION 'سند منتقل‌شده از هلو با Backup بعدی هلو اصلاح می‌شود، نه دستی'; END IF;
  IF e.source IN ('sales_invoice', 'purchase_invoice', 'return') THEN
    RAISE EXCEPTION 'سند فاکتور با «برگشت» اصلاح می‌شود، نه با ابطال سند'; END IF;
  IF e.source = 'cheque' THEN RAISE EXCEPTION 'سند چک با ابطال رویداد همان چک اصلاح می‌شود'; END IF;
  IF e.kind IN ('opening', 'closing', 'reversal') THEN RAISE EXCEPTION 'سند % (%) ابطال‌پذیر نیست', e.id, e.kind; END IF;
  nid := core.reverse_entry(p_entry, p_date, p_reason, p_user);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason) VALUES (p_user, 'reverse', 'journal_entry', p_entry::text,
    jsonb_build_object('reversal_entry_id', nid), p_reason);
  RETURN nid;
END $$;

CREATE FUNCTION core.journal_list(p_from date, p_to date, p_query text DEFAULT NULL, p_source text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS TABLE (entry_id bigint, number bigint, effective_date date, description text, source text, kind text, total numeric, reversed boolean,
               created_by text) LANGUAGE sql STABLE AS $$
  SELECT e.id, e.number, e.effective_date, e.description, e.source, e.kind, (SELECT sum(debit) FROM core.journal_line WHERE entry_id = e.id),
         EXISTS (SELECT 1 FROM core.journal_entry r WHERE r.reverses_id = e.id AND r.status <> 'draft'), e.created_by
  FROM core.journal_entry e
  WHERE e.status <> 'draft' AND e.effective_date BETWEEN p_from AND p_to AND (p_source IS NULL OR e.source = p_source)
    AND (p_query IS NULL OR btrim(p_query) = '' OR e.number::text = btrim(p_query) OR e.description ILIKE '%' || p_query || '%'
         OR EXISTS (SELECT 1 FROM core.journal_line l WHERE l.entry_id = e.id AND l.description ILIKE '%' || p_query || '%'))
  ORDER BY e.effective_date DESC, e.number DESC NULLS LAST, e.id DESC LIMIT least(coalesce(p_limit, 200), 1000) $$;

-- ============ Lineage: where a voucher comes from, and everything around it ============
-- the backup (SHA-256) behind a Reader run; the core works without the Holoo mirror, so it is looked up only if present
CREATE FUNCTION core.holoo_run_sha256(p_run text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE s text;
BEGIN
  IF p_run IS NULL OR to_regclass('holoo_mirror.import_run') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT sha256 FROM holoo_mirror.import_run WHERE run_id = $1' INTO s USING p_run;
  RETURN s;
END $$;

CREATE FUNCTION core.entry_detail(p_entry bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'entry', to_jsonb(e) || jsonb_build_object('fiscal_year', (SELECT code FROM core.fiscal_year WHERE id = e.fiscal_year_id),
                                               'period', (SELECT code FROM core.period WHERE id = e.period_id)),
    'lines', (SELECT jsonb_agg(jsonb_build_object('line_no', l.line_no, 'account_code', a.code, 'account_name', a.name, 'party_id', l.party_id,
                                                  'party_name', p.name, 'debit', l.debit, 'credit', l.credit, 'description', l.description) ORDER BY l.line_no)
              FROM core.journal_line l JOIN core.account a ON a.id = l.account_id LEFT JOIN core.party p ON p.id = l.party_id WHERE l.entry_id = e.id),
    'origin', CASE
      WHEN e.source = 'holoo' THEN (SELECT jsonb_build_object('kind', 'holoo_voucher', 'source_db', m.source_db, 'holoo_voucher', m.sanad_code,
                                                             'status', m.status, 'first_seen_run', m.first_seen_run, 'last_seen_run', m.last_seen_run,
                                                             'backup_sha256', core.holoo_run_sha256(m.first_seen_run))
                                    FROM core.legacy_entry_map m WHERE m.entry_id = e.id OR m.reversal_entry_id = e.id LIMIT 1)
      ELSE (SELECT jsonb_build_object('kind', d.source, 'ref', d.source_ref, 'posted_by', d.posted_by, 'posted_at', d.posted_at)
            FROM core.document_posting d WHERE d.entry_id = e.id LIMIT 1) END,
    'reverses', e.reverses_id,
    'reversed_by', (SELECT id FROM core.journal_entry r WHERE r.reverses_id = e.id AND r.status <> 'draft' LIMIT 1),
    'audit', (SELECT coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'actor', a.actor, 'action', a.action, 'reason', a.reason) ORDER BY a.id), '[]')
              FROM core.audit_event a WHERE a.object_type = 'journal_entry' AND a.object_id = e.id::text),
    'settlements', (SELECT count(*) FROM core.settlement s WHERE s.debit_entry_id = e.id OR s.credit_entry_id = e.id))
  FROM core.journal_entry e WHERE e.id = p_entry $$;

-- ============ Cheques ============
CREATE FUNCTION core.cheque_list(p_direction text DEFAULT NULL, p_state text DEFAULT NULL, p_query text DEFAULT NULL, p_limit int DEFAULT 300)
RETURNS TABLE (cheque_id bigint, direction text, number text, bank_code text, amount numeric, due_date date, party_id int, party_name text,
               state text, since date, location_code text, location_name text, overdue boolean) LANGUAGE sql STABLE AS $$
  SELECT c.id, c.direction, c.number, c.bank_code, c.amount, c.due_date, c.party_id, p.name, s.state, s.since, a.code, a.name,
         c.due_date < current_date AND s.state IN ('received', 'returned_from_bank', 'returned_by_endorsee', 'opening_position', 'moved_between_cashboxes', 'issued')
  FROM core.cheque c JOIN core.cheque_status s ON s.cheque_id = c.id LEFT JOIN core.party p ON p.id = c.party_id LEFT JOIN core.account a ON a.id = s.account_id
  WHERE (p_direction IS NULL OR c.direction = p_direction) AND (p_state IS NULL OR s.state = p_state)
    AND (p_query IS NULL OR btrim(p_query) = '' OR c.number = btrim(p_query) OR p.name ILIKE '%' || p_query || '%')
  ORDER BY c.due_date DESC NULLS LAST, c.id DESC LIMIT least(coalesce(p_limit, 300), 2000) $$;

CREATE FUNCTION core._cheque_event(p_cheque bigint, p_type text, p_date date, p_from_acc int, p_from_party int, p_to_acc int, p_to_party int,
  p_user text, p_note text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE ev bigint;
BEGIN
  INSERT INTO core.cheque_event (cheque_id, state, effective_date, event_type, from_account_id, from_party_id, to_account_id, to_party_id, note)
  VALUES (p_cheque, p_type, p_date, p_type, p_from_acc, p_from_party, p_to_acc, p_to_party, p_note) RETURNING id INTO ev;
  PERFORM core.post_cheque_events(ARRAY[ev], p_date, 'event:' || ev, p_user);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, p_type, 'cheque', p_cheque::text, jsonb_build_object('event_id', ev));
  RETURN ev;
END $$;

-- receive a customer's cheque into a cash box
CREATE FUNCTION core.cheque_receive(p_party int, p_cashbox int, p_number text, p_bank_code text, p_amount numeric, p_due date, p_date date, p_user text,
  p_sayad text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE cid bigint; box core.cashbox; acc int;
BEGIN
  PERFORM core.require_permission(p_user, 'cheque.manage');
  SELECT * INTO box FROM core.cashbox WHERE id = p_cashbox;
  IF box.cheque_account_id IS NULL THEN RAISE EXCEPTION 'صندوق % حساب اسناد دریافتنی ندارد', p_cashbox; END IF;
  SELECT coalesce(default_receivable_account_id, core.setting_account('account_customers')) INTO acc FROM core.party WHERE id = p_party;
  INSERT INTO core.cheque (direction, sayad_no, bank_code, number, amount, issue_date, due_date, party_id)
  VALUES ('in', nullif(btrim(p_sayad), ''), p_bank_code, p_number, p_amount, p_date, p_due, p_party) RETURNING id INTO cid;
  PERFORM core._cheque_event(cid, 'received', p_date, acc, p_party, box.cheque_account_id, NULL, p_user, NULL);
  RETURN cid;
END $$;

-- issue our cheque to a supplier
CREATE FUNCTION core.cheque_issue(p_party int, p_bank_account int, p_number text, p_amount numeric, p_due date, p_date date, p_user text,
  p_sayad text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE cid bigint; b core.company_bank_account; acc int;
BEGIN
  PERFORM core.require_permission(p_user, 'cheque.manage');
  SELECT * INTO b FROM core.company_bank_account WHERE id = p_bank_account;
  IF b.payable_cheque_account_id IS NULL THEN RAISE EXCEPTION 'حساب بانکی % حساب اسناد پرداختنی ندارد', p_bank_account; END IF;
  SELECT coalesce(default_payable_account_id, core.setting_account('account_suppliers')) INTO acc FROM core.party WHERE id = p_party;
  IF acc IS NULL THEN RAISE EXCEPTION 'حساب پرداختنی این شخص مشخص نیست (تنظیم account_suppliers)'; END IF;
  INSERT INTO core.cheque (direction, sayad_no, bank_code, number, amount, issue_date, due_date, party_id, bank_account_id)
  VALUES ('out', nullif(btrim(p_sayad), ''), b.bank_code, p_number, p_amount, p_date, p_due, p_party, p_bank_account) RETURNING id INTO cid;
  PERFORM core._cheque_event(cid, 'issued', p_date, b.payable_cheque_account_id, NULL, acc, p_party, p_user, NULL);
  RETURN cid;
END $$;

-- the next move of a cheque; the FROM side is always where the cheque is now (never typed by hand)
-- received cheques: deposit (→ bank collection), collect (collection → bank), bounce (collection → cash box), return (→ payer),
--                   endorse (→ another party's payable), cash (→ cash)        issued cheques: paid (notes payable → bank)
CREATE FUNCTION core.cheque_move(p_cheque bigint, p_action text, p_date date, p_user text, p_bank_account int DEFAULT NULL, p_party int DEFAULT NULL,
  p_cashbox int DEFAULT NULL, p_note text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c core.cheque; loc core.cheque_location; b core.company_bank_account; box core.cashbox; to_acc int; to_party int; typ text; last_box int;
BEGIN
  PERFORM core.require_permission(p_user, 'cheque.manage');
  SELECT * INTO c FROM core.cheque WHERE id = p_cheque FOR UPDATE;
  SELECT * INTO loc FROM core.cheque_location WHERE cheque_id = p_cheque;
  IF loc.cheque_id IS NULL THEN RAISE EXCEPTION 'چک % سابقه‌ای ندارد', p_cheque; END IF;
  IF p_bank_account IS NOT NULL THEN SELECT * INTO b FROM core.company_bank_account WHERE id = p_bank_account; END IF;
  IF c.direction = 'in' THEN
    CASE p_action
      WHEN 'deposit' THEN typ := 'deposited_for_collection'; to_acc := b.collection_account_id;
      WHEN 'collect' THEN typ := 'collected'; to_acc := (SELECT gl_account_id FROM core.company_bank_account WHERE collection_account_id = loc.account_id LIMIT 1);
      WHEN 'bounce' THEN typ := 'returned_from_bank';
        SELECT cheque_account_id INTO to_acc FROM core.cashbox WHERE id = coalesce(p_cashbox, (SELECT id FROM core.cashbox WHERE is_main LIMIT 1));
      WHEN 'return' THEN typ := 'returned_to_payer';
        SELECT coalesce(default_receivable_account_id, core.setting_account('account_customers')) INTO to_acc FROM core.party WHERE id = c.party_id; to_party := c.party_id;
      WHEN 'endorse' THEN typ := 'endorsed_to_party'; to_party := p_party;
        SELECT coalesce(default_payable_account_id, core.setting_account('account_suppliers'), core.setting_account('account_customers')) INTO to_acc FROM core.party WHERE id = p_party;
      WHEN 'cash' THEN typ := 'cashed';
        SELECT cash_account_id INTO to_acc FROM core.cashbox WHERE id = coalesce(p_cashbox, (SELECT id FROM core.cashbox WHERE is_main LIMIT 1));
      ELSE RAISE EXCEPTION 'عملیات % برای چک دریافتی تعریف نشده است', p_action;
    END CASE;
    IF loc.last_event IN ('collected', 'cashed', 'returned_to_payer', 'endorsed_to_party') AND p_action <> 'bounce' THEN
      RAISE EXCEPTION 'چک % بسته شده است (%)', p_cheque, loc.last_event; END IF;
    IF to_acc IS NULL THEN RAISE EXCEPTION 'حساب مقصد برای «%» مشخص نیست (بانک، صندوق یا شخص را انتخاب کنید)', p_action; END IF;
    RETURN core._cheque_event(p_cheque, typ, p_date, loc.account_id, loc.party_id, to_acc, to_party, p_user, p_note);
  ELSE
    IF p_action <> 'paid' THEN RAISE EXCEPTION 'برای چک پرداختی فقط «پرداخت‌شده» تعریف است'; END IF;
    IF loc.last_event = 'paid_by_bank' THEN RAISE EXCEPTION 'چک % قبلاً پرداخت شده است', p_cheque; END IF;
    SELECT * INTO b FROM core.company_bank_account WHERE id = c.bank_account_id;
    RETURN core._cheque_event(p_cheque, 'paid_by_bank', p_date, b.gl_account_id, NULL, b.payable_cheque_account_id, NULL, p_user, p_note);
  END IF;
END $$;

-- undo the last move of a cheque: a reversing event and the reversal of its voucher (never a deletion)
CREATE FUNCTION core.cheque_undo_last(p_cheque bigint, p_date date, p_reason text, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE ev core.cheque_event; rid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'cheque.manage'); PERFORM core.require_reason(p_reason);
  SELECT e.* INTO ev FROM core.cheque_event e WHERE e.cheque_id = p_cheque AND e.event_type IS NOT NULL AND e.reverses_event_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM core.cheque_event r WHERE r.reverses_event_id = e.id)
   ORDER BY e.effective_date DESC, e.id DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'چک % رویداد برگشت‌پذیری ندارد', p_cheque; END IF;
  IF ev.legacy_event_id IS NOT NULL THEN RAISE EXCEPTION 'رویداد منتقل‌شده از هلو با Backup بعدی اصلاح می‌شود'; END IF;
  IF (SELECT count(*) FROM core.cheque_event WHERE journal_entry_id = ev.journal_entry_id) > 1 THEN
    RAISE EXCEPTION 'سند این رویداد چند چک دارد؛ اصلاح دستی لازم است'; END IF;
  INSERT INTO core.cheque_event (cheque_id, state, effective_date, reverses_event_id, note) VALUES (p_cheque, 'reversal', p_date, ev.id, p_reason) RETURNING id INTO rid;
  PERFORM core.reverse_entry(ev.journal_entry_id, p_date, p_reason, p_user);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason) VALUES (p_user, 'undo', 'cheque', p_cheque::text,
    jsonb_build_object('reversed_event', ev.id), p_reason);
  RETURN rid;
END $$;

CREATE FUNCTION core.cashbox_list() RETURNS TABLE (cashbox_id int, code text, name text, is_main boolean) LANGUAGE sql STABLE AS $$
  SELECT id, code, name, is_main FROM core.cashbox ORDER BY is_main DESC, name $$;

-- ============ Goods and stock ============
CREATE FUNCTION core.item_save(p_item int, p_code text, p_name text, p_unit text, p_is_service boolean, p_user text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE iid int := p_item; mk text := lower(regexp_replace(translate(btrim(p_name), 'يك', 'یک'), '\s+', '', 'g'));
BEGIN
  PERFORM core.require_permission(p_user, 'item.manage');
  IF btrim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'نام کالا لازم است'; END IF;
  IF EXISTS (SELECT 1 FROM core.item WHERE model_key = mk AND id IS DISTINCT FROM iid) THEN
    RAISE EXCEPTION 'کالایی با همین نام (مدل) وجود دارد (D-13)'; END IF;
  IF iid IS NULL THEN
    INSERT INTO core.item (code, name, unit, is_service, model_key)
    VALUES (coalesce(nullif(btrim(p_code), ''), 'N' || nextval('core.item_id_seq')), btrim(p_name), p_unit, coalesce(p_is_service, false), mk) RETURNING id INTO iid;
  ELSE
    IF coalesce(p_is_service, false) AND EXISTS (SELECT 1 FROM core.stock_movement WHERE item_id = iid) THEN
      RAISE EXCEPTION 'کالای دارای گردش انبار خدمت نمی‌شود'; END IF;
    UPDATE core.item SET name = btrim(p_name), unit = p_unit, is_service = coalesce(p_is_service, is_service), model_key = mk WHERE id = iid;
  END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, CASE WHEN p_item IS NULL THEN 'create' ELSE 'update' END, 'item', iid::text,
    jsonb_build_object('name', p_name, 'unit', p_unit, 'is_service', p_is_service));
  RETURN iid;
END $$;

-- stock of goods (fast: quantities only; value and average cost come from the kardex of one item)
CREATE FUNCTION core.stock_list(p_query text DEFAULT NULL, p_warehouse int DEFAULT NULL, p_limit int DEFAULT 300)
RETURNS TABLE (item_id int, code text, name text, warehouse_id int, warehouse_name text, qty numeric, last_movement date) LANGUAGE sql STABLE AS $$
  SELECT i.id, i.code, i.name, w.id, w.name, sum(m.direction * m.qty), max(m.effective_date)
  FROM core.stock_movement_live m JOIN core.item i ON i.id = m.item_id JOIN core.warehouse w ON w.id = m.warehouse_id
  WHERE (p_query IS NULL OR btrim(p_query) = '' OR i.name ILIKE '%' || p_query || '%' OR i.code = p_query) AND (p_warehouse IS NULL OR w.id = p_warehouse)
  GROUP BY i.id, i.code, i.name, w.id, w.name HAVING sum(m.direction * m.qty) <> 0 ORDER BY i.name, w.name LIMIT least(coalesce(p_limit, 300), 3000) $$;

CREATE SEQUENCE core.transfer_seq START 1000000000;
CREATE FUNCTION core.stock_transfer(p_item int, p_from int, p_to int, p_qty numeric, p_date date, p_user text, p_note text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE t bigint := nextval('core.transfer_seq');
BEGIN
  PERFORM core.require_permission(p_user, 'inventory.manage');
  IF p_from = p_to THEN RAISE EXCEPTION 'انبار مبدأ و مقصد یکی است'; END IF;
  IF (SELECT is_service FROM core.item WHERE id = p_item) THEN RAISE EXCEPTION 'خدمت موجودی ندارد'; END IF;
  INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, effective_time, qty, transfer_id, source, source_ref, created_by)
  VALUES (p_item, p_from, 'transfer_out', p_date, localtime(0), p_qty, t, 'transfer', 'transfer:' || t || ':out', p_user),
         (p_item, p_to, 'transfer_in', p_date, localtime(0), p_qty, t, 'transfer', 'transfer:' || t || ':in', p_user);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'transfer', 'stock', t::text,
    jsonb_build_object('item', p_item, 'from', p_from, 'to', p_to, 'qty', p_qty, 'note', p_note));
  RETURN t;
END $$;

CREATE FUNCTION core.stock_transfer_reverse(p_transfer bigint, p_reason text, p_user text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m core.stock_movement;
BEGIN
  PERFORM core.require_permission(p_user, 'inventory.manage'); PERFORM core.require_reason(p_reason);
  IF NOT EXISTS (SELECT 1 FROM core.stock_movement_live WHERE transfer_id = p_transfer AND source = 'transfer') THEN
    RAISE EXCEPTION 'انتقال % وجود ندارد یا قبلاً برگشت خورده است', p_transfer; END IF;
  FOR m IN SELECT * FROM core.stock_movement WHERE transfer_id = p_transfer AND reverses_id IS NULL LOOP
    INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, effective_time, qty, transfer_id, source, reverses_id, created_by)
    VALUES (m.item_id, m.warehouse_id, m.kind, m.effective_date, m.effective_time, m.qty, m.transfer_id, 'transfer_reversal', m.id, p_user);
  END LOOP;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'reverse_transfer', 'stock', p_transfer::text, p_reason);
END $$;

-- ============ Periods, users, permissions, settings ============
CREATE FUNCTION core.periods_list() RETURNS TABLE (fiscal_year text, year_status text, period_id int, period text, starts_on date, ends_on date, status text,
  entries bigint) LANGUAGE sql STABLE AS $$
  SELECT y.code, y.status, p.id, p.code, p.starts_on, p.ends_on, p.status,
         (SELECT count(*) FROM core.journal_entry e WHERE e.period_id = p.id AND e.status <> 'draft')
  FROM core.period p JOIN core.fiscal_year y ON y.id = p.fiscal_year_id ORDER BY p.starts_on DESC $$;

CREATE FUNCTION core.users_list() RETURNS TABLE (username text, display_name text, active boolean, kind text, agent_code text, permissions text[],
  mfa_enabled boolean, has_password boolean, last_login timestamptz) LANGUAGE sql STABLE AS $$
  SELECT u.username, u.display_name, u.active, CASE WHEN u.is_ai_agent THEN 'ai_agent' WHEN u.is_service THEN 'service' ELSE 'person' END,
         (SELECT g.code FROM core.sales_agent_user au JOIN core.sales_agent g ON g.id = au.agent_id WHERE au.username = u.username),
         ARRAY(SELECT permission FROM core.user_permission WHERE username = u.username ORDER BY 1),
         c.mfa_enabled_at IS NOT NULL, c.username IS NOT NULL,
         (SELECT max(at) FROM core.auth_event WHERE username = u.username AND event = 'login_ok')
  FROM core.app_user u LEFT JOIN core.app_credential c ON c.username = u.username ORDER BY u.username $$;

CREATE FUNCTION core.user_create(p_username text, p_display_name text, p_kind text, p_by text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_by, 'security.admin');
  IF p_username !~ '^[a-z][a-z0-9_.-]{2,30}$' THEN RAISE EXCEPTION 'نام کاربری: حروف کوچک لاتین، ۳ تا ۳۱ نویسه'; END IF;
  INSERT INTO core.app_user (username, display_name, is_service, is_ai_agent) VALUES (p_username, p_display_name, p_kind = 'service', p_kind = 'ai_agent');
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_by, 'create', 'app_user', p_username, jsonb_build_object('kind', p_kind));
END $$;

CREATE FUNCTION core.user_set_active(p_username text, p_active boolean, p_by text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_by, 'security.admin'); PERFORM core.require_reason(p_reason);
  IF p_username = p_by AND NOT p_active THEN RAISE EXCEPTION 'کاربر خودش را غیرفعال نمی‌کند'; END IF;
  UPDATE core.app_user SET active = p_active WHERE username = p_username;
  IF NOT p_active THEN UPDATE core.app_session SET revoked_at = now() WHERE username = p_username AND revoked_at IS NULL; END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason) VALUES (p_by, 'set_active', 'app_user', p_username,
    jsonb_build_object('active', p_active), p_reason);
END $$;

-- grant / revoke with the TARGET user named explicitly (the API injects the acting user into p_user / p_by; the 002 functions
-- take the target as p_user, so they are never catalogued directly)
CREATE FUNCTION core.permission_grant(p_target text, p_permission text, p_by text, p_reason text) RETURNS void LANGUAGE sql AS $$
  SELECT core.grant_permission(p_target, p_permission, p_by, p_reason) $$;
CREATE FUNCTION core.permission_revoke(p_target text, p_permission text, p_by text, p_reason text) RETURNS void LANGUAGE sql AS $$
  SELECT core.revoke_permission(p_target, p_permission, p_by, p_reason) $$;

CREATE FUNCTION core.permissions_list() RETURNS TABLE (code text, description text, people_only boolean, holders bigint) LANGUAGE sql STABLE AS $$
  SELECT p.code, p.description,
         p.code IN ('period.close', 'period.reopen', 'security.admin', 'settings.change', 'beta.order_change', 'agent.settle', 'agent.deal_approve'),
         (SELECT count(*) FROM core.user_permission u WHERE u.permission = p.code) FROM core.permission p ORDER BY p.code $$;

CREATE FUNCTION core.settings_list() RETURNS TABLE (key text, value text, allowed text[], pattern text, decision text, updated_by text, updated_at timestamptz)
LANGUAGE sql STABLE AS $$ SELECT key, value, allowed, pattern, decision, updated_by, updated_at FROM core.setting ORDER BY key $$;

-- ============ Cash and bank balances; dashboard ============
CREATE FUNCTION core.money_balances(p_as_of date DEFAULT current_date)
RETURNS TABLE (account_id int, code text, name text, kind text, balance numeric) LANGUAGE sql STABLE AS $$
  SELECT m.account_id, m.code, m.name, m.kind, coalesce((SELECT sum(l.debit - l.credit) FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id
                                                          WHERE l.account_id = m.account_id AND e.status <> 'draft' AND e.kind <> 'closing' AND e.effective_date <= p_as_of), 0)
  FROM core.list_money_accounts() m $$;

CREATE FUNCTION core.dashboard(p_as_of date DEFAULT current_date)
RETURNS TABLE (metric text, label text, value numeric, detail text, tab text) LANGUAGE sql STABLE AS $$
  WITH fy AS (SELECT * FROM core.fiscal_year WHERE p_as_of BETWEEN starts_on AND ends_on),
  mon AS (SELECT starts_on, ends_on FROM core.period WHERE p_as_of BETWEEN starts_on AND ends_on),
  lines AS (SELECT l.*, e.effective_date FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id
            WHERE e.status <> 'draft' AND e.kind <> 'closing' AND e.effective_date <= p_as_of)
  SELECT 'cash', 'موجودی صندوق‌ها', (SELECT coalesce(sum(balance), 0) FROM core.money_balances(p_as_of) WHERE kind = 'cash'), NULL, 'bank'
  UNION ALL SELECT 'bank', 'موجودی بانک‌ها', (SELECT coalesce(sum(balance), 0) FROM core.money_balances(p_as_of) WHERE kind = 'bank'), NULL, 'bank'
  UNION ALL SELECT 'receivable', 'طلب از اشخاص', (SELECT coalesce(sum(debit - credit), 0) FROM lines l JOIN core.account a ON a.id = l.account_id AND a.requires_party AND a.nature = 'debit'), NULL, 'parties'
  UNION ALL SELECT 'payable', 'بدهی به اشخاص', (SELECT coalesce(sum(credit - debit), 0) FROM lines l JOIN core.account a ON a.id = l.account_id AND a.requires_party AND a.nature = 'credit'), NULL, 'parties'
  UNION ALL SELECT 'sales_month', 'فروش این ماه', (SELECT coalesce(sum(l.credit - l.debit), 0) FROM lines l JOIN core.account_ancestor x ON x.account_id = l.account_id
            AND x.ancestor_id = core.setting_account('account_sales') WHERE l.effective_date BETWEEN (SELECT starts_on FROM mon) AND p_as_of), NULL, 'mgmt'
  UNION ALL SELECT 'cheques_in_hand', 'چک‌های دریافتی نزد صندوق و بانک', (SELECT coalesce(sum(amount), 0) FROM core.cheque_status s
            WHERE s.direction = 'in' AND s.kind = 'tracked' AND s.state IN ('received', 'deposited_for_collection', 'returned_from_bank', 'opening_position', 'moved_between_cashboxes')),
            (SELECT count(*)::text || ' فقره' FROM core.cheque_status s WHERE s.direction = 'in' AND s.kind = 'tracked'
               AND s.state IN ('received', 'deposited_for_collection', 'returned_from_bank', 'opening_position', 'moved_between_cashboxes')), 'cheques'
  UNION ALL SELECT 'cheques_due_week', 'چک‌های پرداختی سررسید ۷ روز آینده', (SELECT coalesce(sum(amount), 0) FROM core.cheque_status s
            WHERE s.direction = 'out' AND s.kind = 'tracked' AND s.state IN ('issued', 'opening_position') AND s.due_date BETWEEN p_as_of AND p_as_of + 7), NULL, 'cheques'
  UNION ALL SELECT 'controls_high', 'کنترل‌های با شدت زیاد', (SELECT count(*) FROM core.control_inbox(p_as_of) WHERE severity = 'high' AND items > 0), NULL, 'inbox'
  UNION ALL SELECT 'pending_deals', 'معامله نماینده در انتظار تأیید', (SELECT count(*) FROM core.agent_deal WHERE status = 'declared'), NULL, 'agents'
  UNION ALL SELECT 'fiscal_year', 'سال مالی', (SELECT code::numeric FROM fy), (SELECT status FROM fy), 'periods' $$;

INSERT INTO core.operation_catalog (operation, kind, function_signature, purpose, permission, effect, undo, basis, ai_allowed, agent_allowed) VALUES
  ('dashboard', 'read', 'core.dashboard(date)', 'the day at a glance: cash, bank, receivables, payables, sales, cheques, controls', NULL, 'none', '—', 'UX', true, false),
  ('parties.list', 'read', 'core.party_list(text,integer)', 'people and companies with their balance', NULL, 'none', '—', 'D-03', true, false),
  ('parties.profile', 'read', 'core.party_profile(integer)', 'everything about one person: identity, roles, balances, cheques, Beta, recent vouchers', NULL, 'none', '—', 'D-03, E29', true, false),
  ('parties.save', 'write', 'core.party_save(integer,text,text,text,text,text,text,integer)', 'create or edit a person / company (a verified national id never changes here)',
   'party.manage', 'adds or updates the party; before/after audited', 'edit again (merge only with party.merge)', 'D-18', true, false),
  ('accounts.tree', 'read', 'core.account_tree(date)', 'the chart of accounts with balances at every level', NULL, 'none', '—', 'D-03', true, false),
  ('accounts.create', 'write', 'core.account_create(text,text,text,text,boolean,text,text)', 'add an account under a parent', 'account.manage',
   'adds a leaf account', 'deactivate (accounts with history are never deleted)', 'ACC', true, false),
  ('journal.post_manual', 'write', 'core.journal_post_manual(date,text,jsonb,text,text,text)', 'post a manual voucher (balanced, one call, idempotent by key)',
   'journal.post', 'adds one posted voucher', 'journal.reverse', 'W-03, W-04', true, false),
  ('journal.reverse', 'write', 'core.journal_reverse(bigint,date,text,text)', 'reverse a posted voucher (documents: through their return; Holoo: next backup)',
   'journal.reverse', 'adds the mirror voucher', '—', 'W-03', true, false),
  ('journal.list', 'read', 'core.journal_list(date,date,text,text,integer)', 'vouchers of a period, searchable', NULL, 'none', '—', 'ACC', true, false),
  ('journal.detail', 'read', 'core.entry_detail(bigint)', 'one voucher with lines, origin (document / Holoo voucher and backup), reversal links and audit',
   NULL, 'none', '—', 'lineage', true, false),
  ('cheques.list', 'read', 'core.cheque_list(text,text,text,integer)', 'cheques with where each one is now', NULL, 'none', '—', 'E18', true, false),
  ('cheques.receive', 'write', 'core.cheque_receive(integer,integer,text,text,numeric,date,date,text,text)', 'receive a customer''s cheque into a cash box',
   'cheque.manage', 'adds the cheque, its event and voucher', 'cheques.undo_last', 'E18', true, false),
  ('cheques.issue', 'write', 'core.cheque_issue(integer,integer,text,numeric,date,date,text,text)', 'issue our cheque to a supplier', 'cheque.manage',
   'adds the cheque, its event and voucher', 'cheques.undo_last', 'E18', true, false),
  ('cheques.move', 'write', 'core.cheque_move(bigint,text,date,text,integer,integer,integer,text)',
   'next move of a cheque: deposit, collect, bounce, return, endorse, cash, paid', 'cheque.manage', 'adds an event and its voucher', 'cheques.undo_last', 'E18', true, false),
  ('cheques.undo_last', 'write', 'core.cheque_undo_last(bigint,date,text,text)', 'undo the last move of a cheque (reversing event + reversal voucher)',
   'cheque.manage', 'adds the reversal', '—', 'E18, W-13', true, false),
  ('cashboxes.list', 'read', 'core.cashbox_list()', 'cash boxes', NULL, 'none', '—', 'E19', true, false),
  ('items.save', 'write', 'core.item_save(integer,text,text,text,boolean,text)', 'create or edit a good / service (one model per name, D-13)', 'item.manage',
   'adds or updates the item; audited', 'edit again', 'D-13', true, false),
  ('stock.list', 'read', 'core.stock_list(text,integer,integer)', 'stock of goods per warehouse', NULL, 'none', '—', 'E11', true, false),
  ('stock.transfer', 'write', 'core.stock_transfer(integer,integer,integer,numeric,date,text,text)', 'move stock between warehouses (never negative)',
   'inventory.manage', 'adds a transfer pair', 'stock.transfer_reverse', 'E11, W-11', true, false),
  ('stock.transfer_reverse', 'write', 'core.stock_transfer_reverse(bigint,text,text)', 'reverse a transfer', 'inventory.manage', 'adds reversing movements', '—', 'E11', true, false),
  ('periods.list', 'read', 'core.periods_list()', 'fiscal years and periods with status', NULL, 'none', '—', 'D-05', true, false),
  ('periods.change_status', 'write', 'core.change_period_status(integer,text,text,text)', 'open / close / reopen a period (people only; period.close or period.reopen checked inside)', NULL,
   'changes the status; audited', 'change back with period.reopen', 'D-05', false, false),
  ('users.list', 'read', 'core.users_list()', 'users with kind, permissions, second factor and last sign-in', 'security.admin', 'none', '—', 'W-14', true, false),
  ('users.create', 'write', 'core.user_create(text,text,text,text)', 'add a user (person / service / AI agent)', 'security.admin', 'adds the user', 'users.set_active', 'W-14', false, false),
  ('users.set_active', 'write', 'core.user_set_active(text,boolean,text,text)', 'activate / deactivate a user (ends its sessions)', 'security.admin',
   'changes the flag; audited', 'set again', 'W-14', false, false),
  ('permissions.list', 'read', 'core.permissions_list()', 'every permission, whether it is reserved for people, and how many hold it', NULL, 'none', '—', 'W-14', true, false),
  ('permissions.grant', 'write', 'core.permission_grant(text,text,text,text)', 'grant a permission (with a reason)', 'security.admin', 'adds the grant; audited',
   'permissions.revoke', 'W-14', false, false),
  ('permissions.revoke', 'write', 'core.permission_revoke(text,text,text,text)', 'revoke a permission (with a reason)', 'security.admin', 'removes the grant; audited',
   'permissions.grant', 'W-14', false, false),
  ('settings.list', 'read', 'core.settings_list()', 'every setting with its allowed values and the decision behind it', NULL, 'none', '—', 'D-xx', true, false),
  ('settings.change', 'write', 'core.change_setting(text,text,text,text)', 'change a setting (with a reason; people only)', 'settings.change', 'changes the value; audited',
   'change back', 'D-xx', false, false),
  ('money.balances', 'read', 'core.money_balances(date)', 'balance of every cash box and bank account', NULL, 'none', '—', 'E19', true, false);

-- the catalogued permission of an operation is enforced for EVERY operation, reads included (e.g. the user list), not only
-- inside write functions; agent users additionally reach agent-scoped operations only (021)
CREATE OR REPLACE FUNCTION core.require_operation(p_user text, p_operation text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE op core.operation_catalog;
BEGIN
  SELECT * INTO op FROM core.operation_catalog WHERE operation = p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown operation %', p_operation; END IF;
  IF core.agent_of(p_user) IS NOT NULL AND NOT op.agent_allowed THEN
    RAISE EXCEPTION 'permission denied: % is not available in the agent workspace', p_operation USING ERRCODE = 'insufficient_privilege'; END IF;
  IF core.agent_of(p_user) IS NULL AND EXISTS (SELECT 1 FROM core.sales_agent_user WHERE username = p_user) THEN
    RAISE EXCEPTION 'permission denied: agent user % is inactive', p_user USING ERRCODE = 'insufficient_privilege'; END IF;
  IF op.permission IS NOT NULL THEN PERFORM core.require_permission(p_user, op.permission); END IF;
  IF NOT op.ai_allowed AND coalesce((SELECT is_ai_agent FROM core.app_user WHERE username = p_user), false) THEN
    RAISE EXCEPTION 'permission denied: % is reserved for people; an AI agent may prepare, a person decides', p_operation USING ERRCODE = 'insufficient_privilege'; END IF;
END $$;
