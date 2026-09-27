"""Automatic bank reconciliation (core 010). Rules, strictest first; a rule only fires when the match is UNAMBIGUOUS
(exactly one candidate on both sides), everything else is left for a person:

  1. exact        — same direction, same amount, same date;
  2. window       — same direction, same amount, dates within `bank_recon_date_window_days` (default 3);
  3. same_day_sum — all still-open book lines of one date and direction add up exactly to one statement line of
                    that date (e.g. several POS receipts settled as one bank credit), or the reverse (several bank fee
                    lines booked as one entry).
Every group goes through core.reconcile (balance check, permission, one live group per line).
"""
from __future__ import annotations

import collections
import datetime as dt
import json


def _open(conn, account: int):
    st = conn.execute("""SELECT statement_line_id, value_date, net FROM core.bank_statement_recon
                         WHERE company_bank_account_id = %s AND group_id IS NULL AND net <> 0""", (account,)).fetchall()
    bk = conn.execute("""SELECT entry_id, line_no, effective_date, net FROM core.bank_book_line
                         WHERE company_bank_account_id = %s AND group_id IS NULL""", (account,)).fetchall()
    return [(r[0], r[1], int(r[2])) for r in st], [((r[0], r[1]), r[2], int(r[3])) for r in bk]


def _unique_pairs(st, bk, window: int):
    """Mutually unique (statement, book) pairs of equal net within `window` days."""
    by_amt = collections.defaultdict(list)
    for key, d, n in bk:
        by_amt[n].append((key, d))
    cand_s = {}
    cand_b = collections.defaultdict(list)
    for sid, d, n in st:
        c = [k for k, bd in by_amt.get(n, []) if abs((bd - d).days) <= window]
        cand_s[sid] = c
        for k in c:
            cand_b[k].append(sid)
    return [(sid, c[0]) for sid, c in cand_s.items() if len(c) == 1 and len(cand_b[c[0]]) == 1]


def auto_match(conn, account: int, user: str) -> dict:
    window = int(conn.execute("SELECT core.setting_value('bank_recon_date_window_days')").fetchone()[0])
    out = collections.Counter()
    for method, w in (("exact", 0), ("window", window)):
        st, bk = _open(conn, account)
        for sid, key in _unique_pairs(st, bk, w):
            conn.execute("SELECT core.reconcile(%s, %s, %s::jsonb, %s, %s)", (account, [sid], json.dumps([list(key)]), method, user))
            out[method] += 1
    st, bk = _open(conn, account)
    s_day = collections.defaultdict(list); b_day = collections.defaultdict(list)
    for sid, d, n in st:
        s_day[(d, n > 0)].append((sid, n))
    for key, d, n in bk:
        b_day[(d, n > 0)].append((key, n))
    for k in set(s_day) & set(b_day):
        ss, bb = s_day[k], b_day[k]
        if len(ss) == 1 and len(bb) >= 2 and sum(n for _, n in bb) == ss[0][1]:
            conn.execute("SELECT core.reconcile(%s, %s, %s::jsonb, 'same_day_sum', %s)", (account, [ss[0][0]], json.dumps([list(x) for x, _ in bb]), user))
            out["same_day_sum"] += 1
        elif len(bb) == 1 and len(ss) >= 2 and sum(n for _, n in ss) == bb[0][1]:
            conn.execute("SELECT core.reconcile(%s, %s, %s::jsonb, 'same_day_sum', %s)", (account, [x for x, _ in ss], json.dumps([list(bb[0][0])]), user))
            out["same_day_sum"] += 1
    st, bk = _open(conn, account)
    out["statement_open"] = len(st); out["book_open"] = len(bk)
    return dict(out)
