"""Beta API evidence + Almas agent network (core 021), against the in-process simulator of BetaApiDoc 1.3. Synthetic data."""
import datetime as dt
import json

import jdatetime
import psycopg
import pytest
from psycopg.types.json import Jsonb

from beta import api_flow
from beta.api_client import BetaApi, BetaApiDisabled
from beta.api_simulator import BetaSimulator
from beta.common import make_national_id as nid

Denied = psycopg.errors.InsufficientPrivilege
Raised = psycopg.errors.RaiseException
C1, C2 = nid("001234567"), nid("002345678")


def grant(db, user, *perms, ai=False, service=False):
    db.execute("INSERT INTO core.app_user (username, is_ai_agent, is_service) VALUES (%s, %s, %s) ON CONFLICT DO NOTHING", (user, ai, service))
    for p in perms:
        db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES (%s, %s, 'install')", (user, p))


@pytest.fixture()
def env(db):
    grant(db, "admin", "security.admin", "settings.change", "agent.manage", "agent.entitlement", "agent.settle", "beta.order_change",
          "beta.receipt_manage", "beta.sale_manage", "beta.api_call", "beta.contract_manage")
    grant(db, "sync", "beta.api_call", "beta.contract_manage", service=True)
    grant(db, "staff", "beta.sale_manage", "beta.api_call")
    grant(db, "ai", "agent.settle", "agent.entitlement", ai=True)
    holder = db.execute("INSERT INTO core.party (name, national_id) VALUES ('holder', %s) RETURNING id", (nid("123456789"),)).fetchone()[0]
    acc = db.execute("INSERT INTO core.company_bank_account (bank_code, account_no, title, holder_party_id) VALUES ('refah', '111', 'scheme', %s) RETURNING id",
                     (holder,)).fetchone()[0]
    db.execute("INSERT INTO core.beta_scheme (code, title, holder_party_id, company_bank_account_id, created_by) VALUES ('S1', 's', %s, %s, 'admin')", (holder, acc))
    a1 = db.execute("SELECT core.agent_create('A1', 'agent one', NULL, 'Fars', 'Shiraz', 'admin')").fetchone()[0]
    a2 = db.execute("SELECT core.agent_create('A2', 'agent two', NULL, 'Gilan', 'Rasht', 'admin')").fetchone()[0]
    db.execute("INSERT INTO core.app_user (username) VALUES ('ag1'), ('ag2')")
    db.execute("SELECT core.agent_bind_user('ag1', %s, 'admin')", (a1,))
    db.execute("SELECT core.agent_bind_user('ag2', %s, 'admin')", (a2,))
    db.execute("SELECT core.change_setting('beta_api_mode', 'simulated', 'admin', 'tests use the simulator')")
    sim = BetaSimulator()
    sim.add_customer(C1, credit=5_000_000)
    sim.add_customer(C2, credit=100_000)
    return {"db": db, "sim": sim, "a1": a1, "a2": a2, "scheme": 1, "account": acc}


def api(env, user):
    return BetaApi(env["db"], env["scheme"], user, transport=env["sim"].transport(), api_key="k")


def this_month():
    t = jdatetime.date.today()
    return f"{t.year}/{t.month:02d}"


def new_sale(env, user="ag1", nc=C1, amount=12_000_000, n=12, start=None):
    return env["db"].execute("SELECT core.beta_sale_create(%s, %s, 'customer', 'mobile phone', %s, %s, %s, 'INV-1')",
                             (user, nc, amount, n, start or this_month())).fetchone()[0]


def sell(env, user="ag1", **kw):
    rid = new_sale(env, user, **kw)
    b = api(env, user)
    assert api_flow.check(b, rid)["ok"]
    api_flow.send_code(b, rid)
    r = api_flow.confirm(b, rid, env["sim"].last_otp(kw.get("nc", C1)))
    return rid, r


def status(db, rid):
    return db.execute("SELECT status, beta_order_id FROM core.beta_sale_request WHERE id = %s", (rid,)).fetchone()


