"""Treasury & cheques (core 007): treasury_posting_lines, the cheque location chain, guarantee instruments, and the
Holoo voucher decomposition used by migration/treasury_parity.py — synthetic data only."""
import json

import psycopg
import pytest

from migration import holoo_ledger as M
from migration.treasury_parity import decompose


@pytest.fixture()
def t(db):
    M.ensure_fiscal_year(db, "1405")
    for code, name, lvl, nat, stmt, party in [
            ("1010001", "cash box", 2, "debit", "balance_sheet", False), ("10200010001", "bank A", 3, "debit", "balance_sheet", False),
            ("10200010002", "bank B", 3, "debit", "balance_sheet", False), ("1030008", "customers", 2, "debit", "balance_sheet", True),
            ("4010176", "suppliers", 2, "credit", "balance_sheet", True), ("6010009", "bank fees", 2, "debit", "income_statement", False),
            ("8030001", "purchase cash discount", 2, "credit", "income_statement", False),
            ("9030001", "sales cash discount", 2, "debit", "income_statement", False),
            ("10400010001", "cheques in cash box", 3, "debit", "balance_sheet", False),
            ("10400020001", "cheques at bank A for collection", 3, "debit", "balance_sheet", False),
            ("4020001", "notes payable bank A", 2, "credit", "balance_sheet", False),
            ("0010002", "guarantees of others with us", 2, "debit", "memo", False),
            ("0020002", "guarantee counter", 2, "credit", "memo", False)]:
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES (%s,%s,%s,true,%s,%s,%s)",
                   (code, name, lvl, nat, stmt, party))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    party = db.execute("INSERT INTO core.party (name) VALUES ('synthetic customer') RETURNING id").fetchone()[0]
    return ids, party


def tl(db, doc):
    return sorted((r[1], r[2], float(r[3]), float(r[4]), r[5])
                  for r in db.execute("SELECT * FROM core.treasury_posting_lines(%s::jsonb)", (json.dumps(doc),)).fetchall())


def test_receipt_with_fee_and_cash_discount(db, t):
    ids, p = t
    out = tl(db, {"kind": "receipt", "money_account_id": ids["10200010001"],
                  "counter": [{"account_id": ids["1030008"], "party_id": p, "amount": 1000}],
                  "fees": [{"account_id": ids["6010009"], "amount": 5}], "discounts": [{"account_id": ids["9030001"], "amount": 50}]})
    assert out == sorted([(ids["10200010001"], None, 950.0, 0.0, "money_in"), (ids["1030008"], p, 0.0, 1000.0, "counter"),
                          (ids["9030001"], None, 50.0, 0.0, "cash_discount"), (ids["6010009"], None, 5.0, 0.0, "fee"),
                          (ids["10200010001"], None, 0.0, 5.0, "fee_paid")])
    assert sum(x[2] for x in out) == sum(x[3] for x in out)


def test_payment_with_discount_received_and_transfer_and_fee_doc(db, t):
    ids, p = t
    pay = tl(db, {"kind": "payment", "money_account_id": ids["10200010001"],
                  "counter": [{"account_id": ids["4010176"], "party_id": p, "amount": 800}], "discounts": [{"account_id": ids["8030001"], "amount": 100}]})
    assert (ids["10200010001"], None, 0.0, 700.0, "money_out") in pay and (ids["8030001"], None, 0.0, 100.0, "cash_discount") in pay
    tr = tl(db, {"kind": "transfer", "money_account_id": ids["10200010001"], "counter": [{"account_id": ids["10200010002"], "amount": 300}],
                 "fees": [{"account_id": ids["6010009"], "amount": 2}]})
    assert tr == sorted([(ids["10200010002"], None, 300.0, 0.0, "counter"), (ids["10200010001"], None, 0.0, 300.0, "money_out"),
                         (ids["6010009"], None, 2.0, 0.0, "fee"), (ids["10200010001"], None, 0.0, 2.0, "fee_paid")])
    fee = tl(db, {"kind": "bank_fee", "money_account_id": ids["10200010001"], "counter": [{"account_id": ids["6010009"], "amount": 9}]})
    assert fee == sorted([(ids["6010009"], None, 9.0, 0.0, "counter"), (ids["10200010001"], None, 0.0, 9.0, "money_out")])


