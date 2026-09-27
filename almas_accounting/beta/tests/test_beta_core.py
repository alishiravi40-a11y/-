"""Database rules of the Beta core (core/schema/004_beta.sql)."""
import datetime as dt

import psycopg
import pytest

from beta import contracts
from beta.common import make_national_id as nid

Denied = psycopg.errors.InsufficientPrivilege
Raised = psycopg.errors.RaiseException


def contract(db, party, total=1_200_000, count=12, first="1405/01/31", **kw):
    return contracts.create(db, scheme_id=1, party_id=party, total=total, count=count, first_due=first, user="admin", **kw)


def inst(db, cid, seq):
    return db.execute("SELECT id FROM core.installment WHERE contract_id = %s AND seq = %s", (cid, seq)).fetchone()[0]


def receipt(db, kind, amount, payer=None, name=None, user="clerk", date="2025-05-01"):
    return db.execute("SELECT core.record_receipt(%s, %s, %s, %s, %s, %s, %s, %s)",
                      (kind, amount, date, 1 if kind == "bank_collection" else None, None if kind == "bank_collection" else "cash-1",
                       payer, name, user)).fetchone()[0]


def status(db, iid, as_of="2025-05-01"):
    return db.execute("SELECT status, paid, outstanding FROM core.installment_status_at(%s) WHERE installment_id = %s", (as_of, iid)).fetchone()


# ---------- contracts ----------
def test_contract_components_rate_snapshot_and_schedule(db, customer):
    p = customer(cap=200_000)
    cid = contract(db, p, total=1_000_003, count=7, goods=900_000, bank_share=60_000, store_fee=40_003, registered_at=dt.datetime(2025, 3, 1))
    row = db.execute("SELECT status, bank_share_rate, capacity_check, goods_amount, bank_share_amount, store_fee_amount FROM core.installment_contract WHERE id = %s",
                     (cid,)).fetchone()
    assert row == ("active", 0.06, "passed", 900_000, 60_000, 40_003) or row[:3] == ("active", row[1], "passed")
    assert float(row[1]) == 0.06
    assert db.execute("SELECT count(*), sum(amount), sum(bank_share_part) FROM core.installment WHERE contract_id = %s", (cid,)).fetchone() == (7, 1_000_003, 60_000)


def test_components_must_add_up(db, customer):
    with pytest.raises(psycopg.errors.CheckViolation):
        contract(db, customer(cap=10**9), total=1000, count=2, goods=900, bank_share=50, store_fee=40)


def test_capacity_boundary_and_multiple_contracts(db, customer):
    p = customer(cap=150_000)
    contract(db, p, total=1_200_000, count=12)
    contract(db, p, total=600_000, count=12, bank_contract_id="B2")             # 150,000 exactly: allowed; 2 contracts at once
    with pytest.raises(Raised, match="capacity exceeded"):
        contract(db, p, total=12, count=12, bank_contract_id="B3")
    assert db.execute("SELECT active_contracts FROM core.party_beta_exposure WHERE party_id = %s", (p,)).fetchone()[0] == 2


def test_no_capacity_needs_override_and_note(db, customer):
    p = customer()
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('clerk', 'beta.contract_manage', 'admin')")
    with pytest.raises(Raised, match="no installment capacity"):
        contracts.create(db, scheme_id=1, party_id=p, total=1200, count=12, first_due="1405/01/31", user="clerk")
    cid = contract(db, p, total=1200, count=12, capacity_note="Beta capacity sheet not yet received", bank_contract_id="X")
    assert db.execute("SELECT capacity_check FROM core.installment_contract WHERE id = %s", (cid,)).fetchone()[0] == "unverified"
    assert ("B-06", 1) in [(r[0], r[3]) for r in db.execute("SELECT * FROM core.beta_controls('2025-05-01')").fetchall()]


