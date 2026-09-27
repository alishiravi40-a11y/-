# core — مدل داده هسته حسابداری (v0.7)

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

## v0.3 — D-11 و D-12 (`schema/003_below_cost_alerts.sql`، آزمون: `tests/test_alerts.py`)
| تصمیم | قاعده اعمال‌شده در DB | آزمون |
|---|---|---|
| D-11 آخرین قیمت خرید | `below_cost_basis=last_purchase` (تغییر Audit‌شده)؛ `purchase_price` (بدون حذف و ویرایش؛ خرید باطل = ردیف معکوس) و `last_purchase_price(item, date)`؛ مقدار هنگام ثبت روی ردیف فروش ذخیره می‌شود؛ خرید پس از تاریخ فروش لحاظ نمی‌شود؛ فروش زیر میانگین ولی بالای آخرین خرید هشدار ندارد؛ نبود خرید قبلی = `cost_basis_missing` | `test_d11_*` |
| D-12 سایت + ایمیل | حساب سرویس (`app_user.is_service`) در کانال `web` بدون توقف نهایی می‌کند. برای هر فاکتور: **یک** `below_cost_alert` با مهلت `below_cost_review_hours` و **یک** ردیف در `notification_outbox`. گیرندگان در تنظیم `below_cost_alert_emails` (با اعتبارسنجی، مجوز و Audit). هشدار حذف‌نشدنی است و فقط با `review_below_cost_alert` و مجوز `sales.below_cost_review` بررسی می‌شود. ایمیل ارسال‌شده غیرقابل تغییر است. `below_cost_alert_status` دیرکرد بررسی و ایمیل تحویل‌نشده را نشان می‌دهد. کاربر حضوری همچنان طبق D-06 | `test_d12_*` |

استقرار: حساب سایت با `is_service=true` ساخته شود؛ نشانی گیرنده و SMTP در مرحله راه‌اندازی تعیین می‌شوند؛ Worker ایمیل: `python -m notifier.below_cost_mail --pg ... --loop 60`.

D-13 (تأیید مالک): آخرین قیمت خرید = آخرین خرید همان مدل در کل مجموعه، فارغ از انبار و انتقال؛ در هسته کالا همان مدل است.

باز: کدینگ اشخاص (D-03).

## v0.4 — اشخاص و ماژول بتا (`schema/004_beta.sql`؛ آزمون‌ها: `beta/tests`)
پرونده هویتی واحد با کد ملی، نگاشت Legacy هلو با lineage، طرح و حساب بتا، نرخ نسخه‌دار سهم بانک، قراردادهای متعدد، برنامه اقساط، وصول بانکی، پرداخت مستقیم، اضافه‌وصول، استرداد، لغو، Import صورت‌حساب و گزارش بتا، و کنترل‌های B-01 تا B-14. جزئیات و نتیجه اجرای آزمایشی در `beta/README.md` آمده است.

یادداشت: `003_below_cost_alerts.sql` طوری اصلاح شد که با اجرای دستوربه‌دستور (psql) هم درست بارگذاری شود؛ تغییر تنظیم حالا داخل یک بلوک `DO` است.

## v0.5 — انتقال دفاتر هلو (`schema/005_legacy_ledger.sql`؛ `migration/`)
نگاشت حساب و سند هلو با lineage. انتقال کامل ۱۴۰۴ با **صفر اختلاف** نسبت به View خود هلو انجام شد و اجرای دوباره بی‌اثر است. جزئیات در `migration/README.md`.

## v0.6 — قواعد ثبت اسناد تجاری (`schema/006_posting.sql`)
قاعده خالص `document_posting_lines` برای فروش، برگشت از فروش، خرید، برگشت از خرید و ضایعات؛ همراه با `post_document` (ثبت دوباره بی‌اثر است)، `post_sales_invoice` و جدول `sales_invoice_payment`. برای هر کالا می‌توان حساب درآمد جدا تعریف کرد. حساب‌های پیش‌فرض در تنظیمات هستند. هر ۲۰,۸۲۸ سند تجاری ۱۴۰۴ عیناً برابر سند هلو بازتولید شد (`migration/README.md`).

## v0.7 — خزانه و چک (`schema/007_treasury.sql`)
- `cashbox` (حساب نقد و حساب چک صندوق)؛ حساب بانکی شرکت با حساب وصولی، اسناد پرداختنی و کارمزد.
- **چک با مکان صریح:** رویداد (`event_type`) با از/به (حساب + شخص). Trigger `cheque_event_chain` (شروع از مکان قبلی، شخص الزامی روی حساب شخص)، `cheque_event_lines` (بد: به / بس: از)، `post_cheque_events` (Idempotent) و View `cheque_location`. تنها تغییر مجاز روی رویداد، یک‌بار ثبت پیوند سند است.
- **اسناد خزانه:** `treasury_posting_lines(doc)` برای دریافت، پرداخت، انتقال و کارمزد، با کارمزد و تخفیف نقدی. انتقال فقط بین حساب‌های خود شرکت و بدون شخص است.
- **ضمانت:** `guarantee_instrument` / `guarantee_event` / `guarantee_open` / `guarantee_event_lines` با ضامن الزامی.
- برابری با ۱۴۰۴: چک ۶,۲۲۹ از ۶,۲۳۰، خزانه و ضمانت ۷,۷۶۲ از ۷,۷۶۲ (`migration/README.md`).