@pytest.mark.parametrize("doc,msg", [
    ({"kind": "loan", "money_account_id": 1}, "unknown treasury kind"),
    ({"kind": "receipt", "counter": []}, "money account is required"),
    ({"kind": "payment", "money_account_id": 1, "counter": [{"account_id": 2, "amount": 0}]}, "positive"),
    ({"kind": "transfer", "money_account_id": 1, "counter": [{"account_id": 1, "amount": 5}]}, "between own accounts"),
    ({"kind": "transfer", "money_account_id": 1, "counter": [{"account_id": 2, "party_id": 1, "amount": 5}]}, "between own accounts"),
    ({"kind": "transfer", "money_account_id": 1, "counter": [{"account_id": 2, "amount": 5}], "discounts": [{"account_id": 3, "amount": 1}]}, "discount"),
    ({"kind": "payment", "money_account_id": 1, "counter": [{"account_id": 2, "amount": 5}], "discounts": [{"account_id": 3, "amount": 6}]}, "exceeds"),
])
def test_treasury_rule_guards(db, t, doc, msg):
    with pytest.raises(psycopg.errors.RaiseException, match=msg):
        tl(db, doc)


# ---- Holoo voucher decomposition (pure) ----
MONEY, FEE, DISC = {1, 2, 3}, {60}, {80, 90}


def test_decompose_compound_receipt_becomes_receipt_plus_transfer():
    # customer pays 100 into bank 1; the same voucher moves 500 from bank 1 to bank 2 (Holoo type «receipt»)
    docs, why = decompose([(1, None, 100, 0), (40, 7, 0, 100), (2, None, 500, 0), (1, None, 0, 500)], MONEY, FEE)
    assert why is None and sorted(d["kind"] for d in docs) == ["receipt", "transfer"]


def test_decompose_merged_fee_line_is_a_fee_of_the_paying_bank():
    # transfer 1000 from bank 1 to bank 2 with a 3 fee inside a single credit line of bank 1 (no gross pair)
    docs, _ = decompose([(2, None, 1000, 0), (60, None, 3, 0), (1, None, 0, 1003)], MONEY, FEE)
    assert docs == [{"kind": "transfer", "money_account_id": 1, "counter": [{"account_id": 2, "amount": 1000}],
                     "fees": [{"account_id": 60, "amount": 3}]}]


def test_decompose_gross_fee_pair_alone_is_a_bank_fee():
    docs, _ = decompose([(60, None, 7, 0), (3, None, 0, 7)], MONEY, FEE)
    assert docs == [{"kind": "bank_fee", "money_account_id": 3, "counter": [{"account_id": 60, "amount": 7}], "fees": []}]


def test_decompose_payment_with_cash_discount_and_multi_source_transfer():
    docs, _ = decompose([(41, 9, 800, 0), (1, None, 0, 650), (80, None, 0, 150)], MONEY, FEE, DISC)
    assert docs == [{"kind": "payment", "money_account_id": 1, "counter": [{"account_id": 41, "party_id": 9, "amount": 800}],
                     "discounts": [{"account_id": 80, "amount": 150}]}]
    docs, _ = decompose([(1, None, 300, 0), (2, None, 0, 100), (3, None, 0, 200)], MONEY, FEE)
    assert sorted((d["money_account_id"], d["counter"][0]["amount"]) for d in docs) == [(2, 100), (3, 200)]


def test_decompose_rejects_general_journal_shapes():
    docs, why = decompose([(40, 7, 100, 0), (41, 8, 0, 100)], MONEY, FEE)         # party-to-party, no money
    assert docs is None
    docs, why = decompose([(1, None, 0, 100), (40, 7, 150, 0), (50, None, 0, 50)], MONEY, FEE)   # mixed, 50 is not a discount account
    assert docs is None and why == "mixed non-money debits and credits"


# ---- cheque location chain ----
def cheque(db, ids, p, direction="in", amount=500):
    return db.execute("INSERT INTO core.cheque (direction, number, amount, due_date, party_id) VALUES (%s, 'X1', %s, '2026-05-01', %s) RETURNING id",
                      (direction, amount, p)).fetchone()[0]


def event(db, chk, typ, fa, fp, ta, tp, day="2026-04-01"):
    return db.execute("""INSERT INTO core.cheque_event (cheque_id, state, effective_date, event_type, from_account_id, from_party_id, to_account_id, to_party_id)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""", (chk, typ, day, typ, fa, fp, ta, tp)).fetchone()[0]


