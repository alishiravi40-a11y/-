-- Almas Shahr accounting — core v0.24: catalogued read operations for the agent screens (central staff) — the UI, the API
-- and an AI agent read exactly the same thing. No rule lives here; these are thin, documented windows on 022/023.

-- performance: the 023 view re-evaluated the report views per row through correlated subqueries (8.7 s for 3 sales in the UI
-- trial). Same columns and meaning; every source is computed once.
CREATE OR REPLACE VIEW core.agent_person_separation AS
WITH r AS MATERIALIZED (SELECT agent_id, bank_ref, beta_total, owed_to_agent, open_to_agent FROM core.agent_sales_report),
ra AS (SELECT agent_id, count(*) FILTER (WHERE bank_ref IS NOT NULL) AS sales, coalesce(sum(beta_total), 0) AS beta_total,
              coalesce(sum(owed_to_agent), 0) AS owed, coalesce(sum(open_to_agent), 0) AS open FROM r GROUP BY agent_id),
cs AS MATERIALIZED (SELECT c.party_id, count(*) FILTER (WHERE c.status <> 'draft') AS n,
                           coalesce(sum(s.outstanding_amount), 0) AS outstanding
                    FROM core.installment_contract c LEFT JOIN core.contract_status s ON s.contract_id = c.id
                    WHERE c.party_id IN (SELECT party_id FROM core.sales_agent WHERE party_id IS NOT NULL) GROUP BY c.party_id),
lg AS MATERIALIZED (SELECT agent_id, sum(legacy_balance) AS bal, sum(buyer_amount) AS buyers, sum(unclassified_amount) AS unclassified
                    FROM core.legacy_aggregate_status GROUP BY agent_id)
SELECT g.id AS agent_id, g.code, g.party_id AS agent_party_id,
       coalesce(ra.sales, 0) AS sales_as_agent, coalesce(ra.beta_total, 0) AS buyers_beta_total, coalesce(ra.owed, 0) AS owed_to_agent,
       coalesce(ra.open, 0) AS open_to_agent,
       coalesce(cs.n, 0) AS own_contracts_as_customer, coalesce(cs.outstanding, 0) AS own_outstanding_as_customer,
       coalesce(lg.bal, 0) AS legacy_aggregate_balance, coalesce(lg.buyers, 0) AS legacy_classified_to_buyers, coalesce(lg.unclassified, 0) AS legacy_unclassified
FROM core.sales_agent g LEFT JOIN ra ON ra.agent_id = g.id LEFT JOIN cs ON cs.party_id = g.party_id LEFT JOIN lg ON lg.agent_id = g.id;

CREATE FUNCTION core.agents_list() RETURNS TABLE (agent_id int, code text, title text, province text, city text, status text) LANGUAGE sql STABLE AS $$
  SELECT id, code, title, province, city, status FROM core.sales_agent ORDER BY code $$;

-- per agent: its three roles side by side (agent / customer / legacy), never mixed (023)
CREATE FUNCTION core.agents_overview()
RETURNS TABLE (agent_id int, code text, title text, sales_as_agent bigint, buyers_beta_total numeric, owed_to_agent numeric, open_to_agent numeric,
               own_contracts_as_customer bigint, legacy_aggregate_balance numeric, legacy_unclassified numeric) LANGUAGE sql STABLE AS $$
  SELECT s.agent_id, s.code, g.title, s.sales_as_agent, s.buyers_beta_total, s.owed_to_agent, s.open_to_agent, s.own_contracts_as_customer,
         s.legacy_aggregate_balance, s.legacy_unclassified
  FROM core.agent_person_separation s JOIN core.sales_agent g ON g.id = s.agent_id ORDER BY s.code $$;

-- one agent's sales, each with its REAL buyer (023 agent_sales_report)
CREATE FUNCTION core.agent_report(p_agent int)
RETURNS TABLE (bank_ref text, registered_at timestamp, buyer_national_id text, buyer_name text, beta_total numeric, deal_id bigint, base_amount numeric,
               owed_to_agent numeric, settled numeric, open_to_agent numeric, settlement_methods text[], state_fa text, attribution_method text) LANGUAGE sql STABLE AS $$
  SELECT bank_ref, registered_at, buyer_national_id, buyer_name, beta_total, deal_id, base_amount, owed_to_agent, settled, open_to_agent, settlement_methods,
         state_fa, attribution_method
  FROM core.agent_sales_report WHERE agent_id = p_agent ORDER BY registered_at DESC NULLS FIRST, deal_id DESC $$;

