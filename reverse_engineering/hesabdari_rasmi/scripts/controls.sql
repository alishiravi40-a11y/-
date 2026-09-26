-- کنترل‌ها و شواهد اصلی گزارش مهندسی معکوس «حسابداری رسمی الماس شهر»
-- اجرا روی نسخه Restoreشده دیتابیس holoo1_1404 (فقط خواندنی؛ هیچ داده‌ای تغییر نمی‌کند)
-- شماره‌های [C-xx] با بخش «کنترل‌های حسابداری» گزارش هماهنگ است.

USE holoo1_1404;

-- [C-01] توازن هر سند (باید صفر ردیف برگرداند)
SELECT Sanad_Code, SUM(ISNULL(Bed,0)) - SUM(ISNULL(Bes,0)) AS diff
FROM SND_LIST GROUP BY Sanad_Code
HAVING ABS(SUM(ISNULL(Bed,0)) - SUM(ISNULL(Bes,0))) > 0.5;

-- [C-02] سند بدون ردیف / ردیف بدون سند / ردیف با حساب نامعتبر
SELECT COUNT(*) FROM SANAD s WHERE NOT EXISTS (SELECT 1 FROM SND_LIST l WHERE l.Sanad_Code = s.Sanad_Code);
SELECT COUNT(*) FROM SND_LIST l WHERE NOT EXISTS (SELECT 1 FROM SANAD s WHERE s.Sanad_Code = l.Sanad_Code);
SELECT COUNT(*) FROM SND_LIST l WHERE NOT EXISTS (SELECT 1 FROM SARFASL f WHERE f.Sarfasl_Code = l.Col_Code + l.Moien_Code + l.Tafzili_Code);

-- [C-03] شماره‌های عطف (Sanad_Code_C) مفقود
WITH n AS (SELECT TOP (47449) ROW_NUMBER() OVER (ORDER BY (SELECT 1)) AS n FROM SND_LIST)
SELECT n FROM n WHERE NOT EXISTS (SELECT 1 FROM SANAD s WHERE s.Sanad_Code_C = n.n);

-- [C-04] ترتیب تاریخی شماره اسناد (باید صفر باشد)
SELECT COUNT(*) FROM (SELECT Sanad_Date, LAG(Sanad_Date) OVER (ORDER BY Sanad_Code_C) pd FROM SANAD) x WHERE Sanad_Date < pd;

-- [C-05] مانده حساب‌ها پس از سند اختتامیه (باید صفر باشد؛ ۴ حساب باقی می‌ماند)
SELECT l.Col_Code + l.Moien_Code + l.Tafzili_Code AS acc, SUM(Bed) - SUM(Bes) AS bal
FROM SND_LIST l GROUP BY l.Col_Code + l.Moien_Code + l.Tafzili_Code
HAVING ABS(SUM(Bed) - SUM(Bes)) > 0.5;

-- [C-06] همان کنترل با حذف اسناد فاکتورهای نوع Q (نتیجه: صفر ردیف)
SELECT l.Col_Code + l.Moien_Code + l.Tafzili_Code AS acc, SUM(Bed) - SUM(Bes) AS bal
FROM SND_LIST l LEFT JOIN (SELECT DISTINCT Sanad_Code sc FROM FACTURE WHERE Fac_Type = 'Q') q ON q.sc = l.Sanad_Code
WHERE q.sc IS NULL
GROUP BY l.Col_Code + l.Moien_Code + l.Tafzili_Code HAVING ABS(SUM(Bed) - SUM(Bes)) > 0.5;

-- [C-07] فرمول موجودی: Exist = First_exist + K + Y + D - F - X - Z - S  (Q اثر انباری ندارد)
WITH m AS (
  SELECT A_Code, SUM(CASE Fac_Type WHEN 'K' THEN Few_Article WHEN 'Y' THEN Few_Article WHEN 'D' THEN Few_Article
                                   WHEN 'F' THEN -Few_Article WHEN 'X' THEN -Few_Article WHEN 'Z' THEN -Few_Article
                                   WHEN 'S' THEN -Few_Article ELSE 0 END) mv
  FROM FACTART GROUP BY A_Code)
SELECT a.A_Code, a.First_exist, m.mv, a.Exist
FROM ARTICLE a LEFT JOIN m ON m.A_Code = a.A_Code
WHERE ABS(ISNULL(a.First_exist,0) + ISNULL(m.mv,0) - ISNULL(a.Exist,0)) >= 0.001;

-- [C-08] ارزش موجودی پایان دوره = Σ(Exist × Buy_Price) و مقایسه با حساب 105
SELECT SUM(Exist * Buy_Price) FROM ARTICLE;
SELECT SUM(Bed) FROM SND_LIST WHERE Sanad_Code = 371083 AND Col_Code = '105';

