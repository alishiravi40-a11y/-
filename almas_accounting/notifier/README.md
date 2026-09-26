# notifier — ارسال اعلان‌های هسته

`below_cost_mail.py` هشدارهای فروش زیر آخرین قیمت خرید را ارسال می‌کند (تصمیم‌های D-11 و D-12):

- ردیف‌های `core.notification_outbox` را برمی‌دارد. **یک ردیف = یک فاکتور = یک ایمیل** که همه اقلام زیر قیمت و اختلاف هر کدام را دارد.
- گیرندگان هنگام ارسال از تنظیم `below_cost_alert_emails` خوانده می‌شوند. مدیر آن را با `core.change_setting` تغییر می‌دهد و در کد ثابت نیست.
- متن و گیرندگانِ ارسال‌شده روی همان ردیف ذخیره می‌شوند و پس از ارسال قابل تغییر نیستند.
- خطای SMTP ثبت و با فاصله افزایشی دوباره تلاش می‌شود. تحویل حداقل یک‌بار است.
- ثبت داخلی هشدار (`core.below_cost_alert`) مستقل از ایمیل است و همیشه باقی می‌ماند.

```bash
export ALMAS_SMTP_HOST=... ALMAS_SMTP_PORT=587 ALMAS_SMTP_USER=... ALMAS_SMTP_PASSWORD=... ALMAS_SMTP_FROM=alerts@...
python -m notifier.below_cost_mail --pg "$ALMAS_PG_DSN" --loop 60
```

آزمون: `HOLOO_PG_TEST_DSN=... python -m pytest notifier/tests`. آزمون با یک سرور SMTP محلی واقعی اجرا می‌شود.