def inbox(db, as_of=None):
    return {r[1]: (r[4], r[5]) for r in db.execute("SELECT * FROM core.control_inbox(%s)", (as_of or dt.date.today(),))}


# ---------- Jalali calendar in SQL ----------
def test_jalali_matches_jdatetime(db):
    d = dt.date(2011, 3, 1)
    while d < dt.date(2041, 3, 1):
        j = jdatetime.date.fromgregorian(date=d)
        got = db.execute("SELECT core.jalali(%s), core.jalali_to_date(%s)", (d, f"{j.year}/{j.month}/{j.day}")).fetchone()
        assert got == (f"{j.year}/{j.month:02d}/{j.day:02d}", d), d
        d += dt.timedelta(days=17)
    assert db.execute("SELECT core.beta_date('2026-04-20T00:00:00'), core.beta_date('۱۴۰۵/۰۱/۳۱')").fetchone() == (dt.date(2026, 4, 20), dt.date(2026, 4, 20))


# ---------- the happy path: agent sells, the centre makes the contract ----------
def test_sale_to_contract_with_lineage_and_no_otp_stored(env):
    db = env["db"]
    rid, r = sell(env)
    assert r["status"] == "consumed" and r["beta_order_id"] == 22401
    otp = env["sim"].sent_otps[-1][1]
    assert db.execute("SELECT count(*) FROM core.beta_api_call WHERE request_body::text LIKE %s OR response::text LIKE %s",
                      (f"%{otp}%", f"%{otp}%")).fetchone()[0] == 0
    assert db.execute("SELECT request_body->>'otp' FROM core.beta_api_call WHERE endpoint = 'consume'").fetchone()[0] == "***"
    cid = api_flow.sync_order(api(env, "sync"), 22401, "sync")
    assert api_flow.sync_order(api(env, "sync"), 22401, "sync") == cid                     # idempotent
    c = db.execute("SELECT status, total_amount, installment_count, capacity_check, beta_order_id, sale_request_id FROM core.installment_contract WHERE id = %s",
                   (cid,)).fetchone()
    assert c == ("active", 12_000_000, 12, "imported_from_beta", 22401, rid)
    assert db.execute("SELECT count(*) FROM core.beta_installment_link l JOIN core.installment i ON i.id = l.installment_id WHERE i.contract_id = %s",
                      (cid,)).fetchone()[0] == 12
    lin = db.execute("SELECT agent_id, internal_ref, beta_amount, beta_live_installments, agent_entitled FROM core.beta_sale_lineage WHERE contract_id = %s",
                     (cid,)).fetchone()
    assert lin == (env["a1"], "INV-1", 12_000_000, 12, 0)
    assert status(db, rid)[0] == "contracted"
    box = inbox(db)
    assert all(box[k][0] == 0 for k in ("BA-01", "BA-02", "BA-03", "BA-04", "BA-09", "BA-10", "BA-13"))


def test_agent_cannot_create_the_contract(env):
    rid, _ = sell(env)
    api(env, "sync").order_installments(22401)
    with pytest.raises(Denied):
        env["db"].execute("SELECT core.beta_contract_from_order(1, 22401, 'ag1')")


# ---------- idempotency: an unclear answer is resolved, never re-sold ----------
def test_lost_response_is_resolved_by_request_id(env):
    db, sim = env["db"], env["sim"]
    rid = new_sale(env)
    b = api(env, "ag1")
    api_flow.check(b, rid)
    api_flow.send_code(b, rid)
    sim.fail_next = "lost_response"
    r = api_flow.confirm(b, rid, sim.last_otp(C1))
    assert r["status"] == "consumed" and r["beta_order_id"] == 22401 and len(sim.orders) == 1
    assert db.execute("SELECT array_agg(endpoint || ':' || outcome ORDER BY id) FROM core.beta_api_call WHERE sale_request_id = %s", (rid,)).fetchone()[0][-2:] \
        == ["consume:no_response", "order_by_request_id:ok"]


