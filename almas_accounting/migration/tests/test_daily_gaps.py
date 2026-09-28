"""Daily work without SQL (core 030): setup of warehouses / cash boxes / bank accounts, bank statement import, fiscal year
creation, the Holoo import queue, the statement file reader. Synthetic data only."""
import datetime as dt
import io

import jdatetime
import psycopg
import pytest
from psycopg.types.json import Jsonb

from migration.tests.test_daily_operations import acct, office  # noqa: F401  (same synthetic office)
from treasury import statement_file as SF

Raised = psycopg.errors.RaiseException
Denied = psycopg.errors.InsufficientPrivilege


@pytest.fixture()
def setup(office):
    db = office["db"]
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('acc', 'setup.manage', 't'), ('acc', 'bank.statement_import', 't'), "
               "('acc', 'bank.reconcile', 't'), ('acc', 'holoo.import', 't')")
    return office


def one(db, sql, *a):
    return db.execute(sql, a).fetchone()[0]


def test_warehouses_cashboxes_and_bank_accounts_are_set_up_from_the_application(setup):
    db = setup["db"]
    w = one(db, "SELECT core.warehouse_save(NULL, NULL, 'انبار شعبه', true, 'acc')")
    assert one(db, "SELECT core.warehouse_save(%s, NULL, 'انبار شعبه دو', true, 'acc')", w) == w
    with pytest.raises(Denied):
        db.execute("SELECT core.warehouse_save(NULL, NULL, 'x', true, 'viewer')")
    item = one(db, "INSERT INTO core.item (code, name, model_key) VALUES ('P1', 'کالا', 'k') RETURNING id")
    db.execute("""INSERT INTO core.stock_movement (item_id, warehouse_id, kind, effective_date, qty, unit_price, source, created_by)
                  VALUES (%s, %s, 'opening', '2026-03-21', 2, 10, 'test', 't')""", (item, w))
    with pytest.raises(Raised, match="موجودی دارد"):
        db.execute("SELECT core.warehouse_save(%s, NULL, 'انبار شعبه دو', false, 'acc')", (w,))

    cash2 = acct(db, "1010002", "صندوق فروشگاه", "101", 3, nature="debit")
    box = one(db, "SELECT core.cashbox_save(NULL, 'صندوق فروشگاه', '1010002', NULL, 'acc')")
    assert one(db, "SELECT cash_account_id FROM core.cashbox WHERE id = %s", box) == cash2
    with pytest.raises(Raised, match="حساب اشخاص"):
        db.execute("SELECT core.cashbox_save(NULL, 'غلط', '1030008', NULL, 'acc')")
    with pytest.raises(Raised, match="وصل است"):                      # the main cash box already uses 1010001
        db.execute("SELECT core.cashbox_save(NULL, 'تکراری', '1010001', NULL, 'acc')")
    with pytest.raises(Raised, match="معین آخر"):
        db.execute("SELECT core.cashbox_save(NULL, 'غلط', '101', NULL, 'acc')")
    # a cash box whose account has postings keeps it
    db.execute("SELECT core.journal_post_manual('2026-04-05', 't', %s, 'acc')",
               (Jsonb([{"account_code": "1010002", "debit": 5}, {"account_code": "1020001", "credit": 5}]),))
    acct(db, "1010003", "صندوق سوم", "101", 3, nature="debit")
    with pytest.raises(Raised, match="گردش دارد"):
        db.execute("SELECT core.cashbox_save(%s, 'صندوق فروشگاه', '1010003', NULL, 'acc')", (box,))
    assert one(db, "SELECT core.cashbox_save(%s, 'صندوق فروشگاه (نام تازه)', '1010002', NULL, 'acc')", box) == box

    acct(db, "1020002", "بانک صادرات", "102", 3, nature="debit")
    b = one(db, "SELECT core.bank_account_save(NULL, 'saderat', '555', 'صادرات ۵۵۵', '1020002', NULL, NULL, NULL, true, 'acc')")
    ov = one(db, "SELECT core.setup_overview()")
    assert [x["title"] for x in ov["bank_accounts"] if x["bank_account_id"] == b] == ["صادرات ۵۵۵"]
    assert {x["name"] for x in ov["cashboxes"]} >= {"صندوق فروشگاه (نام تازه)"}
    assert one(db, "SELECT count(*) FROM core.list_money_accounts() WHERE name IN ('صادرات ۵۵۵', 'صندوق فروشگاه (نام تازه)')") == 2
    assert one(db, "SELECT count(*) FROM core.audit_event WHERE object_type IN ('warehouse', 'cashbox', 'company_bank_account')") >= 5


