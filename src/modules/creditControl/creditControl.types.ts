/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Invoice, JournalVoucher, Check, BusinessPartner, Person } from '../../types';

/**
 * سیاست تخصیص پرداخت‌ها
 * Payment Allocation Policy (e.g., FIFO)
 */
export enum PaymentAllocationPolicy {
  FIFO = 'FIFO', // قدیمی‌ترین فاکتور باز اول تسویه می‌شود
  SPECIFIC_INVOICE = 'SPECIFIC_INVOICE', // تخصیص به فاکتور مشخص انتخاب شده
  PRO_RATA = 'PRO_RATA', // تسهیم به نسبت مانده کل فاکتورها
}

/**
 * سیاست برخورد با برگشت از فروش
 * Sales Return Handling Policy
 */
export enum SalesReturnHandlingPolicy {
  REDUCE_ORIGINAL_INVOICE = 'REDUCE_ORIGINAL_INVOICE', // کاهش مستقیم مانده فاکتور اصلی مرجع
  CREATE_CREDIT_MEMO = 'CREATE_CREDIT_MEMO', // ایجاد بستانکار عمومی برای نماینده و تخصیص دستی/خودکار
}

/**
 * سیاست محاسبه اعتبار آزاد
 * Free Credit Calculation Policy
 */
export enum CreditCalculationPolicy {
  STRICT = 'STRICT', // فقط فاکتورهای قطعی و پرداخت‌های تایید شده نهایی
  OPTIMISTIC = 'OPTIMISTIC', // احتساب چک‌های در جریان وصول و اسناد در حال تایید
}

/**
 * سیاست تولید پیش‌نویس سند حسابداری برای جریمه دیرکرد
 * Late Fee Voucher Generation Policy
 */
export enum VoucherDraftPolicy {
  DAILY_INDEPENDENT = 'DAILY_INDEPENDENT', // برای جریمه هر روز یک رکورد و سند پیشنهادی مستقل
  MONTHLY_CONSOLIDATED = 'MONTHLY_CONSOLIDATED', // تجمیع ماهانه جریمه‌ها در یک سند پیشنهادی
  PER_INVOICE_CUMULATIVE = 'PER_INVOICE_CUMULATIVE', // تجمیع جریمه‌های کل دوره یک فاکتور در یک سند
}

/**
 * سیاست ارسال هشدارها و اطلاع‌رسانی
 * Warning and Notification Delivery Policy
 */
export enum WarningDeliveryPolicy {
  SMS_AND_DASHBOARD = 'SMS_AND_DASHBOARD', // ارسال پیامک و نمایش در داشبورد
  DASHBOARD_ONLY = 'DASHBOARD_ONLY', // فقط نمایش در داشبورد نماینده و مدیر
  SMS_ONLY = 'SMS_ONLY', // فقط ارسال پیامک
}

/**
 * ساختار سیاست‌ها و قوانین کنترل حساب نماینده فروش (Sales Agent Policy)
 * این ساختار داده برای هر دو پنل «نماینده فروش» و «نماینده اعتباری» کاربرد دارد.
 */
export interface SalesAgentPolicy {
  id: string; // شناسه قانون
  name: string; // نام قانون (مثال: قوانین پیش‌فرض نمایندگان اقساطی)
  agentType: 'sales_agent' | 'credit_agent' | 'both'; // نوع نماینده هدف قوانین
  
  // تنظیمات مبالغ و اعتبار
  creditLimit: number; // سقف اعتبار پایه (ریال)
  isOverLimitAllowed: boolean; // آیا عبور از سقف اعتبار مجاز است؟
  allowedOverLimitPercentage: number; // درصد مجاز عبور از سقف اعتبار (مثال: ۵٪ اضافه بر سقف)

  // تنظیمات جریمه دیرکرد و بازه زمانی
  isPenaltyEnabled: boolean; // آیا جریمه دیرکرد فعال است؟
  lateFeeDailyPercentage: number; // درصد جریمه دیرکرد روزانه (مثلاً ۰.۱ درصد)
  paymentTermDays: number; // مهلت پرداخت استاندارد فاکتورها (به روز)
  gracePeriodDays: number; // تعداد روزهای تنفس (بدون اعمال جریمه بلافاصله پس از سررسید)

  // تنظیمات سیستمی و زمان‌بندی
  engineExecutionHour: string; // ساعت اجرای خودکار موتور (مثلاً "23:00")
  isSmsEnabled: boolean; // آیا ارسال خودکار پیامک هشدار فعال است؟
  isFinanceApprovalRequired: boolean; // آیا جریمه‌های محاسبه شده نیاز به تایید حسابدار دارند؟
  warningSmsTemplate: string; // قالب متن پیامک هشدار دهنده
  overdueSmsTemplate: string; // قالب متن پیامک اخطار دیرکرد شدید

  // سیاست‌های کسب‌وکار (تنظیمات استراتژی)
  paymentAllocationPolicy: PaymentAllocationPolicy; // نحوه تخصیص پرداخت‌ها (FIFO و ...)
  salesReturnHandlingPolicy: SalesReturnHandlingPolicy; // نحوه اعمال برگشت از فروش
  creditCalculationPolicy: CreditCalculationPolicy; // نحوه محاسبه اعتبار آزاد
  voucherDraftPolicy: VoucherDraftPolicy; // نحوه تولید اسناد جریمه
  warningDeliveryPolicy: WarningDeliveryPolicy; // سیاست ارسال هشدارها

  // فیلدهای پویا و سفارشی برای توسعه‌پذیری آتی بدون تغییر کد
  customParameters: Record<string, any>;
}

