"""Holoo ledger → core (D-03): chart mapping, idempotency, newer backup, parity, mirror untouched."""
import psycopg
import pytest

from migration import holoo_ledger as M

DB = "holoo1_1404"
ACCOUNTS = [  # code, name, parent, nature, group, role
    ("101", "cash", None, 1, 1, 3), ("1010001", "cash box", "101", 1, 1, 3),
    ("103", "receivables", None, 1, 1, 5), ("1030008", "customers", "103", 1, 1, 5),
    ("10300080001", "customer A", "1030008", 1, 1, 5), ("10300080002", "customer B", "1030008", 1, 1, 5),
    ("10300089999", "unused non-person", "1030008", 1, 1, 5),                       # dropped: no postings
    ("1037001", "old-style person moein", "103", 1, 1, 5),                          # person at moein level → 103P
    ("901", "revenue", None, 2, 9, 50), ("9010001", "sales", "901", 2, 9, 50),
    ("005", "opening balance", None, 0, 0, 1)]
PERSONS = [("0001", "Customer A", "10300080001", None), ("0002", "Customer B", "10300080002", None), ("0003", "Old Person", "1037001", None)]
VOUCHERS = [  # sanad, date, state, lines [(account, debit, credit, visible)]
    (1, "2025-03-21", "opening", [("1010001", 500, 0, True), ("005", 0, 500, True)]),
    (2, "2025-04-10", "normal", [("10300080001", 300, 0, True), ("9010001", 0, 300, True)]),
    (3, "2025-05-10", "normal", [("1010001", 200, 0, True), ("10300080001", 0, 200, True), ("1037001", 50, 0, True), ("9010001", 0, 50, True)]),
    (4, "2025-06-10", "normal", [("10300080002", 70, 0, False), ("9010001", 0, 70, False)]),   # voided invoice: hidden lines
    (5, "2025-06-11", "normal", [("10300080002", 90, 0, True), ("9010001", 0, 90, True), ("1010001", 0, 0, True)])]


def seed(db, run="run1"):
    db.execute("INSERT INTO holoo_mirror.import_run VALUES (%s, %s)", (run, DB))
    for a in ACCOUNTS:
        db.execute("INSERT INTO holoo_mirror.account VALUES (%s,%s,%s,%s,%s,%s,%s,NULL)", (DB,) + a)
    for c, n, d, cr in PERSONS:
        db.execute("INSERT INTO holoo_mirror.person VALUES (%s,%s,%s,%s,NULL,NULL,%s,%s,%s,NULL)", (DB, c, n, n.replace(" ", ""), d, cr, "h" + c))
    for s, d, st, lines in VOUCHERS:
        db.execute("INSERT INTO holoo_mirror.voucher (source_db, sanad_code, doc_date, state, comment) VALUES (%s,%s,%s,%s,%s)", (DB, s, d, st, f"v{s}"))
        for i, (a, dr, cr, vis) in enumerate(lines, 1):
            db.execute("INSERT INTO holoo_mirror.voucher_line VALUES (%s,%s,%s,%s,%s,%s,NULL,%s,NULL)", (DB, s, i, a, dr, cr, vis))


def fp(db):
    return [db.execute(f"SELECT count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM holoo_mirror.{t} t").fetchone()
            for t in ("person", "account", "voucher", "voucher_line", "import_run")]


def test_chart_follows_d03(db):
    seed(db)
    M.migrate(db, DB, "1404")
    acc = {r[0]: r[1:] for r in db.execute("SELECT code, is_leaf, requires_party, statement FROM core.account").fetchall()}
    assert acc["1030008"] == (True, True, "balance_sheet")                # person moein → leaf control
    assert acc["103P"] == (True, True, "balance_sheet")                   # old-style person moeins → 103P
    assert "10300080001" not in acc and "1037001" not in acc and "10300089999" not in acc
    assert acc["9010001"] == (True, False, "income_statement") and acc["005"][2] == "memo"
    kinds = dict(db.execute("SELECT legacy_code, kind FROM core.legacy_account_map").fetchall())
    assert kinds["10300080001"] == "person_control" and kinds["10300089999"] == "dropped_unused" and kinds["9010001"] == "same_code"


def test_migration_parity_and_voided_vouchers(db):
    seed(db)
    before = fp(db)
    st = M.migrate(db, DB, "1404")
    assert st["entries_created"] == 4 and st["skipped_no_visible_lines"] == 1
    p = M.parity(db, DB)
    assert p["status"] == "pass" and p["holoo_totals"] == [1140.0, 1140.0]
    bal = dict(db.execute("""SELECT pl.legacy_code, t.balance FROM core.trial_balance_party t JOIN core.party_legacy_code pl ON pl.party_id = t.party_id""").fetchall())
    assert bal == {"0001": 100, "0002": 90, "0003": 50}
    assert db.execute("SELECT kind FROM core.journal_entry WHERE number = 1").fetchone()[0] == "opening"
    assert fp(db) == before                                                # holoo_mirror never written


def test_rerun_is_idempotent(db):
    seed(db)
    M.migrate(db, DB, "1404")
    n = db.execute("SELECT (SELECT count(*) FROM core.journal_entry), (SELECT count(*) FROM core.journal_line), (SELECT count(*) FROM core.party)").fetchone()
    st = M.migrate(db, DB, "1404")
    assert (st["entries_created"], st["superseded"], st["removed_in_source"]) == (0, 0, 0)
    assert db.execute("SELECT (SELECT count(*) FROM core.journal_entry), (SELECT count(*) FROM core.journal_line), (SELECT count(*) FROM core.party)").fetchone() == n


