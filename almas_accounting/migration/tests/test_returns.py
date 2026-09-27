"""Sales and purchase returns (core 016). Synthetic data."""
import psycopg
import pytest

from migration.tests.test_commercial import purchase, shop  # noqa: F401  (fixture reuse)


def finalize_purchase(db, y, sup, wh, phone, qty, price):
    inv = purchase(db, y, sup, wh, phone, qty, price)
    db.execute("UPDATE core.purchase_invoice SET status = 'final', finalized_by = 'buyer' WHERE id = %s", (inv,))
    db.execute("SELECT core.post_purchase_invoice(%s, 'buyer')", (inv,))
    return inv


def sale(db, y, cus, wh, phone, qty, price):
    s = db.execute("INSERT INTO core.sales_invoice (fiscal_year_id, invoice_date, party_id, created_by) VALUES (%s, '2026-04-05', %s, 'buyer') RETURNING id",
                   (y, cus)).fetchone()[0]
    db.execute("INSERT INTO core.sales_invoice_line (invoice_id, line_no, item_id, quantity, unit_price, warehouse_id) VALUES (%s, 1, %s, %s, %s, %s)",
               (s, phone, qty, price, wh))
    db.execute("UPDATE core.sales_invoice SET status = 'final', finalized_by = 'buyer' WHERE id = %s", (s,))
    db.execute("SELECT core.post_sales_invoice(%s, 'buyer')", (s,))
    return s


def ret(db, y, kind, inv, qty, date="2026-04-10"):
    col = "sales_invoice_id" if kind == "sales_return" else "purchase_invoice_id"
    r = db.execute(f"INSERT INTO core.return_document (kind, {col}, fiscal_year_id, return_date, reason, created_by) VALUES (%s, %s, %s, %s, 'damaged', 'buyer') RETURNING id",
                   (kind, inv, y, date)).fetchone()[0]
    db.execute("INSERT INTO core.return_line VALUES (%s, 1, %s)", (r, qty))
    return r


@pytest.fixture()
def returns(db, shop):
    y, ids, sup, cus, wh, phone = shop
    for code in ("9020001", "8020001"):
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement) VALUES (%s, %s, 2, true, 'either', 'income_statement')", (code, code))
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('buyer', 'return.finalize', 't')")
    return shop


def test_sales_return_undoes_the_sale_at_its_cost(db, returns):
    y, ids, sup, cus, wh, phone = returns
    finalize_purchase(db, y, sup, wh, phone, 10, 1000)
    s = sale(db, y, cus, wh, phone, 4, 1500)
    r = ret(db, y, "sales_return", s, 3)
    db.execute("UPDATE core.return_document SET status = 'final', finalized_by = 'buyer' WHERE id = %s", (r,))
    e = db.execute("SELECT core.post_return(%s, 'buyer')", (r,)).fetchone()[0]
    assert db.execute("SELECT core.post_return(%s, 'buyer')", (r,)).fetchone()[0] == e
    bal = dict(db.execute("SELECT a.code, sum(l.debit - l.credit) FROM core.journal_line l JOIN core.account a ON a.id = l.account_id WHERE l.entry_id = %s GROUP BY 1", (e,)).fetchall())
    assert bal == {"9020001": 4500, "1030008": -4500}
    assert db.execute("SELECT qty, avg_cost FROM core.inventory_valuation('2026-12-31')").fetchone() == (9, 1000)
    r2 = ret(db, y, "sales_return", s, 2)                                   # only 1 left on the line
    with pytest.raises(psycopg.errors.RaiseException, match="exceeds what is left"):
        db.execute("UPDATE core.return_document SET status = 'final', finalized_by = 'buyer' WHERE id = %s", (r2,))


def test_purchase_return_and_guards(db, returns):
    y, ids, sup, cus, wh, phone = returns
    p = finalize_purchase(db, y, sup, wh, phone, 5, 1000)
    r = ret(db, y, "purchase_return", p, 2)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("UPDATE core.return_document SET status = 'final', finalized_by = 'clerk' WHERE id = %s", (r,))
    db.execute("UPDATE core.return_document SET status = 'final', finalized_by = 'buyer' WHERE id = %s", (r,))
    e = db.execute("SELECT core.post_return(%s, 'buyer')", (r,)).fetchone()[0]
    bal = dict(db.execute("SELECT a.code, sum(l.debit - l.credit) FROM core.journal_line l JOIN core.account a ON a.id = l.account_id WHERE l.entry_id = %s GROUP BY 1", (e,)).fetchall())
    assert bal == {"4010176": 2000, "8020001": -2000}
    assert db.execute("SELECT qty FROM core.inventory_valuation('2026-12-31')").fetchone()[0] == 3
    with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
        db.execute("UPDATE core.return_line SET quantity = 1 WHERE return_id = %s", (r,))
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("INSERT INTO core.return_document (kind, sales_invoice_id, fiscal_year_id, return_date, reason, created_by) VALUES ('purchase_return', 1, %s, '2026-04-10', 'x y z', 'buyer')", (y,))
