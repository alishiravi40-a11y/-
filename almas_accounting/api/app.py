"""Almas accounting API — one uniform contract over the core's operation catalog (core/schema/013_ai_catalog.sql).

Design (AI-native, simple):
  * the API holds NO business rule: every rule, permission and check is enforced by the database; the API only
    dispatches catalogued operations, so a person's UI and an AI agent use exactly the same, documented door;
  * GET  /operations            — what the authenticated user (or agent) may do now, with purpose, undo and basis;
  * POST /operations/{name}     — run one catalogued operation with NAMED arguments (validated against the function);
  * GET  /schema                — the core's self-description (tables, views, functions with their comments);
  * the acting user is injected by the API into p_user / p_by / p_created_by — never accepted from the caller;
  * every write is recorded in core.audit_event (operation, arguments, channel) in the same transaction as its effect.
Authentication (W-14, W-15; api/auth.py + core/schema/025_auth.sql): POST /auth/login gives a session token (Argon2id
password, TOTP second factor for people-only permissions, lockout); service accounts and AI agents use X-Almas-Key.
The development header X-Almas-User is accepted ONLY when ALMAS_API_DEV_AUTH=1.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import decimal
import ipaddress
import json
import os
import secrets
import threading

import psycopg
from psycopg.types.json import Jsonb
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from api import auth

ACTOR_PARAMS = {"p_user", "p_by", "p_created_by"}
@contextlib.asynccontextmanager
async def _lifespan(_app):
    # a Holoo import queued before a restart is picked up again (its steps are idempotent)
    if os.environ.get("ALMAS_PG_DSN") and os.environ.get("ALMAS_IMPORT_WORKER", "1") == "1":
        threading.Thread(target=run_import_worker, daemon=True).start()
    yield


app = FastAPI(title="Almas Shahr accounting API", version="0.4.0", lifespan=_lifespan)
# the web UI is a static page that uses nothing but this API (no logic of its own)
app.mount("/ui", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static"), html=True), name="ui")


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/ui/")


def dsn() -> str:
    d = os.environ.get("ALMAS_PG_DSN")
    if not d:
        raise HTTPException(503, "ALMAS_PG_DSN is not configured")
    return d


def _session(token: str) -> tuple[str, bool, bool] | None:
    with psycopg.connect(dsn(), autocommit=True) as c:
        return c.execute("SELECT username, must_change, mfa_missing FROM core.auth_session_user(%s)", (auth.sha256(token),)).fetchone()


def _ip(request: Request) -> str | None:
    """The caller's address, or None when it is not an IP (an IP-restricted key is then refused)."""
    try:
        return str(ipaddress.ip_address(request.client.host)) if request.client else None
    except ValueError:
        return None


def _identify(request: Request, authorization: str | None, x_almas_key: str | None, x_almas_user: str | None) -> tuple[str, bool, bool]:
    """(user, must_change, mfa_missing). Bearer session → API key → development header (only with ALMAS_API_DEV_AUTH=1)."""
    if authorization and authorization.lower().startswith("bearer "):
        row = _session(authorization[7:].strip())
        if not row:
            raise HTTPException(401, "نشست منقضی یا نامعتبر است؛ دوباره وارد شوید")
        return row
    if x_almas_key:
        with psycopg.connect(dsn(), autocommit=True) as c:
            u = c.execute("SELECT core.api_key_user(%s, %s)", (auth.sha256(x_almas_key), _ip(request))).fetchone()[0]
        if not u:
            raise HTTPException(401, "invalid, expired, revoked or out-of-range API key")
        return u, False, False
    if os.environ.get("ALMAS_API_DEV_AUTH") == "1" and x_almas_user:
        with psycopg.connect(dsn()) as c:
            if not c.execute("SELECT 1 FROM core.app_user WHERE username = %s AND active", (x_almas_user,)).fetchone():
                raise HTTPException(401, "unknown or inactive user")
        return x_almas_user, False, False
    raise HTTPException(401, "ابتدا با نام کاربری و رمز وارد شوید")


