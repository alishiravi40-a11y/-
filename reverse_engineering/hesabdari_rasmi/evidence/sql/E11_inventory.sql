-- E11 — Inventory quantity and value reconciliation

-- @name: E11.1 | Quantity formula check (all articles)
WITH m AS (SELECT A_Code, SUM(CASE WHEN Fac_Type IN ('K','Y','D') THEN Few_Article WHEN Fac_Type IN ('F','X','Z','S') THEN -Few_Article ELSE 0 END) mv FROM FACTART GROUP BY A_Code)
SELECT CASE WHEN LEFT(a.A_Code,2) = '01' THEN 'service' ELSE 'goods' END kind, COUNT(*) n,
       SUM(CASE WHEN ABS(ISNULL(a.First_exist,0) + ISNULL(m.mv,0) - ISNULL(a.Exist,0)) < 0.001 THEN 1 ELSE 0 END) formula_ok
FROM ARTICLE a LEFT JOIN m ON m.A_Code = a.A_Code GROUP BY CASE WHEN LEFT(a.A_Code,2) = '01' THEN 'service' ELSE 'goods' END;

-- @name: E11.2 | Value roll-forward (goods): opening(item) + purchases + returns-in + transfers-in − cost out = ending
WITH v AS (
  SELECT f.Fac_Type, SUM(fa.Few_Article * CASE WHEN f.Fac_Type = 'K' THEN fa.Price_BS ELSE ISNULL(fa.Buy_Price,0) END) val
  FROM FACTART fa JOIN FACTURE f ON f.Fac_Code = fa.Fac_Code AND f.Fac_Type = fa.Fac_Type
  WHERE LEFT(fa.A_Code,2) <> '01' GROUP BY f.Fac_Type)
SELECT (SELECT SUM(First_exist * FirstBuy_Price) FROM ARTICLE WHERE LEFT(A_Code,2) <> '01') opening_items,
       (SELECT val FROM v WHERE Fac_Type = 'K') purchases_K, (SELECT val FROM v WHERE Fac_Type = 'Y') returns_in_Y,
       (SELECT val FROM v WHERE Fac_Type = 'D') transfer_in_D, (SELECT val FROM v WHERE Fac_Type = 'S') transfer_out_S,
       (SELECT val FROM v WHERE Fac_Type = 'F') cost_sales_F, (SELECT val FROM v WHERE Fac_Type = 'X') cost_X,
       (SELECT val FROM v WHERE Fac_Type = 'Z') cost_Z,
       (SELECT SUM(Exist * Buy_Price) FROM ARTICLE WHERE LEFT(A_Code,2) <> '01') ending_items;

-- @name: E11.3 | Service/expense items bought on purchase invoices (value of K lines on 01xxx items)
SELECT fa.A_Code, a.A_Name, SUM(fa.Few_Article) qty, SUM(fa.Few_Article * fa.Price_BS) value
FROM FACTART fa JOIN ARTICLE a ON a.A_Code = fa.A_Code WHERE fa.Fac_Type = 'K' AND LEFT(fa.A_Code,2) = '01' GROUP BY fa.A_Code, a.A_Name;

-- @name: E11.4 | Opening inventory: item-level vs ledger 106, per warehouse
SELECT m.M_groupname, SUM(a.First_exist) qty, SUM(a.First_exist * a.FirstBuy_Price) value
FROM ARTICLE a JOIN M_GROUP m ON m.M_groupcode = LEFT(a.A_Code,2) WHERE a.First_exist > 0 AND LEFT(a.A_Code,2) <> '01' GROUP BY m.M_groupname ORDER BY value DESC;

-- @name: E11.5 | The 6-unit item that explains the opening-inventory swing
SELECT A_Code, A_Name, First_exist, FirstBuy_Price, First_exist * FirstBuy_Price value, Exist, Buy_Price,
       (SELECT COUNT(*) FROM FACTART fa WHERE fa.A_Code = ARTICLE.A_Code) movement_lines
FROM ARTICLE WHERE ABS(First_exist * FirstBuy_Price - 10266398349) < 2;

-- @name: E11.6 | Items with stored Buy_Price differing from last purchase direction (Buy_Price <= 0 with stock)
SELECT COUNT(*) items_in_stock, SUM(CASE WHEN ISNULL(Buy_Price,0) <= 0 THEN 1 ELSE 0 END) zero_cost_in_stock FROM ARTICLE WHERE Exist > 0 AND LEFT(A_Code,2) <> '01';

-- @name: E11.7 | Transfer pairs: value out (S at source cost) vs value in (D line cost)
SELECT COUNT(*) pairs, SUM(s.Few_Article * ISNULL(s.Buy_Price,0)) value_out, SUM(d.Few_Article * ISNULL(d.Buy_Price,0)) value_in,
       SUM(CASE WHEN ABS(ISNULL(s.Buy_Price,0) - ISNULL(d.Buy_Price,0)) > 1 THEN 1 ELSE 0 END) unit_cost_differs
FROM FACTART s JOIN FACTART d ON d.Fac_Code = s.Fac_Code AND d.Fac_Type = 'D' AND d.A_Index = s.A_Index WHERE s.Fac_Type = 'S';

-- @name: E11.8 | Items with NEGATIVE opening quantity carried from the previous year
SELECT A_Code, A_Name, First_exist, FirstBuy_Price, First_exist * FirstBuy_Price value FROM ARTICLE WHERE First_exist < 0 ORDER BY value;

-- @name: E11.9 | Historical negative stock: end-of-day balance < 0 (goods)
WITH d AS (
  SELECT fa.A_Code, f.Fac_Date,
         SUM(CASE WHEN f.Fac_Type IN ('K','Y','D') THEN fa.Few_Article WHEN f.Fac_Type IN ('F','X','Z','S') THEN -fa.Few_Article ELSE 0 END) net
  FROM FACTART fa JOIN FACTURE f ON f.Fac_Code = fa.Fac_Code AND f.Fac_Type = fa.Fac_Type
  WHERE LEFT(fa.A_Code,2) <> '01' GROUP BY fa.A_Code, f.Fac_Date),
r AS (SELECT d.A_Code, d.Fac_Date, a.First_exist + SUM(d.net) OVER (PARTITION BY d.A_Code ORDER BY d.Fac_Date ROWS UNBOUNDED PRECEDING) bal
      FROM d JOIN ARTICLE a ON a.A_Code = d.A_Code)
SELECT COUNT(DISTINCT A_Code) items, COUNT(*) item_days, MIN(bal) worst FROM r WHERE bal < 0;

-- @name: E11.10 | Sale lines with zero stored cost (cost understatement in line-level margins)
SELECT COUNT(*) lines, SUM(fa.Few_Article) qty, SUM(fa.Few_Article * a.Buy_Price) approx_cost_at_final_avg, SUM(fa.Few_Article * fa.Price_BS) revenue
FROM FACTART fa JOIN ARTICLE a ON a.A_Code = fa.A_Code WHERE fa.Fac_Type = 'F' AND ISNULL(fa.Buy_Price,0) = 0 AND LEFT(fa.A_Code,2) <> '01';
