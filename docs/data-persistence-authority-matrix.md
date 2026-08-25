# ماتریس مرجع مسیرهای ذخیره‌سازی و ممیزی اقتدار داده‌ها
## (Data Persistence Authority Matrix & Source of Truth Audit)

---

## ۱. هدف و دامنه ممیزی ساختاری

این سند، مرجع قطعی ممیزی تمام داده‌های ماندگار و گذرا در سیستم مالی و اعتباری است. تمام جریان‌های داده از لحظه اقدام کاربر در رابط کاربری (UI) تا محل نهایی ذخیره‌سازی (حافظه موقت، حافظه محلی مرورگر `localStorage`، فایل مرکزی `central_app_state.json`، و جداول/توابع PostgreSQL در Supabase) را به‌صورت دقیق و تفکیک‌شده ثبت می‌کند.

> **اصل حاکم (Single Source of Truth Invariant)**: طبق معماری مصوب در `GEMINI.md`، پایگاه‌داده سرور تنها منبع قطعی (Server-Authoritative SSOT) برای داده‌های مالی و تجاری است. ذخیره‌سازی در `localStorage` یا نگهداری صرف در حافظه موقت کلاینت برای داده‌های ماندگار مالی اکیداً ممنوع و مانع (Blocker) محسوب می‌شود.

---

## ۲. دسته‌بندی‌های استاندارد وضعیت اقتدار داده (Authority Statuses)

1. **پایگاه‌داده منبع قطعی (Database Authoritative)**: داده مستقیماً از طریق سرویس‌های سرور (`/api/*`) و توابع امن پایگاه‌داده (`SECURITY DEFINER RPC`) ثبت و خوانده می‌شود و کلاینت صرفاً لایه نمایش است.
2. **فقط حافظه موقت مجاز (Transient Memory Allowed)**: داده‌های زودگذر (مانند تست‌های اتصال، پیش‌نویس‌های بدون ذخیره، وضعیت فیلترها و فرم‌های در حال تکمیل).
3. **حافظه مرورگر منبع اصلی و مانع (Browser Storage Authoritative & Blocker)**: داده‌های ماندگار که هنوز به سرور منتقل نشده‌اند و منبع اصلی خواندن و نوشتن آنها `localStorage` است.
4. **فقط حافظه موقت برنامه و مانع (In-Memory Only & Blocker)**: موجودیت‌های تجاری که حتی در `localStorage` هم ذخیره نمی‌شوند و با رفرش صفحه از بین می‌روند.
5. **مسیر دوگانه و مانع (Dual-Path & Blocker)**: داده‌هایی که هم در سرور و هم به صورت موازی در `localStorage` از طریق `saveAppState` ذخیره می‌شوند که منجر به عدم انطباق (Data Drift / Split-Brain) می‌گردد.
6. **فاقد مسیر ذخیره‌سازی (No Persistence Path)**: موجودیت‌هایی که هیچ مکانیزم ماندگاری برای آنها پیاده‌سازی نشده است.

---

## ۳. ماتریس تفصیلی ممیزی تمام فیلدهای `AppState` (۵۶ فیلد در `src/types.ts`)

