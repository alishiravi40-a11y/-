"""Backup import (core 028): the Reader's real publish step on synthetic Silver files, change detection, incremental stock,
review queue, order guard, idempotent re-run and reconciliation. Synthetic data only."""
import datetime as dt
import hashlib

import duckdb
import psycopg
import pytest

from migration import holoo_incremental, holoo_inventory, import_backup
from migration.tests.conftest import DSN

DB = "hx"
COLS = {
    "warehouse": [("code", "VARCHAR"), ("name", "VARCHAR")],
    "item": [("a_code", "VARCHAR"), ("name", "VARCHAR"), ("name_key", "VARCHAR"), ("is_service", "BOOLEAN"), ("warehouse_code", "VARCHAR"),
             ("first_qty", "DOUBLE"), ("first_unit_cost", "DOUBLE"), ("stored_qty", "DOUBLE"), ("stored_avg_cost", "DOUBLE")],
    "voucher": [("sanad_code", "INTEGER"), ("number", "INTEGER"), ("doc_date", "DATE"), ("state", "VARCHAR")],
    "document": [("fac_type", "VARCHAR"), ("fac_code", "VARCHAR"), ("doc_date", "DATE"), ("doc_time", "VARCHAR"), ("total_qty", "DOUBLE"),
                 ("extra_cost", "DOUBLE"), ("tax_state", "INTEGER")],
    "document_line": [("fac_type", "VARCHAR"), ("fac_code", "VARCHAR"), ("a_code", "VARCHAR"), ("line_index", "INTEGER"), ("qty", "DOUBLE"),
                      ("unit_price", "DOUBLE"), ("unit_cost", "DOUBLE")],
    "cheque": [("check_code", "INTEGER"), ("amount", "DOUBLE")],
    "cheque_event": [("event_id", "INTEGER"), ("check_code", "INTEGER")],
    "tax_submission": [("id", "INTEGER"), ("fac_type", "VARCHAR"), ("fac_code", "VARCHAR")],
}


def backup_v1():
    return {
        "warehouse": [("1", "central"), ("2", "shop")],
        # A1 / A2: one model in two warehouses (Holoo gives each warehouse its own item code); B1 another model
        "item": [("A1", "phone", "phone", False, "1", 10, 100, 9, 100), ("A2", "phone", "phone", False, "2", 0, 0, 2, 100),
                 ("B1", "tv", "tv", False, "1", 5, 50, 4, 50)],
        "voucher": [(1, 1, dt.date(2025, 3, 21), "opening")],
        "document": [("K", "1", dt.date(2025, 4, 1), "09:00", 4, 0, None), ("F", "2", dt.date(2025, 4, 2), "10:00", 4, 0, 2),
                     ("S", "3", dt.date(2025, 4, 3), "11:00", 2, 0, None), ("D", "3", dt.date(2025, 4, 3), "11:00", 2, 0, None)],
        "document_line": [("K", "1", "A1", 0, 4, 100, 100), ("F", "2", "A1", 0, 3, 150, 100), ("F", "2", "B1", 1, 1, 90, 50),
                          ("S", "3", "A1", 0, 2, 0, 100), ("D", "3", "A2", 0, 2, 0, 100)],
        "cheque": [(7, 1000), (8, 500)], "cheque_event": [(70, 7), (80, 8)], "tax_submission": [(5, "F", "2")],
    }


def backup_v2():
    """A later backup of the same Holoo database: a sale line changed, a line removed, a sale added, an opening changed,
    a cheque changed, a Moadian record removed."""
    b = backup_v1()
    b["item"] = [("A1", "phone", "phone", False, "1", 10, 100, 9, 100), ("A2", "phone", "phone", False, "2", 0, 0, 2, 100),
                 ("B1", "tv", "tv", False, "1", 6, 50, 6, 50)]
    b["document"].append(("F", "4", dt.date(2025, 4, 5), "12:00", 2, 0, None))
    b["document_line"] = [("K", "1", "A1", 0, 4, 100, 100), ("F", "2", "A1", 0, 1, 150, 100),
                          ("S", "3", "A1", 0, 2, 0, 100), ("D", "3", "A2", 0, 2, 0, 100), ("F", "4", "A1", 0, 2, 150, 100)]
    b["cheque"] = [(7, 1200), (8, 500)]
    b["tax_submission"] = []
    return b


