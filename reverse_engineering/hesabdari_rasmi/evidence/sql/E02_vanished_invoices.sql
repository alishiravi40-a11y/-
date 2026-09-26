-- E02 — Sales invoice numbers: gaps, deletions, vanished web-service invoices

-- @name: E02.1 | Display number range and gaps per type
SELECT Fac_Type, MIN(Fac_Code_C) mn, MAX(Fac_Code_C) mx, COUNT(*) n, MAX(Fac_Code_C) - MIN(Fac_Code_C) + 1 - COUNT(*) gaps
FROM FACTURE GROUP BY Fac_Type;

-- @name: E02.2 | Internal code (Fac_Code) range for F+Q (shared counter) and gaps
SELECT MIN(CAST(Fac_Code AS int)) mn, MAX(CAST(Fac_Code AS int)) mx, COUNT(*) n,
       MAX(CAST(Fac_Code AS int)) - MIN(CAST(Fac_Code AS int)) + 1 - COUNT(*) gaps
FROM FACTURE WHERE Fac_Type IN ('F','Q');

-- @name: E02.3 | Log classification of missing display numbers (created/edited/deleted events)
WITH nums AS (
  SELECT TOP (21205) 90440346 + ROW_NUMBER() OVER (ORDER BY (SELECT 1)) - 1 AS n FROM SND_LIST),
miss AS (SELECT n FROM nums WHERE NOT EXISTS (SELECT 1 FROM FACTURE f WHERE f.Fac_Type IN ('F','Q') AND f.Fac_Code_C = nums.n)),
ev AS (
  SELECT m.n,
         MAX(CASE WHEN RTRIM(p.KindProc) = 'A' THEN 1 ELSE 0 END) a,
         MAX(CASE WHEN RTRIM(p.KindProc) = 'E' THEN 1 ELSE 0 END) e,
         MAX(CASE WHEN RTRIM(p.KindProc) = 'D' THEN 1 ELSE 0 END) d
  FROM miss m LEFT JOIN Process p ON RTRIM(p.NameProc) = 'F' AND p.Comment LIKE '%' + CAST(m.n AS varchar(10)) + '%'
  GROUP BY m.n)
SELECT CASE WHEN a = 0 AND d = 0 THEN 'no log trace'
            WHEN d = 1 THEN 'deleted (logged)'
            WHEN a = 1 AND d = 0 THEN 'created, then vanished without delete log' END AS class,
       COUNT(*) n
FROM ev GROUP BY CASE WHEN a = 0 AND d = 0 THEN 'no log trace' WHEN d = 1 THEN 'deleted (logged)'
                      WHEN a = 1 AND d = 0 THEN 'created, then vanished without delete log' END;

-- @name: E02.4 | Vanished-without-delete-log invoices: creation date, user, channel
WITH p AS (
  SELECT p.ID, p.DateProc, p.User_Code, p.Number, p.Comment,
         TRY_CAST(SUBSTRING(p.Comment, PATINDEX('%904[456]_____%', p.Comment), 8) AS int) AS fnum
  FROM Process p WHERE RTRIM(p.NameProc) = 'F' AND PATINDEX('%904[456]_____%', p.Comment) > 0)
SELECT LEFT(a.DateProc, 7) AS month, a.User_Code,
       CASE WHEN a.Comment LIKE N'%وب سرویس%' THEN 'web-service' ELSE 'ui' END AS channel, COUNT(*) n
FROM p a
WHERE RTRIM((SELECT KindProc FROM Process x WHERE x.ID = a.ID)) = 'A'
  AND NOT EXISTS (SELECT 1 FROM FACTURE f WHERE f.Fac_Type IN ('F','Q') AND f.Fac_Code_C = a.fnum)
  AND NOT EXISTS (SELECT 1 FROM p d JOIN Process x ON x.ID = d.ID WHERE d.fnum = a.fnum AND RTRIM(x.KindProc) = 'D')
GROUP BY LEFT(a.DateProc, 7), a.User_Code, CASE WHEN a.Comment LIKE N'%وب سرویس%' THEN 'web-service' ELSE 'ui' END;

-- @name: E02.5 | Fixed voucher numbers cited in those creation logs no longer exist in SANAD
WITH p AS (
  SELECT TRY_CAST(RTRIM(p.Number) AS int) AS sc, TRY_CAST(SUBSTRING(p.Comment, PATINDEX('%904[456]_____%', p.Comment), 8) AS int) AS fnum
  FROM Process p WHERE RTRIM(p.NameProc) = 'F' AND RTRIM(p.KindProc) = 'A' AND PATINDEX('%904[456]_____%', p.Comment) > 0),
x AS (
  SELECT p.*, CASE WHEN s.Sanad_Code IS NULL THEN 0 ELSE 1 END AS voucher_exists
  FROM p LEFT JOIN SANAD s ON s.Sanad_Code = p.sc
  WHERE NOT EXISTS (SELECT 1 FROM FACTURE f WHERE f.Fac_Type IN ('F','Q') AND f.Fac_Code_C = p.fnum)
    AND NOT EXISTS (SELECT 1 FROM Process d WHERE RTRIM(d.KindProc) = 'D' AND RTRIM(d.NameProc) = 'F' AND d.Comment LIKE '%' + CAST(p.fnum AS varchar(10)) + '%'))
SELECT COUNT(*) logged_creations_missing, SUM(voucher_exists) voucher_still_exists FROM x;

-- @name: E02.6 | Tax serial continuity (serials in TaxLog ∪ FACTURE, 1404 range)
WITH s AS (
  SELECT DISTINCT TRY_CAST(SerialFact AS int) v FROM TaxLog WHERE TRY_CAST(SerialFact AS int) IS NOT NULL
  UNION SELECT TRY_CAST(SerialFact AS int) FROM FACTURE WHERE TRY_CAST(SerialFact AS int) IS NOT NULL)
SELECT MIN(v) mn, MAX(CASE WHEN v <= 27359 THEN v END) mx_1404, COUNT(CASE WHEN v <= 27359 THEN 1 END) used,
       MAX(CASE WHEN v <= 27359 THEN v END) - MIN(v) + 1 - COUNT(CASE WHEN v <= 27359 THEN 1 END) gaps
FROM s;

-- @name: E02.7 | TaxLog rows pointing to non-existent invoices (sent then removed)
SELECT t.Fac_Code, t.Fac_Type, t.SendType, t.StateTax, t.SendDateTax
FROM TaxLog t WHERE NOT EXISTS (SELECT 1 FROM FACTURE f WHERE f.Fac_Code = t.Fac_Code AND f.Fac_Type IN ('F','Q'));

-- @name: E02.8 | Deletions of sales invoices by user and month
SELECT User_Code, LEFT(DateProc, 7) m, COUNT(*) n FROM Process
WHERE RTRIM(KindProc) = 'D' AND RTRIM(NameProc) = 'F' GROUP BY User_Code, LEFT(DateProc, 7) ORDER BY User_Code, m;

-- @name: E02.9 | Existence of a helper procedure that moves invoices between years
SELECT o.name, o.create_date, o.modify_date FROM sys.objects o WHERE o.name IN ('MoveFactureCustomerExist');
