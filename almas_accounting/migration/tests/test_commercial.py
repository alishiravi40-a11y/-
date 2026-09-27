"""Purchase and sales invoices connected to inventory (core 015): one transaction writes voucher + stock + purchase
price; a sale that would make stock negative posts nothing. Synthetic data."""
import psycopg
import pytest

from migration import holoo_ledger as M


@pytest.fixture()
def shop(db):
    y = M.ensure_fiscal_year(db, "1405")
    for code, stmt, party in [("4010176", "balance_sheet", True), ("8010001", "income_statement", False), ("1030008", "balance_sheet", True),
                              ("9010001", "income_statement", False), ("1010001", "balance_sheet", False)]:
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES (%s, %s, 2, true, 'either', %s, %s)",
                   (code, code, stmt, party))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    sup = db.execute("INSERT INTO core.party (name, default_payable_account_id) VALUES ('supplier', %s) RETURNING id", (ids["4010176"],)).fetchone()[0]
    cus = db.execute("INSERT INTO core.party (name, default_receivable_account_id) VALUES ('customer', %s) RETURNING id", (ids["1030008"],)).fetchone()[0]
    db.execute("INSERT INTO core.app_user (username) VALUES ('buyer'), ('clerk')")
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('buyer', 'purchase.finalize', 't'), ('buyer', 'document.post', 't')")
    wh = db.execute("INSERT INTO core.warehouse (code, name) VALUES ('W1', 'central') RETURNING id").fetchone()[0]
    phone = db.execute("INSERT INTO core.item (code, name, model_key) VALUES ('P1', 'phone', 'phone') RETURNING id").fetchone()[0]
    return y, ids, sup, cus, wh, phone


def purchase(db, y, sup, wh, item, qty, price, discount=0, extra=0):
    inv = db.execute("INSERT INTO core.purchase_invoice (fiscal_year_id, invoice_date, party_id, extra_cost, created_by) VALUES (%s, '2026-04-01', %s, %s, 'buyer') RETURNING id",
                     (y, sup, extra)).fetchone()[0]
    db.execute("INSERT INTO core.purchase_invoice_line VALUES (%s, 1, %s, %s, %s, %s, %s)", (inv, item, wh, qty, price, discount))
    return inv


def test_purchase_posts_voucher_stock_and_price(db, shop):
    y, ids, sup, cus, wh, phone = shop
    inv = purchase(db, y, sup, wh, phone, 10, 1000, discount=500, extra=200)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("UPDATE core.purchase_invoice SET status = 'final', finalized_by = 'clerk' WHERE id = %s", (inv,))
    db.execute("UPDATE core.purchase_invoice SET status = 'final', finalized_by = 'buyer' WHERE id = %s", (inv,))
    e = db.execute("SELECT core.post_purchase_invoice(%s, 'buyer')", (inv,)).fetchone()[0]
    assert db.execute("SELECT core.post_purchase_invoice(%s, 'buyer')", (inv,)).fetchone()[0] == e          # idempotent
    bal = dict(db.execute("""SELECT a.code, sum(l.debit - l.credit) FROM core.journal_line l JOIN core.account a ON a.id = l.account_id
                             WHERE l.entry_id = %s GROUP BY 1""", (e,)).fetchall())
    assert bal == {"8010001": 9700, "4010176": -9700}                   # 10×1000 − 500 discount + 200 extra costs
    # unit cost = (10 000 − 500)/10 + 200/10 = 970
    assert db.execute("SELECT qty, avg_cost FROM core.inventory_valuation('2026-12-31')").fetchone() == (10, 970)
    assert db.execute("SELECT core.last_purchase_price(%s, '2026-12-31')", (phone,)).fetchone()[0] == 970
    with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
        db.execute("UPDATE core.purchase_invoice_line SET quantity = 11 WHERE invoice_id = %s", (inv,))


def test_sale_beyond_stock_posts_nothing(db, shop):
    y, ids, sup, cus, wh, phone = shop
    inv = purchase(db, y, sup, wh, phone, 1, 1000)
    db.execute("UPDATE core.purchase_invoice SET status = 'final', finalized_by = 'buyer' WHERE id = %s", (inv,))
    db.execute("SELECT core.post_purchase_invoice(%s, 'buyer')", (inv,))
    s = db.execute("INSERT INTO core.sales_invoice (fiscal_year_id, invoice_date, party_id, created_by) VALUES (%s, '2026-04-02', %s, 'buyer') RETURNING id",
                   (y, cus)).fetchone()[0]
    db.execute("INSERT INTO core.sales_invoice_line (invoice_id, line_no, item_id, quantity, unit_price, warehouse_id) VALUES (%s, 1, %s, 2, 1500, %s)", (s, phone, wh))
    db.execute("UPDATE core.sales_invoice SET status = 'final', finalized_by = 'buyer' WHERE id = %s", (s,))
    before = db.execute("SELECT count(*) FROM core.journal_entry").fetchone()[0]
    with pytest.raises(psycopg.errors.RaiseException, match="negative"):
        with db.transaction():
            db.execute("SELECT core.post_sales_invoice(%s, 'buyer')", (s,))
    assert db.execute("SELECT count(*) FROM core.journal_entry").fetchone()[0] == before           # nothing half-posted
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("SELECT core.post_sales_invoice(%s, 'clerk')", (s,))
