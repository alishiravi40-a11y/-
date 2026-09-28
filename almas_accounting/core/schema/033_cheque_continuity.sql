-- Almas Shahr accounting — core v0.33: a cheque is one cheque across Holoo years.
-- Evidence (E31): the real FY1405 backup carries 2,533 cheques of FY1404 under the same Check_Code with the same number,
-- amount and direction (all 2,533). Each Holoo year was imported as its own set of cheques, so every carried cheque existed
-- twice in the core, and a cheque spent before the year end and returned in the new year lost its holder (71 FY1405 vouchers).
-- Rule (migration/holoo_cheques): a Holoo cheque that matches a cheque already in the core from an EARLIER Holoo year
-- (same code, number, amount, direction) continues that cheque; its opening position in the new year is CHECKED against the
-- core's location (carried_forward / position_differs, never re-added), and the new year's events continue the same chain,
-- so the location-chain rule (core 007) validates them against where the cheque really is.

CREATE TABLE core.cheque_legacy_code (
  source_db text NOT NULL, check_code int NOT NULL, cheque_id bigint NOT NULL REFERENCES core.cheque,
  continued boolean NOT NULL DEFAULT false,               -- true: the cheque came from an earlier Holoo year
  PRIMARY KEY (source_db, check_code));
CREATE INDEX cheque_legacy_code_cheque ON core.cheque_legacy_code (cheque_id);
COMMENT ON TABLE core.cheque_legacy_code IS 'which core cheque each Holoo (database, Check_Code) is — one physical cheque across years';
INSERT INTO core.cheque_legacy_code (source_db, check_code, cheque_id)
SELECT legacy_source_db, holoo_check_code, id FROM core.cheque WHERE legacy_source_db IS NOT NULL AND holoo_check_code IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE core.legacy_cheque_opening_check (
  source_db text NOT NULL, check_code int NOT NULL, cheque_id bigint NOT NULL REFERENCES core.cheque,
  holoo_state text NOT NULL, holoo_account_id int REFERENCES core.account, holoo_party_id int REFERENCES core.party,
  core_state text, core_account_id int REFERENCES core.account, core_party_id int REFERENCES core.party,
  status text NOT NULL CHECK (status IN ('carried_forward', 'position_differs')), checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_db, check_code));
COMMENT ON TABLE core.legacy_cheque_opening_check IS 'a new Holoo year''s opening position of a continued cheque, compared with the core';

-- where a cheque was at the end of a day (its last live event up to that date; a cheque closed before migration keeps that state)
CREATE FUNCTION core.cheque_position_at(p_cheque bigint, p_date date) RETURNS TABLE (state text, account_id int, party_id int) LANGUAGE sql STABLE AS $$
  SELECT coalesce(x.event_type, c.closed_before_migration), x.to_account_id, x.to_party_id
  FROM core.cheque c LEFT JOIN LATERAL (
    SELECT e.event_type, e.to_account_id, e.to_party_id FROM core.cheque_event e
    WHERE e.cheque_id = c.id AND e.event_type IS NOT NULL AND e.reverses_event_id IS NULL AND e.effective_date <= p_date
      AND NOT EXISTS (SELECT 1 FROM core.cheque_event r WHERE r.reverses_event_id = e.id)
    ORDER BY e.effective_date DESC, e.id DESC LIMIT 1) x ON true
  WHERE c.id = p_cheque $$;

CREATE FUNCTION core.cheque_opening_controls(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT 'cheques', 'CHQ-OPEN', 'high', 'محل چک در افتتاحیه سال تازه هلو با محل آن در سیستم یکی نیست', count(*), sum(c.amount), 'E31'
  FROM core.legacy_cheque_opening_check o JOIN core.cheque c ON c.id = o.cheque_id WHERE o.status = 'position_differs' $$;

ALTER FUNCTION core.control_inbox(date) RENAME TO control_inbox_v32;
CREATE FUNCTION core.control_inbox(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT * FROM core.control_inbox_v32(p_as_of) UNION ALL SELECT * FROM core.cheque_opening_controls(p_as_of) $$;
