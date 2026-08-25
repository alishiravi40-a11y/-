/**
 * Investor Accounting Adapter & Mapper Layer
 * (لایه اتصال و تبدیل رویدادهای سرمایه‌گذاران به حسابداری)
 * 
 * مسئولیت‌ها:
 * - تعریف رویدادهای مالی سرمایه‌گذار (دریافت سرمایه، استرداد سرمایه، تحقق کارمزد، پرداخت کارمزد)
 * - تبدیل ساختار رویداد سرمایه‌گذار به پیش‌نویس درخواست ثبت سند حسابداری دوطرفه (Double-Entry Voucher Request)
 * - اعتبارسنجی تراز بودن بدهکار و بستانکار و صحت داده‌های ورودی قبل از درخواست
 * 
 * ⚠️ این لایه فقط Mapper و درخواست‌ساز است و هیچ دخل و تصرفی در موتور اصلی حسابداری (accounting.ts) ندارد.
 */

import { Person } from '../../types';
import { InvestorContract, InvestorFinancialEvent, InvestorFinancialEventType } from './types';

export interface InvestorVoucherDraftRequest {
  eventId: string;
  eventType: InvestorFinancialEventType;
  contractId: string;
  contractNumber: string;
  investorPersonId: string;
  investorPersonName: string;
  date: string; // تاریخ شمسی
  description: string;
  entries: {
    subsidiaryId: string;
    floatingDetailed?: {
      type: 'person' | 'product' | 'other';
      id: string;
      name: string;
    };
    debit: number;
    credit: number;
    description?: string;
  }[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
  createdBy?: string;
}

export interface InvestorAccountingAdapterOptions {
  bankSubAccountId?: string;
  financialExpenseSubAccountId?: string;
  investorPayableSubAccountId?: string;
  createdBy?: string;
}

export const DEFAULT_INVESTOR_PAYABLES_SUB_ID = 'SUB_INVESTOR_PAYABLES';
export const DEFAULT_FINANCIAL_EXPENSE_SUB_ID = 'SUB_EXP_FIN_INTEREST';
export const DEFAULT_BANK_SUB_ID = 'SUB_BANK_MAIN';

export class InvestorAccountingMapper {
  /**
   * کنترل صحت و پیش‌شرط‌های اعتبارسنجی رویداد مالی سرمایه‌گذار
   */
  public static validateFinancialEvent(
    event: InvestorFinancialEvent,
    person: Person | null | undefined,
    contract: InvestorContract | null | undefined
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!person) {
      errors.push('شخص سرمایه‌گذار در سیستم یافت نشد.');
    } else if (person.id !== event.investorPersonId) {
      errors.push(`شناسه شخص ورودی (${person.id}) با شناسه سرمایه‌گذار رویداد (${event.investorPersonId}) مغایرت دارد.`);
    }

    if (!contract) {
      errors.push('قرارداد سرمایه‌گذاری مربوطه یافت نشد.');
    } else {
      if (contract.id !== event.contractId) {
        errors.push(`شناسه قرارداد ورودی (${contract.id}) با شناسه قرارداد رویداد (${event.contractId}) مغایرت دارد.`);
      }
      if (contract.status === 'terminated') {
        errors.push('امکان ثبت رویداد مالی برای قرارداد فسخ/خاتمه یافته وجود ندارد.');
      }
    }

    if (!event.amount || event.amount <= 0) {
      errors.push('مبلغ رویداد مالی باید بزرگتر از صفر باشد.');
    }

