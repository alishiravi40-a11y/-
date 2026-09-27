"""Almas accounting API — one uniform contract over the core's operation catalog (core/schema/013_ai_catalog.sql).

Design (AI-native, simple):
  * the API holds NO business rule: every rule, permission and check is enforced by the database; the API only
    dispatches catalogued operations, so a person's UI and an AI agent use exactly the same, documented door;
  * GET  /operations            — what the authenticated user (or agent) may do now, with purpose, undo and basis;
  * POST /operations/{name}     — run one catalogued operation with NAMED arguments (validated against the function);
  * GET  /schema                — the core's self-description (tables, views, functions with their comments);
  * the acting user is injected by the API into p_user / p_by / p_created_by — never accepted from the caller;
  * every write is recorded in core.audit_event (operation, arguments, channel) in the same transaction as its effect.
Authentication is pluggable: `authenticate()` must be replaced at deployment (W-14: strong password hashing, MFA).
The development header X-Almas-User is accepted ONLY when ALMAS_API_DEV_AUTH=1.
"""
from __future__ import annotations

import datetime as dt
import decimal
import json
import os

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ACTOR_PARAMS = {"p_user", "p_by", "p_created_by"}
app = FastAPI(title="Almas Shahr accounting API", version="0.2.0")
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


def authenticate(x_almas_user: str | None = Header(default=None)) -> str:
    """Development authentication only. Replace with the deployment's identity provider (W-14)."""
    if os.environ.get("ALMAS_API_DEV_AUTH") != "1":
        raise HTTPException(401, "no authentication configured for this deployment")
    if not x_almas_user:
        raise HTTPException(401, "missing X-Almas-User")
    with psycopg.connect(dsn()) as c:
        if not c.execute("SELECT 1 FROM core.app_user WHERE username = %s AND active", (x_almas_user,)).fetchone():
            raise HTTPException(401, "unknown or inactive user")
    return x_almas_user


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
        return _rows(c.execute("SELECT * FROM core.schema_catalog ORDER BY object_kind, name"))


class Call(BaseModel):
    args: dict = {}
    note: str | None = None


@app.post("/operations/{operation}")
def call(operation: str, body: Call, user: str = Depends(authenticate)):
    with psycopg.connect(dsn()) as c:
        op = c.execute("""SELECT kind, function_signature FROM core.operation_catalog WHERE operation = %s""", (operation,)).fetchone()
        if not op:
            raise HTTPException(404, f"unknown operation {operation}")
        kind, sig = op
        names = c.execute("""SELECT p.proargnames, p.pronargs, p.proretset, pg_get_function_identity_arguments(p.oid)
                             FROM pg_proc p WHERE p.oid = to_regprocedure(%s)""", (sig,)).fetchone()
        argnames = [n for n in (names[0] or [])][: names[1]]
        bad = set(body.args) - set(argnames)
        if bad:
            raise HTTPException(422, f"unknown argument(s) {sorted(bad)}; expected {argnames}")
        if set(body.args) & ACTOR_PARAMS:
            raise HTTPException(422, "the acting user is set by the API, not by the caller")
        args = dict(body.args)
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
                              (user, operation, json.dumps({"args": body.args, "channel": "api"}, default=str), body.note))
        except psycopg.errors.InsufficientPrivilege as e:
            raise HTTPException(403, str(e).split("\n")[0])
        except (psycopg.errors.RaiseException, psycopg.errors.IntegrityError, psycopg.errors.DataError) as e:
            raise HTTPException(400, str(e).split("\n")[0])
        return {"operation": operation, "kind": kind, "rows": result}
