"""Parity against Holoo's own views on the restored FY1404 database (requires the SQL Server used for the import)."""
import os

import pytest

from holoo_reader import parity, sqlserver, transform

WORK = os.environ.get("HOLOO_GOLDEN_WORKDIR")
SHA = "c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2"
pytestmark = [pytest.mark.golden, pytest.mark.skipif(not (WORK and os.environ.get("HOLOO_SQL_PASSWORD")),
                                                     reason="needs HOLOO_GOLDEN_WORKDIR and a reachable SQL Server with the restored DB")]


@pytest.mark.parametrize("fn", parity.ALL, ids=lambda f: f.__name__)
def test_parity(fn):
    silver = transform.open_silver(os.path.join(WORK, "imports", SHA, "silver.duckdb"))
    with sqlserver.connect(sqlserver.ServerConfig(), f"holoo_{SHA[:12]}") as sql:
        r = fn(sql, silver)
    assert r["status"] == "pass", r