def authenticate(request: Request, authorization: str | None = Header(default=None), x_almas_key: str | None = Header(default=None),
                 x_almas_user: str | None = Header(default=None)) -> str:
    """A fully authenticated user: password changed if required, second factor enrolled if required (W-14)."""
    user, must_change, mfa_missing = _identify(request, authorization, x_almas_key, x_almas_user)
    if must_change:
        raise HTTPException(403, "password change required (POST /auth/password)")
    if mfa_missing:
        raise HTTPException(403, "second factor enrolment required (POST /auth/mfa/enroll)")
    return user


def authenticate_partial(request: Request, authorization: str | None = Header(default=None), x_almas_key: str | None = Header(default=None),
                         x_almas_user: str | None = Header(default=None)) -> str:
    """Signed in, possibly still owing a password change or MFA enrolment — only for the /auth endpoints that fix that."""
    return _identify(request, authorization, x_almas_key, x_almas_user)[0]


def _client(request: Request) -> str:
    return f"{request.client.host if request.client else '?'} {request.headers.get('user-agent', '')[:80]}"


def _db_error(e: Exception):
    if isinstance(e, psycopg.errors.InsufficientPrivilege):
        return HTTPException(403, str(e).split("\n")[0])
    return HTTPException(400, str(e).split("\n")[0])


class Login(BaseModel):
    username: str
    password: str
    otp: str | None = None


@app.post("/auth/login")
def login(body: Login, request: Request):
    generic = HTTPException(401, "نام کاربری، رمز یا کد یکبار مصرف نادرست است")
    with psycopg.connect(dsn(), autocommit=True) as c:
        row = c.execute("""SELECT c.password_hash, c.locked_until > now(), c.mfa_secret_enc FROM core.app_user u
                           LEFT JOIN core.app_credential c ON c.username = u.username WHERE u.username = %s AND u.active""", (body.username,)).fetchone()
        if not auth.verify_password(row[0] if row else None, body.password):
            if row and row[0]:
                c.execute("SELECT core.auth_record_failure(%s, %s)", (body.username, _client(request)))
            raise generic
        if row[1]:
            raise HTTPException(423, "حساب به‌دلیل تلاش‌های ناموفق موقتاً قفل است")
        step = None
        if row[2]:
            step = auth.totp_match(auth.decrypt_secret(row[2]), body.otp or "")
            if step is None:
                c.execute("SELECT core.auth_record_failure(%s, %s, 'mfa_fail')", (body.username, _client(request)))
                raise generic
        token = auth.new_token()
        try:
            exp = c.execute("SELECT core.auth_login_ok(%s, %s, %s, %s)", (body.username, auth.sha256(token), _client(request), step)).fetchone()[0]
        except psycopg.errors.RaiseException:
            raise generic
        st = c.execute("SELECT must_change, mfa_missing FROM core.auth_session_user(%s)", (auth.sha256(token),)).fetchone()
    return {"token": token, "expires_at": exp.isoformat(), "must_change_password": st[0], "must_enroll_mfa": st[1]}


@app.post("/auth/logout")
def logout(request: Request, authorization: str | None = Header(default=None)):
    if authorization and authorization.lower().startswith("bearer "):
        with psycopg.connect(dsn(), autocommit=True) as c:
            c.execute("SELECT core.auth_logout(%s, %s)", (auth.sha256(authorization[7:].strip()), _client(request)))
    return {"ok": True}


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@app.post("/auth/password")
def change_password(body: PasswordChange, request: Request, user: str = Depends(authenticate_partial)):
    with psycopg.connect(dsn(), autocommit=True) as c:
        cur = c.execute("SELECT password_hash FROM core.app_credential WHERE username = %s", (user,)).fetchone()
        if not auth.verify_password(cur[0] if cur else None, body.current_password):
            c.execute("SELECT core.auth_record_failure(%s, %s)", (user, _client(request)))
            raise HTTPException(401, "رمز فعلی نادرست است")
        try:
            h = auth.hash_password(body.new_password, user)
        except ValueError as e:
            raise HTTPException(422, str(e))
        if auth.verify_password(cur[0], body.new_password):
            raise HTTPException(422, "رمز تازه باید با رمز فعلی فرق کند")
        c.execute("SELECT core.auth_set_password(%s, %s, %s, false, %s)", (user, h, user, _client(request)))
    return {"ok": True}


