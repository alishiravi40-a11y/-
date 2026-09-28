"""Table names as SQL Server resolves them, not as Python compares strings.

A Holoo database can spell a table differently from another Holoo database (seen in the real FY1405 backup:
`Check_event`, where FY1404 has `Check_Event`). Under a case-insensitive collation SQL Server treats both spellings
as the same table, so the Reader must too — otherwise the profile reports the table missing, and (worse) extraction
writes `Check_event.parquet` while the transform looks for `Check_Event.parquet` and silently finds nothing.

Rules (strict on purpose):
  * an exact name always wins;
  * a name differing only in case is mapped to the Reader's name ONLY when the database's collation is
    case-insensitive (…_CI_…) and ONLY for tables the Reader knows (KNOWN_TABLES); unknown tables keep their names;
  * under a case-sensitive collation nothing is folded: a differently-cased table is a different table;
  * two tables folding to one Reader name is ambiguous and refused (never guess which one is meant).
Columns are not folded: the profile's required columns are still compared exactly.
"""
from __future__ import annotations

from .sqlserver import query

# every table the Reader reads by name (profile, transform, checks); a test keeps this list in step with transform.py
KNOWN_TABLES = frozenset([
    "SANAD", "SND_LIST", "SND_INDX", "SARFASL", "CUSTOMER", "FACTURE", "FACTART", "ARTICLE", "Check", "Check_Event",
    "Process", "TaxLog", "M_GROUP", "S_GROUP", "Cash", "ACOUND_N", "USERDB", "NEWBANK", "Sanad_Edit", "snd_list_Edit",
])


class AmbiguousTableName(ValueError):
    pass


def collation(conn) -> str:
    _, rows = query(conn, "SELECT CONVERT(varchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation'))")
    return rows[0][0] or ""


def is_case_insensitive(coll: str) -> bool:
    return "_CI_" in f"{coll}_".upper()


def canonical_map(actual: list[str], case_insensitive: bool, known=KNOWN_TABLES) -> dict[str, str]:
    """actual table name → name the Reader uses (only entries that differ). Raises AmbiguousTableName."""
    if not case_insensitive:
        return {}
    present = set(actual)
    by_fold: dict[str, list[str]] = {}
    for t in actual:
        by_fold.setdefault(t.casefold(), []).append(t)
    out = {}
    for k in known:
        if k in present:
            continue                                                  # exact spelling present: nothing to map
        cands = by_fold.get(k.casefold(), [])
        if len(cands) > 1:
            raise AmbiguousTableName(f"tables {sorted(cands)} all match {k!r} under a case-insensitive collation")
        if cands:
            out[cands[0]] = k
    return out


def table_names(conn) -> tuple[dict[str, str], str]:
    """(actual → Reader name for case-only differences, collation) of the connected database."""
    _, rows = query(conn, "SELECT name FROM sys.tables")
    coll = collation(conn)
    return canonical_map([r[0] for r in rows], is_case_insensitive(coll)), coll
