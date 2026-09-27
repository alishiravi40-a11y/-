"""Holoo ledger → core ledger (D-03): chart of accounts, parties, and every voucher of a fiscal year, with lineage.

Guarantees
  * holoo_mirror is only read; the Holoo Reader / Restore / publish pipeline is untouched;
  * idempotent: re-running the same import changes nothing; a newer backup of the same fiscal year only
    (a) refreshes lineage, (b) supersedes changed vouchers (reversal + new entry, never an edit), (c) reverses vouchers
    removed in the source; posted entries are immutable (W-05);
  * D-03: person accounts are not accounts — lines go to a control account with party_id:
      Holoo tafsili of a person under moein M → control M (or M||'P' if M also has non-person accounts WITH postings);
      Holoo moein of a person under kol K → control K||'P';
    non-person accounts keep their Holoo code; unused non-person tafsili under a person moein are recorded as dropped;
  * hidden lines (Show_Daftar = 0 — voided invoices) and zero lines are not migrated; a voucher left with no lines is
    recorded as skipped;
  * parity(): every Holoo account (or person) balance equals the core balance of its mapped (account, party).
"""
from __future__ import annotations

import json

import jdatetime

from beta import legacy

USER = "holoo-migration"
STATEMENT_BY_GROUP = {1: "balance_sheet", 2: "balance_sheet", 3: "balance_sheet", 4: "balance_sheet", 5: "balance_sheet",
                      15: "balance_sheet", 6: "income_statement", 7: "income_statement", 8: "income_statement",
                      9: "income_statement", 10: "income_statement", 11: "income_statement", 12: "income_statement"}  # GROP_SAR.Group_Main
KIND = {"opening": "opening", "closing_temporary": "closing", "closing": "closing"}


def ensure_fiscal_year(conn, code: str) -> int:
    row = conn.execute("SELECT id FROM core.fiscal_year WHERE code = %s", (code,)).fetchone()
    if row:
        return row[0]
    y = int(code)
    start = jdatetime.date(y, 1, 1)
    end = jdatetime.date(y + 1, 1, 1) - jdatetime.timedelta(days=1)
    fid = conn.execute("INSERT INTO core.fiscal_year (code, starts_on, ends_on) VALUES (%s, %s, %s) RETURNING id",
                       (code, start.togregorian(), end.togregorian())).fetchone()[0]
    for m in range(1, 13):
        a = jdatetime.date(y, m, 1)
        b = (jdatetime.date(y, m + 1, 1) if m < 12 else jdatetime.date(y + 1, 1, 1)) - jdatetime.timedelta(days=1)
        conn.execute("INSERT INTO core.period (fiscal_year_id, code, starts_on, ends_on) VALUES (%s, %s, %s, %s)",
                     (fid, f"{code}-{m:02d}", a.togregorian(), b.togregorian()))
    return fid


