/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  KnowledgeCategory, 
  KnowledgeArticle, 
  KnowledgeStep, 
  KnowledgeError, 
  KnowledgeGlossary, 
  KnowledgeVersion 
} from './modules/knowledge/knowledge.types';
import { CreditControlDraft } from './modules/creditControl/creditControl.types';
import { SmsSettings, SmsTemplate } from './modules/sms/types';
import { 
  InvestorProfile, 
  InvestorContract, 
  InvestorPaymentSchedule, 
  InvestorPaymentObligation,
  InvestorReferral,
  InvestorReturnRequest,
  InvestorAuditLog
} from './modules/investors/types';

export interface AgentGuarantor {
  id: string;
  name: string;
  nationalId: string;
  mobile: string;
  relation: string;
}

export interface AgentGuaranteeCheck {
  id: string;
  checkNumber: string;
  bankName: string;
  amount: number;
  sayadiNumber?: string;
  dueDate: string;
}

export interface AgentDetails {
  storeName?: string;
  storeAddress?: string;
  agentToken?: string;
  guarantors?: AgentGuarantor[];
  guaranteeChecks?: AgentGuaranteeCheck[];
}

export type DocumentCategoryType = 
  | 'national_card' 
  | 'birth_certificate' 
  | 'contract'
  | 'bank_credit_scoring'
  | 'refah_beta_report'
  | 'employment_income' 
  | 'business_license'
  | 'bank_cheque' 
  | 'check_images'
  | 'guarantee_promissory' 
  | 'other';

export interface PersonAttachment {
  id: string;
  name: string;
  url: string; // Base64 or object URL for local
  type: string;
  uploadDate: string;
  category?: DocumentCategoryType;
  status?: 'pending' | 'unreviewed' | 'reviewed' | 'approved' | 'rejected' | 'needs_revision';
  rejectionReason?: string; // Serves as short description
  reviewerName?: string;
  reviewDate?: string;
  internalNote?: string;
  fileSizeKb?: number;
  originalSizeKb?: number;
}

export interface CriticalDetails {
  phoneBoxStatus: 'at_store' | 'delivered' | 'none';
  ownershipStatus: 'at_store' | 'delivered' | 'none';
  guaranteeCheckStatus: 'at_store' | 'delivered' | 'none';
  manualNotes: string;
  updatedAt: string;
}

export type PersonRoleType = 'customer' | 'supplier' | 'sales_rep' | 'credit_rep' | 'employee' | 'other';
export type PersonStatusType = 'active' | 'inactive' | 'blocked';

export interface Person {
  id: string; // ID
  code: string; // Unique Person Code (e.g. P1001)
  name: string; // Full Name (نام و نام خانوادگی)
  nationalId?: string; // National ID (کد ملی)
  address?: string; // Address (آدرس)
  mobile?: string; // Mobile (شماره موبایل)
  phone?: string; // Phone (شماره ثابت)
  roles?: PersonRoleType[]; // نقش‌های چندگانه (مشتری، تامین‌کننده، نماینده فروش، نماینده اعتباری، کارمند، سایر)
  status?: PersonStatusType; // وضعیت شخص (فعال، غیرفعال، مسدود)
  personType?: 'real' | 'legal'; // نوع شخص: حقیقی / حقوقی
  gender?: 'male' | 'female' | 'other'; // جنسیت (برای شخص حقیقی)
  accountHolderName?: string; // نام صاحب حساب بانکی
  province?: string; // استان
  city?: string; // شهر
  district?: string; // منطقه
  postalCode?: string; // کد پستی
  fatherName?: string; // نام پدر
  birthDate?: string; // تاریخ تولد / تاریخ تاسیس
  companyName?: string; // نام شرکت یا مجموعه
  cardNumber?: string; // شماره کارت بانکی
  shebaNumber?: string; // شماره شبا
  bankName?: string; // نام بانک
  internalNotes?: string; // توضیحات داخلی
  isAgent?: boolean; // Is independent credit agent?
  agencyRole?: string;
  agencyStatus?: string;
  agencyCreditLimit?: number;
  agentDetails?: AgentDetails; // Extra details if isAgent
  attachments?: PersonAttachment[]; // Customer Documents / مدارک شخص
  creditLimit?: number; // Feature 5: Credit Limit
  creditScore?: number; // رتبه اعتباری (0-100)
  role?: 'debtor' | 'creditor' | 'both'; // role: debtor (بدهکار), creditor (بستانکار) or both
  isOfflineWholesaleEnabled?: boolean; // فعال بودن بخش عمده‌فروشی آفلاین
  isInstallmentEnabled?: boolean; // فعال بودن بخش فروش اقساطی
  allowedDelayDays?: number; // تعداد روز مجاز نسیه
  isDocumentsApproved?: boolean; // وضعیت تایید مستندات ضمانت توسط مدیریت
  walletBalance?: number; // تراز یا موجودی کیف پول اعتباری همکار
  penaltyRate?: number; // نرخ جریمه دیرکرد روزانه درصد (مثلاً 0.1 درصد)
  criticalDetails?: CriticalDetails; // Feature: Critical Status Panel
  createdAt: string; // ISO String
  updatedAt?: string; // ISO String تاریخ آخرین تغییر
  createdBy?: string;
  ownerUserId?: string;
  generatedPassword?: string;
  loginIdentifier?: string;
  branchId?: string;
  representativeId?: string;
  organizationId?: string;
  hasActivity?: boolean;
}

