"""Parity tests: Holoo's OWN views/functions (executed on the restored DB) vs the canonical Silver model.

These are the 'آزمون برابری' of the Holoo Compatibility Matrix: they prove the new model reproduces Holoo's figures.
"""
from __future__ import annotations

from collections import defaultdict

from .sqlserver import query

TOL = 0.5


def _cmp(name, holoo: dict, ours: dict, matrix_ids: str) -> dict:
    keys = set(holoo) | set(ours)
    diff = [(k, holoo.get(k, 0.0), ours.get(k, 0.0)) for k in keys if abs((holoo.get(k) or 0) - (ours.get(k) or 0)) > TOL]
    return {"test": name, "matrix": matrix_ids, "compared": len(keys), "mismatches": len(diff),
            "status": "pass" if not diff else "fail", "examples": sorted(diff, key=lambda x: -abs(x[1] - x[2]))[:10]}


def p01_account_balances(sql, silver) -> dict:
    """Holoo view MandehOfSarfasl (kol/moein/tafsili, Show_Daftar=1, all vouchers) vs canonical ledger."""
    _, rows = query(sql, "SELECT RTRIM(HLPSarfasl), Mand FROM MandehOfSarfasl")
    holoo = {k: v or 0.0 for k, v in rows}
    ours = defaultdict(float)
    for code, bal in silver.execute("SELECT account_code, balance FROM account_balance").fetchall():
        ours[code[:3]] += bal
        if len(code) >= 7:
            ours[code[:7]] += bal
        if len(code) == 11:
            ours[code] += bal
    return _cmp("P-01 مانده حساب‌ها (کل/معین/تفصیلی) = View هلو MandehOfSarfasl", holoo, dict(ours), "ACC-05, ACC-12")


def p02_person_balances(sql, silver) -> dict:
    """Holoo view W_Calc_Mandeh_Customer (debit ∪ credit accounts, Type in (5,15) kol, excl. closing) vs canonical."""
    _, rows = query(sql, "SELECT C_Code, Mandeh FROM W_Calc_Mandeh_Customer")
    holoo = {k: v or 0.0 for k, v in rows}
    ours = dict(silver.execute("""
        WITH kol AS (SELECT DISTINCT kol FROM account WHERE role_type IN (5, 15)),
        pa AS (SELECT c_code, debit_account acc FROM person WHERE debit_account IS NOT NULL
               UNION SELECT c_code, credit_account FROM person WHERE credit_account IS NOT NULL),
        bal AS (SELECT l.account_code, SUM(l.debit - l.credit) b FROM voucher_line l JOIN voucher v USING (sanad_code)
                WHERE l.in_ledger AND v.state NOT IN ('closing_temporary','closing') AND substr(l.account_code,1,3) IN (SELECT kol FROM kol)
                GROUP BY 1)
        SELECT p.c_code, coalesce(SUM(bal.b), 0) FROM person p LEFT JOIN pa ON pa.c_code = p.c_code LEFT JOIN bal ON bal.account_code = pa.acc
        GROUP BY p.c_code""").fetchall())
    return _cmp("P-02 مانده اشخاص = View هلو W_Calc_Mandeh_Customer", holoo, ours, "PER-03, PER-04")


def p03_kardex(sql, silver) -> dict:
    """Holoo kardex view W_ArtKardexWithoutAmani (invoice-based movements) vs canonical stock_movement, net qty per item."""
    _, rows = query(sql, """SELECT A_Code, SUM(CASE WHEN Fac_Type IN ('K','Y','D') THEN Few_Article WHEN Fac_Type IN ('F','X','Z','S') THEN -Few_Article ELSE 0 END)
                            FROM W_ArtKardexWithoutAmani GROUP BY A_Code""")
    holoo = {k: v or 0.0 for k, v in rows}
    ours = dict(silver.execute("SELECT a_code, SUM(qty_signed) FROM stock_movement GROUP BY 1").fetchall())
    return _cmp("P-03 گردش مقداری کالا = View کاردکس هلو W_ArtKardexWithoutAmani", holoo, ours, "INV-04, INV-09")


def p04_cheque_counts(sql, silver) -> dict:
    """Cheque/event/voucher link counts and amounts per direction: Holoo tables vs canonical."""
    _, rows = query(sql, "SELECT CASE WHEN Daryaft_Pardakht = 1 THEN 'in' ELSE 'out' END, SUM(Cust) FROM [Check] GROUP BY Daryaft_Pardakht")
    holoo = {k: v for k, v in rows}
    ours = dict(silver.execute("SELECT direction, SUM(amount) FROM cheque GROUP BY 1").fetchall())
    return _cmp("P-04 مبلغ چک‌ها به تفکیک جهت", holoo, ours, "CHQ-01")


def _jalali_months(silver):
    """Gregorian [start, end] of each Jalali month present in the vouchers (fiscal-year calendar)."""
    import jdatetime
    first, last = silver.execute("SELECT min(doc_date), max(doc_date) FROM voucher").fetchone()
    j = jdatetime.date.fromgregorian(date=first).replace(day=1)
    out = []
    while j.togregorian() <= last:
        nxt = (j.replace(day=28) + jdatetime.timedelta(days=5)).replace(day=1)
        out.append((f"{j.year:04d}/{j.month:02d}", j.togregorian(), (nxt - jdatetime.timedelta(days=1)).togregorian()))
        j = nxt
    return out


def p05_person_turnover_by_month(sql, silver) -> dict:
    """Holoo function Calc_BedBes_UseInFuncDateBetween2 (person debit/credit turnover for a date range — basis of the
    person account review and 4-column person report) for every Jalali month vs canonical."""
    holoo, ours = {}, {}
    for label, d1, d2 in _jalali_months(silver):
        _, rows = query(sql, f"SELECT C_Code, SumBed, SumBes FROM Calc_BedBes_UseInFuncDateBetween2('{d1:%Y%m%d}', '{d2:%Y%m%d}')")
        for c, bed, bes in rows:
            holoo[(label, c, "debit")] = bed or 0.0
            holoo[(label, c, "credit")] = bes or 0.0
        for c, bed, bes in silver.execute("""
            WITH pa AS (SELECT c_code, debit_account acc FROM person WHERE debit_account IS NOT NULL
                        UNION SELECT c_code, credit_account FROM person WHERE credit_account IS NOT NULL)
            SELECT pa.c_code, SUM(l.debit), SUM(l.credit)
            FROM voucher_line l JOIN voucher v USING (sanad_code) JOIN pa ON pa.acc = l.account_code
            WHERE l.in_ledger AND v.state NOT IN ('closing_temporary', 'closing') AND v.doc_date BETWEEN ? AND ?
            GROUP BY 1""", [d1, d2]).fetchall():
            ours[(label, c, "debit")] = bed or 0.0
            ours[(label, c, "credit")] = bes or 0.0
    return _cmp("P-05 گردش بدهکار/بستانکار ماهانه اشخاص = تابع هلو Calc_BedBes_UseInFuncDateBetween2", holoo, ours, "PER-03, ACC-15, ACC-16")


ALL = [p01_account_balances, p02_person_balances, p03_kardex, p04_cheque_counts, p05_person_turnover_by_month]


def run(sql, silver) -> list[dict]:
    return [f(sql, silver) for f in ALL]
