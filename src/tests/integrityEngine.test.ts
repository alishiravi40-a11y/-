import {
  SystemState,
  EventBus,
  TraceLogger,
  ImpactAnalyzer,
  IntegrityGuard,
  LifecycleManager,
  DataIntegrityEngine,
  SystemEvent
} from '../utils/integrityEngine';
import {
  Person,
  BusinessPartner,
  Invoice,
  JournalVoucher,
  Check,
  InstallmentBook,
  Installment,
  NesyehPurchaseOrder,
  NesyehPaymentDeclaration,
  NesyehOrderableItem,
  User,
  AgencyType,
  PartnerRole
} from '../types';

// Mock system state generator for isolation
function createInitialMockState(): SystemState {
  const dummyPerson1: Person = {
    id: 'pers_101',
    code: 'P1001',
    name: 'علی تقوی',
    nationalId: '1234567890',
    isAgent: true,
    role: 'debtor',
    isDocumentsApproved: true,
    createdAt: new Date().toISOString()
  };

  const dummyPerson2: Person = {
    id: 'pers_102',
    code: 'P1002',
    name: 'سارا کریمی',
    nationalId: '0987654321',
    isAgent: false,
    role: 'debtor',
    isDocumentsApproved: true,
    createdAt: new Date().toISOString()
  };

  const dummyPartner: BusinessPartner = {
    id: 'part_501',
    personId: 'pers_101',
    status: 'active',
    agencyType: AgencyType.BOTH,
    roles: [PartnerRole.CREDIT_SALES_AGENT],
    profile: {
      partnerId: 'part_501',
      contractStatus: 'active'
    },
    branches: [],
    nesyehOnboarding: {
      onboardingStatus: 'ACTIVE',
      guarantees: [
        {
          id: 'guar_1',
          type: 'CHECK',
          amount: 500000000,
          createdAt: new Date().toISOString()
        }
      ],
      statusHistory: []
    },
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  };

  const dummyUser: User = {
    id: 'usr_201',
    name: 'علی تقوی (نماینده)',
    username: 'ali_taghavi',
    password: 'password123',
    role: 'agent',
    allowedWarehouseIds: ['wh_main'],
    defaultWarehouseId: 'wh_main',
    personId: 'pers_101',
    createdAt: new Date().toISOString()
  };

  return {
    persons: [dummyPerson1, dummyPerson2],
    businessPartners: [dummyPartner],
    invoices: [],
    vouchers: [],
    checks: [],
    installmentBooks: [],
    installments: [],
    nesyehCatalog: [],
    nesyehPurchaseOrders: [],
    nesyehPaymentDeclarations: [],
    users: [dummyUser]
  };
}

