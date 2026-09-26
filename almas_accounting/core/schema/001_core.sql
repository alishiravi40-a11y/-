-- Almas Shahr accounting — core data model v0.1 (PostgreSQL 14+).
-- Design goals come from the Holoo weakness register (W-xx). Every weakness closed here is enforced by the DATABASE,
-- not only by the application: see core/tests/test_core_rules.py.
CREATE SCHEMA IF NOT EXISTS core;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ Periods (W-01, W-19, W-28) ============
CREATE TABLE core.fiscal_year (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL,                 -- e.g. '1404'
  starts_on date NOT NULL, ends_on date NOT NULL, CHECK (ends_on > starts_on));
CREATE TABLE core.period (
  id serial PRIMARY KEY, fiscal_year_id int NOT NULL REFERENCES core.fiscal_year, code text NOT NULL,   -- '1404-01'
  starts_on date NOT NULL, ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed')),   -- closing: only 'adjustment' entries
  UNIQUE (fiscal_year_id, code), CHECK (ends_on >= starts_on));

-- ============ Chart of accounts (ACC-01..04) ============
CREATE TABLE core.account (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL, parent_id int REFERENCES core.account,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 4), is_leaf boolean NOT NULL DEFAULT true,
  nature text NOT NULL CHECK (nature IN ('debit', 'credit', 'either')),
  statement text NOT NULL CHECK (statement IN ('balance_sheet', 'income_statement', 'memo')),
  role text,                                                        -- system role (Holoo SarfaslType), e.g. 'sales', 'bank'
  requires_party boolean NOT NULL DEFAULT false,                    -- sub-ledger account (customers/suppliers)
  holoo_code text, active boolean NOT NULL DEFAULT true);

-- ============ Parties (PER-xx, W-22) ============
CREATE TABLE core.party (
  id serial PRIMARY KEY, name text NOT NULL, legal_kind text NOT NULL DEFAULT 'person' CHECK (legal_kind IN ('person', 'company')),
  national_id text, economic_code text, mobile text, city_code int,
  risk_flags text[] NOT NULL DEFAULT '{}',                          -- structured flags instead of text in the name (W-22)
  credit_limit numeric(20,0), payment_terms_days int, holoo_c_code text, holoo_source_db text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX party_national_id ON core.party (national_id) WHERE national_id IS NOT NULL;

-- ============ Journal (ACC-05..10, W-03, W-05, W-06, W-07, W-24) ============
CREATE TABLE core.journal_entry (
  id bigserial PRIMARY KEY, number bigint, fiscal_year_id int NOT NULL REFERENCES core.fiscal_year,
  period_id int NOT NULL REFERENCES core.period,
  effective_date date NOT NULL,                                     -- accounting date
  recorded_at timestamptz NOT NULL DEFAULT now(),                   -- server time of recording (W-06)
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'approved', 'final')),
  kind text NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'adjustment', 'reversal', 'opening', 'closing')),
  source text NOT NULL DEFAULT 'manual',                            -- manual|sale|purchase|cheque|treasury|payroll|...
  source_ref text,                                                  -- e.g. document id / channel order no
  reverses_id bigint REFERENCES core.journal_entry, reason text,    -- reversal instead of hiding lines (W-03)
  description text, created_by text NOT NULL, posted_at timestamptz, posted_by text,
  UNIQUE (fiscal_year_id, number),
  CHECK (kind <> 'reversal' OR (reverses_id IS NOT NULL AND reason IS NOT NULL)));
CREATE TABLE core.journal_line (
  entry_id bigint NOT NULL REFERENCES core.journal_entry ON DELETE CASCADE, line_no int NOT NULL,
  account_id int NOT NULL REFERENCES core.account, party_id int REFERENCES core.party,
  debit numeric(20,0) NOT NULL DEFAULT 0 CHECK (debit >= 0), credit numeric(20,0) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text,
  PRIMARY KEY (entry_id, line_no), CHECK ((debit = 0) <> (credit = 0)));   -- exactly one side; no zero lines; no "hidden" flag (W-04)

