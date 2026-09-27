"""Derived allocation for data migrated from Holoo, and the aging control (core 008, E21).

Holoo never recorded which receipt settled which invoice (W-17). For migrated sub-ledgers the allocation is DERIVED:
reversal pairs first, then FIFO (oldest debit ← oldest credit). Every such settlement is marked `legacy_fifo`, so it is
never mistaken for a fact recorded by a person; users may undo and re-allocate with a reason.
Proof: for every sub-ledger and every month end, aging (open debits − unapplied credits) = ledger balance.
Idempotent: a sub-ledger with nothing open on both sides produces no settlement.
"""
from __future__ import annotations

import collections
import json
import time


def allocate_all(conn, user: str = "holoo-migration") -> dict:
    subs = conn.execute("""SELECT DISTINCT l.account_id, l.party_id FROM core.journal_line l
                           JOIN core.account a ON a.id = l.account_id AND a.requires_party""").fetchall()
    t = time.time(); n = 0
    for a, p in subs:
        n += conn.execute("SELECT core.allocate_fifo(%s, %s, %s, 'legacy_fifo')", (a, p, user)).fetchone()[0]
    return {"sub_ledgers": len(subs), "settlements_created": n, "seconds": round(time.time() - t)}


def control(conn, year: str) -> dict:
    ends = [r[0] for r in conn.execute("""SELECT p.ends_on FROM core.period p JOIN core.fiscal_year y ON y.id = p.fiscal_year_id
                                          WHERE y.code = %s ORDER BY 1""", (year,))]
    bad = {str(d): conn.execute("SELECT count(*) FROM core.aging_control(%s)", (d,)).fetchone()[0] for d in ends}
    return {"month_ends": len(ends), "sub_ledgers_with_difference": sum(bad.values())}


def summary(conn, as_of) -> dict:
    """Aggregates only (no party)."""
    m = dict(conn.execute("SELECT method, count(*) FROM core.settlement_active GROUP BY 1").fetchall())
    ag = conn.execute("""SELECT count(*) FILTER (WHERE open_debit > 0), count(*) FILTER (WHERE unapplied_credit > 0),
               sum(not_due), sum(d1_30), sum(d31_60), sum(d61_90), sum(d91_180), sum(d181_365), sum(over_365),
               sum(open_debit), sum(unapplied_credit), sum(net)
        FROM core.aging(%s) a JOIN core.account ac ON ac.id = a.account_id WHERE ac.code LIKE '103%%'""", (as_of,)).fetchone()
    st = dict(conn.execute("""SELECT status, count(*) FROM core.receivable_document_status s JOIN core.account ac ON ac.id = s.account_id
                              WHERE ac.code LIKE '103%%' GROUP BY 1""").fetchall())
    keys = ["parties_with_open_debit", "parties_with_unapplied_credit", "not_due", "d1_30", "d31_60", "d61_90", "d91_180",
            "d181_365", "over_365", "open_debit", "unapplied_credit", "net"]
    return {"settlements_by_method": m, "receivables_103_aging": dict(zip(keys, [float(x or 0) for x in ag])), "debit_items_status_103": st}


if __name__ == "__main__":
    import argparse
    import psycopg
    ap = argparse.ArgumentParser(); ap.add_argument("--pg", required=True); ap.add_argument("--year", default="1404"); ap.add_argument("--as-of", required=True)
    a = ap.parse_args()
    with psycopg.connect(a.pg, autocommit=True) as c:
        print(json.dumps({"allocate": allocate_all(c), "rerun": allocate_all(c), "control": control(c, a.year),
                          "summary": summary(c, a.as_of)}, ensure_ascii=False, indent=1, default=str))
