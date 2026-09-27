-- Almas Shahr accounting — core v0.22: agent deals made in the BANK PANEL, their attribution, and agent settlement
-- (bank transfer or Dornatel wallet charge). Owner answers D-22 / D-25 (1405/07); design: docs/BETA_API_FA.md §11–§14.
-- Proven by migration/tests/test_agent_deals.py.
--
-- What the owner stated (facts of the business, not inferences):
--   D-25  Agents register Beta sales DIRECTLY in the bank's Beta panel with access given by Almas. The panel is a real,
--         independent sales channel: the system must not assume a Beta sale starts in Almas.
--   D-22  The goods an agent sells are the AGENT's. Almas owes the agent the deal's BASE amount (the real value of the
--         agent's goods), not the Beta contract total, usually within ~24 hours, paid by bank transfer and/or by charging
--         the agent's Dornatel wallet.
-- What this file therefore does NOT do: derive the base amount from the Beta total; treat the difference as Almas's profit;
-- split the difference into bank share / financing cost / Almas fee (D-14, Q-2, D-26 stay open); attribute a bank sale to an
-- agent without evidence. Attribution = explicit declaration + matching + controlled review.

-- ============ Permissions and settings ============
INSERT INTO core.permission VALUES
  ('agent.deal_manage',  'declare / correct an agent deal for any agent (central staff)'),
  ('agent.deal_approve', 'approve an agent deal''s base amount: creates what Almas owes the agent (people only)'),
  ('agent.attribute',    'attribute a sale registered at the bank to an agent and deal (review of matching)'),
  ('agent.identity',     'record which bank-panel registrar identity belongs to which agent');

INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('agent_base_settlement_hours', '24', NULL, '^[0-9]{1,4}$', 'D-22'),
  ('agent_deal_match_days', '7', NULL, '^[0-9]{1,3}$', 'D-25'),
  ('agent_bank_settlement_match_days', '7', NULL, '^[0-9]{1,3}$', 'AG-14'),
  ('agent_auto_attribution', 'off', '{off,on}', NULL, 'D-25');

-- D-22: what an agent is owed for a deal is its base amount (owner, 1405/07). The setting records the rule; nothing computes it.
SELECT set_config('almas.controlled_change', 'on', false);
UPDATE core.setting SET allowed = '{undecided,base_goods_value}', value = 'base_goods_value', decision = 'D-22 (owner 1405/07)', updated_by = 'owner D-22'
WHERE key = 'agent_share_rule';
SELECT set_config('almas.controlled_change', 'off', false);

-- ============ Panel identities (who, in the bank panel, registers for which agent) ============
-- Almas hands out the panel access, so Almas KNOWS which registrar identity is whose: this is a declaration with evidence,
-- never an inference from sales patterns. Overlapping periods for two agents are allowed (shared access happens) and make
-- attribution by identity ambiguous (control AG-10).
CREATE TABLE core.agent_panel_identity (
  id bigserial PRIMARY KEY, agent_id int NOT NULL REFERENCES core.sales_agent, scheme_id int NOT NULL REFERENCES core.beta_scheme,
  registrar_national_id text NOT NULL CHECK (core.valid_national_id(registrar_national_id)), registrar_name text,
  valid_from date NOT NULL, valid_to date, evidence_ref text NOT NULL CHECK (btrim(evidence_ref) <> ''),
  recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz, reversed_by text, reversal_reason text,
  CHECK (valid_to IS NULL OR valid_to >= valid_from));
CREATE TRIGGER agent_panel_identity_rules BEFORE UPDATE OR DELETE ON core.agent_panel_identity FOR EACH ROW EXECUTE FUNCTION core.trg_reversible_fact();

-- the panel export carries who registered each sale (E28); kept on the immutable snapshot row
ALTER TABLE core.beta_contract_snapshot ADD COLUMN registrar_national_id text, ADD COLUMN registrar_name text, ADD COLUMN agency text;

-- ============ Agent deal: the agent's sale with its own base amount ============
CREATE TABLE core.agent_deal (
  id bigserial PRIMARY KEY, agent_id int NOT NULL REFERENCES core.sales_agent, scheme_id int NOT NULL REFERENCES core.beta_scheme,
  national_id text NOT NULL CHECK (core.valid_national_id(national_id)), party_id int REFERENCES core.party, customer_name text,
  sale_date date NOT NULL, goods_description text NOT NULL CHECK (btrim(goods_description) <> ''),
  base_amount numeric(20,0) NOT NULL CHECK (base_amount > 0),        -- rials: real value of the AGENT's goods (D-22); never derived
  base_amount_source text NOT NULL CHECK (base_amount_source IN ('agent_invoice', 'agent_declaration', 'staff_entry', 'agreement')),
  evidence_ref text NOT NULL CHECK (btrim(evidence_ref) <> ''),      -- where the base amount comes from (invoice no., file, message)
  declared_beta_total numeric(20,0) CHECK (declared_beta_total > 0), declared_order_ref text,   -- what the agent says the bank shows
  status text NOT NULL DEFAULT 'declared' CHECK (status IN ('declared', 'approved', 'rejected', 'cancelled')),
  declared_by text NOT NULL, declared_at timestamptz NOT NULL DEFAULT now(),
  approved_by text, approved_at timestamptz, closed_by text, closed_at timestamptz, close_reason text, updated_at timestamptz);
CREATE INDEX agent_deal_customer ON core.agent_deal (scheme_id, national_id);
-- one panel reference belongs to one live deal (a second declaration of the same bank sale is refused, not left to review)
CREATE UNIQUE INDEX agent_deal_order_ref ON core.agent_deal (scheme_id, declared_order_ref) WHERE declared_order_ref IS NOT NULL AND status IN ('declared', 'approved');
COMMENT ON TABLE core.agent_deal IS 'an agent''s Beta sale: the agent''s goods and their base amount, which Almas owes the agent (D-22)';

CREATE FUNCTION core.trg_agent_deal_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'agent deals are never deleted; reject or cancel'; END IF;
  IF (NEW.id, NEW.agent_id, NEW.scheme_id, NEW.declared_by, NEW.declared_at) IS DISTINCT FROM (OLD.id, OLD.agent_id, OLD.scheme_id, OLD.declared_by, OLD.declared_at) THEN
    RAISE EXCEPTION 'agent deal % identity is immutable', OLD.id; END IF;
  IF OLD.status <> 'declared' AND (NEW.national_id, NEW.sale_date, NEW.goods_description, NEW.base_amount, NEW.base_amount_source, NEW.evidence_ref,
                                   NEW.declared_beta_total, NEW.declared_order_ref)
     IS DISTINCT FROM (OLD.national_id, OLD.sale_date, OLD.goods_description, OLD.base_amount, OLD.base_amount_source, OLD.evidence_ref,
                       OLD.declared_beta_total, OLD.declared_order_ref) THEN
    RAISE EXCEPTION 'agent deal % is %; correct it with an adjustment, not an edit', OLD.id, OLD.status; END IF;
  IF OLD.status <> 'declared' AND (NEW.approved_by, NEW.approved_at) IS DISTINCT FROM (OLD.approved_by, OLD.approved_at) THEN
    RAISE EXCEPTION 'the approval of agent deal % is immutable', OLD.id; END IF;
  IF OLD.status IN ('rejected', 'cancelled') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'agent deal % is %', OLD.id, OLD.status; END IF;
  IF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'cancelled') THEN RAISE EXCEPTION 'an approved deal can only be cancelled'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER agent_deal_rules BEFORE UPDATE OR DELETE ON core.agent_deal FOR EACH ROW EXECUTE FUNCTION core.trg_agent_deal_rules();