| # | نام فیلد در AppState | نوع داده | وضعیت اقتدار | محل ذخیره‌سازی فعلی | مسیر سرور | جدول / تابع پایگاه‌داده | مسیر بازیابی در لود |
|---|---|---|---|---|---|---|---|
| ۱ | `users` | `User[]` | **مسیر دوگانه و مانع** | `localStorage` + `auth.users` | `/api/auth/*` | `users`, `memberships` | `GET /api/auth/me` + `localStorage` |
| ۲ | `persons` | `Person[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/persons` | `persons`, `person_roles`, `rpc_create_person` | `GET /api/persons` |
| ۳ | `products` | `Product[]` | **پایگاه‌داده منبع قطعی** | PostgreSQL DB | `/api/products` | `products`, `product_code_sequences`, `rpc_create_product_atomic` (مایگریشن 06/28) | `executeFinancialHydration` |
| ۴ | `productCategories` | `string[]` | **پایگاه‌داده منبع قطعی** | PostgreSQL DB | `/api/product-categories` | `product_categories` (مایگریشن 06/28) | `executeFinancialHydration` |
| ۵ | `subsidiaries` | `AccountSubsidiary[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/chart-of-accounts` | `subsidiary_accounts`, `rpc_create_subsidiary` | `GET /api/chart-of-accounts` |
| ۶ | `vouchers` | `JournalVoucher[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/vouchers`, `/api/manual-vouchers` | `journal_vouchers`, `voucher_entries` | `GET /api/vouchers` |
| ۷ | `checks` | `Check[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/cheques` | `cheques`, `cheque_mutations`, `rpc_create_cheque` | `GET /api/cheques` |
| ۸ | `checkbooks` | `CheckbookModel[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | `checkbooks` (مایگریشن 19) | `loadAppState()` |
| ۹ | `invoices` | `Invoice[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/invoices` | `invoices`, `invoice_items`, `rpc_create_invoice_atomic` | `GET /api/invoices` |
| ۱۰ | `openingBalances` | `OpeningBalance[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/opening-balance` | `journal_vouchers`, `rpc_create_opening_balance_atomic` | `loadAppState()` + `GET /api/vouchers` |
| ۱۱ | `installmentBooks` | `InstallmentBook[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/installments/create` | `installment_books`, `rpc_create_installment_book_atomic` | `loadAppState()` |
| ۱۲ | `installments` | `Installment[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/installments/settle` | `installments`, `rpc_settle_installment_atomic` | `loadAppState()` |
| ۱۳ | `installmentRequests` | `InstallmentRequest[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | `installment_requests` (مایگریشن 14) | `loadAppState()` |
| ۱۴ | `installmentPlans` | `InstallmentPlan[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | `installment_plans` (مایگریشن 14) | `loadAppState()` |
| ۱۵ | `warehouses` | `Warehouse[]` | **پایگاه‌داده منبع قطعی** | PostgreSQL DB | `/api/warehouses` | `warehouses`, `warehouse_code_sequences`, `rpc_create_warehouse_atomic` (مایگریشن 06/29) | `executeFinancialHydration` |
| ۱۶ | `warehouseTransfers` | `WarehouseTransfer[]` | **پایگاه‌داده منبع قطعی** | PostgreSQL DB | `/api/warehouse-transfers` | `inventory_transactions`, `inventory_transaction_items`, `rpc_execute_warehouse_transfer_atomic` (مایگریشن 07/30) | `executeFinancialHydration` |
| ۱۷ | `costCenters` | `CostCenter[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` + Central JSON | ندارد | جدول اختصاصی ندارد | `loadAppState()` |
| ۱۸ | `bankTerminals` | `BankTerminal[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` + Central JSON | ندارد | جدول اختصاصی ندارد | `loadAppState()` |
| ۱۹ | `auditLogs` | `AuditLog[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` + Central JSON | ندارد | `audit_logs` (در مایگریشن‌ها) | `loadAppState()` |
| ۲۰ | `settings` | `AppSettings` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` + Central JSON | `/api/app-state` | `app_state_store` (مایگریشن 11) | `loadAppState()` |
| ۲۱ | `roles` | `Role[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/auth/context` | `roles` (مایگریشن 02) | `loadAppState()` + Context |
| ۲۲ | `permissions` | `Permission[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/auth/context` | `permissions` (مایگریشن 02) | `loadAppState()` + Context |
| ۲۳ | `rolePermissions` | `RolePermission[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/auth/context` | `role_permissions` (مایگریشن 02) | `loadAppState()` + Context |
| ۲۴ | `knowledgeCategories` | `KnowledgeCategory[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | جدول اختصاصی ندارد | `loadKnowledgeState()` |
| ۲۵ | `knowledgeArticles` | `KnowledgeArticle[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | جدول اختصاصی ندارد | `loadKnowledgeState()` |
| ۲۶ | `knowledgeSteps` | `KnowledgeStep[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | جدول اختصاصی ندارد | `loadKnowledgeState()` |
| ۲۷ | `knowledgeErrors` | `KnowledgeError[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | جدول اختصاصی ندارد | `loadKnowledgeState()` |
| ۲۸ | `knowledgeGlossary` | `KnowledgeGlossary[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | جدول اختصاصی ندارد | `loadKnowledgeState()` |
| ۲۹ | `knowledgeVersions` | `KnowledgeVersion[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | جدول اختصاصی ندارد | `loadKnowledgeState()` |
| ۳۰ | `businessPartners` | `BusinessPartner[]` | **مسیر دوگانه و مانع** | `localStorage` + DB | `/api/persons/:id/agent-details` | `business_partners` (مایگریشن 27) | `loadAppState()` |
| ۳۱ | `partnerCreditRequests` | `PartnerCreditRequest[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | `partner_credit_requests` | `loadAppState()` |
| ۳۲ | `partnerSalesPlans` | `PartnerSalesPlan[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | جدول اختصاصی ندارد | `loadAppState()` |
| ۳۳ | `partnerOrders` | `PartnerOrder[]` | **مسیر دوگانه و مانع** | `localStorage` | `/api/orders/convert` | `invoices` (مایگریشن 18) | `loadAppState()` |
| ۳۴ | `partnerSettlements` | `PartnerSettlement[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | جدول اختصاصی ندارد | `loadAppState()` |
| ۳۵ | `creditFiles` | `CreditFile[]` | **مسیر دوگانه و مانع** | `localStorage` + Direct Supabase | ندارد | `credit_files` (مایگریشن 01) | `loadAppState()` |
| ۳۶ | `creditPolicies` | `CreditPolicy[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | `credit_policies` | `loadAppState()` |
| ۳۷ | `calculators` | `Calculator[]` | **پایگاه‌داده منبع قطعی** | سرور و پایگاه‌داده | `/api/calculators` | `calculators` | `GET /api/calculators` |
| ۳۸ | `partnerTickets` | `PartnerTicket[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | جدول اختصاصی ندارد | از بین می‌رود |
| ۳۹ | `syncTests` | `Array<SyncTest>` | **فقط حافظه موقت مجاز** | حافظه موقت React | ندارد | ندارد | موقت برای تست اتصال |
| ۴۰ | `projectNotes` | `ProjectNote[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | ندارد | `loadAppState()` |
| ۴۱ | `nesyehCatalog` | `NesyehOrderableItem[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | ندارد | از بین می‌رود |
| ۴۲ | `nesyehPurchaseOrders`| `NesyehPurchaseOrder[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | ندارد | از بین می‌رود |
| ۴۳ | `nesyehPaymentDeclarations`| `NesyehPaymentDeclaration[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | ندارد | از بین می‌رود |
| ۴۴ | `creditControlDrafts`| `CreditControlDraft[]` | **فقط حافظه موقت مجاز** | حافظه موقت React | ندارد | ندارد | پیش‌نویس موقت فرم |
| ۴۵ | `investorProfiles` | `InvestorProfile[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | جدول مستقل ندارد | داده ماک تستی |
| ۴۶ | `investorContracts` | `InvestorContract[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | جدول مستقل ندارد | داده ماک تستی |
| ۴۷ | `investorPaymentSchedules`| `InvestorPaymentSchedule[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | جدول مستقل ندارد | داده ماک تستی |
| ۴۸ | `investorPaymentObligations`| `InvestorPaymentObligation[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | جدول مستقل ندارد | داده ماک تستی |
| ۴۹ | `investorReferrals` | `InvestorReferral[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | جدول مستقل ندارد | داده ماک تستی |
| ۵۰ | `investorReturnRequests`| `InvestorReturnRequest[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | جدول مستقل ندارد | داده ماک تستی |
| ۵۱ | `investorAuditLogs` | `InvestorAuditLog[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | جدول مستقل ندارد | داده ماک تستی |
| ۵۲ | `smsSettings` | `SmsSettings` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | ندارد | `localStorage.getItem` |
| ۵۳ | `smsTemplates` | `SmsTemplate[]` | **حافظه مرورگر منبع اصلی و مانع** | `localStorage` | ندارد | ندارد | `localStorage.getItem` |
| ۵۴ | `visitorProfiles` | `VisitorProfile[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | ندارد | از بین می‌رود |
| ۵۵ | `referrerNodes` | `ReferrerNode[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | ندارد | از بین می‌رود |
| ۵۶ | `visitorCommissions`| `VisitorCommissionStatement[]` | **فقط حافظه موقت برنامه و مانع** | حافظه موقت React | ندارد | ندارد | از بین می‌رود |

---

## ۴. ممیزی تفصیلی کلیدهای حافظه محلی مرورگر (`localStorage`)

فهرست کامل کلیدهای مورد استفاده در کلاینت و وضعیت مجاز/مانع بودن آنها:

| # | کلید LocalStorage | پرونده استفاده | تابع / خط | نوع داده | وضعیت ممیزی |
|---|---|---|---|---|---|
| ۱ | `accounting_initialized` | `src/utils/accounting.ts` | `saveAppState` (خط 684) | پرچم راه‌اندازی | مانع (کنترلر کلاینت) |
| ۲ | `accounting_persons` | `src/utils/accounting.ts` | `saveAppState` (خط 747) | اشخاص | **مانع دوگانه** |
| ۳ | `accounting_products` | `src/utils/accounting.ts` | `saveAppState` / `loadAppState` | کالاها | غیرفعال شده (پایگاه‌داده قطعی) |
| ۴ | `accounting_product_categories` | `src/utils/accounting.ts` | `saveAppState` / `loadAppState` | دسته‌بندی کالا | غیرفعال شده (پایگاه‌داده قطعی) |
| ۵ | `accounting_subsidiaries` | `src/utils/accounting.ts` | `saveAppState` (خط 750) | حساب‌های معین | **مانع دوگانه** |
| ۶ | `accounting_vouchers` | `src/utils/accounting.ts` | `saveAppState` (خط 751) | اسناد حسابداری | **مانع دوگانه** |
| ۷ | `accounting_checks` | `src/utils/accounting.ts` | `saveAppState` (خط 752) | چک‌ها | **مانع دوگانه** |
| ۸ | `accounting_invoices` | `src/utils/accounting.ts` | `saveAppState` (خط 753) | فاکتورها | **مانع دوگانه** |
| ۹ | `accounting_opening_balances` | `src/utils/accounting.ts` | `saveAppState` (خط 754) | تراز افتتاحیه | **مانع دوگانه** |
| ۱۰ | `accounting_installment_books` | `src/utils/accounting.ts` | `saveAppState` (خط 755) | دفترچه‌های اقساط | **مانع دوگانه** |
| ۱۱ | `accounting_installments_details` | `src/utils/accounting.ts` | `saveAppState` (خط 756) | اقساط ریز | **مانع دوگانه** |
| ۱۲ | `accounting_installments` | `src/utils/accounting.ts` | `saveAppState` (خط 757) | درخواست‌های اقساط | **مانع محلی** |
| ۱۳ | `accounting_installment_plans` | `src/utils/accounting.ts` | `saveAppState` (خط 758) | طرح‌های اقساطی | **مانع محلی** |
| ۱۴ | `accounting_warehouses` | `src/utils/accounting.ts` | `saveAppState` / `loadAppState` | انبارها | غیرفعال شده (پایگاه‌داده قطعی) |
| ۱۵ | `accounting_transfers` | `src/utils/accounting.ts` | `saveAppState` (خط 760) | انتقال بین انبار | **مانع محلی** |
| ۱۶ | `accounting_cost_centers` | `src/utils/accounting.ts` | `saveAppState` (خط 761) | مراکز هزینه | **مانع محلی** |
| ۱۷ | `accounting_bank_terminals` | `src/utils/accounting.ts` | `saveAppState` (خط 762) | پایانه‌های پوز | **مانع محلی** |
| ۱۸ | `accounting_audit_logs` | `src/utils/accounting.ts` | `saveAppState` (خط 763) | لاگ‌های سیستم | **مانع محلی** |
| ۱۹ | `accounting_settings` | `src/utils/accounting.ts` | `saveAppState` (خط 764) | تنظیمات نرم‌افزار | **مانع محلی** |
| ۲۰ | `accounting_roles` | `src/utils/accounting.ts` | `saveAppState` (خط 765) | نقش‌های کاربری | **مانع دوگانه** |
| ۲۱ | `accounting_permissions` | `src/utils/accounting.ts` | `saveAppState` (خط 766) | دسترسی‌ها | **مانع دوگانه** |
| ۲۲ | `accounting_role_permissions` | `src/utils/accounting.ts` | `saveAppState` (خط 767) | انتساب دسترسی نقش | **مانع دوگانه** |
| ۲۳ | `accounting_users` | `src/utils/accounting.ts` | `saveAppState` (خط 768) | کاربران | **مانع دوگانه** |
| ۲۴ | `accounting_business_partners` | `src/utils/accounting.ts` | `saveAppState` (خط 769) | نمایندگان و همکاران | **مانع دوگانه** |
| ۲۵ | `accounting_partner_credit_requests` | `src/utils/accounting.ts` | `saveAppState` (خط 770) | درخواست‌های اعتباری | **مانع محلی** |
| ۲۶ | `accounting_partner_sales_plans` | `src/utils/accounting.ts` | `saveAppState` (خط 771) | طرح‌های فروش همکار | **مانع محلی** |
| ۲۷ | `accounting_partner_orders` | `src/utils/accounting.ts` | `saveAppState` (خط 772) | سفارشات همکار | **مانع دوگانه** |
| ۲۸ | `accounting_partner_settlements` | `src/utils/accounting.ts` | `saveAppState` (خط 773) | تسویه‌های همکار | **مانع محلی** |
| ۲۹ | `project_notes` | `src/utils/accounting.ts` | `saveAppState` (خط 774) | یادداشت‌های پروژه | **مانع محلی** |
| ۳۰ | `accounting_credit_files` | `src/utils/accounting.ts` | `saveAppState` (خط 775) | پرونده‌های اعتباری | **مانع دوگانه** |
| ۳۱ | `accounting_credit_policies` | `src/utils/accounting.ts` | `saveAppState` (خط 776) | سیاست‌های اعتباری | **مانع محلی** |
| ۳۲ | `accounting_knowledge_categories` | `src/modules/knowledge/knowledge.storage.ts` | `saveKnowledgeState` | دسته‌های دانش | **مانع محلی** |
| ۳۳ | `accounting_knowledge_articles` | `src/modules/knowledge/knowledge.storage.ts` | `saveKnowledgeState` | مقالات دانشنامه | **مانع محلی** |
| ۳۴ | `accounting_knowledge_steps` | `src/modules/knowledge/knowledge.storage.ts` | `saveKnowledgeState` | مراحل آموزشی | **مانع محلی** |
| ۳۵ | `accounting_knowledge_errors` | `src/modules/knowledge/knowledge.storage.ts` | `saveKnowledgeState` | راهنمای خطاها | **مانع محلی** |
| ۳۶ | `accounting_knowledge_glossary` | `src/modules/knowledge/knowledge.storage.ts` | `saveKnowledgeState` | واژه‌نامه مالی | **مانع محلی** |
| ۳۷ | `accounting_knowledge_versions` | `src/modules/knowledge/knowledge.storage.ts` | `saveKnowledgeState` | نسخه‌های سیستم | **مانع محلی** |
| ۳۸ | `smsTemplates` | `src/modules/sms/components/SMSManagementCenter.tsx` | خط 231 و 245 | قالب‌های پیامک | **مانع محلی** |
| ۳۹ | `smsEventsConfig` | `src/modules/sms/components/SmsEventsConfigTab.tsx` | خط 211 | رویدادهای پیامک | **مانع محلی** |
| ۴۰ | `sms_recovery_queue` | `src/modules/sms/recoveryService.ts` | خط 91 | صف پیامک آفلاین | مجاز (Fail-safe موقت) |
| ۴۱ | `offline_sync_queue` | `src/services/offlineSyncQueueService.ts` | خط 63 | صف همگام‌سازی آفلاین | مجاز (Fail-safe موقت) |
| ۴۲ | `custom_supabase_config` | `src/lib/supabaseClient.ts` | خط 62 | تنظیمات سفارشی کلاینت | **مانع امنیتی** |
| ۴۳ | `localStorage_emergency_backup_v1` | `src/services/centralSyncService.ts` | خط 73 | بکاپ اضطراری | مجاز (Fail-safe موقت) |
| ۴۴ | `central_sync_last_time` | `src/services/centralSyncService.ts` | خط 176 | زمان آخرین همگام‌سازی | وضعیت موقت |
| ۴۵ | `custom_banks` | `src/components/CheckManager.tsx` | خط 259 و 519 | لیست بانک‌های سفارشی | **مانع محلی** |
| ۴۶ | `AGENT_SYNC_TEST` | `src/components/PartnerDashboard.tsx` | خط 623 | تست دسترسی به Storage | مجاز (تست فنی مرورگر) |

---

## ۵. ممیزی فراخوانی‌های مستقیم Supabase از رابط کاربری (مغایر با اصل حاکمیت سرور)

فراخوانی‌های زیر مستقیماً از کامپوننت‌های فرانت‌اند روی جداول Supabase انجام می‌شوند و باید به مسیرهای سروری `/api/*` منتقل گردند:

1. **`src/components/PartnerDashboard.tsx`**:
   - خط 552: `supabase.from('credit_files').insert(newFile)`
   - خط 590: `supabase.from('credit_files').update(...)`
   - خط 1176: `supabase.from('credit_files').update({ status: 'pending' })`
   - خط 1203: `supabase.from('credit_files').delete().eq('id', file.id)`
   - خط 1706: `supabase.from('credit_files').upsert(newOrUpdatedFile)`
   - خط 2385: `supabase.from('credit_files').update(...)`
   - خط 2430: `supabase.from('credit_files').update(...)`
2. **`src/components/CentralCreditFileManager.tsx`**:
   - خط 86: `supabase.from('credit_files').update(...)`
3. **`src/components/AgentManager.tsx`**:
   - خط 4292: `supabase.from('credit_files').insert(newFile)`
4. **`src/components/PartnerCustomerDocuments.tsx`**:
   - خط 183: `supabase.from('credit_files').update({ paymentDocuments: ... })`
   - خط 217: `supabase.from('credit_files').update({ paymentDocuments: ... })`
   - خط 244: `supabase.from('credit_files').update({ paymentDocuments: ... })`
5. **`src/components/AgentDossierManager.tsx`**:
   - خط 91: `supabase.from('credit_files').update(...)`
6. **`src/services/centralSyncService.ts`**:
   - خط 199: `supabase.from('credit_files').upsert(state.creditFiles)`

---

## ۶. ممیزی موجودیت‌های الزامی بیست‌گانه

### ۱. اشخاص (Persons)
- **صفحه و تابع**: `PersonDirectory.tsx` (`handleSavePerson`, `handleDeletePerson`), `AgentManager.tsx`
- **محل ذخیره‌سازی**: مسیر دوگانه (`/api/persons` + `saveAppState`)
- **مسیر سرور**: `GET/POST /api/persons`, `PUT/POST /api/persons/:id`, `GET /api/persons/next-code`
- **جدول / تابع پایگاه‌داده**: جدول `persons`, `person_roles` و تابع `rpc_create_person`
- **مسیر بازیابی**: `PersonService.getAllPersons()`
- **رفتار در شکست DB**: پرتاب خطا، عدم اعمال در دیتابیس؛ اما در صورت فراخوانی مستقیم `saveAppState` در حافظه کلاینت ثبت می‌شود.
- **نمایش پیام موفقیت**: پیام Toast پس از پاسخ موفق سرور.
- **وضعیت**: **مسیر دوگانه و مانع**

### ۲. کالاها و دسته‌بندی‌ها (Products & Categories)
- **صفحه و تابع**: `ProductManager.tsx` (`handleSaveProduct`, `handleDeleteProduct`), `App.tsx`
- **محل ذخیره‌سازی**: `localStorage.getItem('accounting_products')` و فایل `central_app_state.json`
- **مسیر سرور**: فاقد اندپوینت اختصاصی CRUD (صرفاً از طریق `/api/app-state`)
- **جدول / تابع پایگاه‌داده**: جداول `products`, `product_categories` در مایگریشن `06_inventory_master_data.sql`
- **مسیر بازیابی**: `loadAppState()`
- **رفتار در شکست DB**: از دست رفتن داده در سرور و اتکا به کلاینت.
- **وضعیت**: **حافظه مرورگر منبع اصلی و مانع**

### ۳. انبارها و انتقال انبار (Warehouses & Warehouse Transfers)
- **صفحه و تابع**: `WarehouseManager.tsx` (`handleCreateTransfer`, `handleSaveWarehouse`)
- **محل ذخیره‌سازی**: `localStorage` (`accounting_warehouses`, `accounting_transfers`)
- **مسیر سرور**: فاقد اندپوینت اختصاصی
- **جدول / تابع پایگاه‌داده**: `warehouses`, `warehouse_transfers` (مایگریشن 06 و 07)
- **مسیر بازیابی**: `loadAppState()`
- **وضعیت**: **حافظه مرورگر منبع اصلی و مانع**

### ۴. حساب‌ها و اسناد حسابداری (Chart of Accounts & Journal Vouchers)
- **صفحه و تابع**: `AccountingDocumentManager.tsx`, `VoucherEntryModal.tsx`, `ChartOfAccountsManager.tsx`
- **محل ذخیره‌سازی**: مسیر دوگانه (سرویس‌های سرور + `saveAppState`)
- **مسیر سرور**: `/api/chart-of-accounts`, `/api/vouchers`, `/api/manual-vouchers`
- **جدول / تابع پایگاه‌داده**: `subsidiary_accounts`, `journal_vouchers`, `voucher_entries`, `rpc_create_journal_voucher_draft`
- **مسیر بازیابی**: `GET /api/chart-of-accounts`, `GET /api/vouchers`
- **وضعیت**: **مسیر دوگانه و مانع**

### ۵. چک‌ها و دسته‌چک‌ها (Cheques & Checkbooks)
- **صفحه و تابع**: `CheckManager.tsx` (`handleCreateCheck`, `handleTransition`, `handleEditCheck`, `handleReverseCheck`)
- **محل ذخیره‌سازی**: چک‌ها دارای اندپوینت سرور (`/api/cheques`) هستند اما هنوز در `saveAppState` در حافظه کلاینت ثبت می‌شوند. دسته‌چک‌ها کلاینتی هستند.
- **مسیر سرور**: `/api/cheques`, `/api/cheques/:id/transition`, `/api/cheques/:id/edit`, `/api/cheques/:id/reverse`
- **جدول / تابع پایگاه‌داده**: `cheques`, `cheque_mutations`, `rpc_create_cheque`, `rpc_transition_cheque`, `rpc_edit_cheque`, `rpc_reverse_cheque`
- **مسیر بازیابی**: `GET /api/cheques`
- **وضعیت**: **مسیر دوگانه و مانع**

### ۶. فاکتورها (Invoices)
- **صفحه و تابع**: `InvoiceManager.tsx`, `InvoiceEditorModal.tsx`, `App.tsx`
- **محل ذخیره‌سازی**: مسیر دوگانه (`/api/invoices` + `saveAppState`)
- **مسیر سرور**: `GET/POST /api/invoices`, `PUT /api/invoices/:id`, `POST /api/invoices/:id/void`
- **جدول / تابع پایگاه‌داده**: `invoices`, `invoice_items`, `rpc_create_invoice_atomic`, `rpc_update_invoice_atomic`, `rpc_void_invoice_atomic`
- **مسیر بازیابی**: `GET /api/invoices`
- **وضعیت**: **مسیر دوگانه و مانع**

### ۷. مانده‌های افتتاحیه (Opening Balances)
- **صفحه و تابع**: `OpeningBalanceManager.tsx` (`handleSaveOpeningBalance`)
- **محل ذخیره‌سازی**: مسیر دوگانه (`/api/opening-balance` + `saveAppState`)
- **مسیر سرور**: `POST /api/opening-balance`
- **جدول / تابع پایگاه‌داده**: `rpc_create_opening_balance_atomic`, `journal_vouchers`
- **مسیر بازیابی**: `GET /api/vouchers` + `loadAppState()`
- **وضعیت**: **مسیر دوگانه و مانع**

### ۸. دفترچه‌ها و اقساط (Installment Books & Installments)
- **صفحه و تابع**: `InstallmentManager.tsx`, `InstallmentBookletManager.tsx`
- **محل ذخیره‌سازی**: مسیر دوگانه (`/api/installments/*` + `saveAppState`)
- **مسیر سرور**: `POST /api/installments/create`, `POST /api/installments/settle`
- **جدول / تابع پایگاه‌داده**: `installment_books`, `installments`, `rpc_create_installment_book_atomic`, `rpc_settle_installment_atomic`
- **مسیر بازیابی**: `loadAppState()`
- **وضعیت**: **مسیر دوگانه و مانع**

### ۹. نمایندگان فروش و اعتباری (Business Partners / Agents)
- **صفحه و تابع**: `AgentManager.tsx`, `PartnerDashboard.tsx`
- **محل ذخیره‌سازی**: مسیر دوگانه (بخشی در `/api/persons/:id/agent-details` و کل آرایه در `accounting_business_partners`)
- **مسیر سرور**: `/api/persons/:id/agent-details`, `/api/persons/me/agent-profile`
- **جدول / تابع پایگاه‌داده**: `business_partners` (مایگریشن 27)
- **مسیر بازیابی**: `loadAppState()`
- **وضعیت**: **مسیر دوگانه و مانع**

### ۱۰. پرونده‌های اعتباری و مدارک (Credit Files & Policies)
- **صفحه و تابع**: `PartnerDashboard.tsx`, `CentralCreditFileManager.tsx`, `AgentDossierManager.tsx`
- **محل ذخیره‌سازی**: مسیر دوگانه خطرناک (فراخوانی مستقیم `supabase.from('credit_files')` در فرانت‌اند + `saveAppState`)
- **مسیر سرور**: فاقد روت‌های سروری امن `/api/credit-files`
- **جدول / تابع پایگاه‌داده**: `credit_files` (مایگریشن 01)
- **مسیر بازیابی**: `loadAppState()`
- **وضعیت**: **مسیر دوگانه و مانع**

### ۱۱. درخواست‌ها، سفارش‌ها و تسویه‌ها (Partner Requests, Orders & Settlements)
- **صفحه و تابع**: `AgentManager.tsx`, `PartnerOrderManager.tsx`
- **محل ذخیره‌سازی**: `localStorage` (`accounting_partner_credit_requests`, `accounting_partner_orders`, `accounting_partner_settlements`) با روت تبدیل سفارش `/api/orders/convert`
- **مسیر سرور**: `POST /api/orders/convert`
- **جدول / تابع پایگاه‌داده**: `invoices` (مایگریشن 18)
- **وضعیت**: **مسیر دوگانه و مانع**

### ۱۲. ماشین‌حساب‌ها و نرخ‌های آنها (Calculators & Overrides)
- **صفحه و تابع**: `CalculatorManagementCenter.tsx`, `creditCalculatorEngine.ts`
- **محل ذخیره‌سازی**: مسیر دوگانه (سرویس سروری `/api/calculators` + `state.calculators` در `saveAppState`)
- **مسیر سرور**: `GET/POST/PUT/DELETE /api/calculators`
- **جدول / تابع پایگاه‌داده**: `calculators` (در دیتابیس / استیت)
- **مسیر بازیابی**: `GET /api/calculators`
- **وضعیت**: **مسیر دوگانه و مانع**

### ۱۳. مراکز هزینه و پایانه‌های بانکی (Cost Centers & Bank Terminals)
- **صفحه و تابع**: `AccountingSettings.tsx`, `BankTerminalManager.tsx`
- **محل ذخیره‌سازی**: `localStorage` (`accounting_cost_centers`, `accounting_bank_terminals`)
- **مسیر سرور**: ندارد
- **جدول / تابع پایگاه‌داده**: ندارد
- **وضعیت**: **حافظه مرورگر منبع اصلی و مانع**

### ۱۴. تنظیمات برنامه (App Settings)
- **صفحه و تابع**: `SettingsView.tsx`, `AccountingSettings.tsx`
- **محل ذخیره‌سازی**: `localStorage.getItem('accounting_settings')` و فایل `central_app_state.json`
- **مسیر سرور**: `/api/app-state`
- **جدول / تابع پایگاه‌داده**: `app_state_store` (مایگریشن 11)
- **وضعیت**: **حافظه مرورگر منبع اصلی و مانع**

### ۱۵. سرمایه‌گذاران (Investors)
- **صفحه و تابع**: `InvestorManagementCenter.tsx`, `src/modules/investors/*`
- **محل ذخیره‌سازی**: صرفاً حافظه موقت React (`AppState.investorProfiles`, `investorContracts`, ...) و روت تغییر سرفصل چک `/api/cheques/:id/reclassify-investor-commission`
- **مسیر سرور**: `/api/cheques/:id/reclassify-investor-commission`
- **جدول / تابع پایگاه‌داده**: فاقد جداول اختصاصی نهایی (طرح آزمایشی)
- **وضعیت**: **فقط حافظه موقت برنامه و مانع**

### ۱۶. بازدیدکنندگان و پورسانت‌ها (Visitors & Commissions)
- **صفحه و تابع**: `VisitorNetworkManager.tsx`, `visitorCommissionEngine.ts`
- **محل ذخیره‌سازی**: صرفاً حافظه موقت React (`visitorProfiles`, `referrerNodes`, `visitorCommissions`)
- **مسیر سرور**: ندارد
- **جدول / تابع پایگاه‌داده**: ندارد
- **وضعیت**: **فقط حافظه موقت برنامه و مانع**

### ۱۷. پیامک‌ها (SMS Settings, Templates & Recovery)
- **صفحه و تابع**: `SMSManagementCenter.tsx`, `SmsEventsConfigTab.tsx`, `recoveryService.ts`
- **محل ذخیره‌سازی**: `localStorage` (`smsTemplates`, `smsEventsConfig`, `sms_recovery_queue`)
- **مسیر سرور**: ندارد (فراخوانی وب‌سرویس پیامکی در بک‌اند)
- **جدول / تابع پایگاه‌داده**: ندارد
- **وضعیت**: **حافظه مرورگر منبع اصلی و مانع**

### ۱۸. گزارش رویدادها (Audit Logs)
- **صفحه و تابع**: `AuditLogViewer.tsx`, `App.tsx`
- **محل ذخیره‌سازی**: `localStorage.getItem('accounting_audit_logs')`
- **مسیر سرور**: ندارد
- **جدول / تابع پایگاه‌داده**: `audit_logs` (تعریف اولیه)
- **وضعیت**: **حافظه مرورگر منبع اصلی و مانع**

### ۱۹. پشتیبان‌گیری و همگام‌سازی مرکزی (Backup & Central Sync)
- **صفحه و تابع**: `BackupManager.tsx`, `centralSyncService.ts`
- **محل ذخیره‌سازی**: فایل `central_app_state.json` در ریشه سرور و `localStorage_emergency_backup_v1`
- **مسیر سرور**: `/api/app-state`, `/api/backup/*`, `/api/download-zip`
- **جدول / تابع پایگاه‌داده**: `app_state_store`
- **وضعیت**: **مسیر دوگانه و مانع**

### ۲۰. مرکز دانش و راهنما (Knowledge Center)
- **صفحه و تابع**: `KnowledgeCenter.tsx`, `knowledge.storage.ts`
- **محل ذخیره‌سازی**: `localStorage` (`accounting_knowledge_*`)
- **مسیر سرور**: ندارد
- **جدول / تابع پایگاه‌داده**: ندارد
- **وضعیت**: **حافظه مرورگر منبع اصلی و مانع**

---

## ۷. فهرست مسیرهای واقعاً پایگاه‌داده‌محور (Server-Authoritative Foundation)

مسیرهای زیر در سرور پیاده‌سازی شده، دارای منطق احراز هویت (`authMiddleware`) و کنترل دسترسی سازمان (`resolveVerifiedOrgForWrite`) هستند و تراکنش‌های آنها اتمیک است:

1. **مدیریت اشخاص**:
   - `GET /api/persons`
   - `POST /api/persons` (اتمیک با `rpc_create_person`)
   - `PUT /api/persons/:id` (اتمیک با `rpc_update_person`)
   - `POST /api/persons/:id/deactivate`
   - `GET /api/persons/next-code`
   - `GET/PUT /api/persons/:id/agent-details`
2. **کدینگ و حساب‌های معین (COA)**:
   - `GET /api/chart-of-accounts`
   - `POST /api/chart-of-accounts`
   - `PUT /api/chart-of-accounts/:id`
   - `POST /api/chart-of-accounts/:id/deactivate`
3. **اسناد حسابداری**:
   - `GET /api/vouchers`
   - `GET /api/vouchers/:id`
   - `POST /api/manual-vouchers` (با تراز دوطرفه بدهکار/بستانکار اجباری)
4. **مدیریت فاکتورها**:
   - `GET /api/invoices`
   - `GET /api/invoices/:id`
   - `POST /api/invoices` (با `rpc_create_invoice_atomic`)
   - `PUT /api/invoices/:id` (با `rpc_update_invoice_atomic`)
   - `POST /api/invoices/:id/void` (با `rpc_void_invoice_atomic`)
5. **مدیریت چک‌ها و اسناد تجاری**:
   - `GET /api/cheques`
   - `GET /api/cheques/:id`
   - `POST /api/cheques` (با `rpc_create_cheque`)
   - `POST /api/cheques/:id/transition` (با `rpc_transition_cheque`)
   - `POST /api/cheques/:id/edit` (با `rpc_edit_cheque`)
   - `POST /api/cheques/:id/reverse` (با `rpc_reverse_cheque`)
   - `POST /api/cheques/:id/reclassify-investor-commission`
6. **اقساط و تسویه اقساط**:
   - `POST /api/installments/create` (با `rpc_create_installment_book_atomic`)
   - `POST /api/installments/settle` (با `rpc_settle_installment_atomic`)
7. **مانده‌های افتتاحیه**:
   - `POST /api/opening-balance` (با `rpc_create_opening_balance_atomic`)
8. **دریافت و پرداخت نقدی (صندوق / بانک)**:
   - `POST /api/cash-transactions/pay`
   - `POST /api/cash-transactions/receive`
9. **ماشین‌حساب‌های اعتباری**:
   - `GET /api/calculators`
   - `POST /api/calculators`
   - `PUT /api/calculators/:id`
   - `DELETE /api/calculators/:id`
10. **تبدیل سفارش به فاکتور**:
    - `POST /api/orders/convert`

---

## ۸. ترتیب پیشنهادی انتقال ماژول‌ها به پایگاه‌داده قطعی (Proposed Migration Sequence)

برای حذف تدریجی `localStorage` و `saveAppState` بدون ایجاد شکست در سیستم، توالی انتقال ۸ مرحله‌ای زیر پیشنهاد می‌گردد:

1. **گام ۱ (فعلی)**: تثبیت مرجع مسیرهای ذخیره‌سازی، ممیزی و محافظت از طریق تست گارد خودکار.
2. **گام ۲**: انتقال پرونده‌های اعتباری (`creditFiles`) و مدارک از فراخوانی مستقیم Supabase فرانت‌اند به اندپوینت‌های سروری امن `/api/credit-files`.
3. **گام ۳**: قطع وابستگی فاکتورها، چک‌ها و اسناد حسابداری به `saveAppState` و حذف کامل بازنویسی `localStorage` برای این موجودیت‌های تراکنشی.
4. **گام ۴**: انتقال موجودیت‌های انبارداری (کالاها `products`، دسته‌بندی‌ها، انبارها `warehouses` و حواله‌های انتقال) به جداول مایگریشن 06 و 07 از طریق سرویس‌های `/api/products` و `/api/inventory`.
5. **گام ۵**: انتقال دفترچه‌ها و اقساط (`installmentBooks`, `installments`, `installmentRequests`, `installmentPlans`) به فراخوانی‌های کامل سروری و حذف ذخیره محلی آنها.
6. **گام ۶**: انتقال نمایندگان (`businessPartners`)، درخواست‌ها، سفارش‌ها و تسویه‌های همکاران به پایگاه‌داده.
7. **گام ۷**: انتقال ماژول‌های سرمایه‌گذاران، شبکه ویزیتوری، تنظیمات پیامک و دانشنامه به جداول اختصاصی پایگاه‌داده.
8. **گام ۸**: حذف کامل تابع `saveAppState` و مهاجرت تمام بخش‌های باقی‌مانده `central_app_state.json` به پایگاه‌داده PostgreSQL.
