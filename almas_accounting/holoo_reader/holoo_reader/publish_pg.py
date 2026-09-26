"""Publish a Silver canonical import into PostgreSQL schema `holoo_mirror` — idempotent, versioned, auditable.

For every canonical table:
  * key = (source_db, natural key); lineage columns first_run / last_run / removed_run; source_row_hash
  * new rows → inserted; changed rows (hash differs) → updated + change_log('changed');
    rows missing from the new import of the same source_db → removed_run set + change_log('removed_in_source') (never deleted)
  * re-publishing the same import → no data change (only last_run bookkeeping)
"""
from __future__ import annotations

import json
import os

import duckdb
import psycopg

KEYS = {
    "meta": ["key"], "account": ["code"], "warehouse": ["code"], "item": ["a_code"], "person": ["c_code"],
    "voucher": ["sanad_code"], "voucher_line": ["sanad_code", "line_index"], "document": ["fac_type", "fac_code"],
    "document_line": ["fac_type", "fac_code", "a_code", "line_index"], "voucher_link": ["source_row_hash"],
    "cashbox": ["id"], "bank_account": ["id"], "bank": ["code"], "cheque": ["check_code"], "cheque_event": ["event_id"],
    "tax_submission": ["id"], "audit_event": ["id"], "app_user": ["code"], "opening_version": ["version"],
    "opening_version_line": ["version", "line_index", "source_row_hash"], "audit_snapshot": ["process_id", "row_no"],
    "web_payload": ["process_id"], "web_payload_line": ["process_id", "line_no"],
}
PG_TYPE = {"VARCHAR": "text", "INTEGER": "integer", "BIGINT": "bigint", "DOUBLE": "double precision", "BOOLEAN": "boolean",
           "DATE": "date", "TIMESTAMP": "timestamp", "SMALLINT": "smallint", "JSON": "jsonb"}

DDL = """
CREATE SCHEMA IF NOT EXISTS holoo_mirror;
CREATE TABLE IF NOT EXISTS holoo_mirror.import_run (
  run_id text PRIMARY KEY, backup_sha256 text NOT NULL, source_db text NOT NULL, fiscal_year integer, holoo_version text,
  reader_version text, published_at timestamptz DEFAULT now(), counts jsonb, change_summary jsonb);
CREATE TABLE IF NOT EXISTS holoo_mirror.change_log (
  run_id text NOT NULL, source_db text NOT NULL, table_name text NOT NULL, entity_key jsonb NOT NULL, change text NOT NULL,
  old_hash text, new_hash text, logged_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS change_log_run ON holoo_mirror.change_log (run_id, table_name);
"""


