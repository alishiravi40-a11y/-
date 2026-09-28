"""Files through the API (a bank statement, a Holoo backup) and the invoice list / printable invoice. Synthetic data only."""
from api.tests.test_documents import call, env, first  # noqa: F401  (same synthetic shop)

H = {"X-Almas-User": "ops"}


def test_bank_statement_upload_reads_the_file_and_imports_once(env, db):
    c, ids, sup, cus = env
    bank = db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement) VALUES ('1020001', 'bank', 2, true, 'debit', 'balance_sheet') RETURNING id").fetchone()[0]
    acc = db.execute("INSERT INTO core.company_bank_account (bank_code, account_no, title, gl_account_id) VALUES ('mellat', '1', 'ملت', %s) RETURNING id", (bank,)).fetchone()[0]
    csv = "تاریخ,شرح,واریز,برداشت,موجودی\n1405/01/12,واریز,1000,,1000\n1405/01/13,کارمزد,,200,800\n".encode("utf-8")
    url = f"/files/bank_statement?account={acc}&name=mellat.csv"
    assert c.post(url, content=csv, headers=H).status_code == 403                     # no permission yet
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('ops', 'bank.statement_import', 't')")
    r = c.post(url, content=csv, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["new_lines"] == 2 and r.json()["balance_chain_ok"] is True
    assert c.post(url, content=csv, headers=H).json()["status"] == "duplicate"
    bad = c.post(url, content="a,b\n1,2\n".encode(), headers=H)
    assert bad.status_code == 400 and "تاریخ" in bad.json()["detail"]
    a = db.execute("SELECT after->>'channel' FROM core.audit_event WHERE action = 'api_call' AND object_id = 'bank.statement_import'").fetchone()[0]
    assert a == "file_upload"
    # manual matching from the screen: a list of statement lines is an array argument (bigint[]), the book lines JSON
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('ops', 'bank.reconcile', 't')")
    call(c, "treasury.post", {"p_doc": {"kind": "receipt", "money_account_id": bank, "counter": [{"account_id": ids["1010001"], "amount": 1000}]},
                              "p_date": "2026-04-01"})
    open_lines = call(c, "bank.open_lines", {"p_bank_account": acc, "p_from": "2026-03-21", "p_to": "2026-04-30"})[1]["rows"]
    st = [int(x["ref"]) for x in open_lines if x["side"] == "bank" and x["amount"] == "1000"]
    bk = [[int(v) for v in x["ref"].split(":")] for x in open_lines if x["side"] == "book"]
    r = call(c, "bank.reconcile", {"p_account": acc, "p_statement": st, "p_book": bk, "p_method": "manual", "p_note": None})
    assert r[0] == 200, r
    assert call(c, "years.create", {"p_code": "14x6", "p_period_starts": ["2027-03-21"], "p_ends_on": "2028-03-19"})[0] in (400, 403)


def test_holoo_backup_upload_is_stored_and_queued(env, db, tmp_path, monkeypatch):
    c, ids, sup, cus = env
    monkeypatch.setenv("ALMAS_UPLOAD_DIR", str(tmp_path)); monkeypatch.setenv("ALMAS_IMPORT_WORKER", "0")
    assert c.post("/files/holoo_backup?name=holoo.bak", content=b"x" * 1000, headers=H).status_code == 403
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('ops', 'holoo.import', 't')")
    r = c.post("/files/holoo_backup?name=../../holoo 1404.bak", content=b"x" * 1000, headers=H)
    assert r.status_code == 200 and r.json()["status"] == "queued"
    stored = db.execute("SELECT input_files[1] FROM core.holoo_import_batch WHERE id = %s", (r.json()["batch"],)).fetchone()[0]
    assert "/" not in stored and stored.endswith("holoo_1404.bak") and (tmp_path / stored).stat().st_size == 1000
    assert c.post("/files/holoo_backup?name=b.bak", content=b"y", headers=H).status_code == 409   # one at a time


def test_invoice_list_and_printable_invoice(env, db):
    c, ids, sup, cus = env
    item = call(c, "items.find", {"p_query": "گوشی"})[1]["rows"][0]["item_id"]
    wh = call(c, "warehouses.list", {})[1]["rows"][0]["warehouse_id"]
    cash = call(c, "money_accounts.list", {})[1]["rows"][0]["account_id"]
    p = first(call(c, "purchase.create", {"p_date": "2026-04-01", "p_party": sup, "p_payments": [], "p_extra_cost": 500,
                                          "p_lines": [{"item_id": item, "warehouse_id": wh, "quantity": 5, "unit_price": 1000}]})[1])
    call(c, "purchase.finalize", {"p_invoice": p})
    s = first(call(c, "sales.create", {"p_date": "2026-04-05", "p_party": cus, "p_payments": [{"method": "cash", "account_id": cash, "amount": 1000}],
                                       "p_lines": [{"item_id": item, "warehouse_id": wh, "quantity": 2, "unit_price": 1500, "discount": 100}]})[1])
    call(c, "sales.finalize", {"p_invoice": s})
    r = first(call(c, "return.create", {"p_kind": "sales_return", "p_invoice": s, "p_date": "2026-04-06", "p_reason": "defective",
                                        "p_lines": [{"original_line_no": 1, "quantity": 1}]})[1])
    call(c, "return.finalize", {"p_return": r})
    rows = call(c, "invoices.list", {"p_kind": "all", "p_from": "2026-03-21", "p_to": "2026-04-30"})[1]["rows"]
    assert [(x["kind"], x["total"]) for x in rows] == [("sales_return", None), ("sales", "2900"), ("purchase", "5500")]
    assert all(x["entry_id"] for x in rows)
    d = first(call(c, "invoices.detail", {"p_kind": "sales", "p_id": s})[1])
    assert d["party"]["name"] == "مشتری نمونه" and d["totals"]["net"] == 2900 and d["totals"]["paid"] == 1000 and d["totals"]["discount"] == 100
    assert d["lines"][0]["item_name"] == "گوشی نمونه" and d["entry"]["entry_id"] and d["returns"][0]["return_id"] == r
    ret = first(call(c, "invoices.detail", {"p_kind": "return", "p_id": r})[1])
    assert ret["kind"] == "sales_return" and ret["header"]["original_invoice"] == s and ret["lines"][0]["quantity"] == 1
    pur = first(call(c, "invoices.detail", {"p_kind": "purchase", "p_id": p})[1])
    assert pur["totals"]["extra_cost"] == 500 and pur["totals"]["net"] == 5500
    assert call(c, "invoices.list", {"p_kind": "sales", "p_from": None, "p_to": None, "p_query": "مشتری"})[1]["rows"][0]["document_id"] == s