function runIntegrityEngineTests() {
  console.log("\n=======================================================");
  console.log("🚀 STARTING DATA INTEGRITY ENGINE & LIFECYCLE SUITE TESTS");
  console.log("=======================================================\n");

  const state = createInitialMockState();

  // -------------------------------------------------------------
  // SUITE 1: Event Bus & Trace Logger Verification
  // -------------------------------------------------------------
  console.log("--- Suite 1: Event Bus & Trace Logger ---");
  const bus = EventBus.getInstance();
  const logger = TraceLogger.getInstance();

  bus.clear();
  logger.clear();

  let eventFiredCount: number = 0;
  let receivedPayload: any = null;

  const unsubscribe = bus.subscribe('PERSON_CREATED', (e: SystemEvent) => {
    eventFiredCount++;
    receivedPayload = e.payload;
  });

  const dummyEvent: SystemEvent = {
    id: 'evt_test',
    timestamp: new Date().toISOString(),
    type: 'PERSON_CREATED',
    payload: { id: 'p_test', name: 'تست' },
    traceId: 'TRC_TEST'
  };

  bus.publish(dummyEvent);

  if (eventFiredCount !== 1 || receivedPayload?.id !== 'p_test') {
    throw new Error('Test 1.1 Failed: Event Bus did not publish event or subscription failed.');
  }

  // Test wildcard subscription
  let wildcardCount = 0;
  bus.subscribe('*', () => {
    wildcardCount++;
  });

  bus.publish(dummyEvent);
  if (wildcardCount !== 1) {
    throw new Error('Test 1.2 Failed: Wildcard subscriber failed to trigger.');
  }

  unsubscribe();
  bus.publish(dummyEvent);
  if ((eventFiredCount as number) !== 2) {
    throw new Error('Test 1.3 Failed: Unsubscription failed. Event fired when it shouldn\'t.');
  }

  // Verify Trace Logger size boundaries
  for (let i = 0; i < 1005; i++) {
    logger.log({
      id: `l_${i}`,
      timestamp: new Date().toISOString(),
      traceId: `T_${i}`,
      action: 'TEST',
      entityType: 'Test',
      entityId: `id_${i}`,
      status: 'success',
      steps: []
    });
  }
  const loggedHistory = logger.getLogs();
  if (loggedHistory.length > 1000) {
    throw new Error(`Test 1.4 Failed: TraceLogger capacity should be bounded to 1000. Got ${loggedHistory.length}`);
  }

  console.log("✅ Suite 1 Passed: Event Bus and Trace Logger operating successfully.");

  // -------------------------------------------------------------
  // SUITE 2: Integrity Guard Validations
  // -------------------------------------------------------------
  console.log("\n--- Suite 2: Integrity Guard Validations ---");

  // A. Double-Entry Balance check
  const balancedVoucher: JournalVoucher = {
    id: 'v_1',
    voucherNumber: 1,
    date: '1403/01/01',
    gregorianDate: new Date().toISOString(),
    description: 'سند متعادل',
    isAutomatic: true,
    entries: [
      { subsidiaryId: 'SUB_DEBTORS', debit: 1000, credit: 0 },
      { subsidiaryId: 'SUB_REVENUE', debit: 0, credit: 1000 }
    ]
  };

  const unbalancedVoucher: JournalVoucher = {
    id: 'v_2',
    voucherNumber: 2,
    date: '1403/01/01',
    gregorianDate: new Date().toISOString(),
    description: 'سند نامتعادل',
    isAutomatic: true,
    entries: [
      { subsidiaryId: 'SUB_DEBTORS', debit: 1000, credit: 0 },
      { subsidiaryId: 'SUB_REVENUE', debit: 0, credit: 950 }
    ]
  };

  if (!IntegrityGuard.verifyVoucherBalance(balancedVoucher)) {
    throw new Error('Test 2.1 Failed: Balanced voucher marked as unbalanced.');
  }

  if (IntegrityGuard.verifyVoucherBalance(unbalancedVoucher)) {
    throw new Error('Test 2.2 Failed: Unbalanced voucher marked as balanced.');
  }

  // B. Code Uniqueness
  const duplicatePersonCode: Partial<Person> = {
    id: 'pers_new',
    code: 'P1001', // already taken by dummyPerson1
    name: 'رضا امینی'
  };
  const personCodeErrors = IntegrityGuard.validatePerson(duplicatePersonCode, state, false);
  if (personCodeErrors.length === 0 || !personCodeErrors[0].includes('کد شخص تکراری است')) {
    throw new Error('Test 2.3 Failed: Duplicate person code constraint failed to trigger.');
  }

  // C. National ID uniqueness
  const duplicateNationalId: Partial<Person> = {
    id: 'pers_new2',
    code: 'P1003',
    name: 'حسین نوری',
    nationalId: '1234567890' // taken by pers_101
  };
  const nationalIdErrors = IntegrityGuard.validatePerson(duplicateNationalId, state, false);
  if (nationalIdErrors.length === 0 || !nationalIdErrors[0].includes('کد ملی تکراری است')) {
    throw new Error('Test 2.4 Failed: Duplicate national ID constraint failed to trigger.');
  }

  console.log("✅ Suite 2 Passed: Integrity Guard validated uniqueness constraints and ledger balance.");

  // -------------------------------------------------------------
  // SUITE 3: Lifecycle Management Transitions
  // -------------------------------------------------------------
  console.log("\n--- Suite 3: Lifecycle Management ---");

  const partnerDraft = state.businessPartners[0]; // Currently Active, OnboardingStatus: ACTIVE

  // Test illegal transition (e.g., ACTIVE back to DRAFT directly)
  const illegalTransition = LifecycleManager.validateOnboardingTransition(partnerDraft, 'DRAFT');
  if (illegalTransition.allowed) {
    throw new Error('Test 3.1 Failed: Allowed illegal state transition from ACTIVE to DRAFT.');
  }

  // Test legal transition (ACTIVE to SUSPENDED)
  const legalTransition = LifecycleManager.validateOnboardingTransition(partnerDraft, 'SUSPENDED');
  if (!legalTransition.allowed) {
    throw new Error(`Test 3.2 Failed: Blocked valid state transition ACTIVE -> SUSPENDED. Error: ${legalTransition.error}`);
  }

  // Test moving to ACTIVE without guarantees
  const partnerNoGuarantees: BusinessPartner = {
    ...partnerDraft,
    nesyehOnboarding: {
      onboardingStatus: 'MANAGER_APPROVED',
      guarantees: [], // Empty guarantees!
      statusHistory: []
    }
  };
  const blockedActivate = LifecycleManager.validateOnboardingTransition(partnerNoGuarantees, 'ACTIVE');
  if (blockedActivate.allowed) {
    throw new Error('Test 3.3 Failed: Allowed activation of agent onboarding profile without guarantees.');
  }

  console.log("✅ Suite 3 Passed: Lifecycle Manager successfully blocks invalid transitions & validates activation dependencies.");

  // -------------------------------------------------------------
  // SUITE 4: Impact Analysis Engine
  // -------------------------------------------------------------
  console.log("\n--- Suite 4: Impact Analysis Engine ---");

  // Case A: Safe deletion of Person (no invoices, vouchers, books, etc.)
  const safeDeleteReport = ImpactAnalyzer.analyze('delete', 'Person', 'pers_102', state);
  if (!safeDeleteReport.isSafe) {
    throw new Error(`Test 4.1 Failed: Person 102 should be completely safe to delete. Blocks: ${JSON.stringify(safeDeleteReport.blocks)}`);
  }

  // Case B: Blocked deletion of Person due to Financial Invoice Dependencies
  const stateWithInvoice: SystemState = {
    ...state,
    invoices: [
      {
        id: 'inv_1',
        invoiceNumber: 1,
        type: 'sell',
        isProInvoice: false,
        isConverted: false,
        date: '1403/01/01',
        personId: 'pers_101', // Linked to pers_101
        items: [],
        discount: 0,
        taxPercent: 0,
        totalAmount: 100000,
        paidAmount: 0,
        createdAt: new Date().toISOString(),
        status: 'active'
      }
    ]
  };
  const blockedDeleteReport = ImpactAnalyzer.analyze('delete', 'Person', 'pers_101', stateWithInvoice);
  if (blockedDeleteReport.isSafe) {
    throw new Error('Test 4.2 Failed: Allowed deletion of Person linked to a sales invoice.');
  }
  const invoiceBlock = blockedDeleteReport.blocks.some(b => b.reason.includes('فاکتورهای مالی'));
  if (!invoiceBlock) {
    throw new Error('Test 4.3 Failed: Correct block message not populated for invoice dependencies.');
  }

  // Case C: Warning about Orphan business partner when deleting Person
  const warningDeleteReport = ImpactAnalyzer.analyze('delete', 'Person', 'pers_101', state); // pers_101 has a BusinessPartner in this state
  if (!warningDeleteReport.isSafe) {
    throw new Error('Test 4.4 Failed: Blocked deletion of Person due to warning when it should be safe (only warning).');
  }
  const hasOrphanWarning = warningDeleteReport.blocks.some(b => b.severity === 'warning' && b.reason.includes('همکار تجاری'));
  const hasBusinessPartnerAffected = warningDeleteReport.affectedEntities.some(e => e.entityType === 'BusinessPartner');
  if (!hasOrphanWarning || !hasBusinessPartnerAffected) {
    throw new Error('Test 4.5 Failed: Warning report did not record BusinessPartner orphan risk or cascade action.');
  }

  console.log("✅ Suite 4 Passed: Impact Analyzer correctly identifies relational dependencies and blocks unsafe modifications.");

  // -------------------------------------------------------------
  // SUITE 5: Data Integrity Engine (CRUD + Cascades Pipeline)
  // -------------------------------------------------------------
  console.log("\n--- Suite 5: Data Integrity Engine Execution Pipeline ---");
  const engine = new DataIntegrityEngine();

  // Test 5.1: Create Person
  const newPerson: Person = {
    id: 'pers_103',
    code: 'P1003',
    name: 'نیما یوشیج',
    nationalId: '1122334455',
    createdAt: new Date().toISOString()
  };

  const createResult = engine.createPerson(newPerson, state);
  if (!createResult.success) {
    throw new Error(`Test 5.1 Failed: Could not create valid person. Errors: ${createResult.errors}`);
  }
  if (!createResult.updatedState.persons.some(p => p.id === 'pers_103')) {
    throw new Error('Test 5.1 Failed: New state is missing the created person.');
  }
  if (createResult.traceLog.status !== 'success' || createResult.traceLog.action !== 'CREATE_PERSON') {
    throw new Error('Test 5.1 Failed: Incorrect trace log generated.');
  }

  // Test 5.2: Catch Duplicates on Create
  const duplicateCreateResult = engine.createPerson({
    id: 'pers_104',
    code: 'P1001', // Duplicate code!
    name: 'سهراب سپهری',
    createdAt: new Date().toISOString()
  }, state);

  if (duplicateCreateResult.success) {
    throw new Error('Test 5.2 Failed: Engine permitted creating a person with duplicate code.');
  }
  if (duplicateCreateResult.traceLog.status !== 'failed' || !duplicateCreateResult.errors) {
    throw new Error('Test 5.2 Failed: No failure trace log or error descriptions returned.');
  }

  // Test 5.3: Change Person Status with Cascading Suspensions
  // We want to suspend pers_101. It should automatically deactivate their linked BusinessPartner (part_501) and User (usr_201).
  const suspensionResult = engine.changePersonStatus('pers_101', false, state); // isApproved = false (Suspend)
  if (!suspensionResult.success) {
    throw new Error(`Test 5.3 Failed: Suspended person operation returned error. ${suspensionResult.errors}`);
  }

  const updatedPartner = suspensionResult.updatedState.businessPartners.find(bp => bp.id === 'part_501');
  const updatedUser = suspensionResult.updatedState.users.find(u => u.id === 'usr_201');

  if (updatedPartner?.status !== 'inactive') {
    throw new Error(`Test 5.3 Failed: Cascade deactivation failed for Business Partner. Current status: ${updatedPartner?.status}`);
  }
  if (updatedUser?.allowedWarehouseIds && updatedUser.allowedWarehouseIds.length !== 0) {
    throw new Error('Test 5.3 Failed: Cascade suspension failed for linked User permissions.');
  }

  // Verify Trace Log has recorded steps
  const stepsRecorded = suspensionResult.traceLog.steps;
  const bpDeactivatedStep = stepsRecorded.some(s => s.target.includes('BusinessPartner') && s.status === 'updated');
  const userSuspendedStep = stepsRecorded.some(s => s.target.includes('User') && s.status === 'updated');

  if (!bpDeactivatedStep || !userSuspendedStep) {
    throw new Error('Test 5.3 Failed: Cascade steps were not transparently documented in the Trace Log.');
  }

  // Test 5.4: Deactivate BusinessPartner cascades to Orders
  // If we deactivate part_501, any of their pending orders should automatically cancel/suspend.
  const stateWithOrders: SystemState = {
    ...state,
    nesyehPurchaseOrders: [
      {
        id: 'ord_1',
        orderNumber: 'ORD-1001',
        partnerId: 'part_501',
        partnerName: 'علی تقوی',
        orderDate: '1403/01/01',
        items: [],
        totalAmount: 500000,
        status: 'SUBMITTED', // Pending review order
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'ord_2',
        orderNumber: 'ORD-1002',
        partnerId: 'part_501',
        partnerName: 'علی تقوی',
        orderDate: '1403/01/01',
        items: [],
        totalAmount: 1200000,
        status: 'CONVERTED_TO_INVOICE', // Already finalized - shouldn't change
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]
  };

  const partnerDeactivation = engine.changePartnerStatus('part_501', 'SUSPENDED', stateWithOrders);
  if (!partnerDeactivation.success) {
    throw new Error(`Test 5.4 Failed: SUSPENDED partner transition errored: ${partnerDeactivation.errors}`);
  }

  const ord1 = partnerDeactivation.updatedState.nesyehPurchaseOrders.find(o => o.id === 'ord_1');
  const ord2 = partnerDeactivation.updatedState.nesyehPurchaseOrders.find(o => o.id === 'ord_2');

  if (ord1?.status !== 'CANCELLED') {
    throw new Error(`Test 5.4 Failed: Active purchase order was not suspended on partner deactivation. Status: ${ord1?.status}`);
  }
  if (ord2?.status !== 'CONVERTED_TO_INVOICE') {
    throw new Error(`Test 5.4 Failed: Already finalized purchase order was wrongly modified. Status: ${ord2?.status}`);
  }

  console.log("✅ Suite 5 Passed: Data Integrity Engine orchestrates CRUD operations, triggers cascades, and creates detailed Trace Logs.");

  // -------------------------------------------------------------
  // SUITE 6: BusinessPartner Onboarding & Synchronization
  // -------------------------------------------------------------
  console.log("\n--- Suite 6: BusinessPartner Onboarding & Synchronization ---");

  const newPartnerId = 'part_999';
  const newPersonId = 'pers_999';
  const brandNewPartner: BusinessPartner = {
    id: newPartnerId,
    personId: newPersonId,
    status: 'active',
    agencyType: AgencyType.INSTALLMENT_ONLY,
    roles: [PartnerRole.CREDIT_SALES_AGENT],
    profile: {
      partnerId: newPartnerId,
      partnerName: 'سهراب سپهری',
      storeName: 'کتاب‌فروشی سهراب',
      contractStatus: 'active',
      creditLimit: 50000000
    },
    branches: [],
    nesyehSettings: {
      creditLimit: 50000000,
      paymentTermDays: 30,
      lateFeePercentage: 2,
      isPurchaseAllowed: true
    },
    createdAt: new Date().toISOString(),
    createdBy: 'Admin'
  };

  const partnerCreationResult = engine.createBusinessPartner(brandNewPartner, state);
  if (!partnerCreationResult.success) {
    throw new Error(`Test 6.1 Failed: Could not create partner. Errors: ${partnerCreationResult.errors}`);
  }

  const syncedPerson = partnerCreationResult.updatedState.persons.find(p => p.id === newPersonId);
  if (!syncedPerson) {
    throw new Error('Test 6.1 Failed: Engine did not automatically create the corresponding Person record!');
  }
  if (syncedPerson.name !== 'سهراب سپهری') {
    throw new Error('Test 6.1 Failed: Synced Person has incorrect name.');
  }

  // Test 6.2: Updating BusinessPartner synchronizes Person identity properties (name, storeName, isDocumentsApproved)
  const updatedPartnerDetails = {
    profile: {
      ...brandNewPartner.profile,
      partnerName: 'سهراب سپهری کاشانی'
    },
    creditExtension: {
      creditRules: {
        maxCreditLimit: 75000000,
        defaultInstallmentDays: 30,
        penaltyRatePerMonth: 0.1
      }
    },
    nesyehOnboarding: {
      onboardingStatus: 'ACTIVE' as any,
      guarantees: [],
      statusHistory: []
    }
  };

  const partnerUpdateResult = engine.updateBusinessPartner(newPartnerId, updatedPartnerDetails, partnerCreationResult.updatedState);
  if (!partnerUpdateResult.success) {
    throw new Error(`Test 6.2 Failed: Partner update failed. Errors: ${partnerUpdateResult.errors}`);
  }

  const updatedSyncedPerson = partnerUpdateResult.updatedState.persons.find(p => p.id === newPersonId);
  if (!updatedSyncedPerson) {
    throw new Error('Test 6.2 Failed: Synced Person went missing.');
  }
  if (updatedSyncedPerson.name !== 'سهراب سپهری کاشانی') {
    throw new Error(`Test 6.2 Failed: Person identity synchronization fields did not update. Name: ${updatedSyncedPerson.name}`);
  }

  // Test 6.3: Unassigning/Deleting Sales BusinessPartner role without financial activity
  const partnerDeletionResult = engine.deleteBusinessPartner(newPartnerId, partnerUpdateResult.updatedState);
  if (!partnerDeletionResult.success) {
    throw new Error(`Test 6.3 Failed: Could not unassign partner role. Errors: ${partnerDeletionResult.errors}`);
  }

  const deletedPartnerExist = partnerDeletionResult.updatedState.businessPartners.some(bp => bp.id === newPartnerId);
  if (deletedPartnerExist) {
    throw new Error('Test 6.3 Failed: Partner role record still exists in the list after unassigning.');
  }

  const personStillExists = partnerDeletionResult.updatedState.persons.find(p => p.id === newPersonId);
  if (!personStillExists) {
    throw new Error('Test 6.3 Failed: Reference Person record was wrongly deleted when unassigning agent role.');
  }
  if (personStillExists.isAgent) {
    throw new Error('Test 6.3 Failed: Person isAgent flag was not updated to false after role unassignment.');
  }

  console.log("✅ Suite 6 Passed: BusinessPartner lifecycle operations are secure and Person records are dynamically kept in absolute sync.");

  console.log("\n=======================================================");
  console.log("🎉 ALL DATA INTEGRITY ENGINE REGRESSION TESTS PASSED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runIntegrityEngineTests();
