# Baseline Lock v1 — سند قفل خط مبنای پروژه

**تاریخ ایجاد:** ۲۰۲۶-۰۷-۲۶ (۴ مرداد ۱۴۰۵)  
**نسخه پروژه:** Financial & Enterprise Core v1.0  
**وضعیت پروژه:** قفل خط مبنا (Baseline Locked) — بدون هیچ‌گونه تغییر در کد، دیتابیس، ساختار یا فرمول‌ها.

---

## ۱. ساختار کامل پروژه (Project Structure)

### ۱.۱. فهرست فایل‌های اصلی و حجم آن‌ها
| نام فایل / مسیر | حجم تقریبی | تعداد خطوط | نقش و مسئولیت اصلی |
| :--- | :--- | :--- | :--- |
| `/src/App.tsx` | ~307 KB | ۶,۳۷۹ | کامپوننت اصلی، هماهنگ‌کننده متمرکز State، مدیریت مسیرها، مودال‌ها، Handlers و اتصالات Supabase |
| `/src/utils/accounting.ts` | ~111 KB | ۲,۶۱۰ | **هسته محاسبات مالی و انبار**؛ توابع صدور اسناد، محاسبه مانده اشخاص، اقساط، موجودی انبار، سود و زیان و Serialization |
| `/src/types.ts` | ~27 KB | ۹۰۳ | **قراردادها و تایپ‌ها**؛ تعریف کلیه اینترفیس‌ها و انوم‌های متغیرهای AppState, Voucher, Invoice, Person, Check و غیره |
| `/src/components/PartnerDashboard.tsx` | ~131 KB | ۲,۳۱۷ | پنل مدیریت نمایندگان، پرونده‌های اعتباری، کمیسیون‌ها و درخواست‌های اعتبارسنجی |
| `/src/components/InvoiceForm.tsx` | ~91 KB | ۱,۸۳۱ | فرم صدور و ویرایش فاکتورهای خرید، فروش، مرجوعی، فروش اقساطی و تنظیم دریافت/پرداخت‌ها |
| `/src/components/BackupManager.tsx` | ~15.5 KB | ۳۱۷ | مدیریت خروجی گرفتن (Export) و بازگردانی (Import) فایل‌های پشتیبان JSON |
| `/src/components/AuditLogViewer.tsx` | ~4.3 KB | ۹۷ | نمایش لاگ‌های ثبت شده از تغییرات و رویدادهای سیستم |
| `/src/tests/accounting.test.ts` | ~8 KB | ۱۸۳ | مجموعه تست‌های unit فعلی جهت سنجش توابع حسابداری |

### ۱.۲. وابستگی و ماتریس ارتباط فایل‌ها
```
[src/types.ts]
      ▲
      │ (تعریف تایپ‌ها)
      ├───────────────────────────────┐
      │                               │
[src/utils/accounting.ts] ◄─── [src/components/*]
      ▲                               ▲
      │ (توابع مالی و محاسباتی)          │ (UI Controls)
      └─────────────┬─────────────────┘
                    │
              [src/App.tsx] ◄──► [LocalStorage / Supabase]
```

### ۱.۳. فایل‌های بحرانی (Critical Files)
1. **`src/utils/accounting.ts`**: هرگونه خطای منطقی در این فایل باعث خراب شدن اسناد مالی، ناترازی و اشتباه در محاسبه موجودی و مانده اشخاص می‌شود.
2. **`src/App.tsx`**: به عنوان منبع واحد حقیقت (Single Source of Truth) عمل کرده و تغییر بدون احتیاط در Handlers آن باعث Data Loss می‌گردد.
3. **`src/types.ts`**: تغییر ساختار اینترفیس‌ها بدون Migration، باعث ناهمخوانی داده‌های ذخیره‌شده قبلی در LocalStorage می‌شود.

---

## ۲. وضعیت هسته مالی (Financial Core Status)

| بخش / عملیات | محل دقیق کد (File & Lines) | شرح عملکرد |
| :--- | :--- | :--- |
| **ثبت سند فاکتور** | `src/utils/accounting.ts` (Lines 1444-1637) | تابع `createInvoiceVoucher`: ایجاد اسناد بدهکار/بستانکار برای فاکتورهای خرید، فروش، مرجوعی و احتساب تخفیفات و ارزش افزوده |
| **ثبت سند تغییر وضعیت چک** | `src/utils/accounting.ts` (Lines 1262-1365) | تابع `createCheckStateVoucher`: صدور اسناد حسابداری برای وضعیت‌های "در جریان وصول"، "وصول شده"، "برگشتی" و "عودت" |
| **ثبت سند اقساط** | `src/utils/accounting.ts` (Lines 1366-1443) | تابع `createInstallmentVoucher`: صدور اسناد اسناد دریافتنی/پرداختنی اقساط |
| **محاسبه مانده اشخاص** | `src/utils/accounting.ts` (Lines 451-525) | تابع `calculatePersonBalances`: پیمایش اسناد و محاسبه مجموع بدهکار و بستانکار هر شخص |
| **محاسبه اقساط** | `src/utils/accounting.ts` (Lines 150-238) | تابع `calculateInstallments` و `generateInstallments`: محاسبه سود سالانه/ماهانه و جدول سررسید اقساط |
| **محاسبه کمیسیون نماینده** | `src/utils/accounting.ts` & `PartnerDashboard.tsx` | تابع `calculateAgentSettlement`: محاسبه درصد کارمزد نماینده بر اساس فاکتورها و اقساط ثبت‌شده |
| **محاسبه موجودی انبار** | `src/utils/accounting.ts` (Lines 887-1050) | تابع `calculateProductStocks`: محاسبه موجودی تفکیکی هر انبار بر اساس سند اول دوره، فاکتورهای خرید/فروش/مرجوعی و حواله‌های انتقال |

