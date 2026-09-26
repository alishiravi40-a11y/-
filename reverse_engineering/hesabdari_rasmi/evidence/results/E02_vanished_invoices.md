# E02_vanished_invoices

- DB: `holoo1_1404` — backup SHA-256 `c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2`
- source: `evidence/sql/E02_vanished_invoices.sql` (sha1 763265012c)

## E02.1 — Display number range and gaps per type

| Fac_Type | mn | mx | n | gaps |
|---|---|---|---|---|
| K | 4856 | 5869 | 942 | 72 |
| X | 5 | 5 | 1 | 0 |
| S | 4581 | 5115 | 482 | 53 |
| D | 4581 | 5115 | 482 | 53 |
| F | 90440346 | 90461550 | 19877 | 1328 |
| Q | 90440859 | 90458180 | 4 | 17318 |
| Z | 2 | 4 | 3 | 0 |
| Y | 244 | 250 | 5 | 2 |

_8 row(s)_

## E02.2 — Internal code (Fac_Code) range for F+Q (shared counter) and gaps

| mn | mx | n | gaps |
|---|---|---|---|
| 107382 | 128589 | 19881 | 1327 |

_1 row(s)_

## E02.3 — Log classification of missing display numbers (created/edited/deleted events)

| class | n |
|---|---|
| created, then vanished without delete log | 131 |
| deleted (logged) | 151 |
| no log trace | 1042 |

_3 row(s)_

## E02.4 — Vanished-without-delete-log invoices: creation date, user, channel

| month | User_Code | channel | n |
|---|---|---|---|
| 2026/03 | 3 | web-service | 1 |
| 2025/04 | 11 | ui | 1 |
| 2025/03 | 3 | web-service | 130 |

_3 row(s)_

## E02.5 — Fixed voucher numbers cited in those creation logs no longer exist in SANAD

| logged_creations_missing | voucher_still_exists |
|---|---|
| 132 | 0 |

_1 row(s)_

## E02.6 — Tax serial continuity (serials in TaxLog ∪ FACTURE, 1404 range)

| mn | mx_1404 | used | gaps |
|---|---|---|---|
| 0 | 27359 | 19891 | 7469 |

_1 row(s)_

## E02.7 — TaxLog rows pointing to non-existent invoices (sent then removed)

| Fac_Code | Fac_Type | SendType | StateTax | SendDateTax |
|---|---|---|---|---|

_0 row(s)_

## E02.8 — Deletions of sales invoices by user and month

| User_Code | m | n |
|---|---|---|
| 2 | 2025/04 | 2 |
| 2 | 2025/05 | 1 |
| 2 | 2025/07 | 1 |
| 2 | 2025/10 | 1 |
| 2 | 2026/01 | 1 |
| 10 | 2025/03 | 1 |
| 10 | 2025/04 | 4 |
| 10 | 2025/05 | 10 |
| 10 | 2025/06 | 14 |
| 10 | 2025/07 | 20 |
| 10 | 2025/08 | 8 |
| 10 | 2025/09 | 6 |
| 10 | 2025/10 | 9 |
| 10 | 2025/11 | 6 |
| 10 | 2025/12 | 33 |
| 10 | 2026/01 | 6 |
| 10 | 2026/02 | 6 |
| 10 | 2026/03 | 1 |
| 11 | 2025/05 | 3 |
| 11 | 2025/07 | 1 |
| 11 | 2025/08 | 1 |
| 11 | 2025/11 | 1 |
| 11 | 2025/12 | 3 |
| 11 | 2026/01 | 2 |
| 11 | 2026/02 | 2 |
| 11 | 2026/03 | 2 |
| 12 | 2025/03 | 1 |
| 12 | 2025/05 | 1 |
| 12 | 2025/10 | 1 |
| 14 | 2025/04 | 1 |
| 14 | 2025/05 | 2 |
| 14 | 2025/06 | 1 |
| 14 | 2025/07 | 1 |
| 14 | 2025/12 | 1 |
| 14 | 2026/03 | 1 |
| 16 | 2026/02 | 1 |
| 16 | 2026/03 | 1 |

_37 row(s)_

## E02.9 — Existence of a helper procedure that moves invoices between years

| name | create_date | modify_date |
|---|---|---|
| MoveFactureCustomerExist | 2026-09-08 11:13:04 | 2026-09-08 11:13:04 |

_1 row(s)_