/**
 * وضعیت مانده واقعی هر فاکتور
 */
export interface InvoiceBalance {
  invoiceId: string;
  invoiceNumber: number;
  originalAmount: number;
  paidAmount: number;
  returnedAmount: number;
  remainingAmount: number; // مانده واقعی فاکتور
  dueDate: string; // تاریخ سررسید فاکتور
  delayDays: number; // تعداد روز دیرکرد از سررسید
  penaltyRate?: number; // نرخ جریمه دیرکرد (از Snapshot فاکتور یا Fallback)
  accumulatedPenalty: number; // کل جریمه دیرکرد ثبت شده تاکنون روی این فاکتور
  status: 'settled' | 'partially_paid' | 'open'; // وضعیت فاکتور (تسویه شده، نیمه‌تسویه، باز)
}

/**
 * خلاصه وضعیت اعتبار نماینده
 */
export interface AgentCreditSummary {
  agentId: string;
  totalCreditLimit: number; // سقف کل اعتبار با احتساب درصد مجاز
  baseCreditLimit: number; // سقف اعتبار پایه
  usedCredit: number; // اعتبار مصرف شده (فاکتورهای قطعی باز)
  freeCredit: number; // اعتبار آزاد باقی‌مانده
  isOverdrawn: boolean; // آیا از سقف عبور کرده است؟
  overdraftAmount: number; // مبلغ عبور از سقف (در صورت وجود)
}

/**
 * رکوردهای جریمه‌های دیرکرد آماده بررسی و تایید
 */
export interface PendingLateFeeRecord {
  id: string;
  agentId: string;
  invoiceId: string;
  invoiceNumber: number;
  targetDate: string; // تاریخ مورد محاسبه (روز دیرکرد)
  outstandingAmount: number; // مانده فاکتور در آن روز
  penaltyRate: number; // نرخ جریمه دیرکرد اعمال شده (روزانه)
  calculatedPenaltyAmount: number; // مبلغ جریمه محاسبه شده برای آن روز
  isApproved: boolean; // وضعیت تایید حسابداری
  approvedBy?: string;
  approvedDate?: string;
}

/**
 * رویدادهای کنترلی صادر شده توسط موتور
 */
export interface CreditControlEvent {
  id: string;
  agentId: string;
  eventType: 'CREDIT_EXCEEDED' | 'GRACE_PERIOD_EXPIRING' | 'OVERDUE_WARNING' | 'CRITICAL_OVERDUE';
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: string;
  smsSent: boolean;
}

/**
 * پیش‌نویس جریمه دیرکرد روزانه (Phase 4)
 */
export interface CreditControlDraft {
  id: string; // شناسه منحصر به فرد پیش‌نویس (مثال: DFT_CC_agentId_invoiceId_date)
  agentId: string; // شناسه نماینده
  invoiceId: string; // شناسه فاکتور
  invoiceNumber: number; // شماره فاکتور
  calculationDate: string; // تاریخ محاسبه (تاریخ کاری)
  baseRemainingAmount: number; // مبلغ مانده واقعی مبنا در همان روز
  penaltyPercentage: number; // درصد جریمه روزانه
  penaltyAmount: number; // مبلغ جریمه محاسبه شده برای همان روز
  status: 'pending' | 'approved' | 'rejected'; // وضعیت پیش‌نویس
  createdAt: string; // زمان ایجاد (ISO string)
  voucherId?: string; // شناسه سند حسابداری ثبت شده
  rejectionReason?: string; // علت رد
  note?: string; // توضیحات حسابدار
}

/**
 * پیش‌نویس سند حسابداری پیشنهادی
 */
export interface SuggestedVoucherDraft {
  id: string;
  date: string;
  description: string;
  debitAccountId: string; // بدهکار: حساب جاری نماینده (بدهکاران تجاری)
  creditAccountId: string; // بستانکار: درآمد کارمزد دیرکرد یا درآمد مالی
  amount: number;
  associatedInvoiceId?: string;
}

/**
 * واسط ورودی موتور کنترل حساب نماینده فروش
 */
export interface CreditControlEngineInput {
  agent: Person;
  partner: BusinessPartner;
  policy: SalesAgentPolicy;
  invoices: Invoice[];
  vouchers: JournalVoucher[];
  checks: Check[];
  currentDate: string; // تاریخ شبیه‌سازی یا جاری سیستم (Jalali یا میلادی)
}

/**
 * واسط خروجی مستقل موتور کنترل حساب نماینده فروش
 */
export interface CreditControlEngineOutput {
  invoiceBalances: InvoiceBalance[];
  creditSummary: AgentCreditSummary;
  pendingLateFees: PendingLateFeeRecord[];
  draftVouchers: SuggestedVoucherDraft[];
  emittedEvents: CreditControlEvent[];
}

/**
 * نقطه توسعه‌پذیری (Extension Point) موتور برای تزریق استراتژی‌های سفارشی در آینده
 */
export interface ICreditControlStrategy {
  allocatePayments(input: CreditControlEngineInput): InvoiceBalance[];
  calculateLateFees(balances: InvoiceBalance[], policy: SalesAgentPolicy, currentDate: string): PendingLateFeeRecord[];
  evaluateCreditLimits(input: CreditControlEngineInput, balances: InvoiceBalance[]): AgentCreditSummary;
  generateDraftVouchers(pendingFees: PendingLateFeeRecord[], policy: SalesAgentPolicy): SuggestedVoucherDraft[];
  dispatchWarnings(balances: InvoiceBalance[], summary: AgentCreditSummary, policy: SalesAgentPolicy): CreditControlEvent[];
}