LINES = [
    {"date": "2026-04-01", "jdate": "1405/01/12", "time": "10:00", "doc_no": "1", "deposit": 1000, "withdrawal": 0, "balance": 11000, "description": "واریز"},
    {"date": "2026-04-02", "jdate": "1405/01/13", "time": "11:00", "doc_no": "2", "deposit": 0, "withdrawal": 5000, "balance": 6000, "description": "کارمزد پیامک"},
]


def test_a_bank_statement_is_imported_once_and_overlaps_add_only_new_lines(setup):
    db = setup["db"]
    acc = one(db, "SELECT id FROM core.company_bank_account")
    r = one(db, "SELECT core.bank_statement_import(%s, 's1.csv', 'sha1', %s, 'acc')", acc, Jsonb(LINES))
    assert r["new_lines"] == 2 and r["balance_chain_ok"] and r["by_class"] == {"other_deposit": 1, "bank_fee": 1}
    assert one(db, "SELECT core.bank_statement_import(%s, 's1.csv', 'sha1', %s, 'acc')", acc, Jsonb(LINES))["status"] == "duplicate"
    more = LINES[1:] + [{"date": "2026-04-03", "jdate": "1405/01/14", "doc_no": "3", "deposit": 0, "withdrawal": 1000, "balance": 5000, "description": "چک"}]
    r2 = one(db, "SELECT core.bank_statement_import(%s, 's2.csv', 'sha2', %s, 'acc')", acc, Jsonb(more))
    assert (r2["new_lines"], r2["known_lines"]) == (1, 1)
    assert one(db, "SELECT count(*) FROM core.bank_statement_line") == 3
    broken = [{**LINES[0], "doc_no": "9", "date": "2026-04-20", "balance": 1}, {**LINES[1], "doc_no": "10", "date": "2026-04-20", "withdrawal": 7000, "balance": 999}]
    assert one(db, "SELECT core.bank_statement_import(%s, 's3.csv', 'sha3', %s, 'acc')", acc, Jsonb(broken))["balance_chain_ok"] is False
    with pytest.raises(Raised, match="یکی از واریز یا برداشت"):
        db.execute("SELECT core.bank_statement_import(%s, 's4', 'sha4', %s, 'acc')", (acc, Jsonb([{**LINES[0], "withdrawal": 5}])))
    with pytest.raises(Denied):
        db.execute("SELECT core.bank_statement_import(%s, 's5', 'sha5', %s, 'viewer')", (acc, Jsonb(LINES)))
    with pytest.raises(Raised, match="never deleted"):
        db.execute("DELETE FROM core.bank_statement_line")
    files = db.execute("SELECT file_name, new_lines FROM core.bank_statement_files(%s)", (acc,)).fetchall()
    assert files[-1] == ("s1.csv", 2)
    # the lines match the book automatically where unambiguous (same rules as treasury/bank_recon)
    db.execute("""SELECT core.post_treasury(%s, '2026-04-02', 'acc', 'fee')""",
               (Jsonb({"kind": "bank_fee", "money_account_id": setup["bank"], "counter": [{"account_id": setup["cash"], "amount": 5000}]}),))
    auto = one(db, "SELECT core.bank_auto_reconcile(%s, 'acc')", acc)
    assert auto["exact"] == 1
    g = db.execute("SELECT group_id, amount FROM core.bank_recon_groups(%s, '2026-03-21', '2026-04-30')", (acc,)).fetchall()
    assert len(g) == 1 and g[0][1] == -5000


def fy_dates(code: int):
    starts = [jdatetime.date(code, m, 1).togregorian() for m in range(1, 13)]
    return starts, jdatetime.date(code + 1, 1, 1).togregorian() - dt.timedelta(days=1)


