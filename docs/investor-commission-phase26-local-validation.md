# راهنمای اجرای آزمون محلی و دورریختنی چرخه چک کارمزد سرمایه‌گذار (فاز ۲۶)

**توجه بسیار مهم:** این دستورالعمل **فقط** برای اجرای در یک پایگاه‌داده محلی، کاملاً دورریختنی و ایزوله (مانند Supabase CLI یا Docker روی `127.0.0.1` یا `localhost`) طراحی شده است. هرگونه اجرای این بسته روی پروژه آنلاین Supabase یا محیط عملیاتی **اکیداً ممنوع** است.

**هشدار محدوده آزمون‌های ایستا:** آزمون‌های ایستای TypeScript (مانند `investorCommissionPhase26ValidationPackage.test.ts` و `investorCommissionAtomicWorkflowDraft.test.ts`) صرفاً ساختار پرونده‌ها و عدم وجود الگوهای نامعتبر را بررسی می‌کنند و **به هیچ وجه جایگزین اجرای واقعی کامپایل و اجرای SQL در پایگاه‌داده PostgreSQL نمی‌شوند**. تایید نهایی پایگاه‌داده تا پیش از اجرای موفق کامل در محیط محلی دورریختنی، **«اثبات‌نشده»** است و این بسته **هیچ مجوزی برای انتشار یا استقرار ندارد**.

---

## ۱. خلاصه‌ی ساختار آزمون‌ها و ادعاها (Assertion Summary)

- **فایل آزمون پایگاه‌داده (`supabase/tests/investor_commission_phase26_database_validation.sql`):**
  - **مجموع ادعاهای سطح اصلی (Assertions):** دقیقاً ۴۴ ادعا (`SELECT plan(44)`).
  - **سناریوهای مثبت:** ۴ سناریو (بازطبقات‌بندی اتمیک، تکرارپذیری، تحقق و پاس شدن با بانک اصلی، و پاس شدن با بانک فرعی دوم).
  - **سناریوهای منفی:** ۱۸ سناریوی منفی واقعی همراه با فراخوانی تابع، دریافت خطای دقیق و اثبات عدم تغییر نسخه/وضعیت/مانده‌ها.
  - **ادعاهای امنیتی:** ۹ ادعای واقعی برای کنترل RLS جداول و سطوح دسترسی توابع (`has_function_privilege`).
- **آزمون ایستای بسته (`src/tests/investorCommissionPhase26ValidationPackage.test.ts`):** ۱۳ کنترل ساختاری ایستا (از جمله عدم وجود `SELECT pass(` و انطباق ۱:۱ plan با assertionها).
- **آزمون ایستای پیش‌نویس (`src/tests/investorCommissionAtomicWorkflowDraft.test.ts`):** ۵۱ کنترل ایستا برای قرارداد پارامترها و منطق اتمیک.

---

## ۲. بررسی ابزارها و نسخه‌ها

پیش از شروع، از نصب بودن ابزارهای لازم روی سیستم محلی خود اطمینان حاصل کنید:

```bash
docker --version
psql --version
supabase --version
```

برای مشاهده دستورات مجاز CLI و نحوه کار با Supabase CLI، دستورات زیر را جهت راهنمایی اجرا کنید:

```bash
supabase --help
supabase start --help
supabase test db --help
supabase db advisors --help
supabase migration new --help
```

---

## ۳. راه‌اندازی محیط محلی و ایزوله (Disposable Local Setup)

پایگاه‌داده محلی جدید را راه‌اندازی کنید:

```bash
supabase start
```

### ⚠️ نقطه کنترل ایمنی و توقف فوری (Critical Safety Check)

بلافاصله آدرس اتصال به پایگاه‌داده را بررسی کنید. آدرس باید **حتماً** `127.0.0.1` یا `localhost` باشد:

```bash
supabase status
```

**اخطار توقف:** اگر آدرس پایگاه‌داده شامل دامنه خارجی یا پروژه آنلاین ابری باشد، **بلافاصله عملیات را متوقف کنید**.

---

## ۴. اعمال مایگریشن‌های رسمی پایه (۰۱ تا ۲۳)

ابتدا مایگریشن‌های رسمی موجود در پروژه را روی پایگاه‌داده محلی اعمال کنید:

```bash
supabase db reset
```

این دستور تمامی مایگریشن‌های رسمی پوشه `supabase/migrations/` (از ۰۱ تا ۲۳) را روی محیط محلی اعمال می‌کند.

---

