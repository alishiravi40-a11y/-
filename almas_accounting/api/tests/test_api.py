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
    assert page.status_code == 200 and 'dir="rtl"' in page.text and "js/app.js" in page.text
    assert c.get("/ui/js/pages/home.js").status_code == 200 and "controls.inbox" in c.get("/ui/js/pages/home.js").text
    rows = c.post("/operations/controls.inbox", json={"args": {"p_as_of": "2026-08-01"}}, headers=h("viewer")).json()["rows"]
    assert {r["area"] for r in rows} >= {"receivables", "tax", "cheques"}


def test_agent_workspace_user_reaches_only_agent_operations(client, db):
    c, ids, p = client
    a = db.execute("INSERT INTO core.sales_agent (code, title, created_by) VALUES ('A1', 'agent one', 'install') RETURNING id").fetchone()[0]
    db.execute("INSERT INTO core.app_user (username) VALUES ('rep')")
    db.execute("INSERT INTO core.sales_agent_user (username, agent_id, bound_by) VALUES ('rep', %s, 'install')", (a,))
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('rep', 'agent.workspace', 'install')")
    r = c.post("/operations/ar.aging", json={"args": {"p_as_of": "2026-06-01"}}, headers=h("rep"))
    assert r.status_code == 403 and "agent workspace" in r.json()["detail"]                 # central accounting is closed
    assert c.post("/operations/agent.my_cases", json={"args": {}}, headers=h("rep")).status_code == 200
    assert c.get("/schema", headers=h("rep")).status_code == 403
    assert all(o["operation"].startswith("agent.") for o in c.get("/operations", headers=h("rep")).json())


def test_agent_screens_through_the_api(client, db):
    """The agent declares a deal from its workspace; central staff see it, approve the base amount and read the agent report."""
    from beta.common import make_national_id as nid
    c, ids, p = client
    db.execute("INSERT INTO core.app_user (username) VALUES ('boss'), ('rep')")
    for perm in ("agent.manage", "agent.deal_approve", "agent.attribute", "agent.settle"):
        db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('boss', %s, 't')", (perm,))
    holder = db.execute("INSERT INTO core.party (name, national_id) VALUES ('holder', %s) RETURNING id", (nid("123456789"),)).fetchone()[0]
    acc = db.execute("INSERT INTO core.company_bank_account (bank_code, account_no, title, holder_party_id) VALUES ('refah', '1', 's', %s) RETURNING id", (holder,)).fetchone()[0]
    db.execute("INSERT INTO core.beta_scheme (code, title, holder_party_id, company_bank_account_id, created_by) VALUES ('S1', 's', %s, %s, 't')", (holder, acc))
    a = db.execute("SELECT core.agent_create('A1', 'agent one', NULL, NULL, NULL, 'boss')").fetchone()[0]
    db.execute("SELECT core.agent_bind_user('rep', %s, 'boss')", (a,))
    r = c.post("/operations/agent.deal_declare", headers=h("rep"), json={"args": {
        "p_national_id": nid("001234567"), "p_customer_name": "buyer", "p_sale_date": "2026-09-20", "p_goods": "tv",
        "p_base_amount": 1000, "p_base_source": "agent_invoice", "p_evidence_ref": "inv 5"}})
    assert r.status_code == 200, r.text
    deal = r.json()["rows"][0]["agent_deal_declare"]
    assert c.post("/operations/agents.deals_pending", headers=h("rep"), json={"args": {}}).status_code == 403     # central screen closed to the agent
    pend = c.post("/operations/agents.deals_pending", headers=h("boss"), json={"args": {}}).json()["rows"]
    assert [x["deal_id"] for x in pend] == [deal]
    assert c.post("/operations/agent.deal_approve", headers=h("boss"), json={"args": {"p_deal": deal}}).status_code == 200
    mine = c.post("/operations/agent.my_deals", headers=h("rep"), json={"args": {}}).json()["rows"]
    assert mine[0]["owed"] == "1000" and mine[0]["status_fa"] == "تأییدشده"
    rep = c.post("/operations/agents.report", headers=h("boss"), json={"args": {"p_agent": a}}).json()["rows"]
    assert rep[0]["base_amount"] == "1000" and rep[0]["state_fa"] == "در بانک دیده نشده"
    ov = c.post("/operations/agents.overview", headers=h("boss"), json={"args": {}}).json()["rows"]
    assert ov[0]["owed_to_agent"] == "1000" and ov[0]["own_contracts_as_customer"] == 0


def test_every_operation_the_ui_calls_is_catalogued(db):
    """The UI holds no rule and no private door: every op('…') it calls must be a catalogued operation (AI-native)."""
    import pathlib, re
    root = pathlib.Path(__file__).parents[1] / "static" / "js"
    used = set()
    for f in root.rglob("*.js"):
        used |= set(re.findall(r"\bop\('([a-z_.]+)'", f.read_text(encoding="utf-8")))
    known = {r[0] for r in db.execute("SELECT operation FROM core.operation_catalog")}
    assert used and used <= known, sorted(used - known)
