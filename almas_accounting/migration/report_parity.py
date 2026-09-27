"""Report parity (E20): the reports of the new core against Holoo's OWN server-side report logic on the restored backup.

  A. four-column trial balance per month and for the year, every Holoo code at every level (kol 3 / moein 7 /
     tafsili 11): opening, period debit, period credit — Holoo rule: Show_Daftar = 1, Sanad_State not in (2, 3)
     (as in Calc_BedBes_UseInFuncDateBetween4); the year is also compared WITH the closing vouchers (W_SarfaslMandeh).
  B. balance of every person at every month end, against the result of Holoo's function
     Calc_Mandeh_CustomerFuncDate itself.
  C. ledger of every account and person («مرور حساب», «دفتر معین اشخاص», «ریز عملکرد بانک»): debit, credit and running
     balance at the end of every day, all vouchers included (spMoienAshkhas rule).
  D. Holoo's procedure spMoienAshkhas itself, executed for a sample of person accounts, against core.account_ledger:
     the same lines, the same end-of-day balances, the same final balance.
  E. cheque list: the state of every cheque (Holoo RetVazeatCheck of the last Check_Event) against the location model.
Read-only on both sides; the output holds counts only (no names, codes or amounts of a person).
"""
from __future__ import annotations

import collections
import datetime as dt
import json
import pathlib
import random
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "holoo_reader"))

HOLOO_STATE = {"D": "received", "M": "moved_between_cashboxes", "J": "deposited_for_collection", "S": "returned_by_endorsee",
               "B": "returned_to_payer", "R": "returned_from_bank", "P": "issued", "O": "settled_otherwise"}


def _rollup(d: dict) -> dict:
    """{11/7/3-char code: value tuple} → summed at kol, moein and tafsili like W_SarfaslMandeh."""
    out = collections.defaultdict(lambda: None)
    for code, v in d.items():
        for k in {code[:3], code[:7] if len(code) >= 7 else None, code if len(code) == 11 else None} - {None}:
            out[k] = tuple(a + b for a, b in zip(out[k], v)) if out[k] else tuple(v)
    return dict(out)


def _code_map(pg, db):
    return {(a, p): code for code, a, p in pg.execute(
        "SELECT legacy_code, account_id, party_id FROM core.legacy_account_map WHERE source_db = %s AND account_id IS NOT NULL", (db,))}


def _cmp(h: dict, c: dict, tol=0.5):
    keys = set(h) | set(c)
    z = lambda v: v or (0, 0, 0)
    bad = [k for k in keys if any(abs(x - y) > tol for x, y in zip(z(h.get(k)), z(c.get(k))))]
    return len(keys), bad


def trial_balances(pg, sql, db, year):
    from holoo_reader import sqlserver
    cmap = _code_map(pg, db)
    periods = pg.execute("""SELECT p.code, p.starts_on, p.ends_on FROM core.period p JOIN core.fiscal_year y ON y.id = p.fiscal_year_id
                            WHERE y.code = %s ORDER BY p.starts_on""", (year,)).fetchall()
    ys, ye = periods[0][1], periods[-1][2]
    runs = [(c, s, e, False) for c, s, e in periods] + [("year", ys, ye, False), ("year+closing", ys, ye, True)]
    res, total, bad_n, examples = {}, 0, 0, []
    for name, s, e, closing in runs:
        _, rows = sqlserver.query(sql, f"""
            SELECT RTRIM(l.Col_Code) + RTRIM(ISNULL(l.Moien_Code, '')) + RTRIM(ISNULL(l.Tafzili_Code, '')),
                   SUM(CASE WHEN s.Sanad_Date < %s THEN ISNULL(l.Bed, 0) - ISNULL(l.Bes, 0) ELSE 0 END),
                   SUM(CASE WHEN s.Sanad_Date >= %s THEN ISNULL(l.Bed, 0) ELSE 0 END),
                   SUM(CASE WHEN s.Sanad_Date >= %s THEN ISNULL(l.Bes, 0) ELSE 0 END)
            FROM SND_LIST l JOIN SANAD s ON s.Sanad_Code = l.Sanad_Code
            WHERE l.Show_Daftar = 1 AND s.Sanad_Date <= %s {'' if closing else 'AND s.Sanad_State NOT IN (2, 3)'}
            GROUP BY RTRIM(l.Col_Code) + RTRIM(ISNULL(l.Moien_Code, '')) + RTRIM(ISNULL(l.Tafzili_Code, ''))""",
                                  (str(s), str(s), str(s), str(e)))
        h = _rollup({k: (float(o or 0), float(d or 0), float(c or 0)) for k, o, d, c in rows})
        core = {}
        for a, p, o, d, c in pg.execute("SELECT account_id, party_id, opening, period_debit, period_credit FROM core.trial_balance_period(%s, %s, %s, %s)",
                                        (year, s, e, closing)):
            code = cmap.get((a, p))
            if code is None:
                core.setdefault("UNMAPPED", (0, 0, 0)); continue
            core[code] = (float(o), float(d), float(c))
        c = _rollup(core)
        n, bad = _cmp(h, c)
        res[name] = {"codes": n, "different": len(bad)}
        total += n; bad_n += len(bad)
        examples += [(name, len(k)) for k in bad[:2]]
    return {"runs": len(runs), "code_periods_compared": total, "different": bad_n, "by_run": res, "difference_levels": examples[:6]}


