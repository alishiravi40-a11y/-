"""Reports (core 009) and bank reconciliation (core 010) — synthetic data only."""
import datetime as dt
import json

import psycopg
import pytest

from migration import holoo_ledger as M
from treasury import bank_recon


@pytest.fixture()
def book(db):
    M.ensure_fiscal_year(db, "1405")
    accs = [("102", None, 1, "debit", False), ("10200010001", "102", 3, "debit", False), ("103", None, 1, "debit", False),
            ("1030008", "103", 2, "debit", True), ("901", None, 1, "credit", False), ("9010001", "901", 2, "credit", False),
            ("6010009", None, 2, "debit", False)]
    for code, parent, lvl, nat, party in accs:
        db.execute("""INSERT INTO core.account (code, name, parent_id, level, is_leaf, nature, statement, requires_party)
                      VALUES (%s, %s, (SELECT id FROM core.account WHERE code = %s), %s, %s, %s, 'balance_sheet', %s)""",
                   (code, code, parent, lvl, lvl > 1, nat, party))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    p = db.execute("INSERT INTO core.party (name) VALUES ('synthetic') RETURNING id").fetchone()[0]
    db.execute("INSERT INTO core.app_user (username) VALUES ('clerk'), ('viewer')")
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('clerk', 'bank.reconcile', 't'), ('clerk', 'bank.unreconcile', 't')")
    return ids, p


def entry(db, date, lines, kind="normal", number=None):
    y = db.execute("SELECT fiscal_year_id, id FROM core.period WHERE %s BETWEEN starts_on AND ends_on", (date,)).fetchone()
    e = db.execute("INSERT INTO core.journal_entry (number, fiscal_year_id, period_id, effective_date, kind, created_by) VALUES (%s, %s, %s, %s, %s, 't') RETURNING id",
                   (number, y[0], y[1], date, kind)).fetchone()[0]
    for i, (acc, party, dr, cr) in enumerate(lines, 1):
        db.execute("INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, credit) VALUES (%s, %s, %s, %s, %s, %s)",
                   (e, i, acc, party, dr, cr))
    db.execute("UPDATE core.journal_entry SET status = 'posted', posted_by = 't' WHERE id = %s", (e,))
    return e


def sale(db, ids, p, date, amt, **kw):
    return entry(db, date, [(ids["1030008"], p, amt, 0), (ids["9010001"], None, 0, amt)], **kw)


def receipt(db, ids, p, date, amt, **kw):
    return entry(db, date, [(ids["10200010001"], None, amt, 0), (ids["1030008"], p, 0, amt)], **kw)


# ---------------- reports ----------------
def test_four_column_trial_balance_levels_and_closing_rule(db, book):
    ids, p = book
    sale(db, ids, p, "2026-03-25", 1000); receipt(db, ids, p, "2026-04-25", 600); sale(db, ids, p, "2026-05-02", 200)
    entry(db, "2027-03-20", [(ids["9010001"], None, 1200, 0), (ids["1030008"], p, 0, 1200)], kind="closing")   # a closing-style entry
    tb = {(r[0], r[3]): r[4:] for r in db.execute("SELECT * FROM core.trial_balance_levels('1405', '2026-04-21', '2026-05-21')").fetchall()}
    # customers control with party: opening 1000, period Dr 200 / Cr 600, closing 600 debit
    assert tb[("1030008", p)] == (1000, 200, 600, 600, 600, 0)
    assert tb[("103", None)] == (1000, 200, 600, 600, 600, 0)                     # kol = sum of its moeins
    assert tb[("901", None)][3] == -1200
    whole = {r[0]: r[7] for r in db.execute("SELECT * FROM core.trial_balance_levels('1405', '2026-03-21', '2027-03-20') WHERE party_id IS NULL")}
    assert whole["9010001"] == -1200                                                # closing excluded by default (Holoo rule)
    closed = {r[0]: r[7] for r in db.execute("SELECT * FROM core.trial_balance_levels('1405', '2026-03-21', '2027-03-20', true) WHERE party_id IS NULL")}
    assert closed["9010001"] == 0 and closed["1030008"] == -600
    assert db.execute("SELECT balance FROM core.party_balance_at('1405', '2027-03-20')").fetchone()[0] == 600


def test_account_ledger_running_balance_orders_by_date_number_line(db, book):
    ids, p = book
    sale(db, ids, p, "2026-04-01", 500, number=20)
    receipt(db, ids, p, "2026-04-01", 300, number=10)           # same day, lower voucher number → first
    sale(db, ids, p, "2026-03-25", 100, number=5)
    rows = db.execute("SELECT seq, debit, credit, running_balance FROM core.account_ledger('1405', %s, %s, '2026-03-30', '2026-04-30')",
                      (ids["1030008"], p)).fetchall()
    assert rows == [(0, 0, 0, 100), (1, 0, 300, -200), (2, 500, 0, 300)]
    kol = db.execute("SELECT count(*), max(running_balance) FILTER (WHERE seq = 2) FROM core.account_ledger('1405', %s, NULL, '2026-03-21', '2026-04-30')",
                     (ids["103"],)).fetchone()
    assert kol == (4, -200)                                       # the kol ledger includes every line below it


