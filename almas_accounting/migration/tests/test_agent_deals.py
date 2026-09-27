"""Agent deals made in the BANK PANEL (D-25), base amount owed to the agent (D-22), attribution by evidence + review, and
settlement by bank transfer or Dornatel wallet charge (core 022). Synthetic data only."""
import datetime as dt

import psycopg
import pytest
from psycopg.types.json import Jsonb

from beta import snapshot_import
from beta.common import make_national_id as nid

Denied = psycopg.errors.InsufficientPrivilege
Raised = psycopg.errors.RaiseException
C1, C2, R1, R2 = nid("001234567"), nid("002345678"), nid("004444444"), nid("005555555")
TODAY = dt.date.today()


def grant(db, user, *perms, ai=False):
    db.execute("INSERT INTO core.app_user (username, is_ai_agent) VALUES (%s, %s) ON CONFLICT DO NOTHING", (user, ai))
    for p in perms:
        db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES (%s, %s, 'install')", (user, p))


@pytest.fixture()
def env(db):
    grant(db, "admin", "security.admin", "settings.change", "agent.manage", "agent.entitlement", "agent.settle", "agent.deal_manage",
          "agent.deal_approve", "agent.attribute", "agent.identity", "beta.contract_manage", "beta.receipt_manage")
    grant(db, "ai", "agent.deal_approve", "agent.attribute", ai=True)
    holder = db.execute("INSERT INTO core.party (name, national_id) VALUES ('holder', %s) RETURNING id", (nid("123456789"),)).fetchone()[0]
    acc = db.execute("INSERT INTO core.company_bank_account (bank_code, account_no, title, holder_party_id) VALUES ('refah', '111', 'scheme', %s) RETURNING id",
                     (holder,)).fetchone()[0]
    db.execute("INSERT INTO core.beta_scheme (code, title, holder_party_id, company_bank_account_id, created_by) VALUES ('S1', 's', %s, %s, 'admin')", (holder, acc))
    a1 = db.execute("SELECT core.agent_create('A1', 'agent one', NULL, 'Fars', 'Shiraz', 'admin')").fetchone()[0]
    a2 = db.execute("SELECT core.agent_create('A2', 'agent two', NULL, 'Gilan', 'Rasht', 'admin')").fetchone()[0]
    db.execute("INSERT INTO core.app_user (username) VALUES ('ag1'), ('ag2')")
    db.execute("SELECT core.agent_bind_user('ag1', %s, 'admin')", (a1,))
    db.execute("SELECT core.agent_bind_user('ag2', %s, 'admin')", (a2,))
    return {"db": db, "a1": a1, "a2": a2, "account": acc}


def panel_export(db, rows, sha="f1"):
    """A bank-panel export (E15/E28 shape) with the registrar of each sale."""
    out = []
    for ref, nc, total, n, registrar in rows:
        out.append({"bank_contract_id": ref, "nc": nc, "name": "customer", "account": None,
                    "registered_at": dt.datetime.combine(TODAY - dt.timedelta(days=1), dt.time(10)), "total": total, "count": n,
                    "first_due": "1405/08/30", "first_amount": total // n, "collected": 0, "overdue": 0, "deleted": 0, "collected_amount": 0,
                    "registrar_nc": registrar, "registrar_name": "registrar", "agency": None})
    return snapshot_import.import_rows(db, out, sha, "panel.xlsx", 1, "admin")


def declare(db, user="ag1", nc=C1, base=1_000_000_000, total=None, ref=None, agent=None, source="agent_invoice", sale_date=None):
    return db.execute("SELECT core.agent_deal_declare(%s, %s, 'customer', %s, 'refrigerator', %s, %s, 'invoice 17', %s, %s, %s)",
                      (user, nc, sale_date or TODAY - dt.timedelta(days=1), base, source, total, ref, agent)).fetchone()[0]


def inbox(db, as_of=None):
    return {r[1]: (r[4], r[5]) for r in db.execute("SELECT * FROM core.control_inbox(%s)", (as_of or TODAY,))}


def queue(db):
    return {r[0]: r[1:] for r in db.execute("SELECT ref, state, proposed_agent_id, proposed_deal_id FROM core.bank_sale_attribution_queue")}


