# E06_cogs_profit

- DB: `holoo1_1404` — backup SHA-256 `c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2`
- source: `evidence/sql/E06_cogs_profit.sql` (sha1 6b96efb31e)

## E06.1 — Temporary-account balances before closing (state 0/1 vouchers only)

| Col_Code | name | balance |
|---|---|---|
| 106 | موجودي اول دوره انبار | 117,979,382,380 |
| 601 | هزينه هاي عملياتي | 122,316,447,397 |
| 602 | هزينه هاي غير عملياتي | 49,723,977,543 |
| 702 | درآمدهاي غير عملياتي | -233,048,742 |
| 801 | خريد | 8,048,192,777,349 |
| 802 | برگشت از خريد | -475,058,680 |
| 803 | تخفيفات نقدي خريد | -207,125,483 |
| 901 | درآمد عملياتي | -7,875,445,781,360 |
| 902 | برگشت از فروش | 1,101,720,000 |
| 903 | تخفيفات نقدي فروش | 120,887,858 |

_10 row(s)_

## E06.2 — Periodic COGS = opening inventory + net purchases − ending inventory (ending = Σ Exist×Buy_Price)

| opening | purchases | purchase_returns | purchase_discounts | ending_from_articles | cogs_periodic | cogs_in_closing_voucher_net_zero_check |
|---|---|---|---|---|---|---|
| 117,979,382,380 | 8,048,192,777,349 | -475,058,680 | -207,125,483 | 466,205,850,507 | 7,699,284,125,059 | 0 |

_1 row(s)_

## E06.3 — Perpetual view: Σ(sale qty × moving-average cost stored on each line), by invoice type

| Fac_Type | cost | sales_value |
|---|---|---|
| X | 460,792,642 | 475,058,599 |
| F | 7,673,785,380,608 | 7,875,645,192,360 |
| Q | 593,212,197 | 582,000,000 |
| Z | 311,591,850 | 311,591,850 |
| Y | 1,081,114,035 | 1,101,720,000 |

_5 row(s)_

## E06.4 — Profit and loss recomputed from ledger (before closing)

| net_sales | other_income | operating_expenses | non_operating_expenses |
|---|---|---|---|
| 7,874,223,173,502 | 233,048,742 | 122,316,447,397 | 49,723,977,543 |

_1 row(s)_

## E06.5 — Net sales: ledger view vs raw (difference = hidden voided-invoice lines)

| net_901_ledger | net_901_raw |
|---|---|
| 7,875,445,781,360 | 7,876,027,781,360 |

_1 row(s)_

## E06.6 — Profit booked by the closing voucher into 5020003

| profit_closed |
|---|
| 3,131,672,245 |

_1 row(s)_

## E06.7 — Revenue lines of sales vouchers not equal to invoice amount (split to other income, e.g. shipping 702)

| acc | n | amount |
|---|---|---|
| 9010001 | 19881 | 7,876,027,781,360 |
| 7020005 | 205 | 199,411,000 |
| 6010006 | 3 | -311,591,850 |
| 8010001 | 3 | 311,591,850 |
| 8020001 | 1 | 475,058,599 |

_5 row(s)_
