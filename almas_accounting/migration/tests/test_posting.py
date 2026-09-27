"""Posting rule (core.document_posting_lines / post_document / post_sales_invoice) — D-01, D-02, E17."""
import json

import psycopg
import pytest

from migration import holoo_ledger as M


@pytest.fixture()
def ledger(db):
    M.ensure_fiscal_year(db, "1405")
    for code, name, lvl, leaf, nat, stmt, party in [
            ("103", "receivables", 1, False, "debit", "balance_sheet", False), ("1030008", "customers", 2, True, "debit", "balance_sheet", True),
            ("401", "payables", 1, False, "credit", "balance_sheet", False), ("4010176", "suppliers", 2, True, "credit", "balance_sheet", True),
            ("1010001", "cash box", 2, True, "debit", "balance_sheet", False), ("10200020063", "POS", 3, True, "debit", "balance_sheet", False),
            ("9010001", "sales", 2, True, "credit", "income_statement", False), ("7020005", "shipping income", 2, True, "credit", "income_statement", False),
            ("9020001", "sales returns", 2, True, "debit", "income_statement", False), ("8010001", "purchases", 2, True, "debit", "income_statement", False),
            ("6010006", "waste expense", 2, True, "debit", "income_statement", False), ("4050002", "VAT payable", 2, True, "credit", "balance_sheet", False)]:
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                   (code, name, lvl, leaf, nat, stmt, party))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    party = db.execute("INSERT INTO core.party (name, default_receivable_account_id) VALUES ('customer', %s) RETURNING id", (ids["1030008"],)).fetchone()[0]
    return ids, party


def doc(kind, ids, party, lines, payments=(), acc="1030008", **kw):
    d = {"kind": kind, "party_id": party, "party_account_id": ids[acc], "lines": [{"account_id": ids[a], "amount": m} for a, m in lines],
         "payments": [{"account_id": ids[a], "amount": m} for a, m in payments]}
    d.update(kw)
    return json.dumps(d)


def lines(db, d):
    return sorted((r[1], r[2], float(r[3]), float(r[4]), r[5]) for r in db.execute("SELECT * FROM core.document_posting_lines(%s::jsonb)", (d,)).fetchall())


def test_sale_with_partial_card_payment_matches_holoo_pattern(db, ledger):
    ids, p = ledger
    out = lines(db, doc("sale", ids, p, [("9010001", 900), ("7020005", 100)], [("10200020063", 600)]))
    assert out == sorted([(ids["1030008"], p, 1000.0, 0.0, "party_invoice"), (ids["9010001"], None, 0.0, 900.0, "counter"),
                          (ids["7020005"], None, 0.0, 100.0, "counter"), (ids["1030008"], p, 0.0, 600.0, "party_settlement"),
                          (ids["10200020063"], None, 600.0, 0.0, "settlement_instrument")])


def test_purchase_and_returns_are_mirrored(db, ledger):
    ids, p = ledger
    pur = lines(db, doc("purchase", ids, p, [("8010001", 500)], acc="4010176"))
    assert pur == sorted([(ids["4010176"], p, 0.0, 500.0, "party_invoice"), (ids["8010001"], None, 500.0, 0.0, "counter")])
    ret = lines(db, doc("sale_return", ids, p, [("9020001", 300)], [("10200020063", 300)]))
    assert (ids["9020001"], None, 300.0, 0.0, "counter") in ret and (ids["10200020063"], None, 0.0, 300.0, "settlement_instrument") in ret


def test_waste_goes_from_purchases_to_expense_without_party(db, ledger):
    ids, p = ledger
    out = lines(db, doc("waste", ids, None, [("8010001", 70)], expense_account_id=ids["6010006"]))
    assert out == sorted([(ids["6010006"], None, 70.0, 0.0, "counter"), (ids["8010001"], None, 0.0, 70.0, "counter")])


def test_rule_guards(db, ledger):
    ids, p = ledger
    with pytest.raises(psycopg.errors.RaiseException, match="exceed"):
        lines(db, doc("sale", ids, p, [("9010001", 100)], [("1010001", 101)]))
    with pytest.raises(psycopg.errors.RaiseException, match="VAT"):
        lines(db, doc("sale", ids, p, [("9010001", 100)], vat_amount=9))
    out = lines(db, doc("sale", ids, p, [("9010001", 100)], vat_amount=9, vat_account_id=ids["4050002"]))
    assert (ids["4050002"], None, 0.0, 9.0, "vat") in out and (ids["1030008"], p, 109.0, 0.0, "party_invoice") in out


def test_post_document_is_balanced_idempotent_and_needs_open_period(db, ledger):
    ids, p = ledger
    d = doc("sale", ids, p, [("9010001", 100)], [("1010001", 100)])
    e1 = db.execute("SELECT core.post_document(%s::jsonb, '2026-04-01', 'test', 'S-1', 'u')", (d,)).fetchone()[0]
    e2 = db.execute("SELECT core.post_document(%s::jsonb, '2026-04-01', 'test', 'S-1', 'u')", (d,)).fetchone()[0]
    assert e1 == e2 and db.execute("SELECT status FROM core.journal_entry WHERE id = %s", (e1,)).fetchone()[0] == "posted"
    with pytest.raises(psycopg.errors.RaiseException, match="no period"):
        db.execute("SELECT core.post_document(%s::jsonb, '2030-01-01', 'test', 'S-2', 'u')", (d,))


def test_new_system_sales_invoice_posts_from_its_own_data(db, ledger):
    ids, p = ledger
    db.execute("INSERT INTO core.app_user (username) VALUES ('seller')")
    item = db.execute("INSERT INTO core.item (code, name) VALUES ('P1', 'phone') RETURNING id").fetchone()[0]
    ship = db.execute("INSERT INTO core.item (code, name, revenue_account_id) VALUES ('0101003', 'shipping', %s) RETURNING id", (ids["7020005"],)).fetchone()[0]
    inv = db.execute("INSERT INTO core.sales_invoice (fiscal_year_id, invoice_date, party_id, created_by) VALUES (1, '2026-04-01', %s, 'seller') RETURNING id",
                     (p,)).fetchone()[0]
    db.execute("""INSERT INTO core.sales_invoice_line (invoice_id, line_no, item_id, quantity, unit_price, unit_cost_moving_average, unit_cost_last_purchase)
                  VALUES (%s, 1, %s, 1, 1000, 800, 800), (%s, 2, %s, 1, 50, NULL, NULL)""", (inv, item, inv, ship))
    db.execute("INSERT INTO core.sales_invoice_payment VALUES (%s, 1, 'card', %s, 400, 'POS-1')", (inv, ids["10200020063"]))
    with pytest.raises(psycopg.errors.RaiseException, match="not final"):
        db.execute("SELECT core.post_sales_invoice(%s, 'seller')", (inv,))
    db.execute("UPDATE core.sales_invoice SET status = 'final', finalized_by = 'seller' WHERE id = %s", (inv,))
    eid = db.execute("SELECT core.post_sales_invoice(%s, 'seller')", (inv,)).fetchone()[0]
    bal = dict(db.execute("SELECT a.code, sum(l.debit - l.credit) FROM core.journal_line l JOIN core.account a ON a.id = l.account_id WHERE entry_id = %s GROUP BY 1",
                          (eid,)).fetchall())
    assert bal == {"1030008": 650, "9010001": -1000, "7020005": -50, "10200020063": 400}     # shipping to its own account, no COGS (D-02)
    with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
        db.execute("INSERT INTO core.sales_invoice_payment VALUES (%s, 2, 'cash', %s, 1, NULL)", (inv, ids["1010001"]))
