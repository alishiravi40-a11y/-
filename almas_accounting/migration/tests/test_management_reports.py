"""Management reports (core 020): monthly net sales and kardex gross margin; inventory status. Synthetic data."""
from decimal import Decimal
from migration.tests.test_commercial import purchase, shop  # noqa: F401
from migration.tests.test_returns import finalize_purchase, returns, sale, ret  # noqa: F401


def test_monthly_margin_and_inventory_status(db, returns):
    y, ids, sup, cus, wh, phone = returns
    db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement) VALUES ('9030001', 'd', 2, true, 'either', 'income_statement')")
    finalize_purchase(db, y, sup, wh, phone, 10, 1000)                   # 1405-01-12
    s = sale(db, y, cus, wh, phone, 4, 1500)                             # 2026-04-05 = 1405-01-16: revenue 6,000, cost 4,000
    r = ret(db, y, "sales_return", s, 1, date="2026-04-25")             # 1405-02-05: return 1,500, cost back 1,000
    db.execute("UPDATE core.return_document SET status = 'final', finalized_by = 'buyer' WHERE id = %s", (r,))
    db.execute("SELECT core.post_return(%s, 'buyer')", (r,))
    m = {row[0]: row[3:] for row in db.execute("SELECT * FROM core.monthly_sales_margin('1405')")}
    assert m["1405-01"] == (6000, 0, 6000, 4000, 2000, Decimal("33.3"))
    assert m["1405-02"] == (0, 1500, -1500, -1000, -500, Decimal("33.3"))
    st = db.execute("SELECT qty, avg_cost, value, days_since_last_sale FROM core.inventory_status('2026-05-05')").fetchone()
    assert st == (7, 1000, 7000, 30)
