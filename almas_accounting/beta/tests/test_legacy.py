"""Holoo legacy persons → core parties: read-only, idempotent, lineage-preserving (beta/legacy.py)."""
from beta import legacy
from beta.common import make_national_id as nid

MIRROR = """
CREATE SCHEMA holoo_mirror;
CREATE TABLE holoo_mirror.import_run (run_id text PRIMARY KEY, source_db text);
CREATE TABLE holoo_mirror.person (source_db text, c_code text, name text, name_key text, national_code text, mobile text,
  debit_account text, credit_account text, source_row_hash text, removed_run text, PRIMARY KEY (source_db, c_code));
CREATE TABLE holoo_mirror.account (source_db text, code text, name text, removed_run text, PRIMARY KEY (source_db, code));
CREATE TABLE holoo_mirror.voucher (source_db text, sanad_code int, state text, removed_run text, PRIMARY KEY (source_db, sanad_code));
CREATE TABLE holoo_mirror.voucher_line (source_db text, sanad_code int, line_index int, account_code text, debit numeric, credit numeric,
  in_ledger boolean, removed_run text);
"""
A, B, C, D = nid("012345678"), nid("023456789"), nid("034567891"), nid("045678912")


def seed(db, db_name="holoo1_1404", run="run1"):
    db.execute("INSERT INTO holoo_mirror.import_run VALUES (%s, %s)", (run, db_name))
    db.execute("""INSERT INTO holoo_mirror.person VALUES
      (%(d)s,'0001','Ali Beta','alibeta',%(a)s,'0912','10800040001',NULL,'h1',NULL),
      (%(d)s,'0002','Sara Store','sarastore',%(b)s,NULL,'10300080002',NULL,'h2',NULL),
      (%(d)s,'0003','Sara Store dup','sarastoredup',%(b)s,NULL,'10300080003',NULL,'h3',NULL),
      (%(d)s,'0004','No Id','noid',NULL,NULL,'10300080004',NULL,'h4',NULL),
      (%(d)s,'0005','Bad Id','badid','1234567890',NULL,'10300080005',NULL,'h5',NULL)""", {"d": db_name, "a": A, "b": B})
    db.execute("""INSERT INTO holoo_mirror.account VALUES (%(d)s,'1080004','beta customers',NULL),(%(d)s,'10800040001','Ali (بتا)',NULL),
      (%(d)s,'10300080002','Sara',NULL),(%(d)s,'10300080003','Sara',NULL),(%(d)s,'10300080004','x',NULL),(%(d)s,'10300080005','y',NULL)""", {"d": db_name})
    db.execute("INSERT INTO holoo_mirror.voucher VALUES (%(d)s,1,'normal',NULL),(%(d)s,2,'closing',NULL)", {"d": db_name})
    db.execute("""INSERT INTO holoo_mirror.voucher_line VALUES (%(d)s,1,1,'10800040001',500,0,true,NULL),(%(d)s,1,2,'10300080002',0,200,true,NULL),
      (%(d)s,2,1,'10800040001',0,500,true,NULL)""", {"d": db_name})


def mirror_fingerprint(db):
    return [db.execute(f"SELECT count(*), md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) FROM holoo_mirror.{t} t").fetchone()
            for t in ("person", "account", "voucher", "voucher_line", "import_run")]


def test_first_mapping_creates_parties_with_lineage(db):
    db.execute(MIRROR); seed(db)
    before = mirror_fingerprint(db)
    st = legacy.map_persons(db, "holoo1_1404")
    assert st["parties_created"] == 5 and st["source_persons"] == 5
    rows = dict(db.execute("SELECT l.legacy_code, (p.national_id, p.national_id_claim) FROM core.party_legacy_code l JOIN core.party p ON p.id = l.party_id").fetchall())
    assert rows["0001"] == (A, None) and rows["0002"] == (B, None)
    assert rows["0003"] == (None, B)                    # duplicate national code in Holoo → claim, not merged
    assert rows["0004"] == (None, None) and rows["0005"] == (None, "1234567890")   # invalid id kept only as a claim
    assert db.execute("SELECT legacy_tags FROM core.party_legacy_code WHERE legacy_code = '0001'").fetchone()[0] == ["beta"]
    assert db.execute("SELECT balance, is_beta FROM core.legacy_balance WHERE legacy_account_code = '10800040001'").fetchone() == (500, True)
    assert db.execute("SELECT count(*) FROM core.party_merge_candidate WHERE level = 'strong'").fetchone()[0] == 1
    assert mirror_fingerprint(db) == before             # holoo_mirror is never written


