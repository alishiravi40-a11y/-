"""Year-end closing parity (E22): core.year_end_lines rebuilds Holoo's 1404 closing vouchers.

Inputs are exactly what the closing needs and nothing taken from the vouchers being tested, except the ending
inventory valuation, which in both systems is an input of the close (Holoo computes it from stock × purchase price,
E06.2 / ACC-11); it is read from Holoo's own temporary-closing voucher (account 105).
Compared net per (account, party) for the temporary closing (Sanad_State 2) and the permanent closing (Sanad_State 3),
plus the shape of the closing-balance account (006: two lines, total debit and total credit).
"""
from __future__ import annotations

import collections
import json


def run(conn, db: str, year: str, pl_code: str = "5020003") -> dict:
    ents = dict(conn.execute("""SELECT v.state, m.entry_id FROM holoo_mirror.voucher v JOIN core.legacy_entry_map m
                                ON m.source_db = v.source_db AND m.sanad_code = v.sanad_code AND m.status = 'current'
                                WHERE v.source_db = %s AND v.state IN ('closing_temporary', 'closing')""", (db,)).fetchall())
    endinv = conn.execute("""SELECT sum(l.debit - l.credit) FROM core.journal_line l JOIN core.account a ON a.id = l.account_id
                             WHERE l.entry_id = %s AND a.code = core.setting_value('account_ending_inventory')""", (ents["closing_temporary"],)).fetchone()[0]
    pl = conn.execute("SELECT id FROM core.account WHERE code = %s", (pl_code,)).fetchone()[0]
    out = {"ending_inventory_input": float(endinv)}
    if conn.execute("SELECT to_regclass('core.stock_movement') IS NOT NULL AND EXISTS (SELECT 1 FROM core.stock_movement)").fetchone()[0]:
        # the same figure computed by the new inventory (012): goods only — services carry no stock in the new model
        own = conn.execute("SELECT core.ending_inventory_value(%s)", (year,)).fetchone()[0]
        out["core_inventory_valuation"] = float(own)
        out["core_minus_holoo_input"] = float(own) - float(endinv)
    for stage, state in (("temporary", "closing_temporary"), ("permanent", "closing")):
        h = collections.Counter(); c = collections.Counter()
        for a, p, n in conn.execute("SELECT account_id, party_id, sum(debit - credit) FROM core.journal_line WHERE entry_id = %s GROUP BY 1, 2", (ents[state],)):
            h[(a, p)] += float(n)
        for a, p, n in conn.execute("SELECT account_id, party_id, sum(debit - credit) FROM core.year_end_lines(%s, %s, %s) WHERE stage = %s GROUP BY 1, 2",
                                    (year, endinv, pl, stage)):
            c[(a, p)] += float(n)
        h = {k: v for k, v in h.items() if abs(v) >= 0.5}; c = {k: v for k, v in c.items() if abs(v) >= 0.5}
        keys = set(h) | set(c)
        bad = [k for k in keys if abs(h.get(k, 0) - c.get(k, 0)) >= 0.5]
        tot_h = conn.execute("SELECT sum(debit) FROM core.journal_line WHERE entry_id = %s", (ents[state],)).fetchone()[0]
        tot_c = conn.execute("SELECT sum(debit) FROM core.year_end_lines(%s, %s, %s) WHERE stage = %s", (year, endinv, pl, stage)).fetchone()[0]
        out[stage] = {"account_party_pairs": len(keys), "different": len(bad), "holoo_total_debit": float(tot_h), "core_total_debit": float(tot_c)}
    shape = lambda rows: sorted((float(d), float(cr)) for d, cr in rows)
    out["closing_balance_account_lines"] = {
        "holoo": len(conn.execute("""SELECT 1 FROM core.journal_line l JOIN core.account a ON a.id = l.account_id
                                    WHERE l.entry_id = %s AND a.code = core.setting_value('account_closing_balance')""", (ents["closing"],)).fetchall()),
        "core": len(conn.execute("""SELECT 1 FROM core.year_end_lines(%s, %s, %s) l JOIN core.account a ON a.id = l.account_id
                                   WHERE l.stage = 'permanent' AND a.code = core.setting_value('account_closing_balance')""", (year, endinv, pl)).fetchall())}
    return out


if __name__ == "__main__":
    import argparse
    import psycopg
    ap = argparse.ArgumentParser(); ap.add_argument("--pg", required=True); ap.add_argument("--source-db", required=True); ap.add_argument("--year", default="1404")
    a = ap.parse_args()
    with psycopg.connect(a.pg, autocommit=True) as c:
        print(json.dumps(run(c, a.source_db, a.year), ensure_ascii=False, indent=1))
