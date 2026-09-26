"""End-to-end import pipeline with audit, idempotency and gating."""
from __future__ import annotations

import datetime as _dt
import getpass
import json
import os

import duckdb

from . import READER_VERSION, checks, extract, profile, sqlserver, transform
from .acquire import acquire
from .registry import Registry


def ingest(inputs: list[str], workdir: str, cfg: sqlserver.ServerConfig | None = None, operator: str | None = None,
           force: bool = False) -> dict:
    cfg = cfg or sqlserver.ServerConfig()
    reg = Registry(os.path.join(workdir, "registry.duckdb"))
    staging = os.path.join(workdir, "staging")
    acq = acquire(inputs, staging)
    done = reg.completed_by_sha(acq.backup_sha256)
    if done and not force:
        run_id = reg.start(status="duplicate", duplicate_of=done[0], backup_sha256=acq.backup_sha256, backup_size=acq.backup_size,
                           inner_name=acq.inner_name, inputs=[vars(s) for s in acq.inputs], reader_version=READER_VERSION,
                           operator=operator or getpass.getuser(), finished_at=_dt.datetime.now(), silver_path=done[1])
        return {"run_id": run_id, "status": "duplicate", "duplicate_of": done[0], "silver_path": done[1]}

    run_id = reg.start(status="running", backup_sha256=acq.backup_sha256, backup_size=acq.backup_size, inner_name=acq.inner_name,
                       inputs=[vars(s) for s in acq.inputs], reader_version=READER_VERSION, operator=operator or getpass.getuser())
    try:
        out_dir = os.path.join(workdir, "imports", acq.backup_sha256)
        bronze = os.path.join(out_dir, "bronze")
        dbname, meta = sqlserver.restore(cfg, acq.backup_path, acq.backup_sha256)
        with sqlserver.connect(cfg, dbname) as conn:
            prof = profile.detect(conn, meta)
            if not prof["compatible"]:
                raise RuntimeError(f"unsupported Holoo profile; missing required columns: {prof['missing_required']}")
            ext = extract.extract_all(conn, bronze)
        reg.update(run_id, source_db=prof["source_db"], fiscal_year=prof["fiscal_year"], profile=prof, backup_meta=meta)
        silver = os.path.join(out_dir, "silver.duckdb")
        counts = transform.build_silver(bronze, silver, {
            "backup_sha256": acq.backup_sha256, "source_db": prof["source_db"], "fiscal_year": prof["fiscal_year"],
            "profile_fingerprint": prof["fingerprint"], "holoo_version": prof["holoo_version"], "reader_version": READER_VERSION,
            "run_id": run_id})
        con = transform.open_silver(silver)
        results = checks.run_all(con, {e["table"]: e["rows"] for e in ext})
        con.close()
        passed = checks.gate(results)
        prev = reg.previous_for(prof["source_db"], prof["fiscal_year"], acq.backup_sha256)
        changes = reg.diff(run_id, prev[0], prev[1], silver) if prev else None
        with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
            json.dump({"run_id": run_id, "backup_sha256": acq.backup_sha256, "profile": prof, "backup_meta": meta, "extract": ext,
                       "silver_counts": counts, "checks": results, "gate_passed": passed, "previous_run": prev[0] if prev else None,
                       "change_summary": changes}, f, ensure_ascii=False, indent=1, default=str)
        reg.update(run_id, status="completed", finished_at=_dt.datetime.now(), silver_path=silver, counts=counts, checks=results,
                   gate_passed=passed, previous_run=prev[0] if prev else None, change_summary=changes)
        return {"run_id": run_id, "status": "completed", "gate_passed": passed, "silver_path": silver, "profile": prof,
                "checks": results, "change_summary": changes}
    except Exception as e:  # recorded for audit, then re-raised
        reg.update(run_id, status="failed", finished_at=_dt.datetime.now(), error=repr(e))
        raise
