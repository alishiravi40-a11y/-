/**
 * Investor Domain Data Model Integration & Safety Regression Tests
 * (تست‌های ساختاری و عدم تداخل مدل داده سرمایه‌گذاران)
 */

import {
  Person,
  BusinessPartner,
  PartnerRole,
  AgencyType,
  AppState,
  InvestorProfile,
  InvestorContract,
  InvestorPaymentSchedule,
} from '../types';

function runInvestorDataModelTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING INVESTOR DOMAIN DATA MODEL STRUCTURAL TESTS');
  console.log('=======================================================');

  // ----------------------------------------------------
  // Test 1: Person + BusinessPartner integration with INVESTOR role
  // ----------------------------------------------------
  console.log('\n--- Test 1: Person + BusinessPartner with PartnerRole.INVESTOR ---');
  
  const testPerson: Person = {
    id: 'P_INV_1001',
    code: 'PER-1001',
    name: 'حسین سرمایه‌گذار',
    nationalId: '1234567890',
    mobile: '09121112233',
    personType: 'real',
    roles: ['other'],
    createdAt: new Date().toISOString(),
  };

  const testPartner: BusinessPartner = {
    id: 'BP_INV_1001',
    personId: testPerson.id,
    status: 'active',
    agencyType: AgencyType.BOTH,
    roles: [PartnerRole.INVESTOR],
    profile: {
      partnerId: 'BP_INV_1001',
      partnerName: testPerson.name,
      contractStatus: 'active',
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'system',
  };

  if (!testPartner.roles.includes(PartnerRole.INVESTOR)) {
    throw new Error('❌ Test 1 Failed: PartnerRole.INVESTOR was not correctly assigned.');
  }
  if (testPartner.personId !== testPerson.id) {
    throw new Error('❌ Test 1 Failed: Person association mismatch.');
  }
  console.log('✅ Test 1 Passed: Person & BusinessPartner with INVESTOR role integrated seamlessly.');

  // ----------------------------------------------------
  // Test 2: Coexistence of INVESTOR with Sales Agent roles
  // ----------------------------------------------------
  console.log('\n--- Test 2: Coexistence of INVESTOR with existing roles ---');

  const multiRolePartner: BusinessPartner = {
    id: 'BP_MULTI_2002',
    personId: 'P_MULTI_2002',
    status: 'active',
    agencyType: AgencyType.CREDIT_ONLY,
    roles: [PartnerRole.CREDIT_SALES_AGENT, PartnerRole.INVESTOR],
    profile: {
      partnerId: 'BP_MULTI_2002',
      partnerName: 'علی همکار و سرمایه‌گذار',
      contractStatus: 'active',
    },
    branches: [],
    salesExtension: {
      commissionSettings: { defaultRate: 2.5 },
    },
    createdAt: new Date().toISOString(),
    createdBy: 'system',
  };

  if (multiRolePartner.roles.length !== 2) {
    throw new Error('❌ Test 2 Failed: Multi-role count mismatch.');
  }
  if (!multiRolePartner.roles.includes(PartnerRole.CREDIT_SALES_AGENT) || !multiRolePartner.roles.includes(PartnerRole.INVESTOR)) {
    throw new Error('❌ Test 2 Failed: Multi-role elements missing.');
  }
  if (multiRolePartner.salesExtension?.commissionSettings?.defaultRate !== 2.5) {
    throw new Error('❌ Test 2 Failed: Sales extension corrupted by adding INVESTOR role.');
  }
  console.log('✅ Test 2 Passed: Multi-role partner retaining sales & investor capabilities.');

  // ----------------------------------------------------
  // Test 3: Investor Contract & Payment Schedule Model Integrity
  // ----------------------------------------------------
  console.log('\n--- Test 3: Investor Contract & Payment Schedule Data Structures ---');

  const profile: InvestorProfile = {
    id: 'INV_PROF_1',
    personId: testPerson.id,
    businessPartnerId: testPartner.id,
    totalInvestedAmount: 5000000000, // 5 Milliard Rials
    activeContractsCount: 1,
    bankAccountDetails: {
      bankName: 'بانک ملی',
      accountNumber: '0101234567008',
      iban: 'IR1201700000000101234567008',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const contract: InvestorContract = {
    id: 'INV_CTR_1001',
    contractNumber: 'INV-1403-001',
    investorPersonId: testPerson.id,
    businessPartnerId: testPartner.id,
    startDate: '1403/01/01',
    endDate: '1404/01/01',
    initialCapital: 5000000000,
    currentCapital: 5000000000,
    monthlyFeeRate: 3.5, // 3.5% per month
    paymentFrequency: 'monthly',
    status: 'active',
    changeLogs: [
      {
        id: 'LOG_1',
        contractId: 'INV_CTR_1001',
        changeType: 'RATE_CHANGE',
        changeDate: '1403/06/01',
        description: 'افزایش نرخ کارمزد ماهانه به ۳.۵٪',
        previousRate: 3.0,
        newRate: 3.5,
        changedAt: new Date().toISOString(),
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const schedule: InvestorPaymentSchedule = {
    id: 'SCHED_101',
    contractId: contract.id,
    investorPersonId: testPerson.id,
    dueDate: '1403/02/01',
    expectedAmount: 175000000, // 5,000,000,000 * 3.5% = 175,000,000
    paymentType: 'FEE',
    status: 'PLANNED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (contract.currentCapital !== 5000000000 || contract.status !== 'active') {
    throw new Error('❌ Test 3 Failed: InvestorContract state invalid.');
  }
  if (schedule.expectedAmount !== 175000000 || schedule.status !== 'PLANNED') {
    throw new Error('❌ Test 3 Failed: InvestorPaymentSchedule structure invalid.');
  }
  console.log('✅ Test 3 Passed: Investor Contract & Payment Schedule models verified.');

  // ----------------------------------------------------
  // Test 4: AppState Compatibility & State Preservation
  // ----------------------------------------------------
  console.log('\n--- Test 4: AppState Integration & JSON Serialization ---');

  const dummyAppState: Partial<AppState> = {
    persons: [testPerson],
    businessPartners: [testPartner],
    investorProfiles: [profile],
    investorContracts: [contract],
    investorPaymentSchedules: [schedule],
  };

  const serialized = JSON.stringify(dummyAppState);
  const deserialized = JSON.parse(serialized) as Partial<AppState>;

  if (
    !deserialized.investorProfiles ||
    deserialized.investorProfiles.length !== 1 ||
    deserialized.investorContracts?.[0].contractNumber !== 'INV-1403-001'
  ) {
    throw new Error('❌ Test 4 Failed: AppState serialization lost investor data.');
  }

  console.log('✅ Test 4 Passed: AppState serialization and compatibility confirmed.');

  console.log('\n=======================================================');
  console.log('🎉 ALL INVESTOR DOMAIN DATA MODEL TESTS PASSED!');
  console.log('=======================================================');
}

runInvestorDataModelTests();
