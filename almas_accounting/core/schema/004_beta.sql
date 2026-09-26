-- Almas Shahr accounting — core v0.4: parties (D-03/D-18), Beta schemes, installment contracts, installments,
-- bank collections, direct payments, overpayment credits, refunds, cancellations, bank statements, Beta snapshots.
-- Design: docs/BETA_INSTALLMENTS_DESIGN_FA.md v0.5. Proven by core/tests/test_beta.py and beta/tests.
--
-- Open decisions are kept OPEN by construction (no redesign needed when they close):
--   D-14  bank-share accounting (gross | pass_through): no journal posting is generated for Beta events yet; every event
--         carries journal_entry_id (NULL = not posted) and core.beta_unposted lists them. setting beta_bank_share_accounting.
--   Q-1   which scheme a Beta-system export belongs to: the importer REQUIRES an explicit scheme; nothing is inferred.
--   Q-2   how the bank share is withdrawn: bank_share_withdrawal is many-to-one (allocatable to many installments or none),
--         starts as an unconfirmed candidate, and never changes a receivable.
-- Legacy (Holoo) data: read-only from holoo_mirror via beta/legacy.py; lineage in party_legacy_code / legacy_balance.

-- ============ Permissions and settings ============
INSERT INTO core.permission VALUES
  ('party.merge',             'merge / unmerge party records after identity verification (D-18)'),
  ('beta.scheme_manage',      'create Beta schemes, bank accounts and bank-share rates'),
  ('beta.contract_manage',    'create and activate installment contracts'),
  ('beta.capacity_override',  'activate a contract without a verified installment capacity (D-17)'),
  ('beta.receipt_manage',     'record / allocate / reverse receipts'),
  ('beta.refund',             'refund an overpayment credit (D-16)'),
  ('beta.credit_reallocate',  'reallocate an overpayment credit to another installment (manual only, D-16)'),
  ('beta.review',             'review imported cancellations / amendments / matches');

INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('beta_bank_share_accounting', 'undecided', '{undecided,gross,pass_through}', NULL, 'D-14'),
  -- where floor(total/count) remainder goes; NOT proven from Beta data (E15) — configurable, default last installment
  ('beta_schedule_remainder', 'last', '{last,first}', NULL, 'E15'),
  ('beta_overdue_grace_days', '0', NULL, '^[0-9]{1,3}$', 'B-01');

-- ============ Parties: identity (D-18) and legacy lineage ============
CREATE FUNCTION core.valid_national_id(p text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s int := 0; c int;
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{10}$' OR p ~ '^(.)\1{9}$' THEN RETURN false; END IF;
  FOR i IN 1..9 LOOP s := s + substr(p, i, 1)::int * (11 - i); END LOOP;
  s := s % 11; c := substr(p, 10, 1)::int;
  RETURN (s < 2 AND c = s) OR (s >= 2 AND c = 11 - s);
END $$;

ALTER TABLE core.party
  ADD COLUMN name_key text,                                   -- normalized name (search / suspicious-duplicate detection only)
  ADD COLUMN national_id_claim text,                          -- a national id asserted by a source but not (yet) verified as this party's
  ADD COLUMN merged_into_id int REFERENCES core.party,        -- set by merge; the record is never deleted
  ADD CONSTRAINT party_national_id_valid CHECK (national_id IS NULL OR core.valid_national_id(national_id));
COMMENT ON COLUMN core.party.holoo_c_code IS 'deprecated (v0.1): use core.party_legacy_code — one party can have many legacy codes';

CREATE TABLE core.party_legacy_code (
  id bigserial PRIMARY KEY, party_id int NOT NULL REFERENCES core.party,
  source_system text NOT NULL DEFAULT 'holoo', source_db text NOT NULL, legacy_code text NOT NULL,     -- Holoo C_Code
  legacy_name text, legacy_national_code text, legacy_debit_account text, legacy_credit_account text,
  legacy_tags text[] NOT NULL DEFAULT '{}',                    -- e.g. {beta} from «(بتا)» in the Holoo account name
  source_row_hash text, first_seen_run text, last_seen_run text,
  link_rule text NOT NULL CHECK (link_rule IN ('new_party', 'same_legacy_code_other_year', 'manual_merge')),
  UNIQUE (source_system, source_db, legacy_code));

CREATE TABLE core.party_bank_account (
  id bigserial PRIMARY KEY, party_id int NOT NULL REFERENCES core.party, bank_code text NOT NULL DEFAULT 'unknown',
  account_no text NOT NULL, source text NOT NULL, first_seen timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_code, account_no));

CREATE TABLE core.party_merge (
  id bigserial PRIMARY KEY, source_party_id int NOT NULL REFERENCES core.party, target_party_id int NOT NULL REFERENCES core.party,
  reason text NOT NULL, merged_by text NOT NULL, merged_at timestamptz NOT NULL DEFAULT now(), moved jsonb NOT NULL,
  undone_at timestamptz, undone_by text, undo_reason text, CHECK (source_party_id <> target_party_id));

-- ============ Company bank accounts, Beta schemes, bank-share rates ============
CREATE TABLE core.company_bank_account (
  id serial PRIMARY KEY, bank_code text NOT NULL, account_no text NOT NULL, title text NOT NULL,
  holder_party_id int REFERENCES core.party, account_type text, gl_account_id int REFERENCES core.account,
  UNIQUE (bank_code, account_no));

CREATE TABLE core.beta_scheme (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, title text NOT NULL,
  holder_party_id int NOT NULL REFERENCES core.party,                    -- the person in whose name the scheme is
  company_bank_account_id int NOT NULL REFERENCES core.company_bank_account,   -- where the bank deposits installments
  bank_scheme_ref text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  capacity_limit numeric(20,0), capacity_note text,                      -- D-17: scheme capacity NOT modelled until evidenced
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE core.bank_share_rate (
  scheme_id int NOT NULL REFERENCES core.beta_scheme, effective_from date NOT NULL,
  rate numeric(7,6) NOT NULL CHECK (rate BETWEEN 0.01 AND 0.10),         -- 1%..10% (owner)
  created_by text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scheme_id, effective_from));
CREATE TRIGGER bank_share_rate_immutable BEFORE UPDATE OR DELETE ON core.bank_share_rate FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

CREATE FUNCTION core.bank_share_rate_at(p_scheme int, p_date date) RETURNS core.bank_share_rate LANGUAGE sql STABLE AS $$
  SELECT * FROM core.bank_share_rate WHERE scheme_id = p_scheme AND effective_from <= p_date ORDER BY effective_from DESC LIMIT 1 $$;

