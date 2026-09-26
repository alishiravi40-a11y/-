# E11_inventory

- DB: `holoo1_1404` — backup SHA-256 `c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2`
- source: `evidence/sql/E11_inventory.sql` (sha1 608d537ec2)

## E11.1 — Quantity formula check (all articles)

| kind | n | formula_ok |
|---|---|---|
| goods | 9596 | 9596 |
| service | 11 | 7 |

_2 row(s)_

## E11.2 — Value roll-forward (goods): opening(item) + purchases + returns-in + transfers-in − cost out = ending

| opening_items | purchases_K | returns_in_Y | transfer_in_D | transfer_out_S | cost_sales_F | cost_X | cost_Z | ending_items |
|---|---|---|---|---|---|---|---|---|
| 117,979,312,380 | 8,046,132,127,550 | 1,081,114,035 | 1,905,339,607,568 | 1,905,339,607,568 | 7,673,785,380,608 | 460,792,642 | 310,499,850 | 466,205,780,507 |

_1 row(s)_

## E11.3 — Service/expense items bought on purchase invoices (value of K lines on 01xxx items)

| A_Code | A_Name | qty | value |
|---|---|---|---|
| 0101003 | خدمات بسته بندي و ارسال سفارش | 3 | 2,780,000 |
| 0101002 | هزينه حمل کالاي خريداري شده | 16 | 28,050,000 |
| 0101011 | کارمزد خريد کالا يا ارائه خدمت | 12 | 2,191,410,856 |

_3 row(s)_

## E11.4 — Opening inventory: item-level vs ledger 106, per warehouse

| M_groupname | qty | value |
|---|---|---|
| انبار 1 مرکزي | 1,330 | 92,781,327,228 |
| دي جي کالا اماني | 340 | 19,527,612,060 |
| انبار الماس شهر | 144 | 15,885,429,439 |
| انبار سبحاني(آفلاين)(فردوسي سابق) | 24 | 3,426,614,369 |
| انبار پارس مموري | 44 | 830,711,945 |
| ديجي کالا/فروش | 15 | 166,299,954 |

_6 row(s)_

## E11.5 — The 6-unit item that explains the opening-inventory swing

| A_Code | A_Name | First_exist | FirstBuy_Price | value | Exist | Buy_Price | movement_lines |
|---|---|---|---|---|---|---|---|
| 0201623 | IP16 Pro Max /1TB/NotActive | 6 | 1,711,066,392 | 10,266,398,349 | 6 | 1,711,066,392 | 0 |

_1 row(s)_

## E11.6 — Items with stored Buy_Price differing from last purchase direction (Buy_Price <= 0 with stock)

| items_in_stock | zero_cost_in_stock |
|---|---|
| 211 | 0 |

_1 row(s)_

## E11.7 — Transfer pairs: value out (S at source cost) vs value in (D line cost)

| pairs | value_out | value_in | unit_cost_differs |
|---|---|---|---|
| 3717 | 1,905,339,607,568 | 1,905,339,607,568 | 0 |

_1 row(s)_

## E11.8 — Items with NEGATIVE opening quantity carried from the previous year

| A_Code | A_Name | First_exist | FirstBuy_Price | value |
|---|---|---|---|---|
| 0201597 | سامسونگ/A16/128G/Ram4 | -38 | 105,280,000 | -4,000,640,000 |
| 0201560 | شيائومي/Redmi13/256G/Ram8 | -25 | 113,660,000 | -2,841,500,000 |
| 0201512 | شيائومي/Note13/256G/Ram8 | -18 | 125,130,000 | -2,252,340,000 |
| 0304429 | سامسونگ/S24 Ultra/256G/Ram12/5G | -2 | 772,000,000 | -1,544,000,000 |
| 0201532 | شيائومي/Redmi A3/128G/Ram4 | -19 | 60,880,000 | -1,156,720,000 |
| 0201574 | سامسونگ/A06/64G/Ram4 | -18 | 63,750,000 | -1,147,500,000 |
| 0201506 | سامسونگ/A25/256G/Ram8 | -4 | 168,230,000 | -672,920,000 |
| 0201518 | شيائومي/Note13 pro /256G/Ram8 | -2 | 185,000,000 | -370,000,000 |
| 0304455 | سامسونگ/A55 5G /128G/RAM8 | -1 | 247,724,248 | -247,724,248 |
| 0201580 | سامسونگ/A06/128G/Ram6 | -2 | 85,779,184 | -171,558,368 |
| 0201599 | سامسونگ/A16/256G/Ram8 | -1 | 143,830,000 | -143,830,000 |
| 0201584 | شيائومي/Poco C75/256G/Ram8 | -1 | 89,950,000 | -89,950,000 |

_12 row(s)_

## E11.9 — Historical negative stock: end-of-day balance < 0 (goods)

| items | item_days | worst |
|---|---|---|
| 64 | 99 | -44 |

_1 row(s)_

## E11.10 — Sale lines with zero stored cost (cost understatement in line-level margins)

| lines | qty | approx_cost_at_final_avg | revenue |
|---|---|---|---|
| 101 | 114 | 28,392,946,143 | 24,993,970,000 |

_1 row(s)_
