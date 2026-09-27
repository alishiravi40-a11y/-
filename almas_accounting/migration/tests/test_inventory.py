"""Inventory (core 012): Holoo's proven cost order, transfers, re-costing after a backdated entry (W-10), no negative
stock (W-11), valuation. Synthetic data only."""
import psycopg
import pytest


@pytest.fixture()
def inv(db):
    db.execute("INSERT INTO core.warehouse (code, name) VALUES ('W1', 'central'), ('W2', 'shop')")
    w = dict(db.execute("SELECT code, id FROM core.warehouse").fetchall())
    i = db.execute("INSERT INTO core.item (code, name, model_key) VALUES ('M1', 'phone', 'phone') RETURNING id").fetchone()[0]
    return w, i


def mv(db, item, wh, kind, date, qty, price=None, time="10:00", transfer=None, extra=0, legacy=False):
    with db.transaction():
        return db.execute("""INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, effective_time, qty, unit_price,
                             extra_cost_per_unit, transfer_id, source, created_by, legacy)
                             VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'test','t',%s) RETURNING id""",
                          (item, wh, kind, date, time, qty, price, extra, transfer, legacy)).fetchone()[0]


def kardex(db, item):
    return [(r[2], float(r[5]), float(r[6]), float(r[8]), float(r[9])) for r in db.execute("SELECT * FROM core.item_kardex(%s)", (item,))]


def test_moving_average_in_holoo_order(db, inv):
    w, i = inv
    mv(db, i, w["W1"], "opening", "2026-03-21", 10, 100)
    mv(db, i, w["W1"], "sale", "2026-04-01", 4, time="09:00")
    mv(db, i, w["W1"], "purchase", "2026-04-01", 10, 200, time="09:00", extra=10)   # same time: purchase (K=1) before sale (F=2)
    k = kardex(db, i)
    assert [x[0] for x in k] == ["opening", "purchase", "sale"]
    # (10×100 + 10×210) / 20 = 155 ; the sale leaves at 155
    assert k[1][4] == 155 and k[2][2] == 155 and k[2][3] == 16


def test_transfer_moves_at_source_average(db, inv):
    w, i = inv
    mv(db, i, w["W1"], "opening", "2026-03-21", 10, 100)
    mv(db, i, w["W2"], "opening", "2026-03-21", 10, 300)
    mv(db, i, w["W1"], "transfer_out", "2026-04-02", 5, transfer=1)
    mv(db, i, w["W2"], "transfer_in", "2026-04-02", 5, transfer=1)
    v = {r[1]: (float(r[2]), float(r[3])) for r in db.execute("SELECT * FROM core.inventory_valuation('2026-04-30')")}
    assert v[w["W1"]] == (5, 100) and v[w["W2"]] == (15, round((10 * 300 + 5 * 100) / 15, 4))


def test_backdated_purchase_recosts_later_issues(db, inv):
    w, i = inv
    mv(db, i, w["W1"], "opening", "2026-03-21", 2, 100)
    mv(db, i, w["W1"], "sale", "2026-05-01", 2)
    assert kardex(db, i)[-1][2] == 100
    mv(db, i, w["W1"], "purchase", "2026-04-15", 2, 300)          # entered later, dated earlier (Holoo froze the cost: W-10)
    assert kardex(db, i)[-1][2] == 200                             # the sale is re-costed from the movements


def test_negative_stock_is_refused_but_legacy_is_listed(db, inv):
    w, i = inv
    mv(db, i, w["W1"], "opening", "2026-03-21", 1, 100)
    with pytest.raises(psycopg.errors.RaiseException, match="negative"):
        mv(db, i, w["W1"], "sale", "2026-04-01", 2)
    mv(db, i, w["W1"], "sale", "2026-04-01", 2, legacy=True)
    assert db.execute("SELECT worst_qty FROM core.inventory_negative_legacy").fetchone()[0] == -1


def test_movements_are_immutable_and_reversal_drops_out(db, inv):
    w, i = inv
    o = mv(db, i, w["W1"], "opening", "2026-03-21", 3, 100)
    s = mv(db, i, w["W1"], "sale", "2026-04-01", 1)
    with pytest.raises(psycopg.errors.RaiseException):
        db.execute("UPDATE core.stock_movement SET qty = 2 WHERE id = %s", (s,))
    db.execute("""INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, qty, source, created_by, reverses_id)
                  VALUES (%s, %s, 'sale', '2026-04-01', 1, 'test', 't', %s)""", (i, w["W1"], s))
    assert db.execute("SELECT qty, value FROM core.inventory_valuation('2026-12-31')").fetchone() == (3, 300)
