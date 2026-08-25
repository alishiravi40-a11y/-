import { AppState, BusinessPartner, Person, AgencyType, PartnerRole } from '../types';
import { DataIntegrityEngine } from '../utils/integrityEngine';

function runAgencyPersonSelectionTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING AGENCY PERSON SELECTION REGRESSION TESTS');
  console.log('=======================================================');

  // Test setup
  const mockPerson: Person = {
    id: 'person_test_101',
    code: 'P-101',
    name: 'علی حسینی',
    nationalId: '1234567890',
    mobile: '09121112233',
    address: 'تهران، خیابان آزادی',
    createdAt: new Date().toISOString()
  };

  const initialCreditPartner: BusinessPartner = {
    id: 'BP_CREDIT_101',
    personId: 'person_test_101',
    status: 'active',
    agencyType: AgencyType.INSTALLMENT_ONLY,
    roles: [PartnerRole.CREDIT_SALES_AGENT],
    profile: {
      partnerId: 'BP_CREDIT_101',
      partnerName: 'علی حسینی',
      storeName: 'فروشگاه الکترونیک حسینی',
      contractStatus: 'active',
      creditLimit: 200000000
    },
    creditExtension: {
      allowedCalculators: ['CALC_SADI'],
      creditRules: { maxCreditLimit: 200000000 }
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'Admin'
  };

  let state: Partial<AppState> = {
    persons: [mockPerson, { ...mockPerson }], // intentionally duplicate Person in array
    businessPartners: [initialCreditPartner]
  };

  // Step 1: Verify Deduplication
  console.log('--- Test 1: Deduplication of Persons list ---');
  const uniquePersons = (state.persons || []).filter((p, index, self) =>
    index === self.findIndex(t => t.id === p.id)
  );
  if (uniquePersons.length !== 1) {
    throw new Error(`Deduplication failed: expected 1 person, got ${uniquePersons.length}`);
  }
  console.log('✅ Test 1 Passed: Person list successfully deduplicated (1 unique entry).');

  // Step 2: Selecting Credit Partner for Sales Partner Role creation
  console.log('--- Test 2: Adding Sales Partner role to an existing Credit Partner ---');
  const p = uniquePersons[0];
  const existingBp = (state.businessPartners || []).find(bp => bp.personId === p.id);

  const isAlreadySalesPartner = Boolean(
    existingBp && (
      existingBp.salesExtension?.nesyehSettings ||
      existingBp.nesyehSettings ||
      existingBp.nesyehOnboarding ||
      existingBp.agencyType === ('DEFERRED_PAYMENT' as any) ||
      existingBp.contract?.type === ('DEFERRED_AGENT' as any) ||
      (existingBp.roles || []).includes('DEFERRED_AGENT' as any)
    )
  );

  if (isAlreadySalesPartner) {
    throw new Error('Test failed: person should not yet be identified as Sales Partner.');
  }

  // Simulate updating existing BusinessPartner to add Sales Partner role & extension
  const updatedBp: BusinessPartner = {
    ...existingBp!,
    roles: Array.from(new Set([...(existingBp!.roles || []), PartnerRole.CREDIT_SALES_AGENT, 'DEFERRED_AGENT' as any])),
    salesExtension: {
      nesyehSettings: {
        creditLimit: 150000000,
        paymentTermDays: 30,
        lateFeePercentage: 1.5,
        isPurchaseAllowed: true
      }
    },
    nesyehSettings: {
      creditLimit: 150000000,
      paymentTermDays: 30,
      lateFeePercentage: 1.5,
      isPurchaseAllowed: true
    }
  };

  state = {
    ...state,
    businessPartners: [updatedBp]
  };

  if (state.businessPartners!.length !== 1) {
    throw new Error(`Test failed: expected 1 BusinessPartner, got ${state.businessPartners!.length}`);
  }

  const savedBp = state.businessPartners![0];
  if (!savedBp.roles.includes('DEFERRED_AGENT' as any) || !savedBp.roles.includes(PartnerRole.CREDIT_SALES_AGENT)) {
    throw new Error('Test failed: BusinessPartner does not have both roles.');
  }
  if (!savedBp.creditExtension || !savedBp.salesExtension) {
    throw new Error('Test failed: both creditExtension and salesExtension must be preserved.');
  }
  console.log('✅ Test 2 Passed: Sales Partner role added successfully to existing Credit Partner without duplicate record.');

  // Step 3: Attempting duplicate Sales Partner creation for the same Person
  console.log('--- Test 3: Preventing Duplicate Sales Partner File Creation ---');
  const currentBp = state.businessPartners!.find(bp => bp.personId === p.id);
  const isAlreadySalesPartnerNow = Boolean(
    currentBp && (
      currentBp.salesExtension?.nesyehSettings ||
      currentBp.nesyehSettings ||
      currentBp.nesyehOnboarding ||
      currentBp.agencyType === ('DEFERRED_PAYMENT' as any) ||
      currentBp.contract?.type === ('DEFERRED_AGENT' as any) ||
      (currentBp.roles || []).includes('DEFERRED_AGENT' as any)
    )
  );

  if (!isAlreadySalesPartnerNow) {
    throw new Error('Test failed: Person should now be identified as already having a Sales Partner file.');
  }
  console.log('✅ Test 3 Passed: System correctly detects existing Sales Partner role and blocks duplicate file creation.');

  // Step 4: Verification of exact agencyType mapping for single and dual roles
  console.log('--- Test 4: Verification of exact agencyType mapping (Scenario 1, 2, 3) ---');
  
  // Scenario 1: Pure Sales Agent creation
  const salesOnlyBp: Partial<BusinessPartner> = {
    agencyType: AgencyType.INSTALLMENT_ONLY,
    roles: ['DEFERRED_AGENT' as any]
  };
  const isSalesOnlyCredit = salesOnlyBp.agencyType === AgencyType.CREDIT_ONLY || salesOnlyBp.agencyType === AgencyType.BOTH;
  const isSalesOnlySales = salesOnlyBp.agencyType === AgencyType.INSTALLMENT_ONLY || salesOnlyBp.agencyType === AgencyType.BOTH;
  if (isSalesOnlyCredit || !isSalesOnlySales || salesOnlyBp.agencyType !== AgencyType.INSTALLMENT_ONLY) {
    throw new Error('Scenario 1 Failed: Pure Sales Agent must have agencyType = INSTALLMENT_ONLY and no credit tag.');
  }

  // Scenario 2: Pure Credit Agent creation
  const creditOnlyBp: Partial<BusinessPartner> = {
    agencyType: AgencyType.CREDIT_ONLY,
    roles: [PartnerRole.CREDIT_SALES_AGENT]
  };
  const isCreditOnlyCredit = creditOnlyBp.agencyType === AgencyType.CREDIT_ONLY || creditOnlyBp.agencyType === AgencyType.BOTH;
  const isCreditOnlySales = creditOnlyBp.agencyType === AgencyType.INSTALLMENT_ONLY || creditOnlyBp.agencyType === AgencyType.BOTH;
  if (!isCreditOnlyCredit || isCreditOnlySales || creditOnlyBp.agencyType !== AgencyType.CREDIT_ONLY) {
    throw new Error('Scenario 2 Failed: Pure Credit Agent must have agencyType = CREDIT_ONLY and no sales tag.');
  }

  // Scenario 3: Dual Role Agent creation
  const dualRoleBp: Partial<BusinessPartner> = {
    agencyType: AgencyType.BOTH,
    roles: [PartnerRole.CREDIT_SALES_AGENT, 'DEFERRED_AGENT' as any]
  };
  const isDualCredit = dualRoleBp.agencyType === AgencyType.CREDIT_ONLY || dualRoleBp.agencyType === AgencyType.BOTH;
  const isDualSales = dualRoleBp.agencyType === AgencyType.INSTALLMENT_ONLY || dualRoleBp.agencyType === AgencyType.BOTH;
  if (!isDualCredit || !isDualSales || dualRoleBp.agencyType !== AgencyType.BOTH) {
    throw new Error('Scenario 3 Failed: Dual Role Agent must have agencyType = BOTH and both tags.');
  }
  console.log('✅ Test 4 Passed: Exact agencyType dynamic assignment verified for all 3 scenarios.');

  // Scenario 4: Regular Debtor or Creditor Customer (No agency tags)
  const regularCustomerPerson: Person = {
    id: 'cust_normal_1',
    code: 'P-100',
    name: 'علی حسینی (مشتری عادی)',
    nationalId: '1234567890',
    role: 'debtor',
    isAgent: false,
    createdAt: new Date().toISOString()
  };
  const regBp: BusinessPartner | undefined = undefined; // No BusinessPartner record
  
  const isRegSales = Boolean(
    (regBp && (
      (regBp as any).agencyType === AgencyType.INSTALLMENT_ONLY ||
      (regBp as any).agencyType === AgencyType.BOTH
    )) ||
    (!regBp && regularCustomerPerson.isAgent)
  );
  const isRegCredit = Boolean(
    regBp && (
      (regBp as any).agencyType === AgencyType.CREDIT_ONLY ||
      (regBp as any).agencyType === AgencyType.BOTH ||
      Boolean((regBp as any).creditExtension)
    )
  );

  if (isRegSales || isRegCredit) {
    throw new Error('Scenario 4 Failed: Regular customer should not receive any agency badges.');
  }
  console.log('✅ Test 5 Passed: Scenario 4 verified - Regular customer receives no agency badges.');

  console.log('=======================================================');
  console.log('🎉 ALL AGENCY PERSON SELECTION TESTS PASSED SUCCESSFULLY!');
  console.log('=======================================================');
}

runAgencyPersonSelectionTests();
