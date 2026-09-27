"""One inbox of every control (core 017). Synthetic data."""
from migration.tests.test_receivables import ar, post  # noqa: F401


def test_inbox_lists_every_control_and_is_empty_on_a_clean_ledger(db):
    rows = db.execute("SELECT area, control, items FROM core.control_inbox('2026-06-01')").fetchall()
    areas = {r[0] for r in rows}
    assert {"sales", "receivables", "cheques", "inventory", "tax", "beta", "ledger"} <= areas
    assert all(r[2] == 0 for r in rows)                                            # the goal: an empty inbox


def test_overdue_receivable_appears(db, ar):
    ids, p = ar
    post(db, ids, p, "2026-03-25", 1000)                                           # due 2026-04-04 (10 days terms)
    inbox = {r[1]: (r[4], r[5]) for r in db.execute("SELECT * FROM core.control_inbox('2026-08-01')")}
    assert inbox["R-01"] == (1, 1000) and inbox["R-03"] == (0, 0)