-- D-17: the customer's maximum installment (from the Beta system), versioned
CREATE TABLE core.customer_installment_capacity (
  id bigserial PRIMARY KEY, party_id int NOT NULL REFERENCES core.party,
  max_installment_amount numeric(20,0) NOT NULL CHECK (max_installment_amount > 0),
  valid_from date NOT NULL, valid_to date, source text NOT NULL CHECK (source IN ('beta_system', 'manual')),
  evidence_ref text, recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from));

-- ============ Imports (provenance, idempotency) ============
CREATE TABLE core.import_file (
  id bigserial PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('bank_statement', 'beta_contract_snapshot')),
  sha256 text NOT NULL, file_name text, scheme_id int REFERENCES core.beta_scheme,
  company_bank_account_id int REFERENCES core.company_bank_account,
  imported_by text NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(), stats jsonb,
  UNIQUE (kind, sha256));

-- ============ Beta-system snapshots (Q-1: scheme chosen explicitly at import) ============
CREATE TABLE core.beta_contract_snapshot (
  file_id bigint NOT NULL REFERENCES core.import_file, bank_contract_id text NOT NULL, national_code text NOT NULL,
  registered_at timestamp, total_amount numeric(20,0) NOT NULL, installment_count int NOT NULL, first_due_date date NOT NULL,
  first_installment_amount numeric(20,0) NOT NULL, collected_count int NOT NULL, collected_amount numeric(20,0) NOT NULL,
  overdue_count int NOT NULL, cancelled_count int NOT NULL, customer_account_no text, row_hash text NOT NULL,
  PRIMARY KEY (file_id, bank_contract_id));
CREATE TRIGGER beta_contract_snapshot_immutable BEFORE UPDATE OR DELETE ON core.beta_contract_snapshot FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

-- ============ Installment contracts and schedules ============
CREATE TABLE core.installment_contract (
  id bigserial PRIMARY KEY, scheme_id int NOT NULL REFERENCES core.beta_scheme, party_id int NOT NULL REFERENCES core.party,
  bank_contract_id text,                                                  -- «شناسه» in the Beta system
  registered_at timestamp, sale_ref text,
  total_amount numeric(20,0) NOT NULL CHECK (total_amount > 0),           -- customer debt = sum of installments
  goods_amount numeric(20,0), bank_share_amount numeric(20,0), store_fee_amount numeric(20,0),   -- D-15: kept apart
  bank_share_rate numeric(7,6), bank_share_rate_from date,                -- rate version snapshot
  installment_count int NOT NULL CHECK (installment_count BETWEEN 1 AND 120), first_due_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed', 'cancelled')),
  capacity_check text CHECK (capacity_check IN ('passed', 'unverified', 'imported_from_beta')), capacity_note text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'beta_import')), source_import_file_id bigint REFERENCES core.import_file,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), activated_by text, activated_at timestamptz,
  journal_entry_id bigint REFERENCES core.journal_entry,                  -- D-14: posting pending
  UNIQUE (scheme_id, bank_contract_id),
  CHECK ((goods_amount IS NULL AND bank_share_amount IS NULL AND store_fee_amount IS NULL)
         OR coalesce(goods_amount, 0) + coalesce(bank_share_amount, 0) + coalesce(store_fee_amount, 0) = total_amount),
  CHECK (goods_amount IS NULL OR goods_amount >= 0), CHECK (bank_share_amount IS NULL OR bank_share_amount >= 0),
  CHECK (store_fee_amount IS NULL OR store_fee_amount >= 0));
CREATE INDEX installment_contract_party ON core.installment_contract (party_id);

CREATE TABLE core.installment (
  id bigserial PRIMARY KEY, contract_id bigint NOT NULL REFERENCES core.installment_contract, seq int NOT NULL CHECK (seq >= 1),
  due_date date NOT NULL, amount numeric(20,0) NOT NULL CHECK (amount > 0),
  goods_part numeric(20,0), bank_share_part numeric(20,0), store_fee_part numeric(20,0),
  UNIQUE (contract_id, seq));