-- entitlements may now rest on a deal (the base amount) before any Almas contract exists
ALTER TABLE core.agent_entitlement ADD COLUMN deal_id bigint REFERENCES core.agent_deal, ALTER COLUMN contract_id DROP NOT NULL,
  DROP CONSTRAINT agent_entitlement_basis_check,
  ADD CONSTRAINT agent_entitlement_basis_check CHECK (basis IN ('deal_base', 'sale', 'collection', 'adjustment')),
  ADD CONSTRAINT agent_entitlement_anchor CHECK (contract_id IS NOT NULL OR deal_id IS NOT NULL),
  ADD CONSTRAINT agent_entitlement_deal_base CHECK (basis <> 'deal_base' OR deal_id IS NOT NULL);
-- (the 021 view froze its column list: re-state it with deal_id appended)
CREATE OR REPLACE VIEW core.agent_entitlement_status AS
SELECT e.id, e.agent_id, e.contract_id, e.installment_id, e.receipt_id, e.basis, e.amount, e.rule_ref, e.note, e.created_by, e.created_at,
       e.reversed_at, e.reversed_by, e.reversal_reason, e.journal_entry_id,
       coalesce((SELECT sum(a.amount) FROM core.agent_settlement_allocation a JOIN core.agent_settlement s ON s.id = a.settlement_id
                 WHERE a.entitlement_id = e.id AND s.reversed_at IS NULL), 0) AS settled,
       CASE WHEN e.reversed_at IS NOT NULL THEN 0
            ELSE e.amount - coalesce((SELECT sum(a.amount) FROM core.agent_settlement_allocation a JOIN core.agent_settlement s ON s.id = a.settlement_id
                                      WHERE a.entitlement_id = e.id AND s.reversed_at IS NULL), 0) END AS open_amount,
       e.deal_id
FROM core.agent_entitlement e;
CREATE UNIQUE INDEX agent_entitlement_one_base ON core.agent_entitlement (deal_id) WHERE basis = 'deal_base' AND reversed_at IS NULL;

-- ============ Bank sales seen by Almas, from any source ============
-- source 'panel_export': the bank panel's Excel export (snapshot import; «شناسه» + registrar); 'api_order': the Beta API.
-- The two are NOT merged by equal id: that «شناسه» = Order.Id is unproven (U-B5, control BA-12).
CREATE VIEW core.bank_sale AS
WITH snap AS (
  SELECT DISTINCT ON (f.scheme_id, s.bank_contract_id) f.scheme_id, s.bank_contract_id AS ref, s.national_code, s.total_amount, s.registered_at,
         s.registrar_national_id, s.registrar_name, f.imported_at AS seen_at
  FROM core.beta_contract_snapshot s JOIN core.import_file f ON f.id = s.file_id
  ORDER BY f.scheme_id, s.bank_contract_id, f.imported_at DESC, f.id DESC)
SELECT scheme_id, 'panel_export'::text AS source, ref, lpad(national_code, 10, '0') AS national_id, total_amount, registered_at,
       registrar_national_id, registrar_name, seen_at FROM snap
UNION ALL
SELECT o.scheme_id, 'api_order', o.beta_order_id::text, o.national_id, o.amount, NULL::timestamp, NULL, NULL,
       (SELECT min(observed_at) FROM core.beta_order_observation x WHERE x.scheme_id = o.scheme_id AND x.beta_order_id = o.beta_order_id)
FROM core.beta_order_latest o WHERE o.present;

-- the Almas contract of a bank sale (same source key only)
CREATE FUNCTION core.bank_sale_contract(p_scheme int, p_source text, p_ref text) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT id FROM core.installment_contract
  WHERE scheme_id = p_scheme AND ((p_source = 'panel_export' AND bank_contract_id = p_ref AND beta_order_id IS NULL)
                                  OR (p_source = 'api_order' AND beta_order_id::text = p_ref)) $$;

-- ============ Attribution: which agent (and deal) a bank sale belongs to ============
CREATE TABLE core.bank_sale_attribution (
  id bigserial PRIMARY KEY, scheme_id int NOT NULL, source text NOT NULL CHECK (source IN ('panel_export', 'api_order')), ref text NOT NULL,
  agent_id int REFERENCES core.sales_agent, deal_id bigint REFERENCES core.agent_deal,
  method text NOT NULL CHECK (method IN ('declared_order_ref', 'panel_identity', 'declared_customer', 'manual', 'almas_own', 'auto')),
  evidence jsonb NOT NULL, reason text, attributed_by text NOT NULL, attributed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((method = 'almas_own') = (agent_id IS NULL)), CHECK (deal_id IS NULL OR agent_id IS NOT NULL));
CREATE TRIGGER bank_sale_attribution_immutable BEFORE UPDATE OR DELETE ON core.bank_sale_attribution FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
COMMENT ON TABLE core.bank_sale_attribution IS 'append-only: the latest row per bank sale is current; history is never lost';

CREATE VIEW core.bank_sale_attribution_current AS
SELECT DISTINCT ON (scheme_id, source, ref) * FROM core.bank_sale_attribution ORDER BY scheme_id, source, ref, attributed_at DESC, id DESC;

