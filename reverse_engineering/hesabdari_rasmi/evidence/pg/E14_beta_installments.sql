-- E14 — Beta installment customers (طرح بتا) in Holoo FY1404: coding, voucher patterns, collections, bank share.
-- Runs on the PostgreSQL mirror (holoo_mirror) published by holoo-reader. Aggregates only — no personal names.
\pset footer off
CREATE TEMP TABLE b AS SELECT code acc, left(code,7) moein, name FROM holoo_mirror.account
 WHERE source_db='holoo1_1404' AND length(code)>=7 AND (name ~ '\(\s*بتا|بتا\s*\)' OR left(code,7)='1080004') AND code<>'1080004';
CREATE TEMP TABLE L AS SELECT l.*, v.doc_jdate, (l.account_code IN (SELECT acc FROM b)) is_beta
 FROM holoo_mirror.voucher_line l JOIN holoo_mirror.voucher v USING (source_db,sanad_code)
 WHERE l.source_db='holoo1_1404' AND l.in_ledger AND v.state NOT IN ('closing_temporary','closing');

\echo '## E14.1 Beta-related accounts in the chart (dedicated branch 1080004 «مشتريان طرح بتا»; 4050006 payable «طرح هاي فروش اقساطي»)'
SELECT code, name FROM holoo_mirror.account WHERE source_db='holoo1_1404' AND code IN ('1080004','4050006','40500060001','4030004','9070001','6010009');
\echo '## E14.2 Where beta customers are coded (moein) and year-end receivable before closing'
SELECT b.moein, (b.moein='1080004') dedicated_branch, count(DISTINCT b.acc) accounts, count(DISTINCT l.account_code) active, round(coalesce(sum(l.debit-l.credit),0)) balance
 FROM b LEFT JOIN L l ON l.account_code=b.acc GROUP BY 1,2 ORDER BY 1;
\echo '## E14.3 Voucher shapes touching beta customers (BETA = beta customer; + debit, - credit; vouchers <= 12 lines)'
WITH s AS (SELECT sanad_code, count(*) n, string_agg(DISTINCT CASE WHEN is_beta THEN 'BETA' ELSE left(account_code,7) END || CASE WHEN debit>0 THEN '+' ELSE '-' END, ' ') sig
           FROM L WHERE sanad_code IN (SELECT sanad_code FROM L WHERE is_beta) GROUP BY 1)
SELECT sig, count(*) vouchers FROM s WHERE n<=12 GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
\echo '## E14.4 Contract vouchers: customer debt, bank share recognised up front (6010009 Dr = 4050006 Cr)'
WITH c AS (SELECT sanad_code, sum(debit) FILTER (WHERE is_beta) beta_d, sum(debit) FILTER (WHERE left(account_code,7)='6010009') fee_d,
  sum(credit) FILTER (WHERE left(account_code,7)='4050006') pay_c FROM L GROUP BY 1
  HAVING sum(debit) FILTER (WHERE is_beta)>0 AND sum(credit) FILTER (WHERE left(account_code,7)='4050006')>0)
SELECT count(*) contracts, round(sum(beta_d)) customer_debt, round(sum(fee_d)) bank_share_expensed, count(*) FILTER (WHERE abs(fee_d-pay_c)<1) share_eq_payable,
 round((percentile_cont(0.5) WITHIN GROUP (ORDER BY fee_d/nullif(beta_d,0))*100)::numeric,2) median_share_pct FROM c;
\echo '## E14.5 Contracts per quarter by the moein the customer was coded in (inconsistent use of the dedicated branch)'
WITH c AS (SELECT DISTINCT sanad_code, doc_jdate FROM L WHERE left(account_code,7)='4050006' AND credit>0)
SELECT substr(c.doc_jdate,1,4)||'-Q'||((substr(c.doc_jdate,6,2)::int+2)/3) q, b.moein, count(DISTINCT c.sanad_code) contracts
FROM c JOIN L x ON x.sanad_code=c.sanad_code AND x.debit>0 JOIN b ON b.acc=x.account_code GROUP BY 1,2 ORDER BY 1,2;
\echo '## E14.6 Installment collections (description «وصول قسط بتا--…»): batch vouchers, no installment number'
SELECT count(*) lines, count(DISTINCT sanad_code) vouchers, count(DISTINCT account_code) customers, round(sum(credit)) collected,
 count(*) FILTER (WHERE description ~ 'قسط\s*(شماره|ش)?\s*[0-9۰-۹]') with_installment_no FROM L WHERE is_beta AND description LIKE '%وصول قسط%';
\echo '## E14.7 Bank-share payable 4050006 in 1404: recognised vs cleared'
SELECT round(sum(credit)) recognised, round(sum(debit)) cleared, count(*) FILTER (WHERE debit>0) clearing_lines, round(sum(credit-debit)) open_at_year_end FROM L WHERE left(account_code,7)='4050006';
\echo '## E14.8 Customer duplicated: beta person with another person record of the same (normalized) name'
WITH p AS (SELECT c_code, regexp_replace(regexp_replace(name,'\(\s*بتا\s*\)|بتا\)|\(بتا','','g'),'[\s()]+','','g') k, debit_account FROM holoo_mirror.person WHERE source_db='holoo1_1404'),
bp AS (SELECT p.* FROM p JOIN b ON b.acc=p.debit_account)
SELECT count(DISTINCT c_code) beta_persons, count(DISTINCT c_code) FILTER (WHERE EXISTS (SELECT 1 FROM p o WHERE o.k=bp.k AND o.c_code<>bp.c_code)) with_second_record FROM bp;
\echo '## E14.9 Holoo installment module (SQL Server): GHEST = 22 installments of 3 customers, 0 marked collected; GhestGroup, CustomerGroup, GroupSarfasl = 0 rows'
