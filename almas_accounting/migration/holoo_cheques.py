"""Holoo cheques → core cheque location model (E18), with parity against Holoo's vouchers.

Holoo keeps where a cheque is IMPLICIT. The rules below were derived from FY1404 and are proven by parity():
  received (D)           : payer party → cash box cheque account (event cash box)
  deposited (J)          : current → collection account of the bank (ACOUND_N.Dar_*)
  collected (V, in coll.): collection account → the bank's GL account
  endorsed (V + person)  : current → the person's account (Holoo code «00000» = nobody → counterparty from the voucher, W-32)
  returned_from_bank (R) : collection → the cash box the cheque last sat in (prior-year cheque: the main cash box)
  moved (M)              : current → the event cash box
  returned_to_payer (B)  : current → the payer's account
  returned_by_endorsee(S): endorsee → the cash box it last sat in
  issued (P, out)        : notes payable of the drawn bank (ACOUND_N.Par_*) → payee's account (liability moves)
  paid_by_bank (V, out)  : bank GL → notes payable
  settled_otherwise (O)  : counterparty from the voucher (loans / partners) → notes payable
  events inside the opening voucher are opening positions: opening-balance account → location.
Nothing is written to holoo_mirror; re-running is idempotent (legacy_event_id).
"""
from __future__ import annotations

import collections

from migration import posting_parity

NOBODY = "00000"
MAIN_CHEQUE_ACCOUNT = "10400010001"          # where prior-year cheques return from the bank (E18)


def _load(conn, db):
    q = lambda sql, *a: conn.execute(sql, a).fetchall()
    ev = q("""SELECT e.event_id, e.check_code, e.state, e.event_date, e.voucher_code, e.account_code, e.cashbox_id,
                     c.direction, c.amount, c.person_code, c.number, c.account_no
              FROM holoo_mirror.cheque_event e JOIN holoo_mirror.cheque c USING (source_db, check_code)
              WHERE e.source_db = %s AND e.removed_run IS NULL ORDER BY e.check_code, e.event_date, e.event_id""", db)
    boxes = dict(q("SELECT id, cheque_account_code FROM holoo_mirror.cashbox WHERE source_db = %s", db))
    pers = {r[0]: (r[1], r[2]) for r in q("SELECT c_code, debit_account, credit_account FROM holoo_mirror.person WHERE source_db = %s", db)}
    banks = q("""SELECT id, account_code, collection_account_code, payable_cheque_account_code, account_no
                 FROM holoo_mirror.bank_account WHERE source_db = %s""", db)
    lines = collections.defaultdict(list)
    for s, a, dr, cr in q("""SELECT l.sanad_code, l.account_code, l.debit, l.credit FROM holoo_mirror.voucher_line l
                            WHERE l.source_db = %s AND l.in_ledger AND l.removed_run IS NULL AND l.sanad_code IN
                            (SELECT voucher_code FROM holoo_mirror.cheque_event WHERE source_db = %s)""", db, db):
        lines[s].append((a, float(dr or 0) - float(cr or 0)))
    vtype = dict(q("SELECT sanad_code, voucher_type FROM holoo_mirror.voucher WHERE source_db = %s", db))
    cbox = dict(q("SELECT check_code, cashbox_id FROM holoo_mirror.cheque WHERE source_db = %s", db))
    opening = {r[0] for r in q("SELECT sanad_code FROM holoo_mirror.voucher WHERE source_db = %s AND state = 'opening'", db)}
    return ev, boxes, pers, banks, lines, vtype, opening, cbox


