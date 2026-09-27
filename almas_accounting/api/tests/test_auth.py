"""Authentication (W-14) and service keys (W-15): core 025 + api/auth.py. Every rule is proven by trying to break it."""
import time

import psycopg
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from api import auth
from api.app import app
from api.tests.conftest import DSN

PW = "correct horse battery"


@pytest.fixture()
def c(db, monkeypatch):
    monkeypatch.setenv("ALMAS_PG_DSN", DSN)
    monkeypatch.delenv("ALMAS_API_DEV_AUTH", raising=False)                  # a real deployment: no development header
    monkeypatch.setenv("ALMAS_SECRET_KEY", Fernet.generate_key().decode())
    db.execute("INSERT INTO core.app_user (username) VALUES ('clerk'), ('boss'), ('boss2')")
    db.execute("INSERT INTO core.app_user (username, is_service) VALUES ('sync', true)")
    for u, p in (("boss", "security.admin"), ("boss2", "security.admin")):
        db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES (%s, %s, 't')", (u, p))
    db.execute("SELECT set_config('almas.operator_cli', 'on', false)")
    for u in ("clerk", "boss", "boss2"):
        db.execute("SELECT core.auth_set_password(%s, %s, 'system:test', false)", (u, auth.hash_password(PW, u)))
    db.execute("SELECT set_config('almas.operator_cli', 'off', false)")
    return TestClient(app)


def login(c, user, pw=PW, otp=None):
    return c.post("/auth/login", json={"username": user, "password": pw, "otp": otp})


def bearer(t):
    return {"Authorization": f"Bearer {t}"}