def silver(path, run, data):
    con = duckdb.connect(str(path))
    con.execute("CREATE TABLE meta (key VARCHAR, value VARCHAR)")
    con.executemany("INSERT INTO meta VALUES (?, ?)", [("run_id", run), ("source_db", DB), ("fiscal_year", "1404"), ("backup_sha256", run * 4)])
    for t, cols in COLS.items():
        con.execute(f"CREATE TABLE {t} ({', '.join(f'{c} {ty}' for c, ty in cols)}, source_row_hash VARCHAR)")
        for r in data[t]:
            con.execute(f"INSERT INTO {t} VALUES ({', '.join('?' * (len(cols) + 1))})", list(r) + [hashlib.md5(repr(r).encode()).hexdigest()])
    con.close()
    return str(path)


@pytest.fixture()
def imp(db, tmp_path):
    from holoo_reader import publish_pg
    from migration import holoo_ledger
    db.execute("DROP SCHEMA holoo_mirror CASCADE")
    holoo_ledger.ensure_fiscal_year(db, "1404")
    db.execute("INSERT INTO core.app_user (username) VALUES ('boss'), ('clerk')")
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('boss', 'holoo.import', 't')")

    def publish(run, data):
        f = tmp_path / f"{run}.duckdb"                                         # the same backup again → the same Silver file
        return publish_pg.publish(str(f) if f.exists() else silver(f, run, data), DSN)

    def batch(**kw):
        cols = {"triggered_by": "t", "input_files": ["x.bak"], "source_db": DB, "fiscal_year": "1404", **kw}
        return db.execute(f"INSERT INTO core.holoo_import_batch ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) RETURNING id",
                          list(cols.values())).fetchone()[0]
    return publish, batch


def stock(db):
    return {r[0]: float(r[1]) for r in db.execute("""SELECT l.legacy_code, coalesce(sum(CASE WHEN m.kind IN ('opening','purchase','sale_return','transfer_in')
            THEN m.qty ELSE -m.qty END), 0) FROM core.item_legacy_code l LEFT JOIN core.stock_movement_live m ON m.item_id = l.item_id
            AND m.warehouse_id = l.warehouse_id GROUP BY 1""")}


def legacy_core_rows(db):
    """What an earlier import put in the core for cheques and Moadian (their own migration is tested elsewhere)."""
    db.execute("INSERT INTO core.cheque (direction, number, amount, holoo_check_code, legacy_source_db) VALUES ('in', '7', 1000, 7, %s), ('in', '8', 500, 8, %s)", (DB, DB))
    db.execute("""INSERT INTO core.tax_submission (document_source, document_ref, subject, status, tax_id, legacy_id, legacy, created_by)
                  VALUES ('holoo:hx:F', '2', 'original', 'accepted', 'T1', 5, true, 't')""")


def test_newer_backup_changes_are_detected_and_applied_without_editing_legacy_facts(db, imp):
    publish, batch = imp
    r1 = publish("r1", backup_v1())
    assert r1["changes"] == {}                                                # first import of a database: nothing to compare
    first = import_backup.change_summary(db, "r1", DB)
    assert first["first_import"] and first["tables"]["document_line"] == {"added": 5, "changed": 0, "removed_in_source": 0, "unchanged": 0}
    holoo_inventory.migrate(db, DB)
    assert stock(db) == {"A1": 9, "A2": 2, "B1": 4}
    legacy_core_rows(db)
    first_ids = {r[0] for r in db.execute("SELECT id FROM core.stock_movement")}

    r2 = publish("r2", backup_v2())
    cs = import_backup.change_summary(db, "r2", DB)
    assert not cs["first_import"]
    assert cs["tables"]["document_line"] == {"added": 1, "changed": 1, "removed_in_source": 1, "unchanged": 3}
    assert cs["tables"]["item"] == {"added": 0, "changed": 1, "removed_in_source": 0, "unchanged": 2}
    assert cs["tables"]["cheque"]["changed"] == 1 and cs["tables"]["tax_submission"]["removed_in_source"] == 1

    b = batch(status="running")
    holoo_inventory.migrate(db, DB)                                          # the added sale
    inc = holoo_incremental.inventory(db, DB, "r2")
    assert inc["reversed"] == 3 and inc["reentered"] == 2                    # A1 sale changed, B1 line removed, B1 opening changed
    assert stock(db) == {"A1": 9, "A2": 2, "B1": 6}                         # = Holoo's own stored quantities of backup v2
    # nothing of the first import was edited or deleted
    assert first_ids <= {r[0] for r in db.execute("SELECT id FROM core.stock_movement")}
    with pytest.raises(psycopg.errors.RaiseException):
        db.execute("UPDATE core.stock_movement SET qty = 99 WHERE id = %s", (min(first_ids),))
    # the lineage of every live legacy line points to its Holoo row and the run that last set it
    assert db.execute("SELECT count(*) FROM core.stock_movement_live WHERE source_ref LIKE %s", ("%@r2",)).fetchone()[0] == 2

    rq = holoo_incremental.review_queue(db, DB, "r2", b)
    assert rq["review_items"] == 2                                           # cheque 7 changed, Moadian record removed
    assert {r[0] for r in db.execute("SELECT entity FROM core.legacy_change_review")} == {"cheque", "tax_submission"}

    # the same run again (the Reader reports a duplicate backup; publishing it again records nothing): no double counting
    publish("r2", backup_v2())
    assert db.execute("SELECT count(*) FROM holoo_mirror.change_log WHERE run_id = 'r2'").fetchone()[0] == sum(
        v for t in cs["tables"].values() for k, v in t.items() if k != "unchanged")
    holoo_inventory.migrate(db, DB)
    again = holoo_incremental.inventory(db, DB, "r2")
    assert again["reversed"] == 0 and again["reentered"] == 0
    assert holoo_incremental.review_queue(db, DB, "r2", b)["review_items"] == 0
    assert stock(db) == {"A1": 9, "A2": 2, "B1": 6}
    par = holoo_inventory.parity(db, DB, "2026-03-20")
    assert par["stock_qty_equal"] == par["item_codes"] == 3


