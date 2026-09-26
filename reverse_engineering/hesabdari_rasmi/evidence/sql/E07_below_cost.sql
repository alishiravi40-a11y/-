-- E07 — Sales below cost

-- @name: E07.1 | Sales lines vs stored moving-average cost (goods only)
SELECT COUNT(*) lines, SUM(CASE WHEN Price_BS < Buy_Price THEN 1 ELSE 0 END) below_cost,
       SUM(CASE WHEN Price_BS < Buy_Price THEN (Buy_Price - Price_BS) * Few_Article ELSE 0 END) shortfall,
       SUM(CASE WHEN Price_BS < Buy_Price * 0.99 THEN 1 ELSE 0 END) below_cost_by_more_than_1pct,
       SUM(CASE WHEN Price_BS < Buy_Price * 0.99 THEN (Buy_Price - Price_BS) * Few_Article ELSE 0 END) shortfall_gt1pct,
       SUM(CASE WHEN ISNULL(Buy_Price, 0) = 0 THEN 1 ELSE 0 END) zero_cost_lines
FROM FACTART WHERE Fac_Type = 'F' AND LEFT(A_Code, 2) <> '01';

-- @name: E07.2 | Below-cost lines by warehouse (main group)
SELECT m.M_groupname, COUNT(*) lines, SUM(CASE WHEN fa.Price_BS < fa.Buy_Price THEN 1 ELSE 0 END) below,
       SUM(fa.Few_Article * fa.Price_BS) revenue, SUM(fa.Few_Article * fa.Buy_Price) cost
FROM FACTART fa JOIN M_GROUP m ON m.M_groupcode = LEFT(fa.A_Code, 2) WHERE fa.Fac_Type = 'F' AND LEFT(fa.A_Code, 2) <> '01'
GROUP BY m.M_groupname ORDER BY revenue DESC;

-- @name: E07.3 | Below-cost lines by entering user (FACTURE.UserCode)
SELECT f.UserCode, COUNT(*) lines, SUM(CASE WHEN fa.Price_BS < fa.Buy_Price THEN 1 ELSE 0 END) below,
       SUM(CASE WHEN fa.Price_BS < fa.Buy_Price THEN (fa.Buy_Price - fa.Price_BS) * fa.Few_Article ELSE 0 END) shortfall
FROM FACTART fa JOIN FACTURE f ON f.Fac_Code = fa.Fac_Code AND f.Fac_Type = fa.Fac_Type
WHERE f.Fac_Type = 'F' AND LEFT(fa.A_Code, 2) <> '01' GROUP BY f.UserCode ORDER BY lines DESC;

-- @name: E07.4 | Below-cost against the latest purchase price before the sale date (independent of average)
WITH s AS (
  SELECT fa.Fac_Code, fa.A_Index, fa.A_Code, fa.Few_Article, fa.Price_BS, f.Fac_Date,
         (SELECT TOP 1 k.Price_BS FROM FACTART k JOIN FACTURE kf ON kf.Fac_Code = k.Fac_Code AND kf.Fac_Type = k.Fac_Type
           WHERE k.Fac_Type = 'K' AND kf.Fac_Date <= f.Fac_Date
             AND k.A_Code IN (SELECT a2.A_Code FROM ARTICLE a2 JOIN ARTICLE a1 ON a1.A_Name = a2.A_Name WHERE a1.A_Code = fa.A_Code)
           ORDER BY kf.Fac_Date DESC, kf.Fac_Code DESC) AS last_buy
  FROM FACTART fa JOIN FACTURE f ON f.Fac_Code = fa.Fac_Code AND f.Fac_Type = fa.Fac_Type
  WHERE f.Fac_Type = 'F' AND LEFT(fa.A_Code, 2) <> '01')
SELECT COUNT(*) lines, SUM(CASE WHEN last_buy IS NULL THEN 1 ELSE 0 END) no_prior_purchase,
       SUM(CASE WHEN Price_BS < last_buy THEN 1 ELSE 0 END) below_last_purchase,
       SUM(CASE WHEN Price_BS < last_buy THEN (last_buy - Price_BS) * Few_Article ELSE 0 END) shortfall_vs_last_purchase
FROM s;
