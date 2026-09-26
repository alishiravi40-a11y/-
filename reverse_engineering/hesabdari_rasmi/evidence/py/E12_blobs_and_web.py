"""E12 — Evidence from decoded Process blobs (ADTG after-images) and web-service payloads (WEBBLOB).

Runs on the Silver canonical DB produced by almas_accounting/holoo_reader (read-only).
Usage: python3 E12_blobs_and_web.py <workdir-of-holoo-reader> [> ../results/E12_blobs_and_web.md]
"""
import glob
import os
import sys

import duckdb

SHA = "c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2"
Q = {
 "E12.1 | Decoded blobs and payloads": """SELECT (SELECT COUNT(*) FROM audit_snapshot) snapshot_rows, (SELECT COUNT(DISTINCT process_id) FROM audit_snapshot) events_with_snapshot,
    (SELECT COUNT(*) FROM web_payload) web_payloads, (SELECT SUM(CASE WHEN strict_json THEN 0 ELSE 1 END) FROM web_payload) malformed_json_recovered,
    (SELECT COUNT(*) FROM web_payload_line) web_lines""",
 "E12.2 | Snapshot semantics: last snapshot of each voucher vs current voucher lines (after-image test)": """
    WITH s AS (SELECT sanad_code, process_id, list(account_code || ':' || CAST(round(debit) AS BIGINT) || ':' || CAST(round(credit) AS BIGINT) ORDER BY account_code, debit, credit) sig
               FROM voucher_snapshot_line WHERE kind IN ('add','edit') GROUP BY sanad_code, process_id),
         last AS (SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY sanad_code ORDER BY process_id DESC) rn FROM s) WHERE rn = 1),
         cur AS (SELECT sanad_code, list(account_code || ':' || CAST(round(debit) AS BIGINT) || ':' || CAST(round(credit) AS BIGINT) ORDER BY account_code, debit, credit) sig FROM voucher_line GROUP BY 1)
    SELECT COUNT(*) vouchers_compared, SUM(CASE WHEN l.sig = c.sig THEN 1 ELSE 0 END) last_snapshot_equals_current
    FROM last l JOIN cur c USING (sanad_code)""",
 "E12.3 | Vouchers in the log that are absent from this database, by document year": """
    SELECT substr(doc_date_jalali,1,4) doc_year, COUNT(*) vouchers, list_distinct(flatten(list(kinds))) kinds FROM voucher_absent GROUP BY 1 ORDER BY 1""",
 "E12.4 | Absent 1403 vouchers: when were they touched (log month) and how": """
    SELECT strftime(first_event, '%Y-%m') log_month, COUNT(*) vouchers FROM voucher_absent WHERE doc_date_jalali < '1404' GROUP BY 1 ORDER BY 1""",
 "E12.5 | Web sales posted with a previous-fiscal-year date (payload date < 2025-03-21) and their fate": """
    WITH w AS (SELECT w.*, a.number, a.event_date FROM web_payload w JOIN audit_event a ON a.id = w.process_id WHERE a.kind = 'add' AND w.doc_type = 1)
    SELECT CASE WHEN d.fac_code IS NOT NULL THEN 'kept in FY1404 (re-dated ' || strftime(d.doc_date, '%Y-%m-%d') || ')' ELSE 'removed from FY1404' END fate,
           COUNT(*) n, SUM(coalesce(w.cash,0) + coalesce(w.bank,0) + coalesce(w.credit,0)) amount, min(w.doc_date) min_web_date, max(w.doc_date) max_web_date, min(w.event_date) posted_from, max(w.event_date) posted_to
    FROM w LEFT JOIN document d ON d.voucher_code = TRY_CAST(w.number AS INTEGER) AND d.kind IN ('sale','sale_voided')
    WHERE w.doc_date < DATE '2025-03-21' GROUP BY 1""",
 "E12.6 | Invoice date vs web sale date (posted invoices)": """
    SELECT date_diff('day', w.doc_date, d.doc_date) invoice_minus_web_days, COUNT(*) n
    FROM web_payload w JOIN audit_event a ON a.id = w.process_id JOIN document d ON d.voucher_code = TRY_CAST(a.number AS INTEGER) AND d.kind IN ('sale','sale_voided','purchase')
    WHERE a.kind = 'add' GROUP BY 1 ORDER BY 1""",
 "E12.7 | Invoice amount vs web amount, and whether the invoice was edited in Holoo afterwards": """
    WITH x AS (SELECT d.kind, d.total, coalesce(w.cash,0) + coalesce(w.bank,0) + coalesce(w.credit,0) web_total,
                      EXISTS (SELECT 1 FROM audit_event e WHERE e.kind = 'edit' AND e.number = a.number) edited
               FROM web_payload w JOIN audit_event a ON a.id = w.process_id
               JOIN document d ON d.voucher_code = TRY_CAST(a.number AS INTEGER) AND d.kind IN ('sale','purchase') WHERE a.kind = 'add')
    SELECT kind, COUNT(*) invoices, SUM(CASE WHEN abs(total - web_total) > 1 THEN 1 ELSE 0 END) amount_differs,
           SUM(CASE WHEN abs(total - web_total) > 1 AND edited THEN 1 ELSE 0 END) differs_and_edited_in_holoo,
           SUM(CASE WHEN abs(total - web_total) > 1 THEN total - web_total ELSE 0 END) net_difference
    FROM x GROUP BY 1""",
 "E12.8 | Web payment instrument vs Holoo settlement (sales)": """
    SELECT CASE WHEN coalesce(w.bank,0) > 0 AND coalesce(w.credit,0) = 0 THEN 'web: bank only' WHEN coalesce(w.credit,0) > 0 AND coalesce(w.bank,0) = 0 THEN 'web: credit only'
                WHEN coalesce(w.cash,0) > 0 THEN 'web: cash' ELSE 'web: mixed/zero' END web_mode,
           COUNT(*) n, SUM(CASE WHEN d.card > 0 THEN 1 ELSE 0 END) holoo_card, SUM(CASE WHEN d.credit > 0 THEN 1 ELSE 0 END) holoo_credit, SUM(CASE WHEN d.cheque > 0 THEN 1 ELSE 0 END) holoo_cheque
    FROM web_payload w JOIN audit_event a ON a.id = w.process_id JOIN document d ON d.voucher_code = TRY_CAST(a.number AS INTEGER) AND d.kind = 'sale'
    WHERE a.kind = 'add' GROUP BY 1 ORDER BY n DESC""",
 "E12.9 | ErpCode identity: web product/customer codes map 1:1 to Holoo codes (learned from unedited invoices)": """
    WITH pairs AS (
      SELECT wl.product_erpcode, l.a_code FROM web_payload w JOIN audit_event a ON a.id = w.process_id
      JOIN document d ON d.voucher_code = TRY_CAST(a.number AS INTEGER) AND d.kind = 'sale'
      JOIN web_payload_line wl ON wl.process_id = w.process_id
      JOIN document_line l ON l.fac_type = d.fac_type AND l.fac_code = d.fac_code AND l.line_index = wl.line_no + 1 AND abs(l.qty - wl.qty) < 1e-9
      WHERE a.kind = 'add' AND NOT EXISTS (SELECT 1 FROM audit_event e WHERE e.kind = 'edit' AND e.number = a.number))
    SELECT COUNT(DISTINCT product_erpcode) web_codes, SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END) mapped_to_one_holoo_item
    FROM (SELECT product_erpcode, COUNT(DISTINCT a_code) n FROM pairs GROUP BY 1)""",
 "E12.10 | Deleted sales invoices recoverable from before-images (DF events)": """
    SELECT COUNT(DISTINCT s.process_id) deleted_invoice_events, COUNT(*) snapshot_rows,
           SUM(CAST(json_extract(s.data, '$.Price_BS') AS DOUBLE) * CAST(json_extract(s.data, '$.Few_Article') AS DOUBLE)) line_value
    FROM audit_snapshot s JOIN audit_event a ON a.id = s.process_id WHERE a.kind = 'delete' AND a.object = 'sale_invoice'""",
}


def main(workdir):
    con = duckdb.connect(os.path.join(workdir, "imports", SHA, "silver.duckdb"), read_only=True)
    out = ["# E12_blobs_and_web", "", f"- Silver: holoo_reader import of backup SHA-256 `{SHA}`", "- source: `evidence/py/E12_blobs_and_web.py`", ""]
    for head, sql in Q.items():
        name, desc = [x.strip() for x in head.split("|", 1)]
        cur = con.execute(sql); rows = cur.fetchall(); cols = [d[0] for d in cur.description]
        out += [f"## {name} — {desc}", "", "| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
        out += ["| " + " | ".join(f"{v:,.0f}" if isinstance(v, float) and abs(v) >= 1000 else str(v) for v in r) + " |" for r in rows]
        out += ["", f"_{len(rows)} row(s)_", ""]
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1])
