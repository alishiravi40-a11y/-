/**
 * Investor Contract Lifecycle Engine
 * (موتور مدیریت چرخه عمر قراردادهای سرمایه‌گذاری)
 * 
 * مسئولیت‌ها:
 * - ثبت و ایجاد قرارداد جدید سرمایه‌گذاری
 * - مدیریت افزایش و کاهش سرمایه با ثبت سوابق تاریخی
 * - مدیریت تغییرات نرخ کارمزد بدون حذف سوابق گذشته
 * - تغییر وضعیت‌های قرارداد (فعال، خاتمه یافته، تمدید شده و ...)
 * - صدور رویدادهای داخلی چرخه عمر قرارداد (InvestorContractEvent)
 * 
 * ⚠️ این موتور هیچ سند حسابداری، بدهی مالی یا چک ایجاد نمی‌کند.
 */

import {
  InvestorContract,
  InvestorContractStatus,
  InvestorPaymentFrequency,
  InvestorRateHistory,
  InvestorContractChangeLog,
  InvestorContractEvent,
  InvestorContractEventType,
} from './types';

export interface CreateContractParams {
  investorPersonId: string;
  initialCapital: number;
  startDate: string;
  endDate?: string;
  monthlyFeeRate: number;
  paymentFrequency: InvestorPaymentFrequency;
  businessPartnerId?: string;
  contractNumber?: string;
  notes?: string;
  createdBy?: string;
}

export interface CapitalAdjustmentParams {
  amount: number;
  effectiveDate: string;
  description: string;
  changedBy?: string;
}

export interface RateChangeParams {
  newRate: number;
  effectiveDate: string;
  reason?: string;
  changedBy?: string;
}

export interface StatusUpdateParams {
  newStatus: InvestorContractStatus;
  reason?: string;
  changedBy?: string;
  effectiveDate?: string;
}

export class InvestorContractEngine {
  private static contractCounter = 1;

  /**
   * ایجاد قرارداد سرمایه‌گذاری جدید
   */
  public static createInvestorContract(params: CreateContractParams): {
    contract: InvestorContract;
    event: InvestorContractEvent;
  } {
    if (!params.investorPersonId) {
      throw new Error('شناسه شخص سرمایه‌گذار الزامی است.');
    }
    if (params.initialCapital <= 0) {
      throw new Error('مبلغ اولیه سرمایه باید بزرگتر از صفر باشد.');
    }
    if (params.monthlyFeeRate < 0) {
      throw new Error('نرخ کارمزد ماهانه نمی‌تواند منفی باشد.');
    }

    const now = new Date().toISOString();
    const contractId = `INV_CTR_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const contractNumber =
      params.contractNumber ||
      `INV-${params.startDate ? params.startDate.substring(0, 4) : '1403'}-${String(
        this.contractCounter++
      ).padStart(3, '0')}`;

    const contract: InvestorContract = {
      id: contractId,
      contractNumber,
      investorPersonId: params.investorPersonId,
      businessPartnerId: params.businessPartnerId,
      startDate: params.startDate,
      endDate: params.endDate,
      initialCapital: params.initialCapital,
      currentCapital: params.initialCapital,
      monthlyFeeRate: params.monthlyFeeRate,
      paymentFrequency: params.paymentFrequency,
      status: 'active',
      history: [],
      changeLogs: [
        {
          id: `LOG_${Date.now()}_0`,
          contractId,
          changeType: 'STATUS_CHANGE',
          changeDate: params.startDate,
          description: `ایجاد اولیه قرارداد سرمایه‌گذاری با سرمایه ${params.initialCapital.toLocaleString()} ریال و نرخ کارمزد ${params.monthlyFeeRate}٪`,
          newCapital: params.initialCapital,
          newRate: params.monthlyFeeRate,
          changedAt: now,
          changedBy: params.createdBy || 'system',
        },
      ],
      notes: params.notes,
      createdAt: now,
      updatedAt: now,
    };

    const event: InvestorContractEvent = {
      id: `EVT_${Date.now()}_1`,
      contractId,
      eventType: 'contract_created',
      timestamp: now,
      performedBy: params.createdBy || 'system',
      payload: {
        contractNumber,
        investorPersonId: params.investorPersonId,
        initialCapital: params.initialCapital,
        monthlyFeeRate: params.monthlyFeeRate,
        paymentFrequency: params.paymentFrequency,
      },
      notes: `قرارداد شماره ${contractNumber} ایجاد گردید.`,
    };

    return { contract, event };
  }

  /**
   * افزایش سرمایه قرارداد
   */
  public static increaseInvestorCapital(
    contract: InvestorContract,
    params: CapitalAdjustmentParams
  ): { contract: InvestorContract; event: InvestorContractEvent } {
    if (contract.status !== 'active' && contract.status !== 'renewed') {
      throw new Error(`امکان افزایش سرمایه برای قرارداد در وضعیت "${contract.status}" وجود ندارد.`);
    }
    if (params.amount <= 0) {
      throw new Error('مبلغ افزایش سرمایه باید بزرگتر از صفر باشد.');
    }

    const previousCapital = contract.currentCapital;
    const newCapital = previousCapital + params.amount;
    const now = new Date().toISOString();

    const changeLog: InvestorContractChangeLog = {
      id: `LOG_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      contractId: contract.id,
      changeType: 'CAPITAL_INCREASE',
      changeDate: params.effectiveDate,
      description: params.description || `افزایش سرمایه به میزان ${params.amount.toLocaleString()} ریال`,
      previousCapital,
      newCapital,
      changedAt: now,
      changedBy: params.changedBy || 'system',
    };

