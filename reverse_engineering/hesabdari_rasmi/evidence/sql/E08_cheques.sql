-- E08 — Cheque subsystem vs ledger reconciliation

-- @name: E08.1 | Current state of each cheque (last event) with amount
WITH last AS (SELECT Check_Code, State, SarFasl_Code, Cash_ID, ROW_NUMBER() OVER (PARTITION BY Check_Code ORDER BY Date_Time DESC, Id DESC) rn FROM Check_Event)
SELECT c.Daryaft_Pardakht AS received, l.State, COUNT(*) n, SUM(c.Cust) amount
FROM [Check] c JOIN last l ON l.Check_Code = c.Check_Code AND l.rn = 1 GROUP BY c.Daryaft_Pardakht, l.State ORDER BY 1 DESC, n DESC;

-- @name: E08.2 | Ledger balance of receivable-cheque accounts (104) at year end (before closing), per moein
SELECT l.Col_Code + l.Moien_Code AS moein, MAX(f.Sarfasl_Name) name, SUM(l.Bed) - SUM(l.Bes) balance
FROM SND_LIST l JOIN SANAD s ON s.Sanad_Code = l.Sanad_Code JOIN SARFASL f ON f.Sarfasl_Code = l.Col_Code + l.Moien_Code
WHERE s.sanad_state IN (0,1) AND l.Col_Code = '104' GROUP BY l.Col_Code + l.Moien_Code;

-- @name: E08.3 | Received cheques in hand (D,S,M,R) vs 104-0001 (cash) ; in collection (J) vs 104-0002
WITH last AS (SELECT Check_Code, State, ROW_NUMBER() OVER (PARTITION BY Check_Code ORDER BY Date_Time DESC, Id DESC) rn FROM Check_Event)
SELECT SUM(CASE WHEN l.State IN ('D','S','M','R') THEN c.Cust ELSE 0 END) in_hand_subsystem,
       (SELECT SUM(Bed) - SUM(Bes) FROM SND_LIST x JOIN SANAD s ON s.Sanad_Code = x.Sanad_Code WHERE s.sanad_state IN (0,1) AND x.Col_Code + x.Moien_Code = '1040001') in_hand_ledger,
       SUM(CASE WHEN l.State = 'J' THEN c.Cust ELSE 0 END) in_collection_subsystem,
       (SELECT SUM(Bed) - SUM(Bes) FROM SND_LIST x JOIN SANAD s ON s.Sanad_Code = x.Sanad_Code WHERE s.sanad_state IN (0,1) AND x.Col_Code + x.Moien_Code = '1040002') in_collection_ledger
FROM [Check] c JOIN last l ON l.Check_Code = c.Check_Code AND l.rn = 1 WHERE c.Daryaft_Pardakht = 1;

-- @name: E08.4 | Issued cheques open (P) vs ledger 402
WITH last AS (SELECT Check_Code, State, ROW_NUMBER() OVER (PARTITION BY Check_Code ORDER BY Date_Time DESC, Id DESC) rn FROM Check_Event)
SELECT SUM(CASE WHEN l.State = 'P' THEN c.Cust ELSE 0 END) open_issued_subsystem,
       (SELECT SUM(Bes) - SUM(Bed) FROM SND_LIST x JOIN SANAD s ON s.Sanad_Code = x.Sanad_Code WHERE s.sanad_state IN (0,1) AND x.Col_Code = '402') open_issued_ledger
FROM [Check] c JOIN last l ON l.Check_Code = c.Check_Code AND l.rn = 1 WHERE c.Daryaft_Pardakht = 0;

-- @name: E08.5 | Per-cashbox reconciliation (Cash.Sarfasl_Code2 = cheque account of the cashbox)
WITH last AS (SELECT Check_Code, State, Cash_ID, ROW_NUMBER() OVER (PARTITION BY Check_Code ORDER BY Date_Time DESC, Id DESC) rn FROM Check_Event)
SELECT cs.Id, cs.S_Name, cs.Sarfasl_Code2,
       (SELECT SUM(c.Cust) FROM [Check] c JOIN last l ON l.Check_Code = c.Check_Code AND l.rn = 1 WHERE c.Daryaft_Pardakht = 1 AND l.State IN ('D','S','M','R') AND c.Cash_Id = cs.Id) subsystem,
       (SELECT SUM(Bed) - SUM(Bes) FROM SND_LIST x JOIN SANAD s ON s.Sanad_Code = x.Sanad_Code WHERE s.sanad_state IN (0,1) AND x.Col_Code + x.Moien_Code + x.Tafzili_Code = cs.Sarfasl_Code2) ledger
FROM Cash cs WHERE cs.Sarfasl_Code2 <> '';

-- @name: E08.6 | Flag consistency: Check flags vs last event
WITH last AS (SELECT Check_Code, State, ROW_NUMBER() OVER (PARTITION BY Check_Code ORDER BY Date_Time DESC, Id DESC) rn FROM Check_Event)
SELECT l.State, c.Vosool, c.DarJaryan, c.Sel_check, c.Bargashty, COUNT(*) n
FROM [Check] c JOIN last l ON l.Check_Code = c.Check_Code AND l.rn = 1 WHERE c.Daryaft_Pardakht = 1
GROUP BY l.State, c.Vosool, c.DarJaryan, c.Sel_check, c.Bargashty ORDER BY l.State, n DESC;