## ۵. اعمال پرونده‌های نامزد محلی (Candidate Files)

پرونده‌های نامزد را **بدون** ساخت مایگریشن رسمی، به صورت مستقیم روی پایگاه‌داده محلی اجرا کنید:

```bash
# ۱. اعمال نامزد زیرساخت رابطه‌ای
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f security/local-db-validation/investor-commission/01_investor_relational_foundation_candidate.sql

# ۲. اعمال نامزد توابع اتمیک
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f security/local-db-validation/investor-commission/02_investor_commission_atomic_workflow_candidate.sql
```

---

## ۶. اجرای مجموعه آزمون‌های تراکنشی (Database Test Suite)

مجموعه آزمون‌های pgTAP و تراکنشی فاز ۲۶ را اجرا کنید:

```bash
# روش ۱: با استفاده از Supabase CLI
supabase test db supabase/tests/investor_commission_phase26_database_validation.sql

# روش ۲: اجرای مستقیم با psql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/investor_commission_phase26_database_validation.sql
```

تأیید کنید که تمامی ۴۴ ادعای اصلی آزمون با موفقیت (ok) به پایان رسیده و تمامی تراکنش‌ها با موفقیت `ROLLBACK` شده‌اند.

---

## ۷. برنامه آزمون همزمانی (Concurrent Session Test Plan)

**توجه:** این بخش تا زمان اجرای واقعی در محیط محلی **«اثبات‌نشده»** باقی می‌ماند و باید در یک محیط محلی با دو نشست همزمان `psql` آزمایش شود.

### سناریوی آزمون همزمانی:

۱. **نشست ۱ (Session 1):** یک تراکنش باز کنید و قفل `reclassify_investor_commission_cheque_atomic` را روی چک ۱ برقرار کنید:
   ```sql
   BEGIN;
   SELECT public.reclassify_investor_commission_cheque_atomic(
       '00000000-0000-4000-a000-000000000001',
       '00000000-0000-4000-a000-000000000300',
       '00000000-0000-4000-a000-000000000200',
       1, 'CONC_KEY_1', 'CONC_FP_1', '00000000-0000-4000-a000-000000000002'
   );
   -- COMMIT نزنید!
   ```

۲. **نشست ۲ (Session 2):** همزمان همان تابع را برای همان چک اجرا کنید:
   ```sql
   BEGIN;
   SELECT public.reclassify_investor_commission_cheque_atomic(
       '00000000-0000-4000-a000-000000000001',
       '00000000-0000-4000-a000-000000000300',
       '00000000-0000-4000-a000-000000000200',
       1, 'CONC_KEY_2', 'CONC_FP_2', '00000000-0000-4000-a000-000000000002'
   );
   ```
   **نتیجه مورد انتظار:** نشست ۲ روی قفل `FOR UPDATE` منتظر می‌ماند (Wait status).

۳. **تأیید رفتار در نشست ۱:**
   ```sql
   COMMIT;
   ```

۴. **نتیجه در نشست ۲:**
   بلافاصله پس از COMMIT نشست ۱، نشست ۲ آزاد شده و با خطا (ERR_OBLIGATION_ALREADY_ALLOCATED یا ERR_STALE_VERSION) متوقف می‌شود. هیچ مانده دوبل یا تخصیص تکراری ایجاد نمی‌شود.

---

## ۸. بررسی توصیه‌گرهای امنیتی و کارایی (Advisors)

پس از اجرای آزمون‌ها، توصیه داده‌ها را بررسی کنید:

```bash
supabase db advisors
```

تأیید کنید که هیچ هشدار امنیتی (RLS disabled یا public function access) وجود ندارد.

---

## ۹. پاک‌سازی کامل محیط محلی (Cleanup)

پس از اتمام آزمون‌ها، محیط محلی را کاملاً دور بریزید:

```bash
supabase stop --no-backup
```

---

## ۱۰. گام‌های بعدی پس از موفقیت کامل محلی

۱. خروجی خام و کامل لاگ اجرای محلی را ذخیره کنید.
۲. پس از تأیید گزارش توسط تیم مالی و فنی، جهت تبدیل نامزدها به مایگریشن رسمی، با راهنمای `supabase migration new --help` نام مایگریشن جدید را در `supabase/migrations/` ایجاد کنید.
۳. پرچمدار ویژگی (`ENABLE_INVESTOR_COMMISSION_RECLASSIFICATION`) تا پیش از صدور مجوز رسمی کنترل نهایی همچنان خاموش (`false`) باقی می‌ماند.
