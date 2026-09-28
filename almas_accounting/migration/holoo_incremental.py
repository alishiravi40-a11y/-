"""What a NEWER Holoo backup changed, applied to the core without editing any legacy fact (core 028).

The Reader's publish step records, per run, exactly which Holoo rows were added, changed or removed (holoo_mirror.change_log,
by stable Holoo keys). From that list:
  * ledger vouchers — handled by holoo_ledger.migrate (reversal + re-posting of a changed or removed voucher);
  * stock lines — a changed / removed Holoo line (or a changed document, or a changed opening quantity) has its live legacy
    movement REVERSED and, if the line still exists, re-entered from the current Holoo row with the reference «base@run»;
  * cheques, cheque events and Moadian records of Holoo that were already migrated and then changed / removed in Holoo go to
    core.legacy_change_review: the cheque location chain and the tax status are facts a person must look at, so the importer
    neither overwrites them nor ignores them.
Added rows are migrated by the regular steps (holoo_cheques / holoo_inventory / holoo_tax), which are idempotent by key.
"""
from __future__ import annotations

import json

from migration.holoo_inventory import KIND, USER, openings


def _bases(conn, db: str, run: str) -> list[str]:
    return [r[0] for r in conn.execute("""
      WITH ch AS (SELECT table_name, entity_key FROM holoo_mirror.change_log
                  WHERE run_id = %(run)s AND source_db = %(db)s AND change IN ('changed', 'removed_in_source')
                    AND table_name IN ('document_line', 'document', 'item'))
      SELECT DISTINCT 'holoo:' || %(db)s || ':' || l.fac_type || ':' || l.fac_code || ':' || l.line_index
      FROM ch JOIN holoo_mirror.document_line l ON l.source_db = %(db)s AND l.fac_type = ch.entity_key ->> 'fac_type' AND l.fac_code = ch.entity_key ->> 'fac_code'
        AND (ch.table_name = 'document' OR (l.a_code = ch.entity_key ->> 'a_code' AND l.line_index::text = ch.entity_key ->> 'line_index'))
      WHERE ch.table_name IN ('document_line', 'document')
      UNION
      SELECT 'holoo:' || %(db)s || ':opening:' || (ch.entity_key ->> 'a_code') FROM ch WHERE ch.table_name = 'item'""", {"db": db, "run": run})]


def inventory(conn, db: str, run: str) -> dict:
    bases = _bases(conn, db, run)
    if not bases:
        return {"affected_lines": 0, "reversed": 0, "reentered": 0}
    with conn.transaction():
        rev = conn.execute("""
          INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, effective_time, qty, unit_price, extra_cost_per_unit, transfer_id,
                                           source, reverses_id, legacy, created_by)
          SELECT m.item_id, m.warehouse_id, m.kind, m.effective_date, m.effective_time, m.qty, m.unit_price, m.extra_cost_per_unit, m.transfer_id,
                 'holoo', m.id, true, %(u)s
          FROM core.stock_movement_live m WHERE m.legacy AND split_part(m.source_ref, '@', 1) = ANY (%(b)s)
            AND m.source_ref <> split_part(m.source_ref, '@', 1) || '@' || %(run)s          -- already re-entered by this run: re-running it is a no-op
          """, {"b": bases, "u": USER, "run": run}).rowcount
        y0 = conn.execute("SELECT min(doc_date) FROM holoo_mirror.voucher WHERE source_db = %s AND state = 'opening'", (db,)).fetchone()[0]
        # the same rule as the first import: re-entered, or re-checked against the previous year's closing (core 032)
        opening = openings(conn, db, y0, run, [b for b in bases if ":opening:" in b])["recorded"]
        lines = conn.execute("""
          INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, effective_time, qty, unit_price, extra_cost_per_unit, transfer_id,
                                           source, source_ref, legacy, created_by)
          SELECT m.item_id, m.warehouse_id, (%(kind)s::jsonb ->> d.fac_type), d.doc_date, coalesce(d.doc_time, '00:00')::time, l.qty,
                 CASE d.fac_type WHEN 'K' THEN l.unit_price WHEN 'Y' THEN l.unit_cost END,
                 CASE WHEN d.fac_type = 'K' AND coalesce(d.total_qty, 0) > 0 THEN coalesce(d.extra_cost, 0) / d.total_qty ELSE 0 END,
                 CASE WHEN d.fac_type IN ('D', 'S') THEN core.legacy_transfer_id(l.source_db, d.fac_code, l.line_index) END,
                 'holoo', 'holoo:' || l.source_db || ':' || d.fac_type || ':' || d.fac_code || ':' || l.line_index || '@' || %(run)s, true, %(u)s
          FROM holoo_mirror.document_line l JOIN holoo_mirror.document d USING (source_db, fac_type, fac_code)
          JOIN core.item_legacy_code m ON m.source_db = l.source_db AND m.legacy_code = l.a_code
          JOIN holoo_mirror.item i ON i.source_db = l.source_db AND i.a_code = l.a_code AND NOT i.is_service
          WHERE l.source_db = %(db)s AND l.removed_run IS NULL AND d.removed_run IS NULL AND d.fac_type IN ('K','F','Y','X','Z','D','S') AND l.qty > 0
            AND 'holoo:' || l.source_db || ':' || d.fac_type || ':' || d.fac_code || ':' || l.line_index = ANY (%(b)s)
          ON CONFLICT DO NOTHING""", {"db": db, "kind": json.dumps(KIND), "run": run, "b": bases, "u": USER}).rowcount
    return {"affected_lines": len(bases), "reversed": rev, "reentered": opening + lines}


def review_queue(conn, db: str, run: str, batch: int) -> dict:
    """Changed / removed Holoo cheques, cheque events and Moadian records that the core already holds → review items."""
    n = conn.execute("""
      INSERT INTO core.legacy_change_review (batch_id, source_db, run_id, entity, entity_key, change, detail)
      SELECT %(b)s, c.source_db, c.run_id, c.table_name, c.entity_key, c.change,
             CASE c.table_name WHEN 'cheque' THEN 'چک هلو پس از انتقال تغییر کرده یا حذف شده است'
                               WHEN 'cheque_event' THEN 'رویداد چک هلو پس از انتقال تغییر کرده یا حذف شده است؛ محل چک را بررسی کنید'
                               ELSE 'سابقه ارسال مؤدیان در هلو تغییر کرده یا حذف شده است' END
      FROM holoo_mirror.change_log c
      WHERE c.run_id = %(run)s AND c.source_db = %(db)s AND c.change IN ('changed', 'removed_in_source')
        AND ((c.table_name = 'cheque' AND EXISTS (SELECT 1 FROM core.cheque_legacy_code k WHERE k.source_db = %(db)s AND k.check_code::text = c.entity_key ->> 'check_code'))
          OR (c.table_name = 'cheque_event' AND EXISTS (SELECT 1 FROM core.cheque_event e WHERE e.legacy_source_db = %(db)s AND e.legacy_event_id::text = c.entity_key ->> 'event_id'))
          OR (c.table_name = 'tax_submission' AND EXISTS (SELECT 1 FROM core.tax_submission t WHERE t.legacy AND t.legacy_id::text = c.entity_key ->> 'id')))
      ON CONFLICT DO NOTHING""", {"b": batch, "run": run, "db": db}).rowcount
    return {"review_items": n}
