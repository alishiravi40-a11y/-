# E16 — Beta scheme bank statement profile (aggregates only)

- input: bank statement (xls) SHA-256 `f8262904e84a038cf9d81e9a698587e38eeecd0cc15ff211f039da42787f3014`; Beta export (E15) SHA-256 `ed229291…38a0e`; Holoo mirror holoo1_1404. Files not stored (personal data).

    ## E16.1 statement: account type from title: True | rows 400 | period (1405, 5, 30) - (1405, 7, 4) | running balance consistent (oldest-first / newest-first) 1 / 399 of 399
    ## E16.2 deposits: installment («بابت قسط») rows 351 sum 15707595247 | other deposits 13 sum 9888767985 | withdrawals 36 sum 28364284227
    ## E16.3 installment deposits by day (million rials): {'05/30': 82, '06/01': 5641, '06/29': 1138, '06/30': 1185, '06/31': 1584, '07/01': 6074}
    ## E16.4 deposit id: filled 351 lengths {10: 351} | deposits per id {4: 3, 2: 110, 1: 119} | ids with 2 deposits and equal amount 103 of 110 | one id -> one payer name True
    ## E16.5 withdrawals by class: {'bank fees/SMS/statement (< 1M)': 23, 'supplier/other transfers (PAYA/SATNA)': 11, 'instant PAYA to Refah (REFA)': 2} | REFA total 1038124560 = 6.61 % of installment deposits | any withdrawal described as bank share/installment fee: 0
    ## E16.6 payers 232 | = Holoo 1404 beta customers 214 | = Beta-export customers (name) 5 | deposit id = Beta-export national code 7 of 351 | deposit id = national code of same-named Holoo person 317 of 326
    ## E16.7 1405 deposit vs modal 1404 Holoo «وصول قسط» credit of the same customer: {'equal': 107, 'different': 24}
