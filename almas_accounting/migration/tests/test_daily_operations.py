"""Everyday operations (core 026): people, accounts, manual vouchers and reversal, numbering, lineage, cheques, stock,
users and permissions, dashboard. Synthetic data; every rule is tried against."""
import datetime as dt

import psycopg
import pytest
from psycopg.types.json import Jsonb

from beta.common import make_national_id as nid
from migration import holoo_ledger as M

Raised = psycopg.errors.RaiseException
Denied = psycopg.errors.InsufficientPrivilege
D = dt.date(2026, 4, 5)                      # inside FY1405


def acct(db, code, name, parent, level, leaf=True, nature="either", party=False, statement="balance_sheet"):
    pid = db.execute("SELECT id FROM core.account WHERE code = %s", (parent,)).fetchone()[0] if parent else None
    return db.execute("""INSERT INTO core.account (code, name, parent_id, level, is_leaf, nature, statement, requires_party)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""", (code, name, pid, level, leaf, nature, statement, party)).fetchone()[0]


@pytest.fixture()
def office(db):
    M.ensure_fiscal_year(db, "1405")
    acct(db, "1", "دارایی", None, 1, False, "debit")
    acct(db, "102", "بانک", "1", 2, False, "debit"); bank = acct(db, "1020001", "بانک ملت", "102", 3, nature="debit")
    acct(db, "101", "صندوق", "1", 2, False, "debit"); cash = acct(db, "1010001", "صندوق اصلی", "101", 3, nature="debit")
    acct(db, "103", "دریافتنی", "1", 2, False, "debit"); acct(db, "1030008", "مشتریان", "103", 3, nature="debit", party=True)
    acct(db, "104", "اسناد", "1", 2, False, "debit"); chq = acct(db, "1040001", "اسناد نزد صندوق", "104", 3, nature="debit")
    coll = acct(db, "1040002", "اسناد در جریان وصول", "104", 3, nature="debit")
    acct(db, "4", "بدهی", None, 1, False, "credit"); acct(db, "401", "پرداختنی", "4", 2, False, "credit")
    acct(db, "4010001", "تأمین‌کنندگان", "401", 3, nature="credit", party=True); npay = acct(db, "4020001", "اسناد پرداختنی", "4", 2, nature="credit")
    acct(db, "9", "درآمد", None, 1, False, "credit", statement="income_statement"); acct(db, "9010001", "فروش", "9", 2, nature="credit", statement="income_statement")
    db.execute("SELECT set_config('almas.controlled_change', 'on', false)")
    db.execute("UPDATE core.setting SET value = '4010001' WHERE key = 'account_suppliers'")
    db.execute("SELECT set_config('almas.controlled_change', 'off', false)")
    db.execute("INSERT INTO core.cashbox (code, name, cash_account_id, cheque_account_id, is_main) VALUES ('C1', 'صندوق اصلی', %s, %s, true)", (cash, chq))
    db.execute("""INSERT INTO core.company_bank_account (bank_code, account_no, title, gl_account_id, collection_account_id, payable_cheque_account_id)
                  VALUES ('mellat', '123', 'ملت ۱۲۳', %s, %s, %s)""", (bank, coll, npay))
    db.execute("INSERT INTO core.app_user (username) VALUES ('acc'), ('viewer'), ('boss')")
    for p in ("party.manage", "account.manage", "journal.post", "journal.reverse", "cheque.manage", "item.manage", "inventory.manage", "treasury.post"):
        db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('acc', %s, 't')", (p,))
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('boss', 'security.admin', 't'), ('boss', 'period.close', 't')")
    return {"db": db, "bank": bank, "cash": cash, "chq": chq, "coll": coll}


def bal(db, account_id):
    return db.execute("SELECT coalesce(sum(debit - credit), 0) FROM core.journal_line WHERE account_id = %s", (account_id,)).fetchone()[0]


def manual(db, lines, key=None, date=D, user="acc"):
    return db.execute("SELECT core.journal_post_manual(%s, 'test', %s, %s, %s)", (date, Jsonb(lines), user, key)).fetchone()[0]