def test_remapping_same_import_is_a_no_op(db):
    db.execute(MIRROR); seed(db)
    legacy.map_persons(db, "holoo1_1404")
    snap = db.execute("SELECT count(*), md5(string_agg(t::text, '|' ORDER BY t::text)) FROM core.party t").fetchone()
    st = legacy.map_persons(db, "holoo1_1404")
    assert st["parties_created"] == 0 and st["lineage_refreshed"] == 0 and st["balances_inserted"] == 0 and st["balances_updated"] == 0
    assert db.execute("SELECT count(*), md5(string_agg(t::text, '|' ORDER BY t::text)) FROM core.party t").fetchone() == snap


def test_newer_backup_same_year_refreshes_lineage_without_overwriting_party(db):
    db.execute(MIRROR); seed(db)
    legacy.map_persons(db, "holoo1_1404")
    pid = db.execute("SELECT party_id FROM core.party_legacy_code WHERE legacy_code = '0002'").fetchone()[0]
    db.execute("UPDATE core.party SET mobile = '0935 edited in new system' WHERE id = %s", (pid,))
    db.execute("INSERT INTO holoo_mirror.import_run VALUES ('run2', 'holoo1_1404')")
    db.execute("UPDATE holoo_mirror.person SET source_row_hash = 'h2b', mobile = '0999' WHERE c_code = '0002'")
    db.execute("INSERT INTO holoo_mirror.person VALUES ('holoo1_1404','0006','New Guy','newguy',%s,NULL,'10300080006',NULL,'h6',NULL)", (C,))
    db.execute("INSERT INTO holoo_mirror.voucher_line VALUES ('holoo1_1404',1,3,'10800040001',100,0,true,NULL)")
    st = legacy.map_persons(db, "holoo1_1404", "run2")
    assert st["parties_created"] == 1 and st["lineage_refreshed"] == 5
    assert db.execute("SELECT mobile FROM core.party WHERE id = %s", (pid,)).fetchone()[0] == "0935 edited in new system"
    assert db.execute("SELECT source_row_hash, first_seen_run, last_seen_run FROM core.party_legacy_code WHERE legacy_code = '0002'").fetchone() == ("h2b", "run1", "run2")
    assert db.execute("SELECT balance, first_seen_run, last_seen_run FROM core.legacy_balance WHERE legacy_account_code = '10800040001'").fetchone() == (600, "run1", "run2")


def test_other_fiscal_year_links_same_person_only_with_same_identity(db):
    db.execute(MIRROR); seed(db)
    legacy.map_persons(db, "holoo1_1404")
    db.execute("INSERT INTO holoo_mirror.import_run VALUES ('run1405', 'holoo1_1405')")
    db.execute("""INSERT INTO holoo_mirror.person VALUES
      ('holoo1_1405','0001','Ali Beta','alibeta',%s,NULL,'10800040001',NULL,'x1',NULL),
      ('holoo1_1405','0002','Somebody Else','somebodyelse',%s,NULL,'10300080002',NULL,'x2',NULL),
      ('holoo1_1405','0004','No Id','noid',NULL,NULL,'10300080004',NULL,'x4',NULL)""", (A, D))
    st = legacy.map_persons(db, "holoo1_1405")
    assert st["linked_other_year"] == 2 and st["parties_created"] == 1
    same = db.execute("""SELECT count(DISTINCT party_id) FROM core.party_legacy_code WHERE legacy_code = '0001'""").fetchone()[0]
    diff = db.execute("""SELECT count(DISTINCT party_id) FROM core.party_legacy_code WHERE legacy_code = '0002'""").fetchone()[0]
    assert (same, diff) == (1, 2)
