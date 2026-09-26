"""Database-enforced rules of the core model (each maps to a Holoo weakness W-xx). Needs HOLOO_PG_TEST_DSN."""
import os
import pathlib

import psycopg
import pytest

DSN = os.environ.get("HOLOO_PG_TEST_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="HOLOO_PG_TEST_DSN not set")
SCHEMA = (pathlib.Path(__file__).parents[1] / "schema" / "001_core.sql").read_text(encoding="utf-8")


@pytest.fixture()
def db():
    c = psycopg.connect(DSN, autocommit=True)
    c.execute("DROP SCHEMA IF EXISTS core CASCADE")
    c.execute(SCHEMA)
    c.execute("INSERT INTO core.fiscal_year (code, starts_on, ends_on) VALUES ('1404', '2025-03-21', '2026-03-20')")
    c.execute("""INSERT INTO core.period (fiscal_year_id, code, starts_on, ends_on, status) VALUES
                 (1, '1404-01', '2025-03-21', '2025-04-20', 'closed'), (1, '1404-02', '2025-04-21', '2025-05-21', 'closing'),
                 (1, '1404-03', '2025-05-22', '2025-06-21', 'open')""")
    c.execute("""INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES
                 ('1020001', 'bank', 2, true, 'debit', 'balance_sheet', false), ('9010001', 'sales', 2, true, 'credit', 'income_statement', false),
                 ('103', 'receivables', 1, false, 'debit', 'balance_sheet', false), ('1030008', 'customers', 2, true, 'debit', 'balance_sheet', true)""")
    c.execute("INSERT INTO core.party (name) VALUES ('customer A')")
    yield c
    c.execute("DROP SCHEMA core CASCADE")


def entry(c, date, period, lines, kind="normal", post=True):
    eid = c.execute("""INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, kind, created_by)
                       VALUES (1, %s, %s, %s, 'test') RETURNING id""", (period, date, kind)).fetchone()[0]
    for n, (acc, party, d, cr) in enumerate(lines, 1):
        c.execute("""INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, credit)
                     SELECT %s, %s, id, %s, %s, %s FROM core.account WHERE code = %s""", (eid, n, party, d, cr, acc))
    if post:
        c.execute("UPDATE core.journal_entry SET status = 'posted', posted_by = 'test' WHERE id = %s", (eid,))
    return eid


SALE = [("1030008", 1, 100, 0), ("9010001", None, 0, 100)]


def test_balanced_entry_posts(db):
    eid = entry(db, "2025-06-01", 3, SALE)
    assert db.execute("SELECT status FROM core.journal_entry WHERE id = %s", (eid,)).fetchone()[0] == "posted"


def test_unbalanced_entry_cannot_post(db):
    with pytest.raises(psycopg.errors.RaiseException, match="not balanced"):
        entry(db, "2025-06-01", 3, [("1030008", 1, 100, 0), ("9010001", None, 0, 90)])


def test_line_must_have_exactly_one_side(db):
    with pytest.raises(psycopg.errors.CheckViolation):
        entry(db, "2025-06-01", 3, [("1030008", 1, 100, 100)], post=False)


def test_closed_period_rejects_posting(db):          # W-01
    with pytest.raises(psycopg.errors.RaiseException, match="closed"):
        entry(db, "2025-04-01", 1, SALE)


def test_closing_period_accepts_only_adjustments(db):  # W-01 / year-end adjustments
    with pytest.raises(psycopg.errors.RaiseException, match="closing"):
        entry(db, "2025-05-01", 2, SALE)
    entry(db, "2025-05-01", 2, SALE, kind="adjustment")


def test_effective_date_must_be_inside_period(db):
    with pytest.raises(psycopg.errors.RaiseException, match="outside period"):
        entry(db, "2025-07-01", 3, SALE)


def test_posted_entry_is_immutable_and_undeletable(db):  # W-05
    eid = entry(db, "2025-06-01", 3, SALE)
    with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
        db.execute("UPDATE core.journal_line SET debit = 1 WHERE entry_id = %s AND line_no = 1", (eid,))
    with pytest.raises(psycopg.errors.RaiseException, match="cannot be deleted"):
        db.execute("DELETE FROM core.journal_entry WHERE id = %s", (eid,))
    with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
        db.execute("UPDATE core.journal_entry SET effective_date = '2025-06-02' WHERE id = %s", (eid,))


def test_draft_entry_with_lines_can_be_deleted(db):
    eid = entry(db, "2025-06-01", 3, SALE, post=False)
    db.execute("DELETE FROM core.journal_entry WHERE id = %s", (eid,))
    assert db.execute("SELECT count(*) FROM core.journal_line WHERE entry_id = %s", (eid,)).fetchone()[0] == 0


def test_reversal_nets_to_zero_and_is_traceable(db):  # W-03 (void = reversal, not hidden lines)
    eid = entry(db, "2025-06-01", 3, SALE)
    rid = db.execute("SELECT core.reverse_entry(%s, '2025-06-05', 'invoice voided by customer request', 'test')", (eid,)).fetchone()[0]
    assert db.execute("SELECT kind, reverses_id FROM core.journal_entry WHERE id = %s", (rid,)).fetchone() == ("reversal", eid)
    assert db.execute("SELECT SUM(balance) FILTER (WHERE balance <> 0) FROM core.trial_balance").fetchone()[0] is None
    with pytest.raises(psycopg.errors.RaiseException, match="already reversed"):
        db.execute("SELECT core.reverse_entry(%s, '2025-06-06', 'again', 'test')", (eid,))


def test_party_required_on_subledger_account_and_leaf_only(db):
    with pytest.raises(psycopg.errors.RaiseException, match="requires a party"):
        entry(db, "2025-06-01", 3, [("1030008", None, 100, 0), ("9010001", None, 0, 100)], post=False)
    with pytest.raises(psycopg.errors.RaiseException, match="not a leaf"):
        entry(db, "2025-06-01", 3, [("103", None, 100, 0)], post=False)


def test_audit_log_is_append_only_and_hash_chained(db):  # W-02
    entry(db, "2025-06-01", 3, SALE)
    n = db.execute("SELECT COUNT(*) FROM core.audit_event").fetchone()[0]
    assert n >= 2
    assert db.execute("SELECT bool_and(link_ok AND hash_ok) FROM core.audit_chain_check").fetchone()[0]
    with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
        db.execute("UPDATE core.audit_event SET actor = 'mallory' WHERE id = 1")
    # tampering bypassing the trigger is detected by the chain check
    db.execute("ALTER TABLE core.audit_event DISABLE TRIGGER audit_chain")
    db.execute("UPDATE core.audit_event SET actor = 'mallory' WHERE id = 1")
    db.execute("ALTER TABLE core.audit_event ENABLE TRIGGER audit_chain")
    assert not db.execute("SELECT bool_and(hash_ok) FROM core.audit_chain_check").fetchone()[0]


def test_cheque_events_are_immutable_and_reversible(db):  # W-13
    cid = db.execute("INSERT INTO core.cheque (direction, number, amount, due_date, party_id) VALUES ('in', '759265', 100, '2025-07-01', 1) RETURNING id").fetchone()[0]
    e1 = db.execute("INSERT INTO core.cheque_event (cheque_id, state, effective_date) VALUES (%s, 'received', '2025-06-01') RETURNING id", (cid,)).fetchone()[0]
    e2 = db.execute("INSERT INTO core.cheque_event (cheque_id, state, effective_date) VALUES (%s, 'spent', '2025-06-10') RETURNING id", (cid,)).fetchone()[0]
    with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
        db.execute("DELETE FROM core.cheque_event WHERE id = %s", (e2,))
    db.execute("INSERT INTO core.cheque_event (cheque_id, state, effective_date, reverses_event_id, note) VALUES (%s, 'spent', '2025-06-12', %s, 'undo spend')", (cid, e2))
    assert db.execute("SELECT state FROM core.cheque_current WHERE id = %s", (cid,)).fetchone()[0] == "received"
    assert db.execute("SELECT COUNT(*) FROM core.cheque_event WHERE cheque_id = %s", (cid,)).fetchone()[0] == 3   # history kept
