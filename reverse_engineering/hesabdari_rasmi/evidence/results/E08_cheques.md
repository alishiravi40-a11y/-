# E08_cheques

- DB: `holoo1_1404` — backup SHA-256 `c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2`
- source: `evidence/sql/E08_cheques.sql` (sha1 509c5bc2c3)

## E08.1 — Current state of each cheque (last event) with amount

| received | State | n | amount |
|---|---|---|---|
| True | V | 9786 | 637,168,530,800 |
| True | D | 1094 | 66,415,967,400 |
| True | B | 719 | 61,150,972,000 |
| True | J | 598 | 36,720,445,400 |
| True | M | 140 | 8,338,050,000 |
| True | R | 7 | 407,580,000 |
| True | S | 2 | 98,600,000 |
| False | V | 85 | 316,677,223,310 |
| False | O | 72 | 85,381,130,000 |
| False | P | 12 | 86,800,000,000 |

_10 row(s)_

## E08.2 — Ledger balance of receivable-cheque accounts (104) at year end (before closing), per moein

| moein | name | balance |
|---|---|---|
| 1040001 | اسناد دريافتني نزد صندوق | 75,060,197,400 |
| 1040002 | اسناد در جريان وصول نزد بانک | 26,906,816,800 |
| 1040003 | اسناد دريافتني نزد صندوق خريد دين | 9,813,628,600 |

_3 row(s)_

## E08.3 — Received cheques in hand (D,S,M,R) vs 104-0001 (cash) ; in collection (J) vs 104-0002

| in_hand_subsystem | in_hand_ledger | in_collection_subsystem | in_collection_ledger |
|---|---|---|---|
| 75,260,197,400 | 75,060,197,400 | 36,720,445,400 | 26,906,816,800 |

_1 row(s)_

## E08.4 — Issued cheques open (P) vs ledger 402

| open_issued_subsystem | open_issued_ledger |
|---|---|
| 86,800,000,000 | 86,800,000,000 |

_1 row(s)_

## E08.5 — Per-cashbox reconciliation (Cash.Sarfasl_Code2 = cheque account of the cashbox)

| Id | S_Name | Sarfasl_Code2 | subsystem | ledger |
|---|---|---|---|---|
| 9 | صندوق خريد دين | 10400010004 | 12,421,450,000 | 12,421,450,000 |
| 7 | صندوق الماس شهر | 10400010002 | NULL | 0 |
| 8 | صندوق پارس مموري | 10400010003 | NULL | NULL |
| 3 | صندوق | 10400010001 | 58,427,687,400 | 58,227,687,400 |
| 10 | صندوق چک هاي برگشتي نزد فروشگاه | 10400010005 | 4,411,060,000 | 4,411,060,000 |

_5 row(s)_

## E08.6 — Flag consistency: Check flags vs last event

| State | Vosool | DarJaryan | Sel_check | Bargashty | n |
|---|---|---|---|---|---|
| B | True | False | False | True | 719 |
| D | False | True | False | False | 771 |
| D | False | False | False | False | 321 |
| D | True | False | True | False | 2 |
| J | False | True | False | False | 598 |
| M | False | False | False | False | 139 |
| M | False | True | False | False | 1 |
| R | False | False | False | False | 7 |
| S | False | False | False | False | 1 |
| S | False | True | False | False | 1 |
| V | True | True | False | False | 9103 |
| V | True | False | True | False | 640 |
| V | True | True | True | False | 40 |
| V | True | False | False | False | 3 |

_14 row(s)_

## E08.7 — Overdue cheques still in hand at year end

| overdue | n | amount |
|---|---|---|
| 1-30d | 8 | 497,770,000 |
| 31-90d | 7 | 362,980,000 |
| 91-180d | 111 | 6,114,260,000 |
| >180d | 190 | 11,001,350,000 |

_4 row(s)_

## E08.8 — Event dates later than year end (events recorded for FY1404 cheques after closing?)

| State | n | mn | mx |
|---|---|---|---|

_0 row(s)_

## E08.9 — Due date before receipt date / duplicates of (bank, cheque number)

| due_before_receipt | duplicate_bank_number_account | duplicate_sayad | with_sayad |
|---|---|---|---|
| 0 | 0 | 2 | 32 |

_1 row(s)_

## E08.10 — The 200,000,000 subsystem↔ledger gap: cheques whose last event by date ≠ last event by entry order

| Check_Code | Check_Number | Cust | last_by_date | Date_Time | last_by_entry | entry_doc_date | entry_voucher |
|---|---|---|---|---|---|---|---|
| 39984 | 759265 | 100,000,000 | D | 2025-12-29 | V | 2025-12-15 | 354663 |
| 39985 | 759266 | 100,000,000 | D | 2025-12-29 | V | 2025-12-15 | 354663 |

_2 row(s)_

## E08.11 — Log of the two cheques (spend → return → undo → back-dated spend)

| DateProc | TimeProc | User_Code | c |
|---|---|---|---|
| 2025/12/16 | 18:00 | 16 | برگشت چك خرج شده به صندوق با شماره چک 759265 و مبلغ 100000000 ريال  طي سند: 139682 |
| 2025/12/16 | 18:00 | 16 | برگشت چك خرج شده به صندوق با شماره چک 759266 و مبلغ 100000000 ريال  طي سند: 139682 |
| 2025/12/29 | 18:09 | 11 | عودت از حالت خرجي چك دريافتي به شماره: 759266 و به مبلغ:100000000 از طرف: شرکت همراه تجارت شکيل-14011115760 |
| 2025/12/29 | 18:10 | 11 | عودت از حالت خرجي چك دريافتي به شماره: 759265 و به مبلغ:100000000 از طرف: شرکت همراه تجارت شکيل-14011115760 |
| 2025/12/29 | 18:18 | 14 |  عودت سند برگشتي به شماره: 759265 و مبلغ: 100000000 |
| 2025/12/29 | 18:18 | 14 |  عودت سند برگشتي به شماره: 759266 و مبلغ: 100000000 |
| 2025/12/29 | 18:19 | 14 | عودت از حالت خرجي چك دريافتي به شماره: 759265 و به مبلغ:100000000 از طرف: اکبر زمرديان |
| 2025/12/29 | 18:19 | 14 | عودت از حالت خرجي چك دريافتي به شماره: 759266 و به مبلغ:100000000 از طرف: اکبر زمرديان |
| 2026/01/14 | 14:29 | 16 | چك خرجي  به شرکت همراه تجارت شکيل-14011115760 + طي سند: 137926/372 شماره ثابت سند354663 |
| 2026/01/14 | 14:29 | 16 | ...پرداخت به + طي سند: 137926/372 شماره ثابت سند354663 |

_10 row(s)_

## E08.12 — "Undo" operations on cheques (عودت ...) — these rewind state and remove history

| op | n | users |
|---|---|---|
| undo: deposit to bank | 562 | 5 |
| undo: collection | 178 | 5 |
| undo: bounce | 75 | 4 |
| edit bank document | 45 | 5 |
| undo: other | 30 | 2 |
| other edit | 13 | 4 |
| undo: spend to third party | 6 | 3 |

_7 row(s)_