-- contract rules: content frozen after activation; activation validates schedule, capacity and permission
CREATE FUNCTION core.trg_contract_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int; s numeric; bad int; cap numeric; peak numeric; r core.bank_share_rate;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'contract % is not a draft; cancel it instead', OLD.id; END IF;
    RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    IF (NEW.scheme_id, NEW.party_id, NEW.bank_contract_id, NEW.total_amount, NEW.installment_count, NEW.first_due_date,
        NEW.goods_amount, NEW.bank_share_amount, NEW.store_fee_amount) IS DISTINCT FROM
       (OLD.scheme_id, OLD.party_id, OLD.bank_contract_id, OLD.total_amount, OLD.installment_count, OLD.first_due_date,
        OLD.goods_amount, OLD.bank_share_amount, OLD.store_fee_amount)
       AND coalesce(current_setting('almas.controlled_change', true), 'off') <> 'on' THEN
      RAISE EXCEPTION 'active contract % is immutable; record an amendment', OLD.id; END IF;
    IF OLD.status IN ('closed', 'cancelled') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'contract % is %', OLD.id, OLD.status; END IF;
  END IF;
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    IF NEW.activated_by IS NULL THEN RAISE EXCEPTION 'activated_by is required'; END IF;
    PERFORM core.require_permission(NEW.activated_by, 'beta.contract_manage');
    SELECT count(*), coalesce(sum(amount), 0) INTO n, s FROM core.installment WHERE contract_id = NEW.id;
    IF n <> NEW.installment_count OR s <> NEW.total_amount THEN
      RAISE EXCEPTION 'schedule of contract % is invalid: % installments / sum % (expected % / %)', NEW.id, n, s, NEW.installment_count, NEW.total_amount; END IF;
    SELECT count(*) INTO bad FROM (SELECT seq, due_date, lag(due_date) OVER (ORDER BY seq) prev FROM core.installment WHERE contract_id = NEW.id) x
      WHERE x.prev IS NOT NULL AND x.due_date <= x.prev;
    IF bad > 0 OR (SELECT max(seq) FROM core.installment WHERE contract_id = NEW.id) <> n
       OR (SELECT due_date FROM core.installment WHERE contract_id = NEW.id AND seq = 1) <> NEW.first_due_date THEN
      RAISE EXCEPTION 'schedule of contract % must be seq 1..n with increasing due dates starting at first_due_date', NEW.id; END IF;
    IF NEW.goods_amount IS NOT NULL AND EXISTS (
         SELECT 1 FROM core.installment WHERE contract_id = NEW.id
         HAVING coalesce(sum(goods_part), -1) <> NEW.goods_amount OR coalesce(sum(bank_share_part), -1) <> NEW.bank_share_amount
             OR coalesce(sum(store_fee_part), -1) <> NEW.store_fee_amount) THEN
      RAISE EXCEPTION 'installment component parts of contract % do not add up to the contract components', NEW.id; END IF;
    -- bank-share rate snapshot (versioned rate at registration date)
    IF NEW.bank_share_rate IS NULL THEN
      r := core.bank_share_rate_at(NEW.scheme_id, coalesce(NEW.registered_at::date, current_date));
      NEW.bank_share_rate := r.rate; NEW.bank_share_rate_from := r.effective_from;
    END IF;
    -- D-17: customer installment capacity (sum of monthly installments of all active contracts of the party)
    IF NEW.source = 'beta_import' THEN
      NEW.capacity_check := 'imported_from_beta';              -- approved by the Beta system itself
    ELSE
      SELECT max_installment_amount INTO cap FROM core.customer_installment_capacity
       WHERE party_id = NEW.party_id AND valid_from <= NEW.first_due_date AND (valid_to IS NULL OR valid_to >= NEW.first_due_date)
       ORDER BY valid_from DESC, id DESC LIMIT 1;
      SELECT max(m) INTO peak FROM (
        SELECT date_trunc('month', i.due_date) mo, sum(i.amount) m FROM core.installment i JOIN core.installment_contract c ON c.id = i.contract_id
        WHERE c.party_id = NEW.party_id AND (c.id = NEW.id OR c.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM core.installment_cancellation x WHERE x.installment_id = i.id AND x.reversed_at IS NULL)
        GROUP BY 1) z;
      IF cap IS NOT NULL THEN
        IF peak > cap THEN
          RAISE EXCEPTION 'installment capacity exceeded for party %: monthly % > capacity %', NEW.party_id, peak, cap; END IF;
        NEW.capacity_check := 'passed';
      ELSE
        IF NOT core.has_permission(NEW.activated_by, 'beta.capacity_override') OR coalesce(btrim(NEW.capacity_note), '') = '' THEN
          RAISE EXCEPTION 'no installment capacity recorded for party %: record it, or activate with beta.capacity_override and a note', NEW.party_id; END IF;
        NEW.capacity_check := 'unverified';
      END IF;
    END IF;
    NEW.activated_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION core.trg_installment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM core.installment_contract WHERE id = coalesce(NEW.contract_id, OLD.contract_id)) <> 'draft' THEN
    RAISE EXCEPTION 'schedule of contract % is frozen', coalesce(NEW.contract_id, OLD.contract_id); END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER installment_rules BEFORE INSERT OR UPDATE OR DELETE ON core.installment FOR EACH ROW EXECUTE FUNCTION core.trg_installment_rules();

-- Contract amendments observed in a source (e.g. a later Beta snapshot) are recorded, never silently applied
CREATE TABLE core.contract_amendment (
  id bigserial PRIMARY KEY, contract_id bigint NOT NULL REFERENCES core.installment_contract, source_import_file_id bigint REFERENCES core.import_file,
  before jsonb NOT NULL, after jsonb NOT NULL, status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'accepted', 'rejected')),
  reviewed_by text, reviewed_at timestamptz, review_note text, created_at timestamptz NOT NULL DEFAULT now());

-- ============ Money in: receipts, allocations, overpayment credits, refunds ============
CREATE TABLE core.bank_statement_line (
  id bigserial PRIMARY KEY, company_bank_account_id int NOT NULL REFERENCES core.company_bank_account,
  value_date date NOT NULL, value_time text, doc_no text, branch text,
  deposit numeric(20,0) NOT NULL DEFAULT 0 CHECK (deposit >= 0), withdrawal numeric(20,0) NOT NULL DEFAULT 0 CHECK (withdrawal >= 0),
  balance numeric(20,0), deposit_id text, description text,
  natural_key text NOT NULL,                                -- doc_no|date|time|deposit|withdrawal|balance (row numbers are not stable)
  first_file_id bigint NOT NULL REFERENCES core.import_file, last_file_id bigint NOT NULL REFERENCES core.import_file,
  classification text NOT NULL CHECK (classification IN ('installment', 'bank_share_candidate', 'bank_fee', 'other_deposit', 'other_withdrawal')),
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('auto_matched', 'party_identified', 'needs_review', 'unmatched', 'confirmed', 'not_applicable')),
  match_detail jsonb, UNIQUE (company_bank_account_id, natural_key),
  CHECK ((deposit > 0) <> (withdrawal > 0)));
CREATE FUNCTION core.trg_statement_line_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'bank statement lines are never deleted'; END IF;
  IF (NEW.company_bank_account_id, NEW.value_date, NEW.deposit, NEW.withdrawal, NEW.balance, NEW.natural_key, NEW.first_file_id)
     IS DISTINCT FROM (OLD.company_bank_account_id, OLD.value_date, OLD.deposit, OLD.withdrawal, OLD.balance, OLD.natural_key, OLD.first_file_id) THEN
    RAISE EXCEPTION 'bank statement line % facts are immutable', OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER statement_line_rules BEFORE UPDATE OR DELETE ON core.bank_statement_line FOR EACH ROW EXECUTE FUNCTION core.trg_statement_line_rules();

CREATE TABLE core.receipt (
  id bigserial PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('bank_collection', 'direct_payment')),
  amount numeric(20,0) NOT NULL CHECK (amount > 0), value_date date NOT NULL,
  company_bank_account_id int REFERENCES core.company_bank_account, cash_desk text,
  payer_party_id int REFERENCES core.party, payer_name text, deposit_id text, bank_doc_no text,
  statement_line_id bigint UNIQUE REFERENCES core.bank_statement_line, note text,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz, reversed_by text, reversal_reason text,
  journal_entry_id bigint REFERENCES core.journal_entry,
  CHECK (company_bank_account_id IS NOT NULL OR cash_desk IS NOT NULL),
  CHECK (kind <> 'bank_collection' OR company_bank_account_id IS NOT NULL),
  CHECK (payer_party_id IS NOT NULL OR payer_name IS NOT NULL OR kind = 'bank_collection'));