-- deals declared by agents, waiting for a person to approve the base amount, with what the bank shows
CREATE FUNCTION core.agent_deals_pending()
RETURNS TABLE (deal_id bigint, agent_code text, sale_date date, customer_national_id text, goods_description text, base_amount numeric,
               base_amount_source text, evidence_ref text, bank_ref text, beta_total numeric, customer_matches boolean, declared_at timestamptz) LANGUAGE sql STABLE AS $$
  SELECT l.deal_id, l.agent_code, l.sale_date, l.customer_national_id, l.goods_description, l.base_amount, l.base_amount_source, l.evidence_ref,
         l.bank_ref, l.beta_total, l.customer_matches, d.declared_at
  FROM core.agent_deal_lineage l JOIN core.agent_deal d ON d.id = l.deal_id WHERE l.deal_status = 'declared' ORDER BY d.declared_at $$;

-- bank sales waiting for attribution, with the matching proposal and its reasons
CREATE FUNCTION core.attribution_queue(p_limit int DEFAULT 200)
RETURNS TABLE (scheme_id int, source text, ref text, national_id text, total_amount numeric, registered_at timestamp, state text,
               proposed_agent_id int, proposed_agent_code text, proposed_deal_id bigint, reasons text) LANGUAGE sql STABLE AS $$
  SELECT q.scheme_id, q.source, q.ref, q.national_id, q.total_amount, q.registered_at, q.state, q.proposed_agent_id, g.code, q.proposed_deal_id,
         (SELECT string_agg(DISTINCT s ->> 'detail', '؛ ') FROM jsonb_array_elements(coalesce(q.signals, '[]')) s)
  FROM core.bank_sale_attribution_queue q LEFT JOIN core.sales_agent g ON g.id = q.proposed_agent_id
  ORDER BY CASE q.state WHEN 'proposed' THEN 1 WHEN 'conflict' THEN 2 WHEN 'weak' THEN 3 ELSE 4 END, q.registered_at DESC NULLS LAST
  LIMIT least(p_limit, 1000) $$;

-- what is still owed to an agent, per entitlement (for the settlement form)
CREATE FUNCTION core.agent_open_entitlements(p_agent int)
RETURNS TABLE (entitlement_id bigint, deal_id bigint, contract_id bigint, basis text, amount numeric, settled numeric, open_amount numeric, created_at timestamptz,
               customer_national_id text) LANGUAGE sql STABLE AS $$
  SELECT e.id, e.deal_id, e.contract_id, e.basis, e.amount, e.settled, e.open_amount, e.created_at, d.national_id
  FROM core.agent_entitlement_status e LEFT JOIN core.agent_deal d ON d.id = e.deal_id
  WHERE e.agent_id = p_agent AND e.reversed_at IS NULL AND e.open_amount <> 0 ORDER BY e.created_at $$;

-- Almas's own bank accounts (where a transfer to an agent is paid from; tied later to the statement line)
CREATE FUNCTION core.company_bank_accounts_list() RETURNS TABLE (bank_account_id int, title text, bank_code text, account_no text) LANGUAGE sql STABLE AS $$
  SELECT id, title, bank_code, account_no FROM core.company_bank_account ORDER BY title $$;

INSERT INTO core.operation_catalog (operation, kind, function_signature, purpose, permission, effect, undo, basis, ai_allowed, agent_allowed) VALUES
  ('agents.list', 'read', 'core.agents_list()', 'the sales agents', NULL, 'none', '—', 'D-22', true, false),
  ('bank_accounts.list', 'read', 'core.company_bank_accounts_list()', 'Almas''s own bank accounts (payments to agents, statements)', NULL, 'none', '—', 'D-22', true, false),
  ('agents.overview', 'read', 'core.agents_overview()', 'per agent: sales as agent, own purchases as customer, legacy on its account — kept apart', NULL,
   'none', '—', 'E29', true, false),
  ('agents.report', 'read', 'core.agent_report(integer)', 'an agent''s sales with the real buyer, Beta total, base amount, owed, settled, open and method',
   NULL, 'none', '—', 'D-22, E29', true, false),
  ('agents.deals_pending', 'read', 'core.agent_deals_pending()', 'agent deals waiting for approval of their base amount', NULL, 'none', '—', 'D-22', true, false),
  ('agents.attribution_queue', 'read', 'core.attribution_queue(integer)', 'bank sales waiting for attribution with the matching proposal and reasons',
   NULL, 'none', '—', 'D-25, E28', true, false),
  ('agents.open_entitlements', 'read', 'core.agent_open_entitlements(integer)', 'what is still owed to an agent, per deal', NULL, 'none', '—', 'D-22', true, false);
