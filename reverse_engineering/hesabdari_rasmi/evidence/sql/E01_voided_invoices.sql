-- E01 — Voided sales invoices (Fac_Type='Q'): stock, ledger, closing, tax effects

-- @name: E01.1 | Q invoices header, payment split and linked voucher
SELECT f.Fac_Code, f.Fac_Code_C, f.Fac_Date, f.C_Code, f.Sum_Price, f.Card, f.FNesieh, f.FCheck, f.FNaghd,
       f.Sanad_Code, s.Sanad_Code_C, s.Sanad_Type, f.DateUser, f.StateTax
FROM FACTURE f JOIN SANAD s ON s.Sanad_Code = f.Sanad_Code
WHERE f.Fac_Type = 'Q' ORDER BY f.Fac_Date;

-- @name: E01.2 | Audit log for each Q invoice (creation, return attempts, void event)
SELECT p.ID, p.DateProc, p.TimeProc, p.User_Code, RTRIM(p.KindProc) + RTRIM(p.NameProc) AS k, p.C_Code, LEFT(p.Comment, 110) AS comment
FROM Process p
WHERE p.C_Code IN (SELECT C_Code FROM FACTURE WHERE Fac_Type = 'Q')
  AND (RTRIM(p.NameProc) = 'Y' OR EXISTS (SELECT 1 FROM FACTURE q WHERE q.Fac_Type = 'Q' AND p.Comment LIKE '%' + CAST(q.Fac_Code_C AS varchar(20)) + '%'))
ORDER BY p.ID;

-- @name: E01.3 | All void events in the log (are there voided invoices other than the 4 Q?)
SELECT p.DateProc, p.User_Code, LEFT(p.Comment, 80) AS comment,
       CASE WHEN EXISTS (SELECT 1 FROM FACTURE q WHERE q.Fac_Type = 'Q' AND p.Comment LIKE '%' + CAST(q.Fac_Code_C AS varchar(20)) + '%') THEN 'still Q' ELSE 'NOT Q now' END AS now_state
FROM Process p WHERE p.Comment LIKE N'%ابطال فاکتور%' OR p.Comment LIKE N'%ابطال فاكتور%' ORDER BY p.ID;

-- @name: E01.4 | Voucher lines of Q invoices still posted in the ledger
SELECT l.Sanad_Code, l.Col_Code + l.Moien_Code + l.Tafzili_Code AS acc, l.Bed, l.Bes, l.Type_Line, LEFT(l.Comment_Line, 50) AS line
FROM SND_LIST l WHERE l.Sanad_Code IN (SELECT Sanad_Code FROM FACTURE WHERE Fac_Type = 'Q') ORDER BY l.Sanad_Code, l.[Index];

-- @name: E01.5 | Revenue still booked from Q vouchers (credit to 901)
SELECT SUM(l.Bes) - SUM(l.Bed) AS revenue_from_voided
FROM SND_LIST l WHERE l.Col_Code = '901' AND l.Sanad_Code IN (SELECT Sanad_Code FROM FACTURE WHERE Fac_Type = 'Q');

-- @name: E01.6 | Accounts with balance after closing (should be empty)
SELECT l.Col_Code + l.Moien_Code + l.Tafzili_Code AS acc, SUM(Bed) - SUM(Bes) AS bal
FROM SND_LIST l GROUP BY l.Col_Code + l.Moien_Code + l.Tafzili_Code HAVING ABS(SUM(Bed) - SUM(Bes)) > 0.5;

-- @name: E01.7 | Same, excluding Q vouchers (expected: 0 rows)
SELECT l.Col_Code + l.Moien_Code + l.Tafzili_Code AS acc, SUM(Bed) - SUM(Bes) AS bal
FROM SND_LIST l LEFT JOIN (SELECT DISTINCT Sanad_Code sc FROM FACTURE WHERE Fac_Type = 'Q') q ON q.sc = l.Sanad_Code
WHERE q.sc IS NULL GROUP BY l.Col_Code + l.Moien_Code + l.Tafzili_Code HAVING ABS(SUM(Bed) - SUM(Bes)) > 0.5;

-- @name: E01.8 | Stock: Q lines exist in FACTART but are excluded from Exist (per-article check for the 4 items)
WITH m AS (
  SELECT A_Code,
         SUM(CASE WHEN Fac_Type IN ('K','Y','D') THEN Few_Article WHEN Fac_Type IN ('F','X','Z','S') THEN -Few_Article ELSE 0 END) mv_noQ,
         SUM(CASE WHEN Fac_Type = 'Q' THEN Few_Article ELSE 0 END) q_qty
  FROM FACTART GROUP BY A_Code)
SELECT a.A_Code, a.First_exist, m.mv_noQ, m.q_qty, a.Exist,
       a.First_exist + m.mv_noQ AS formula_noQ, a.First_exist + m.mv_noQ - m.q_qty AS formula_Q_as_sale
FROM ARTICLE a JOIN m ON m.A_Code = a.A_Code WHERE m.q_qty <> 0;

-- @name: E01.9 | Tax system (Moadian) trail: original send (SendType 1) and cancellation (SendType 3)
SELECT t.Fac_Code, t.Fac_Type, t.SendType, t.StateTax, t.FTaxId, t.SerialFact, t.SendDateTax
FROM TaxLog t WHERE t.Fac_Code IN (SELECT Fac_Code FROM FACTURE WHERE Fac_Type = 'Q') ORDER BY t.Fac_Code, t.Id;

-- @name: E01.10 | Holoo code evidence: kardex views exclude Q from invoice movements
SELECT o.name, CASE WHEN m.definition LIKE '%Not in (''S'',''D'',''Q''%' OR m.definition LIKE '%NOT IN (''D'', ''S'' , ''Q''%' THEN 'excludes Q' ELSE '-' END AS q_rule
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id WHERE o.name LIKE 'W_ArtKardex%';
