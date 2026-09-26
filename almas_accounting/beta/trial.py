"""Trial run of the Beta core on real files (prints AGGREGATES ONLY; run against a scratch database).

python -m beta.trial --pg DSN --statement bankStatements.xls [--beta-export export.xlsx --export-scheme unassigned|this]
  * maps Holoo legacy persons (holoo_mirror in the same database, read-only) — twice, to prove idempotency;
  * creates the scheme account from the statement title (bank account id only) and scheme S1;
  * optional Beta export: 'unassigned' = its own placeholder scheme/account (Q-1 open, the honest default);
    'this' = WHAT-IF the export belonged to this scheme (measures matching if Q-1 were answered that way);
  * imports the statement (proposal mode, then auto-apply on a copy is NOT done: proposal statistics are the result);
  * re-imports the same statement and export to prove idempotency; prints the B-xx controls.
"""
from __future__ import annotations

import argparse
import json
import re

import psycopg
import xlrd

from . import legacy, snapshot_import as SI, statement_import as ST
from .common import norm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg", required=True); ap.add_argument("--statement", required=True)
    ap.add_argument("--beta-export"); ap.add_argument("--export-scheme", choices=["unassigned", "this"], default="unassigned")
    ap.add_argument("--auto-apply", action="store_true")
    a = ap.parse_args()
    out = {}
    with psycopg.connect(a.pg, autocommit=True) as c:
        c.execute("INSERT INTO core.app_user (username, is_service) VALUES ('trial', true) ON CONFLICT DO NOTHING")
        for p in ("beta.receipt_manage", "beta.contract_manage", "beta.review", "beta.scheme_manage"):
            c.execute("INSERT INTO core.user_permission (username, permission, granted_by) VALUES ('trial', %s, 'trial') ON CONFLICT DO NOTHING", (p,))
        out["legacy_first"] = legacy.map_persons(c, "holoo1_1404")
        out["legacy_rerun"] = legacy.map_persons(c, "holoo1_1404")
        out["parties"] = c.execute("""SELECT count(*), count(national_id), count(national_id_claim) FROM core.party""").fetchone()
        out["merge_candidates"] = dict(c.execute("SELECT level, count(*) FROM core.party_merge_candidate GROUP BY 1").fetchall())
        out["legacy_beta_balance"] = c.execute("SELECT count(*), sum(balance) FROM core.legacy_balance WHERE is_beta AND balance <> 0").fetchone()
        title = norm(xlrd.open_workbook(a.statement).sheets()[0].row_values(1)[1])
        acc_no = re.search(r"شماره حساب\s*:\s*(\d+)", title).group(1)
        holder = c.execute("INSERT INTO core.party (name) VALUES ('scheme holder (trial)') RETURNING id").fetchone()[0]
        acc = c.execute("""INSERT INTO core.company_bank_account (bank_code, account_no, title, holder_party_id, account_type)
                           VALUES ('refah', %s, 'Beta scheme account', %s, 'savings') RETURNING id""", (acc_no, holder)).fetchone()[0]
        s1 = c.execute("""INSERT INTO core.beta_scheme (code, title, holder_party_id, company_bank_account_id, created_by)
                          VALUES ('S1', 'current Beta scheme', %s, %s, 'trial') RETURNING id""", (holder, acc)).fetchone()[0]
        if a.beta_export:
            if a.export_scheme == "this":
                sid = s1
            else:
                acc2 = c.execute("""INSERT INTO core.company_bank_account (bank_code, account_no, title) VALUES ('unknown', 'Q-1', 'unknown account (Q-1)')
                                    RETURNING id""").fetchone()[0]
                sid = c.execute("""INSERT INTO core.beta_scheme (code, title, holder_party_id, company_bank_account_id, created_by)
                                   VALUES ('Q1', 'scheme of the Beta export (unknown, Q-1)', %s, %s, 'trial') RETURNING id""", (holder, acc2)).fetchone()[0]
            out["beta_export_import"] = SI.import_snapshot(c, a.beta_export, sid, "trial")
            out["beta_export_reimport"] = SI.import_snapshot(c, a.beta_export, sid, "trial")["status"]
            out["contracts"] = c.execute("""SELECT count(*), count(DISTINCT party_id), sum(total_amount) FROM core.installment_contract""").fetchone()
            out["observed_vs_recorded_mismatch"] = c.execute("SELECT count(*) FROM core.beta_observed_vs_recorded WHERE observed_collected <> recorded_paid").fetchone()[0]
        st = ST.import_statement(c, a.statement, acc, "trial", auto_apply=a.auto_apply)
        out["statement_import"] = st
        out["statement_reimport"] = ST.import_statement(c, a.statement, acc, "trial")["status"]
        out["installment_lines_by_reason"] = dict(c.execute("""
          SELECT match_status || coalesce(' / ' || (match_detail->>'reason'), ''), count(*) FROM core.bank_statement_line
          WHERE classification = 'installment' GROUP BY 1""").fetchall())
        out["installment_amounts_by_status"] = {k: int(v) for k, v in c.execute("""
          SELECT match_status, sum(deposit) FROM core.bank_statement_line WHERE classification = 'installment' GROUP BY 1""").fetchall()}
        out["party_identified_with_legacy_beta_tag"] = c.execute("""
          SELECT count(*) FROM core.bank_statement_line b JOIN core.party_legacy_code l ON l.party_id = (b.match_detail->>'party_id')::int
          WHERE b.classification = 'installment' AND 'beta' = ANY (l.legacy_tags)""").fetchone()[0]
        out["controls"] = [r for r in c.execute("SELECT control, items, amount FROM core.beta_controls(current_date)").fetchall() if r[1]]
    print(json.dumps(out, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
