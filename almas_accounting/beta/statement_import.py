"""Bank statement import for a Beta scheme account (E16 format: bank 'DynamicReport' .xls).

* idempotent: file SHA-256 (same file → no-op) and per line natural key doc_no|date|time|deposit|withdrawal|balance
  (bank row numbers restart in every export, so they are not keys); overlapping statements add only new lines;
* every line is classified: installment | bank_share_candidate (Q-2) | bank_fee | other_deposit | other_withdrawal;
* installment lines: deposit id = customer national code (E16) → party → active contracts of schemes paid into this
  account → the installment due in the window [value_date-40d, value_date+5d] with the same amount.
  Exactly one candidate and a consistent name → 'auto_matched'; with auto_apply (explicit, default off) a bank_collection
  receipt is recorded and applied to THAT installment (an already-paid installment yields a duplicate-collection credit).
  Everything else → 'party_identified' / 'needs_review' / 'unmatched' for a person to decide.
"""
from __future__ import annotations

import datetime as dt
import json
import re

import jdatetime
import xlrd

from .common import amount, find_party, name_key, national_code, norm, sha256_file

SHARE_CANDIDATE = re.compile(r"REFA|رفاه")                   # Q-2: instant PAYA to Refah — candidates only
FEE = re.compile(r"کارمزد|هزینه|پیامک|پرینت|صورتحساب")


def read_xls(path: str) -> list[dict]:
    sh = xlrd.open_workbook(path).sheets()[0]
    hrow = next(r for r in range(min(sh.nrows, 20)) if {"تاریخ", "واریز", "برداشت"} <= {norm(v) for v in sh.row_values(r)})
    hdr = [norm(v) for v in sh.row_values(hrow)]
    out = []
    for r in range(hrow + 1, sh.nrows):
        v = dict(zip(hdr, sh.row_values(r)))
        d = norm(v.get("تاریخ"))
        if not re.fullmatch(r"\d{4}/\d{2}/\d{2}", d):
            continue
        y, m, day = (int(x) for x in d.split("/"))
        out.append({"date": jdatetime.date(y, m, day).togregorian(), "jdate": d, "time": norm(v.get("زمان")),
                    "doc_no": norm(v.get("شماره سند")), "branch": norm(v.get("شعبه")), "deposit": amount(v.get("واریز")),
                    "withdrawal": amount(v.get("برداشت")), "balance": amount(v.get("موجودی")),
                    "deposit_id": norm(v.get("شناسه واریز")), "description": norm(v.get("توضیحات"))})
    return out


def classify(line: dict) -> str:
    if line["deposit"] > 0:
        return "installment" if "قسط" in line["description"] else "other_deposit"
    if SHARE_CANDIDATE.search(line["description"]):
        return "bank_share_candidate"
    if line["withdrawal"] < 1_000_000 and FEE.search(line["description"]):
        return "bank_fee"
    return "other_withdrawal"


def balance_chain_ok(lines) -> bool:
    fwd = all(lines[i - 1]["balance"] + lines[i]["deposit"] - lines[i]["withdrawal"] == lines[i]["balance"] for i in range(1, len(lines)))
    back = all(lines[i]["balance"] + lines[i - 1]["deposit"] - lines[i - 1]["withdrawal"] == lines[i - 1]["balance"] for i in range(1, len(lines)))
    return fwd or back


def match(conn, line: dict, account_id: int) -> tuple[str, dict]:
    nc = national_code(line["deposit_id"])
    party = find_party(conn, nc)
    payer = name_key(re.sub(r"^.*?بابت\s*قسط", "", line["description"]))
    if party is None:
        return "unmatched", {"reason": "no party for deposit id", "deposit_id_is_national_code": bool(nc)}
    pname = conn.execute("SELECT name FROM core.party WHERE id = %s", (party,)).fetchone()[0]
    name_ok = bool(payer) and (payer in name_key(pname) or name_key(pname) in payer)
    cands = conn.execute("""
      SELECT i.id, i.contract_id, i.seq, i.due_date, i.amount, st.outstanding FROM core.installment i
      JOIN core.installment_contract c ON c.id = i.contract_id AND c.status = 'active' AND c.party_id = %s
      JOIN core.beta_scheme s ON s.id = c.scheme_id AND s.company_bank_account_id = %s
      JOIN core.installment_status_at(%s) st ON st.installment_id = i.id AND NOT st.cancelled
      WHERE i.due_date BETWEEN %s::date - 40 AND %s::date + 5""",
      (party, account_id, line["date"], line["date"], line["date"])).fetchall()
    exact_all = [c for c in cands if c[4] == line["deposit"]]
    unpaid = [c for c in exact_all if c[5] > 0]
    # prefer the single unpaid installment of that amount; only if none is unpaid can it be a duplicate collection
    exact = unpaid if unpaid else exact_all
    detail = {"party_id": party, "name_consistent": name_ok, "candidates": len(cands), "amount_matches": len(exact_all),
              "possible_duplicate": not unpaid and len(exact_all) == 1}
    if not cands:
        n_contracts = conn.execute("""SELECT count(*) FROM core.installment_contract c JOIN core.beta_scheme s ON s.id = c.scheme_id
                                      WHERE c.party_id = %s AND s.company_bank_account_id = %s""", (party, account_id)).fetchone()[0]
        detail["reason"] = "no contract of this party in schemes of this account" if n_contracts == 0 else "no installment due in window"
        return "party_identified", detail
    if len(exact) == 1 and name_ok:
        detail["installment_id"] = exact[0][0]
        return "auto_matched", detail
    detail["reason"] = "ambiguous or amount/name mismatch"
    return "needs_review", detail