export interface ProductCategory {
  id: string;
  organizationId?: string;
  parentCategoryId?: string | null;
  code: string;
  title: string;
  description?: string | null;
  isActive: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface MeasurementUnit {
  id: string;
  organizationId?: string;
  code: string;
  title: string;
  allowsFraction: boolean;
  decimalPlaces: number;
  isActive: boolean;
  isSystem: boolean;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Product {
  id: string;
  code: string; // e.g. K1001 (کد کالا / بارکد)
  name: string; // Item Name (نام کالا)
  category: string; // Category Title / Name (دسته کالا/خدمت)
  categoryId?: string; // Foreign Key to product_categories.id
  measurementUnitId?: string; // Foreign Key to measurement_units.id
  isService?: boolean; // Is this a service? (product_kind === 'SERVICE')
  productKind?: 'PRODUCT' | 'SERVICE';
  unit: string; // Unit Title / Name (دستگاه, عدد, پک)
  initialStock: number; // Initial Stock (موجودی اولیه - فقط برای نمایش سازگار)
  initialUnitCost?: number; // بهای واحد موجودی اولیه
  reorderPoint: number; // Reorder Point (نقطه سفارش حداقل موجودی)
  hasSerial?: boolean; // آیا این کالا دارای شماره سریال (IMEI) است
  isSerialized?: boolean;
  defaultSalePrice?: number; // Default Sale Price (قیمت فروش پیش‌فرض)
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  isActive?: boolean;
  version?: number;
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
  ownerUserId?: string;
  branchId?: string;
  representativeId?: string;
  organizationId?: string;
}

// Accounting Levels
export type AccountGroup = 
  | 'دارایی‌های جاری'
  | 'دارایی‌های غیرجاری'
  | 'بدهی‌های جاری'
  | 'بدهی‌های غیرجاری'
  | 'حقوق صاحبان سهام'
  | 'درآمدها'
  | 'هزینه‌ها';

export type AccountGeneral =
  | 'بانک‌ها'
  | 'صندوق‌ها'
  | 'بدهکاران تجاری'
  | 'بستانکاران تجاری'
  | 'اسناد دریافتنی'
  | 'اسناد پرداختنی'
  | 'اسناد در جریان وصول'
  | 'موجودی کالا'
  | 'پیش‌پرداخت‌ها'
  | 'پیش‌دریافت‌ها'
  | 'سرمایه'
  | 'فروش کالا'
  | 'بهای تمام شده کالای فروش رفته'
  | 'هزینه‌های عمومی و اداری'
  | 'درآمد کارمزد'
  | 'تسهیلات دریافتی'
  | 'جاری شرکا و سرمایه‌گذاران'
  | 'تراز افتتاحیه'
  | 'هزینه‌های مالی';

export interface AccountSubsidiary {
  id: string; // e.g. SUB_MELI, SUB_SANDOGH_MAIN
  generalType: AccountGeneral;
  groupType: AccountGroup;
  name: string; // e.g. "بانک ملی شعبه مرکزی" or "صندوق اصلی" or "هزینه قبوض"
  code: string; // e.g. 10101, 10201
  requiresPerson?: boolean;
  requiresCostCenter?: boolean;
}

// Floating Detailed (تفصیلی شناور): This is dynamic based on Person or Product or generic items
export interface FloatingDetailed {
  type: 'person' | 'product' | 'other';
  id: string; // Reference to person ID or product ID or other
  name: string;
}

export interface VoucherEntry {
  subsidiaryId: string; // Target Subsidiary Account ID
  floatingDetailed?: FloatingDetailed; // Optional floating detailed reference (Person or Product)
  debit: number; // بدهکار
  credit: number; // بستانکار
  description?: string; // بابت ...
  contractType?: 'credit' | 'deferred_sales' | string; // نوع قرارداد جهت تفکیک پرونده مالی نماینده
}

export type DocumentStatus = 'active' | 'voided' | 'draft';

export interface JournalVoucher {
  id: string;
  voucherNumber: number; // Unique sequential voucher number
  date: string; // Jalali Date (YYYY/MM/DD)
  gregorianDate: string; // ISO date
  description: string; // شرح کلی سند
  entries: VoucherEntry[];
  isAutomatic: boolean; // Is automatically generated or manual
  sourceType?: 'buy_invoice' | 'sell_invoice' | 'check_state_change' | 'manual' | 'opening_balance' | 'installment_book' | 'transfer' | 'cash_transaction';
  sourceId?: string; // ID of the source invoice or check
  createdBy?: string;
  ownerUserId?: string;
  branchId?: string;
  representativeId?: string;
  organizationId?: string;
  contractType?: 'credit' | 'deferred_sales' | string; // نوع قرارداد جهت تفکیک پرونده مالی نماینده
  status?: DocumentStatus;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  reversalVoucherId?: string;
}

export type CheckType = 'received' | 'paid';

export type ReceivedCheckState =
  | 'present_in_cashbox' // موجود در صندوق
  | 'deposited_to_bank' // واگذار شده به بانک (در جریان وصول)
  | 'cleared' // وصول شده (واریز به حساب بانک)
  | 'passed_to_others' // خرج شده به دیگران
  | 'bounced'; // برگشتی

export type BouncedReceivedCheckSubState =
  | 'returned_to_customer' // عودت داده شده به مشتری
  | 'in_legal_process' // در جریان حقوقی
  | 'cleared_after_bounce'; // وصول شده پس از برگشت

export type PaidCheckState =
  | 'issued' // صادر شده
  | 'cleared' // پاس شده
  | 'bounced'; // برگشتی

export type BouncedPaidCheckSubState =
  | 'un_bounced_solved' // رفع سوء اثر شده
  | 'provisioned_funds'; // تامین موجودی شده

export enum CheckReviewStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  NEEDS_CORRECTION = 'NEEDS_CORRECTION',
  REJECTED = 'REJECTED',
}

export interface CheckReviewHistoryItem {
  id: string;
  fromStatus?: CheckReviewStatus;
  toStatus: CheckReviewStatus;
  timestamp: string;
  jalaliDate: string;
  actorName: string;
  comment?: string;
}

export interface CheckbookLeafModel {
  leafIndex: number; // شماره برگه از ۱ تا N
  checkNumber: string; // شماره سریال برگه چک
  sayadiNumber: string; // کد صیادی ۱۶ رقمی
  status: 'unused' | 'issued' | 'cancelled';
  checkId?: string; // آیدی چک صادر شده در صورت وجود
  issuedDate?: string;
  note?: string;
}

export interface CheckbookModel {
  id: string;
  bankAccountId: string; // شناسه حساب بانکی معین متصل (issuerBankAccountId)
  bankName: string; // نام بانک صادرکننده
  issuerNationalId?: string; // کد ملی صادرکننده چک
  totalLeaves: number; // تعداد برگه‌ها
  startSerial: string; // شماره سریال شروع
  endSerial: string; // شماره سریال پایان
  prefix4Digits: string; // ۴ رقم اول صیادی (سمت چپ - مسلسل)
  middle8Digits: string; // ۸ رقم وسط صیادی (ثابت)
  leaves: CheckbookLeafModel[];
  createdAt: string;
  status: 'active' | 'finished' | 'archived';
  title?: string; // عنوان اختیاری دسته چک
}

export interface Check {
  id: string;
  type: CheckType;
  voucherId?: string; // شناسه سند حسابداری اول یا اصلی چک
  invoiceId?: string;
  installmentBookId?: string;
  investorId?: string;
  checkNumber: string; // شماره سریال چک (یا همان شماره چک)
  sayadiNumber?: string; // شماره صیادی جداگانه
  bankName: string; // نام بانک (برای صادرکننده یا بانک چک دریافتی)
  issuerBankAccountId?: string; // شناسه حساب بانکی معین شرکت صادرکننده چک پرداختی
  checkbookId?: string; // شناسه دسته چک مربوطه (در صورت استفاده از دسته چک)
  leafIndex?: number; // شماره برگه در دسته چک (۱ تا N)
  dueDate: string; // تاریخ سررسید (Jalali YYYY/MM/DD)
  amount: number; // مبلغ چک
  personId: string; // صادرکننده (برای دریافتی) یا دریافت‌کننده (برای پرداختی)
  nationalId?: string; // کد ملی صاحب چک (برای نمایندگان اجباری است)
  isApproved?: boolean; // تایید شده توسط مدیریت (Legacy)
  reviewStatus?: CheckReviewStatus; // وضعیت بررسی چک (جدید)
  reviewHistory?: CheckReviewHistoryItem[]; // تاریخچه بررسی مدیریت
  rejectionReason?: string; // دلیل رد یا نیاز به اصلاح چک
  isInstallment?: boolean; // آیا چک مربوط به تسویه اقساطی/چکی است
  submittedByAgentId?: string; // آیدی نماینده‌ای که چک را ثبت کرده
  isAmani?: boolean; // آیا چک امانی/ضمانتی است (بدون اثر مالی)
  isInvestorCommission?: boolean; // آیا چک بابت کارمزد سرمایه‌گذار صادر شده است (عدم کسر از جاری شخص در زمان صدور)
  investorContractId?: string; // شناسه قرارداد سرمایه‌گذاری
  investorObligationId?: string; // شناسه تعهد سرمایه‌گذار
  currentState: ReceivedCheckState | PaidCheckState;
  currentSubState?: BouncedReceivedCheckSubState | BouncedPaidCheckSubState;
  depositedBankId?: string; // ID of the bank where it was deposited
  version?: number;
  legacyId?: string;
  // Dedicated Check Archive & Legal Dossier (بایگانی اختصاصی و پرونده حقوقی)
  frontImage?: string; // تصویر روی چک
  backImage?: string; // تصویر پشت چک
  endorsementImage?: string; // تصویر ظهرنویسی
  nonPaymentCertificateImage?: string; // تصویر گواهی عدم پرداخت
  legalDocuments?: PersonAttachment[]; // مدارک و پیوست‌های حقوقی
  legalCaseNumber?: string; // شماره پرونده حقوقی
  legalAuthorityReference?: string; // مرجع رسیدگی (دادگاه/شورای حل اختلاف)
  nonPaymentCertificateNumber?: string; // شماره گواهی عدم پرداخت
  nonPaymentCertificateDate?: string; // تاریخ دریافت گواهی عدم پرداخت
  legalAssignedLawyer?: string; // وکیل یا مسئول پیگیری حقوقی
  legalLastStatus?: string; // آخرین وضعیت پرونده حقوقی
  legalLastActionDate?: string; // تاریخ آخرین اقدام حقوقی
  history: {
    state: ReceivedCheckState | PaidCheckState;
    subState?: BouncedReceivedCheckSubState | BouncedPaidCheckSubState;
    date: string; // Jalali YYYY/MM/DD
    voucherId?: string; // Accounting Voucher ID issued for this change
    note?: string;
    userId?: string; // شناسه کاربر انجام‌دهنده
    actorName?: string; // نام کاربر ثبت‌کننده
    beforeState?: ReceivedCheckState | PaidCheckState; // وضعیت قبل
    afterState?: ReceivedCheckState | PaidCheckState; // وضعیت بعد
    timestamp?: string; // تاریخ و زمان دقیق ثبت
    ipOrSessionId?: string; // شناسه نشست / IP
  }[];
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
  ownerUserId?: string;
  branchId?: string;
  representativeId?: string;
  organizationId?: string;
  status?: DocumentStatus;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  reversalVoucherId?: string;
}

export interface InvoiceItem {
  productId: string;
  quantity: number;
  unitPrice: number; // فی خرید یا فروش
  discount: number; // تخفیف ردیفی (مبلغ)
  serialNumbers?: string[]; // آرایه شماره سریال‌های وارد شده
  warehouseId: string; // Feature 8: Warehouse
  costPrice?: number;
  totalCostPrice?: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: number; // Sequential number
  type: 'buy' | 'sell';
  isProInvoice: boolean; // پیش‌فاکتور (قرنطینه و بدون اثر مالی)
  isConverted: boolean; // Has been converted from pro-invoice to real invoice
  date: string; // Jalali Date YYYY/MM/DD
  personId: string; // Buyer or Supplier
  items: InvoiceItem[];
  discount: number; // تخفیف کلی زیر فاکتور
  taxPercent: number; // درصد مالیات بر ارزش افزوده
  description?: string;
  voucherId?: string; // Associated double-entry journal entry ID
  totalAmount: number; // Feature 7: Aging
  paidAmount: number; // Feature 7: Aging
  cashPaidAmount?: number; // مبلغ نقدی / بانکی پرداختی
  posPaidAmount?: number; // مبلغ کارتخوان پرداختی
  posTerminalId?: string; // آیدی دستگاه کارتخوان انتخابی
  isInstallmentDeferred?: boolean; // آیا مابقی به صورت اقساطی پرداخت می‌شود؟
  isSettledWithChecks?: boolean; // تسویه با اسناد دریافتی
  isPaidFromWallet?: boolean; // تسویه با کیف پول همکار
  delayPenaltyAmount?: number; // مبلغ جریمه دیرکرد محاسبه شده و ثبت شده
  settlementCommission?: number; // کارمزد توافق شده تسویه با چک یا اقساط
  costCenterId?: string; // Feature 6: Cost Center
  purchaseManagerProfitRate?: number; // نرخ آنالیز مدیر خرید (مخصوص موبایل)
  createdAt: string;
  createdBy?: string;
  ownerUserId?: string;
  branchId?: string;
  representativeId?: string;
  organizationId?: string;
  status?: DocumentStatus;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  reversalVoucherId?: string;
  creditRulesSnapshot?: CreditRulesSnapshot; // Snapshot قوانین اعتباری در زمان صدور فاکتور
}

export interface CreditRulesSnapshot {
  maxCreditLimit: number; // سقف اعتبار نماینده در زمان صدور فاکتور (ریال)
  defaultInstallmentDays: number; // مهلت پرداخت مجاز (روز)
  gracePeriodDays?: number; // زمان تنفس (روز)
  penaltyRatePerMonth: number; // نرخ جریمه دیرکرد (ماهانه)
  contractType?: string; // نوع قرارداد یا شرایط اعتباری
  snapshotCreatedAt: string; // تاریخ و زمان ایجاد Snapshot
}

export interface InstallmentPlan {
  id: string;
  name: string; // نام طرح (بتا، طلا و ...)
  interestRate: number; // نرخ کارمزد (%)
  penaltyRate: number; // نرخ جریمه دیرکرد (%)
  maxTerm: number; // حداکثر تعداد اقساط
  prepaymentPercent: number; // درصد پیش‌پرداخت الزامی
  isActive: boolean;
}

export interface CreditPolicy {
  id: string;
  title: string;
  minAmount: number;
  maxAmount: number;
  needsValidation: boolean;
  needsBackSignature: boolean;
  needsCollateral: boolean;
  needsGuarantorInfo: boolean;
  needsGuarantorValidation: boolean;
  needsAmaniCheck: boolean;
  amaniReminderDays: number;
  isActive: boolean;
}

export interface Collateral {
  id: string;
  type: 'gold' | 'property_doc' | 'check' | 'other';
  description: string;
  value: number; // ارزش تقریبی
  receivedDate: string;
  status: 'held' | 'returned' | 'liquidated';
  attachments?: PersonAttachment[];
}

export type ApprovalStatus = 'draft' | 'agent_submitted' | 'finance_review' | 'manager_approved' | 'rejected' | 'canceled' | 'pending' | 'approved';

export interface ApprovalStep {
  status: ApprovalStatus;
  userId: string;
  userName: string;
  timestamp: string;
  comment?: string;
}

export interface InstallmentDocument {
  id: string;
  category: string;
  fileName: string;
  fileUrl: string;
}

export interface Installment {
  id: string;
  bookId: string;
  installmentNumber: number;
  dueDate: string;
  amount: number;
  paidAmount: number;
  paidDate?: string;
  calculatorId?: string;
  agentBankId?: string;
  agentBankName?: string;
  interestPart: number; // سود قسط
  principalPart: number; // اصل قسط
  penaltyAmount: number;
  delayDays: number;
  status: 'upcoming' | 'paid' | 'overdue' | 'partially_paid' | 'voided' | 'canceled';
}

export interface InstallmentBook {
  id: string;
  personId: string;
  invoiceId?: string;
  creditFileId?: string;
  calculatorId?: string;
  agentBankId?: string;
  agentBankName?: string;
  totalPrincipal: number;
  totalInterest: number;
  totalAmount: number;
  installmentCount: number;
  startDate: string;
  intervalDays: number; // 30 for month, 1 for day, etc.
  isVariableInterval?: boolean;
  status: 'active' | 'completed' | 'terminated' | 'voided' | 'canceled';
  createdAt: string;
  createdBy?: string;
  ownerUserId?: string;
  branchId?: string;
  representativeId?: string;
  organizationId?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  reversalVoucherId?: string;
}

export interface InstallmentRequest {
  id: string;
  agentId: string; // The agent who submitted this
  personId?: string; // Customer ID
  customerName?: string; // If registered by agent
  customerNationalId?: string; // If registered by agent
  customerMobile?: string; // If registered by agent
  goodsDescription?: string; // If registered by agent
  invoiceId?: string; // Associated invoice
  planId?: string; // Selected plan
  totalAmount: number;
  prepaymentAmount: number;
  installmentAmount: number;
  numberOfInstallments: number;
  installments?: Installment[];
  collaterals?: Collateral[];
  documents: InstallmentDocument[];
  status: ApprovalStatus;
  approvalHistory?: ApprovalStep[];
  commissionAmount?: number; // سهم کارمزد نماینده
  adminNotes?: string;
  createdAt: string;
}

export interface OpeningBalanceItem {
  productId: string;
  quantity: number;
  unitCost: number;
  discount: number; // Added discount field
  serialNumbers?: string[];
  color?: string;
  warehouseId?: string;
}

export interface OpeningBalance {
  id: string;
  number: number;
  date: string; // Jalali Date YYYY/MM/DD
  description?: string;
  items: OpeningBalanceItem[];
  warehouse?: string; // انبار
  recordedBy?: string; // کاربر ثبت‌کننده
  voucherId?: string; // Associated double-entry journal entry ID
  createdAt: string;
}

export interface BankTerminal {
  id: string;
  name: string;
  bankAccountId: string; // id of AccountSubsidiary (e.g. SUB_BANK_MELI)
  intermediateAccountId: string; // id of AccountSubsidiary for "in-transit" account
  delayDays: number;
  transferTime: string; // e.g. "10:00"
  isActive: boolean;
}

export type UserRole = 'admin' | 'accountant' | 'cashier' | 'seller' | 'agent';

export interface User {
  id: string;
  name: string;
  username: string;
  password?: string; // Optional legacy field - scrubbed from backups and persistent state
  role: UserRole;
  allowedWarehouseIds: string[]; // Access restriction
  defaultWarehouseId: string; // Default for invoices
  roleId?: string; // Standard RBAC Role ID
  personId?: string; // Link to Person
  createdAt: string;
}

export enum PartnerRole {
  CREDIT_SALES_AGENT = 'CREDIT_SALES_AGENT',
  CREDIT_BUYER_AGENT = 'CREDIT_BUYER_AGENT',
  REFERRER = 'REFERRER',
  VISITOR = 'VISITOR',
  INVESTOR = 'INVESTOR',
}

export enum PartnerContractType {
  CREDIT_AGENT = 'CREDIT_AGENT',
  DEFERRED_AGENT = 'DEFERRED_AGENT',
  REFERRER = 'REFERRER',
}

export interface PartnerContract {
  id: string;
  partnerId: string;
  type: PartnerContractType;
  startDate: string;
  endDate?: string;
  status: 'active' | 'suspended' | 'expired';
  creditLimit: number;
  hasRepresentativeGuarantee: boolean;
  commissionRate: number;
  notes?: string;
  createdAt: string;
}

export interface PartnerBranch {
  id: string;
  partnerId: string;
  name: string;
  address: string;
  phone: string;
  managerName: string;
  isActive: boolean;
  createdAt: string;
}

export enum PartnerOrderStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface PartnerOrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
}