def test_newer_backup_supersedes_changed_and_reverses_removed(db):
    seed(db)
    M.migrate(db, DB, "1404")
    db.execute("INSERT INTO holoo_mirror.import_run VALUES ('run2', %s)", (DB,))
    db.execute("UPDATE holoo_mirror.voucher_line SET debit = 350 WHERE sanad_code = 2 AND line_index = 1")
    db.execute("UPDATE holoo_mirror.voucher_line SET credit = 350 WHERE sanad_code = 2 AND line_index = 2")
    db.execute("UPDATE holoo_mirror.voucher SET removed_run = 'run2' WHERE sanad_code = 5")
    db.execute("UPDATE holoo_mirror.voucher_line SET removed_run = 'run2' WHERE sanad_code = 5")
    db.execute("INSERT INTO holoo_mirror.voucher (source_db, sanad_code, doc_date, state, comment) VALUES (%s, 6, '2025-07-01', 'normal', 'v6')", (DB,))
    db.execute("INSERT INTO holoo_mirror.voucher_line VALUES (%s,6,1,'1010001',10,0,NULL,true,NULL),(%s,6,2,'9010001',0,10,NULL,true,NULL)", (DB, DB))
    st = M.migrate(db, DB, "1404", "run2")
    assert (st["superseded"], st["removed_in_source"], st["entries_created"]) == (1, 1, 2)
    assert M.parity(db, DB)["status"] == "pass"
    # history kept: original entries still posted, each with a reversal; nothing edited or deleted
    assert db.execute("SELECT count(*) FROM core.journal_entry WHERE kind = 'reversal'").fetchone()[0] == 2
    assert db.execute("SELECT count(*) FROM core.legacy_entry_map WHERE status IN ('superseded', 'removed_in_source')").fetchone()[0] == 2
    assert db.execute("SELECT sum(balance) FROM core.trial_balance WHERE code = '1030008'").fetchone()[0] == 150   # 350 - 200


def test_posted_migrated_entries_are_immutable(db):
    seed(db)
    M.migrate(db, DB, "1404")
    with pytest.raises(psycopg.errors.RaiseException, match="immutable"):
        db.execute("UPDATE core.journal_line SET debit = 1 WHERE entry_id = (SELECT entry_id FROM core.legacy_entry_map WHERE sanad_code = 2)")


def test_holoo_sub_numbered_vouchers_keep_the_pair_and_holoo_order(db):
    """FY1405 (E31): Holoo numbers vouchers (Sanad_Code_C, Sanad_Code_C2) and shows «C.C2» (dbo.RetSanadCode)."""
    seed(db)
    db.execute("UPDATE holoo_mirror.voucher SET number = sanad_code, number2 = 0")
    db.execute("UPDATE holoo_mirror.voucher SET number = 10, number2 = 2, doc_date = '2025-04-10' WHERE sanad_code = 2")
    db.execute("UPDATE holoo_mirror.voucher SET number = 10, number2 = 1, doc_date = '2025-04-10' WHERE sanad_code = 3")
    st = M.migrate(db, DB, "1404")
    assert st["entries_created"] == 4 and M.parity(db, DB)["status"] == "pass"
    shown = dict(db.execute("SELECT split_part(source_ref, ':', 2)::int, number_display FROM core.journal_entry").fetchall())
    assert shown[2] == "10.2" and shown[3] == "10.1" and shown[5] == "5"
    # the ledger follows Holoo's order: 10.1 before 10.2 on the same day, although 10.2 was entered first
    cust = db.execute("SELECT id FROM core.account WHERE code = '1030008'").fetchone()[0]
    rows = db.execute("SELECT number_display FROM core.account_ledger('1404', %s, NULL, '2025-03-21', '2026-03-20') WHERE entry_id IS NOT NULL", (cust,)).fetchall()
    assert [r[0] for r in rows][:2] == ["10.1", "10.2"]
    assert [r[0] for r in db.execute("SELECT number_display FROM core.journal_list('2025-03-21', '2026-03-20', '10.2')")] == ["10.2"]
    assert {r[2] for r in db.execute("SELECT * FROM core.global_search('10')") if r[0] == "entry"} == {"سند 10.1", "سند 10.2"}
    assert M.migrate(db, DB, "1404")["entries_created"] == 0                      # idempotent


def test_a_repeated_holoo_voucher_number_stops_the_import_with_the_numbers(db):
    seed(db)
    db.execute("UPDATE holoo_mirror.voucher SET number = 7, number2 = 1 WHERE sanad_code IN (2, 3)")
    with pytest.raises(RuntimeError, match=r"repeated.*'7\.1'"):
        M.migrate(db, DB, "1404")
    assert db.execute("SELECT count(*) FROM core.journal_entry").fetchone()[0] == 0


def test_native_vouchers_have_no_sub_number_and_the_pair_is_unique(db):
    M.ensure_fiscal_year(db, "1405")
    db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement) VALUES ('1', 'a', 1, true, 'debit', 'balance_sheet'), ('2', 'b', 1, true, 'credit', 'balance_sheet')")
    fy, per = db.execute("SELECT fiscal_year_id, id FROM core.period ORDER BY starts_on LIMIT 1").fetchone()
    def entry(number, sub):
        return db.execute("INSERT INTO core.journal_entry (number, number_sub, fiscal_year_id, period_id, effective_date, created_by) VALUES (%s, %s, %s, %s, '2026-03-25', 't') RETURNING number_display",
                          (number, sub, fy, per)).fetchone()[0]
    assert entry(8, 0) == "8" and entry(8, 1) == "8.1"
    with pytest.raises(psycopg.errors.UniqueViolation):
        entry(8, 1)
    with pytest.raises(psycopg.errors.CheckViolation):
        entry(None, 2)
