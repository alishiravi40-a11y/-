import os
import pathlib
import sys

import psycopg
import pytest

ROOT = pathlib.Path(__file__).parents[2]
sys.path.insert(0, str(ROOT))
DSN = os.environ.get("HOLOO_PG_TEST_DSN")
SCHEMA = "\n".join((ROOT / "core" / "schema" / f).read_text(encoding="utf-8")
                   for f in ("001_core.sql", "002_decisions.sql", "003_below_cost_alerts.sql", "004_beta.sql"))
ALL_PERMS = ["security.admin", "settings.change", "party.merge", "beta.scheme_manage", "beta.contract_manage", "beta.capacity_override",
             "beta.receipt_manage", "beta.refund", "beta.credit_reallocate", "beta.review"]


from beta.common import make_national_id as nid  # noqa: E402


@pytest.fixture()
def db():
    if not DSN:
        pytest.skip("HOLOO_PG_TEST_DSN not set")
    c = psycopg.connect(DSN, autocommit=True)
    c.execute("DROP SCHEMA IF EXISTS core CASCADE")
    c.execute("DROP SCHEMA IF EXISTS holoo_mirror CASCADE")
    c.execute(SCHEMA)
    c.execute("INSERT INTO core.app_user (username, is_service) VALUES ('admin', false), ('clerk', false), ('importer', true)")
    for p in ALL_PERMS:
        c.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('admin', %s, 'install')", (p,))
    for p in ("beta.receipt_manage", "beta.contract_manage", "beta.review"):
        c.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('importer', %s, 'install')", (p,))
    c.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('clerk', 'beta.receipt_manage', 'install')")
    holder = c.execute("INSERT INTO core.party (name, national_id) VALUES ('scheme holder', %s) RETURNING id", (nid("123456789"),)).fetchone()[0]
    acc = c.execute("INSERT INTO core.company_bank_account (bank_code, account_no, title, holder_party_id) VALUES ('refah', '111', 'scheme account', %s) RETURNING id",
                    (holder,)).fetchone()[0]
    c.execute("INSERT INTO core.beta_scheme (code, title, holder_party_id, company_bank_account_id, created_by) VALUES ('S1', 'scheme 1', %s, %s, 'admin')",
              (holder, acc))
    c.execute("INSERT INTO core.bank_share_rate (scheme_id, effective_from, rate, created_by, reason) VALUES (1, '2025-01-01', 0.06, 'admin', 'initial')")
    yield c
    c.execute("DROP SCHEMA IF EXISTS core CASCADE")
    c.execute("DROP SCHEMA IF EXISTS holoo_mirror CASCADE")
    c.close()


@pytest.fixture()
def customer(db):
    def make(name="customer", prefix="001234567", cap=None):
        pid = db.execute("INSERT INTO core.party (name, name_key, national_id) VALUES (%s, %s, %s) RETURNING id",
                         (name, name.replace(" ", ""), nid(prefix))).fetchone()[0]
        if cap:
            db.execute("""INSERT INTO core.customer_installment_capacity (party_id, max_installment_amount, valid_from, source, recorded_by)
                          VALUES (%s, %s, '2020-01-01', 'beta_system', 'admin')""", (pid, cap))
        return pid
    return make
