-- Almas Shahr accounting — core v0.14: submissions to the Moadian system («سامانه مؤدیان») and tax controls (TAX-01/02, W-08).
--
-- PROVEN about Holoo (E09, E01.9; migration/holoo_tax.py):
--   * every sending attempt is a row of TaxLog (type, state, tax id, serial, time); the invoice keeps the latest state
--     in FACTURE.StateTax: 2 = accepted, 0 = not sent / failed (with the error text), 1 = pending;
--   * SendType 1 = original invoice, 3 = cancellation (E01.9). The meaning of 2, 4, 5 and 6 is NOT proven; they are
--     kept raw as legacy_send_type and never mapped to a subject by guesswork;
--   * weaknesses: 74 invoices failed or never sent, without follow-up; 574 invoices sent more than once; 3 tax ids
--     used on two invoices (W-08).
-- NEW: submissions are an append-only log with a strict life cycle, a correction or cancellation needs an accepted
-- original, a tax id belongs to one invoice, and controls list every invoice not accepted within the allowed days.
-- VAT itself (D-01) is posted by the document posting rule (006) when present; in 1404 it was always zero.

INSERT INTO core.permission (code, description) VALUES ('tax.submit', 'record submissions to the Moadian system and their results');
INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('tax_submission_max_days', '7', NULL, '^[0-9]{1,3}$', 'W-08');

CREATE TABLE core.tax_submission (
  id bigserial PRIMARY KEY,
  document_source text NOT NULL,            -- 'sales_invoice' (new system) or 'holoo:<db>:<fac_type>' (migrated)
  document_ref text NOT NULL,               -- invoice id / Holoo fac_code
  subject text NOT NULL CHECK (subject IN ('original', 'correction', 'cancellation', 'return', 'legacy_unknown')),
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'pending', 'accepted', 'rejected', 'failed')),
  tax_id text,                              -- «شماره مالیاتی صورتحساب»
  serial text, error_text text,
  sent_at timestamptz, responded_at timestamptz,
  legacy_send_type int, legacy_state int, legacy_id int, legacy boolean NOT NULL DEFAULT false,
  created_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'accepted' OR tax_id IS NOT NULL),
  CHECK (subject <> 'legacy_unknown' OR legacy));
