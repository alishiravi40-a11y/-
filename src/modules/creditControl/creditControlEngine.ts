/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CreditControlEngineInput,
  CreditControlEngineOutput,
  InvoiceBalance,
  AgentCreditSummary,
  PendingLateFeeRecord,
  SuggestedVoucherDraft,
  CreditControlEvent,
  ICreditControlStrategy,
  PaymentAllocationPolicy,
  SalesReturnHandlingPolicy,
  CreditCalculationPolicy,
  VoucherDraftPolicy,
  WarningDeliveryPolicy,
  SalesAgentPolicy,
  CreditControlDraft
} from './creditControl.types';
import { addDaysToJalali, getJalaliDiffDays, compareJalali } from '../../utils/jalali';
import { AppState, Person, BusinessPartner } from '../../types';
import { resolvePartnerCreditRules } from '../../utils/partnerProcess';

/**
 * پیاده‌سازی استراتژی محاسباتی کنترل حساب نمایندگان فروش
 * Core business computational logic, completely pure, side-effect-free, and based on Business Date.
 */
// Helper to distinguish sales accounts receivable (بدهکاران تجاری و فروش نسیه) from payables / credit files
const SALES_DEBTORS_SUBSIDIARIES = new Set([
  'SUB_DEBTORS',
  'SUB_DEBTORS_AGENTS',
  'SUB_DEBTORS_INSTALLMENT',
  '10301',
  '10302',
  '10304'
]);

function isSalesDebtorsAccount(subsidiaryId?: string): boolean {
  if (!subsidiaryId) return false;
  if (SALES_DEBTORS_SUBSIDIARIES.has(subsidiaryId)) return true;
  if (subsidiaryId.startsWith('SUB_DEBTORS')) return true;
  return false;
}

export class DefaultCreditControlStrategy implements ICreditControlStrategy {
  /**
   * ۱. سیاست تخصیص پرداخت‌ها و برگشت از فروش به صورت FIFO واقعی
   */
  allocatePayments(input: CreditControlEngineInput): InvoiceBalance[] {
    const targetAgentId = input.agent.id;
    const targetPartnerPersonId = input.partner.personId;

    // الف) فیلتر و مرتب‌سازی فاکتورهای معتبر و باز نماینده به ترتیب تاریخ صعودی (FIFO)
    const agentInvoices = input.invoices
      .filter(inv => {
        const isAgent = inv.personId === targetAgentId || inv.personId === targetPartnerPersonId;
        const isReal = !inv.isProInvoice;
        const isActive = inv.status !== 'voided' && inv.status !== 'draft';
        const isSell = inv.type === 'sell';
        return isAgent && isReal && isActive && isSell;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return compareJalali(a.date, b.date);
        return a.invoiceNumber - b.invoiceNumber;
      });

    // ب) شناسایی و اعمال اسناد برگشت از فروش (Sales Returns)
    // برگشت از فروش باید مانده فاکتور مرجع را کاهش دهد و مستقل از پرداخت‌های نقدی عمومی مستقیماً اعمال شود.
    const returnsByInvoiceId: Record<string, number> = {};

    input.vouchers
      .filter(v => v.status !== 'voided' && v.status !== 'draft')
      .forEach(v => {
        const isReturnVoucher = v.description?.includes('برگشت') || v.description?.includes('مرجوع');
        if (isReturnVoucher && v.sourceId) {
          v.entries.forEach(e => {
            const isAgent = e.floatingDetailed?.id === targetAgentId || e.floatingDetailed?.id === targetPartnerPersonId;
            const isCredit = e.credit > 0;
            if (isAgent && isCredit) {
              returnsByInvoiceId[v.sourceId!] = (returnsByInvoiceId[v.sourceId!] || 0) + e.credit;
            }
          });
        }
      });

    // آماده‌سازی آرایه پایه مانده فاکتورها
    const balances: InvoiceBalance[] = agentInvoices.map(invoice => {
      const returnedAmount = returnsByInvoiceId[invoice.id] || 0;
      const paymentTermDays = invoice.creditRulesSnapshot?.defaultInstallmentDays ?? input.policy.paymentTermDays;
      const penaltyRate = invoice.creditRulesSnapshot?.penaltyRatePerMonth ?? input.policy.lateFeeDailyPercentage;
      // مهلت پرداخت N روزه از تاریخ فاکتور: روز سررسید پایان روز Nام است
      const dueDate = paymentTermDays > 0 
        ? addDaysToJalali(invoice.date, paymentTermDays - 1) 
        : invoice.date;
      const rawDelay = getJalaliDiffDays(input.currentDate, dueDate);
      const delayDays = rawDelay > 0 ? rawDelay : 0;

      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        originalAmount: invoice.totalAmount,
        paidAmount: 0,
        returnedAmount,
        remainingAmount: Math.max(0, invoice.totalAmount - returnedAmount),
        dueDate,
        delayDays,
        penaltyRate,
        accumulatedPenalty: 0,
        status: 'open'
      };
    });

