-- Canonical model v1 (DuckDB; types chosen to be PostgreSQL-compatible).
-- Every table carries source_row_hash (SHA-256 of the raw Holoo row) for idempotent re-import and change detection.

CREATE TABLE meta (key VARCHAR PRIMARY KEY, value VARCHAR);

CREATE TABLE account (
  code VARCHAR PRIMARY KEY, level SMALLINT, kol VARCHAR, moein VARCHAR, tafsili VARCHAR, name VARCHAR, name_key VARCHAR,
  parent_code VARCHAR, nature SMALLINT, group_code SMALLINT, role_type INTEGER, stored_balance DOUBLE, source_row_hash VARCHAR);

CREATE TABLE warehouse (code VARCHAR PRIMARY KEY, name VARCHAR, source_row_hash VARCHAR);

CREATE TABLE item (
  a_code VARCHAR PRIMARY KEY, name VARCHAR, name_key VARCHAR, warehouse_code VARCHAR, subgroup_code VARCHAR,
  is_service BOOLEAN, alt_code VARCHAR, tax_item_id VARCHAR, first_qty DOUBLE, first_unit_cost DOUBLE,
  stored_qty DOUBLE, stored_avg_cost DOUBLE, source_row_hash VARCHAR);

CREATE TABLE person (
  c_code VARCHAR PRIMARY KEY, code_c VARCHAR, name VARCHAR, name_key VARCHAR, legal_kind SMALLINT,
  national_code VARCHAR, economic_code VARCHAR, mobile VARCHAR, city_code INTEGER,
  debit_account VARCHAR, credit_account VARCHAR, blacklisted BOOLEAN, flagged_in_name BOOLEAN,
  created_at TIMESTAMP, source_row_hash VARCHAR);

CREATE TABLE voucher (
  sanad_code INTEGER PRIMARY KEY, number INTEGER, number2 INTEGER, doc_date DATE, doc_jdate VARCHAR,
  voucher_type SMALLINT, voucher_type_name VARCHAR, state VARCHAR, user_code INTEGER, saved_date DATE,
  last_edit_at TIMESTAMP, from_invoice BOOLEAN, from_auto BOOLEAN, comment VARCHAR, source_row_hash VARCHAR);

CREATE TABLE voucher_line (
  sanad_code INTEGER, line_index INTEGER, account_code VARCHAR, debit DOUBLE, credit DOUBLE, line_role VARCHAR,
  description VARCHAR, in_ledger BOOLEAN, source_row_hash VARCHAR, PRIMARY KEY (sanad_code, line_index));

CREATE TABLE document (
  fac_type VARCHAR, fac_code VARCHAR, number BIGINT, kind VARCHAR, kind_name VARCHAR, doc_date DATE, doc_jdate VARCHAR,
  person_code VARCHAR, total DOUBLE, cash DOUBLE, card DOUBLE, cheque DOUBLE, credit DOUBLE, discount DOUBLE,
  voucher_code INTEGER, user_code INTEGER, channel VARCHAR, web_order_no VARCHAR, tax_state INTEGER, tax_id VARCHAR,
  saved_date DATE, comment VARCHAR,
  doc_time VARCHAR,                -- FACTURE.Fac_Time (HH:MM:SS): Holoo orders its cost kardex by date, time, type (E23)
  extra_cost DOUBLE,               -- FACTURE.HazFactK: purchase-invoice extra costs, added per unit to the cost (E23)
  total_qty DOUBLE,                -- FACTURE.Sum_Few: quantity the extra costs are spread over
  source_row_hash VARCHAR, PRIMARY KEY (fac_type, fac_code));

CREATE TABLE document_line (
  fac_type VARCHAR, fac_code VARCHAR, a_code VARCHAR, line_index INTEGER, qty DOUBLE, unit_price DOUBLE,
  unit_cost DOUBLE,                -- FACTART.Buy_Price: moving weighted average cost at the time of the line
  line_discount DOUBLE,
  unit_last_purchase_cost DOUBLE,  -- FACTART.EndBuy_PriceK: last purchase price before the sale (NULL = none); see D-11
  source_row_hash VARCHAR, PRIMARY KEY (fac_type, fac_code, a_code, line_index));

CREATE TABLE voucher_link (sanad_code INTEGER, fac_type VARCHAR, fac_code VARCHAR, check_code INTEGER, source_row_hash VARCHAR);

CREATE TABLE cashbox (id INTEGER PRIMARY KEY, parent_id INTEGER, is_cash BOOLEAN, name VARCHAR, account_code VARCHAR, cheque_account_code VARCHAR, source_row_hash VARCHAR);

CREATE TABLE bank_account (id INTEGER PRIMARY KEY, c_code VARCHAR, bank_code VARCHAR, account_no VARCHAR, branch VARCHAR, account_code VARCHAR,
  is_pos BOOLEAN, is_active BOOLEAN,
  collection_account_code VARCHAR,       -- ACOUND_N.Dar_*: received cheques deposited for collection at this bank (v0.3, E18)
  payable_cheque_account_code VARCHAR,   -- ACOUND_N.Par_*: notes payable for cheques issued on this account
  fee_account_code VARCHAR,              -- ACOUND_N.Wage_*: bank fee expense
  source_row_hash VARCHAR);

CREATE TABLE bank (code VARCHAR PRIMARY KEY, name VARCHAR, source_row_hash VARCHAR);

