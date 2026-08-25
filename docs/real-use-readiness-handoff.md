# سند تحویل و آماده‌سازی نهایی برای آزمون واقعی پایگاه‌داده و ممیزی مستقل
## (Real-Use Readiness Handoff & Database Migration Specification)

---

## ۱. هدف سند و بیانیه وضعیت پروژه

این سند، مرجع تحویل نهایی و خلاصه‌سازی وضعیت معماری، مرجعیت داده‌ها، مایگریشن‌های پایگاه‌داده و آزمون‌های تحویل برای پروژه **سیستم جامع حسابداری، نسیه‌دهی، اقساط و اعتبارات** می‌باشد.

> ⚠️ **هشدار صریح و خط‌قرمز عملیاتی (Operational Constraint)**:
> **برنامه در وضعیت فعلی پیش از اجرای کامل و موفقیت‌آمیز تمام ۳۴ فایل مایگریشن روی یک دیتابیس واقعی PostgreSQL و انجام ممیزی و ورود اطلاعات آزمایشی، به هیچ عنوان آماده استفاده واقعی یا عملیاتی نیست.**

---

## ۲. تعیین قطعی دامنه نسخه نخست (Operational Scope Boundary)

### ۲.۱. بخش‌های داخل دامنه استفاده واقعی (In-Scope First Version)

موجودیت‌ها و جریان‌های زیر کاملاً در دامنه عملیاتی نسخه اول قرار دارند و تعاملات آنها از طریق سرویس‌های سروری و RPCهای پایگاه‌داده به انضمام قوانین حسابداری دوطرفه و کنترل‌های اعتباری پشتیبانی می‌شود:

1. **اشخاص و مشتریان (Persons & Customers)**: ثبت، ویرایش، کدگذاری خودکار، نقش‌ها و استعلام هویت/کدملی.
2. **حساب‌ها و مانده‌های اول دوره (COA & Opening Balances)**: درخت حساب‌های معین (`subsidiary_accounts`) و ثبت تراز افتتاحیه اتمیک.
3. **اسناد و ردیف‌های حسابداری (Journal Vouchers & Entries)**: صدور اسناد حسابداری با لزوم تراز دقیق $\sum \text{Debit} = \sum \text{Credit}$.
4. **فاکتورها (Invoices)**: صدور، ویرایش، باطل‌سازی اتمیک و اثر حسابداری متناظر با ثبت کد پادمان.
5. **چک‌های دریافتی و پرداختی (Cheques & Cheque Mutations)**: چرخه کامل ۵ حالته اسناد تجاری (صندوق، واگذار به بانک، وصول، خرج به غیر، برگشتی) همراه با معکوس‌سازی و اسناد اصلاحی.
6. **ماشین‌حساب‌های اعتباری (Credit Calculators)**: فرمول‌ها و تنظیمات محاسبه سود و اقساط با اقتدار سروری.
7. **کالا، دسته‌بندی و واحد سنجش (Products, Categories & Units)**: ثبت کالا، کدگذاری خودکار با ففل سطرها و تخصیص شناسه واحد سنجش و دسته‌بندی.
8. **انبارها و انتقال بین انبارها (Warehouses & Transfers)**: ثبت انبار، تخصیص کلاینتی/سروری کد و حواله‌های انتقال بین انبار با اثر حسابداری دوطرفه موجودی کالا.
9. **دفترچه‌های اقساط و وصول اقساط (Installment Books & Receipts)**: ایجاد دفترچه قسط، زمان‌بندی و تسویه اتمیک قسط با ثبت سند حسابداری.
10. **نمایندگان اعتباری (Credit Agents / Business Partners)**: پروفایل اعتباری، کارمزدها و سقف اعتباری نمایندگان.
11. **پرونده‌ها، سیاست‌ها و درخواست‌های اعتباری (Credit Files, Policies & Requests)**: تشکیل پرونده، دروازه تسویه حساب (`checkCustomerCreditEligibility`)، حذف منطقی (`deleted_at`) با علل لغو اجباری.
12. **مدارک پرونده‌های اعتباری (Credit File Documents)**: بارگذاری واقعی فایل تا سقف ۱۵ مگابایت، پسوندهای مجاز (PDF, JPEG, PNG, WEBP)، هش SHA-256 سروری، استریم دانلود و جبران شکست پاکسازی Storage.
13. **حساب‌های بانکی و صندوق (Bank Accounts & Cashboxes)**: حساب‌های بانکی و موجودی‌های نقدی مورد نیاز عملیات فوق (`SUB_BANK`, `SUB_CASH`).

