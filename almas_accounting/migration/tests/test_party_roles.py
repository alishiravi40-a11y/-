"""Customer / sales agent / panel registrar are separate; the legacy practice of recording an agent's Beta sales on the agent's
own account is kept as tagged history and never continued (core 023, E29). Synthetic data only."""
import datetime as dt

import psycopg
import pytest
from psycopg.types.json import Jsonb

from beta.common import make_national_id as nid
from migration.tests.test_agent_deals import env, panel_export, declare, inbox, TODAY  # noqa: F401
from migration.tests.test_receivables import post
from migration import holoo_ledger as M

Raised = psycopg.errors.RaiseException
AGENT_NC, B1, B2, REG = nid("007777777"), nid("001234567"), nid("002345678"), nid("004444444")


def legacy_entry(db, ids, party, date, amount, text):
    """A migrated Holoo voucher: Dr party line (with Holoo's description) / Cr other; posted after its lines are written."""
    y = db.execute("SELECT fiscal_year_id, id FROM core.period WHERE %s BETWEEN starts_on AND ends_on", (date,)).fetchone()
    e = db.execute("INSERT INTO core.journal_entry (fiscal_year_id, period_id, effective_date, created_by) VALUES (%s, %s, %s, 'migration') RETURNING id",
                   (y[0], y[1], date)).fetchone()[0]
    db.execute("INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, description) VALUES (%s, 1, %s, %s, %s, %s)",
               (e, ids["1030009"], party, amount, text))
    db.execute("INSERT INTO core.journal_line (entry_id, line_no, account_id, credit) VALUES (%s, 2, %s, %s)", (e, ids["9010001"], amount))
    db.execute("UPDATE core.journal_entry SET status = 'posted', posted_by = 'migration' WHERE id = %s", (e,))
    return e


@pytest.fixture()
def world(env):
    """Agent A1 is also a person (party) with a national id; its buyers B1, B2 are other people; REG is who typed the sales."""
    db = env["db"]
    grant = "INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('admin', 'legacy.classify', 'install')"
    db.execute(grant)
    ap = db.execute("INSERT INTO core.party (name, national_id) VALUES ('agent person', %s) RETURNING id", (AGENT_NC,)).fetchone()[0]
    db.execute("UPDATE core.sales_agent SET party_id = %s WHERE id = %s", (ap, env["a1"]))
    reg = db.execute("INSERT INTO core.party (name, national_id) VALUES ('registrar person', %s) RETURNING id", (REG,)).fetchone()[0]
    db.execute("SELECT core.agent_identity_record(%s, 1, %s, 'registrar', %s, NULL, 'access letter', 'admin')", (env["a1"], REG, TODAY - dt.timedelta(days=30)))
    panel_export(db, [("B-1", B1, 1_600, 4, REG), ("B-2", B2, 800, 4, REG)])
    deals = {}
    for ref, nc, base in (("B-1", B1, 1_000), ("B-2", B2, 500)):
        deals[ref] = declare(db, nc=nc, base=base, ref=ref)
        db.execute("SELECT core.agent_attribute(1, 'panel_export', %s, %s, %s, 'declared_order_ref', 'admin')", (ref, env["a1"], deals[ref]))
        e = db.execute("SELECT core.agent_deal_approve(%s, 'admin')", (deals[ref],)).fetchone()[0]
        deals[ref + ":e"] = e
    db.execute("SELECT core.agent_settle(%s, 'bank_transfer', 1000, current_date, %s, 'admin', %s, 'PAYA-1')",
               (env["a1"], Jsonb([{"entitlement_id": deals["B-1:e"], "amount": 1000}]), env["account"]))
    return {**env, "agent_party": ap, "registrar_party": reg, "deals": deals}


