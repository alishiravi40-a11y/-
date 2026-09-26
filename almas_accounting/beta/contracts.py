"""Create installment contracts (draft → schedule → activate). All rules are enforced by the database (004_beta.sql)."""
from __future__ import annotations

from . import schedule as S


def setting(conn, key):
    return conn.execute("SELECT core.setting_value(%s)", (key,)).fetchone()[0]


def create(conn, *, scheme_id, party_id, total, count, first_due, user, bank_contract_id=None, registered_at=None,
           sale_ref=None, goods=None, bank_share=None, store_fee=None, source="manual", file_id=None,
           capacity_note=None, activate=True) -> int:
    rows = S.build(total, count, first_due, setting(conn, "beta_schedule_remainder"))
    with conn.transaction():
        cid = conn.execute(
            """INSERT INTO core.installment_contract (scheme_id, party_id, bank_contract_id, registered_at, sale_ref, total_amount,
               goods_amount, bank_share_amount, store_fee_amount, installment_count, first_due_date, source, source_import_file_id,
               capacity_note, created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (scheme_id, party_id, bank_contract_id, registered_at, sale_ref, total, goods, bank_share, store_fee, count,
             rows[0][1], source, file_id, capacity_note, user)).fetchone()[0]
        if goods is not None:
            for seq, due, amt, g, b, f in S.split_components(rows, goods, bank_share, store_fee):
                conn.execute("""INSERT INTO core.installment (contract_id, seq, due_date, amount, goods_part, bank_share_part, store_fee_part)
                                VALUES (%s,%s,%s,%s,%s,%s,%s)""", (cid, seq, due, amt, g, b, f))
        else:
            for seq, due, amt in rows:
                conn.execute("INSERT INTO core.installment (contract_id, seq, due_date, amount) VALUES (%s,%s,%s,%s)", (cid, seq, due, amt))
        if activate:
            conn.execute("UPDATE core.installment_contract SET status = 'active', activated_by = %s WHERE id = %s", (user, cid))
    return cid