### ۲.۲. بخش‌های تعویق‌افتاده و خارج از دامنه شروع کار (Deferred / Out-of-Scope)

بخش‌های زیر جهت حفظ سادگی و متمرکز بودن نسخه اول غیرفعال و مستند شده‌اند (هیچ کدی حذف نشده است):

1. **نماینده فروش / نماینده نسیه (Sales Agent / Nesyeh Catalog)**: بخش کاتالوگ و ثبت سفارش خرید نسیه تا زمان تثبیت زیرساخت فروشگاهی به حالت تعویق درآمده است.
2. **ماژول‌های آینده و مرکز دانش (Future Modules & Knowledge Center)**: مقالات، مراحل و دانشنامه در نسخه اولیه غیرفعال هستند.
3. **قابلیت بازطبقه‌بندی کارمزد سرمایه‌گذار (Investor Commission Reclassification)**: تا زمان اجرای واقعی آزمون پایگاه‌داده PostgreSQL معوق گشته است.
4. **امکانات جانبی فاقد کاربرد مستقیم (Visitor Network & SMS Recovery Queues)**: ماژول‌های شبکه ویزیتوری و صفوف بازیابی پیامک کلاینتی غیرفعال شده‌اند.

---

## ۳. جدول نهایی مرجعیت داده‌ها (Final Data Persistence Authority)

