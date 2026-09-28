"""Holoo inventory → core stock movements (core 012), with parity against Holoo (E23).

Models (core.item) come from the normalized item name across warehouse codes (D-13, owner-approved); every Holoo item code
is mapped to model × warehouse (core.item_legacy_code). Services (01…) carry no stock and are not migrated as stock.
Movements: opening (first_qty at first_unit_cost, at the start of the year), and every document line by Holoo type
(K, F, Y, X, Z, D, S — Q moves nothing), at the document's date and time (Reader v0.4), purchases with the invoice's extra
costs per unit, sales returns at the cost on the return line, transfers paired by (document, line). All are flagged
legacy (Holoo allowed negative stock). Idempotent by source_ref.
"""
from __future__ import annotations

import collections
import json

KIND = {"K": "purchase", "F": "sale", "Y": "sale_return", "X": "purchase_return", "Z": "waste", "D": "transfer_in", "S": "transfer_out"}
USER = "holoo-migration"


def migrate(conn, db: str) -> dict:
    st = collections.Counter()
    with conn.transaction():
        st["warehouses"] = conn.execute("""INSERT INTO core.warehouse (code, name, holoo_group_code)
            SELECT 'W' || code, name, code FROM holoo_mirror.warehouse WHERE source_db = %s AND removed_run IS NULL
            ON CONFLICT (code) DO NOTHING""", (db,)).rowcount
        st["models"] = conn.execute("""INSERT INTO core.item (code, name, model_key, is_service)
            SELECT DISTINCT ON (name_key) 'M' || min(a_code) OVER (PARTITION BY name_key), name, name_key, bool_or(is_service) OVER (PARTITION BY name_key)
            FROM holoo_mirror.item WHERE source_db = %s AND removed_run IS NULL ORDER BY name_key, a_code
            ON CONFLICT DO NOTHING""", (db,)).rowcount
        st["item_codes"] = conn.execute("""INSERT INTO core.item_legacy_code (source_db, legacy_code, legacy_name, item_id, warehouse_id)
            SELECT i.source_db, i.a_code, i.name, ci.id, w.id FROM holoo_mirror.item i JOIN core.item ci ON ci.model_key = i.name_key
            LEFT JOIN core.warehouse w ON w.holoo_group_code = i.warehouse_code
            WHERE i.source_db = %s AND i.removed_run IS NULL ON CONFLICT DO NOTHING""", (db,)).rowcount
        y0 = conn.execute("""SELECT min(doc_date) FROM holoo_mirror.voucher WHERE source_db = %s AND state = 'opening'""", (db,)).fetchone()[0]
        st["openings"] = conn.execute("""INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, qty, unit_price, source, source_ref, legacy, created_by)
            SELECT m.item_id, m.warehouse_id, 'opening', %(y0)s, i.first_qty, coalesce(i.first_unit_cost, 0), 'holoo', 'holoo:' || i.source_db || ':opening:' || i.a_code, true, %(u)s
            FROM holoo_mirror.item i JOIN core.item_legacy_code m ON m.source_db = i.source_db AND m.legacy_code = i.a_code
            WHERE i.source_db = %(db)s AND i.removed_run IS NULL AND NOT i.is_service AND coalesce(i.first_qty, 0) <> 0
            ON CONFLICT DO NOTHING""", {"db": db, "y0": y0, "u": USER}).rowcount
        # transfer pairs: one id per (document, line) shared by its S and D lines
        st["movements"] = conn.execute("""INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, effective_time, qty, unit_price,
                   extra_cost_per_unit, transfer_id, source, source_ref, legacy, created_by)
            SELECT m.item_id, m.warehouse_id, (%(kind)s::jsonb ->> d.fac_type), d.doc_date, coalesce(d.doc_time, '00:00')::time, l.qty,
                   CASE d.fac_type WHEN 'K' THEN l.unit_price WHEN 'Y' THEN l.unit_cost END,
                   CASE WHEN d.fac_type = 'K' AND coalesce(d.total_qty, 0) > 0 THEN coalesce(d.extra_cost, 0) / d.total_qty ELSE 0 END,
                   CASE WHEN d.fac_type IN ('D', 'S') THEN core.legacy_transfer_id(l.source_db, d.fac_code, l.line_index) END,
                   'holoo', 'holoo:' || l.source_db || ':' || d.fac_type || ':' || d.fac_code || ':' || l.line_index, true, %(u)s
            FROM holoo_mirror.document_line l JOIN holoo_mirror.document d USING (source_db, fac_type, fac_code)
            JOIN core.item_legacy_code m ON m.source_db = l.source_db AND m.legacy_code = l.a_code
            JOIN holoo_mirror.item i ON i.source_db = l.source_db AND i.a_code = l.a_code AND NOT i.is_service
            WHERE l.source_db = %(db)s AND l.removed_run IS NULL AND d.removed_run IS NULL AND d.fac_type IN ('K','F','Y','X','Z','D','S') AND l.qty > 0
            ON CONFLICT DO NOTHING""", {"db": db, "kind": json.dumps(KIND), "u": USER}).rowcount
    return dict(st)


