"""Compare balances in the new core with Holoo's OWN view MandehOfSarfasl (restored backup), per Holoo code at every level.

Core balance of a Holoo code = sum of core lines of current migrated entries on its mapped (account, party); rolled up
to kol (3) / moein (7) / tafsili (11) exactly as Holoo's view does.
Usage: python -m migration.verify_holoo_view --pg DSN --source-db holoo1_1404 --sql-db holoo_c67841443533
"""
from __future__ import annotations

import argparse
import collections
import json

import psycopg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg", required=True); ap.add_argument("--source-db", required=True); ap.add_argument("--sql-db", required=True)
    a = ap.parse_args()
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "holoo_reader"))
    from holoo_reader import sqlserver
    with sqlserver.connect(sqlserver.ServerConfig(), a.sql_db) as sql:
        _, rows = sqlserver.query(sql, "SELECT RTRIM(HLPSarfasl), Mand FROM MandehOfSarfasl")
    holoo = {k: float(v or 0) for k, v in rows}
    with psycopg.connect(a.pg) as c:
        per_code = c.execute("""
          WITH core_bal AS (SELECT jl.account_id, jl.party_id, sum(jl.debit - jl.credit) b FROM core.legacy_entry_map m
                            JOIN core.journal_line jl ON jl.entry_id = m.entry_id WHERE m.source_db = %(db)s AND m.status = 'current' GROUP BY 1, 2)
          SELECT m.legacy_code, coalesce(cb.b, 0) FROM core.legacy_account_map m
          JOIN core_bal cb ON cb.account_id = m.account_id AND cb.party_id IS NOT DISTINCT FROM m.party_id
          WHERE m.source_db = %(db)s""", {"db": a.source_db}).fetchall()
    # a (control, party) pair belongs to exactly one Holoo code here (no person has two accounts on one control) — checked:
    ours = collections.defaultdict(float)
    for code, b in per_code:
        b = float(b)
        ours[code[:3]] += b
        if len(code) >= 7:
            ours[code[:7]] += b
        if len(code) == 11:
            ours[code] += b
    keys = set(holoo) | set(ours)
    bad = [(k, holoo.get(k, 0.0), ours.get(k, 0.0)) for k in keys if abs(holoo.get(k, 0.0) - ours.get(k, 0.0)) > 0.5]
    print(json.dumps({"test": "core (migrated) = Holoo view MandehOfSarfasl", "compared": len(keys), "mismatches": len(bad),
                      "examples": sorted(bad, key=lambda x: -abs(x[1] - x[2]))[:5], "status": "pass" if not bad else "fail"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