# ---------- the whole chain: panel sale → attribution → base owed → bank + wallet settlement ----------
def test_panel_sale_to_settled_agent_with_full_lineage(env):
    db = env["db"]
    assert panel_export(db, [("B-100", C1, 1_600_000_000, 12, R1)])["contracts_created"] == 1
    assert queue(db)["B-100"][0] == "no_candidate" and inbox(db)["AG-09"] == (1, 1_600_000_000)          # nobody known yet: review
    db.execute("SELECT core.agent_identity_record(%s, 1, %s, 'registrar', %s, NULL, 'access letter 12', 'admin')", (env["a1"], R1, TODAY - dt.timedelta(days=30)))
    deal = declare(db)                                                                                     # the agent: base 1,000,000,000
    assert queue(db)["B-100"] == ("proposed", env["a1"], deal) and inbox(db)["AG-11"][0] == 1
    db.execute("SELECT core.agent_attribute(1, 'panel_export', 'B-100', %s, %s, 'panel_identity', 'admin')", (env["a1"], deal))
    cid = db.execute("SELECT id FROM core.installment_contract WHERE bank_contract_id = 'B-100'").fetchone()[0]
    assert db.execute("SELECT agent_id FROM core.contract_owner WHERE contract_id = %s", (cid,)).fetchone()[0] == env["a1"]
    assert inbox(db)["AG-01"] == (1, 1_600_000_000)                                                         # attributed, base not approved yet
    ent = db.execute("SELECT core.agent_deal_approve(%s, 'admin')", (deal,)).fetchone()[0]
    assert db.execute("SELECT basis, amount FROM core.agent_entitlement WHERE id = %s", (ent,)).fetchone() == ("deal_base", 1_000_000_000)   # base, not Beta total
    box = inbox(db)
    assert box["AG-01"][0] == 0 and box["AG-16"] == (1, 600_000_000)                                        # difference shown, never called profit
    db.execute("SELECT core.agent_settle(%s, 'bank_transfer', 400000000, current_date, %s, 'admin', %s, 'PAYA-1')",
               (env["a1"], Jsonb([{"entitlement_id": ent, "amount": 400_000_000}]), env["account"]))
    db.execute("""SELECT core.agent_settle(%s, 'dornatel_wallet', 600000000, current_date, %s, 'admin',
                                           p_dornatel_txn_ref => 'DN-9001', p_wallet_account_ref => 'W-A1', p_evidence_ref => 'dornatel screenshot 3')""",
               (env["a1"], Jsonb([{"entitlement_id": ent, "amount": 600_000_000}])))
    lin = db.execute("""SELECT agent_code, customer_national_id, bank_ref, base_amount, beta_total, unallocated_difference, contract_id, owed_to_agent,
                               paid_by_bank, paid_by_wallet, open_to_agent FROM core.agent_deal_lineage WHERE deal_id = %s""", (deal,)).fetchone()
    assert lin == ("A1", C1, "B-100", 1_000_000_000, 1_600_000_000, 600_000_000, cid, 1_000_000_000, 400_000_000, 600_000_000, 0)
    assert db.execute("SELECT count(*) FROM core.audit_event WHERE object_type IN ('agent_deal', 'bank_sale', 'agent_settlement')").fetchone()[0] >= 5
    mine = db.execute("SELECT deal_id, base_amount, matched_with_bank, open_amount FROM core.agent_my_deals('ag1')").fetchall()
    assert mine == [(deal, 1_000_000_000, True, 0)] and db.execute("SELECT count(*) FROM core.agent_my_deals('ag2')").fetchone()[0] == 0


# ---------- attribution is never guessed ----------
def test_attribution_needs_evidence_and_conflicts_go_to_review(env):
    db = env["db"]
    panel_export(db, [("B-1", C1, 900, 3, R1), ("B-2", C2, 1200, 3, R2)])
    with pytest.raises(Raised, match="no panel_identity evidence"):
        db.execute("SELECT core.agent_attribute(1, 'panel_export', 'B-1', %s, NULL, 'panel_identity', 'admin')", (env["a1"],))
    with pytest.raises(Raised, match="reason"):
        db.execute("SELECT core.agent_attribute(1, 'panel_export', 'B-1', %s, NULL, 'manual', 'admin')", (env["a1"],))
    # one registrar identity recorded for two agents (shared access) → conflict, not a choice
    for a in (env["a1"], env["a2"]):
        db.execute("SELECT core.agent_identity_record(%s, 1, %s, 'r', %s, NULL, 'letter', 'admin')", (a, R1, TODAY - dt.timedelta(days=9)))
    assert queue(db)["B-1"][0] == "conflict" and inbox(db)["AG-10"][0] == 1
    # the agent declared another customer under this bank reference → conflict signal; linking needs a manual decision
    d2 = declare(db, user="ag2", nc=C1, ref="B-2")
    assert queue(db)["B-2"][0] == "conflict"
    with pytest.raises(Raised, match="customer differs"):
        db.execute("SELECT core.agent_attribute(1, 'panel_export', 'B-2', %s, %s, 'declared_order_ref', 'admin')", (env["a2"], d2))
    db.execute("SELECT core.agent_attribute(1, 'panel_export', 'B-2', %s, %s, 'manual', 'admin', 'agent confirmed a typo in the national id')", (env["a2"], d2))
    db.execute("SELECT core.agent_attribute(1, 'panel_export', 'B-1', NULL, NULL, 'almas_own', 'admin', 'sold by Almas head office')")
    assert set(queue(db)) == set() and inbox(db)["AG-15"][0] == 1                    # linked deal and bank sale disagree on the customer: shown


