# گزارش پیاده‌سازی زیرسیستم «موجودی قابل سفارش» و چرخه سفارش نسیه (v1)
**تاریخ:** ۴ اسفند ۱۴۰۴  
**نسخه:** Nesyeh Orderable Inventory Implementation v1.0  
**وضعیت:** پیاده‌سازی و تست کاملاً موفق (۱۰۰٪ مستقل از سیستم حسابداری)

---

## ۱. خلاصه‌ی اجرایی
در فاز چهارم از توسعه معماری مستقل «نماینده نسیه»، زیرسیستم **«موجودی قابل سفارش» (Orderable Inventory)** و **چرخه سفارش خریدهای نسیه (Purchase Order Lifecycle)** طراحی، پیاده‌سازی و نهایی گردید. 

این ماژول به نمایندگان نسیه اجازه می‌دهد کالاهای مجاز تعیین‌شده توسط مدیریت را در ویترین اختصاصی مشاهده، انتخاب و درخواست سفارش جدید ثبت نمایند. مدیران ارشد نیز از طریق ماژول اختصاصی مدیریت موجودی نسیه در پنل مدیریت، قادر به افزودن کالا به ویترین نسیه، تعیین قیمت پیشنهادی نسیه، تنظیم ظرفیت قابل سفارش، و مدیریت وضعیت درخواست‌های سفارش (بررسی، تغییر تعداد درخواستی، تایید یا رد) می‌باشند.

---

## ۲. فهرست فایل‌های ایجادشده و تغییریافته

| نام فایل | وضعیت | توضیحات |
| :--- | :--- | :--- |
| `src/types.ts` | **تغییریافته** | تعریف ساختارهای جدید داده (`NesyehOrderableItem`, `NesyehPurchaseOrder`, `NesyehPurchaseOrderItem`, `NesyehPurchaseOrderStatus`) و توسعه `AppState` |
| `src/components/NesyehInventoryAndOrdersManager.tsx` | **ایجادشده** | کامپوننت مدیریتی مستقل برای کنترل ویترین کالاهای نسیه و مدیریت درخواست‌های سفارش در پنل مدیریت |
| `src/components/NesyehPartnerDashboard.tsx` | **تغییریافته** | توسعه تب ویترین کالاها، افزودن سبد خرید تعاملی، ثبت درخواست سفارش و مشاهده تاریخچه سفارشات در پنل نماینده نسیه |
| `src/components/AgentManager.tsx` | **تغییریافته** | افزودن تب «مدیریت موجودی و سفارشات نسیه» در مرکز مدیریت نمایندگان |
| `Nesyeh_Orderable_Inventory_Implementation_Report_v1.md` | **ایجادشده** | سند گزارش رسمی پیاده‌سازی فاز چهارم |

---

## ۳. ساختارهای داده جدید (Data Structures)

در فایل `src/types.ts` ساختارهای زیر اضافه شدند:

```typescript
// وضعیت‌های چرخه سفارش خرید نسیه
export type NesyehPurchaseOrderStatus = 
  | 'DRAFT' 
  | 'SUBMITTED' 
  | 'UNDER_REVIEW' 
  | 'MODIFIED_BY_COMPANY' 
  | 'APPROVED' 
  | 'REJECTED' 
  | 'READY' 
  | 'SHIPPED' 
  | 'DELIVERED';

// کالاهای موجود در ویترین قابل سفارش نسیه
export interface NesyehOrderableItem {
  id: string;
  productId: string;
  code: string;
  name: string;
  brand?: string;
  category?: string;
  image?: string;
  description?: string;
  cashPrice: number;            // قیمت نقدی پایه
  suggestedNesyehPrice: number; // قیمت پیشنهادی خرید نسیه
  orderableCapacity: number;    // ظرفیت قابل سفارش (عددی کاملاً مجازی)
  isActive: boolean;
  priority: number;
  badge?: 'NEW' | 'SPECIAL' | 'HOT' | 'LIMITED';
  createdAt: string;
  updatedAt: string;
}

// اقلام درون هر سفارش خرید نسیه
export interface NesyehPurchaseOrderItem {
  id: string;
  orderableItemId: string;
  productId: string;
  productName: string;
  productCode: string;
  requestedQuantity: number;
  approvedQuantity?: number;
  cashPrice: number;
  unitPrice: number;
  totalPrice: number;
}

// سند سفارش خرید نسیه
export interface NesyehPurchaseOrder {
  id: string;
  orderNumber: string;
  partnerId: string;
  partnerName: string;
  storeName?: string;
  orderDate: string;
  items: NesyehPurchaseOrderItem[];
  totalAmount: number;
  partnerNotes?: string;
  adminNotes?: string;
  status: NesyehPurchaseOrderStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
}
```