# ---------- vouchers ----------
def test_every_posted_voucher_is_numbered_and_manual_vouchers_are_atomic_and_idempotent(office):
    db = office["db"]
    p = db.execute("SELECT core.party_save(NULL, 'مشتری یک', %s, '0912', NULL, 'person', 'acc')", (nid("001234567"),)).fetchone()[0]
    r = db.execute("SELECT core.receive_from_party(%s, %s, 1000, %s, 'acc')", (p, office["cash"], D)).fetchone()[0]
    e1 = manual(db, [{"account_code": "1020001", "debit": 500}, {"account_code": "1010001", "credit": 500}], key="k-1")
    assert manual(db, [{"account_code": "1020001", "debit": 500}, {"account_code": "1010001", "credit": 500}], key="k-1") == e1   # same key, same voucher
    nums = [x[0] for x in db.execute("SELECT number FROM core.journal_entry WHERE id IN (%s, %s) ORDER BY id", (r, e1))]
    assert None not in nums and nums[1] == nums[0] + 1
    before = db.execute("SELECT count(*) FROM core.journal_entry").fetchone()[0]
    with pytest.raises(Raised, match="not balanced"):
        manual(db, [{"account_code": "1020001", "debit": 500}, {"account_code": "1010001", "credit": 400}])
    with pytest.raises(Raised, match="requires a party"):
        manual(db, [{"account_code": "1030008", "debit": 5}, {"account_code": "1010001", "credit": 5}])
    with pytest.raises(Denied):
        manual(db, [{"account_code": "1020001", "debit": 5}, {"account_code": "1010001", "credit": 5}], user="viewer")
    assert db.execute("SELECT count(*) FROM core.journal_entry").fetchone()[0] == before           # nothing half-done


def test_reversal_is_the_only_correction_and_goes_through_the_right_path(office):
    db = office["db"]
    e = manual(db, [{"account_code": "1020001", "debit": 700}, {"account_code": "1010001", "credit": 700}])
    with pytest.raises(Raised, match="reason"):
        db.execute("SELECT core.journal_reverse(%s, %s, '', 'acc')", (e, D))
    r = db.execute("SELECT core.journal_reverse(%s, %s, 'wrong bank', 'acc')", (e, D)).fetchone()[0]
    assert bal(db, office["bank"]) == 0
    with pytest.raises(Raised, match="already reversed"):
        db.execute("SELECT core.journal_reverse(%s, %s, 'again', 'acc')", (e, D))
    with pytest.raises(psycopg.errors.RaiseException):
        db.execute("DELETE FROM core.journal_entry WHERE id = %s", (e,))                         # never deleted
    det = db.execute("SELECT core.entry_detail(%s)", (e,)).fetchone()[0]
    assert det["reversed_by"] == r and det["origin"]["kind"] == "manual" and det["audit"][-1]["reason"] == "wrong bank"
    assert db.execute("SELECT core.entry_detail(%s)", (r,)).fetchone()[0]["reverses"] == e
    db.execute("UPDATE core.journal_entry SET source = 'holoo' WHERE id = %s", (manual(db, [{"account_code": "1020001", "debit": 1}, {"account_code": "1010001", "credit": 1}]),))
    h = db.execute("SELECT id FROM core.journal_entry WHERE source = 'holoo'").fetchone()[0]
    with pytest.raises(Raised, match="Backup"):
        db.execute("SELECT core.journal_reverse(%s, %s, 'try', 'acc')", (h, D))


def test_closed_period_refuses_vouchers(office):
    db = office["db"]
    per = db.execute("SELECT id FROM core.period WHERE %s BETWEEN starts_on AND ends_on", (D,)).fetchone()[0]
    db.execute("SELECT core.change_period_status(%s, 'closing', 'boss', 'month end')", (per,))
    db.execute("SELECT core.change_period_status(%s, 'closed', 'boss', 'month end')", (per,))
    with pytest.raises(Raised, match="closed"):
        manual(db, [{"account_code": "1020001", "debit": 5}, {"account_code": "1010001", "credit": 5}])