-- matching signals for every bank sale that is not attributed yet. Nothing here decides; it proposes, with its reasons.
CREATE FUNCTION core.bank_sale_candidates(p_scheme int DEFAULT NULL)
RETURNS TABLE (scheme_id int, source text, ref text, national_id text, total_amount numeric, registered_at timestamp,
               agent_id int, deal_id bigint, signal text, strength text, detail text) LANGUAGE sql STABLE AS $$
  WITH open_sale AS (
    SELECT b.* FROM core.bank_sale b
    WHERE (p_scheme IS NULL OR b.scheme_id = p_scheme)
      AND NOT EXISTS (SELECT 1 FROM core.bank_sale_attribution_current a WHERE a.scheme_id = b.scheme_id AND a.source = b.source AND a.ref = b.ref)),
  free_deal AS (
    SELECT d.* FROM core.agent_deal d WHERE d.status IN ('declared', 'approved')
      AND NOT EXISTS (SELECT 1 FROM core.bank_sale_attribution_current a WHERE a.deal_id = d.id))
  -- 1. the agent declared this very bank reference
  SELECT s.scheme_id, s.source, s.ref, s.national_id, s.total_amount, s.registered_at, d.agent_id, d.id, 'declared_order_ref',
         CASE WHEN d.national_id = s.national_id THEN 'strong' ELSE 'conflict' END,
         CASE WHEN d.national_id = s.national_id THEN 'شناسه اعلام‌شده نماینده و کد ملی منطبق' ELSE 'شناسه منطبق ولی کد ملی مشتری متفاوت' END
  FROM open_sale s JOIN free_deal d ON d.scheme_id = s.scheme_id AND d.declared_order_ref = s.ref
  UNION ALL
  -- 2. the registrar identity recorded on the sale belongs to an agent (valid on the registration date)
  SELECT s.scheme_id, s.source, s.ref, s.national_id, s.total_amount, s.registered_at, i.agent_id, NULL, 'panel_identity', 'strong',
         'ثبت‌کننده پنل متعلق به این نماینده است (' || i.evidence_ref || ')'
  FROM open_sale s JOIN core.agent_panel_identity i ON i.scheme_id = s.scheme_id AND i.registrar_national_id = s.registrar_national_id
   AND i.reversed_at IS NULL AND s.registered_at::date >= i.valid_from AND (i.valid_to IS NULL OR s.registered_at::date <= i.valid_to)
  UNION ALL
  -- 3. a deal of the same customer near the same date (no bank reference declared): medium, stronger when the declared total agrees
  SELECT s.scheme_id, s.source, s.ref, s.national_id, s.total_amount, s.registered_at, d.agent_id, d.id, 'declared_customer',
         CASE WHEN d.declared_beta_total = s.total_amount THEN 'strong' ELSE 'medium' END,
         'کد ملی و تاریخ نزدیک' || CASE WHEN d.declared_beta_total = s.total_amount THEN '، مبلغ کل اعلام‌شده برابر' ELSE '' END
  FROM open_sale s JOIN free_deal d ON d.scheme_id = s.scheme_id AND d.national_id = s.national_id AND d.declared_order_ref IS NULL
   AND (s.registered_at IS NULL OR abs(d.sale_date - s.registered_at::date) <= core.setting_value('agent_deal_match_days')::int) $$;

-- one row per unattributed bank sale: what the matching proposes and whether a person must decide
CREATE VIEW core.bank_sale_attribution_queue AS
WITH c AS (SELECT * FROM core.bank_sale_candidates(NULL)),
agg AS (
  SELECT scheme_id, source, ref, count(DISTINCT agent_id) AS agents, count(DISTINCT deal_id) AS deals,
         bool_or(strength = 'strong') AS has_strong, bool_or(strength = 'conflict') AS has_conflict,
         min(agent_id) AS agent_id, min(deal_id) AS deal_id, jsonb_agg(jsonb_build_object('agent_id', agent_id, 'deal_id', deal_id, 'signal', signal,
                                                                                   'strength', strength, 'detail', detail)) AS signals
  FROM c GROUP BY 1, 2, 3)
SELECT b.scheme_id, b.source, b.ref, b.national_id, b.total_amount, b.registered_at, b.registrar_name,
       CASE WHEN g.ref IS NULL THEN 'no_candidate'
            WHEN g.has_conflict OR g.agents > 1 OR g.deals > 1 THEN 'conflict'
            WHEN g.has_strong THEN 'proposed' ELSE 'weak' END AS state,
       CASE WHEN g.agents = 1 AND NOT g.has_conflict THEN g.agent_id END AS proposed_agent_id,
       CASE WHEN g.agents = 1 AND g.deals = 1 AND NOT g.has_conflict THEN g.deal_id END AS proposed_deal_id, g.signals
FROM core.bank_sale b LEFT JOIN agg g ON g.scheme_id = b.scheme_id AND g.source = b.source AND g.ref = b.ref
WHERE NOT EXISTS (SELECT 1 FROM core.bank_sale_attribution_current a WHERE a.scheme_id = b.scheme_id AND a.source = b.source AND a.ref = b.ref);

