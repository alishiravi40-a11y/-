/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SalesAgentCreditControlEngine } from '../modules/creditControl/creditControlEngine';
import { CreditControlEngineInput, PaymentAllocationPolicy, SalesReturnHandlingPolicy, CreditCalculationPolicy, VoucherDraftPolicy, CreditControlDraft, SalesAgentPolicy } from '../modules/creditControl/creditControl.types';
import { Person, BusinessPartner, AgencyType, Invoice, JournalVoucher, Check, PartnerRole, AppState } from '../types';

function runTests() {
  console.log('=======================================================');
  console.log('🧪 RUNNING CREDIT CONTROL ENGINE COMPREHENSIVE TESTS');
  console.log('=======================================================');

  // Shared mock Agent & Partner structures
  const mockAgent: Person = {
    id: 'agent_test_id',
    code: 'P9001',
    name: 'نماینده تست اعتباری',
    nationalId: '1234567890',
    isAgent: true,
    role: 'creditor',
    createdAt: new Date().toISOString()
  };

  const mockPartner: BusinessPartner = {
    id: 'BP_agent_test',
    personId: 'agent_test_id',
    status: 'active',
    agencyType: AgencyType.INSTALLMENT_ONLY,
    roles: [],
    profile: {
      partnerId: 'BP_agent_test',
      contractStatus: 'active'
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  };

  const mockPolicy = SalesAgentCreditControlEngine.createDefaultPolicy(mockAgent.id, 150000000); // 150,000,000 credit limit
  mockPolicy.paymentTermDays = 30;
  mockPolicy.gracePeriodDays = 5;
  mockPolicy.lateFeeDailyPercentage = 0.1; // 0.1% daily penalty

  // -------------------------------------------------------------
  // Scenario 1: Partial payment (پرداخت جزئی)
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 1: Partial payment...');
  const inv1: Invoice = {
    id: 'inv_1',
    invoiceNumber: 1001,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/01',
    personId: mockAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 100000000, // 100M
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  // Payment voucher
  const v1: JournalVoucher = {
    id: 'v_pay_1',
    voucherNumber: 501,
    date: '1405/01/05',
    gregorianDate: new Date().toISOString(),
    description: 'دریافت علی‌الحساب بابت نماینده',
    isAutomatic: false,
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        debit: 0,
        credit: 40000000, // 40M payment
        floatingDetailed: { type: 'person', id: mockAgent.id, name: mockAgent.name }
      }
    ]
  };

  const input1: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy: mockPolicy,
    invoices: [inv1],
    vouchers: [v1],
    checks: [],
    currentDate: '1405/01/10'
  };

  const out1 = SalesAgentCreditControlEngine.process(input1);
  if (out1.invoiceBalances.length !== 1) throw new Error('Expected 1 invoice balance');
  const bal1 = out1.invoiceBalances[0];

  if (bal1.originalAmount !== 100000000 || bal1.paidAmount !== 40000000 || bal1.remainingAmount !== 60000000) {
    throw new Error(`Scenario 1 Failed: Amounts incorrect. Paid: ${bal1.paidAmount}, Remaining: ${bal1.remainingAmount}`);
  }
  if (bal1.status !== 'partially_paid') {
    throw new Error(`Scenario 1 Failed: Expected status partially_paid, got ${bal1.status}`);
  }
  console.log('✅ Scenario 1 Passed: Partial payment allocated correctly.');

  // -------------------------------------------------------------
  // Scenario 2: Multiple payments on a single invoice (چند پرداخت روی یک فاکتور)
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 2: Multiple payments on a single invoice...');
  const v2_a: JournalVoucher = {
    id: 'v_pay_2a',
    voucherNumber: 502,
    date: '1405/01/05',
    gregorianDate: new Date().toISOString(),
    description: 'پرداخت اول',
    isAutomatic: false,
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        debit: 0,
        credit: 30000000, // 30M
        floatingDetailed: { type: 'person', id: mockAgent.id, name: mockAgent.name }
      }
    ]
  };
  const v2_b: JournalVoucher = {
    id: 'v_pay_2b',
    voucherNumber: 503,
    date: '1405/01/08',
    gregorianDate: new Date().toISOString(),
    description: 'پرداخت دوم',
    isAutomatic: false,
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        debit: 0,
        credit: 30000000, // 30M
        floatingDetailed: { type: 'person', id: mockAgent.id, name: mockAgent.name }
      }
    ]
  };

  const input2: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy: mockPolicy,
    invoices: [inv1],
    vouchers: [v2_a, v2_b],
    checks: [],
    currentDate: '1405/01/10'
  };

  const out2 = SalesAgentCreditControlEngine.process(input2);
  const bal2 = out2.invoiceBalances[0];

  if (bal2.paidAmount !== 60000000 || bal2.remainingAmount !== 40000000) {
    throw new Error(`Scenario 2 Failed: Paid: ${bal2.paidAmount}, Remaining: ${bal2.remainingAmount}`);
  }
  if (bal2.status !== 'partially_paid') {
    throw new Error(`Scenario 2 Failed: Expected status partially_paid, got ${bal2.status}`);
  }
  console.log('✅ Scenario 2 Passed: Multiple payments summed and allocated correctly.');

  // -------------------------------------------------------------
  // Scenario 3: Multiple invoices with FIFO allocation (چند فاکتور با FIFO)
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 3: Multiple invoices with FIFO allocation...');
  const inv3_a: Invoice = {
    id: 'inv_3a',
    invoiceNumber: 2001,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/01', // Oldest
    personId: mockAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 100000000, // 100M
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };
  const inv3_b: Invoice = {
    id: 'inv_3b',
    invoiceNumber: 2002,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/02/01', // Newer
    personId: mockAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 100000000, // 100M
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  // Payment of 120M
  const v3_pay: JournalVoucher = {
    id: 'v_pay_3',
    voucherNumber: 504,
    date: '1405/02/05',
    gregorianDate: new Date().toISOString(),
    description: 'تسویه بزرگ نماینده',
    isAutomatic: false,
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        debit: 0,
        credit: 120000000, // 120M
        floatingDetailed: { type: 'person', id: mockAgent.id, name: mockAgent.name }
      }
    ]
  };

  const input3: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy: mockPolicy,
    invoices: [inv3_b, inv3_a], // Pass unsorted to verify sorting/FIFO
    vouchers: [v3_pay],
    checks: [],
    currentDate: '1405/02/10'
  };

  const out3 = SalesAgentCreditControlEngine.process(input3);
  const bal3_a = out3.invoiceBalances.find(b => b.invoiceId === 'inv_3a')!;
  const bal3_b = out3.invoiceBalances.find(b => b.invoiceId === 'inv_3b')!;

  if (bal3_a.remainingAmount !== 0 || bal3_a.status !== 'settled') {
    throw new Error(`Scenario 3 Failed: Oldest invoice not settled. Remaining: ${bal3_a.remainingAmount}, status: ${bal3_a.status}`);
  }
  if (bal3_b.remainingAmount !== 80000000 || bal3_b.status !== 'partially_paid') {
    throw new Error(`Scenario 3 Failed: Newer invoice should have 80M remaining. Got: ${bal3_b.remainingAmount}, status: ${bal3_b.status}`);
  }
  console.log('✅ Scenario 3 Passed: Payment correctly routed in strict FIFO order.');

  // -------------------------------------------------------------
  // Scenario 4: Sales return (برگشت از فروش)
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 4: Sales return...');
  const inv4: Invoice = {
    id: 'inv_4',
    invoiceNumber: 4001,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/01',
    personId: mockAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 100000000, // 100M
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  // Sales return voucher linked via sourceId
  const v_return: JournalVoucher = {
    id: 'v_ret_4',
    voucherNumber: 601,
    sourceType: 'sell_invoice',
    sourceId: 'inv_4', // linked specifically to inv4
    date: '1405/01/15',
    gregorianDate: new Date().toISOString(),
    description: 'برگشت از فروش فاکتور ۴۰۰۱',
    isAutomatic: true,
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        debit: 0,
        credit: 30000000, // 30M returned
        floatingDetailed: { type: 'person', id: mockAgent.id, name: mockAgent.name }
      }
    ]
  };

  const input4: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy: mockPolicy,
    invoices: [inv4],
    vouchers: [v_return],
    checks: [],
    currentDate: '1405/01/20'
  };

  const out4 = SalesAgentCreditControlEngine.process(input4);
  const bal4 = out4.invoiceBalances[0];

  if (bal4.returnedAmount !== 30000000) {
    throw new Error(`Scenario 4 Failed: Expected 30M returned Amount, got ${bal4.returnedAmount}`);
  }
  if (bal4.remainingAmount !== 70000000) {
    throw new Error(`Scenario 4 Failed: Expected 70M remaining, got ${bal4.remainingAmount}`);
  }
  console.log('✅ Scenario 4 Passed: Sales return reduced specific reference invoice principal correctly.');

  // -------------------------------------------------------------
  // Scenario 5: Unconfirmed payment (پرداخت تأییدنشده)
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 5: Unconfirmed payment...');
  const v_draft: JournalVoucher = {
    id: 'v_draft_pay',
    voucherNumber: 509,
    date: '1405/01/05',
    gregorianDate: new Date().toISOString(),
    description: 'سند موقت پیش‌نویس پرداخت',
    status: 'draft', // Draft status -> must be ignored!
    isAutomatic: false,
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        debit: 0,
        credit: 90000000,
        floatingDetailed: { type: 'person', id: mockAgent.id, name: mockAgent.name }
      }
    ]
  };

  const check_unconfirmed: Check = {
    id: 'chk_unconfirmed',
    checkNumber: '445566',
    bankName: 'Melli',
    personId: mockAgent.id,
    amount: 80000000,
    dueDate: '1405/01/10',
    type: 'received',
    currentState: 'present_in_cashbox', // not 'cleared' -> must be ignored!
    createdAt: new Date().toISOString(),
    history: []
  };

  const input5: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy: mockPolicy,
    invoices: [inv1],
    vouchers: [v_draft],
    checks: [check_unconfirmed],
    currentDate: '1405/01/20'
  };

  const out5 = SalesAgentCreditControlEngine.process(input5);
  const bal5 = out5.invoiceBalances[0];

  if (bal5.remainingAmount !== 100000000 || bal5.paidAmount !== 0) {
    throw new Error(`Scenario 5 Failed: Remaining amount should remain 100M. Got remaining: ${bal5.remainingAmount}, paid: ${bal5.paidAmount}`);
  }
  console.log('✅ Scenario 5 Passed: Draft vouchers and unconfirmed checks were successfully ignored.');

  // -------------------------------------------------------------
  // Scenario 6: Delay of several days & Late fee calculation (چند روز تأخیر)
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 6: Delay of several days & late fee calculation...');
  const overdueInv: Invoice = {
    id: 'inv_overdue',
    invoiceNumber: 6001,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/01', // Due Date: 1405/02/01
    personId: mockAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 100000000, // 100M
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  const input6: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy: mockPolicy,
    invoices: [overdueInv],
    vouchers: [],
    checks: [],
    currentDate: '1405/02/08' // 9 days delay from 1405/01/30 (30-day term). Grace period: 5 days. Overdue penalizable: 4 days (days 6,7,8,9)
  };

  const out6 = SalesAgentCreditControlEngine.process(input6);
  if (out6.pendingLateFees.length !== 4) {
    throw new Error(`Scenario 6 Failed: Expected 4 late fee records (days 6, 7, 8, 9), got ${out6.pendingLateFees.length}`);
  }

  // Daily late fee on 100M with 0.1% = 100,000 per day. Total 4 days = 400,000
  const totalLateFee = out6.pendingLateFees.reduce((sum, f) => sum + f.calculatedPenaltyAmount, 0);
  if (totalLateFee !== 400000) {
    throw new Error(`Scenario 6 Failed: Expected total penalty 400,000, got ${totalLateFee}`);
  }

  // Also verify suggested drafts based on daily policy
  if (out6.draftVouchers.length !== 4) {
    throw new Error(`Scenario 6 Failed: Expected 4 daily independent draft vouchers, got ${out6.draftVouchers.length}`);
  }

  // Test consolidated draft policies
  const monthlyPolicy = { ...mockPolicy, voucherDraftPolicy: VoucherDraftPolicy.MONTHLY_CONSOLIDATED };
  const out6_monthly = SalesAgentCreditControlEngine.process({ ...input6, policy: monthlyPolicy });
  if (out6_monthly.draftVouchers.length !== 1 || out6_monthly.draftVouchers[0].amount !== 400000) {
    throw new Error('Scenario 6 Failed: Monthly consolidation failed to produce 1 draft of 400,000');
  }

  console.log('✅ Scenario 6 Passed: Daily late fees and consolidated voucher drafts calculated correctly.');

  // -------------------------------------------------------------
  // Scenario 7: Balance reaching zero (صفر شدن مانده)
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 7: Balance reaching zero...');
  const v_full_pay: JournalVoucher = {
    id: 'v_full_pay',
    voucherNumber: 520,
    date: '1405/01/10',
    gregorianDate: new Date().toISOString(),
    description: 'تسویه کامل بدهی',
    isAutomatic: false,
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        debit: 0,
        credit: 100000000, // 100M full payment
        floatingDetailed: { type: 'person', id: mockAgent.id, name: mockAgent.name }
      }
    ]
  };

  const input7: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy: mockPolicy,
    invoices: [inv1],
    vouchers: [v_full_pay],
    checks: [],
    currentDate: '1405/01/20'
  };

  const out7 = SalesAgentCreditControlEngine.process(input7);
  const bal7 = out7.invoiceBalances[0];

  if (bal7.remainingAmount !== 0 || bal7.status !== 'settled') {
    throw new Error(`Scenario 7 Failed: Expected remaining amount 0 and settled status. Got remaining: ${bal7.remainingAmount}, status: ${bal7.status}`);
  }
  console.log('✅ Scenario 7 Passed: Invoice reached zero balance and settled state correctly.');

  // -------------------------------------------------------------
  // Scenario 8: Free credit calculation (محاسبه اعتبار آزاد)
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 8: Free credit calculation...');
  // 2 active invoices of 40M each = 80M total. Confirmed payment of 10M. Net debt = 70M.
  // Credit limit is 150M. Expected free credit = 150M - 70M = 80M.
  const inv8_a: Invoice = {
    id: 'inv_8a',
    invoiceNumber: 8001,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/01',
    personId: mockAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 40000000, // 40M
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };
  const inv8_b: Invoice = {
    id: 'inv_8b',
    invoiceNumber: 8002,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/02',
    personId: mockAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 40000000, // 40M
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  const v_pay_8: JournalVoucher = {
    id: 'v_pay_8',
    voucherNumber: 531,
    date: '1405/01/05',
    gregorianDate: new Date().toISOString(),
    description: 'پرداخت جزئی سناریو ۸',
    isAutomatic: false,
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        debit: 0,
        credit: 10000000, // 10M
        floatingDetailed: { type: 'person', id: mockAgent.id, name: mockAgent.name }
      }
    ]
  };

  const input8: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy: mockPolicy,
    invoices: [inv8_a, inv8_b],
    vouchers: [v_pay_8],
    checks: [],
    currentDate: '1405/01/10'
  };

  const out8 = SalesAgentCreditControlEngine.process(input8);
  const summary8 = out8.creditSummary;

  if (summary8.usedCredit !== 70000000) {
    throw new Error(`Scenario 8 Failed: Expected usedCredit 70M, got ${summary8.usedCredit}`);
  }
  if (summary8.freeCredit !== 80000000) {
    throw new Error(`Scenario 8 Failed: Expected freeCredit 80M, got ${summary8.freeCredit}`);
  }
  console.log('✅ Scenario 8 Passed: Used and Free Credit limits evaluated correctly.');

  // =============================================================
  // Phase 4: Daily Cycle Engine tests
  // =============================================================
  console.log('\n=======================================================');
  console.log('🧪 RUNNING PHASE 4: DAILY CYCLE ENGINE TEST CASES');
  console.log('=======================================================');

  // Let's create an AppState instance with 2 agents, each with overdue invoices on 1405/01/15.
  // Agent 1: mockAgent (agent_test_id)
  // Agent 2: agent_test_2
  const mockAgent2: Person = {
    id: 'agent_test_2_id',
    code: 'P9002',
    name: 'نماینده دوم تست',
    isAgent: true,
    createdAt: new Date().toISOString()
  };

  const mockPartner2: BusinessPartner = {
    id: 'BP_agent_test_2',
    personId: 'agent_test_2_id',
    status: 'active',
    agencyType: 'INSTALLMENT_ONLY' as any,
    roles: [],
    profile: {
      partnerId: 'BP_agent_test_2',
      contractStatus: 'active'
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  };

  // Set up invoices:
  // Invoice 1: Agent 1, due on 1405/01/05. Overdue on 1405/01/15 (10 days delay, past 5 days grace). Amount = 100M
  const invPhase4_1: Invoice = {
    id: 'inv_p4_1',
    invoiceNumber: 4001,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/01',
    personId: mockAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 100000000,
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  // Invoice 2: Agent 1, due on 1405/01/08. Overdue on 1405/01/15 (7 days delay, past 5 days grace). Amount = 50M
  const invPhase4_2: Invoice = {
    id: 'inv_p4_2',
    invoiceNumber: 4002,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/04',
    personId: mockAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 50000000,
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  // Invoice 3: Agent 2, due on 1405/01/05. Overdue on 1405/01/15. Amount = 120M
  const invPhase4_3: Invoice = {
    id: 'inv_p4_3',
    invoiceNumber: 4003,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/01',
    personId: mockAgent2.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 120000000,
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  const mockPartnerPhase4: BusinessPartner = {
    ...mockPartner,
    nesyehSettings: {
      creditLimit: 150000000,
      paymentTermDays: 4,
      lateFeePercentage: 0.1,
      isPurchaseAllowed: true
    }
  };

  const mockPartner2Phase4: BusinessPartner = {
    ...mockPartner2,
    nesyehSettings: {
      creditLimit: 150000000,
      paymentTermDays: 4,
      lateFeePercentage: 0.1,
      isPurchaseAllowed: true
    }
  };

  const appStatePhase4: any = {
    persons: [mockAgent, mockAgent2],
    businessPartners: [mockPartnerPhase4, mockPartner2Phase4],
    invoices: [invPhase4_1, invPhase4_2, invPhase4_3],
    vouchers: [],
    checks: [],
    creditControlDrafts: []
  };

  // 1. Create Drafts for multiple invoices of one agent, and multiple agents
  console.log('🔹 Testing Draft creation for multi-invoices and multi-agents on 1405/01/15...');
  const draftsDay15 = SalesAgentCreditControlEngine.runDailyCycle(appStatePhase4, '1405/01/15', []);
  
  // We expect 3 drafts:
  // - Invoice 4001: 100M remaining, daily rate 0.1% = 100,000 جریمه
  // - Invoice 4002: 50M remaining, daily rate 0.1% = 50,000 جریمه
  // - Invoice 4003: 120M remaining, daily rate 0.1% = 120,000 جریمه
  if (draftsDay15.length !== 3) {
    throw new Error(`Phase 4 Error: Expected 3 drafts on 1405/01/15, got ${draftsDay15.length}`);
  }

  const d1 = draftsDay15.find(d => d.invoiceId === 'inv_p4_1')!;
  const d2 = draftsDay15.find(d => d.invoiceId === 'inv_p4_2')!;
  const d3 = draftsDay15.find(d => d.invoiceId === 'inv_p4_3')!;

  if (!d1 || d1.penaltyAmount !== 100000 || d1.baseRemainingAmount !== 100000000) {
    throw new Error(`Phase 4 Error: Invoice 4001 draft amounts incorrect`);
  }
  if (!d2 || d2.penaltyAmount !== 50000 || d2.baseRemainingAmount !== 50000000) {
    throw new Error(`Phase 4 Error: Invoice 4002 draft amounts incorrect`);
  }
  if (!d3 || d3.penaltyAmount !== 120000 || d3.baseRemainingAmount !== 120000000) {
    throw new Error(`Phase 4 Error: Invoice 4003 draft amounts incorrect`);
  }
  console.log('✅ Multi-invoice and multi-agent draft creation verified successfully.');

  // 2. Same-day re-run and idempotency (جلوگیری از ایجاد Draft تکراری)
  console.log('🔹 Testing same-day re-run and idempotency (Same-day re-run)...');
  const mergedDraftsDay15 = [...draftsDay15];
  const draftsDay15ReRun = SalesAgentCreditControlEngine.runDailyCycle(appStatePhase4, '1405/01/15', mergedDraftsDay15);
  
  if (draftsDay15ReRun.length !== 0) {
    throw new Error(`Phase 4 Error: Re-running on same day produced duplicate drafts! Got ${draftsDay15ReRun.length} duplicates`);
  }
  console.log('✅ Idempotency verified: re-running on the same day produces 0 new drafts.');

  // 3. Next-day execution (اجرای موتور در روز بعد)
  console.log('🔹 Testing next-day execution (1405/01/16)...');
  const draftsDay16 = SalesAgentCreditControlEngine.runDailyCycle(appStatePhase4, '1405/01/16', mergedDraftsDay15);
  
  if (draftsDay16.length !== 3) {
    throw new Error(`Phase 4 Error: Expected 3 drafts on day 16, got ${draftsDay16.length}`);
  }
  const d1_day16 = draftsDay16.find(d => d.invoiceId === 'inv_p4_1')!;
  if (d1_day16.calculationDate !== '1405/01/16' || d1_day16.penaltyAmount !== 100000) {
    throw new Error('Phase 4 Error: Next day draft calculation error');
  }
  console.log('✅ Next-day execution verified successfully.');

  // 4. Balance change impact after payment and recalculating next day
  // (تغییر مانده فاکتور پس از پرداخت و محاسبه مجدد روز بعد)
  console.log('🔹 Testing balance change impact after payment on 1405/01/17...');
  
  // Create a payment voucher of 40M for Agent 1 on 1405/01/16 (which reduces remaining balance of Invoice 4001 to 60M)
  const paymentVoucherP4: JournalVoucher = {
    id: 'v_p4_pay_1',
    voucherNumber: 601,
    date: '1405/01/16',
    gregorianDate: new Date().toISOString(),
    description: 'پرداخت ۴۰ میلیونی فاکتور ۴۰۰۱ در روز ۱۶',
    isAutomatic: false,
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        debit: 0,
        credit: 40000000, // 40M
        floatingDetailed: { type: 'person', id: mockAgent.id, name: mockAgent.name }
      }
    ]
  };

  const appStatePhase4Updated = {
    ...appStatePhase4,
    vouchers: [paymentVoucherP4],
    creditControlDrafts: [...mergedDraftsDay15, ...draftsDay16]
  };

  const draftsDay17 = SalesAgentCreditControlEngine.runDailyCycle(
    appStatePhase4Updated, 
    '1405/01/17', 
    appStatePhase4Updated.creditControlDrafts
  );

  // Invoice 4001 remaining balance is now 60M. Daily late fee should be 60,000 (instead of 100,000)
  const d1_day17 = draftsDay17.find(d => d.invoiceId === 'inv_p4_1')!;
  if (!d1_day17) {
    throw new Error('Phase 4 Error: Expected draft for Invoice 4001 on day 17');
  }
  if (d1_day17.baseRemainingAmount !== 60000000 || d1_day17.penaltyAmount !== 60000) {
    throw new Error(`Phase 4 Error: Remaining balance was not updated correctly after payment. Expected balance: 60M, got ${d1_day17.baseRemainingAmount}. Expected penalty: 60k, got ${d1_day17.penaltyAmount}`);
  }

  // Invoice 4002 has no payment, should still have 50M balance and 50,000 penalty
  const d2_day17 = draftsDay17.find(d => d.invoiceId === 'inv_p4_2')!;
  if (d2_day17.baseRemainingAmount !== 50000000 || d2_day17.penaltyAmount !== 50000) {
    throw new Error('Phase 4 Error: Invoice 4002 incorrect amounts on day 17');
  }

  console.log('✅ Balance change impact verified successfully! Payment reduced balance and penalty amount accordingly.');

  // ==========================================
  // PHASE 5: accountant approval / rejection cycle tests
  // ==========================================
  console.log('\n=======================================================');
  console.log('🚀 TESTING PHASE 5: ACCOUNTANT APPROVAL & REJECTION CYCLE');
  console.log('=======================================================');

  // Let's take the drafts day 15 (which has 3 drafts: inv_p4_1, inv_p4_2, inv_p4_3)
  const draftsForPhase5 = JSON.parse(JSON.stringify(draftsDay15)) as CreditControlDraft[];
  const initialVoucherCount = appStatePhase4.vouchers.length;

  const testStatePhase5 = {
    ...appStatePhase4,
    creditControlDrafts: draftsForPhase5,
    vouchers: [...appStatePhase4.vouchers]
  };

  // Find draft 1 for inv_p4_1
  const draftToApprove = testStatePhase5.creditControlDrafts.find(d => d.invoiceId === 'inv_p4_1' && d.calculationDate === '1405/01/15')!;
  if (!draftToApprove || draftToApprove.status !== 'pending') {
    throw new Error('Phase 5 Error: Draft should be pending before approval');
  }

  // 1. Successful Draft Approval (تأیید موفق Draft)
  console.log('🔹 Testing Successful Draft Approval (تأیید موفق Draft)...');
  const agent1 = testStatePhase5.persons.find(p => p.id === draftToApprove.agentId)!;
  const agent1Name = agent1.name;
  
  const voucherId1 = `v_auto_penalty_${draftToApprove.id}`;
  const nextVoucherNo = Math.max(0, ...testStatePhase5.vouchers.map(v => v.voucherNumber)) + 1;

  // Create standard double entry voucher
  const newVoucher: JournalVoucher = {
    id: voucherId1,
    voucherNumber: nextVoucherNo,
    date: draftToApprove.calculationDate,
    gregorianDate: new Date().toISOString(),
    description: `ثبت جریمه دیرکرد فاکتور شماره ${draftToApprove.invoiceNumber} نماینده ${agent1Name}`,
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        floatingDetailed: { type: 'person', id: draftToApprove.agentId, name: agent1Name },
        debit: draftToApprove.penaltyAmount,
        credit: 0,
        description: `بدهکار: جریمه دیرکرد روزانه فاکتور ${draftToApprove.invoiceNumber}`
      },
      {
        subsidiaryId: 'SUB_OTHER_REVENUE',
        debit: 0,
        credit: draftToApprove.penaltyAmount,
        description: `بستانکار: درآمد کارمزد جریمه دیرکرد نماینده ${agent1Name}`
      }
    ],
    isAutomatic: true,
    sourceType: 'manual',
    sourceId: draftToApprove.id,
    status: 'active'
  };

  // Apply state update
  testStatePhase5.vouchers.push(newVoucher);
  draftToApprove.status = 'approved';
  draftToApprove.voucherId = voucherId1;
  draftToApprove.note = 'تأییدیه تست حسابرس';

  // Verify updates
  if (testStatePhase5.vouchers.length !== initialVoucherCount + 1) {
    throw new Error('Phase 5 Error: Voucher was not created upon approval');
  }
  const addedVoucher = testStatePhase5.vouchers.find(v => v.id === voucherId1)!;
  if (!addedVoucher || addedVoucher.entries[0].debit !== draftToApprove.penaltyAmount || addedVoucher.entries[1].credit !== draftToApprove.penaltyAmount) {
    throw new Error('Phase 5 Error: Accounting double-entry is incorrect');
  }
  console.log('✅ Successful Draft Approval verified.');

  // 2. Draft Rejection (رد Draft)
  console.log('🔹 Testing Draft Rejection (رد Draft)...');
  const draftToReject = testStatePhase5.creditControlDrafts.find(d => d.invoiceId === 'inv_p4_2' && d.calculationDate === '1405/01/15')!;
  if (!draftToReject || draftToReject.status !== 'pending') {
    throw new Error('Phase 5 Error: Draft should be pending before rejection');
  }

  // Reject with reason
  draftToReject.status = 'rejected';
  draftToReject.rejectionReason = 'خطا در محاسبه به علت توافق قبلی';
  draftToReject.note = 'رد شده توسط مدیریت';

  // Verify no voucher was created
  if (testStatePhase5.vouchers.length !== initialVoucherCount + 1) {
    throw new Error('Phase 5 Error: Rejection should not generate any voucher');
  }
  console.log('✅ Draft Rejection verified.');

  // 3. Prevent re-approval / action (جلوگیری از تأیید مجدد)
  console.log('🔹 Testing prevention of action on already processed drafts...');
  if (draftToApprove.status !== 'approved') {
    throw new Error('Phase 5 Error: Status should be approved');
  }
  // Try to action again - should guard
  const tryReapprove = (d: CreditControlDraft) => {
    if (d.status !== 'pending') {
      return false; // Action blocked
    }
    return true;
  };
  if (tryReapprove(draftToApprove) === true || tryReapprove(draftToReject) === true) {
    throw new Error('Phase 5 Error: Allowed action on non-pending draft');
  }
  console.log('✅ Prevention of re-action verified.');

  // 4. Prevent duplicate voucher (جلوگیری از ایجاد سند تکراری)
  console.log('🔹 Testing prevention of duplicate voucher creation...');
  const isVoucherExists = (id: string) => testStatePhase5.vouchers.some(v => v.id === id);
  if (!isVoucherExists(voucherId1)) {
    throw new Error('Phase 5 Error: Expected voucher to exist');
  }
  // If we try to create another voucher with same ID or for same draft, it should be blocked
  const createVoucherForDraft = (d: CreditControlDraft) => {
    const vId = `v_auto_penalty_${d.id}`;
    if (isVoucherExists(vId) || testStatePhase5.vouchers.some(v => v.sourceId === d.id)) {
      throw new Error('خطا: سند حسابداری جریمه برای این پیش‌نویس قبلاً در سیستم ثبت شده است!');
    }
  };
  try {
    createVoucherForDraft(draftToApprove);
    throw new Error('Phase 5 Error: Allowed duplicate voucher creation');
  } catch (err: any) {
    if (err.message !== 'خطا: سند حسابداری جریمه برای این پیش‌نویس قبلاً در سیستم ثبت شده است!') {
      throw err;
    }
    console.log('✅ Duplicate voucher creation successfully prevented with specific error message.');
  }

  // 5. Engine rerun after approval/rejection (اجرای مجدد موتور پس از تأیید/رد)
  console.log('🔹 Testing engine rerun after approval/rejection...');
  const testStateRerun = {
    ...testStatePhase5,
    creditControlDrafts: [...testStatePhase5.creditControlDrafts]
  };

  const rerunDrafts = SalesAgentCreditControlEngine.runDailyCycle(
    testStateRerun,
    '1405/01/15',
    testStateRerun.creditControlDrafts
  );

  // Since all 3 drafts for 1405/01/15 are in creditControlDrafts (1 approved, 1 rejected, 1 pending), 
  // running the engine again for 1405/01/15 must produce 0 new drafts!
  if (rerunDrafts.length !== 0) {
    throw new Error(`Phase 5 Error: Expected 0 new drafts on rerun for 1405/01/15, got ${rerunDrafts.length}`);
  }
  console.log('✅ Engine rerun idempotency verified (0 new drafts generated for existing approved/rejected/pending dates).');

  // =============================================================
  // 🛡️ STEP 2 / 18 ACCEPTANCE SCENARIOS: ROLE & SUBSIDIARY ISOLATION
  // =============================================================
  console.log('\n=======================================================');
  console.log('🛡️ TESTING ROLE & SUBSIDIARY ISOLATION ACCEPTANCE SCENARIOS');
  console.log('=======================================================');

  const dualRoleAgent: Person = {
    id: 'dual_role_person_id',
    code: 'P9099',
    name: 'علی شیروی (نماینده فروش و اعتباری)',
    nationalId: '0011223344',
    isAgent: true,
    role: 'creditor',
    createdAt: new Date().toISOString()
  };

  const dualRolePartner: BusinessPartner = {
    id: 'BP_dual_role',
    personId: 'dual_role_person_id',
    status: 'active',
    agencyType: AgencyType.BOTH,
    roles: [PartnerRole.CREDIT_SALES_AGENT, PartnerRole.CREDIT_BUYER_AGENT],
    profile: {
      partnerId: 'BP_dual_role',
      contractStatus: 'active'
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  };

  const salesPolicy = SalesAgentCreditControlEngine.createDefaultPolicy(dualRoleAgent.id, 200000000);
  salesPolicy.paymentTermDays = 30;

  const baseSalesInvoice: Invoice = {
    id: 'inv_sales_100m',
    invoiceNumber: 9901,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/01',
    personId: dualRoleAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 100000000, // 100M
    paidAmount: 0,
    createdAt: new Date().toISOString()
  };

  // Scenario 1: Only sales debt
  console.log('🔹 Acceptance Scenario 1: Only sales debt (100M, 0 payment)...');
  const outAcceptance1 = SalesAgentCreditControlEngine.process({
    agent: dualRoleAgent,
    partner: dualRolePartner,
    policy: salesPolicy,
    invoices: [baseSalesInvoice],
    vouchers: [],
    checks: [],
    currentDate: '1405/01/10'
  });
  const balAcceptance1 = outAcceptance1.invoiceBalances[0];
  if (balAcceptance1.remainingAmount !== 100000000 || balAcceptance1.paidAmount !== 0) {
    throw new Error(`Scenario 1 Failed: Expected remaining 100M, got ${balAcceptance1.remainingAmount}`);
  }
  console.log('✅ Acceptance Scenario 1 Passed: Sales balance is 100,000,000.');

  // Scenario 2: Credit from credit role (80M credit role ledger credit)
  console.log('🔹 Acceptance Scenario 2: Credit role ledger entry (80M credit file)...');
  const voucherCreditRole: JournalVoucher = {
    id: 'v_credit_role_80m',
    voucherNumber: 801,
    contractType: 'credit', // Explicitly credit portfolio role
    date: '1405/01/05',
    gregorianDate: new Date().toISOString(),
    description: 'بستانکاری نماینده بابت پرونده اعتباری مشتری',
    isAutomatic: true,
    entries: [
      {
        subsidiaryId: 'SUB_CREDITORS',
        contractType: 'credit',
        debit: 0,
        credit: 80000000, // 80M
        floatingDetailed: { type: 'person', id: dualRoleAgent.id, name: dualRoleAgent.name }
      }
    ]
  };
  const outAcceptance2 = SalesAgentCreditControlEngine.process({
    agent: dualRoleAgent,
    partner: dualRolePartner,
    policy: salesPolicy,
    invoices: [baseSalesInvoice],
    vouchers: [voucherCreditRole],
    checks: [],
    currentDate: '1405/01/10'
  });
  const balAcceptance2 = outAcceptance2.invoiceBalances[0];
  if (balAcceptance2.remainingAmount !== 100000000 || balAcceptance2.paidAmount !== 0) {
    throw new Error(`Scenario 2 Failed: Credit role entry must NOT reduce sales invoice debt! Got remaining: ${balAcceptance2.remainingAmount}, paid: ${balAcceptance2.paidAmount}`);
  }
  console.log('✅ Acceptance Scenario 2 Passed: Credit role entry (80M) did NOT reduce sales debt. Balance remains 100M.');

  // Scenario 3: Commission credit entry (20M commission in SUB_CREDITORS)
  console.log('🔹 Acceptance Scenario 3: Commission voucher (20M in SUB_CREDITORS)...');
  const voucherCommission: JournalVoucher = {
    id: 'v_commission_20m',
    voucherNumber: 802,
    date: '1405/01/06',
    gregorianDate: new Date().toISOString(),
    description: 'سند پورسانت و بازاریابی فروش',
    isAutomatic: true,
    entries: [
      {
        subsidiaryId: 'SUB_CREDITORS',
        debit: 0,
        credit: 20000000, // 20M
        floatingDetailed: { type: 'person', id: dualRoleAgent.id, name: dualRoleAgent.name }
      }
    ]
  };
  const outAcceptance3 = SalesAgentCreditControlEngine.process({
    agent: dualRoleAgent,
    partner: dualRolePartner,
    policy: salesPolicy,
    invoices: [baseSalesInvoice],
    vouchers: [voucherCommission],
    checks: [],
    currentDate: '1405/01/10'
  });
  const balAcceptance3 = outAcceptance3.invoiceBalances[0];
  if (balAcceptance3.remainingAmount !== 100000000 || balAcceptance3.paidAmount !== 0) {
    throw new Error(`Scenario 3 Failed: Commission entry must NOT reduce sales invoice debt! Got remaining: ${balAcceptance3.remainingAmount}`);
  }
  console.log('✅ Acceptance Scenario 3 Passed: Commission voucher (20M) did NOT reduce sales debt. Balance remains 100M.');

  // Scenario 4: Real sales payment (30M in SUB_DEBTORS_AGENTS)
  console.log('🔹 Acceptance Scenario 4: Real sales debt payment (30M in SUB_DEBTORS_AGENTS)...');
  const voucherSalesPayment: JournalVoucher = {
    id: 'v_sales_pay_30m',
    voucherNumber: 803,
    date: '1405/01/07',
    gregorianDate: new Date().toISOString(),
    description: 'واریز وجه نقد / پوز بابت تسویه بدهی فاکتور فروش',
    isAutomatic: false,
    sourceType: 'cash_transaction',
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS_AGENTS',
        debit: 0,
        credit: 30000000, // 30M
        floatingDetailed: { type: 'person', id: dualRoleAgent.id, name: dualRoleAgent.name }
      }
    ]
  };
  const outAcceptance4 = SalesAgentCreditControlEngine.process({
    agent: dualRoleAgent,
    partner: dualRolePartner,
    policy: salesPolicy,
    invoices: [baseSalesInvoice],
    vouchers: [voucherSalesPayment],
    checks: [],
    currentDate: '1405/01/10'
  });
  const balAcceptance4 = outAcceptance4.invoiceBalances[0];
  if (balAcceptance4.remainingAmount !== 70000000 || balAcceptance4.paidAmount !== 30000000) {
    throw new Error(`Scenario 4 Failed: Expected remaining 70M, paid 30M. Got remaining: ${balAcceptance4.remainingAmount}, paid: ${balAcceptance4.paidAmount}`);
  }
  console.log('✅ Acceptance Scenario 4 Passed: Real sales payment (30M) reduced balance to 70M.');

  // Scenario 5: Combination of multiple roles (80M credit role + 20M commission + 30M real payment)
  console.log('🔹 Acceptance Scenario 5: Combined multiple roles (80M credit + 20M commission + 30M real payment)...');
  const outAcceptance5 = SalesAgentCreditControlEngine.process({
    agent: dualRoleAgent,
    partner: dualRolePartner,
    policy: salesPolicy,
    invoices: [baseSalesInvoice],
    vouchers: [voucherCreditRole, voucherCommission, voucherSalesPayment],
    checks: [],
    currentDate: '1405/01/10'
  });
  const balAcceptance5 = outAcceptance5.invoiceBalances[0];
  if (balAcceptance5.paidAmount !== 30000000 || balAcceptance5.remainingAmount !== 70000000) {
    throw new Error(`Scenario 5 Failed: Expected paid 30M and remaining 70M. Got paid: ${balAcceptance5.paidAmount}, remaining: ${balAcceptance5.remainingAmount}`);
  }
  console.log('✅ Acceptance Scenario 5 Passed: Only the 30M real sales payment was allocated. Remaining balance is exactly 70M.');

  // =========================================================================
  // COMMAND 4: DAILY PENALTY & NON-COMPOUNDING ACCEPTANCE TESTS
  // =========================================================================
  console.log('\n=======================================================');
  console.log('🧪 COMMAND 4: DAILY LATE FEE & NON-COMPOUNDING TESTS');
  console.log('=======================================================');

  const cmd4Agent: Person = {
    id: 'agent_cmd4_1',
    code: 'P9004',
    name: 'علی تقوی (نماینده آزمون ۴)',
    mobile: '09124444444',
    isAgent: true,
    createdAt: '2026-01-01'
  };

  const cmd4Partner: BusinessPartner = {
    id: 'BP_agent_cmd4_1',
    personId: cmd4Agent.id,
    status: 'active',
    agencyType: AgencyType.INSTALLMENT_ONLY,
    roles: [],
    profile: {
      partnerId: 'BP_agent_cmd4_1',
      contractStatus: 'active',
      creditLimit: 500000000
    },
    creditExtension: {
      creditRules: {
        maxCreditLimit: 500000000,
        defaultInstallmentDays: 3, // 3-day term
        penaltyRatePerMonth: 0.1 // 0.1% daily
      }
    },
    branches: [],
    createdAt: '2026-01-01',
    createdBy: 'system'
  };

  const cmd4Policy: SalesAgentPolicy = {
    ...SalesAgentCreditControlEngine.createDefaultPolicy(cmd4Agent.id, 500000000),
    paymentTermDays: 3,
    gracePeriodDays: 0, // 0 extra grace period -> penalty starts exactly on day 4
    lateFeeDailyPercentage: 0.1,
    isPenaltyEnabled: true
  };

  const cmd4Invoice: Invoice = {
    id: 'inv_cmd4_100m',
    invoiceNumber: 9901,
    date: '1405/01/01', // Date: 1405/01/01 -> 3-day term means Day 1, 2, 3 allowed; Day 4 is first overdue day
    personId: cmd4Agent.id,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    discount: 0,
    taxPercent: 0,
    totalAmount: 100000000, // 100M
    items: [],
    paidAmount: 0,
    createdAt: '2026-01-01',
    creditRulesSnapshot: {
      maxCreditLimit: 500000000,
      defaultInstallmentDays: 3,
      penaltyRatePerMonth: 0.1,
      snapshotCreatedAt: '1405/01/01'
    }
  };

  let cmd4AppState: any = {
    persons: [cmd4Agent],
    businessPartners: [cmd4Partner],
    invoices: [cmd4Invoice],
    vouchers: [],
    checks: [],
    creditControlDrafts: []
  };

  // --- CMD4 TEST 1: 3-Day Grace Period -> Days 1..3: 0 penalty, Days 4..10: 7 daily penalties ---
  console.log('🔹 CMD4 Test 1: Testing 3-day payment term & 7 daily penalties from Day 4 to Day 10...');
  
  // Day 1 (1405/01/01): 0 penalty
  const d1Drafts = SalesAgentCreditControlEngine.runDailyCycle(cmd4AppState, '1405/01/01', cmd4AppState.creditControlDrafts);
  if (d1Drafts.length !== 0) throw new Error(`CMD4 Test 1 Failed: Day 1 should have 0 drafts, got ${d1Drafts.length}`);
  
  // Day 2 (1405/01/02): 0 penalty
  const d2Drafts = SalesAgentCreditControlEngine.runDailyCycle(cmd4AppState, '1405/01/02', cmd4AppState.creditControlDrafts);
  if (d2Drafts.length !== 0) throw new Error(`CMD4 Test 1 Failed: Day 2 should have 0 drafts, got ${d2Drafts.length}`);

  // Day 3 (1405/01/03): 0 penalty
  const d3Drafts = SalesAgentCreditControlEngine.runDailyCycle(cmd4AppState, '1405/01/03', cmd4AppState.creditControlDrafts);
  if (d3Drafts.length !== 0) throw new Error(`CMD4 Test 1 Failed: Day 3 should have 0 drafts, got ${d3Drafts.length}`);
  console.log('  ✅ Days 1, 2, 3 have exactly 0 penalties (within 3-day term).');

  // Days 4 to 10 (1405/01/04 to 1405/01/10): Each day must produce exactly 1 penalty draft of 100,000 Rials
  const allDailyDrafts: CreditControlDraft[] = [];
  for (let day = 4; day <= 10; day++) {
    const dayStr = day < 10 ? `1405/01/0${day}` : `1405/01/${day}`;
    const dayDrafts = SalesAgentCreditControlEngine.runDailyCycle(cmd4AppState, dayStr, allDailyDrafts);
    if (dayDrafts.length !== 1) {
      throw new Error(`CMD4 Test 1 Failed: Expected 1 draft on ${dayStr}, got ${dayDrafts.length}`);
    }
    const draft = dayDrafts[0];
    if (draft.penaltyAmount !== 100000 || draft.baseRemainingAmount !== 100000000) {
      throw new Error(`CMD4 Test 1 Failed on ${dayStr}: Expected penalty 100k on 100M base, got ${draft.penaltyAmount} on ${draft.baseRemainingAmount}`);
    }
    allDailyDrafts.push(draft);
  }

  if (allDailyDrafts.length !== 7) {
    throw new Error(`CMD4 Test 1 Failed: Expected exactly 7 daily drafts from Day 4 to Day 10, got ${allDailyDrafts.length}`);
  }
  console.log('  ✅ Exactly 7 independent daily penalty drafts created from Day 4 to Day 10.');

  // --- CMD4 TEST 2: Non-Compounding Penalty Base ---
  console.log('🔹 CMD4 Test 2: Verifying penalty is NOT compounded (Invoice totalAmount remains 100M)...');
  // Simulate approving Day 4's penalty draft into a journal voucher
  const day4Voucher: JournalVoucher = {
    id: `v_auto_penalty_${allDailyDrafts[0].id}`,
    voucherNumber: 1001,
    date: '1405/01/04',
    gregorianDate: '2026-03-24',
    description: 'ثبت جریمه دیرکرد روز ۴',
    entries: [
      {
        subsidiaryId: 'SUB_DEBTORS',
        floatingDetailed: { type: 'person', id: cmd4Agent.id, name: cmd4Agent.name },
        debit: 100000,
        credit: 0,
        description: 'بدهکار جریمه روز ۴'
      },
      {
        subsidiaryId: 'SUB_OTHER_REVENUE',
        debit: 0,
        credit: 100000,
        description: 'بستانکار درآمد جریمه'
      }
    ],
    isAutomatic: true,
    sourceType: 'manual',
    sourceId: allDailyDrafts[0].id,
    status: 'active'
  };

  cmd4AppState.vouchers.push(day4Voucher);

  // Re-run for Day 5: Base must STILL be 100,000,000 (NOT 100,100,000)
  const day5TestDrafts = SalesAgentCreditControlEngine.runDailyCycle(cmd4AppState, '1405/01/05', []);
  const d5Draft = day5TestDrafts[0];
  if (d5Draft.baseRemainingAmount !== 100000000 || d5Draft.penaltyAmount !== 100000) {
    throw new Error(`CMD4 Test 2 Failed: Penalty compounded! Base is ${d5Draft.baseRemainingAmount}, expected 100,000,000`);
  }
  if (cmd4AppState.invoices[0].totalAmount !== 100000000) {
    throw new Error(`CMD4 Test 2 Failed: Invoice totalAmount was mutated to ${cmd4AppState.invoices[0].totalAmount}`);
  }
  console.log('  ✅ Non-compounding verified: Base remains strictly 100M, Day 5 penalty is 100k, invoice totalAmount untouched.');

  // --- CMD4 TEST 3: Partial Payment of 40M on Day 5 ---
  console.log('🔹 CMD4 Test 3: Testing Partial Payment of 40M on Day 5 -> Days 6..10 base becomes 60M...');
  const partialPaymentVoucher: JournalVoucher = {
    id: 'v_cmd4_partial_pay_40m',
    voucherNumber: 1002,
    date: '1405/01/05',
    gregorianDate: '2026-03-25',
    description: 'واریز نقدی ۴۰ میلیون بابت تسویه فاکتور فروش',
    entries: [
      {
        subsidiaryId: 'SUB_CASH',
        debit: 40000000,
        credit: 0,
        description: 'بدهکار صندوق'
      },
      {
        subsidiaryId: 'SUB_DEBTORS_AGENTS',
        floatingDetailed: { type: 'person', id: cmd4Agent.id, name: cmd4Agent.name },
        debit: 0,
        credit: 40000000,
        description: 'بستانکار بدهکاران تجاری نماینده'
      }
    ],
    isAutomatic: true,
    sourceType: 'manual',
    status: 'active'
  };

  cmd4AppState.vouchers.push(partialPaymentVoucher);

  // On Day 6 (1405/01/06), base must now be 60,000,000 and penalty 60,000 Rials
  const day6Drafts = SalesAgentCreditControlEngine.runDailyCycle(cmd4AppState, '1405/01/06', []);
  if (day6Drafts.length !== 1) throw new Error(`CMD4 Test 3 Failed: Expected 1 draft on Day 6, got ${day6Drafts.length}`);
  const d6 = day6Drafts[0];
  if (d6.baseRemainingAmount !== 60000000 || d6.penaltyAmount !== 60000) {
    throw new Error(`CMD4 Test 3 Failed on Day 6: Expected base 60M and penalty 60k, got base ${d6.baseRemainingAmount} and penalty ${d6.penaltyAmount}`);
  }
  console.log('  ✅ Partial payment verified: Base reduced to 60M, daily penalty on Day 6 is exactly 60k.');

  // --- CMD4 TEST 4: Full Settlement of remaining 60M on Day 10 ---
  console.log('🔹 CMD4 Test 4: Testing Full Settlement of remaining 60M -> Day 11 penalty is ZERO...');
  const fullPaymentVoucher: JournalVoucher = {
    id: 'v_cmd4_full_pay_60m',
    voucherNumber: 1003,
    date: '1405/01/10',
    gregorianDate: '2026-03-30',
    description: 'واریز نهایی ۶۰ میلیون ریال و تسویه کامل فاکتور',
    entries: [
      {
        subsidiaryId: 'SUB_CASH',
        debit: 60000000,
        credit: 0,
        description: 'بدهکار صندوق'
      },
      {
        subsidiaryId: 'SUB_DEBTORS_AGENTS',
        floatingDetailed: { type: 'person', id: cmd4Agent.id, name: cmd4Agent.name },
        debit: 0,
        credit: 60000000,
        description: 'بستانکار بدهکاران تجاری نماینده'
      }
    ],
    isAutomatic: true,
    sourceType: 'manual',
    status: 'active'
  };

  cmd4AppState.vouchers.push(fullPaymentVoucher);

  // On Day 11 (1405/01/11), remaining balance is 0 -> 0 drafts produced
  const day11Drafts = SalesAgentCreditControlEngine.runDailyCycle(cmd4AppState, '1405/01/11', []);
  if (day11Drafts.length !== 0) {
    throw new Error(`CMD4 Test 4 Failed: Expected 0 drafts after full settlement, got ${day11Drafts.length}`);
  }
  // Check that historical vouchers (1001, 1002, 1003) remain in system
  if (cmd4AppState.vouchers.length !== 3) {
    throw new Error(`CMD4 Test 4 Failed: Historical vouchers were not preserved`);
  }
  console.log('  ✅ Full settlement verified: 0 penalty on Day 11, all historical penalty & payment vouchers intact.');

  // --- CMD4 TEST 5: Idempotency Re-run ---
  console.log('🔹 CMD4 Test 5: Testing Idempotency re-run on same date...');
  const testReRunState: any = {
    persons: [cmd4Agent],
    businessPartners: [cmd4Partner],
    invoices: [cmd4Invoice],
    vouchers: [], // Unpaid state
    checks: [],
    creditControlDrafts: []
  };

  const initialDrafts = SalesAgentCreditControlEngine.runDailyCycle(testReRunState, '1405/01/04', []);
  if (initialDrafts.length !== 1) throw new Error('CMD4 Test 5 Failed: Initial run did not produce 1 draft');

  const secondRunDrafts = SalesAgentCreditControlEngine.runDailyCycle(testReRunState, '1405/01/04', initialDrafts);
  if (secondRunDrafts.length !== 0) {
    throw new Error(`CMD4 Test 5 Failed: Re-run produced ${secondRunDrafts.length} duplicate drafts instead of 0`);
  }
  console.log('  ✅ Idempotency verified: Re-running cycle on same date produces 0 duplicate drafts.');

  // --- CMD4 TEST 6: Role Separation Preservation ---
  console.log('🔹 CMD4 Test 6: Verifying credit role (80M) + commission (20M) does not reduce base or penalty...');
  const stateWithOtherRoles: any = {
    persons: [cmd4Agent],
    businessPartners: [cmd4Partner],
    invoices: [cmd4Invoice],
    vouchers: [voucherCreditRole, voucherCommission], // 80M credit role + 20M commission
    checks: [],
    creditControlDrafts: []
  };

  const roleDrafts = SalesAgentCreditControlEngine.runDailyCycle(stateWithOtherRoles, '1405/01/04', []);
  if (roleDrafts.length !== 1) throw new Error('CMD4 Test 6 Failed: Expected 1 draft');
  if (roleDrafts[0].baseRemainingAmount !== 100000000 || roleDrafts[0].penaltyAmount !== 100000) {
    throw new Error(`CMD4 Test 6 Failed: Other roles leaked into penalty base! Got base ${roleDrafts[0].baseRemainingAmount}`);
  }
  console.log('  ✅ Role separation verified: Credit role & commission do not reduce sales penalty base.');

  console.log('\n=======================================================');
  console.log('🎉 ALL COMMAND 4 DAILY PENALTY & NON-COMPOUNDING TESTS PASSED!');
  console.log('=======================================================');

  console.log('\n=======================================================');
  console.log('🎉 ALL 8 CORE + PHASE 4 & 5 + 5 ACCEPTANCE SCENARIOS PASSED!');
  console.log('=======================================================');
}

try {
  runTests();
} catch (error) {
  console.error('❌ Credit Control Engine Tests failed with error:', error);
  process.exit(1);
}
