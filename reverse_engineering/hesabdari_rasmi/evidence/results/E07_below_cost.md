# E07_below_cost

- DB: `holoo1_1404` — backup SHA-256 `c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2`
- source: `evidence/sql/E07_below_cost.sql` (sha1 ce1e376777)

## E07.1 — Sales lines vs stored moving-average cost (goods only)

| lines | below_cost | shortfall | below_cost_by_more_than_1pct | shortfall_gt1pct | zero_cost_lines |
|---|---|---|---|---|---|
| 29841 | 8078 | 77,252,040,851 | 5765 | 74,252,797,796 | 101 |

_1 row(s)_

## E07.2 — Below-cost lines by warehouse (main group)

| M_groupname | lines | below | revenue | cost |
|---|---|---|---|---|
| انبار 1 مرکزي | 22219 | 6669 | 6,110,158,154,600 | 6,002,871,932,322 |
| انبار الماس شهر | 7226 | 1328 | 1,635,838,685,000 | 1,556,547,031,970 |
| انبار سبحاني(آفلاين)(فردوسي سابق) | 152 | 29 | 62,208,480,000 | 60,244,212,027 |
| انبار پارس مموري | 212 | 20 | 42,048,350,000 | 34,594,592,229 |
| دي جي کالا اماني | 32 | 32 | 19,332,335,760 | 19,527,612,060 |

_5 row(s)_

## E07.3 — Below-cost lines by entering user (FACTURE.UserCode)

| UserCode | lines | below | shortfall |
|---|---|---|---|
| 3 | 27848 | 7601 | 71,095,586,179 |
| 11 | 1142 | 230 | 2,394,523,726 |
| 10 | 575 | 186 | 2,918,846,538 |
| 12 | 222 | 45 | 742,943,583 |
| 16 | 35 | 11 | 49,616,676 |
| 2 | 17 | 5 | 50,524,150 |
| 14 | 2 | 0 | 0 |

_7 row(s)_

## E07.4 — Below-cost against the latest purchase price before the sale date (independent of average)

| lines | no_prior_purchase | below_last_purchase | shortfall_vs_last_purchase |
|---|---|---|---|
| 29841 | 395 | 8100 | 78,096,001,107 |

_1 row(s)_
