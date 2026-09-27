"""Holoo Moadian history (TaxLog) → core.tax_submission (core 014), with parity against FACTURE.StateTax (E09).

Mapping — only what is proven: SendType 1 → original, 3 → cancellation (E01.9); 2, 4, 5, 6 → legacy_unknown (raw value
kept). State 2 → accepted, 1 → pending, 0 → failed (Holoo: «not sent / failed»). Every row keeps its Holoo id, type and
state. Idempotent by (document, legacy id).
Parity: the latest attempt of each invoice must give the same status as the invoice's own StateTax.
"""
from __future__ import annotations

import collections
import json

SUBJECT = {1: "original", 3: "cancellation"}
STATUS = {2: "accepted", 1: "pending", 0: "failed"}


def migrate(conn, db: str) -> dict:
    n = conn.execute("""
        INSERT INTO core.tax_submission (document_source, document_ref, subject, status, tax_id, serial, sent_at,
                                         legacy_send_type, legacy_state, legacy_id, legacy, created_by)
        SELECT 'holoo:' || source_db || ':' || fac_type, fac_code,
               coalesce(%(subj)s::jsonb ->> send_type::text, 'legacy_unknown'), coalesce(%(stat)s::jsonb ->> state::text, 'failed'),
               NULLIF(tax_id, ''), serial, sent_at, send_type, state, id, true, 'holoo-migration'
        FROM holoo_mirror.tax_submission WHERE source_db = %(db)s AND removed_run IS NULL
        ON CONFLICT DO NOTHING""", {"db": db, "subj": json.dumps(SUBJECT), "stat": json.dumps(STATUS)}).rowcount
    return {"submissions": n}


def parity(conn, db: str) -> dict:
    rows = conn.execute("""
        SELECT d.fac_type, d.tax_state, t.last_status FROM holoo_mirror.document d
        LEFT JOIN core.tax_document_status t ON t.document_source = 'holoo:' || d.source_db || ':' || d.fac_type AND t.document_ref = d.fac_code
        WHERE d.source_db = %s AND d.removed_run IS NULL AND (d.tax_state IS NOT NULL OR t.last_status IS NOT NULL)""", (db,)).fetchall()
    out = collections.Counter()
    for fac_type, state, last in rows:
        expected = STATUS.get(state) if state is not None else None
        key = "same" if expected == last else f"holoo_state={state} core_last={last}"
        out[(fac_type, key)] += 1
    controls = {r[0]: int(r[2]) for r in conn.execute("SELECT * FROM core.tax_controls(current_date)")}
    return {"by_type": {f"{t}:{k}": n for (t, k), n in sorted(out.items())}, "controls": controls}


if __name__ == "__main__":
    import argparse
    import psycopg
    ap = argparse.ArgumentParser(); ap.add_argument("--pg", required=True); ap.add_argument("--source-db", required=True)
    a = ap.parse_args()
    with psycopg.connect(a.pg, autocommit=True) as c:
        print(json.dumps({"migrate": migrate(c, a.source_db), "rerun": migrate(c, a.source_db), "parity": parity(c, a.source_db)}, indent=1))
