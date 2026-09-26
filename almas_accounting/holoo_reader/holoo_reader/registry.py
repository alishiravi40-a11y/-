"""Import registry: audit of every import run, idempotency by backup SHA-256, and source-change detection."""
from __future__ import annotations

import datetime as _dt
import json
import os
import uuid

import duckdb

DDL = """
CREATE TABLE IF NOT EXISTS import_run (
  run_id VARCHAR PRIMARY KEY, started_at TIMESTAMP, finished_at TIMESTAMP, status VARCHAR, duplicate_of VARCHAR,
  backup_sha256 VARCHAR, backup_size BIGINT, inner_name VARCHAR, inputs JSON, source_db VARCHAR, fiscal_year INTEGER,
  profile JSON, backup_meta JSON, reader_version VARCHAR, operator VARCHAR, silver_path VARCHAR, counts JSON,
  checks JSON, gate_passed BOOLEAN, previous_run VARCHAR, change_summary JSON, error VARCHAR);
CREATE TABLE IF NOT EXISTS source_change (
  run_id VARCHAR, previous_run VARCHAR, entity VARCHAR, entity_key VARCHAR, change VARCHAR, old_hash VARCHAR, new_hash VARCHAR);
"""

# entity → (table, key expression)
ENTITY_KEYS = {
    "account": ("account", "code"), "person": ("person", "c_code"), "item": ("item", "a_code"),
    "voucher": ("voucher", "CAST(sanad_code AS VARCHAR)"), "voucher_line": ("voucher_line", "sanad_code || ':' || line_index"),
    "document": ("document", "fac_type || ':' || fac_code"), "document_line": ("document_line", "fac_type || ':' || fac_code || ':' || a_code || ':' || line_index"),
    "cheque": ("cheque", "CAST(check_code AS VARCHAR)"), "cheque_event": ("cheque_event", "CAST(event_id AS VARCHAR)"),
    "audit_event": ("audit_event", "CAST(id AS VARCHAR)"), "tax_submission": ("tax_submission", "CAST(id AS VARCHAR)"),
}


class Registry:
    def __init__(self, path: str):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.con = duckdb.connect(path)
        self.con.execute(DDL)

    def completed_by_sha(self, sha: str):
        return self.con.execute("SELECT run_id, silver_path FROM import_run WHERE backup_sha256 = ? AND status = 'completed' ORDER BY started_at LIMIT 1", [sha]).fetchone()

    def previous_for(self, source_db: str, fiscal_year: int, exclude_sha: str):
        return self.con.execute("""SELECT run_id, silver_path FROM import_run WHERE source_db = ? AND fiscal_year = ? AND status = 'completed'
                                   AND backup_sha256 <> ? ORDER BY finished_at DESC LIMIT 1""", [source_db, fiscal_year, exclude_sha]).fetchone()

    def start(self, **kw) -> str:
        run_id = kw.pop("run_id", None) or uuid.uuid4().hex
        kw.setdefault("started_at", _dt.datetime.now())
        cols = ["run_id"] + list(kw)
        vals = [run_id] + [json.dumps(v, ensure_ascii=False, default=str) if isinstance(v, (dict, list)) else v for v in kw.values()]
        self.con.execute(f"INSERT INTO import_run ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", vals)
        return run_id

    def update(self, run_id: str, **kw):
        sets = ", ".join(f"{k} = ?" for k in kw)
        vals = [json.dumps(v, ensure_ascii=False, default=str) if isinstance(v, (dict, list)) else v for v in kw.values()]
        self.con.execute(f"UPDATE import_run SET {sets} WHERE run_id = ?", vals + [run_id])

    def diff(self, run_id: str, prev_run: str, prev_silver: str, new_silver: str) -> dict:
        """Row-hash comparison per entity; stores one source_change row per added/changed/removed key."""
        summary = {}
        self.con.execute(f"ATTACH '{prev_silver}' AS prev (READ_ONLY)")
        self.con.execute(f"ATTACH '{new_silver}' AS cur (READ_ONLY)")
        try:
            for ent, (tbl, key) in ENTITY_KEYS.items():
                q = f"""
                  WITH o AS (SELECT {key} k, source_row_hash h FROM prev.{tbl}), n AS (SELECT {key} k, source_row_hash h FROM cur.{tbl})
                  SELECT coalesce(n.k, o.k), CASE WHEN o.k IS NULL THEN 'added' WHEN n.k IS NULL THEN 'removed_in_source' ELSE 'changed' END, o.h, n.h
                  FROM o FULL JOIN n ON n.k = o.k WHERE o.k IS NULL OR n.k IS NULL OR o.h <> n.h"""
                rows = self.con.execute(q).fetchall()
                if rows:
                    self.con.executemany("INSERT INTO source_change VALUES (?, ?, ?, ?, ?, ?, ?)",
                                         [[run_id, prev_run, ent, k, c, oh, nh] for k, c, oh, nh in rows])
                summary[ent] = {c: sum(1 for r in rows if r[1] == c) for c in ("added", "changed", "removed_in_source")}
        finally:
            self.con.execute("DETACH prev")
            self.con.execute("DETACH cur")
        return summary