def parity(conn, db: str, year_end: str) -> dict:
    """Kardex of core vs Holoo: final stock and average per item code, the cost of every outgoing line, and the valuation."""
    out = collections.Counter()
    items = conn.execute("""SELECT i.a_code, m.item_id, m.warehouse_id, coalesce(i.stored_qty, 0), coalesce(i.stored_avg_cost, 0)
                            FROM holoo_mirror.item i JOIN core.item_legacy_code m ON m.source_db = i.source_db AND m.legacy_code = i.a_code
                            WHERE i.source_db = %s AND i.removed_run IS NULL AND NOT i.is_service""", (db,)).fetchall()
    holoo_cost = {r[0]: float(r[1]) for r in conn.execute(
        """SELECT 'holoo:' || l.source_db || ':' || l.fac_type || ':' || l.fac_code || ':' || l.line_index, l.unit_cost
           FROM holoo_mirror.document_line l WHERE l.source_db = %s AND l.removed_run IS NULL AND l.fac_type IN ('F','X','Z','S')""", (db,))}
    by_item = collections.defaultdict(list)
    for a, it, wh, q, c in items:
        by_item[it].append((a, wh, float(q), float(c)))
    for it, codes in by_item.items():
        rows = conn.execute("""SELECT k.warehouse_id, k.kind, k.unit_cost, k.qty_after, k.avg_cost_after, s.source_ref
                               FROM core.item_kardex(%s) k JOIN core.stock_movement s ON s.id = k.movement_id""", (it,)).fetchall()
        last = {}
        for wh, kind, uc, qa, ac, ref in rows:
            last[wh] = (float(qa), float(ac))
            if kind in ("sale", "purchase_return", "waste", "transfer_out") and ref in holoo_cost:
                out["out_lines"] += 1
                hc = holoo_cost[ref]
                out["out_lines_cost_equal"] += abs(hc - float(uc)) <= max(1.0, abs(hc) * 1e-6)
        for a, wh, q, c in codes:
            cq, cc = last.get(wh, (0.0, 0.0))
            out["item_codes"] += 1
            out["stock_qty_equal"] += abs(cq - q) < 0.001
            if q != 0:
                out["item_codes_in_stock"] += 1
                out["avg_cost_equal"] += abs(cc - c) <= max(1.0, abs(c) * 1e-6)
    hv = conn.execute("""SELECT sum(stored_qty * stored_avg_cost) FROM holoo_mirror.item WHERE source_db = %s AND removed_run IS NULL AND NOT is_service""",
                      (db,)).fetchone()[0]
    cv = conn.execute("SELECT sum(value) FROM core.inventory_valuation(%s)", (year_end,)).fetchone()[0]
    res = dict(out)
    res.update({"holoo_goods_value_exist_x_buy_price": float(hv or 0), "core_valuation": float(cv or 0),
                "valuation_difference": round(float(cv or 0) - float(hv or 0), 2),
                "negative_stock_legacy_item_warehouses": conn.execute("SELECT count(*) FROM core.inventory_negative_legacy").fetchone()[0]})
    return res


if __name__ == "__main__":
    import argparse
    import psycopg
    ap = argparse.ArgumentParser(); ap.add_argument("--pg", required=True); ap.add_argument("--source-db", required=True); ap.add_argument("--year-end", required=True)
    a = ap.parse_args()
    with psycopg.connect(a.pg, autocommit=True) as c:
        print(json.dumps({"migrate": migrate(c, a.source_db), "rerun": migrate(c, a.source_db), "parity": parity(c, a.source_db, a.year_end)},
                         ensure_ascii=False, indent=1))
