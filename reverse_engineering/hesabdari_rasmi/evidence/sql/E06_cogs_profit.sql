-- E06 — Cost of goods sold, gross and net profit — recomputed independently from the ledger (without the closing vouchers)

-- @name: E06.1 | Temporary-account balances before closing (state 0/1 vouchers only)
SELECT l.Col_Code, MAX(f.Sarfasl_Name) name, SUM(l.Bed) - SUM(l.Bes) balance
FROM SND_LIST l JOIN SANAD s ON s.Sanad_Code = l.Sanad_Code JOIN SARFASL f ON f.Sarfasl_Code = l.Col_Code
WHERE s.sanad_state IN (0, 1) AND l.Col_Code IN ('106','503','601','602','702','801','802','803','901','902','903','904')
GROUP BY l.Col_Code ORDER BY l.Col_Code;

-- @name: E06.2 | Periodic COGS = opening inventory + net purchases − ending inventory (ending = Σ Exist×Buy_Price)
WITH b AS (SELECT l.Col_Code, SUM(l.Bed) - SUM(l.Bes) v FROM SND_LIST l JOIN SANAD s ON s.Sanad_Code = l.Sanad_Code WHERE s.sanad_state IN (0,1) GROUP BY l.Col_Code)
SELECT (SELECT v FROM b WHERE Col_Code = '106') opening,
       (SELECT v FROM b WHERE Col_Code = '801') purchases,
       (SELECT v FROM b WHERE Col_Code = '802') purchase_returns,
       (SELECT v FROM b WHERE Col_Code = '803') purchase_discounts,
       (SELECT SUM(Exist * Buy_Price) FROM ARTICLE) ending_from_articles,
       (SELECT v FROM b WHERE Col_Code = '106') + (SELECT v FROM b WHERE Col_Code = '801') + (SELECT v FROM b WHERE Col_Code = '802')
         + (SELECT v FROM b WHERE Col_Code = '803') - (SELECT SUM(Exist * Buy_Price) FROM ARTICLE) AS cogs_periodic,
       (SELECT SUM(Bed) - SUM(Bes) FROM SND_LIST WHERE Sanad_Code = 371083 AND Col_Code = '503') AS cogs_in_closing_voucher_net_zero_check;

-- @name: E06.3 | Perpetual view: Σ(sale qty × moving-average cost stored on each line), by invoice type
SELECT f.Fac_Type, SUM(fa.Few_Article * ISNULL(fa.Buy_Price, 0)) cost, SUM(fa.Few_Article * fa.Price_BS) sales_value
FROM FACTART fa JOIN FACTURE f ON f.Fac_Code = fa.Fac_Code AND f.Fac_Type = fa.Fac_Type
WHERE f.Fac_Type IN ('F','Y','X','Z','Q') GROUP BY f.Fac_Type;

-- @name: E06.4 | Profit and loss recomputed from ledger (before closing)
WITH b AS (SELECT l.Col_Code, SUM(l.Bes) - SUM(l.Bed) v FROM SND_LIST l JOIN SANAD s ON s.Sanad_Code = l.Sanad_Code WHERE s.sanad_state IN (0,1) GROUP BY l.Col_Code)
SELECT SUM(CASE WHEN Col_Code IN ('901','902','903','904') THEN v ELSE 0 END) net_sales,
       SUM(CASE WHEN Col_Code IN ('702') THEN v ELSE 0 END) other_income,
       SUM(CASE WHEN Col_Code IN ('601') THEN -v ELSE 0 END) operating_expenses,
       SUM(CASE WHEN Col_Code IN ('602') THEN -v ELSE 0 END) non_operating_expenses
FROM b;

-- @name: E06.5 | Net sales excluding voided (Q) invoice vouchers
SELECT SUM(l.Bes) - SUM(l.Bed) net_901_excl_Q FROM SND_LIST l JOIN SANAD s ON s.Sanad_Code = l.Sanad_Code
WHERE s.sanad_state IN (0,1) AND l.Col_Code = '901' AND l.Sanad_Code NOT IN (SELECT Sanad_Code FROM FACTURE WHERE Fac_Type = 'Q');

-- @name: E06.6 | Profit booked by the closing voucher into 5020003
SELECT SUM(Bes) - SUM(Bed) profit_closed FROM SND_LIST WHERE Sanad_Code = 371083 AND Col_Code + Moien_Code + Tafzili_Code = '5020003';

-- @name: E06.7 | Revenue lines of sales vouchers not equal to invoice amount (split to other income, e.g. shipping 702)
SELECT l.Col_Code + l.Moien_Code + l.Tafzili_Code acc, COUNT(*) n, SUM(l.Bes) - SUM(l.Bed) amount
FROM SND_LIST l JOIN SANAD s ON s.Sanad_Code = l.Sanad_Code WHERE s.Sanad_Type = 13 AND (l.Type_Line = ' ' OR l.Type_Line IS NULL)
GROUP BY l.Col_Code + l.Moien_Code + l.Tafzili_Code ORDER BY n DESC;