def test_timeout_before_registration_needs_a_new_code(env):
    db, sim = env["db"], env["sim"]
    rid = new_sale(env)
    b = api(env, "ag1")
    api_flow.check(b, rid)
    api_flow.send_code(b, rid)
    sim.fail_next = "timeout"
    r = api_flow.confirm(b, rid, "000000")
    assert r["status"] == "checked" and not sim.orders                 # the bank has nothing: a new code is required


def test_duplicate_request_id_is_4406_and_resolves_to_the_same_order(env):
    db, sim = env["db"], env["sim"]
    rid, r = sell(env)
    body = {"title": "mobile phone", "amount": 12_000_000, "numberOfInstallments": 12, "otp": "1", "requestId": str(
        db.execute("SELECT request_id FROM core.beta_sale_request WHERE id = %s", (rid,)).fetchone()[0]), "startDateYearMonth": this_month()}
    res = api(env, "staff").call("consume", path_args={"nationalCode": C1}, body=body)
    assert res["status"] == 4406 and len(sim.orders) == 1


# ---------- the OTP is bound to the data; the precheck blocks what the document makes certain ----------
def test_otp_bound_to_data_and_wrong_code(env):
    db, sim = env["db"], env["sim"]
    rid = new_sale(env)
    b = api(env, "ag1")
    api_flow.check(b, rid)
    api_flow.send_code(b, rid)
    r = api_flow.confirm(b, rid, "999999" if sim.last_otp(C1) != "999999" else "111111")
    assert r["status"] == "otp_sent" and r["last_status"] == 4446                 # wrong code: may re-enter
    with pytest.raises(api_flow.SaleBlocked, match="هنوز معتبر"):
        api_flow.send_code(b, rid)                                               # no second code within 2 minutes (4444)
    db.execute("SELECT core.beta_sale_change('ag1', %s, NULL, 13000000, NULL, NULL)", (rid,))
    assert status(db, rid)[0] == "checked"
    with pytest.raises(api_flow.SaleBlocked, match="ابتدا رمز"):
        api_flow.confirm(b, rid, sim.last_otp(C1))


def test_precheck_blocks(env):
    db = env["db"]
    rid = new_sale(env, nc=C2, amount=12_000_000, n=12)                            # 1,000,000 a month > credit 100,000
    res = api_flow.check(api(env, "ag1"), rid)
    assert not res["ok"] and any("توان بازپرداخت" in x for x in res["blocking"])
    rid2 = new_sale(env, start="1390/01")
    res = api_flow.check(api(env, "ag1"), rid2)
    assert any("ماه شروع" in x for x in res["blocking"])
    with pytest.raises(Raised, match="۳۶"):
        new_sale(env, n=37)
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("UPDATE core.beta_sale_request SET installment_count = 40 WHERE id = %s", (rid,))


def test_eight_purchases_a_month(env):
    db = env["db"]
    for _ in range(8):
        sell(env, amount=120_000, n=12)
    rid = new_sale(env, amount=120_000, n=12)
    res = api_flow.check(api(env, "ag1"), rid)
    assert any("۸ خرید" in x for x in res["blocking"])


