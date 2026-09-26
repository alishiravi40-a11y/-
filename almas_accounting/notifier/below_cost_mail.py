"""D-12: deliver below-cost alerts by e-mail — exactly one message per invoice, listing every below-cost line.

The database decides WHAT to send (core.below_cost_alert + core.notification_outbox, created atomically when the
invoice is finalized). This worker only delivers:
  * recipients are read from core.setting('below_cost_alert_emails') at send time (manager-configurable, never
    hard-coded); with none configured the alert stays queued and is flagged as undelivered;
  * the rendered subject/body and the recipients actually used are stored on the outbox row (immutable once sent);
  * failures are retried with back-off; delivery is at-least-once (a crash between SMTP accept and commit can repeat
    one message, never lose it).

SMTP settings come from the environment: ALMAS_SMTP_HOST, ALMAS_SMTP_PORT (587), ALMAS_SMTP_USER, ALMAS_SMTP_PASSWORD,
ALMAS_SMTP_FROM, ALMAS_SMTP_STARTTLS (1/0).  Usage: python -m notifier.below_cost_mail --pg DSN [--loop SECONDS]
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import smtplib
import time
from email.message import EmailMessage

import jdatetime
import psycopg
from psycopg.rows import dict_row

MAX_BACKOFF_MIN = 60


def _money(v) -> str:
    return "—" if v is None else f"{int(round(float(v))):,}"


def _jdate(d) -> str:
    if d is None:
        return "—"
    if isinstance(d, dt.datetime):
        j = jdatetime.datetime.fromgregorian(datetime=d.astimezone())
        return j.strftime("%Y/%m/%d %H:%M")
    return jdatetime.date.fromgregorian(date=d).strftime("%Y/%m/%d")


def render(alert: dict, lines: list[dict]) -> tuple[str, str]:
    """Plain-text Persian e-mail: one message for the whole invoice, one row per below-cost line."""
    subject = f"هشدار فروش زیر آخرین قیمت خرید — فاکتور {alert['invoice_number'] or alert['invoice_id']} ({len(lines)} قلم)"
    out = [
        "فاکتور زیر پیش از ارسال کالا نیاز به بررسی دارد (تصمیم مالک D-12).",
        "",
        f"شماره فاکتور: {alert['invoice_number'] or alert['invoice_id']}",
        f"تاریخ فاکتور: {_jdate(alert['invoice_date'])}",
        f"کانال فروش: {alert['channel']}",
        f"مشتری: {alert['party_name'] or '—'}",
        f"ثبت‌کننده: {alert['finalized_by']}",
        f"مبنای کنترل: آخرین قیمت خرید (D-11)",
        f"مهلت بررسی تا: {_jdate(alert['review_due_at'])}",
        "",
        "اقلام زیر آخرین قیمت خرید (مبالغ به ریال):",
    ]
    for ln in lines:
        out.append(
            f"- ردیف {ln['line_no']}: {ln['item_code']} {ln['item_name']} | تعداد {ln['quantity']:g} | "
            f"قیمت فروش {_money(ln['net_unit_price'])} | آخرین قیمت خرید {_money(ln['unit_cost_last_purchase'])} | "
            f"اختلاف هر واحد {_money(ln['unit_difference'])} | اختلاف ردیف {_money(ln['shortfall_amount'])}")
    out += ["", f"جمع اختلاف فاکتور: {_money(alert['total_shortfall'])} ریال",
            f"شناسه هشدار در سیستم: {alert['id']} — نتیجه بررسی را در سیستم ثبت کنید."]
    return subject, "\n".join(out)


def recipients(pg) -> list[str]:
    raw = pg.execute("SELECT core.setting_value('below_cost_alert_emails')").fetchone()[0] or ""
    return [r.strip() for r in raw.split(",") if r.strip()]


class SmtpSender:
    def __init__(self):
        self.host = os.environ["ALMAS_SMTP_HOST"]
        self.port = int(os.environ.get("ALMAS_SMTP_PORT", "587"))
        self.user = os.environ.get("ALMAS_SMTP_USER")
        self.password = os.environ.get("ALMAS_SMTP_PASSWORD")
        self.sender = os.environ["ALMAS_SMTP_FROM"]
        self.starttls = os.environ.get("ALMAS_SMTP_STARTTLS", "1") == "1"

    def send(self, to: list[str], subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.sender, ", ".join(to), subject
        msg.set_content(body, charset="utf-8")
        with smtplib.SMTP(self.host, self.port, timeout=30) as s:
            if self.starttls:
                s.starttls()
            if self.user:
                s.login(self.user, self.password or "")
            s.send_message(msg)


def dispatch(dsn: str, sender, limit: int = 50) -> dict:
    """Send due alerts. Each row is locked (SKIP LOCKED) so several workers never send the same alert twice."""
    stats = {"sent": 0, "failed": 0, "no_recipient": 0}
    with psycopg.connect(dsn, autocommit=True) as pg:
        to = recipients(pg)
        while stats["sent"] + stats["failed"] + stats["no_recipient"] < limit:
            with pg.transaction():
                row = pg.execute("""SELECT id, ref_id, attempts FROM core.notification_outbox
                                    WHERE kind = 'below_cost_alert' AND channel = 'email' AND status IN ('queued', 'failed')
                                      AND next_attempt_at <= now()
                                    ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1""").fetchone()
                if not row:
                    break
                oid, alert_id, attempts = row
                if not to:
                    pg.execute("""UPDATE core.notification_outbox SET last_error = 'no recipient configured (setting below_cost_alert_emails)',
                                  next_attempt_at = now() + interval '15 minutes' WHERE id = %s""", (oid,))
                    stats["no_recipient"] += 1
                    continue
                cur = pg.cursor(row_factory=dict_row)
                alert = cur.execute("SELECT * FROM core.below_cost_alert_status WHERE id = %s", (alert_id,)).fetchone()
                lines = cur.execute("SELECT * FROM core.below_cost_alert_line WHERE alert_id = %s ORDER BY line_no", (alert_id,)).fetchall()
                subject, body = render(alert, lines)
                try:
                    sender.send(to, subject, body)
                except Exception as e:   # delivery problem: keep queued with back-off, record the error
                    backoff = min(2 ** attempts, MAX_BACKOFF_MIN)
                    pg.execute("""UPDATE core.notification_outbox SET status = 'failed', attempts = attempts + 1, last_error = %s,
                                  next_attempt_at = now() + make_interval(mins => %s) WHERE id = %s""", (str(e)[:500], backoff, oid))
                    stats["failed"] += 1
                    continue
                pg.execute("""UPDATE core.notification_outbox SET status = 'sent', attempts = attempts + 1, sent_at = now(),
                              last_error = NULL, recipients = %s, subject = %s, body = %s WHERE id = %s""", (to, subject, body, oid))
                stats["sent"] += 1
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pg", default=os.environ.get("ALMAS_PG_DSN"), required=not os.environ.get("ALMAS_PG_DSN"))
    ap.add_argument("--loop", type=int, default=0, help="poll every N seconds (0 = run once)")
    a = ap.parse_args()
    sender = SmtpSender()
    while True:
        print(dispatch(a.pg, sender), flush=True)
        if not a.loop:
            break
        time.sleep(a.loop)


if __name__ == "__main__":
    main()
