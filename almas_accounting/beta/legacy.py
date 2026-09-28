"""Map Holoo legacy persons (holoo_mirror, read-only) to core parties — idempotent, lineage-preserving.

Rules (design v0.5, D-18):
  * key = (holoo, source_db, C_Code) in core.party_legacy_code; re-running the same import changes nothing;
  * a newer backup of the same source_db only refreshes lineage (last_seen_run, source_row_hash); party data edited in
    the new system is never overwritten; a changed legacy national code is reported, not applied;
  * the same C_Code in ANOTHER source_db (another fiscal year) is linked to the same party only when the national code
    is equal (a code that is not an 8–10 digit national code — empty, legal-entity ID, … — must be recorded identically
    AND the normalized name must be equal) — otherwise a new party is created;
  * a valid national code becomes party.national_id only if no other party holds it; otherwise it is kept as
    national_id_claim and shows up as a 'strong' merge candidate (never merged automatically);
  * Holoo account balances of the persons are copied to core.legacy_balance (is_beta from «(بتا)» / 1080004).
Nothing is written to holoo_mirror.
"""
from __future__ import annotations

BETA_ACCOUNT = r"(name ~ '\(\s*بتا|بتا\s*\)' OR left(code, 7) = '1080004') AND code <> '1080004'"


def map_persons(conn, source_db: str, run_id: str | None = None) -> dict:
    run_id = run_id or conn.execute("SELECT max(run_id) FROM holoo_mirror.import_run WHERE source_db = %s", (source_db,)).fetchone()[0]
    stats = {}
    with conn.transaction():
        conn.execute("DROP TABLE IF EXISTS pg_temp.src")
        conn.execute(f"""
          CREATE TEMP TABLE src AS
          WITH beta AS (SELECT code FROM holoo_mirror.account WHERE source_db = %(db)s AND removed_run IS NULL AND {BETA_ACCOUNT})
          SELECT p.c_code, btrim(p.name) AS name, p.name_key, p.mobile, p.debit_account, p.credit_account, p.source_row_hash,
                 CASE WHEN translate(btrim(coalesce(p.national_code, '')), '۰۱۲۳۴۵۶۷۸۹', '0123456789') ~ '^[0-9]{{8,10}}$'
                      THEN lpad(translate(btrim(p.national_code), '۰۱۲۳۴۵۶۷۸۹', '0123456789'), 10, '0') END AS nc,
                 btrim(p.national_code) AS nc_raw,
                 (p.debit_account IN (SELECT code FROM beta) OR p.credit_account IN (SELECT code FROM beta)) AS is_beta
          FROM holoo_mirror.person p WHERE p.source_db = %(db)s AND p.removed_run IS NULL""", {"db": source_db})
        stats["source_persons"] = conn.execute("SELECT count(*) FROM src").fetchone()[0]
        # 1. lineage refresh for already-mapped legacy codes (party data untouched)
        stats["changed_national_code"] = conn.execute("""
          SELECT count(*) FROM core.party_legacy_code l JOIN src ON src.c_code = l.legacy_code
          WHERE l.source_system = 'holoo' AND l.source_db = %s AND l.legacy_national_code IS DISTINCT FROM src.nc_raw""", (source_db,)).fetchone()[0]
        stats["lineage_refreshed"] = conn.execute("""
          UPDATE core.party_legacy_code l SET last_seen_run = %s, source_row_hash = src.source_row_hash
          FROM src WHERE l.source_system = 'holoo' AND l.source_db = %s AND l.legacy_code = src.c_code
            AND (l.last_seen_run IS DISTINCT FROM %s OR l.source_row_hash IS DISTINCT FROM src.source_row_hash)""",
          (run_id, source_db, run_id)).rowcount
        conn.execute("""DELETE FROM src WHERE c_code IN (SELECT legacy_code FROM core.party_legacy_code
                        WHERE source_system = 'holoo' AND source_db = %s)""", (source_db,))
        # 2. same C_Code already mapped from another fiscal year → same party when identity agrees
        stats["linked_other_year"] = conn.execute("""
          INSERT INTO core.party_legacy_code (party_id, source_db, legacy_code, legacy_name, legacy_national_code, legacy_debit_account,
                 legacy_credit_account, legacy_tags, source_row_hash, first_seen_run, last_seen_run, link_rule)
          SELECT DISTINCT ON (src.c_code) o.party_id, %s, src.c_code, src.name, src.nc_raw, src.debit_account, src.credit_account,
                 CASE WHEN src.is_beta THEN '{beta}'::text[] ELSE '{}' END, src.source_row_hash, %s, %s, 'same_legacy_code_other_year'
          FROM src JOIN core.party_legacy_code o ON o.source_system = 'holoo' AND o.source_db <> %s AND o.legacy_code = src.c_code
          JOIN core.party pa ON pa.id = o.party_id
          WHERE (src.nc IS NOT NULL AND lpad(o.legacy_national_code, 10, '0') = src.nc)
             -- no 8–10 digit national code (empty, or e.g. an 11-digit legal-entity ID, E31: 428 in FY1405): the same
             -- recorded code, character for character, AND the same name
             OR (src.nc IS NULL AND coalesce(btrim(o.legacy_national_code), '') = coalesce(src.nc_raw, '') AND pa.name_key = src.name_key)
          ORDER BY src.c_code, o.id""", (source_db, run_id, run_id, source_db)).rowcount
        conn.execute("""DELETE FROM src WHERE c_code IN (SELECT legacy_code FROM core.party_legacy_code
                        WHERE source_system = 'holoo' AND source_db = %s)""", (source_db,))
        # 3. new parties; national_id only when valid and free (first C_Code wins), else kept as a claim
        conn.execute("""
          INSERT INTO core.party (name, name_key, mobile, national_id, national_id_claim, holoo_c_code, holoo_source_db)
          SELECT s.name, s.name_key, s.mobile,
                 CASE WHEN s.ok AND s.rn = 1 AND NOT EXISTS (SELECT 1 FROM core.party x WHERE x.national_id = s.nc) THEN s.nc END,
                 CASE WHEN s.nc IS NOT NULL AND NOT (s.ok AND s.rn = 1 AND NOT EXISTS (SELECT 1 FROM core.party x WHERE x.national_id = s.nc))
                      THEN s.nc END,
                 s.c_code, %s
          FROM (SELECT src.*, core.valid_national_id(src.nc) ok,
                       row_number() OVER (PARTITION BY CASE WHEN core.valid_national_id(src.nc) THEN src.nc ELSE src.c_code END ORDER BY src.c_code) rn
                FROM src) s""", (source_db,))
        stats["parties_created"] = conn.execute("""
          INSERT INTO core.party_legacy_code (party_id, source_db, legacy_code, legacy_name, legacy_national_code, legacy_debit_account,
                 legacy_credit_account, legacy_tags, source_row_hash, first_seen_run, last_seen_run, link_rule)
          SELECT pa.id, %s, src.c_code, src.name, src.nc_raw, src.debit_account, src.credit_account,
                 CASE WHEN src.is_beta THEN '{beta}'::text[] ELSE '{}' END, src.source_row_hash, %s, %s, 'new_party'
          FROM src JOIN core.party pa ON pa.holoo_source_db = %s AND pa.holoo_c_code = src.c_code
          WHERE NOT EXISTS (SELECT 1 FROM core.party_legacy_code l WHERE l.party_id = pa.id)""",
          (source_db, run_id, run_id, source_db)).rowcount
        # 4. legacy balances of person accounts (balance before closing entries), upsert with lineage
        res = conn.execute(f"""
          WITH beta AS (SELECT code FROM holoo_mirror.account WHERE source_db = %(db)s AND removed_run IS NULL AND {BETA_ACCOUNT}),
          acc AS (SELECT DISTINCT ON (a) a, party_id FROM (
                    SELECT legacy_debit_account a, party_id, id FROM core.party_legacy_code WHERE source_db = %(db)s AND legacy_debit_account IS NOT NULL
                    UNION ALL SELECT legacy_credit_account, party_id, id FROM core.party_legacy_code WHERE source_db = %(db)s AND legacy_credit_account IS NOT NULL) z
                  ORDER BY a, id),
          bal AS (SELECT l.account_code a, sum(l.debit - l.credit) b FROM holoo_mirror.voucher_line l JOIN holoo_mirror.voucher v USING (source_db, sanad_code)
                  WHERE l.source_db = %(db)s AND l.in_ledger AND l.removed_run IS NULL AND v.removed_run IS NULL
                    AND v.state NOT IN ('closing_temporary', 'closing') GROUP BY 1)
          INSERT INTO core.legacy_balance (party_id, source_db, legacy_account_code, balance, is_beta, first_seen_run, last_seen_run)
          SELECT acc.party_id, %(db)s, acc.a, round(coalesce(bal.b, 0)), acc.a IN (SELECT code FROM beta), %(run)s, %(run)s
          FROM acc LEFT JOIN bal ON bal.a = acc.a
          ON CONFLICT (source_db, legacy_account_code) DO UPDATE SET balance = EXCLUDED.balance, last_seen_run = EXCLUDED.last_seen_run
          WHERE core.legacy_balance.balance IS DISTINCT FROM EXCLUDED.balance OR core.legacy_balance.last_seen_run IS DISTINCT FROM EXCLUDED.last_seen_run
          RETURNING (xmax = 0) AS inserted""", {"db": source_db, "run": run_id}).fetchall()
        stats["balances_inserted"] = sum(1 for (i,) in res if i)
        stats["balances_updated"] = sum(1 for (i,) in res if not i)
    return stats
