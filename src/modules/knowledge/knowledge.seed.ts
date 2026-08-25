import { 
  KnowledgeCategory, 
  KnowledgeArticle, 
  KnowledgeStep, 
  KnowledgeError, 
  KnowledgeGlossary, 
  KnowledgeVersion 
} from './knowledge.types';

export const DEFAULT_KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  { id: 'cat_sales', title: 'مدیریت فروش و فاکتورها', description: 'آموزش‌های مربوط به ثبت و ویرایش انواع فاکتورها، سود فاکتور و بهای تمام‌شده', displayOrder: 1 },
  { id: 'cat_accounting', title: 'حسابداری و اسناد مالی', description: 'دفاتر مالی روزنامه و کل، تراز آزمایشی، کدهای تفصیلی و معین و اسناد دوبل', displayOrder: 2 },
  { id: 'cat_installments', title: 'مدیریت فروش اقساطی', description: 'فرآیند ثبت اقساط، طرح‌های اعتباری بتا/طلا و فرمول‌های محاسبه بهره و جرایم', displayOrder: 3 },
  { id: 'cat_checks', title: 'مدیریت چک‌ها و اوراق بهادار', description: 'ثبت، وصول، برگشت و واگذاری چک‌های صیادی و ثبت اسناد دریافتنی/پرداختنی', displayOrder: 4 },
  { id: 'cat_inventory', title: 'انبارداری و موجودی کالا', description: 'رسید ورود کالا، حواله خروج، کاردکس انبار و روش‌های ارزش‌گذاری کالا', displayOrder: 5 },
  { id: 'cat_reps', title: 'مدیریت نمایندگان و همکاران', description: 'کیف پول اعتباری، ثبت تضامین و مدارک همکار و ثبت پیش‌فاکتورها', displayOrder: 6 }
];