---

## ۳. وضعیت داده‌ها و موجودیت‌ها (Entities & Relations)

1. **`Person` (اشخاص):**
   - کلید اصلی: `id`
   - ارتباط: متصل به فاکتورها (`Invoice.personId`)، اسناد (`VoucherItem.personId`)، چک‌ها (`Check.personId`) و پرونده‌های اعتباری (`CreditFile.personId`).
2. **`Product` (کالاها / خدمات):**
   - کلید اصلی: `id`
   - ارتباط: متصل به آیتم‌های فاکتور (`InvoiceItem.productId`) و موجودی انبارها (`Warehouse`).
3. **`Invoice` (فاکتورها):**
   - کلید اصلی: `id`
   - ارتباط: متصل به `Person`، اسناد مالی (`invoice.voucherId`)، چک‌ها، دفترچه اقساط و نماینده فروش.
4. **`Voucher` (سند حسابداری):**
   - کلید اصلی: `id`
   - شامل آرایه‌ای از `VoucherItem` (شامل `accountCode`, `debit`, `credit`, `personId`, `description`).
5. **`Check` (چک‌ها):**
   - کلید اصلی: `id`
   - ارتباط: متصل به `Person` و اسناد مالی تغییر وضعیت چک (`voucherHistory`).
6. **`Installment` (اقساط):**
   - کلید اصلی: `id`
   - ارتباط: متصل به `Invoice` و `CreditFile`.
7. **`CreditFile` (پرونده اعتباری):**
   - کلید اصلی: `id`
   - ارتباط: متصل به `Partner` (نماینده) و `Person` (مشتری).
8. **`Partner` (نمایندگان):**
   - کلید اصلی: `id`
   - ارتباط: متصل به پرونده‌های اعتباری و اسناد تسویه کارمزد.

---

## ۴. وضعیت ذخیره‌سازی و ارتباطات (Storage & I/O)

- **ذخیره‌سازی محلی (LocalStorage):**
  - متغیر `hesabdar_app_state` تمام شیء `AppState` را در مرورگر نگه می‌دارد.
  - فراخوانی از طریق `loadAppState()` در زمان بالا آمدن برنامه و `saveAppState(state)` در هنگام هر تغییر.
- **ذخیره‌سازی ابری (Supabase):**
  - جداول `credit_files` و `checks` جهت سینک آنلاین بین نمایندگان استفاده می‌شوند (`supabase.from('credit_files')` و `supabase.from('checks')`).
- **ورودی و خروجی اطلاعات:**
  - **Import:** فرم‌های UI + بازگردانی فایل JSON از طریق `BackupManager`.
  - **Export:** دانلود بکاپ JSON کامل سیستم + خروجی‌های چاپی و فایل‌های اکسل/PDF.

---

## ۵. وضعیت تست‌ها (Testing Status)

- **تست‌های موجود:**  
  فایل `/src/tests/accounting.test.ts` شامل موارد زیر است:
  - سنجش بالانس بودن اسناد (T-Account Balance).
  - صحت ساختار Voucherها.
  - صحت محاسبه موجودی کالا در سناریوهای پایه.
- **کمبودهای تست (Gaps):**
  - عدم وجود تست برای چرخه کامل صدور فاکتور اقساطی همراه با چک و کارمزد نماینده.
  - عدم وجود تست برای سنجش رفتار سیستم در صورت قطعی Supabase یا خطای Storage.
  - عدم وجود تست ایزوله‌سازی داده‌های نمایندگان در محیط چندکاربره.

---

## ۶. قوانین غیرقابل تغییر و معیارهای پذیرش تغییرات آینده (Baseline Rules)

### ۶.۱. بخش‌های غیرقابل تغییر در فاز اول (Frozen Code)
1. **فرمول‌ها و توابع ریاضی موجود در `src/utils/accounting.ts`** (از جمله `createInvoiceVoucher` و `calculatePersonBalances`).
2. **ساختار اساسی `AppState` و `VoucherItem` در `src/types.ts`**.
3. **کلید ذخیره‌سازی `hesabdar_app_state` در LocalStorage**.

### ۶.۲. معیارهای پذیرش (Acceptance Criteria) برای هر اصلاح آتی
- **قانون توازن مطلق:** هیچ سندی تحت هیچ شرایطی نباید با اختلاف بدهکار و بستانکار (`debit !== credit`) ذخیره شود.
- **قانون عدم تخریب داده (Zero Data Loss):** هرگونه تغییر در UI یا Backend باید سازگاری عقب‌رو (Backward Compatibility) با فایل‌های JSON بکاپ قبلی داشته باشد.
- **پاس شدن تمام تست‌های رگرسیون:** قبل و بعد از اعمال هر تغییر کوچک، اجرای کلیه تست‌های Vitest/Jest اجباری است.

---
**پایان سند Baseline Lock v1**