-- Period and date rules on the entry
CREATE FUNCTION core.trg_entry_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p core.period;
BEGIN
  SELECT * INTO p FROM core.period WHERE id = NEW.period_id;
  IF NEW.effective_date NOT BETWEEN p.starts_on AND p.ends_on THEN
    RAISE EXCEPTION 'effective_date % is outside period %', NEW.effective_date, p.code; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted', 'approved', 'final') THEN
    -- a posted entry may only move forward in status; content is immutable (W-05)
    IF NEW.status = 'draft' OR NEW.effective_date <> OLD.effective_date OR NEW.period_id <> OLD.period_id OR NEW.kind <> OLD.kind THEN
      RAISE EXCEPTION 'posted entry % is immutable; use a reversal', OLD.id; END IF;
  END IF;
  IF NEW.status <> 'draft' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    IF p.status = 'closed' THEN RAISE EXCEPTION 'period % is closed', p.code; END IF;
    IF p.status = 'closing' AND NEW.kind NOT IN ('adjustment', 'closing', 'reversal') THEN
      RAISE EXCEPTION 'period % is closing: only adjustment entries are allowed', p.code; END IF;
    IF (SELECT coalesce(SUM(debit), 0) - coalesce(SUM(credit), 0) FROM core.journal_line WHERE entry_id = NEW.id) <> 0
       OR NOT EXISTS (SELECT 1 FROM core.journal_line WHERE entry_id = NEW.id) THEN
      RAISE EXCEPTION 'entry % is not balanced or has no lines', NEW.id; END IF;
    NEW.posted_at := coalesce(NEW.posted_at, now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entry_rules BEFORE INSERT OR UPDATE ON core.journal_entry FOR EACH ROW EXECUTE FUNCTION core.trg_entry_rules();

CREATE FUNCTION core.trg_entry_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'posted entry % cannot be deleted; use a reversal', OLD.id; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER entry_no_delete BEFORE DELETE ON core.journal_entry FOR EACH ROW EXECUTE FUNCTION core.trg_entry_no_delete();

CREATE FUNCTION core.trg_line_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; eid bigint; a core.account;
BEGIN
  eid := coalesce(NEW.entry_id, OLD.entry_id);
  SELECT status INTO st FROM core.journal_entry WHERE id = eid;
  IF st IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'lines of posted entry % are immutable', eid; END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT * INTO a FROM core.account WHERE id = NEW.account_id;
    IF NOT a.is_leaf THEN RAISE EXCEPTION 'account % is not a leaf', a.code; END IF;
    IF a.requires_party AND NEW.party_id IS NULL THEN RAISE EXCEPTION 'account % requires a party', a.code; END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER line_rules BEFORE INSERT OR UPDATE OR DELETE ON core.journal_line FOR EACH ROW EXECUTE FUNCTION core.trg_line_rules();

-- Reversal helper (W-03): creates and posts a mirror entry in an open period
CREATE FUNCTION core.reverse_entry(p_entry bigint, p_date date, p_reason text, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE e core.journal_entry; nid bigint; per int;
BEGIN
  SELECT * INTO e FROM core.journal_entry WHERE id = p_entry;
  IF e.status = 'draft' THEN RAISE EXCEPTION 'draft entries are deleted, not reversed'; END IF;
  IF EXISTS (SELECT 1 FROM core.journal_entry WHERE reverses_id = p_entry AND status <> 'draft') THEN RAISE EXCEPTION 'entry % already reversed', p_entry; END IF;
  SELECT id INTO per FROM core.period WHERE p_date BETWEEN starts_on AND ends_on;
  INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, kind, source, source_ref, reverses_id, reason, description, created_by)
  SELECT fiscal_year_id, per, p_date, 'reversal', e.source, e.source_ref, e.id, p_reason, 'Reversal of ' || e.id, p_user
  FROM core.period WHERE id = per RETURNING id INTO nid;
  INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, credit, description)
  SELECT nid, line_no, account_id, party_id, credit, debit, description FROM core.journal_line WHERE entry_id = p_entry;
  UPDATE core.journal_entry SET status = 'posted', posted_by = p_user WHERE id = nid;
  RETURN nid;
