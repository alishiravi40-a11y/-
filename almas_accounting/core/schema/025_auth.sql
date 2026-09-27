-- Almas Shahr accounting — core v0.25: authentication (W-14) and service keys (W-15).
-- Holoo kept passwords in a primary key, a 4-character admin password and an unknown hash (W-14), and ran its web service as a
-- supervisor (W-15). Here:
--   * only an Argon2id hash is stored (computed by the API; this schema refuses anything else); no password is ever logged;
--   * sessions are random tokens of which only the SHA-256 is stored; they expire and can be revoked;
--   * repeated failures lock the account for a while; every login, failure, lock, logout and credential change is an
--     append-only auth event;
--   * a second factor (TOTP) is REQUIRED for anyone holding a people-only permission (closing periods, security, settings,
--     paying agents, approving agent deals, bank-side Beta changes); its secret is stored encrypted (key outside the DB);
--   * service accounts and AI agents use API keys (hash stored, optional IP allow-list, expiry, revocation) — never a person's
--     password, and a person never gets an API key.
-- Proven by api/tests/test_auth.py.

INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('auth_session_hours', '12', NULL, '^[0-9]{1,3}$', 'W-14'),
  ('auth_lockout_threshold', '5', NULL, '^[0-9]{1,2}$', 'W-14'),
  ('auth_lockout_minutes', '15', NULL, '^[0-9]{1,4}$', 'W-14');

CREATE TABLE core.app_credential (
  username text PRIMARY KEY REFERENCES core.app_user,
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  must_change boolean NOT NULL DEFAULT false, set_by text NOT NULL, set_at timestamptz NOT NULL DEFAULT now(),
  failed_count int NOT NULL DEFAULT 0, locked_until timestamptz,
  mfa_secret_enc text, mfa_enabled_at timestamptz, mfa_last_step bigint);
COMMENT ON TABLE core.app_credential IS 'Argon2id password hash and encrypted TOTP secret per user; never a password (W-14)';

CREATE TABLE core.app_session (
  token_sha256 text PRIMARY KEY, username text NOT NULL REFERENCES core.app_user, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, last_seen_at timestamptz, revoked_at timestamptz, client text);
CREATE INDEX app_session_user ON core.app_session (username);

CREATE TABLE core.api_key (
  id serial PRIMARY KEY, key_prefix text UNIQUE NOT NULL, key_sha256 text UNIQUE NOT NULL, username text NOT NULL REFERENCES core.app_user,
  name text NOT NULL, allowed_ips cidr[], expires_at timestamptz, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz, revoked_at timestamptz, revoked_by text);

CREATE TABLE core.auth_event (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT clock_timestamp(), username text, event text NOT NULL
    CHECK (event IN ('login_ok', 'login_fail', 'locked', 'logout', 'password_set', 'password_changed', 'mfa_enrolled', 'mfa_reset',
                     'mfa_fail', 'api_key_created', 'api_key_revoked', 'sessions_revoked')),
  actor text, client text, detail text);
CREATE TRIGGER auth_event_immutable BEFORE UPDATE OR DELETE ON core.auth_event FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

-- MFA is required for whoever holds a permission reserved for people
CREATE FUNCTION core.mfa_required(p_user text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM core.user_permission WHERE username = p_user AND permission IN
    ('security.admin', 'settings.change', 'period.close', 'period.reopen', 'beta.order_change', 'agent.settle', 'agent.deal_approve')) $$;