---

## ۴. گردش کار و چرخه سفارش (Order Lifecycle Workflow)

۱. **مدیریت ویترین نسیه (Admin):**
   - مدیر از طریق «مرکز مدیریت نمایندگان» و تب «موجودی و سفارشات نسیه» اقدام به افزودن یا ویرایش کالاها می‌کند.
   - تعیین قیمت نقدی، قیمت پیشنهادی نسیه و **ظرفیت قابل سفارش (Orderable Capacity)** انجام می‌شود.
   - این ظرفیت **هیچ ارتباطی با انبار واقعی شرکت ندارد** و صرفاً یک سقف مجازی نمایش در ویترین است.

۲. **ثبت درخواست سفارش توسط نماینده (Partner):**
   - نماینده نسیه با ورود به پنل خود و تب «ویترین کالاها»، اقلام مورد نیاز را با تعداد مشخص به سبد سفارش می‌افزاید.
   - سیستم پیش از اجازه ثبت سفارش، وضعیت سقف خرید نسیه و مانده تعهدات نماینده را کنترل می‌کند (`canCreateNesyehOrder`).
   - پس از تایید، یک رکورد `NesyehPurchaseOrder` با وضعیت `SUBMITTED` ایجاد می‌شود.

۳. **بررسی و تعیین تکلیف مدیریت (Admin Review):**
   - مدیر لیست سفارشات دریافتی را مشاهده کرده و می‌تواند:
     - سفارش را بدون تغییر تایید کند (`APPROVED`).
     - تعداد اقلام درخواستی را اصلاح نموده و وضعیت را به `MODIFIED_BY_COMPANY` یا `APPROVED` تغییر دهد.
     - سفارش را با ذکر علت رد نماید (`REJECTED`).
     - وضعیت ارسال را به `READY` (آماده ارسال)، `SHIPPED` (ارسال‌شده) یا `DELIVERED` (تحویل‌شده) تغییر دهد.

---

## ۵. اثبات ایزوله‌سازی و عدم تاثیر بر حسابداری و انبار (Accounting & Warehouse Isolation)

- **فایل `src/utils/accounting.ts`:** به هیچ عنوان دستخوش تغییر نشد (تغییرات: ۰ بیت).
- **اسناد حسابداری (Vouchers):** ثبت یا تغییر وضعیت سفارش نسیه **هیچ سند حسابداری (کاسه/دفتر کل/معین)** صادر یا ویرایش نمیکند.
- **انبار و موجودی واقعی (Warehouse & Stock):** موجودی واقعی کالاها در جدول `Warehouse` و `Product.stock` کسر یا رزرو نمی‌شود.
- **اعتبار نمایندگان اعتباری:** پنل نماینده اعتباری (`PartnerDashboard.tsx`) دستخوش هیچ‌گونه افزودن کد یا شرط تداخل‌زا نگردید.

---

## ۶. نتایج تست‌ها و اعتبارسنجی (Verification & Regression Results)

۱. **تست کامپایل پروژه (`compile_applet`):**  
   - نتیجه: **Build succeeded - the applet is compiled successfully** (بدون هیچ خطای تایپ اسکریپت یا سینتکس).

۲. **تست‌های رگرسیون حسابداری (`npm run test:accounting`):**  
   - نتیجه: **۸ از ۸ مجموعه تست کاملاً موفق (8/8 Suites Passed)**.  
   - تایید کامل سلامت هسته حسابداری، ثبت اسناد، دفترچه اقساط، چک‌ها و کسر موجودی انبار.

---

## ۷. نتیجه‌گیری
فاز چهارم معماری نماینده نسیه با موفقیت کامل پیاده‌سازی و تست گردید. تمامی فرآیندهای مربوط به ویترین کالا و ثبت سفارش به صورت مستقل، امن و ایزوله عمل می‌کنند.