    // ج) جمع‌آوری کل پرداخت‌های تایید شده نهایی
    // پرداخت‌های تأییدنشده هیچ اثری روی محاسبات ندارند.
    interface PaymentTx {
      id: string;
      amount: number;
      date: string;
    }
    const paymentTxs: PaymentTx[] = [];

    // ۱. استخراج از سندهای حسابداری تایید شده دریافت وجه و تسویه بدهی فروش (با حفظ تفکیک نقش‌ها و سرفصل‌ها)
    input.vouchers
      .filter(v => v.status !== 'voided' && v.status !== 'draft')
      .forEach(v => {
        // الف) رد صریح اسنادی که مربوط به نقش یا پرونده اعتباری هستند
        if (v.contractType === 'credit') return;

        // ب) رد اسناد مرجوعی که در گام قبل به صورت اختصاصی با sourceId کسر شده‌اند
        const isReturnVoucher = Boolean(
          (v.sourceType === 'sell_invoice' && v.sourceId && returnsByInvoiceId[v.sourceId]) ||
          v.description?.includes('برگشت') ||
          v.description?.includes('مرجوع')
        );

        if (!isReturnVoucher) {
          v.entries.forEach(e => {
            const isAgent = e.floatingDetailed?.id === targetAgentId || e.floatingDetailed?.id === targetPartnerPersonId;
            const isCredit = e.credit > 0;
            const isEntryCreditRole = e.contractType === 'credit';
            const isSalesAccount = isSalesDebtorsAccount(e.subsidiaryId);

            // فقط بستانکاری در سرفصل‌های دریافتنی فروش (بدهکاران تجاری) و خارج از نقش اعتباری پذیرفته می‌شود
            // بستانکاری‌های ناشی از کمیسیون (SUB_CREDITORS)، کیف پول اعتباری (SUB_PARTNER_WALLET) یا قراردادهای اعتباری رد می‌شوند
            if (isAgent && isCredit && !isEntryCreditRole && isSalesAccount) {
              paymentTxs.push({
                id: `${v.id}_${e.subsidiaryId}`,
                amount: e.credit,
                date: v.date
              });
            }
          });
        }
      });

    // ۲. استخراج از چک‌های وصول شده تایید شده که در اسناد حسابداری بالا نیستند (با رد چک‌های امانی، کارمزد سرمایه‌گذار یا اعتباری)
    const voucherSourceIds = new Set(
      input.vouchers
        .filter(v => v.status !== 'voided' && v.status !== 'draft')
        .map(v => v.sourceId)
        .filter(Boolean)
    );

    input.checks
      .filter(c => c.personId === targetAgentId || c.personId === targetPartnerPersonId)
      .filter(c => c.type === 'received' && c.currentState === 'cleared')
      .filter(c => !c.isAmani && !c.isInvestorCommission && !c.investorContractId)
      .forEach(c => {
        if (!voucherSourceIds.has(c.id)) {
          paymentTxs.push({
            id: c.id,
            amount: c.amount,
            date: c.dueDate || input.currentDate
          });
        }
      });