export interface PartnerOrder {
  id: string;
  businessPartnerId: string;
  branchId?: string;
  orderDate: string;
  items: PartnerOrderItem[];
  status: PartnerOrderStatus;
  totalAmount: number;
  centerNotes?: string;
  createdAt: string;
  createdBy: string;
}

export interface PartnerProfile {
  partnerId: string;
  partnerName?: string;
  storeName?: string;
  contractStatus: string;
  contractDate?: string;
  assignedManager?: string;
  notes?: string;
  documents?: string[];
  riskLevel?: 'low' | 'medium' | 'high';
  creditLimit?: number;
  guaranteeStatus?: string;
}

export enum AgencyType {
  INSTALLMENT_ONLY = 'INSTALLMENT_ONLY',
  CREDIT_ONLY = 'CREDIT_ONLY',
  BOTH = 'BOTH',
}

export interface NesyehPartnerSettings {
  creditLimit: number;
  paymentTermDays: number;
  lateFeePercentage: number;
  isPurchaseAllowed: boolean;
  contractNotes?: string;
}

export interface NesyehGuarantee {
  id: string;
  type: 'CHECK' | 'PROMISSORY_NOTE' | 'OTHER';
  amount: number;
  checkNumber?: string;
  sayadId?: string;
  bankName?: string;
  issueDate?: string;
  dueDate?: string;
  description?: string;
  attachmentUrl?: string;
  createdAt: string;
}