def import_statement(conn, path: str, account_id: int, user: str, auto_apply: bool = False) -> dict:
    return import_lines(conn, read_xls(path), sha256_file(path), path.split("/")[-1], account_id, user, auto_apply)


def import_lines(conn, lines: list[dict], sha: str, file_name: str, account_id: int, user: str, auto_apply: bool = False) -> dict:
    if conn.execute("SELECT 1 FROM core.import_file WHERE kind = 'bank_statement' AND sha256 = %s", (sha,)).fetchone():
        return {"status": "duplicate", "sha256": sha}
    stats = {"status": "imported", "sha256": sha, "lines": len(lines), "balance_chain_ok": balance_chain_ok(lines),
             "new_lines": 0, "known_lines": 0, "by_class": {}, "installment_match": {}, "receipts_created": 0, "credits_created": 0}
    with conn.transaction():
        fid = conn.execute("""INSERT INTO core.import_file (kind, sha256, file_name, company_bank_account_id, imported_by)
                              VALUES ('bank_statement', %s, %s, %s, %s) RETURNING id""", (sha, file_name, account_id, user)).fetchone()[0]
        for ln in lines:
            nk = "|".join(str(ln[k]) for k in ("doc_no", "jdate", "time", "deposit", "withdrawal", "balance"))
            cls = classify(ln)
            stats["by_class"][cls] = stats["by_class"].get(cls, 0) + 1
            row = conn.execute("""
              INSERT INTO core.bank_statement_line (company_bank_account_id, value_date, value_time, doc_no, branch, deposit, withdrawal,
                     balance, deposit_id, description, natural_key, first_file_id, last_file_id, classification, match_status)
              VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
              ON CONFLICT (company_bank_account_id, natural_key) DO UPDATE SET last_file_id = EXCLUDED.last_file_id
              RETURNING id, (xmax = 0)""",
              (account_id, ln["date"], ln["time"], ln["doc_no"], ln["branch"], ln["deposit"], ln["withdrawal"], ln["balance"],
               ln["deposit_id"] or None, ln["description"], nk, fid, fid, cls,
               "unmatched" if cls in ("installment", "bank_share_candidate") else "not_applicable")).fetchone()
            lid, new = row
            if not new:
                stats["known_lines"] += 1
                continue
            stats["new_lines"] += 1
            if cls == "bank_share_candidate":
                conn.execute("""INSERT INTO core.bank_share_withdrawal (company_bank_account_id, amount, value_date, bank_doc_no, statement_line_id,
                                note, created_by) VALUES (%s,%s,%s,%s,%s,'Q-2 candidate from statement import',%s)""",
                             (account_id, ln["withdrawal"], ln["date"], ln["doc_no"], lid, user))
                conn.execute("UPDATE core.bank_statement_line SET match_status = 'needs_review' WHERE id = %s", (lid,))
            if cls != "installment":
                continue
            status, detail = match(conn, ln, account_id)
            if status == "auto_matched" and auto_apply:
                rid = conn.execute("SELECT core.record_receipt('bank_collection', %s, %s, %s, NULL, %s, %s, %s, 'statement import', %s, %s, %s)",
                                   (ln["deposit"], ln["date"], account_id, detail["party_id"],
                                    re.sub(r"^.*?بابت\s*قسط\s*", "", ln["description"]) or None, user, lid, ln["deposit_id"], ln["doc_no"])).fetchone()[0]
                res = conn.execute("SELECT core.apply_receipt(%s, %s, %s)", (rid, detail["installment_id"], user)).fetchone()[0]
                detail.update(receipt_id=rid, applied=res)
                stats["receipts_created"] += 1
                stats["credits_created"] += 1 if res.get("credit") else 0
            stats["installment_match"][status] = stats["installment_match"].get(status, 0) + 1
            conn.execute("UPDATE core.bank_statement_line SET match_status = %s, match_detail = %s WHERE id = %s",
                         (status, json.dumps(detail, default=str), lid))
        conn.execute("UPDATE core.import_file SET stats = %s WHERE id = %s", (json.dumps(stats), fid))
    return stats