    // ۳. پشتیبانی از پرداخت‌های قطعی مستقیم فاکتور در سناریوهای تستی ساده فاقد دفتر کل
    if (paymentTxs.length === 0) {
      const invoicePaidSum = input.invoices
        .filter(inv => {
          const isAgent = inv.personId === targetAgentId || inv.personId === targetPartnerPersonId;
          const isActive = inv.status !== 'voided' && inv.status !== 'draft';
          return isAgent && isActive;
        })
        .reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);

      if (invoicePaidSum > 0) {
        paymentTxs.push({
          id: 'inv_paid_amount_sum',
          amount: invoicePaidSum,
          date: input.currentDate
        });
      }
    }

    // مرتب‌سازی پرداخت‌ها بر اساس تاریخ صعودی جهت پیاده‌سازی دقیق FIFO
    paymentTxs.sort((a, b) => compareJalali(a.date, b.date));

    // د) تخصیص مبالغ پرداخت به فاکتورها به صورت FIFO
    paymentTxs.forEach(tx => {
      let paymentAmount = tx.amount;
      for (const inv of balances) {
        if (inv.remainingAmount <= 0) continue;

        const allocatable = Math.min(paymentAmount, inv.remainingAmount);
        inv.paidAmount += allocatable;
        inv.remainingAmount -= allocatable;
        paymentAmount -= allocatable;

        if (paymentAmount <= 0) break;
      }
    });

    // ه) به‌روزرسانی فیلد وضعیت (Status) فاکتورها
    balances.forEach(inv => {
      const originalPayable = Math.max(0, inv.originalAmount - inv.returnedAmount);
      if (inv.remainingAmount <= 0) {
        inv.status = 'settled';
      } else if (inv.paidAmount > 0) {
        inv.status = 'partially_paid';
      } else {
        inv.status = 'open';
      }
    });

    return balances;
  }

  /**
   * ۲. محاسبه جریمه دیرکرد روزانه با رعایت مهلت پرداخت و روزهای تنفس
   */
  calculateLateFees(balances: InvoiceBalance[], policy: SalesAgentPolicy, currentDate: string): PendingLateFeeRecord[] {
    const pendingFees: PendingLateFeeRecord[] = [];
    if (!policy.isPenaltyEnabled) return [];

    balances.forEach(invoice => {
      // فقط فاکتورهای باز یا نیمه تسویه مشمول جریمه می‌شوند
      if (invoice.status === 'settled') return;

      const rawDelay = getJalaliDiffDays(currentDate, invoice.dueDate);
      const delayDays = rawDelay > 0 ? rawDelay : 0;

      // اگر دیرکرد از روزهای تنفس بیشتر باشد، جریمه دیرکرد برای هر روز محاسبه می‌شود
      if (delayDays > policy.gracePeriodDays) {
        const penaltyRate = invoice.penaltyRate ?? policy.lateFeeDailyPercentage;
        // برای هر روز تاخیر فراتر از مهلت تنفس، رکورد جریمه روزانه تولید می‌شود
        for (let dayOffset = 1; dayOffset <= delayDays; dayOffset++) {
          if (dayOffset > policy.gracePeriodDays) {
            const targetDate = addDaysToJalali(invoice.dueDate, dayOffset);
            // اطمینان حاصل می‌کنیم تاریخ مورد محاسبه دیرکرد فراتر از روز جاری بیزینسی شبیه‌سازی نباشد
            if (compareJalali(targetDate, currentDate) <= 0) {
              const calculatedPenaltyAmount = Math.round(invoice.remainingAmount * (penaltyRate / 100));
              if (calculatedPenaltyAmount > 0) {
                pendingFees.push({
                  id: `PEN_${invoice.invoiceId}_${targetDate}`,
                  agentId: policy.id.replace('POL_', ''),
                  invoiceId: invoice.invoiceId,
                  invoiceNumber: invoice.invoiceNumber,
                  targetDate,
                  outstandingAmount: invoice.remainingAmount,
                  penaltyRate,
                  calculatedPenaltyAmount,
                  isApproved: false
                });
              }
            }
          }
        }
      }
    });

    return pendingFees;
  }

  /**
   * ۳. ارزیابی سقف اعتبار و محاسبه اعتبار آزاد
   */
  evaluateCreditLimits(input: CreditControlEngineInput, balances: InvoiceBalance[]): AgentCreditSummary {
    const baseLimit = input.policy.creditLimit;
    const allowedOverLimit = input.policy.isOverLimitAllowed
      ? baseLimit * (1 + input.policy.allowedOverLimitPercentage / 100)
      : baseLimit;

    // اعتبار مصرف شده برابر است با مجموع بدهی‌های قطعی تسویه‌نشده فاکتورها
    const usedCredit = balances.reduce((sum, inv) => sum + inv.remainingAmount, 0);
    const freeCredit = Math.max(0, baseLimit - usedCredit);
    const isOverdrawn = usedCredit > allowedOverLimit;
    const overdraftAmount = isOverdrawn ? usedCredit - allowedOverLimit : 0;

    return {
      agentId: input.agent.id,
      baseCreditLimit: baseLimit,
      totalCreditLimit: allowedOverLimit,
      usedCredit,
      freeCredit,
      isOverdrawn,
      overdraftAmount
    };
  }

  /**
   * ۴. سیاست تولید پیش‌نویس اسناد حسابداری جریمه بر اساس روش‌های تجمیعی یا تفکیکی
   */
  generateDraftVouchers(pendingFees: PendingLateFeeRecord[], policy: SalesAgentPolicy): SuggestedVoucherDraft[] {
    const drafts: SuggestedVoucherDraft[] = [];
    if (pendingFees.length === 0) return [];

    const debitAccount = 'SUB_DEBTORS'; // بدهکاران تجاری (جاری نماینده)
    const creditAccount = 'SUB_OTHER_REVENUE'; // بستانکار: درآمد کارمزد دیرکرد

    if (policy.voucherDraftPolicy === VoucherDraftPolicy.DAILY_INDEPENDENT) {
      pendingFees.forEach(fee => {
        drafts.push({
          id: `DFT_${fee.id}`,
          date: fee.targetDate,
          description: `پیش‌نویس جریمه دیرکرد روزانه فاکتور ${fee.invoiceNumber} مورخ ${fee.targetDate}`,
          debitAccountId: debitAccount,
          creditAccountId: creditAccount,
          amount: fee.calculatedPenaltyAmount,
          associatedInvoiceId: fee.invoiceId
        });
      });
    } else if (policy.voucherDraftPolicy === VoucherDraftPolicy.PER_INVOICE_CUMULATIVE) {
      // تجمیع جریمه‌ها بر اساس هر فاکتور به صورت مستقل
      const byInvoice: Record<string, { fee: PendingLateFeeRecord; total: number; dates: string[] }> = {};
      pendingFees.forEach(fee => {
        if (!byInvoice[fee.invoiceId]) {
          byInvoice[fee.invoiceId] = { fee, total: 0, dates: [] };
        }
        byInvoice[fee.invoiceId].total += fee.calculatedPenaltyAmount;
        byInvoice[fee.invoiceId].dates.push(fee.targetDate);
      });

      Object.keys(byInvoice).forEach(invId => {
        const item = byInvoice[invId];
        drafts.push({
          id: `DFT_CUM_${invId}`,
          date: item.fee.targetDate,
          description: `پیش‌نویس جریمه دیرکرد تجمیعی فاکتور شماره ${item.fee.invoiceNumber} برای دیرکرد روزهای ${item.dates.slice(0, 5).join(', ')}${item.dates.length > 5 ? ' و ...' : ''}`,
          debitAccountId: debitAccount,
          creditAccountId: creditAccount,
          amount: item.total,
          associatedInvoiceId: invId
        });
      });
    } else if (policy.voucherDraftPolicy === VoucherDraftPolicy.MONTHLY_CONSOLIDATED) {
      // تجمیع جریمه‌های کل فاکتورهای نماینده به صورت ماهانه در قالب یک سند واحد پیشنهادی
      const byMonth: Record<string, { total: number; fees: PendingLateFeeRecord[] }> = {};
      pendingFees.forEach(fee => {
        const month = fee.targetDate.substring(0, 7); // "YYYY/MM"
        if (!byMonth[month]) {
          byMonth[month] = { total: 0, fees: [] };
        }
        byMonth[month].total += fee.calculatedPenaltyAmount;
        byMonth[month].fees.push(fee);
      });

      Object.keys(byMonth).forEach(month => {
        const item = byMonth[month];
        drafts.push({
          id: `DFT_MNT_${month.replace('/', '_')}`,
          date: `${month}/30`,
          description: `پیش‌نویس جریمه دیرکرد تجمیعی ماهانه ${month} نماینده`,
          debitAccountId: debitAccount,
          creditAccountId: creditAccount,
          amount: item.total
        });
      });
    }

    return drafts;
  }

  /**
   * ۵. تولید هشدارهای اعتباری و پیامک‌های اخطار در قالب رویدادهای حافظه‌ای بدون ایجاد اثر جانبی
   */
  dispatchWarnings(balances: InvoiceBalance[], summary: AgentCreditSummary, policy: SalesAgentPolicy): CreditControlEvent[] {
    const events: CreditControlEvent[] = [];

    // هشدار عبور از سقف اعتبار
    if (summary.isOverdrawn) {
      events.push({
        id: `EVT_CREDIT_EXCEEDED_${summary.agentId}`,
        agentId: summary.agentId,
        eventType: 'CREDIT_EXCEEDED',
        severity: 'critical',
        message: `اعتبار مصرف شده (${summary.usedCredit.toLocaleString()} ریال) از سقف مجاز کل عبور کرده است!`,
        timestamp: new Date().toISOString(),
        smsSent: false
      });
    }

    // هشدار دیرکرد فاکتورها
    balances.forEach(inv => {
      if (inv.remainingAmount > 0 && inv.delayDays > 0) {
        if (inv.delayDays > policy.gracePeriodDays * 2) {
          events.push({
            id: `EVT_CRITICAL_OVERDUE_${inv.invoiceId}`,
            agentId: summary.agentId,
            eventType: 'CRITICAL_OVERDUE',
            severity: 'critical',
            message: `فاکتور شماره ${inv.invoiceNumber} بیش از ${inv.delayDays} روز دیرکرد شدید دارد و شامل جریمه فعال است.`,
            timestamp: new Date().toISOString(),
            smsSent: false
          });
        } else {
          events.push({
            id: `EVT_OVERDUE_WARNING_${inv.invoiceId}`,
            agentId: summary.agentId,
            eventType: 'OVERDUE_WARNING',
            severity: 'warning',
            message: `فاکتور شماره ${inv.invoiceNumber} دارای ${inv.delayDays} روز دیرکرد است.`,
            timestamp: new Date().toISOString(),
            smsSent: false
          });
        }
      }
    });

    return events;
  }
}