CREATE TABLE core.receipt_allocation (
  id bigserial PRIMARY KEY, receipt_id bigint NOT NULL REFERENCES core.receipt, installment_id bigint NOT NULL REFERENCES core.installment,
  amount numeric(20,0) NOT NULL CHECK (amount > 0), allocated_by text NOT NULL, allocated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE core.overpayment_credit (
  id bigserial PRIMARY KEY, receipt_id bigint NOT NULL REFERENCES core.receipt, contract_id bigint NOT NULL REFERENCES core.installment_contract,
  installment_id bigint REFERENCES core.installment, amount numeric(20,0) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (reason IN ('duplicate_collection', 'excess_amount')),
  refund_to_party_id int REFERENCES core.party, refund_to_name text,   -- default: the direct payer of that installment (D-16)
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE core.refund (
  id bigserial PRIMARY KEY, credit_id bigint NOT NULL REFERENCES core.overpayment_credit, amount numeric(20,0) NOT NULL CHECK (amount > 0),
  paid_to_party_id int REFERENCES core.party, paid_to_name text, paid_at date NOT NULL, method text NOT NULL, bank_ref text,
  reason text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  journal_entry_id bigint REFERENCES core.journal_entry);

CREATE TABLE core.credit_reallocation (
  id bigserial PRIMARY KEY, credit_id bigint NOT NULL REFERENCES core.overpayment_credit, installment_id bigint NOT NULL REFERENCES core.installment,
  amount numeric(20,0) NOT NULL CHECK (amount > 0), reason text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE core.installment_cancellation (
  id bigserial PRIMARY KEY, installment_id bigint NOT NULL REFERENCES core.installment,
  source text NOT NULL CHECK (source IN ('manual', 'beta_import')), source_import_file_id bigint REFERENCES core.import_file,
  reason text NOT NULL, review_status text NOT NULL DEFAULT 'accepted' CHECK (review_status IN ('pending_review', 'accepted')),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz, reversed_by text, reversal_reason text);
CREATE UNIQUE INDEX installment_cancellation_live ON core.installment_cancellation (installment_id) WHERE reversed_at IS NULL;
CREATE TRIGGER contract_rules BEFORE INSERT OR UPDATE OR DELETE ON core.installment_contract FOR EACH ROW EXECUTE FUNCTION core.trg_contract_rules();

-- Q-2: bank-share withdrawals — candidates until confirmed; allocation to installments optional and many-to-one
CREATE TABLE core.bank_share_withdrawal (
  id bigserial PRIMARY KEY, company_bank_account_id int NOT NULL REFERENCES core.company_bank_account,
  amount numeric(20,0) NOT NULL CHECK (amount > 0), value_date date NOT NULL, bank_doc_no text,
  statement_line_id bigint UNIQUE REFERENCES core.bank_statement_line,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'confirmed', 'rejected')),
  reviewed_by text, reviewed_at timestamptz, note text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  journal_entry_id bigint REFERENCES core.journal_entry);
CREATE TABLE core.bank_share_allocation (
  id bigserial PRIMARY KEY, withdrawal_id bigint NOT NULL REFERENCES core.bank_share_withdrawal,
  installment_id bigint NOT NULL REFERENCES core.installment, amount numeric(20,0) NOT NULL CHECK (amount > 0),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

-- immutability of money facts (corrections = reversal / new rows)
CREATE FUNCTION core.trg_receipt_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'receipts are never deleted; reverse them'; END IF;
  IF (NEW.kind, NEW.amount, NEW.value_date, NEW.company_bank_account_id, NEW.cash_desk, NEW.statement_line_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.kind, OLD.amount, OLD.value_date, OLD.company_bank_account_id, OLD.cash_desk, OLD.statement_line_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'receipt % is immutable; reverse it', OLD.id; END IF;
  IF OLD.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'receipt % is reversed', OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receipt_rules BEFORE UPDATE OR DELETE ON core.receipt FOR EACH ROW EXECUTE FUNCTION core.trg_receipt_rules();
CREATE TRIGGER receipt_allocation_immutable BEFORE UPDATE OR DELETE ON core.receipt_allocation FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE TRIGGER overpayment_credit_immutable BEFORE UPDATE OR DELETE ON core.overpayment_credit FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE TRIGGER refund_immutable BEFORE UPDATE OR DELETE ON core.refund FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE TRIGGER credit_reallocation_immutable BEFORE UPDATE OR DELETE ON core.credit_reallocation FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE TRIGGER bank_share_allocation_immutable BEFORE UPDATE OR DELETE ON core.bank_share_allocation FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

-- ============ Derived state (never stored by hand) ============
-- money applied to an installment = allocations of non-reversed receipts + credit reallocations
CREATE VIEW core.installment_paid AS
SELECT i.id AS installment_id,
       coalesce((SELECT sum(a.amount) FROM core.receipt_allocation a JOIN core.receipt r ON r.id = a.receipt_id
                 WHERE a.installment_id = i.id AND r.reversed_at IS NULL AND r.kind = 'bank_collection'), 0) AS paid_by_bank,
       coalesce((SELECT sum(a.amount) FROM core.receipt_allocation a JOIN core.receipt r ON r.id = a.receipt_id
                 WHERE a.installment_id = i.id AND r.reversed_at IS NULL AND r.kind = 'direct_payment'), 0) AS paid_direct,
       coalesce((SELECT sum(x.amount) FROM core.credit_reallocation x JOIN core.overpayment_credit oc ON oc.id = x.credit_id
                 JOIN core.receipt r ON r.id = oc.receipt_id WHERE x.installment_id = i.id AND r.reversed_at IS NULL), 0) AS paid_from_credit
FROM core.installment i;

-- status: cancelled > paid_* > collected_per_beta (the latest Beta snapshot says collected, no bank receipt recorded yet)
--         > overdue > partial > due > not_due. Beta observations are NEVER money: they only prevent false arrears and feed B-14.
CREATE FUNCTION core.installment_status_at(p_as_of date) RETURNS TABLE (
  installment_id bigint, contract_id bigint, party_id int, scheme_id int, seq int, due_date date, amount numeric,
  paid numeric, outstanding numeric, paid_by_bank numeric, paid_direct numeric, cancelled boolean, status text)
LANGUAGE sql STABLE AS $$
  WITH obs AS (
    SELECT DISTINCT ON (f.scheme_id, s.bank_contract_id) f.scheme_id, s.bank_contract_id, s.collected_count
    FROM core.beta_contract_snapshot s JOIN core.import_file f ON f.id = s.file_id
    WHERE f.imported_at::date <= p_as_of ORDER BY f.scheme_id, s.bank_contract_id, f.imported_at DESC, f.id DESC),
  base AS (
    SELECT i.*, c.party_id, c.scheme_id, p.paid_by_bank, p.paid_direct, p.paid_from_credit, x.id IS NOT NULL AS is_cancelled,
           coalesce(obs.collected_count, 0) AS beta_collected,
           row_number() OVER (PARTITION BY i.contract_id, (x.id IS NULL) ORDER BY i.seq) AS live_rank
    FROM core.installment i JOIN core.installment_contract c ON c.id = i.contract_id AND c.status IN ('active', 'closed')
    JOIN core.installment_paid p ON p.installment_id = i.id
    LEFT JOIN core.installment_cancellation x ON x.installment_id = i.id AND x.reversed_at IS NULL
    LEFT JOIN obs ON obs.scheme_id = c.scheme_id AND obs.bank_contract_id = c.bank_contract_id)
  SELECT id, contract_id, party_id, scheme_id, seq, due_date, amount,
         paid_by_bank + paid_direct + paid_from_credit,
         CASE WHEN is_cancelled THEN 0 ELSE amount - (paid_by_bank + paid_direct + paid_from_credit) END,
         paid_by_bank, paid_direct, is_cancelled,
         CASE WHEN is_cancelled THEN 'cancelled'
              WHEN paid_by_bank + paid_direct + paid_from_credit >= amount THEN
                   CASE WHEN paid_direct + paid_from_credit = 0 THEN 'paid_by_bank' WHEN paid_by_bank = 0 THEN 'paid_direct' ELSE 'paid_mixed' END
              WHEN live_rank <= beta_collected THEN 'collected_per_beta'
              WHEN due_date + core.setting_value('beta_overdue_grace_days')::int < p_as_of THEN 'overdue'
              WHEN paid_by_bank + paid_direct + paid_from_credit > 0 THEN 'partial'
              WHEN due_date <= p_as_of THEN 'due'
              ELSE 'not_due' END
  FROM base $$;

CREATE VIEW core.installment_status AS SELECT * FROM core.installment_status_at(current_date);

CREATE VIEW core.credit_status AS
SELECT oc.*, r.reversed_at IS NOT NULL AS receipt_reversed,
       coalesce((SELECT sum(amount) FROM core.refund WHERE credit_id = oc.id), 0) AS refunded,
       coalesce((SELECT sum(amount) FROM core.credit_reallocation WHERE credit_id = oc.id), 0) AS reallocated,
       CASE WHEN r.reversed_at IS NOT NULL THEN 0 ELSE oc.amount - coalesce((SELECT sum(amount) FROM core.refund WHERE credit_id = oc.id), 0)
            - coalesce((SELECT sum(amount) FROM core.credit_reallocation WHERE credit_id = oc.id), 0) END AS open_amount
FROM core.overpayment_credit oc JOIN core.receipt r ON r.id = oc.receipt_id;

CREATE VIEW core.receipt_status AS
SELECT r.*, coalesce((SELECT sum(amount) FROM core.receipt_allocation WHERE receipt_id = r.id), 0) AS allocated,
       coalesce((SELECT sum(amount) FROM core.overpayment_credit WHERE receipt_id = r.id), 0) AS credited,
       r.amount - coalesce((SELECT sum(amount) FROM core.receipt_allocation WHERE receipt_id = r.id), 0)
                - coalesce((SELECT sum(amount) FROM core.overpayment_credit WHERE receipt_id = r.id), 0) AS unapplied
FROM core.receipt r;

CREATE VIEW core.contract_status AS
SELECT c.id AS contract_id, c.scheme_id, c.party_id, c.bank_contract_id, c.status, c.total_amount, c.installment_count,
       count(*) FILTER (WHERE s.status LIKE 'paid%') AS paid_count, count(*) FILTER (WHERE s.status = 'overdue') AS overdue_count,
       count(*) FILTER (WHERE s.status = 'cancelled') AS cancelled_count, coalesce(sum(s.paid), 0) AS paid_amount,
       coalesce(sum(s.outstanding), 0) AS outstanding_amount,
       coalesce(sum(s.outstanding) FILTER (WHERE s.status = 'overdue'), 0) AS overdue_amount
FROM core.installment_contract c LEFT JOIN core.installment_status s ON s.contract_id = c.id
GROUP BY c.id;

CREATE VIEW core.party_beta_exposure AS
SELECT party_id, count(*) FILTER (WHERE status = 'active') AS active_contracts, sum(outstanding_amount) AS outstanding,
       sum(overdue_amount) AS overdue, sum(overdue_count) AS overdue_installments
FROM core.contract_status GROUP BY party_id;

-- ============ Operations (permission + audit; the only write paths for money) ============
CREATE FUNCTION core.record_receipt(p_kind text, p_amount numeric, p_date date, p_bank_account int, p_cash_desk text,
  p_payer_party int, p_payer_name text, p_user text, p_note text DEFAULT NULL, p_statement_line bigint DEFAULT NULL,
  p_deposit_id text DEFAULT NULL, p_bank_doc text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE rid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'beta.receipt_manage');
  INSERT INTO core.receipt (kind, amount, value_date, company_bank_account_id, cash_desk, payer_party_id, payer_name, statement_line_id,
                            deposit_id, bank_doc_no, note, created_by)
  VALUES (p_kind, p_amount, p_date, p_bank_account, p_cash_desk, p_payer_party, p_payer_name, p_statement_line, p_deposit_id, p_bank_doc, p_note, p_user)
  RETURNING id INTO rid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after)
  VALUES (p_user, 'record', 'receipt', rid::text, jsonb_build_object('kind', p_kind, 'amount', p_amount, 'date', p_date));
  RETURN rid;
END $$;

-- Apply (the unapplied part of) a receipt to ONE specific installment. Never picks another installment on its own:
-- money for an already-settled installment becomes a duplicate-collection credit (D-16); excess becomes an excess credit.
CREATE FUNCTION core.apply_receipt(p_receipt bigint, p_installment bigint, p_user text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r core.receipt_status; i core.installment; st record; alloc numeric := 0; rest numeric; cid bigint; reason text;
        to_party int; to_name text;
BEGIN
  PERFORM core.require_permission(p_user, 'beta.receipt_manage');
  PERFORM 1 FROM core.receipt WHERE id = p_receipt FOR UPDATE;
  SELECT * INTO r FROM core.receipt_status WHERE id = p_receipt;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown receipt %', p_receipt; END IF;
  IF r.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'receipt % is reversed', p_receipt; END IF;
  IF r.unapplied <= 0 THEN RAISE EXCEPTION 'receipt % has nothing left to apply', p_receipt; END IF;
  SELECT * INTO i FROM core.installment WHERE id = p_installment FOR UPDATE;
  SELECT * INTO st FROM core.installment_status_at(current_date) s WHERE s.installment_id = p_installment;
  IF NOT FOUND THEN RAISE EXCEPTION 'installment % is not part of an active contract', p_installment; END IF;
  IF st.cancelled THEN RAISE EXCEPTION 'installment % is cancelled', p_installment; END IF;
  alloc := least(r.unapplied, greatest(st.outstanding, 0));
  IF alloc > 0 THEN
    INSERT INTO core.receipt_allocation (receipt_id, installment_id, amount, allocated_by) VALUES (p_receipt, p_installment, alloc, p_user);
  END IF;
  rest := r.unapplied - alloc;
  IF rest > 0 THEN
    reason := CASE WHEN st.outstanding <= 0 THEN 'duplicate_collection' ELSE 'excess_amount' END;
    -- refund goes by default to whoever paid this installment directly (family / customer), else to the receipt's payer
    SELECT rr.payer_party_id, rr.payer_name INTO to_party, to_name FROM core.receipt_allocation a JOIN core.receipt rr ON rr.id = a.receipt_id
     WHERE a.installment_id = p_installment AND rr.kind = 'direct_payment' AND rr.reversed_at IS NULL ORDER BY a.id DESC LIMIT 1;
    IF to_party IS NULL AND to_name IS NULL THEN to_party := r.payer_party_id; to_name := r.payer_name; END IF;
    INSERT INTO core.overpayment_credit (receipt_id, contract_id, installment_id, amount, reason, refund_to_party_id, refund_to_name, created_by)
    VALUES (p_receipt, i.contract_id, p_installment, rest, reason, to_party, to_name, p_user) RETURNING id INTO cid;
  END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after)
  VALUES (p_user, 'apply', 'receipt', p_receipt::text, jsonb_build_object('installment', p_installment, 'allocated', alloc, 'credit', rest, 'credit_id', cid, 'reason', reason));
  RETURN jsonb_build_object('allocated', alloc, 'credit', rest, 'credit_id', cid, 'reason', reason);
END $$;

CREATE FUNCTION core.reverse_receipt(p_receipt bigint, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'beta.receipt_manage'); PERFORM core.require_reason(p_reason);
  IF EXISTS (SELECT 1 FROM core.refund f JOIN core.overpayment_credit oc ON oc.id = f.credit_id WHERE oc.receipt_id = p_receipt)
     OR EXISTS (SELECT 1 FROM core.credit_reallocation x JOIN core.overpayment_credit oc ON oc.id = x.credit_id WHERE oc.receipt_id = p_receipt) THEN
    RAISE EXCEPTION 'receipt % has refunded or reallocated credit; reverse those first', p_receipt; END IF;
  UPDATE core.receipt SET reversed_at = now(), reversed_by = p_user, reversal_reason = p_reason WHERE id = p_receipt;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'reverse', 'receipt', p_receipt::text, p_reason);
END $$;

CREATE FUNCTION core.refund_credit(p_credit bigint, p_amount numeric, p_paid_at date, p_method text, p_bank_ref text,
  p_user text, p_reason text, p_to_party int DEFAULT NULL, p_to_name text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c core.credit_status; fid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'beta.refund'); PERFORM core.require_reason(p_reason);
  PERFORM 1 FROM core.overpayment_credit WHERE id = p_credit FOR UPDATE;
  SELECT * INTO c FROM core.credit_status WHERE id = p_credit;
  IF p_amount > c.open_amount THEN RAISE EXCEPTION 'refund % exceeds open credit %', p_amount, c.open_amount; END IF;
  INSERT INTO core.refund (credit_id, amount, paid_to_party_id, paid_to_name, paid_at, method, bank_ref, reason, created_by)
  VALUES (p_credit, p_amount, coalesce(p_to_party, c.refund_to_party_id), coalesce(p_to_name, c.refund_to_name), p_paid_at, p_method, p_bank_ref, p_reason, p_user)
  RETURNING id INTO fid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason)
  VALUES (p_user, 'refund', 'overpayment_credit', p_credit::text, jsonb_build_object('refund_id', fid, 'amount', p_amount), p_reason);
  RETURN fid;