    const updatedContract: InvestorContract = {
      ...contract,
      currentCapital: newCapital,
      changeLogs: [...(contract.changeLogs || []), changeLog],
      updatedAt: now,
    };

    const event: InvestorContractEvent = {
      id: `EVT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      contractId: contract.id,
      eventType: 'capital_increased',
      timestamp: now,
      performedBy: params.changedBy || 'system',
      payload: {
        addedAmount: params.amount,
        previousCapital,
        newCapital,
        effectiveDate: params.effectiveDate,
      },
      notes: `سرمایه قرارداد از ${previousCapital.toLocaleString()} به ${newCapital.toLocaleString()} ریال افزایش یافت.`,
    };

    return { contract: updatedContract, event };
  }

  /**
   * کاهش سرمایه قرارداد
   */
  public static decreaseInvestorCapital(
    contract: InvestorContract,
    params: CapitalAdjustmentParams
  ): { contract: InvestorContract; event: InvestorContractEvent } {
    if (contract.status !== 'active' && contract.status !== 'renewed') {
      throw new Error(`امکان کاهش سرمایه برای قرارداد در وضعیت "${contract.status}" وجود ندارد.`);
    }
    if (params.amount <= 0) {
      throw new Error('مبلغ کاهش سرمایه باید بزرگتر از صفر باشد.');
    }
    if (params.amount > contract.currentCapital) {
      throw new Error(
        `مبلغ کاهش سرمایه (${params.amount.toLocaleString()}) از کل سرمایه فعلی (${contract.currentCapital.toLocaleString()}) بیشتر است.`
      );
    }

    const previousCapital = contract.currentCapital;
    const newCapital = previousCapital - params.amount;
    const now = new Date().toISOString();

    const changeLog: InvestorContractChangeLog = {
      id: `LOG_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      contractId: contract.id,
      changeType: 'CAPITAL_DECREASE',
      changeDate: params.effectiveDate,
      description: params.description || `کاهش سرمایه به میزان ${params.amount.toLocaleString()} ریال`,
      previousCapital,
      newCapital,
      changedAt: now,
      changedBy: params.changedBy || 'system',
    };

    const updatedContract: InvestorContract = {
      ...contract,
      currentCapital: newCapital,
      changeLogs: [...(contract.changeLogs || []), changeLog],
      updatedAt: now,
    };