CREATE INDEX tax_submission_document ON core.tax_submission (document_source, document_ref);
CREATE UNIQUE INDEX tax_submission_legacy ON core.tax_submission (document_source, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TRIGGER tax_submission_immutable BEFORE UPDATE OR DELETE ON core.tax_submission FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

CREATE FUNCTION core.trg_tax_submission_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.legacy THEN RETURN NEW; END IF;                 -- history from Holoo is recorded as it was (and controlled below)
  PERFORM core.require_permission(NEW.created_by, 'tax.submit');
  IF NEW.subject IN ('correction', 'cancellation', 'return') AND NOT EXISTS (
       SELECT 1 FROM core.tax_submission s WHERE s.document_source = NEW.document_source AND s.document_ref = NEW.document_ref
         AND s.subject = 'original' AND s.status = 'accepted') THEN
    RAISE EXCEPTION 'a % needs an accepted original submission of the same invoice', NEW.subject; END IF;
  IF NEW.subject = 'original' AND NEW.status = 'accepted' AND EXISTS (
       SELECT 1 FROM core.tax_submission s WHERE s.document_source = NEW.document_source AND s.document_ref = NEW.document_ref
         AND s.subject = 'original' AND s.status = 'accepted') THEN
    RAISE EXCEPTION 'the invoice already has an accepted original submission; send a correction instead'; END IF;
  IF NEW.status = 'accepted' AND EXISTS (
       SELECT 1 FROM core.tax_submission s WHERE s.tax_id = NEW.tax_id AND s.status = 'accepted'
         AND (s.document_source, s.document_ref) IS DISTINCT FROM (NEW.document_source, NEW.document_ref)) THEN
    RAISE EXCEPTION 'tax id % is already accepted for another invoice (W-08)', NEW.tax_id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tax_submission_rules BEFORE INSERT ON core.tax_submission FOR EACH ROW EXECUTE FUNCTION core.trg_tax_submission_rules();

-- Holoo's own per-invoice flag (FACTURE.StateTax), kept to expose where it disagrees with its own log (control T-06)
CREATE TABLE core.legacy_tax_flag (
  document_source text NOT NULL, document_ref text NOT NULL, holoo_state int, PRIMARY KEY (document_source, document_ref));

-- the tax status of every submitted invoice: the latest attempt decides, except that a NOT-accepted attempt of an
-- unproven Holoo type (legacy_unknown) never decides. Evidence (E25): in 17 invoices a SendType 6 attempt (state 0, no
-- tax id) follows an accepted original and Holoo's own StateTax stays 2; in 9 invoices whose only attempts are of type
-- 2 or 5 and accepted, StateTax is 2.
CREATE VIEW core.tax_document_status AS
SELECT DISTINCT ON (s.document_source, s.document_ref) s.document_source, s.document_ref, s.subject AS last_subject, s.status AS last_status,
       s.tax_id AS last_tax_id, s.sent_at AS last_sent_at,
       (SELECT count(*) FROM core.tax_submission x WHERE (x.document_source, x.document_ref) = (s.document_source, s.document_ref)) AS attempts,
       EXISTS (SELECT 1 FROM core.tax_submission x WHERE (x.document_source, x.document_ref) = (s.document_source, s.document_ref)
               AND x.status = 'accepted' AND x.subject = 'cancellation') AS cancelled
FROM core.tax_submission s
WHERE s.subject <> 'legacy_unknown' OR s.status = 'accepted'
ORDER BY s.document_source, s.document_ref, s.sent_at DESC NULLS LAST, s.id DESC;

-- controls (W-08): every row is something a person must look at
CREATE FUNCTION core.tax_controls(p_as_of date)
RETURNS TABLE (control text, severity text, documents bigint, detail text) LANGUAGE sql STABLE AS $$
  SELECT 'T-01', 'high', count(*), 'final sales invoices of the new system with no accepted submission after the allowed days'
  FROM core.sales_invoice i
  WHERE i.status = 'final' AND i.invoice_date <= p_as_of - core.setting_value('tax_submission_max_days')::int
    AND NOT EXISTS (SELECT 1 FROM core.tax_document_status t WHERE t.document_source = 'sales_invoice' AND t.document_ref = i.id::text
                    AND t.last_status = 'accepted')
  UNION ALL
  SELECT 'T-02', 'high', count(*), 'invoices whose latest attempt failed, was rejected or is still pending'
  FROM core.tax_document_status WHERE last_status IN ('failed', 'rejected', 'pending', 'queued', 'sent')
  UNION ALL
  SELECT 'T-03', 'high', count(*), 'tax ids accepted for more than one invoice'
  FROM (SELECT tax_id FROM core.tax_submission WHERE status = 'accepted' GROUP BY tax_id
        HAVING count(DISTINCT (document_source, document_ref)) > 1) d
  UNION ALL
  SELECT 'T-04', 'medium', count(*), 'invoices sent more than once (resends)'
  FROM core.tax_document_status WHERE attempts > 1
  UNION ALL
  SELECT 'T-05', 'low', count(*), 'legacy submissions with an unproven Holoo send type (kept raw, NEEDS_MORE_EVIDENCE)'
  FROM core.tax_submission WHERE subject = 'legacy_unknown'
  UNION ALL
  SELECT 'T-06', 'high', count(*), 'Holoo invoice flag disagrees with its own submission log — verify in the Moadian portal'
  FROM core.legacy_tax_flag f JOIN core.tax_document_status t USING (document_source, document_ref)
  WHERE (f.holoo_state = 2) <> (t.last_status = 'accepted') $$;

INSERT INTO core.operation_catalog VALUES
  ('tax.controls', 'read', 'core.tax_controls(date)', 'Moadian controls: unsent, failed, duplicate tax ids, resends', NULL, 'none', '—', 'E09, W-08', true);