CREATE TABLE cheque (
  check_code INTEGER PRIMARY KEY, direction VARCHAR, number VARCHAR, sayad VARCHAR, amount DOUBLE, bank_code VARCHAR,
  account_no VARCHAR, branch VARCHAR, issue_date DATE, due_date DATE, person_code VARCHAR, cashbox_id INTEGER, source_row_hash VARCHAR);

CREATE TABLE cheque_event (
  event_id INTEGER PRIMARY KEY, check_code INTEGER, state VARCHAR, state_name VARCHAR, event_date DATE,
  voucher_code INTEGER, account_code VARCHAR, cashbox_id INTEGER, source_row_hash VARCHAR);

CREATE TABLE tax_submission (id INTEGER PRIMARY KEY, fac_type VARCHAR, fac_code VARCHAR, send_type INTEGER, state INTEGER,
  tax_id VARCHAR, serial VARCHAR, sent_at TIMESTAMP, source_row_hash VARCHAR);

CREATE TABLE audit_event (
  id INTEGER PRIMARY KEY, event_date DATE, event_time VARCHAR, user_code INTEGER, kind VARCHAR, object VARCHAR,
  comment VARCHAR, number VARCHAR, c_code VARCHAR, via_web_service BOOLEAN, blob_sha256 VARCHAR, blob_len INTEGER, source_row_hash VARCHAR);

CREATE TABLE app_user (code INTEGER PRIMARY KEY, name VARCHAR, is_supervisor BOOLEAN, is_deactivated BOOLEAN, can_backdate BOOLEAN, source_row_hash VARCHAR);

CREATE TABLE opening_version_line (version INTEGER, account_code VARCHAR, debit DOUBLE, credit DOUBLE, line_index INTEGER, source_row_hash VARCHAR);
CREATE TABLE opening_version (version INTEGER PRIMARY KEY, user_code INTEGER, edited_at TIMESTAMP, source_row_hash VARCHAR);

-- Decoded Process blobs (after-images) and web-service payloads
CREATE TABLE audit_snapshot (process_id INTEGER, row_no INTEGER, tables VARCHAR, data JSON);
CREATE TABLE web_payload (process_id INTEGER PRIMARY KEY, strict_json BOOLEAN, payload_id VARCHAR, order_no VARCHAR, doc_type INTEGER,
  doc_date DATE, doc_time VARCHAR, customer_erpcode VARCHAR, cash DOUBLE, cash_account VARCHAR, bank DOUBLE, bank_account VARCHAR,
  credit DOUBLE, discount DOUBLE, comment VARCHAR, line_count INTEGER, lines_total DOUBLE);
CREATE TABLE web_payload_line (process_id INTEGER, line_no INTEGER, product_erpcode VARCHAR, qty DOUBLE, price DOUBLE);

-- Derived
CREATE VIEW stock_movement AS
SELECT l.fac_type, l.fac_code, d.doc_date, l.a_code, l.line_index, d.kind,
       l.qty * CASE d.kind WHEN 'purchase' THEN 1 WHEN 'sale_return' THEN 1 WHEN 'transfer_in' THEN 1
                           WHEN 'sale' THEN -1 WHEN 'purchase_return' THEN -1 WHEN 'waste' THEN -1 WHEN 'transfer_out' THEN -1
                           WHEN 'quick_sale' THEN -1 ELSE 0 END AS qty_signed
FROM document_line l JOIN document d USING (fac_type, fac_code);

CREATE VIEW cheque_status AS
SELECT c.*, e.state AS last_state, e.state_name AS last_state_name, e.event_date AS last_event_date
FROM cheque c LEFT JOIN (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY check_code ORDER BY event_date DESC, event_id DESC) rn FROM cheque_event) e
  ON e.check_code = c.check_code AND e.rn = 1;

CREATE VIEW account_balance AS
SELECT l.account_code, SUM(l.debit) debit, SUM(l.credit) credit, SUM(l.debit) - SUM(l.credit) balance,
       SUM(CASE WHEN v.state NOT IN ('closing_temporary','closing') THEN l.debit - l.credit ELSE 0 END) balance_before_closing
FROM voucher_line l JOIN voucher v USING (sanad_code) WHERE l.in_ledger GROUP BY l.account_code;

-- Voucher history from after-images: one row per (process event, voucher line)
CREATE VIEW voucher_snapshot_line AS
SELECT s.process_id, a.event_date, a.event_time, a.user_code, a.kind, s.row_no,
       CAST(json_extract(s.data, '$."Sanad.Sanad_Code"') AS INTEGER) AS sanad_code,
       json_extract_string(s.data, '$.Sanad_Date') AS doc_date_jalali,
       json_extract_string(s.data, '$.Sarfasl_code') AS account_code,
       CAST(json_extract(s.data, '$.Bed') AS DOUBLE) AS debit, CAST(json_extract(s.data, '$.Bes') AS DOUBLE) AS credit,
       json_extract_string(s.data, '$.Comment_Line') AS description
FROM audit_snapshot s JOIN audit_event a ON a.id = s.process_id
WHERE s.tables = 'SND_LIST,Sanad,USERDB';

-- Vouchers seen in the log but absent from this database (deleted, or belonging to another fiscal-year database)
CREATE VIEW voucher_absent AS
SELECT sanad_code, min(doc_date_jalali) doc_date_jalali, list(DISTINCT kind) kinds, min(event_date) first_event, max(event_date) last_event
FROM voucher_snapshot_line WHERE sanad_code NOT IN (SELECT sanad_code FROM voucher) GROUP BY sanad_code;
