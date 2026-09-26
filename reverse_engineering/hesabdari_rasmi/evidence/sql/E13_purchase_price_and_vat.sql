-- E13 — Purchase-price definitions on sale lines (D-06 / D-11) and VAT behaviour (D-01)

-- @name: E13.1 | Holoo settings relevant to below-cost control and VAT (MSETUP2)
SELECT Name, [Boolean], [Double], [String]
FROM MSETUP2 WHERE Name IN ('VAT', 'Darsad_Maliat', 'Darsad_Avarez', 'CheckBuyPriceAlart', 'CalcSoodInForooshEndBuyPrice', 'AcceptLesPrice')
ORDER BY Name;

-- @name: E13.2 | Purchase-price fields stored on each goods sale line (F): moving average vs last purchase
SELECT COUNT(*) sale_lines,
       SUM(CASE WHEN ISNULL(Buy_Price, 0) <> 0 THEN 1 ELSE 0 END) with_moving_average_Buy_Price,
       SUM(CASE WHEN ISNULL(EndBuy_PriceK, 0) <> 0 THEN 1 ELSE 0 END) with_last_purchase_EndBuy_PriceK,
       SUM(CASE WHEN ISNULL(EndBuy_PriceK, 0) = 0 THEN 1 ELSE 0 END) without_last_purchase,
       SUM(CASE WHEN ISNULL(EndBuy_Price, 0) <> 0 THEN 1 ELSE 0 END) with_EndBuy_Price_nonzero
FROM FACTART WHERE Fac_Type = 'F' AND LEFT(A_Code, 2) <> '01';

-- @name: E13.3 | EndBuy_PriceK = last purchase price of the same item on/before the sale date (tolerance 2 rials: Holoo splits a purchase line into rows differing by 1 rial)
WITH s AS (
  SELECT fa.A_Code, fa.EndBuy_PriceK e, f.Fac_Date d
  FROM FACTART fa JOIN FACTURE f ON f.Fac_Code = fa.Fac_Code AND f.Fac_Type = fa.Fac_Type
  WHERE fa.Fac_Type = 'F' AND ISNULL(fa.EndBuy_PriceK, 0) <> 0 AND LEFT(fa.A_Code, 2) <> '01'),
k AS (
  SELECT fa.A_Code, f.Fac_Date d, f.Fac_Code c, fa.Price_BS p
  FROM FACTART fa JOIN FACTURE f ON f.Fac_Code = fa.Fac_Code AND f.Fac_Type = fa.Fac_Type WHERE fa.Fac_Type = 'K')
SELECT COUNT(*) lines_with_last_purchase,
       SUM(CASE WHEN ABS(x.p - s.e) <= 2 THEN 1 ELSE 0 END) equals_last_purchase_same_item,
       SUM(CASE WHEN x.p IS NULL THEN 1 ELSE 0 END) no_purchase_this_year_before_sale
FROM s OUTER APPLY (SELECT TOP 1 k.p FROM k WHERE k.A_Code = s.A_Code AND k.d <= s.d ORDER BY k.d DESC, k.c DESC) x;

-- @name: E13.3b | Same test at model level (item name across all warehouses; items are duplicated per warehouse)
WITH s AS (
  SELECT LTRIM(RTRIM(a.A_Name)) m, fa.EndBuy_PriceK e, f.Fac_Date d
  FROM FACTART fa JOIN FACTURE f ON f.Fac_Code = fa.Fac_Code AND f.Fac_Type = fa.Fac_Type JOIN ARTICLE a ON a.A_Code = fa.A_Code
  WHERE fa.Fac_Type = 'F' AND ISNULL(fa.EndBuy_PriceK, 0) <> 0 AND LEFT(fa.A_Code, 2) <> '01'),
k AS (
  SELECT LTRIM(RTRIM(a.A_Name)) m, f.Fac_Date d, f.Fac_Code c, fa.Price_BS p
  FROM FACTART fa JOIN FACTURE f ON f.Fac_Code = fa.Fac_Code AND f.Fac_Type = fa.Fac_Type JOIN ARTICLE a ON a.A_Code = fa.A_Code
  WHERE fa.Fac_Type = 'K')