def test_a_line_changed_twice_keeps_one_live_movement(db, imp):
    publish, _ = imp
    publish("r1", backup_v1()); holoo_inventory.migrate(db, DB)
    publish("r2", backup_v2()); holoo_inventory.migrate(db, DB); holoo_incremental.inventory(db, DB, "r2")
    v3 = backup_v2()
    v3["document_line"][1] = ("F", "2", "A1", 0, 2, 150, 100)
    v3["item"][0] = ("A1", "phone", "phone", False, "1", 10, 100, 8, 100)
    publish("r3", v3); holoo_inventory.migrate(db, DB); holoo_incremental.inventory(db, DB, "r3")
    assert stock(db)["A1"] == 8
    live = db.execute("SELECT source_ref FROM core.stock_movement_live WHERE source_ref LIKE 'holoo:hx:F:2:0%'").fetchall()
    assert live == [("holoo:hx:F:2:0@r3",)]


def test_transfer_pairs_are_stable_across_imports(db):
    a = db.execute("SELECT core.legacy_transfer_id('hx', '3', 0), core.legacy_transfer_id('hx', '3', 0), core.legacy_transfer_id('hx', '3', 1)").fetchone()
    assert a[0] == a[1] != a[2] and a[0] > 0


def test_an_older_backup_is_refused(db, imp):
    _, batch = imp
    t = dt.datetime(2026, 9, 26, 10, 41, tzinfo=dt.timezone.utc)
    batch(status="reconciled", backup_sha256="new", backup_finished_at=t)
    assert import_backup.order_guard(db, DB, "old", t - dt.timedelta(days=3)).startswith("backup finished")
    assert import_backup.order_guard(db, DB, "newer", t + dt.timedelta(days=1)) is None
    assert import_backup.order_guard(db, DB, "new", t) is None                        # the same backup again
    assert import_backup.order_guard(db, "other_db", "old", t - dt.timedelta(days=3)) is None
    rep = {"backup_meta": {"header": [{"BackupFinishDate": "2026-09-26 10:41:45"}]}}
    assert import_backup.backup_finished_at(rep) == dt.datetime(2026, 9, 26, 10, 41, 45, tzinfo=dt.timezone.utc)