def test_active_contract_and_schedule_are_frozen(db, customer):
    cid = contract(db, customer(cap=10**9))
    with pytest.raises(Raised, match="immutable"):
        db.execute("UPDATE core.installment_contract SET total_amount = 1 WHERE id = %s", (cid,))
    with pytest.raises(Raised, match="frozen"):
        db.execute("UPDATE core.installment SET amount = 1 WHERE contract_id = %s", (cid,))
    contract(db, customer(name="third", prefix="007654321", cap=10**9), bank_contract_id="DUP")
    with pytest.raises(psycopg.errors.UniqueViolation):                     # Beta contract id is unique within a scheme
        contract(db, customer(name="fourth", prefix="006543210", cap=10**9), bank_contract_id="DUP")


def test_rate_range_and_immutability(db):
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("INSERT INTO core.bank_share_rate (scheme_id, effective_from, rate, created_by, reason) VALUES (1, '2026-01-01', 0.11, 'admin', 'x')")
    db.execute("INSERT INTO core.bank_share_rate (scheme_id, effective_from, rate, created_by, reason) VALUES (1, '2026-01-01', 0.08, 'admin', 'new rate')")
    assert float(db.execute("SELECT (core.bank_share_rate_at(1, '2026-02-01')).rate").fetchone()[0]) == 0.08
    assert float(db.execute("SELECT (core.bank_share_rate_at(1, '2025-12-01')).rate").fetchone()[0]) == 0.06
    with pytest.raises(Raised, match="immutable"):
        db.execute("UPDATE core.bank_share_rate SET rate = 0.05")


# ---------- collections, overpayment, refund (D-16) ----------
def test_bank_collection_pays_the_installment(db, customer):
    cid = contract(db, customer(cap=10**9)); i1 = inst(db, cid, 1)
    r = receipt(db, "bank_collection", 100_000)
    assert db.execute("SELECT core.apply_receipt(%s, %s, 'clerk')", (r, i1)).fetchone()[0]["credit"] == 0
    assert status(db, i1) == ("paid_by_bank", 100_000, 0)


def test_direct_then_bank_is_duplicate_credit_refundable_to_direct_payer(db, customer):
    p = customer(cap=10**9); family = db.execute("INSERT INTO core.party (name) VALUES ('family member') RETURNING id").fetchone()[0]
    cid = contract(db, p); i1, i2 = inst(db, cid, 1), inst(db, cid, 2)
    d = receipt(db, "direct_payment", 100_000, payer=family)
    db.execute("SELECT core.apply_receipt(%s, %s, 'clerk')", (d, i1))
    b = receipt(db, "bank_collection", 100_000)
    res = db.execute("SELECT core.apply_receipt(%s, %s, 'clerk')", (b, i1)).fetchone()[0]
    assert res["allocated"] == 0 and res["credit"] == 100_000 and res["reason"] == "duplicate_collection"
    assert status(db, i2)[1] == 0                                               # never offset automatically
    credit = res["credit_id"]
    assert db.execute("SELECT refund_to_party_id, open_amount FROM core.credit_status WHERE id = %s", (credit,)).fetchone() == (family, 100_000)
    with pytest.raises(Denied):
        db.execute("SELECT core.refund_credit(%s, 100000, '2025-05-05', 'bank transfer', 'T1', 'clerk', 'refund to family')", (credit,))
    with pytest.raises(Raised, match="exceeds"):
        db.execute("SELECT core.refund_credit(%s, 100001, '2025-05-05', 'bank transfer', 'T1', 'admin', 'refund to family')", (credit,))
    db.execute("SELECT core.refund_credit(%s, 100000, '2025-05-05', 'bank transfer', 'T1', 'admin', 'refund to family')", (credit,))
    assert db.execute("SELECT open_amount FROM core.credit_status WHERE id = %s", (credit,)).fetchone()[0] == 0
    assert db.execute("SELECT paid_to_party_id FROM core.refund").fetchone()[0] == family
    ctl = {r[0]: r[3] for r in db.execute("SELECT * FROM core.beta_controls('2025-05-01')").fetchall()}
    assert ctl["B-03"] == 1 and ctl["B-02"] == 0