-- attribute one bank sale (a person's decision; also the path of the optional auto rule)
CREATE FUNCTION core.agent_attribute(p_scheme int, p_source text, p_ref text, p_agent int, p_deal bigint, p_method text, p_user text,
  p_reason text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE s core.bank_sale; d core.agent_deal; aid bigint; ev jsonb;
BEGIN
  PERFORM core.require_permission(p_user, 'agent.attribute');
  SELECT * INTO s FROM core.bank_sale WHERE scheme_id = p_scheme AND source = p_source AND ref = p_ref;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank sale %/% not found in scheme %', p_source, p_ref, p_scheme; END IF;
  IF p_method IN ('manual', 'almas_own') THEN PERFORM core.require_reason(p_reason); END IF;
  IF p_deal IS NOT NULL THEN
    SELECT * INTO d FROM core.agent_deal WHERE id = p_deal;
    IF d.agent_id IS DISTINCT FROM p_agent THEN RAISE EXCEPTION 'deal % belongs to agent %, not %', p_deal, d.agent_id, p_agent; END IF;
    IF d.status NOT IN ('declared', 'approved') THEN RAISE EXCEPTION 'deal % is %', p_deal, d.status; END IF;
    IF d.scheme_id <> p_scheme THEN RAISE EXCEPTION 'deal % is of another scheme', p_deal; END IF;
    IF d.national_id <> s.national_id AND p_method <> 'manual' THEN
      RAISE EXCEPTION 'deal % customer differs from the bank sale; only a manual attribution with a reason can link them', p_deal; END IF;
    IF EXISTS (SELECT 1 FROM core.bank_sale_attribution_current a WHERE a.deal_id = p_deal AND (a.scheme_id, a.source, a.ref) <> (p_scheme, p_source, p_ref)) THEN
      RAISE EXCEPTION 'deal % is already attributed to another bank sale', p_deal; END IF;
  END IF;
  IF p_method NOT IN ('manual', 'almas_own') AND NOT EXISTS (
       SELECT 1 FROM core.bank_sale_candidates(p_scheme) c WHERE c.source = p_source AND c.ref = p_ref AND c.agent_id = p_agent
         AND c.signal = CASE p_method WHEN 'auto' THEN c.signal ELSE p_method END AND c.strength <> 'conflict') THEN
    RAISE EXCEPTION 'no % evidence links bank sale % to agent %; use a manual attribution with a reason', p_method, p_ref, p_agent; END IF;
  ev := jsonb_build_object('bank_total', s.total_amount, 'national_id_match', d.id IS NULL OR d.national_id = s.national_id,
          'signals', (SELECT jsonb_agg(to_jsonb(c)) FROM core.bank_sale_candidates(p_scheme) c WHERE c.source = p_source AND c.ref = p_ref));
  INSERT INTO core.bank_sale_attribution (scheme_id, source, ref, agent_id, deal_id, method, evidence, reason, attributed_by)
  VALUES (p_scheme, p_source, p_ref, p_agent, p_deal, p_method, ev, p_reason, p_user) RETURNING id INTO aid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason) VALUES (p_user, 'attribute', 'bank_sale', p_source || ':' || p_ref,
    jsonb_build_object('agent_id', p_agent, 'deal_id', p_deal, 'method', p_method), p_reason);
  RETURN aid;
END $$;

-- optional rule: apply only unambiguous STRONG proposals (one agent, at most one deal, no conflict). Off by default.
CREATE FUNCTION core.agent_attribute_auto(p_scheme int, p_user text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE q record; n int := 0;
BEGIN
  IF core.setting_value('agent_auto_attribution') <> 'on' THEN RAISE EXCEPTION 'automatic attribution is off (setting agent_auto_attribution)'; END IF;
  FOR q IN SELECT * FROM core.bank_sale_attribution_queue WHERE scheme_id = p_scheme AND state = 'proposed' LOOP
    PERFORM core.agent_attribute(q.scheme_id, q.source, q.ref, q.proposed_agent_id, q.proposed_deal_id, 'auto', p_user);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ownership of a contract now also follows the attribution of its bank sale (latest decision wins; placeholder rows ignored)
CREATE OR REPLACE VIEW core.contract_owner AS
SELECT DISTINCT ON (contract_id) contract_id, agent_id, assigned_at FROM (
  SELECT contract_id, agent_id, assigned_at, id AS k FROM core.contract_agent WHERE NOT (agent_id IS NULL AND source = 'import')
  UNION ALL
  SELECT core.bank_sale_contract(a.scheme_id, a.source, a.ref), a.agent_id, a.attributed_at, a.id
  FROM core.bank_sale_attribution_current a WHERE core.bank_sale_contract(a.scheme_id, a.source, a.ref) IS NOT NULL) z
ORDER BY contract_id, assigned_at DESC, k DESC;

-- ============ Deal operations ============
CREATE FUNCTION core.agent_deal_declare(p_user text, p_national_id text, p_customer_name text, p_sale_date date, p_goods text,
  p_base_amount numeric, p_base_source text, p_evidence_ref text, p_declared_beta_total numeric DEFAULT NULL, p_declared_order_ref text DEFAULT NULL,
  p_agent int DEFAULT NULL, p_scheme int DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE my int := core.agent_of(p_user); ag int := p_agent; sch int := p_scheme; did bigint;
        nid text := lpad(btrim(translate(p_national_id, '۰۱۲۳۴۵۶۷۸۹', '0123456789')), 10, '0');
BEGIN
  IF my IS NOT NULL THEN
    PERFORM core.require_permission(p_user, 'agent.workspace');
    IF ag IS NOT NULL AND ag <> my THEN RAISE EXCEPTION 'permission denied: an agent declares only its own deals' USING ERRCODE = 'insufficient_privilege'; END IF;
    ag := my;
    IF p_base_source NOT IN ('agent_invoice', 'agent_declaration') THEN RAISE EXCEPTION 'an agent declares from its own invoice or declaration'; END IF;
  ELSE
    PERFORM core.require_permission(p_user, 'agent.deal_manage');
    IF ag IS NULL THEN RAISE EXCEPTION 'choose the agent'; END IF;
  END IF;
  IF sch IS NULL THEN
    IF (SELECT count(*) FROM core.beta_scheme WHERE status = 'active') <> 1 THEN RAISE EXCEPTION 'choose the Beta scheme (more than one is active)'; END IF;
    SELECT id INTO sch FROM core.beta_scheme WHERE status = 'active';
  END IF;
  IF NOT core.valid_national_id(nid) THEN RAISE EXCEPTION 'کد ملی خریدار معتبر نیست'; END IF;
  SELECT id INTO did FROM core.agent_deal WHERE scheme_id = sch AND declared_order_ref = nullif(btrim(p_declared_order_ref), '') AND status IN ('declared', 'approved');
  IF FOUND THEN RAISE EXCEPTION 'این فروش پنل قبلاً اعلام شده است (معامله %)', did; END IF;
  INSERT INTO core.agent_deal (agent_id, scheme_id, national_id, party_id, customer_name, sale_date, goods_description, base_amount, base_amount_source,
                               evidence_ref, declared_beta_total, declared_order_ref, declared_by)
  VALUES (ag, sch, nid, (SELECT id FROM core.party WHERE national_id = nid AND merged_into_id IS NULL), p_customer_name, p_sale_date, p_goods, p_base_amount,
          p_base_source, p_evidence_ref, p_declared_beta_total, nullif(btrim(p_declared_order_ref), ''), p_user) RETURNING id INTO did;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'declare', 'agent_deal', did::text,
    jsonb_build_object('agent_id', ag, 'base_amount', p_base_amount, 'source', p_base_source, 'evidence', p_evidence_ref));
  RETURN did;
END $$;

-- before approval only; every change keeps before/after in the audit
CREATE FUNCTION core.agent_deal_correct(p_deal bigint, p_base_amount numeric, p_base_source text, p_evidence_ref text, p_user text, p_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d core.agent_deal;
BEGIN
  PERFORM core.require_permission(p_user, 'agent.deal_manage'); PERFORM core.require_reason(p_reason);
  SELECT * INTO d FROM core.agent_deal WHERE id = p_deal;
  UPDATE core.agent_deal SET base_amount = p_base_amount, base_amount_source = p_base_source, evidence_ref = p_evidence_ref WHERE id = p_deal;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after, reason) VALUES (p_user, 'correct', 'agent_deal', p_deal::text,
    jsonb_build_object('base_amount', d.base_amount, 'source', d.base_amount_source, 'evidence', d.evidence_ref),
    jsonb_build_object('base_amount', p_base_amount, 'source', p_base_source, 'evidence', p_evidence_ref), p_reason);
END $$;

-- approval creates what Almas owes the agent: exactly the base amount (D-22). The Beta total plays no part in it.
CREATE FUNCTION core.agent_deal_approve(p_deal bigint, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE d core.agent_deal; eid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'agent.deal_approve');
  SELECT * INTO d FROM core.agent_deal WHERE id = p_deal FOR UPDATE;
  IF NOT FOUND OR d.status <> 'declared' THEN RAISE EXCEPTION 'deal % is not waiting for approval', p_deal; END IF;
  IF (SELECT status FROM core.sales_agent WHERE id = d.agent_id) = 'closed' THEN RAISE EXCEPTION 'agent % is closed', d.agent_id; END IF;
  UPDATE core.agent_deal SET status = 'approved', approved_by = p_user, approved_at = now() WHERE id = p_deal;
  INSERT INTO core.agent_entitlement (agent_id, deal_id, basis, amount, rule_ref, note, created_by)
  VALUES (d.agent_id, p_deal, 'deal_base', d.base_amount, 'D-22: base goods value (owner 1405/07); evidence ' || d.evidence_ref, d.goods_description, p_user)
  RETURNING id INTO eid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'approve', 'agent_deal', p_deal::text,
    jsonb_build_object('entitlement_id', eid, 'base_amount', d.base_amount));
  RETURN eid;
END $$;

CREATE FUNCTION core.agent_deal_close(p_deal bigint, p_status text, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d core.agent_deal;
BEGIN
  PERFORM core.require_reason(p_reason);
  SELECT * INTO d FROM core.agent_deal WHERE id = p_deal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'deal % not found', p_deal; END IF;
  IF p_status = 'rejected' THEN
    PERFORM core.require_permission(p_user, 'agent.deal_approve');
    IF d.status <> 'declared' THEN RAISE EXCEPTION 'only a declared deal can be rejected'; END IF;
  ELSIF p_status = 'cancelled' THEN
    PERFORM core.require_permission(p_user, 'agent.deal_approve');
    IF EXISTS (SELECT 1 FROM core.agent_entitlement WHERE deal_id = p_deal AND reversed_at IS NULL) THEN
      RAISE EXCEPTION 'deal % still has live entitlements; reverse (or, if settled, adjust) them first', p_deal; END IF;
  ELSE RAISE EXCEPTION 'status must be rejected or cancelled'; END IF;
  UPDATE core.agent_deal SET status = p_status, closed_by = p_user, closed_at = now(), close_reason = p_reason WHERE id = p_deal;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, p_status, 'agent_deal', p_deal::text, p_reason);
END $$;

-- a correction after approval: a signed adjustment on the same deal (e.g. the bank deleted the sale after Almas paid)
CREATE FUNCTION core.agent_deal_adjust(p_deal bigint, p_amount numeric, p_evidence_ref text, p_user text, p_reason text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE d core.agent_deal; eid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'agent.deal_approve'); PERFORM core.require_reason(p_reason);
  SELECT * INTO d FROM core.agent_deal WHERE id = p_deal;
  IF d.status <> 'approved' THEN RAISE EXCEPTION 'only an approved deal is adjusted'; END IF;
  INSERT INTO core.agent_entitlement (agent_id, deal_id, basis, amount, rule_ref, note, created_by)
  VALUES (d.agent_id, p_deal, 'adjustment', p_amount, 'adjustment of deal ' || p_deal || '; evidence ' || p_evidence_ref, p_reason, p_user) RETURNING id INTO eid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason) VALUES (p_user, 'adjust', 'agent_deal', p_deal::text,
    jsonb_build_object('entitlement_id', eid, 'amount', p_amount, 'evidence', p_evidence_ref), p_reason);
  RETURN eid;
