"""Owner decisions D-01, D-02, D-05, D-06 (and open D-11) enforced by the database. Needs HOLOO_PG_TEST_DSN."""
import os
import pathlib

import psycopg
import pytest

DSN = os.environ.get("HOLOO_PG_TEST_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="HOLOO_PG_TEST_DSN not set")
SCHEMA_DIR = pathlib.Path(__file__).parents[1] / "schema"
SCHEMA = "\n".join((SCHEMA_DIR / f).read_text(encoding="utf-8") for f in ("001_core.sql", "002_decisions.sql"))
Denied = psycopg.errors.InsufficientPrivilege
Raised = psycopg.errors.RaiseException


@pytest.fixture()
def db():
    c = psycopg.connect(DSN, autocommit=True)
    c.execute("DROP SCHEMA IF EXISTS core CASCADE")
    c.execute(SCHEMA)
    # two fiscal years, each with two periods; both years open at the same time (D-05)
    c.execute("""INSERT INTO core.fiscal_year (code, starts_on, ends_on) VALUES
                 ('1404', '2025-03-21', '2026-03-20'), ('1405', '2026-03-21', '2027-03-21')""")
    c.execute("""INSERT INTO core.period (fiscal_year_id, code, starts_on, ends_on) VALUES
                 (1, '1404-01', '2025-03-21', '2025-09-22'), (1, '1404-02', '2025-09-23', '2026-03-20'),
                 (2, '1405-01', '2026-03-21', '2026-09-22'), (2, '1405-02', '2026-09-23', '2027-03-21')""")
    c.execute("""INSERT INTO core.account (code, name, level, is_leaf, nature, statement) VALUES
                 ('1010001', 'cash', 2, true, 'debit', 'balance_sheet'), ('9010001', 'sales', 2, true, 'credit', 'income_statement')""")
    c.execute("INSERT INTO core.app_user (username) VALUES ('owner'), ('manager'), ('seller'), ('senior_seller')")
    c.execute("""INSERT INTO core.user_permission (username, permission, granted_by) VALUES
                 ('owner', 'security.admin', 'install'), ('owner', 'settings.change', 'install'),
                 ('manager', 'period.close', 'install'), ('manager', 'period.reopen', 'install')""")
    c.execute("SELECT core.grant_permission('senior_seller', 'sales.below_cost', 'owner', 'trusted for clearance sales')")
    c.execute("INSERT INTO core.item (code, name) VALUES ('IP16PM-1T', 'iPhone 16 Pro Max 1TB')")
    yield c
    c.execute("DROP SCHEMA core CASCADE")


def post(c, year, period, date, amount=100, kind="normal"):
    eid = c.execute("""INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, kind, created_by)
                       VALUES (%s, %s, %s, %s, 'test') RETURNING id""", (year, period, date, kind)).fetchone()[0]
    c.execute("""INSERT INTO core.journal_line (entry_id, line_no, account_id, debit, credit) VALUES
                 (%s, 1, 1, %s, 0), (%s, 2, 2, 0, %s)""", (eid, amount, eid, amount))
    c.execute("UPDATE core.journal_entry SET status = 'posted' WHERE id = %s", (eid,))
    return eid


def invoice(c, user, lines, date="2026-04-01", year=2):
    iid = c.execute("""INSERT INTO core.sales_invoice (fiscal_year_id, invoice_date, created_by)
                       VALUES (%s, %s, %s) RETURNING id""", (year, date, user)).fetchone()[0]
    for n, (price, ma, lp) in enumerate(lines, 1):
        c.execute("""INSERT INTO core.sales_invoice_line (invoice_id, line_no, item_id, quantity, unit_price,
                     unit_cost_moving_average, unit_cost_last_purchase) VALUES (%s, %s, 1, 1, %s, %s, %s)""",
                  (iid, n, price, ma, lp))
    return iid


def finalize(c, iid, user, ack=False, reason=None):
    c.execute("""UPDATE core.sales_invoice SET status = 'final', finalized_by = %s, below_cost_acknowledged = %s,
                 below_cost_reason = %s WHERE id = %s""", (user, ack, reason, iid))


# ---------------- D-01 / D-02 settings ----------------
def test_d01_d02_settings_fixed_to_owner_decisions(db):
    assert db.execute("SELECT core.setting_value('vat_mode'), core.setting_value('inventory_accounting')").fetchone() \
        == ("holoo_compatible", "periodic")
    with pytest.raises(psycopg.errors.CheckViolation):   # no other value is admissible until the owner decides otherwise
        db.execute("SELECT core.change_setting('vat_mode', 'standard_rate', 'owner', 'try')")
    with pytest.raises(Raised, match="controlled function"):
        db.execute("UPDATE core.setting SET value = 'periodic' WHERE key = 'inventory_accounting'")


def test_d01_vat_is_stored_as_given_not_computed(db):
    iid = invoice(db, "seller", [(1000, 900, 900)])
    db.execute("UPDATE core.sales_invoice_line SET vat_amount = 0, levy_amount = 0 WHERE invoice_id = %s", (iid,))
    finalize(db, iid, "seller")
    assert db.execute("SELECT vat_amount, levy_amount FROM core.sales_invoice_line WHERE invoice_id = %s", (iid,)).fetchone() == (0, 0)


# ---------------- D-05 periods ----------------
def test_d05_two_fiscal_years_open_at_once(db):
    post(db, 2, 3, "2026-04-01")     # new year
    post(db, 1, 2, "2026-03-01")     # previous year is still open for posting
    rows = db.execute("SELECT fiscal_year, balance FROM core.trial_balance_by_year WHERE code = '1010001' ORDER BY 1").fetchall()
    assert rows == [("1404", 100), ("1405", 100)]      # reports separated per year


def test_d05_starting_new_year_does_not_lock_previous(db):
    db.execute("INSERT INTO core.fiscal_year (code, starts_on, ends_on) VALUES ('1406', '2027-03-22', '2028-03-20')")
    assert db.execute("SELECT array_agg(status ORDER BY id) FROM core.fiscal_year").fetchone()[0] == ["open"] * 3
    post(db, 1, 2, "2026-03-01")


def test_d05_entry_must_stay_inside_its_own_year(db):
    with pytest.raises(Raised, match="does not belong"):
        post(db, 1, 3, "2026-04-01")


def test_d05_direct_status_update_is_blocked(db):
    with pytest.raises(Raised, match="controlled"):
        db.execute("UPDATE core.period SET status = 'closed' WHERE id = 1")
    with pytest.raises(Raised, match="controlled"):
        db.execute("UPDATE core.fiscal_year SET status = 'closed' WHERE id = 1")


def test_d05_close_requires_permission_and_reason(db):
    with pytest.raises(Denied):
        db.execute("SELECT core.change_period_status(1, 'closed', 'seller', 'month end')")
    with pytest.raises(Raised, match="reason"):
        db.execute("SELECT core.change_period_status(1, 'closed', 'manager', '')")
    db.execute("SELECT core.change_period_status(1, 'closed', 'manager', 'first half of 1404 reviewed')")
    with pytest.raises(Raised, match="closed"):
        post(db, 1, 1, "2025-05-01")
    post(db, 1, 2, "2026-01-01")      # the other period of the same year is still open


def test_d05_close_and_reopen_are_fully_audited(db):
    db.execute("SELECT core.change_period_status(1, 'closed', 'manager', 'reviewed')")
    db.execute("SELECT core.change_period_status(1, 'open', 'manager', 'auditor adjustment needed')")
    rows = db.execute("""SELECT actor, action, before->>'status', after->>'status', reason FROM core.audit_event
                         WHERE object_type = 'period' ORDER BY id""").fetchall()
    assert rows == [("manager", "close", "open", "closed", "reviewed"),
                    ("manager", "reopen", "closed", "open", "auditor adjustment needed")]
    assert db.execute("SELECT bool_and(link_ok AND hash_ok) FROM core.audit_chain_check").fetchone()[0]


def test_d05_reopen_needs_its_own_permission(db):
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('seller', 'period.close', 'owner')")
    db.execute("SELECT core.change_period_status(1, 'closed', 'seller', 'month end')")
    with pytest.raises(Denied):
        db.execute("SELECT core.change_period_status(1, 'open', 'seller', 'oops')")


def test_d05_year_close_requires_all_periods_closed_and_blocks_reopening_periods(db):
    with pytest.raises(Raised, match="not closed"):
        db.execute("SELECT core.change_fiscal_year_status(1, 'closed', 'manager', 'year end')")
    db.execute("SELECT core.change_fiscal_year_status(1, 'closing', 'manager', 'year-end adjustments')")
    with pytest.raises(Raised, match="closing"):
        post(db, 1, 2, "2026-03-01")                                  # year closing: only adjustments
    post(db, 1, 2, "2026-03-01", kind="adjustment")
    for pid in (1, 2):
        db.execute("SELECT core.change_period_status(%s, 'closed', 'manager', 'year end')", (pid,))
    with pytest.raises(Raised, match="draft entries"):                  # the rejected post above left a draft
        db.execute("SELECT core.change_fiscal_year_status(1, 'closed', 'manager', 'year end approved')")
    db.execute("DELETE FROM core.journal_entry WHERE status = 'draft'")
    db.execute("SELECT core.change_fiscal_year_status(1, 'closed', 'manager', 'year end approved')")
    with pytest.raises(Raised, match="reopen the year first"):
        db.execute("SELECT core.change_period_status(2, 'open', 'manager', 'late invoice')")
    post(db, 2, 3, "2026-04-01")                                       # 1405 unaffected


# ---------------- D-06 below-cost sales ----------------
def test_d06_warning_is_shown_on_draft(db):
    iid = invoice(db, "seller", [(900, 1000, 950), (1200, 1000, 1100)])
    rows = db.execute("""SELECT line_no, warning, reference_cost, shortfall_amount, creator_may_finalize
                         FROM core.sales_invoice_warnings WHERE invoice_id = %s""", (iid,)).fetchall()
    assert rows == [(1, "below_cost", 1000, 100, False)]


def test_d06_user_without_permission_cannot_finalize(db):
    iid = invoice(db, "seller", [(900, 1000, 950)])
    with pytest.raises(Denied, match="sales.below_cost"):
        finalize(db, iid, "seller", ack=True, reason="customer insisted")
    assert db.execute("SELECT status FROM core.sales_invoice WHERE id = %s", (iid,)).fetchone()[0] == "draft"
    assert db.execute("SELECT count(*) FROM core.below_cost_event").fetchone()[0] == 0


def test_d06_permitted_user_must_acknowledge_then_history_is_kept(db):
    iid = invoice(db, "seller", [(900, 1000, 950)])
    with pytest.raises(Raised, match="acknowledged"):
        finalize(db, iid, "senior_seller")
    finalize(db, iid, "senior_seller", ack=True, reason="clearance of old stock")
    ev = db.execute("""SELECT authorized_by, basis, net_unit_price, reference_cost, shortfall_amount, below_moving_average,
                       below_last_purchase, reason FROM core.below_cost_event""").fetchall()
    assert ev == [("senior_seller", "undecided", 900, 1000, 100, True, True, "clearance of old stock")]
    assert db.execute("SELECT count(*) FROM core.audit_event WHERE action = 'below_cost_sale'").fetchone()[0] == 1
    assert db.execute("SELECT authorized_by FROM core.below_cost_report").fetchall() == [("senior_seller",)]
    with pytest.raises(Raised, match="immutable"):
        db.execute("DELETE FROM core.below_cost_event")
    with pytest.raises(Raised, match="immutable"):
        db.execute("UPDATE core.sales_invoice_line SET unit_price = 1000 WHERE invoice_id = %s", (iid,))


def test_d06_normal_sale_needs_no_permission(db):
    iid = invoice(db, "seller", [(1200, 1000, 1100)])
    finalize(db, iid, "seller")
    assert db.execute("SELECT count(*) FROM core.below_cost_event").fetchone()[0] == 0


def test_d06_revoked_permission_takes_effect(db):
    db.execute("SELECT core.revoke_permission('senior_seller', 'sales.below_cost', 'owner', 'policy change')")
    iid = invoice(db, "seller", [(900, 1000, 950)])
    with pytest.raises(Denied):
        finalize(db, iid, "senior_seller", ack=True, reason="x")
    actions = db.execute("SELECT action FROM core.audit_event WHERE object_type = 'user_permission' ORDER BY id").fetchall()
    assert actions == [("grant",), ("revoke",)]


def test_d06_only_admin_grants_permission(db):
    with pytest.raises(Denied):
        db.execute("SELECT core.grant_permission('seller', 'sales.below_cost', 'manager', 'self service')")


# ---------------- D-11 purchase-price basis (open) ----------------
@pytest.mark.parametrize("basis, flagged", [
    ("undecided", True),          # below either basis -> needs permission (provisional default)
    ("max", True),
    ("moving_average", False),    # price 950 >= moving average 900
    ("last_purchase", True),      # price 950 <  last purchase 1000
])
def test_d11_basis_setting_changes_what_counts_as_below_cost(db, basis, flagged):
    if basis != "undecided":
        db.execute("SELECT core.change_setting('below_cost_basis', %s, 'owner', 'owner decision D-11')", (basis,))
    iid = invoice(db, "seller", [(950, 900, 1000)])
    n = db.execute("SELECT count(*) FROM core.sales_invoice_warnings WHERE invoice_id = %s AND warning = 'below_cost'", (iid,)).fetchone()[0]
    assert n == (1 if flagged else 0)


def test_d11_missing_cost_basis_is_reported_not_guessed(db):
    iid = invoice(db, "seller", [(950, 900, None)])     # Holoo: 4,947 sale lines have no last purchase price
    rows = db.execute("SELECT warning FROM core.sales_invoice_warnings WHERE invoice_id = %s ORDER BY warning", (iid,)).fetchall()
    assert rows == [("cost_basis_missing",)]


def test_setting_change_is_audited(db):
    with pytest.raises(Denied):
        db.execute("SELECT core.change_setting('below_cost_basis', 'max', 'seller', 'x')")
    db.execute("SELECT core.change_setting('below_cost_basis', 'max', 'owner', 'owner decision D-11')")
    assert db.execute("""SELECT before->>'value', after->>'value' FROM core.audit_event WHERE object_type = 'setting'""").fetchone() \
        == ("undecided", "max")