# ---------- agent workspace: own data only, never central ----------
def test_agent_scope(env):
    db = env["db"]
    rid, _ = sell(env)
    api_flow.sync_order(api(env, "sync"), 22401, "sync")
    assert len(db.execute("SELECT * FROM core.agent_my_cases('ag1')").fetchall()) == 1
    assert db.execute("SELECT count(*) FROM core.agent_my_cases('ag2')").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM core.agent_my_customers('ag1')").fetchone()[0] == 1
    with pytest.raises(Denied):
        db.execute("SELECT core.beta_sale_abandon('ag2', %s, 'not mine')", (rid,))
    with pytest.raises(Denied):
        db.execute("SELECT core.beta_sale_create('ag2', %s, 'x', 't', 1000, 2, %s, NULL, %s)", (C1, this_month(), env["a1"]))
    with pytest.raises(Denied):
        db.execute("SELECT * FROM core.agent_my_cases('staff')")                         # not an agent user
    with pytest.raises(Denied):
        api(env, "ag1").order_list("140501")                                             # central read
    with pytest.raises(Denied):
        api(env, "ag1").order_delete(22401)                                              # people with beta.order_change only
    with pytest.raises(Denied):
        db.execute("SELECT core.require_operation('ag1', 'ledger.trial_balance')")
    db.execute("SELECT core.require_operation('ag1', 'agent.my_cases')")
    ops = {r[0] for r in db.execute("SELECT * FROM core.operations_for('ag1')")}
    assert ops and all(o.startswith("agent.") for o in ops) and "agent.record_settlement" not in ops
    with pytest.raises(Denied, match="central permission"):
        db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('ag1', 'ar.allocate', 'admin')")
    with pytest.raises(Denied, match="separate account"):
        db.execute("SELECT core.agent_bind_user('staff', %s, 'admin')", (env["a1"],))


def test_disabled_until_a_person_enables_it(env):
    db = env["db"]
    db.execute("SELECT core.change_setting('beta_api_mode', 'disabled', 'admin', 'back to default')")
    with pytest.raises(BetaApiDisabled):
        api(env, "staff")
    with pytest.raises(Raised, match="disabled"):
        db.execute("SELECT core.beta_record_call('staff', 1, 'valid_months', 'GET', 'date/validate', NULL, 200, '{}', NULL, now())")
    with pytest.raises(Denied, match="reserved for people"):
        db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('ai', 'settings.change', 'install')")
        db.execute("SELECT core.change_setting('beta_api_mode', 'production', 'ai', 'try')")


# ---------- reconciliation controls: bank vs Almas ----------
def record(db, endpoint, path, response, order_ref=None, user="staff", http=200):
    return db.execute("SELECT core.beta_record_call(%s, 1, %s, 'GET', %s, NULL, %s, %s, NULL, now(), NULL, %s)",
                      (user, endpoint, path, http, Jsonb(response) if response is not None else None, order_ref)).fetchone()[0]


def test_bank_has_almas_has_not_and_collection_controls(env):
    db, sim = env["db"], env["sim"]
    rid, _ = sell(env)
    t = jdatetime.date.today()
    api_flow.sync_month(api(env, "sync"), f"{t.year}{t.month:02d}")
    assert inbox(db)["BA-10"][0] == 0 and inbox(db)["BA-01"] == (1, 12_000_000)          # at the bank, no Almas contract yet
    cid = api_flow.sync_order(api(env, "sync"), 22401, "sync")
    assert inbox(db)["BA-01"][0] == 0
    first_due = db.execute("SELECT due_date FROM core.installment WHERE contract_id = %s AND seq = 1", (cid,)).fetchone()[0]
    sim.process_installment(22401, 1, True, when=first_due)
    sim.process_installment(22401, 2, False)
    api(env, "sync").order_installments(22401)
    later = first_due + dt.timedelta(days=40)
    box = inbox(db, later)
    assert box["BA-05"] == (1, 1_000_000)                                                # bank collected, nothing reached Almas's account
    assert box["BA-07"][0] == 1                                                          # collection failed at the bank
    iid = db.execute("SELECT id FROM core.installment WHERE contract_id = %s AND seq = 1", (cid,)).fetchone()[0]
    rc = db.execute("SELECT core.record_receipt('bank_collection', 1000000, %s, %s, NULL, NULL, NULL, 'admin')", (first_due, env["account"])).fetchone()[0]
    db.execute("SELECT core.apply_receipt(%s, %s, 'admin')", (rc, iid))
    assert inbox(db, later)["BA-05"][0] == 0
    iid3 = db.execute("SELECT id FROM core.installment WHERE contract_id = %s AND seq = 3", (cid,)).fetchone()[0]
    rc3 = db.execute("SELECT core.record_receipt('bank_collection', 1000000, %s, %s, NULL, NULL, NULL, 'admin')", (first_due, env["account"])).fetchone()[0]
    db.execute("SELECT core.apply_receipt(%s, %s, 'admin')", (rc3, iid3))
    assert inbox(db, later)["BA-06"] == (1, 1_000_000)                                  # Almas recorded a deposit the bank does not know


