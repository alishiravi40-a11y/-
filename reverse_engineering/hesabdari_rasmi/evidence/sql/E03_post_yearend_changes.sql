-- E03 — Changes to FY1404 books after year end (2026-03-20)

-- @name: E03.1 | Highest fixed voucher number cited in the log while the year was open
SELECT MAX(TRY_CAST(RTRIM(Number) AS int)) max_fixed_logged FROM Process
WHERE RTRIM(KindProc) = 'A' AND RTRIM(NameProc) IN ('S','F','K','C','X','Y','Z') AND DateProc <= '2026/03/20'
  AND TRY_CAST(RTRIM(Number) AS int) BETWEEN 300000 AND 400000;

-- @name: E03.2 | Vouchers by first-save month for fixed numbers above the last in-year number
SELECT LEFT(REPLACE(DateUser,'/','-'),10) AS day_saved, COUNT(*) n, MIN(Sanad_Code) mn, MAX(Sanad_Code) mx
FROM SANAD WHERE Sanad_Code > 361458 GROUP BY LEFT(REPLACE(DateUser,'/','-'),10) ORDER BY 1;

-- @name: E03.3 | Vouchers CREATED after year end (identity allocated after the last voucher saved on/before 2026-03-20)
WITH lim AS (SELECT MAX(Sanad_Code) m FROM SANAD WHERE TRY_CONVERT(date, REPLACE(DateUser,'/','-')) <= '2026-03-20' AND Sanad_Code < 371083)
SELECT (SELECT m FROM lim) AS last_inyear_id, s.Sanad_Type, COUNT(*) n,
       MIN(s.Sanad_Date) min_doc_date, MAX(s.Sanad_Date) max_doc_date,
       SUM(ISNULL(t.amt, 0)) amount
FROM SANAD s LEFT JOIN (SELECT Sanad_Code, SUM(Bed) amt FROM SND_LIST GROUP BY Sanad_Code) t ON t.Sanad_Code = s.Sanad_Code
WHERE s.Sanad_Code > (SELECT m FROM lim) AND s.Sanad_Code < 371083
GROUP BY s.Sanad_Type ORDER BY n DESC;

-- @name: E03.4 | Same set by creating user
WITH lim AS (SELECT MAX(Sanad_Code) m FROM SANAD WHERE TRY_CONVERT(date, REPLACE(DateUser,'/','-')) <= '2026-03-20' AND Sanad_Code < 371083)
SELECT UserCodeInc, COUNT(*) n FROM SANAD WHERE Sanad_Code > (SELECT m FROM lim) AND Sanad_Code < 371083 GROUP BY UserCodeInc ORDER BY n DESC;

-- @name: E03.5 | Existing (in-year) vouchers re-saved after year end (Endeditdate > 2026-03-20)
WITH lim AS (SELECT MAX(Sanad_Code) m FROM SANAD WHERE TRY_CONVERT(date, REPLACE(DateUser,'/','-')) <= '2026-03-20' AND Sanad_Code < 371083),
x AS (SELECT CASE WHEN s.Sanad_Code <= lim.m THEN 'created in-year' ELSE 'created after year end' END AS origin,
             LEFT(CONVERT(varchar, s.Endeditdate, 23), 7) AS edit_month
      FROM SANAD s CROSS JOIN lim WHERE s.Endeditdate > '2026-03-21')
SELECT origin, edit_month, COUNT(*) n FROM x GROUP BY origin, edit_month ORDER BY 1, 2;

-- @name: E03.6 | Union: all vouchers touched after year end (created or last saved)
WITH lim AS (SELECT MAX(Sanad_Code) m FROM SANAD WHERE TRY_CONVERT(date, REPLACE(DateUser,'/','-')) <= '2026-03-20' AND Sanad_Code < 371083),
x AS (SELECT s.Sanad_Code, CASE WHEN s.Sanad_Code > lim.m THEN 1 ELSE 0 END AS created_after
      FROM SANAD s CROSS JOIN lim
      WHERE s.Sanad_Code < 371083 AND s.Sanad_Code > 1
        AND (s.Sanad_Code > lim.m OR s.Endeditdate > '2026-03-21' OR TRY_CONVERT(date, REPLACE(s.DateUser,'/','-')) > '2026-03-20'))
SELECT COUNT(*) touched, SUM(created_after) created_after, COUNT(*) - SUM(created_after) edited_after FROM x;

-- @name: E03.7 | Invoices whose last save is after year end
SELECT Fac_Type, COUNT(*) n, SUM(Sum_Price) amount, MIN(Fac_Date) min_date, MAX(Fac_Date) max_date
FROM FACTURE WHERE TRY_CONVERT(date, REPLACE(DateUser,'/','-')) > '2026-03-20' GROUP BY Fac_Type;

-- @name: E03.8 | Invoices whose voucher was created after year end
WITH lim AS (SELECT MAX(Sanad_Code) m FROM SANAD WHERE TRY_CONVERT(date, REPLACE(DateUser,'/','-')) <= '2026-03-20' AND Sanad_Code < 371083)
SELECT f.Fac_Type, COUNT(*) n, SUM(f.Sum_Price) amount FROM FACTURE f
WHERE f.Sanad_Code > (SELECT m FROM lim) AND f.Sanad_Code < 371083 GROUP BY f.Fac_Type;

-- @name: E03.9 | Tax submissions performed after year end from this database
SELECT SendType, StateTax, COUNT(*) n, MIN(SendDateTax) first_, MAX(SendDateTax) last_
FROM TaxLog WHERE SendDateTax > '2026-03-21' GROUP BY SendType, StateTax;

-- @name: E03.10 | Closing vouchers generation time
SELECT Sanad_Code, Sanad_Code_C, sanad_state, DateUser, TimeUser, UserCodeInc FROM SANAD WHERE sanad_state IN (1,2,3);