export interface NesyehReferrer {
  name: string;
  mobile: string;
  description?: string;
}

export interface NesyehOnboardingStatusHistory {
  status: string;
  date: string;
  userName: string;
  comment?: string;
}

export interface NesyehOnboardingProfile {
  onboardingStatus: 'DRAFT' | 'COMPLETED_INFO' | 'MANAGER_APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
  nesyehPartnerId?: string;
  linkCreatedAt?: string;
  lastLogin?: string;
  isLinkActive?: boolean;
  nationalId?: string;
  landlinePhone?: string;
  address?: string;
  province?: string;
  city?: string;
  nationalCardAttachment?: string;
  storeLicenseAttachment?: string;
  contractAttachment?: string;
  guarantees: NesyehGuarantee[];
  referrer?: NesyehReferrer;
  statusHistory: NesyehOnboardingStatusHistory[];
  startDate?: string;
  confidentialNotes?: string;
}

export type NesyehBadgeType = 'NEW' | 'SPECIAL' | 'LIMITED' | 'OFFER';

export interface NesyehOrderableItem {
  id: string;
  productId: string;
  code: string;
  name: string;
  brand?: string;
  category?: string;
  image?: string;
  description?: string;
  cashPrice: number;
  suggestedNesyehPrice: number;
  orderableCapacity: number; // این عدد صرفاً ظرفیت نمایش سفارش است و به هیچ عنوان موجودی واقعی انبار نیست
  isActive: boolean;
  priority: number;
  badge?: NesyehBadgeType;
  createdAt: string;
  updatedAt: string;
}