-- @name: E08.7 | Overdue cheques still in hand at year end
WITH last AS (SELECT Check_Code, State, ROW_NUMBER() OVER (PARTITION BY Check_Code ORDER BY Date_Time DESC, Id DESC) rn FROM Check_Event)
SELECT CASE WHEN DATEDIFF(day, c.Receive_Date, '2026-03-20') > 180 THEN '>180d' WHEN DATEDIFF(day, c.Receive_Date, '2026-03-20') > 90 THEN '91-180d'
            WHEN DATEDIFF(day, c.Receive_Date, '2026-03-20') > 30 THEN '31-90d' ELSE '1-30d' END AS overdue, COUNT(*) n, SUM(c.Cust) amount
FROM [Check] c JOIN last l ON l.Check_Code = c.Check_Code AND l.rn = 1
WHERE c.Daryaft_Pardakht = 1 AND l.State IN ('D','S','M','R') AND c.Receive_Date < '2026-03-20'
GROUP BY CASE WHEN DATEDIFF(day, c.Receive_Date, '2026-03-20') > 180 THEN '>180d' WHEN DATEDIFF(day, c.Receive_Date, '2026-03-20') > 90 THEN '91-180d'
            WHEN DATEDIFF(day, c.Receive_Date, '2026-03-20') > 30 THEN '31-90d' ELSE '1-30d' END;

-- @name: E08.8 | Event dates later than year end (events recorded for FY1404 cheques after closing?)
SELECT State, COUNT(*) n, MIN(Date_Time) mn, MAX(Date_Time) mx FROM Check_Event WHERE Date_Time > '2026-03-20' GROUP BY State;

-- @name: E08.9 | Due date before receipt date / duplicates of (bank, cheque number)
SELECT (SELECT COUNT(*) FROM [Check] WHERE Receive_Date < Export_Date) due_before_receipt,
       (SELECT COUNT(*) FROM (SELECT Bank_Code, Check_Number FROM [Check] WHERE Daryaft_Pardakht = 1 GROUP BY Bank_Code, Check_Number, Account_Number HAVING COUNT(*) > 1) x) duplicate_bank_number_account,
       (SELECT COUNT(*) FROM (SELECT Sayad_Number FROM [Check] WHERE ISNULL(Sayad_Number,'') <> '' GROUP BY Sayad_Number HAVING COUNT(*) > 1) x) duplicate_sayad,
       (SELECT COUNT(*) FROM [Check] WHERE ISNULL(Sayad_Number,'') <> '') with_sayad;

-- @name: E08.10 | The 200,000,000 subsystem↔ledger gap: cheques whose last event by date ≠ last event by entry order
WITH o AS (SELECT Check_Code, State, Date_Time, Id, Sanad_Code,
                  ROW_NUMBER() OVER (PARTITION BY Check_Code ORDER BY Date_Time DESC, Id DESC) r_date,
                  ROW_NUMBER() OVER (PARTITION BY Check_Code ORDER BY Id DESC) r_id FROM Check_Event)
SELECT a.Check_Code, c.Check_Number, c.Cust, a.State last_by_date, a.Date_Time, b.State last_by_entry, b.Date_Time entry_doc_date, b.Sanad_Code entry_voucher
FROM o a JOIN o b ON b.Check_Code = a.Check_Code AND b.r_id = 1 JOIN [Check] c ON c.Check_Code = a.Check_Code
WHERE a.r_date = 1 AND a.Id <> b.Id ORDER BY c.Cust DESC;

-- @name: E08.11 | Log of the two cheques (spend → return → undo → back-dated spend)
SELECT DateProc, TimeProc, User_Code, LEFT(Comment, 120) c FROM Process WHERE Comment LIKE '%759265%' OR Comment LIKE '%759266%' OR Number LIKE '354663%' ORDER BY ID;

-- @name: E08.12 | "Undo" operations on cheques (عودت ...) — these rewind state and remove history
SELECT CASE WHEN Comment LIKE N'%عودت%وصول%' THEN 'undo: collection'
            WHEN Comment LIKE N'%عودت%بحساب خواباندن%' THEN 'undo: deposit to bank'
            WHEN Comment LIKE N'%عودت%خرجي%' THEN 'undo: spend to third party'
            WHEN Comment LIKE N'%عودت سند برگشتي%' THEN 'undo: bounce'
            WHEN Comment LIKE N'%عودت%' THEN 'undo: other'
            WHEN Comment LIKE N'%اصلاح مشخصات سن%' THEN 'edit bank document'
            ELSE 'other edit' END AS op, COUNT(*) n, COUNT(DISTINCT User_Code) users
FROM Process WHERE RTRIM(KindProc) = 'E' AND RTRIM(NameProc) = 'C'
GROUP BY CASE WHEN Comment LIKE N'%عودت%وصول%' THEN 'undo: collection'
            WHEN Comment LIKE N'%عودت%بحساب خواباندن%' THEN 'undo: deposit to bank'
            WHEN Comment LIKE N'%عودت%خرجي%' THEN 'undo: spend to third party'
            WHEN Comment LIKE N'%عودت سند برگشتي%' THEN 'undo: bounce'
            WHEN Comment LIKE N'%عودت%' THEN 'undo: other'
            WHEN Comment LIKE N'%اصلاح مشخصات سن%' THEN 'edit bank document'
            ELSE 'other edit' END ORDER BY n DESC;