def test_cheque_moves_along_its_locations_and_posts(db, t):
    ids, p = t
    c = cheque(db, ids, p)
    e1 = event(db, c, "received", ids["1030008"], p, ids["10400010001"], None)
    e2 = event(db, c, "deposited_for_collection", ids["10400010001"], None, ids["10400020001"], None, "2026-04-10")
    e3 = event(db, c, "collected", ids["10400020001"], None, ids["10200010001"], None, "2026-05-01")
    assert sorted(db.execute("SELECT account_id, party_id, debit, credit FROM core.cheque_event_lines(%s)", (e1,)).fetchall()) == \
        sorted([(ids["10400010001"], None, 500, 0), (ids["1030008"], p, 0, 500)])
    loc = db.execute("SELECT account_id, last_event FROM core.cheque_location WHERE cheque_id = %s", (c,)).fetchone()
    assert loc == (ids["10200010001"], "collected")
    eid = db.execute("SELECT core.post_cheque_events(%s, '2026-04-01', 'v1', 'tester')", ([e1, e2, e3],)).fetchone()[0]
    assert db.execute("SELECT core.post_cheque_events(%s, '2026-04-01', 'v1', 'tester')", ([e1],)).fetchone()[0] == eid   # idempotent
    tot = db.execute("SELECT sum(debit), sum(credit), count(*) FROM core.journal_line WHERE entry_id = %s", (eid,)).fetchone()
    assert tot == (1500, 1500, 6)
    assert db.execute("SELECT count(*) FROM core.cheque_event WHERE journal_entry_id = %s", (eid,)).fetchone()[0] == 3
    with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
        db.execute("UPDATE core.cheque_event SET effective_date = '2026-06-01' WHERE id = %s", (e1,))


def test_cheque_chain_rejects_a_move_from_where_it_is_not(db, t):
    ids, p = t
    c = cheque(db, ids, p)
    event(db, c, "received", ids["1030008"], p, ids["10400010001"], None)
    with pytest.raises(psycopg.errors.RaiseException, match="is at account"):        # backdated / phantom move (Holoo E08)
        event(db, c, "collected", ids["10400020001"], None, ids["10200010001"], None)
    with pytest.raises(psycopg.errors.RaiseException, match="needs the party"):      # W-32: «00000» = nobody is not allowed
        event(db, c, "endorsed_to_party", ids["10400010001"], None, ids["4010176"], None)
    with pytest.raises(psycopg.errors.RaiseException, match="from and to"):
        event(db, c, "cashed", ids["10400010001"], None, None, None)


# ---- guarantee instruments ----
def test_guarantee_taken_released_and_party_required(db, t):
    ids, p = t
    with pytest.raises(psycopg.errors.CheckViolation):                               # W-35: a new guarantee names its guarantor
        db.execute("INSERT INTO core.guarantee_instrument (direction, amount, memo_account_id, memo_counter_account_id) VALUES ('received', 10, %s, %s)",
                   (ids["0010002"], ids["0020002"]))
    g = db.execute("""INSERT INTO core.guarantee_instrument (direction, party_id, amount, memo_account_id, memo_counter_account_id)
                      VALUES ('received', %s, 900, %s, %s) RETURNING id""", (p, ids["0010002"], ids["0020002"])).fetchone()[0]
    with pytest.raises(psycopg.errors.RaiseException, match="already"):
        db.execute("INSERT INTO core.guarantee_event (guarantee_id, event_type, effective_date) VALUES (%s, 'released', '2026-04-01')", (g,))
    e1 = db.execute("INSERT INTO core.guarantee_event (guarantee_id, event_type, effective_date) VALUES (%s, 'taken', '2026-04-01') RETURNING id", (g,)).fetchone()[0]
    assert sorted(db.execute("SELECT account_id, party_id, debit, credit FROM core.guarantee_event_lines(%s)", (e1,)).fetchall()) == \
        sorted([(ids["0010002"], p, 900, 0), (ids["0020002"], p, 0, 900)])
    assert db.execute("SELECT count(*) FROM core.guarantee_open").fetchone()[0] == 1
    e2 = db.execute("INSERT INTO core.guarantee_event (guarantee_id, event_type, effective_date) VALUES (%s, 'released', '2026-06-01') RETURNING id", (g,)).fetchone()[0]
    assert sorted(db.execute("SELECT account_id, debit, credit FROM core.guarantee_event_lines(%s)", (e2,)).fetchall()) == \
        sorted([(ids["0020002"], 900, 0), (ids["0010002"], 0, 900)])
    assert db.execute("SELECT count(*) FROM core.guarantee_open").fetchone()[0] == 0


