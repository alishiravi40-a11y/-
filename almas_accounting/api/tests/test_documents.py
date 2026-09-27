"""The whole document life cycle through the API only: lookups → purchase → sale → return → receipt. Synthetic data."""
import pytest
from fastapi.testclient import TestClient

from api.app import app
from api.tests.conftest import DSN
from migration import holoo_ledger as M


@pytest.fixture()
def env(db, monkeypatch):
    monkeypatch.setenv("ALMAS_PG_DSN", DSN); monkeypatch.setenv("ALMAS_API_DEV_AUTH", "1")
    M.ensure_fiscal_year(db, "1405")
    for code, stmt, party in [("4010176", "balance_sheet", True), ("1030008", "balance_sheet", True), ("8010001", "income_statement", False),
                              ("8020001", "income_statement", False), ("9010001", "income_statement", False), ("9020001", "income_statement", False),
                              ("1010001", "balance_sheet", False)]:
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES (%s, %s, 2, true, 'either', %s, %s)",
                   (code, code, stmt, party))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    db.execute("INSERT INTO core.cashbox (code, name, cash_account_id) VALUES ('C1', 'صندوق اصلی', %s)", (ids["1010001"],))
    sup = db.execute("INSERT INTO core.party (name, default_payable_account_id) VALUES ('تأمین‌کننده نمونه', %s) RETURNING id", (ids["4010176"],)).fetchone()[0]
    cus = db.execute("INSERT INTO core.party (name, default_receivable_account_id, mobile) VALUES ('مشتری نمونه', %s, '0000000001') RETURNING id", (ids["1030008"],)).fetchone()[0]
    db.execute("INSERT INTO core.warehouse (code, name) VALUES ('W1', 'انبار مرکزی')")
    db.execute("INSERT INTO core.item (code, name, model_key) VALUES ('P1', 'گوشی نمونه', 'phone')")
    db.execute("INSERT INTO core.app_user (username) VALUES ('ops'), ('viewer')")
    for perm in ("sales.create", "sales.finalize", "purchase.create", "purchase.finalize", "return.create", "return.finalize", "document.post", "treasury.post"):
        db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('ops', %s, 't')", (perm,))
    return TestClient(app), ids, sup, cus


def call(c, op, args, user="ops"):
    r = c.post(f"/operations/{op}", json={"args": args}, headers={"X-Almas-User": user})
    return r.status_code, r.json()


def first(j):
    return next(iter(j["rows"][0].values()))


def test_full_cycle_through_the_api(env, db):
    c, ids, sup, cus = env
    item = call(c, "items.find", {"p_query": "گوشی"})[1]["rows"][0]["item_id"]
    wh = call(c, "warehouses.list", {})[1]["rows"][0]["warehouse_id"]
    cash = call(c, "money_accounts.list", {})[1]["rows"][0]["account_id"]
    assert call(c, "parties.find", {"p_query": "0000000001"})[1]["rows"][0]["party_id"] == cus
    # purchase 10 at 1,000
    st, j = call(c, "purchase.create", {"p_date": "2026-04-01", "p_party": sup,
                                        "p_lines": [{"item_id": item, "warehouse_id": wh, "quantity": 10, "unit_price": 1000}], "p_payments": []})
    assert st == 200
    assert call(c, "purchase.finalize", {"p_invoice": first(j)})[0] == 200
    # two sales: numbers 1 and 2, gapless
    sales = []
    for q in (3, 2):
        st, j = call(c, "sales.create", {"p_date": "2026-04-05", "p_party": cus, "p_payments": [],
                                         "p_lines": [{"item_id": item, "warehouse_id": wh, "quantity": q, "unit_price": 1500}]})
        sales.append(first(j))
        assert call(c, "sales.finalize", {"p_invoice": sales[-1]})[0] == 200
    assert [r[0] for r in db.execute("SELECT number FROM core.sales_invoice ORDER BY id")] == [1, 2]
    # a sale beyond stock is refused and leaves nothing behind
    st, j = call(c, "sales.create", {"p_date": "2026-04-06", "p_party": cus, "p_payments": [],
                                     "p_lines": [{"item_id": item, "warehouse_id": wh, "quantity": 99, "unit_price": 1500}]})
    st2, err = call(c, "sales.finalize", {"p_invoice": first(j)})
    assert st2 == 400 and "negative" in err["detail"]
    assert db.execute("SELECT status FROM core.sales_invoice WHERE id = %s", (first(j),)).fetchone()[0] == "draft"
    # return 1 unit of the first sale
    st, j = call(c, "return.create", {"p_kind": "sales_return", "p_invoice": sales[0], "p_date": "2026-04-07", "p_reason": "defective",
                                      "p_lines": [{"original_line_no": 1, "quantity": 1}]})
    assert call(c, "return.finalize", {"p_return": first(j)})[0] == 200
    # the customer pays 4,000 in cash
    assert call(c, "treasury.receive", {"p_party": cus, "p_money_account": cash, "p_amount": 3000, "p_date": "2026-04-08"})[0] == 200
    doc = {"kind": "receipt", "money_account_id": cash, "counter": [{"account_id": ids["1030008"], "party_id": cus, "amount": 1000}]}
    assert call(c, "treasury.post", {"p_doc": doc, "p_date": "2026-04-08"})[0] == 200
    stock = db.execute("SELECT qty FROM core.inventory_valuation('2026-12-31')").fetchone()[0]
    assert stock == 10 - 3 - 2 + 1
    aging = call(c, "ar.aging_report", {"p_as_of": "2026-04-30"})[1]["rows"]
    assert aging[0]["party_name"] == "مشتری نمونه" and aging[0]["net"] == "2000"          # 7,500 − 1,500 return − 4,000
    # every write went through the API audit, and a viewer cannot write
    assert db.execute("SELECT count(*) FROM core.audit_event WHERE action = 'api_call'").fetchone()[0] >= 8
    assert call(c, "sales.create", {"p_date": "2026-04-05", "p_party": cus, "p_payments": [], "p_lines": [{"item_id": item, "quantity": 1, "unit_price": 1}]},
                user="viewer")[0] == 403