END $$;

-- ============ Append-only audit with hash chain (W-02, W-29) ============
CREATE TABLE core.audit_event (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT clock_timestamp(), actor text NOT NULL,
  action text NOT NULL, object_type text NOT NULL, object_id text NOT NULL,
  before jsonb, after jsonb, reason text, prev_hash bytea, hash bytea NOT NULL);
CREATE FUNCTION core.trg_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev bytea;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'audit log is append-only'; END IF;
  SELECT hash INTO prev FROM core.audit_event ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.hash := digest(coalesce(encode(prev, 'hex'), '') || NEW.at::text || NEW.actor || NEW.action || NEW.object_type || NEW.object_id
                     || coalesce(NEW.before::text, '') || coalesce(NEW.after::text, '') || coalesce(NEW.reason, ''), 'sha256');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain BEFORE INSERT OR UPDATE OR DELETE ON core.audit_event FOR EACH ROW EXECUTE FUNCTION core.trg_audit_chain();

CREATE FUNCTION core.trg_audit_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after)
  VALUES (coalesce(current_setting('almas.actor', true), session_user), lower(TG_OP), TG_TABLE_NAME,
          coalesce(NEW.id, OLD.id)::text, CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END, CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER audit_journal AFTER INSERT OR UPDATE OR DELETE ON core.journal_entry FOR EACH ROW EXECUTE FUNCTION core.trg_audit_journal();

CREATE VIEW core.audit_chain_check AS
WITH x AS (SELECT id, hash, prev_hash, lag(hash) OVER (ORDER BY id) expected_prev,
                  digest(coalesce(encode(prev_hash, 'hex'), '') || at::text || actor || action || object_type || object_id
                         || coalesce(before::text, '') || coalesce(after::text, '') || coalesce(reason, ''), 'sha256') recomputed
           FROM core.audit_event)
SELECT id, (prev_hash IS NOT DISTINCT FROM expected_prev) AS link_ok, (hash = recomputed) AS hash_ok FROM x;

-- ============ Cheques: event-sourced, no undo (W-13) ============
CREATE TABLE core.cheque (
  id bigserial PRIMARY KEY, direction text NOT NULL CHECK (direction IN ('in', 'out')), sayad_no text UNIQUE,
  bank_code text, number text NOT NULL, amount numeric(20,0) NOT NULL CHECK (amount > 0), issue_date date, due_date date NOT NULL,
  party_id int REFERENCES core.party, holoo_check_code int);
CREATE TABLE core.cheque_event (
  id bigserial PRIMARY KEY, cheque_id bigint NOT NULL REFERENCES core.cheque, state text NOT NULL,
  effective_date date NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), journal_entry_id bigint REFERENCES core.journal_entry,
  reverses_event_id bigint REFERENCES core.cheque_event, note text);
CREATE FUNCTION core.trg_cheque_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'cheque events are immutable; record a reversing event instead'; END $$;
CREATE TRIGGER cheque_event_immutable BEFORE UPDATE OR DELETE ON core.cheque_event FOR EACH ROW EXECUTE FUNCTION core.trg_cheque_event_immutable();
CREATE VIEW core.cheque_current AS
SELECT DISTINCT ON (c.id) c.*, e.state, e.effective_date AS state_date
FROM core.cheque c LEFT JOIN core.cheque_event e ON e.cheque_id = c.id
  AND NOT EXISTS (SELECT 1 FROM core.cheque_event r WHERE r.reverses_event_id = e.id)
  AND e.reverses_event_id IS NULL
ORDER BY c.id, e.effective_date DESC, e.recorded_at DESC, e.id DESC;

-- ============ Reporting ============
CREATE VIEW core.trial_balance AS
SELECT a.code, a.name, SUM(l.debit) debit, SUM(l.credit) credit, SUM(l.debit - l.credit) balance
FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft' JOIN core.account a ON a.id = l.account_id
GROUP BY a.code, a.name;