def test_automatic_attribution_is_off_by_default_and_takes_only_clear_cases(env):
    db = env["db"]
    panel_export(db, [("B-1", C1, 900, 3, R1), ("B-2", C2, 1200, 3, None)])
    db.execute("SELECT core.agent_identity_record(%s, 1, %s, 'r', %s, NULL, 'letter', 'admin')", (env["a1"], R1, TODAY - dt.timedelta(days=9)))
    declare(db, user="ag2", nc=C2)                                                    # same customer, near date, no total: weak
    with pytest.raises(Raised, match="off"):
        db.execute("SELECT core.agent_attribute_auto(1, 'admin')")
    db.execute("SELECT core.change_setting('agent_auto_attribution', 'on', 'admin', 'test the rule')")
    assert db.execute("SELECT core.agent_attribute_auto(1, 'admin')").fetchone()[0] == 1
    assert queue(db) == {"B-2": ("weak", env["a2"], queue(db)["B-2"][2])}             # the weak one waits for a person


def test_identity_validity_period_is_respected(env):
    db = env["db"]
    panel_export(db, [("B-1", C1, 900, 3, R1)])
    db.execute("SELECT core.agent_identity_record(%s, 1, %s, 'r', %s, %s, 'letter', 'admin')",
               (env["a1"], R1, TODAY - dt.timedelta(days=90), TODAY - dt.timedelta(days=60)))              # access withdrawn before the sale
    assert queue(db)["B-1"][0] == "no_candidate"


# ---------- the base amount: explicit, evidenced, approved by a person, immutable after approval ----------
def test_base_amount_rules(env):
    db = env["db"]
    with pytest.raises(Raised, match="own invoice"):
        declare(db, source="staff_entry")
    with pytest.raises(Denied):
        declare(db, user="ag1", agent=env["a2"])
    d = declare(db, base=500)
    with pytest.raises(Denied):
        db.execute("SELECT core.agent_deal_approve(%s, 'ag1')", (d,))
    with pytest.raises(Denied, match="reserved for people"):
        db.execute("SELECT core.agent_deal_approve(%s, 'ai')", (d,))
    db.execute("SELECT core.agent_deal_correct(%s, 450, 'agent_invoice', 'invoice 17 rev 2', 'admin', 'invoice corrected by the agent')", (d,))
    assert db.execute("SELECT before->>'base_amount', after->>'base_amount' FROM core.audit_event WHERE action = 'correct'").fetchone() == ("500", "450")
    e = db.execute("SELECT core.agent_deal_approve(%s, 'admin')", (d,)).fetchone()[0]
    with pytest.raises(Raised, match="adjustment"):
        db.execute("UPDATE core.agent_deal SET base_amount = 1 WHERE id = %s", (d,))
    with pytest.raises(Raised, match="immutable"):
        db.execute("UPDATE core.agent_deal SET approved_at = now() - interval '9 days' WHERE id = %s", (d,))
    with pytest.raises(psycopg.errors.UniqueViolation):
        db.execute("INSERT INTO core.agent_entitlement (agent_id, deal_id, basis, amount, rule_ref, created_by) VALUES (%s, %s, 'deal_base', 1, 'x', 'admin')",
                   (env["a1"], d))
    db.execute("SELECT core.agent_deal_adjust(%s, -50, 'bank deleted 1 installment', 'admin', 'sale reduced at the bank')", (d,))
    assert db.execute("SELECT owed_to_agent FROM core.agent_deal_lineage WHERE deal_id = %s", (d,)).fetchone()[0] == 400
    with pytest.raises(Raised, match="live entitlements"):
        db.execute("SELECT core.agent_deal_close(%s, 'cancelled', 'admin', 'sale cancelled')", (d,))
    assert e