def party_balances(pg, sql, db, year):
    from holoo_reader import sqlserver
    party_of = dict(pg.execute("SELECT legacy_code, party_id FROM core.party_legacy_code WHERE source_db = %s", (db,)).fetchall())
    ends = [r[0] for r in pg.execute("""SELECT p.ends_on FROM core.period p JOIN core.fiscal_year y ON y.id = p.fiscal_year_id
                                        WHERE y.code = %s ORDER BY 1""", (year,))]
    tot, bad, unmapped = 0, 0, 0
    for d in ends:
        _, rows = sqlserver.query(sql, "SELECT C_Code, Mandeh FROM Calc_Mandeh_CustomerFuncDate(%s, '1900-01-01 00:00:00')",
                                  (str(d + dt.timedelta(days=1)),))
        core = collections.defaultdict(float)
        for p, b in pg.execute("SELECT party_id, sum(balance) FROM core.party_balance_at(%s, %s) GROUP BY 1", (year, d)):
            core[p] += float(b)
        for c_code, m in rows:
            p = party_of.get(c_code)
            if p is None:
                unmapped += 1; continue
            tot += 1
            if abs(float(m or 0) - core.get(p, 0.0)) > 0.5:
                bad += 1
    return {"function": "Calc_Mandeh_CustomerFuncDate", "month_ends": len(ends), "person_balances_compared": tot, "different": bad,
            "holoo_persons_without_party": unmapped // max(len(ends), 1)}


def daily_ledgers(pg, sql, db, year):
    from holoo_reader import sqlserver
    cmap = _code_map(pg, db)
    _, rows = sqlserver.query(sql, """
        SELECT RTRIM(l.Col_Code) + RTRIM(ISNULL(l.Moien_Code, '')) + RTRIM(ISNULL(l.Tafzili_Code, '')), CONVERT(char(10), s.Sanad_Date, 23),
               SUM(ISNULL(l.Bed, 0)), SUM(ISNULL(l.Bes, 0))
        FROM SND_LIST l JOIN SANAD s ON s.Sanad_Code = l.Sanad_Code WHERE l.Show_Daftar = 1
        GROUP BY RTRIM(l.Col_Code) + RTRIM(ISNULL(l.Moien_Code, '')) + RTRIM(ISNULL(l.Tafzili_Code, '')), CONVERT(char(10), s.Sanad_Date, 23)""")
    h = {(k, d): (float(a or 0), float(b or 0)) for k, d, a, b in rows if abs(float(a or 0)) + abs(float(b or 0)) > 0}
    c = {}
    for a, p, d, dr, cr in pg.execute("""SELECT account_id, party_id, effective_date, sum(debit), sum(credit) FROM core.year_lines(%s)
                                         GROUP BY 1, 2, 3""", (year,)):
        c[(cmap.get((a, p), "UNMAPPED"), str(d))] = (float(dr), float(cr))
    keys = set(h) | set(c)
    bad = [k for k in keys if any(abs(x - y) > 0.5 for x, y in zip(h.get(k, (0, 0)), c.get(k, (0, 0))))]
    # running balance at the end of every active day follows from equal daily turnover; checked explicitly as well
    run_h, run_c, rb_bad = collections.defaultdict(float), collections.defaultdict(float), 0
    for k in sorted(keys, key=lambda x: (x[0], x[1])):
        hd, cd = h.get(k, (0, 0)), c.get(k, (0, 0))
        run_h[k[0]] += hd[0] - hd[1]; run_c[k[0]] += cd[0] - cd[1]
        rb_bad += abs(run_h[k[0]] - run_c[k[0]]) > 0.5
    accounts = {k[0] for k in keys}
    return {"account_days_compared": len(keys), "accounts": len(accounts),
            "bank_and_cash_accounts": sum(1 for a in accounts if a[:3] in ("101", "102")),
            "different_turnover": len(bad), "different_end_of_day_balance": rb_bad}


def moien_ashkhas_sample(pg, sql, db, year, n=120, seed=1404):
    """Execute Holoo's own spMoienAshkhas for a sample of person accounts and compare with core.account_ledger."""
    from holoo_reader import sqlserver
    persons = pg.execute("""SELECT m.legacy_code, m.account_id, m.party_id, count(*) FROM core.legacy_account_map m
                            JOIN core.journal_line l ON l.account_id = m.account_id AND l.party_id = m.party_id
                            WHERE m.source_db = %s AND m.kind = 'person_control' AND length(m.legacy_code) = 11 GROUP BY 1, 2, 3""", (db,)).fetchall()
    persons.sort(key=lambda r: -r[3])
    rnd = random.Random(seed)
    sample = persons[:20] + rnd.sample(persons[20:], min(n - 20, len(persons) - 20))
    ys, ye = pg.execute("SELECT starts_on, ends_on FROM core.fiscal_year WHERE code = %s", (year,)).fetchone()
    stats = collections.Counter()
    for code, acc, party, _ in sample:
        _, rows = sqlserver.query(sql, "EXEC spMoienAshkhas @C_Code = %s", (code,))
        hl = [(str(r[4])[:10], float(r[6] or 0), float(r[7] or 0), float(r[10] or 0)) for r in rows]   # date, bed, bes, mandeh
        cl = [(str(r[1]), float(r[5]), float(r[6]), float(r[7])) for r in pg.execute(
            "SELECT * FROM core.account_ledger(%s, %s, %s, %s, %s)", (year, acc, party, ys, ye)).fetchall()[1:]]
        stats["accounts"] += 1; stats["lines"] += len(hl)
        same_lines = sorted((d, b, c) for d, b, c, _ in hl) == sorted((d, b, c) for d, b, c, _ in cl)
        eod = lambda L: {d: m for d, _, _, m in L}                  # last running balance of each day
        stats["same_lines"] += same_lines
        stats["same_end_of_day_balances"] += eod(hl) == eod(cl)
        stats["same_final_balance"] += (not hl and not cl) or (hl and cl and abs(hl[-1][3] - cl[-1][3]) < 0.5)
        stats["same_line_order"] += [x[:3] for x in hl] == [x[:3] for x in cl]
    return {"procedure": "spMoienAshkhas", **stats}


def cheque_states(pg, sql, db):
    from holoo_reader import sqlserver
    _, rows = sqlserver.query(sql, """
        SELECT e.Check_Code, e.State, ISNULL(e.SarFasl_Code, ''), c.Daryaft_Pardakht FROM Check_Event e
        JOIN (SELECT Check_Code, MAX(Id) mid FROM (SELECT Check_Code, Id, ROW_NUMBER() OVER (PARTITION BY Check_Code ORDER BY Date_Time DESC, Id DESC) rn
              FROM Check_Event) x WHERE rn = 1 GROUP BY Check_Code) last ON last.mid = e.Id
        JOIN [Check] c ON c.Check_Code = e.Check_Code""")
    holoo = {}
    for chk, st, sar, daryaft in rows:
        if st == "V":
            t = ("endorsed_to_party" if sar.strip() not in ("", "00000") else "collected") if daryaft else "paid_by_bank"
            if daryaft and sar.strip() == "00000":
                t = "endorsed_to_party"
        else:
            t = HOLOO_STATE.get(st, "unknown:" + st)
        holoo[chk] = t
    # an opening position is the state the cheque was carried in from the previous year (kept in cheque_event.state)
    core = {k: (HOLOO_STATE.get(st, st) if ev == "opening_position" else ev) for k, ev, st in pg.execute(
        """SELECT c.holoo_check_code, l.last_event, (SELECT e.state FROM core.cheque_event e WHERE e.cheque_id = l.cheque_id AND e.event_type IS NOT NULL
                   ORDER BY e.effective_date DESC, e.id DESC LIMIT 1)
           FROM core.cheque_location l JOIN core.cheque c ON c.id = l.cheque_id WHERE c.legacy_source_db = %s""", (db,)).fetchall()}
    both = set(holoo) & set(core)
    same = sum(1 for k in both if holoo[k] == core[k])
    diff = collections.Counter((holoo[k], core[k]) for k in both if holoo[k] != core[k])
    return {"holoo_cheques": len(holoo), "core_cheques_with_events": len(core), "compared": len(both), "same_state": same,
            "different": {f"{a} → {b}": n for (a, b), n in diff.most_common(8)}, "only_in_holoo": len(set(holoo) - set(core)),
            "holoo_state_distribution": dict(collections.Counter(holoo.values()).most_common())}


def run(pg, sql, db, year):
    return {"A_trial_balance": trial_balances(pg, sql, db, year), "B_party_balance": party_balances(pg, sql, db, year),
            "C_daily_ledgers": daily_ledgers(pg, sql, db, year), "D_spMoienAshkhas": moien_ashkhas_sample(pg, sql, db, year),
            "E_cheque_states": cheque_states(pg, sql, db)}


if __name__ == "__main__":
    import argparse
    import psycopg
    from holoo_reader import sqlserver
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg", required=True); ap.add_argument("--source-db", required=True); ap.add_argument("--sql-db", required=True)
    ap.add_argument("--year", default="1404"); ap.add_argument("--only", default="")
    a = ap.parse_args()
    with psycopg.connect(a.pg, autocommit=True) as pg, sqlserver.connect(sqlserver.ServerConfig(), a.sql_db) as sql:
        if a.only:
            fn = {"A": trial_balances, "B": party_balances, "C": daily_ledgers, "D": moien_ashkhas_sample}.get(a.only)
            out = fn(pg, sql, a.source_db, a.year) if fn else cheque_states(pg, sql, a.source_db)
        else:
            out = run(pg, sql, a.source_db, a.year)
        print(json.dumps(out, ensure_ascii=False, indent=1, default=str))
