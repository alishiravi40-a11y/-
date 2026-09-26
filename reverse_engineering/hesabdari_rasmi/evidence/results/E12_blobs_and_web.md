# E12_blobs_and_web

- Silver: holoo_reader import of backup SHA-256 `c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2`
- source: `evidence/py/E12_blobs_and_web.py`

## E12.1 — Decoded blobs and payloads

| snapshot_rows | events_with_snapshot | web_payloads | malformed_json_recovered | web_lines |
|---|---|---|---|---|
| 161163 | 46181 | 21012 | 31 | 44464 |

_1 row(s)_

## E12.2 — Snapshot semantics: last snapshot of each voucher vs current voucher lines (after-image test)

| vouchers_compared | last_snapshot_equals_current |
|---|---|
| 21762 | 21158 |

_1 row(s)_

## E12.3 — Vouchers in the log that are absent from this database, by document year

| doc_year | vouchers | kinds |
|---|---|---|
| 1402 | 14 | ['delete', 'edit'] |
| 1403 | 10736 | ['login', 'delete', 'reprint', 'edit', 'add'] |
| 1404 | 1015 | ['edit', 'delete', 'add'] |

_3 row(s)_

## E12.4 — Absent 1403 vouchers: when were they touched (log month) and how

| log_month | vouchers |
|---|---|
| 2025-03 | 269 |
| 2025-04 | 120 |
| 2025-05 | 59 |
| 2025-06 | 37 |
| 2025-07 | 36 |
| 2025-08 | 4745 |
| 2025-09 | 5358 |
| 2025-10 | 3 |
| 2025-11 | 88 |
| 2025-12 | 2 |
| 2026-01 | 11 |
| 2026-02 | 2 |
| 2026-03 | 20 |

_13 row(s)_

## E12.5 — Web sales posted with a previous-fiscal-year date (payload date < 2025-03-21) and their fate

| fate | n | amount | min_web_date | max_web_date | posted_from | posted_to |
|---|---|---|---|---|---|---|
| removed from FY1404 | 130 | 27,867,500,000 | 2025-03-18 | 2025-03-20 | 2025-03-25 | 2025-03-26 |
| kept in FY1404 (re-dated 2025-03-21) | 1 | 398,440,000 | 2025-03-20 | 2025-03-20 | 2025-03-25 | 2025-03-25 |

_2 row(s)_

## E12.6 — Invoice date vs web sale date (posted invoices)

| invoice_minus_web_days | n |
|---|---|
| -10 | 1 |
| -4 | 2 |
| -3 | 3 |
| -2 | 4 |
| -1 | 189 |
| 0 | 20486 |
| 1 | 39 |
| 6 | 1 |

_8 row(s)_

## E12.7 — Invoice amount vs web amount, and whether the invoice was edited in Holoo afterwards

| kind | invoices | amount_differs | differs_and_edited_in_holoo | net_difference |
|---|---|---|---|---|
| purchase | 924 | 697 | 673 | -46,470,936,783 |
| sale | 19798 | 110 | 109 | -17,673,011,000 |

_2 row(s)_

## E12.8 — Web payment instrument vs Holoo settlement (sales)

| web_mode | n | holoo_card | holoo_credit | holoo_cheque |
|---|---|---|---|---|
| web: bank only | 13320 | 13229 | 265 | 1 |
| web: credit only | 4193 | 30 | 4178 | 4 |
| web: mixed/zero | 2218 | 2193 | 2158 | 60 |
| web: cash | 67 | 52 | 51 | 1 |

_4 row(s)_

## E12.9 — ErpCode identity: web product/customer codes map 1:1 to Holoo codes (learned from unedited invoices)

| web_codes | mapped_to_one_holoo_item |
|---|---|
| 449 | 449 |

_1 row(s)_

## E12.10 — Deleted sales invoices recoverable from before-images (DF events)

| deleted_invoice_events | snapshot_rows | line_value |
|---|---|---|
| 157 | 198 | 56,193,686,000 |

_1 row(s)_

