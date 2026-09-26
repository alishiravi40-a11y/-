# نقشه راه پروژه

| # | مرحله | خروجی | وضعیت |
|---|---|---|---|
| 1 | Restore و شناسایی Backup | مشخصات، هش، Restore سالم | ✅ انجام شد |
| 2 | مهندسی معکوس عمیق | `REPORT_FA.md`، Inventory | ✅ انجام شد |
| 3 | اثبات مستقل قواعد و یافته‌ها | `EVIDENCE_REVIEW_FA.md`، `evidence/` (E01–E11) | ✅ دور ۲ انجام شد |
| 4 | نقشه قابلیت‌ها | `compatibility/` (۹۱ قابلیت) | ✅ نسخه ۱ |
| 5 | ثبت ضعف‌ها | `WEAKNESS_REGISTER_FA.md` (۲۵ ضعف) | ✅ نسخه ۱ |
| 6 | طراحی معماری و Reader | `ARCHITECTURE_FA.md`، `HOLOO_READER_FA.md` | ✅ v0.1 |
| 7 | **پیاده‌سازی Holoo Backup Reader** | `holoo_reader/` + Golden tests روی ۱۴۰۴ | 🔄 در حال انجام |
| 8 | تکمیل مجهولات با آزمایش | Parser ADTG؛ Backup ۱۴۰۳/۱۴۰۵؛ آزمایش کنترل‌شده روی هلو | ⏳ نیاز به D-09 |
| 9 | Data platform و آینه | PostgreSQL `holoo_mirror`، Import مکرر | ⏳ |
| 10 | داشبورد و کنترل‌های مدیریتی روی آینه | Controls engine + Analytics | ⏳ |
| 11 | هسته حسابداری جدید | Ledger، دوره‌ها، اسناد، اشخاص | ⏳ پس از D-02، D-03، D-05 |
| 12 | زیردامنه‌ها | فروش، خرید، انبار، خزانه، چک، مالیات | ⏳ |
| 13 | فاز موازی و Parity | Diff روزانه با Backup هلو | ⏳ D-07 |
| 14 | Cutover و ارتقا | | ⏳ |

## اصول اجرای هر مرحله
- **Evidence First.** هر مرحله با Commit و Push ثبت می‌شود.
- ماتریس سازگاری و ثبت ضعف‌ها در هر مرحله به‌روز می‌شوند.