def derive(conn, db, seed: dict | None = None):
    """Holoo events → [(event, type, from_code, to_code)] with codes in Holoo terms (None = from the voucher), and the
    opening positions of cheques continued from an earlier year → [(event, expected_code_or_None)] to be CHECKED (core 033).
    seed: check_code → {"loc", "onhand", "bank"} (Holoo codes of this database) — where the core already has the cheque."""
    ev, boxes, pers, banks, lines, vtype, opening, cbox = _load(conn, db)
    seed = seed or {}
    coll = {b[1]: b[2] for b in banks}; payable = {b[1]: b[3] for b in banks}
    bank_by_no = {}
    for b in banks:
        bank_by_no.setdefault(b[4], b[1])

    def pacc(code, side):
        a = pers.get(code)
        if not a or code == NOBODY:
            return None
        return (a[0] or a[1]) if side == "in" else (a[1] or a[0])

    out, loc, onhand, bank_of, closed_prior, checks = [], {}, {}, {}, set(), []
    for chk, s0 in seed.items():                                    # a cheque continued from an earlier year starts where the core has it
        loc[chk] = s0.get("loc")
        if s0.get("onhand"):
            onhand[chk] = s0["onhand"]
        if s0.get("bank"):
            bank_of[chk] = s0["bank"]
    for e in ev:
        eid, chk, st, dt, v, acc, box, dirn, amt, person, num, accno = e
        if v in opening and chk in seed:                            # its opening position is the previous year's end: compare, never re-add
            if st == "V":
                expected = pacc(acc, "out") if (acc and dirn == "in") else None
            else:
                expected = boxes.get(box) if st in ("D", "M", "R") else coll.get(acc) if st == "J" else None
            checks.append((e, expected)); continue
        if v in opening and st not in ("D", "J", "P", "M", "R"):
            closed_prior.add(chk); continue                         # collected / spent before the year: no position
        if v in opening:
            to = boxes.get(box) if st == "D" else coll.get(acc) if st == "J" else payable.get(bank_by_no.get(accno)) if dirn == "out" else None
            out.append((e, "opening", "005", to)); loc[chk] = to
            if st == "D":
                onhand[chk] = to
            if st == "J":
                bank_of[chk] = acc
            if dirn == "out":
                bank_of[chk] = bank_by_no.get(accno)
            continue
        if chk not in loc and dirn == "in" and st != "D":          # cheque from a prior year: starts at its cash box (cheque table)
            loc[chk] = boxes.get(cbox.get(chk))
        cur = loc.get(chk)
        if dirn == "in":
            if st == "D":
                to = boxes.get(box); out.append((e, "received", pacc(acc or person, "in"), to)); loc[chk] = onhand[chk] = to
            elif st == "J":
                to = coll.get(acc); bank_of[chk] = acc; out.append((e, "deposited_for_collection", cur, to)); loc[chk] = to
            elif st == "V" and acc:
                to = pacc(acc, "out"); out.append((e, "endorsed_to_party", cur, to)); loc[chk] = to
            elif st == "V" and chk in bank_of and cur == coll.get(bank_of[chk]):
                out.append((e, "collected", cur, bank_of[chk])); loc[chk] = bank_of[chk]
            elif st == "V":                                          # collected, deposit made in a prior year: bank from the voucher
                out.append((e, "collected", None, None)); loc[chk] = None
            elif st == "R":
                to = onhand.get(chk) or MAIN_CHEQUE_ACCOUNT; out.append((e, "returned_from_bank", cur, to)); loc[chk] = onhand[chk] = to
            elif st == "M":
                to = boxes.get(box); out.append((e, "moved_between_cashboxes", cur, to)); loc[chk] = onhand[chk] = to
            elif st == "B":
                to = pacc(person, "in"); out.append((e, "returned_to_payer", cur, to)); loc[chk] = to
            elif st == "S":
                to = onhand.get(chk) or MAIN_CHEQUE_ACCOUNT; out.append((e, "returned_by_endorsee", cur, to)); loc[chk] = to
        else:
            if st == "P":
                bank = bank_by_no.get(accno); bank_of[chk] = bank; frm = payable.get(bank)
                out.append((e, "issued", frm, pacc(acc or person, "out"))); loc[chk] = frm
            elif st == "V":
                out.append((e, "paid_by_bank", bank_of.get(chk), cur))
            elif st == "O":
                out.append((e, "settled_otherwise", None, cur))
    # counterparties Holoo did not record on the cheque (None) are taken from the voucher: the residual lines after the
    # explained ones, matched by amount (W-32). For issued/settled cheques the liability moves the other way.
    by_v = collections.defaultdict(list)
    for r in out:
        by_v[r[0][4]].append(r)
    resolved = []
    for v, rs in by_v.items():
        net = collections.Counter()
        for a, x in lines[v]:
            net[a] += x
        for e, t, f, to in rs:
            if t == "opening":
                continue
            amt = float(e[8])
            if to:
                net[to] -= amt
            if f:
                net[f] += amt
        pool = [[a, x] for a, x in net.items() if abs(x) >= 1]
        for e, t, f, to in rs:
            amt = float(e[8])
            if t != "opening":
                if to is None:                                   # a debit line of this amount is left in the voucher
                    hit = next((p for p in pool if abs(p[1] - amt) < 1), None)
                    if hit:
                        hit[1] -= amt; to = hit[0]
                if f is None:                                    # a credit line of this amount is left in the voucher
                    hit = next((p for p in pool if abs(p[1] + amt) < 1), None)
                    if hit:
                        hit[1] += amt; f = hit[0]
            resolved.append((e, t, f, to))
        # Holoo often posts the counterparty of many cheques as ONE line (e.g. a prepayment to a supplier): when the
        # remaining unresolved amounts of one side add up to exactly one leftover line, that line is the counterparty.
        for side in ("to", "from"):
            idx = [i for i in range(len(resolved) - len(rs), len(resolved))
                   if resolved[i][1] != "opening" and resolved[i][3 if side == "to" else 2] is None]
            if not idx:
                continue
            total = sum(float(resolved[i][0][8]) for i in idx) * (1 if side == "to" else -1)
            left = [p for p in pool if abs(p[1]) >= 1]
            if len(left) == 1 and abs(left[0][1] - total) < 1:
                for i in idx:
                    e, t, f, to = resolved[i]
                    resolved[i] = (e, t, left[0][0], to) if side == "from" else (e, t, f, left[0][0])
                left[0][1] -= total
    order = {e[0]: i for i, e in enumerate(ev)}                  # back to chronological order per cheque
    resolved.sort(key=lambda r: order[r[0][0]])
    return resolved, vtype, opening, checks