export const DEFAULT_KNOWLEDGE_ARTICLES: KnowledgeArticle[] = [
  {
    id: 'art_sales_invoice',
    categoryId: 'cat_sales',
    knowledgeCode: 'INV-001',
    title: 'ثبت فاکتور فروش',
    content: 'برای ثبت فاکتور فروش جدید، ابتدا به بخش فاکتورها رفته و دکمه "صدور فاکتور جدید" را بزنید. سپس مشتری، انبار مرجع، و محصولات موردنظر را با تعداد و فی مشخص انتخاب کنید. سیستم به صورت خودکار سود فاکتور، بهای تمام‌شده بر اساس روش میانگین موزون یا FIFO و اسناد حسابداری مرتبط را محاسبه و پیش‌نویس می‌کند. در صورت تایید نهایی، سند مالی مربوطه صادر خواهد شد.',
    targetRoute: 'invoices',
    searchKeywords: ['فروش', 'فاکتور', 'فاکتور فروش', 'سود فاکتور', 'صادر'],
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'art_check_deposit',
    categoryId: 'cat_checks',
    knowledgeCode: 'CHK-014',
    title: 'ثبت چک دریافتی',
    content: 'ثبت و پیگیری چک‌های دریافتی از مشتریان. چک‌های دریافتی به عنوان اسناد دریافتنی در وضعیت سررسید نشده ثبت می‌شوند. هنگام وصول یا واگذاری چک، وضعیت آن در سیستم به "وصول شده" تغییر می‌یابد و آرتیکل حسابداری متناظر صادر می‌شود.',
    targetRoute: 'checks',
    searchKeywords: ['چک', 'دریافتی', 'وصول', 'واگذاری', 'اسناد دریافتنی'],
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'art_installment_cancel',
    categoryId: 'cat_installments',
    knowledgeCode: 'INS-023',
    title: 'ابطال دفترچه اقساط',
    content: 'در صورتی که مشتری تمایل به تسویه زودهنگام یا انصراف داشته باشد، می‌توانید نسبت به ابطال دفترچه اقساط اقدام کنید. ابطال دفترچه باعث لغو تراکنش‌های قسطی آینده و برگشت مانده بدهی به حساب معین مشتری می‌شود. آرتیکل‌های تعدیل کارمزد نیز صادر خواهند شد.',
    targetRoute: 'installments',
    searchKeywords: ['اقساط', 'دفترچه', 'ابطال', 'تسویه', 'انصراف'],
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'art_rep_register',
    categoryId: 'cat_reps',
    knowledgeCode: 'REP-041',
    title: 'ثبت نماینده و همکار جدید',
    content: 'برای همکاری با فروشگاه‌های طرف قرارداد، ابتدا باید نماینده جدید در سیستم تعریف شود. پس از تعریف نماینده، می‌توانید مدارک ضمانت، سقف اعتبار اختصاصی و کیف پول اعتباری را تنظیم کنید. نمایندگان امکان خرید اعتباری از کیف پول را بر اساس مجوزها خواهند داشت.',
    targetRoute: 'people',
    searchKeywords: ['نماینده', 'همکار', 'کیف پول', 'اعتبار', 'مدارک'],
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: 'art_stk_receipt',
    categoryId: 'cat_inventory',
    knowledgeCode: 'STK-051',
    title: 'رسید ورود انبار',
    content: 'عملیات ثبت رسید ورود کالا به انبار جهت افزایش موجودی فیزیکی و بهای تمام‌شده. این رسید معمولاً بر اساس فاکتور خرید یا انتقال بین انبارها صادر می‌شود. ارزش کالا در موجودی اولیه با ارزش کارشناسی یا فاکتور خرید تراز می‌گردد.',
    targetRoute: 'warehouses',
    searchKeywords: ['انبار', 'رسید', 'موجودی', 'کالا', 'ورود'],
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export const DEFAULT_KNOWLEDGE_STEPS: KnowledgeStep[] = [
  { id: 'step_sales_1', articleId: 'art_sales_invoice', stepNumber: 1, title: 'ورود به منوی فاکتورها', description: 'از منوی کناری سمت راست، روی گزینه "فاکتورها" کلیک کنید.' },
  { id: 'step_sales_2', articleId: 'art_sales_invoice', stepNumber: 2, title: 'افزودن فاکتور فروش', description: 'روی دکمه "صدور فاکتور جدید" در بالای صفحه کلیک کنید.' },
  { id: 'step_sales_3', articleId: 'art_sales_invoice', stepNumber: 3, title: 'انتخاب خریدار و محصولات', description: 'نام خریدار را انتخاب کرده و ردیف‌های محصول را اضافه نمایید. تعداد و مبالغ را وارد کرده و روش تسویه را مشخص نمایید.' },
  { id: 'step_sales_4', articleId: 'art_sales_invoice', stepNumber: 4, title: 'ثبت و صدور سند حسابداری', description: 'روی دکمه "ذخیره فاکتور" کلیک کنید تا فاکتور ثبت شده و سند مالی آن به طور خودکار صادر شود.' }
];

export const DEFAULT_KNOWLEDGE_ERRORS: KnowledgeError[] = [
  { id: 'err_sales_neg', errorCode: 'ERR-STK-002', errorTitle: 'خطای موجودی منفی انبار', cause: 'موجودی فیزیکی محصول انتخابی در انبار مشخص شده کمتر از تعداد درخواستی در فاکتور است و گزینه "جلوگیری از موجودی منفی" در تنظیمات فعال است.', solution: 'ابتدا موجودی محصول را از طریق "رسید ورود انبار" افزایش دهید یا انبار دیگری که کالا در آن موجود است را انتخاب کنید. همچنین می‌توانید موقتاً کنترل موجودی منفی را در تنظیمات سیستم غیرفعال نمایید.', articleId: 'art_sales_invoice' },
  { id: 'err_sales_credit', errorCode: 'ERR-CRD-005', errorTitle: 'تجاوز از سقف اعتبار مشتری', cause: 'مجموع بدهی‌های فعلی مشتری به همراه مبلغ فاکتور جدید، از سقف اعتبار تعیین شده برای وی فراتر می‌رود.', solution: 'در بخش مدیریت اشخاص سقف اعتبار مشتری را افزایش دهید یا از مشتری بخواهید بخشی از بدهی خود یا مبلغ فاکتور جدید را به صورت نقدی یا چک تسویه نماید.', articleId: 'art_sales_invoice' }
];

export const DEFAULT_KNOWLEDGE_GLOSSARY: KnowledgeGlossary[] = [
  { id: 'glo_1', term: 'دفتر روزنامه', definition: 'دفتری که در آن کلیه رویدادهای مالی و معاملات تجاری یک واحد اقتصادی به ترتیب تاریخ وقوع، بدهکار و بستانکار ثبت می‌شوند.', relatedTerms: ['سند حسابداری', 'دفتر کل'] },
  { id: 'glo_2', term: 'بهای تمام شده کالای فروش رفته', definition: 'مجموع هزینه‌های مستقیم مربوط به تولید یا خرید کالاهایی که در یک دوره مالی به فروش رسیده‌اند (بر اساس روش میانگین یا FIFO).', relatedTerms: ['انبارداری', 'سود ناخالص'] },
  { id: 'glo_3', term: 'روش ارزیابی میانگین موزون', definition: 'روشی برای محاسبه بهای تمام‌شده موجودی انبار که در آن ارزش کالای آماده برای فروش بر تعداد واحدهای موجود تقسیم می‌شود تا نرخ متوسط محاسبه شود.', relatedTerms: ['انبار', 'بهای تمام شده'] },
  { id: 'glo_4', term: 'سقف اعتبار', definition: 'حداکثر بدهی مجازی که یک مشتری یا نماینده می‌تواند در معاملات اعتباری و غیرنقدی نزد مجموعه داشته باشد.', relatedTerms: ['نماینده', 'خرید اعتباری'] }
];

export const DEFAULT_KNOWLEDGE_VERSIONS: KnowledgeVersion[] = [
  { id: 'ver_1', articleId: 'art_sales_invoice', version: 'v1.2.0', compatibleAppVersion: 'v2.4+', changeLog: 'اضافه شدن سود ناخالص به ردیف‌های فاکتور و اعمال تخفیف بر اساس سقف تخفیف نقش کاربر.' }
];