def test_the_next_fiscal_year_is_created_from_the_application(setup):
    db = setup["db"]
    s, e = fy_dates(1406)
    fid = one(db, "SELECT core.fiscal_year_create('1406', %s, %s, 'boss')", s, e)
    assert one(db, "SELECT count(*) FROM core.period WHERE fiscal_year_id = %s AND status = 'open'", fid) == 12
    assert one(db, "SELECT min(starts_on) FROM core.period WHERE fiscal_year_id = %s", fid) == one(db, "SELECT ends_on + 1 FROM core.fiscal_year WHERE code = '1405'")
    with pytest.raises(Raised, match="وجود دارد"):
        db.execute("SELECT core.fiscal_year_create('1406', %s, %s, 'boss')", (s, e))
    s8, e8 = fy_dates(1408)
    with pytest.raises(Raised, match="درست پس از"):                    # 1407 skipped
        db.execute("SELECT core.fiscal_year_create('1408', %s, %s, 'boss')", (s8, e8))
    with pytest.raises(Denied):
        db.execute("SELECT core.fiscal_year_create('1407', %s, %s, 'acc')", (*fy_dates(1407),))
    ov = {r[1]: r for r in db.execute("SELECT * FROM core.years_overview()")}
    assert ov["1406"][4] == "open" and ov["1406"][5] == 12


def test_a_holoo_backup_is_queued_one_at_a_time(setup):
    db = setup["db"]
    b = one(db, "SELECT core.import_queue('20260928_ab12_holoo.bak', 'acc')")
    assert one(db, "SELECT status FROM core.holoo_import_batch WHERE id = %s", b) == "queued"
    with pytest.raises(Raised, match="در صف"):
        db.execute("SELECT core.import_queue('another.bak', 'acc')")
    with pytest.raises(Raised, match="نام فایل"):
        db.execute("UPDATE core.holoo_import_batch SET status = 'failed' WHERE id = %s", (b,))
        db.execute("SELECT core.import_queue('../etc/passwd', 'acc')")
    with pytest.raises(Denied):
        db.execute("SELECT core.import_queue('x.bak', 'viewer')")


def test_a_queued_import_whose_file_is_gone_is_closed(setup, tmp_path):
    from migration import import_backup
    from migration.tests.conftest import DSN
    db = setup["db"]
    b = one(db, "SELECT core.import_queue('missing.bak', 'acc')")
    assert import_backup.run_queued(DSN, str(tmp_path), str(tmp_path / "work"))["status"] == "failed"
    assert one(db, "SELECT status FROM core.holoo_import_batch WHERE id = %s", b) == "failed"
    assert import_backup.run_queued(DSN, str(tmp_path), str(tmp_path / "work")) is None


# ---------- statement files (bank exports differ; the header is found by its Persian names) ----------
def test_statement_file_reader_csv_xlsx_and_errors():
    csv_text = ("گزارش حساب\n"
                "ردیف,تاریخ,زمان,شماره سند,شرح,واریز,برداشت,موجودی\n"
                '1,۱۴۰۵/۰۱/۱۲,10:00,55,واریز نقدی,"۱,۰۰۰",,"۱۱٬۰۰۰"\n'
                "2,1405/01/13,11:00,56,کارمزد,,500,10500\n"
                "جمع,,,,,1000,500,\n")
    lines = SF.read_statement(csv_text.encode("utf-8"), "s.csv")
    assert [(x["date"], x["deposit"], x["withdrawal"], x["balance"]) for x in lines] == [("2026-04-01", 1000, 0, 11000), ("2026-04-02", 0, 500, 10500)]
    assert lines[0]["natural_key"] == "55|1405/01/12|10:00|1000|0|11000"
    tsv = "تاریخ\tبستانکار\tبدهکار\tمانده\tتوضیحات\n2026-04-01\t700\t0\t700\tسود\n"
    assert SF.read_statement(tsv.encode("utf-8"), "s.txt")[0]["jdate"] == "1405/01/12"
    import openpyxl
    wb = openpyxl.Workbook(); ws = wb.active
    ws.append(["تاریخ", "واریز", "برداشت", "موجودی", "شرح"]); ws.append(["1405/01/12", 2000, None, 2000, "واریز"]); ws.append([dt.datetime(2026, 4, 2), None, 300, 1700, "خرید"])
    buf = io.BytesIO(); wb.save(buf)
    x = SF.read_statement(buf.getvalue(), "s.xlsx")
    assert [(r["date"], r["deposit"], r["withdrawal"]) for r in x] == [("2026-04-01", 2000, 0), ("2026-04-02", 0, 300)]
    with pytest.raises(SF.StatementError, match="سطر عنوان"):
        SF.read_statement("a,b\n1,2\n".encode(), "x.csv")
    with pytest.raises(SF.StatementError, match="عدد نیست"):
        SF.read_statement("تاریخ,واریز,برداشت\n1405/01/12,abc,\n".encode(), "x.csv")