export type NesyehPurchaseOrderStatus = 
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'MODIFIED_BY_COMPANY'
  | 'APPROVED'
  | 'REJECTED'
  | 'CONVERTED_TO_INVOICE'
  | 'CANCELLED'
  | 'READY'
  | 'SHIPPED'
  | 'DELIVERED';

export interface NesyehPurchaseOrderItem {
  id: string;
  orderableItemId: string;
  productId: string;
  productName: string;
  productCode: string;
  requestedQuantity: number;
  approvedQuantity?: number;
  cashPrice: number;
  unitPrice: number; // قیمت پیشنهادی نسیه
  totalPrice: number;
}

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
  salesInvoiceId?: string;
  createdAt: string;
  updatedAt: string;
  convertedAt?: string;
}

export type NesyehPaymentType = 'POS' | 'BANK_TRANSFER' | 'CHECK';

export type NesyehPaymentStatus = 
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'RECONCILED_WITH_DISCREPANCY';

export interface NesyehPaymentDeclaration {
  id: string;
  declarationNumber: string;
  partnerId: string;
  partnerName: string;
  paymentType: NesyehPaymentType;
  amount: number;
  paymentDate: string;
  declarationDate?: string;
  posBatchSummaryDate?: string;
  
  // Bank Transfer specific
  bankName?: string;
  trackingNumber?: string;
  receiptImage?: string;