END $$;

CREATE FUNCTION core.reallocate_credit(p_credit bigint, p_installment bigint, p_amount numeric, p_user text, p_reason text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE c core.credit_status; st record; xid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'beta.credit_reallocate'); PERFORM core.require_reason(p_reason);
  PERFORM 1 FROM core.overpayment_credit WHERE id = p_credit FOR UPDATE;
  SELECT * INTO c FROM core.credit_status WHERE id = p_credit;
  IF p_amount > c.open_amount THEN RAISE EXCEPTION 'reallocation % exceeds open credit %', p_amount, c.open_amount; END IF;
  SELECT * INTO st FROM core.installment_status_at(current_date) s WHERE s.installment_id = p_installment;
  IF NOT FOUND OR st.cancelled OR p_amount > st.outstanding THEN RAISE EXCEPTION 'installment % cannot take %', p_installment, p_amount; END IF;
  INSERT INTO core.credit_reallocation (credit_id, installment_id, amount, reason, created_by) VALUES (p_credit, p_installment, p_amount, p_reason, p_user)
  RETURNING id INTO xid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason)
  VALUES (p_user, 'reallocate', 'overpayment_credit', p_credit::text, jsonb_build_object('installment', p_installment, 'amount', p_amount), p_reason);
  RETURN xid;
