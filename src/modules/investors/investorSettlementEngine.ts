/**
 * Investor Payment Obligation & Settlement Management Engine
 * (موتور مدیریت تعهدات، سررسیدها و پرداخت‌های سرمایه‌گذاران)
 * 
 * مسئولیت‌ها:
 * - مدیریت تعهدات آتی (کارمزد دوره‌ای، استرداد اصل سرمایه، اصلاحیه قرارداد)
 * - استخراج پرداختهای نزدیک به سررسید و عقب‌افتاده برای داشبورد مدیر مالی
 * - جلوگیری از پرداخت و تسویه تکراری (Duplicate Settlement Guard)
 * - لایه اتصال چک صادر شده به تعهد سرمایه‌گذار بدون دستکاری موتور چک موجود
 * - ثبت پرداخت‌های بانکی و تولید پی‌لود اطلاع‌رسانی (SMS/WhatsApp/گزارش)
 * - بازمحاسبه تعهدات آتی هنگام افزایش/کاهش سرمایه بدون دستکاری سوابق گذشته
 * 
 * ⚠️ رعایت اصل تحقق و تطابق: صدور چک به تنهایی باعث شناسایی کامل هزینه در روز صدور نمی‌شود.
 * ثبت اسناد مالی همچنان از مسیر اختصاصی InvestorAccountingAdapter انجام می‌پذیرد.
 */

import {
  InvestorContract,
  InvestorPaymentObligation,
  InvestorObligationStatus,
} from './types';
import { InvestorCommissionEngine } from './investorCommissionEngine';
import {
  addDaysToJalali,
  compareJalali,
  getCurrentJalaliDate,
} from '../../utils/jalali';

export interface BankSettlementData {
  paymentDate: string; // YYYY/MM/DD
  bankName?: string;
  trackingNumber?: string;
  destinationAccount?: string;
  paymentReceiptUrl?: string;
  notes?: string;
}

export interface IssuedCheckInfo {
  checkId: string;
  checkNumber: string;
  checkDueDate: string; // YYYY/MM/DD
  bankName?: string;
}

export interface SettlementNotificationPayload {
  eventName: 'INVESTOR_PAYMENT_SETTLED';
  obligationId: string;
  contractId: string;
  investorPersonId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  trackingNumber?: string;
  checkNumber?: string;
  createdAt: string;
}

export interface DailySettlementTaskList {
  reportDate: string;
  overdueItems: InvestorPaymentObligation[];
  dueTodayItems: InvestorPaymentObligation[];
  upcomingItems: InvestorPaymentObligation[];
  totalOverdueAmount: number;
  totalDueTodayAmount: number;
  totalUpcomingAmount: number;
}

export class InvestorSettlementEngine {
  /**
   * استخراج پرداختهای نزدیک به سررسید (مثلاً ۷ روز آینده)
   */
  public static extractUpcomingObligations(
    obligations: InvestorPaymentObligation[],
    daysAhead: number = 7,
    currentDate?: string
  ): InvestorPaymentObligation[] {
    const today = currentDate || getCurrentJalaliDate();
    const maxDate = addDaysToJalali(today, daysAhead);

    return obligations.filter((item) => {
      if (item.status === 'PAID' || item.status === 'CANCELLED') {
        return false;
      }
      return (
        compareJalali(item.dueDate, today) >= 0 &&
        compareJalali(item.dueDate, maxDate) <= 0
      );
    });
  }

  /**
   * استخراج پرداختهای عقب‌افتاده
   */
  public static extractOverdueObligations(
    obligations: InvestorPaymentObligation[],
    currentDate?: string
  ): InvestorPaymentObligation[] {
    const today = currentDate || getCurrentJalaliDate();

    return obligations.filter((item) => {
      if (item.status === 'PAID' || item.status === 'CANCELLED') {
        return false;
      }
      return compareJalali(item.dueDate, today) < 0;
    });
  }

  /**
   * تولید لیست کارهای روزانه تسویه برای مدیر مالی
   */
  public static generateDailySettlementTaskList(
    obligations: InvestorPaymentObligation[],
    currentDate?: string
  ): DailySettlementTaskList {
    const today = currentDate || getCurrentJalaliDate();
    const overdueItems = this.extractOverdueObligations(obligations, today);
    
    const dueTodayItems = obligations.filter(
      (item) =>
        (item.status === 'PLANNED' || item.status === 'DUE') &&
        item.dueDate === today
    );

    const upcomingItems = this.extractUpcomingObligations(obligations, 7, today).filter(
      (item) => item.dueDate !== today
    );

    const totalOverdueAmount = overdueItems.reduce((s, x) => s + x.amount, 0);
    const totalDueTodayAmount = dueTodayItems.reduce((s, x) => s + x.amount, 0);
    const totalUpcomingAmount = upcomingItems.reduce((s, x) => s + x.amount, 0);

    return {
      reportDate: today,
      overdueItems,
      dueTodayItems,
      upcomingItems,
      totalOverdueAmount,
      totalDueTodayAmount,
      totalUpcomingAmount,
    };
  }

  /**
   * جلوگیری از پرداخت و تسویه تکراری (Duplicate Settlement Guard)
   */
  public static validateSettlementEligibility(
    obligation: InvestorPaymentObligation
  ): { allowed: boolean; reason?: string } {
    if (obligation.status === 'PAID') {
      return {
        allowed: false,
        reason: `تعهد با شناسه ${obligation.id} قبلاً در تاریخ ${obligation.paymentDate || 'نامشخص'} تسویه شده است.`,
      };
    }
    if (obligation.status === 'CANCELLED') {
      return {
        allowed: false,
        reason: `تعهد با شناسه ${obligation.id} لغو شده است و قابل تسویه نمی‌باشد.`,
      };
    }
    return { allowed: true };
  }