def build_chart(conn, db: str, run: str) -> dict:
    """Create core accounts and legacy_account_map for one Holoo database (parties must be mapped first)."""
    conn.execute("DROP TABLE IF EXISTS pg_temp.pacc, pg_temp.hacc, pg_temp.target")
    conn.execute("""CREATE TEMP TABLE pacc AS
        SELECT DISTINCT ON (a) a, party_id FROM (
          SELECT legacy_debit_account a, party_id, id FROM core.party_legacy_code WHERE source_db = %(db)s AND legacy_debit_account IS NOT NULL
          UNION ALL SELECT legacy_credit_account, party_id, id FROM core.party_legacy_code WHERE source_db = %(db)s AND legacy_credit_account IS NOT NULL) z
        ORDER BY a, id""", {"db": db})
    conn.execute("""CREATE TEMP TABLE hacc AS
        SELECT a.code, a.name, a.parent_code, length(a.code) len, a.nature, a.role_type, k.group_code kol_group,
               p.party_id, EXISTS (SELECT 1 FROM holoo_mirror.voucher_line l WHERE l.source_db = a.source_db AND l.account_code = a.code
                                   AND l.in_ledger AND l.removed_run IS NULL AND (l.debit <> 0 OR l.credit <> 0)) has_lines
        FROM holoo_mirror.account a LEFT JOIN holoo_mirror.account k ON k.source_db = a.source_db AND k.code = left(a.code, 3)
        LEFT JOIN pacc p ON p.a = a.code WHERE a.source_db = %(db)s AND a.removed_run IS NULL""", {"db": db})
    # moeins / kols that hold persons, and whether they also hold non-person accounts with postings
    conn.execute("""CREATE TEMP TABLE target AS
        SELECT h.code, h.party_id,
               CASE WHEN h.party_id IS NULL THEN NULL
                    WHEN h.len = 11 THEN left(h.code, 7) || CASE WHEN EXISTS (SELECT 1 FROM hacc o WHERE o.parent_code = left(h.code, 7)
                                                                  AND o.party_id IS NULL AND o.has_lines) THEN 'P' ELSE '' END
                    ELSE left(h.code, 3) || 'P' END AS control
        FROM hacc h""")
    # non-person accounts under a person moein without postings → dropped (the moein becomes the leaf control)
    conn.execute("""ALTER TABLE hacc ADD COLUMN dropped boolean NOT NULL DEFAULT false""")
    conn.execute("""UPDATE hacc h SET dropped = true WHERE h.party_id IS NULL AND h.len = 11 AND NOT h.has_lines
                    AND h.parent_code IN (SELECT control FROM target WHERE control IS NOT NULL)""")
    conn.execute("""
      INSERT INTO core.account (code, name, level, is_leaf, nature, statement, role, requires_party, holoo_code)
      SELECT h.code, h.name, CASE h.len WHEN 3 THEN 1 WHEN 7 THEN 2 ELSE 3 END, true,
             CASE h.nature WHEN 1 THEN 'debit' WHEN 2 THEN 'credit' ELSE 'either' END,
             coalesce((%(stmt)s::jsonb ->> h.kol_group::text), 'memo'), h.role_type::text,
             h.code IN (SELECT control FROM target WHERE control IS NOT NULL), h.code
      FROM hacc h WHERE h.party_id IS NULL AND NOT h.dropped
      ON CONFLICT (code) DO NOTHING""", {"stmt": json.dumps({str(k): v for k, v in STATEMENT_BY_GROUP.items()})})
    # synthetic person controls (K||'P' under kol K, M||'P' under moein M)
    conn.execute("""
      INSERT INTO core.account (code, name, level, is_leaf, nature, statement, requires_party)
      SELECT DISTINCT t.control, 'اشخاص — ' || p.name, p.level + 1, true, p.nature, p.statement, true
      FROM target t JOIN core.account p ON p.code = left(t.control, length(t.control) - 1)
      WHERE t.control LIKE '%%P' ON CONFLICT (code) DO NOTHING""")
    conn.execute("UPDATE core.account a SET requires_party = true WHERE a.code IN (SELECT control FROM target WHERE control IS NOT NULL) AND NOT a.requires_party")
    conn.execute("""UPDATE core.account c SET parent_id = p.id FROM core.account p
                    WHERE c.parent_id IS NULL AND c.level > 1 AND p.code = CASE WHEN c.code LIKE '%%P' THEN left(c.code, length(c.code) - 1)
                                                                              WHEN c.level = 2 THEN left(c.code, 3) ELSE left(c.code, 7) END""")
    conn.execute("""UPDATE core.account a SET is_leaf = NOT EXISTS (SELECT 1 FROM core.account c WHERE c.parent_id = a.id)
                    WHERE a.is_leaf IS DISTINCT FROM NOT EXISTS (SELECT 1 FROM core.account c WHERE c.parent_id = a.id)""")
    res = conn.execute("""
      INSERT INTO core.legacy_account_map (source_db, legacy_code, legacy_name, account_id, party_id, kind, first_seen_run, last_seen_run)
      SELECT %(db)s, h.code, h.name, a.id, h.party_id,
             CASE WHEN h.party_id IS NOT NULL THEN 'person_control' WHEN h.dropped THEN 'dropped_unused' ELSE 'same_code' END, %(run)s, %(run)s
      FROM hacc h JOIN target t ON t.code = h.code
      LEFT JOIN core.account a ON a.code = CASE WHEN h.party_id IS NOT NULL THEN t.control WHEN h.dropped THEN NULL ELSE h.code END
      ON CONFLICT (source_system, source_db, legacy_code) DO UPDATE SET last_seen_run = EXCLUDED.last_seen_run
      WHERE core.legacy_account_map.last_seen_run IS DISTINCT FROM EXCLUDED.last_seen_run
      RETURNING kind, (xmax = 0) AS inserted""", {"db": db, "run": run}).fetchall()
    out = {}
    for kind, ins in res:
        k = f"{kind}_{'new' if ins else 'refreshed'}"
        out[k] = out.get(k, 0) + 1
    return out


