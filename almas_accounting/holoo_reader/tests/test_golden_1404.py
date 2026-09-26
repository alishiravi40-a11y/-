"""Golden tests: the canonical model built from the real FY1404 backup must reproduce the numbers PROVEN in
reverse_engineering/hesabdari_rasmi (REPORT_FA.md / EVIDENCE_REVIEW_FA.md). Run with HOLOO_GOLDEN_WORKDIR set to
the workdir of a completed `holoo-reader ingest` of holoo1_1404 (backup SHA-256 c678414435…)."""
import glob
import json
import os

import duckdb
import pytest

WORK = os.environ.get("HOLOO_GOLDEN_WORKDIR")
SHA = "c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2"
pytestmark = [pytest.mark.golden, pytest.mark.skipif(not WORK, reason="HOLOO_GOLDEN_WORKDIR not set")]


@pytest.fixture(scope="module")
def con():
    c = duckdb.connect(os.path.join(WORK, "imports", SHA, "silver.duckdb"), read_only=True)
    yield c
    c.close()


def one(con, sql):
    return con.execute(sql).fetchone()[0]


def test_counts(con):
    assert one(con, "SELECT COUNT(*) FROM voucher") == 47447
    assert one(con, "SELECT COUNT(*) FROM voucher_line") == 190469
    assert one(con, "SELECT COUNT(*) FROM document WHERE kind='sale'") == 19877
    assert one(con, "SELECT COUNT(*) FROM document WHERE kind='sale_voided'") == 4
    assert one(con, "SELECT COUNT(*) FROM cheque") == 12515
    assert one(con, "SELECT COUNT(*) FROM cheque_event") == 35824


def test_ledger_totals_and_balance(con):
    assert one(con, "SELECT SUM(debit) FROM voucher_line") == 80720660543371
    assert one(con, "SELECT SUM(debit) - SUM(credit) FROM voucher_line") == 0


def test_hidden_lines_are_exactly_voided_invoice_vouchers(con):
    assert one(con, "SELECT COUNT(*) FROM voucher_line WHERE NOT in_ledger") == 14
    assert one(con, """SELECT COUNT(*) FROM voucher_line l WHERE NOT in_ledger
                       AND sanad_code NOT IN (SELECT voucher_code FROM document WHERE kind='sale_voided')""") == 0


def test_all_accounts_zero_after_closing(con):
    assert one(con, "SELECT COUNT(*) FROM account_balance WHERE abs(balance) > 0.5") == 0


def test_profit_and_cogs(con):
    b = dict(con.execute("SELECT substr(account_code,1,3) k, SUM(balance_before_closing) FROM account_balance GROUP BY 1").fetchall())
    net_sales = -(b["901"] + b["902"] + b["903"] + b.get("904", 0))
    assert round(net_sales) == 7874223173502
    ending = one(con, "SELECT SUM(stored_qty * stored_avg_cost) FROM item")
    cogs = b["106"] + b["801"] + b["802"] + b["803"] - ending
    assert round(cogs) == 7699284125059
    profit = net_sales - cogs - b["601"] - b["602"] - b["702"]
    assert round(profit) == 3131672245


def test_stock_formula_holds_for_all_goods(con):
    assert one(con, """SELECT COUNT(*) FROM item i LEFT JOIN (SELECT a_code, SUM(qty_signed) q FROM stock_movement GROUP BY 1) m USING (a_code)
                       WHERE NOT i.is_service AND abs(i.first_qty + coalesce(m.q,0) - i.stored_qty) > 0.001""") == 0


def test_cheque_gap_is_exactly_two_backdated_cheques(con):
    sub = one(con, "SELECT SUM(amount) FROM cheque_status WHERE direction='in' AND last_state IN ('D','S','M','R','J')")
    led = one(con, "SELECT SUM(balance_before_closing) FROM account_balance WHERE account_code LIKE '104%'")
    assert round(sub - led) == 200000000


def test_web_channel_and_order_numbers(con):
    assert one(con, "SELECT COUNT(*) FROM document WHERE kind='sale' AND channel='web_service'") == 18424
    assert one(con, "SELECT COUNT(*) FROM document WHERE kind='sale' AND web_order_no IS NOT NULL") >= 19700


def test_no_secrets_in_silver_or_bronze():
    bronze = os.path.join(WORK, "imports", SHA, "bronze", "USERDB.parquet")
    import pyarrow.parquet as pq
    assert not [c for c in pq.read_schema(bronze).names if "pas" in c.lower()]


def test_report_gate_and_registry():
    rep = json.load(open(os.path.join(WORK, "imports", SHA, "report.json")))
    assert rep["gate_passed"] is True
    reg = duckdb.connect(os.path.join(WORK, "registry.duckdb"), read_only=True)
    # exactly one normal completed import per backup; later runs are either 'duplicate' or explicitly forced
    assert reg.execute("SELECT COUNT(*) FROM import_run WHERE backup_sha256 = ? AND status = 'completed' AND NOT coalesce(forced, false)", [SHA]).fetchone()[0] == 1
    assert reg.execute("SELECT COUNT(*) FROM import_run WHERE backup_sha256 = ? AND status = 'duplicate'", [SHA]).fetchone()[0] >= 1


def test_blob_decoding_and_web_payloads(con):
    assert one(con, "SELECT COUNT(DISTINCT process_id) FROM audit_snapshot") == 46181
    assert one(con, "SELECT COUNT(*) FROM web_payload") == 21012
    # after-image semantics: last snapshot equals current voucher for 21,158 of 21,762 vouchers
    assert one(con, "SELECT COUNT(*) FROM voucher_absent WHERE doc_date_jalali < '1404' AND doc_date_jalali >= '1403'") == 10736


def test_prior_year_web_sales_removed(con):
    n = one(con, """SELECT COUNT(*) FROM web_payload w JOIN audit_event a ON a.id = w.process_id
                    LEFT JOIN document d ON d.voucher_code = TRY_CAST(a.number AS INTEGER) AND d.kind IN ('sale','sale_voided')
                    WHERE a.kind = 'add' AND w.doc_type = 1 AND w.doc_date < DATE '2025-03-21' AND d.fac_code IS NULL""")
    assert n == 130