  /**
   * ثبت تسویه و پرداخت بانکی به همراه تولید پی‌لود اطلاع‌رسانی
   */
  public static registerBankSettlement(
    obligation: InvestorPaymentObligation,
    settlementData: BankSettlementData,
    createdBy?: string
  ): {
    updatedObligation: InvestorPaymentObligation;
    notificationPayload: SettlementNotificationPayload;
  } {
    const eligibility = this.validateSettlementEligibility(obligation);
    if (!eligibility.allowed) {
      throw new Error(`خطای ثبت تسویه بانکی: ${eligibility.reason}`);
    }

    if (!settlementData.paymentDate) {
      throw new Error('تاریخ پرداخت الزامی است.');
    }

    const nowIso = new Date().toISOString();

    const updatedObligation: InvestorPaymentObligation = {
      ...obligation,
      status: 'PAID',
      paymentMethod: 'BANK_TRANSFER',
      paymentDate: settlementData.paymentDate,
      bankDetails: {
        bankName: settlementData.bankName,
        trackingNumber: settlementData.trackingNumber,
        destinationAccount: settlementData.destinationAccount,
        paymentReceiptUrl: settlementData.paymentReceiptUrl,
      },
      notes: `${obligation.notes || ''} | تسویه بانکی به شماره پیگیری ${settlementData.trackingNumber || 'نامشخص'}`.trim(),
      updatedAt: nowIso,
    };

    const notificationPayload: SettlementNotificationPayload = {
      eventName: 'INVESTOR_PAYMENT_SETTLED',
      obligationId: obligation.id,
      contractId: obligation.contractId,
      investorPersonId: obligation.investorPersonId,
      amount: obligation.amount,
      paymentDate: settlementData.paymentDate,
      paymentMethod: 'BANK_TRANSFER',
      trackingNumber: settlementData.trackingNumber,
      createdAt: nowIso,
    };

    return {
      updatedObligation,
      notificationPayload,
    };
  }

  /**
   * اتصال چک صادر شده بابت کارمزد/اصل سرمایه به تعهد سرمایه‌گذار
   * ⚠️ توجه: طبق اصل تحقق، صرف صدور/اتصال چک، وضعیت تعهد را به PAID تغییر نمی‌دهد
   * و هزینه‌ها را به صورت کامل پیش‌پرداخت نمی‌کند.
   */
  public static linkIssuedCheckToObligation(
    obligation: InvestorPaymentObligation,
    checkInfo: IssuedCheckInfo,
    notes?: string
  ): InvestorPaymentObligation {
    const eligibility = this.validateSettlementEligibility(obligation);
    if (!eligibility.allowed) {
      throw new Error(`خطای اتصال چک: ${eligibility.reason}`);
    }

    if (!checkInfo.checkId || !checkInfo.checkNumber) {
      throw new Error('مشخصات چک (شناسه و شماره چک) الزامی است.');
    }

    const nowIso = new Date().toISOString();

    return {
      ...obligation,
      paymentMethod: 'CHECK',
      checkId: checkInfo.checkId,
      checkNumber: checkInfo.checkNumber,
      checkDueDate: checkInfo.checkDueDate,
      notes: `${obligation.notes || ''} | متصل شده به چک شماره ${checkInfo.checkNumber} سررسید ${checkInfo.checkDueDate}`.trim(),
      updatedAt: nowIso,
    };
  }

  /**
   * بازمحاسبه و اصلاح تعهدات آتی هنگام تغییر سرمایه (افزایش / کاهش)
   * (سوابق گذشته و تعهدات پرداختی بدون دستکاری حفظ می‌شوند)
   */
  public static adjustObligationsOnCapitalChange(
    existingObligations: InvestorPaymentObligation[],
    contract: InvestorContract,
    effectiveDate: string
  ): InvestorPaymentObligation[] {
    const monthsInPeriod = InvestorCommissionEngine.getFrequencyMonths(contract.paymentFrequency);
    const newCommissionResult = InvestorCommissionEngine.calculateInvestorCommission(
      contract.currentCapital,
      contract.monthlyFeeRate,
      monthsInPeriod
    );

    const nowIso = new Date().toISOString();

    return existingObligations.map((obligation) => {
      // اگر پرداخت‌شده یا لغو شده است، بدون تغییر حفظ می‌شود
      if (obligation.status === 'PAID' || obligation.status === 'CANCELLED') {
        return obligation;
      }

      // اگر سررسید آن قبل از تاریخ اعمال است، تغییر نمی‌کند
      if (compareJalali(obligation.dueDate, effectiveDate) < 0) {
        return obligation;
      }

      // برای تعهدات آتی (کارمزد دوره‌ای)، مبلغ جدید اعمال می‌شود
      if (obligation.obligationType === 'FEE') {
        return {
          ...obligation,
          amount: newCommissionResult.expectedAmount,
          status: 'ADJUSTED',
          notes: `${obligation.notes || ''} | اصلاح شده بر اساس سرمایه جدید (${contract.currentCapital.toLocaleString()} ریال) و نرخ (${contract.monthlyFeeRate}٪)`,
          updatedAt: nowIso,
        };
      }

      return obligation;
    });
  }
}
