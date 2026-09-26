# core — مدل داده هسته حسابداری (v0.1)

`schema/001_core.sql` (PostgreSQL) — طراحی جایگزین ضعف‌های هلو. قواعد در **خود پایگاه داده** اعمال می‌شوند و با `tests/test_core_rules.py` اثبات شده‌اند:

| قاعده | ضعف هلو | آزمون |
|---|---|---|
| ثبت فقط سند تراز؛ هر ردیف دقیقاً یک طرف؛ بدون ردیف صفر و بدون «پنهان در دفتر» | W-04, W-24 | `test_unbalanced_entry_cannot_post`, `test_line_must_have_exactly_one_side` |
| قفل دوره: بسته = ممنوع، در حال بستن = فقط اصلاحیه | W-01, W-28 | `test_closed_period_rejects_posting`, `test_closing_period_accepts_only_adjustments` |
| تاریخ مؤثر داخل دوره + زمان ثبت سرور | W-06 | `test_effective_date_must_be_inside_period` |
| سند ثبت‌شده غیرقابل تغییر و حذف | W-05, W-07 | `test_posted_entry_is_immutable_and_undeletable` |
| ابطال = سند معکوس قابل ردیابی (نه پنهان‌سازی) | W-03 | `test_reversal_nets_to_zero_and_is_traceable` |
| حساب معین/تفصیلی شخص‌محور بدون شخص پذیرفته نمی‌شود؛ فقط حساب برگ | W-22 | `test_party_required_on_subledger_account_and_leaf_only` |
| Audit فقط‌افزودنی با زنجیره هش؛ دستکاری قابل کشف | W-02 | `test_audit_log_is_append_only_and_hash_chained` |
| چک: رویدادها غیرقابل حذف؛ Undo = رویداد معکوس | W-13 | `test_cheque_events_are_immutable_and_reversible` |

اجرا: `HOLOO_PG_TEST_DSN=... python3 -m pytest -q tests`

باز (منتظر تصمیم مالک): روش حسابداری موجودی (D-02)، کدینگ اشخاص (D-03)، سیاست ثبت با تاریخ گذشته (D-05)، VAT (D-01).
