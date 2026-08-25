/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  Person, 
  Product, 
  AccountSubsidiary, 
  JournalVoucher, 
  Check, 
  Invoice, 
  VoucherEntry,
  ReceivedCheckState,
  PaidCheckState,
  BouncedReceivedCheckSubState,
  BouncedPaidCheckSubState,
  AppState,
  InstallmentPlan,
  InstallmentRequest,
  InstallmentBook,
  BankTerminal,
  WarehouseTransfer,
  Role,
  Permission,
  RolePermission,
  KnowledgeCategory,
  KnowledgeArticle,
  KnowledgeStep,
  KnowledgeError,
  KnowledgeGlossary,
  KnowledgeVersion,
  OpeningBalance,
  InvoiceItem,
  BusinessPartner
} from '../types';
import { getCurrentJalaliDate, parseJalali, jalaliToGregorian } from './jalali';
import { resolvePartnerCreditRules } from './partnerProcess';
import { loadKnowledgeState, saveKnowledgeState, clearKnowledgeState } from '../modules/knowledge/knowledge.storage';
import { pushAppStateToCentral } from '../services/centralSyncService';

// Seed initial custom roles and permissions for RBAC
export const DEFAULT_ROLES: Role[] = [
  {
    id: 'role_super_admin',
    name: 'مدیر ارشد',
    description: 'دسترسی کامل به تمامی بخش‌های سیستم',
    isSystemRole: true,
    isActive: true,
    maximumDiscountPercent: 100,
    maximumCreditLimit: 1000000000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'role_seller',
    name: 'فروشنده',
    description: 'ثبت فاکتورهای فروش و مدیریت مشتریان کالا',
    isSystemRole: true,
    isActive: true,
    maximumDiscountPercent: 15,
    maximumCreditLimit: 500000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'role_stock_keeper',
    name: 'انباردار',
    description: 'مدیریت کالاها، انبارها و ورود و خروج کالا',
    isSystemRole: true,
    isActive: true,
    maximumDiscountPercent: 0,
    maximumCreditLimit: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'role_visitor',
    name: 'ویزیتور',
    description: 'ثبت پیش‌فاکتور و پیگیری مشتریان',
    isSystemRole: true,
    isActive: true,
    maximumDiscountPercent: 5,
    maximumCreditLimit: 100000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'role_representative',
    name: 'نماینده / فروشگاه طرف قرارداد',
    description: 'ثبت اقساط، بارگذاری مدارک ضمانت و خریدهای اعتباری',
    isSystemRole: true,
    isActive: true,
    maximumDiscountPercent: 10,
    maximumCreditLimit: 2000000000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
];

export const DEFAULT_PERMISSIONS: Permission[] = [
  { id: 'ViewAccountingReports', name: 'مشاهده گزارش‌های حسابداری', description: 'دسترسی به دفاتر روزنامه، کل، معین و تراز آزمایشی', category: 'حسابداری' },
  { id: 'CreateInvoice', name: 'ثبت فاکتور خرید و فروش', description: 'امکان صدور فاکتورهای جدید خرید و فروش', category: 'فروش' },
  { id: 'EditInvoice', name: 'ویرایش فاکتور', description: 'امکان ویرایش فاکتورهای صادر شده قبلی', category: 'فروش' },
  { id: 'DeleteInvoice', name: 'حذف فاکتور', description: 'امکان حذف فاکتورها و اسناد وابسته', category: 'فروش' },
  { id: 'ViewCostPrice', name: 'مشاهده بهای تمام شده', description: 'امکان مشاهده بهای تمام شده کالاها در انبار و گزارش‌ها', category: 'حسابداری' },
  { id: 'ViewProfit', name: 'مشاهده سود زیان', description: 'مشاهده میزان سود فاکتورها و سود ناخالص در گزارش‌ها', category: 'حسابداری' },
  { id: 'CreateWarehouseReceipt', name: 'ثبت رسید انبار / موجودی اولیه', description: 'امکان ثبت موجودی اولیه و حواله/رسید انبار', category: 'انبارداری' },
  { id: 'CreateCustomer', name: 'ثبت و ویرایش مشتریان', description: 'امکان تعریف مشتری جدید یا ویرایش اطلاعات افراد', category: 'فروش' },
  { id: 'CreateRepresentativeCustomer', name: 'ثبت نماینده / همکار جدید', description: 'امکان ثبت نمایندگان اعتباری یا فروشگاه‌های طرف قرارداد', category: 'نمایندگی' },
  { id: 'UploadRepresentativeDocuments', name: 'بارگذاری اسناد و مدارک همکار', description: 'امکان آپلود تصاویر مدارک و تضامین همکار', category: 'نمایندگی' },
  { id: 'AccessCreditPurchase', name: 'دسترسی خرید اعتباری نماینده', description: 'امکان خرید اعتباری توسط نماینده از کیف پول اختصاصی', category: 'نمایندگی' },
  { id: 'AccessInvestmentSales', name: 'دسترسی فروش با سرمایه مجموعه', description: 'امکان فروش مستقیم کالا از سرمایه اختصاصی مجموعه', category: 'نمایندگی' },
  { id: 'ManageUsersAndRoles', name: 'مدیریت کاربران، نقش‌ها و مجوزها', description: 'دسترسی کامل به مدیریت کاربران و انتساب نقش‌ها و سطوح دسترسی (RBAC)', category: 'مدیریت سیستم' },
];

export const DEFAULT_ROLE_PERMISSIONS: RolePermission[] = [
  // Super Admin: All true
  ...DEFAULT_PERMISSIONS.map(p => ({ roleId: 'role_super_admin', permissionId: p.id, allow: true })),
  
  // Seller
  { roleId: 'role_seller', permissionId: 'CreateInvoice', allow: true },
  { roleId: 'role_seller', permissionId: 'CreateCustomer', allow: true },
  { roleId: 'role_seller', permissionId: 'ViewAccountingReports', allow: false },
  { roleId: 'role_seller', permissionId: 'EditInvoice', allow: false },
  { roleId: 'role_seller', permissionId: 'DeleteInvoice', allow: false },
  { roleId: 'role_seller', permissionId: 'ViewCostPrice', allow: false },
  { roleId: 'role_seller', permissionId: 'ViewProfit', allow: false },
  { roleId: 'role_seller', permissionId: 'CreateWarehouseReceipt', allow: false },
  { roleId: 'role_seller', permissionId: 'CreateRepresentativeCustomer', allow: false },
  { roleId: 'role_seller', permissionId: 'UploadRepresentativeDocuments', allow: false },
  { roleId: 'role_seller', permissionId: 'AccessCreditPurchase', allow: false },
  { roleId: 'role_seller', permissionId: 'AccessInvestmentSales', allow: false },
  { roleId: 'role_seller', permissionId: 'ManageUsersAndRoles', allow: false },

  // Stock Keeper
  { roleId: 'role_stock_keeper', permissionId: 'CreateWarehouseReceipt', allow: true },
  { roleId: 'role_stock_keeper', permissionId: 'CreateInvoice', allow: false },
  { roleId: 'role_stock_keeper', permissionId: 'CreateCustomer', allow: false },
  { roleId: 'role_stock_keeper', permissionId: 'ViewAccountingReports', allow: false },
  { roleId: 'role_stock_keeper', permissionId: 'EditInvoice', allow: false },
  { roleId: 'role_stock_keeper', permissionId: 'DeleteInvoice', allow: false },
  { roleId: 'role_stock_keeper', permissionId: 'ViewCostPrice', allow: true },
  { roleId: 'role_stock_keeper', permissionId: 'ViewProfit', allow: false },
  { roleId: 'role_stock_keeper', permissionId: 'CreateRepresentativeCustomer', allow: false },
  { roleId: 'role_stock_keeper', permissionId: 'UploadRepresentativeDocuments', allow: false },
  { roleId: 'role_stock_keeper', permissionId: 'AccessCreditPurchase', allow: false },
  { roleId: 'role_stock_keeper', permissionId: 'AccessInvestmentSales', allow: false },
  { roleId: 'role_stock_keeper', permissionId: 'ManageUsersAndRoles', allow: false },

  // Visitor
  { roleId: 'role_visitor', permissionId: 'CreateInvoice', allow: true },
  { roleId: 'role_visitor', permissionId: 'CreateCustomer', allow: true },
  { roleId: 'role_visitor', permissionId: 'ViewAccountingReports', allow: false },
  { roleId: 'role_visitor', permissionId: 'EditInvoice', allow: false },
  { roleId: 'role_visitor', permissionId: 'DeleteInvoice', allow: false },
  { roleId: 'role_visitor', permissionId: 'ViewCostPrice', allow: false },
  { roleId: 'role_visitor', permissionId: 'ViewProfit', allow: false },
  { roleId: 'role_visitor', permissionId: 'CreateWarehouseReceipt', allow: false },
  { roleId: 'role_visitor', permissionId: 'CreateRepresentativeCustomer', allow: false },
  { roleId: 'role_visitor', permissionId: 'UploadRepresentativeDocuments', allow: false },
  { roleId: 'role_visitor', permissionId: 'AccessCreditPurchase', allow: false },
  { roleId: 'role_visitor', permissionId: 'AccessInvestmentSales', allow: false },
  { roleId: 'role_visitor', permissionId: 'ManageUsersAndRoles', allow: false },

  // Representative
  { roleId: 'role_representative', permissionId: 'CreateInvoice', allow: true },
  { roleId: 'role_representative', permissionId: 'CreateCustomer', allow: true },
  { roleId: 'role_representative', permissionId: 'ViewAccountingReports', allow: false },
  { roleId: 'role_representative', permissionId: 'EditInvoice', allow: false },
  { roleId: 'role_representative', permissionId: 'DeleteInvoice', allow: false },
  { roleId: 'role_representative', permissionId: 'ViewCostPrice', allow: false },
  { roleId: 'role_representative', permissionId: 'ViewProfit', allow: false },
  { roleId: 'role_representative', permissionId: 'CreateWarehouseReceipt', allow: false },
  { roleId: 'role_representative', permissionId: 'CreateRepresentativeCustomer', allow: true },
  { roleId: 'role_representative', permissionId: 'UploadRepresentativeDocuments', allow: true },
  { roleId: 'role_representative', permissionId: 'AccessCreditPurchase', allow: true },
  { roleId: 'role_representative', permissionId: 'AccessInvestmentSales', allow: true },
  { roleId: 'role_representative', permissionId: 'ManageUsersAndRoles', allow: false },
];

// Seed initial subsidiary accounts
export const DEFAULT_SUBSIDIARIES: AccountSubsidiary[] = [
  { id: 'SUB_BANK_MELI', generalType: 'بانک‌ها', groupType: 'دارایی‌های جاری', name: 'بانک ملی ایران', code: '10101' },
  { id: 'SUB_BANK_MELI_INT', generalType: 'اسناد در جریان وصول', groupType: 'دارایی‌های جاری', name: 'در جریان واریز بانک ملی', code: '1010199' },
  { id: 'SUB_BANK_MELLAT', generalType: 'بانک‌ها', groupType: 'دارایی‌های جاری', name: 'بانک ملت', code: '10102' },
  { id: 'SUB_BANK_MELLAT_INT', generalType: 'اسناد در جریان وصول', groupType: 'دارایی‌های جاری', name: 'در جریان واریز بانک ملت', code: '1010299' },
  { id: 'SUB_BANK_SADERAT', generalType: 'بانک‌ها', groupType: 'دارایی‌های جاری', name: 'بانک صادرات', code: '10103' },
  { id: 'SUB_BANK_SADERAT_INT', generalType: 'اسناد در جریان وصول', groupType: 'دارایی‌های جاری', name: 'در جریان واریز بانک صادرات', code: '1010399' },
  { id: 'SUB_BANK_PARSIAN', generalType: 'بانک‌ها', groupType: 'دارایی‌های جاری', name: 'بانک پارسیان', code: '10104' },
  { id: 'SUB_BANK_PARSIAN_INT', generalType: 'اسناد در جریان وصول', groupType: 'دارایی‌های جاری', name: 'در جریان واریز بانک پارسیان', code: '1010499' },
  { id: 'SUB_BANK_REFAH', generalType: 'بانک‌ها', groupType: 'دارایی‌های جاری', name: 'بانک رفاه', code: '10105' },
  { id: 'SUB_BANK_REFAH_INT', generalType: 'اسناد در جریان وصول', groupType: 'دارایی‌های جاری', name: 'در جریان واریز بانک رفاه', code: '1010599' },
  { id: 'SUB_BANK_IRANZAMIN', generalType: 'بانک‌ها', groupType: 'دارایی‌های جاری', name: 'بانک ایران زمین', code: '10106' },
  { id: 'SUB_BANK_IRANZAMIN_INT', generalType: 'اسناد در جریان وصول', groupType: 'دارایی‌های جاری', name: 'در جریان واریز بانک ایران زمین', code: '1010699' },
  { id: 'SUB_CASH_MAIN', generalType: 'صندوق‌ها', groupType: 'دارایی‌های جاری', name: 'صندوق اصلی', code: '10201' },
  { id: 'SUB_CASH_SHOP', generalType: 'صندوق‌ها', groupType: 'دارایی‌های جاری', name: 'صندوق فروشگاه', code: '10202' },
  { id: 'SUB_DEBTORS', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری', name: 'حساب‌های دریافتنی (بدهکاران تجاری عادی)', code: '10301' },
  { id: 'SUB_DEBTORS_INSTALLMENT', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری', name: 'اسناد دریافتنی (بدهکاران اقساطی)', code: '10302' },
  { id: 'SUB_PARTNER_WALLET', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری', name: 'کیف پول اعتباری همکاران (تفصیلی)', code: '10303' },
  { id: 'SUB_DEBTORS_AGENTS', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری', name: 'حساب‌های دریافتنی (نمایندگان فروش)', code: '10304' },
  { id: 'SUB_BETA_SYSTEM', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری', name: 'حساب واسط سامانه بتا (بانک رفاه - قرارداد عقیلی)', code: '10305' },
  { id: 'SUB_BETA_MEHDI', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری', name: 'حساب واسط سامانه بتا (بانک رفاه - قرارداد مهدی)', code: '10306' },
  { id: 'SUB_BETA_MANSOURI', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری', name: 'حساب واسط سامانه بتا (بانک رفاه - قرارداد منصوری)', code: '10307' },
  { id: 'SUB_BETA_HAMID', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری', name: 'حساب واسط سامانه بتا (بانک رفاه - قرارداد حمید)', code: '10308' },
  { id: 'SUB_BETA_JAFARI', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری', name: 'حساب واسط سامانه بتا (بانک رفاه - قرارداد جعفری)', code: '10309' },
  { id: 'SUB_CHECKS_REC', generalType: 'اسناد دریافتنی', groupType: 'دارایی‌های جاری', name: 'اسناد دریافتنی (چک‌های صندوق)', code: '10401' },
  { id: 'SUB_CHECKS_TRANSIT', generalType: 'اسناد در جریان وصول', groupType: 'دارایی‌های جاری', name: 'اسناد در جریان وصول (واگذار شده)', code: '10402' },
  { id: 'SUB_INVENTORY', generalType: 'موجودی کالا', groupType: 'دارایی‌های جاری', name: 'موجودی کالا (انبار)', code: '10501' },
  { id: 'SUB_PRE_PAY', generalType: 'پیش‌پرداخت‌ها', groupType: 'دارایی‌های جاری', name: 'پیش‌پرداخت‌ها', code: '10601' },
  { id: 'SUB_VAT_BUY', generalType: 'پیش‌پرداخت‌ها', groupType: 'دارایی‌های جاری', name: 'مالیات بر ارزش افزوده خرید', code: '10602' },
  { id: 'SUB_DEFERRED_FEE', generalType: 'پیش‌پرداخت‌ها', groupType: 'دارایی‌های جاری', name: 'کارمزد در انتظار تحقق', code: '10603' },
  
  { id: 'SUB_CHECKS_PAY', generalType: 'اسناد پرداختنی', groupType: 'بدهی‌های جاری', name: 'اسناد پرداختنی (چک‌های صادرشده)', code: '20101' },
  { id: 'SUB_CREDITORS', generalType: 'بستانکاران تجاری', groupType: 'بدهی‌های جاری', name: 'حساب‌های پرداختنی (بستانکاران)', code: '20201' },
  { id: 'SUB_PRE_REC', generalType: 'پیش‌دریافت‌ها', groupType: 'بدهی‌های جاری', name: 'پیش‌دریافت‌ها', code: '20301' },
  { id: 'SUB_VAT_SELL', generalType: 'پیش‌دریافت‌ها', groupType: 'بدهی‌های جاری', name: 'مالیات بر ارزش افزوده فروش', code: '20302' },
  
  { id: 'SUB_EQUITY', generalType: 'سرمایه', groupType: 'حقوق صاحبان سهام', name: 'سرمایه اولیه', code: '50101' },
  
  { id: 'SUB_REVENUE', generalType: 'فروش کالا', groupType: 'درآمدها', name: 'فروش کالا و خدمات', code: '60101' },
  { id: 'SUB_COMMISSION_REV', generalType: 'درآمد کارمزد', groupType: 'درآمدها', name: 'درآمد کارمزد فروش اقساطی', code: '60102' },
  
  { id: 'SUB_COGS', generalType: 'بهای تمام شده کالای فروش رفته', groupType: 'هزینه‌ها', name: 'بهای تمام شده کالای فروش رفته', code: '70101' },
  { id: 'SUB_EXP_SALARY', generalType: 'هزینه‌های عمومی و اداری', groupType: 'هزینه‌ها', name: 'هزینه حقوق و دستمزد', code: '70201' },
  { id: 'SUB_EXP_BILLS', generalType: 'هزینه‌های عمومی و اداری', groupType: 'هزینه‌ها', name: 'هزینه قبوض (آب و برق و تلفن)', code: '70202' },
  { id: 'SUB_EXP_RENT', generalType: 'هزینه‌های عمومی و اداری', groupType: 'هزینه‌ها', name: 'هزینه اجاره غرفه/فروشگاه', code: '70203' },
  { id: 'SUB_EXP_CATERING', generalType: 'هزینه‌های عمومی و اداری', groupType: 'هزینه‌ها', name: 'هزینه چای، پذیرایی و آبدارخانه', code: '70205' },
  { id: 'SUB_EXP_TRANSPORT', generalType: 'هزینه‌های عمومی و اداری', groupType: 'هزینه‌ها', name: 'هزینه باربری و حمل و نقل', code: '70206' },
  { id: 'SUB_EXP_MISC', generalType: 'هزینه‌های عمومی و اداری', groupType: 'هزینه‌ها', name: 'سایر هزینه‌های عمومی و اداری', code: '70204' },
  
  { id: 'SUB_REV_COMMISSION', generalType: 'درآمد کارمزد', groupType: 'درآمدها', name: 'درآمد کارمزد فروش چکی و نسیه', code: '60201' },
  { id: 'SUB_INVESTORS', generalType: 'جاری شرکا و سرمایه‌گذاران', groupType: 'حقوق صاحبان سهام', name: 'جاری شرکا و سرمایه‌گذاران', code: '50102' },
  { id: 'SUB_LIAB_LOANS', generalType: 'تسهیلات دریافتی', groupType: 'بدهی‌های غیرجاری', name: 'تسهیلات و استقراض‌های دریافتی', code: '20401' },
  { id: 'SUB_EXP_FIN_INTEREST', generalType: 'هزینه‌های مالی', groupType: 'هزینه‌ها', name: 'هزینه مالی و بهره پرداختی (سود پول)', code: '70301' },
  { id: 'SUB_INTEREST_INCOME', generalType: 'درآمد کارمزد', groupType: 'درآمدها', name: 'درآمد حاصل از سود اقساط', code: '60103' },
  { id: 'SUB_OPENING_BAL', generalType: 'تراز افتتاحیه', groupType: 'حقوق صاحبان سهام', name: 'تراز افتتاحیه اول دوره', code: '99901' },
];

// IKC Defaults relocated to src/modules/knowledge/knowledge.seed.ts


export function loadAppState(): AppState {
  try {
    const isInitialized = localStorage.getItem('accounting_initialized') === 'true';
    const personsStr = localStorage.getItem('accounting_persons');
    // Note: products and productCategories are authoritative in PostgreSQL DB (migrations 06/28). Operational localStorage reads are disabled.
    const subsidiariesStr = localStorage.getItem('accounting_subsidiaries');
    const vouchersStr = localStorage.getItem('accounting_vouchers');
    const checksStr = localStorage.getItem('accounting_checks');
    const invoicesStr = localStorage.getItem('accounting_invoices');
    const openingBalancesStr = localStorage.getItem('accounting_opening_balances');
    const installmentBooksStr = localStorage.getItem('accounting_installment_books');
    const installmentsDetailsStr = localStorage.getItem('accounting_installments_details');
    const installmentsStr = localStorage.getItem('accounting_installments');
    // Note: businessPartners, partnerCreditRequests, creditFiles, and creditPolicies are authoritative in PostgreSQL DB. Operational localStorage reads are disabled.
    const businessPartnersStr = null;
    const partnerCreditRequestsStr = null;
    const partnerSalesPlansStr = localStorage.getItem('accounting_partner_sales_plans');
    const partnerOrdersStr = localStorage.getItem('accounting_partner_orders');
    const partnerSettlementsStr = localStorage.getItem('accounting_partner_settlements');
    const projectNotesStr = localStorage.getItem('project_notes');
    const creditFilesStr = null;
    const creditPoliciesStr = null;

    const rawVouchers = vouchersStr ? JSON.parse(vouchersStr) : [];
    
    // Cleanup: If the system contains sample data (identified by the seed voucher ID), clear the system.
    if (vouchersStr && vouchersStr.includes('seed_v_1')) {
      resetAppState();
      return {
        users: [],
        persons: [],
        products: [],
        productCategories: [],
        subsidiaries: DEFAULT_SUBSIDIARIES,
        vouchers: [],
        checks: [],
        invoices: [],
        openingBalances: [],
        installmentBooks: [],
        installments: [],
        installmentRequests: [],
        installmentPlans: [
          { id: 'beta', name: 'طرح بتا (بازنشستگان)', interestRate: 2, penaltyRate: 4, maxTerm: 12, prepaymentPercent: 0, isActive: true },
          { id: 'gold', name: 'طرح وثیقه طلا', interestRate: 1.5, penaltyRate: 3, maxTerm: 24, prepaymentPercent: 10, isActive: true },
          { id: 'partner', name: 'ضمانت همکار', interestRate: 3, penaltyRate: 5, maxTerm: 10, prepaymentPercent: 20, isActive: true },
        ],
        warehouses: [],
        warehouseTransfers: [],
        costCenters: [],
        bankTerminals: [],
        auditLogs: [],
        creditFiles: [],
        creditPolicies: [
          { id: 'pol_1', title: 'اعتبار خرد (تا ۵۰ میلیون تومان)', minAmount: 0, maxAmount: 50000000, needsValidation: true, needsBackSignature: false, needsCollateral: false, needsGuarantorInfo: false, needsGuarantorValidation: false, needsAmaniCheck: false, amaniReminderDays: 10, isActive: true },
          { id: 'pol_2', title: 'اعتبار متوسط (۵۰ تا ۲۰۰ میلیون تومان)', minAmount: 50000001, maxAmount: 200000000, needsValidation: true, needsBackSignature: true, needsCollateral: false, needsGuarantorInfo: true, needsGuarantorValidation: true, needsAmaniCheck: false, amaniReminderDays: 10, isActive: true },
          { id: 'pol_3', title: 'اعتبار کلان (بیش از ۲۰۰ میلیون تومان)', minAmount: 200000001, maxAmount: 5000000000, needsValidation: true, needsBackSignature: true, needsCollateral: true, needsGuarantorInfo: true, needsGuarantorValidation: true, needsAmaniCheck: true, amaniReminderDays: 10, isActive: true },
        ],
        calculators: [],
        settings: {
          inventoryValuationMethod: 'WEIGHTED_AVERAGE',
          defaultWarehouseId: 'DEFAULT',
          companyName: 'سیستم حسابداری هوشمند'
        }
      };
    }

    const migratedVouchers = rawVouchers.map((v: any) => {
      // Map old commission subsidiary to the operational installment commission subsidiary (Requirement 1)
      let entries = v.entries.map((e: any) => {
        if (e.subsidiaryId === 'SUB_REV_COMMISSION') {
          return { ...e, subsidiaryId: 'SUB_COMMISSION_REV' };
        }
        return e;
      });

      if (v.isAutomatic && v.sourceType === 'check_state_change') {
        const hasSubDebtorsOrCreditors = entries.some((e: any) => 
          ['SUB_DEBTORS', 'SUB_DEBTORS_INSTALLMENT', 'SUB_PARTNER_WALLET', 'SUB_DEBTORS_AGENTS', 'SUB_CREDITORS'].includes(e.subsidiaryId)
        );
        entries = entries.map((e: any) => {
          if (e.floatingDetailed && e.floatingDetailed.type === 'person') {
            const isTradeAccount = ['SUB_DEBTORS', 'SUB_DEBTORS_INSTALLMENT', 'SUB_PARTNER_WALLET', 'SUB_DEBTORS_AGENTS', 'SUB_CREDITORS'].includes(e.subsidiaryId);
            if (!isTradeAccount && hasSubDebtorsOrCreditors) {
              const { floatingDetailed, ...rest } = e;
              return rest;
            }
          }
          return e;
        });
      }

      return { ...v, entries };
    });

    // const warehousesStr = localStorage.getItem('accounting_warehouses'); // Disabled: warehouses are DB authoritative
    // const transfersStr = localStorage.getItem('accounting_transfers'); // Disabled: warehouse transfers are DB authoritative
    const costCentersStr = localStorage.getItem('accounting_cost_centers');
    const logsStr = localStorage.getItem('accounting_audit_logs');
    const settingsStr = localStorage.getItem('accounting_settings');

    let parsedPersons = personsStr ? JSON.parse(personsStr) : [];
    
    // Auto-fix any persons that have role 'both' or no role
    let dataChanged = false;
    parsedPersons = parsedPersons.map((p: any) => {
       if (p.role === 'both' || !p.role) {
           dataChanged = true;
           return { ...p, role: 'debtor' };
       }
       return p;
    });

    if (dataChanged) {
      localStorage.setItem('accounting_persons', JSON.stringify(parsedPersons));
    }

    const state: AppState = {
      users: localStorage.getItem('accounting_users') ? JSON.parse(localStorage.getItem('accounting_users')!) : [],
      persons: parsedPersons,
      products: [],
      productCategories: [],
      subsidiaries: (() => {
        const loaded = subsidiariesStr ? JSON.parse(subsidiariesStr) : [...DEFAULT_SUBSIDIARIES];
        
        let addedMissing = false;
        // Merge missing defaults and sync system subsidiary definitions
        DEFAULT_SUBSIDIARIES.forEach(ds => {
          const idx = loaded.findIndex((s: any) => s.id === ds.id);
          if (idx === -1) {
            loaded.push(ds);
            addedMissing = true;
          } else {
            // Ensure properties of system subsidiaries are fully synced with system defaults
            const existing = loaded[idx];
            if (
              existing.name !== ds.name || 
              existing.code !== ds.code || 
              existing.generalType !== ds.generalType || 
              existing.groupType !== ds.groupType
            ) {
              loaded[idx] = { 
                ...existing, 
                name: ds.name, 
                code: ds.code, 
                generalType: ds.generalType, 
                groupType: ds.groupType 
              };
              addedMissing = true;
            }
          }
        });

        // Ensure SUB_DEBTORS_AGENTS is in the loaded list
        if (!loaded.some((s: any) => s.id === 'SUB_DEBTORS_AGENTS')) {
          loaded.push({ id: 'SUB_DEBTORS_AGENTS', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری', name: 'حساب‌های دریافتنی (نمایندگان فروش)', code: '10304' });
          addedMissing = true;
        }

        const mappedLoaded = loaded.map((s: any) => {
          if (s.id === 'SUB_DEBTORS_INSTALLMENT') {
            return { ...s, name: 'اسناد دریافتنی (بدهکاران اقساطی)' };
          }
          if (s.id === 'SUB_COMMISSION_REV') {
            return { ...s, name: 'درآمد کارمزد فروش اقساطی' };
          }
          return s;
        });

        if (addedMissing && subsidiariesStr) {
          localStorage.setItem('accounting_subsidiaries', JSON.stringify(mappedLoaded));
        }

        return mappedLoaded;
      })(),
      vouchers: migratedVouchers,
      checks: checksStr ? JSON.parse(checksStr) : [],
      invoices: invoicesStr ? JSON.parse(invoicesStr) : [],
      openingBalances: openingBalancesStr ? JSON.parse(openingBalancesStr) : [],
      // Note: installmentBooks and installments are authoritative in PostgreSQL DB (migrations 14/26/31). Operational localStorage reads are disabled.
      installmentBooks: [],
      installments: [],
      installmentRequests: installmentsStr ? JSON.parse(installmentsStr) : [],
      installmentPlans: localStorage.getItem('accounting_installment_plans') ? JSON.parse(localStorage.getItem('accounting_installment_plans')!) : [
        { id: 'beta', name: 'طرح بتا (بازنشستگان)', interestRate: 2, penaltyRate: 4, maxTerm: 12, prepaymentPercent: 0, isActive: true },
        { id: 'gold', name: 'طرح وثیقه طلا', interestRate: 1.5, penaltyRate: 3, maxTerm: 24, prepaymentPercent: 10, isActive: true },
        { id: 'partner', name: 'ضمانت همکار', interestRate: 3, penaltyRate: 5, maxTerm: 10, prepaymentPercent: 20, isActive: true },
      ],
      // Note: warehouses and warehouseTransfers are authoritative in PostgreSQL DB. Operational localStorage reads are disabled.
      warehouses: [],
      warehouseTransfers: [],
      costCenters: costCentersStr ? JSON.parse(costCentersStr) : [],
      bankTerminals: localStorage.getItem('accounting_bank_terminals') ? JSON.parse(localStorage.getItem('accounting_bank_terminals')!) : [],
      auditLogs: logsStr ? JSON.parse(logsStr) : [],
      settings: settingsStr ? JSON.parse(settingsStr) : {
        inventoryValuationMethod: 'WEIGHTED_AVERAGE',
        defaultWarehouseId: 'DEFAULT',
        companyName: 'سیستم حسابداری هوشمند'
      },
      businessPartners: businessPartnersStr
        ? JSON.parse(businessPartnersStr)
        : (isInitialized ? [] : [
            {
              id: 'BP_DEMO_1',
              personId: 'p_c_1',
              status: 'active',
              roles: ['CREDIT_SALES_AGENT'],
              profile: {
                partnerId: 'BP_DEMO_1',
                contractStatus: 'فعال',
                riskLevel: 'low',
                creditLimit: 500000000,
              },
              branches: [
                {
                  id: 'BR_1_1',
                  partnerId: 'BP_DEMO_1',
                  name: 'شعبه مرکزی (تهران)',
                  address: 'تهران، خیابان ولیعصر',
                  phone: '021-88888888',
                  managerName: 'علی رضایی',
                  isActive: true,
                  createdAt: new Date().toISOString()
                },
                {
                  id: 'BR_1_2',
                  partnerId: 'BP_DEMO_1',
                  name: 'شعبه غرب',
                  address: 'تهران، سعادت آباد',
                  phone: '021-22222222',
                  managerName: 'رضا علوی',
                  isActive: true,
                  createdAt: new Date().toISOString()
                }
              ],
              contract: {
                id: 'CON_1',
                partnerId: 'BP_DEMO_1',
                type: 'CREDIT_AGENT',
                startDate: '1402/01/01',
                status: 'active',
                creditLimit: 500000000,
                hasRepresentativeGuarantee: true,
                commissionRate: 2,
                createdAt: new Date().toISOString()
              },
              users: ['user_test_seller'],
              createdAt: new Date().toISOString(),
              createdBy: 'system'
            }
          ]),
      partnerCreditRequests: partnerCreditRequestsStr ? JSON.parse(partnerCreditRequestsStr) : [],
      partnerSalesPlans: partnerSalesPlansStr
        ? JSON.parse(partnerSalesPlansStr)
        : (isInitialized ? [] : [
            {
              id: 'PLAN_6M',
              name: 'طرح ۶ ماهه استاندارد',
              description: 'بازپرداخت ۶ ماهه با سود بانکی متعارف',
              isActive: true,
              minAmount: 10000000,
              maxAmount: 500000000,
              allowedTerms: [6],
              interestRate: 18,
              commissionRate: 20,
              paymentPeriods: [30]
            },
            {
              id: 'PLAN_12M',
              name: 'طرح ۱۲ ماهه بلند مدت',
              description: 'بازپرداخت یکساله برای خریدهای سرمایه‌ای',
              isActive: true,
              minAmount: 50000000,
              maxAmount: 1000000000,
              allowedTerms: [12],
              interestRate: 21,
              commissionRate: 15,
              paymentPeriods: [30, 60]
            },
            {
              id: 'PLAN_QUARTERLY',
              name: 'طرح فصلی (سه ماهه)',
              description: 'مناسب برای تامین کالای سریع',
              isActive: true,
              minAmount: 5000000,
              maxAmount: 200000000,
              allowedTerms: [3],
              interestRate: 15,
              commissionRate: 25,
              paymentPeriods: [30, 90]
            }
          ]),
      partnerOrders: partnerOrdersStr ? JSON.parse(partnerOrdersStr) : [],
      partnerSettlements: partnerSettlementsStr ? JSON.parse(partnerSettlementsStr) : [],
      projectNotes: projectNotesStr ? JSON.parse(projectNotesStr) : [],
      creditFiles: creditFilesStr ? JSON.parse(creditFilesStr) : [],
      creditPolicies: creditPoliciesStr ? JSON.parse(creditPoliciesStr) : [
        { id: 'pol_1', title: 'اعتبار خرد (تا ۵۰ میلیون تومان)', minAmount: 0, maxAmount: 50000000, needsValidation: true, needsBackSignature: false, needsCollateral: false, needsGuarantorInfo: false, needsGuarantorValidation: false, needsAmaniCheck: false, amaniReminderDays: 10, isActive: true },
        { id: 'pol_2', title: 'اعتبار متوسط (۵۰ تا ۲۰۰ میلیون تومان)', minAmount: 50000001, maxAmount: 200000000, needsValidation: true, needsBackSignature: true, needsCollateral: false, needsGuarantorInfo: true, needsGuarantorValidation: true, needsAmaniCheck: false, amaniReminderDays: 10, isActive: true },
        { id: 'pol_3', title: 'اعتبار کلان (بیش از ۲۰۰ میلیون تومان)', minAmount: 200000001, maxAmount: 5000000000, needsValidation: true, needsBackSignature: true, needsCollateral: true, needsGuarantorInfo: true, needsGuarantorValidation: true, needsAmaniCheck: true, amaniReminderDays: 10, isActive: true },
      ],
      calculators: []
    };

    // Merge missing default subsidiaries by unique ID
    const existingIds = new Set(state.subsidiaries.map(s => s.id));
    const missing = DEFAULT_SUBSIDIARIES.filter(s => !existingIds.has(s.id));
    if (missing.length > 0) {
      state.subsidiaries = [...state.subsidiaries, ...missing];
      localStorage.setItem('accounting_subsidiaries', JSON.stringify(state.subsidiaries));
    }

    // Auto-purge any Jafar and Baqir records that have installment issues as requested
    const hasJafarOrBaqir = state.persons.some(p => p.name.includes('جعفر') || p.name.includes('باقر'));
    if (hasJafarOrBaqir) {
      const idsToPurge = state.persons.filter(p => p.name.includes('جعفر') || p.name.includes('باقر')).map(p => p.id);
      
      state.persons = state.persons.filter(p => !idsToPurge.includes(p.id));
      
      const booksToPurge = state.installmentBooks.filter(b => idsToPurge.includes(b.personId));
      const bookIdsToPurge = booksToPurge.map(b => b.id);
      
      state.installmentBooks = state.installmentBooks.filter(b => !bookIdsToPurge.includes(b.id));
      state.installments = state.installments.filter(i => !bookIdsToPurge.includes(i.bookId));
      state.installmentRequests = state.installmentRequests.filter(r => !idsToPurge.includes(r.personId));
      
      localStorage.setItem('accounting_persons', JSON.stringify(state.persons));
      localStorage.setItem('accounting_installment_books', JSON.stringify(state.installmentBooks));
      localStorage.setItem('accounting_installments_details', JSON.stringify(state.installments));
      localStorage.setItem('accounting_installments', JSON.stringify(state.installmentRequests));
    }

    // Load and seed RBAC tables
    const loadedRoles = localStorage.getItem('accounting_roles') 
      ? JSON.parse(localStorage.getItem('accounting_roles')!) 
      : [...DEFAULT_ROLES];
    const loadedPermissions = localStorage.getItem('accounting_permissions') 
      ? JSON.parse(localStorage.getItem('accounting_permissions')!) 
      : [...DEFAULT_PERMISSIONS];
    const loadedRolePermissions = localStorage.getItem('accounting_role_permissions') 
      ? JSON.parse(localStorage.getItem('accounting_role_permissions')!) 
      : [...DEFAULT_ROLE_PERMISSIONS];

    if (!localStorage.getItem('accounting_roles')) {
      localStorage.setItem('accounting_roles', JSON.stringify(loadedRoles));
    }
    if (!localStorage.getItem('accounting_permissions')) {
      localStorage.setItem('accounting_permissions', JSON.stringify(loadedPermissions));
    }
    if (!localStorage.getItem('accounting_role_permissions')) {
      localStorage.setItem('accounting_role_permissions', JSON.stringify(loadedRolePermissions));
    }

    // Check for test users and append them if missing
    let usersList = state.users || [];
    let usersUpdated = false;

    if (usersUpdated) {
      state.users = usersList;
      localStorage.setItem('accounting_users', JSON.stringify(usersList));
    }

    // Populate role fields on existing users if not set
    let usersModified = false;
    usersList = usersList.map(u => {
      if (!u.roleId) {
        usersModified = true;
        // Assign default roles based on userRole if matching
        if (u.role === 'admin') return { ...u, roleId: 'role_super_admin' };
        if (u.role === 'seller') return { ...u, roleId: 'role_seller' };
        if (u.role === 'agent') return { ...u, roleId: 'role_representative' };
        return { ...u, roleId: 'role_seller' }; // fallback
      }
      return u;
    });

    if (usersModified) {
      state.users = usersList;
      localStorage.setItem('accounting_users', JSON.stringify(usersList));
    }

    state.roles = loadedRoles;
    state.permissions = loadedPermissions;
    state.rolePermissions = loadedRolePermissions;

    // Load and seed Knowledge Center tables via isolated storage
    const kState = loadKnowledgeState();
    state.knowledgeCategories = kState.categories;
    state.knowledgeArticles = kState.articles;
    state.knowledgeSteps = kState.steps;
    state.knowledgeErrors = kState.errors;
    state.knowledgeGlossary = kState.glossary;
    state.knowledgeVersions = kState.versions;

    if (!isInitialized) {
      localStorage.setItem('accounting_initialized', 'true');
    }

    return state;
  } catch (e) {
    console.error("Error loading app state", e);
    return {
      users: [],
      persons: [],
      products: [],
      productCategories: [],
      subsidiaries: DEFAULT_SUBSIDIARIES,
      vouchers: [],
      checks: [],
      invoices: [],
      openingBalances: [],
      installmentBooks: [],
      installments: [],
      installmentRequests: [],
      installmentPlans: [
        { id: 'beta', name: 'طرح بتا (بازنشستگان)', interestRate: 2, penaltyRate: 4, maxTerm: 12, prepaymentPercent: 0, isActive: true },
        { id: 'gold', name: 'طرح وثیقه طلا', interestRate: 1.5, penaltyRate: 3, maxTerm: 24, prepaymentPercent: 10, isActive: true },
        { id: 'partner', name: 'ضمانت همکار', interestRate: 3, penaltyRate: 5, maxTerm: 10, prepaymentPercent: 20, isActive: true },
      ],
      warehouses: [],
      warehouseTransfers: [],
      costCenters: [],
      bankTerminals: [],
      auditLogs: [],
      creditFiles: [],
      creditPolicies: [],
      calculators: [],
      settings: {
        inventoryValuationMethod: 'WEIGHTED_AVERAGE',
        defaultWarehouseId: 'DEFAULT',
        companyName: 'سیستم حسابداری هوشمند'
      },
      knowledgeCategories: [],
      knowledgeArticles: [],
      knowledgeSteps: [],
      knowledgeErrors: [],
      knowledgeGlossary: [],
      knowledgeVersions: []
    };
  }
}

export function saveAppState(state: AppState) {
  try {
    localStorage.setItem('accounting_initialized', 'true');

    // Auto-update hasActivity for persons and businessPartners
    const invoices = state.invoices || [];
    const installmentRequests = state.installmentRequests || [];
    const vouchers = state.vouchers || [];
    const checks = state.checks || [];
    const partnerOrders = state.partnerOrders || [];
    const partnerSettlements = state.partnerSettlements || [];
    const partnerCreditRequests = state.partnerCreditRequests || [];
    const businessPartners = state.businessPartners || [];

    if (state.persons) {
      state.persons.forEach(person => {
        const bp = businessPartners.find(b => b.personId === person.id);
        const hasAct = 
          person.hasActivity || 
          invoices.some(inv => inv.personId === person.id) ||
          installmentRequests.some(ir => ir.personId === person.id) ||
          vouchers.some(v => v.entries?.some((e: any) => e.floatingDetailed?.type === 'person' && e.floatingDetailed?.id === person.id)) ||
          checks.some(c => c.personId === person.id) ||
          (bp && (
            bp.hasActivity ||
            partnerOrders.some(o => o.businessPartnerId === bp.id) ||
            partnerSettlements.some(s => s.businessPartnerId === bp.id) ||
            partnerCreditRequests.some(cr => cr.businessPartnerId === bp.id)
          ));
        
        if (hasAct) {
          person.hasActivity = true;
          if (bp) {
            bp.hasActivity = true;
          }
        } else {
          person.hasActivity = person.hasActivity || false;
          if (bp) {
            bp.hasActivity = bp.hasActivity || false;
          }
        }
      });
    }

    if (businessPartners) {
      businessPartners.forEach(bp => {
        const person = state.persons?.find(p => p.id === bp.personId);
        const hasAct = 
          bp.hasActivity ||
          (person && person.hasActivity) ||
          partnerOrders.some(o => o.businessPartnerId === bp.id) ||
          partnerSettlements.some(s => s.businessPartnerId === bp.id) ||
          partnerCreditRequests.some(cr => cr.businessPartnerId === bp.id);
        
        if (hasAct) {
          bp.hasActivity = true;
          if (person) {
            person.hasActivity = true;
          }
        } else {
          bp.hasActivity = bp.hasActivity || false;
        }
      });
    }

    localStorage.setItem('accounting_persons', JSON.stringify(state.persons));
    // Note: products and productCategories are authoritative in PostgreSQL DB (migrations 06/28). Operational localStorage writes are disabled.
    localStorage.setItem('accounting_subsidiaries', JSON.stringify(state.subsidiaries));
    localStorage.setItem('accounting_vouchers', JSON.stringify(state.vouchers));
    localStorage.setItem('accounting_checks', JSON.stringify(state.checks));
    localStorage.setItem('accounting_invoices', JSON.stringify(state.invoices));
    localStorage.setItem('accounting_opening_balances', JSON.stringify(state.openingBalances));
    // Note: installmentBooks and installments are authoritative in PostgreSQL DB (migrations 14/26/31). Operational localStorage writes are disabled.
    // localStorage.setItem('accounting_installment_books', JSON.stringify(state.installmentBooks));
    // localStorage.setItem('accounting_installments_details', JSON.stringify(state.installments));
    localStorage.setItem('accounting_installments', JSON.stringify(state.installmentRequests));
    localStorage.setItem('accounting_installment_plans', JSON.stringify(state.installmentPlans));
    // Note: warehouses and transfers are authoritative in PostgreSQL DB. Operational localStorage writes are disabled.
    // localStorage.setItem('accounting_warehouses', JSON.stringify(state.warehouses));
    // localStorage.setItem('accounting_transfers', JSON.stringify(state.warehouseTransfers));
    localStorage.setItem('accounting_cost_centers', JSON.stringify(state.costCenters));
    localStorage.setItem('accounting_bank_terminals', JSON.stringify(state.bankTerminals));
    localStorage.setItem('accounting_audit_logs', JSON.stringify(state.auditLogs));
    localStorage.setItem('accounting_settings', JSON.stringify(state.settings));
    localStorage.setItem('accounting_roles', JSON.stringify(state.roles || []));
    localStorage.setItem('accounting_permissions', JSON.stringify(state.permissions || []));
    localStorage.setItem('accounting_role_permissions', JSON.stringify(state.rolePermissions || []));
    localStorage.setItem('accounting_users', JSON.stringify(state.users || []));
    // Note: businessPartners, partnerCreditRequests, creditFiles, and creditPolicies are authoritative in PostgreSQL DB. Operational localStorage writes are disabled.
    // localStorage.setItem('accounting_business_partners', JSON.stringify(state.businessPartners || []));
    // localStorage.setItem('accounting_partner_credit_requests', JSON.stringify(state.partnerCreditRequests || []));
    localStorage.setItem('accounting_partner_sales_plans', JSON.stringify(state.partnerSalesPlans || []));
    localStorage.setItem('accounting_partner_orders', JSON.stringify(state.partnerOrders || []));
    localStorage.setItem('accounting_partner_settlements', JSON.stringify(state.partnerSettlements || []));
    localStorage.setItem('project_notes', JSON.stringify(state.projectNotes || []));
    // localStorage.setItem('accounting_credit_files', JSON.stringify(state.creditFiles || []));
    // localStorage.setItem('accounting_credit_policies', JSON.stringify(state.creditPolicies || []));
    // Save Knowledge Center state via isolated storage
    saveKnowledgeState({
      categories: state.knowledgeCategories,
      articles: state.knowledgeArticles,
      steps: state.knowledgeSteps,
      errors: state.knowledgeErrors,
      glossary: state.knowledgeGlossary,
      versions: state.knowledgeVersions
    });

    // Push to central store (Express + Supabase)
    pushAppStateToCentral(state);
  } catch (e) {
    console.error("Error saving app state", e);
  }
}

export function resetTransactionsOnly(state: AppState): AppState {
  // 1. Clear transactional data
  const newState: AppState = {
    ...state,
    products: state.products.map(p => ({
      ...p,
      initialStock: 0,
      initialUnitCost: 0
    })),
    vouchers: [],
    checks: [],
    invoices: [],
    openingBalances: [],
    installmentRequests: [],
    warehouseTransfers: [],
    auditLogs: [],
  };
  
  return newState;
}

export function resetAppState() {
  localStorage.removeItem('accounting_initialized');
  localStorage.removeItem('accounting_persons');
  localStorage.removeItem('accounting_products');
  localStorage.removeItem('accounting_product_categories');
  localStorage.removeItem('accounting_subsidiaries');
  localStorage.removeItem('accounting_vouchers');
  localStorage.removeItem('accounting_checks');
  localStorage.removeItem('accounting_invoices');
  localStorage.removeItem('accounting_opening_balances');
  localStorage.removeItem('accounting_installments');
  localStorage.removeItem('accounting_warehouses');
  localStorage.removeItem('accounting_transfers');
  localStorage.removeItem('accounting_cost_centers');
  localStorage.removeItem('accounting_audit_logs');
  localStorage.removeItem('accounting_settings');
  localStorage.removeItem('accounting_business_partners');
  localStorage.removeItem('accounting_partner_credit_requests');
  localStorage.removeItem('accounting_partner_sales_plans');
  localStorage.removeItem('accounting_partner_orders');
  localStorage.removeItem('accounting_partner_settlements');
  localStorage.removeItem('project_notes');
  clearKnowledgeState();
}

// Balance and accounting math
export function calculateSubsidiaryBalances(vouchers: JournalVoucher[]) {
  const balances: Record<string, { debit: number; credit: number; balance: number }> = {};
  
  vouchers.forEach(v => {
    v.entries.forEach(e => {
      if (!balances[e.subsidiaryId]) {
        balances[e.subsidiaryId] = { debit: 0, credit: 0, balance: 0 };
      }
      balances[e.subsidiaryId].debit += e.debit;
      balances[e.subsidiaryId].credit += e.credit;
    });
  });

  // Calculate actual balance (Debits - Credits is positive for assets/expenses, negative for liabilities/equity/revenues)
  // But let's look up subsidiary type to show appropriate balance nature
  DEFAULT_SUBSIDIARIES.forEach(sub => {
    const b = balances[sub.id] || { debit: 0, credit: 0, balance: 0 };
    const net = b.debit - b.credit;
    // For Assets and Expenses, debit is positive nature.
    // For Liabilities, Equity and Revenues, credit is positive nature.
    const isDebitNature = ['دارایی‌های جاری', 'دارایی‌های غیرجاری', 'هزینه‌ها'].includes(sub.groupType);
    b.balance = isDebitNature ? net : -net;
    balances[sub.id] = b;
  });

  return balances;
}

// Calculate detail person balances (chain link)
export function calculatePersonBalances(vouchers: JournalVoucher[], personId?: string, subsidiaryId?: string | string[]) {
  // A person can have balances in Debtors, Creditors, Checks Received (if present), etc.
  const balances: Record<string, { debit: number; credit: number; net: number; nature: 'بدهکار' | 'بستانکار' | 'بی‌حساب' }> = {};

  const subIds = subsidiaryId 
    ? (Array.isArray(subsidiaryId) ? subsidiaryId : [subsidiaryId])
    : null;

  vouchers.forEach(v => {
    v.entries.forEach(e => {
      if (e.floatingDetailed && e.floatingDetailed.type === 'person') {
        const pId = e.floatingDetailed.id;
        if (personId && pId !== personId) return;
        if (subIds && !subIds.includes(e.subsidiaryId)) return;

        if (!balances[pId]) {
          balances[pId] = { debit: 0, credit: 0, net: 0, nature: 'بی‌حساب' };
        }
        balances[pId].debit += e.debit;
        balances[pId].credit += e.credit;
      }
    });
  });

  Object.keys(balances).forEach(id => {
    const b = balances[id];
    const diff = b.debit - b.credit;
    b.net = Math.abs(diff);
    b.nature = diff > 0 ? 'بدهکار' : diff < 0 ? 'بستانکار' : 'بی‌حساب';
  });

  return balances;
}

// Calculate Stock/Inventory Quantities based on:
// Opening Balance Documents + Purchase Invoices - Sale Invoices (Real/Finalized only)
export function calculateProductStocks(products: Product[], invoices: Invoice[], openingBalances: AppState['openingBalances'], transfers: WarehouseTransfer[]) {
  const stocks: Record<string, { 
    quantity: number; 
    totalCost: number; 
    averageCost: number;
    warehouseStocks: Record<string, number>;
  }> = {};

  products.forEach(p => {
    stocks[p.id] = { 
      quantity: 0, 
      totalCost: 0, 
      averageCost: p.initialUnitCost || 0,
      warehouseStocks: {}
    };
  });

  // 1. Opening Balances
  openingBalances.forEach(ob => {
    ob.items.forEach(item => {
      if (stocks[item.productId]) {
        stocks[item.productId].quantity += item.quantity;
        stocks[item.productId].totalCost += item.quantity * item.unitCost;
        stocks[item.productId].averageCost = stocks[item.productId].totalCost / (stocks[item.productId].quantity || 1);
        
        const wh = item.warehouseId || ob.warehouse || 'DEFAULT';
        stocks[item.productId].warehouseStocks[wh] = (stocks[item.productId].warehouseStocks[wh] || 0) + item.quantity;
      }
    });
  });

  // 2. Invoices
  const sortedInvoices = [...invoices].sort((a, b) => a.date.localeCompare(b.date));

  sortedInvoices.forEach(inv => {
    if (inv.isProInvoice) return;

    inv.items.forEach(item => {
      const stock = stocks[item.productId];
      if (!stock) return;

      if (inv.type === 'buy') {
        stock.quantity += item.quantity;
        stock.totalCost += item.quantity * item.unitPrice;
        if (stock.quantity > 0) {
          stock.averageCost = stock.totalCost / stock.quantity;
        }
        stock.warehouseStocks[item.warehouseId] = (stock.warehouseStocks[item.warehouseId] || 0) + item.quantity;
      } else if (inv.type === 'sell') {
        stock.quantity -= item.quantity;
        stock.totalCost -= item.quantity * stock.averageCost;
        stock.warehouseStocks[item.warehouseId] = (stock.warehouseStocks[item.warehouseId] || 0) - item.quantity;
      }
    });
  });

  // 3. Transfers
  transfers.forEach(tr => {
    tr.items.forEach(item => {
      const stock = stocks[item.productId];
      if (!stock) return;
      
      stock.warehouseStocks[tr.fromWarehouseId] = (stock.warehouseStocks[tr.fromWarehouseId] || 0) - item.quantity;
      stock.warehouseStocks[tr.toWarehouseId] = (stock.warehouseStocks[tr.toWarehouseId] || 0) + item.quantity;
    });
  });

  return stocks;
}

export function createWarehouseTransferVoucher(
  transfer: WarehouseTransfer,
  products: Product[],
  nextVoucherNo: number,
  currentStocks?: ReturnType<typeof calculateProductStocks>
): JournalVoucher {
  const entries: VoucherEntry[] = [];
  let totalTransferValue = 0;

  transfer.items.forEach(item => {
    const product = products.find(p => p.id === item.productId);
    // Determine unit cost using weighted average cost from currentStocks, or product initial unit cost / cost price
    let unitCost = 0;
    if (currentStocks && currentStocks[item.productId]?.averageCost > 0) {
      unitCost = currentStocks[item.productId].averageCost;
    } else if (product?.initialUnitCost && product.initialUnitCost > 0) {
      unitCost = product.initialUnitCost;
    } else if ((product as any)?.costPrice && (product as any).costPrice > 0) {
      unitCost = (product as any).costPrice;
    } else if ((item as any).unitCostPrice && (item as any).unitCostPrice > 0) {
      unitCost = (item as any).unitCostPrice;
    } else if ((item as any).unitPrice && (item as any).unitPrice > 0) {
      unitCost = (item as any).unitPrice;
    }

    const itemValue = Math.round(item.quantity * unitCost);
    totalTransferValue += itemValue;
    
    entries.push({
      subsidiaryId: 'SUB_INVENTORY',
      floatingDetailed: { type: 'product', id: item.productId, name: product?.name || 'کالای نامشخص' },
      debit: itemValue,
      credit: 0,
      description: `انتقال به انبار مقصد: ${transfer.description}`
    });
    
    entries.push({
      subsidiaryId: 'SUB_INVENTORY',
      floatingDetailed: { type: 'product', id: item.productId, name: product?.name || 'کالای نامشخص' },
      debit: 0,
      credit: itemValue,
      description: `خروج از انبار مبدا: ${transfer.description}`
    });
  });

  return {
    id: `v_transfer_${transfer.id}`,
    voucherNumber: nextVoucherNo,
    date: transfer.date,
    gregorianDate: new Date().toISOString(),
    description: `سند انتقال انبار: ${transfer.description}`,
    entries,
    isAutomatic: true,
    sourceType: 'transfer',
    sourceId: transfer.id
  };
}

/**
 * Feature 2: Profit & Loss (P&L) Calculation
 */
export function calculateProfitAndLoss(vouchers: JournalVoucher[], subsidiaries: AccountSubsidiary[]) {
  let revenue = 0;
  let cogs = 0;
  let expenses = 0;
  let otherIncome = 0;

  vouchers.forEach(v => {
    v.entries.forEach(e => {
      const sub = subsidiaries.find(s => s.id === e.subsidiaryId);
      if (!sub) return;

      if (sub.generalType === 'فروش کالا') {
        revenue += (e.credit - e.debit);
      } else if (sub.generalType === 'بهای تمام شده کالای فروش رفته') {
        cogs += (e.debit - e.credit);
      } else if (sub.groupType === 'هزینه‌ها') {
        expenses += (e.debit - e.credit);
      } else if (sub.generalType === 'درآمد کارمزد') {
        otherIncome += (e.credit - e.debit);
      }
    });
  });

  const grossProfit = revenue - cogs;
  const netProfit = grossProfit + otherIncome - expenses;

  return {
    revenue,
    cogs,
    grossProfit,
    expenses,
    otherIncome,
    netProfit
  };
}

/**
 * Feature 3: Balance Sheet Calculation
 */
export function calculateBalanceSheet(vouchers: JournalVoucher[], subsidiaries: AccountSubsidiary[]) {
  const accountBalances: Record<string, number> = {};

  vouchers.forEach(v => {
    v.entries.forEach(e => {
      accountBalances[e.subsidiaryId] = (accountBalances[e.subsidiaryId] || 0) + (e.debit - e.credit);
    });
  });

  const assets: { name: string; balance: number }[] = [];
  const liabilities: { name: string; balance: number }[] = [];
  const equity: { name: string; balance: number }[] = [];

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  subsidiaries.forEach(sub => {
    const balance = accountBalances[sub.id] || 0;
    if (balance === 0) return;

    if (sub.groupType === 'دارایی‌های جاری' || sub.groupType === 'دارایی‌های غیرجاری') {
      assets.push({ name: sub.name, balance });
      totalAssets += balance;
    } else if (sub.groupType === 'بدهی‌های جاری' || sub.groupType === 'بدهی‌های غیرجاری') {
      liabilities.push({ name: sub.name, balance: -balance }); // Show as positive in report
      totalLiabilities += -balance;
    } else if (sub.groupType === 'حقوق صاحبان سهام') {
      equity.push({ name: sub.name, balance: -balance });
      totalEquity += -balance;
    }
  });

  // Include Net Profit in Equity
  const pl = calculateProfitAndLoss(vouchers, subsidiaries);
  equity.push({ name: 'سود (زیان) انباشته / جاری', balance: pl.netProfit });
  totalEquity += pl.netProfit;

  return {
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    totalEquity
  };
}

/**
 * Feature: Smart Installment Calculation
 * Based on the formula: Interest = P * r * (days/365)
 */
import { addDaysToJalali, getJalaliDiffDays, addMonthsToJalali } from './jalali';
import { Installment } from '../types';

export function calculateInstallments(
  totalAmount: number,
  prepaymentAmount: number,
  count: number,
  plan: InstallmentPlan,
  firstDueDate?: string,
  intervalDays?: number | number[]
): { 
  installments: Installment[]; 
  totalInterest: number; 
  totalAmount: number; 
  monthlyAmount: number; 
  totalPayable: number;
} {
  const principal = totalAmount - prepaymentAmount;
  const interestRate = plan.interestRate; // Monthly or annual?
  // If the user's formula P * r * (days/365) is used, interestRate is annual.
  
  // 1. Calculate dates and intervals
  const startDate = firstDueDate || getCurrentJalaliDate();
  const dates: string[] = [];
  const intervals: number[] = [];

  for (let i = 0; i < count; i++) {
    const days = Array.isArray(intervalDays) ? intervalDays[i] : (intervalDays || 30);
    intervals.push(days);
    if (i === 0) {
      dates.push(startDate);
    } else {
      dates.push(addDaysToJalali(dates[i - 1], days));
    }
  }
  
  const totalDays = intervals.reduce((sum, d) => sum + d, 0);

  // 2. Calculate Total Interest (Simple interest on total principal for total duration)
  // User Formula: Principal * (Rate/100) * (TotalDays/365)
  const totalInterest = Math.round(principal * (interestRate / 100) * (totalDays / 365));
  const totalPayable = principal + totalInterest;
  const monthlyAmount = Math.round(totalPayable / count);

  // 3. Generate Installments
  const installments: Installment[] = [];
  let remainingPrincipal = principal;

  for (let i = 0; i < count; i++) {
    const daysInThisPeriod = intervals[i];
    let interestPart = Math.round((interestRate / 100) * remainingPrincipal * (daysInThisPeriod / 365));
    
    if (interestPart > monthlyAmount && i < count - 1) {
      interestPart = Math.round(monthlyAmount * 0.5);
    }

    let principalPart = monthlyAmount - interestPart;
    
    if (i === count - 1) {
      const currentTotal = installments.reduce((sum, inst) => sum + inst.amount, 0);
      const lastAmount = totalPayable - currentTotal;
      
      const currentInterest = installments.reduce((sum, inst) => sum + inst.interestPart, 0);
      interestPart = totalInterest - currentInterest;
      principalPart = lastAmount - interestPart;
      
      installments.push({
        id: `inst_${Math.random().toString(36).substr(2, 9)}`,
        bookId: '',
        installmentNumber: i + 1,
        dueDate: dates[i],
        amount: lastAmount,
        paidAmount: 0,
        interestPart,
        principalPart,
        penaltyAmount: 0,
        delayDays: 0,
        status: 'upcoming'
      });
    } else {
      installments.push({
        id: `inst_${Math.random().toString(36).substr(2, 9)}`,
        bookId: '',
        installmentNumber: i + 1,
        dueDate: dates[i],
        amount: monthlyAmount,
        paidAmount: 0,
        interestPart,
        principalPart,
        penaltyAmount: 0,
        delayDays: 0,
        status: 'upcoming'
      });
      remainingPrincipal -= principalPart;
    }
  }

  return { 
    installments, 
    totalInterest, 
    totalAmount: totalPayable, 
    monthlyAmount, 
    totalPayable 
  };
}

/**
 * Smart Dual-Plan Installment Calculator (Normal Step-Based vs Beta Plan)
 */
export function calculateSmartInstallments(
  principal: number,
  count: number,
  intervalType: 'monthly' | 'bi-monthly',
  planType: 'normal' | 'beta',
  betaSurchargePercent: number = 5,
  firstDueDate: string
): {
  installments: Installment[];
  totalInterest: number;
  totalAmount: number;
  monthlyAmount: number;
  totalPayable: number;
} {
  // Guard against invalid, zero or negative counts
  if (!count || isNaN(count) || count <= 0) {
    return {
      installments: [],
      totalInterest: 0,
      totalAmount: principal,
      monthlyAmount: 0,
      totalPayable: principal
    };
  }

  // Step 1: Calculate Real Sleep Period
  const sleepPeriod = intervalType === 'monthly' ? count : (count + 1);

  // Step 2: Determine Base Rate
  let baseRate = 0;
  if (sleepPeriod <= 6) baseRate = 7.5;
  else if (sleepPeriod <= 9) baseRate = 8;
  else baseRate = 8.5;

  // Step 3: Calculate Interest
  const interestPercent = (sleepPeriod + 1) * (baseRate / 2);
  const totalInterest = Math.round(principal * (interestPercent / 100));
  const intermediateAmount = principal + totalInterest;

  // Step 4: Apply Plan Logic
  let finalTotal = intermediateAmount;
  if (planType === 'beta') {
    const surcharge = Math.round(intermediateAmount * (betaSurchargePercent / 100));
    finalTotal += surcharge;
  }

  // Step 5: Generate Installments
  const monthlyAmount = Math.round(finalTotal / count);
  const installments: Installment[] = [];
  const intervalDays = intervalType === 'monthly' ? 30 : 60;

  for (let i = 0; i < count; i++) {
    const dueDate = addDaysToJalali(firstDueDate, i * intervalDays);
    const amount = i === count - 1 ? (finalTotal - installments.reduce((sum, inst) => sum + inst.amount, 0)) : monthlyAmount;
    
    installments.push({
      id: `inst_${planType}_${Math.random().toString(36).substr(2, 9)}`,
      bookId: '',
      installmentNumber: i + 1,
      dueDate,
      amount,
      paidAmount: 0,
      interestPart: Math.round(totalInterest / count),
      principalPart: amount - Math.round(totalInterest / count),
      penaltyAmount: 0,
      delayDays: 0,
      status: 'upcoming'
    });
  }

  return {
    installments,
    totalInterest: finalTotal - principal,
    totalAmount: finalTotal,
    monthlyAmount,
    totalPayable: finalTotal
  };
}

/**
 * Feature 7: Debtors Aging Report
 */
export function calculateAgingReport(invoices: Invoice[], persons: Person[]) {
  const today = new Date();
  const report: {
    personName: string;
    totalDebt: number;
    zeroToThirty: number;
    thirtyToSixty: number;
    sixtyToNinety: number;
    overNinety: number;
  }[] = [];

  const customerDebts: Record<string, { total: number; invoices: { date: string; amount: number }[] }> = {};

  invoices.filter(inv => inv.type === 'sell').forEach(inv => {
    if (!customerDebts[inv.personId]) {
      customerDebts[inv.personId] = { total: 0, invoices: [] };
    }
    const remaining = inv.totalAmount - inv.paidAmount;
    if (remaining > 0) {
      customerDebts[inv.personId].total += remaining;
      customerDebts[inv.personId].invoices.push({ date: inv.date, amount: remaining });
    }
  });

  Object.entries(customerDebts).forEach(([personId, data]) => {
    const person = persons.find(p => p.id === personId);
    if (!person) return;

    let zeroToThirty = 0;
    let thirtyToSixty = 0;
    let sixtyToNinety = 0;
    let overNinety = 0;

    data.invoices.forEach(inv => {
      let diffDays = 0;
      const parsed = parseJalali(inv.date);
      if (parsed) {
        const invDate = jalaliToGregorian(parsed.jy, parsed.jm, parsed.jd);
        diffDays = Math.floor((today.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
      } else {
        const invDate = new Date(inv.date);
        diffDays = isNaN(invDate.getTime()) ? 0 : Math.floor((today.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      if (diffDays <= 30) zeroToThirty += inv.amount;
      else if (diffDays <= 60) thirtyToSixty += inv.amount;
      else if (diffDays <= 90) sixtyToNinety += inv.amount;
      else overNinety += inv.amount;
    });

    report.push({
      personName: person.name,
      totalDebt: data.total,
      zeroToThirty,
      thirtyToSixty,
      sixtyToNinety,
      overNinety
    });
  });

  return report;
}

/**
 * Get average or FIFO purchase prices of products
 * Useful for buy invoice unit price defaulting
 */
export function createOpeningBalanceVoucher(openingBalance: AppState['openingBalances'][0], products: Product[], nextVoucherNo: number): JournalVoucher {
  const entries: VoucherEntry[] = [];
  let totalAmount = 0;

  openingBalance.items.forEach(item => {
    const product = products.find(p => p.id === item.productId);
    const amount = item.quantity * item.unitCost;
    totalAmount += amount;
    
    entries.push({
      subsidiaryId: 'SUB_INVENTORY',
      floatingDetailed: { type: 'product', id: item.productId, name: product?.name || 'کالای نامشخص' },
      debit: amount,
      credit: 0,
      description: `موجودی افتتاحیه ${product?.name || ''} - سند شماره ${openingBalance.number}`
    });
  });

  entries.push({
    subsidiaryId: 'SUB_OPENING_BAL', // تراز افتتاحیه
    debit: 0,
    credit: totalAmount,
    description: `سند تراز افتتاحیه شماره ${openingBalance.number}`
  });

  return {
    id: `v_ob_${openingBalance.id}`,
    voucherNumber: nextVoucherNo,
    date: openingBalance.date,
    gregorianDate: openingBalance.createdAt,
    description: `ثبت سند افتتاحیه شماره ${openingBalance.number}`,
    entries,
    isAutomatic: true,
    sourceType: 'opening_balance',
    sourceId: openingBalance.id
  };
}


export function getPreviousPurchasePrice(productId: string, invoices: Invoice[], products: Product[]): number {
  const buyInvs = invoices.filter(inv => !inv.isProInvoice && inv.type === 'buy');
  
  // Find chronologically last buy invoice containing this product
  for (let i = buyInvs.length - 1; i >= 0; i--) {
    const item = buyInvs[i].items.find(it => it.productId === productId);
    if (item) return item.unitPrice;
  }

  // Fallback: Check product initial cost
  const prod = products.find(p => p.id === productId);
  if (prod && prod.initialUnitCost && prod.initialUnitCost > 0) {
    return prod.initialUnitCost;
  }

  return 0;
}

export function createTransferVoucher(
  amount: number,
  fromSubId: string,
  toSubId: string,
  date: string,
  nextVoucherNo: number,
  invoiceId: string
): JournalVoucher {
  const entries: VoucherEntry[] = [
    {
      subsidiaryId: toSubId,
      debit: amount,
      credit: 0,
      description: 'انتقال از حساب واسط به حساب بانک'
    },
    {
      subsidiaryId: fromSubId,
      debit: 0,
      credit: amount,
      description: 'انتقال از حساب واسط به حساب بانک'
    }
  ];

  return {
    id: `v_transfer_${Date.now()}`,
    voucherNumber: nextVoucherNo,
    date: date,
    gregorianDate: new Date().toISOString(),
    description: 'انتقال خودکار از حساب واسط به بانک',
    entries,
    isAutomatic: true,
    sourceType: 'transfer',
    sourceId: invoiceId
  };
}

// Generate automatic double entry vouchers
export function createInvoiceVoucher(
  invoice: Invoice, 
  personName: string, 
  nextVoucherNo: number,
  subsidiaries: AccountSubsidiary[],
  currentStocks: ReturnType<typeof calculateProductStocks>,
  commissionAmount?: number,
  isAgent?: boolean,
  bankTerminals: BankTerminal[] = []
): JournalVoucher {
  const entries: VoucherEntry[] = [];
  const jalaliDate = invoice.date;
  const gregorianDate = new Date().toISOString();

  // Find standard subsidiaries
  const subAr = subsidiaries.find(s => s.generalType === 'بدهکاران تجاری')?.id || 'SUB_DEBTORS';
  const subAp = subsidiaries.find(s => s.generalType === 'بستانکاران تجاری')?.id || 'SUB_CREDITORS';
  const subSales = subsidiaries.find(s => s.generalType === 'فروش کالا')?.id || 'SUB_REVENUE';
  const subInventory = subsidiaries.find(s => s.generalType === 'موجودی کالا')?.id || 'SUB_INVENTORY';
  const subCogs = subsidiaries.find(s => s.generalType === 'بهای تمام شده کالای فروش رفته')?.id || 'SUB_COGS';
  const subVatBuy = subsidiaries.find(s => s.id === 'SUB_VAT_BUY')?.id || 'SUB_VAT_BUY';
  const subVatSell = subsidiaries.find(s => s.id === 'SUB_VAT_SELL')?.id || 'SUB_VAT_SELL';

  // Calculate totals
  let subtotal = 0;
  let totalDiscount = invoice.discount || 0;
  invoice.items.forEach(item => {
    subtotal += (item.quantity || 0) * (item.unitPrice || 0);
    totalDiscount += item.discount || 0;
  });

  const taxPercent = invoice.taxPercent || 0;
  const vat = Math.round((subtotal - totalDiscount) * (taxPercent / 100));
  const finalAmount = subtotal - totalDiscount + vat;

  if (invoice.type === 'sell') {
    const cashPaid = invoice.cashPaidAmount || 0;
    const posPaid = invoice.posPaidAmount || 0;
    const remaining = finalAmount - (cashPaid + posPaid);

    // 1. Debit Cash/Bank for cash/deposit payment
    if (cashPaid > 0) {
      entries.push({
        subsidiaryId: 'SUB_CASH_MAIN',
        debit: cashPaid,
        credit: 0,
        description: `دریافت نقدی بابت فاکتور فروش شماره ${invoice.invoiceNumber}`
      });
    }

    // 2. Debit Bank/POS for POS payment
    if (posPaid > 0) {
      let targetBankSub = 'SUB_BANK_MELI'; // default
      if (invoice.posTerminalId) {
        const terminal = bankTerminals.find(t => t.id === invoice.posTerminalId);
        if (terminal && terminal.intermediateAccountId) {
          targetBankSub = terminal.intermediateAccountId;
        }
      }
      entries.push({
        subsidiaryId: targetBankSub,
        debit: posPaid,
        credit: 0,
        description: `دریافت کارتخوان بابت فاکتور فروش شماره ${invoice.invoiceNumber}`
      });
    }

    // 3. Debit Customer (Accounts Receivable - Normal or Installment) for remaining amount
    if (remaining > 0 || (cashPaid === 0 && posPaid === 0)) {
      const actualRemaining = remaining > 0 ? remaining : finalAmount;
      const isInstallmentOrCheck = invoice.isInstallmentDeferred || invoice.isSettledWithChecks;
      
      const targetSubId = invoice.isPaidFromWallet 
        ? 'SUB_PARTNER_WALLET' 
        : (isAgent 
            ? 'SUB_DEBTORS_AGENTS' 
            : (isInstallmentOrCheck ? 'SUB_DEBTORS_INSTALLMENT' : subAr));
            
      const debtTypeLabel = invoice.isPaidFromWallet 
        ? 'کیف پول همکاران' 
        : (isAgent 
            ? 'حساب‌های دریافتنی (نمایندگان فروش)' 
            : (isInstallmentOrCheck ? 'بدهکاران اقساطی / چک' : 'بدهکاران تجاری عادی'));
      
      const commAmount = commissionAmount !== undefined ? commissionAmount : (invoice.settlementCommission || 0);
      const debitVal = actualRemaining + (isInstallmentOrCheck ? commAmount : 0);
      
      entries.push({
        subsidiaryId: targetSubId,
        floatingDetailed: { type: 'person', id: invoice.personId, name: personName },
        debit: debitVal,
        credit: 0,
        description: `فروش ${invoice.isPaidFromWallet ? 'با کیف پول همکاران' : (invoice.isInstallmentDeferred ? 'اقساطی' : (invoice.isSettledWithChecks ? 'با تسویه اسناد دریافتنی' : 'نسیه'))} - فاکتور شماره ${invoice.invoiceNumber} (${debtTypeLabel})`
      });
    }

    // 4. Credit Sales Revenue
    entries.push({
      subsidiaryId: subSales,
      debit: 0,
      credit: subtotal - totalDiscount,
      description: `فروش طی فاکتور شماره ${invoice.invoiceNumber}`
    });

    // 5. Credit VAT
    if (vat > 0) {
      entries.push({
        subsidiaryId: subVatSell,
        debit: 0,
        credit: vat,
        description: `مالیات ارزش افزوده فاکتور فروش ${invoice.invoiceNumber}`
      });
    }

    // Credit Commission Revenue (Requirement 1 & 3)
    const commAmount = commissionAmount !== undefined ? commissionAmount : (invoice.settlementCommission || 0);
    if ((invoice.isInstallmentDeferred || invoice.isSettledWithChecks) && commAmount > 0) {
      entries.push({
        subsidiaryId: 'SUB_COMMISSION_REV',
        debit: 0,
        credit: commAmount,
        description: `درآمد حاصل از کارمزد اقساط - فاکتور شماره ${invoice.invoiceNumber} - ${personName}`
      });
    }

    // 4. Inventory Cost (COGS)
    let totalCogs = 0;
    invoice.items.forEach(item => {
      // Prioritize stored persistent cost if available (FIN-PERSISTENT-COSTING-001-D)
      if (item.totalCostPrice && item.totalCostPrice > 0) {
        totalCogs += item.totalCostPrice;
      } else {
        const avgCost = currentStocks[item.productId]?.averageCost || 0;
        totalCogs += item.quantity * avgCost;
      }
    });

    if (totalCogs > 0) {
      entries.push({
        subsidiaryId: subCogs,
        debit: Math.round(totalCogs),
        credit: 0,
        description: `بهای تمام شده فاکتور شماره ${invoice.invoiceNumber}`
      });
      entries.push({
        subsidiaryId: subInventory,
        debit: 0,
        credit: Math.round(totalCogs),
        description: `خروج از انبار بابت فاکتور شماره ${invoice.invoiceNumber}`
      });
    }
  } else if (invoice.type === 'buy') {
    // 1. Debit Inventory
    entries.push({
      subsidiaryId: subInventory,
      debit: subtotal - totalDiscount,
      credit: 0,
      description: `خرید طی فاکتور شماره ${invoice.invoiceNumber}`
    });

    // 2. Debit VAT
    if (vat > 0) {
      entries.push({
        subsidiaryId: subVatBuy,
        debit: vat,
        credit: 0,
        description: `مالیات ارزش افزوده فاکتور خرید ${invoice.invoiceNumber}`
      });
    }

    // 3. Credit Supplier (Accounts Payable)
    entries.push({
      subsidiaryId: subAp,
      floatingDetailed: { type: 'person', id: invoice.personId, name: personName },
      debit: 0,
      credit: finalAmount,
      description: `خرید طی فاکتور شماره ${invoice.invoiceNumber}`
    });
  }

  return {
    id: invoice.voucherId || `v_auto_inv_${invoice.id}`,
    voucherNumber: nextVoucherNo,
    date: jalaliDate,
    gregorianDate,
    description: `${invoice.type === 'sell' ? 'فروش' : 'خرید'} - فاکتور ${invoice.invoiceNumber}`,
    entries,
    isAutomatic: true,
    sourceType: invoice.type === 'sell' ? 'sell_invoice' : 'buy_invoice',
    sourceId: invoice.id
  };
}

/**
 * Resolves the journal voucher associated with an invoice.
 * Priority 1: Explicit invoice.voucherId (or invoice.journalVoucherId).
 * Priority 2: Explicit voucher metadata (voucher.sourceId === invoice.id && (sourceType === 'sell_invoice' || sourceType === 'buy_invoice')).
 * Priority 3: Isolated fallback for legacy AppState objects ('v_auto_inv_' + invoice.id or 'v_auto_' + invoice.id).
 * Pure read-only, deterministic, zero side effects.
 */
export function resolveInvoiceVoucher(
  invoice: { id: string; voucherId?: string },
  vouchers: JournalVoucher[]
): JournalVoucher | undefined {
  if (!invoice || !vouchers || vouchers.length === 0) return undefined;

  // Priority 1: Explicit voucherId on invoice object
  if (invoice.voucherId) {
    const explicitMatch = vouchers.find(v => v.id === invoice.voucherId);
    if (explicitMatch) return explicitMatch;
  }

  // Priority 2: Explicit source reference metadata on voucher
  const sourceMatch = vouchers.find(
    v => v.sourceId === invoice.id && (v.sourceType === 'sell_invoice' || v.sourceType === 'buy_invoice')
  );
  if (sourceMatch) return sourceMatch;

  // Priority 3: Isolated fallback for legacy AppState objects
  const legacyMatch = vouchers.find(
    v => v.id === `v_auto_inv_${invoice.id}` || v.id === `v_auto_${invoice.id}`
  );
  return legacyMatch;
}

/**
 * Checks if a voucher is associated with a given invoice.
 */
export function isVoucherForInvoice(
  voucher: JournalVoucher,
  invoice: { id: string; voucherId?: string }
): boolean {
  if (!voucher || !invoice) return false;
  if (invoice.voucherId && voucher.id === invoice.voucherId) return true;
  if (voucher.sourceId === invoice.id && (voucher.sourceType === 'sell_invoice' || voucher.sourceType === 'buy_invoice')) return true;
  if (voucher.id === `v_auto_inv_${invoice.id}` || voucher.id === `v_auto_${invoice.id}`) return true;
  return false;
}

// Generate automatic voucher for check transactions
export function createCheckStateVoucher(
  check: Check, 
  personName: string, 
  fromState: string, 
  toState: string, 
  nextVoucherNo: number,
  optionalBankId?: string, // e.g. SUB_BANK_MELI
  optionalCashId?: string, // e.g. SUB_CASH_MAIN
  toSubState?: string,
  endorsedPerson?: { id: string; name: string }
): JournalVoucher {
  const entries: VoucherEntry[] = [];
  const jalali = getCurrentJalaliDate();
  
  const bankSubId = optionalBankId || check.issuerBankAccountId || 'SUB_BANK_MELI';
  const debtorSubId = check.isInstallment ? 'SUB_DEBTORS_INSTALLMENT' : 'SUB_DEBTORS';

  if (fromState === toState) {
    if (check.type === 'received' && toState === 'bounced' && toSubState === 'cleared_after_bounce') {
      entries.push({ 
        subsidiaryId: bankSubId, 
        debit: check.amount, 
        credit: 0, 
        description: `وصول چک برگشتی شماره ${check.checkNumber} - واریز به حساب` 
      });
      entries.push({ 
        subsidiaryId: debtorSubId, 
        floatingDetailed: { type: 'person', id: check.personId, name: personName }, 
        debit: 0, 
        credit: check.amount, 
        description: `تسویه بدهی مشتری بابت وصول چک برگشتی ${check.checkNumber}` 
      });
    }
  } else {
    if (check.type === 'received') {
      if (toState === 'present_in_cashbox') {
        if (fromState === 'passed_to_others') {
          const recipientId = endorsedPerson ? endorsedPerson.id : check.personId;
          const recipientName = endorsedPerson ? endorsedPerson.name : personName;
          entries.push({ subsidiaryId: 'SUB_CHECKS_REC', debit: check.amount, credit: 0, description: `برگشت چک خرج‌شده ${check.checkNumber} به صندوق` });
          entries.push({ subsidiaryId: 'SUB_CREDITORS', floatingDetailed: { type: 'person', id: recipientId, name: recipientName }, debit: 0, credit: check.amount, description: `برگشت چک خرج‌شده ${check.checkNumber} - بستانکار شدن مجدد تامین‌کننده ${recipientName}` });
        } else {
          entries.push({ subsidiaryId: 'SUB_CHECKS_REC', debit: check.amount, credit: 0, description: `دریافت چک شماره ${check.checkNumber} از ${personName}` });
          entries.push({ subsidiaryId: debtorSubId, floatingDetailed: { type: 'person', id: check.personId, name: personName }, debit: 0, credit: check.amount, description: `تسویه مشتری بابت چک ${check.checkNumber}` });
        }
      } else if (toState === 'deposited_to_bank') {
        entries.push({ subsidiaryId: 'SUB_CHECKS_TRANSIT', debit: check.amount, credit: 0, description: `واگذاری چک شماره ${check.checkNumber} به بانک` });
        entries.push({ subsidiaryId: 'SUB_CHECKS_REC', debit: 0, credit: check.amount, description: `خروج چک شماره ${check.checkNumber} از صندوق` });
      } else if (toState === 'cleared') {
        const creditSub = fromState === 'deposited_to_bank' ? 'SUB_CHECKS_TRANSIT' : 'SUB_CHECKS_REC';
        entries.push({ subsidiaryId: bankSubId, debit: check.amount, credit: 0, description: `وصول چک شماره ${check.checkNumber}` });
        entries.push({ subsidiaryId: creditSub, debit: 0, credit: check.amount, description: `تسویه اسناد دریافتنی چک ${check.checkNumber}` });
      } else if (toState === 'passed_to_others') {
        const recipientId = endorsedPerson ? endorsedPerson.id : check.personId;
        const recipientName = endorsedPerson ? endorsedPerson.name : personName;
        entries.push({ subsidiaryId: 'SUB_CREDITORS', floatingDetailed: { type: 'person', id: recipientId, name: recipientName }, debit: check.amount, credit: 0, description: `خرج چک ${check.checkNumber} بابت بدهی ${recipientName}` });
        entries.push({ subsidiaryId: 'SUB_CHECKS_REC', debit: 0, credit: check.amount, description: `خروج چک ${check.checkNumber} از صندوق` });
      } else if (toState === 'bounced') {
        if (fromState === 'passed_to_others') {
          const recipientId = endorsedPerson ? endorsedPerson.id : check.personId;
          const recipientName = endorsedPerson ? endorsedPerson.name : personName;
          entries.push({ subsidiaryId: debtorSubId, floatingDetailed: { type: 'person', id: check.personId, name: personName }, debit: check.amount, credit: 0, description: `برگشت چک خرج‌شده ${check.checkNumber} - بدهکار شدن مجدد مشتری ${personName}` });
          entries.push({ subsidiaryId: 'SUB_CREDITORS', floatingDetailed: { type: 'person', id: recipientId, name: recipientName }, debit: 0, credit: check.amount, description: `برگشت چک خرج‌شده ${check.checkNumber} - بستانکار شدن مجدد تامین‌کننده ${recipientName}` });
        } else {
          const creditSub = fromState === 'deposited_to_bank' ? 'SUB_CHECKS_TRANSIT' : 'SUB_CHECKS_REC';
          entries.push({ subsidiaryId: debtorSubId, floatingDetailed: { type: 'person', id: check.personId, name: personName }, debit: check.amount, credit: 0, description: `برگشت چک ${check.checkNumber} - بدهکار شدن مشتری` });
          entries.push({ subsidiaryId: creditSub, debit: 0, credit: check.amount, description: `کسر از ${fromState === 'deposited_to_bank' ? 'اسناد در جریان وصول' : 'صندوق'} بابت برگشت چک ${check.checkNumber}` });
        }
      }
    } else {
      const isInvestorComm = Boolean(check.isInvestorCommission || check.investorContractId || check.investorObligationId);
      if (toState === 'issued') {
        if (!isInvestorComm) {
          entries.push({ subsidiaryId: 'SUB_CREDITORS', floatingDetailed: { type: 'person', id: check.personId, name: personName }, debit: check.amount, credit: 0, description: `صدور چک ${check.checkNumber} به نام ${personName}` });
          entries.push({ subsidiaryId: 'SUB_CHECKS_PAY', debit: 0, credit: check.amount, description: `ثبت اسناد پرداختنی چک ${check.checkNumber}` });
        } else {
          // صدور/اتصال چک کارمزد سرمایه‌گذار: بدهکار: کارمزد در انتظار تحقق، بستانکار: اسناد پرداختنی
          entries.push({ subsidiaryId: 'SUB_DEFERRED_FEE', debit: check.amount, credit: 0, description: `ثبت کارمزد در انتظار تحقق بابت صدور چک کارمزد سرمایه‌گذار ${check.checkNumber}` });
          entries.push({ subsidiaryId: 'SUB_CHECKS_PAY', debit: 0, credit: check.amount, description: `ثبت اسناد پرداختنی چک کارمزد سرمایه‌گذار ${check.checkNumber}` });
        }
      } else if (toState === 'cleared') {
        if (!isInvestorComm) {
          entries.push({ subsidiaryId: 'SUB_CHECKS_PAY', debit: check.amount, credit: 0, description: `پاس شدن چک ${check.checkNumber}` });
          entries.push({ subsidiaryId: bankSubId, debit: 0, credit: check.amount, description: `کسر از بانک بابت چک ${check.checkNumber}` });
        } else {
          // در روز واقعی پاس شدن چک کارمزد سرمایه‌گذار: دو ثبت مستقل و متوازن در سند
          // ثبت اول — تسویه چک: بدهکار: اسناد پرداختنی، بستانکار: بانک
          entries.push({ subsidiaryId: 'SUB_CHECKS_PAY', debit: check.amount, credit: 0, description: `تسویه اسناد پرداختنی بابت پاس شدن چک کارمزد ${check.checkNumber}` });
          entries.push({ subsidiaryId: bankSubId, debit: 0, credit: check.amount, description: `کسر از بانک بابت پاس شدن چک کارمزد ${check.checkNumber}` });
          // ثبت دوم — تحقق واقعی هزینه: بدهکار: هزینه کارمزد سرمایه‌گذاری، بستانکار: کارمزد در انتظار تحقق
          entries.push({ subsidiaryId: 'SUB_EXP_FIN_INTEREST', debit: check.amount, credit: 0, description: `تحقق واقعی هزینه کارمزد سرمایه‌گذاری بابت پاس شدن چک ${check.checkNumber}` });
          entries.push({ subsidiaryId: 'SUB_DEFERRED_FEE', debit: 0, credit: check.amount, description: `تسویه کارمزد در انتظار تحقق بابت تحقق هزینه چک ${check.checkNumber}` });
        }
      } else if (toState === 'bounced') {
        if (!isInvestorComm) {
          entries.push({ subsidiaryId: 'SUB_CHECKS_PAY', debit: check.amount, credit: 0, description: `ابطال تعهد اسناد پرداختنی چک ${check.checkNumber}` });
          entries.push({ subsidiaryId: 'SUB_CREDITORS', floatingDetailed: { type: 'person', id: check.personId, name: personName }, debit: 0, credit: check.amount, description: `بستانکار شدن مجدد طرف حساب بابت برگشت چک ${check.checkNumber}` });
        } else {
          // ابطال چک کارمزد قبل از سررسید: بدهکار: اسناد پرداختنی، بستانکار: کارمزد در انتظار تحقق
          entries.push({ subsidiaryId: 'SUB_CHECKS_PAY', debit: check.amount, credit: 0, description: `ابطال اسناد پرداختنی بابت برگشت چک کارمزد سرمایه‌گذار ${check.checkNumber}` });
          entries.push({ subsidiaryId: 'SUB_DEFERRED_FEE', debit: 0, credit: check.amount, description: `برگشت کارمزد در انتظار تحقق بابت ابطال چک ${check.checkNumber}` });
        }
      }
    }
  }

  if (entries.length === 0) {
    return null;
  }

  return {
    id: `v_auto_check_${check.id}_${toState}_${Date.now()}`,
    voucherNumber: nextVoucherNo,
    date: jalali,
    gregorianDate: new Date().toISOString(),
    description: `سند خودکار وضعیت چک ${check.checkNumber} (${toState})`,
    entries,
    isAutomatic: true,
    sourceType: 'check_state_change',
    sourceId: check.id
  };
}

export function updateCheckState(
  check: Check,
  newState: ReceivedCheckState | PaidCheckState,
  newSubState: BouncedReceivedCheckSubState | BouncedPaidCheckSubState | undefined,
  voucherId: string | undefined,
  note: string | undefined,
  bankId?: string,
  userId?: string,
  actorName?: string
): Check {
  console.log('Updating check state', check.id, 'to', newState);
  return {
    ...check,
    currentState: newState,
    currentSubState: newSubState,
    depositedBankId: newState === 'bounced' ? undefined : (bankId || check.depositedBankId),
    history: [
      ...check.history,
      {
        state: newState,
        subState: newSubState,
        date: getCurrentJalaliDate(),
        voucherId,
        note,
        beforeState: check.currentState,
        afterState: newState,
        timestamp: new Date().toISOString(),
        userId,
        actorName,
      }
    ],
  };
}

// Dual Channel Profit & Loss Calculation
// Calculating costs of sold goods (COGS) based on FIFO or Weighted Average method
export interface ProfitAndLossReport {
  revenue: number; // جمع فروش
  cogs: number; // بهای تمام شده کالای فروش رفته
  grossProfit: number; // سود ناویژه
  expenses: number; // هزینه‌ها
  otherRevenue: number; // سایر درآمدها (مانند درآمد کارمزد)
  operatingExpenseRate?: number; // نرخ هزینه عملیاتی پیش‌فرض
  operatingExpenseAmount?: number; // مبلغ هزینه عملیاتی پیش‌فرض
  netProfit: number; // سود ویژه
  details: {
    productName: string;
    quantitySold: number;
    salesRevenue: number;
    cogsCost: number;
    profit: number;
  }[];
}

export function calculateDetailedProfitAndLoss(
  state: AppState,
  startDate: string,
  endDate: string,
  method: 'fifo' | 'average' | 'serial'
): ProfitAndLossReport {
  const { products, invoices, vouchers, openingBalances } = state;
  
  // 1. Get real (non-pro-invoice) purchase and sales invoices
  const realInvs = invoices.filter(inv => !inv.isProInvoice && inv.date >= startDate && inv.date <= endDate);
  const buyInvs = invoices.filter(inv => !inv.isProInvoice && inv.type === 'buy'); // All time buy invoices for history costing layers
  const sellInvs = realInvs.filter(inv => inv.type === 'sell');

  // Let's gather general expenses and other revenues from manual and auto vouchers
  let totalExpenses = 0;
  let totalOtherRevenue = 0;
  vouchers.forEach(v => {
    if (v.date >= startDate && v.date <= endDate) {
      v.entries.forEach(e => {
        const sub = DEFAULT_SUBSIDIARIES.find(s => s.id === e.subsidiaryId) || state.subsidiaries.find(s => s.id === e.subsidiaryId);
        if (sub) {
          if (sub.groupType === 'هزینه‌ها' && sub.id !== 'SUB_COGS') {
            // Debit increases expenses
            totalExpenses += (e.debit - e.credit);
          } else if (sub.groupType === 'درآمدها' && sub.id !== 'SUB_REVENUE') {
            // Credit increases other revenues
            totalOtherRevenue += (e.credit - e.debit);
          }
        }
      });
    }
  });

  // Calculate COGS and sales revenue per product
  const productPnls: Record<string, { quantity: number; revenue: number; cogs: number }> = {};
  
  products.forEach(p => {
    productPnls[p.id] = { quantity: 0, revenue: 0, cogs: 0 };
  });

  // Dual-channel costing implementation
  if (method === 'average') {
    // WEIGHTED AVERAGE METHOD:
    products.forEach(p => {
      let totalQty = 0;
      let totalVal = 0;

      // 1. Include Initial Stocks from opening balance documents
      openingBalances.forEach(ob => {
        ob.items.forEach(item => {
          if (item.productId === p.id) {
            totalQty += item.quantity;
            totalVal += (item.quantity * item.unitCost);
          }
        });
      });

      // 2. Add purchases
      buyInvs.forEach(inv => {
        inv.items.forEach(item => {
          if (item.productId === p.id) {
            totalQty += item.quantity;
            totalVal += (item.quantity * item.unitPrice - item.discount);
          }
        });
      });

      const avgUnitCost = totalQty > 0 ? (totalVal / totalQty) : (p.initialUnitCost || 0);

      // Calculate revenue and cogs for sales in the date range
      sellInvs.forEach(inv => {
        inv.items.forEach(item => {
          if (item.productId === p.id) {
            const itemRevenue = (item.quantity * item.unitPrice) - item.discount;
            
            // Prioritize stored persistent cost if available (FIN-PERSISTENT-COSTING-001-D)
            let itemCogs = 0;
            if (item.totalCostPrice && item.totalCostPrice > 0) {
              itemCogs = item.totalCostPrice;
            } else {
              itemCogs = item.quantity * avgUnitCost;
            }
            
            productPnls[p.id].quantity += item.quantity;
            productPnls[p.id].revenue += itemRevenue;
            productPnls[p.id].cogs += itemCogs;
          }
        });
      });
    });

  } else if (method === 'fifo') {
    // FIFO METHOD:
    products.forEach(p => {
      // Construct FIFO layers
      const layers: { quantity: number; unitPrice: number }[] = [];
      
      // 1. Add layers from opening balances
      openingBalances.forEach(ob => {
        ob.items.forEach(item => {
          if (item.productId === p.id && item.quantity > 0) {
            layers.push({ quantity: item.quantity, unitPrice: item.unitCost });
          }
        });
      });

      // Chronologically add buy invoices
      const sortedBuyInvs = [...buyInvs].sort((a, b) => a.date.localeCompare(b.date));
      sortedBuyInvs.forEach(inv => {
        inv.items.forEach(item => {
          if (item.productId === p.id) {
            // Net unit price after row discount
            const netUnitPrice = item.quantity > 0 ? (item.quantity * item.unitPrice - item.discount) / item.quantity : item.unitPrice;
            layers.push({ quantity: item.quantity, unitPrice: netUnitPrice });
          }
        });
      });

      // Now go through sales in the date range
      // Wait, we need to process all sales from all-time chronologically to correctly exhaust FIFO layers up to our date range, 
      // but only accumulate COGS/Revenue for sales inside the date range!
      const allSellInvs = invoices.filter(inv => !inv.isProInvoice && inv.type === 'sell').sort((a, b) => a.date.localeCompare(b.date));

      allSellInvs.forEach(inv => {
        const inDateRange = inv.date >= startDate && inv.date <= endDate;
        
        inv.items.forEach(item => {
          if (item.productId === p.id) {
            // Prioritize stored persistent cost if available (FIN-PERSISTENT-COSTING-001-D)
            let totalCogsForThisSale = 0;
            if (item.totalCostPrice && item.totalCostPrice > 0) {
              totalCogsForThisSale = item.totalCostPrice;
            } else {
              let qtyToFulfill = item.quantity;
              while (qtyToFulfill > 0 && layers.length > 0) {
                const currentLayer = layers[0];
                if (currentLayer.quantity <= qtyToFulfill) {
                  totalCogsForThisSale += currentLayer.quantity * currentLayer.unitPrice;
                  qtyToFulfill -= currentLayer.quantity;
                  layers.shift(); // fully consumed
                } else {
                  totalCogsForThisSale += qtyToFulfill * currentLayer.unitPrice;
                  currentLayer.quantity -= qtyToFulfill;
                  qtyToFulfill = 0;
                }
              }

              if (qtyToFulfill > 0) {
                totalCogsForThisSale += qtyToFulfill * (p.initialUnitCost || 0);
              }
            }

            if (inDateRange) {
              const itemRevenue = (item.quantity * item.unitPrice) - item.discount;
              productPnls[p.id].quantity += item.quantity;
              productPnls[p.id].revenue += itemRevenue;
              productPnls[p.id].cogs += totalCogsForThisSale;
            }
          }
        });
      });
    });
  } else if (method === 'serial') {
    // SERIAL-BASED TRACKING METHOD:
    const serialCostMap = new Map<string, number>();

    openingBalances.forEach(ob => {
      ob.items.forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        if (prod && prod.category === 'موبایل') {
          (item.serialNumbers || []).forEach(sn => {
            serialCostMap.set(sn, item.unitCost);
          });
        }
      });
    });

    buyInvs.forEach(inv => {
      inv.items.forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        if (prod && prod.category === 'موبایل') {
          (item.serialNumbers || []).forEach(sn => {
            serialCostMap.set(sn, item.unitPrice);
          });
        }
      });
    });

    products.forEach(p => {
      // Calculate Weighted Average fallback cost
      let totalQty = 0;
      let totalVal = 0;

      openingBalances.forEach(ob => {
        ob.items.forEach(item => {
          if (item.productId === p.id) {
            totalQty += item.quantity;
            totalVal += (item.quantity * item.unitCost);
          }
        });
      });

      buyInvs.forEach(inv => {
        inv.items.forEach(item => {
          if (item.productId === p.id) {
            totalQty += item.quantity;
            totalVal += (item.quantity * item.unitPrice - item.discount);
          }
        });
      });

      const avgUnitCost = totalQty > 0 ? (totalVal / totalQty) : (p.initialUnitCost || 0);

      // Go through sales inside the date range
      sellInvs.forEach(inv => {
        inv.items.forEach(item => {
          if (item.productId === p.id) {
            const itemRevenue = (item.quantity * item.unitPrice) - item.discount;
            // Prioritize stored persistent cost if available (FIN-PERSISTENT-COSTING-001-D)
            let itemCogs = 0;
            if (item.totalCostPrice && item.totalCostPrice > 0) {
              itemCogs = item.totalCostPrice;
            } else if (p.category === 'موبایل') {
              let matchedCount = 0;
              (item.serialNumbers || []).forEach(sn => {
                if (serialCostMap.has(sn)) {
                  itemCogs += serialCostMap.get(sn)!;
                  matchedCount++;
                }
              });

              const unmatchedQty = item.quantity - matchedCount;
              if (unmatchedQty > 0) {
                itemCogs += unmatchedQty * avgUnitCost;
              }
            } else {
              // Non-mobile products fall back to weighted average
              itemCogs = item.quantity * avgUnitCost;
            }

            productPnls[p.id].quantity += item.quantity;
            productPnls[p.id].revenue += itemRevenue;
            productPnls[p.id].cogs += itemCogs;
          }
        });
      });
    });
  }

  // Compile detailed report
  let totalRevenue = 0;
  let totalCogs = 0;
  const details = products.map(p => {
    const pnl = productPnls[p.id] || { quantity: 0, revenue: 0, cogs: 0 };
    totalRevenue += pnl.revenue;
    totalCogs += pnl.cogs;
    return {
      productName: p.name,
      quantitySold: pnl.quantity,
      salesRevenue: pnl.revenue,
      cogsCost: pnl.cogs,
      profit: pnl.revenue - pnl.cogs
    };
  }).filter(d => d.quantitySold > 0 || d.salesRevenue > 0);

  const grossProfit = totalRevenue - totalCogs;
  
  // Deduct operational expense rate if set
  const opExpenseRate = state.settings.defaultOperatingExpenseRate || 0;
  const opExpenseAmount = Math.round(totalRevenue * (opExpenseRate / 100));
  
  const netProfit = grossProfit + totalOtherRevenue - totalExpenses - opExpenseAmount;

  return {
    revenue: totalRevenue,
    cogs: totalCogs,
    grossProfit,
    expenses: totalExpenses,
    otherRevenue: totalOtherRevenue,
    operatingExpenseRate: opExpenseRate,
    operatingExpenseAmount: opExpenseAmount,
    netProfit,
    details
  };
}

/**
 * Normalizes Persian and Arabic digits in a string to standard English digits.
 */
export function toEnglishDigits(str: string): string {
  const persianDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicDigits  = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  let normalized = str;
  for (let i = 0; i < 10; i++) {
    normalized = normalized.replace(persianDigits[i], i.toString()).replace(arabicDigits[i], i.toString());
  }
  return normalized;
}

/**
 * Extracts digits (including Persian/Arabic normalized to English) and returns as a number.
 */
export function parseNumericValue(val: string | number): number {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const englishVal = toEnglishDigits(val);
  const clean = englishVal.replace(/[^0-9]/g, '');
  return clean ? parseInt(clean, 10) : 0;
}

/**
 * Feature 9: Create Audit Log Entry
 */
export function createAuditLog(
  action: AppState['auditLogs'][0]['action'],
  entityType: AppState['auditLogs'][0]['entityType'],
  entityId: string,
  details: string,
  previousValue?: any,
  newValue?: any
): AppState['auditLogs'][0] {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    userId: 'current-user', // In a real app, this would be the actual user ID
    userName: 'مدیر سیستم',
    action,
    entityType,
    entityId,
    details,
    previousValue,
    newValue
  };
}

/**
 * Feature 5: Check Credit Limit
 */
export function checkCreditLimit(
  person: Person, 
  vouchers: JournalVoucher[], 
  newInvoiceAmount: number,
  businessPartners: BusinessPartner[] = []
): { 
  allowed: boolean; 
  currentDebt: number; 
  remainingLimit: number;
} {
  const balances = calculatePersonBalances(vouchers, person.id);
  const pBal = balances[person.id] || { debit: 0, credit: 0, net: 0, nature: 'بی‌حساب' };
  
  // Current Debt is Debit - Credit (positive if they owe us)
  const currentDebt = pBal.nature === 'بدهکار' ? pBal.net : (pBal.nature === 'بستانکار' ? -pBal.net : 0);
  const totalPotentialDebt = currentDebt + newInvoiceAmount;
  
  const creditRules = resolvePartnerCreditRules(person, businessPartners);
  const limit = creditRules.maxCreditLimit;
  const remainingLimit = limit - currentDebt;

  if (limit > 0 && totalPotentialDebt > limit) {
    return { allowed: false, currentDebt, remainingLimit };
  }

  return { allowed: true, currentDebt, remainingLimit };
}

/**
 * Smart Installment Calculator
 */
export interface InstallmentCalculationResult {
  monthlyAmount: number;
  totalInterest: number;
  totalPayable: number;
  installments: {
    number: number;
    dueDate: string;
    principal: number;
    interest: number;
    total: number;
  }[];
}

export function calculateDetailedInstallments(
  principal: number,
  startDate: string,
  count: number,
  intervalDays: number,
  interestRatePercent: number, // ماهانه
  variableDates?: string[]
): InstallmentCalculationResult {
  const installments = [];
  let totalInterest = 0;
  
  // ساده‌ترین روش: سود ثابت برای کل دوره بر اساس زمان
  // در حسابداری بازار ایران معمولاً سود را روی کل مبلغ می‌کشند
  // اما کاربر خواسته که فاصله زمانی روی سود اثر بگذارد.
  
  for (let i = 0; i < count; i++) {
    const dueDate = variableDates && variableDates[i] ? variableDates[i] : 'به زودی'; // Logic to calculate date if not provided
    
    // اگر فاصله زمانی متغیر باشد، سود آن قسط متناسب با زمان محاسبه می‌شود
    // فرمول: سود = اصل * نرخ * (تعداد روز / ۳۰)
    const currentIntervalDays = intervalDays; // Basic logic, can be refined
    const installmentInterest = Math.round(principal * (interestRatePercent / 100) * (currentIntervalDays / 30));
    const installmentPrincipal = Math.round(principal / count);
    
    installments.push({
      number: i + 1,
      dueDate,
      principal: installmentPrincipal,
      interest: installmentInterest,
      total: installmentPrincipal + installmentInterest
    });
    
    totalInterest += installmentInterest;
  }

  const totalPayable = principal + totalInterest;
  
  return {
    monthlyAmount: Math.round(totalPayable / count),
    totalInterest,
    totalPayable,
    installments
  };
}

/**
 * Calculate Credit Score based on payment history
 */
export function updateCreditScore(person: Person, installmentRequests: InstallmentRequest[]): number {
  const customerInstallments = installmentRequests.filter(r => r.personId === person.id);
  if (customerInstallments.length === 0) return 50; // Neutral starting point

  let totalPoints = 50;
  let historyCount = 0;

  customerInstallments.forEach(req => {
    req.installments.forEach(inst => {
      historyCount++;
      if (inst.status === 'paid') {
        if (inst.paidDate && inst.paidDate <= inst.dueDate) {
          totalPoints += 5; // Reward on-time
        } else {
          totalPoints += 1; // Late but paid
        }
      } else if (inst.status === 'overdue') {
        totalPoints -= 10; // Heavy penalty for overdue
      }
    });
  });

  return Math.min(100, Math.max(0, totalPoints));
}

/**
 * Automatic Settlement with Agent
 * Calculates commission based on installment request
 */
export function calculateAgentSettlement(request: InstallmentRequest, plan: InstallmentPlan): number {
  // Example logic: Agent gets a percentage of total interest or a flat fee per plan
  // Let's say 20% of the interest goes to the agent
  const principal = request.totalAmount - request.prepaymentAmount;
  const interest = Math.round(principal * (plan.interestRate / 100) * request.numberOfInstallments);
  return Math.round(interest * 0.2); // 20% commission
}

export function getAvailableSerialNumbers(productId: string, state: AppState, excludeInvoiceId?: string): string[] {
  const added = new Set<string>();
  const removed = new Set<string>();

  // Add from opening balances
  state.openingBalances.forEach(ob => {
    ob.items.forEach(item => {
      if (item.productId === productId && item.serialNumbers) {
        item.serialNumbers.forEach(sn => {
          if (sn && sn.trim()) added.add(sn.trim());
        });
      }
    });
  });

  // Add from buy invoices, remove from sell invoices
  state.invoices.forEach(inv => {
    if (inv.isProInvoice || inv.id === excludeInvoiceId) return;
    inv.items.forEach(item => {
      if (item.productId === productId && item.serialNumbers) {
        if (inv.type === 'buy') {
          item.serialNumbers.forEach(sn => {
            if (sn && sn.trim()) added.add(sn.trim());
          });
        } else if (inv.type === 'sell') {
          item.serialNumbers.forEach(sn => {
            if (sn && sn.trim()) removed.add(sn.trim());
          });
        }
      }
    });
  });

  // Return added minus removed
  return Array.from(added).filter(sn => !removed.has(sn));
}

/**
 * Validates a list of serial numbers for a specific product and transaction type.
 * Returns an array of error messages. Empty array means valid.
 */
export function validateSerialNumbers(
  productId: string, 
  serials: string[], 
  quantity: number,
  state: AppState, 
  type: 'buy' | 'sell' | 'opening',
  excludeId?: string
): string[] {
  const errors: string[] = [];
  const cleanSerials = serials.map(s => s.trim()).filter(s => s.length > 0);

  // 1. Check quantity match
  if (cleanSerials.length !== quantity) {
    errors.push(`تعداد شماره سریال‌ها (${cleanSerials.length}) با تعداد کالا (${quantity}) همخوانی ندارد.`);
  }

  // 2. Check for internal duplicates in this list
  const uniqueInList = new Set(cleanSerials);
  if (uniqueInList.size !== cleanSerials.length) {
    errors.push("در لیست وارد شده شماره سریال تکراری وجود دارد.");
  }

  // 3. Specific validation by type
  if (type === 'buy' || type === 'opening') {
    // Check if any of these serials already exist in the system (across ALL products to be safe)
    const allExisting = new Set<string>();
    state.openingBalances.forEach(ob => {
      if (ob.id === excludeId) return;
      ob.items.forEach(item => item.serialNumbers?.forEach(sn => allExisting.add(sn)));
    });
    state.invoices.forEach(inv => {
      if (inv.isProInvoice || inv.id === excludeId) return;
      inv.items.forEach(item => {
        if (inv.type === 'buy') {
          item.serialNumbers?.forEach(sn => allExisting.add(sn));
        }
      });
    });

    const duplicates = cleanSerials.filter(sn => allExisting.has(sn));
    if (duplicates.length > 0) {
      errors.push(`شماره سریال(های) زیر قبلاً در سیستم ثبت شده‌اند: ${duplicates.join(', ')}`);
    }
  } else if (type === 'sell') {
    // Check if these serials exist in stock
    const available = new Set(getAvailableSerialNumbers(productId, state, excludeId));
    const missing = cleanSerials.filter(sn => !available.has(sn));
    
    if (missing.length > 0) {
      errors.push(`شماره سریال(های) زیر در موجودی انبار یافت نشد: ${missing.join(', ')}`);
    }
  }

  return errors;
}

export function createInstallmentFeeVoucher(
  book: InstallmentBook,
  personName: string,
  nextVoucherNo: number
): JournalVoucher {
  const jalaliDate = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

  const entries: VoucherEntry[] = [
    {
      subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
      floatingDetailed: { type: 'person', id: book.personId, name: personName },
      debit: book.totalInterest,
      credit: 0,
      description: `کارمزد تقسیط بدهی - دفترچه قسط به مبلغ کل ${book.totalAmount.toLocaleString()}`
    },
    {
      subsidiaryId: 'SUB_COMMISSION_REV',
      debit: 0,
      credit: book.totalInterest,
      description: `درآمد کارمزد اقساط بابت دفترچه مشتری ${personName}`
    }
  ];

  return {
    id: `v_auto_inst_${book.id}`,
    voucherNumber: nextVoucherNo,
    date: jalaliDate,
    gregorianDate: new Date().toISOString(),
    description: `ثبت کارمزد اقساط دفترچه ${book.id}`,
    entries,
    isAutomatic: true,
    sourceType: 'installment_book',
    sourceId: book.id
  };
}

export function createReverseVoucher(
  originalVoucher: JournalVoucher,
  voidDate: string,
  voidReason: string,
  nextVoucherNo: number
): JournalVoucher {
  const reversedEntries = originalVoucher.entries.map(entry => ({
    subsidiaryId: entry.subsidiaryId,
    floatingDetailed: entry.floatingDetailed,
    debit: entry.credit,
    credit: entry.debit,
    description: `برگشت/اصلاح سند شماره ${originalVoucher.voucherNumber}: ${entry.description || ''}`
  }));

  return {
    id: `v_rev_${originalVoucher.id}_${Date.now()}`,
    voucherNumber: nextVoucherNo,
    date: voidDate,
    gregorianDate: new Date().toISOString(),
    description: `سند معکوس/ابطالی بابت سند شماره ${originalVoucher.voucherNumber} - بابت: ${voidReason}`,
    entries: reversedEntries,
    isAutomatic: true,
    sourceType: originalVoucher.sourceType,
    sourceId: originalVoucher.sourceId,
    status: 'active',
    reversalVoucherId: originalVoucher.id
  };
}

/**
 * تابع مرکزی تولید شماره یکتای سند حسابداری (Central Voucher Sequence Generator)
 * جلوگیری از تکرار شماره سند با استفاده از Math.max روی شماره‌های موجود
 */
export function getNextVoucherNumber(vouchers: JournalVoucher[]): number {
  if (!vouchers || vouchers.length === 0) {
    return 1;
  }
  const maxNo = Math.max(...vouchers.map(v => Number(v.voucherNumber) || 0));
  return Math.max(maxNo + 1, 1);
}

/**
 * بررسی سیاست حذف اسناد حسابداری (Financial Delete Guard)
 * جلوگیری از حذف فیزیکی اسناد اتوماتیک و سیستمی
 */
export function checkVoucherDeletionPolicy(voucher: JournalVoucher): { allowed: boolean; reason?: string } {
  if (!voucher) {
    return { allowed: false, reason: 'سند حسابداری نامعتبر است.' };
  }

  // ۱. بررسی اسناد اتوماتیک یا دارای sourceType غیر دستی
  const isAuto = voucher.isAutomatic === true;
  const hasSystemSourceType = Boolean(voucher.sourceType && voucher.sourceType !== 'manual');
  
  // ۲. بررسی وجود شناسه مرجع یا پیشوند IDهای سیستمی
  const hasSourceId = Boolean(voucher.sourceId);
  const isSystemGeneratedId = 
    typeof voucher.id === 'string' && (
      voucher.id.startsWith('v_auto_') || 
      voucher.id.startsWith('v_check_') || 
      voucher.id.startsWith('v_ob_') || 
      voucher.id.startsWith('v_rev_') || 
      voucher.id.startsWith('v_transfer_') ||
      voucher.id.startsWith('v_partner_')
    );

  if (isAuto || hasSystemSourceType || hasSourceId || isSystemGeneratedId) {
    return {
      allowed: false,
      reason: 'این سند حسابداری توسط سیستم ایجاد شده و حذف مستقیم آن امکان‌پذیر نیست. برای اصلاح یا بی‌اثر کردن سند، از فرآیند ابطال یا سند معکوس استفاده کنید.'
    };
  }

  return { allowed: true };
}

/**
 * Calculates the persistent cost of a sold item based on FIFO, Weighted Average, or Serial tracking.
 * Used to store the final cost price of each item at the moment of invoice finalization.
 */
export function calculatePersistentCost(
  invoiceItem: InvoiceItem,
  currentStockData: {
    products: Product[];
    invoices: Invoice[];
    openingBalances: OpeningBalance[];
  },
  costingMethod: 'fifo' | 'average' | 'serial'
): { costPrice: number; totalCostPrice: number } {
  const p = currentStockData.products.find(prod => prod.id === invoiceItem.productId);
  if (!p) {
    throw new Error(`Product not found: ${invoiceItem.productId}`);
  }

  if (costingMethod === 'average') {
    let totalQty = 0;
    let totalVal = 0;

    // 1. Include Initial Stocks from opening balance documents
    currentStockData.openingBalances.forEach(ob => {
      ob.items.forEach(item => {
        if (item.productId === p.id) {
          totalQty += item.quantity;
          totalVal += (item.quantity * item.unitCost);
        }
      });
    });

    // 2. Add purchases
    const buyInvs = currentStockData.invoices.filter(inv => !inv.isProInvoice && inv.type === 'buy');
    buyInvs.forEach(inv => {
      inv.items.forEach(item => {
        if (item.productId === p.id) {
          totalQty += item.quantity;
          totalVal += (item.quantity * item.unitPrice - item.discount);
        }
      });
    });

    const avgUnitCost = totalQty > 0 ? (totalVal / totalQty) : (p.initialUnitCost || 0);

    if (avgUnitCost <= 0) {
      throw new Error(`محاسبه بهای تمام‌شده میانگین موزون برای کالا ${p.name || p.id} امکان‌پذیر نیست.`);
    }

    return {
      costPrice: Math.round(avgUnitCost),
      totalCostPrice: Math.round(invoiceItem.quantity * avgUnitCost)
    };

  } else if (costingMethod === 'fifo') {
    const layers: { quantity: number; unitPrice: number }[] = [];
    
    // 1. Add layers from opening balances
    currentStockData.openingBalances.forEach(ob => {
      ob.items.forEach(item => {
        if (item.productId === p.id && item.quantity > 0) {
          layers.push({ quantity: item.quantity, unitPrice: item.unitCost });
        }
      });
    });

    // 2. Add layers from buy invoices (chronological)
    const buyInvs = currentStockData.invoices
      .filter(inv => !inv.isProInvoice && inv.type === 'buy')
      .sort((a, b) => a.date.localeCompare(b.date));

    buyInvs.forEach(inv => {
      inv.items.forEach(item => {
        if (item.productId === p.id) {
          const netUnitPrice = item.quantity > 0 ? (item.quantity * item.unitPrice - item.discount) / item.quantity : item.unitPrice;
          layers.push({ quantity: item.quantity, unitPrice: netUnitPrice });
        }
      });
    });

    // 3. Exhaust layers with all existing sales in currentStockData.invoices
    const sellInvs = currentStockData.invoices
      .filter(inv => !inv.isProInvoice && inv.type === 'sell')
      .sort((a, b) => a.date.localeCompare(b.date));

    sellInvs.forEach(inv => {
      inv.items.forEach(item => {
        if (item.productId === p.id) {
          let qtyToFulfill = item.quantity;
          while (qtyToFulfill > 0 && layers.length > 0) {
            const currentLayer = layers[0];
            if (currentLayer.quantity <= qtyToFulfill) {
              qtyToFulfill -= currentLayer.quantity;
              layers.shift();
            } else {
              currentLayer.quantity -= qtyToFulfill;
              qtyToFulfill = 0;
            }
          }
        }
      });
    });

    // 4. Now calculate cost for the current invoiceItem.quantity
    let qtyToFulfill = invoiceItem.quantity;
    let totalCostPrice = 0;

    while (qtyToFulfill > 0 && layers.length > 0) {
      const currentLayer = layers[0];
      if (currentLayer.quantity <= qtyToFulfill) {
        totalCostPrice += currentLayer.quantity * currentLayer.unitPrice;
        qtyToFulfill -= currentLayer.quantity;
        layers.shift();
      } else {
        totalCostPrice += qtyToFulfill * currentLayer.unitPrice;
        currentLayer.quantity -= qtyToFulfill;
        qtyToFulfill = 0;
      }
    }

    if (qtyToFulfill > 0) {
      totalCostPrice += qtyToFulfill * (p.initialUnitCost || 0);
    }

    const costPrice = invoiceItem.quantity > 0 ? (totalCostPrice / invoiceItem.quantity) : 0;

    if (totalCostPrice <= 0) {
      throw new Error(`محاسبه بهای تمام‌شده FIFO برای کالا ${p.name || p.id} امکان‌پذیر نیست.`);
    }

    return {
      costPrice: Math.round(costPrice),
      totalCostPrice: Math.round(totalCostPrice)
    };

  } else if (costingMethod === 'serial') {
    const serialCostMap = new Map<string, number>();

    currentStockData.openingBalances.forEach(ob => {
      ob.items.forEach(item => {
        const prod = currentStockData.products.find(prodItem => prodItem.id === item.productId);
        if (prod && prod.category === 'موبایل') {
          (item.serialNumbers || []).forEach(sn => {
            serialCostMap.set(sn, item.unitCost);
          });
        }
      });
    });

    const buyInvs = currentStockData.invoices.filter(inv => !inv.isProInvoice && inv.type === 'buy');
    buyInvs.forEach(inv => {
      inv.items.forEach(item => {
        const prod = currentStockData.products.find(prodItem => prodItem.id === item.productId);
        if (prod && prod.category === 'موبایل') {
          (item.serialNumbers || []).forEach(sn => {
            serialCostMap.set(sn, item.unitPrice);
          });
        }
      });
    });

    // Calculate Weighted Average fallback cost
    let totalQty = 0;
    let totalVal = 0;

    currentStockData.openingBalances.forEach(ob => {
      ob.items.forEach(item => {
        if (item.productId === p.id) {
          totalQty += item.quantity;
          totalVal += (item.quantity * item.unitCost);
        }
      });
    });

    buyInvs.forEach(inv => {
      inv.items.forEach(item => {
        if (item.productId === p.id) {
          totalQty += item.quantity;
          totalVal += (item.quantity * item.unitPrice - item.discount);
        }
      });
    });

    const avgUnitCost = totalQty > 0 ? (totalVal / totalQty) : (p.initialUnitCost || 0);

    let totalCostPrice = 0;

    if (p.category === 'موبایل') {
      let matchedCount = 0;
      (invoiceItem.serialNumbers || []).forEach(sn => {
        if (serialCostMap.has(sn)) {
          totalCostPrice += serialCostMap.get(sn)!;
          matchedCount++;
        }
      });

      const unmatchedQty = invoiceItem.quantity - matchedCount;
      if (unmatchedQty > 0) {
        totalCostPrice += unmatchedQty * avgUnitCost;
      }
    } else {
      totalCostPrice = invoiceItem.quantity * avgUnitCost;
    }

    const costPrice = invoiceItem.quantity > 0 ? (totalCostPrice / invoiceItem.quantity) : 0;

    if (totalCostPrice <= 0) {
      throw new Error(`محاسبه بهای تمام‌شده سریال برای کالا ${p.name || p.id} امکان‌پذیر نیست.`);
    }

    return {
      costPrice: Math.round(costPrice),
      totalCostPrice: Math.round(totalCostPrice)
    };
  }

  throw new Error(`روش بهای تمام‌شده نامعتبر است: ${costingMethod}`);
}

export function getFilteredPersonsForSell(persons: Person[], businessPartners: BusinessPartner[] = []): Person[] {
  return persons.filter(p => {
    const bp = businessPartners.find(b => b.personId === p.id);
    // Exclude persons whose business partner record is explicitly inactive
    if (bp && bp.status === 'inactive') {
      return false;
    }
    // Otherwise, include all distinct person records as they are
    return true;
  });
}

export function isValidCheckTransition(
  checkType: 'received' | 'paid',
  currentState: ReceivedCheckState | PaidCheckState,
  newState: ReceivedCheckState | PaidCheckState,
  newSubState?: BouncedReceivedCheckSubState | BouncedPaidCheckSubState
): { allowed: boolean; reason?: string } {
  // If no change, allowed
  if (currentState === newState) {
    return { allowed: true };
  }

  if (checkType === 'received') {
    const from = currentState as ReceivedCheckState;
    const to = newState as ReceivedCheckState;

    if (from === 'passed_to_others') {
      if (to === 'present_in_cashbox') {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'این عملیات با وضعیت فعلی چک مجاز نیست.',
      };
    }

    if (from === 'cleared') {
      return {
        allowed: false,
        reason: 'این عملیات با وضعیت فعلی چک مجاز نیست.',
      };
    }

    if (from === 'present_in_cashbox') {
      if (['deposited_to_bank', 'cleared', 'passed_to_others', 'bounced'].includes(to)) {
        return { allowed: true };
      }
    } else if (from === 'deposited_to_bank') {
      if (['cleared', 'bounced'].includes(to)) {
        return { allowed: true };
      }
    } else if (from === 'bounced') {
      if (['present_in_cashbox', 'cleared', 'bounced'].includes(to)) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: 'این عملیات با وضعیت فعلی چک مجاز نیست.',
    };
  } else {
    // Paid check
    const from = currentState as PaidCheckState;
    const to = newState as PaidCheckState;

    if (from === 'cleared') {
      return {
        allowed: false,
        reason: 'این عملیات با وضعیت فعلی چک مجاز نیست.',
      };
    }

    if (from === 'issued') {
      if (['cleared', 'bounced'].includes(to)) {
        return { allowed: true };
      }
    } else if (from === 'bounced') {
      if (['cleared', 'bounced'].includes(to)) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: 'این عملیات با وضعیت فعلی چک مجاز نیست.',
    };
  }
}

/**
 * Audit & Compilation Engine for 8-Column Trial Balance (تراز آزمایشی ۸ ستونی)
 */
export interface TrialBalance8ColumnRow {
  code: string;
  name: string;
  level: 'general' | 'subsidiary' | 'detailed';
  parentCode?: string;
  // 8 Columns:
  openingDebit: number;    // ۱. گردش/مانده ابتدای دوره - بدهکار
  openingCredit: number;   // ۲. گردش/مانده ابتدای دوره - بستانکار
  periodDebit: number;     // ۳. گردش طی دوره - بدهکار
  periodCredit: number;    // ۴. گردش طی دوره - بستانکار
  totalDebit: number;      // ۵. گردش کل / مجموع - بدهکار
  totalCredit: number;     // ۶. گردش کل / مجموع - بستانکار
  closingDebit: number;    // ۷. مانده پایان دوره - بدهکار
  closingCredit: number;   // ۸. مانده پایان دوره - بستانکار
}

export interface TrialBalance8ColumnResult {
  rows: TrialBalance8ColumnRow[];
  totals: {
    openingDebit: number;
    openingCredit: number;
    periodDebit: number;
    periodCredit: number;
    totalDebit: number;
    totalCredit: number;
    closingDebit: number;
    closingCredit: number;
  };
  imbalances: {
    openingDiff: number;
    periodDiff: number;
    totalDiff: number;
    closingDiff: number;
  };
  isBalanced: boolean;
}

export function calculate8ColumnTrialBalance(
  vouchers: JournalVoucher[],
  subsidiaries: AccountSubsidiary[],
  startDate: string = '1400/01/01',
  endDate: string = '1499/12/29',
  level: 'general' | 'subsidiary' | 'detailed' = 'subsidiary'
): TrialBalance8ColumnResult {
  const generalMap: Record<string, { code: string; name: string; rawPrevDebit: number; rawPrevCredit: number; rawTurnoverDebit: number; rawTurnoverCredit: number }> = {};
  const subsidiaryMap: Record<string, { id: string; code: string; name: string; genCode: string; rawPrevDebit: number; rawPrevCredit: number; rawTurnoverDebit: number; rawTurnoverCredit: number }> = {};
  const detailedMap: Record<string, { code: string; name: string; subId: string; rawPrevDebit: number; rawPrevCredit: number; rawTurnoverDebit: number; rawTurnoverCredit: number }> = {};

  function getGeneralAccountName(genCode: string, defaultName: string): string {
    const map: Record<string, string> = {
      '101': 'موجودی نقدی و بانک - بانک‌ها',
      '102': 'موجودی نقدی و بانک - صندوق‌ها',
      '103': 'حساب‌های دریافتنی (بدهکاران تجاری)',
      '104': 'اسناد دریافتنی و در جریان وصول',
      '105': 'موجودی کالا (انبار)',
      '106': 'پیش‌پرداخت‌ها و دارایی‌های جاری دیگر',
      '201': 'اسناد پرداختنی (چک‌های صادره)',
      '202': 'حساب‌های پرداختنی (بستانکاران تجاری)',
      '203': 'پیش‌دریافت‌ها و بدهی‌های جاری دیگر',
      '204': 'تسهیلات و استقراض‌های دریافتی',
      '501': 'سرمایه و جاری شرکا',
      '601': 'درآمدهای عملیاتی و فروش',
      '602': 'سایر درآمدها و کارمزد',
      '701': 'بهای تمام شده کالای فروش رفته',
      '702': 'هزینه‌های عمومی، اداری و تشکیلاتی',
      '703': 'هزینه‌های مالی و بهره پرداختی',
      '999': 'تراز افتتاحیه'
    };
    return map[genCode] || defaultName || `حساب کل ${genCode}`;
  }

  // Initialize maps from subsidiaries
  subsidiaries.forEach(sub => {
    const genCode = sub.code.slice(0, 3);
    subsidiaryMap[sub.id] = {
      id: sub.id,
      code: sub.code,
      name: sub.name,
      genCode,
      rawPrevDebit: 0,
      rawPrevCredit: 0,
      rawTurnoverDebit: 0,
      rawTurnoverCredit: 0,
    };

    if (!generalMap[genCode]) {
      generalMap[genCode] = {
        code: genCode,
        name: getGeneralAccountName(genCode, sub.generalType),
        rawPrevDebit: 0,
        rawPrevCredit: 0,
        rawTurnoverDebit: 0,
        rawTurnoverCredit: 0,
      };
    }
  });

  // Populate from vouchers
  vouchers.forEach(v => {
    v.entries.forEach(e => {
      const sub = subsidiaries.find(s => s.id === e.subsidiaryId);
      if (!sub) return;

      const genCode = sub.code.slice(0, 3);
      const debit = e.debit || 0;
      const credit = e.credit || 0;

      const isPrev = v.date < startDate;
      const isDuring = v.date >= startDate && v.date <= endDate;

      // Subsidiary
      if (!subsidiaryMap[sub.id]) {
        subsidiaryMap[sub.id] = {
          id: sub.id,
          code: sub.code,
          name: sub.name,
          genCode,
          rawPrevDebit: 0,
          rawPrevCredit: 0,
          rawTurnoverDebit: 0,
          rawTurnoverCredit: 0,
        };
      }
      if (isPrev) {
        subsidiaryMap[sub.id].rawPrevDebit += debit;
        subsidiaryMap[sub.id].rawPrevCredit += credit;
      } else if (isDuring) {
        subsidiaryMap[sub.id].rawTurnoverDebit += debit;
        subsidiaryMap[sub.id].rawTurnoverCredit += credit;
      }

      // General
      if (!generalMap[genCode]) {
        generalMap[genCode] = {
          code: genCode,
          name: getGeneralAccountName(genCode, sub.generalType),
          rawPrevDebit: 0,
          rawPrevCredit: 0,
          rawTurnoverDebit: 0,
          rawTurnoverCredit: 0,
        };
      }
      if (isPrev) {
        generalMap[genCode].rawPrevDebit += debit;
        generalMap[genCode].rawPrevCredit += credit;
      } else if (isDuring) {
        generalMap[genCode].rawTurnoverDebit += debit;
        generalMap[genCode].rawTurnoverCredit += credit;
      }

      // Detailed
      if (e.floatingDetailed) {
        const detailedId = e.floatingDetailed.id;
        const detailedName = e.floatingDetailed.name;
        const type = e.floatingDetailed.type;
        const detailedKey = `${sub.id}_${type}_${detailedId}`;

        if (!detailedMap[detailedKey]) {
          const shortId = detailedId.slice(-4).toUpperCase();
          const detailedCode = `${sub.code}-${shortId}`;
          detailedMap[detailedKey] = {
            code: detailedCode,
            name: detailedName,
            subId: sub.id,
            rawPrevDebit: 0,
            rawPrevCredit: 0,
            rawTurnoverDebit: 0,
            rawTurnoverCredit: 0,
          };
        }

        if (isPrev) {
          detailedMap[detailedKey].rawPrevDebit += debit;
          detailedMap[detailedKey].rawPrevCredit += credit;
        } else if (isDuring) {
          detailedMap[detailedKey].rawTurnoverDebit += debit;
          detailedMap[detailedKey].rawTurnoverCredit += credit;
        }
      }
    });
  });

  function calculate8ColRow(raw: { code: string; name: string; rawPrevDebit: number; rawPrevCredit: number; rawTurnoverDebit: number; rawTurnoverCredit: number }) {
    const openingNet = raw.rawPrevDebit - raw.rawPrevCredit;
    const openingDebit = openingNet > 0 ? openingNet : 0;
    const openingCredit = openingNet < 0 ? Math.abs(openingNet) : 0;

    const periodDebit = raw.rawTurnoverDebit;
    const periodCredit = raw.rawTurnoverCredit;

    const totalDebit = openingDebit + periodDebit;
    const totalCredit = openingCredit + periodCredit;

    const endNet = (raw.rawPrevDebit + raw.rawTurnoverDebit) - (raw.rawPrevCredit + raw.rawTurnoverCredit);
    const closingDebit = endNet > 0 ? endNet : 0;
    const closingCredit = endNet < 0 ? Math.abs(endNet) : 0;

    return {
      code: raw.code,
      name: raw.name,
      openingDebit,
      openingCredit,
      periodDebit,
      periodCredit,
      totalDebit,
      totalCredit,
      closingDebit,
      closingCredit,
      rawPrevDebit: raw.rawPrevDebit,
      rawPrevCredit: raw.rawPrevCredit,
      rawTurnoverDebit: raw.rawTurnoverDebit,
      rawTurnoverCredit: raw.rawTurnoverCredit
    };
  }

  const hasActivity = (row: any) => {
    return (
      row.rawPrevDebit > 0 ||
      row.rawPrevCredit > 0 ||
      row.rawTurnoverDebit > 0 ||
      row.rawTurnoverCredit > 0
    );
  };

  const rows: TrialBalance8ColumnRow[] = [];
  const sortedGenCodes = Object.keys(generalMap).sort((a, b) => a.localeCompare(b));

  sortedGenCodes.forEach(genCode => {
    const genRaw = generalMap[genCode];
    const genRow = { ...calculate8ColRow(genRaw), level: 'general' as const };

    if (!hasActivity(genRow)) return;

    if (level === 'general') {
      rows.push(genRow);
      return;
    }

    const subRows = Object.entries(subsidiaryMap)
      .filter(([_, subRaw]) => subRaw.genCode === genCode)
      .map(([id, subRaw]) => ({ ...calculate8ColRow(subRaw), id, level: 'subsidiary' as const, parentCode: genCode }))
      .filter(hasActivity)
      .sort((a, b) => a.code.localeCompare(b.code));

    if (subRows.length === 0) return;

    rows.push(genRow);

    subRows.forEach(subRow => {
      rows.push(subRow);

      if (level === 'detailed') {
        const detRows = Object.entries(detailedMap)
          .filter(([_, detRaw]) => detRaw.subId === subRow.id)
          .map(([_, detRaw]) => ({ ...calculate8ColRow(detRaw), level: 'detailed' as const, parentCode: subRow.code }))
          .filter(hasActivity)
          .sort((a, b) => a.code.localeCompare(b.code));

        detRows.forEach(detRow => {
          rows.push(detRow);
        });
      }
    });
  });

  let totalOpeningDebit = 0;
  let totalOpeningCredit = 0;
  let totalPeriodDebit = 0;
  let totalPeriodCredit = 0;
  let totalCumDebit = 0;
  let totalCumCredit = 0;
  let totalClosingDebit = 0;
  let totalClosingCredit = 0;

  rows.forEach((r, i) => {
    let isLeaf = false;
    if (level === 'general') {
      if (r.level === 'general') isLeaf = true;
    } else if (level === 'subsidiary') {
      if (r.level === 'subsidiary') isLeaf = true;
    } else if (level === 'detailed') {
      if (r.level === 'detailed') {
        isLeaf = true;
      } else if (r.level === 'subsidiary') {
        const hasDetailedChildren = i < rows.length - 1 && rows[i + 1].level === 'detailed';
        if (!hasDetailedChildren) {
          isLeaf = true;
        }
      }
    }

    if (isLeaf) {
      totalOpeningDebit += r.openingDebit;
      totalOpeningCredit += r.openingCredit;
      totalPeriodDebit += r.periodDebit;
      totalPeriodCredit += r.periodCredit;
      totalCumDebit += r.totalDebit;
      totalCumCredit += r.totalCredit;
      totalClosingDebit += r.closingDebit;
      totalClosingCredit += r.closingCredit;
    }
  });

  const openingDiff = totalOpeningDebit - totalOpeningCredit;
  const periodDiff = totalPeriodDebit - totalPeriodCredit;
  const totalDiff = totalCumDebit - totalCumCredit;
  const closingDiff = totalClosingDebit - totalClosingCredit;

  const isBalanced = 
    Math.abs(openingDiff) < 1 &&
    Math.abs(periodDiff) < 1 &&
    Math.abs(totalDiff) < 1 &&
    Math.abs(closingDiff) < 1;

  return {
    rows,
    totals: {
      openingDebit: totalOpeningDebit,
      openingCredit: totalOpeningCredit,
      periodDebit: totalPeriodDebit,
      periodCredit: totalPeriodCredit,
      totalDebit: totalCumDebit,
      totalCredit: totalCumCredit,
      closingDebit: totalClosingDebit,
      closingCredit: totalClosingCredit,
    },
    imbalances: {
      openingDiff,
      periodDiff,
      totalDiff,
      closingDiff,
    },
    isBalanced,
  };
}

