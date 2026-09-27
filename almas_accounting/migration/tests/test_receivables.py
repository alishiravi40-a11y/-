"""Open items, settlement (allocation of receipts to invoices) and aging — core 008 (TRE-07, W-17). Synthetic data."""
import datetime as dt

import psycopg
import pytest

from migration import holoo_ledger as M


@pytest.fixture()
def ar(db):
    M.ensure_fiscal_year(db, "1405")
    for code, lvl, nat, party in [("1030008", 2, "debit", True), ("9010001", 2, "credit", False), ("10200010001", 3, "debit", False)]:
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES (%s, %s, %s, true, %s, 'balance_sheet', %s)",
                   (code, code, lvl, nat, party))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    p = db.execute("INSERT INTO core.party (name, payment_terms_days) VALUES ('synthetic customer', 10) RETURNING id").fetchone()[0]
    db.execute("INSERT INTO core.app_user (username) VALUES ('clerk'), ('viewer')")
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('clerk', 'ar.allocate', 'test'), ('clerk', 'ar.unallocate', 'test')")
    return ids, p


def post(db, ids, p, date, amount, kind="sale"):
    """sale: Dr customer / Cr sales; receipt: Dr bank / Cr customer. Returns (entry, party line_no)."""
    y = db.execute("SELECT fiscal_year_id, id FROM core.period WHERE %s BETWEEN starts_on AND ends_on", (date,)).fetchone()
    e = db.execute("INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, created_by) VALUES (%s, %s, %s, 'test') RETURNING id",
                   (y[0], y[1], date)).fetchone()[0]
    cust, other = (ids["1030008"], ids["9010001"]) if kind == "sale" else (ids["10200010001"], ids["1030008"])
    db.execute("INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit) VALUES (%s, 1, %s, %s, %s)",
               (e, cust, p if kind == "sale" else None, amount))
    db.execute("INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, credit) VALUES (%s, 2, %s, %s, %s)",
               (e, other, p if kind == "receipt" else None, amount))
    db.execute("UPDATE core.journal_entry SET status = 'posted', posted_by = 'test' WHERE id = %s", (e,))
    return e, (1 if kind == "sale" else 2)


def d(s):
    return dt.date.fromisoformat(s)


def test_fifo_allocates_oldest_first_and_status(db, ar):
    ids, p = ar
    i1 = post(db, ids, p, "2026-04-01", 1000); i2 = post(db, ids, p, "2026-04-10", 500)
    post(db, ids, p, "2026-04-20", 1200, "receipt")
    assert db.execute("SELECT core.allocate_fifo(%s, %s, 'clerk')", (ids["1030008"], p)).fetchone()[0] == 2
    st = dict(db.execute("SELECT entry_id, status FROM core.receivable_document_status").fetchall())
    assert st == {i1[0]: "settled", i2[0]: "partial"}
    assert db.execute("SELECT open_amount FROM core.open_item WHERE entry_id = %s AND line_no = 1", (i2[0],)).fetchone()[0] == 300
    assert db.execute("SELECT core.allocate_fifo(%s, %s, 'clerk')", (ids["1030008"], p)).fetchone()[0] == 0     # nothing left to pair