def test_mismatch_deleted_and_pascal_case(env):
    db = env["db"]
    rid, _ = sell(env, amount=3_000_000, n=3)
    cid = api_flow.sync_order(api(env, "sync"), 22401, "sync")
    ids = [r[0] for r in db.execute("SELECT beta_installment_id FROM core.beta_installment_link ORDER BY installment_id")]
    dues = [r[0] for r in db.execute("SELECT due_date FROM core.installment WHERE contract_id = %s ORDER BY seq", (cid,))]
    rows = [{"Id": ids[0], "Amount": 1_000_000, "OverdueDate": core_j(db, dues[0]), "IsSetteled": False, "OrderId": 22401, "Status": 0, "IsDeleted": False},
            {"Id": ids[1], "Amount": 900_000, "OverdueDate": f"{dues[1]}T00:00:00", "IsSetteled": False, "OrderId": 22401, "Status": 0, "IsDeleted": False},
            {"Id": ids[2], "Amount": 1_000_000, "OverdueDate": f"{dues[2]}T00:00:00", "IsSetteled": False, "OrderId": 22401, "Status": 0, "IsDeleted": True}]
    record(db, "order_installments", "order/22401/installments", {"Message": "", "Status": 200, "Data": {"TotalRecords": 3, "Data": rows}}, 22401)
    box = inbox(db)
    assert box["BA-04"] == (1, 100_000)                                                  # Jalali date parsed; amount differs on one
    assert box["BA-08"][0] == 1 and box["BA-03"][0] == 1                                 # deleted at the bank, live in Almas; count differs
    assert db.execute("SELECT status_name, status_verified FROM core.beta_installment_latest WHERE beta_installment_id = %s", (ids[0],)).fetchone() \
        == ("Created", False)                                                            # numeric status: inference only (U-B2)


def core_j(db, d):
    return db.execute("SELECT core.jalali(%s)", (d,)).fetchone()[0]


def test_acceptor_error_unknown_outcome_and_unreadable_response(env):
    db, sim = env["db"], env["sim"]
    rid = new_sale(env)
    b = api(env, "ag1")
    api_flow.check(b, rid)
    sim.acceptor_state = "fee_undefined"
    with pytest.raises(api_flow.SaleBlocked, match="کارمزد"):
        api_flow.send_code(b, rid)
    assert inbox(db)["BA-11"][0] == 1
    record(db, "order_list", "order/140501/all", {"status": 200, "data": {"data": [{"id": "not-a-number"}]}})
    assert inbox(db)["BA-13"][0] == 1 and db.execute("SELECT count(*) FROM core.beta_api_call").fetchone()[0] >= 4
    record(db, "order_list", "order/140502/all", {"status": 200, "data": {"totalRecords": 2, "data": [
        {"id": 5, "title": "t", "amount": 10, "customerNationalCode": C1, "projectType": 1}]}})
    assert inbox(db)["BA-13"][0] == 2 and inbox(db)["BA-01"] == (1, 10)               # kept as evidence, flagged incomplete
    with pytest.raises(Raised, match="immutable"):
        db.execute("UPDATE core.beta_api_call SET message = 'x'")


