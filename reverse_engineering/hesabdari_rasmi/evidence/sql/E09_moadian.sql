-- E09 — Tax system (Moadian) submissions

-- @name: E09.1 | Sales invoices by StateTax
SELECT Fac_Type, StateTax, COUNT(*) n, SUM(Sum_Price) amount FROM FACTURE WHERE Fac_Type IN ('F','Q','Y','K','X') GROUP BY Fac_Type, StateTax ORDER BY 1, 2;

-- @name: E09.2 | TaxLog by SendType / StateTax
SELECT SendType, StateTax, COUNT(*) n, COUNT(DISTINCT Fac_Code) invoices, MIN(SendDateTax) first_, MAX(SendDateTax) last_ FROM TaxLog GROUP BY SendType, StateTax ORDER BY 1, 2;

-- @name: E09.3 | Sales invoices with no TaxLog row at all
SELECT f.StateTax, COUNT(*) n, SUM(f.Sum_Price) amount, MIN(f.Fac_Date) mn, MAX(f.Fac_Date) mx
FROM FACTURE f WHERE f.Fac_Type = 'F' AND NOT EXISTS (SELECT 1 FROM TaxLog t WHERE t.Fac_Code = f.Fac_Code) GROUP BY f.StateTax;

-- @name: E09.4 | Unsent/failed (StateTax=0) sales invoices by month and payment mode
SELECT LEFT(CONVERT(varchar, Fac_Date, 23), 7) m, COUNT(*) n, SUM(Sum_Price) amount, SUM(Card) card, SUM(FNesieh) credit
FROM FACTURE WHERE Fac_Type = 'F' AND StateTax = 0 GROUP BY LEFT(CONVERT(varchar, Fac_Date, 23), 7) ORDER BY 1;

-- @name: E09.5 | Error text samples for unsent/failed
SELECT TOP 15 Fac_Code_C, Fac_Date, Sum_Price, LEFT(ErrorTax, 120) err FROM FACTURE WHERE Fac_Type = 'F' AND StateTax = 0 AND ISNULL(ErrorTax,'') <> '' ORDER BY Fac_Date;

-- @name: E09.6 | Tax id uniqueness and resends
SELECT (SELECT COUNT(*) FROM (SELECT FTaxId FROM FACTURE WHERE ISNULL(FTaxId,'') <> '' GROUP BY FTaxId HAVING COUNT(*) > 1) x) dup_taxid_in_facture,
       (SELECT COUNT(*) FROM (SELECT Fac_Code FROM TaxLog GROUP BY Fac_Code HAVING COUNT(*) > 1) x) invoices_sent_more_than_once,
       (SELECT COUNT(*) FROM FACTURE WHERE Fac_Type = 'F' AND StateTax = 2 AND ISNULL(FTaxId,'') = '') accepted_without_taxid;

-- @name: E09.7 | Purchases: VAT and tax fields
SELECT COUNT(*) purchase_invoices, SUM(CASE WHEN ISNULL(Sum_Levy,0) + ISNULL(Sum_Scot,0) <> 0 THEN 1 ELSE 0 END) with_vat,
       SUM(CASE WHEN ISNULL(FTaxId,'') <> '' THEN 1 ELSE 0 END) with_taxid FROM FACTURE WHERE Fac_Type = 'K';

-- @name: E09.8 | VAT-related settings and item tax flags
SELECT (SELECT COUNT(*) FROM ARTICLE WHERE ISNULL(Levy,0) <> 0 OR ISNULL(scot,0) <> 0) items_with_vat_rate,
       (SELECT COUNT(*) FROM ARTICLE WHERE Include_Tax = 1) items_include_tax,
       (SELECT COUNT(*) FROM ARTICLE WHERE ISNULL(A_codeIdTax,'') <> '') items_with_tax_id,
       (SELECT COUNT(*) FROM FACTART WHERE ISNULL(Levy,0) + ISNULL(Scot,0) <> 0) lines_with_vat;