def _seed(conn, db: str) -> dict:
    """Where the core has each cheque continued into `db` from an earlier year, in Holoo codes of `db` (core 033)."""
    code = lambda a, p: None if a is None else conn.execute(
        """SELECT legacy_code FROM core.legacy_account_map WHERE source_db = %s AND account_id = %s AND party_id IS NOT DISTINCT FROM %s
           ORDER BY legacy_code LIMIT 1""", (db, a, p)).fetchone()
    seed = {}
    for chk, cid, dirn in conn.execute("""SELECT m.check_code, m.cheque_id, c.direction FROM core.cheque_legacy_code m JOIN core.cheque c ON c.id = m.cheque_id
                                         WHERE m.source_db = %s AND m.continued""", (db,)).fetchall():
        st = conn.execute("SELECT account_id, party_id FROM core.cheque_status WHERE cheque_id = %s", (cid,)).fetchone()
        if dirn == "out":                                            # an issued cheque sits on the notes-payable account of its bank
            pay = conn.execute("""SELECT e.from_account_id FROM core.cheque_event e WHERE e.cheque_id = %s AND e.event_type IN ('issued', 'opening_position')
                                  ORDER BY e.effective_date DESC, e.id DESC LIMIT 1""", (cid,)).fetchone()
            loc = code(pay[0], None) if pay else None
            bank = conn.execute("""SELECT g.legacy_code FROM core.company_bank_account k JOIN core.legacy_account_map g ON g.source_db = %s AND g.account_id = k.gl_account_id
                                   WHERE k.payable_cheque_account_id = %s ORDER BY g.legacy_code LIMIT 1""", (db, pay[0] if pay else None)).fetchone()
            seed[chk] = {"loc": loc[0] if loc else None, "bank": bank[0] if bank else None}
            continue
        loc = code(st[0], st[1]) if st else None
        box = conn.execute("""SELECT e.to_account_id FROM core.cheque_event e JOIN core.cashbox b ON b.cheque_account_id = e.to_account_id
                              WHERE e.cheque_id = %s ORDER BY e.effective_date DESC, e.id DESC LIMIT 1""", (cid,)).fetchone()
        bank = conn.execute("""SELECT g.legacy_code FROM core.company_bank_account k JOIN core.legacy_account_map g ON g.source_db = %s AND g.account_id = k.gl_account_id
                               WHERE k.collection_account_id = %s ORDER BY g.legacy_code LIMIT 1""", (db, st[0] if st else None)).fetchone()
        onhand = code(box[0], None) if box else None
        seed[chk] = {"loc": loc[0] if loc else None, "onhand": onhand[0] if onhand else None, "bank": bank[0] if bank else None}
    return seed