# ---------------- bank reconciliation ----------------
@pytest.fixture()
def bank(db, book):
    ids, p = book
    b = db.execute("""INSERT INTO core.company_bank_account (bank_code, account_no, title, gl_account_id) VALUES ('X', 'SYN-1', 'synthetic bank', %s)
                      RETURNING id""", (ids["10200010001"],)).fetchone()[0]
    f = db.execute("INSERT INTO core.import_file (kind, sha256, company_bank_account_id, imported_by) VALUES ('bank_statement', 'x', %s, 't') RETURNING id", (b,)).fetchone()[0]
    return ids, p, b, f


def st_line(db, b, f, date, dep, wd, bal):
    return db.execute("""INSERT INTO core.bank_statement_line (company_bank_account_id, value_date, deposit, withdrawal, balance, natural_key,
                         first_file_id, last_file_id, classification) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                      (b, date, dep, wd, bal, f"{date}|{dep}|{wd}|{bal}", f, f, "other_deposit" if dep else "other_withdrawal")).fetchone()[0]


def test_auto_match_rules_and_reconciliation_statement(db, bank):
    ids, p, b, f = bank
    receipt(db, ids, p, "2026-04-01", 1000)                                      # exact
    receipt(db, ids, p, "2026-04-03", 700)                                       # window (bank 2 days later)
    receipt(db, ids, p, "2026-04-05", 100); receipt(db, ids, p, "2026-04-05", 150)   # POS: two book lines, one bank credit
    receipt(db, ids, p, "2026-04-08", 400)                                       # deposit in transit (not yet in bank)
    entry(db, "2026-04-06", [(ids["6010009"], None, 30, 0), (ids["10200010001"], None, 0, 30)])  # fee booked as one line
    st_line(db, b, f, "2026-04-01", 1000, 0, 1000)
    st_line(db, b, f, "2026-04-05", 700, 0, 1700)
    st_line(db, b, f, "2026-04-05", 250, 0, 1950)
    st_line(db, b, f, "2026-04-06", 0, 10, 1940); st_line(db, b, f, "2026-04-06", 0, 20, 1920)
    st_line(db, b, f, "2026-04-07", 0, 5, 1915)                                  # bank charge not yet in books
    r = bank_recon.auto_match(db, b, "clerk")
    assert r == {"exact": 1, "window": 1, "same_day_sum": 2, "statement_open": 1, "book_open": 1}
    rec = db.execute("SELECT * FROM core.bank_reconciliation(%s, '2026-04-01', '2026-04-30')", (b,)).fetchone()
    # statement 0 → 1915, book 0 → 2320; in bank not in book −5; in book not in bank +400; nothing unexplained
    assert rec == (0, 1915, 0, 2320, -5, 400, 0, 1, 1, 0)
    # a period that cuts through a reconciled group is still explained
    rec2 = db.execute("SELECT unexplained, reconciled_across_period FROM core.bank_reconciliation(%s, '2026-04-04', '2026-04-30')", (b,)).fetchone()
    assert rec2[0] == 0 and rec2[1] == 700


def test_reconcile_guards_and_undo(db, bank):
    ids, p, b, f = bank
    e = receipt(db, ids, p, "2026-04-01", 1000)
    s1 = st_line(db, b, f, "2026-04-01", 900, 0, 900)
    with pytest.raises(psycopg.errors.RaiseException, match="differs from book net"):
        db.execute("SELECT core.reconcile(%s, %s, %s::jsonb, 'manual', 'clerk')", (b, [s1], json.dumps([[e, 1]])))
    with pytest.raises(psycopg.errors.RaiseException, match="GL account"):     # the customer line is not a bank line
        db.execute("SELECT core.reconcile(%s, %s, %s::jsonb, 'manual', 'clerk')", (b, [s1], json.dumps([[e, 2]])))
    s2 = st_line(db, b, f, "2026-04-01", 100, 0, 1000)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("SELECT core.reconcile(%s, %s, %s::jsonb, 'manual', 'viewer')", (b, [s1, s2], json.dumps([[e, 1]])))
    g = db.execute("SELECT core.reconcile(%s, %s, %s::jsonb, 'manual', 'clerk', 'two bank lines for one receipt')", (b, [s1, s2], json.dumps([[e, 1]]))).fetchone()[0]
    with pytest.raises(psycopg.errors.RaiseException, match="already reconciled"):
        db.execute("SELECT core.reconcile(%s, %s, %s::jsonb, 'manual', 'clerk')", (b, [s1], json.dumps([[e, 1]])))
    with pytest.raises(psycopg.errors.RaiseException):
        db.execute("DELETE FROM core.bank_recon_group WHERE id = %s", (g,))
    db.execute("SELECT core.unreconcile(%s, 'clerk', 'wrong pairing')", (g,))
    assert db.execute("SELECT count(*) FROM core.bank_statement_recon WHERE group_id IS NULL").fetchone()[0] == 2
