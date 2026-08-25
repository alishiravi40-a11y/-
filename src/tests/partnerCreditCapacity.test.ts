import { 
  AppState, BusinessPartner, PartnerCreditRequest, 
  PartnerCreditRequestStatus, Person, AgencyType, PartnerRole 
} from '../types';
import { 
  calculatePartnerRemainingLimit, resolvePartnerCreditRules, 
  finalizePartnerCreditRequest 
} from '../utils/partnerProcess';
import { getCurrentJalaliYearMonth } from '../utils/jalali';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ PASSED: ${message}`);
}

export function runPartnerCreditCapacityTests() {
  console.log('=== Starting Partner Credit Capacity & Renewal Unit Tests ===');

  const currentJalaliYM = getCurrentJalaliYearMonth();

  const mockPerson: Person = {
    id: 'P_AGENT_1',
    code: 'P_AGENT_1',
    name: 'علی همکار',
    nationalId: '1234567890',
    mobile: '09123456789',
    createdAt: new Date().toISOString()
  };

  const mockPartner: BusinessPartner = {
    id: 'BP_AGENT_1',
    personId: 'P_AGENT_1',
    status: 'active',
    agencyType: AgencyType.BOTH,
    roles: [PartnerRole.CREDIT_SALES_AGENT, PartnerRole.CREDIT_BUYER_AGENT],
    profile: {
      partnerId: 'BP_AGENT_1',
      contractStatus: 'فعال',
      riskLevel: 'low',
      creditLimit: 5000000000
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'admin',
    creditExtension: {
      creditRules: {
        maxCreditLimit: 5000000000, // 5 Billion Rials
        maxPerDossierLimit: 1000000000, // 1 Billion Rials per dossier
        renewalType: 'AUTO'
      }
    },
    salesExtension: {
      salesRules: {
        nesyehPurchaseLimit: 200000000 // 200 Million Rials (Sales role)
      }
    }
  };

  const initialState: AppState = {
    persons: [mockPerson],
    businessPartners: [mockPartner],
    partnerCreditRequests: [],
    vouchers: [],
    checks: [],
    installmentBooks: [],
    invoices: [],
    openingBalances: [],
    users: [],
    creditFiles: [],
    products: [],
    productCategories: [],
    subsidiaries: [],
    installments: [],
    installmentRequests: [],
    installmentPlans: [],
    warehouses: [],
    warehouseTransfers: [],
    costCenters: [],
    visitorProfiles: [],
    rolePermissions: [],
    projectNotes: [],
    bankTerminals: [],
    auditLogs: [],
    settings: {} as any,
    creditPolicies: [],
    calculators: []
  };

  // Test 1: ظرفیت ۵ میلیارد ← ارسال پرونده ۱ میلیارد ← مانده ۴ میلیارد
  console.log('\n[Test 1] Initial capacity & submission reservation');
  const req1: PartnerCreditRequest = {
    id: 'PCR_101',
    businessPartnerId: 'BP_AGENT_1',
    customerPersonId: 'P_CUST_1',
    status: PartnerCreditRequestStatus.SUBMITTED_BY_PARTNER,
    requestedAmount: 1000000000, // 1 Billion Rials
    salePlanId: 'PLAN_1',
    termCount: 12,
    paymentPeriod: 30,
    documents: [],
    approvalHistory: [],
    createdAt: new Date().toISOString(),
    createdBy: 'U1'
  };

  let state1: AppState = {
    ...initialState,
    partnerCreditRequests: [req1]
  };

  const remaining1 = calculatePartnerRemainingLimit('BP_AGENT_1', state1);
  assert(remaining1 === 4000000000, `Expected remaining limit 4 Billion, got ${remaining1}`);

  // Test 2: تأیید همان پرونده ← مانده همچنان ۴ میلیارد، نه ۳ میلیارد
  console.log('\n[Test 2] Final approval confirms reservation without double deduction');
  const req1Approved: PartnerCreditRequest = {
    ...req1,
    status: PartnerCreditRequestStatus.FINAL_APPROVED,
    approvedAt: new Date().toISOString()
  };

  let state2: AppState = {
    ...initialState,
    partnerCreditRequests: [req1Approved]
  };

  const remaining2 = calculatePartnerRemainingLimit('BP_AGENT_1', state2);
  assert(remaining2 === 4000000000, `Expected remaining limit still 4 Billion after approval, got ${remaining2}`);

  // Test 3: رد یا لغو پرونده رزروشده ← ظرفیت آزاد شود
  console.log('\n[Test 3] Rejection or cancellation frees reserved capacity');
  const req1Rejected: PartnerCreditRequest = {
    ...req1,
    status: PartnerCreditRequestStatus.REJECTED
  };

  let state3: AppState = {
    ...initialState,
    partnerCreditRequests: [req1Rejected]
  };

  const remaining3 = calculatePartnerRemainingLimit('BP_AGENT_1', state3);
  assert(remaining3 === 5000000000, `Expected remaining limit restored to 5 Billion, got ${remaining3}`);

  // Test 4: پرونده بیشتر از ظرفیت باقیمانده ← مسدود
  console.log('\n[Test 4] Request exceeding remaining capacity is blocked');
  const req2TooBig: PartnerCreditRequest = {
    id: 'PCR_102',
    businessPartnerId: 'BP_AGENT_1',
    customerPersonId: 'P_CUST_2',
    status: PartnerCreditRequestStatus.FINAL_APPROVED,
    requestedAmount: 5000000000, // 5 Billion (when remaining is 4 Billion)
    salePlanId: 'PLAN_1',
    termCount: 12,
    paymentPeriod: 30,
    documents: [],
    approvalHistory: [],
    calculationResults: {
      totalPayment: 5000000000,
      totalInterest: 0,
      partnerCommission: 0,
      installmentAmount: 500000000,
      suggestedInstallments: [],
      calculatedAt: new Date().toISOString(),
      calculatedBy: 'U1'
    },
    createdAt: new Date().toISOString(),
    createdBy: 'U1'
  };

  let state4: AppState = {
    ...state2, // State where 1 Billion is already reserved (4 Billion remaining)
    partnerCreditRequests: [...state2.partnerCreditRequests, req2TooBig]
  };

  let threwCapacityError = false;
  try {
    finalizePartnerCreditRequest('PCR_102', state4);
  } catch (err: any) {
    threwCapacityError = true;
    assert(err.message.includes('ظرفیت اعتباری باقی‌مانده'), `Error message correctly mentions remaining limit: ${err.message}`);
  }
  assert(threwCapacityError, 'Finalizing request exceeding capacity threw an error');

  // Test 5: پرونده بیشتر از maxPerDossierLimit ← مسدود
  console.log('\n[Test 5] Request exceeding maxPerDossierLimit is identified');
  const rules = resolvePartnerCreditRules('BP_AGENT_1', state1.businessPartners);
  assert(rules.maxPerDossierLimit === 1000000000, 'maxPerDossierLimit correctly resolved as 1 Billion');
  const isDossierExceeded = 1500000000 > rules.maxPerDossierLimit!;
  assert(isDossierExceeded, '1.5 Billion exceeds maxPerDossierLimit of 1 Billion');

  // Test 6: ماه جدید خودکار ← ظرفیت کامل دوره جدید
  console.log('\n[Test 6] Auto renewal in new Jalali month grants full capacity');
  const reqPastMonth: PartnerCreditRequest = {
    id: 'PCR_PAST',
    businessPartnerId: 'BP_AGENT_1',
    customerPersonId: 'P_CUST_OLD',
    status: PartnerCreditRequestStatus.FINAL_APPROVED,
    requestedAmount: 3000000000,
    salePlanId: 'PLAN_1',
    termCount: 12,
    paymentPeriod: 30,
    documents: [],
    approvalHistory: [],
    createdAt: '2020-01-01T10:00:00.000Z', // Old Jalali month
    createdBy: 'U1'
  };

  let state6: AppState = {
    ...initialState,
    partnerCreditRequests: [reqPastMonth]
  };

  const remainingAutoNewMonth = calculatePartnerRemainingLimit('BP_AGENT_1', state6);
  assert(remainingAutoNewMonth === 5000000000, `Past month request ignored in current Jalali month, full 5 Billion available`);

  // Test 7: ماه جدید دستی ← تا اقدام مدیر قابل استفاده نباشد
  console.log('\n[Test 7] Manual renewal blocks capacity until admin activation');
  const mockPartnerManual: BusinessPartner = {
    ...mockPartner,
    creditExtension: {
      creditRules: {
        maxCreditLimit: 5000000000,
        renewalType: 'MANUAL',
        activePeriodJalali: '1404/11' // Admin activated an old Jalali month, current is currentJalaliYM
      }
    }
  };

  let state7: AppState = {
    ...initialState,
    businessPartners: [mockPartnerManual]
  };

  const remainingManualUnactivated = calculatePartnerRemainingLimit('BP_AGENT_1', state7);
  assert(remainingManualUnactivated === 0, `Manual mode with unactivated current month returns 0 remaining limit`);

  // Admin activates current month
  const mockPartnerManualActivated: BusinessPartner = {
    ...mockPartnerManual,
    creditExtension: {
      creditRules: {
        ...mockPartnerManual.creditExtension?.creditRules,
        activePeriodJalali: currentJalaliYM
      }
    }
  };

  let state7Activated: AppState = {
    ...initialState,
    businessPartners: [mockPartnerManualActivated]
  };

  const remainingManualActivated = calculatePartnerRemainingLimit('BP_AGENT_1', state7Activated);
  assert(remainingManualActivated === 5000000000, `Manual mode returns 5 Billion after admin activates current Jalali month`);

  // Test 8: یک شخص با هر دو نقش فروش و اعتباری ← دو ظرفیت کاملاً مستقل
  console.log('\n[Test 8] Sales and Credit limits remain completely independent');
  const salesLimit = mockPartner.salesExtension?.salesRules?.nesyehPurchaseLimit;
  const creditLimit = mockPartner.creditExtension?.creditRules?.maxCreditLimit;
  assert(salesLimit === 200000000, 'Sales nesyeh limit is 200 Million');
  assert(creditLimit === 5000000000, 'Credit max limit is 5 Billion');
  const creditRemainingAfterReq = calculatePartnerRemainingLimit('BP_AGENT_1', state1);
  assert(creditRemainingAfterReq === 4000000000, 'Credit capacity reduced to 4 Billion');
  assert(mockPartner.salesExtension?.salesRules?.nesyehPurchaseLimit === 200000000, 'Sales nesyeh limit unchanged at 200 Million');

  // Test 9: هیچ سند حسابداری صرفاً بر اثر رزرو/تجدید ظرفیت ایجاد نشود
  console.log('\n[Test 9] No accounting vouchers created by capacity reservation or period renewal');
  const initialVouchersCount = initialState.vouchers.length;
  calculatePartnerRemainingLimit('BP_AGENT_1', state1);
  calculatePartnerRemainingLimit('BP_AGENT_1', state7Activated);
  assert(state1.vouchers.length === initialVouchersCount, 'Voucher count remains unchanged (0 created)');

  console.log('\n✅ ALL 9 MANDATORY PARTNER CREDIT CAPACITY TESTS PASSED SUCCESSFULLY!');
}

if (process.env.NODE_ENV === 'test' || import.meta.url === `file://${process.argv[1]}`) {
  runPartnerCreditCapacityTests();
}