class MfaEnroll(BaseModel):
    password: str


class MfaConfirm(BaseModel):
    pending: str
    code: str


@app.post("/auth/mfa/enroll")
def mfa_enroll(body: MfaEnroll, user: str = Depends(authenticate_partial)):
    with psycopg.connect(dsn(), autocommit=True) as c:
        cur = c.execute("SELECT password_hash FROM core.app_credential WHERE username = %s", (user,)).fetchone()
    if not auth.verify_password(cur[0] if cur else None, body.password):
        raise HTTPException(401, "رمز نادرست است")
    secret = auth.new_totp_secret()
    # nothing is stored until the first code proves the authenticator app has the secret
    return {"otpauth_uri": auth.otpauth_uri(secret, user), "secret": secret, "pending": auth.encrypt_secret(f"{user}:{secret}")}


@app.post("/auth/mfa/confirm")
def mfa_confirm(body: MfaConfirm, user: str = Depends(authenticate_partial)):
    try:
        owner, secret = auth.decrypt_secret(body.pending).split(":", 1)
    except Exception:
        raise HTTPException(400, "invalid enrolment")
    if owner != user:
        raise HTTPException(403, "this enrolment belongs to another user")
    step = auth.totp_match(secret, body.code)
    if step is None:
        raise HTTPException(401, "کد یکبار مصرف نادرست است")
    with psycopg.connect(dsn(), autocommit=True) as c:
        c.execute("SELECT core.auth_mfa_enable(%s, %s, %s)", (user, auth.encrypt_secret(secret), step))
    return {"ok": True}


class AdminPassword(BaseModel):
    username: str
    new_password: str


@app.post("/auth/admin/password")
def admin_password(body: AdminPassword, request: Request, user: str = Depends(authenticate)):
    try:
        h = auth.hash_password(body.new_password, body.username)
    except ValueError as e:
        raise HTTPException(422, str(e))
    with psycopg.connect(dsn(), autocommit=True) as c:
        try:
            c.execute("SELECT core.auth_set_password(%s, %s, %s, true, %s)", (body.username, h, user, _client(request)))
        except psycopg.Error as e:
            raise _db_error(e)
    return {"ok": True, "must_change_password": True}


class AdminMfaReset(BaseModel):
    username: str
    reason: str


@app.post("/auth/admin/mfa_reset")
def admin_mfa_reset(body: AdminMfaReset, user: str = Depends(authenticate)):
    with psycopg.connect(dsn(), autocommit=True) as c:
        try:
            c.execute("SELECT core.auth_mfa_reset(%s, %s, %s)", (body.username, user, body.reason))
        except psycopg.Error as e:
            raise _db_error(e)
    return {"ok": True}


class ApiKeyCreate(BaseModel):
    username: str
    name: str
    expires_days: int | None = 90
    allowed_ips: list[str] | None = None


@app.post("/auth/admin/api_keys")
def api_key_create(body: ApiKeyCreate, user: str = Depends(authenticate)):
    secret = auth.new_token()
    prefix = secrets.token_hex(4)
    key = f"alm_{prefix}_{secret}"
    exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=body.expires_days) if body.expires_days else None
    with psycopg.connect(dsn(), autocommit=True) as c:
        try:
            kid = c.execute("SELECT core.api_key_create(%s, %s, %s, %s, %s, %s::cidr[], %s)",
                            (body.username, prefix, auth.sha256(key), body.name, exp, body.allowed_ips, user)).fetchone()[0]
        except psycopg.Error as e:
            raise _db_error(e)
    return {"id": kid, "key": key, "note": "the key is shown once; only its hash is stored"}


@app.post("/auth/admin/api_keys/{key_id}/revoke")
def api_key_revoke(key_id: int, user: str = Depends(authenticate)):
    with psycopg.connect(dsn(), autocommit=True) as c:
        try:
            c.execute("SELECT core.api_key_revoke(%s, %s)", (key_id, user))
        except psycopg.Error as e:
            raise _db_error(e)
    return {"ok": True}


def _jsonable(v):
    if isinstance(v, decimal.Decimal):
        return str(v)                                   # exact: amounts never go through float
    if isinstance(v, (dt.date, dt.datetime, dt.time)):
        return v.isoformat()
    return v


