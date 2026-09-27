-- Almas Shahr accounting — core v0.13: machine-readable catalog for controlled use by AI agents (AI-native from the root).
--
-- An AI agent is an ordinary user of the core: it acts only through the catalogued operations, needs the SAME
-- permissions as a person, and every write it makes is recorded exactly like a person's (append-only tables, reversal
-- instead of edit, audit). The catalog tells an agent — and a human reviewer — what exists, what each operation does,
-- which permission it needs, how its effect is undone and which evidence or owner decision it rests on. The catalog is
-- itself checked by tests: every function and permission named here must exist.

ALTER TABLE core.app_user ADD COLUMN is_ai_agent boolean NOT NULL DEFAULT false;

CREATE TABLE core.operation_catalog (
  operation text PRIMARY KEY,                     -- stable name, e.g. 'ar.allocate'
  kind text NOT NULL CHECK (kind IN ('read', 'write')),
  function_signature text NOT NULL,               -- regprocedure text, e.g. 'core.allocate(bigint,integer,bigint,integer,numeric,text,text)'
  purpose text NOT NULL,
  permission text REFERENCES core.permission,     -- NULL = read-only, no permission beyond database access
  effect text NOT NULL,                           -- what changes, and that it is append-only / derived
  undo text NOT NULL,                             -- how the effect is reversed ('—' for reads)
  basis text NOT NULL,                            -- evidence (E-xx), owner decision (D-xx) or weakness (W-xx) it rests on
  ai_allowed boolean NOT NULL DEFAULT true);      -- false = reserved for people (e.g. closing a year)

CREATE FUNCTION core.trg_catalog_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF to_regprocedure(NEW.function_signature) IS NULL THEN RAISE EXCEPTION 'catalog: function % does not exist', NEW.function_signature; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_check BEFORE INSERT OR UPDATE ON core.operation_catalog FOR EACH ROW EXECUTE FUNCTION core.trg_catalog_check();

INSERT INTO core.operation_catalog VALUES
  ('ledger.trial_balance', 'read', 'core.trial_balance_levels(text,date,date,boolean)', 'four-column trial balance at every level', NULL, 'none', '—', 'E20 (= Holoo)', true),
  ('ledger.account_ledger', 'read', 'core.account_ledger(text,integer,integer,date,date,boolean)', 'ledger of an account or party with running balance', NULL, 'none', '—', 'E20 (= spMoienAshkhas)', true),
  ('ledger.party_balance', 'read', 'core.party_balance_at(text,date)', 'balance of every party at a date (closing entries excluded)', NULL, 'none', '—', 'E20 (= Calc_Mandeh_CustomerFuncDate)', true),
  ('ar.open_items', 'read', 'core.open_items_at(date)', 'open receivable/payable items at a date', NULL, 'none', '—', 'TRE-07, W-17', true),
  ('ar.aging', 'read', 'core.aging(date)', 'aging per party; net equals the ledger balance', NULL, 'none', '—', 'E21', true),
  ('ar.allocate', 'write', 'core.allocate(bigint,integer,bigint,integer,numeric,text,text)', 'settle a debit item with a credit item of the same party', 'ar.allocate',
   'adds one settlement (append-only); never more than what is open', 'core.undo_settlement with a reason', 'TRE-07, W-17', true),
  ('ar.allocate_fifo', 'write', 'core.allocate_fifo(integer,integer,text,text)', 'settle a party''s open items oldest first (reversal pairs first)', 'ar.allocate',
   'adds settlements (append-only)', 'core.undo_settlement per settlement', 'TRE-07', true),
  ('ar.unallocate', 'write', 'core.undo_settlement(bigint,text,text)', 'undo one settlement', 'ar.unallocate', 'adds an undo record; the settlement stays in history', '—', 'TRE-07', true),
  ('bank.reconciliation', 'read', 'core.bank_reconciliation(integer,date,date)', 'reconciliation statement; unexplained must be 0', NULL, 'none', '—', 'W-36', true),
  ('bank.reconcile', 'write', 'core.reconcile(integer,bigint[],jsonb,text,text,text)', 'tie statement lines to book lines of equal net amount', 'bank.reconcile',
   'adds one reconciliation group (append-only)', 'core.unreconcile with a reason', 'W-36', true),
  ('bank.unreconcile', 'write', 'core.unreconcile(bigint,text,text)', 'undo a reconciliation group', 'bank.unreconcile', 'adds an undo record', '—', 'W-36', true),
  ('treasury.posting_rule', 'read', 'core.treasury_posting_lines(jsonb)', 'the voucher lines of a receipt / payment / transfer / bank fee (pure rule)', NULL, 'none', '—', 'E19 (= Holoo 7,762/7,762)', true),
  ('document.posting_rule', 'read', 'core.document_posting_lines(jsonb)', 'the voucher lines of a sale / purchase / return / waste (pure rule)', NULL, 'none', '—', 'E17 (= Holoo 20,828/20,828)', true),
  ('cheque.location', 'read', 'core.cheque_event_lines(bigint)', 'the voucher lines of one cheque event (debit to, credit from)', NULL, 'none', '—', 'E18', true),
  ('inventory.kardex', 'read', 'core.item_kardex(integer,date)', 'kardex of an item with quantity, average cost and the cost of every movement', NULL, 'none', '—', 'E23', true),
  ('inventory.valuation', 'read', 'core.inventory_valuation(date)', 'stock and value per item × warehouse at a date', NULL, 'none', '—', 'E22, E23', true),
  ('year.closing_rule', 'read', 'core.year_end_lines(text,numeric,integer)', 'the closing entries a year would get (pure rule)', NULL, 'none', '—', 'E22 (= Holoo 1404)', true),
  ('year.close', 'write', 'core.close_fiscal_year(text,numeric,text,integer,text,text)', 'close a fiscal year (temporary + permanent closing)', 'period.close',
   'posts two closing entries; the year must be in status closing', 'controlled reopening (D-05): reversal entries, audited', 'D-05, W-19', false),
  ('year.open_next', 'write', 'core.open_next_fiscal_year(text,text,text)', 'generate the next year''s opening from the closing', 'period.close',
   'posts the opening entry once (idempotent)', 'controlled reopening (D-05)', 'W-19', false);