/**
 * موتور کنترل حساب نماینده فروش (Sales Agent Credit Control Engine)
 * یک موتور محاسباتی ۱۰۰٪ مستقل و فاقد اثر جانبی (Side-Effect Free)
 */
export class SalesAgentCreditControlEngine {
  private static strategy: ICreditControlStrategy = new DefaultCreditControlStrategy();

  /**
   * امکان تزریق استراتژی سفارشی به موتور (Extension Point)
   */
  public static registerStrategy(customStrategy: ICreditControlStrategy): void {
    SalesAgentCreditControlEngine.strategy = customStrategy;
  }

  /**
   * متد اصلی پردازش موتور کنترل حساب
   * @param input ورودی‌های سیستم شامل شخص، نماینده، فاکتورها، پرداخت‌ها و سیاست‌ها
   * @returns خروجی‌های موتور شامل مانده واقعی، خلاصه اعتبار، جریمه‌ها، پیش‌نویس اسناد و رویدادها
   */
  public static process(input: CreditControlEngineInput): CreditControlEngineOutput {
    const { policy } = input;

    // ثبت گزارش عملکرد موتور در کنسول به منظور خطایابی سریع
    console.log(`[SalesAgentCreditControlEngine] Processing account for Agent: ${input.agent.name || input.agent.id}`);
    console.log(`[SalesAgentCreditControlEngine] Applied Policy: ${policy.name} (ID: ${policy.id})`);

    // اجرای فازهای پردازشی بر اساس استراتژی منتخب
    const invoiceBalances = this.strategy.allocatePayments(input);
    const pendingLateFees = this.strategy.calculateLateFees(invoiceBalances, policy, input.currentDate);
    const creditSummary = this.strategy.evaluateCreditLimits(input, invoiceBalances);
    const draftVouchers = this.strategy.generateDraftVouchers(pendingLateFees, policy);
    const emittedEvents = this.strategy.dispatchWarnings(invoiceBalances, creditSummary, policy);

    return {
      invoiceBalances,
      creditSummary,
      pendingLateFees,
      draftVouchers,
      emittedEvents
    };
  }

