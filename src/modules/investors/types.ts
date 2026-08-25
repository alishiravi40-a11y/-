/**
 * Investor Module Core Domain Data Models
 * (مشارکت و مدیریت سرمایه‌گذاران)
 */

export type InvestorContractStatus = 'active' | 'completed' | 'renewed' | 'terminated' | 'paused';

export type InvestorPaymentFrequency = 'monthly' | 'bimonthly' | 'quarterly' | 'semi_annual' | 'annual';

export type InvestorCategory = 'INDIVIDUAL' | 'COMPANY' | 'BANK' | 'FINANCIAL_INSTITUTION';

export interface InvestorBankAccount {
  bankName?: string;
  accountNumber?: string;
  iban?: string;
  cardCode?: string;
}

export interface InstitutionalRepaymentItem {
  id: string;
  dueDate: string;
  totalAmount: number;
  principalPortion: number;
  feePortion: number;
  status: 'PLANNED' | 'PAID' | 'OVERDUE';
  paidDate?: string;
}

export interface InstitutionalInvestorDetails {
  receivedAmount: number; // مبلغ دریافت شده
  totalRepaymentAmount: number; // مبلغ کل بازپرداختی
  principalDebt: number; // اصل بدهی
  contractInterestOrFee: number; // کارمزد یا بهره قرارداد
  repaymentSchedule: InstitutionalRepaymentItem[]; // جدول بازپرداخت
  dueDates: string[]; // سررسیدها
  settlementStatus: 'ACTIVE' | 'SETTLED' | 'OVERDUE' | 'DEFAULTED'; // وضعیت تسویه
}

export interface InvestorProfile {
  id: string;
  personId: string;
  businessPartnerId?: string;
  category?: InvestorCategory; // نوع سرمایه‌گذار: حقیقی، حقوقی، بانک، موسسه مالی
  institutionalDetails?: InstitutionalInvestorDetails; // اطلاعات اختصاصی سرمایه‌گذار سازمانی
  totalInvestedAmount: number; // مجموع کل سرمایه‌گذاری
  activeContractsCount: number; // تعداد قراردادهای فعال
  notes?: string;
  bankAccountDetails?: InvestorBankAccount;
  createdAt: string;
  updatedAt: string;
}

export interface InvestorRateHistory {
  id: string;
  contractId: string;
  effectiveDate: string;
  previousRate: number;
  newRate: number;
  reason?: string;
  changedAt: string;
  changedBy?: string;
}

export interface InvestorContractChangeLog {
  id: string;
  contractId: string;
  changeType: 'CAPITAL_INCREASE' | 'CAPITAL_DECREASE' | 'RATE_CHANGE' | 'FREQUENCY_CHANGE' | 'STATUS_CHANGE' | 'OTHER';
  changeDate: string;
  description: string;
  previousCapital?: number;
  newCapital?: number;
  previousRate?: number;
  newRate?: number;
  changedAt: string;
  changedBy?: string;
}