def _columns(silver, table):
    return [(r[0], r[1]) for r in silver.execute(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position", [table]).fetchall()]


def _pg_type(t: str) -> str:
    return PG_TYPE.get(t.split("(")[0].upper(), "text")


def ensure_table(pg, table, cols):
    keys = KEYS[table]
    coldefs = ", ".join(f'"{c}" {_pg_type(t)}' for c, t in cols if c != "source_row_hash")
    pk = ", ".join(["source_db"] + [f'"{k}"' for k in keys])
    pg.execute(f"""CREATE TABLE IF NOT EXISTS holoo_mirror."{table}" (source_db text NOT NULL, fiscal_year integer, {coldefs},
                  source_row_hash text, first_run text, last_run text, removed_run text, PRIMARY KEY ({pk}))""")


def publish(silver_path: str, pg_dsn: str) -> dict:
    silver = duckdb.connect(silver_path, read_only=True)
    meta = dict(silver.execute("SELECT key, value FROM meta").fetchall())
    run_id, source_db, fy = meta["run_id"], meta["source_db"], int(meta["fiscal_year"])
    summary, counts = {}, {}
    with psycopg.connect(pg_dsn) as pg:
        pg.execute(DDL)
        for table, keys in KEYS.items():
            cols = _columns(silver, table)
            if not cols:
                continue
            ensure_table(pg, table, cols)
            names = [c for c, _ in cols]
            q = ", ".join(f'"{c}"' for c in names)
            pg.execute(f'CREATE TEMP TABLE stg (LIKE holoo_mirror."{table}" INCLUDING DEFAULTS) ON COMMIT DROP')
            src_cols = [f"CAST({c} AS VARCHAR)" if t == "JSON" else c for c, t in cols]
            cur = silver.execute(f"SELECT {', '.join(src_cols)} FROM {table}")
            n = 0
            with pg.cursor().copy(f'COPY stg (source_db, fiscal_year, {q}) FROM STDIN') as cp:
                while True:
                    batch = cur.fetchmany(20000)
                    if not batch:
                        break
                    for r in batch:
                        cp.write_row((source_db, fy) + tuple(r))
                    n += len(batch)
            counts[table] = n
            kq = ", ".join(f'"{k}"' for k in keys)
            on = " AND ".join([f"t.source_db = s.source_db"] + [f't."{k}" = s."{k}"' for k in keys])  # keys are NOT NULL (checked below)
            nulls = pg.execute(f"SELECT COUNT(*) FROM stg WHERE " + " OR ".join(f'"{k}" IS NULL' for k in keys)).fetchone()[0]
            if nulls:
                raise ValueError(f"{table}: {nulls} staged rows have NULL key columns {keys}")
            pg.execute(f"CREATE INDEX ON stg (source_db, {', '.join(chr(34) + k + chr(34) for k in keys)})")
            pg.execute("ANALYZE stg")
            keyjson = "jsonb_build_object(" + ", ".join(f"'{k}', s.\"{k}\"" for k in keys) + ")"
            keyjson_t = keyjson.replace("s.", "t.")
            # change log before applying
            pg.execute(f"""INSERT INTO holoo_mirror.change_log (run_id, source_db, table_name, entity_key, change, old_hash, new_hash)
                SELECT %s, s.source_db, %s, {keyjson}, CASE WHEN t.source_db IS NULL THEN 'added' ELSE 'changed' END, t.source_row_hash, s.source_row_hash
                FROM stg s LEFT JOIN holoo_mirror."{table}" t ON {on}
                WHERE (t.source_db IS NULL OR t.source_row_hash IS DISTINCT FROM s.source_row_hash OR t.removed_run IS NOT NULL)
                  AND EXISTS (SELECT 1 FROM holoo_mirror."{table}" x WHERE x.source_db = s.source_db LIMIT 1)""", (run_id, table))
            pg.execute(f"""INSERT INTO holoo_mirror.change_log (run_id, source_db, table_name, entity_key, change, old_hash, new_hash)
                SELECT %s, t.source_db, %s, {keyjson_t}, 'removed_in_source', t.source_row_hash, NULL
                FROM holoo_mirror."{table}" t WHERE t.source_db = %s AND t.removed_run IS NULL
                  AND NOT EXISTS (SELECT 1 FROM stg s WHERE {on})""", (run_id, table, source_db))
            upd = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in names if c not in keys) + ", fiscal_year = EXCLUDED.fiscal_year"
            pg.execute(f"""INSERT INTO holoo_mirror."{table}" (source_db, fiscal_year, {q}, first_run, last_run)
                SELECT source_db, fiscal_year, {q}, %s, %s FROM stg
                ON CONFLICT (source_db, {kq}) DO UPDATE SET {upd}, last_run = EXCLUDED.last_run, removed_run = NULL
                WHERE holoo_mirror."{table}".source_row_hash IS DISTINCT FROM EXCLUDED.source_row_hash
                   OR holoo_mirror."{table}".removed_run IS NOT NULL""", (run_id, run_id))
            pg.execute(f"""UPDATE holoo_mirror."{table}" t SET last_run = %s FROM stg s WHERE {on} AND t.last_run IS DISTINCT FROM %s""", (run_id, run_id))
            pg.execute(f"""UPDATE holoo_mirror."{table}" t SET removed_run = %s WHERE t.source_db = %s AND t.removed_run IS NULL
                AND NOT EXISTS (SELECT 1 FROM stg s WHERE {on})""", (run_id, source_db))
            pg.execute("DROP TABLE stg")
            summary[table] = dict(pg.execute("""SELECT change, COUNT(*) FROM holoo_mirror.change_log WHERE run_id = %s AND table_name = %s
                                                GROUP BY change""", (run_id, table)).fetchall())
        pg.execute("""INSERT INTO holoo_mirror.import_run (run_id, backup_sha256, source_db, fiscal_year, holoo_version, reader_version, counts, change_summary)
                      VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (run_id) DO UPDATE SET published_at = now(), counts = EXCLUDED.counts,
                      change_summary = EXCLUDED.change_summary""",
                   (run_id, meta["backup_sha256"], source_db, fy, meta.get("holoo_version"), meta.get("reader_version"),
                    json.dumps(counts), json.dumps(summary)))
    silver.close()
    return {"run_id": run_id, "source_db": source_db, "counts": counts, "changes": {k: v for k, v in summary.items() if v}}