# ---- Holoo cheque derivation (E18) on a synthetic mirror ----
CHEQUE_MIRROR = """
ALTER TABLE holoo_mirror.voucher ADD COLUMN voucher_type int;
CREATE TABLE holoo_mirror.cheque (source_db text, check_code int, direction text, amount numeric, person_code text, number text,
  account_no text, cashbox_id int);
CREATE TABLE holoo_mirror.cheque_event (source_db text, event_id bigint, check_code int, state text, event_date date, voucher_code int,
  account_code text, cashbox_id int, removed_run text);
CREATE TABLE holoo_mirror.cashbox (source_db text, id int, cheque_account_code text);
CREATE TABLE holoo_mirror.bank_account (source_db text, id int, account_code text, collection_account_code text,
  payable_cheque_account_code text, account_no text);
"""


def test_derive_rebuilds_the_implicit_cheque_locations(db):
    from migration.holoo_cheques import derive
    db.execute(CHEQUE_MIRROR)
    S = "fake"
    db.execute("INSERT INTO holoo_mirror.person (source_db, c_code, name, debit_account, credit_account) VALUES "
               "(%s, '00001', 'payer', '10300080001', '10300080001'), (%s, '00002', 'supplier', '40101760002', '40101760002'), "
               "(%s, '00000', 'nobody', NULL, NULL)", (S, S, S))
    db.execute("INSERT INTO holoo_mirror.cashbox VALUES (%s, 1, '10400010001')", (S,))
    db.execute("INSERT INTO holoo_mirror.bank_account VALUES (%s, 1, '10200010001', '10400020001', '4020001', 'ACC-1')", (S,))
    db.execute("""INSERT INTO holoo_mirror.cheque VALUES (%s, 1, 'in', 100, '00001', 'A', NULL, 1), (%s, 2, 'in', 200, '00001', 'B', NULL, 1),
                  (%s, 3, 'out', 300, '00002', 'C', 'ACC-1', NULL), (%s, 4, 'in', 50, '00001', 'D', NULL, 1)""", (S, S, S, S))
    ev = [(1, 1, "D", "2026-04-01", 10, "00001", 1), (2, 1, "J", "2026-04-02", 11, "10200010001", None), (3, 1, "V", "2026-04-03", 12, None, None),
          (4, 2, "D", "2026-04-01", 10, "00001", 1), (5, 2, "V", "2026-04-05", 13, "00002", None),
          (6, 3, "P", "2026-04-01", 14, "00002", None), (7, 3, "V", "2026-04-20", 15, None, None),
          (8, 4, "D", "2026-04-01", 10, "00001", 1), (9, 4, "V", "2026-04-06", 16, "00000", None)]      # «00000»: nobody (W-32)
    db.cursor().executemany("INSERT INTO holoo_mirror.cheque_event VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL)", [(S,) + e for e in ev])
    vl = [(10, "10400010001", 350, 0), (10, "10300080001", 0, 350), (11, "10400020001", 100, 0), (11, "10400010001", 0, 100),
          (12, "10200010001", 100, 0), (12, "10400020001", 0, 100), (13, "40101760002", 200, 0), (13, "10400010001", 0, 200),
          (14, "40101760002", 300, 0), (14, "4020001", 0, 300), (15, "4020001", 300, 0), (15, "10200010001", 0, 300),
          (16, "1070009", 50, 0), (16, "10400010001", 0, 50)]                                         # endorsed as a prepayment
    db.cursor().executemany("INSERT INTO holoo_mirror.voucher_line (source_db, sanad_code, account_code, debit, credit, in_ledger) VALUES (%s,%s,%s,%s,%s,true)",
                   [(S,) + x for x in vl])
    db.cursor().executemany("INSERT INTO holoo_mirror.voucher (source_db, sanad_code, voucher_type) VALUES (%s, %s, 8)", [(S, v) for v in range(10, 17)])
    got = {e[0]: (t, f, to) for e, t, f, to in derive(db, S)[0]}
    assert got == {1: ("received", "10300080001", "10400010001"), 2: ("deposited_for_collection", "10400010001", "10400020001"),
                   3: ("collected", "10400020001", "10200010001"), 4: ("received", "10300080001", "10400010001"),
                   5: ("endorsed_to_party", "10400010001", "40101760002"), 6: ("issued", "4020001", "40101760002"),
                   7: ("paid_by_bank", "10200010001", "4020001"), 8: ("received", "10300080001", "10400010001"),
                   9: ("endorsed_to_party", "10400010001", "1070009")}


