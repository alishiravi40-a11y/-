import duckdb

from holoo_reader.registry import Registry


def _silver(path, rows):
    c = duckdb.connect(str(path))
    c.execute("CREATE TABLE voucher (sanad_code INTEGER, source_row_hash VARCHAR)")
    for tbl, key in [("account", "code VARCHAR"), ("person", "c_code VARCHAR"), ("item", "a_code VARCHAR"),
                     ("voucher_line", "sanad_code INTEGER, line_index INTEGER"), ("document", "fac_type VARCHAR, fac_code VARCHAR"),
                     ("document_line", "fac_type VARCHAR, fac_code VARCHAR, a_code VARCHAR, line_index INTEGER"),
                     ("cheque", "check_code INTEGER"), ("cheque_event", "event_id INTEGER"), ("audit_event", "id INTEGER"),
                     ("tax_submission", "id INTEGER")]:
        c.execute(f"CREATE TABLE {tbl} ({key}, source_row_hash VARCHAR)")
    c.executemany("INSERT INTO voucher VALUES (?, ?)", rows)
    c.close()


def test_change_detection_added_changed_removed(tmp_path):
    a, b = tmp_path / "a.duckdb", tmp_path / "b.duckdb"
    _silver(a, [(1, "h1"), (2, "h2"), (3, "h3")])
    _silver(b, [(1, "h1"), (2, "h2x"), (4, "h4")])
    reg = Registry(str(tmp_path / "reg.duckdb"))
    summary = reg.diff("run2", "run1", str(a), str(b))
    assert summary["voucher"] == {"added": 1, "changed": 1, "removed_in_source": 1}
    rows = reg.con.execute("SELECT entity_key, change FROM source_change ORDER BY entity_key").fetchall()
    assert rows == [("2", "changed"), ("3", "removed_in_source"), ("4", "added")]


def test_identical_silver_produces_no_changes(tmp_path):
    a, b = tmp_path / "a.duckdb", tmp_path / "b.duckdb"
    _silver(a, [(1, "h1")]); _silver(b, [(1, "h1")])
    reg = Registry(str(tmp_path / "reg.duckdb"))
    assert reg.diff("r2", "r1", str(a), str(b))["voucher"] == {"added": 0, "changed": 0, "removed_in_source": 0}
