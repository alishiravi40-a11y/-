import os
import pathlib
import sys

import psycopg
import pytest

ROOT = pathlib.Path(__file__).parents[2]
sys.path.insert(0, str(ROOT))
DSN = os.environ.get("HOLOO_PG_TEST_DSN")
SCHEMA = "\n".join((ROOT / "core" / "schema" / f).read_text(encoding="utf-8")
                   for f in ("001_core.sql", "002_decisions.sql", "003_below_cost_alerts.sql", "004_beta.sql", "005_legacy_ledger.sql",
                             "006_posting.sql", "007_treasury.sql", "008_receivables.sql",
                             "009_reports.sql", "010_bank_reconciliation.sql", "011_year_end.sql", "012_inventory.sql", "013_ai_catalog.sql", "014_tax.sql", "015_commercial_documents.sql", "016_returns.sql", "017_control_inbox.sql",
                             "018_document_api.sql", "019_forms_support.sql", "020_management_reports.sql"))
MIRROR = """
CREATE SCHEMA holoo_mirror;
CREATE TABLE holoo_mirror.import_run (run_id text PRIMARY KEY, source_db text);
CREATE TABLE holoo_mirror.person (source_db text, c_code text, name text, name_key text, national_code text, mobile text,
  debit_account text, credit_account text, source_row_hash text, removed_run text, PRIMARY KEY (source_db, c_code));
CREATE TABLE holoo_mirror.account (source_db text, code text, name text, parent_code text, nature int, group_code int, role_type int,
  removed_run text, PRIMARY KEY (source_db, code));
CREATE TABLE holoo_mirror.voucher (source_db text, sanad_code int, number int, doc_date date, state text, comment text, removed_run text,
  PRIMARY KEY (source_db, sanad_code));
CREATE TABLE holoo_mirror.voucher_line (source_db text, sanad_code int, line_index int, account_code text, debit numeric, credit numeric,
  description text, in_ledger boolean, removed_run text);
"""


@pytest.fixture()
def db():
    if not DSN:
        pytest.skip("HOLOO_PG_TEST_DSN not set")
    c = psycopg.connect(DSN, autocommit=True)
    c.execute("DROP SCHEMA IF EXISTS core CASCADE"); c.execute("DROP SCHEMA IF EXISTS holoo_mirror CASCADE")
    c.execute(SCHEMA); c.execute(MIRROR)
    yield c
    c.execute("DROP SCHEMA IF EXISTS core CASCADE"); c.execute("DROP SCHEMA IF EXISTS holoo_mirror CASCADE")
    c.close()
