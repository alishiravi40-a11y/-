"""Controls engine: declarative accounting/management controls over holoo_mirror + analytics views.

Each control: id, area, severity (critical|high|medium|info), title (FA), sql → one row (value, amount[, detail json]),
threshold (value above → alert), explain(value, amount) → plain Persian explanation for the manager, weakness/matrix refs.
Results are stored in analytics.control_run / analytics.control_result after every import.
Usage: python3 controls.py --pg "$HOLOO_PG_DSN" [--source-db holoo1_1404] [--report out.md]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import uuid

import psycopg

F = lambda n: f"{n:,.0f}"

CONTROLS = [
    # ---- Ledger integrity
    dict(id="CTL-01", area="دفتر", severity="critical", title="اسناد نامتوازن", refs="C-01, R-01",
         sql="""SELECT COUNT(*), 0 FROM (SELECT sanad_code FROM holoo_mirror.voucher_line WHERE source_db=%(db)s AND removed_run IS NULL
                GROUP BY 1 HAVING abs(SUM(debit)-SUM(credit)) > 0.5) x""",
         explain=lambda v, a: f"{F(v)} سند جمع بدهکار و بستانکارش برابر نیست." if v else "همه اسناد تراز هستند."),
    dict(id="CTL-02", area="دفتر", severity="high", title="مانده حساب‌ها پس از اختتامیه", refs="R-07, W-04",
         sql="""SELECT COUNT(*), coalesce(SUM(abs(b)),0) FROM (SELECT account_code, SUM(debit-credit) b FROM analytics.gl_line WHERE source_db=%(db)s
                GROUP BY 1 HAVING abs(SUM(debit-credit)) > 0.5) x
                WHERE EXISTS (SELECT 1 FROM holoo_mirror.voucher WHERE source_db=%(db)s AND state='closing' AND removed_run IS NULL)""",
         explain=lambda v, a: f"{F(v)} حساب پس از بستن سال مانده دارند (جمع {F(a)} ریال)." if v else "پس از بستن سال همه حساب‌ها صفرند (یا سال هنوز بسته نشده)."),
    dict(id="CTL-03", area="دوره مالی", severity="critical", title="اسناد ایجاد یا اصلاح‌شده پس از پایان سال", refs="W-01, E03",
         sql="""WITH fy AS (SELECT MAX(doc_date) e FROM holoo_mirror.voucher WHERE source_db=%(db)s AND removed_run IS NULL)
                SELECT COUNT(*), 0 FROM holoo_mirror.voucher v, fy WHERE v.source_db=%(db)s AND v.removed_run IS NULL AND v.state = 'normal'
                AND (v.saved_date > fy.e OR v.last_edit_at::date > fy.e)""",
         explain=lambda v, a: f"{F(v)} سند سال مالی پس از پایان سال ذخیره یا اصلاح شده‌اند؛ نرم‌افزار قفل دوره ندارد." if v else "پس از پایان سال سندی تغییر نکرده است."),
    dict(id="CTL-04", area="دوره مالی", severity="medium", title="ثبت با تاریخ گذشته (بیش از ۳ روز)", refs="W-06",
         sql="""SELECT COUNT(*), 0 FROM holoo_mirror.voucher WHERE source_db=%(db)s AND removed_run IS NULL AND state='normal' AND saved_date - doc_date > 3""",
         explain=lambda v, a: f"{F(v)} سند بیش از ۳ روز بعد از تاریخ سند ذخیره شده‌اند (آخرین ذخیره)."),
    # ---- Sales / margin
    dict(id="CTL-10", area="فروش", severity="high", title="فروش زیر بهای تمام‌شده (میانگین موزون متحرک)", refs="W-09, E07, E13.4",
         sql="""SELECT COUNT(*), coalesce(SUM(cost - revenue),0) FROM analytics.sales_line WHERE source_db=%(db)s AND below_cost""",
         explain=lambda v, a: f"{F(v)} ردیف فروش زیر بهای تمام‌شده فروخته شده؛ کسری جمعاً {F(a)} ریال."),
    dict(id="CTL-10b", area="فروش", severity="high", title="فروش زیر آخرین قیمت خرید (مبنای رسمی D-11؛ آخرین خرید همان مدل در هر انبار)", refs="W-09, D-11, D-13, E13.4",
         sql="""SELECT COUNT(*), coalesce(SUM(qty * (last_purchase_basis - unit_price)),0) FROM analytics.sales_line_d11 WHERE source_db=%(db)s AND below_last_purchase_d11""",
         explain=lambda v, a: f"{F(v)} ردیف فروش زیر آخرین قیمت خرید بوده‌اند؛ اختلاف جمعاً {F(a)} ریال. این مبنای رسمی کنترل فروش زیر قیمت خرید است."),
    dict(id="CTL-10c", area="فروش", severity="high", title="فاکتورهایی که هشدار ایمیلی می‌گرفتند (یک ایمیل برای هر فاکتور؛ D-12)", refs="D-12",
         sql="""SELECT COUNT(*), COUNT(*) FILTER (WHERE channel = 'web_service') FROM analytics.below_cost_alert_invoices WHERE source_db=%(db)s""",
         explain=lambda v, a: f"{F(v)} فاکتور دست‌کم یک قلم زیر آخرین قیمت خرید داشته‌اند ({F(a)} فاکتور از سایت). در سیستم جدید برای هر کدام یک هشدار داخلی و یک ایمیل ثبت می‌شود."),
    dict(id="CTL-10d", area="فروش", severity="medium", title="ردیف فروش بدون هیچ قیمت خرید قبلی (کنترل زیر قیمت ممکن نیست)", refs="D-11, D-13",
         sql="""SELECT COUNT(*), coalesce(SUM(revenue),0) FROM analytics.sales_line_d11 WHERE source_db=%(db)s AND basis_missing""",
         explain=lambda v, a: f"{F(v)} ردیف فروش (به مبلغ {F(a)} ریال) کالایی بوده که پیش از فروش هیچ خریدی از همان مدل ثبت نشده است؛ برای این‌ها هشدار «مبنای نامعلوم» ثبت می‌شود."),
    dict(id="CTL-11", area="فروش", severity="medium", title="ردیف فروش با بهای صفر (سود ردیفی بیش از واقع)", refs="W-10, E11.10",
         sql="""SELECT COUNT(*), coalesce(SUM(revenue),0) FROM analytics.sales_line WHERE source_db=%(db)s AND zero_cost""",
         explain=lambda v, a: f"{F(v)} ردیف فروش بدون بهای تمام‌شده ثبت شده (فروش قبل از ثبت خرید)؛ سود این ردیف‌ها واقعی نیست."),
    dict(id="CTL-12", area="فروش", severity="high", title="مغایرت مبلغ سند کانال وب با فاکتور", refs="W-26, E12.7",
         sql="""SELECT COUNT(*), coalesce(SUM(abs(web_amount - invoice_amount)),0) FROM analytics.web_reconciliation WHERE source_db=%(db)s AND status='amount_differs'""",
         explain=lambda v, a: f"{F(v)} فاکتور با آنچه سایت فرستاده متفاوت است (اختلاف مطلق {F(a)} ریال)؛ پس از ورود در هلو اصلاح شده‌اند."),
    dict(id="CTL-13", area="فروش", severity="high", title="Payload وب بدون فاکتور در دفاتر", refs="W-27, E12.5",
         sql="""SELECT COUNT(*), coalesce(SUM(web_amount),0) FROM analytics.web_reconciliation WHERE source_db=%(db)s AND status='not_in_books'""",
         explain=lambda v, a: f"{F(v)} سند ارسالی سایت ({F(a)} ریال) در این دفاتر نیست (حذف‌شده یا متعلق به سال دیگر)."),
    dict(id="CTL-14", area="فروش", severity="medium", title="تاریخ فاکتور متفاوت با تاریخ فروش سایت", refs="W-27, E12.6",
         sql="""SELECT COUNT(*), 0 FROM analytics.web_reconciliation WHERE source_db=%(db)s AND status='date_differs'""",
         explain=lambda v, a: f"تاریخ {F(v)} فاکتور با تاریخ فروش در سایت یکی نیست (خطر Cut-off)."),
    # ---- Tax
    dict(id="CTL-20", area="مالیات", severity="high", title="فاکتورهای فروش ناموفق/ارسال‌نشده به مؤدیان", refs="W-08, E09",
         sql="""SELECT COUNT(*), coalesce(SUM(total),0) FROM holoo_mirror.document WHERE source_db=%(db)s AND removed_run IS NULL AND kind='sale' AND coalesce(tax_state,0) <> 2 AND total > 0""",
         explain=lambda v, a: f"{F(v)} فاکتور فروش ({F(a)} ریال) در سامانه مؤدیان پذیرفته نشده است."),
    # ---- Cheques
    dict(id="CTL-30", area="چک", severity="high", title="چک‌های دریافتی سررسیدگذشته که هنوز در صندوق‌اند", refs="W-12, E08.7",
         sql="""WITH m AS (SELECT MAX(doc_date) d FROM holoo_mirror.voucher WHERE source_db=%(db)s AND removed_run IS NULL)
                SELECT COUNT(*), coalesce(SUM(amount),0) FROM analytics.cheque_status, m WHERE source_db=%(db)s AND direction='in' AND last_state IN ('D','S','M','R') AND due_date < m.d""",
         explain=lambda v, a: f"{F(v)} چک به مبلغ {F(a)} ریال سررسیدشان گذشته ولی هنوز به بانک نرفته یا وصول نشده‌اند."),
    dict(id="CTL-31", area="چک", severity="medium", title="مشتریان با ۳ چک برگشتی یا بیشتر", refs="W-12",
         sql="""SELECT COUNT(*), coalesce(SUM(open_amount),0) FROM analytics.customer_cheque_risk WHERE source_db=%(db)s AND bounced >= 3""",
         explain=lambda v, a: f"{F(v)} مشتری سابقه ۳+ چک برگشتی دارند؛ چک‌های باز آنها {F(a)} ریال است."),
    dict(id="CTL-32", area="چک", severity="high", title="مغایرت سیستم چک با دفتر (104)", refs="W-13, E08.3",
         sql="""SELECT CASE WHEN abs(s.v - l.v) > 1 THEN 1 ELSE 0 END, abs(s.v - l.v) FROM
                (SELECT coalesce(SUM(amount),0) v FROM analytics.cheque_status WHERE source_db=%(db)s AND direction='in' AND last_state IN ('D','S','M','R','J')) s,
                (SELECT coalesce(SUM(debit-credit),0) v FROM analytics.gl_line WHERE source_db=%(db)s AND kol='104' AND state NOT IN ('closing_temporary','closing')) l""",
         explain=lambda v, a: f"مانده چک‌های دریافتی در سیستم چک با دفتر {F(a)} ریال اختلاف دارد." if v else "سیستم چک با دفتر تطبیق دارد."),
    # ---- Inventory
    dict(id="CTL-40", area="انبار", severity="medium", title="موجودی راکد (بدون فروش در ۹۰ روز آخر)", refs="analytics",
         sql="""WITH m AS (SELECT MAX(doc_date) d FROM holoo_mirror.voucher WHERE source_db=%(db)s AND removed_run IS NULL)
                SELECT COUNT(*), coalesce(SUM(value),0) FROM analytics.stock_position, m WHERE source_db=%(db)s AND qty > 0 AND (last_sale IS NULL OR last_sale < m.d - 90)""",
         explain=lambda v, a: f"{F(v)} قلم کالا به ارزش {F(a)} ریال در ۹۰ روز آخر فروش نداشته‌اند."),
    dict(id="CTL-41", area="انبار", severity="medium", title="موجودی منفی در انبار", refs="W-11",
         sql="""SELECT COUNT(*), coalesce(SUM(value),0) FROM analytics.stock_position WHERE source_db=%(db)s AND qty < 0""",
         explain=lambda v, a: f"{F(v)} کالا موجودی منفی دارند." if v else "هیچ کالایی موجودی منفی ندارد."),
    dict(id="CTL-42", area="انبار", severity="medium", title="کالا با موجودی اول دوره منفی", refs="W-11, E11.8",
         sql="""SELECT COUNT(*), coalesce(SUM(first_qty * first_unit_cost),0) FROM holoo_mirror.item WHERE source_db=%(db)s AND removed_run IS NULL AND first_qty < 0""",
         explain=lambda v, a: f"{F(v)} کالا با موجودی منفی از سال قبل منتقل شده‌اند."),
    # ---- Audit
    dict(id="CTL-50", area="سوابق", severity="high", title="حذف فاکتور فروش (قابل بازیابی از Log)", refs="W-05, E12.10",
         sql="""SELECT COUNT(*), 0 FROM holoo_mirror.audit_event WHERE source_db=%(db)s AND removed_run IS NULL AND kind='delete' AND object='sale_invoice'""",
         explain=lambda v, a: f"{F(v)} فاکتور فروش حذف شده است؛ نسخه کامل آنها در Log موجود و قابل بازیابی است."),
    dict(id="CTL-51", area="سوابق", severity="high", title="اصلاح اسناد در روزهایی که هیچ رویدادی در Log ثبت نشده", refs="W-02, E05.4",
         sql="""WITH days AS (SELECT DISTINCT event_date d FROM holoo_mirror.audit_event WHERE source_db=%(db)s AND removed_run IS NULL)
                SELECT COUNT(*), COUNT(DISTINCT last_edit_at::date) FROM holoo_mirror.voucher v WHERE v.source_db=%(db)s AND v.removed_run IS NULL
                AND v.last_edit_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM days WHERE days.d = v.last_edit_at::date)""",
         explain=lambda v, a: f"{F(v)} سند در {F(a)} روز اصلاح شده‌اند که در آن روزها هیچ رویدادی در Log این دیتابیس نیست (Log در دیتابیس سال دیگر نوشته شده)." if v else "همه اصلاحات در روزهای دارای Log انجام شده‌اند."),
    dict(id="CTL-52", area="امنیت", severity="high", title="کاربران سرپرست (معاف از کنترل‌ها)", refs="W-14, W-15",
         sql="""SELECT COUNT(*), 0 FROM holoo_mirror.app_user WHERE source_db=%(db)s AND removed_run IS NULL AND is_supervisor AND NOT is_deactivated""",
         explain=lambda v, a: f"{F(v)} کاربر فعال دسترسی سرپرست دارند (از جمله کاربر وب‌سرویس)."),
    # ---- Receivables
    dict(id="CTL-60", area="مطالبات", severity="medium", title="مطالبات بیش از ۹۰ روز", refs="W-17",
         sql="""SELECT COUNT(*) FILTER (WHERE d91_180 + d180_plus > 0), coalesce(SUM(d91_180 + d180_plus),0) FROM analytics.receivable_ageing WHERE source_db=%(db)s""",
         explain=lambda v, a: f"{F(v)} حساب مشتری جمعاً {F(a)} ریال بدهی بیش از ۹۰ روز دارند."),
]

DDL = """
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE TABLE IF NOT EXISTS analytics.control_run (run_id text PRIMARY KEY, source_db text, import_run text, ran_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS analytics.control_result (run_id text, control_id text, area text, severity text, title text, status text,
  value numeric, amount numeric, explanation text, refs text, PRIMARY KEY (run_id, control_id));
"""


def run(dsn: str, source_db: str) -> tuple[str, list[dict]]:
    run_id = uuid.uuid4().hex
    out = []
    with psycopg.connect(dsn) as pg:
        pg.execute(DDL)
        imp = pg.execute("SELECT run_id FROM holoo_mirror.import_run WHERE source_db = %s ORDER BY published_at DESC LIMIT 1", (source_db,)).fetchone()
        pg.execute("INSERT INTO analytics.control_run (run_id, source_db, import_run) VALUES (%s, %s, %s)", (run_id, source_db, imp[0] if imp else None))
        for c in CONTROLS:
            v, a = pg.execute(c["sql"], {"db": source_db}).fetchone()
            v, a = float(v or 0), float(a or 0)
            status = "ok" if v == 0 else "alert"
            r = dict(control_id=c["id"], area=c["area"], severity=c["severity"], title=c["title"], status=status, value=v, amount=a,
                     explanation=c["explain"](v, a), refs=c["refs"])
            pg.execute("""INSERT INTO analytics.control_result VALUES (%(run_id)s, %(control_id)s, %(area)s, %(severity)s, %(title)s, %(status)s,
                          %(value)s, %(amount)s, %(explanation)s, %(refs)s)""", {**r, "run_id": run_id})
            out.append(r)
    return run_id, out


def to_markdown(source_db: str, run_id: str, results: list[dict]) -> str:
    sev = {"critical": "🔴", "high": "🟠", "medium": "🟡", "info": "⚪"}
    md = [f"# کنترل‌های خودکار — {source_db}", "", f"- اجرا: `{run_id}` — {_dt.datetime.now():%Y-%m-%d %H:%M}", "",
          "| کد | حوزه | شدت | کنترل | وضعیت | تعداد | مبلغ (ریال)/مقدار دوم | توضیح برای مدیر | مرجع |", "|---|---|---|---|---|---:|---:|---|---|"]
    for r in results:
        md.append(f"| {r['control_id']} | {r['area']} | {sev[r['severity']]} {r['severity']} | {r['title']} | {'✅' if r['status']=='ok' else '⚠️'} | "
                  f"{F(r['value'])} | {F(r['amount'])} | {r['explanation']} | {r['refs']} |")
    return "\n".join(md) + "\n"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg", required=True); ap.add_argument("--source-db", default="holoo1_1404"); ap.add_argument("--report")
    a = ap.parse_args()
    rid, res = run(a.pg, a.source_db)
    md = to_markdown(a.source_db, rid, res)
    if a.report:
        open(a.report, "w", encoding="utf-8").write(md)
    print(md)