  // POS specific
  posTerminalNumber?: string;
  posDeclaredAmount?: number;
  posBankMatchedAmount?: number;
  discrepancyAmount?: number;
  discrepancyStatus?: 'MATCHED' | 'DISCREPANCY_PENDING' | 'DISCREPANCY_RESOLVED';

  // Check specific
  checkNumber?: string;
  checkDueDate?: string;
  checkImage?: string;
  checkSayadId?: string;

  description?: string;
  partnerNotes?: string;
  adminNotes?: string;
  status: NesyehPaymentStatus;
  
  voucherId?: string;
  checkId?: string;
  
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface SalesPartnerExtension {
  salesRules?: {
    allowedCategories?: string[];
    maxOrderAmount?: number;
    nesyehPurchaseLimit?: number;
    specialDiscountRate?: number;
    requiredAgencyDocs?: string[];
    allowedDepositAccountIds?: string[];
  };
  salesControls?: {
    canPlaceOrders?: boolean;
    requireManagerApprovalForReturn?: boolean;
    blockOnOverdue?: boolean;
    canViewPersonalLedger?: boolean;
    canSubmitPurchaseRequest?: boolean;
  };
  dedicatedSalesLink?: string;
  commissionSettings?: {
    defaultRate?: number;
    tierRates?: { threshold: number; rate: number }[];
  };
  nesyehSettings?: NesyehPartnerSettings;
}

export interface PartnerCreditRules {
  maxCreditLimit?: number;
  maxPerDossierLimit?: number;
  defaultInstallmentDays?: number;
  penaltyRatePerMonth?: number;
  commissionRate?: number;
  requiredDocuments?: string[];
  allowedTenors?: number[];
  renewalType?: 'AUTO' | 'MANUAL';
  activePeriodJalali?: string;
}

export interface ResolvedPartnerCreditRules {
  maxCreditLimit: number;
  maxPerDossierLimit?: number;
  defaultInstallmentDays: number;
  penaltyRatePerMonth: number;
  allowedCalculators: string[];
  isCreditEnabled: boolean;
  renewalType?: 'AUTO' | 'MANUAL';
  activePeriodJalali?: string;
}

export interface CreditRuleHistoryEntry {
  id: string;
  partnerId: string;
  changedAt: string;
  changedByUserId?: string;
  changedByUserName?: string;
  changeReason?: string;
  previousRules?: PartnerCreditRules;
  newRules: PartnerCreditRules;
}

export interface AgentFeatureToggles {
  // ۱- مدیریت دسترسی‌ها (Access Control)
  viewLedger: boolean;            // مشاهده ریزحساب
  viewAccountBalance: boolean;    // مشاهده مانده حساب
  viewCreditDossier: boolean;     // مشاهده پرونده اعتباری
  viewInstallments: boolean;      // مشاهده اقساط
  viewChecks: boolean;            // مشاهده چک‌ها
  viewContracts: boolean;         // مشاهده قراردادها
  viewDocuments: boolean;         // مشاهده مدارک
  viewMessages: boolean;          // مشاهده پیام‌ها
  submitRequests: boolean;        // امکان ثبت درخواست
  editAllowedProfile: boolean;    // امکان ویرایش اطلاعات مجاز
  uploadDocuments: boolean;       // امکان بارگذاری مدارک

  // ۲- سیاست‌های عملیاتی (Operational Policies)
  allowCustomerRegister: boolean; // اجازه ثبت مشتری
  allowDossierCreation: boolean;  // اجازه تشکیل پرونده
  allowCreditRequest: boolean;    // اجازه ثبت درخواست اعتبار
  allowViewHistory: boolean;      // اجازه مشاهده سوابق
  allowViewReports: boolean;      // اجازه مشاهده گزارش‌ها
  allowFuturePolicy: boolean;     // اجازه استفاده از امکانات آینده