  /**
   * اجرای چرخه روزانه موتور کنترل حساب نمایندگان فروش (Phase 4)
   * این متد کاملاً Idempotent (همان‌توان) بوده و پیش‌نویس جریمه‌های روزانه را تولید می‌کند.
   */
  public static runDailyCycle(
    state: AppState,
    currentDate: string,
    existingDrafts: CreditControlDraft[] = []
  ): CreditControlDraft[] {
    const newDrafts: CreditControlDraft[] = [];

    // ۱. شناسایی نمایندگان واجد شرایط
    const agentPersons = (state.persons || []).filter(p => p.isAgent);
    const partnerPersons = (state.businessPartners || [])
      .map(bp => (state.persons || []).find(p => p.id === bp.personId))
      .filter((p): p is Person => !!p);

    const uniqueAgentsMap = new Map<string, Person>();
    [...agentPersons, ...partnerPersons].forEach(p => {
      uniqueAgentsMap.set(p.id, p);
    });

    const agents = Array.from(uniqueAgentsMap.values());

    // ۲. پردازش برای تک‌تک نمایندگان
    agents.forEach(agent => {
      const rules = resolvePartnerCreditRules(agent, state.businessPartners);
      const partner = (state.businessPartners || []).find(bp => bp.personId === agent.id || bp.id === agent.id) || ({
        id: `BP_${agent.id}`,
        personId: agent.id,
        status: 'active',
        agencyType: 'INSTALLMENT_ONLY' as any,
        roles: [],
        profile: {
          partnerId: `BP_${agent.id}`,
          contractStatus: 'active',
          creditLimit: rules.maxCreditLimit
        },
        creditExtension: {
          creditRules: {
            maxCreditLimit: rules.maxCreditLimit,
            defaultInstallmentDays: rules.defaultInstallmentDays,
            penaltyRatePerMonth: rules.penaltyRatePerMonth
          }
        },
        branches: [],
        createdAt: new Date().toISOString(),
        createdBy: 'system'
      } as BusinessPartner);

      const policy = SalesAgentCreditControlEngine.createDefaultPolicy(agent.id, rules.maxCreditLimit);
      policy.paymentTermDays = rules.defaultInstallmentDays;
      policy.lateFeeDailyPercentage = rules.penaltyRatePerMonth;
      policy.gracePeriodDays = (rules as any).gracePeriodDays ?? 0;

      // فقط در صورتی فاکتورها بررسی شوند که جریمه دیرکرد در سیاست نماینده فعال باشد
      if (!policy.isPenaltyEnabled) return;

      const input: CreditControlEngineInput = {
        agent,
        partner,
        policy,
        invoices: state.invoices || [],
        vouchers: state.vouchers || [],
        checks: state.checks || [],
        currentDate
      };

      // تخصیص پرداخت‌ها به صورت FIFO جهت بدست آوردن مانده واقعی هر فاکتور
      const balances = this.strategy.allocatePayments(input);

      balances.forEach(balance => {
        // الف) فقط فاکتورهای باز یا نیمه تسویه با مانده واقعی مثبت بررسی می‌شوند
        if (balance.status === 'settled' || balance.remainingAmount <= 0) return;

        // ب) فاکتور باید قطعی باشد (که قبلاً در allocatePayments فیلتر شده است)
        
        // ج) بررسی عبور از مهلت تنفس در تاریخ کاری جاری
        const rawDelay = getJalaliDiffDays(currentDate, balance.dueDate);
        const delayDays = rawDelay > 0 ? rawDelay : 0;

        if (delayDays > policy.gracePeriodDays) {
          const penaltyRate = balance.penaltyRate ?? policy.lateFeeDailyPercentage;
          // محاسبه جریمه دیرکرد روزانه بر اساس مانده واقعی همان روز
          const calculatedPenaltyAmount = Math.round(balance.remainingAmount * (penaltyRate / 100));

          if (calculatedPenaltyAmount > 0) {
            // د) کنترل هم‌توانی (Idempotency): آیا قبلاً برای این فاکتور و این تاریخ کاری پیش‌نویسی ثبت شده است؟
            const alreadyExists = existingDrafts.some(
              d => d.invoiceId === balance.invoiceId && d.calculationDate === currentDate
            ) || newDrafts.some(
              d => d.invoiceId === balance.invoiceId && d.calculationDate === currentDate
            );

            if (!alreadyExists) {
              newDrafts.push({
                id: `DFT_CC_${agent.id}_${balance.invoiceId}_${currentDate.replace(/\//g, '_')}`,
                agentId: agent.id,
                invoiceId: balance.invoiceId,
                invoiceNumber: balance.invoiceNumber,
                calculationDate: currentDate,
                baseRemainingAmount: balance.remainingAmount,
                penaltyPercentage: penaltyRate,
                penaltyAmount: calculatedPenaltyAmount,
                status: 'pending',
                createdAt: new Date().toISOString()
              });
            }
          }
        }
      });
    });

    return newDrafts;
  }