export interface InvestorContract {
  id: string;
  contractNumber: string; // شماره قرارداد
  investorPersonId: string; // شناسه شخص سرمایه‌گذار
  businessPartnerId?: string; // شناسه همکار تجاری مربوطه
  startDate: string; // تاریخ شروع قرارداد
  endDate?: string; // تاریخ پایان قرارداد
  initialCapital: number; // مبلغ اولیه سرمایه
  currentCapital: number; // مبلغ فعلی سرمایه
  monthlyFeeRate: number; // نرخ کارمزد توافق شده ماهانه (درصد)
  paymentFrequency: InvestorPaymentFrequency; // نوع دوره دریافت کارمزد
  status: InvestorContractStatus; // وضعیت قرارداد
  history?: InvestorRateHistory[];
  changeLogs?: InvestorContractChangeLog[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type InvestorContractEventType = 
  | 'contract_created'
  | 'capital_increased'
  | 'capital_decreased'
  | 'rate_changed'
  | 'contract_renewed'
  | 'contract_terminated'
  | 'status_changed';

export interface InvestorContractEvent {
  id: string;
  contractId: string;
  eventType: InvestorContractEventType;
  timestamp: string;
  payload: Record<string, any>;
  performedBy?: string;
  notes?: string;
}

export type InvestorCommissionScheduleStatus = 'PLANNED' | 'DUE' | 'PAID' | 'CANCELLED';

export type InvestorObligationType = 'FEE' | 'CAPITAL_PRINCIPAL' | 'CONTRACT_ADJUSTMENT';
export type InvestorObligationStatus = 'PLANNED' | 'DUE' | 'PAID' | 'CANCELLED' | 'ADJUSTED';
export type InvestorPaymentMethod = 'BANK_TRANSFER' | 'CHECK' | 'CASH' | 'UNSPECIFIED';

export interface InvestorPaymentObligation {
  id: string;
  investorPersonId: string;
  contractId: string;
  obligationType: InvestorObligationType;
  amount: number;
  createdAt: string;
  dueDate: string; // YYYY/MM/DD
  status: InvestorObligationStatus;
  paymentMethod: InvestorPaymentMethod;
  checkId?: string;
  checkNumber?: string;
  checkDueDate?: string;
  bankDetails?: {
    bankName?: string;
    trackingNumber?: string;
    destinationAccount?: string;
    paymentReceiptUrl?: string;
  };
  paymentDate?: string; // تاریخ واقعی تسویه
  voucherId?: string; // شناسه سند مالی در صورت ثبت سند
  notes?: string;
  updatedAt: string;
}

export type InvestorFinancialEventType = 
  | 'INVESTMENT_RECEIVED'
  | 'INVESTMENT_RETURNED'
  | 'COMMISSION_ACCRUED'
  | 'COMMISSION_PAID';

export interface InvestorFinancialEvent {
  id: string;
  contractId: string;
  investorPersonId: string;
  eventType: InvestorFinancialEventType;
  amount: number;
  eventDate: string; // YYYY/MM/DD
  description?: string;
  paymentScheduleId?: string;
  checkId?: string; // شناسه چک متصل شده جهت ثبت مستقیم بستانکار اسناد پرداختنی
  cashOrBankSubAccountId?: string; // شناسه حساب تفصیلی معین بانک یا صندوق
  createdBy?: string;
}

export interface InvestorPaymentSchedule {
  id: string;
  contractId: string;
  investorPersonId: string;
  dueDate: string; // تاریخ سررسید
  expectedAmount: number; // مبلغ مورد انتظار
  paymentType: 'FEE' | 'CAPITAL_PRINCIPAL' | 'CONTRACT_ADJUSTMENT'; // نوع پرداخت
  status: InvestorCommissionScheduleStatus; // وضعیت برنامه پرداخت
  voucherId?: string; // شناسه سند مالی در صورت پرداخت
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ReferralCommissionStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'RECALCULATED' | 'CANCELLED';

export interface InvestorReferral {
  id: string;
  referrerPersonId: string; // شناسه معرف
  referrerName?: string;
  referredInvestorPersonId: string; // شناسه سرمایه‌گذار معرفی‌شده
  referredInvestorName?: string;
  contractId?: string;
  referralDate: string; // YYYY/MM/DD
  capitalAmount: number; // مبلغ سرمایه جذب شده
  contractDurationMonths: number; // مدت قرارداد به ماه (مثلا ۳ ماه یا ۱۲ ماه)
  contractType: string; // نوع قرارداد / دوره پرداخت
  commissionRate: number; // نرخ کمیسیون معرف (درصد)
  calculatedCommissionAmount: number; // مبلغ کمیسیون محاسبه‌شده
  suggestedRecalculatedCommission?: number; // پیشنهاد جدید در صورت تغییر سرمایه یا فسخ
  commissionStatus: ReferralCommissionStatus; // وضعیت کمیسیون
  approvalNotes?: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvestorReturnRequest {
  id: string;
  contractId: string;
  investorPersonId: string;
  investorName?: string;
  requestedAmount: number;
  requestDate: string; // YYYY/MM/DD
  reason?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
  processedBy?: string;
  processedAt?: string;
  createdAt: string;
}

export type InvestorAlertType = 'UPCOMING_PAYMENT' | 'EXPIRING_CONTRACT' | 'RECENT_CHANGE' | 'RETURN_REQUEST' | 'DATA_WARNING';

export interface InvestorAlert {
  id: string;
  type: InvestorAlertType;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  contractId?: string;
  investorPersonId?: string;
  dueDate?: string;
  createdAt: string;
}

export interface InvestorAuditLog {
  id: string;
  contractId?: string;
  investorPersonId?: string;
  action: 'CAPITAL_CHANGE' | 'RATE_CHANGE' | 'STATUS_CHANGE' | 'REFERRAL_CHANGE' | 'PAYMENT_TERMS_CHANGE' | 'RETURN_REQUEST' | 'INSTITUTIONAL_REGISTER';
  performedBy: string;
  timestamp: string;
  previousValue?: string;
  newValue?: string;
  description: string;
}
