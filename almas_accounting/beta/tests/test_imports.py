"""Bank statement import and Beta snapshot import (synthetic rows in the real formats)."""
import datetime as dt

import pytest

from beta import contracts, snapshot_import as SI, statement_import as ST
from conftest import nid

N1, N2 = nid("051234567"), nid("062345678")


def line(date, deposit=0, withdrawal=0, desc="", dep_id="", doc="D1", bal=0, time="10:00"):
    y, m, d = date
    import jdatetime
    return {"date": jdatetime.date(y, m, d).togregorian(), "jdate": f"{y:04}/{m:02}/{d:02}", "time": time, "doc_no": doc, "branch": "1",
            "deposit": deposit, "withdrawal": withdrawal, "balance": bal, "deposit_id": dep_id, "description": desc}


@pytest.fixture()
def setup(db):
    p1 = db.execute("INSERT INTO core.party (name, name_key, national_id) VALUES ('مشتری نمونه یک', 'مشترینمونهیک', %s) RETURNING id", (N1,)).fetchone()[0]
    p2 = db.execute("INSERT INTO core.party (name, name_key, national_id) VALUES ('مشتری نمونه دو', 'مشترینمونهدو', %s) RETURNING id", (N2,)).fetchone()[0]
    c1 = contracts.create(db, scheme_id=1, party_id=p1, total=1_200_000, count=12, first_due="1405/05/31", user="admin",
                          capacity_note="test", bank_contract_id="K1")
    return {"p1": p1, "p2": p2, "c1": c1}


STATEMENT = [
    line((1405, 6, 1), deposit=100_000, desc="بابت قسط مشتری نمونه یک", dep_id=N1, doc="A1", bal=100_000),
    line((1405, 6, 1), deposit=70_000, desc="بابت قسط مشتری نمونه دو", dep_id=N2, doc="A2", bal=170_000),
    line((1405, 6, 1), deposit=50_000, desc="بابت قسط ناشناس", dep_id="9999999999", doc="A3", bal=220_000),
    line((1405, 6, 2), withdrawal=6_000, desc="برداشت پایا لحظه ای صادرهREFA123", doc="A4", bal=214_000),
    line((1405, 6, 2), withdrawal=230, desc="کارمزد ساتنا", doc="A5", bal=213_770),
    line((1405, 6, 3), deposit=5_000_000, desc="پایا مرکزشاپرک", doc="A6", bal=5_213_770),
    line((1405, 6, 4), withdrawal=4_000_000, desc="ساتنا شرکت تامین کالا", doc="A7", bal=1_213_770),
]


def test_statement_classification_and_matching_without_auto_apply(db, setup):
    st = ST.import_lines(db, STATEMENT, "sha-1", "s1.xls", 1, "importer")
    assert st["balance_chain_ok"] and st["new_lines"] == 7
    assert st["by_class"] == {"installment": 3, "bank_share_candidate": 1, "bank_fee": 1, "other_deposit": 1, "other_withdrawal": 1}
    assert st["installment_match"] == {"auto_matched": 1, "party_identified": 1, "unmatched": 1}
    assert db.execute("SELECT count(*) FROM core.receipt").fetchone()[0] == 0          # proposal only: no money booked
    assert db.execute("SELECT count(*), min(status) FROM core.bank_share_withdrawal").fetchone() == (1, "candidate")
    assert ST.import_lines(db, STATEMENT, "sha-1", "s1.xls", 1, "importer")["status"] == "duplicate"


def test_statement_auto_apply_books_and_pays_the_matched_installment(db, setup):
    st = ST.import_lines(db, STATEMENT, "sha-2", "s2.xls", 1, "importer", auto_apply=True)
    assert st["receipts_created"] == 1
    assert db.execute("""SELECT s.status FROM core.installment_status_at('2026-08-24') s JOIN core.installment i ON i.id = s.installment_id
                         WHERE i.contract_id = %s AND i.seq = 1""", (setup["c1"],)).fetchone()[0] == "paid_by_bank"
    # overlapping next statement: known lines are not re-imported or re-applied; a duplicate bank payment → credit
    nxt = STATEMENT[:1] + [line((1405, 6, 2), deposit=100_000, desc="بابت قسط مشتری نمونه یک", dep_id=N1, doc="B1", bal=1_313_770)]
    # the second deposit is for the same (already paid) installment only if nothing else is due: make it ambiguous-free
    st2 = ST.import_lines(db, nxt, "sha-3", "s3.xls", 1, "importer", auto_apply=True)
    assert st2["known_lines"] == 1 and st2["new_lines"] == 1
    assert db.execute("SELECT count(*) FROM core.receipt").fetchone()[0] == 2
    assert db.execute("SELECT reason FROM core.overpayment_credit").fetchone()[0] == "duplicate_collection"