    if (!event.eventDate || !event.eventDate.match(/^\d{4}\/\d{2}\/\d{2}$/)) {
      errors.push('تاریخ رویداد مالی نامعتبر است. فرمت صحیح YYYY/MM/DD می‌باشد.');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * تبدیل رویداد سرمایه‌گذار به پیش‌نویس درخواست سند حسابداری
   */
  public static createVoucherDraftRequest(
    event: InvestorFinancialEvent,
    person: Person,
    contract: InvestorContract,
    options?: InvestorAccountingAdapterOptions
  ): InvestorVoucherDraftRequest {
    const validation = this.validateFinancialEvent(event, person, contract);
    if (!validation.isValid) {
      throw new Error(`اعتبارسنجی رویداد مالی سرمایه‌گذار ناموفق بود: ${validation.errors.join(' | ')}`);
    }

    const bankSubId = event.cashOrBankSubAccountId || options?.bankSubAccountId || DEFAULT_BANK_SUB_ID;
    const financialExpenseSubId = options?.financialExpenseSubAccountId || DEFAULT_FINANCIAL_EXPENSE_SUB_ID;
    const investorPayablesSubId = options?.investorPayableSubAccountId || DEFAULT_INVESTOR_PAYABLES_SUB_ID;

    const floatingPerson = {
      type: 'person' as const,
      id: person.id,
      name: person.name,
    };

    let entries: InvestorVoucherDraftRequest['entries'] = [];
    let defaultDesc = '';

    switch (event.eventType) {
      case 'INVESTMENT_RECEIVED':
        defaultDesc = `دریافت سرمایه طی قرارداد شماره ${contract.contractNumber} از ${person.name}`;
        entries = [
          // بدهکار: بانک / صندوق
          {
            subsidiaryId: bankSubId,
            debit: event.amount,
            credit: 0,
            description: event.description || defaultDesc,
          },
          // بستانکار: جاری شرکا و سرمایه‌گذاران (با تفصیلی شخص)
          {
            subsidiaryId: investorPayablesSubId,
            floatingDetailed: floatingPerson,
            debit: 0,
            credit: event.amount,
            description: event.description || defaultDesc,
          },
        ];
        break;

      case 'INVESTMENT_RETURNED':
        defaultDesc = `استرداد اصل سرمایه طی قرارداد شماره ${contract.contractNumber} به ${person.name}`;
        entries = [
          // بدهکار: جاری شرکا و سرمایه‌گذاران (با تفصیلی شخص)
          {
            subsidiaryId: investorPayablesSubId,
            floatingDetailed: floatingPerson,
            debit: event.amount,
            credit: 0,
            description: event.description || defaultDesc,
          },
          // بستانکار: بانک / صندوق
          {
            subsidiaryId: bankSubId,
            debit: 0,
            credit: event.amount,
            description: event.description || defaultDesc,
          },
        ];
        break;

      case 'COMMISSION_ACCRUED':
        defaultDesc = `شناسایی و تحقق کارمزد سرمایه‌گذاری طی قرارداد شماره ${contract.contractNumber} متعلق به ${person.name}`;
        entries = [
          // بدهکار: هزینه‌های مالی
          {
            subsidiaryId: financialExpenseSubId,
            debit: event.amount,
            credit: 0,
            description: event.description || defaultDesc,
          },
          // بستانکار: اسناد پرداختنی (اگر چک متصل است) یا جاری شرکا و سرمایه‌گذاران (با تفصیلی شخص)
          {
            subsidiaryId: event.checkId ? 'SUB_CHECKS_PAY' : investorPayablesSubId,
            floatingDetailed: event.checkId ? undefined : floatingPerson,
            debit: 0,
            credit: event.amount,
            description: event.description || defaultDesc,
          },
        ];
        break;

      case 'COMMISSION_PAID':
        defaultDesc = `پرداخت کارمزد سرمایه‌گذاری طی قرارداد شماره ${contract.contractNumber} به ${person.name}`;
        entries = [
          // بدهکار: جاری شرکا و سرمایه‌گذاران (با تفصیلی شخص)
          {
            subsidiaryId: investorPayablesSubId,
            floatingDetailed: floatingPerson,
            debit: event.amount,
            credit: 0,
            description: event.description || defaultDesc,
          },
          // بستانکار: بانک / صندوق
          {
            subsidiaryId: bankSubId,
            debit: 0,
            credit: event.amount,
            description: event.description || defaultDesc,
          },
        ];
        break;

      default:
        throw new Error(`نوع رویداد مالی سرمایه‌گذار پشتیبانی نمی‌شود: ${event.eventType}`);
    }

    const totalDebit = entries.reduce((sum, item) => sum + item.debit, 0);
    const totalCredit = entries.reduce((sum, item) => sum + item.credit, 0);
    const isBalanced = totalDebit === totalCredit && totalDebit > 0;

    if (!isBalanced) {
      throw new Error(`سند حسابداری تولید شده تراز نمی‌باشد! جمع بدهکار: ${totalDebit}، جمع بستانکار: ${totalCredit}`);
    }

    return {
      eventId: event.id,
      eventType: event.eventType,
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      investorPersonId: person.id,
      investorPersonName: person.name,
      date: event.eventDate,
      description: event.description || defaultDesc,
      entries,
      totalDebit,
      totalCredit,
      isBalanced,
      createdBy: options?.createdBy || event.createdBy || 'system',
    };
  }
}