-- who may set a password: the user itself (change), a security admin (reset), or the operator's bootstrap CLI
CREATE FUNCTION core.auth_set_password(p_target text, p_hash text, p_by text, p_must_change boolean, p_client text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_by LIKE 'system:%' THEN
    IF coalesce(current_setting('almas.operator_cli', true), 'off') <> 'on' THEN RAISE EXCEPTION 'system credentials are set only by the operator CLI'; END IF;
  ELSIF p_by <> p_target THEN
    PERFORM core.require_permission(p_by, 'security.admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.app_user WHERE username = p_target) THEN RAISE EXCEPTION 'unknown user %', p_target; END IF;
  INSERT INTO core.app_credential (username, password_hash, must_change, set_by) VALUES (p_target, p_hash, p_must_change, p_by)
  ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change = EXCLUDED.must_change, set_by = EXCLUDED.set_by,
    set_at = now(), failed_count = 0, locked_until = NULL;
  IF p_by <> p_target THEN                                              -- a reset ends every open session of that user
    UPDATE core.app_session SET revoked_at = now() WHERE username = p_target AND revoked_at IS NULL;
  END IF;
  INSERT INTO core.auth_event (username, event, actor, client) VALUES (p_target, CASE WHEN p_by = p_target THEN 'password_changed' ELSE 'password_set' END, p_by, p_client);
END $$;

-- a failed attempt; returns the lock time if the account is (now) locked
CREATE FUNCTION core.auth_record_failure(p_user text, p_client text, p_what text DEFAULT 'login_fail') RETURNS timestamptz LANGUAGE plpgsql AS $$
DECLARE n int; lk timestamptz;
BEGIN
  INSERT INTO core.auth_event (username, event, client) VALUES (p_user, p_what, p_client);
  UPDATE core.app_credential SET failed_count = failed_count + 1 WHERE username = p_user RETURNING failed_count INTO n;
  IF n IS NOT NULL AND n >= core.setting_value('auth_lockout_threshold')::int THEN
    lk := now() + make_interval(mins => core.setting_value('auth_lockout_minutes')::int);
    UPDATE core.app_credential SET locked_until = lk, failed_count = 0 WHERE username = p_user;
    INSERT INTO core.auth_event (username, event, client, detail) VALUES (p_user, 'locked', p_client, 'until ' || lk);
  END IF;
  RETURN lk;
END $$;

CREATE FUNCTION core.auth_login_ok(p_user text, p_token_sha256 text, p_client text, p_mfa_step bigint DEFAULT NULL) RETURNS timestamptz LANGUAGE plpgsql AS $$
DECLARE exp timestamptz := now() + make_interval(hours => core.setting_value('auth_session_hours')::int);
BEGIN
  IF p_mfa_step IS NOT NULL AND p_mfa_step <= coalesce((SELECT mfa_last_step FROM core.app_credential WHERE username = p_user), -1) THEN
    RAISE EXCEPTION 'one-time code already used'; END IF;
  UPDATE core.app_credential SET failed_count = 0, locked_until = NULL, mfa_last_step = coalesce(p_mfa_step, mfa_last_step) WHERE username = p_user;
  INSERT INTO core.app_session (token_sha256, username, expires_at, client) VALUES (p_token_sha256, p_user, exp, p_client);
  INSERT INTO core.auth_event (username, event, client) VALUES (p_user, 'login_ok', p_client);
  RETURN exp;
END $$;

-- the user of a live session, and what still has to happen before it may work (password change, MFA enrolment)
CREATE FUNCTION core.auth_session_user(p_token_sha256 text)
RETURNS TABLE (username text, must_change boolean, mfa_missing boolean) LANGUAGE plpgsql AS $$
BEGIN
  UPDATE core.app_session s SET last_seen_at = now()
  WHERE s.token_sha256 = p_token_sha256 AND s.revoked_at IS NULL AND s.expires_at > now();
  RETURN QUERY
  SELECT s.username, coalesce(c.must_change, false), core.mfa_required(s.username) AND c.mfa_enabled_at IS NULL
  FROM core.app_session s JOIN core.app_user u ON u.username = s.username AND u.active LEFT JOIN core.app_credential c ON c.username = s.username
  WHERE s.token_sha256 = p_token_sha256 AND s.revoked_at IS NULL AND s.expires_at > now();
END $$;

CREATE FUNCTION core.auth_logout(p_token_sha256 text, p_client text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u text;
BEGIN
  UPDATE core.app_session SET revoked_at = now() WHERE token_sha256 = p_token_sha256 AND revoked_at IS NULL RETURNING username INTO u;
  IF u IS NOT NULL THEN INSERT INTO core.auth_event (username, event, client) VALUES (u, 'logout', p_client); END IF;
END $$;

CREATE FUNCTION core.auth_mfa_enable(p_user text, p_secret_enc text, p_step bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE core.app_credential SET mfa_secret_enc = p_secret_enc, mfa_enabled_at = now(), mfa_last_step = p_step WHERE username = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'user % has no password credential', p_user; END IF;
  INSERT INTO core.auth_event (username, event, actor) VALUES (p_user, 'mfa_enrolled', p_user);
END $$;

CREATE FUNCTION core.auth_mfa_reset(p_target text, p_by text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_by, 'security.admin'); PERFORM core.require_reason(p_reason);
  IF p_by = p_target THEN RAISE EXCEPTION 'a second factor is reset by another administrator'; END IF;
  UPDATE core.app_credential SET mfa_secret_enc = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL WHERE username = p_target;
  UPDATE core.app_session SET revoked_at = now() WHERE username = p_target AND revoked_at IS NULL;
  INSERT INTO core.auth_event (username, event, actor, detail) VALUES (p_target, 'mfa_reset', p_by, p_reason);
END $$;

-- API keys only for service accounts and AI agents (W-15): a person signs in, it does not get a key
CREATE FUNCTION core.api_key_create(p_user text, p_prefix text, p_sha256 text, p_name text, p_expires timestamptz, p_ips cidr[], p_by text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE kid int;
BEGIN
  PERFORM core.require_permission(p_by, 'security.admin');
  IF NOT EXISTS (SELECT 1 FROM core.app_user WHERE username = p_user AND (is_service OR is_ai_agent)) THEN
    RAISE EXCEPTION 'API keys are for service accounts and AI agents only; % is a person', p_user; END IF;
  INSERT INTO core.api_key (key_prefix, key_sha256, username, name, allowed_ips, expires_at, created_by)
  VALUES (p_prefix, p_sha256, p_user, p_name, p_ips, p_expires, p_by) RETURNING id INTO kid;
  INSERT INTO core.auth_event (username, event, actor, detail) VALUES (p_user, 'api_key_created', p_by, p_name || ' (' || p_prefix || ')');
  RETURN kid;
END $$;

CREATE FUNCTION core.api_key_revoke(p_key int, p_by text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u text;
BEGIN
  PERFORM core.require_permission(p_by, 'security.admin');
  UPDATE core.api_key SET revoked_at = now(), revoked_by = p_by WHERE id = p_key AND revoked_at IS NULL RETURNING username INTO u;
  IF u IS NULL THEN RAISE EXCEPTION 'key % not found or already revoked', p_key; END IF;
  INSERT INTO core.auth_event (username, event, actor, detail) VALUES (u, 'api_key_revoked', p_by, p_key::text);
END $$;

CREATE FUNCTION core.api_key_user(p_sha256 text, p_ip inet) RETURNS text LANGUAGE plpgsql AS $$
DECLARE k core.api_key;
BEGIN
  SELECT * INTO k FROM core.api_key WHERE key_sha256 = p_sha256 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF k.allowed_ips IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(k.allowed_ips) n WHERE p_ip <<= n) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM core.app_user WHERE username = k.username AND active) THEN RETURN NULL; END IF;
  UPDATE core.api_key SET last_used_at = now() WHERE id = k.id;
  RETURN k.username;
END $$;

-- control: people who must have a second factor and still do not
CREATE FUNCTION core.auth_controls(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT 'security', 'SEC-01', 'high', 'کاربر دارای مجوز حساس بدون ورود دومرحله‌ای', count(*), NULL::numeric, 'W-14'
  FROM core.app_user u LEFT JOIN core.app_credential c ON c.username = u.username
  WHERE u.active AND NOT u.is_service AND NOT u.is_ai_agent AND core.mfa_required(u.username) AND c.mfa_enabled_at IS NULL
  UNION ALL
  SELECT 'security', 'SEC-02', 'medium', 'کلید API فعال بدون تاریخ انقضا یا محدودیت IP', count(*), NULL::numeric, 'W-15'
  FROM core.api_key WHERE revoked_at IS NULL AND (expires_at IS NULL OR allowed_ips IS NULL)
  UNION ALL
  SELECT 'security', 'SEC-03', 'medium', 'حساب قفل‌شده در ۲۴ ساعت گذشته (تلاش ناموفق مکرر)', count(DISTINCT username), NULL::numeric, 'W-14'
  FROM core.auth_event WHERE event = 'locked' AND at > p_as_of::timestamptz - interval '1 day' AND at < p_as_of::timestamptz + interval '1 day' $$;

ALTER FUNCTION core.control_inbox(date) RENAME TO control_inbox_v24;
CREATE FUNCTION core.control_inbox(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT * FROM core.control_inbox_v24(p_as_of) UNION ALL SELECT * FROM core.auth_controls(p_as_of) $$;
