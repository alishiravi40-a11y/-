"""Owner decisions D-11 (last purchase price is the below-cost basis) and D-12 (web sells, one alert per invoice)."""
import os
import pathlib

import psycopg
import pytest

DSN = os.environ.get("HOLOO_PG_TEST_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="HOLOO_PG_TEST_DSN not set")
SCHEMA_DIR = pathlib.Path(__file__).parents[1] / "schema"
SCHEMA = "\n".join((SCHEMA_DIR / f).read_text(encoding="utf-8")
                   for f in ("001_core.sql", "002_decisions.sql", "003_below_cost_alerts.sql"))
Denied = psycopg.errors.InsufficientPrivilege
Raised = psycopg.errors.RaiseException


@pytest.fixture()
def db():
    c = psycopg.connect(DSN, autocommit=True)
    c.execute("DROP SCHEMA IF EXISTS core CASCADE")
    c.execute(SCHEMA)
    c.execute("INSERT INTO core.fiscal_year (code, starts_on, ends_on) VALUES ('1405', '2026-03-21', '2027-03-21')")
    c.execute("INSERT INTO core.period (fiscal_year_id, code, starts_on, ends_on) VALUES (1, '1405-01', '2026-03-21', '2027-03-21')")
    c.execute("INSERT INTO core.app_user (username, is_service) VALUES ('owner', false), ('seller', false), ('manager', false), ('webshop', true)")
    c.execute("""INSERT INTO core.user_permission (username, permission, granted_by) VALUES
                 ('owner', 'security.admin', 'install'), ('owner', 'settings.change', 'install'),
                 ('manager', 'sales.below_cost_review', 'install')""")
    c.execute("INSERT INTO core.party (name) VALUES ('customer A')")
    c.execute("INSERT INTO core.item (code, name) VALUES ('A1', 'Phone X'), ('A2', 'Case Y'), ('A3', 'Charger Z')")
    # purchase history: item 1 bought at 1000 then 1100 (last); item 2 at 50; item 3 never bought
    c.execute("""INSERT INTO core.purchase_price (item_id, purchase_date, unit_cost, source) VALUES
                 (1, '2026-04-01', 1000, 'K-1'), (1, '2026-04-10', 1100, 'K-2'), (2, '2026-04-01', 50, 'K-1')""")
    yield c
    c.execute("DROP SCHEMA core CASCADE")


def invoice(c, lines, user="webshop", channel="web", date="2026-04-20"):
    iid = c.execute("""INSERT INTO core.sales_invoice (fiscal_year_id, number, invoice_date, party_id, channel, created_by)
                       VALUES (1, nextval('core.sales_invoice_id_seq') + 1000, %s, 1, %s, %s) RETURNING id""",
                    (date, channel, user)).fetchone()[0]
    for n, (item, qty, price, avg) in enumerate(lines, 1):
        c.execute("""INSERT INTO core.sales_invoice_line (invoice_id, line_no, item_id, quantity, unit_price, unit_cost_moving_average)
                     VALUES (%s, %s, %s, %s, %s, %s)""", (iid, n, item, qty, price, avg))
    return iid


def finalize(c, iid, user="webshop", ack=False):
    c.execute("UPDATE core.sales_invoice SET status = 'final', finalized_by = %s, below_cost_acknowledged = %s WHERE id = %s",
              (user, ack, iid))


# ---------------- D-11 ----------------
def test_d11_basis_is_last_purchase_and_recorded_in_audit(db):
    assert db.execute("SELECT core.setting_value('below_cost_basis')").fetchone()[0] == "last_purchase"
    row = db.execute("SELECT after->>'value', reason FROM core.audit_event WHERE object_id = 'below_cost_basis'").fetchone()
    assert row[0] == "last_purchase" and "D-11" in row[1]


def test_d11_last_purchase_is_snapshotted_from_history(db):
    iid = invoice(db, [(1, 1, 1050, 900)])
    assert db.execute("SELECT unit_cost_last_purchase FROM core.sales_invoice_line WHERE invoice_id = %s", (iid,)).fetchone()[0] == 1100
    db.execute("INSERT INTO core.purchase_price (item_id, purchase_date, unit_cost, source) VALUES (1, '2026-04-15', 2000, 'K-3')")
    assert db.execute("SELECT unit_cost_last_purchase FROM core.sales_invoice_line WHERE invoice_id = %s", (iid,)).fetchone()[0] == 1100


def test_d11_below_moving_average_only_is_not_below_cost(db):
    iid = invoice(db, [(1, 1, 1200, 1500)])        # below moving average 1500, above last purchase 1100
    finalize(db, iid, user="seller")                # no permission needed
    assert db.execute("SELECT count(*) FROM core.below_cost_alert").fetchone()[0] == 0


def test_d11_later_purchase_does_not_apply_to_earlier_sale(db):
    iid = invoice(db, [(1, 1, 1050, 900)], date="2026-04-05")       # last purchase on that date = 1000
    assert db.execute("SELECT count(*) FROM core.sales_invoice_warnings WHERE invoice_id = %s AND warning = 'below_cost'", (iid,)).fetchone()[0] == 0


def test_d11_item_never_purchased_is_reported_not_guessed(db):
    iid = invoice(db, [(3, 1, 10, 20)])
    assert db.execute("SELECT warning FROM core.sales_invoice_warnings WHERE invoice_id = %s", (iid,)).fetchall() == [("cost_basis_missing",)]


# ---------------- D-12 ----------------
def test_d12_web_below_cost_is_not_blocked_and_creates_one_alert_with_all_lines(db):
    iid = invoice(db, [(1, 2, 1000, 900), (2, 3, 40, 45), (1, 1, 1200, 900)])   # lines 1 and 2 below last purchase
    finalize(db, iid)                                                               # web service: no permission, no ack
    alerts = db.execute("SELECT id, lines, total_shortfall, status, channel FROM core.below_cost_alert").fetchall()
    assert len(alerts) == 1 and alerts[0][1:] == (2, 2 * 100 + 3 * 10, "open", "web")
    lines = db.execute("""SELECT line_no, net_unit_price, unit_cost_last_purchase, unit_difference, shortfall_amount
                          FROM core.below_cost_alert_line ORDER BY line_no""").fetchall()
    assert lines == [(1, 1000, 1100, 100, 200), (2, 40, 50, 10, 30)]
    assert db.execute("SELECT count(*), min(status) FROM core.notification_outbox").fetchone() == (1, "queued")   # ONE e-mail


def test_d12_review_window_comes_from_setting(db):
    db.execute("SELECT core.change_setting('below_cost_review_hours', '12', 'owner', 'shipping is faster now')")
    iid = invoice(db, [(1, 1, 1000, 900)])
    finalize(db, iid)
    hours = db.execute("SELECT extract(epoch FROM review_due_at - created_at) / 3600 FROM core.below_cost_alert").fetchone()[0]
    assert round(hours) == 12


def test_d12_store_user_still_needs_permission_and_ack(db):         # D-06 unchanged for people
    iid = invoice(db, [(1, 1, 1000, 900)], user="seller", channel="store")
    with pytest.raises(Denied):
        finalize(db, iid, user="seller", ack=True)
    iid2 = invoice(db, [(1, 1, 1000, 900)], user="seller", channel="web")   # web channel, but a person finalizes
    with pytest.raises(Denied):
        finalize(db, iid2, user="seller", ack=True)
    db.execute("SELECT core.grant_permission('seller', 'sales.below_cost', 'owner', 'clearance')")
    finalize(db, iid, user="seller", ack=True)
    assert db.execute("SELECT count(*) FROM core.below_cost_alert").fetchone()[0] == 1   # permitted sales alert too


def test_d12_normal_web_invoice_creates_no_alert(db):
    finalize(db, invoice(db, [(1, 1, 1500, 900)]))
    assert db.execute("SELECT count(*) FROM core.below_cost_alert").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM core.notification_outbox").fetchone()[0] == 0


def test_d12_recipients_are_a_manager_setting_not_hard_coded(db):
    with pytest.raises(Denied):
        db.execute("SELECT core.change_setting('below_cost_alert_emails', 'x@example.com', 'seller', 'x')")
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("SELECT core.change_setting('below_cost_alert_emails', 'not-an-email', 'owner', 'typo')")
    db.execute("SELECT core.change_setting('below_cost_alert_emails', 'boss@example.com, audit@example.com', 'owner', 'D-12 recipients')")
    assert db.execute("SELECT core.setting_value('below_cost_alert_emails')").fetchone()[0] == "boss@example.com, audit@example.com"
    assert db.execute("SELECT count(*) FROM core.audit_event WHERE object_id = 'below_cost_alert_emails'").fetchone()[0] == 1


def test_d12_alert_record_is_permanent_and_review_is_audited(db):
    iid = invoice(db, [(1, 1, 1000, 900)])
    finalize(db, iid)
    aid = db.execute("SELECT id FROM core.below_cost_alert").fetchone()[0]
    with pytest.raises(Raised, match="never deleted"):
        db.execute("DELETE FROM core.below_cost_alert")
    with pytest.raises(Raised, match="review_below_cost_alert"):
        db.execute("UPDATE core.below_cost_alert SET status = 'reviewed_ok'")
    with pytest.raises(Denied):
        db.execute("SELECT core.review_below_cost_alert(%s, 'reviewed_ok', 'seller', 'fine')", (aid,))
    db.execute("SELECT core.review_below_cost_alert(%s, 'reviewed_action', 'manager', 'called customer; price corrected on return')", (aid,))
    st = db.execute("SELECT status, reviewed_by, review_overdue FROM core.below_cost_alert_status").fetchone()
    assert st == ("reviewed_action", "manager", False)
    assert db.execute("SELECT count(*) FROM core.audit_event WHERE object_type = 'below_cost_alert'").fetchone()[0] == 1
    with pytest.raises(Raised, match="already"):
        db.execute("SELECT core.review_below_cost_alert(%s, 'reviewed_ok', 'manager', 'again')", (aid,))


def test_d12_overdue_and_undelivered_are_visible(db):
    finalize(db, invoice(db, [(1, 1, 1000, 900)]))
    db.execute("SELECT set_config('almas.controlled_change', 'on', false)")
    db.execute("UPDATE core.below_cost_alert SET review_due_at = now() - interval '1 hour'")
    db.execute("SELECT set_config('almas.controlled_change', 'off', false)")
    assert db.execute("SELECT review_overdue, email_undelivered FROM core.below_cost_alert_status").fetchone() == (True, True)


def test_d12_sent_email_is_immutable_history(db):
    finalize(db, invoice(db, [(1, 1, 1000, 900)]))
    db.execute("""UPDATE core.notification_outbox SET status = 'sent', sent_at = now(), attempts = 1,
                  recipients = '{boss@example.com}', subject = 's', body = 'b'""")
    with pytest.raises(Raised, match="immutable"):
        db.execute("UPDATE core.notification_outbox SET body = 'rewritten'")
    with pytest.raises(Raised, match="never deleted"):
        db.execute("DELETE FROM core.notification_outbox")
