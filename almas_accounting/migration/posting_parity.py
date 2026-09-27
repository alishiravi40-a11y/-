"""Parity of the posting rule (core.document_posting_lines) with Holoo's own vouchers, for every commercial document.

For each Holoo document with a voucher (sale, sale_return, purchase, purchase_return, waste) a normalized document is
built from the INVOICE data (document + lines + the person's account + the payment accounts), the core rule produces
the voucher lines, and they are compared with Holoo's visible voucher lines mapped through legacy_account_map
(account, party, side, amount). Payment accounts are transaction data (for web sales they come from the web payload —
proven 11,706/11,706); everything else is derived by the rule.

mode 'holoo_compat': reproduces Holoo exactly — the web service posts shipping (item 0101003) to sales, the UI to «درآمد حمل».
mode 'new':          the item's configured revenue account for every channel (W-31) — reports how many vouchers differ.
Usage: python -m migration.posting_parity --pg DSN --source-db holoo1_1404 [--mode holoo_compat|new]
"""
from __future__ import annotations

import argparse
import json

import psycopg

from migration import holoo_ledger as M
from beta import legacy

SHIPPING_ITEM, SHIPPING_ACCOUNT = "0101003", "7020005"      # E17: Holoo item-level revenue account


def prepare(conn, db):
    run = conn.execute("SELECT max(run_id) FROM holoo_mirror.import_run WHERE source_db = %s", (db,)).fetchone()[0]
    with conn.transaction():
        legacy.map_persons(conn, db, run)
        M.build_chart(conn, db, run)


def run(conn, db: str, mode: str = "holoo_compat") -> dict:
    prepare(conn, db)
    q = """
    WITH d AS (SELECT * FROM holoo_mirror.document WHERE source_db = %(db)s AND removed_run IS NULL AND voucher_code IS NOT NULL
               AND kind IN ('sale', 'sale_return', 'purchase', 'purchase_return', 'waste')),
    acc AS (SELECT legacy_code, account_id, party_id FROM core.legacy_account_map WHERE source_db = %(db)s),
    pers AS (SELECT p.c_code, p.debit_account, p.credit_account FROM holoo_mirror.person p WHERE p.source_db = %(db)s),
    doc AS (
      SELECT d.kind, d.fac_type, d.fac_code, d.voucher_code, jsonb_build_object(
        'kind', d.kind,
        'party_id', pa.party_id, 'party_account_id', pa.account_id,
        'expense_account_id', (SELECT id FROM core.account WHERE code = core.setting_value('account_waste_expense')),
        'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'account_id', (SELECT id FROM core.account WHERE code =
                        CASE WHEN d.kind = 'sale' AND dl.a_code = %(ship)s AND (%(mode)s = 'new' OR d.channel = 'holoo_ui') THEN %(shipacc)s
                             ELSE core.setting_value(CASE d.kind WHEN 'sale' THEN 'account_sales' WHEN 'sale_return' THEN 'account_sales_return'
                                  WHEN 'purchase' THEN 'account_purchases' WHEN 'purchase_return' THEN 'account_purchase_return' ELSE 'account_purchases' END) END),
                    'amount', CASE WHEN d.kind = 'waste' THEN dl.qty * dl.unit_cost ELSE dl.qty * dl.unit_price - dl.line_discount END)), '[]')
                  FROM holoo_mirror.document_line dl WHERE dl.source_db = d.source_db AND dl.fac_type = d.fac_type AND dl.fac_code = d.fac_code),
        'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('account_id', a.account_id, 'amount', l.debit + l.credit)), '[]')
                     FROM holoo_mirror.voucher_line l JOIN acc a ON a.legacy_code = l.account_code
                     WHERE l.source_db = d.source_db AND l.sanad_code = d.voucher_code AND l.in_ledger AND l.line_role = 'settlement_instrument')) AS doc
      FROM d LEFT JOIN pers ON pers.c_code = d.person_code
      LEFT JOIN acc pa ON pa.legacy_code = CASE WHEN d.kind IN ('sale', 'purchase_return') THEN coalesce(pers.debit_account, pers.credit_account)
                                               ELSE coalesce(pers.credit_account, pers.debit_account) END),
    rule AS (SELECT doc.kind, doc.fac_code, r.account_id, r.party_id, sum(r.debit) dr, sum(r.credit) cr
             FROM doc CROSS JOIN LATERAL core.document_posting_lines(doc.doc) r GROUP BY 1, 2, 3, 4),
    holoo AS (SELECT d.kind, d.fac_code, a.account_id, a.party_id, sum(l.debit) dr, sum(l.credit) cr
              FROM d JOIN holoo_mirror.voucher_line l ON l.source_db = d.source_db AND l.sanad_code = d.voucher_code AND l.in_ledger
              JOIN acc a ON a.legacy_code = l.account_code GROUP BY 1, 2, 3, 4),
    cmp AS (SELECT coalesce(r.kind, h.kind) kind, coalesce(r.fac_code, h.fac_code) fac_code,
                   bool_and(abs(coalesce(r.dr, 0) - coalesce(h.dr, 0)) < 1 AND abs(coalesce(r.cr, 0) - coalesce(h.cr, 0)) < 1) ok
            FROM rule r FULL JOIN holoo h ON h.kind = r.kind AND h.fac_code = r.fac_code AND h.account_id = r.account_id
                 AND h.party_id IS NOT DISTINCT FROM r.party_id GROUP BY 1, 2)
    SELECT kind, count(*), count(*) FILTER (WHERE ok), (array_agg(fac_code) FILTER (WHERE NOT ok))[1:5] FROM cmp GROUP BY 1 ORDER BY 1"""
    rows = conn.execute(q, {"db": db, "mode": mode, "ship": SHIPPING_ITEM, "shipacc": SHIPPING_ACCOUNT}).fetchall()
    res = {k: {"documents": n, "identical_voucher": ok, "examples_differing": ex} for k, n, ok, ex in rows}
    return {"mode": mode, "by_kind": res, "total": sum(v["documents"] for v in res.values()),
            "identical": sum(v["identical_voucher"] for v in res.values())}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg", required=True); ap.add_argument("--source-db", required=True)
    ap.add_argument("--mode", choices=["holoo_compat", "new"], default="holoo_compat")
    a = ap.parse_args()
    with psycopg.connect(a.pg, autocommit=True) as c:
        print(json.dumps(run(c, a.source_db, a.mode), ensure_ascii=False, indent=1))
