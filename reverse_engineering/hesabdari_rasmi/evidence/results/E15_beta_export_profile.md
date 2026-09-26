# E15 — Beta export profile (aggregates only)

- input: Beta-system contracts export (xlsx), SHA-256 `ed229291beea75c7d50c29a69e378915dc996b19cb8874989c06256865b38a0e` — file not stored in the repository (personal data)

    ## E15.1 shape: rows 552 columns 24 | headers: ['شناسه', 'عنوان', 'تاریخ ثبت', 'زمان ثبت', 'کدملی مشتری', 'شماره حساب', 'سازمان مشتری', 'مبلغ پرداخت نقدی', 'مبلغ کل اعتباری', 'تاریخ اولین قسط', 'مبلغ اولین قسط', 'اقساط', 'اقساط وصولی', 'اقساط سررسید', 'اقساط حذف شده', 'مبلغ اقساط وصولی', 'کدملی ثبت کننده', 'نمایندگی', 'بازاریاب']
    ## E15.2 شناسه: unique True | increasing with registration time 551 of 551 | registration range (1404, 10, 9) - (1405, 5, 27)
    ## E15.3 national code: valid checksum 552 of 552 | customers 516 | contracts per customer {1: 484, 3: 4, 2: 28}
    ## E15.4 شماره حساب: length {14: 552} | distinct 516 | accounts per customer {1: 516} | customers per account {1: 516}
    ## E15.5 installments: count distribution {3: 1, 4: 1, 6: 10, 7: 2, 8: 13, 9: 2, 10: 12, 11: 1, 12: 403, 13: 4, 14: 7, 15: 5, 16: 2, 18: 88, 24: 1} | first == floor(total/count) 552 | remainder (total - first*count) in [0, count) 552 | remainder == 0 237
    ## E15.6 first due: end of Jalali month 552 of 552 | months after registration: reg day<=15 {0: 253, 1: 5} reg day>15 {1: 292, 2: 2}
    ## E15.7 collections: collected_amount == collected*first 551 | live contracts 517 | collected + «اقساط سررسید» == installments due by export date 517 | live with overdue>0 4 | fully collected 3
    ## E15.8 deleted installments: rows with deleted>0 35 | whole contract deleted 30 | partial (count, deleted, collected, overdue) [(12, 11, 1, 0), (12, 11, 1, 0), (12, 10, 1, 0), (12, 7, 5, 0), (18, 17, 1, 0)] | deleted + collected == count 34 of 35
    ## E15.9 مبلغ پرداخت نقدی values [(1.0, 371), (0.0, 178), (100.0, 2), (1000000.0, 1)] | distinct: سازمان 1 بازاریاب 1 نمایندگی empty 552 registrars 11 | عنوان generic 153
    ## E15.10 overlap with Holoo 1404 persons (customers, in_holoo, as_beta_in_holoo, registered_in_1404, of_which_beta_in_holoo): (516, 17, 9, 74, 1)
