/**
 * Investor Commission Calculation & Schedule Engine
 * (موتور محاسبه و زمان‌بندی کارمزد سرمایه‌گذاران)
 * 
 * مسئولیت‌ها:
 * - محاسبه کارمزد دوره‌ای بر اساس سرمایه فعلی، نرخ ماهانه و دوره دریافت
 * - تولید جدول زمان‌بندی پرداخت‌های آینده (Payment Schedule)
 * - پشتیبانی از تمامی دوره‌های پرداخت (ماهانه، دوماهه، سه ماهه، شش ماهه، سالانه)
 * - بازمحاسبه اقساط آتی هنگام تغییر سرمایه یا نرخ بدون دستکاری سوابق گذشته
 * 
 * ⚠️ این موتور فقط محاسباتی و زمان‌بندی است و هیچ سند مالی یا حسابی صادر نمی‌کند.
 */

import {
  InvestorContract,
  InvestorPaymentSchedule,
  InvestorPaymentFrequency,
  InvestorCommissionScheduleStatus,
} from './types';
import { addMonthsToJalali, compareJalali, getCurrentJalaliDate } from '../../utils/jalali';

export interface CalculationResult {
  expectedAmount: number;
  monthlyFeeRate: number;
  monthsInPeriod: number;
  capitalAmount: number;
}

export class InvestorCommissionEngine {
  /**
   * نگاشت نوع دوره به تعداد ماه
   */
  public static getFrequencyMonths(frequency: InvestorPaymentFrequency): number {
    switch (frequency) {
      case 'monthly':
        return 1;
      case 'bimonthly':
        return 2;
      case 'quarterly':
        return 3;
      case 'semi_annual':
        return 6;
      case 'annual':
        return 12;
      default:
        return 1;
    }
  }

  /**
   * محاسبه کارمزد دوره‌ای
   * فرمول: سرمایه فعلی * (نرخ ماهانه / 100) * تعداد ماه دوره
   */
  public static calculateInvestorCommission(
    capital: number,
    monthlyFeeRate: number,
    frequency: InvestorPaymentFrequency | number
  ): CalculationResult {
    if (capital < 0) {
      throw new Error('مبلغ سرمایه نمی‌تواند منفی باشد.');
    }
    if (monthlyFeeRate < 0) {
      throw new Error('نرخ کارمزد نمی‌تواند منفی باشد.');
    }

    const monthsInPeriod = typeof frequency === 'number' ? frequency : this.getFrequencyMonths(frequency);
    if (monthsInPeriod <= 0) {
      throw new Error('تعداد ماه‌های دوره باید بزرگتر از صفر باشد.');
    }

    // محاسبه کارمزد دوره به صورت گرد شده
    const expectedAmount = Math.round(capital * (monthlyFeeRate / 100) * monthsInPeriod);

    return {
      expectedAmount,
      monthlyFeeRate,
      monthsInPeriod,
      capitalAmount: capital,
    };
  }

  /**
   * تولید برنامه زمان‌بندی پرداخت‌های آینده برای یک قرارداد
   * @param contract قرارداد سرمایه‌گذاری
   * @param totalContractMonths مدت کل قرارداد به ماه (پیش‌فرض ۱۲ ماه)
   */
  public static generatePaymentSchedule(
    contract: InvestorContract,
    totalContractMonths: number = 12
  ): InvestorPaymentSchedule[] {
    if (totalContractMonths <= 0) {
      throw new Error('مدت قرارداد به ماه باید بزرگتر از صفر باشد.');
    }

    const monthsInPeriod = this.getFrequencyMonths(contract.paymentFrequency);
    const numberOfPeriods = Math.floor(totalContractMonths / monthsInPeriod);

    if (numberOfPeriods <= 0) {
      throw new Error(
        `مدت قرارداد (${totalContractMonths} ماه) کمتر از دوره پرداخت انتخاب شده (${monthsInPeriod} ماه) است.`
      );
    }

    const schedules: InvestorPaymentSchedule[] = [];
    const currentDate = getCurrentJalaliDate();
    const nowIso = new Date().toISOString();

    const commissionResult = this.calculateInvestorCommission(
      contract.currentCapital,
      contract.monthlyFeeRate,
      monthsInPeriod
    );

    let lastDueDate = contract.startDate;

    for (let i = 1; i <= numberOfPeriods; i++) {
      const dueDate = addMonthsToJalali(contract.startDate, i * monthsInPeriod);
      
      // تعیین وضعیت سررسید: اگر تاریخ سررسید گذشته یا امروز است -> DUE در غیر این صورت -> PLANNED
      let status: InvestorCommissionScheduleStatus = 'PLANNED';
      if (compareJalali(dueDate, currentDate) <= 0) {
        status = 'DUE';
      }

      const scheduleItem: InvestorPaymentSchedule = {
        id: `SCHED_${contract.id}_${i}_${Date.now()}`,
        contractId: contract.id,
        investorPersonId: contract.investorPersonId,
        dueDate,
        expectedAmount: commissionResult.expectedAmount,
        paymentType: 'FEE',
        status,
        notes: `کارمزد دوره ${i} از ${numberOfPeriods} (دوره ${monthsInPeriod} ماهه با نرخ ${contract.monthlyFeeRate}٪)`,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      schedules.push(scheduleItem);
      lastDueDate = dueDate;
    }

    return schedules;
  }

  /**
   * بازمحاسبه برنامه‌های پرداخت آینده پس از تغییر سرمایه یا نرخ
   * (بدون دستکاری سوابق گذشته یا پرداخت‌شده)
   * 
   * @param existingSchedules لیست برنامه‌های موجود
   * @param contract قرارداد بروزرسانی شده
   * @param effectiveDate تاریخ اعمال تغییرات
   */
  public static recalculateFutureSchedule(
    existingSchedules: InvestorPaymentSchedule[],
    contract: InvestorContract,
    effectiveDate: string
  ): InvestorPaymentSchedule[] {
    const monthsInPeriod = this.getFrequencyMonths(contract.paymentFrequency);
    const newCommission = this.calculateInvestorCommission(
      contract.currentCapital,
      contract.monthlyFeeRate,
      monthsInPeriod
    );
    const nowIso = new Date().toISOString();

    return existingSchedules.map((schedule) => {
      // اگر پرداخت شده، لغو شده، یا سررسید آن قبل از تاریخ اعمال است، بدون تغییر حفظ می‌شود
      if (
        schedule.status === 'PAID' ||
        schedule.status === 'CANCELLED' ||
        compareJalali(schedule.dueDate, effectiveDate) < 0
      ) {
        return schedule;
      }

      // برنامه‌های آینده با نرخ و سرمایه جدید بروزرسانی می‌شوند
      return {
        ...schedule,
        expectedAmount: newCommission.expectedAmount,
        notes: `${schedule.notes || ''} | اصلاح شده بر اساس سرمایه جدید (${contract.currentCapital.toLocaleString()} ریال) و نرخ جدید (${contract.monthlyFeeRate}٪)`,
        updatedAt: nowIso,
      };
    });
  }
}