def test_buyers_own_the_sales_the_agent_owns_the_attribution(world):
    db, ap = world["db"], world["agent_party"]
    owners = db.execute("""SELECT p.national_id FROM core.installment_contract c JOIN core.party p ON p.id = c.party_id ORDER BY c.bank_contract_id""").fetchall()
    assert [r[0] for r in owners] == [B1, B2]                                          # each sale belongs to its real buyer
    assert db.execute("SELECT count(*) FROM core.installment_contract WHERE party_id = %s", (ap,)).fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM core.party_beta_exposure WHERE party_id = %s", (ap,)).fetchone()[0] == 0   # no debt on the agent person
    assert {r[0] for r in db.execute("SELECT agent_id FROM core.contract_owner")} == {world["a1"]}                  # the agent owns the sales
    roles = dict((r[0], r[1:]) for r in db.execute("SELECT party_id, contracts_as_customer, sales_agent_id, registrar_identities FROM core.party_roles"))
    assert roles[ap] == (0, world["a1"], 0)
    assert roles[world["registrar_party"]] == (0, None, 1)                               # the registrar is neither customer nor agent
    rep = db.execute("""SELECT bank_ref, buyer_national_id, beta_total, base_amount, owed_to_agent, settled, open_to_agent, settlement_methods, state_fa
                        FROM core.agent_sales_report WHERE agent_id = %s ORDER BY bank_ref""", (world["a1"],)).fetchall()
    assert rep == [("B-1", B1, 1_600, 1_000, 1_000, 1_000, 0, ["bank_transfer"], "تسویه‌شده"),
                   ("B-2", B2, 800, 500, 500, 0, 500, [], "تسویه‌نشده")]
    sep = db.execute("SELECT sales_as_agent, buyers_beta_total, owed_to_agent, open_to_agent, own_contracts_as_customer FROM core.agent_person_separation WHERE agent_id = %s",
                     (world["a1"],)).fetchone()
    assert sep == (2, 2_400, 1_500, 500, 0)


def test_the_agents_personal_purchase_stays_in_its_customer_role(world):
    db, ap = world["db"], world["agent_party"]
    panel_export(db, [("B-3", AGENT_NC, 400, 4, REG)], sha="f2")                        # the agent buys for itself, same registrar
    assert db.execute("SELECT count(*) FROM core.installment_contract WHERE party_id = %s", (ap,)).fetchone()[0] == 1
    db.execute("SELECT core.agent_attribute(1, 'panel_export', 'B-3', %s, NULL, 'panel_identity', 'admin')", (world["a1"],))
    sep = db.execute("SELECT sales_as_agent, own_contracts_as_customer, own_outstanding_as_customer FROM core.agent_person_separation WHERE agent_id = %s",
                     (world["a1"],)).fetchone()
    assert sep == (3, 1, 400)                                                           # two roles, two numbers, no mixing
    assert inbox(db)["AG-17"] == (1, 400)                                               # visible for a conflict-of-interest review


def test_posting_can_never_put_a_buyers_debt_on_the_agent_or_vice_versa(world):
    db = world["db"]
    M.ensure_fiscal_year(db, "1405")
    for code in ("1030008", "9010001"):
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES (%s, %s, 2, true, 'either', 'balance_sheet', %s)",
                   (code, code, code == "1030008"))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    cid = db.execute("SELECT id FROM core.installment_contract WHERE bank_contract_id = 'B-1'").fetchone()[0]
    buyer = db.execute("SELECT party_id FROM core.installment_contract WHERE id = %s", (cid,)).fetchone()[0]
    wrong, _ = post(db, ids, world["agent_party"], "2026-04-01", 1_600)                   # the legacy way: on the agent's account
    with pytest.raises(Raised, match="customer / agent separation"):
        db.execute("INSERT INTO core.document_posting (source, source_ref, entry_id, posted_by) VALUES ('beta_contract', %s, %s, 'test')", (str(cid), wrong))
    right, _ = post(db, ids, buyer, "2026-04-01", 1_600)
    db.execute("INSERT INTO core.document_posting (source, source_ref, entry_id, posted_by) VALUES ('beta_contract', %s, %s, 'test')", (str(cid), right))
    wrong2, _ = post(db, ids, buyer, "2026-04-02", 1_000)                               # the agent's claim put on a buyer
    with pytest.raises(Raised, match="customer / agent separation"):
        db.execute("INSERT INTO core.document_posting (source, source_ref, entry_id, posted_by) VALUES ('agent_entitlement', %s, %s, 'test')",
                   (str(world["deals"]["B-1:e"]), wrong2))
    ok2, _ = post(db, ids, world["agent_party"], "2026-04-02", 1_000)
    db.execute("INSERT INTO core.document_posting (source, source_ref, entry_id, posted_by) VALUES ('agent_entitlement', %s, %s, 'test')",
               (str(world["deals"]["B-1:e"]), ok2))


