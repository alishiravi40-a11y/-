"""Table names are compared as SQL Server compares them (collation), without weakening the profile.

Regression: the real FY1405 backup spells `Check_event` where FY1404 has `Check_Event`; under Arabic_CI_AS they are
one table. The profile rejected the backup, and extraction would have written `Check_event.parquet` that the
transform never reads."""
import os
import pathlib
import re
import uuid

import pytest

from holoo_reader import names, profile


def test_case_only_difference_is_mapped_under_a_case_insensitive_collation():
    assert names.canonical_map(["SANAD", "Check_event", "Other"], True) == {"Check_event": "Check_Event"}
    assert names.is_case_insensitive("Arabic_CI_AS") and not names.is_case_insensitive("Latin1_General_CS_AS")


def test_nothing_is_folded_under_a_case_sensitive_collation():
    assert names.canonical_map(["Check_event"], False) == {}


def test_exact_spelling_wins_and_unknown_tables_keep_their_names():
    assert names.canonical_map(["Check_Event", "check_event_old"], True) == {}
    assert names.canonical_map(["MyTable", "mytable2"], True) == {}                 # not a table the Reader reads


def test_two_tables_folding_to_one_reader_name_are_refused():
    with pytest.raises(names.AmbiguousTableName):
        names.canonical_map(["check_event", "CHECK_EVENT"], True)


def test_required_columns_are_still_compared_exactly():
    cols = [(c, "int") for c in profile.REQUIRED["Check_Event"]]
    base = {t: [(c, "int") for c in cs] for t, cs in profile.REQUIRED.items()}
    assert profile.missing_required(base) == {}
    folded = {**{t: v for t, v in base.items() if t != "Check_Event"}, "Check_Event": cols}
    assert profile.missing_required(folded) == {}
    lower_cols = {**folded, "Check_Event": [(c.lower(), t) for c, t in cols]}          # columns are NOT folded
    assert profile.missing_required(lower_cols)["Check_Event"] == profile.REQUIRED["Check_Event"]
    without = {t: v for t, v in base.items() if t != "Check_Event"}                     # a truly absent table stays missing
    assert profile.missing_required(without) == {"Check_Event": profile.REQUIRED["Check_Event"]}


def test_every_table_the_transform_reads_is_known():
    src = (pathlib.Path(profile.__file__).parent / "transform.py").read_text(encoding="utf-8")
    used = set(re.findall(r"FROM \{\{?(\w+)\}\}?", src))
    assert used and used <= names.KNOWN_TABLES, used - names.KNOWN_TABLES
    assert set(profile.REQUIRED) <= names.KNOWN_TABLES and set(profile.KEY_TABLES) <= names.KNOWN_TABLES


# ---------- against a real SQL Server (the same code path the pipeline runs) ----------
@pytest.fixture()
def server():
    if not os.environ.get("HOLOO_SQL_PASSWORD"):
        pytest.skip("HOLOO_SQL_PASSWORD not set (no SQL Server)")
    from holoo_reader import sqlserver
    cfg = sqlserver.ServerConfig()
    made = []

    def make(coll, tables):
        db = f"names_{uuid.uuid4().hex[:8]}"
        with sqlserver.connect(cfg, autocommit=True) as c:
            c.cursor().execute(f"CREATE DATABASE [{db}] COLLATE {coll}")
        made.append(db)
        with sqlserver.connect(cfg, db, autocommit=True) as c:
            for t in tables:
                c.cursor().execute(f"CREATE TABLE dbo.[{t}] (Id int, Check_Code int, Sanad_Code int, Date_Time datetime, Cash_ID int, SarFasl_Code varchar(20), State varchar(5))")
                c.cursor().execute(f"INSERT INTO dbo.[{t}] VALUES (1, 7, 70, '2026-04-01', 1, '101', 'a')")
        return db
    yield cfg, make
    with sqlserver.connect(cfg, autocommit=True) as c:
        for db in made:
            c.cursor().execute(f"ALTER DATABASE [{db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE")
            c.cursor().execute(f"DROP DATABASE [{db}]")


def test_live_case_insensitive_database_profile_and_extraction_use_one_name(server, tmp_path):
    from holoo_reader import extract, sqlserver
    cfg, make = server
    db = make("Arabic_CI_AS", ["Check_event"])
    with sqlserver.connect(cfg, db) as c:
        snap = profile.schema_snapshot(c, names.table_names(c)[0])
        assert "Check_Event" in snap and "Check_Event" not in profile.missing_required(snap)
        ext = extract.extract_all(c, str(tmp_path))
    assert ext == [{"table": "Check_Event", "rows": 1, "dropped_secret_columns": [], "blob_columns": [], "source_table": "Check_event"}]
    assert (tmp_path / "Check_Event.parquet").exists() and not (tmp_path / "Check_event.parquet").exists()


def test_live_case_sensitive_database_stays_strict(server, tmp_path):
    from holoo_reader import extract, sqlserver
    cfg, make = server
    db = make("Latin1_General_CS_AS", ["Check_event"])
    with sqlserver.connect(cfg, db) as c:
        m, coll = names.table_names(c)
        assert m == {} and "_CS_" in coll
        assert "Check_Event" in profile.missing_required(profile.schema_snapshot(c, m))           # a different table here
        assert [e["table"] for e in extract.extract_all(c, str(tmp_path))] == ["Check_event"]
    both = make("Latin1_General_CS_AS", ["Check_event", "Check_Event"])
    with sqlserver.connect(cfg, both) as c:
        assert names.table_names(c)[0] == {}                                                     # the exact spelling is used
