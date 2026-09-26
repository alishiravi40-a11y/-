-- E05 — Audit log (Process) continuity and coverage

-- @name: E05.1 | Log volume per month
SELECT LEFT(DateProc, 7) m, COUNT(*) n, MIN(ID) min_id, MAX(ID) max_id FROM Process GROUP BY LEFT(DateProc, 7) ORDER BY 1;

-- @name: E05.2 | ID continuity across the year-end boundary
SELECT TOP 6 ID, DateProc, TimeProc, User_Code, LEFT(Comment, 60) c FROM Process WHERE ID BETWEEN 670578 AND 670590 ORDER BY ID;

-- @name: E05.3 | Identity gaps (>1) in Process.ID — large jumps (~1000) are SQL Server identity-cache restarts
SELECT ID, nx, nx - ID - 1 AS missing FROM (SELECT ID, LEAD(ID) OVER (ORDER BY ID) nx FROM Process) x WHERE nx - ID > 1 ORDER BY ID;

-- @name: E05.4 | Activity evidence in other tables during the log gap (2026-03-21 .. 2026-09-07)
SELECT 'SANAD.Endeditdate' src, COUNT(*) n FROM SANAD WHERE Endeditdate BETWEEN '2026-03-21' AND '2026-09-07'
UNION ALL SELECT 'SANAD.DateUser', COUNT(*) FROM SANAD WHERE TRY_CONVERT(date, REPLACE(DateUser,'/','-')) BETWEEN '2026-03-21' AND '2026-09-07'
UNION ALL SELECT 'FACTURE.DateUser', COUNT(*) FROM FACTURE WHERE TRY_CONVERT(date, REPLACE(DateUser,'/','-')) BETWEEN '2026-03-21' AND '2026-09-07'
UNION ALL SELECT 'TaxLog.SendDateTax', COUNT(*) FROM TaxLog WHERE SendDateTax BETWEEN '2026-03-21' AND '2026-09-07'
UNION ALL SELECT 'Sanad_Edit.Endeditdate', COUNT(*) FROM Sanad_Edit WHERE Endeditdate BETWEEN '2026-03-21' AND '2026-09-07'
UNION ALL SELECT 'Process', COUNT(*) FROM Process WHERE DateProc BETWEEN '2026/03/21' AND '2026/09/07';

-- @name: E05.5 | Coverage: share of vouchers whose creation is logged (A-S / A-F / A-K ... with fixed number)
WITH logged AS (SELECT DISTINCT TRY_CAST(RTRIM(Number) AS int) sc FROM Process WHERE RTRIM(KindProc) = 'A' AND TRY_CAST(RTRIM(Number) AS int) > 300000)
SELECT s.Sanad_Type, COUNT(*) n, SUM(CASE WHEN l.sc IS NOT NULL THEN 1 ELSE 0 END) creation_logged
FROM SANAD s LEFT JOIN logged l ON l.sc = s.Sanad_Code WHERE s.Sanad_Code > 1 GROUP BY s.Sanad_Type ORDER BY n DESC;

-- @name: E05.6 | Before-image blobs available per operation
SELECT RTRIM(KindProc) + RTRIM(NameProc) k, COUNT(*) n, SUM(CASE WHEN Blob IS NOT NULL THEN 1 ELSE 0 END) with_blob FROM Process
GROUP BY RTRIM(KindProc) + RTRIM(NameProc) HAVING SUM(CASE WHEN Blob IS NOT NULL THEN 1 ELSE 0 END) > 0 ORDER BY n DESC;

-- @name: E05.7 | Code objects created/modified on the closing day (2026-09-08) — year-transfer run
SELECT CONVERT(varchar(10), create_date, 23) d, type_desc, COUNT(*) n FROM sys.objects WHERE is_ms_shipped = 0 AND type IN ('P','FN','IF','TF','V','TR')
GROUP BY CONVERT(varchar(10), create_date, 23), type_desc ORDER BY 1 DESC;
