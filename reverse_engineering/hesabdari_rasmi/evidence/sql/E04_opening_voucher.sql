-- E04 — Opening voucher (Sanad_Code=1) versions after year end

-- @name: E04.1 | Versions kept in Sanad_Edit/snd_list_Edit + current
SELECT CAST(e.id AS varchar(5)) AS version, s.UserCodeInc, s.Endeditdate, COUNT(*) lines, SUM(e.Bed) total
FROM snd_list_Edit e JOIN Sanad_Edit s ON s.Id = e.id GROUP BY e.id, s.UserCodeInc, s.Endeditdate
UNION ALL SELECT 'current', (SELECT UserCodeInc FROM SANAD WHERE Sanad_Code = 1), (SELECT Endeditdate FROM SANAD WHERE Sanad_Code = 1), COUNT(*), SUM(Bed)
FROM SND_LIST WHERE Sanad_Code = 1;

-- @name: E04.2 | Net change per top-level account: version 1 → current
WITH v1 AS (SELECT Col_Code, SUM(Bed) - SUM(Bes) b FROM snd_list_Edit WHERE id = 1 GROUP BY Col_Code),
cur AS (SELECT Col_Code, SUM(Bed) - SUM(Bes) b FROM SND_LIST WHERE Sanad_Code = 1 GROUP BY Col_Code)
SELECT COALESCE(v1.Col_Code, cur.Col_Code) col, ISNULL(v1.b, 0) v1_balance, ISNULL(cur.b, 0) current_balance, ISNULL(cur.b, 0) - ISNULL(v1.b, 0) change
FROM v1 FULL JOIN cur ON cur.Col_Code = v1.Col_Code
WHERE ABS(ISNULL(cur.b, 0) - ISNULL(v1.b, 0)) > 0.5 ORDER BY ABS(ISNULL(cur.b, 0) - ISNULL(v1.b, 0)) DESC;

-- @name: E04.3 | Opening inventory (106) per version
SELECT CAST(id AS varchar(5)) version, SUM(Bed) - SUM(Bes) inv106 FROM snd_list_Edit WHERE Col_Code = '106' GROUP BY id
UNION ALL SELECT 'current', SUM(Bed) - SUM(Bes) FROM SND_LIST WHERE Sanad_Code = 1 AND Col_Code = '106';

-- @name: E04.4 | Opening inventory value implied by ARTICLE (Σ First_exist × FirstBuy_Price, excluding service items)
SELECT SUM(First_exist * FirstBuy_Price) implied_opening_value, COUNT(*) items_with_opening_qty
FROM ARTICLE WHERE First_exist > 0 AND LEFT(A_Code, 2) <> '01';

-- @name: E04.5 | Log entries mentioning the opening balance
SELECT DateProc, User_Code, LEFT(Comment, 100) comment FROM Process
WHERE Comment LIKE N'%افتتاح%' OR Comment LIKE N'%اول دوره%' ORDER BY ID;