def test_settlement_deadline_and_unmatched_deal(env):
    db = env["db"]
    d = declare(db, sale_date=TODAY - dt.timedelta(days=30))
    assert inbox(db)["AG-12"][0] == 0
    db.execute("SELECT core.change_setting('agent_base_settlement_hours', '0', 'admin', 'test')")
    assert inbox(db)["AG-12"][0] == 1                                                  # declared, waiting for approval past the deadline
    db.execute("SELECT core.agent_deal_approve(%s, 'admin')", (d,))
    box = inbox(db)
    assert box["AG-07"] == (1, 1_000_000_000)                                          # base not paid within the deadline
    assert box["AG-08"] == (1, 1_000_000_000)                                          # paid-for deal the bank does not show


# ---------- settlement instruments: real, referenced, reconcilable ----------
def test_wallet_and_bank_settlement_controls(env):
    db = env["db"]
    d = declare(db, base=1000)
    e = db.execute("SELECT core.agent_deal_approve(%s, 'admin')", (d,)).fetchone()[0]
    alloc = Jsonb([{"entitlement_id": e, "amount": 300}])
    with pytest.raises(psycopg.errors.IntegrityError):                                # no Dornatel reference, no wallet settlement
        db.execute("SELECT core.agent_settle(%s, 'dornatel_wallet', 300, current_date, %s, 'admin', p_wallet_account_ref => 'W')", (env["a1"], alloc))
    w = db.execute("SELECT core.agent_settle(%s, 'dornatel_wallet', 300, current_date, %s, 'admin', p_dornatel_txn_ref => 'DN-1', p_wallet_account_ref => 'W')",
                   (env["a1"], alloc)).fetchone()[0]
    with pytest.raises(psycopg.errors.UniqueViolation):                               # one Dornatel transaction settles once
        db.execute("SELECT core.agent_settle(%s, 'dornatel_wallet', 300, current_date, '[]', 'admin', p_dornatel_txn_ref => 'DN-1', p_wallet_account_ref => 'W')",
                   (env["a1"],))
    charge = db.execute("SELECT wallet_charge_id FROM core.agent_settlement WHERE id = %s", (w,)).fetchone()[0]
    assert inbox(db, TODAY + dt.timedelta(days=2))["AG-13"] == (1, 300)
    db.execute("SELECT core.dornatel_wallet_confirm(%s, 'Dornatel ledger export 1405/07/20', 'admin')", (charge,))
    assert inbox(db, TODAY + dt.timedelta(days=2))["AG-13"][0] == 0
    with pytest.raises(Raised, match="wallet charge"):
        db.execute("SELECT core.agent_reverse_settlement(%s, 'admin', 'undo')", (w,))
    with pytest.raises(Raised, match="immutable"):
        db.execute("UPDATE core.dornatel_wallet_charge SET amount = 1")
    db.execute("SELECT core.dornatel_wallet_reverse(%s, 'DN-1-R', 'admin', 'charged the wrong wallet')", (charge,))
    assert db.execute("SELECT reversed_at IS NOT NULL FROM core.agent_settlement WHERE id = %s", (w,)).fetchone()[0]
    assert db.execute("SELECT open_to_agent FROM core.agent_deal_lineage WHERE deal_id = %s", (d,)).fetchone()[0] == 1000
    b = db.execute("SELECT core.agent_settle(%s, 'bank_transfer', 1000, current_date - 10, %s, 'admin', %s, 'PAYA-7')",
                   (env["a1"], Jsonb([{"entitlement_id": e, "amount": 1000}]), env["account"])).fetchone()[0]
    assert inbox(db)["AG-14"] == (1, 1000)                                             # not yet seen on the bank statement
    fid = db.execute("INSERT INTO core.import_file (kind, sha256, imported_by) VALUES ('bank_statement', 'x', 'admin') RETURNING id").fetchone()[0]
    line = db.execute("""INSERT INTO core.bank_statement_line (company_bank_account_id, value_date, withdrawal, natural_key, first_file_id, last_file_id,
                         classification) VALUES (%s, current_date - 10, 1000, 'k1', %s, %s, 'other_withdrawal') RETURNING id""",
                      (env["account"], fid, fid)).fetchone()[0]
    db.execute("SELECT core.agent_settlement_tie_statement(%s, %s, 'admin')", (b, line))
    assert inbox(db)["AG-14"][0] == 0
    with pytest.raises(Raised, match="immutable"):
        db.execute("UPDATE core.agent_settlement SET statement_line_id = NULL WHERE id = %s", (b,))


def test_catalog_and_workspace(db):
    ops = dict(db.execute("SELECT operation, agent_allowed FROM core.operation_catalog WHERE operation LIKE 'agent.%'").fetchall())
    assert ops["agent.deal_declare"] and ops["agent.my_deals"] and not ops["agent.deal_approve"] and not ops["agent.settle"]
    assert db.execute("SELECT value FROM core.setting WHERE key = 'agent_share_rule'").fetchone()[0] == "base_goods_value"