# ---------- agent money: explicit entitlements, allocated settlements, no formula ----------
def test_agent_entitlement_and_settlement(env):
    db = env["db"]
    rid, _ = sell(env)
    cid = api_flow.sync_order(api(env, "sync"), 22401, "sync")
    iid = db.execute("SELECT id FROM core.installment WHERE contract_id = %s AND seq = 1", (cid,)).fetchone()[0]
    rc = db.execute("SELECT core.record_receipt('bank_collection', 1000000, current_date, %s, NULL, NULL, NULL, 'admin')", (env["account"],)).fetchone()[0]
    db.execute("SELECT core.apply_receipt(%s, %s, 'admin')", (rc, iid))
    with pytest.raises(Raised, match="not owned"):
        db.execute("SELECT core.agent_record_entitlement(%s, %s, 'sale', 50000, 'agreement A2', 'admin')", (env["a2"], cid))
    e = db.execute("SELECT core.agent_record_entitlement(%s, %s, 'collection', 80000, 'agreement A1 #3 (manual, D-22 open)', 'admin', %s, %s)",
                   (env["a1"], cid, iid, rc)).fetchone()[0]
    assert inbox(db)["AG-02"] == (1, 80_000)
    with pytest.raises(Raised, match="only 80000"):
        db.execute("SELECT core.agent_record_settlement(%s, 90000, current_date, 'transfer', %s, NULL, 'T1', %s, 'admin')",
                   (env["a1"], env["account"], Jsonb([{"entitlement_id": e, "amount": 90000}])))
    with pytest.raises(Denied, match="reserved for people"):
        db.execute("SELECT core.agent_record_settlement(%s, 80000, current_date, 'transfer', %s, NULL, 'T1', %s, 'ai')",
                   (env["a1"], env["account"], Jsonb([{"entitlement_id": e, "amount": 80000}])))
    s = db.execute("SELECT core.agent_record_settlement(%s, 100000, current_date, 'transfer', %s, NULL, 'T1', %s, 'admin')",
                   (env["a1"], env["account"], Jsonb([{"entitlement_id": e, "amount": 80000}]))).fetchone()[0]
    assert inbox(db)["AG-02"][0] == 0 and inbox(db)["AG-04"] == (1, 20_000)             # 20,000 paid without a stated reason
    assert db.execute("SELECT entitled, paid, balance_due FROM core.agent_balance WHERE agent_id = %s", (env["a1"],)).fetchone() == (80_000, 100_000, -20_000)
    assert db.execute("SELECT agent_entitled, agent_settled, agent_open FROM core.beta_sale_lineage WHERE contract_id = %s", (cid,)).fetchone() == (80_000, 80_000, 0)
    assert db.execute("SELECT entitled, settled, open_amount FROM core.agent_my_statement('ag1')").fetchone() == (80_000, 80_000, 0)
    with pytest.raises(Raised, match="settled"):
        db.execute("SELECT core.agent_reverse_entitlement(%s, 'admin', 'wrong amount')", (e,))
    db.execute("SELECT core.reverse_receipt(%s, 'admin', 'bank returned it')", (rc,))
    assert inbox(db)["AG-03"] == (1, 80_000)                                             # entitlement rests on a reversed collection
    with pytest.raises(Raised, match="immutable"):
        db.execute("UPDATE core.agent_settlement SET amount = 1 WHERE id = %s", (s,))
    db.execute("SELECT core.agent_reverse_settlement(%s, 'admin', 'paid by mistake')", (s,))
    db.execute("SELECT core.agent_reverse_entitlement(%s, 'admin', 'collection reversed')", (e,))
    box = inbox(db)
    assert box["AG-03"][0] == 0 and box["AG-04"][0] == 0 and box["AG-05"][0] == 0


def test_contract_link_is_set_once(env):
    db = env["db"]
    sell(env)
    cid = api_flow.sync_order(api(env, "sync"), 22401, "sync")
    with pytest.raises(Raised, match="set once"):
        db.execute("UPDATE core.installment_contract SET beta_order_id = 1 WHERE id = %s", (cid,))
    with pytest.raises(Raised, match="cannot change|is contracted"):
        db.execute("UPDATE core.beta_sale_request SET amount = 1")


def test_catalog_lists_agent_operations(db):
    rows = db.execute("SELECT operation FROM core.operation_catalog WHERE agent_allowed").fetchall()
    assert {"agent.sale_create", "agent.my_cases", "agent.my_statement"} <= {r[0] for r in rows}
    assert json.dumps(rows)