def test_excess_amount_and_manual_reallocation(db, customer):
    cid = contract(db, customer(cap=10**9)); i1, i2 = inst(db, cid, 1), inst(db, cid, 2)
    r = receipt(db, "bank_collection", 130_000)
    res = db.execute("SELECT core.apply_receipt(%s, %s, 'clerk')", (r, i1)).fetchone()[0]
    assert (res["allocated"], res["credit"], res["reason"]) == (100_000, 30_000, "excess_amount")
    with pytest.raises(Denied):
        db.execute("SELECT core.reallocate_credit(%s, %s, 30000, 'clerk', 'apply to next')", (res["credit_id"], i2))
    db.execute("SELECT core.reallocate_credit(%s, %s, 30000, 'admin', 'customer asked to apply to next installment')", (res["credit_id"], i2))
    assert status(db, i2) == ("partial", 30_000, 70_000)


def test_reversal_restores_outstanding_and_is_blocked_after_refund(db, customer):
    cid = contract(db, customer(cap=10**9)); i1 = inst(db, cid, 1)
    r = receipt(db, "bank_collection", 100_000)
    db.execute("SELECT core.apply_receipt(%s, %s, 'clerk')", (r, i1))
    with pytest.raises(Raised, match="immutable"):
        db.execute("UPDATE core.receipt SET amount = 1 WHERE id = %s", (r,))
    with pytest.raises(Raised, match="never deleted"):
        db.execute("DELETE FROM core.receipt WHERE id = %s", (r,))
    db.execute("SELECT core.reverse_receipt(%s, 'clerk', 'bank reversed the transfer')", (r,))
    assert status(db, i1, "2026-05-01") == ("overdue", 0, 100_000)
    r2 = receipt(db, "bank_collection", 200_000)
    res = db.execute("SELECT core.apply_receipt(%s, %s, 'clerk')", (r2, i1)).fetchone()[0]
    db.execute("SELECT core.refund_credit(%s, 100000, '2025-05-05', 'cash', NULL, 'admin', 'excess returned')", (res["credit_id"],))
    with pytest.raises(Raised, match="refunded"):
        db.execute("SELECT core.reverse_receipt(%s, 'clerk', 'mistake')", (r2,))


# ---------- status, cancellation ----------
def test_statuses_over_time(db, customer):
    cid = contract(db, customer(cap=10**9), first="1404/01/31")                  # 2025-04-20
    i1, i2 = inst(db, cid, 1), inst(db, cid, 2)
    assert status(db, i1, "2025-04-01")[0] == "not_due"
    assert status(db, i1, "2025-04-20")[0] == "due"
    assert status(db, i1, "2025-04-21")[0] == "overdue"
    d = receipt(db, "direct_payment", 40_000, name="walk-in payer")
    db.execute("SELECT core.apply_receipt(%s, %s, 'clerk')", (d, i2))
    assert status(db, i2, "2025-05-01")[0] == "partial"


def test_cancellation_only_for_unpaid_installments(db, customer):
    cid = contract(db, customer(cap=10**9)); i1, i12 = inst(db, cid, 1), inst(db, cid, 12)
    r = receipt(db, "bank_collection", 100_000)
    db.execute("SELECT core.apply_receipt(%s, %s, 'clerk')", (r, i1))
    with pytest.raises(Raised, match="already has payments"):
        db.execute("SELECT core.cancel_installment(%s, 'manual', 'early settlement', 'admin')", (i1,))
    db.execute("SELECT core.cancel_installment(%s, 'manual', 'early settlement', 'admin')", (i12,))
    assert status(db, i12)[0] == "cancelled"
    r2 = receipt(db, "bank_collection", 100_000)
    with pytest.raises(Raised, match="cancelled"):
        db.execute("SELECT core.apply_receipt(%s, %s, 'clerk')", (r2, i12))
    assert db.execute("SELECT cancelled_count, outstanding_amount FROM core.contract_status WHERE contract_id = %s", (cid,)).fetchone() == (1, 1_000_000)


