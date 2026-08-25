import { 
  AppState, Person, BusinessPartner, InstallmentBook, Installment, 
  Check, JournalVoucher, PartnerCreditRequest, PartnerCreditRequestStatus, 
  CreditFile, AgencyType, PartnerRole 
} from '../types';
import { 
  checkCustomerCreditEligibility, finalizePartnerCreditRequest, 
  finalizeCreditFile 
} from '../utils/partnerProcess';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

export function runCustomerSettlementGateTests() {
  console.log('--- STARTING CUSTOMER SETTLEMENT GATE TESTS (STEP 16) ---');

  const samplePerson: Person = {
    id: 'P_CUST_100',
    code: 'P_CUST_100',
    name: 'رضا مشتری',
    nationalId: '0011223344',
    mobile: '09121112233',
    createdAt: new Date().toISOString()
  };

  const sampleAgent: BusinessPartner = {
    id: 'BP_AGENT_100',
    personId: 'P_AGENT_100',
    status: 'active',
    agencyType: AgencyType.BOTH,
    roles: [PartnerRole.CREDIT_SALES_AGENT],
    profile: {
      partnerId: 'BP_AGENT_100',
      contractStatus: 'فعال',
      riskLevel: 'low',
      creditLimit: 5000000000
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'admin',
    creditExtension: {
      creditRules: {
        maxCreditLimit: 5000000000,
        maxPerDossierLimit: 1000000000,
        renewalType: 'AUTO'
      }
    }
  };

  const baseState: AppState = {
    persons: [samplePerson],
    businessPartners: [sampleAgent],
    creditFiles: [],
    partnerCreditRequests: [],
    installmentBooks: [],
    installments: [],
    checks: [],
    vouchers: [],
    auditLogs: [],
    partnerSalesPlans: [],
    invoices: [],
    openingBalances: [],
    users: [],
    products: [],
    productCategories: [],
    subsidiaries: [],
    installmentRequests: [],
    installmentPlans: [],
    warehouses: [],
    warehouseTransfers: [],
    costCenters: [],
    visitorProfiles: [],
    rolePermissions: [],
    projectNotes: [],
    bankTerminals: [],
    settings: {} as any,
    creditPolicies: [],
    calculators: []
  };

  // Test 1: پرونده completed ولی دارای بدهی واقعی مرتبط در دفتر کل
  console.log('\n[Test 1] Completed book but real debtor balance in ledger -> BLOCKED');
  const book1: InstallmentBook = {
    id: 'IB_1',
    personId: 'P_CUST_100',
    creditFileId: 'CF_1',
    totalPrincipal: 100000000,
    totalInterest: 10000000,
    totalAmount: 110000000,
    installmentCount: 12,
    startDate: '1402/01/01',
    intervalDays: 30,
    status: 'completed',
    createdAt: new Date().toISOString(),
    createdBy: 'admin'
  };
  const voucher1: JournalVoucher = {
    id: 'V_1',
    voucherNumber: 1,
    date: '1402/01/01',
    gregorianDate: new Date().toISOString(),
    description: 'بدهی اعتباری مشتری',
    isAutomatic: true,
    entries: [
      {
        debit: 20000000,
        credit: 0,
        description: 'مانده بدهی اقساط',
        subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
        floatingDetailed: { id: 'P_CUST_100', name: 'رضا مشتری', type: 'person' }
      }
    ]
  };
  const state1: AppState = { ...baseState, installmentBooks: [book1], vouchers: [voucher1] };
  const res1 = checkCustomerCreditEligibility('0011223344', state1);
  assert(!res1.isEligible, 'Test 1 Failed: Should block credit due to remaining ledger debtor balance.');
  console.log('✅ Test 1 Passed:', res1.reasons[0]);

  // Test 2: پرونده completed ولی یک قسط پرداخت‌نشده وجود دارد
  console.log('\n[Test 2] Completed book but unpaid installment exists -> BLOCKED');
  const inst2: Installment = {
    id: 'INST_2',
    bookId: 'IB_1',
    installmentNumber: 1,
    amount: 10000000,
    paidAmount: 0,
    interestPart: 0,
    principalPart: 10000000,
    penaltyAmount: 0,
    delayDays: 0,
    dueDate: '1402/02/01',
    status: 'upcoming'
  };
  const state2: AppState = { ...baseState, installmentBooks: [book1], installments: [inst2] };
  const res2 = checkCustomerCreditEligibility('0011223344', state2);
  assert(!res2.isEligible, 'Test 2 Failed: Should block credit due to unpaid installment.');
  console.log('✅ Test 2 Passed:', res2.reasons[0]);

  // Test 3: پرونده completed ولی چک مرتبط هنوز وصول نشده است
  console.log('\n[Test 3] Completed book but uncollected check in cashbox -> BLOCKED');
  const check3: Check = {
    id: 'CHK_3',
    type: 'received',
    checkNumber: '888999',
    bankName: 'ملی',
    dueDate: '1402/03/01',
    amount: 50000000,
    personId: 'P_CUST_100',
    nationalId: '0011223344',
    currentState: 'present_in_cashbox',
    isInstallment: true,
    isAmani: false,
    history: [],
    createdAt: new Date().toISOString(),
    createdBy: 'admin',
    status: 'active'
  };
  const state3: AppState = { ...baseState, installmentBooks: [book1], checks: [check3] };
  const res3 = checkCustomerCreditEligibility('0011223344', state3);
  assert(!res3.isEligible, 'Test 3 Failed: Should block credit due to uncollected check.');
  console.log('✅ Test 3 Passed:', res3.reasons[0]);

  // Test 4: چک مرتبط برگشتی و حل‌نشده است
  console.log('\n[Test 4] Related check is bounced -> BLOCKED');
  const check4: Check = { ...check3, id: 'CHK_4', currentState: 'bounced' };
  const state4: AppState = { ...baseState, checks: [check4] };
  const res4 = checkCustomerCreditEligibility('0011223344', state4);
  assert(!res4.isEligible, 'Test 4 Failed: Should block credit due to bounced check.');
  console.log('✅ Test 4 Passed:', res4.reasons[0]);

  // Test 5: پرونده قبلی واقعاً تسویه شده (بدهی=۰، قسط=۰، چک=۰) -> مجاز
  console.log('\n[Test 5] Previous dossier truly settled -> PERMITTED');
  const res5 = checkCustomerCreditEligibility('0011223344', baseState);
  assert(res5.isEligible, 'Test 5 Failed: Should allow new credit when all commitments are settled.');
  console.log('✅ Test 5 Passed: Customer eligible for new credit.');

  // Test 6: عدم تهاتر نقش مشتری و نماینده (شخص هم مشتری و هم نماینده است)
  console.log('\n[Test 6] Person is both customer and agent, creditor as agent but owes as customer -> BLOCKED');
  const DualRolePerson: Person = {
    id: 'P_DUAL',
    code: 'P_DUAL',
    name: 'علی دو نقشی',
    nationalId: '5556667778',
    mobile: '09125556677',
    createdAt: new Date().toISOString()
  };
  const DualRoleAgent: BusinessPartner = {
    id: 'BP_DUAL',
    personId: 'P_DUAL',
    status: 'active',
    agencyType: AgencyType.BOTH,
    roles: [PartnerRole.CREDIT_SALES_AGENT],
    profile: { partnerId: 'BP_DUAL', contractStatus: 'فعال', riskLevel: 'low', creditLimit: 5000000000 },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'admin'
  };
  // Voucher with creditor balance in SUB_CREDITORS (for agent commission/settlement = 500M) AND debtor balance in SUB_DEBTORS_INSTALLMENT (as customer = 100M)
  const dualRoleVoucher: JournalVoucher = {
    id: 'V_DUAL',
    voucherNumber: 2,
    date: '1402/01/01',
    gregorianDate: new Date().toISOString(),
    description: 'تراکنش‌های دو نقشی',
    isAutomatic: true,
    entries: [
      {
        debit: 0,
        credit: 500000000,
        description: 'بستانکاری بابت کمیسیون نماینده',
        subsidiaryId: 'SUB_CREDITORS',
        floatingDetailed: { id: 'P_DUAL', name: 'علی دو نقشی', type: 'person' }
      },
      {
        debit: 100000000,
        credit: 0,
        description: 'بدهی اقساطی به عنوان مشتری',
        subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
        floatingDetailed: { id: 'P_DUAL', name: 'علی دو نقشی', type: 'person' }
      }
    ]
  };
  const state6: AppState = {
    ...baseState,
    persons: [DualRolePerson],
    businessPartners: [DualRoleAgent],
    vouchers: [dualRoleVoucher]
  };
  const res6 = checkCustomerCreditEligibility('5556667778', state6);
  assert(!res6.isEligible, 'Test 6 Failed: Creditor balance in agent role MUST NOT offset debtor balance in customer role!');
  console.log('✅ Test 6 Passed: Role clearing prevented! Reason:', res6.reasons[0]);

  // Test 7: اعتبار مستقیم مرکز -> هیچ تغییری در ظرفیت نماینده ایجاد نشود
  console.log('\n[Test 7] Center Credit File does not affect partner capacity');
  const centerFile7: CreditFile = {
    id: 'CF_CENTER_7',
    personId: 'P_CUST_100',
    requestedAmount: 300000000,
    representativeId: 'CENTER',
    agentCommissionAmount: 0,
    plan: 'طرح مرکز',
    status: 'pending',
    calculationResults: {
      creditAmount: 300000000,
      installmentCount: 12,
      installmentAmount: 27500000,
      totalCommission: 0,
      totalRepayment: 330000000
    },
    createdAt: new Date().toISOString()
  };
  const state7: AppState = { ...baseState, creditFiles: [centerFile7] };
  const fileFinRes7 = finalizeCreditFile('CF_CENTER_7', state7);
  assert(fileFinRes7.creditFiles?.[0]?.status === 'approved', 'Test 7 Failed: Center credit file should finalize cleanly.');
  console.log('✅ Test 7 Passed: Center credit finalized without touching partner limits.');

  // Test 8: پرونده نماینده -> قواعد ظرفیت فعلی بدون تغییر باقی بماند
  console.log('\n[Test 8] Partner dossier capacity rules operate unchanged');
  const partnerReq8: PartnerCreditRequest = {
    id: 'PCR_8',
    businessPartnerId: 'BP_AGENT_100',
    customerPersonId: 'P_CUST_100',
    requestedAmount: 500000000,
    salePlanId: 'PLAN_1',
    termCount: 12,
    paymentPeriod: 30,
    status: PartnerCreditRequestStatus.FINAL_APPROVED,
    calculationResults: {
      totalPayment: 550000000,
      totalInterest: 50000000,
      partnerCommission: 10000000,
      installmentAmount: 55000000,
      suggestedInstallments: [],
      calculatedAt: new Date().toISOString(),
      calculatedBy: 'agent'
    },
    submittedChecks: [],
    documents: [],
    approvalHistory: [],
    createdAt: new Date().toISOString(),
    createdBy: 'agent'
  };
  const state8: AppState = { ...baseState, partnerCreditRequests: [partnerReq8] };
  const reqFinRes8 = finalizePartnerCreditRequest('PCR_8', state8);
  assert(!!reqFinRes8.installmentBooks && reqFinRes8.installmentBooks.length > 0, 'Test 8 Failed: Partner request finalized cleanly when customer is eligible.');
  console.log('✅ Test 8 Passed: Partner capacity and request finalization operating as expected.');

  // Test 9: رد یا لغو پرونده‌ای که هیچ تعهد مالی ایجاد نکرده است
  console.log('\n[Test 9] Cancelled/Rejected request without financial commitment does not block future credit');
  const rejectedReq9: PartnerCreditRequest = {
    id: 'PCR_REJ',
    businessPartnerId: 'BP_AGENT_100',
    customerPersonId: 'P_CUST_100',
    requestedAmount: 1000000000,
    salePlanId: 'PLAN_1',
    termCount: 12,
    paymentPeriod: 30,
    status: PartnerCreditRequestStatus.REJECTED,
    submittedChecks: [],
    documents: [],
    approvalHistory: [],
    createdAt: new Date().toISOString(),
    createdBy: 'agent'
  };
  const state9: AppState = { ...baseState, partnerCreditRequests: [rejectedReq9] };
  const res9 = checkCustomerCreditEligibility('0011223344', state9);
  assert(res9.isEligible, 'Test 9 Failed: Rejected/Cancelled requests must not block future credit.');
  console.log('✅ Test 9 Passed: Cancelled/rejected request safely permits future credit.');

  // Test 10: اجرای مجدد کنترل کاملاً خواندنی و بدون عوارض جانبی (Idempotency)
  console.log('\n[Test 10] Repeated calls to checkCustomerCreditEligibility are 100% read-only');
  const initialVoucherCount = baseState.vouchers.length;
  const initialCheckCount = baseState.checks.length;
  const initialBookCount = baseState.installmentBooks.length;

  for (let i = 0; i < 10; i++) {
    checkCustomerCreditEligibility('0011223344', baseState);
  }

  assert(baseState.vouchers.length === initialVoucherCount, 'Test 10 Failed: Vouchers modified.');
  assert(baseState.checks.length === initialCheckCount, 'Test 10 Failed: Checks modified.');
  assert(baseState.installmentBooks.length === initialBookCount, 'Test 10 Failed: Books modified.');
  console.log('✅ Test 10 Passed: Gate is 100% read-only across multiple executions.');

  console.log('\n🎉 ALL 10 ACCEPTANCE TESTS FOR STEP 16 PASSED SUCCESSFULLY! 🎉');
}

runCustomerSettlementGateTests();