def _rows(cur) -> list[dict]:
    cols = [d.name for d in cur.description] if cur.description else []
    return [{k: _jsonable(v) for k, v in zip(cols, r)} for r in cur.fetchall()]


@app.get("/health")
def health():
    with psycopg.connect(dsn()) as c:
        return {"database": c.execute("SELECT 1").fetchone()[0] == 1}


@app.get("/operations")
def operations(user: str = Depends(authenticate)):
    with psycopg.connect(dsn()) as c:
        return _rows(c.execute("SELECT * FROM core.operations_for(%s)", (user,)))


@app.get("/schema")
def schema(user: str = Depends(authenticate)):
    with psycopg.connect(dsn()) as c:
        if c.execute("SELECT EXISTS (SELECT 1 FROM core.sales_agent_user WHERE username = %s)", (user,)).fetchone()[0]:
            raise HTTPException(403, "the agent workspace has no access to the central schema")
        return _rows(c.execute("SELECT * FROM core.schema_catalog ORDER BY object_kind, name"))


class Call(BaseModel):
    args: dict = {}
    note: str | None = None


@app.post("/operations/{operation}")
def call(operation: str, body: Call, user: str = Depends(authenticate)):
    return run_operation(user, operation, body.args, body.note)


def run_operation(user: str, operation: str, call_args: dict, note: str | None = None, channel: str = "api") -> dict:
    """The one door: permission (database), named arguments, injected actor, audit — for /operations and for file uploads."""
    body = Call(args=call_args, note=note)
    # autocommit: the transaction below is the real one, so deferred checks (e.g. negative stock) fire inside it
    with psycopg.connect(dsn(), autocommit=True) as c:
        op = c.execute("""SELECT kind, function_signature FROM core.operation_catalog WHERE operation = %s""", (operation,)).fetchone()
        if not op:
            raise HTTPException(404, f"unknown operation {operation}")
        kind, sig = op
        try:                                            # agent users: agent-scoped operations only (core 021)
            c.execute("SELECT core.require_operation(%s, %s)", (user, operation))
        except psycopg.errors.InsufficientPrivilege as e:
            raise HTTPException(403, str(e).split("\n")[0])
        names = c.execute("""SELECT p.proargnames, p.pronargs, p.proretset, pg_get_function_identity_arguments(p.oid)
                             FROM pg_proc p WHERE p.oid = to_regprocedure(%s)""", (sig,)).fetchone()
        argnames = [n for n in (names[0] or [])][: names[1]]
        bad = set(body.args) - set(argnames)
        if bad:
            raise HTTPException(422, f"unknown argument(s) {sorted(bad)}; expected {argnames}")
        if set(body.args) & ACTOR_PARAMS:
            raise HTTPException(422, "the acting user is set by the API, not by the caller")
        args = {k: (Jsonb(v) if isinstance(v, (dict, list)) else v) for k, v in body.args.items()}   # JSON → jsonb
        for a in argnames:
            if a in ACTOR_PARAMS:
                args[a] = user
        fn = sig.split("(")[0]
        sql = f"SELECT * FROM {fn}(" + ", ".join(f"{a} => %({a})s" for a in args) + ")"
        try:
            with c.transaction():
                cur = c.execute(sql, args)
                result = _rows(cur)
                if kind == "write":
                    c.execute("""INSERT INTO core.audit_event (actor, action, object_type, object_id, after, reason)
                                 VALUES (%s, 'api_call', 'operation', %s, %s::jsonb, %s)""",
                              (user, operation, json.dumps({"args": body.args, "channel": channel}, default=str), body.note))
        except psycopg.errors.InsufficientPrivilege as e:
            raise HTTPException(403, str(e).split("\n")[0])
        except (psycopg.errors.RaiseException, psycopg.errors.IntegrityError, psycopg.errors.DataError) as e:
            raise HTTPException(400, str(e).split("\n")[0])
        return {"operation": operation, "kind": kind, "rows": result}


# ---------- files: a bank statement, a Holoo backup (the file is read here; the effect is a catalogued operation) ----------
MAX_STATEMENT_BYTES = 20 << 20


