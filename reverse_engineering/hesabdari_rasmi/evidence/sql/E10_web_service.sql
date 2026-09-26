-- E10 — Link between the web-service channel and sales

-- @name: E10.1 | Invoice creation channel from the log (A-F/A-K events)
SELECT RTRIM(NameProc) doc, CASE WHEN Comment LIKE N'%(وب سرویس)%' THEN 'web-service' ELSE 'holoo-ui' END channel, User_Code, COUNT(*) n
FROM Process WHERE RTRIM(KindProc) = 'A' AND RTRIM(NameProc) IN ('F','K') GROUP BY RTRIM(NameProc), CASE WHEN Comment LIKE N'%(وب سرویس)%' THEN 'web-service' ELSE 'holoo-ui' END, User_Code ORDER BY n DESC;

-- @name: E10.2 | Invoice fields populated by the channel (UserCode=3 is the web user)
SELECT CASE WHEN UserCode = 3 THEN 'web(3)' ELSE 'other' END src, COUNT(*) n,
       SUM(CASE WHEN ISNULL(UId,'') <> '' THEN 1 ELSE 0 END) with_uid,
       SUM(CASE WHEN Fac_Comment LIKE 'web%' THEN 1 ELSE 0 END) comment_web_prefix,
       SUM(CASE WHEN Fac_Comment LIKE '%/[0-9][0-9][0-9][0-9][0-9]%' THEN 1 ELSE 0 END) comment_with_order_no,
       SUM(CASE WHEN ISNULL(OrderId,0) <> 0 THEN 1 ELSE 0 END) with_orderid,
       SUM(CASE WHEN IsCMS = 1 THEN 1 ELSE 0 END) iscms
FROM FACTURE WHERE Fac_Type = 'F' GROUP BY CASE WHEN UserCode = 3 THEN 'web(3)' ELSE 'other' END;

-- @name: E10.3 | Comment pattern samples (operator/order-number)
SELECT TOP 12 Fac_Code_C, LEFT(Fac_Comment, 60) c FROM FACTURE WHERE Fac_Type = 'F' AND UserCode = 3 ORDER BY NEWID();

-- @name: E10.4 | Web invoices later edited in Holoo UI (E-F by a human user)
SELECT p.User_Code, COUNT(DISTINCT p.Number) invoices_edited FROM Process p
WHERE RTRIM(p.KindProc) = 'E' AND RTRIM(p.NameProc) = 'F' GROUP BY p.User_Code ORDER BY 2 DESC;

-- @name: E10.5 | Entry lag: invoice date vs web posting date (log)
WITH a AS (SELECT TRY_CONVERT(date, REPLACE(DateProc,'/','-')) d, TRY_CAST(RTRIM(Number) AS int) sc FROM Process WHERE RTRIM(KindProc) = 'A' AND RTRIM(NameProc) = 'F' AND Comment LIKE N'%(وب سرویس)%')
SELECT DATEDIFF(day, f.Fac_Date, a.d) lag_days, COUNT(*) n FROM a JOIN FACTURE f ON f.Sanad_Code = a.sc AND f.Fac_Type = 'F'
GROUP BY DATEDIFF(day, f.Fac_Date, a.d) ORDER BY 1;

-- @name: E10.6 | Web invoices: posting hour distribution (log time is real; Fac_Time is not)
SELECT LEFT(TimeProc, 2) hh, COUNT(*) n FROM Process WHERE RTRIM(KindProc) = 'A' AND RTRIM(NameProc) = 'F' AND Comment LIKE N'%(وب سرویس)%' GROUP BY LEFT(TimeProc, 2) ORDER BY 1;

-- @name: E10.7 | Payment instrument accounts used by web sales (Type_Line Z)
SELECT l.Col_Code + l.Moien_Code + l.Tafzili_Code acc, MAX(sf.Sarfasl_Name) name, COUNT(*) n, SUM(l.Bed) amount
FROM SND_LIST l JOIN FACTURE f ON f.Sanad_Code = l.Sanad_Code AND f.Fac_Type = 'F' JOIN SARFASL sf ON sf.Sarfasl_Code = l.Col_Code + l.Moien_Code + l.Tafzili_Code
WHERE l.Type_Line = 'Z' GROUP BY l.Col_Code + l.Moien_Code + l.Tafzili_Code ORDER BY amount DESC;