def test_early_payment_matches_the_unpaid_installment_not_a_duplicate(db, setup):
    ST.import_lines(db, STATEMENT[:1], "sha-5", "s5.xls", 1, "importer", auto_apply=True)          # pays 1405/05/31
    early = [line((1405, 6, 30), deposit=100_000, desc="بابت قسط مشتری نمونه یک", dep_id=N1, doc="E1", bal=200_000)]
    ST.import_lines(db, early, "sha-6", "s6.xls", 1, "importer", auto_apply=True)                  # window holds 05/31 (paid) and 06/31
    paid = db.execute("""SELECT i.seq FROM core.installment_status_at('2026-09-21') s JOIN core.installment i ON i.id = s.installment_id
                         WHERE i.contract_id = %s AND s.status = 'paid_by_bank' ORDER BY 1""", (setup["c1"],)).fetchall()
    assert paid == [(1,), (2,)] and db.execute("SELECT count(*) FROM core.overpayment_credit").fetchone()[0] == 0


def test_statement_name_mismatch_goes_to_review(db, setup):
    bad = [line((1405, 6, 1), deposit=100_000, desc="بابت قسط شخص دیگر", dep_id=N1, doc="C1", bal=100_000)]
    st = ST.import_lines(db, bad, "sha-4", "s4.xls", 1, "importer", auto_apply=True)
    assert st["installment_match"] == {"needs_review": 1} and st["receipts_created"] == 0


SNAP = [{"bank_contract_id": "7000001", "nc": N2, "name": "مشتری نمونه دو", "account": "90000000000001",
         "registered_at": dt.datetime(2026, 8, 18, 18, 17, 34), "total": 600_000_005, "count": 12, "first_due": "1405/06/31",
         "first_amount": 50_000_000, "collected": 0, "overdue": 0, "deleted": 0, "collected_amount": 0},
        {"bank_contract_id": "7000002", "nc": nid("071234567"), "name": "مشتری جدید", "account": "90000000000002",
         "registered_at": dt.datetime(2026, 8, 18, 18, 11, 11), "total": 1200, "count": 12, "first_due": "1405/06/31",
         "first_amount": 100, "collected": 0, "overdue": 0, "deleted": 0, "collected_amount": 0},
        {"bank_contract_id": "7000003", "nc": N2, "name": "مشتری نمونه دو", "account": "90000000000001",
         "registered_at": dt.datetime(2026, 8, 18, 19, 0), "total": 1000, "count": 3, "first_due": "1405/06/31",
         "first_amount": 400, "collected": 0, "overdue": 0, "deleted": 0, "collected_amount": 0}]


def test_snapshot_requires_scheme_and_creates_contracts(db, setup):
    with pytest.raises(ValueError, match="Q-1"):
        SI.import_rows(db, SNAP, "snap-1", "beta.xlsx", None, "importer")
    st = SI.import_rows(db, SNAP, "snap-1", "beta.xlsx", 1, "importer")
    assert (st["contracts_created"], st["parties_created"], st["schedule_mismatch"]) == (2, 1, 1)   # 400 ≠ floor(1000/3)
    rows = db.execute("SELECT party_id, capacity_check, source FROM core.installment_contract WHERE bank_contract_id = '7000001'").fetchone()
    assert rows == (setup["p2"], "imported_from_beta", "beta_import")                              # linked by national code
    last = db.execute("""SELECT amount FROM core.installment i JOIN core.installment_contract c ON c.id = i.contract_id
                         WHERE c.bank_contract_id = '7000001' ORDER BY seq DESC LIMIT 1""").fetchone()[0]
    assert last == 50_000_005
    assert db.execute("SELECT count(*) FROM core.party_bank_account").fetchone()[0] == 2
    assert SI.import_rows(db, SNAP, "snap-1", "beta.xlsx", 1, "importer")["status"] == "duplicate"


def test_later_snapshot_records_amendments_and_cancellations_for_review(db, setup):
    SI.import_rows(db, SNAP[:2], "snap-1", "beta.xlsx", 1, "importer")
    later = [dict(SNAP[0], deleted=11, collected=1, collected_amount=50_000_000), dict(SNAP[1], total=2400, first_amount=200)]
    st = SI.import_rows(db, later, "snap-2", "beta2.xlsx", 1, "importer")
    assert st["cancellations_pending_review"] == 11 and st["amendments"] == 1
    assert db.execute("SELECT count(*) FROM core.installment_cancellation WHERE review_status = 'pending_review'").fetchone()[0] == 11
    assert db.execute("SELECT total_amount FROM core.installment_contract WHERE bank_contract_id = '7000002'").fetchone()[0] == 1200  # not applied
    ctl = {r[0]: r[3] for r in db.execute("SELECT * FROM core.beta_controls('2026-10-01')").fetchall()}
    assert ctl["B-08"] == 1 and ctl["B-09"] == 11 and ctl["B-13"] == 1        # Beta says 1 collected, we recorded 0
    assert ctl["B-14"] == 1                                                    # reported by Beta, not a false arrear (status below)
    st1 = db.execute("""SELECT s.status FROM core.installment_status_at('2026-10-01') s JOIN core.installment i ON i.id = s.installment_id
                        JOIN core.installment_contract c ON c.id = i.contract_id WHERE c.bank_contract_id = '7000001' AND i.seq = 1""").fetchone()[0]
    assert st1 == "collected_per_beta"
