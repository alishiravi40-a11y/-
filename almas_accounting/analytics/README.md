# analytics — کنترل‌ها و تحلیل مدیریتی روی آینه هلو

پس از هر `holoo-reader publish`:
```bash
psql "$HOLOO_PG_DSN" -f sql/010_views.sql          # Viewهای تحلیلی (analytics.*)
python3 controls.py --pg "$HOLOO_PG_DSN" --source-db holoo1_1404 --report reports/controls_holoo1_1404.md
```
- **Viewها:** `gl_line`، `sales_line` (سود ردیفی، زیر بها با دو معیار میانگین و آخرین خرید، بهای صفر)، `below_cost_sales` (فروش زیر قیمت خرید به تفکیک ماه، کاربر، کانال و انبار؛ D-06)، `monthly_sales`، `margin_by_brand/warehouse`، `person_balance`، `receivable_open_items`/`receivable_ageing` (FIFO؛ جمع = مطالبات دفتر)، `cheque_status`، `cheque_bank_risk`، `customer_cheque_risk`، `stock_position`، `purchase_price_history`، `web_reconciliation`
- **کنترل‌ها:** ۲۲ کنترل اعلانی (`controls.py`) با شدت، توضیح ساده برای مدیر و ارجاع به ثبت ضعف‌ها و شواهد. نتایج در `analytics.control_run` و `analytics.control_result` ذخیره می‌شوند تا روند در Importهای بعدی قابل مقایسه باشد.
- گزارش نمونه (فقط اعداد تجمیعی): `reports/controls_holoo1_1404.md`