END $$;

CREATE FUNCTION core.cancel_installment(p_installment bigint, p_source text, p_reason text, p_user text,
  p_file bigint DEFAULT NULL, p_review text DEFAULT 'accepted') RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE st record; xid bigint;
BEGIN
  PERFORM core.require_permission(p_user, CASE WHEN p_source = 'beta_import' THEN 'beta.review' ELSE 'beta.contract_manage' END);
  PERFORM core.require_reason(p_reason);
  PERFORM 1 FROM core.installment WHERE id = p_installment FOR UPDATE;
  SELECT * INTO st FROM core.installment_status_at(current_date) s WHERE s.installment_id = p_installment;
  IF NOT FOUND THEN RAISE EXCEPTION 'installment % is not part of an active contract', p_installment; END IF;
  IF st.paid > 0 THEN RAISE EXCEPTION 'installment % already has payments (%); it cannot be cancelled', p_installment, st.paid; END IF;
  INSERT INTO core.installment_cancellation (installment_id, source, source_import_file_id, reason, review_status, created_by)
  VALUES (p_installment, p_source, p_file, p_reason, p_review, p_user) RETURNING id INTO xid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'cancel', 'installment', p_installment::text, p_reason);
  RETURN xid;
END $$;

-- ============ Party merge / unmerge (D-18: never automatic; national id is the key) ============
CREATE FUNCTION core.merge_parties(p_source int, p_target int, p_user text, p_reason text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE s core.party; t core.party; mv jsonb; mid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'party.merge'); PERFORM core.require_reason(p_reason);
  SELECT * INTO s FROM core.party WHERE id = p_source FOR UPDATE; SELECT * INTO t FROM core.party WHERE id = p_target FOR UPDATE;
  IF s.merged_into_id IS NOT NULL OR t.merged_into_id IS NOT NULL THEN RAISE EXCEPTION 'party already merged'; END IF;
  IF coalesce(s.national_id, s.national_id_claim) IS NOT NULL AND coalesce(t.national_id, t.national_id_claim) IS NOT NULL
     AND coalesce(s.national_id, s.national_id_claim) <> coalesce(t.national_id, t.national_id_claim) THEN
    RAISE EXCEPTION 'different national ids: parties % and % are different persons', p_source, p_target; END IF;
  mv := jsonb_build_object(
    'legacy_codes', (SELECT coalesce(jsonb_agg(id), '[]') FROM core.party_legacy_code WHERE party_id = p_source),
    'bank_accounts', (SELECT coalesce(jsonb_agg(id), '[]') FROM core.party_bank_account WHERE party_id = p_source),
    'contracts', (SELECT coalesce(jsonb_agg(id), '[]') FROM core.installment_contract WHERE party_id = p_source),
    'capacities', (SELECT coalesce(jsonb_agg(id), '[]') FROM core.customer_installment_capacity WHERE party_id = p_source),
    'national_id', s.national_id);
  PERFORM set_config('almas.controlled_change', 'on', true);
  UPDATE core.party_legacy_code SET party_id = p_target WHERE party_id = p_source;
  UPDATE core.party_bank_account SET party_id = p_target WHERE party_id = p_source;
  UPDATE core.installment_contract SET party_id = p_target WHERE party_id = p_source;     -- contracts are moved, NEVER merged
  UPDATE core.customer_installment_capacity SET party_id = p_target WHERE party_id = p_source;
  UPDATE core.party SET merged_into_id = p_target, national_id = NULL, national_id_claim = coalesce(s.national_id, s.national_id_claim) WHERE id = p_source;
  UPDATE core.party SET national_id = coalesce(t.national_id, s.national_id, t.national_id_claim, s.national_id_claim),
                        national_id_claim = NULL WHERE id = p_target;
  PERFORM set_config('almas.controlled_change', 'off', true);
  INSERT INTO core.party_merge (source_party_id, target_party_id, reason, merged_by, moved) VALUES (p_source, p_target, p_reason, p_user, mv)
  RETURNING id INTO mid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after, reason)
  VALUES (p_user, 'merge', 'party', p_source::text, to_jsonb(s), jsonb_build_object('into', p_target, 'moved', mv), p_reason);
  RETURN mid;