END $$;

CREATE FUNCTION core.agent_identity_record(p_agent int, p_scheme int, p_registrar_national_id text, p_registrar_name text, p_valid_from date,
  p_valid_to date, p_evidence_ref text, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE iid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'agent.identity');
  INSERT INTO core.agent_panel_identity (agent_id, scheme_id, registrar_national_id, registrar_name, valid_from, valid_to, evidence_ref, recorded_by)
  VALUES (p_agent, p_scheme, lpad(p_registrar_national_id, 10, '0'), p_registrar_name, p_valid_from, p_valid_to, p_evidence_ref, p_user) RETURNING id INTO iid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'create', 'agent_panel_identity', iid::text,
    jsonb_build_object('agent_id', p_agent, 'valid_from', p_valid_from, 'valid_to', p_valid_to, 'evidence', p_evidence_ref));
  RETURN iid;
END $$;

CREATE FUNCTION core.agent_identity_reverse(p_identity bigint, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'agent.identity'); PERFORM core.require_reason(p_reason);
  UPDATE core.agent_panel_identity SET reversed_at = now(), reversed_by = p_user, reversal_reason = p_reason WHERE id = p_identity AND reversed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'identity mapping % not found or already reversed', p_identity; END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'reverse', 'agent_panel_identity', p_identity::text, p_reason);
END $$;

-- ============ Settlement: bank transfer, cash, or Dornatel wallet charge ============
-- A wallet charge is a real financial event with Dornatel's own transaction reference (unique: one charge settles once),
-- confirmation against Dornatel's records, and reversal only with Dornatel's reversal reference. Never "a number changed".
CREATE TABLE core.dornatel_wallet_charge (
  id bigserial PRIMARY KEY, agent_id int NOT NULL REFERENCES core.sales_agent, amount numeric(20,0) NOT NULL CHECK (amount > 0),
  charged_at timestamptz NOT NULL, dornatel_txn_ref text NOT NULL UNIQUE CHECK (btrim(dornatel_txn_ref) <> ''),
  wallet_account_ref text NOT NULL CHECK (btrim(wallet_account_ref) <> ''), evidence_ref text,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'confirmed')), confirmed_by text, confirmed_at timestamptz, confirmation_ref text,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz, reversed_by text, reversal_reason text, reversal_dornatel_ref text, journal_entry_id bigint REFERENCES core.journal_entry);
CREATE FUNCTION core.trg_wallet_charge_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'wallet charges are never deleted; reverse with Dornatel''s reversal reference'; END IF;
  IF (NEW.agent_id, NEW.amount, NEW.charged_at, NEW.dornatel_txn_ref, NEW.wallet_account_ref, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.agent_id, OLD.amount, OLD.charged_at, OLD.dornatel_txn_ref, OLD.wallet_account_ref, OLD.created_by, OLD.created_at)
     OR (OLD.status = 'confirmed' AND (NEW.status, NEW.confirmed_by, NEW.confirmed_at, NEW.confirmation_ref)
                                      IS DISTINCT FROM (OLD.status, OLD.confirmed_by, OLD.confirmed_at, OLD.confirmation_ref))
     OR (OLD.reversed_at IS NOT NULL AND (NEW.reversed_at, NEW.reversal_dornatel_ref) IS DISTINCT FROM (OLD.reversed_at, OLD.reversal_dornatel_ref)) THEN
    RAISE EXCEPTION 'wallet charge % facts are immutable', OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER wallet_charge_rules BEFORE UPDATE OR DELETE ON core.dornatel_wallet_charge FOR EACH ROW EXECUTE FUNCTION core.trg_wallet_charge_rules();

ALTER TABLE core.agent_settlement ADD COLUMN wallet_charge_id bigint UNIQUE REFERENCES core.dornatel_wallet_charge,
  ADD COLUMN statement_line_id bigint UNIQUE REFERENCES core.bank_statement_line,
  DROP CONSTRAINT agent_settlement_check,
  ADD CONSTRAINT agent_settlement_method CHECK (
    (method = 'bank_transfer' AND company_bank_account_id IS NOT NULL AND wallet_charge_id IS NULL)
    OR (method = 'cash' AND cash_desk IS NOT NULL AND wallet_charge_id IS NULL)
    OR (method = 'dornatel_wallet' AND wallet_charge_id IS NOT NULL AND company_bank_account_id IS NULL AND cash_desk IS NULL));
-- the statement line of a bank transfer can be tied once (reconciliation); nothing else of a settlement changes
CREATE OR REPLACE FUNCTION core.trg_reversible_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE free text[] := '{reversed_at,reversed_by,reversal_reason,journal_entry_id,statement_line_id}';
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '% rows are never deleted; reverse instead', TG_TABLE_NAME; END IF;
  IF (to_jsonb(NEW) - free) IS DISTINCT FROM (to_jsonb(OLD) - free)
     OR (OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at)
     OR (to_jsonb(OLD) ->> 'statement_line_id' IS NOT NULL AND to_jsonb(NEW) -> 'statement_line_id' IS DISTINCT FROM to_jsonb(OLD) -> 'statement_line_id') THEN
    RAISE EXCEPTION '% % is immutable (only a one-time reversal is allowed)', TG_TABLE_NAME, OLD.id; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION core.agent_allocate(p_settlement bigint, p_allocations jsonb, p_user text) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE s core.agent_settlement; a jsonb; e core.agent_entitlement_status; total numeric := 0;
