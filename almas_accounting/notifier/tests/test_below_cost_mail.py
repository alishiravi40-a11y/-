"""D-12 e-mail delivery: one message per invoice through a real (local) SMTP conversation. Needs HOLOO_PG_TEST_DSN."""
import email
import email.policy
import os
import pathlib
import socketserver
import sys
import threading

import psycopg
import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parents[2]))
from notifier import below_cost_mail as M  # noqa: E402

DSN = os.environ.get("HOLOO_PG_TEST_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="HOLOO_PG_TEST_DSN not set")
SCHEMA = "\n".join((pathlib.Path(__file__).parents[2] / "core" / "schema" / f).read_text(encoding="utf-8")
                   for f in ("001_core.sql", "002_decisions.sql", "003_below_cost_alerts.sql"))


class _SMTP(socketserver.StreamRequestHandler):
    """Minimal SMTP server: records every accepted message."""
    def handle(self):
        w = lambda s: self.wfile.write((s + "\r\n").encode())
        w("220 test"); rcpt, data = [], None
        while True:
            line = self.rfile.readline().decode(errors="replace").rstrip("\r\n")
            cmd = line[:4].upper()
            if cmd in ("EHLO", "HELO"):
                w("250 ok")
            elif cmd == "MAIL":
                w("250 ok")
            elif cmd == "RCPT":
                rcpt.append(line.split(":", 1)[1].strip(" <>")); w("250 ok")
            elif cmd == "DATA":
                w("354 go"); buf = []
                while (l := self.rfile.readline()) not in (b".\r\n", b".\n", b""):
                    buf.append(l[1:] if l.startswith(b"..") else l)
                self.server.messages.append((rcpt, email.message_from_bytes(b"".join(buf), policy=email.policy.default)))
                rcpt = []; w("250 queued")
            elif cmd == "QUIT":
                w("221 bye"); return
            elif cmd == "RSET" or cmd == "NOOP":
                w("250 ok")
            else:
                w("502 no")
            if not line:
                return


@pytest.fixture()
def smtp(monkeypatch):
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _SMTP); srv.messages = []
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("ALMAS_SMTP_HOST", "127.0.0.1"); monkeypatch.setenv("ALMAS_SMTP_PORT", str(srv.server_address[1]))
    monkeypatch.setenv("ALMAS_SMTP_FROM", "alerts@almas.test"); monkeypatch.setenv("ALMAS_SMTP_STARTTLS", "0")
    yield srv
    srv.shutdown()


@pytest.fixture()
def db():
    c = psycopg.connect(DSN, autocommit=True)
    c.execute("DROP SCHEMA IF EXISTS core CASCADE"); c.execute(SCHEMA)
    c.execute("INSERT INTO core.fiscal_year (code, starts_on, ends_on) VALUES ('1405', '2026-03-21', '2027-03-21')")
    c.execute("INSERT INTO core.period (fiscal_year_id, code, starts_on, ends_on) VALUES (1, '1405-01', '2026-03-21', '2027-03-21')")
    c.execute("INSERT INTO core.app_user (username, is_service) VALUES ('owner', false), ('webshop', true)")
    c.execute("""INSERT INTO core.user_permission (username, permission, granted_by) VALUES
                 ('owner', 'security.admin', 'install'), ('owner', 'settings.change', 'install')""")
    c.execute("INSERT INTO core.party (name) VALUES ('مشتری الف')")
    c.execute("INSERT INTO core.item (code, name) VALUES ('0201574', 'گوشی نمونه'), ('0301001', 'قاب نمونه')")
    c.execute("""INSERT INTO core.purchase_price (item_id, purchase_date, unit_cost, source) VALUES
                 (1, '2026-04-01', 77000000, 'K-5134'), (2, '2026-04-01', 500000, 'K-5135')""")
    yield c
    c.execute("DROP SCHEMA core CASCADE")


def web_invoice(c, number, lines):
    iid = c.execute("""INSERT INTO core.sales_invoice (fiscal_year_id, number, invoice_date, party_id, channel, created_by)
                       VALUES (1, %s, '2026-04-20', 1, 'web', 'webshop') RETURNING id""", (number,)).fetchone()[0]
    for n, (item, qty, price) in enumerate(lines, 1):
        c.execute("INSERT INTO core.sales_invoice_line (invoice_id, line_no, item_id, quantity, unit_price) VALUES (%s, %s, %s, %s, %s)",
                  (iid, n, item, qty, price))
    c.execute("UPDATE core.sales_invoice SET status = 'final', finalized_by = 'webshop' WHERE id = %s", (iid,))
    return iid


def test_one_email_per_invoice_listing_every_line(db, smtp):
    db.execute("SELECT core.change_setting('below_cost_alert_emails', 'boss@almas.test, audit@almas.test', 'owner', 'D-12')")
    web_invoice(db, 112598, [(1, 1, 76500000), (2, 2, 450000), (1, 1, 80000000)])   # two lines below last purchase
    web_invoice(db, 112599, [(2, 1, 400000)])
    assert M.dispatch(DSN, M.SmtpSender()) == {"sent": 2, "failed": 0, "no_recipient": 0}
    assert len(smtp.messages) == 2
    rcpt, msg = smtp.messages[0]
    assert rcpt == ["boss@almas.test", "audit@almas.test"]
    body = msg.get_content()
    assert "112598" in msg["Subject"] and "(2 قلم)" in msg["Subject"]
    assert "76,500,000" in body and "77,000,000" in body and "500,000" in body   # sale price, last purchase, difference
    assert "450,000" in body and "جمع اختلاف فاکتور: 600,000" in body
    assert "80,000,000" not in body                                              # line above cost is not listed
    row = db.execute("SELECT status, recipients, subject FROM core.notification_outbox ORDER BY id LIMIT 1").fetchone()
    assert row[0] == "sent" and row[1] == ["boss@almas.test", "audit@almas.test"] and "112598" in row[2]
    assert M.dispatch(DSN, M.SmtpSender())["sent"] == 0                           # never sent twice
    assert len(smtp.messages) == 2


def test_no_recipient_keeps_alert_queued_and_flagged(db, smtp):
    web_invoice(db, 1, [(1, 1, 1)])
    assert M.dispatch(DSN, M.SmtpSender()) == {"sent": 0, "failed": 0, "no_recipient": 1}
    assert db.execute("SELECT email_status, email_undelivered FROM core.below_cost_alert_status").fetchone() == ("queued", True)
    # the manager configures the address later → the pending alert goes to it
    db.execute("SELECT core.change_setting('below_cost_alert_emails', 'boss@almas.test', 'owner', 'set recipient')")
    db.execute("UPDATE core.notification_outbox SET next_attempt_at = now()")
    assert M.dispatch(DSN, M.SmtpSender())["sent"] == 1 and smtp.messages[0][0] == ["boss@almas.test"]


def test_smtp_failure_is_recorded_and_retried(db):
    db.execute("SELECT core.change_setting('below_cost_alert_emails', 'boss@almas.test', 'owner', 'D-12')")
    web_invoice(db, 1, [(1, 1, 1)])

    class Down:
        def send(self, *a):
            raise ConnectionRefusedError("smtp down")

    assert M.dispatch(DSN, Down())["failed"] == 1
    st, attempts, err = db.execute("SELECT status, attempts, last_error FROM core.notification_outbox").fetchone()
    assert (st, attempts) == ("failed", 1) and "smtp down" in err
    assert db.execute("SELECT count(*) FROM core.below_cost_alert").fetchone()[0] == 1       # internal record intact