END $$;

CREATE FUNCTION core.unmerge_parties(p_merge bigint, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m core.party_merge;
BEGIN
  PERFORM core.require_permission(p_user, 'party.merge'); PERFORM core.require_reason(p_reason);
  SELECT * INTO m FROM core.party_merge WHERE id = p_merge FOR UPDATE;
  IF m.undone_at IS NOT NULL THEN RAISE EXCEPTION 'merge % already undone', p_merge; END IF;
  PERFORM set_config('almas.controlled_change', 'on', true);
  UPDATE core.party_legacy_code SET party_id = m.source_party_id WHERE id IN (SELECT jsonb_array_elements_text(m.moved->'legacy_codes')::bigint);
  UPDATE core.party_bank_account SET party_id = m.source_party_id WHERE id IN (SELECT jsonb_array_elements_text(m.moved->'bank_accounts')::bigint);
  UPDATE core.installment_contract SET party_id = m.source_party_id WHERE id IN (SELECT jsonb_array_elements_text(m.moved->'contracts')::bigint);
  UPDATE core.customer_installment_capacity SET party_id = m.source_party_id WHERE id IN (SELECT jsonb_array_elements_text(m.moved->'capacities')::bigint);
  IF m.moved->>'national_id' IS NOT NULL THEN
    UPDATE core.party SET national_id = NULL, national_id_claim = m.moved->>'national_id'
     WHERE id = m.target_party_id AND national_id = m.moved->>'national_id'
       AND NOT EXISTS (SELECT 1 FROM core.party_merge o WHERE o.target_party_id = m.target_party_id AND o.id <> m.id AND o.undone_at IS NULL);
  END IF;
  UPDATE core.party SET merged_into_id = NULL, national_id = m.moved->>'national_id',
                        national_id_claim = CASE WHEN m.moved->>'national_id' IS NULL THEN national_id_claim END WHERE id = m.source_party_id;
  PERFORM set_config('almas.controlled_change', 'off', true);
  UPDATE core.party_merge SET undone_at = now(), undone_by = p_user, undo_reason = p_reason WHERE id = p_merge;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'unmerge', 'party', m.source_party_id::text, p_reason);
END $$;

CREATE VIEW core.party_merge_candidate AS
SELECT 'strong'::text AS level, a.id AS party_id, b.id AS candidate_party_id, 'same national id'::text AS evidence
FROM core.party a JOIN core.party b ON b.national_id = a.national_id_claim
WHERE a.merged_into_id IS NULL AND b.merged_into_id IS NULL AND a.id <> b.id
UNION ALL
SELECT 'suspicious', a.id, b.id, 'same normalized name'
FROM core.party a JOIN core.party b ON b.name_key = a.name_key AND b.id > a.id
WHERE a.merged_into_id IS NULL AND b.merged_into_id IS NULL AND a.name_key IS NOT NULL
  AND NOT (coalesce(a.national_id, a.national_id_claim) IS NOT NULL AND coalesce(b.national_id, b.national_id_claim) IS NOT NULL
           AND coalesce(a.national_id, a.national_id_claim) <> coalesce(b.national_id, b.national_id_claim))
  AND NOT (a.national_id_claim IS NOT NULL AND a.national_id_claim = b.national_id)
  AND NOT (b.national_id_claim IS NOT NULL AND b.national_id_claim = a.national_id);

