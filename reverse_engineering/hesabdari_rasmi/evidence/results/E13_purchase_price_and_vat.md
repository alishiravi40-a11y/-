# E13_purchase_price_and_vat

- DB: `holoo1_1404` — backup SHA-256 `c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2`
- source: `evidence/sql/E13_purchase_price_and_vat.sql` (sha1 825ae3f1de)

## E13.1 — Holoo settings relevant to below-cost control and VAT (MSETUP2)

| Name | Boolean | Double | String |
|---|---|---|---|
| AcceptLesPrice | False | NULL | NULL |
| CalcSoodInForooshEndBuyPrice | True | NULL | NULL |
| CheckBuyPriceAlart | False | NULL | NULL |
| Darsad_Avarez | NULL | NULL | 3 |
| Darsad_Maliat | False | 3 | NULL |
| VAT | True | NULL | NULL |

_6 row(s)_

## E13.2 — Purchase-price fields stored on each goods sale line (F): moving average vs last purchase

| sale_lines | with_moving_average_Buy_Price | with_last_purchase_EndBuy_PriceK | without_last_purchase | with_EndBuy_Price_nonzero |
|---|---|---|---|---|
| 29841 | 29740 | 24894 | 4947 | 0 |

_1 row(s)_

## E13.3 — EndBuy_PriceK = last purchase price of the same item on/before the sale date (tolerance 2 rials: Holoo splits a purchase line into rows differing by 1 rial)

| lines_with_last_purchase | equals_last_purchase_same_item | no_purchase_this_year_before_sale |
|---|---|---|
| 24894 | 21373 | 2983 |

_1 row(s)_

## E13.3b — Same test at model level (item name across all warehouses; items are duplicated per warehouse)

| lines_with_last_purchase | equals_last_purchase_of_model | no_purchase_of_model_this_year_before_sale |
|---|---|---|
| 24894 | 21344 | 323 |

_1 row(s)_

## E13.4 — Below-cost sale lines under each candidate definition of "purchase price" (D-11 impact)

| lines | below_moving_average | shortfall_moving_average | below_last_purchase | shortfall_last_purchase | below_either | below_both |
|---|---|---|---|---|---|---|
| 29841 | 8078 | 77,252,040,851 | 7001 | 70,373,097,460 | 9562 | 5517 |

_1 row(s)_

## E13.5 — ARTICLE.EndBuy_Price vs the item's actual last purchase in the year (reliability of the item-level field)

| items_purchased | article_EndBuy_equals_last_purchase |
|---|---|
| 233 | 124 |

_1 row(s)_

## E13.6 — VAT/levy amounts on invoice headers and lines, per invoice type

| Fac_Type | invoices | DMaliat | Sum_Levy | Sum_Scot | IsLevyAndScot | line_levy_scot |
|---|---|---|---|---|---|---|
| D | 482 | 0 | 0 | 0 | 0 | 0 |
| F | 19877 | 0 | 0 | 0 | 0 | 0 |
| K | 942 | 0 | 0 | 0 | 0 | 0 |
| Q | 4 | 0 | 0 | 0 | 0 | 0 |
| S | 482 | 0 | 0 | 0 | 0 | 0 |
| X | 1 | 0 | 0 | 0 | 0 | 0 |
| Y | 5 | 0 | 0 | 0 | 0 | 0 |
| Z | 3 | 0 | 0 | 0 | 0 | 0 |

_8 row(s)_

## E13.7 — Postings to VAT accounts (visible ledger lines, Show_Daftar = 1)

| acc | lines | debit | credit |
|---|---|---|---|
| 1070001 | 0 | 0 | 0 |
| 1070002 | 0 | 0 | 0 |
| 4030001 | 0 | 0 | 0 |
| 4030002 | 0 | 0 | 0 |
| 6010056 | 0 | 0 | 0 |
| 6010057 | 0 | 0 | 0 |

_6 row(s)_