    const event: InvestorContractEvent = {
      id: `EVT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      contractId: contract.id,
      eventType: 'capital_decreased',
      timestamp: now,
      performedBy: params.changedBy || 'system',
      payload: {
        reducedAmount: params.amount,
        previousCapital,
        newCapital,
        effectiveDate: params.effectiveDate,
      },
      notes: `سرمایه قرارداد از ${previousCapital.toLocaleString()} به ${newCapital.toLocaleString()} ریال کاهش یافت.`,
    };

    return { contract: updatedContract, event };
  }

  /**
   * تغییر نرخ کارمزد قرارداد
   */
  public static changeInvestorRate(
    contract: InvestorContract,
    params: RateChangeParams
  ): { contract: InvestorContract; event: InvestorContractEvent } {
    if (contract.status !== 'active' && contract.status !== 'renewed') {
      throw new Error(`امکان تغییر نرخ برای قرارداد در وضعیت "${contract.status}" وجود ندارد.`);
    }
    if (params.newRate < 0) {
      throw new Error('نرخ جدید کارمزد نمی‌تواند منفی باشد.');
    }

    const previousRate = contract.monthlyFeeRate;
    const now = new Date().toISOString();

    const rateHistoryEntry: InvestorRateHistory = {
      id: `RH_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      contractId: contract.id,
      effectiveDate: params.effectiveDate,
      previousRate,
      newRate: params.newRate,
      reason: params.reason || 'تغییر توافقی نرخ کارمزد',
      changedAt: now,
      changedBy: params.changedBy || 'system',
    };

    const changeLog: InvestorContractChangeLog = {
      id: `LOG_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      contractId: contract.id,
      changeType: 'RATE_CHANGE',
      changeDate: params.effectiveDate,
      description: params.reason || `تغییر نرخ کارمزد از ${previousRate}٪ به ${params.newRate}٪`,
      previousRate,
      newRate: params.newRate,
      changedAt: now,
      changedBy: params.changedBy || 'system',
    };

    const updatedContract: InvestorContract = {
      ...contract,
      monthlyFeeRate: params.newRate,
      history: [...(contract.history || []), rateHistoryEntry],
      changeLogs: [...(contract.changeLogs || []), changeLog],
      updatedAt: now,
    };

    const event: InvestorContractEvent = {
      id: `EVT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      contractId: contract.id,
      eventType: 'rate_changed',
      timestamp: now,
      performedBy: params.changedBy || 'system',
      payload: {
        previousRate,
        newRate: params.newRate,
        effectiveDate: params.effectiveDate,
      },
      notes: `نرخ کارمزد ماهانه از ${previousRate}٪ به ${params.newRate}٪ تغییر کرد.`,
    };

    return { contract: updatedContract, event };
  }

  /**
   * بروزرسانی وضعیت قرارداد (فعال، پایان‌یافته، تمدیدشده، فسخ‌شده، متوقف‌conf)
   */
  public static updateContractStatus(
    contract: InvestorContract,
    params: StatusUpdateParams
  ): { contract: InvestorContract; event: InvestorContractEvent } {
    if (contract.status === params.newStatus) {
      throw new Error(`قرارداد هم‌اکنون در وضعیت "${params.newStatus}" قرار دارد.`);
    }

    const previousStatus = contract.status;
    const now = new Date().toISOString();

    const changeLog: InvestorContractChangeLog = {
      id: `LOG_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      contractId: contract.id,
      changeType: 'STATUS_CHANGE',
      changeDate: params.effectiveDate || new Date().toLocaleDateString('fa-IR'),
      description: params.reason || `تغییر وضعیت قرارداد از ${previousStatus} به ${params.newStatus}`,
      changedAt: now,
      changedBy: params.changedBy || 'system',
    };

    const updatedContract: InvestorContract = {
      ...contract,
      status: params.newStatus,
      changeLogs: [...(contract.changeLogs || []), changeLog],
      updatedAt: now,
    };

    let eventType: InvestorContractEventType = 'status_changed';
    if (params.newStatus === 'terminated') {
      eventType = 'contract_terminated';
    } else if (params.newStatus === 'renewed') {
      eventType = 'contract_renewed';
    }

    const event: InvestorContractEvent = {
      id: `EVT_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      contractId: contract.id,
      eventType,
      timestamp: now,
      performedBy: params.changedBy || 'system',
      payload: {
        previousStatus,
        newStatus: params.newStatus,
        reason: params.reason,
      },
      notes: `وضعیت قرارداد از ${previousStatus} به ${params.newStatus} تغییر یافت.`,
    };

    return { contract: updatedContract, event };
  }
}
