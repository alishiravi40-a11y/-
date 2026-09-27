"""AI-native catalog (core 013): every catalogued operation and permission exists; agents act only with permissions a
person would need; decisions reserved for people are refused to agents at the source."""
import psycopg
import pytest


def test_catalog_is_complete_and_consistent(db):
    rows = db.execute("SELECT operation, function_signature, permission FROM core.operation_catalog").fetchall()
    assert len(rows) >= 15
    for op, sig, perm in rows:
        assert db.execute("SELECT to_regprocedure(%s) IS NOT NULL", (sig,)).fetchone()[0], op
        if perm:
            assert db.execute("SELECT 1 FROM core.permission WHERE code = %s", (perm,)).fetchone(), op
    with pytest.raises(psycopg.errors.RaiseException, match="does not exist"):
        db.execute("""INSERT INTO core.operation_catalog VALUES ('x', 'read', 'core.nope(int)', 'p', NULL, 'e', 'u', 'b', true)""")


def test_agent_needs_the_same_permissions_and_cannot_close_a_year(db):
    db.execute("INSERT INTO core.app_user (username, is_ai_agent) VALUES ('agent', true), ('accountant', false)")
    db.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('agent', 'ar.allocate', 't'), "
               "('agent', 'period.close', 't'), ('accountant', 'period.close', 't')")
    ops = {r[0]: r[4] for r in db.execute("SELECT * FROM core.operations_for('agent')")}
    assert ops["ar.allocate"] is True and ops["ar.unallocate"] is False and ops["year.close"] is False and ops["ar.aging"] is True
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="reserved for people"):
        db.execute("SELECT core.require_permission('agent', 'period.close')")
    db.execute("SELECT core.require_permission('accountant', 'period.close')")
    assert db.execute("SELECT count(*) FROM core.schema_catalog WHERE name = 'settlement' AND description IS NOT NULL").fetchone()[0] == 1