def migrate(conn, source_db: str, fiscal_year: str, run_id: str | None = None) -> dict:
    run = run_id or conn.execute("SELECT max(run_id) FROM holoo_mirror.import_run WHERE source_db = %s", (source_db,)).fetchone()[0]
    stats = {"run": run}
    with conn.transaction():
        stats["parties"] = legacy.map_persons(conn, source_db, run)
        fid = ensure_fiscal_year(conn, fiscal_year)
        stats["chart"] = build_chart(conn, source_db, run)
        conn.execute("DROP TABLE IF EXISTS pg_temp.vl, pg_temp.vh, pg_temp.newv")
        conn.execute("""CREATE TEMP TABLE vl AS
            SELECT l.sanad_code, row_number() OVER (PARTITION BY l.sanad_code ORDER BY l.line_index) line_no, l.line_index,
                   m.account_id, m.party_id, l.debit, l.credit, l.description, l.account_code
            FROM holoo_mirror.voucher_line l JOIN core.legacy_account_map m ON m.source_db = l.source_db AND m.legacy_code = l.account_code
            WHERE l.source_db = %(db)s AND l.in_ledger AND l.removed_run IS NULL AND (l.debit <> 0 OR l.credit <> 0)""", {"db": source_db})
        unmapped = conn.execute("""SELECT count(*) FROM holoo_mirror.voucher_line l WHERE l.source_db = %s AND l.in_ledger AND l.removed_run IS NULL
                                   AND (l.debit <> 0 OR l.credit <> 0) AND NOT EXISTS (SELECT 1 FROM core.legacy_account_map m
                                   WHERE m.source_db = l.source_db AND m.legacy_code = l.account_code AND m.account_id IS NOT NULL)""",
                                (source_db,)).fetchone()[0]
        if unmapped:
            raise RuntimeError(f"{unmapped} visible Holoo lines have no mapped account")
        conn.execute("""CREATE TEMP TABLE vh AS
            SELECT v.sanad_code, v.doc_date, v.state, v.comment,
                   md5(v.doc_date::text || '|' || v.state || '|' || coalesce(string_agg(vl.account_code || ':' || vl.debit || ':' || vl.credit || ':' ||
                       coalesce(vl.description, ''), ';' ORDER BY vl.line_index), '')) AS h, count(vl.*) AS n
            FROM holoo_mirror.voucher v LEFT JOIN vl ON vl.sanad_code = v.sanad_code
            WHERE v.source_db = %(db)s AND v.removed_run IS NULL GROUP BY v.sanad_code, v.doc_date, v.state, v.comment""", {"db": source_db})
        # unchanged → lineage only
        stats["unchanged"] = conn.execute("""UPDATE core.legacy_entry_map m SET last_seen_run = %s FROM vh
            WHERE m.source_db = %s AND m.sanad_code = vh.sanad_code AND m.status IN ('current', 'skipped_no_visible_lines')
              AND m.voucher_hash = vh.h AND m.last_seen_run IS DISTINCT FROM %s""", (run, source_db, run)).rowcount
        # changed or removed in source → reverse the old entry (never edit), then (re)create below
        gone = conn.execute("""SELECT m.sanad_code, m.entry_id, (vh.sanad_code IS NULL) AS removed, e.effective_date FROM core.legacy_entry_map m
            LEFT JOIN vh ON vh.sanad_code = m.sanad_code LEFT JOIN core.journal_entry e ON e.id = m.entry_id
            WHERE m.source_db = %s AND m.status IN ('current', 'skipped_no_visible_lines') AND (vh.sanad_code IS NULL OR vh.h <> m.voucher_hash)""",
            (source_db,)).fetchall()
        stats["superseded"] = stats["removed_in_source"] = 0
        for sanad, entry, removed, date in gone:
            rev = None
            if entry is not None:
                rev = conn.execute("SELECT core.reverse_entry(%s, %s, %s, %s)",
                                   (entry, date, f"Holoo voucher {sanad} {'removed' if removed else 'changed'} in backup run {run}", USER)).fetchone()[0]
            conn.execute("""UPDATE core.legacy_entry_map SET status = %s, reversal_entry_id = %s, last_seen_run = %s
                            WHERE source_db = %s AND sanad_code = %s AND status IN ('current', 'skipped_no_visible_lines')""",
                         ("removed_in_source" if removed else "superseded", rev, run, source_db, sanad))
            stats["removed_in_source" if removed else "superseded"] += 1
        conn.execute("""CREATE TEMP TABLE newv AS SELECT vh.* FROM vh WHERE NOT EXISTS (SELECT 1 FROM core.legacy_entry_map m
                        WHERE m.source_db = %s AND m.sanad_code = vh.sanad_code AND m.status IN ('current', 'skipped_no_visible_lines'))""", (source_db,))
        stats["skipped_no_visible_lines"] = conn.execute("""INSERT INTO core.legacy_entry_map (source_db, sanad_code, voucher_hash, status, first_seen_run, last_seen_run)
            SELECT %s, sanad_code, h, 'skipped_no_visible_lines', %s, %s FROM newv WHERE n = 0""", (source_db, run, run)).rowcount
        # new entries: insert as drafts with lines, then post (entry rules: period, balance, leaf, party)
        stats["entries_created"] = conn.execute("""
            INSERT INTO core.journal_entry (number, fiscal_year_id, period_id, effective_date, kind, source, source_ref, description, created_by)
            SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM core.journal_entry x WHERE x.fiscal_year_id = %(fy)s AND x.number = n.sanad_code) THEN n.sanad_code END,
                   %(fy)s, p.id, n.doc_date, coalesce(%(kind)s::jsonb ->> n.state, 'normal'), 'holoo', %(db)s || ':' || n.sanad_code, n.comment, %(u)s
            FROM newv n JOIN core.period p ON p.fiscal_year_id = %(fy)s AND n.doc_date BETWEEN p.starts_on AND p.ends_on WHERE n.n > 0""",
            {"fy": fid, "kind": json.dumps(KIND), "db": source_db, "u": USER}).rowcount
        conn.execute("""CREATE TEMP TABLE ne AS SELECT DISTINCT ON (e.source_ref) e.id, n.sanad_code, n.h FROM newv n
                        JOIN core.journal_entry e ON e.source = 'holoo' AND e.source_ref = %s || ':' || n.sanad_code AND e.status = 'draft'
                        WHERE n.n > 0 ORDER BY e.source_ref, e.id DESC""", (source_db,))
        conn.execute("""INSERT INTO core.journal_line (entry_id, line_no, account_id, party_id, debit, credit, description)
                        SELECT ne.id, vl.line_no, vl.account_id, vl.party_id, vl.debit, vl.credit, vl.description FROM ne JOIN vl USING (sanad_code)""")
        conn.execute("UPDATE core.journal_entry SET status = 'posted', posted_by = %s WHERE id IN (SELECT id FROM ne)", (USER,))
        conn.execute("""INSERT INTO core.legacy_entry_map (source_db, sanad_code, entry_id, voucher_hash, status, first_seen_run, last_seen_run)
                        SELECT %s, sanad_code, id, h, 'current', %s, %s FROM ne""", (source_db, run, run))
        conn.execute("DROP TABLE IF EXISTS pg_temp.ne")
    return stats


