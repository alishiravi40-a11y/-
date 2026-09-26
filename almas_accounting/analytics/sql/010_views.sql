-- Analytics views over holoo_mirror (current rows only: removed_run IS NULL). PostgreSQL 14+.
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE OR REPLACE VIEW analytics.gl_line AS
SELECT l.source_db, l.fiscal_year, l.sanad_code, l.line_index, v.number AS voucher_no, v.doc_date, v.doc_jdate,
       substr(v.doc_jdate, 1, 7) AS jmonth, v.voucher_type, v.voucher_type_name, v.state, v.user_code,
       l.account_code, substr(l.account_code, 1, 3) AS kol, substr(l.account_code, 1, 7) AS moein,
       l.debit, l.credit, l.line_role, l.description
FROM holoo_mirror.voucher_line l JOIN holoo_mirror.voucher v ON v.source_db = l.source_db AND v.sanad_code = l.sanad_code
WHERE l.removed_run IS NULL AND v.removed_run IS NULL AND l.in_ledger;

CREATE OR REPLACE VIEW analytics.sales_line AS
SELECT d.source_db, d.fiscal_year, d.fac_type, d.fac_code, d.number AS invoice_no, d.doc_date, d.doc_jdate, substr(d.doc_jdate, 1, 7) AS jmonth,
       d.person_code, d.channel, d.web_order_no, d.user_code, l.a_code, i.name AS item_name, split_part(i.name, '/', 1) AS brand,
       i.warehouse_code, w.name AS warehouse_name, l.qty, l.unit_price, l.unit_cost,
       l.qty * l.unit_price AS revenue, l.qty * l.unit_cost AS cost, l.qty * (l.unit_price - l.unit_cost) AS gross_margin,
       (l.unit_price < l.unit_cost) AS below_cost, (l.unit_cost = 0) AS zero_cost
FROM holoo_mirror.document d
JOIN holoo_mirror.document_line l ON l.source_db = d.source_db AND l.fac_type = d.fac_type AND l.fac_code = d.fac_code AND l.removed_run IS NULL
JOIN holoo_mirror.item i ON i.source_db = l.source_db AND i.a_code = l.a_code
LEFT JOIN holoo_mirror.warehouse w ON w.source_db = i.source_db AND w.code = i.warehouse_code
WHERE d.removed_run IS NULL AND d.kind = 'sale' AND NOT i.is_service;

CREATE OR REPLACE VIEW analytics.monthly_sales AS
SELECT source_db, jmonth, COUNT(DISTINCT fac_code) invoices, SUM(qty) units, SUM(revenue) revenue, SUM(cost) cost, SUM(gross_margin) gross_margin,
       SUM(gross_margin) / NULLIF(SUM(revenue), 0) AS margin_pct, SUM(CASE WHEN below_cost THEN 1 ELSE 0 END) below_cost_lines
FROM analytics.sales_line GROUP BY 1, 2;

CREATE OR REPLACE VIEW analytics.margin_by_brand AS
SELECT source_db, brand, SUM(qty) units, SUM(revenue) revenue, SUM(gross_margin) gross_margin, SUM(gross_margin) / NULLIF(SUM(revenue), 0) margin_pct
FROM analytics.sales_line GROUP BY 1, 2;

CREATE OR REPLACE VIEW analytics.margin_by_warehouse AS
SELECT source_db, warehouse_name, SUM(qty) units, SUM(revenue) revenue, SUM(gross_margin) gross_margin, SUM(gross_margin) / NULLIF(SUM(revenue), 0) margin_pct
FROM analytics.sales_line GROUP BY 1, 2;

CREATE OR REPLACE VIEW analytics.person_balance AS
WITH kol AS (SELECT DISTINCT source_db, kol FROM holoo_mirror.account WHERE role_type IN (5, 15) AND removed_run IS NULL),
pa AS (SELECT source_db, c_code, debit_account acc FROM holoo_mirror.person WHERE debit_account IS NOT NULL AND removed_run IS NULL
       UNION SELECT source_db, c_code, credit_account FROM holoo_mirror.person WHERE credit_account IS NOT NULL AND removed_run IS NULL)
SELECT pa.source_db, pa.c_code, p.name, SUM(g.debit - g.credit) AS balance
FROM pa JOIN holoo_mirror.person p ON p.source_db = pa.source_db AND p.c_code = pa.c_code
JOIN analytics.gl_line g ON g.source_db = pa.source_db AND g.account_code = pa.acc AND g.state NOT IN ('closing_temporary', 'closing')
JOIN kol ON kol.source_db = g.source_db AND kol.kol = g.kol
GROUP BY 1, 2, 3;

-- FIFO receivable ageing per account (103 = customers), closed form: remaining part of each debit after all credits
CREATE OR REPLACE VIEW analytics.receivable_open_items AS
WITH x AS (
  SELECT source_db, account_code, doc_date, sanad_code, SUM(debit) d, SUM(credit) c
  FROM analytics.gl_line WHERE kol = '103' AND state NOT IN ('closing_temporary', 'closing') GROUP BY 1, 2, 3, 4),
y AS (
  SELECT *, SUM(d) OVER (PARTITION BY source_db, account_code ORDER BY doc_date, sanad_code) cum_d,
         SUM(c) OVER (PARTITION BY source_db, account_code) total_c FROM x WHERE d > 0 OR c > 0)
SELECT source_db, account_code, doc_date, sanad_code, d AS debit,
       LEAST(d, GREATEST(0, cum_d - total_c)) AS open_amount
FROM y WHERE d > 0 AND cum_d - total_c > 0;