BEGIN
  SELECT * INTO s FROM core.agent_settlement WHERE id = p_settlement;
  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p_allocations, '[]')) LOOP
    PERFORM 1 FROM core.agent_entitlement WHERE id = (a ->> 'entitlement_id')::bigint FOR UPDATE;
    SELECT * INTO e FROM core.agent_entitlement_status WHERE id = (a ->> 'entitlement_id')::bigint;
    IF NOT FOUND OR e.agent_id <> s.agent_id THEN RAISE EXCEPTION 'entitlement % is not of agent %', a ->> 'entitlement_id', s.agent_id; END IF;
    IF e.reversed_at IS NOT NULL OR (a ->> 'amount')::numeric > e.open_amount THEN RAISE EXCEPTION 'entitlement % has only % open', e.id, e.open_amount; END IF;
    INSERT INTO core.agent_settlement_allocation (settlement_id, entitlement_id, amount, created_by) VALUES (p_settlement, e.id, (a ->> 'amount')::numeric, p_user);
    total := total + (a ->> 'amount')::numeric;
  END LOOP;
  IF (SELECT allocated FROM core.agent_settlement_status WHERE id = p_settlement) > s.amount THEN
    RAISE EXCEPTION 'allocations exceed the payment (%)', s.amount; END IF;
  RETURN total;
END $$;

-- one operation for every method; atomic; the wallet charge is created with its Dornatel reference in the same transaction
CREATE FUNCTION core.agent_settle(p_agent int, p_method text, p_amount numeric, p_paid_at date, p_allocations jsonb, p_user text,
  p_bank_account int DEFAULT NULL, p_bank_ref text DEFAULT NULL, p_cash_desk text DEFAULT NULL,
  p_dornatel_txn_ref text DEFAULT NULL, p_wallet_account_ref text DEFAULT NULL, p_charged_at timestamptz DEFAULT NULL,
  p_evidence_ref text DEFAULT NULL, p_note text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE sid bigint; wid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'agent.settle');
  IF p_method = 'dornatel_wallet' THEN
    INSERT INTO core.dornatel_wallet_charge (agent_id, amount, charged_at, dornatel_txn_ref, wallet_account_ref, evidence_ref, created_by)
    VALUES (p_agent, p_amount, coalesce(p_charged_at, now()), p_dornatel_txn_ref, p_wallet_account_ref, p_evidence_ref, p_user) RETURNING id INTO wid;
  END IF;
  INSERT INTO core.agent_settlement (agent_id, amount, paid_at, method, company_bank_account_id, cash_desk, bank_ref, note, created_by, wallet_charge_id)
  VALUES (p_agent, p_amount, p_paid_at, p_method, p_bank_account, p_cash_desk, coalesce(p_bank_ref, p_dornatel_txn_ref), p_note, p_user, wid) RETURNING id INTO sid;
  PERFORM core.agent_allocate(sid, p_allocations, p_user);
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'settle', 'agent_settlement', sid::text,
    jsonb_build_object('agent_id', p_agent, 'method', p_method, 'amount', p_amount, 'wallet_charge_id', wid, 'allocations', p_allocations));
  RETURN sid;
END $$;

-- the 021 entry point keeps working for bank / cash, now through the shared allocation
CREATE OR REPLACE FUNCTION core.agent_record_settlement(p_agent int, p_amount numeric, p_paid_at date, p_method text, p_bank_account int, p_cash_desk text,
  p_bank_ref text, p_allocations jsonb, p_user text, p_note text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  IF p_method = 'dornatel_wallet' THEN RAISE EXCEPTION 'a wallet settlement needs Dornatel''s transaction reference: use core.agent_settle'; END IF;
  RETURN core.agent_settle(p_agent, CASE WHEN p_bank_account IS NOT NULL THEN 'bank_transfer' ELSE 'cash' END, p_amount, p_paid_at, p_allocations, p_user,
                           p_bank_account, p_bank_ref, p_cash_desk, NULL, NULL, NULL, NULL, p_note);
END $$;

CREATE FUNCTION core.dornatel_wallet_confirm(p_charge bigint, p_confirmation_ref text, p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'agent.settle'); PERFORM core.require_reason(p_confirmation_ref);
  UPDATE core.dornatel_wallet_charge SET status = 'confirmed', confirmed_by = p_user, confirmed_at = now(), confirmation_ref = p_confirmation_ref
  WHERE id = p_charge AND status = 'recorded' AND reversed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet charge % is not waiting for confirmation', p_charge; END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'confirm', 'dornatel_wallet_charge', p_charge::text, p_confirmation_ref);
END $$;

-- reversing a wallet settlement = Dornatel reversed the charge: both are reversed together, with Dornatel's reference
CREATE FUNCTION core.dornatel_wallet_reverse(p_charge bigint, p_reversal_dornatel_ref text, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'agent.settle'); PERFORM core.require_reason(p_reason); PERFORM core.require_reason(p_reversal_dornatel_ref);
  UPDATE core.dornatel_wallet_charge SET reversed_at = now(), reversed_by = p_user, reversal_reason = p_reason, reversal_dornatel_ref = p_reversal_dornatel_ref
  WHERE id = p_charge AND reversed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet charge % not found or already reversed', p_charge; END IF;
  UPDATE core.agent_settlement SET reversed_at = now(), reversed_by = p_user, reversal_reason = 'wallet charge reversed: ' || p_reason
  WHERE wallet_charge_id = p_charge AND reversed_at IS NULL;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'reverse', 'dornatel_wallet_charge', p_charge::text, p_reason);
END $$;

CREATE OR REPLACE FUNCTION core.agent_reverse_settlement(p_settlement bigint, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'agent.settle'); PERFORM core.require_reason(p_reason);
  IF (SELECT method FROM core.agent_settlement WHERE id = p_settlement) = 'dornatel_wallet' THEN
    RAISE EXCEPTION 'a wallet settlement is reversed through its wallet charge (core.dornatel_wallet_reverse) with Dornatel''s reference'; END IF;
  UPDATE core.agent_settlement SET reversed_at = now(), reversed_by = p_user, reversal_reason = p_reason WHERE id = p_settlement AND reversed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement % not found or already reversed', p_settlement; END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'reverse', 'agent_settlement', p_settlement::text, p_reason);
END $$;