def test_legacy_aggregate_is_kept_tagged_and_classified_not_continued(world):
    db, ap = world["db"], world["agent_party"]
    M.ensure_fiscal_year(db, "1405")
    for code in ("1030009", "9010001"):
        db.execute("INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party) VALUES (%s, %s, 2, true, 'either', 'balance_sheet', %s)",
                   (code, code, code == "1030009"))
    ids = dict(db.execute("SELECT code, id FROM core.account").fetchall())
    db.execute("""INSERT INTO core.legacy_account_map (source_db, legacy_code, legacy_name, account_id, party_id, kind)
                  VALUES ('holoo_1405', '10300096549', 'agent person (legacy)', %s, %s, 'person_control')""", (ids["1030009"], ap))
    lines = []
    for k, (amount, text) in enumerate([(1_600, 'فاكتور buyer one'), (800, 'فاكتور buyer two'), (300, 'own purchase')], 1):
        e = legacy_entry(db, ids, ap, f"2026-04-0{k}", amount, text)                     # what Holoo did: all on the agent's party
        db.execute("INSERT INTO core.legacy_entry_map (source_db, sanad_code, entry_id, voucher_hash, status) VALUES ('holoo_1405', %s, %s, 'h', 'current')", (k, e))
        lines.append(e)
    before = db.execute("SELECT sum(debit - credit) FROM core.journal_line WHERE party_id = %s", (ap,)).fetchone()[0]
    agg = db.execute("SELECT core.legacy_aggregate_declare('holoo_1405', '10300096549', %s, NULL, NULL, 'accountant statement 1405/07 (E29)', 'admin')",
                     (world["a1"],)).fetchone()[0]
    assert db.execute("SELECT lines, legacy_balance, unclassified_lines FROM core.legacy_aggregate_status").fetchone() == (3, 2_700, 3)
    assert inbox(db)["LG-01"] == (3, 2_700)
    b1 = db.execute("SELECT id FROM core.party WHERE national_id = %s", (B1,)).fetchone()[0]
    b2 = db.execute("SELECT id FROM core.party WHERE national_id = %s", (B2,)).fetchone()[0]
    with pytest.raises(Raised, match="personal purchase"):
        db.execute("SELECT core.legacy_line_classify(%s, 1, 'buyer_sale', %s, 'manual', 'x', 'admin')", (lines[2], ap))
    db.execute("SELECT core.legacy_line_classify(%s, 1, 'buyer_sale', %s, 'contract_ref', 'panel B-1, same amount and date', 'admin')", (lines[0], b1))
    db.execute("SELECT core.legacy_line_classify(%s, 1, 'buyer_sale', %s, 'contract_ref', 'panel B-2', 'admin')", (lines[1], b2))
    db.execute("SELECT core.legacy_line_classify(%s, 1, 'agent_personal', NULL, 'document', 'invoice of the agent''s own purchase', 'admin')", (lines[2],))
    st = db.execute("SELECT buyer_amount, agent_personal_amount, unclassified_lines FROM core.legacy_aggregate_status").fetchone()
    assert st == (2_400, 300, 0) and inbox(db)["LG-01"][0] == 0 and inbox(db)["LG-02"] == (1, 2_400)
    assert db.execute("SELECT sum(debit - credit) FROM core.journal_line WHERE party_id = %s", (ap,)).fetchone()[0] == before   # history untouched
    prop = db.execute("SELECT party_id, role, debit, credit FROM core.legacy_aggregate_reclass_proposal(%s) ORDER BY role, party_id", (agg,)).fetchall()
    assert prop == [(ap, "agent (legacy aggregate)", 0, 2_400), (b1, "buyer", 1_600, 0), (b2, "buyer", 800, 0)]    # balanced; proposal only (D-28)
    sep = db.execute("SELECT legacy_aggregate_balance, legacy_classified_to_buyers, legacy_unclassified FROM core.agent_person_separation WHERE agent_id = %s",
                     (world["a1"],)).fetchone()
    assert sep == (2_700, 2_400, 0)
    with pytest.raises(Raised, match="not on a declared"):
        db.execute("SELECT core.legacy_line_classify(%s, 2, 'other', NULL, 'manual', 'x', 'admin')", (lines[0],))   # the sales line, not the aggregate


def test_registrar_agent_and_buyer_are_joined_only_by_evidence(world):
    db = world["db"]
    panel_export(db, [("B-9", B1, 500, 5, nid("009999999"))], sha="f9")                # an unknown registrar
    q = db.execute("SELECT state FROM core.bank_sale_attribution_queue WHERE ref = 'B-9'").fetchone()[0]
    assert q == "no_candidate"                                                          # same buyer as B-1 does not make it A1's sale
    assert db.execute("SELECT count(*) FROM core.party WHERE national_id = %s", (nid("009999999"),)).fetchone()[0] == 0   # registrars never become parties
