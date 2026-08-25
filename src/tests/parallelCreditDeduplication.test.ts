import { 
  checkCustomerCreditEligibility, 
  finalizePartnerCreditRequest, 
  finalizeCreditFile,
  calculatePartnerRemainingLimit
} from '../utils/partnerProcess';
import { 
  AppState, 
  PartnerCreditRequestStatus, 
  Person, 
  BusinessPartner, 
  CreditFile, 
  PartnerCreditRequest,
  InstallmentBook,
  AgencyType,
  PartnerRole
} from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ PASSED: ${message}`);
}

export function runParallelCreditDeduplicationTests() {
  console.log('=======================================================');
  console.log('🚀 Running Parallel Credit & Deduplication Gates Tests');
  console.log('=======================================================');

  const samplePerson: Person = {
    id: 'P_CUST_1',
    code: 'CUST_1',
    name: 'مشتری تست علی',
    nationalId: '1234567890',
    mobile: '09121111111',
    createdAt: new Date().toISOString()
  };

  const sampleAgent: BusinessPartner = {
    id: 'BP_AGENT_A',
    personId: 'P_AGENT_A',
    status: 'active',
    agencyType: AgencyType.CREDIT_ONLY,
    roles: [PartnerRole.CREDIT_SALES_AGENT],
    profile: {
      partnerId: 'BP_AGENT_A',
      contractStatus: 'فعال'
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'admin',
    creditExtension: {
      creditRules: {
        maxCreditLimit: 1000000000, // 1B Rials
        defaultInstallmentDays: 30,
        penaltyRatePerMonth: 0.1
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

  // Test A
  console.log('\n[Test A] Active/Unsettled CreditFile for customer blocks new PartnerCreditRequest');
  const activeBook: InstallmentBook = {
    id: 'IB_100',
    personId: 'P_CUST_1',
    creditFileId: 'CF_100',
    totalPrincipal: 100000000,
    totalInterest: 10000000,
    totalAmount: 110000000,
    installmentCount: 12,
    startDate: '1403/01/01',
    intervalDays: 30,
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy: 'admin'
  };

  const stateWithBook: AppState = {
    ...baseState,
    installmentBooks: [activeBook]
  };

  const eligibilityA = checkCustomerCreditEligibility('1234567890', stateWithBook);
  assert(!eligibilityA.isEligible, 'Customer with active booklet should not be eligible');
  assert(eligibilityA.reasons.some(r => r.includes('دفترچه اقساط فعال')), 'Should state active booklet reason');

  // Test B
  console.log('\n[Test B] Active/Unsettled PartnerCreditRequest blocks finalizing a new CreditFile');
  const activePartnerRequest: PartnerCreditRequest = {
    id: 'PCR_1',
    businessPartnerId: 'BP_AGENT_A',
    branchId: 'B1',
    customerPersonId: 'P_CUST_1',
    status: PartnerCreditRequestStatus.SUBMITTED_BY_PARTNER,
    requestedAmount: 100000000,
    salePlanId: 'PLAN_1',
    termCount: 12,
    paymentPeriod: 30,
    documents: [],
    approvalHistory: [],
    createdAt: new Date().toISOString(),
    createdBy: 'agent_a'
  };

  const newCenterFile: CreditFile = {
    id: 'CF_NEW',
    personId: 'P_CUST_1',
    createdAt: new Date().toISOString(),
    status: 'pending',
    requestedAmount: 100000000,
    representativeId: 'CENTER',
    plan: 'PLAN_DEFAULT',
    agentCommissionAmount: 0,
    calculationResults: {
      creditAmount: 100000000,
      installmentCount: 12,
      installmentAmount: 10000000,
      totalCommission: 0,
      totalRepayment: 120000000
    }
  };

  const stateWithPCR: AppState = {
    ...baseState,
    creditFiles: [newCenterFile],
    partnerCreditRequests: [activePartnerRequest]
  };

  let threwB = false;
  try {
    finalizeCreditFile('CF_NEW', stateWithPCR);
  } catch (err: any) {
    threwB = true;
    assert(err.message.includes('پورتال همکاران'), 'Should throw cross-path guard error for active PartnerCreditRequest');
  }
  assert(threwB, 'Finalizing CreditFile should be blocked by active PartnerCreditRequest');

  // Test C
  console.log('\n[Test C] Parallel dossier finalization blocking');
  const pcrReq: PartnerCreditRequest = {
    id: 'PCR_PARALLEL',
    businessPartnerId: 'BP_AGENT_A',
    branchId: 'B1',
    customerPersonId: 'P_CUST_1',
    status: PartnerCreditRequestStatus.FINAL_APPROVED,
    requestedAmount: 100000000,
    salePlanId: 'PLAN_1',
    termCount: 12,
    paymentPeriod: 30,
    documents: [],
    approvalHistory: [],
    createdAt: new Date().toISOString(),
    createdBy: 'agent_a',
    calculationResults: {
      totalPayment: 120000000,
      totalInterest: 20000000,
      partnerCommission: 5000000,
      installmentAmount: 10000000,
      suggestedInstallments: [],
      calculatedAt: new Date().toISOString(),
      calculatedBy: 'agent_a'
    }
  };

  const cfFile: CreditFile = {
    id: 'CF_PARALLEL',
    personId: 'P_CUST_1',
    createdAt: new Date().toISOString(),
    status: 'pending',
    requestedAmount: 100000000,
    representativeId: 'CENTER',
    plan: 'PLAN_DEFAULT',
    agentCommissionAmount: 0,
    calculationResults: {
      creditAmount: 100000000,
      installmentCount: 12,
      installmentAmount: 10000000,
      totalCommission: 0,
      totalRepayment: 120000000
    }
  };

  const statePCRFirst: AppState = {
    ...baseState,
    creditFiles: [],
    partnerCreditRequests: [pcrReq]
  };
  const resultPCR = finalizePartnerCreditRequest('PCR_PARALLEL', statePCRFirst);
  const stateAfterPCR: AppState = {
    ...statePCRFirst,
    ...resultPCR,
    creditFiles: [cfFile]
  };

  let threwC1 = false;
  try {
    finalizeCreditFile('CF_PARALLEL', stateAfterPCR);
  } catch (err: any) {
    threwC1 = true;
    assert(err.message.includes('دفترچه اقساط فعال'), 'Blocked because PCR created active booklet');
  }
  assert(threwC1, 'CreditFile finalization should be blocked after PCR is finalized');

  // Test D
  console.log('\n[Test D] Fully settled previous dossier permits a new dossier');
  const settledBook: InstallmentBook = {
    id: 'IB_SETTLED',
    personId: 'P_CUST_1',
    creditFileId: 'CF_OLD',
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

  const stateSettled: AppState = {
    ...baseState,
    installmentBooks: [settledBook]
  };

  const eligibilityD = checkCustomerCreditEligibility('1234567890', stateSettled);
  assert(eligibilityD.isEligible, 'Customer with settled booklet should be eligible for new credit');

  // Test E
  console.log('\n[Test E] REJECTED or CANCELLED previous dossier permits a new dossier');
  const rejectedPCR: PartnerCreditRequest = {
    id: 'PCR_REJ',
    businessPartnerId: 'BP_AGENT_A',
    branchId: 'B1',
    customerPersonId: 'P_CUST_1',
    status: PartnerCreditRequestStatus.REJECTED,
    requestedAmount: 100000000,
    salePlanId: 'PLAN_1',
    termCount: 12,
    paymentPeriod: 30,
    documents: [],
    approvalHistory: [],
    createdAt: new Date().toISOString(),
    createdBy: 'agent_a'
  };

  const canceledCF: CreditFile = {
    id: 'CF_CANC',
    personId: 'P_CUST_1',
    createdAt: new Date().toISOString(),
    status: 'canceled',
    requestedAmount: 100000000,
    representativeId: 'CENTER',
    plan: 'PLAN_DEFAULT',
    agentCommissionAmount: 0
  };

  const stateRejected: AppState = {
    ...baseState,
    creditFiles: [canceledCF],
    partnerCreditRequests: [rejectedPCR]
  };

  const eligibilityE = checkCustomerCreditEligibility('1234567890', stateRejected);
  assert(eligibilityE.isEligible, 'Customer with rejected or canceled dossiers should be eligible');

  // Test F
  console.log('\n[Test F] Direct Head-Office credit does NOT consume agent capacity');
  const centerFileForCap: CreditFile = {
    id: 'CF_CENTER_1',
    personId: 'P_CUST_1',
    createdAt: new Date().toISOString(),
    status: 'approved',
    requestedAmount: 500000000, // 500M Rials direct center
    representativeId: 'CENTER',
    plan: 'PLAN_DEFAULT',
    agentCommissionAmount: 0
  };

  const stateCenterCap: AppState = {
    ...baseState,
    creditFiles: [centerFileForCap]
  };

  const agentCapF = calculatePartnerRemainingLimit('BP_AGENT_A', stateCenterCap);
  assert(agentCapF === 1000000000, 'Agent remaining limit should still be full 1B Rials (direct center credit does not consume agent limit)');

  // Test G
  console.log('\n[Test G] Agent credit consumes only that agent capacity');
  const agentRequestG: PartnerCreditRequest = {
    id: 'PCR_G',
    businessPartnerId: 'BP_AGENT_A',
    branchId: 'B1',
    customerPersonId: 'P_CUST_1',
    status: PartnerCreditRequestStatus.SUBMITTED_BY_PARTNER,
    requestedAmount: 300000000, // 300M Rials
    salePlanId: 'PLAN_1',
    termCount: 12,
    paymentPeriod: 30,
    documents: [],
    approvalHistory: [],
    createdAt: new Date().toISOString(),
    createdBy: 'agent_a'
  };

  const stateAgentCapG: AppState = {
    ...baseState,
    partnerCreditRequests: [agentRequestG]
  };

  const remainingG = calculatePartnerRemainingLimit('BP_AGENT_A', stateAgentCapG);
  assert(remainingG === 700000000, 'Agent capacity should be reduced from 1B to 700M by agent request');

  // Test H
  console.log('\n[Test H] Re-running finalize on the same dossier produces no duplicate vouchers or books');
  const idempotentCF: CreditFile = {
    id: 'CF_IDEMPOTENT',
    personId: 'P_CUST_1',
    createdAt: new Date().toISOString(),
    status: 'pending',
    requestedAmount: 100000000,
    representativeId: 'CENTER',
    plan: 'PLAN_DEFAULT',
    agentCommissionAmount: 0,
    calculationResults: {
      creditAmount: 100000000,
      installmentCount: 12,
      installmentAmount: 10000000,
      totalCommission: 0,
      totalRepayment: 120000000
    }
  };

  const stateIdempotent: AppState = {
    ...baseState,
    creditFiles: [idempotentCF]
  };

  const resultH1 = finalizeCreditFile('CF_IDEMPOTENT', stateIdempotent);
  const stateAfterH1: AppState = {
    ...stateIdempotent,
    ...resultH1
  };

  const booksCount1 = stateAfterH1.installmentBooks.length;
  const vouchersCount1 = stateAfterH1.vouchers.length;

  const resultH2 = finalizeCreditFile('CF_IDEMPOTENT', stateAfterH1);
  const stateAfterH2: AppState = {
    ...stateAfterH1,
    ...resultH2
  };

  const booksCount2 = stateAfterH2.installmentBooks.length;
  const vouchersCount2 = stateAfterH2.vouchers.length;

  assert(booksCount1 === booksCount2, 'Booklets count should not change on second finalize run');
  assert(vouchersCount1 === vouchersCount2, 'Vouchers count should not change on second finalize run');

  console.log('\n🎉 ALL 8 PARALLEL CREDIT & DEDUPLICATION GATES TESTS PASSED SUCCESSFULLY!');
}

// Auto-run if executed directly via tsx
runParallelCreditDeduplicationTests();
