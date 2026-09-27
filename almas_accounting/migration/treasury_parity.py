"""Treasury documents (receipt / payment / transfer / bank fee) and guarantee instruments vs Holoo vouchers of
types 1, 2, 4, 5, 7 without cheques, and memo (guarantee) vouchers of types 0 and 4.

Each Holoo voucher is decomposed (decompose) into the typed treasury documents of the new model — one per real
event: a Holoo «receipt» that also moves money between two banks becomes a receipt + a transfer — then the core
rule core.treasury_posting_lines rebuilds every document and the sum is compared with the voucher, net per account
and party. Memo vouchers are rebuilt by core.guarantee_event_lines. Vouchers that fit no shape are reported; they
belong to the general journal (or reveal a misuse of the voucher type).
Also checked: a bank fee is booked on the fee account configured for that bank (ACOUND_N.Wage_*).
"""
from __future__ import annotations

import collections
import json

from migration import posting_parity

TYPES = {1: "bank transfer", 2: "cash deposit", 4: "receipt", 5: "payment", 7: "bank fee"}


def decompose(lines, money: set, fee_accounts: set, discount_accounts: set = frozenset()):
    """Split one Holoo voucher into the typed treasury documents of the new model (one per real-world event).

    lines = [(account_id, party_id, debit, credit)] gross. Returns (docs, reason) — docs is None when the voucher is
    not a treasury shape (it then belongs to the general journal). Rules:
      * a fee = debit on a bank fee account paired with a money credit of the same amount (gross); it is charged by
        that money account and attached to that account's document (or becomes its own bank_fee document);
      * what is left is netted per (account, party): non-money credits = a receipt into the single receiving money
        account, non-money debits = a payment from the single paying money account, remaining money movements =
        transfers between own accounts (one per source).
    """
    pool = [list(x) for x in lines]
    fees = []                                                   # (payer money account, fee account, amount)
    for f in pool:
        if f[0] in fee_accounts and f[2] > 0 and f[3] == 0:
            pay = next((m for m in pool if m is not f and m[0] in money and m[3] == f[2] and m[2] == 0 and m[1] is None), None)
            if pay is not None:
                fees.append((pay[0], f[0], f[2])); f[2] = 0; pay[3] = 0
    net = collections.Counter()
    for a, p, d, c in pool:
        net[(a, p)] += d - c
    net = {k: x for k, x in net.items() if abs(x) >= 1}
    m_in = [(k[0], x) for k, x in net.items() if k[0] in money and x > 0]
    m_out = [(k[0], -x) for k, x in net.items() if k[0] in money and x < 0]
    others = [(k, x) for k, x in net.items() if k[0] not in money]
    # a fee merged into the money line (no gross pair): charged by the single paying money account
    loose = [(k, x) for k, x in others if k[0] in fee_accounts and k[1] is None and x > 0]
    if loose and len(m_out) == 1 and all(x < 0 for k, x in others if (k, x) not in loose):
        for k, x in loose:
            fees.append((m_out[0][0], k[0], x))
        m_out = [(m_out[0][0], m_out[0][1] - sum(x for k, x in loose))]
        m_out = [(a, x) for a, x in m_out if abs(x) >= 1]
        others = [(k, x) for k, x in others if (k, x) not in loose]
    # cash discount: given on a receipt (debit), received on a payment (credit)
    disc = [(k, x) for k, x in others if k[0] in discount_accounts and k[1] is None]
    rest = [(k, x) for k, x in others if (k, x) not in disc]
    if disc and rest and (all(x < 0 for k, x in rest) and all(x > 0 for k, x in disc)
                          or all(x > 0 for k, x in rest) and all(x < 0 for k, x in disc)):
        others = rest
    else:
        disc = []
    docs = []
    if others and all(x < 0 for k, x in others):               # receipt
        dest = [a for a, x in m_in]
        if len(dest) != 1:
            return None, "receipt without a single receiving money account"
        docs.append({"kind": "receipt", "money_account_id": dest[0],
                     "counter": [{"account_id": k[0], "party_id": k[1], "amount": -x} for k, x in others]})
        docs += [{"kind": "transfer", "money_account_id": a, "counter": [{"account_id": dest[0], "amount": x}]} for a, x in m_out]
        if disc:
            docs[0]["discounts"] = [{"account_id": k[0], "amount": x} for k, x in disc]
        if abs(sum(x for a, x in m_in) - sum(-x for k, x in others) + sum(x for k, x in disc) - sum(x for a, x in m_out)) >= 1:
            return None, "receipt does not balance"
    elif others and all(x > 0 for k, x in others):             # payment
        src = [a for a, x in m_out]
        if len(src) != 1:
            return None, "payment without a single paying money account"
        docs.append({"kind": "payment", "money_account_id": src[0],
                     "counter": [{"account_id": k[0], "party_id": k[1], "amount": x} for k, x in others]})
        docs += [{"kind": "transfer", "money_account_id": src[0], "counter": [{"account_id": a, "amount": x}]} for a, x in m_in]
        if disc:
            docs[0]["discounts"] = [{"account_id": k[0], "amount": -x} for k, x in disc]
    elif others:
        return None, "mixed non-money debits and credits"
    elif m_in or m_out:                                         # transfers only
        if len(m_out) == 1:
            docs.append({"kind": "transfer", "money_account_id": m_out[0][0], "counter": [{"account_id": a, "amount": x} for a, x in m_in]})
        elif len(m_in) == 1:
            docs += [{"kind": "transfer", "money_account_id": a, "counter": [{"account_id": m_in[0][0], "amount": x}]} for a, x in m_out]
        else:
            return None, "many-to-many transfer"
    for payer, acc, amt in fees:
        d = next((d for d in docs if d["money_account_id"] == payer and d["kind"] != "bank_fee"), None)
        if d is None:
            docs.append(d := {"kind": "bank_fee", "money_account_id": payer, "counter": []})
        d.setdefault("fees", []).append({"account_id": acc, "amount": amt})
    for d in docs:                                              # a lone fee document: the fee is its counter
        if d["kind"] == "bank_fee":
            d["counter"], d["fees"] = d.pop("fees"), []
    return (docs or None), ("empty" if not docs else None)


