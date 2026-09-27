"""API over the operation catalog: authentication, dispatch, actor injection, DB-enforced permissions, audit."""
import os

import pytest
from fastapi.testclient import TestClient

from api.app import app
from api.tests.conftest import DSN
from migration.tests.test_receivables import post


@pytest.fixture()
def client(db, monkeypatch):
    monkeypatch.setenv("ALMAS_PG_DSN", DSN)
    monkeypatch.setenv("ALMAS_API_DEV_AUTH", "1")
    from migration import holoo_ledger as M
    M.ensure_fiscal_year(db, "1405")
    for code, party in [("1030008", True), ("9010001", False), ("10200010001", False)]:
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES (%s, %s, 2, true, 'either', 'balance_sheet', %s)",
                   (code, code, party))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    p = db.execute("INSERT INTO core.party (name) VALUES ('synthetic') RETURNING id").fetchone()[0]
    db.execute("INSERT INTO core.app_user (username, is_ai_agent) VALUES ('clerk', false), ('viewer', false), ('agent', true)")
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('clerk', 'ar.allocate', 't'), ('agent', 'ar.allocate', 't')")
    post(db, ids, p, "2026-04-01", 1000); post(db, ids, p, "2026-04-20", 1000, "receipt")
    return TestClient(app), ids, p


def h(user):
    return {"X-Almas-User": user}


def test_authentication(client, monkeypatch):
    c, ids, p = client
    assert c.get("/operations").status_code == 401
    assert c.get("/operations", headers=h("nobody")).status_code == 401
    monkeypatch.setenv("ALMAS_API_DEV_AUTH", "0")
    assert c.get("/operations", headers=h("clerk")).status_code == 401          # no dev auth outside development


def test_operations_list_and_self_description(client):
    c, ids, p = client
    ops = {o["operation"]: o for o in c.get("/operations", headers=h("viewer")).json()}
    assert ops["ar.allocate"]["permitted"] is False and ops["ar.aging"]["permitted"] is True and ops["year.close"]["undo"]
    assert {o["operation"]: o["permitted"] for o in c.get("/operations", headers=h("agent")).json()}["year.close"] is False
    assert any(s["name"] == "settlement" for s in c.get("/schema", headers=h("viewer")).json())


def test_write_is_permission_checked_by_the_database_and_audited(client, db):
    c, ids, p = client
    args = {"p_account": ids["1030008"], "p_party": p}
    assert c.post("/operations/ar.allocate_fifo", json={"args": args}, headers=h("viewer")).status_code == 403
    r = c.post("/operations/ar.allocate_fifo", json={"args": args, "note": "month-end matching"}, headers=h("clerk"))
    assert r.status_code == 200 and r.json()["rows"][0]["allocate_fifo"] == 1
    assert db.execute("SELECT created_by FROM core.settlement").fetchone()[0] == "clerk"            # actor injected by the API
    a = db.execute("SELECT actor, object_id, reason FROM core.audit_event WHERE action = 'api_call'").fetchone()
    assert a == ("clerk", "ar.allocate_fifo", "month-end matching")


def test_argument_validation(client):
    c, ids, p = client
    assert c.post("/operations/nope", json={"args": {}}, headers=h("clerk")).status_code == 404
    r = c.post("/operations/ar.allocate_fifo", json={"args": {"p_account": 1, "p_party": 1, "p_user": "owner"}}, headers=h("clerk"))
    assert r.status_code == 422 and "acting user" in r.json()["detail"]                              # no impersonation
    assert c.post("/operations/ar.aging", json={"args": {"when": "2026-05-01"}}, headers=h("clerk")).status_code == 422


def test_reads_return_exact_amounts(client):
    c, ids, p = client
    r = c.post("/operations/ar.aging", json={"args": {"p_as_of": "2026-05-01"}}, headers=h("viewer")).json()
    row = r["rows"][0]
    assert row["open_debit"] == "1000" and row["unapplied_credit"] == "1000"                        # strings, never floats


def test_ui_is_served_and_the_inbox_is_an_operation(client):
    c, ids, p = client
    assert c.get("/", follow_redirects=False).status_code in (302, 307)
    page = c.get("/ui/")
    assert page.status_code == 200 and 'dir="rtl"' in page.text and "controls.inbox" in page.text
    rows = c.post("/operations/controls.inbox", json={"args": {"p_as_of": "2026-08-01"}}, headers=h("viewer")).json()["rows"]
    assert {r["area"] for r in rows} >= {"receivables", "tax", "cheques"}