def parity(conn, source_db: str) -> dict:
    """Every Holoo account's gross debit/credit (visible lines) == core lines of the current migrated entries, per mapped
    (account, party); plus totals. Returns counts and the first mismatches."""
    rows = conn.execute("""
      WITH h AS (SELECT m.account_id, m.party_id, sum(l.debit) d, sum(l.credit) c FROM holoo_mirror.voucher_line l
                 JOIN core.legacy_account_map m ON m.source_db = l.source_db AND m.legacy_code = l.account_code
                 WHERE l.source_db = %(db)s AND l.in_ledger AND l.removed_run IS NULL GROUP BY 1, 2),
      c AS (SELECT jl.account_id, jl.party_id, sum(jl.debit) d, sum(jl.credit) c FROM core.legacy_entry_map m
            JOIN core.journal_line jl ON jl.entry_id = m.entry_id WHERE m.source_db = %(db)s AND m.status = 'current' GROUP BY 1, 2)
      SELECT coalesce(h.account_id, c.account_id), coalesce(h.party_id, c.party_id), coalesce(h.d, 0)::numeric, coalesce(c.d, 0)::numeric, coalesce(h.c, 0)::numeric, coalesce(c.c, 0)::numeric
      FROM h FULL JOIN c ON c.account_id = h.account_id AND c.party_id IS NOT DISTINCT FROM h.party_id""", {"db": source_db}).fetchall()
    bad = [r for r in rows if abs(r[2] - r[3]) > 0.5 or abs(r[4] - r[5]) > 0.5]
    tot = conn.execute("""SELECT sum(debit), sum(credit) FROM holoo_mirror.voucher_line WHERE source_db = %s AND in_ledger AND removed_run IS NULL""",
                       (source_db,)).fetchone()
    core_tot = conn.execute("""SELECT sum(jl.debit), sum(jl.credit) FROM core.legacy_entry_map m JOIN core.journal_line jl ON jl.entry_id = m.entry_id
                               WHERE m.source_db = %s AND m.status = 'current'""", (source_db,)).fetchone()
    return {"compared": len(rows), "mismatches": len(bad), "examples": bad[:5],
            "holoo_totals": [float(x or 0) for x in tot], "core_totals": [float(x or 0) for x in core_tot],
            "status": "pass" if not bad and [float(x or 0) for x in tot] == [float(x or 0) for x in core_tot] else "fail"}