def guarantee_parity(conn, net: dict, memo_acc: dict, sanad: int, db: str):
    """Rebuild a Holoo memo voucher from core.guarantee_event_lines (inside a rolled-back transaction)."""
    for mm, cc in (("0010002", "0020002"), ("0010001", "0020001")):
        am, ac = memo_acc.get(mm), memo_acc.get(cc)
        x = net.get((am, None), 0)
        if not x or set(net) != {(am, None), (ac, None)}:
            continue
        with conn.transaction(force_rollback=True):
            g = conn.execute("""INSERT INTO core.guarantee_instrument (direction, amount, memo_account_id, memo_counter_account_id,
                                legacy_source_db, legacy_voucher) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                             ("received" if mm == "0010002" else "given", abs(x), am, ac, db, sanad)).fetchone()[0]
            conn.execute("INSERT INTO core.guarantee_event (guarantee_id, event_type, effective_date) VALUES (%s, 'taken', '2000-01-01')", (g,))
            if x < 0:
                conn.execute("INSERT INTO core.guarantee_event (guarantee_id, event_type, effective_date) VALUES (%s, 'released', '2000-01-02')", (g,))
            ev = conn.execute("SELECT max(id) FROM core.guarantee_event WHERE guarantee_id = %s", (g,)).fetchone()[0]
            out = collections.Counter()
            for a, p, d, c in conn.execute("SELECT account_id, party_id, debit, credit FROM core.guarantee_event_lines(%s)", (ev,)).fetchall():
                out[(a, None)] += float(d) - float(c)         # Holoo has no guarantor: compare on the account only (W-35)
        ok = all(abs(out.get(k, 0) - net.get(k, 0)) < 1 for k in set(out) | set(net))
        return ok, ("taken " if x > 0 else "released ") + mm
    return False, None


def run(conn, db: str) -> dict:
    posting_parity.prepare(conn, db)
    money = {r[0] for r in conn.execute("""SELECT DISTINCT m.account_id FROM core.legacy_account_map m WHERE m.source_db = %s
                                           AND (m.legacy_code LIKE '101%%' OR m.legacy_code LIKE '102%%') AND m.account_id IS NOT NULL""", (db,))}
    fee_acc_by_bank = dict(conn.execute("""SELECT g.account_id, f.account_id FROM holoo_mirror.bank_account b
        JOIN core.legacy_account_map g ON g.source_db = b.source_db AND g.legacy_code = b.account_code
        JOIN core.legacy_account_map f ON f.source_db = b.source_db AND f.legacy_code = b.fee_account_code WHERE b.source_db = %s""", (db,)).fetchall())
    fee_accounts = set(fee_acc_by_bank.values())
    discount_accounts = {r[0] for r in conn.execute("""SELECT core.setting_account(k) FROM unnest(ARRAY['account_purchase_cash_discount',
                                                        'account_sales_cash_discount']) k""") if r[0]}
    rows = conn.execute("""
        SELECT v.sanad_code, v.voucher_type, m.account_id, m.party_id, l.debit, l.credit, l.account_code LIKE '00%%'
        FROM holoo_mirror.voucher v JOIN holoo_mirror.voucher_line l ON l.source_db = v.source_db AND l.sanad_code = v.sanad_code AND l.in_ledger AND l.removed_run IS NULL
        JOIN core.legacy_account_map m ON m.source_db = l.source_db AND m.legacy_code = l.account_code
        WHERE v.source_db = %s AND v.removed_run IS NULL AND v.voucher_type IN (0, 1, 2, 4, 5, 7)
          AND NOT EXISTS (SELECT 1 FROM holoo_mirror.cheque_event e WHERE e.source_db = v.source_db AND e.voucher_code = v.sanad_code)
        ORDER BY v.sanad_code, l.line_index""", (db,)).fetchall()
    vouchers = collections.defaultdict(list)
    vtype, memo = {}, collections.defaultdict(bool)
    for s, t, a, p, d, c, is_memo in rows:
        vouchers[s].append((a, p, float(d), float(c))); vtype[s] = t
        memo[s] = memo[s] or is_memo
    memo_acc = dict(conn.execute("""SELECT legacy_code, account_id FROM core.legacy_account_map WHERE source_db = %s
                                    AND legacy_code IN ('0010002', '0020002', '0010001', '0020001')""", (db,)).fetchall())
    res = collections.Counter(); unclass = collections.Counter(); fee_check = collections.Counter()
    examples = collections.defaultdict(list); split = collections.Counter(); guar = collections.Counter()
    for s, ls in vouchers.items():
        t = vtype[s]
        net = collections.Counter()
        for a, p, d, c in ls:
            net[(a, p)] += d - c
        net = {k: x for k, x in net.items() if abs(x) >= 1}
        if memo[s]:                                              # guarantee instruments (memo accounts only)
            ok, kind = guarantee_parity(conn, net, memo_acc, s, db)
            res[(TYPES.get(t, t), "guarantee", ok)] += 1
            if ok:
                guar[kind] += 1
            elif len(examples["guarantee"]) < 5:
                examples["guarantee"].append(s)
            continue
        if t == 0:
            continue                                             # other automatic vouchers are cheque/opening, not treasury
        docs, why = decompose(ls, money, fee_accounts, discount_accounts)
        if docs is None:
            shape = tuple(sorted(("M" if k[0] in money else "P" if k[1] else "A") + ("+" if x > 0 else "-") for k, x in net.items()))
            unclass[(TYPES.get(t, t), why, shape)] += 1
            if len(examples["unclassified"]) < 10:
                examples["unclassified"].append(s)
            continue
        out = collections.Counter()
        for doc in docs:
            for r in conn.execute("SELECT account_id, party_id, debit, credit FROM core.treasury_posting_lines(%s::jsonb)", (json.dumps(doc),)).fetchall():
                out[(r[0], r[1])] += float(r[2]) - float(r[3])
            for f in doc.get("fees", []) + (doc["counter"] if doc["kind"] == "bank_fee" else []):
                fee_check["fee on the bank's configured fee account" if fee_acc_by_bank.get(doc["money_account_id"]) == f["account_id"]
                          else "fee on another bank's fee account"] += 1
        ok = all(abs(out.get(k, 0) - net.get(k, 0)) < 1 for k in set(out) | set(net))
        kinds = "+".join(sorted({d["kind"] for d in docs}))
        res[(TYPES.get(t, t), kinds, ok)] += 1
        if len(docs) > 1 and len({d["kind"] for d in docs}) > 1:
            split[(TYPES.get(t, t), kinds)] += 1
        if not ok and len(examples[kinds]) < 3:
            examples[kinds].append(s)
    return {"compared": {f"{a} → {b}": {"identical" if ok else "different": n} for (a, b, ok), n in sorted(res.items(), key=str)},
            "not_a_treasury_shape": {f"{a}: {w} [{' '.join(b)}]": n for (a, w, b), n in unclass.most_common(12)},
            "compound_vouchers_split": {f"{a} → {b}": n for (a, b), n in split.items()},
            "guarantees": dict(guar),
            "fee_account_check": dict(fee_check), "examples": dict(examples),
            "vouchers": len(vouchers) - sum(1 for s in vouchers if vtype[s] == 0 and not memo[s]),
            "identical": sum(n for (a, b, ok), n in res.items() if ok)}


if __name__ == "__main__":
    import argparse
    import psycopg
    ap = argparse.ArgumentParser(); ap.add_argument("--pg", required=True); ap.add_argument("--source-db", required=True)
    a = ap.parse_args()
    with psycopg.connect(a.pg, autocommit=True) as c:
        print(json.dumps(run(c, a.source_db), ensure_ascii=False, indent=1))
