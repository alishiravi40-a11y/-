"""Year-end closing and next year's opening (core 011, ACC-10/11, W-19) — synthetic data."""
import psycopg
import pytest

from migration import holoo_ledger as M


@pytest.fixture()
def year(db):
    y = M.ensure_fiscal_year(db, "1405")
    for code, stmt, party in [("106", "balance_sheet", False), ("105", "balance_sheet", False), ("503", "income_statement", False),
                              ("8010001", "income_statement", False), ("9010001", "income_statement", False), ("6010001", "income_statement", False),
                              ("1030008", "balance_sheet", True), ("1010001", "balance_sheet", False), ("5020002", "balance_sheet", False),
                              ("5020003", "balance_sheet", False), ("006", "balance_sheet", False), ("005", "balance_sheet", False),
                              ("0010002", "memo", False), ("0020002", "memo", False)]:
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES (%s, %s, 2, true, 'either', %s, %s)",
                   (code, code, stmt, party))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    p = db.execute("INSERT INTO core.party (name) VALUES ('synthetic') RETURNING id").fetchone()[0]
    db.execute("INSERT INTO core.app_user (username) VALUES ('owner'), ('clerk')")
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('owner', 'period.close', 't')")

    def e(date, lines, kind="normal"):
        per = db.execute("SELECT id FROM core.period WHERE %s BETWEEN starts_on AND ends_on", (date,)).fetchone()[0]
        eid = db.execute("INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, kind, created_by) VALUES (%s, %s, %s, %s, 't') RETURNING id",
                         (y, per, date, kind)).fetchone()[0]
        for i, (a, pp, dr, cr) in enumerate(lines, 1):
            db.execute("INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, credit) VALUES (%s,%s,%s,%s,%s,%s)", (eid, i, ids[a], pp, dr, cr))
        db.execute("UPDATE core.journal_entry SET status = 'posted', posted_by = 't' WHERE id = %s", (eid,))
    e("2026-03-21", [("106", None, 1000, 0), ("5020002", None, 0, 1000)], "opening")
    e("2026-04-01", [("8010001", None, 5000, 0), ("1010001", None, 0, 5000)])
    e("2026-05-01", [("1030008", p, 7000, 0), ("9010001", None, 0, 7000)])
    e("2026-06-01", [("6010001", None, 500, 0), ("1010001", None, 0, 500)])
    e("2026-07-01", [("0010002", None, 300, 0), ("0020002", None, 0, 300)])
    return y, ids, p


def net(db, stage, ids):
    rows = db.execute("SELECT account_id, party_id, sum(debit - credit) FROM core.year_end_lines('1405', 2000, %s) WHERE stage = %s GROUP BY 1, 2",
                      (ids["5020003"], stage)).fetchall()
    code = {v: k for k, v in ids.items()}
    return {code[a]: float(n) for a, pp, n in rows if n}


def test_closing_rule_periodic_inventory_and_profit(db, year):
    y, ids, p = year
    t = net(db, "temporary", ids)
    # COGS = opening 1000 + purchases 5000 − ending 2000 = 4000; profit = 7000 − 4000 − 500 = 2500
    assert t == {"106": -1000, "8010001": -5000, "105": 2000, "9010001": 7000, "6010001": -500, "5020003": -2500}
    perm = db.execute("SELECT account_id, party_id, debit, credit, role FROM core.year_end_lines('1405', 2000, %s) WHERE stage = 'permanent'",
                      (ids["5020003"],)).fetchall()
    assert sum(r[2] for r in perm) == sum(r[3] for r in perm) == 18600
    assert [(r[2], r[3]) for r in perm if r[0] == ids["006"]] == [(9300, 0), (0, 9300)]          # two lines, like Holoo
    assert (ids["1030008"], p, 0, 7000, "close_balance") in perm                                # per party


def test_close_and_open_next_year(db, year):
    y, ids, p = year
    with pytest.raises(psycopg.errors.RaiseException, match="must be in status closing"):
        db.execute("SELECT core.close_fiscal_year('1405', 2000, 'year-end count', %s, 'owner', 'year end')", (ids["5020003"],))
    db.execute("SELECT core.change_fiscal_year_status(%s, 'closing', 'owner', 'year end')", (y,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("SELECT core.close_fiscal_year('1405', 2000, 'year-end count', %s, 'clerk', 'year end')", (ids["5020003"],))
    db.execute("SELECT core.close_fiscal_year('1405', 2000, 'year-end count', %s, 'owner', 'year end')", (ids["5020003"],))
    left = db.execute("SELECT count(*) FROM core.trial_balance_period('1405', '2026-03-21', '2027-03-20', true) WHERE closing <> 0").fetchone()[0]
    assert left == 0                                                                           # every account is closed
    with pytest.raises(psycopg.errors.RaiseException, match="already closed"):
        db.execute("SELECT core.close_fiscal_year('1405', 2000, 'year-end count', %s, 'owner', 'again')", (ids["5020003"],))
    M.ensure_fiscal_year(db, "1406")
    o = db.execute("SELECT core.open_next_fiscal_year('1405', '1406', 'owner')").fetchone()[0]
    assert db.execute("SELECT core.open_next_fiscal_year('1405', '1406', 'owner')").fetchone()[0] == o          # idempotent
    opening = {r[0]: float(r[1]) for r in db.execute("""SELECT a.code, sum(l.debit - l.credit) FROM core.journal_line l
                                                          JOIN core.account a ON a.id = l.account_id WHERE l.entry_id = %s GROUP BY 1""", (o,))}
    assert opening == {"105": 2000, "1010001": -5500, "1030008": 7000, "5020002": -1000, "5020003": -2500, "0010002": 300, "0020002": -300, "005": 0}
    y2 = db.execute("SELECT id FROM core.fiscal_year WHERE code = '1406'").fetchone()[0]
    per = db.execute("SELECT id FROM core.period WHERE fiscal_year_id = %s ORDER BY starts_on LIMIT 1", (y2,)).fetchone()[0]
    with pytest.raises(psycopg.errors.RaiseException, match="already has an opening"):          # no hand-typed second opening (W-19)
        db.execute("INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, kind, created_by) VALUES (%s, %s, '2027-03-21', 'opening', 't')", (y2, per))