-- [C-09] جمع ردیف‌ها = جمع فاکتور ؛ جمع روش‌های تسویه = جمع فاکتور ؛ مبلغ سند = مبلغ فاکتور
SELECT f.Fac_Type, COUNT(*) n,
       SUM(CASE WHEN ABS(x.s - f.Sum_Price + ISNULL(f.Takhfif,0)) > 1 THEN 1 ELSE 0 END) mismatch
FROM FACTURE f JOIN (SELECT Fac_Code, Fac_Type, SUM(Few_Article*Price_BS - ISNULL(TakhfifSatriR,0)) s FROM FACTART GROUP BY Fac_Code, Fac_Type) x
  ON x.Fac_Code = f.Fac_Code AND x.Fac_Type = f.Fac_Type
GROUP BY f.Fac_Type;
SELECT COUNT(*) FROM FACTURE WHERE Fac_Type IN ('F','Q')
  AND ABS(ISNULL(FNaghd,0)+ISNULL(FCheck,0)+ISNULL(FNesieh,0)+ISNULL(Card,0)+ISNULL(FHaval,0)+ISNULL(FBon,0)-Sum_Price) > 1;
SELECT f.Fac_Type, SUM(CASE WHEN ABS(ISNULL(l.amt,0) - f.Sum_Price) > 1 THEN 1 ELSE 0 END)
FROM FACTURE f LEFT JOIN (SELECT Sanad_Code, SUM(Bed + Bes) amt FROM SND_LIST WHERE Type_Line = 'F' GROUP BY Sanad_Code) l ON l.Sanad_Code = f.Sanad_Code
WHERE f.Fac_Type IN ('F','K','Q','X','Y') GROUP BY f.Fac_Type;

-- [C-10] فروش زیر بهای تمام‌شده (میانگین موزون ثبت‌شده در ردیف)
SELECT COUNT(*) lines, SUM(CASE WHEN Price_BS < Buy_Price THEN 1 ELSE 0 END) below_cost,
       SUM(CASE WHEN Price_BS < Buy_Price THEN (Buy_Price - Price_BS) * Few_Article ELSE 0 END) loss
FROM FACTART WHERE Fac_Type = 'F' AND LEFT(A_Code,2) <> '01';

-- [C-11] ویرایش پس از پایان سال مالی (Endeditdate / DateUser)
SELECT LEFT(CONVERT(varchar, Endeditdate, 23), 7) m, COUNT(*) FROM SANAD WHERE Endeditdate > '2026-03-20' GROUP BY LEFT(CONVERT(varchar, Endeditdate, 23), 7);
SELECT Fac_Type, COUNT(*), SUM(Sum_Price) FROM FACTURE WHERE TRY_CONVERT(date, REPLACE(DateUser,'/','-')) > '2026-03-20' GROUP BY Fac_Type;

-- [C-12] پیوستگی Log (Process): شکاف زمانی 2026/03/20 تا 2026/09/08 بدون شکاف ID
SELECT MIN(ID), MAX(ID), DateProc, COUNT(*) FROM Process WHERE ID >= 670000 GROUP BY DateProc ORDER BY MIN(ID);

-- [C-13] نسخه‌های سند افتتاحیه
SELECT e.id, s.UserCodeInc, s.Endeditdate, COUNT(*) lines, SUM(e.Bed) bed
FROM snd_list_Edit e JOIN Sanad_Edit s ON s.Id = e.id GROUP BY e.id, s.UserCodeInc, s.Endeditdate ORDER BY e.id;

-- [C-14] مانده کش‌شده SARFASL.Mandeh در برابر دفتر (بدون اسناد بستن/اختتامیه)
WITH b AS (SELECT Col_Code+Moien_Code+Tafzili_Code acc, SUM(Bed)-SUM(Bes) bal FROM SND_LIST WHERE Sanad_Code NOT IN (371083,371084) GROUP BY Col_Code+Moien_Code+Tafzili_Code)
SELECT s.Sarfasl_Code, s.Mandeh, b.bal FROM SARFASL s LEFT JOIN b ON b.acc = s.Sarfasl_Code
WHERE ABS(ISNULL(b.bal,0) - ISNULL(s.Mandeh,0)) >= 1 AND NOT EXISTS (SELECT 1 FROM SARFASL c WHERE c.Parent = s.ID);

-- [C-15] مسیر وضعیت چک‌ها
SELECT Check_Code, STRING_AGG(State, '>') WITHIN GROUP (ORDER BY Date_Time, Id) AS path
FROM Check_Event GROUP BY Check_Code;