def test_every_cheque_has_a_status(db, t):
    ids, p = t
    live = cheque(db, ids, p)
    event(db, live, "received", ids["1030008"], p, ids["10400010001"], None)
    old = cheque(db, ids, p, amount=70)
    db.execute("UPDATE core.cheque SET closed_before_migration = 'endorsed_to_party' WHERE id = %s", (old,))
    orphan = cheque(db, ids, p, amount=90)
    st = {r[0]: (r[1], r[2]) for r in db.execute("SELECT cheque_id, kind, state FROM core.cheque_status")}
    assert st[live] == ("tracked", "received") and st[old] == ("closed_before_migration", "endorsed_to_party")
    assert st[orphan] == ("no_event", None)                                  # visible, never silently missing


def test_a_cheque_continued_into_the_next_year_starts_where_the_core_has_it(db):
    """FY1405 (E31): a cheque endorsed in FY1404 opens FY1405 as «spent to the supplier» and comes back: the return must come
    FROM the supplier (the core's location), and the opening is compared, never added as a second position (core 033)."""
    from migration.holoo_cheques import derive
    db.execute(CHEQUE_MIRROR)
    S = "year2"
    db.execute("INSERT INTO holoo_mirror.person (source_db, c_code, name, debit_account, credit_account) VALUES (%s, '00002', 'supplier', '40101760002', '40101760002')", (S,))
    db.execute("INSERT INTO holoo_mirror.cashbox VALUES (%s, 1, '10400010001')", (S,))
    db.execute("INSERT INTO holoo_mirror.cheque VALUES (%s, 2, 'in', 200, '00001', 'B', NULL, 1)", (S,))
    db.cursor().executemany("INSERT INTO holoo_mirror.cheque_event VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL)",
                            [(S, 1, 2, "V", "2026-03-21", 1, "00002", None), (S, 2, 2, "S", "2026-08-31", 20, None, None)])
    db.execute("INSERT INTO holoo_mirror.voucher (source_db, sanad_code, voucher_type, state) VALUES (%s, 1, 0, 'opening'), (%s, 20, 0, 'normal')", (S, S))
    db.cursor().executemany("INSERT INTO holoo_mirror.voucher_line (source_db, sanad_code, account_code, debit, credit, in_ledger) VALUES (%s,%s,%s,%s,%s,true)",
                            [(S, 20, "10400010001", 200, 0), (S, 20, "40101760002", 0, 200)])
    resolved, _, _, checks = derive(db, S, {2: {"loc": "40101760002", "onhand": "10400010001"}})
    assert [(e[0], t, f, to) for e, t, f, to in resolved] == [(2, "returned_by_endorsee", "40101760002", "10400010001")]
    assert [(e[0], expected) for e, expected in checks] == [(1, "40101760002")]        # the opening is a check against the core
    # without continuity (the old behaviour) the spent cheque had no holder and the return had no source
    old, _, _, _ = derive(db, S)
    assert all(t != "opening" for _, t, _, _ in old)


def test_opening_position_of_a_continued_cheque_is_compared_rule_by_rule():
    """core 033 / E31: the new year's opening of a cheque carried from an earlier Holoo year against the core's position."""
    from migration.holoo_cheques import opening_matches as m
    assert m("P", "out", "", ("issued", 1, None), None) and not m("P", "out", "", ("paid_by_bank", 1, None), None)
    assert m("V", "in", "", ("collected", 1, None), None) and not m("V", "in", "", ("endorsed_to_party", 5, 9), None)
    assert m("V", "in", "28996", ("endorsed_to_party", 5, 9), (5, 9)) and not m("V", "in", "28996", ("endorsed_to_party", 5, 9), (5, 8))
    assert m("D", "in", "", ("received", 3, None), (3, None)) and not m("D", "in", "", ("returned_from_bank", 3, None), (4, None))
    # spent before the first imported year: the core keeps only the state, the earlier Holoo year's counterparty decides
    closed = ("endorsed_to_party", None, None)
    assert m("V", "in", "28996", closed, (5, 9), prior="28996")
    assert not m("V", "in", "28996", closed, (5, 9), prior="28000") and not m("V", "in", "28996", closed, (5, 9), prior="")
    assert not m("V", "in", "28996", ("collected", None, None), (5, 9), prior="28996")
