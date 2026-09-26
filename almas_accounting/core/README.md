# core — مدل داده هسته حسابداری (v0.2)

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
| سند پیش‌نویس با ردیف قابل حذف است (رفع اشکال v0.1) | — | `test_draft_entry_with_lines_can_be_deleted` |

اجرا: `HOLOO_PG_TEST_DSN=... python3 -m pytest -q tests`

## v0.2 — تصمیم‌های مالک (`schema/002_decisions.sql`، آزمون: `tests/test_decisions.py`)
| تصمیم | قاعده اعمال‌شده در DB | آزمون |
|---|---|---|
| D-01 VAT سازگار با هلو | `setting vat_mode=holoo_compatible` (مقدار دیگری پذیرفته نمی‌شود)؛ مالیات/عوارض ردیف همان‌طور که داده شده ذخیره می‌شود | `test_d01_*` |
| D-02 ادواری | `setting inventory_accounting=periodic`؛ فروش سند COGS نمی‌سازد | `test_d01_d02_settings_fixed_to_owner_decisions` |
| D-05 چند سال باز | وضعیت مستقل سال و دوره؛ سند فقط در دوره‌ای از سال خودش؛ تراز جدا برای هر سال؛ ایجاد سال جدید سال قبل را قفل نمی‌کند؛ تغییر وضعیت فقط با `change_period_status` / `change_fiscal_year_status` + مجوز `period.close` / `period.reopen` + علت + Audit؛ UPDATE مستقیم وضعیت مسدود؛ بستن سال فقط وقتی همه دوره‌ها بسته و پیش‌نویسی نمانده؛ بازگشایی دوره در سال بسته ممنوع | `test_d05_*` |
| D-06 فروش زیر قیمت خرید | هشدار در پیش‌نویس (`sales_invoice_warnings`)؛ نهایی‌سازی بدون مجوز `sales.below_cost` رد می‌شود؛ کاربر مجاز باید هشدار را تأیید کند؛ ثبت `below_cost_event` غیرقابل تغییر + Audit؛ گزارش `below_cost_report`؛ اعطا/لغو مجوز فقط توسط `security.admin` با Audit | `test_d06_*` |
| D-11 (باز) معیار قیمت خرید | هر دو معیار روی ردیف ثبت می‌شوند (میانگین متحرک، آخرین خرید)؛ `below_cost_basis` = `undecided` (زیر هر یک ← مجوز)؛ نبود معیار = هشدار `cost_basis_missing`، نه حدس | `test_d11_*` |

یادداشت استقرار: نقش برنامه نباید UPDATE مستقیم روی `period`، `fiscal_year`، `setting` و `user_permission` داشته باشد؛ توابع کنترل‌شده در تولید `SECURITY DEFINER` می‌شوند.

باز: کدینگ اشخاص (D-03)؛ D-11.