-- ============ Legacy Holoo balances (migration evidence; read from holoo_mirror, never written back) ============
CREATE TABLE core.legacy_balance (
  id bigserial PRIMARY KEY, party_id int REFERENCES core.party, source_db text NOT NULL, legacy_account_code text NOT NULL,
  balance numeric(20,0) NOT NULL, is_beta boolean NOT NULL, first_seen_run text, last_seen_run text,
  UNIQUE (source_db, legacy_account_code));

-- latest Beta observation per contract vs what we recorded (receipts) — B-13
CREATE VIEW core.beta_observed_vs_recorded AS
WITH last AS (SELECT DISTINCT ON (f.scheme_id, s.bank_contract_id) s.*, f.scheme_id, f.imported_at
              FROM core.beta_contract_snapshot s JOIN core.import_file f ON f.id = s.file_id
              ORDER BY f.scheme_id, s.bank_contract_id, f.imported_at DESC, f.id DESC)
SELECT c.id AS contract_id, last.scheme_id, last.bank_contract_id, last.imported_at AS observed_at,
       last.collected_count AS observed_collected, cs.paid_count AS recorded_paid,
       last.overdue_count AS observed_overdue, last.cancelled_count AS observed_cancelled, cs.cancelled_count AS recorded_cancelled
FROM last JOIN core.installment_contract c ON c.scheme_id = last.scheme_id AND c.bank_contract_id = last.bank_contract_id
JOIN core.contract_status cs ON cs.contract_id = c.id;

-- ============ Posting (D-14 open) ============
CREATE VIEW core.beta_unposted AS
SELECT 'contract'::text AS object_type, id AS object_id, total_amount AS amount, activated_at::date AS event_date FROM core.installment_contract WHERE status <> 'draft' AND journal_entry_id IS NULL
UNION ALL SELECT 'receipt', id, amount, value_date FROM core.receipt WHERE reversed_at IS NULL AND journal_entry_id IS NULL
UNION ALL SELECT 'refund', id, amount, paid_at FROM core.refund WHERE journal_entry_id IS NULL
UNION ALL SELECT 'bank_share_withdrawal', id, amount, value_date FROM core.bank_share_withdrawal WHERE status = 'confirmed' AND journal_entry_id IS NULL;

-- ============ Controls (B-xx) ============
CREATE FUNCTION core.beta_controls(p_as_of date DEFAULT current_date) RETURNS TABLE (control text, severity text, title text, items bigint, amount numeric)
LANGUAGE sql STABLE AS $$
  SELECT 'B-01', 'high', 'اقساط سررسیدگذشته و وصول‌نشده', count(*), coalesce(sum(outstanding), 0) FROM core.installment_status_at(p_as_of) WHERE status = 'overdue'
  UNION ALL SELECT 'B-02', 'high', 'بستانکاری باز (اضافه‌وصول) در انتظار استرداد یا تصمیم', count(*), coalesce(sum(open_amount), 0) FROM core.credit_status WHERE open_amount > 0
  UNION ALL SELECT 'B-03', 'high', 'وصول تکراری یک قسط (پرداخت مستقیم + بانک)', count(*), coalesce(sum(amount), 0) FROM core.overpayment_credit WHERE reason = 'duplicate_collection'
  UNION ALL SELECT 'B-04', 'medium', 'دریافتی با مانده تخصیص‌نیافته', count(*), coalesce(sum(unapplied), 0) FROM core.receipt_status WHERE reversed_at IS NULL AND unapplied > 0
  UNION ALL SELECT 'B-05', 'medium', 'برداشت نامزد سهم بانک در انتظار تأیید (Q-2)', count(*), coalesce(sum(amount), 0) FROM core.bank_share_withdrawal WHERE status = 'candidate'
  UNION ALL SELECT 'B-06', 'medium', 'قرارداد فعال بدون سقف توان قسط تأییدشده (D-17)', count(*), coalesce(sum(total_amount), 0) FROM core.installment_contract WHERE status = 'active' AND capacity_check = 'unverified'
  UNION ALL SELECT 'B-07', 'medium', 'ردیف صورت‌حساب نیازمند بررسی انسانی', count(*), coalesce(sum(deposit + withdrawal), 0) FROM core.bank_statement_line WHERE match_status IN ('needs_review', 'party_identified', 'unmatched') AND classification IN ('installment', 'bank_share_candidate')
  UNION ALL SELECT 'B-08', 'medium', 'اصلاحیه قرارداد از منبع در انتظار بررسی', count(*), NULL FROM core.contract_amendment WHERE status = 'pending_review'
  UNION ALL SELECT 'B-09', 'medium', 'لغو قسط از منبع در انتظار بررسی', count(*), NULL FROM core.installment_cancellation WHERE review_status = 'pending_review' AND reversed_at IS NULL
  UNION ALL SELECT 'B-10', 'low', 'نامزد ادغام پرونده (کد ملی یکسان)', count(*), NULL FROM core.party_merge_candidate WHERE level = 'strong'
  UNION ALL SELECT 'B-11', 'medium', 'مانده بتای هلو بدون قرارداد در سیستم جدید (انتقال)', count(*), coalesce(sum(balance), 0)
            FROM core.legacy_balance lb WHERE is_beta AND balance <> 0 AND NOT EXISTS (
              SELECT 1 FROM core.installment_contract c WHERE c.party_id = lb.party_id AND c.status IN ('active', 'closed'))
  UNION ALL SELECT 'B-13', 'medium', 'اختلاف تعداد اقساط وصول‌شده در سامانه بتا با دریافتی‌های ثبت‌شده', count(*), NULL
            FROM core.beta_observed_vs_recorded WHERE observed_collected <> recorded_paid
  UNION ALL SELECT 'B-14', 'high', 'قسط وصول‌شده طبق سامانه بتا بدون واریز ثبت‌شده در بانک', count(*), coalesce(sum(outstanding), 0)
            FROM core.installment_status_at(p_as_of) WHERE status = 'collected_per_beta'
  UNION ALL SELECT 'B-12', 'info', 'رویداد بتا بدون سند حسابداری (در انتظار D-14)', count(*), coalesce(sum(amount), 0) FROM core.beta_unposted $$;