# ---------- people and accounts ----------
def test_people_identity_rules_and_balances(office):
    db = office["db"]
    n1 = nid("001234567")
    p = db.execute("SELECT core.party_save(NULL, 'علی', %s, NULL, NULL, 'person', 'acc')", (n1,)).fetchone()[0]
    with pytest.raises(Raised, match="پرونده دیگری"):
        db.execute("SELECT core.party_save(NULL, 'علی ۲', %s, NULL, NULL, 'person', 'acc')", (n1,))
    with pytest.raises(Raised, match="معتبر نیست"):
        db.execute("SELECT core.party_save(NULL, 'x', '1234567890', NULL, NULL, 'person', 'acc')")
    with pytest.raises(Raised, match="D-18"):
        db.execute("SELECT core.party_save(%s, 'علی', %s, NULL, NULL, 'person', 'acc')", (p, nid("002345678")))
    db.execute("SELECT core.party_save(%s, 'علی رضایی', %s, '0935', NULL, 'person', 'acc')", (p, n1))
    db.execute("SELECT core.receive_from_party(%s, %s, 300, %s, 'acc')", (p, office["cash"], D))
    row = db.execute("SELECT name, mobile, balance FROM core.party_list('علی', 10)").fetchone()
    assert row == ("علی رضایی", "0935", -300)
    prof = db.execute("SELECT core.party_profile(%s)", (p,)).fetchone()[0]
    assert prof["accounts"][0]["account_code"] == "1030008" and len(prof["recent"]) == 1
    assert db.execute("SELECT count(*) FROM core.audit_event WHERE object_type = 'party' AND object_id = %s", (str(p),)).fetchone()[0] == 2


def test_chart_of_accounts(office):
    db = office["db"]
    db.execute("SELECT core.account_create('102', '1020002', 'بانک ملی', 'debit', false, 'acc')")
    manual(db, [{"account_code": "1020002", "debit": 50}, {"account_code": "1010001", "credit": 50}])
    with pytest.raises(Raised, match="گردش"):
        db.execute("SELECT core.account_create('1020002', '10200020001', 'زیرحساب', 'debit', false, 'acc')")
    with pytest.raises(Raised, match="شروع شود"):
        db.execute("SELECT core.account_create('102', '9999', 'x', 'debit', false, 'acc')")
    tree = {r[1]: r[9] for r in db.execute("SELECT * FROM core.account_tree(NULL)")}
    assert tree["1020002"] == 50 and tree["102"] == 50 and tree["1"] == 0                        # rolls up; cash −50 inside «1»


# ---------- cheques ----------
def test_received_cheque_life_and_undo(office):
    db = office["db"]
    p = db.execute("SELECT core.party_save(NULL, 'خریدار', NULL, NULL, NULL, 'person', 'acc')").fetchone()[0]
    c = db.execute("SELECT core.cheque_receive(%s, 1, '777', 'mellat', 5000, %s, %s, 'acc')", (p, D + dt.timedelta(days=30), D)).fetchone()[0]
    assert bal(db, office["chq"]) == 5000
    db.execute("SELECT core.cheque_move(%s, 'deposit', %s, 'acc', 1)", (c, D))
    assert bal(db, office["chq"]) == 0 and bal(db, office["coll"]) == 5000
    db.execute("SELECT core.cheque_move(%s, 'collect', %s, 'acc')", (c, D))
    assert bal(db, office["coll"]) == 0 and bal(db, office["bank"]) == 5000
    with pytest.raises(Raised, match="بسته"):
        db.execute("SELECT core.cheque_move(%s, 'deposit', %s, 'acc', 1)", (c, D))
    db.execute("SELECT core.cheque_undo_last(%s, %s, 'collected by mistake', 'acc')", (c, D))
    assert bal(db, office["bank"]) == 0 and bal(db, office["coll"]) == 5000
    assert db.execute("SELECT state FROM core.cheque_list(NULL, NULL, '777', 10)").fetchone()[0] == "deposited_for_collection"
    db.execute("SELECT core.cheque_move(%s, 'bounce', %s, 'acc')", (c, D))
    db.execute("SELECT core.cheque_move(%s, 'return', %s, 'acc')", (c, D))
    assert bal(db, office["chq"]) == 0 and bal(db, office["coll"]) == 0
    assert db.execute("SELECT sum(debit - credit) FROM core.journal_line WHERE party_id = %s", (p,)).fetchone()[0] == 0   # back to the payer
    with pytest.raises(Raised, match="تعریف نشده"):
        db.execute("SELECT core.cheque_move(%s, 'paid', %s, 'acc')", (c, D))