def test_over_allocation_wrong_side_and_permission_are_rejected(db, ar):
    ids, p = ar
    i1 = post(db, ids, p, "2026-04-01", 100); r = post(db, ids, p, "2026-04-02", 150, "receipt")
    with pytest.raises(psycopg.errors.RaiseException, match="exceeds the open amount"):
        db.execute("SELECT core.allocate(%s, %s, %s, %s, 120, 'clerk')", (i1[0], i1[1], r[0], r[1]))
    with pytest.raises(psycopg.errors.RaiseException, match="debit item to a credit item"):
        db.execute("SELECT core.allocate(%s, %s, %s, %s, 50, 'clerk')", (r[0], r[1], i1[0], i1[1]))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("SELECT core.allocate(%s, %s, %s, %s, 50, 'viewer')", (i1[0], i1[1], r[0], r[1]))
    s = db.execute("SELECT core.allocate(%s, %s, %s, %s, 100, 'clerk', 'customer said so')", (i1[0], i1[1], r[0], r[1])).fetchone()[0]
    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        db.execute("DELETE FROM core.settlement WHERE id = %s", (s,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("SELECT core.undo_settlement(%s, 'viewer', 'mistake')", (s,))
    db.execute("SELECT core.undo_settlement(%s, 'clerk', 'allocated to the wrong invoice')", (s,))
    assert db.execute("SELECT status FROM core.receivable_document_status WHERE entry_id = %s", (i1[0],)).fetchone()[0] == "open"
    assert db.execute("SELECT count(*) FROM core.settlement").fetchone()[0] == 1                   # history stays


def test_settlement_needs_same_party(db, ar):
    ids, p = ar
    q = db.execute("INSERT INTO core.party (name) VALUES ('other') RETURNING id").fetchone()[0]
    i1 = post(db, ids, p, "2026-04-01", 100); r = post(db, ids, q, "2026-04-02", 100, "receipt")
    with pytest.raises(psycopg.errors.RaiseException, match="same account and party"):
        db.execute("SELECT core.allocate(%s, %s, %s, %s, 50, 'clerk')", (i1[0], i1[1], r[0], r[1]))


def test_reversal_is_paired_with_its_original(db, ar):
    ids, p = ar
    i1 = post(db, ids, p, "2026-04-01", 400)
    post(db, ids, p, "2026-04-02", 400, "receipt")
    rev = db.execute("SELECT core.reverse_entry(%s, '2026-04-03', 'voided invoice', 'test')", (i1[0],)).fetchone()[0]
    db.execute("SELECT core.allocate_fifo(%s, %s, 'clerk')", (ids["1030008"], p))
    m = dict(db.execute("SELECT method, count(*) FROM core.settlement GROUP BY 1").fetchall())
    assert m == {"reversal_pair": 1}
    # the voided invoice is settled by its reversal; the receipt stays an unapplied credit (an advance / overpayment)
    a = db.execute("SELECT open_debit, unapplied_credit, net FROM core.aging('2026-04-30')").fetchone()
    assert a == (0, 400, -400) and rev


def test_aging_as_of_date_buckets_and_ledger_control(db, ar):
    ids, p = ar
    post(db, ids, p, "2026-03-25", 1000)          # due 2026-04-04 (10 days terms)
    post(db, ids, p, "2026-05-15", 700)           # due 2026-05-25
    post(db, ids, p, "2026-06-01", 300, "receipt")
    db.execute("SELECT core.allocate_fifo(%s, %s, 'clerk')", (ids["1030008"], p))
    a = db.execute("SELECT d61_90, d1_30, open_debit, unapplied_credit, net, oldest_open_due FROM core.aging('2026-06-05')").fetchone()
    assert a == (700, 700, 1400, 0, 1400, d("2026-04-04"))
    # before the receipt: the later payment does not reach back — the whole first invoice is open
    b = db.execute("SELECT d31_60, not_due, open_debit, net FROM core.aging('2026-05-20')").fetchone()
    assert b == (1000, 700, 1700, 1700)
    for day in ("2026-03-30", "2026-05-20", "2026-06-05", "2027-03-01"):
        assert db.execute("SELECT count(*) FROM core.aging_control(%s)", (day,)).fetchone()[0] == 0


def test_closing_entry_is_not_a_settlement(db, ar):
    ids, p = ar
    i1 = post(db, ids, p, "2026-04-01", 800)
    y = db.execute("SELECT fiscal_year_id, id FROM core.period WHERE '2027-03-20' BETWEEN starts_on AND ends_on").fetchone()
    e = db.execute("""INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, kind, created_by)
                      VALUES (%s, %s, '2027-03-20', 'closing', 'test') RETURNING id""", y).fetchone()[0]
    db.execute("INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, credit) VALUES (%s, 1, %s, %s, 800)", (e, ids["1030008"], p))
    db.execute("INSERT INTO core.journal_line (entry_id, line_no, account_id, debit) VALUES (%s, 2, %s, 800)", (e, ids["9010001"]))
    db.execute("UPDATE core.journal_entry SET status = 'posted', posted_by = 'test' WHERE id = %s", (e,))
    assert db.execute("SELECT core.allocate_fifo(%s, %s, 'clerk')", (ids["1030008"], p)).fetchone()[0] == 0
    assert db.execute("SELECT status FROM core.receivable_document_status WHERE entry_id = %s", (i1[0],)).fetchone()[0] == "open"
    with pytest.raises(psycopg.errors.RaiseException, match="settle nothing"):
        db.execute("SELECT core.allocate(%s, 1, %s, 1, 100, 'clerk')", (i1[0], e))
    assert db.execute("SELECT count(*) FROM core.aging_control('2027-03-20')").fetchone()[0] == 0