| نام موجودیت در AppState | نوع داده | وضعیت ممیزی اقتدار | محل ماندگاری / سرور |
|---|---|---|---|
| `users` | `User[]` | `DUAL_PATH_BLOCKER` | `localStorage` + `auth.users` (`/api/auth/*`) |
| `persons` | `Person[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB (`/api/persons`) |
| `products` | `Product[]` | `DATABASE_AUTHORITATIVE` | PostgreSQL DB (`/api/products`) |
| `productCategories` | `string[]` | `DATABASE_AUTHORITATIVE` | PostgreSQL DB (`/api/product-categories`) |
| `subsidiaries` | `AccountSubsidiary[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB (`/api/chart-of-accounts`) |
| `vouchers` | `JournalVoucher[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB (`/api/vouchers`) |
| `checks` | `Check[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB (`/api/cheques`) |
| `checkbooks` | `CheckbookModel[]` | `BROWSER_STORAGE_BLOCKER` | `localStorage` |
| `invoices` | `Invoice[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB (`/api/invoices`) |
| `openingBalances` | `OpeningBalance[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB (`/api/opening-balance`) |
| `installmentBooks` | `InstallmentBook[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB (`/api/installments/create`) |
| `installments` | `Installment[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB (`/api/installments/settle`) |
| `installmentRequests` | `InstallmentRequest[]` | `BROWSER_STORAGE_BLOCKER` | `localStorage` |
| `installmentPlans` | `InstallmentPlan[]` | `BROWSER_STORAGE_BLOCKER` | `localStorage` |
| `warehouses` | `Warehouse[]` | `DATABASE_AUTHORITATIVE` | PostgreSQL DB (`/api/warehouses`) |
| `warehouseTransfers` | `WarehouseTransfer[]` | `DATABASE_AUTHORITATIVE` | PostgreSQL DB (`/api/warehouse-transfers`) |
| `costCenters` | `CostCenter[]` | `BROWSER_STORAGE_BLOCKER` | `localStorage` |
| `bankTerminals` | `BankTerminal[]` | `BROWSER_STORAGE_BLOCKER` | `localStorage` |
| `auditLogs` | `AuditLog[]` | `BROWSER_STORAGE_BLOCKER` | `localStorage` |
| `settings` | `AppSettings` | `BROWSER_STORAGE_BLOCKER` | `localStorage` + `/api/app-state` |
| `roles` | `Role[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB |
| `permissions` | `Permission[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB |
| `rolePermissions` | `RolePermission[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB |
| `knowledgeCategories` ... `knowledgeVersions` | `Knowledge*` | `OUT_OF_SCOPE_DISABLED` | `localStorage` (غیرفعال) |
| `businessPartners` | `BusinessPartner[]` | `DUAL_PATH_BLOCKER` | `localStorage` + DB (`/api/persons/:id/agent-details`) |
| `partnerCreditRequests` | `PartnerCreditRequest[]` | `BROWSER_STORAGE_BLOCKER` | `localStorage` |
| `partnerSalesPlans` | `PartnerSalesPlan[]` | `BROWSER_STORAGE_BLOCKER` | `localStorage` |
| `partnerOrders` | `PartnerOrder[]` | `DUAL_PATH_BLOCKER` | `localStorage` + `/api/orders/convert` |
| `partnerSettlements` | `PartnerSettlement[]` | `BROWSER_STORAGE_BLOCKER` | `localStorage` |
| `creditFiles` | `CreditFile[]` | `DUAL_PATH_BLOCKER` | `localStorage` + Supabase (`/api/credit-files`) |
| `creditPolicies` | `CreditPolicy[]` | `BROWSER_STORAGE_BLOCKER` | `localStorage` |
| `calculators` | `Calculator[]` | `DATABASE_AUTHORITATIVE` | PostgreSQL DB (`/api/calculators`) |
| `nesyehCatalog` ... `nesyehPaymentDeclarations` | `Nesyeh*` | `OUT_OF_SCOPE_DISABLED` | React in-memory (غیرفعال) |
| `investorProfiles` ... `investorAuditLogs` | `Investor*` | `OUT_OF_SCOPE_DISABLED` | React in-memory (غیرفعال) |
| `smsSettings` ... `smsTemplates` | `Sms*` | `OUT_OF_SCOPE_DISABLED` | `localStorage` (غیرفعال) |
| `visitorProfiles` ... `visitorCommissions` | `Visitor*` | `OUT_OF_SCOPE_DISABLED` | React in-memory (غیرفعال) |

---

## ۴. فهرست کامل فایل‌های مایگریشن و هش‌های SHA-256 (۳۴ مایگریشن)

⚠️ **توجه ممیزی**: تمام فایل‌های مایگریشن زیر **صرفاً به صورت فایل SQL در سورس موجودند** و هنوز روی پایگاه‌داده هدف به اجرا در نیامده‌اند:

1. `01_credit_files.sql`: `703fa68d48bf705d0617a06b5d6bdb822157fb5dd843746e874e26663fb0677d` (وضعیت: فایل موجود / اجرانشده)
2. `02_base_infrastructure_auth.sql`: `c1937933ee3f71ce2b6d93aa201e69d081bfd85aaa560782ddae8ded0693938b` (وضعیت: فایل موجود / اجرانشده)
3. `03_persons_foundation.sql`: `b9d3a2b38e5dc3be40c041266058812af96ad37f8b8c2133666068ddf060f81f` (وضعیت: فایل موجود / اجرانشده)
4. `04_chart_of_accounts.sql`: `03ced0710cd4bef1f2db4c6005f0ffb239295858086c2489c0d784ad4111af83` (وضعیت: فایل موجود / اجرانشده)
5. `05_journal_vouchers.sql`: `3173e228671a7adb0c08e45b08a6c32cb44e41d874b02e3bf1dd352e10aa94b4` (وضعیت: فایل موجود / اجرانشده)
6. `06_inventory_master_data.sql`: `4c2215f47224a68fcada9333f58627555de291140d50046c103f70771807d624` (وضعیت: فایل موجود / اجرانشده)
7. `07_inventory_ledger_foundation.sql`: `50baa3536bd5ee49fe1a226a35e755b821a3bfe70b686b924be6203a6bdd14eb` (وضعیت: فایل موجود / اجرانشده)
8. `08_inventory_negative_override_authorization.sql`: `4112bdc97abc1d2f3bc751e6137bd3affd021f2e79e4248ad7c5834eed36ae4d` (وضعیت: فایل موجود / اجرانشده)
9. `09_journal_voucher_draft_atomic_creation.sql`: `a3b38d37a03eee049e4e021d2354540fcbe7c4943df871ea837800f38d690922` (وضعیت: فایل موجود / اجرانشده)
10. `10_admin_bootstrap_transactional_function.sql`: `d1737b1ac9f222c855b916797556859c687efceccdf7cc2b1506679bcef7bdf6` (وضعیت: فایل موجود / اجرانشده)
11. `11_app_state_store_rls.sql`: `ebdbf96a72f1ff15d04c6a52a32388f07d9912996c5be7fba157eb6a3eb6e326` (وضعیت: فایل موجود / اجرانشده)
12. `12_coa_backfill_conflict_hardening.sql`: `c9f3fb75b7b2736dbe17729312d6dc79faf6514e1fb10c488f23d4c962ef8a16` (وضعیت: فایل موجود / اجرانشده)
13. `13_coa_backfill_full_conflict_hardening.sql`: `1ebab349717ea3f13cfc79d3e7c3babbada642959309a7b398267a91b6f51de2` (وضعیت: فایل موجود / اجرانشده)
14. `14_installment_foundation.sql`: `4589c2cc066bbf6fcb48647d5e713ed391aa2bc75ea4b5852668e20de79cc760` (وضعیت: فایل موجود / اجرانشده)
15. `15_invoices_foundation.sql`: `61b3492a8a30425f86404034c19f69b76a654b92dca145674ec95b11451611b9` (وضعیت: فایل موجود / اجرانشده)
16. `16_invoice_update_atomic_foundation.sql`: `6f8430721677bc52952b4e3f96ebedee303b2d4f571a8ab7ede234805ea7fd16` (وضعیت: فایل موجود / اجرانشده)
17. `17_invoice_atomic_void_function.sql`: `7cc31a82bd80d2fb866609287a1c69f06f8499396670a21bee5f753f3f360a53` (وضعیت: فایل موجود / اجرانشده)
18. `18_order_invoice_conversions.sql`: `28902bada3afe30f10486c2c72805c858da59046f549a5ca4460e46ebb1b5f6f` (وضعیت: فایل موجود / اجرانشده)
19. `19_cheques_foundation.sql`: `d2c03f4bdf3bb8112ced0c58a97459908b0125917da13b6e7f8b62ab4aa213ea` (وضعیت: فایل موجود / اجرانشده)
20. `20_cheque_atomic_create.sql`: `6520f7eb24da06ff8b85d1fb161a478385b6c0a0d490627aa06f6ab6ccb50c2d` (وضعیت: فایل موجود / اجرانشده)
21. `21_cheque_atomic_transition.sql`: `0a25cf1e30ca72b559a9bbb50d91534051589b7e752140bbfdaca808b20fcad9` (وضعیت: فایل موجود / اجرانشده)
22. `22_cheque_edit_reversal_foundation.sql`: `392e6a0b96462525e0c981371169c16b80712f96746925e593e2aa7cb8b8df04` (وضعیت: فایل موجود / اجرانشده)
23. `23_invoice_cheques_orchestration.sql`: `0295c39f627cb96dd793ee66e17f9691dd818b83f259cd63bf22cba6a7f3e5c72` (وضعیت: فایل موجود / اجرانشده)
24. `24_lock_invoices_rls.sql`: `dcfd80845e58b1790daf51ca8e4516340ce42d2fa51463a6ffc918af9caec53b` (وضعیت: فایل موجود / اجرانشده)
25. `25_opening_balance_atomic.sql`: `3f075b12d0674df167d02ffeb414525ce9daf25dc5ce312d8b050731be09d3fb` (وضعیت: فایل موجود / اجرانشده)
26. `26_installment_settlement_atomic.sql`: `67bf87476a10e31c4052e24ed42c5a41c16e6d95a8aa6ac5f5db35c6a419c608` (وضعیت: فایل موجود / اجرانشده)
27. `27_agent_attributes_foundation.sql`: `5676f4e7157ec7dc9df02b939ff9d1f4d0ea132fc2e4dd9243081f991d4a89e4` (وضعیت: فایل موجود / اجرانشده)
28. `28_atomic_product_creation.sql`: `890941cc33249e474c4ef1d73e8be887dbf262d57dca7922f3ae04beb2265888` (وضعیت: فایل موجود / اجرانشده)
29. `29_atomic_warehouse_master_data.sql`: `940aea16706960abc4e34e62d4713c5f46cb005ca3a7059f5d72b5df87aca29e` (وضعیت: فایل موجود / اجرانشده)
30. `30_atomic_warehouse_transfer_accounting.sql`: `046cb892c81ed89dc37d00a2e96e237418e2edf15eed0338b1764b32dcfa6f8e` (وضعیت: فایل موجود / اجرانشده)
31. `31_atomic_installment_book_creation.sql`: `29007c54fe035566b3a6fd37da25bd7a4d8297ad5182abdd476aef625f030c0b` (وضعیت: فایل موجود / اجرانشده)
32. `32_partner_and_credit_files_authority.sql`: `c5e1dcff13d751eda9ad3596f9a3a4f842cea7f39cc28c7f8c56ade4069caeee` (وضعیت: فایل موجود / اجرانشده)
33. `33_credit_files_soft_delete_and_documents.sql`: `ca1de189612328c047e617d77b91de083d302cb26a727f4749cf219c5adc81b` (وضعیت: فایل موجود / اجرانشده)
34. `34_credit_documents_storage_bucket.sql`: `312f1a946ca6d0f8bbdcf6e7fb47488bdf5c9f1b2283af115ab38a619c425cca` (وضعیت: فایل موجود / اجرانشده)

---

## ۵. ممیزی وابستگی‌های زیرساختی و مدیریت فایل (دستور ۷)

- **کتابخانه‌های افزوده شده**: `multer` (^2.2.0) و dev-dependency `@types/multer` (^2.2.0).
- **قوانین و محدودیت‌های بارگذاری**:
  - سقف واقعی حجم: ۱۵ مگابایت (`15,728,640` بایت).
  - پسوندهای مجاز: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
  - هش SHA-256 بایت‌های فایل مستقیماً در سرور محاسبه می‌شود.
  - مکانیزم جبران شکست (Compensation Rollback) در `DocumentStorageService` پیاده‌سازی شده و در صورت شکست ثبت در DB، فایل آپلود شده از Storage پاک می‌گردد.

---

## ۶. تفکیک موارد اثبات‌شده، ایستا و معوق آزمون واقعی

### ۶.۱. موارد اثبات‌شده (Proven Items)
- عدم وجود هرگونه کوئری تخریبی فیزیکی (`DELETE FROM credit_files`).
- توقف کاملاً واقعی `readAsDataURL` در لایه آپلود مدارک.
- صفر بودن خواندن و نوشتن عملیاتی `localStorage` برای کالاها، دسته‌بندی‌ها، انبارها، انتقال بین انبارها و ماشین‌حساب‌ها.
- انطباق کامل تایپ‌اسکریپت (`npx tsc --noEmit` با خروجی صفر خطا).
- موفقیت کامل فرایند ساخت پروژه (`npm run build`).

### ۶.۲. مواردی که فقط ایستا بررسی شده‌اند (Statically Checked Items)
- صحت قواعد نحو و سینتکس توابع PL/pgSQL و فایل‌های SQL مایگریشن‌ها.
- عدم وجود تداخل در توابع متوالی مایگریشن‌ها از فایل ۰۱ تا ۳۴.

### ۶.۳. مواردی که هنوز باید روی PostgreSQL و Storage واقعی آزمایش شوند (Pending Real DB Testing)
1. **اجرای واقعی مایگریشن‌ها**: اجرای ترتیب فیزیکی مایگریشن‌ها روی یک دیتابیس PostgreSQL خامی که فاقد هرگونه افزونه غیرمجاز است.
2. **بررسی سیاست‌های RLS**: تست عینی تفکیک داده‌های سازمان‌ها (`organization_id`) تحت سناریوی چندکاربره واقعی.
3. **تست همزمانی قفل سطرها (`FOR UPDATE`)**: آزمایش رفتارهای کالیبره‌شده در تراکنش‌های پرحجم واقعی.
4. **بارگذاری بایت‌ها در باکت خصوصی Supabase**: آزمایش عملی ارسال/دریافت بایت‌های واقعی و قوانین دسترسی Bucket روی پروداکشن واقعی.

---

## ۷. برنامه انتقال‌پذیری آینده (Future Portability Plan)

ساختار کد به گونه‌ای طراحی شده است که فرآیند انتقال سیستم از بستر Supabase به یک سرور داخلی مستقل (On-Premises Docker / PostgreSQL) کاملاً شفاف و بدون بازنویسی برنامه باشد:

1. **لایه API مستقل Express**: تمامی درخواست‌های فرانت‌اند از طریق `/api/*` رد و بدل می‌شوند و فرانت‌اند هیچ وابستگی مستقیمی به SDK کلاینت Supabase ندارد.
2. **استاندارد PostgreSQL و PL/pgSQL**: توابع اتمیک و RLSها بر پایه استاندارد ANSI SQL / PostgreSQL طراحی شده‌اند و روی هر نمونه PostgreSQL قابل اجرا هستند.
3. **انتزاع Storage Provider**: سرویس `DocumentStorageService` قابلیت جایگزینی درایور Supabase Storage با درایورهای S3/MinIO یا Local Disk Storage را دارا می‌باشد.

---
