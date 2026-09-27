"""One reproducible audit run: every migration step and every parity test, in order, on one fresh database.

Input: a PostgreSQL database that holds `holoo_mirror` (published by the Reader) and the core schemas, and the restored
Holoo database on SQL Server (read-only). Output: one JSON document of AGGREGATES only (no names, codes or amounts of
a person), suitable as evidence in the repository. Each step reports what it checked and what it found; nothing here
changes Holoo data.

Usage: HOLOO_SQL_PASSWORD=... python -m migration.audit_run --pg DSN --source-db holoo1_1404 --sql-db holoo1_1404 --year 1404 --out FILE
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import time

import psycopg


def step(results: dict, name: str, fn):
    t = time.time()
    try:
        results[name] = {"result": fn(), "seconds": round(time.time() - t)}
    except Exception as e:                                           # recorded, and the run goes on with independent steps
        results[name] = {"error": repr(e)[:300], "seconds": round(time.time() - t)}
    print(name, json.dumps(results[name], ensure_ascii=False, default=str)[:300], flush=True)


def main():
    from migration import (holoo_cheques, holoo_inventory, holoo_ledger, receivables, report_parity, treasury_parity,
                           year_end_parity)
    ap = argparse.ArgumentParser()
    for a in ("--pg", "--source-db", "--sql-db", "--year", "--out"):
        ap.add_argument(a, required=True)
    a = ap.parse_args()
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "holoo_reader"))
    from holoo_reader import sqlserver
    r: dict = {"started_at": dt.datetime.now().isoformat(timespec="seconds"), "source_db": a.source_db, "fiscal_year": a.year}
    with psycopg.connect(a.pg, autocommit=True) as pg, sqlserver.connect(sqlserver.ServerConfig(), a.sql_db) as sql:
        ys, ye = None, None

        def ledger():
            out = holoo_ledger.migrate(pg, a.source_db, a.year)
            out.pop("parties", None)
            return out
        step(r, "01_ledger_migration", ledger)
        step(r, "02_ledger_rerun_is_noop", lambda: {k: v for k, v in holoo_ledger.migrate(pg, a.source_db, a.year).items() if k != "parties"})
        step(r, "03_ledger_parity_mirror", lambda: {k: v for k, v in holoo_ledger.parity(pg, a.source_db).items() if k != "examples"})
        ys, ye = pg.execute("SELECT starts_on, ends_on FROM core.fiscal_year WHERE code = %s", (a.year,)).fetchone()

        def cheques():
            out = holoo_cheques.migrate(pg, a.source_db)
            out["conflict_examples"] = len(out.get("conflict_examples", []))
            return out
        step(r, "04_cheque_migration", cheques)
        step(r, "05_cheque_voucher_parity", lambda: holoo_cheques.parity(pg, a.source_db))
        step(r, "06_treasury_and_guarantee_parity", lambda: {k: v for k, v in treasury_parity.run(pg, a.source_db).items() if k != "examples"})
        step(r, "07_receivables_allocation", lambda: receivables.allocate_all(pg))
        step(r, "08_receivables_rerun_is_noop", lambda: receivables.allocate_all(pg))
        step(r, "09_aging_equals_ledger", lambda: receivables.control(pg, a.year))
        step(r, "10_aging_summary", lambda: receivables.summary(pg, ye))
        step(r, "11_report_trial_balance", lambda: {k: v for k, v in report_parity.trial_balances(pg, sql, a.source_db, a.year).items() if k != "by_run"})
        step(r, "12_report_party_balance_function", lambda: report_parity.party_balances(pg, sql, a.source_db, a.year))
        step(r, "13_report_daily_ledgers", lambda: report_parity.daily_ledgers(pg, sql, a.source_db, a.year))
        step(r, "14_report_spMoienAshkhas", lambda: report_parity.moien_ashkhas_sample(pg, sql, a.source_db, a.year))
        step(r, "15_report_cheque_states", lambda: report_parity.cheque_states(pg, sql, a.source_db))
        step(r, "16_inventory_migration", lambda: holoo_inventory.migrate(pg, a.source_db))
        step(r, "17_inventory_parity", lambda: holoo_inventory.parity(pg, a.source_db, ye))
        step(r, "18_year_end_closing_parity", lambda: year_end_parity.run(pg, a.source_db, a.year))
    r["finished_at"] = dt.datetime.now().isoformat(timespec="seconds")
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False, indent=1, default=str)


if __name__ == "__main__":
    main()
