/**
 * Investor Referral Engine
 * Handles investor referral registration, commission calculations based on capital and retention duration,
 * and handles capital reduction impact warnings without automatic clawback.
 */

import { InvestorReferral, ReferralCommissionStatus } from './types';

export interface CreateReferralParams {
  referrerPersonId: string;
  referrerName?: string;
  referredInvestorPersonId: string;
  referredInvestorName?: string;
  contractId?: string;
  referralDate: string; // YYYY/MM/DD
  capitalAmount: number; // Rials
  contractDurationMonths: number; // Duration e.g. 3 or 12
  contractType?: string; // e.g. monthly, quarterly
  commissionRate: number; // Percentage e.g. 2.0%
}

export class InvestorReferralEngine {
  /**
   * Calculate referral commission considering capital amount AND retention duration.
   * Formula: Capital * (Rate / 100) * (DurationMonths / 12)
   * Example: 1B Rials @ 2% for 3 months = 1B * 0.02 * (3/12) = 5,000,000 Rials
   * Example: 1B Rials @ 2% for 12 months = 1B * 0.02 * (12/12) = 20,000,000 Rials
   */
  public static calculateReferralCommission(
    capitalAmount: number,
    contractDurationMonths: number,
    commissionRatePercent: number
  ): number {
    if (capitalAmount <= 0 || contractDurationMonths <= 0 || commissionRatePercent <= 0) {
      return 0;
    }
    const annualBase = capitalAmount * (commissionRatePercent / 100);
    const durationFactor = Math.max(1, contractDurationMonths) / 12;
    return Math.round(annualBase * durationFactor);
  }

  /**
   * Register a new referral
   */
  public static registerReferral(params: CreateReferralParams): InvestorReferral {
    if (!params.referrerPersonId || !params.referredInvestorPersonId) {
      throw new Error('شناسه معرف و سرمایه‌گذار معرفی‌شده الزامی است.');
    }
    if (params.referrerPersonId === params.referredInvestorPersonId) {
      throw new Error('معرف نمی‌تواند با شخص سرمایه‌گذار یکسان باشد.');
    }

    const duration = params.contractDurationMonths || 12;
    const calculatedCommission = this.calculateReferralCommission(
      params.capitalAmount,
      duration,
      params.commissionRate
    );

    const referral: InvestorReferral = {
      id: `REF_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      referrerPersonId: params.referrerPersonId,
      referrerName: params.referrerName,
      referredInvestorPersonId: params.referredInvestorPersonId,
      referredInvestorName: params.referredInvestorName,
      contractId: params.contractId,
      referralDate: params.referralDate,
      capitalAmount: params.capitalAmount,
      contractDurationMonths: duration,
      contractType: params.contractType || 'monthly',
      commissionRate: params.commissionRate,
      calculatedCommissionAmount: calculatedCommission,
      commissionStatus: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return referral;
  }

  /**
   * Suggest recalculation on capital reduction, duration reduction, or early termination.
   * CRITICAL RULE: Generates a warning and recalculation proposal ONLY.
   * DOES NOT perform automatic clawback without manager approval.
   */
  public static handleContractAdjustment(
    referral: InvestorReferral,
    newCapitalAmount: number,
    newDurationMonths: number,
    adjustmentReason: string
  ): {
    updatedReferral: InvestorReferral;
    warningMessage: string;
    suggestedCommission: number;
    requiresManagerAction: boolean;
  } {
    const suggestedCommission = this.calculateReferralCommission(
      newCapitalAmount,
      newDurationMonths,
      referral.commissionRate
    );

    const diff = referral.calculatedCommissionAmount - suggestedCommission;

    let warningMessage = '';
    let requiresManagerAction = false;

    if (diff > 0) {
      warningMessage = `⚠️ هشدار تغییر قرارداد معرف: به دلیل ${adjustmentReason} (کاهش سرمایه/مدت)، مبلغ کمیسیون پیشنهادی از ${referral.calculatedCommissionAmount.toLocaleString('fa-IR')} ریال به ${suggestedCommission.toLocaleString('fa-IR')} ریال کاهش می‌یابد. کسر یا تعدیل نیازمند تایید مستقیم مدیر است.`;
      requiresManagerAction = true;
    } else if (diff < 0) {
      warningMessage = `ℹ️ اطلاع: به دلیل افزایش سرمایه/مدت، کمیسیون جدید پیشنهادی ${suggestedCommission.toLocaleString('fa-IR')} ریال است.`;
    } else {
      warningMessage = 'تغییری در کمیسیون معرف رخ نداد.';
    }

    const updatedReferral: InvestorReferral = {
      ...referral,
      suggestedRecalculatedCommission: suggestedCommission,
      commissionStatus: diff !== 0 ? 'RECALCULATED' : referral.commissionStatus,
      updatedAt: new Date().toISOString(),
    };

    return {
      updatedReferral,
      warningMessage,
      suggestedCommission,
      requiresManagerAction,
    };
  }

  /**
   * Approve referral commission by manager
   */
  public static approveCommission(
    referral: InvestorReferral,
    approvedBy: string,
    overrideAmount?: number,
    notes?: string
  ): InvestorReferral {
    const finalAmount = overrideAmount !== undefined ? overrideAmount : (referral.suggestedRecalculatedCommission || referral.calculatedCommissionAmount);

    return {
      ...referral,
      calculatedCommissionAmount: finalAmount,
      suggestedRecalculatedCommission: undefined,
      commissionStatus: 'APPROVED',
      approvedBy,
      approvalNotes: notes || 'تایید شده توسط مدیر',
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Mark referral commission as paid
   */
  public static markAsPaid(referral: InvestorReferral): InvestorReferral {
    return {
      ...referral,
      commissionStatus: 'PAID',
      updatedAt: new Date().toISOString(),
    };
  }
}
