/**
 * Investor Institutional Engine
 * Data model and management infrastructure for Institutional Investors (Banks & Financial Institutions).
 * Operates independently from individual investors without modifying core accounting formulas.
 */

import { InvestorCategory, InstitutionalInvestorDetails, InstitutionalRepaymentItem } from './types';

export interface CreateInstitutionalParams {
  category: 'BANK' | 'FINANCIAL_INSTITUTION' | 'COMPANY';
  receivedAmount: number; // مبلغ دریافت شده از بانک/موسسه
  totalRepaymentAmount: number; // مبلغ کل بازپرداختی
  contractInterestOrFee: number; // کارمزد یا سود توافق‌شده
  repaymentMonths: number; // تعداد اقساط بازپرداخت
  startDate: string; // YYYY/MM/DD
}

export class InvestorInstitutionalEngine {
  /**
   * Initialize institutional details for Bank / Financial Institution
   */
  public static createInstitutionalDetails(
    params: CreateInstitutionalParams
  ): InstitutionalInvestorDetails {
    if (params.receivedAmount <= 0 || params.totalRepaymentAmount < params.receivedAmount) {
      throw new Error('مبلغ دریافت شده و کل بازپرداختی معتبر نیست.');
    }

    const principalDebt = params.receivedAmount;
    const feeTotal = params.totalRepaymentAmount - params.receivedAmount;
    const months = Math.max(1, params.repaymentMonths);

    const monthlyTotal = Math.round(params.totalRepaymentAmount / months);
    const monthlyPrincipal = Math.round(principalDebt / months);
    const monthlyFee = Math.round(feeTotal / months);

    const dueDates: string[] = [];
    const repaymentSchedule: InstitutionalRepaymentItem[] = [];

    let currentYear = parseInt(params.startDate.substring(0, 4)) || 1403;
    let currentMonth = parseInt(params.startDate.substring(5, 7)) || 1;
    let currentDay = parseInt(params.startDate.substring(8, 10)) || 1;

    for (let i = 1; i <= months; i++) {
      currentMonth++;
      if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
      }

      const formattedMonth = currentMonth < 10 ? `0${currentMonth}` : `${currentMonth}`;
      const formattedDay = currentDay < 10 ? `0${currentDay}` : `${currentDay}`;
      const dueDate = `${currentYear}/${formattedMonth}/${formattedDay}`;

      dueDates.push(dueDate);

      // Adjust last item rounding diff
      const isLast = i === months;
      const principalPortion = isLast
        ? principalDebt - monthlyPrincipal * (months - 1)
        : monthlyPrincipal;
      const feePortion = isLast ? feeTotal - monthlyFee * (months - 1) : monthlyFee;
      const totalAmount = principalPortion + feePortion;

      repaymentSchedule.push({
        id: `INST_SCHED_${i}_${Date.now()}`,
        dueDate,
        totalAmount,
        principalPortion,
        feePortion,
        status: 'PLANNED',
      });
    }

    return {
      receivedAmount: params.receivedAmount,
      totalRepaymentAmount: params.totalRepaymentAmount,
      principalDebt,
      contractInterestOrFee: feeTotal,
      repaymentSchedule,
      dueDates,
      settlementStatus: 'ACTIVE',
    };
  }

  /**
   * Settle an institutional repayment item
   */
  public static recordRepaymentSettlement(
    details: InstitutionalInvestorDetails,
    itemId: string,
    settlementDate: string
  ): InstitutionalInvestorDetails {
    const updatedSchedule = details.repaymentSchedule.map((item) => {
      if (item.id === itemId) {
        return {
          ...item,
          status: 'PAID' as const,
          paidDate: settlementDate,
        };
      }
      return item;
    });

    const allPaid = updatedSchedule.every((item) => item.status === 'PAID');

    return {
      ...details,
      repaymentSchedule: updatedSchedule,
      settlementStatus: allPaid ? 'SETTLED' : details.settlementStatus,
    };
  }
}