def migrate(conn, db: str, user: str = "holoo-migration") -> dict:
    posting_parity.prepare(conn, db)
    stats = collections.Counter()
    with conn.transaction():
        acc = lambda code: None if code is None else conn.execute(
            "SELECT account_id, party_id FROM core.legacy_account_map WHERE source_db = %s AND legacy_code = %s", (db, code)).fetchone()
        conn.execute("""INSERT INTO core.cashbox (code, name, cash_account_id, cheque_account_id, is_main, holoo_id)
            SELECT 'holoo:' || c.id, c.name, a.account_id, b.account_id, coalesce(c.cheque_account_code = %s, false), c.id FROM holoo_mirror.cashbox c
            LEFT JOIN core.legacy_account_map a ON a.source_db = c.source_db AND a.legacy_code = c.account_code
            LEFT JOIN core.legacy_account_map b ON b.source_db = c.source_db AND b.legacy_code = c.cheque_account_code
            WHERE c.source_db = %s ON CONFLICT (code) DO NOTHING""", (MAIN_CHEQUE_ACCOUNT, db))
        conn.execute("""INSERT INTO core.company_bank_account (bank_code, account_no, title, gl_account_id, collection_account_id, payable_cheque_account_id,
                               fee_account_id, is_pos, holoo_id)
            SELECT DISTINCT ON (b.bank_code, b.account_no) coalesce(b.bank_code, '?'), coalesce(b.account_no, 'holoo:' || b.id), coalesce(b.branch, 'bank account'),
                   g.account_id, c.account_id, p.account_id, f.account_id, b.is_pos, b.id
            FROM holoo_mirror.bank_account b
            LEFT JOIN core.legacy_account_map g ON g.source_db = b.source_db AND g.legacy_code = b.account_code
            LEFT JOIN core.legacy_account_map c ON c.source_db = b.source_db AND c.legacy_code = b.collection_account_code
            LEFT JOIN core.legacy_account_map p ON p.source_db = b.source_db AND p.legacy_code = b.payable_cheque_account_code
            LEFT JOIN core.legacy_account_map f ON f.source_db = b.source_db AND f.legacy_code = b.fee_account_code
            WHERE b.source_db = %s ORDER BY b.bank_code, b.account_no, b.id ON CONFLICT (bank_code, account_no) DO NOTHING""", (db,))
        # a cheque carried over from an earlier Holoo year (same code, number, amount, direction) continues that core cheque (core 033)
        stats["cheques_continued"] = conn.execute("""
            INSERT INTO core.cheque_legacy_code (source_db, check_code, cheque_id, continued)
            SELECT DISTINCT ON (c.check_code) c.source_db, c.check_code, m.cheque_id, true
            FROM holoo_mirror.cheque c
            JOIN core.cheque_legacy_code m ON m.check_code = c.check_code AND m.source_db <> c.source_db
            JOIN core.cheque k ON k.id = m.cheque_id AND k.number = coalesce(c.number, '?') AND k.amount = c.amount AND k.direction = c.direction
            JOIN holoo_mirror.cheque p ON p.source_db = m.source_db AND p.check_code = m.check_code AND p.fiscal_year < c.fiscal_year
            WHERE c.source_db = %s AND c.removed_run IS NULL AND c.amount > 0
              AND NOT EXISTS (SELECT 1 FROM core.cheque_legacy_code x WHERE x.source_db = c.source_db AND x.check_code = c.check_code)
            ORDER BY c.check_code, p.fiscal_year DESC
            ON CONFLICT DO NOTHING""", (db,)).rowcount
        stats["cheques"] = conn.execute("""
            INSERT INTO core.cheque (direction, sayad_no, bank_code, number, amount, issue_date, due_date, party_id, holoo_check_code, legacy_source_db, bank_account_id)
            SELECT c.direction, NULL, c.bank_code, coalesce(c.number, '?'), c.amount, c.issue_date, c.due_date,
                   (SELECT party_id FROM core.party_legacy_code l WHERE l.source_db = c.source_db AND l.legacy_code = c.person_code AND c.person_code <> '00000'),
                   c.check_code, c.source_db,
                   (SELECT id FROM core.company_bank_account k WHERE k.account_no = c.account_no AND c.direction = 'out' LIMIT 1)
            FROM holoo_mirror.cheque c WHERE c.source_db = %s AND c.removed_run IS NULL AND c.amount > 0
              AND NOT EXISTS (SELECT 1 FROM core.cheque_legacy_code x WHERE x.source_db = c.source_db AND x.check_code = c.check_code)""", (db,)).rowcount
        conn.execute("""INSERT INTO core.cheque_legacy_code (source_db, check_code, cheque_id)
                        SELECT legacy_source_db, holoo_check_code, id FROM core.cheque WHERE legacy_source_db = %s ON CONFLICT DO NOTHING""", (db,))
        ids = dict(conn.execute("SELECT check_code, cheque_id FROM core.cheque_legacy_code WHERE source_db = %s", (db,)).fetchall())
        done = {r[0] for r in conn.execute("SELECT legacy_event_id FROM core.cheque_event WHERE legacy_source_db = %s", (db,)).fetchall()}
        resolved, vtype, opening, checks = derive(conn, db, _seed(conn, db))
        broken = set(); conflicts = []
        for e, t, f, to in resolved:
            eid, chk = e[0], e[1]
            if eid in done:
                stats["already_migrated"] += 1; continue
            if chk in broken:
                stats["skipped_after_unresolved"] += 1; continue
            fa, ta = acc(f), acc(to)
            if not fa or not ta:
                stats["unresolved"] += 1; broken.add(chk); continue
            try:
                with conn.transaction():
                    conn.execute("""INSERT INTO core.cheque_event (cheque_id, state, effective_date, event_type, from_account_id, from_party_id, to_account_id,
                                           to_party_id, legacy_source_db, legacy_event_id, legacy_voucher)
                                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                                 (ids[chk], e[2], e[3], "opening_position" if t == "opening" else t, fa[0], fa[1], ta[0], ta[1], db, eid, e[4]))
            except Exception as ex:                      # location chain broken: Holoo recorded a move from where the cheque was not
                stats["chain_conflict"] += 1; broken.add(chk)
                conflicts.append((chk, e[2], t, f, to, str(e[3])[:10], e[4]))
                continue
            stats["events"] += 1
            stats["type:" + t] += 1
        # continued cheques: the new year's opening position against the core's location (state for closed / issued cheques)
        for e, expected in checks:
            chk, st, dirn = e[1], e[2], e[7]
            core = conn.execute("SELECT state, account_id, party_id FROM core.cheque_status WHERE cheque_id = %s", (ids[chk],)).fetchone()
            exp = acc(expected) if expected else None
            if dirn == "out":
                same = (st == "P" and core[0] in ("issued", "opening_position")) or (st != "P" and core[0] in ("paid_by_bank", "settled_otherwise"))
            elif st == "V" and not expected:                        # collected before the year end
                same = core[0] in ("collected", "cashed")
            else:
                same = exp is not None and (exp[0], exp[1]) == (core[1], core[2])
            conn.execute("""INSERT INTO core.legacy_cheque_opening_check (source_db, check_code, cheque_id, holoo_state, holoo_account_id, holoo_party_id,
                                                                     core_state, core_account_id, core_party_id, status)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (source_db, check_code) DO UPDATE SET holoo_state = EXCLUDED.holoo_state, holoo_account_id = EXCLUDED.holoo_account_id,
                              holoo_party_id = EXCLUDED.holoo_party_id, core_state = EXCLUDED.core_state, core_account_id = EXCLUDED.core_account_id,
                              core_party_id = EXCLUDED.core_party_id, status = EXCLUDED.status, checked_at = now()""",
                         (db, chk, ids[chk], st, exp[0] if exp else None, exp[1] if exp else None, core[0], core[1], core[2],
                          "carried_forward" if same else "position_differs"))
            stats["opening_" + ("carried_forward" if same else "position_differs")] += 1
        # cheques whose only Holoo record in this year is a closed state (V) inside the opening voucher: closed in a
        # previous year, no position here — keep their final state explicitly (208 in 1404)
        stats["closed_before_migration"] = conn.execute("""
            UPDATE core.cheque k SET closed_before_migration = x.st FROM (
              SELECT e.check_code, CASE WHEN c.direction = 'out' THEN 'paid_by_bank'
                                        -- Holoo RetVazeatCheck: V with an empty counterparty = collected, any other (even «00000») = spent
                                        WHEN coalesce(max(e.account_code), '') = '' THEN 'collected' ELSE 'endorsed_to_party' END st
              FROM holoo_mirror.cheque_event e JOIN holoo_mirror.cheque c ON c.source_db = e.source_db AND c.check_code = e.check_code
              JOIN holoo_mirror.voucher v ON v.source_db = e.source_db AND v.sanad_code = e.voucher_code
              WHERE e.source_db = %s AND e.removed_run IS NULL GROUP BY e.check_code, c.direction
              HAVING bool_and(v.state = 'opening') AND bool_and(e.state = 'V')) x
            WHERE k.legacy_source_db = %s AND k.holoo_check_code = x.check_code AND k.closed_before_migration IS NULL
              AND NOT EXISTS (SELECT 1 FROM core.cheque_event ev WHERE ev.cheque_id = k.id)""", (db, db)).rowcount
    out = dict(stats); out['conflict_examples'] = conflicts[:15]
    return out


def parity(conn, db: str) -> dict:
    """Per Holoo voucher: core rule lines of its migrated cheque events == Holoo's lines (net per account and party).
    Sales vouchers (type 13, covered by the sales rule) and the opening voucher are excluded."""
    rows = conn.execute("""
      WITH v AS (SELECT sanad_code, voucher_type, state FROM holoo_mirror.voucher WHERE source_db = %(db)s),
      ev AS (SELECT e.id, e.legacy_voucher FROM core.cheque_event e JOIN v ON v.sanad_code = e.legacy_voucher
             WHERE e.legacy_source_db = %(db)s AND v.voucher_type IS DISTINCT FROM 13 AND v.state <> 'opening'),
      r AS (SELECT ev.legacy_voucher s, l.account_id, l.party_id, sum(l.debit - l.credit) n FROM ev CROSS JOIN LATERAL core.cheque_event_lines(ev.id) l GROUP BY 1, 2, 3),
      h AS (SELECT l.sanad_code s, m.account_id, m.party_id, sum(l.debit - l.credit) n FROM holoo_mirror.voucher_line l
            JOIN core.legacy_account_map m ON m.source_db = l.source_db AND m.legacy_code = l.account_code
            WHERE l.source_db = %(db)s AND l.in_ledger AND l.removed_run IS NULL AND l.sanad_code IN (SELECT legacy_voucher FROM ev) GROUP BY 1, 2, 3),
      c AS (SELECT coalesce(r.s, h.s) s, bool_and(abs(coalesce(r.n, 0) - coalesce(h.n, 0)) < 1) ok
            FROM r FULL JOIN h ON h.s = r.s AND h.account_id = r.account_id AND h.party_id IS NOT DISTINCT FROM r.party_id GROUP BY 1)
      SELECT (SELECT voucher_type FROM v WHERE v.sanad_code = c.s) t, count(*), count(*) FILTER (WHERE ok), (array_agg(s) FILTER (WHERE NOT ok))[1:5]
      FROM c GROUP BY 1 ORDER BY 1""", {"db": db}).fetchall()
    res = {str(t): {"vouchers": n, "identical": ok, "examples": ex} for t, n, ok, ex in rows}
    return {"by_voucher_type": res, "vouchers": sum(v["vouchers"] for v in res.values()), "identical": sum(v["identical"] for v in res.values())}