def test_issued_cheque_is_paid_by_the_bank(office):
    db = office["db"]
    s = db.execute("SELECT core.party_save(NULL, 'تأمین‌کننده', NULL, NULL, NULL, 'company', 'acc')").fetchone()[0]
    c = db.execute("SELECT core.cheque_issue(%s, 1, 'P-1', 9000, %s, %s, 'acc')", (s, D + dt.timedelta(days=10), D)).fetchone()[0]
    assert db.execute("SELECT sum(debit - credit) FROM core.journal_line WHERE party_id = %s", (s,)).fetchone()[0] == 9000
    db.execute("SELECT core.cheque_move(%s, 'paid', %s, 'acc')", (c, D))
    assert bal(db, office["bank"]) == -9000
    assert db.execute("SELECT count(*) FROM core.dashboard(%s) WHERE metric = 'cheques_due_week'", (D,)).fetchone()[0] == 1


# ---------- goods and stock ----------
def test_items_and_transfers(office):
    db = office["db"]
    i = db.execute("SELECT core.item_save(NULL, NULL, 'یخچال X', 'عدد', false, 'acc')").fetchone()[0]
    with pytest.raises(Raised, match="D-13"):
        db.execute("SELECT core.item_save(NULL, NULL, 'یخچال  x', 'عدد', false, 'acc')")
    w1 = db.execute("INSERT INTO core.warehouse (code, name) VALUES ('W1', 'مرکزی') RETURNING id").fetchone()[0]
    w2 = db.execute("INSERT INTO core.warehouse (code, name) VALUES ('W2', 'شعبه') RETURNING id").fetchone()[0]
    db.execute("""INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, qty, unit_price, source, created_by)
                  VALUES (%s, %s, 'purchase', %s, 5, 100, 'test', 'acc')""", (i, w1, D))
    t = db.execute("SELECT core.stock_transfer(%s, %s, %s, 3, %s, 'acc')", (i, w1, w2, D)).fetchone()[0]
    assert dict((r[4], r[5]) for r in db.execute("SELECT * FROM core.stock_list('یخچال', NULL, 10)")) == {"مرکزی": 2, "شعبه": 3}
    with pytest.raises(Raised, match="negative"):
        with db.transaction():
            db.execute("SELECT core.stock_transfer(%s, %s, %s, 9, %s, 'acc')", (i, w1, w2, D))
    db.execute("SELECT core.stock_transfer_reverse(%s, 'wrong branch', 'acc')", (t,))
    assert dict((r[4], r[5]) for r in db.execute("SELECT * FROM core.stock_list('یخچال', NULL, 10)")) == {"مرکزی": 5}


# ---------- users, permissions, catalog enforcement ----------
def test_permissions_are_granted_to_the_target_and_reads_are_permission_checked(office):
    db = office["db"]
    db.execute("SELECT core.user_create('newclerk', 'کارمند', 'person', 'boss')")
    db.execute("SELECT core.permission_grant('newclerk', 'journal.post', 'boss', 'new hire')")
    assert db.execute("SELECT permissions FROM core.users_list() WHERE username = 'newclerk'").fetchone()[0] == ["journal.post"]
    assert "journal.post" not in db.execute("SELECT permissions FROM core.users_list() WHERE username = 'boss'").fetchone()[0]
    with pytest.raises(Denied):
        db.execute("SELECT core.require_operation('viewer', 'users.list')")                  # a read with a catalogued permission
    db.execute("SELECT core.require_operation('boss', 'users.list')")
    db.execute("SELECT core.require_operation('viewer', 'dashboard')")
    with pytest.raises(Raised, match="خودش"):
        db.execute("SELECT core.user_set_active('boss', false, 'boss', 'test')")


def test_dashboard_and_money(office):
    db = office["db"]
    p = db.execute("SELECT core.party_save(NULL, 'مشتری', NULL, NULL, NULL, 'person', 'acc')").fetchone()[0]
    db.execute("SELECT core.receive_from_party(%s, %s, 1200, %s, 'acc')", (p, office["cash"], D))
    m = {r[0]: r[2] for r in db.execute("SELECT * FROM core.dashboard(%s)", (D,))}
    assert m["cash"] == 1200 and m["payable"] == 0 and m["fiscal_year"] == 1405
    assert {r[1] for r in db.execute("SELECT * FROM core.money_balances(%s)", (D,))} == {"1010001", "1020001"}