SELECT COUNT(*) lines_with_last_purchase,
       SUM(CASE WHEN ABS(x.p - s.e) <= 2 THEN 1 ELSE 0 END) equals_last_purchase_of_model,
       SUM(CASE WHEN x.p IS NULL THEN 1 ELSE 0 END) no_purchase_of_model_this_year_before_sale
FROM s OUTER APPLY (SELECT TOP 1 k.p FROM k WHERE k.m = s.m AND k.d <= s.d ORDER BY k.d DESC, k.c DESC) x;

-- @name: E13.4 | Below-cost sale lines under each candidate definition of "purchase price" (D-11 impact)
SELECT COUNT(*) lines,
       SUM(CASE WHEN Price_BS < Buy_Price THEN 1 ELSE 0 END) below_moving_average,
       SUM(CASE WHEN Price_BS < Buy_Price THEN (Buy_Price - Price_BS) * Few_Article ELSE 0 END) shortfall_moving_average,
       SUM(CASE WHEN ISNULL(EndBuy_PriceK, 0) > 0 AND Price_BS < EndBuy_PriceK THEN 1 ELSE 0 END) below_last_purchase,
       SUM(CASE WHEN ISNULL(EndBuy_PriceK, 0) > 0 AND Price_BS < EndBuy_PriceK THEN (EndBuy_PriceK - Price_BS) * Few_Article ELSE 0 END) shortfall_last_purchase,
       SUM(CASE WHEN Price_BS < Buy_Price OR (ISNULL(EndBuy_PriceK, 0) > 0 AND Price_BS < EndBuy_PriceK) THEN 1 ELSE 0 END) below_either,
       SUM(CASE WHEN Price_BS < Buy_Price AND ISNULL(EndBuy_PriceK, 0) > 0 AND Price_BS < EndBuy_PriceK THEN 1 ELSE 0 END) below_both
FROM FACTART WHERE Fac_Type = 'F' AND LEFT(A_Code, 2) <> '01';

-- @name: E13.5 | ARTICLE.EndBuy_Price vs the item's actual last purchase in the year (reliability of the item-level field)
WITH k AS (
  SELECT fa.A_Code, fa.Price_BS, ROW_NUMBER() OVER (PARTITION BY fa.A_Code ORDER BY f.Fac_Date DESC, f.Fac_Code DESC, fa.A_Index DESC) rn
  FROM FACTART fa JOIN FACTURE f ON f.Fac_Code = fa.Fac_Code AND f.Fac_Type = fa.Fac_Type WHERE fa.Fac_Type = 'K')
SELECT COUNT(*) items_purchased, SUM(CASE WHEN ABS(a.EndBuy_Price - k.Price_BS) < 1 THEN 1 ELSE 0 END) article_EndBuy_equals_last_purchase
FROM ARTICLE a JOIN k ON k.A_Code = a.A_Code AND k.rn = 1;

-- @name: E13.6 | VAT/levy amounts on invoice headers and lines, per invoice type
SELECT f.Fac_Type, COUNT(*) invoices, SUM(ISNULL(f.DMaliat, 0)) DMaliat, SUM(ISNULL(f.Sum_Levy, 0)) Sum_Levy,
       SUM(ISNULL(f.Sum_Scot, 0)) Sum_Scot, SUM(CASE WHEN ISNULL(f.IsLevyAndScot, 0) <> 0 THEN 1 ELSE 0 END) IsLevyAndScot,
       (SELECT SUM(ISNULL(Levy, 0)) + SUM(ISNULL(Scot, 0)) FROM FACTART fa WHERE fa.Fac_Type = f.Fac_Type) line_levy_scot
FROM FACTURE f GROUP BY f.Fac_Type ORDER BY f.Fac_Type;

-- @name: E13.7 | Postings to VAT accounts (visible ledger lines, Show_Daftar = 1)
SELECT sf.Sarfasl_Code acc, COUNT(l.Sanad_Code) lines, ISNULL(SUM(l.Bed), 0) debit, ISNULL(SUM(l.Bes), 0) credit
FROM SARFASL sf LEFT JOIN SND_LIST l ON l.Col_Code + l.Moien_Code = sf.Sarfasl_Code AND l.Show_Daftar = 1
WHERE sf.Sarfasl_Code IN ('1070001', '1070002', '4030001', '4030002', '6010056', '6010057')
GROUP BY sf.Sarfasl_Code ORDER BY sf.Sarfasl_Code;