-- tie a bank-transfer settlement to the bank statement line that shows it (reconciliation)
CREATE FUNCTION core.agent_settlement_tie_statement(p_settlement bigint, p_statement_line bigint, p_user text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s core.agent_settlement; l core.bank_statement_line;
BEGIN
  PERFORM core.require_permission(p_user, 'agent.settle');
  SELECT * INTO s FROM core.agent_settlement WHERE id = p_settlement;
  SELECT * INTO l FROM core.bank_statement_line WHERE id = p_statement_line;
  IF s.method <> 'bank_transfer' OR l.company_bank_account_id <> s.company_bank_account_id OR l.withdrawal <> s.amount THEN
    RAISE EXCEPTION 'statement line % (account %, withdrawal %) does not match settlement % (account %, %)', l.id, l.company_bank_account_id, l.withdrawal,
      s.id, s.company_bank_account_id, s.amount; END IF;
  UPDATE core.agent_settlement SET statement_line_id = p_statement_line WHERE id = p_settlement;
END $$;

-- ============ Lineage of an agent deal: agent → customer → bank sale → base → Beta total → bank ids → owed → paid → open ============
CREATE VIEW core.agent_deal_lineage AS
SELECT d.id AS deal_id, d.agent_id, g.code AS agent_code, d.national_id AS customer_national_id, d.party_id, d.sale_date, d.goods_description,
       d.base_amount, d.base_amount_source, d.evidence_ref, d.status AS deal_status, d.approved_at,
       a.source AS bank_source, a.ref AS bank_ref, a.method AS attribution_method, b.total_amount AS beta_total, b.registered_at AS bank_registered_at,
       b.national_id = d.national_id AS customer_matches,
       b.total_amount - d.base_amount AS unallocated_difference,           -- NOT profit: components undecided (D-14, D-26)
       c.id AS contract_id, c.beta_order_id, c.installment_count, cs.paid_count, cs.overdue_count, cs.outstanding_amount AS customer_outstanding,
       coalesce(en.owed, 0) AS owed_to_agent,
       coalesce(pd.by_bank, 0) AS paid_by_bank, coalesce(pd.by_cash, 0) AS paid_by_cash, coalesce(pd.by_wallet, 0) AS paid_by_wallet,
       coalesce(en.owed, 0) - coalesce(pd.by_bank, 0) - coalesce(pd.by_cash, 0) - coalesce(pd.by_wallet, 0) AS open_to_agent,
       pd.last_paid_at
FROM core.agent_deal d JOIN core.sales_agent g ON g.id = d.agent_id
LEFT JOIN core.bank_sale_attribution_current a ON a.deal_id = d.id
LEFT JOIN core.bank_sale b ON b.scheme_id = a.scheme_id AND b.source = a.source AND b.ref = a.ref
LEFT JOIN core.installment_contract c ON c.id = core.bank_sale_contract(a.scheme_id, a.source, a.ref)
LEFT JOIN core.contract_status cs ON cs.contract_id = c.id
LEFT JOIN LATERAL (SELECT sum(e.amount) AS owed FROM core.agent_entitlement e WHERE e.deal_id = d.id AND e.reversed_at IS NULL) en ON true
LEFT JOIN LATERAL (
  SELECT sum(x.amount) FILTER (WHERE s.method = 'bank_transfer') AS by_bank, sum(x.amount) FILTER (WHERE s.method = 'cash') AS by_cash,
         sum(x.amount) FILTER (WHERE s.method = 'dornatel_wallet') AS by_wallet, max(s.paid_at) AS last_paid_at
  FROM core.agent_settlement_allocation x JOIN core.agent_settlement s ON s.id = x.settlement_id AND s.reversed_at IS NULL
  JOIN core.agent_entitlement e ON e.id = x.entitlement_id AND e.deal_id = d.id) pd ON true;

-- ============ Controls ============
CREATE FUNCTION core.agent_deal_controls(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT 'agents', 'AG-01', 'high', 'فروش بانکی منتسب به نماینده بدون مبلغ پایه تأییدشده', count(*), coalesce(sum(b.total_amount), 0), 'D-22'
  FROM core.bank_sale_attribution_current a JOIN core.bank_sale b USING (scheme_id, source, ref)
  WHERE a.agent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.agent_deal d WHERE d.id = a.deal_id AND d.status = 'approved')
  UNION ALL
  SELECT 'agents', 'AG-07', 'high', 'مبلغ پایه تأییدشده که در مهلت تسویه (ساعت) پرداخت نشده', count(*), coalesce(sum(e.open_amount), 0), 'D-22'
  FROM core.agent_entitlement_status e JOIN core.agent_deal d ON d.id = e.deal_id
  WHERE e.basis = 'deal_base' AND e.reversed_at IS NULL AND e.open_amount > 0
    AND d.approved_at + make_interval(hours => core.setting_value('agent_base_settlement_hours')::int) < least(now(), p_as_of::timestamptz + interval '1 day')
  UNION ALL
  SELECT 'agents', 'AG-08', 'high', 'معامله تأییدشده نماینده که فروش آن در بانک دیده نشده', count(*), coalesce(sum(d.base_amount), 0), 'D-25'
  FROM core.agent_deal d WHERE d.status = 'approved' AND d.sale_date + core.setting_value('agent_deal_match_days')::int < p_as_of
    AND NOT EXISTS (SELECT 1 FROM core.bank_sale_attribution_current a WHERE a.deal_id = d.id)
  UNION ALL
  SELECT 'agents', 'AG-09', 'medium', 'فروش ثبت‌شده در بانک بدون انتساب و بدون هیچ نشانه‌ای از نماینده', count(*), coalesce(sum(total_amount), 0), 'D-25'
  FROM core.bank_sale_attribution_queue WHERE state IN ('no_candidate', 'weak')
  UNION ALL
  SELECT 'agents', 'AG-10', 'high', 'فروش بانکی با نشانه‌های متعارض (چند نماینده یا کد ملی ناسازگار)', count(*), coalesce(sum(total_amount), 0), 'D-25'
  FROM core.bank_sale_attribution_queue WHERE state = 'conflict'
  UNION ALL
  SELECT 'agents', 'AG-11', 'medium', 'پیشنهاد انتساب قوی در انتظار تأیید', count(*), coalesce(sum(total_amount), 0), 'D-25'
  FROM core.bank_sale_attribution_queue WHERE state = 'proposed'
  UNION ALL
  SELECT 'agents', 'AG-12', 'medium', 'معامله اعلام‌شده نماینده در انتظار تأیید مبلغ پایه (بیش از مهلت)', count(*), coalesce(sum(base_amount), 0), 'D-22'
  FROM core.agent_deal WHERE status = 'declared'
    AND declared_at + make_interval(hours => core.setting_value('agent_base_settlement_hours')::int) < least(now(), p_as_of::timestamptz + interval '1 day')
  UNION ALL
  SELECT 'agents', 'AG-13', 'medium', 'شارژ کیف پول درناتل که با سوابق درناتل تأیید نشده', count(*), coalesce(sum(amount), 0), 'D-22, D-27'
  FROM core.dornatel_wallet_charge WHERE status = 'recorded' AND reversed_at IS NULL AND charged_at::date < p_as_of
  UNION ALL
  SELECT 'agents', 'AG-14', 'medium', 'پرداخت بانکی به نماینده که با صورت‌حساب بانک تطبیق نشده', count(*), coalesce(sum(amount), 0), 'D-22'
  FROM core.agent_settlement WHERE method = 'bank_transfer' AND reversed_at IS NULL AND statement_line_id IS NULL
    AND paid_at + core.setting_value('agent_bank_settlement_match_days')::int < p_as_of
  UNION ALL
  SELECT 'agents', 'AG-15', 'high', 'ناسازگاری معامله نماینده با فروش بانکی (مبلغ پایه ≥ مبلغ کل بتا، یا مبلغ کل اعلام‌شده متفاوت)', count(*),
         coalesce(sum(l.base_amount), 0), 'D-22'
  FROM core.agent_deal_lineage l JOIN core.agent_deal d ON d.id = l.deal_id
  WHERE l.bank_ref IS NOT NULL AND l.deal_status IN ('declared', 'approved')
    AND (l.base_amount >= l.beta_total OR (d.declared_beta_total IS NOT NULL AND d.declared_beta_total <> l.beta_total) OR NOT l.customer_matches)
  UNION ALL
  SELECT 'agents', 'AG-16', 'info', 'تفاوت مبلغ کل بتا و مبلغ پایه نماینده (تفکیک‌نشده؛ سود نیست تا D-14/D-26)', count(*),
         coalesce(sum(unallocated_difference), 0), 'D-14, D-26'
  FROM core.agent_deal_lineage WHERE deal_status = 'approved' AND bank_ref IS NOT NULL $$;

ALTER FUNCTION core.control_inbox(date) RENAME TO control_inbox_v21;
CREATE FUNCTION core.control_inbox(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT * FROM core.control_inbox_v21(p_as_of) UNION ALL SELECT * FROM core.agent_deal_controls(p_as_of) $$;

-- ============ Agent workspace additions ============
CREATE FUNCTION core.agent_my_deals(p_user text)
RETURNS TABLE (deal_id bigint, sale_date date, national_id text, customer_name text, goods text, base_amount numeric, status text, status_fa text,
               matched_with_bank boolean, owed numeric, paid_by_bank numeric, paid_by_wallet numeric, open_amount numeric) LANGUAGE sql STABLE AS $$
  SELECT l.deal_id, l.sale_date, l.customer_national_id, d.customer_name, l.goods_description, l.base_amount, l.deal_status,
         CASE l.deal_status WHEN 'declared' THEN 'در انتظار تأیید' WHEN 'approved' THEN 'تأییدشده' WHEN 'rejected' THEN 'ردشده' ELSE 'لغوشده' END,
         l.bank_ref IS NOT NULL, l.owed_to_agent, l.paid_by_bank + l.paid_by_cash, l.paid_by_wallet, l.open_to_agent
  FROM core.agent_deal_lineage l JOIN core.agent_deal d ON d.id = l.deal_id
  WHERE l.agent_id = core.require_agent(p_user) ORDER BY l.sale_date DESC, l.deal_id DESC $$;

INSERT INTO core.operation_catalog (operation, kind, function_signature, purpose, permission, effect, undo, basis, ai_allowed, agent_allowed) VALUES
  ('agent.deal_declare', 'write', 'core.agent_deal_declare(text,text,text,date,text,numeric,text,text,numeric,text,integer,integer)',
   'declare an agent deal made in the bank panel with its base amount and evidence (agent: own; staff: any agent)', NULL,
   'adds a declared deal; nothing is owed until a person approves it. Checked inside: agent.workspace (own) or agent.deal_manage', 'reject', 'D-22, D-25', true, true),
  ('agent.my_deals', 'read', 'core.agent_my_deals(text)', 'the agent''s own deals: base amount, owed, paid by bank / wallet, open', NULL, 'none', '—', 'D-22', true, true),
  ('agent.deal_correct', 'write', 'core.agent_deal_correct(bigint,numeric,text,text,text,text)', 'correct a declared deal''s base amount before approval',
   'agent.deal_manage', 'updates the declared deal; before/after in the audit', 'correct again', 'D-22', true, false),
  ('agent.deal_approve', 'write', 'core.agent_deal_approve(bigint,text)', 'approve a deal: Almas owes the agent exactly its base amount', 'agent.deal_approve',
   'deal approved + one deal_base entitlement', 'core.agent_deal_adjust / reverse entitlement', 'D-22', false, false),
  ('agent.deal_close', 'write', 'core.agent_deal_close(bigint,text,text,text)', 'reject a declared deal or cancel one without live entitlements', 'agent.deal_approve',
   'status change; audited', '—', 'D-22', false, false),
  ('agent.deal_adjust', 'write', 'core.agent_deal_adjust(bigint,numeric,text,text,text)', 'signed correction of an approved deal with evidence', 'agent.deal_approve',
   'adds an adjustment entitlement', 'reverse the adjustment', 'D-22', false, false),
  ('agent.attribution_queue', 'read', 'core.bank_sale_candidates(integer)', 'matching signals of bank sales not yet attributed to an agent', NULL, 'none', '—', 'D-25', true, false),
  ('agent.attribute', 'write', 'core.agent_attribute(integer,text,text,integer,bigint,text,text,text)',
   'attribute a bank sale to an agent (and deal) on evidence, or manually with a reason', 'agent.attribute',
   'adds an attribution (append-only; latest is current)', 'attribute again (history kept)', 'D-25', true, false),
  ('agent.attribute_auto', 'write', 'core.agent_attribute_auto(integer,text)', 'apply unambiguous strong proposals (setting agent_auto_attribution)', 'agent.attribute',
   'adds attributions', 'attribute again', 'D-25', true, false),
  ('agent.identity_record', 'write', 'core.agent_identity_record(integer,integer,text,text,date,date,text,text)',
   'record which bank-panel registrar identity belongs to an agent (Almas issued the access)', 'agent.identity', 'adds an identity mapping', 'core.agent_identity_reverse', 'D-25, E28', true, false),
  ('agent.identity_reverse', 'write', 'core.agent_identity_reverse(bigint,text,text)', 'withdraw a wrong identity mapping', 'agent.identity', 'marks it reversed', '—', 'D-25', true, false),
  ('agent.settle', 'write', 'core.agent_settle(integer,text,numeric,date,jsonb,text,integer,text,text,text,text,timestamp with time zone,text,text)',
   'pay an agent by bank transfer, cash or Dornatel wallet charge, allocated to its deals', 'agent.settle',
   'adds a settlement (and the wallet charge) with allocations, atomically', 'core.agent_reverse_settlement / core.dornatel_wallet_reverse', 'D-22', false, false),
  ('agent.wallet_confirm', 'write', 'core.dornatel_wallet_confirm(bigint,text,text)', 'confirm a wallet charge against Dornatel''s records', 'agent.settle',
   'marks it confirmed with the confirmation reference', '—', 'D-22', false, false),
  ('agent.wallet_reverse', 'write', 'core.dornatel_wallet_reverse(bigint,text,text,text)', 'reverse a wallet charge (and its settlement) with Dornatel''s reversal reference',
   'agent.settle', 'marks both reversed', '—', 'D-22', false, false),
  ('agent.controls', 'read', 'core.agent_deal_controls(date)', 'agent-deal controls (base, attribution, settlement, wallet)', NULL, 'none', '—', 'D-22, D-25', true, false);

-- approving a deal creates a debt to the agent: like paying it, a person decides (an AI agent may prepare)
CREATE OR REPLACE FUNCTION core.require_permission(p_user text, p_perm text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT core.has_permission(p_user, p_perm) THEN
    RAISE EXCEPTION 'permission denied: user % lacks %', p_user, p_perm USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_perm IN ('period.close', 'period.reopen', 'security.admin', 'settings.change', 'beta.order_change', 'agent.settle', 'agent.deal_approve')
     AND coalesce((SELECT is_ai_agent FROM core.app_user WHERE username = p_user), false) THEN
    RAISE EXCEPTION 'permission denied: % is reserved for people; an AI agent (%) may prepare, a person decides', p_perm, p_user
      USING ERRCODE = 'insufficient_privilege'; END IF;
END $$;
