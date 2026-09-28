"""One Holoo backup → the core, as one recorded batch (core 028): the coexistence path while Holoo is still in use.

  Backup → Reader (restore read-only, extract, decode, checks + gate) → staging (holoo_mirror, publish with change_log)
  → change detection (added / changed / removed / unchanged per table) → mapping + import (ledger, stock, cheques, tax,
  derived allocation) → reconciliation (core = Holoo) → batch status.

Rules
  * a backup whose reader gate fails is refused: nothing is published;
  * a backup OLDER than the last imported backup of the same Holoo database is refused (publishing it would record the
    newer rows as «changed» and roll the books back); `allow_older=True` is an explicit, recorded override;
  * the same backup again is harmless: the reader reports it as a duplicate, publishing records no change, every
    migration step is idempotent by Holoo key, and the reconciliation runs again;
  * legacy facts are never edited: changed / removed vouchers and stock lines are reversed and re-entered; changed cheque
    events and Moadian records go to core.legacy_change_review;
  * every step, count and check is kept on core.holoo_import_batch (lineage of the import itself).
Usage: python -m migration.import_backup --pg DSN --fiscal-year 1404 --workdir DIR [--allow-older] [--holoo-views] BACKUP_FILES...
"""
from __future__ import annotations

import argparse
import datetime as dt
import getpass
import json
import os
import pathlib
import sys
import time

import psycopg

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "holoo_reader"))
sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from migration import holoo_cheques, holoo_incremental, holoo_inventory, holoo_ledger, holoo_tax, receivables  # noqa: E402


def _j(x) -> str:
    return json.dumps(x, ensure_ascii=False, default=str)


def _set(pg, batch: int, **kw):
    cols = ", ".join(f"{k} = %s" for k in kw)
    vals = [(_j(v) if isinstance(v, (dict, list)) else v) for v in kw.values()]
    pg.execute(f"UPDATE core.holoo_import_batch SET {cols} WHERE id = %s", (*vals, batch))


def backup_finished_at(report: dict):
    h = (report.get("backup_meta") or {}).get("header") or [{}]
    v = h[0].get("BackupFinishDate")
    return dt.datetime.fromisoformat(v).replace(tzinfo=dt.timezone.utc) if v else None


def order_guard(pg, source_db: str, sha: str, finished) -> str | None:
    """None if this backup may be imported; otherwise the reason it is older than what the core already holds."""
    if finished is None:
        return None
    last = pg.execute("""SELECT backup_finished_at, backup_sha256 FROM core.holoo_import_batch
                         WHERE source_db = %s AND status IN ('reconciled', 'differences') AND backup_sha256 <> %s AND backup_finished_at IS NOT NULL
                         ORDER BY backup_finished_at DESC LIMIT 1""", (source_db, sha)).fetchone()
    if last and finished < last[0]:
        return f"backup finished {finished:%Y-%m-%d %H:%M} is older than the imported backup {last[1][:12]} ({last[0]:%Y-%m-%d %H:%M})"
    return None