-- what an agent (or anyone) may do right now: catalogued operations and whether this user holds the permission
CREATE FUNCTION core.operations_for(p_user text)
RETURNS TABLE (operation text, kind text, function_signature text, purpose text, permitted boolean, undo text, basis text) LANGUAGE sql STABLE AS $$
  SELECT c.operation, c.kind, c.function_signature, c.purpose,
         (c.permission IS NULL OR core.has_permission(p_user, c.permission))
         AND (c.ai_allowed OR NOT coalesce((SELECT is_ai_agent FROM core.app_user WHERE username = p_user), false)),
         c.undo, c.basis
  FROM core.operation_catalog c ORDER BY c.kind, c.operation $$;

-- operations reserved for people are refused to AI agents at the source, not only in the catalog
CREATE OR REPLACE FUNCTION core.require_permission(p_user text, p_perm text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT core.has_permission(p_user, p_perm) THEN
    RAISE EXCEPTION 'permission denied: user % lacks %', p_user, p_perm USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_perm IN ('period.close', 'period.reopen', 'security.admin', 'settings.change')
     AND coalesce((SELECT is_ai_agent FROM core.app_user WHERE username = p_user), false) THEN
    RAISE EXCEPTION 'permission denied: % is reserved for people; an AI agent (%) may prepare, a person decides', p_perm, p_user
      USING ERRCODE = 'insufficient_privilege'; END IF;
END $$;

-- self-description: every table, view and function of the core with its documentation comment
CREATE VIEW core.schema_catalog AS
SELECT 'relation' AS object_kind, c.relname AS name, obj_description(c.oid, 'pg_class') AS description
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'core' WHERE c.relkind IN ('r', 'v')
UNION ALL
SELECT 'function', p.oid::regprocedure::text, obj_description(p.oid, 'pg_proc')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'core';

COMMENT ON TABLE core.journal_entry IS 'accounting voucher; posted entries are immutable, corrected only by reversal (W-03, W-05)';
COMMENT ON TABLE core.journal_line IS 'voucher line: one side only, account + party for sub-ledger accounts (D-03)';
COMMENT ON TABLE core.settlement IS 'which debit item a credit item settles; append-only, undone by settlement_undo (TRE-07)';
COMMENT ON TABLE core.stock_movement IS 'stock movement of a model in a warehouse; immutable; cost is derived by core.item_kardex (E23)';
COMMENT ON TABLE core.cheque_event IS 'cheque event with explicit from/to location; posted as debit to / credit from (E18)';
COMMENT ON TABLE core.bank_recon_group IS 'statement lines tied to book lines of equal net amount; append-only (W-36)';
COMMENT ON TABLE core.operation_catalog IS 'machine-readable list of core operations: permission, effect, undo, basis (AI-native)';