def enrol(c, token, pw=PW):
    e = c.post("/auth/mfa/enroll", headers=bearer(token), json={"password": pw}).json()
    code = auth.totp(e["secret"], int(time.time() // 30))
    assert c.post("/auth/mfa/confirm", headers=bearer(token), json={"pending": e["pending"], "code": code}).status_code == 200
    return e["secret"]


def test_only_argon2id_hashes_are_stored_and_nothing_leaks(c, db):
    hashes = [r[0] for r in db.execute("SELECT password_hash FROM core.app_credential")]
    assert hashes and all(h.startswith("$argon2id$") and PW not in h for h in hashes)
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("UPDATE core.app_credential SET password_hash = 'plain' WHERE username = 'clerk'")
    r = login(c, "clerk")
    assert r.status_code == 200 and PW not in r.text
    for table in ("audit_event", "auth_event", "app_session"):
        assert db.execute(f"SELECT count(*) FROM core.{table} WHERE row_to_json({table})::text LIKE %s", (f"%{PW}%",)).fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM core.app_session WHERE token_sha256 = %s", (r.json()["token"],)).fetchone()[0] == 0   # only the hash


def test_session_login_use_logout_and_expiry(c, db):
    assert c.get("/operations").status_code == 401
    assert c.get("/operations", headers={"X-Almas-User": "clerk"}).status_code == 401           # dev header is off
    t = login(c, "clerk").json()["token"]
    assert c.get("/operations", headers=bearer(t)).status_code == 200
    c.post("/auth/logout", headers=bearer(t))
    assert c.get("/operations", headers=bearer(t)).status_code == 401
    t2 = login(c, "clerk").json()["token"]
    db.execute("UPDATE core.app_session SET expires_at = now() - interval '1 second' WHERE token_sha256 = %s", (auth.sha256(t2),))
    assert c.get("/operations", headers=bearer(t2)).status_code == 401
    db.execute("UPDATE core.app_user SET active = false WHERE username = 'clerk'")
    assert login(c, "clerk").status_code == 401


def test_wrong_passwords_lock_the_account_and_are_recorded(c, db):
    assert login(c, "nobody").status_code == 401 and login(c, "clerk", "wrong password!").status_code == 401
    for _ in range(4):
        login(c, "clerk", "wrong password!")
    assert login(c, "clerk").status_code == 423                                                   # locked even with the right password
    ev = [r[0] for r in db.execute("SELECT event FROM core.auth_event WHERE username = 'clerk' ORDER BY id")]
    assert ev.count("login_fail") == 5 and "locked" in ev
    assert any(r[1] == "SEC-03" and r[4] == 1 for r in db.execute("SELECT * FROM core.control_inbox()"))


def test_admin_reset_forces_a_change_and_ends_sessions(c, db):
    boss = login(c, "boss").json()["token"]
    boss = bearer(boss)
    # boss holds security.admin → must enrol a second factor before doing anything else
    assert c.get("/operations", headers=boss).status_code == 403
    enrol(c, boss["Authorization"][7:])
    clerk = login(c, "clerk").json()["token"]
    assert c.post("/auth/admin/password", headers=boss, json={"username": "clerk", "new_password": "short"}).status_code == 422
    assert c.post("/auth/admin/password", headers=boss, json={"username": "clerk", "new_password": "temporary pass 1"}).status_code == 200
    assert c.get("/operations", headers=bearer(clerk)).status_code == 401                          # old session ended
    t = login(c, "clerk", "temporary pass 1").json()
    assert t["must_change_password"] is True
    assert c.get("/operations", headers=bearer(t["token"])).status_code == 403
    assert c.post("/auth/password", headers=bearer(t["token"]), json={"current_password": "temporary pass 1", "new_password": "temporary pass 1"}).status_code == 422
    assert c.post("/auth/password", headers=bearer(t["token"]), json={"current_password": "temporary pass 1", "new_password": "my own secret pw"}).status_code == 200
    assert c.get("/operations", headers=bearer(t["token"])).status_code == 200
    # a person without security.admin cannot reset anyone
    assert c.post("/auth/admin/password", headers=bearer(t["token"]), json={"username": "boss", "new_password": "hijack attempt 1"}).status_code == 403


def test_second_factor_required_verified_and_not_replayable(c, db):
    t = login(c, "boss").json()
    assert t["must_enroll_mfa"] is True
    secret = enrol(c, t["token"])
    assert login(c, "boss").status_code == 401                                                     # code now required
    step = int(time.time() // 30)
    code = auth.totp(secret, step + 1)                                                             # a code not used at enrolment
    ok = login(c, "boss", otp=code)
    assert ok.status_code == 200 and ok.json()["must_enroll_mfa"] is False
    assert login(c, "boss", otp=code).status_code == 401                                          # replay refused
    assert db.execute("SELECT mfa_secret_enc <> %s FROM core.app_credential WHERE username = 'boss'", (secret,)).fetchone()[0]   # stored encrypted
    boss2 = login(c, "boss2").json()["token"]
    enrol(c, boss2)
    # an admin cannot reset its own second factor; another admin can, with a reason
    tb = bearer(ok.json()["token"])
    assert c.post("/auth/admin/mfa_reset", headers=tb, json={"username": "boss", "reason": "lost phone"}).status_code == 400
    assert c.post("/auth/admin/mfa_reset", headers=tb, json={"username": "boss2", "reason": "lost phone"}).status_code == 200
    assert db.execute("SELECT mfa_enabled_at FROM core.app_credential WHERE username = 'boss2'").fetchone()[0] is None


def test_api_keys_for_services_only_with_ip_limits_and_revocation(c, db):
    t = login(c, "boss").json()["token"]
    secret = enrol(c, t)
    b = bearer(login(c, "boss", otp=auth.totp(secret, int(time.time() // 30) + 1)).json()["token"])
    assert c.post("/auth/admin/api_keys", headers=b, json={"username": "clerk", "name": "x"}).status_code == 400   # a person gets no key
    k = c.post("/auth/admin/api_keys", headers=b, json={"username": "sync", "name": "nightly sync", "allowed_ips": ["10.0.0.0/8"]}).json()
    assert c.get("/operations", headers={"X-Almas-Key": k["key"]}).status_code == 401              # the test client is not in 10/8
    k2 = c.post("/auth/admin/api_keys", headers=b, json={"username": "sync", "name": "open"}).json()       # no IP limit: flagged by SEC-02
    assert any(r[1] == "SEC-02" and r[4] >= 1 for r in db.execute("SELECT * FROM core.control_inbox()"))
    assert c.get("/operations", headers={"X-Almas-Key": k2["key"]}).status_code == 200
    assert db.execute("SELECT count(*) FROM core.api_key WHERE key_sha256 = %s", (k2["key"],)).fetchone()[0] == 0   # hash only
    assert c.post(f"/auth/admin/api_keys/{k2['id']}/revoke", headers=b).status_code == 200
    assert c.get("/operations", headers={"X-Almas-Key": k2["key"]}).status_code == 401


def test_system_credentials_only_through_the_operator_cli(db):
    db.execute("INSERT INTO core.app_user (username) VALUES ('x')")
    with pytest.raises(psycopg.errors.RaiseException, match="operator CLI"):
        db.execute("SELECT core.auth_set_password('x', %s, 'system:someone', false)", (auth.hash_password("abcdefghijk", "x"),))


def test_totp_matches_rfc6238_reference():
    # RFC 6238 appendix B, SHA-1 secret "12345678901234567890", T = 59 s → 94287082 (last 6 digits: 287082)
    import base64
    b32 = base64.b32encode(b"12345678901234567890").decode()
    assert auth.totp(b32, 59 // 30) == "287082"