@app.post("/files/bank_statement")
async def upload_bank_statement(request: Request, account: int, name: str, user: str = Depends(authenticate)):
    from treasury import statement_file
    data = await request.body()
    if not data or len(data) > MAX_STATEMENT_BYTES:
        raise HTTPException(400, "فایل خالی است یا از ۲۰ مگابایت بزرگ‌تر است")
    try:
        lines = statement_file.read_statement(data, name)
    except statement_file.StatementError as e:
        raise HTTPException(400, str(e))
    except Exception as e:                                          # a damaged or unknown file
        raise HTTPException(400, f"فایل خوانده نشد: {type(e).__name__}")
    res = run_operation(user, "bank.statement_import", {"p_account": account, "p_file_name": os.path.basename(name)[:200],
                                                        "p_sha256": statement_file.sha256(data), "p_lines": lines}, channel="file_upload")
    st = res["rows"][0]["bank_statement_import"]
    st = json.loads(st) if isinstance(st, str) else st
    ids = st.pop("installment_line_ids", None) or []
    if ids:                                                         # Beta scheme account: suggest the installment (a person confirms)
        from beta import statement_import as beta_st
        with psycopg.connect(dsn(), autocommit=True) as c:
            for lid, value_date, dep, did, desc in c.execute("""SELECT id, value_date, deposit, deposit_id, description FROM core.bank_statement_line
                                                                 WHERE id = ANY (%s)""", (ids,)).fetchall():
                status, detail = beta_st.match(c, {"date": value_date, "deposit": int(dep), "deposit_id": did or "", "description": desc or ""}, account)
                c.execute("UPDATE core.bank_statement_line SET match_status = %s, match_detail = %s WHERE id = %s",
                          (status, json.dumps(detail, default=str), lid))
                st.setdefault("installment_match", {}).setdefault(status, 0)
                st["installment_match"][status] += 1
    return st


def upload_dir() -> str:
    d = os.environ.get("ALMAS_UPLOAD_DIR") or os.path.join(os.path.expanduser("~"), ".almas", "uploads")
    os.makedirs(d, exist_ok=True)
    return d


@app.post("/files/holoo_backup")
async def upload_holoo_backup(request: Request, name: str, user: str = Depends(authenticate)):
    import re
    with psycopg.connect(dsn(), autocommit=True) as c:             # refuse early: permission, and one import at a time
        try:
            c.execute("SELECT core.require_operation(%s, 'imports.queue')", (user,))
        except psycopg.errors.InsufficientPrivilege as e:
            raise HTTPException(403, str(e).split("\n")[0])
        if c.execute("SELECT EXISTS (SELECT 1 FROM core.holoo_import_batch WHERE status IN ('queued', 'running'))").fetchone()[0]:
            raise HTTPException(409, "یک ورود Backup در صف یا در حال اجراست؛ پس از پایان آن دوباره بفرستید")
    base = re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(name))[-80:] or "backup.bak"
    stored = f"{dt.datetime.now():%Y%m%d%H%M%S}_{secrets.token_hex(3)}_{base}"
    path = os.path.join(upload_dir(), stored)
    size = 0
    with open(path, "wb") as f:                                     # streamed: a backup is hundreds of megabytes
        async for chunk in request.stream():
            f.write(chunk)
            size += len(chunk)
    if size == 0:
        os.remove(path)
        raise HTTPException(400, "فایل خالی است")
    res = run_operation(user, "imports.queue", {"p_file_name": stored}, channel="file_upload")
    batch = res["rows"][0]["import_queue"]
    if os.environ.get("ALMAS_IMPORT_WORKER", "1") == "1":
        threading.Thread(target=run_import_worker, daemon=True).start()
    return {"batch": batch, "bytes": size, "status": "queued"}


def run_import_worker():
    """Runs the queued Holoo import (the pipeline of migration/import_backup.py) in the server process."""
    from migration import import_backup
    try:
        import_backup.run_queued(dsn(), upload_dir(), os.environ.get("ALMAS_HOLOO_WORKDIR") or os.path.join(upload_dir(), "..", "holoo_work"))
    except Exception:                                               # recorded on the batch by the importer
        pass