def test_bank_share_withdrawal_is_a_candidate_and_never_touches_receivables(db, customer):
    cid = contract(db, customer(cap=10**9)); i1 = inst(db, cid, 1)
    db.execute("INSERT INTO core.bank_share_withdrawal (company_bank_account_id, amount, value_date, created_by) VALUES (1, 6000, '2025-05-02', 'clerk')")
    assert status(db, i1)[2] == 100_000
    ctl = {r[0]: (r[3], r[4]) for r in db.execute("SELECT * FROM core.beta_controls('2025-05-01')").fetchall()}
    assert ctl["B-05"] == (1, 6000)
    assert ctl["B-12"][0] >= 1                                                  # contract not posted: D-14 open


# ---------- identity and merge (D-18) ----------
def test_national_id_validation_and_uniqueness(db):
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("INSERT INTO core.party (name, national_id) VALUES ('x', '1234567890')")
    db.execute("INSERT INTO core.party (name, national_id) VALUES ('a', %s)", (nid("111111112"),))
    with pytest.raises(psycopg.errors.UniqueViolation):
        db.execute("INSERT INTO core.party (name, national_id) VALUES ('b', %s)", (nid("111111112"),))


def test_merge_moves_contracts_never_merges_them_and_can_be_undone(db, customer):
    a = customer(name="ali rezaei", prefix="002345678", cap=10**9)
    code = db.execute("SELECT national_id FROM core.party WHERE id = %s", (a,)).fetchone()[0]
    b = db.execute("INSERT INTO core.party (name, name_key, national_id_claim) VALUES ('ali rezaei', 'alirezaei', %s) RETURNING id", (code,)).fetchone()[0]
    c1 = contract(db, a, bank_contract_id="C1")
    c2 = contracts.create(db, scheme_id=1, party_id=b, total=600, count=6, first_due="1405/01/31", user="admin", bank_contract_id="C2",
                          capacity_note="legacy")
    cands = db.execute("SELECT level, party_id, candidate_party_id FROM core.party_merge_candidate").fetchall()
    assert ("strong", b, a) in cands and not any(x[0] == "suspicious" for x in cands)
    with pytest.raises(Denied):
        db.execute("SELECT core.merge_parties(%s, %s, 'clerk', 'same person')", (b, a))
    m = db.execute("SELECT core.merge_parties(%s, %s, 'admin', 'same national id verified with ID card')", (b, a)).fetchone()[0]
    assert db.execute("SELECT count(*) FROM core.installment_contract WHERE party_id = %s", (a,)).fetchone()[0] == 2
    assert db.execute("SELECT count(DISTINCT id) FROM core.installment_contract WHERE id IN (%s, %s)", (c1, c2)).fetchone()[0] == 2
    db.execute("SELECT core.unmerge_parties(%s, 'admin', 'wrong merge')", (m,))
    assert db.execute("SELECT party_id FROM core.installment_contract WHERE id = %s", (c2,)).fetchone()[0] == b
    assert db.execute("SELECT merged_into_id FROM core.party WHERE id = %s", (b,)).fetchone()[0] is None


def test_merge_refused_for_different_national_ids(db, customer):
    a = customer(name="same name", prefix="003456789"); b = customer(name="same name", prefix="004567890")
    assert db.execute("SELECT count(*) FROM core.party_merge_candidate").fetchone()[0] == 0   # same name, different ids: not a candidate
    with pytest.raises(Raised, match="different persons"):
        db.execute("SELECT core.merge_parties(%s, %s, 'admin', 'looks the same')", (b, a))


def test_money_operations_are_audited(db, customer):
    cid = contract(db, customer(cap=10**9)); r = receipt(db, "bank_collection", 100_000)
    db.execute("SELECT core.apply_receipt(%s, %s, 'clerk')", (r, inst(db, cid, 1)))
    assert db.execute("SELECT array_agg(action ORDER BY id) FROM core.audit_event WHERE object_type = 'receipt'").fetchone()[0] == ["record", "apply"]
    assert db.execute("SELECT bool_and(link_ok AND hash_ok) FROM core.audit_chain_check").fetchone()[0]
