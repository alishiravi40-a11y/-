"""Beta-system contracts report import (E15 format). Each file is a SNAPSHOT of contract status at report time.

Q-1: the scheme is NEVER inferred — the caller passes scheme_id explicitly.
* idempotent by file SHA-256; snapshot rows stored immutably (core.beta_contract_snapshot);
* party by national code (verified id / claim / Holoo legacy code), else a new party (id verified only if free);
  the customer's bank account number is stored on the party (E15: one account per customer);
* new contract → created with its schedule (floor rule, first due from source) and activated (capacity: imported_from_beta);
  a first-installment amount that contradicts floor(total/count) is NOT created → reported for review;
* existing contract: changed total / count / first due → contract_amendment (pending review), never applied silently;
  more deleted installments than before → the last unpaid installments are cancelled with review_status pending_review;
  collected / overdue counts are kept as observations (control B-13 compares them with recorded receipts).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json

import jdatetime
import openpyxl

from . import contracts
from .common import amount, find_party, name_key, national_code, norm, sha256_file

COLS = {"id": "شناسه", "reg_date": "تاریخ ثبت", "reg_time": "زمان ثبت", "nc": "کدملی مشتری", "first": "نام مشتری",
        "last": "نام خانوادگی مشتری", "account": "شماره حساب", "total": "مبلغ کل اعتباری", "first_due": "تاریخ اولین قسط",
        "first_amount": "مبلغ اولین قسط", "count": "اقساط", "collected": "اقساط وصولی", "overdue": "اقساط سررسید",
        "deleted": "اقساط حذف شده", "collected_amount": "مبلغ اقساط وصولی"}


def jdate(s) -> dt.date:
    y, m, d = (int(x) for x in norm(s).split("/"))
    return jdatetime.date(y, m, d).togregorian()


def read_xlsx(path: str) -> list[dict]:
    ws = openpyxl.load_workbook(path, data_only=True, read_only=True).active
    it = ws.iter_rows(values_only=True)
    hdr = [norm(h) for h in next(it)]
    idx = {k: hdr.index(v) for k, v in COLS.items()}
    out = []
    for r in it:
        if r[idx["id"]] is None:
            continue
        g = {k: r[i] for k, i in idx.items()}
        t = norm(g["reg_time"]) or "00:00:00"
        out.append({"bank_contract_id": norm(g["id"]), "nc": national_code(g["nc"]), "name": norm(f"{g['first'] or ''} {g['last'] or ''}"),
                    "account": norm(g["account"]) or None,
                    "registered_at": dt.datetime.combine(jdate(g["reg_date"]), dt.time.fromisoformat(t)),
                    "total": amount(g["total"]), "count": int(amount(g["count"])), "first_due": norm(g["first_due"]),
                    "first_amount": amount(g["first_amount"]), "collected": int(amount(g["collected"])),
                    "overdue": int(amount(g["overdue"])), "deleted": int(amount(g["deleted"])),
                    "collected_amount": amount(g["collected_amount"])})
    return out


def _party(conn, row, user, stats):
    pid = find_party(conn, row["nc"])
    if pid is None:
        free = row["nc"] and conn.execute("SELECT core.valid_national_id(%s) AND NOT EXISTS (SELECT 1 FROM core.party WHERE national_id = %s)",
                                          (row["nc"], row["nc"])).fetchone()[0]
        pid = conn.execute("INSERT INTO core.party (name, name_key, national_id, national_id_claim) VALUES (%s,%s,%s,%s) RETURNING id",
                           (row["name"], name_key(row["name"]), row["nc"] if free else None, None if free else row["nc"])).fetchone()[0]
        stats["parties_created"] += 1
    if row["account"]:
        other = conn.execute("SELECT party_id FROM core.party_bank_account WHERE bank_code = 'beta' AND account_no = %s", (row["account"],)).fetchone()
        if other is None:
            conn.execute("INSERT INTO core.party_bank_account (party_id, bank_code, account_no, source) VALUES (%s, 'beta', %s, 'beta_export')",
                         (pid, row["account"]))
        elif other[0] != pid:
            stats["account_conflicts"] += 1
    return pid


def import_snapshot(conn, path: str, scheme_id: int, user: str) -> dict:
    return import_rows(conn, read_xlsx(path), sha256_file(path), path.split("/")[-1], scheme_id, user)


def import_rows(conn, rows: list[dict], sha: str, file_name: str, scheme_id: int, user: str) -> dict:
    if scheme_id is None:
        raise ValueError("Q-1: the scheme of a Beta export must be chosen explicitly")
    if conn.execute("SELECT 1 FROM core.import_file WHERE kind = 'beta_contract_snapshot' AND sha256 = %s", (sha,)).fetchone():
        return {"status": "duplicate", "sha256": sha}
    stats = {"status": "imported", "rows": len(rows), "parties_created": 0, "account_conflicts": 0, "contracts_created": 0,
             "schedule_mismatch": 0, "amendments": 0, "cancellations_pending_review": 0, "unchanged": 0}
    with conn.transaction():
        fid = conn.execute("""INSERT INTO core.import_file (kind, sha256, file_name, scheme_id, imported_by)
                              VALUES ('beta_contract_snapshot', %s, %s, %s, %s) RETURNING id""", (sha, file_name, scheme_id, user)).fetchone()[0]
        for r in rows:
            h = hashlib.sha256(json.dumps(r, default=str, sort_keys=True).encode()).hexdigest()
            conn.execute("""INSERT INTO core.beta_contract_snapshot (file_id, bank_contract_id, national_code, registered_at, total_amount, installment_count,
                            first_due_date, first_installment_amount, collected_count, collected_amount, overdue_count, cancelled_count, customer_account_no, row_hash)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                         (fid, r["bank_contract_id"], r["nc"] or "", r["registered_at"], r["total"], r["count"], jdate(r["first_due"]),
                          r["first_amount"], r["collected"], r["collected_amount"], r["overdue"], r["deleted"], r["account"], h))
            pid = _party(conn, r, user, stats)
            c = conn.execute("""SELECT id, total_amount, installment_count, first_due_date FROM core.installment_contract
                                WHERE scheme_id = %s AND bank_contract_id = %s""", (scheme_id, r["bank_contract_id"])).fetchone()
            if c is None:
                if r["first_amount"] != r["total"] // r["count"]:
                    stats["schedule_mismatch"] += 1
                    continue
                cid = contracts.create(conn, scheme_id=scheme_id, party_id=pid, total=r["total"], count=r["count"], first_due=r["first_due"],
                                       user=user, bank_contract_id=r["bank_contract_id"], registered_at=r["registered_at"],
                                       source="beta_import", file_id=fid)
                stats["contracts_created"] += 1
                prev_deleted = 0
            else:
                cid = c[0]
                before = {"total": int(c[1]), "count": c[2], "first_due": str(c[3])}
                after = {"total": r["total"], "count": r["count"], "first_due": str(jdate(r["first_due"]))}
                if before != after:
                    conn.execute("INSERT INTO core.contract_amendment (contract_id, source_import_file_id, before, after) VALUES (%s,%s,%s,%s)",
                                 (cid, fid, json.dumps(before), json.dumps(after)))
                    stats["amendments"] += 1
                prev_deleted = conn.execute("""SELECT count(*) FROM core.installment_cancellation x JOIN core.installment i ON i.id = x.installment_id
                                               WHERE i.contract_id = %s AND x.reversed_at IS NULL""", (cid,)).fetchone()[0]
                if before == after and r["deleted"] == prev_deleted:
                    stats["unchanged"] += 1
            if r["deleted"] > prev_deleted:
                todo = conn.execute("""SELECT s.installment_id FROM core.installment_status_at(current_date) s WHERE s.contract_id = %s
                                       AND NOT s.cancelled AND s.paid = 0 ORDER BY s.seq DESC LIMIT %s""", (cid, r["deleted"] - prev_deleted)).fetchall()
                for (iid,) in todo:
                    conn.execute("SELECT core.cancel_installment(%s, 'beta_import', %s, %s, %s, 'pending_review')",
                                 (iid, f"deleted in Beta system (snapshot {sha[:12]})", user, fid))
                    stats["cancellations_pending_review"] += 1
        conn.execute("UPDATE core.import_file SET stats = %s WHERE id = %s", (json.dumps(stats), fid))
    return stats