  /**
   * تولید یک نمونه پیش‌فرض Policy برای تست و راه‌اندازی سریع بدون Hardcode
   */
  public static createDefaultPolicy(agentId: string, customLimit?: number): SalesAgentPolicy {
    return {
      id: `POL_${agentId}`,
      name: `سیاست اعتباری پیش‌فرض نماینده ${agentId}`,
      agentType: 'sales_agent',
      creditLimit: customLimit ?? 150000000,
      isOverLimitAllowed: false,
      allowedOverLimitPercentage: 0,
      isPenaltyEnabled: true,
      lateFeeDailyPercentage: 0.1,
      paymentTermDays: 30,
      gracePeriodDays: 5,
      engineExecutionHour: '23:00',
      isSmsEnabled: true,
      isFinanceApprovalRequired: true,
      warningSmsTemplate: 'نماینده گرامی، فاکتور شماره {invoiceNumber} به سررسید خود نزدیک شده است. مابقی مانده: {remainingAmount} ریال',
      overdueSmsTemplate: 'هشدار جدی: فاکتور شماره {invoiceNumber} وارد دیرکرد شده و مشمول جریمه روزانه است. لطفا جهت تسویه اقدام نمایید.',
      paymentAllocationPolicy: PaymentAllocationPolicy.FIFO,
      salesReturnHandlingPolicy: SalesReturnHandlingPolicy.REDUCE_ORIGINAL_INVOICE,
      creditCalculationPolicy: CreditCalculationPolicy.STRICT,
      voucherDraftPolicy: VoucherDraftPolicy.DAILY_INDEPENDENT,
      warningDeliveryPolicy: WarningDeliveryPolicy.SMS_AND_DASHBOARD,
      customParameters: {}
    };
  }
}
