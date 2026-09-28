-- Almas Shahr accounting — core v0.28: Holoo coexistence — every backup import is one recorded batch with its change summary,
-- migration steps and reconciliation, and changes the importer must not guess about go to a review queue.
-- Pipeline: migration/import_backup.py (Backup → Reader → staging (holoo_mirror) → change detection → mapping → import → reconciliation).
-- Legacy facts stay facts: a changed Holoo voucher is reversed and re-posted, never edited; a changed Holoo stock line is reversed and
-- re-entered; a changed Holoo cheque event or Moadian record is listed for review, never silently ignored or overwritten.

INSERT INTO core.permission VALUES ('holoo.import', 'run a Holoo backup import and resolve its review items');
INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('holoo_import_max_age_days', '7', NULL, '^[0-9]{1,3}$', 'D-07');

-- a Holoo transfer pairs its S and D lines by (document, line). The pair id is DERIVED from that key, so it is the same in every
-- import (a numbering restarted per import would pair lines of a later backup with an earlier transfer)
CREATE FUNCTION core.legacy_transfer_id(p_db text, p_fac_code text, p_line int) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT ('x' || substr(md5(p_db || ':' || p_fac_code || ':' || p_line), 1, 15))::bit(60)::bigint $$;

CREATE TABLE core.holoo_import_batch (
  id bigserial PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, triggered_by text NOT NULL,
  input_files text[] NOT NULL, backup_sha256 text, reader_status text, reader_run_id text, source_db text, fiscal_year text, backup_finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'reconciled', 'differences', 'failed', 'refused')),
  reader_checks jsonb, change_summary jsonb, migration jsonb, reconciliation jsonb, error text);
COMMENT ON TABLE core.holoo_import_batch IS 'one Holoo backup import: reader result, changes found, migration steps, reconciliation (lineage of every legacy row)';

-- legacy changes the importer does not correct by itself (a person decides)
CREATE TABLE core.legacy_change_review (
  id bigserial PRIMARY KEY, batch_id bigint NOT NULL REFERENCES core.holoo_import_batch, source_db text NOT NULL, run_id text NOT NULL,
  entity text NOT NULL, entity_key jsonb NOT NULL, change text NOT NULL, detail text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'corrected')), resolved_by text, resolved_at timestamptz, resolution text,
  UNIQUE (run_id, entity, entity_key));

CREATE FUNCTION core.legacy_review_resolve(p_review bigint, p_status text, p_resolution text, p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'holoo.import'); PERFORM core.require_reason(p_resolution);
  IF p_status NOT IN ('accepted', 'corrected') THEN RAISE EXCEPTION 'status is accepted or corrected'; END IF;
  UPDATE core.legacy_change_review SET status = p_status, resolved_by = p_user, resolved_at = now(), resolution = p_resolution WHERE id = p_review AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'review item % is not open', p_review; END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, p_status, 'legacy_change_review', p_review::text, p_resolution);
END $$;

CREATE FUNCTION core.imports_list(p_limit int DEFAULT 50)
RETURNS TABLE (batch_id bigint, started_at timestamptz, finished_at timestamptz, triggered_by text, source_db text, fiscal_year text, backup_sha256 text,
               reader_status text, status text, changes text, reconciliation text, open_reviews bigint) LANGUAGE sql STABLE AS $$
  SELECT b.id, b.started_at, b.finished_at, b.triggered_by, b.source_db, b.fiscal_year, left(b.backup_sha256, 12), b.reader_status, b.status,
         (SELECT string_agg(k || ': ' || v, '، ' ORDER BY k) FROM jsonb_each_text(coalesce(b.change_summary -> 'totals', '{}')) x(k, v)),
         (SELECT string_agg(k || '=' || (v ->> 'status'), '، ' ORDER BY k) FROM jsonb_each(coalesce(b.reconciliation, '{}')) x(k, v)),
         (SELECT count(*) FROM core.legacy_change_review r WHERE r.batch_id = b.id AND r.status = 'open')
  FROM core.holoo_import_batch b ORDER BY b.id DESC LIMIT least(p_limit, 500) $$;

CREATE FUNCTION core.import_detail(p_batch bigint) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(b) || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM core.legacy_change_review r WHERE r.batch_id = b.id))
  FROM core.holoo_import_batch b WHERE b.id = p_batch $$;

CREATE FUNCTION core.import_controls(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT 'import', 'IMP-01', 'high', 'آخرین ورود Backup هلو ناموفق یا ردشده است', count(*), NULL::numeric, 'D-07'
  FROM (SELECT DISTINCT ON (coalesce(source_db, '?')) status FROM core.holoo_import_batch ORDER BY coalesce(source_db, '?'), id DESC) z WHERE status IN ('failed', 'refused')
  UNION ALL
  SELECT 'import', 'IMP-02', 'high', 'مغایرت در تطبیق آخرین ورود Backup هلو', count(*), NULL::numeric, 'D-07'
  FROM (SELECT DISTINCT ON (source_db) status FROM core.holoo_import_batch WHERE source_db IS NOT NULL AND status <> 'running' ORDER BY source_db, id DESC) z
  WHERE status = 'differences'
  UNION ALL
  SELECT 'import', 'IMP-03', 'medium', 'تغییر داده هلو در انتظار بررسی (چک، مؤدیان)', count(*), NULL::numeric, 'D-07'
  FROM core.legacy_change_review WHERE status = 'open'
  UNION ALL
  SELECT 'import', 'IMP-04', 'medium', 'Backup هلو دیر به‌روز شده است (دوره هم‌زیستی)', count(*), NULL::numeric, 'D-07'
  FROM (SELECT source_db, max(finished_at) f FROM core.holoo_import_batch WHERE status IN ('reconciled', 'differences') GROUP BY 1) z
  WHERE f < p_as_of::timestamptz - make_interval(days => core.setting_value('holoo_import_max_age_days')::int) $$;

ALTER FUNCTION core.control_inbox(date) RENAME TO control_inbox_v27;
CREATE FUNCTION core.control_inbox(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT * FROM core.control_inbox_v27(p_as_of) UNION ALL SELECT * FROM core.import_controls(p_as_of) $$;

INSERT INTO core.operation_catalog (operation, kind, function_signature, purpose, permission, effect, undo, basis, ai_allowed, agent_allowed) VALUES
  ('imports.list', 'read', 'core.imports_list(integer)', 'every Holoo backup import with its changes, reconciliation and open review items', NULL, 'none', '—', 'D-07', true, false),
  ('imports.detail', 'read', 'core.import_detail(bigint)', 'one import: reader checks, changes per table, migration steps, reconciliation, review items', NULL, 'none', '—', 'D-07', true, false),
  ('imports.review_resolve', 'write', 'core.legacy_review_resolve(bigint,text,text,text)', 'close a legacy change review item with its resolution', 'holoo.import',
   'marks it accepted / corrected; audited', '—', 'D-07', true, false);