  // ۳- مدیریت ابزارها (Tools Control)
  calcStandard: boolean;          // ماشین‌حساب شماره ۱
  calcStepByStep: boolean;        // ماشین‌حساب مرحله‌ای
  calcBeta: boolean;              // ماشین‌حساب بتا
  calcPercentage: boolean;        // ماشین‌حساب درصدی
  calcFutureTool: boolean;        // ماشین‌حساب‌های آینده
}

export interface AgentPortalLink {
  id: string;
  url: string;
  createdAt: string;
  isActive: boolean;
  lastUsedAt?: string;
  description?: string;
}

export interface AgentCalculatorOverride {
  calculatorId: string;
  baseRatePercent?: number;
  pelkaniTier1BaseRate?: number;
  pelkaniTier2BaseRate?: number;
  pelkaniTier3BaseRate?: number;
  betaBankFeeRate?: number;
  maxInstallmentCount?: number;
  minInstallmentCount?: number;
  maxCreditLimit?: number;
  customCommissionPercent?: number;
  decliningSlopePercentage?: number;
  isActive?: boolean;
}

export interface CreditPartnerExtension {
  creditPlans?: string[];
  creditRules?: PartnerCreditRules;
  history?: CreditRuleHistoryEntry[];
  dedicatedCreditLink?: string;
  allowedCalculators?: string[];
  canCreateDossier?: boolean;
  canSubmitCreditRequest?: boolean;
  canViewCustomerCreditHistory?: boolean;
}

export interface BusinessPartner {
  id: string;
  personId: string;
  status: 'active' | 'inactive' | 'pending';
  agencyType: AgencyType;
  roles: PartnerRole[];
  profile: PartnerProfile;
  branches: PartnerBranch[];
  contract?: PartnerContract;
  nesyehSettings?: NesyehPartnerSettings;
  nesyehOnboarding?: NesyehOnboardingProfile;
  users?: string[];
  createdAt: string;
  createdBy: string;
  hasActivity?: boolean;
  allowedSalesPlanIds?: string[];
  allowedCalculatorIds?: string[];
  calculatorOverrides?: Record<string, AgentCalculatorOverride> | AgentCalculatorOverride[];
  salesExtension?: SalesPartnerExtension;
  creditExtension?: CreditPartnerExtension;
  featureToggles?: AgentFeatureToggles;
  portalLinks?: AgentPortalLink[];
}

export enum PartnerCreditRequestStatus {
  DRAFT = 'DRAFT',
  SUBMITTED_BY_PARTNER = 'SUBMITTED_BY_PARTNER',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WAITING_CHECK_CONFIRMATION = 'WAITING_CHECK_CONFIRMATION',
  WAITING_FOR_CHECK_CORRECTION = 'WAITING_FOR_CHECK_CORRECTION',
  FINAL_APPROVED = 'FINAL_APPROVED',
  CANCELLED = 'CANCELLED',
}

export interface PartnerSalesPlan {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  minAmount: number;
  maxAmount: number;
  allowedTerms: number[];
  interestRate: number;
  commissionRate: number;
  paymentPeriods: number[];
}

export interface SuggestedInstallment {
  dueDate: string;
  amount: number;
  description: string;
}

export interface PartnerCustomerDocument {
  id: string;
  type: string;
  fileRef: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  rejectionReason?: string;
  uploadedAt: string;
}

export interface PartnerApprovalHistory {
  id: string;
  requestId: string;
  userId: string;
  role: string;
  status: 'approved' | 'rejected';
  comment?: string;
  timestamp: string;
}

export interface PartnerCheckSubmission {
  id: string;
  checkNumber: string;
  bankName: string;
  dueDate: string;
  amount: number;
  drawerName: string;
  drawerNationalId: string;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'NEEDS_CORRECTION' | 'REJECTED';
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface PartnerCreditRequest {
  id: string;
  businessPartnerId: string;
  branchId?: string;
  customerPersonId: string;
  status: PartnerCreditRequestStatus;
  requestedAmount: number;
  salePlanId: string;
  termCount: number;
  paymentPeriod: number;
  documents: PartnerCustomerDocument[];
  submittedChecks?: PartnerCheckSubmission[];
  approvalHistory: PartnerApprovalHistory[];
  validationResult?: {
    isEligible: boolean;
    reason?: string;
    checkedAt: string;
  };
  calculationResults?: {
    totalPayment: number;
    totalInterest: number;
    partnerCommission: number;
    installmentAmount: number;
    suggestedInstallments: SuggestedInstallment[];
    calculatedAt: string;
    calculatedBy: string;
  };
  rejectionReason?: string;
  createdAt: string;
  createdBy: string;
  approvedAt?: string;
  finalApprovedBy?: string;
}

export interface PartnerSettlement {
  id: string;
  businessPartnerId: string;
  amount: number;
  date: string;
  paymentMethod: string;
  voucherId: string;
  createdBy: string;
  status: 'completed' | 'voided';
  notes?: string;
  createdAt: string;
}

export interface CreditFile {
  id: string; // Unique file ID
  personId: string;
  representativeId: string;
  createdAt: string;
  status: 'draft' | 'ready_to_send' | 'pending' | 'approved' | 'needs_revision' | 'canceled';
  requestedAmount: number;
  plan: string;
  agentCommissionAmount: number; // For info only
  agentCommissionRate?: number; // % commission for the agent
  calculatorId?: string;
  calculatorName?: string;
  agentBankId?: string;
  agentBankName?: string;
  calculationResults?: {
    creditAmount: number;
    installmentCount: number;
    installmentAmount: number;
    totalCommission: number; // This is the total interest/commission (company + agent)
    totalRepayment: number;
    agentCommissionAmount?: number;
    agentCommissionRate?: number;
  };
  revisionNote?: string;
  receivedChecks?: Check[];
  paymentDocuments?: PersonAttachment[];
  documentNotes?: string;
  settlementType?: 'checks' | 'installment_book';
  policyId?: string;
  policySnapshot?: CreditPolicy;
  guarantorName?: string;
  guarantorNationalId?: string;
  guarantorPhone?: string;
  collateralType?: string;
  collateralDescription?: string;
  collateralValue?: number;
  amaniCheckNumber?: string;
  amaniCheckBankName?: string;
  amaniCheckAmount?: number;
  amaniCheckDueDate?: string;
  amaniCheckSayadiNumber?: string;
}

export interface Calculator {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  type: 'sadi_bazaar' | 'pelkani' | 'beta' | 'installment' | 'other';
  agentBankId?: string;
  bankName?: string;
  baseRatePercent?: number;
  pelkaniTier1BaseRate?: number;
  pelkaniTier2BaseRate?: number;
  pelkaniTier3BaseRate?: number;
  betaBankFeeRate?: number;
  maxInstallmentCount?: number;
  decliningSlopePercentage?: number;
}

export interface AppState {
  users: User[]; // Feature: User Management
  persons: Person[];
  products: Product[];
  productCategories: string[]; // List of available categories
  subsidiaries: AccountSubsidiary[];
  vouchers: JournalVoucher[];
  checks: Check[];
  checkbooks?: CheckbookModel[];
  invoices: Invoice[];
  openingBalances: OpeningBalance[];
  installmentBooks: InstallmentBook[];
  installments: Installment[];
  installmentRequests: InstallmentRequest[];
  installmentPlans: InstallmentPlan[];
  warehouses: Warehouse[];
  warehouseTransfers: WarehouseTransfer[];
  costCenters: CostCenter[];
  bankTerminals: BankTerminal[];
  auditLogs: AuditLog[];
  settings: {
    inventoryValuationMethod: 'FIFO' | 'WEIGHTED_AVERAGE';
    defaultWarehouseId: string;
    companyName: string;
    defaultOperatingExpenseRate?: number; // نرخ هزینه عملیاتی پیش‌فرض (٪)
    preventNegativeStock?: boolean;
    controlCreditLimit?: boolean;
    notifyOverdueInstallments?: boolean;
    sadiBazaarBaseRate?: number;
    pelkaniTier1BaseRate?: number;
    pelkaniTier2BaseRate?: number;
    pelkaniTier3BaseRate?: number;
    betaBankFeeRate?: number;
  };
  roles?: Role[];
  permissions?: Permission[];
  rolePermissions?: RolePermission[];
  knowledgeCategories?: KnowledgeCategory[];
  knowledgeArticles?: KnowledgeArticle[];
  knowledgeSteps?: KnowledgeStep[];
  knowledgeErrors?: KnowledgeError[];
  knowledgeGlossary?: KnowledgeGlossary[];
  knowledgeVersions?: KnowledgeVersion[];
  businessPartners?: BusinessPartner[];
  partnerCreditRequests?: PartnerCreditRequest[];
  partnerSalesPlans?: PartnerSalesPlan[];
  partnerOrders?: PartnerOrder[];
  partnerSettlements?: PartnerSettlement[];
  creditFiles: CreditFile[];
  creditPolicies: CreditPolicy[];
  calculators: Calculator[];
  partnerTickets?: PartnerTicket[];
  syncTests?: Array<{ id: string; timestamp: string; senderId: string; status: string }>;
  projectNotes?: ProjectNote[];
  nesyehCatalog?: NesyehOrderableItem[];
  nesyehPurchaseOrders?: NesyehPurchaseOrder[];
  nesyehPaymentDeclarations?: NesyehPaymentDeclaration[];
  creditControlDrafts?: CreditControlDraft[];
  investorProfiles?: InvestorProfile[];
  investorContracts?: InvestorContract[];
  investorPaymentSchedules?: InvestorPaymentSchedule[];
  investorPaymentObligations?: InvestorPaymentObligation[];
  investorReferrals?: InvestorReferral[];
  investorReturnRequests?: InvestorReturnRequest[];
  investorAuditLogs?: InvestorAuditLog[];
  smsSettings?: SmsSettings;
  smsTemplates?: SmsTemplate[];
  visitorProfiles?: VisitorProfile[];
  referrerNodes?: ReferrerNode[];
  visitorCommissions?: VisitorCommissionStatement[];
}

export interface PartnerTicketMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: 'agent' | 'admin';
  message: string;
  attachments?: PersonAttachment[];
  createdAt: string;
}

export interface PartnerTicket {
  id: string;
  ticketNumber: string; // e.g. T-1001
  agentId: string;
  agentName: string;
  subject: string;
  category: 'document_inquiry' | 'credit_limit_request' | 'technical' | 'financial_settlement' | 'feedback' | 'other';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'new' | 'in_progress' | 'answered' | 'closed';
  messages: PartnerTicketMessage[];
  createdAt: string;
  updatedAt: string;
}

export * from './modules/knowledge/knowledge.types';
export * from './modules/investors/types';
export * from './modules/sms/types';

export interface VisitorProfile {
  id: string;
  fullName: string;
  nationalId?: string;
  mobile: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  referralCode: string;
  referralLink: string;
  commissionType: 'PERCENTAGE' | 'FLAT_AMOUNT';
  commissionValue: number;
  assignedPartnerIds: string[];
  notes?: string;
  personId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReferrerNode {
  id: string;
  visitorId: string;
  visitorName: string;
  partnerId: string;
  partnerName: string;
  partnerStoreName?: string;
  assignedAt: string;
  status: 'ACTIVE' | 'ARCHIVED';
  notes?: string;
}

export interface VisitorCommissionDetail {
  partnerId: string;
  partnerName: string;
  storeName?: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmount: number;
  commissionAmount: number;
}

export interface VisitorCommissionStatement {
  id: string;
  visitorId: string;
  visitorName: string;
  visitorMobile: string;
  periodTitle: string;
  calculatedAt: string;
  totalSalesAmount: number;
  totalCommissionAmount: number;
  commissionType: 'PERCENTAGE' | 'FLAT_AMOUNT';
  commissionValue: number;
  status: 'PREVIEW' | 'APPROVED' | 'REJECTED';
  voucherId?: string;
  voucherNumber?: number;
  approvedAt?: string;
  approvedBy?: string;
  notes?: string;
  details: VisitorCommissionDetail[];
}

export interface Role {
  id: string; // RoleId
  name: string; // RoleName
  description: string;
  isSystemRole: boolean; // IsSystemRole
  isActive: boolean; // IsActive
  maximumDiscountPercent: number; // MaximumDiscountPercent
  maximumCreditLimit: number; // MaximumCreditLimit
  createdAt: string; // CreatedAt
  updatedAt: string; // UpdatedAt
}

export interface Permission {
  id: string; // PermissionId
  name: string; // PermissionName
  description: string;
  category: string;
}

export interface RolePermission {
  roleId: string;
  permissionId: string;
  allow: boolean;
}

export const PERMISSIONS = {
  CANCEL_PARTNER_CREDIT_REQUEST: 'CANCEL_PARTNER_CREDIT_REQUEST',
} as const;

export interface Warehouse {
  id: string;
  code?: string;
  name: string;
  branchId?: string;
  branchName?: string;
  location?: string;
  isDefault: boolean;
  status?: 'ACTIVE' | 'INACTIVE' | 'DRAFT';
  version?: number;
  createdAt: string;
  updatedAt?: string;
  organizationId?: string;
}

export interface WarehouseTransfer {
  id: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  items: {
    productId: string;
    quantity: number;
  }[];
  date: string;
  description: string;
  voucherId?: string;
}

export interface CostCenter {
  id: string;
  name: string;
  code: string;
  description?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE' | 'RESET';
  entityType: 'INVOICE' | 'VOUCHER' | 'PRODUCT' | 'PERSON' | 'WAREHOUSE' | 'APP_STATE';
  entityId: string;
  details: string;
  previousValue?: any;
  newValue?: any;
}

export type ProjectNoteStatus = 'todo' | 'in-progress' | 'done';

export interface ProjectNote {
  id: string;
  title: string;
  description: string;
  status: ProjectNoteStatus;
  createdAt: string;
  updatedAt: string;
}