CREATE OR REPLACE VIEW analytics.receivable_ageing AS
SELECT o.source_db, o.account_code, SUM(o.open_amount) AS open_total,
       SUM(CASE WHEN m.as_of - o.doc_date <= 30 THEN o.open_amount ELSE 0 END) AS d0_30,
       SUM(CASE WHEN m.as_of - o.doc_date BETWEEN 31 AND 90 THEN o.open_amount ELSE 0 END) AS d31_90,
       SUM(CASE WHEN m.as_of - o.doc_date BETWEEN 91 AND 180 THEN o.open_amount ELSE 0 END) AS d91_180,
       SUM(CASE WHEN m.as_of - o.doc_date > 180 THEN o.open_amount ELSE 0 END) AS d180_plus
FROM analytics.receivable_open_items o
JOIN (SELECT source_db, MAX(doc_date) as_of FROM holoo_mirror.voucher WHERE removed_run IS NULL GROUP BY 1) m ON m.source_db = o.source_db
GROUP BY 1, 2;

CREATE OR REPLACE VIEW analytics.cheque_status AS
SELECT c.source_db, c.check_code, c.direction, c.number, c.amount, c.bank_code, b.name AS bank_name, c.issue_date, c.due_date, c.person_code,
       e.state AS last_state, e.state_name AS last_state_name, e.event_date AS last_event_date,
       (SELECT COUNT(*) FROM holoo_mirror.cheque_event x WHERE x.source_db = c.source_db AND x.check_code = c.check_code AND x.state IN ('R', 'B') AND x.removed_run IS NULL) > 0 AS bounced
FROM holoo_mirror.cheque c
LEFT JOIN holoo_mirror.bank b ON b.source_db = c.source_db AND b.code = c.bank_code
LEFT JOIN LATERAL (SELECT state, state_name, event_date FROM holoo_mirror.cheque_event x
                   WHERE x.source_db = c.source_db AND x.check_code = c.check_code AND x.removed_run IS NULL
                   ORDER BY event_date DESC, event_id DESC LIMIT 1) e ON true
WHERE c.removed_run IS NULL;

CREATE OR REPLACE VIEW analytics.cheque_bank_risk AS
SELECT source_db, bank_name, COUNT(*) cheques, SUM(CASE WHEN bounced THEN 1 ELSE 0 END) bounced,
       SUM(CASE WHEN bounced THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0) AS bounce_rate
FROM analytics.cheque_status WHERE direction = 'in' GROUP BY 1, 2;

CREATE OR REPLACE VIEW analytics.customer_cheque_risk AS
SELECT source_db, person_code, COUNT(*) cheques, SUM(CASE WHEN bounced THEN 1 ELSE 0 END) bounced, SUM(amount) amount,
       SUM(CASE WHEN last_state IN ('D', 'S', 'M', 'R', 'J') THEN amount ELSE 0 END) open_amount
FROM analytics.cheque_status WHERE direction = 'in' GROUP BY 1, 2;

CREATE OR REPLACE VIEW analytics.stock_position AS
SELECT i.source_db, i.a_code, i.name, split_part(i.name, '/', 1) brand, w.name warehouse_name, i.stored_qty qty, i.stored_avg_cost avg_cost,
       i.stored_qty * i.stored_avg_cost AS value,
       (SELECT MAX(doc_date) FROM analytics.sales_line s WHERE s.source_db = i.source_db AND s.a_code = i.a_code) AS last_sale
FROM holoo_mirror.item i LEFT JOIN holoo_mirror.warehouse w ON w.source_db = i.source_db AND w.code = i.warehouse_code
WHERE i.removed_run IS NULL AND NOT i.is_service AND i.stored_qty <> 0;

CREATE OR REPLACE VIEW analytics.purchase_price_history AS
SELECT d.source_db, i.name AS item_name, d.doc_date, d.doc_jdate, l.unit_price, l.qty
FROM holoo_mirror.document d JOIN holoo_mirror.document_line l ON l.source_db = d.source_db AND l.fac_type = d.fac_type AND l.fac_code = d.fac_code AND l.removed_run IS NULL
JOIN holoo_mirror.item i ON i.source_db = l.source_db AND i.a_code = l.a_code
WHERE d.removed_run IS NULL AND d.kind = 'purchase' AND l.unit_price > 0;

CREATE OR REPLACE VIEW analytics.web_reconciliation AS
SELECT w.source_db, w.process_id, w.order_no, w.doc_type, w.doc_date AS web_date, d.doc_date AS invoice_date, d.fac_type, d.number AS invoice_no,
       coalesce(w.cash, 0) + coalesce(w.bank, 0) + coalesce(w.credit, 0) AS web_amount, d.total AS invoice_amount,
       CASE WHEN d.fac_code IS NULL THEN 'not_in_books' WHEN abs(coalesce(w.cash,0) + coalesce(w.bank,0) + coalesce(w.credit,0) - d.total) > 1 THEN 'amount_differs'
            WHEN w.doc_date <> d.doc_date THEN 'date_differs' ELSE 'ok' END AS status
FROM holoo_mirror.web_payload w JOIN holoo_mirror.audit_event a ON a.source_db = w.source_db AND a.id = w.process_id AND a.kind = 'add'
LEFT JOIN holoo_mirror.document d ON d.source_db = w.source_db AND d.voucher_code = CASE WHEN a.number ~ '^[0-9]+$' THEN a.number::int END
     AND d.kind IN ('sale', 'sale_voided', 'purchase') AND d.removed_run IS NULL
WHERE w.removed_run IS NULL;
