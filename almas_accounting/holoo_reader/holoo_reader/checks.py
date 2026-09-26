"""Validate + Reconcile on the Silver canonical DB.

Every check returns {code, title, level, status, expected, actual, diff, explanation}.
level: 'blocking' (publication gate) or 'warning'. status: 'pass' | 'fail' | 'explained'.
Known, documented exceptions (from reverse-engineering evidence) turn a 'fail' into 'explained'.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

import duckdb

TOL = 0.5


@dataclass
class Result:
    code: str
    title: str
    level: str
    status: str
    expected: object = None
    actual: object = None
    diff: object = None
    explanation: str = ""


def _one(con, sql):
    return con.execute(sql).fetchone()


def _cmp(code, title, level, expected, actual, explanation="", tol=TOL):
    ok = (expected == actual) if not isinstance(expected, (int, float)) else abs((actual or 0) - (expected or 0)) <= tol
    diff = None if ok or not isinstance(expected, (int, float)) else (actual or 0) - (expected or 0)
    return Result(code, title, level, "pass" if ok else "fail", expected, actual, diff, explanation)


# Holoo voids a sales invoice by setting Show_Daftar = 0 on all lines of its voucher (evidence E01.5b); those lines are
# excluded from the ledger (voucher_line.in_ledger = false), which is why R-07 passes on the ledger view. The raw-lines
# fallback below only explains a failure if it is fully caused by voided-invoice vouchers.
def _voided_voucher_codes(con):
    return [r[0] for r in con.execute("SELECT voucher_code FROM document WHERE kind = 'sale_voided' AND voucher_code IS NOT NULL").fetchall()]


def run_all(con: duckdb.DuckDBPyConnection, bronze_counts: dict | None = None) -> list[dict]:
    R: list[Result] = []

    # R-01 balance of every voucher
    n = _one(con, f"SELECT COUNT(*) FROM (SELECT sanad_code FROM voucher_line GROUP BY 1 HAVING abs(SUM(debit) - SUM(credit)) > {TOL})")[0]
    R.append(_cmp("R-01", "توازن بدهکار و بستانکار همه اسناد", "blocking", 0, n))

    # R-02 orphans
    orphan_sql = {
        "voucher_line→voucher": "SELECT COUNT(*) FROM voucher_line l ANTI JOIN voucher v USING (sanad_code)",
        "voucher without lines": "SELECT COUNT(*) FROM voucher v ANTI JOIN voucher_line l USING (sanad_code)",
        "line→account": "SELECT COUNT(*) FROM voucher_line l ANTI JOIN account a ON a.code = l.account_code",
        "document_line→document": "SELECT COUNT(*) FROM document_line l ANTI JOIN document d USING (fac_type, fac_code)",
        "document_line→item": "SELECT COUNT(*) FROM document_line l ANTI JOIN item i USING (a_code)",
        "document→person": "SELECT COUNT(*) FROM document d ANTI JOIN person p ON p.c_code = d.person_code",
        "document→voucher": "SELECT COUNT(*) FROM document d ANTI JOIN voucher v ON v.sanad_code = d.voucher_code WHERE d.voucher_code IS NOT NULL",
        "cheque_event→cheque": "SELECT COUNT(*) FROM cheque_event e ANTI JOIN cheque c USING (check_code)",
        "cheque_event→voucher": "SELECT COUNT(*) FROM cheque_event e ANTI JOIN voucher v ON v.sanad_code = e.voucher_code WHERE e.voucher_code IS NOT NULL",
    }
    for name, sql in orphan_sql.items():
        R.append(_cmp("R-02", f"رکورد یتیم: {name}", "blocking", 0, _one(con, sql)[0]))

    # R-03 stored account balance (SARFASL.Mandeh) vs recomputed before closing (leaf accounts)
    mism = _one(con, f"""SELECT COUNT(*) FROM account a LEFT JOIN account_balance b ON b.account_code = a.code
        WHERE NOT EXISTS (SELECT 1 FROM account c WHERE c.parent_code = a.code)
          AND abs(coalesce(b.balance_before_closing,0) - coalesce(a.stored_balance,0)) > 1""")[0]
    R.append(Result("R-03", "مانده ذخیره‌شده هلو (SARFASL.Mandeh) = مانده بازمحاسبه‌شده پیش از بستن", "warning",
                    "pass" if mism == 0 else "fail", 0, mism, mism, "Cache مانده هلو (SARFASL.Mandeh)؛ در ۱۴۰۴ برای ۱۵ حساب برگ با دفتر نابرابر است (evidence C-14)"))

    # R-04 stored stock = opening + signed movements (goods)
    mism = _one(con, """SELECT COUNT(*) FROM item i LEFT JOIN (SELECT a_code, SUM(qty_signed) q FROM stock_movement GROUP BY 1) m USING (a_code)
        WHERE NOT i.is_service AND abs(i.first_qty + coalesce(m.q,0) - i.stored_qty) > 0.001""")[0]
    R.append(_cmp("R-04", "موجودی ذخیره‌شده هلو (ARTICLE.Exist) = اول دوره + حرکات", "warning", 0, mism))

    # R-05 invoice amount = party line of its voucher
    mism = _one(con, """SELECT COUNT(*) FROM document d JOIN (SELECT sanad_code, SUM(debit + credit) amt FROM voucher_line WHERE line_role = 'party_invoice' GROUP BY 1) l
        ON l.sanad_code = d.voucher_code WHERE d.kind IN ('sale','purchase','sale_return','purchase_return','sale_voided') AND abs(l.amt - d.total) > 1""")[0]
    R.append(_cmp("R-05", "مبلغ فاکتور = ردیف شخص در سند فاکتور", "warning", 0, mism))

    # R-05b invoice = Σ lines and payment split
    mism = _one(con, """SELECT COUNT(*) FROM document d JOIN (SELECT fac_type, fac_code, SUM(qty*unit_price - line_discount) s FROM document_line GROUP BY 1,2) x
        USING (fac_type, fac_code) WHERE d.kind IN ('sale','purchase','sale_return','purchase_return','sale_voided','waste') AND abs(x.s - d.discount - d.total) > 1""")[0]
    R.append(_cmp("R-05b", "جمع ردیف‌های فاکتور = مبلغ فاکتور", "warning", 0, mism))

    # R-06 cheques vs ledger (issued open vs 402)
    sub = _one(con, "SELECT coalesce(SUM(amount),0) FROM cheque_status WHERE direction='out' AND last_state='P'")[0]
    led = _one(con, "SELECT coalesce(-SUM(balance_before_closing),0) FROM account_balance WHERE account_code LIKE '402%'")[0]
    R.append(_cmp("R-06a", "چک‌های پرداختی باز = مانده اسناد پرداختنی (402)", "warning", led, sub))
    sub = _one(con, "SELECT coalesce(SUM(amount),0) FROM cheque_status WHERE direction='in' AND last_state IN ('D','S','M','R','J')")[0]
    led = _one(con, "SELECT coalesce(SUM(balance_before_closing),0) FROM account_balance WHERE account_code LIKE '104%'")[0]
    r = _cmp("R-06b", "چک‌های دریافتی نزد صندوق و در جریان = مانده اسناد دریافتنی (104)", "warning", led, sub)
    if r.status == "fail":
        inv = _one(con, """WITH o AS (SELECT check_code, state, event_date, event_id,
                ROW_NUMBER() OVER (PARTITION BY check_code ORDER BY event_date DESC, event_id DESC) rd,
                ROW_NUMBER() OVER (PARTITION BY check_code ORDER BY event_id DESC) ri FROM cheque_event)
            SELECT coalesce(SUM(c.amount),0) FROM o a JOIN o b ON b.check_code = a.check_code AND b.ri = 1 JOIN cheque c ON c.check_code = a.check_code
            WHERE a.rd = 1 AND a.event_id <> b.event_id AND a.state IN ('D','S','M','R','J') AND b.state NOT IN ('D','S','M','R','J')""")[0]
        if abs(r.diff - inv) <= TOL:
            r.status, r.explanation = "explained", f"کل اختلاف ({inv:,.0f}) مربوط به چک‌هایی است که ترتیب تاریخ رویدادشان با ترتیب ثبت ناسازگار است (ثبت تاریخ‌گذشته؛ evidence E08.10)"
    R.append(r)

    # R-07 all accounts zero after closing
    closed = _one(con, "SELECT COUNT(*) FROM voucher WHERE state = 'closing'")[0]
    if closed:
        n = _one(con, f"SELECT COUNT(*) FROM account_balance WHERE abs(balance) > {TOL}")[0]
        r = _cmp("R-07", "پس از اختتامیه همه حساب‌ها صفر", "warning", 0, n)
        if r.status == "fail":
            vc = _voided_voucher_codes(con)
            if vc:
                n2 = _one(con, f"""SELECT COUNT(*) FROM (SELECT account_code FROM voucher_line WHERE sanad_code NOT IN ({','.join(map(str, vc))})
                                   GROUP BY 1 HAVING abs(SUM(debit) - SUM(credit)) > {TOL})""")[0]
                if n2 == 0:
                    r.status = "explained"
                    r.explanation = f"همه مانده‌ها ناشی از اسناد {len(vc)} فاکتور ابطال‌شده (Q) است (evidence E01)"
        R.append(r)

    # R-10 web-service payload vs posted invoice (payload = what the web shop sent; invoice = what Holoo kept)
    if _one(con, "SELECT COUNT(*) FROM web_payload")[0]:
        base = """FROM web_payload w JOIN audit_event a ON a.id = w.process_id
                  JOIN document d ON d.voucher_code = TRY_CAST(a.number AS INTEGER) AND d.kind IN ('sale','sale_voided','purchase')"""
        n_amt = _one(con, f"SELECT COUNT(*) {base} WHERE a.kind = 'add' AND abs(coalesce(w.cash,0) + coalesce(w.bank,0) + coalesce(w.credit,0) - d.total) > 1")[0]
        R.append(Result("R-10a", "مبلغ Payload وب‌سرویس = مبلغ فاکتور ثبت‌شده", "warning", "pass" if n_amt == 0 else "fail", 0, n_amt, n_amt,
                        "اختلاف یعنی فاکتور پس از دریافت از وب در هلو اصلاح شده است (تسویه، چک، …)"))
        n_date = _one(con, f"SELECT COUNT(*) {base} WHERE a.kind = 'add' AND w.doc_date <> d.doc_date")[0]
        R.append(Result("R-10b", "تاریخ Payload وب‌سرویس = تاریخ فاکتور", "warning", "pass" if n_date == 0 else "fail", 0, n_date, n_date,
                        "تغییر تاریخ فاکتور نسبت به تاریخ فروش در سامانه وب (Cut-off)"))
        fy_start = _one(con, "SELECT MIN(doc_date) FROM voucher")[0]
        n_prev = _one(con, f"SELECT COUNT(*) FROM web_payload w JOIN audit_event a ON a.id = w.process_id WHERE a.kind = 'add' AND w.doc_date < DATE '{fy_start}'")[0]
        R.append(Result("R-10c", "Payloadهای وب با تاریخ سال مالی قبل که در این سال ارسال شده‌اند", "warning", "pass" if n_prev == 0 else "fail", 0, n_prev, n_prev,
                        "فروش سال قبل که پس از شروع سال جدید به این دیتابیس ارسال شده (evidence E12)"))

    # R-08 opening voucher = previous year's closing (needs previous-year import) → reported as not-applicable here
    # R-09 bronze vs silver counts
    if bronze_counts:
        pairs = {"SANAD": "voucher", "SND_LIST": "voucher_line", "FACTURE": "document", "FACTART": "document_line", "CUSTOMER": "person",
                 "ARTICLE": "item", "SARFASL": "account", "Check": "cheque", "Check_Event": "cheque_event", "Process": "audit_event", "TaxLog": "tax_submission"}
        for b, s in pairs.items():
            if b in bronze_counts:
                R.append(_cmp("R-09", f"شمارش Bronze {b} = Silver {s}", "blocking", bronze_counts[b], _one(con, f'SELECT COUNT(*) FROM "{s}"')[0]))

    return [asdict(r) for r in R]


def gate(results: list[dict]) -> bool:
    return all(r["status"] != "fail" for r in results if r["level"] == "blocking")