def test_batch_status_controls_and_review_resolution(db, imp):
    publish, batch = imp
    b = batch(status="running")
    assert import_backup.finish(db, b, {"ledger_balances": {"status": "pass"}, "inventory": {"status": "fail"}}) == "differences"
    ctl = {r[1]: r[4] for r in db.execute("SELECT * FROM core.control_inbox('2026-09-27')") if r[0] == "import"}
    assert ctl["IMP-02"] == 1 and ctl["IMP-01"] == 0
    b2 = batch(status="running")
    assert import_backup.finish(db, b2, {"ledger_balances": {"status": "pass"}}) == "reconciled"
    ctl = {r[1]: r[4] for r in db.execute("SELECT * FROM core.control_inbox('2026-09-27')") if r[0] == "import"}
    assert ctl["IMP-02"] == 0 and ctl["IMP-04"] == 0
    assert {r[1]: r[4] for r in db.execute("SELECT * FROM core.import_controls('2026-10-20')")}["IMP-04"] == 1   # no fresh backup for 7+ days

    publish("r1", backup_v1()); legacy_core_rows(db); publish("r2", backup_v2())
    holoo_incremental.review_queue(db, DB, "r2", b2)
    rid = db.execute("SELECT id FROM core.legacy_change_review WHERE entity = 'cheque'").fetchone()[0]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("SELECT core.legacy_review_resolve(%s, 'accepted', 'checked with the cashier', 'clerk')", (rid,))
    db.execute("SELECT core.legacy_review_resolve(%s, 'accepted', 'checked with the cashier', 'boss')", (rid,))
    with pytest.raises(psycopg.errors.RaiseException, match="not open"):
        db.execute("SELECT core.legacy_review_resolve(%s, 'accepted', 'again', 'boss')", (rid,))
    lst = db.execute("SELECT status, open_reviews FROM core.imports_list(10) WHERE batch_id = %s", (b2,)).fetchone()
    assert lst == ("reconciled", 1)
    d = db.execute("SELECT core.import_detail(%s)", (b2,)).fetchone()[0]
    assert len(d["reviews"]) == 2 and d["status"] == "reconciled"
    assert db.execute("SELECT count(*) FROM core.audit_event WHERE object_type = 'legacy_change_review'").fetchone()[0] == 1


def test_coexistence_native_and_holoo_entries_in_one_period_are_listed_until_the_book_of_record_is_decided(db):
    from migration import holoo_ledger
    from migration.tests.test_receivables import post
    holoo_ledger.ensure_fiscal_year(db, "1405")
    for code, party in [("1030008", True), ("9010001", False), ("10200010001", False)]:
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES (%s, %s, 2, true, 'either', 'balance_sheet', %s)",
                   (code, code, party))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    p = db.execute("INSERT INTO core.party (name) VALUES ('synthetic') RETURNING id").fetchone()[0]
    db.execute("INSERT INTO core.app_user (username) VALUES ('owner')")
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('owner', 'settings.change', 't')")
    h, _ = post(db, ids, p, "2026-04-05", 700)
    db.execute("SET session_replication_role = replica")                    # test only: mark the entry as imported from Holoo
    db.execute("UPDATE core.journal_entry SET source = 'holoo', source_ref = 'hx:1' WHERE id = %s", (h,))
    db.execute("SET session_replication_role = origin")
    post(db, ids, p, "2026-04-10", 300)                                      # the same month, recorded natively
    post(db, ids, p, "2026-06-10", 50)                                       # a month with no Holoo entry
    ctl = lambda: {r[1]: (r[4], r[5]) for r in db.execute("SELECT * FROM core.coexistence_controls('2026-12-01')")}
    assert ctl() == {"COEX-01": (1, 300), "COEX-02": (0, None), "COEX-03": (0, None)}
    assert ("COEX-01", 1) in {(r[1], r[4]) for r in db.execute("SELECT * FROM core.control_inbox('2026-12-01')")}
    db.execute("SELECT core.change_setting('book_of_record_from', '2026-04-08', 'owner', 'D-07 decided: new system from this date')")
    assert ctl() == {"COEX-01": (0, None), "COEX-02": (0, None), "COEX-03": (0, None)}
    db.execute("SELECT core.change_setting('book_of_record_from', '2026-04-01', 'owner', 'owner moved the start date')")
    assert ctl()["COEX-02"] == (1, 700)                                      # Holoo still used after the switch
    db.execute("SELECT core.change_setting('book_of_record_from', '2026-05-01', 'owner', 'owner moved the start date')")
    assert ctl()["COEX-03"] == (1, 300)                                      # a native entry inside Holoo's time
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("SELECT core.change_setting('book_of_record_from', 'soon', 'owner', 'a reason long enough')")


def test_one_import_at_a_time_and_a_dead_import_is_closed(db, imp):
    _, batch = imp
    dead = batch(status="running")
    assert import_backup.claim(db) == 1
    assert db.execute("SELECT status FROM core.holoo_import_batch WHERE id = %s", (dead,)).fetchone()[0] == "failed"
    with psycopg.connect(DSN, autocommit=True) as other:
        with pytest.raises(RuntimeError, match="another"):
            import_backup.claim(other)
    db.execute("SELECT pg_advisory_unlock(hashtext('core.holoo_import'))")
    with psycopg.connect(DSN, autocommit=True) as other:
        assert import_backup.claim(other) == 0
