-- Almas Shahr accounting — core v0.23: Customer / Sales agent / panel registrar kept apart; the legacy practice of recording
-- agents' Beta sales on the agent's own account is PRESERVED as history but never continued. Design: docs/BETA_API_FA.md §15.
-- Evidence: E29 (accountant's statement + what the 1404 backup can and cannot show). Proven by migration/tests/test_party_roles.py.
--
-- Three independent concepts, joined only by evidence:
--   customer   = core.party of the real buyer (national id) — owns the contract and the receivable
--   agent      = core.sales_agent — owns the SALE (attribution) and is owed the deal's base amount (D-22)
--   registrar  = who typed the sale into the bank panel (beta_contract_snapshot.registrar_national_id, E28) — linked to an
--                agent only by core.agent_panel_identity; never to a party, never to a customer
-- A person can be an agent AND, separately, a customer (a personal purchase): the two roles never share a record.

INSERT INTO core.permission VALUES
  ('legacy.classify', 'declare a legacy (Holoo) account as an agent-aggregate account and classify its lines to real buyers');

-- one sales agent per person record (the agent's own identity; its personal account stays its own)
CREATE UNIQUE INDEX sales_agent_party ON core.sales_agent (party_id) WHERE party_id IS NOT NULL;

-- ============ Posting invariant (holds before D-14 / D-26 decide the accounts) ============
-- Reserved document sources for Beta and agent postings. Whatever accounts are chosen later:
--   beta_contract / beta_receipt  → a party on any line must be the BUYER of that contract (or a direct payer of that receipt)
--   agent_entitlement / agent_settlement → a party on any line must be the AGENT's own party — never a buyer
-- so no posting can put a customer's Beta debt on an agent's personal account, or an agent's claim on a customer.
CREATE FUNCTION core.trg_beta_posting_parties() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed int[]; bad int;
BEGIN
  IF NEW.source = 'beta_contract' THEN
    allowed := ARRAY(SELECT party_id FROM core.installment_contract WHERE id = NEW.source_ref::bigint);
  ELSIF NEW.source = 'beta_receipt' THEN
    allowed := ARRAY(SELECT c.party_id FROM core.receipt_allocation a JOIN core.installment i ON i.id = a.installment_id
                     JOIN core.installment_contract c ON c.id = i.contract_id WHERE a.receipt_id = NEW.source_ref::bigint
                     UNION SELECT payer_party_id FROM core.receipt WHERE id = NEW.source_ref::bigint AND payer_party_id IS NOT NULL);
  ELSIF NEW.source = 'agent_entitlement' THEN
    allowed := ARRAY(SELECT g.party_id FROM core.agent_entitlement e JOIN core.sales_agent g ON g.id = e.agent_id WHERE e.id = NEW.source_ref::bigint);
  ELSIF NEW.source = 'agent_settlement' THEN
    allowed := ARRAY(SELECT g.party_id FROM core.agent_settlement s JOIN core.sales_agent g ON g.id = s.agent_id WHERE s.id = NEW.source_ref::bigint);
  ELSE RETURN NEW; END IF;
  SELECT count(*) INTO bad FROM core.journal_line WHERE entry_id = NEW.entry_id AND party_id IS NOT NULL AND NOT (party_id = ANY (coalesce(allowed, '{}')));
  IF bad > 0 THEN
    RAISE EXCEPTION '% % posting puts % line(s) on a party that is not its own (customer / agent separation)', NEW.source, NEW.source_ref, bad; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER beta_posting_parties AFTER INSERT ON core.document_posting DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.trg_beta_posting_parties();

-- ============ Roles of a person, side by side (never merged) ============
CREATE VIEW core.party_roles AS
SELECT p.id AS party_id, p.national_id,
       (SELECT count(*) FROM core.installment_contract c WHERE c.party_id = p.id AND c.status <> 'draft') AS contracts_as_customer,
       (SELECT count(*) FROM core.agent_deal d WHERE d.national_id = p.national_id AND d.status <> 'rejected') AS deals_as_buyer,
       (SELECT g.id FROM core.sales_agent g WHERE g.party_id = p.id) AS sales_agent_id,
       (SELECT count(*) FROM core.agent_panel_identity i WHERE i.registrar_national_id = p.national_id AND i.reversed_at IS NULL) AS registrar_identities
FROM core.party p;

-- ============ The agent's report: its sales, each with the REAL buyer ============
-- every bank sale attributed to the agent (with or without a deal) + its deals not yet seen at the bank
CREATE VIEW core.agent_sales_report AS
SELECT a.agent_id, g.code AS agent_code, a.source AS bank_source, a.ref AS bank_ref, b.registered_at, a.method AS attribution_method,
       c.party_id AS buyer_party_id, b.national_id AS buyer_national_id, bp.name AS buyer_name, b.total_amount AS beta_total,
       l.deal_id, l.base_amount, l.owed_to_agent, l.paid_by_bank + l.paid_by_cash + l.paid_by_wallet AS settled,
       coalesce(l.open_to_agent, 0) AS open_to_agent,
       array_remove(ARRAY[CASE WHEN l.paid_by_bank > 0 THEN 'bank_transfer' END, CASE WHEN l.paid_by_cash > 0 THEN 'cash' END,
                          CASE WHEN l.paid_by_wallet > 0 THEN 'dornatel_wallet' END], NULL) AS settlement_methods,
       CASE WHEN l.deal_id IS NULL THEN 'بدون معامله/مبلغ پایه' WHEN l.deal_status = 'declared' THEN 'مبلغ پایه در انتظار تأیید'
            WHEN l.open_to_agent > 0 THEN 'تسویه‌نشده' ELSE 'تسویه‌شده' END AS state_fa
FROM core.bank_sale_attribution_current a JOIN core.sales_agent g ON g.id = a.agent_id
JOIN core.bank_sale b ON b.scheme_id = a.scheme_id AND b.source = a.source AND b.ref = a.ref
LEFT JOIN core.installment_contract c ON c.id = core.bank_sale_contract(a.scheme_id, a.source, a.ref)
LEFT JOIN core.party bp ON bp.id = c.party_id
LEFT JOIN core.agent_deal_lineage l ON l.deal_id = a.deal_id
UNION ALL
SELECT l.agent_id, l.agent_code, NULL, NULL, NULL, NULL, l.party_id, l.customer_national_id, d.customer_name, NULL, l.deal_id, l.base_amount,
       l.owed_to_agent, l.paid_by_bank + l.paid_by_cash + l.paid_by_wallet, l.open_to_agent,
       array_remove(ARRAY[CASE WHEN l.paid_by_bank > 0 THEN 'bank_transfer' END, CASE WHEN l.paid_by_cash > 0 THEN 'cash' END,
                          CASE WHEN l.paid_by_wallet > 0 THEN 'dornatel_wallet' END], NULL),
       'در بانک دیده نشده'
FROM core.agent_deal_lineage l JOIN core.agent_deal d ON d.id = l.deal_id
WHERE l.bank_ref IS NULL AND l.deal_status IN ('declared', 'approved');

-- ============ Legacy: Holoo accounts that aggregated an agent's Beta sales ============
-- A DECLARATION (accountant/owner, with evidence) that the old system used this Holoo account to accumulate the Beta sales
-- of an agent's buyers. The migrated lines are untouched (parity with Holoo stays exact); they are only tagged and, line by
-- line, classified to the real buyer with evidence. Reclassifying the balance in the new books is a separate decision (D-28).
CREATE TABLE core.legacy_agent_aggregate (
  id bigserial PRIMARY KEY, source_system text NOT NULL DEFAULT 'holoo', source_db text NOT NULL, legacy_code text NOT NULL,
  agent_id int NOT NULL REFERENCES core.sales_agent, account_id int NOT NULL REFERENCES core.account, party_id int NOT NULL REFERENCES core.party,
  scope_from date, scope_to date, evidence_ref text NOT NULL CHECK (btrim(evidence_ref) <> ''),
  declared_by text NOT NULL, declared_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz, reversed_by text, reversal_reason text);
CREATE UNIQUE INDEX legacy_agent_aggregate_live ON core.legacy_agent_aggregate (source_system, source_db, legacy_code) WHERE reversed_at IS NULL;
CREATE TRIGGER legacy_agent_aggregate_rules BEFORE UPDATE OR DELETE ON core.legacy_agent_aggregate FOR EACH ROW EXECUTE FUNCTION core.trg_reversible_fact();

-- the migrated lines of a declared aggregate account (current legacy vouchers only)
CREATE VIEW core.legacy_aggregate_line AS
SELECT d.id AS aggregate_id, d.agent_id, d.party_id AS legacy_party_id, l.entry_id, l.line_no, e.effective_date, l.account_id, l.debit, l.credit,
       l.description, m.sanad_code
FROM core.legacy_agent_aggregate d
JOIN core.legacy_entry_map m ON m.source_system = d.source_system AND m.source_db = d.source_db AND m.status = 'current'
JOIN core.journal_entry e ON e.id = m.entry_id
JOIN core.journal_line l ON l.entry_id = m.entry_id AND l.account_id = d.account_id AND l.party_id = d.party_id
WHERE d.reversed_at IS NULL AND (d.scope_from IS NULL OR e.effective_date >= d.scope_from) AND (d.scope_to IS NULL OR e.effective_date <= d.scope_to);

-- line → real buyer (append-only; the latest decision per line is current). 'agent_personal' = the agent's own business.
CREATE TABLE core.legacy_line_classification (
  id bigserial PRIMARY KEY, entry_id bigint NOT NULL, line_no int NOT NULL,
  class text NOT NULL CHECK (class IN ('buyer_sale', 'buyer_collection', 'agent_personal', 'agent_settlement', 'other')),
  buyer_party_id int REFERENCES core.party,
  method text NOT NULL CHECK (method IN ('national_id', 'contract_ref', 'document', 'manual')),
  evidence text NOT NULL CHECK (btrim(evidence) <> ''), decided_by text NOT NULL, decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (entry_id, line_no) REFERENCES core.journal_line (entry_id, line_no),
  CHECK ((class IN ('buyer_sale', 'buyer_collection')) = (buyer_party_id IS NOT NULL)));
CREATE TRIGGER legacy_line_classification_immutable BEFORE UPDATE OR DELETE ON core.legacy_line_classification FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE VIEW core.legacy_line_classification_current AS
SELECT DISTINCT ON (entry_id, line_no) * FROM core.legacy_line_classification ORDER BY entry_id, line_no, decided_at DESC, id DESC;

CREATE FUNCTION core.legacy_aggregate_declare(p_source_db text, p_legacy_code text, p_agent int, p_scope_from date, p_scope_to date,
  p_evidence_ref text, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE m core.legacy_account_map; did bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'legacy.classify');
  SELECT * INTO m FROM core.legacy_account_map WHERE source_db = p_source_db AND legacy_code = p_legacy_code;
  IF NOT FOUND OR m.kind <> 'person_control' THEN RAISE EXCEPTION 'Holoo account % of % is not a migrated person account', p_legacy_code, p_source_db; END IF;
  INSERT INTO core.legacy_agent_aggregate (source_db, legacy_code, agent_id, account_id, party_id, scope_from, scope_to, evidence_ref, declared_by)
  VALUES (p_source_db, p_legacy_code, p_agent, m.account_id, m.party_id, p_scope_from, p_scope_to, p_evidence_ref, p_user) RETURNING id INTO did;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'declare', 'legacy_agent_aggregate', did::text,
    jsonb_build_object('source_db', p_source_db, 'legacy_code', p_legacy_code, 'agent_id', p_agent, 'evidence', p_evidence_ref));
  RETURN did;
END $$;

CREATE FUNCTION core.legacy_line_classify(p_entry bigint, p_line int, p_class text, p_buyer int, p_method text, p_evidence text, p_user text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE cid bigint; ag int;
BEGIN
  PERFORM core.require_permission(p_user, 'legacy.classify');
  SELECT agent_id INTO ag FROM core.legacy_aggregate_line WHERE entry_id = p_entry AND line_no = p_line;
  IF NOT FOUND THEN RAISE EXCEPTION 'line %/% is not on a declared agent-aggregate account', p_entry, p_line; END IF;
  IF p_buyer IS NOT NULL AND p_buyer = (SELECT party_id FROM core.sales_agent WHERE id = ag) THEN
    RAISE EXCEPTION 'the agent''s own person is not a buyer of its aggregated sales; a personal purchase is class agent_personal'; END IF;
  INSERT INTO core.legacy_line_classification (entry_id, line_no, class, buyer_party_id, method, evidence, decided_by)
  VALUES (p_entry, p_line, p_class, p_buyer, p_method, p_evidence, p_user) RETURNING id INTO cid;
  RETURN cid;
END $$;

CREATE VIEW core.legacy_aggregate_status AS
SELECT d.id AS aggregate_id, d.agent_id, d.source_db, d.legacy_code, d.party_id AS legacy_party_id,
       count(l.*) AS lines, coalesce(sum(l.debit - l.credit), 0) AS legacy_balance,
       count(c.*) FILTER (WHERE c.class IN ('buyer_sale', 'buyer_collection')) AS buyer_lines,
       coalesce(sum(l.debit - l.credit) FILTER (WHERE c.class IN ('buyer_sale', 'buyer_collection')), 0) AS buyer_amount,
       coalesce(sum(l.debit - l.credit) FILTER (WHERE c.class = 'agent_personal'), 0) AS agent_personal_amount,
       count(l.*) FILTER (WHERE c.id IS NULL) AS unclassified_lines,
       coalesce(sum(l.debit - l.credit) FILTER (WHERE c.id IS NULL), 0) AS unclassified_amount
FROM core.legacy_agent_aggregate d
LEFT JOIN core.legacy_aggregate_line l ON l.aggregate_id = d.id
LEFT JOIN core.legacy_line_classification_current c ON c.entry_id = l.entry_id AND c.line_no = l.line_no
WHERE d.reversed_at IS NULL GROUP BY d.id;

-- PROPOSAL ONLY (D-28): the reclassification that would move buyer-classified legacy amounts off the agent's party onto the
-- real buyers, on the same account. Nothing is posted here.
CREATE FUNCTION core.legacy_aggregate_reclass_proposal(p_aggregate bigint)
RETURNS TABLE (account_id int, party_id int, role text, debit numeric, credit numeric, lines bigint) LANGUAGE sql STABLE AS $$
  WITH x AS (SELECT l.account_id, l.legacy_party_id, c.buyer_party_id, l.debit - l.credit AS net
             FROM core.legacy_aggregate_line l JOIN core.legacy_line_classification_current c ON c.entry_id = l.entry_id AND c.line_no = l.line_no
             WHERE l.aggregate_id = p_aggregate AND c.class IN ('buyer_sale', 'buyer_collection'))
  SELECT account_id, buyer_party_id, 'buyer', greatest(sum(net), 0), greatest(-sum(net), 0), count(*) FROM x GROUP BY 1, 2 HAVING sum(net) <> 0
  UNION ALL
  SELECT account_id, legacy_party_id, 'agent (legacy aggregate)', greatest(-sum(net), 0), greatest(sum(net), 0), count(*) FROM x GROUP BY 1, 2 HAVING sum(net) <> 0 $$;

-- ============ One page per agent: the three roles of the same person, never mixed ============
CREATE VIEW core.agent_person_separation AS
SELECT g.id AS agent_id, g.code, g.party_id AS agent_party_id,
       -- 1. as SALES AGENT: sales of its buyers (not its debt)
       (SELECT count(*) FROM core.agent_sales_report r WHERE r.agent_id = g.id AND r.bank_ref IS NOT NULL) AS sales_as_agent,
       (SELECT coalesce(sum(beta_total), 0) FROM core.agent_sales_report r WHERE r.agent_id = g.id) AS buyers_beta_total,
       (SELECT coalesce(sum(owed_to_agent), 0) FROM core.agent_sales_report r WHERE r.agent_id = g.id) AS owed_to_agent,
       (SELECT coalesce(sum(open_to_agent), 0) FROM core.agent_sales_report r WHERE r.agent_id = g.id) AS open_to_agent,
       -- 2. as CUSTOMER: its own purchases only
       (SELECT count(*) FROM core.installment_contract c WHERE c.party_id = g.party_id AND c.status <> 'draft') AS own_contracts_as_customer,
       (SELECT coalesce(sum(outstanding_amount), 0) FROM core.contract_status s WHERE s.party_id = g.party_id) AS own_outstanding_as_customer,
       -- 3. LEGACY: what the old system aggregated on its account, kept apart from its personal balance
       (SELECT coalesce(sum(legacy_balance), 0) FROM core.legacy_aggregate_status s WHERE s.agent_id = g.id) AS legacy_aggregate_balance,
       (SELECT coalesce(sum(buyer_amount), 0) FROM core.legacy_aggregate_status s WHERE s.agent_id = g.id) AS legacy_classified_to_buyers,
       (SELECT coalesce(sum(unclassified_amount), 0) FROM core.legacy_aggregate_status s WHERE s.agent_id = g.id) AS legacy_unclassified
FROM core.sales_agent g;

-- ============ Controls ============
CREATE FUNCTION core.party_role_controls(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT 'agents', 'AG-17', 'medium', 'فروش نماینده به خود او (نقش مشتری و نماینده در یک معامله؛ بررسی تعارض منافع)', count(*), coalesce(sum(r.beta_total), 0), 'E29'
  FROM core.agent_sales_report r JOIN core.sales_agent g ON g.id = r.agent_id WHERE r.buyer_party_id = g.party_id
  UNION ALL
  SELECT 'legacy', 'LG-01', 'high', 'ردیف‌های حساب تجمیعی نماینده در هلو که هنوز به خریدار واقعی نسبت داده نشده', coalesce(sum(unclassified_lines), 0),
         coalesce(sum(abs(unclassified_amount)), 0), 'E29'
  FROM core.legacy_aggregate_status
  UNION ALL
  SELECT 'legacy', 'LG-02', 'info', 'مانده منتسب به خریداران که هنوز روی حساب نماینده (میراث هلو) است؛ اصلاح طبقه‌بندی منتظر D-28', count(*) FILTER (WHERE buyer_amount <> 0),
         coalesce(sum(abs(buyer_amount)), 0), 'E29, D-28'
  FROM core.legacy_aggregate_status
  UNION ALL
  SELECT 'legacy', 'LG-03', 'medium', 'حساب تجمیعی هلو که شخص آن با شخص نماینده اعلام‌شده یکی نیست', count(*), NULL::numeric, 'E29'
  FROM core.legacy_agent_aggregate d JOIN core.sales_agent g ON g.id = d.agent_id
  WHERE d.reversed_at IS NULL AND g.party_id IS DISTINCT FROM d.party_id $$;

ALTER FUNCTION core.control_inbox(date) RENAME TO control_inbox_v22;
CREATE FUNCTION core.control_inbox(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT * FROM core.control_inbox_v22(p_as_of) UNION ALL SELECT * FROM core.party_role_controls(p_as_of) $$;

INSERT INTO core.operation_catalog (operation, kind, function_signature, purpose, permission, effect, undo, basis, ai_allowed, agent_allowed) VALUES
  ('legacy.aggregate_declare', 'write', 'core.legacy_aggregate_declare(text,text,integer,date,date,text,text)',
   'declare that a Holoo account aggregated an agent''s Beta sales (history kept, tagged)', 'legacy.classify', 'adds a declaration; migrated lines untouched',
   'reverse the declaration', 'E29', true, false),
  ('legacy.line_classify', 'write', 'core.legacy_line_classify(bigint,integer,text,integer,text,text,text)',
   'classify one legacy line of an aggregate account to its real buyer (or the agent''s own business) with evidence', 'legacy.classify',
   'adds a classification (append-only; latest is current)', 'classify again', 'E29', true, false),
  ('legacy.reclass_proposal', 'read', 'core.legacy_aggregate_reclass_proposal(bigint)', 'the reclassification a decided D-28 would post (proposal only)', NULL,
   'none', '—', 'D-28', true, false),
  ('agent.role_controls', 'read', 'core.party_role_controls(date)', 'customer / agent / legacy separation controls', NULL, 'none', '—', 'E29', true, false);