def change_summary(pg, run: str, source_db: str) -> dict:
    """Per table: rows added / changed / removed in this run, and unchanged (live rows the run did not touch)."""
    tables = [r[0] for r in pg.execute("SELECT DISTINCT table_name FROM holoo_mirror.change_log WHERE source_db = %s", (source_db,))]
    tables = sorted(set(tables) | {r[0] for r in pg.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'holoo_mirror' AND table_name NOT IN ('import_run', 'change_log')")})
    # the first import of a Holoo database has nothing to compare with: every row it brings is new
    first = not pg.execute("SELECT 1 FROM holoo_mirror.import_run WHERE source_db = %s AND run_id <> %s LIMIT 1", (source_db, run)).fetchone()
    out, tot = {}, {"added": 0, "changed": 0, "removed_in_source": 0, "unchanged": 0}
    for t in tables:
        ch = dict(pg.execute("SELECT change, count(*) FROM holoo_mirror.change_log WHERE run_id = %s AND source_db = %s AND table_name = %s GROUP BY 1",
                             (run, source_db, t)).fetchall())
        has_sdb = pg.execute("SELECT 1 FROM information_schema.columns WHERE table_schema = 'holoo_mirror' AND table_name = %s AND column_name = 'removed_run'",
                             (t,)).fetchone()
        if not has_sdb:
            continue
        live = pg.execute(f'SELECT count(*) FROM holoo_mirror."{t}" WHERE source_db = %s AND removed_run IS NULL', (source_db,)).fetchone()[0]
        row = {"added": ch.get("added", 0), "changed": ch.get("changed", 0), "removed_in_source": ch.get("removed_in_source", 0)}
        row["unchanged"] = live - row["added"] - row["changed"]
        if first:
            row["added"], row["unchanged"] = live, 0
        out[t] = row
        for k in tot:
            tot[k] += row[k]
    return {"tables": out, "totals": tot, "first_import": first}


def reconcile(pg, source_db: str, fiscal_year: str) -> dict:
    """core = Holoo after the import. Each check: status pass / fail and the numbers behind it."""
    r = {}
    led = holoo_ledger.parity(pg, source_db)
    r["ledger_balances"] = {"status": led["status"], "compared": led["compared"], "mismatches": led["mismatches"],
                            "holoo_totals": led["holoo_totals"], "core_totals": led["core_totals"]}
    v = pg.execute("""SELECT (SELECT count(*) FROM holoo_mirror.voucher WHERE source_db = %(db)s AND removed_run IS NULL),
                             (SELECT count(*) FROM core.legacy_entry_map WHERE source_db = %(db)s AND status IN ('current', 'skipped_no_visible_lines')),
                             (SELECT count(*) FROM (SELECT sanad_code FROM core.legacy_entry_map WHERE source_db = %(db)s
                                                    AND status IN ('current', 'skipped_no_visible_lines') GROUP BY 1 HAVING count(*) > 1) d),
                             (SELECT count(*) FROM core.legacy_entry_map m JOIN core.journal_entry e ON e.id = m.entry_id
                              WHERE m.source_db = %(db)s AND m.status IN ('superseded', 'removed_in_source')
                                AND NOT EXISTS (SELECT 1 FROM core.journal_entry x WHERE x.reverses_id = e.id AND x.status = 'posted'))""",
                   {"db": source_db}).fetchone()
    r["vouchers"] = {"status": "pass" if v[0] == v[1] and v[2] == 0 and v[3] == 0 else "fail", "holoo_vouchers": v[0], "core_current": v[1],
                     "mapped_twice": v[2], "superseded_not_reversed": v[3]}
    ye = pg.execute("SELECT ends_on FROM core.fiscal_year WHERE code = %s", (fiscal_year,)).fetchone()[0]
    inv = holoo_inventory.parity(pg, source_db, str(ye))
    dup = pg.execute("""SELECT count(*) FROM (SELECT split_part(source_ref, '@', 1) FROM core.stock_movement_live
                        WHERE legacy AND source_ref LIKE %s GROUP BY 1 HAVING count(*) > 1) d""", (f"holoo:{source_db}:%",)).fetchone()[0]
    ok = inv.get("stock_qty_equal", 0) == inv.get("item_codes", 0) and dup == 0
    r["inventory"] = {"status": "pass" if ok else "fail", "item_codes": inv.get("item_codes", 0), "stock_qty_equal": inv.get("stock_qty_equal", 0),
                      "avg_cost_equal": inv.get("avg_cost_equal", 0), "item_codes_in_stock": inv.get("item_codes_in_stock", 0),
                      "valuation_difference": inv["valuation_difference"], "lines_counted_twice": dup}
    c = pg.execute("""SELECT (SELECT count(*) FROM holoo_mirror.cheque WHERE source_db = %(db)s AND removed_run IS NULL),
                             (SELECT count(*) FROM core.cheque WHERE legacy_source_db = %(db)s),
                             (SELECT count(*) FROM core.cheque k WHERE k.legacy_source_db = %(db)s AND NOT EXISTS (
                                SELECT 1 FROM holoo_mirror.cheque h WHERE h.source_db = %(db)s AND h.check_code = k.holoo_check_code AND h.removed_run IS NULL))""",
                   {"db": source_db}).fetchone()
    chp = holoo_cheques.parity(pg, source_db)
    r["cheques"] = {"status": "pass" if c[0] == c[1] and c[2] == 0 else "fail", "holoo_cheques": c[0], "core_cheques": c[1],
                    "core_cheques_removed_in_holoo": c[2], "voucher_rule_parity": f"{chp['identical']}/{chp['vouchers']}"}
    t = pg.execute("""SELECT (SELECT count(*) FROM holoo_mirror.tax_submission WHERE source_db = %(db)s AND removed_run IS NULL),
                             (SELECT count(*) FROM core.tax_submission s WHERE s.legacy AND EXISTS (SELECT 1 FROM holoo_mirror.tax_submission h
                                WHERE h.source_db = %(db)s AND h.id = s.legacy_id AND h.removed_run IS NULL))""", {"db": source_db}).fetchone()
    r["tax_submissions"] = {"status": "pass" if t[0] == t[1] else "fail", "holoo": t[0], "core": t[1]}
    p = pg.execute("""SELECT count(*) FROM holoo_mirror.person p WHERE p.source_db = %(db)s AND p.removed_run IS NULL AND NOT EXISTS (
                        SELECT 1 FROM core.party_legacy_code l WHERE l.source_system = 'holoo' AND l.source_db = p.source_db AND l.legacy_code = p.c_code)""",
                   {"db": source_db}).fetchone()[0]
    r["parties"] = {"status": "pass" if p == 0 else "fail", "holoo_persons_unmapped": p}
    rc = receivables.control(pg, fiscal_year)
    r["receivables_aging"] = {"status": "pass" if rc["sub_ledgers_with_difference"] == 0 else "fail", **rc}
    return r


def holoo_view_parity(pg, source_db: str, sql_db: str, cfg=None) -> dict:
    """Core balances vs Holoo's OWN view MandehOfSarfasl in the restored backup, per code at kol / moein / tafsili."""
    from holoo_reader import sqlserver
    with sqlserver.connect(cfg or sqlserver.ServerConfig(), sql_db) as sql:
        _, rows = sqlserver.query(sql, "SELECT RTRIM(HLPSarfasl), Mand FROM MandehOfSarfasl")
    holoo = {k: float(v or 0) for k, v in rows}
    per_code = pg.execute("""
      WITH cb AS (SELECT jl.account_id, jl.party_id, sum(jl.debit - jl.credit) b FROM core.legacy_entry_map m
                  JOIN core.journal_line jl ON jl.entry_id = m.entry_id WHERE m.source_db = %(db)s AND m.status = 'current' GROUP BY 1, 2)
      SELECT m.legacy_code, coalesce(cb.b, 0) FROM core.legacy_account_map m JOIN cb ON cb.account_id = m.account_id AND cb.party_id IS NOT DISTINCT FROM m.party_id
      WHERE m.source_db = %(db)s""", {"db": source_db}).fetchall()
    ours: dict[str, float] = {}
    for code, b in per_code:
        for k in {code[:3], code[:7] if len(code) >= 7 else None, code if len(code) == 11 else None} - {None}:
            ours[k] = ours.get(k, 0.0) + float(b)
    bad = [k for k in set(holoo) | set(ours) if abs(holoo.get(k, 0.0) - ours.get(k, 0.0)) > 0.5]
    return {"status": "pass" if not bad else "fail", "compared": len(set(holoo) | set(ours)), "mismatches": len(bad)}


def migrate_run(pg, source_db: str, fiscal_year: str, run: str, batch: int) -> dict:
    """Mapping + import of one published run. Each step is idempotent; the order matters (ledger first: it maps parties and the chart)."""
    steps = {}

    def step(name, fn):
        t = time.time()
        steps[name] = fn()
        if isinstance(steps[name], dict):
            steps[name] = {k: v for k, v in steps[name].items() if k != "conflict_examples"}
        steps[name + "_seconds"] = round(time.time() - t, 1)
        _set(pg, batch, migration=steps)

    step("ledger", lambda: holoo_ledger.migrate(pg, source_db, fiscal_year, run))
    step("inventory_new", lambda: holoo_inventory.migrate(pg, source_db))
    step("inventory_changed", lambda: holoo_incremental.inventory(pg, source_db, run))
    step("cheques", lambda: holoo_cheques.migrate(pg, source_db))
    step("tax", lambda: holoo_tax.migrate(pg, source_db))
    step("allocation", lambda: receivables.allocate_all(pg))
    step("review_queue", lambda: holoo_incremental.review_queue(pg, source_db, run, batch))
    return steps


def claim(pg) -> int:
    """One import at a time (session lock). Holding it, any batch still «running» belongs to a process that died: it is closed
    as failed (its steps are idempotent, so the next import repeats them). Returns how many were closed."""
    if not pg.execute("SELECT pg_try_advisory_lock(hashtext('core.holoo_import'))").fetchone()[0]:
        raise RuntimeError("another Holoo import is running")
    return pg.execute("""UPDATE core.holoo_import_batch SET status = 'failed', finished_at = now(),
                         error = 'interrupted: the import process stopped before finishing (a later import repeats its steps)'
                         WHERE status = 'running'""").rowcount


def finish(pg, batch: int, recon: dict) -> str:
    status = "reconciled" if all(v.get("status") == "pass" for v in recon.values()) else "differences"
    _set(pg, batch, reconciliation=recon, status=status, finished_at=dt.datetime.now(dt.timezone.utc))
    return status


def run(files: list[str], workdir: str, pg_dsn: str, fiscal_year: str, operator: str | None = None, allow_older: bool = False,
        holoo_views: bool = False, force_read: bool = False, cfg=None) -> dict:
    from holoo_reader import pipeline, publish_pg
    operator = operator or getpass.getuser()
    with psycopg.connect(pg_dsn, autocommit=True) as pg:
        pg.execute("SET application_name = 'holoo-import'")
        claim(pg)
        batch = pg.execute("INSERT INTO core.holoo_import_batch (triggered_by, input_files, fiscal_year) VALUES (%s, %s, %s) RETURNING id",
                           (operator, [os.path.basename(f) for f in files], fiscal_year)).fetchone()[0]
        try:
            res = pipeline.ingest(files, workdir, cfg, operator, force_read)
            report = json.load(open(os.path.join(os.path.dirname(res["silver_path"]), "report.json"), encoding="utf-8"))
            src, sha = report["profile"]["source_db"], report["backup_sha256"]
            finished = backup_finished_at(report)
            _set(pg, batch, reader_status=res["status"], reader_run_id=report["run_id"], backup_sha256=sha, source_db=src,
                 backup_finished_at=finished, reader_checks={"gate_passed": report["gate_passed"], "checks": report["checks"]})
            if str(report["profile"].get("fiscal_year")) != str(fiscal_year):
                raise ValueError(f"backup is fiscal year {report['profile'].get('fiscal_year')}, not {fiscal_year}")
            if not report["gate_passed"]:
                _set(pg, batch, status="refused", error="reader gate failed: the backup was not published", finished_at=dt.datetime.now(dt.timezone.utc))
                return {"batch": batch, "status": "refused", "reason": "reader gate failed"}
            why = order_guard(pg, src, sha, finished)
            if why and not allow_older:
                _set(pg, batch, status="refused", error=why, finished_at=dt.datetime.now(dt.timezone.utc))
                return {"batch": batch, "status": "refused", "reason": why}
            pub = publish_pg.publish(res["silver_path"], pg_dsn)
            run_id = pub["run_id"]
            # fresh statistics after publishing: without them the planner can pick nested loops over the mirror (minutes → hours)
            for (t,) in pg.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'holoo_mirror' AND table_type = 'BASE TABLE'").fetchall():
                pg.execute(f'ANALYZE holoo_mirror."{t}"')
            _set(pg, batch, change_summary={**change_summary(pg, run_id, src), "added_columns": pub["added_columns"],
                                            **({"older_backup_allowed": why} if why else {})})
            migrate_run(pg, src, fiscal_year, run_id, batch)
            recon = reconcile(pg, src, fiscal_year)
            if holoo_views:
                recon["holoo_view_MandehOfSarfasl"] = holoo_view_parity(pg, src, f"holoo_{sha[:12]}", cfg)
            status = finish(pg, batch, recon)
            return {"batch": batch, "status": status, "run_id": run_id, "source_db": src, "reconciliation": recon}
        except Exception as e:
            _set(pg, batch, status="failed", error=repr(e)[:2000], finished_at=dt.datetime.now(dt.timezone.utc))
            raise


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pg", required=True); ap.add_argument("--fiscal-year", required=True); ap.add_argument("--workdir", required=True)
    ap.add_argument("--allow-older", action="store_true"); ap.add_argument("--holoo-views", action="store_true")
    ap.add_argument("--operator"); ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    out = run(a.files, a.workdir, a.pg, a.fiscal_year, a.operator, a.allow_older, a.holoo_views)
    print(_j({k: v for k, v in out.items()}))


if __name__ == "__main__":
    main()
