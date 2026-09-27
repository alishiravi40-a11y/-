"""Moadian submissions (core 014): life-cycle rules, one tax id per invoice, controls (W-08). Synthetic data."""
import psycopg
import pytest


@pytest.fixture()
def tax(db):
    db.execute("INSERT INTO core.app_user (username) VALUES ('clerk'), ('viewer')")
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('clerk', 'tax.submit', 't')")
    return db


def sub(db, ref, subject, status, tax_id=None, user="clerk", legacy=False, send_type=None):
    with db.transaction():
        return db.execute("""INSERT INTO core.tax_submission (document_source, document_ref, subject, status, tax_id, sent_at, created_by, legacy, legacy_send_type)
                             VALUES ('sales_invoice', %s, %s, %s, %s, now(), %s, %s, %s) RETURNING id""",
                          (ref, subject, status, tax_id, user, legacy, send_type)).fetchone()[0]


def test_life_cycle(tax):
    db = tax
    with pytest.raises(psycopg.errors.RaiseException, match="needs an accepted original"):
        sub(db, "1", "cancellation", "sent")
    sub(db, "1", "original", "failed")
    sub(db, "1", "original", "accepted", "TAX-A")
    with pytest.raises(psycopg.errors.RaiseException, match="already has an accepted original"):
        sub(db, "1", "original", "accepted", "TAX-B")
    sub(db, "1", "cancellation", "accepted", "TAX-C")
    st = db.execute("SELECT last_subject, last_status, attempts, cancelled FROM core.tax_document_status WHERE document_ref = '1'").fetchone()
    assert st == ("cancellation", "accepted", 3, True)
    with pytest.raises(psycopg.errors.RaiseException):
        db.execute("UPDATE core.tax_submission SET status = 'rejected'")


def test_tax_id_belongs_to_one_invoice_and_permission(tax):
    db = tax
    sub(db, "1", "original", "accepted", "TAX-A")
    with pytest.raises(psycopg.errors.RaiseException, match="already accepted for another invoice"):
        sub(db, "2", "original", "accepted", "TAX-A")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        sub(db, "3", "original", "sent", user="viewer")
    with pytest.raises(psycopg.errors.CheckViolation):
        sub(db, "4", "original", "accepted", None)                        # accepted needs its tax id


def test_controls_and_legacy_history(tax):
    db = tax
    sub(db, "1", "original", "accepted", "TAX-A", legacy=True, send_type=1)
    sub(db, "2", "original", "accepted", "TAX-A", legacy=True, send_type=1)      # Holoo allowed this (E09.6)
    sub(db, "3", "original", "failed", "TAX-X", legacy=True, send_type=1)
    sub(db, "3", "legacy_unknown", "failed", "TAX-Y", legacy=True, send_type=5)
    sub(db, "1", "legacy_unknown", "failed", None, legacy=True, send_type=6)       # unproven type does not decide (E25)
    db.execute("INSERT INTO core.legacy_tax_flag VALUES ('sales_invoice', '1', 0), ('sales_invoice', '2', 2)")
    st = dict(db.execute("SELECT document_ref, last_status FROM core.tax_document_status").fetchall())
    assert st == {"1": "accepted", "2": "accepted", "3": "failed"}
    c = {r[0]: r[2] for r in db.execute("SELECT * FROM core.tax_controls(current_date)")}
    assert c["T-02"] == 1 and c["T-03"] == 1 and c["T-04"] == 2 and c["T-05"] == 2 and c["T-06"] == 1
    with pytest.raises(psycopg.errors.CheckViolation):
        sub(db, "5", "legacy_unknown", "sent")                           # unknown subject only for history
