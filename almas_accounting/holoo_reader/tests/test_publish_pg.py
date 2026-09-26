"""Publishing to PostgreSQL holoo_mirror: idempotency and change detection (requires HOLOO_PG_TEST_DSN + golden workdir)."""
import glob
import os
import shutil

import duckdb
import psycopg
import pytest

from holoo_reader import publish_pg

WORK = os.environ.get("HOLOO_GOLDEN_WORKDIR")
DSN = os.environ.get("HOLOO_PG_TEST_DSN")
SHA = "c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2"
pytestmark = [pytest.mark.golden, pytest.mark.skipif(not (WORK and DSN), reason="needs HOLOO_GOLDEN_WORKDIR and HOLOO_PG_TEST_DSN")]


@pytest.fixture()
def pg():
    c = psycopg.connect(DSN, autocommit=True)
    c.execute("DROP SCHEMA IF EXISTS holoo_mirror CASCADE")
    yield c
    c.execute("DROP SCHEMA IF EXISTS holoo_mirror CASCADE")


def test_publish_is_idempotent_and_tracks_changes(pg, tmp_path):
    silver = os.path.join(WORK, "imports", SHA, "silver.duckdb")
    first = publish_pg.publish(silver, DSN)
    assert first["counts"]["voucher_line"] == 190469
    assert pg.execute("SELECT SUM(debit) FROM holoo_mirror.voucher_line").fetchone()[0] == 80720660543371
    assert publish_pg.publish(silver, DSN)["changes"] == {}          # same import again → nothing changes
    mod = tmp_path / "silver.duckdb"; shutil.copy(silver, mod)
    c = duckdb.connect(str(mod))
    c.execute("UPDATE voucher_line SET debit = debit + 1, source_row_hash = 'x' WHERE sanad_code = 327836 AND line_index = 937002")
    c.execute("DELETE FROM cheque WHERE check_code = 36591")
    c.execute("UPDATE meta SET value = 'test-run-2' WHERE key = 'run_id'"); c.close()
    second = publish_pg.publish(str(mod), DSN)
    assert second["changes"] == {"voucher_line": {"changed": 1}, "cheque": {"removed_in_source": 1}}
    assert pg.execute("SELECT removed_run FROM holoo_mirror.cheque WHERE check_code = 36591").fetchone()[0] == "test-run-2"
    assert pg.execute("SELECT COUNT(*) FROM holoo_mirror.cheque").fetchone()[0] == 12515   # nothing physically deleted
