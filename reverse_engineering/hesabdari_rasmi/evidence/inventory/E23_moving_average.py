"""E23 — how Holoo computes the moving-average cost (ARTICLE.Buy_Price / FACTART.Buy_Price). Aggregates only; read-only.

Source of the rule: Holoo's own view W_ArtKardexForCalcPrice («kardex for calculating price»):
  * order: Fac_Date, Fac_Time, Fac_Type_Order (K=1, F=2, Y=3, X=4, Z=5, D=9, S=10), Fac_Type;
  * a purchase line enters at Price_BS + SarshekanHaz (HazFactK / Sum_Few: the invoice's extra costs per unit), or the
    «_R» variant (extra costs + levies) / Sum_Price × Price_BS; D and S lines carry their own Buy_Price.
The replay is compared with (1) the cost stored on every outgoing line (F, X, Z, S) and (2) the item's final Buy_Price.
Hypotheses that only use the mirror (without Fac_Time / HazFactK) are kept for contrast.
Usage: HOLOO_SQL_PASSWORD=... python E23_moving_average.py <sql-db>
"""
import collections
import json
import os
import sys

import pymssql

IN, OUT = {"K", "Y", "D"}, {"F", "X", "Z", "S"}
ORDER = {"K": 1, "F": 2, "Y": 3, "X": 4, "Z": 5, "D": 9, "S": 10}


def load(db):
    c = pymssql.connect(server="localhost", user=os.environ.get("HOLOO_SQL_USER", "sa"), password=os.environ["HOLOO_SQL_PASSWORD"], database=db)
    cur = c.cursor()
    cur.execute("""SELECT A_Code, ISNULL(First_exist, 0), ISNULL(FirstBuy_Price, 0), ISNULL(Exist, 0), ISNULL(Buy_Price, 0)
                   FROM ARTICLE WHERE LEFT(A_Code, 2) <> '01'""")
    items = {r[0]: tuple(float(x) for x in r[1:]) for r in cur.fetchall()}
    cur.execute("""SELECT FA.A_Code, F.Fac_Type, F.Fac_Code, F.Fac_Date, CONVERT(char(8), F.Fac_Time, 108), FA.A_Index, FA.Few_Article,
                          ISNULL(FA.Price_BS, 0), ISNULL(FA.Buy_Price, 0),
                          ISNULL(F.HazFactK, 0) / dbo.IsZero(F.Sum_Few, 1),
                          (ISNULL(F.HazFactK, 0) + ISNULL(F.OldDAmoozesh, 0) + ISNULL(F.OldDShahrdary, 0) + ISNULL(F.DCEghtesad, 0)) / dbo.IsZero(F.Sum_Price, 1)
                   FROM FACTART FA JOIN FACTURE F ON F.Fac_Code = FA.Fac_Code AND F.Fac_Type = FA.Fac_Type
                   WHERE F.Fac_Type IN ('K','Y','D','F','X','Z','S') AND LEFT(FA.A_Code, 2) <> '01'""")
    by = collections.defaultdict(list)
    for r in cur.fetchall():
        by[r[0]].append(r)
    return items, by


def replay(items, by, key, landed):
    stats = collections.Counter()
    for a, (fq, fc, sq, sc) in items.items():
        q, avg = fq, fc
        for r in sorted(by.get(a, []), key=key):
            t, qty, price, cost, haz, haz_r = r[1], float(r[6]), float(r[7]), float(r[8]), float(r[9]), float(r[10])
            if t in IN:
                unit = (price + (haz if landed == "per_unit" else haz_r * price if landed == "per_value" else 0)) if t == "K" else cost
                avg = (q * avg + qty * unit) / (q + qty) if (q + qty) != 0 else unit
                q += qty
            else:
                stats["out_lines"] += 1
                stats["out_lines_cost_equal"] += abs(cost - avg) <= max(1.0, abs(avg) * 1e-6)
                q -= qty
        if by.get(a):
            stats["items_with_movements"] += 1
            stats["final_cost_equal"] += abs(avg - sc) <= max(1.0, abs(sc) * 1e-6)
    return dict(stats)


def main():
    items, by = load(sys.argv[1])
    holoo = lambda r: (r[3], r[4] or "", ORDER[r[1]], r[1], r[2], r[5])
    out = {"items": len(items),
           "holoo_rule(date,time,type_order)+landed_per_unit": replay(items, by, holoo, "per_unit"),
           "holoo_rule+landed_per_value(_R)": replay(items, by, holoo, "per_value"),
           "holoo_rule_without_landed_cost": replay(items, by, holoo, None),
           "contrast:date_only(no time)": replay(items, by, lambda r: (r[3], r[2], r[5]), "per_unit"),
           "contrast:recording_order(fac_code)": replay(items, by, lambda r: (r[2], r[5]), "per_unit")}
    print(json.dumps(out, indent=1))


if __name__ == "__main__" and len(sys.argv) == 2:
    main()


def classify_misses(items, by):
    """The outgoing lines the Holoo rule does not reproduce: is the stored cost an EARLIER average of the same item
    (stale: the line was not recomputed after an earlier-dated movement was entered later — W-10), zero, or other?
    Also: in how many items does the first miss come right after a movement that was entered later than the miss?"""
    holoo = lambda r: (r[3], r[4] or "", ORDER[r[1]], r[1], r[2], r[5])
    st = collections.Counter()
    for a, (fq, fc, sq, sc) in items.items():
        q, avg, seen = fq, fc, [fc]
        for r in sorted(by.get(a, []), key=holoo):
            t, qty, price, cost = r[1], float(r[6]), float(r[7]), float(r[8])
            if t in IN:
                unit = price if t == "K" else cost
                avg = (q * avg + qty * unit) / (q + qty) if (q + qty) != 0 else unit
                q += qty; seen.append(avg)
            else:
                if abs(cost - avg) > max(1.0, abs(avg) * 1e-6):
                    tol = lambda v: abs(cost - v) <= max(1.0, abs(v) * 1e-6)
                    st["zero_cost" if cost == 0 else "equals_an_earlier_average(stale)" if any(tol(v) for v in seen[:-1])
                       else "other"] += 1
                q -= qty
    return dict(st)


if __name__ == "__main__" and len(sys.argv) > 2 and sys.argv[2] == "misses":
    print(json.dumps(classify_misses(*load(sys.argv[1]))))
