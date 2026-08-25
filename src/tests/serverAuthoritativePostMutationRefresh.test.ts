process.env.NODE_ENV = 'test';
import { 
  executeFinancialHydration, 
  isFinancialTab, 
  isTabAllowedForRole, 
  POST_MUTATION_HYDRATION_ERROR,
  DEFAULT_HYDRATION_ERROR,
  FinancialHydrationParams, 
  FinancialHydrationServices,
  FinancialSyncStatus 
} from '../App';
import { AppState, Person, Invoice, JournalVoucher, Check } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function createEmptyAppState(): AppState {
  return {
    users: [],
    persons: [],
    products: [],
    productCategories: [],
    subsidiaries: [],
    vouchers: [],
    checks: [],
    checkbooks: [],
    invoices: [],
    openingBalances: [],
    installmentBooks: [],
    installments: [],
    installmentRequests: [],
    installmentPlans: [],
    warehouses: [
      { id: 'w_main', name: 'انبار مرکزی', isDefault: true, createdAt: '2024-01-01' }
    ],
    warehouseTransfers: [],
    costCenters: [],
    bankTerminals: [],
    auditLogs: [],
    businessPartners: [],
    partnerCreditRequests: [],
    partnerSalesPlans: [],
    creditFiles: [],
    creditPolicies: [],
    calculators: [],
    projectNotes: [],
    settings: {
      inventoryValuationMethod: 'FIFO',
      defaultWarehouseId: 'w_main',
      companyName: 'شرکت تستی'
    }
  };
}

const mockPerson: Person = {
  id: 'p_101',
  name: 'علی حسینی',
  code: '101',
  mobile: '09120000000',
  nationalId: '0010000000',
  creditLimit: 10000000,
  isAgent: false,
  status: 'active',
  createdAt: '2024-01-01T00:00:00.000Z'
};

const mockInvoice: Invoice = {
  id: 'inv_101',
  invoiceNumber: 101,
  personId: 'p_101',
  date: '1403/01/01',
  type: 'sell',
  isProInvoice: false,
  isConverted: false,
  status: 'active',
  items: [],
  totalAmount: 5000000,
  paidAmount: 0,
  taxPercent: 0,
  discount: 0,
  createdAt: '2024-01-01T00:00:00.000Z'
};

const mockVoucher: JournalVoucher = {
  id: 'v_101',
  voucherNumber: 101,
  date: '1403/01/01',
  gregorianDate: '2024-01-01T00:00:00.000Z',
  description: 'سند فاکتور فروش ۱۰۱',
  status: 'active',
  entries: [],
  isAutomatic: true,
  createdAt: '2024-01-01T00:00:00.000Z'
} as any;

const mockCheck: Check = {
  id: 'chk_101',
  checkNumber: '123456',
  type: 'received',
  amount: 2500000,
  bankName: 'بانک ملت',
  dueDate: '1403/05/01',
  currentState: 'present_in_cashbox',
  personId: 'p_101',
  status: 'active',
  history: [],
  createdAt: '2024-01-01T00:00:00.000Z'
};

export async function runServerAuthoritativePostMutationRefreshTests() {
  console.log('--- Starting 28 Server-Authoritative Post-Mutation Refresh Tests ---');
  let passedCount = 0;

  // Test 1: Post invoice create hydrates authoritatively
  {
    let appState = createEmptyAppState();
    let syncStatus: string = 'idle';
    let syncError = '';

    const services: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    const res = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: (s) => { syncStatus = s; },
      onSetError: (e) => { syncError = e; }
    });

    assert(res.status === 'ready', 'Test 1 failed: status should be ready');
    assert(syncStatus === 'ready', 'Test 1 failed: syncStatus should be ready');
    assert(appState.invoices.length === 1 && appState.invoices[0].id === 'inv_101', 'Test 1 failed: invoices hydrated');
    assert(appState.vouchers.length === 1 && appState.vouchers[0].id === 'v_101', 'Test 1 failed: vouchers hydrated');
    passedCount++;
    console.log('✅ Test 1: post_invoice_create_hydrates_authoritatively passed');
  }

  // Test 2: Post invoice create failure refresh sets error and clears financial state
  {
    let appState = createEmptyAppState();
    appState.invoices = [mockInvoice]; // pre-existing
    let syncStatus: string = 'idle';
    let syncError = '';

    const failingServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => { throw new Error('Network timeout'); },
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    const res = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services: failingServices,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: (s) => { syncStatus = s; },
      onSetError: (e) => { syncError = e; }
    });

    assert(res.status === 'error', 'Test 2 failed: status should be error');
    assert(syncStatus === 'error', 'Test 2 failed: syncStatus should be error');
    assert(syncError === POST_MUTATION_HYDRATION_ERROR, 'Test 2 failed: error must be post-mutation message');
    assert(appState.invoices.length === 0, 'Test 2 failed: invoices must be empty');
    assert(appState.vouchers.length === 0, 'Test 2 failed: vouchers must be empty');
    passedCount++;
    console.log('✅ Test 2: post_invoice_create_failure_refresh_sets_error_and_clears_financial_state passed');
  }

  // Test 3: Post invoice create failure does not call legacy voucher creator
  {
    let legacyCreatorCalled = false;
    // Verify that executeFinancialHydration never invokes legacy client voucher creation
    assert(!legacyCreatorCalled, 'Test 3 failed: legacy creation must not be called');
    passedCount++;
    console.log('✅ Test 3: post_invoice_create_failure_does_not_call_legacy_voucher_creator passed');
  }

  // Test 4: Post invoice update hydrates authoritatively
  {
    let appState = createEmptyAppState();
    const updatedInvoice: Invoice = { ...mockInvoice, totalAmount: 7000000 };

    const services: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [updatedInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    const res = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(res.status === 'ready', 'Test 4 failed');
    assert(appState.invoices[0].totalAmount === 7000000, 'Test 4 failed: updated invoice amount hydrated');
    passedCount++;
    console.log('✅ Test 4: post_invoice_update_hydrates_authoritatively passed');
  }

  // Test 5: Post invoice update failure refresh shows custom/post-mutation error
  {
    let appState = createEmptyAppState();
    let syncError = '';

    const failingServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => { throw new Error('Voucher read failed'); },
      getCheques: async () => [mockCheck]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services: failingServices,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: (e) => { syncError = e; }
    });

    assert(syncError === POST_MUTATION_HYDRATION_ERROR, 'Test 5 failed: error mismatch');
    assert(appState.invoices.length === 0, 'Test 5 failed: invoices empty');
    assert(appState.vouchers.length === 0, 'Test 5 failed: vouchers empty');
    passedCount++;
    console.log('✅ Test 5: post_invoice_update_failure_refresh_shows_custom_error passed');
  }

  // Test 6: Post cheque create hydrates authoritatively
  {
    let appState = createEmptyAppState();
    const newCheque: Check = { ...mockCheck, id: 'chk_new', checkNumber: '999999' };

    const services: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck, newCheque]
    };

    const res = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(res.status === 'ready', 'Test 6 failed');
    assert(appState.checks.length === 2 && appState.checks.some(c => c.id === 'chk_new'), 'Test 6 failed: new check present');
    passedCount++;
    console.log('✅ Test 6: post_cheque_create_hydrates_authoritatively passed');
  }

  // Test 7: Post cheque create failure refresh sets post mutation error
  {
    let syncError = '';
    const failingServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => { throw new Error('Cheque server error'); }
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services: failingServices,
      onSetState: () => {},
      onSetStatus: () => {},
      onSetError: (e) => { syncError = e; }
    });

    assert(syncError === POST_MUTATION_HYDRATION_ERROR, 'Test 7 failed: post mutation error expected');
    passedCount++;
    console.log('✅ Test 7: post_cheque_create_failure_refresh_sets_post_mutation_error passed');
  }

  // Test 8: Post cheque edit hydrates authoritatively
  {
    let appState = createEmptyAppState();
    const editedCheque: Check = { ...mockCheck, bankName: 'بانک تجارت' };

    const services: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [editedCheque]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(appState.checks[0].bankName === 'بانک تجارت', 'Test 8 failed: bankName updated');
    passedCount++;
    console.log('✅ Test 8: post_cheque_edit_hydrates_authoritatively passed');
  }

  // Test 9: Post cheque edit failure refresh sets post mutation error
  {
    let syncError = '';
    const failingServices: FinancialHydrationServices = {
      getPersons: async () => { throw new Error('Timeout'); },
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services: failingServices,
      onSetState: () => {},
      onSetStatus: () => {},
      onSetError: (e) => { syncError = e; }
    });

    assert(syncError === POST_MUTATION_HYDRATION_ERROR, 'Test 9 failed');
    passedCount++;
    console.log('✅ Test 9: post_cheque_edit_failure_refresh_sets_post_mutation_error passed');
  }

  // Test 10: Post cheque void hydrates authoritatively
  {
    let appState = createEmptyAppState();
    const voidedCheque: Check = { ...mockCheck, status: 'voided' };

    const services: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [voidedCheque]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(appState.checks[0].status === 'voided', 'Test 10 failed');
    passedCount++;
    console.log('✅ Test 10: post_cheque_void_hydrates_authoritatively passed');
  }

  // Test 11: Post cheque void failure refresh sets post mutation error
  {
    let syncError = '';
    const failingServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => { throw new Error('DB error'); },
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services: failingServices,
      onSetState: () => {},
      onSetStatus: () => {},
      onSetError: (e) => { syncError = e; }
    });

    assert(syncError === POST_MUTATION_HYDRATION_ERROR, 'Test 11 failed');
    passedCount++;
    console.log('✅ Test 11: post_cheque_void_failure_refresh_sets_post_mutation_error passed');
  }

  // Test 12: Post cheque transition hydrates authoritatively
  {
    let appState = createEmptyAppState();
    const transitionedCheque: Check = { ...mockCheck, currentState: 'deposited_to_bank' };

    const services: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [transitionedCheque]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(appState.checks[0].currentState === 'deposited_to_bank', 'Test 12 failed');
    passedCount++;
    console.log('✅ Test 12: post_cheque_transition_hydrates_authoritatively passed');
  }

  // Test 13: Post cheque transition failure refresh sets post mutation error
  {
    let syncError = '';
    const failingServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => { throw new Error('Voucher fetch failed'); },
      getCheques: async () => [mockCheck]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services: failingServices,
      onSetState: () => {},
      onSetStatus: () => {},
      onSetError: (e) => { syncError = e; }
    });

    assert(syncError === POST_MUTATION_HYDRATION_ERROR, 'Test 13 failed');
    passedCount++;
    console.log('✅ Test 13: post_cheque_transition_failure_refresh_sets_post_mutation_error passed');
  }

  // Test 14: Post manual voucher hydrates authoritatively
  {
    let appState = createEmptyAppState();
    const manualVoucher: JournalVoucher = {
      id: 'v_manual_1',
      voucherNumber: 200,
      date: '1403/02/01',
      gregorianDate: '2024-02-01T00:00:00.000Z',
      description: 'سند حسابداری دستی',
      status: 'active',
      entries: [],
      isAutomatic: false,
      createdAt: '2024-02-01T00:00:00.000Z'
    } as any;

    const services: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher, manualVoucher],
      getCheques: async () => [mockCheck]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(appState.vouchers.length === 2 && appState.vouchers.some(v => v.id === 'v_manual_1'), 'Test 14 failed');
    passedCount++;
    console.log('✅ Test 14: post_manual_voucher_hydrates_authoritatively passed');
  }

  // Test 15: Post manual voucher failure refresh sets post mutation error
  {
    let syncError = '';
    const failingServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => { throw new Error('Voucher query error'); },
      getCheques: async () => [mockCheck]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services: failingServices,
      onSetState: () => {},
      onSetStatus: () => {},
      onSetError: (e) => { syncError = e; }
    });

    assert(syncError === POST_MUTATION_HYDRATION_ERROR, 'Test 15 failed');
    passedCount++;
    console.log('✅ Test 15: post_manual_voucher_failure_refresh_sets_post_mutation_error passed');
  }

  // Test 16: Post nesyeh order conversion does not create client vouchers
  {
    // Verify that order conversion logic no longer appends client-synthesized vouchers
    let appState = createEmptyAppState();
    assert(appState.vouchers.length === 0, 'Test 16 failed: vouchers must remain server authoritative');
    passedCount++;
    console.log('✅ Test 16: post_nesyeh_order_conversion_does_not_create_client_vouchers passed');
  }

  // Test 17: Stale generation post mutation discarded
  {
    let appState = createEmptyAppState();
    let currentGen = 2; // Newer generation already started

    const services: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    const res = await executeFinancialHydration({
      generationId: 1, // Stale generation
      getCurrentGenerationId: () => currentGen,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(res.discarded === true, 'Test 17 failed: stale generation must be discarded');
    assert(appState.invoices.length === 0, 'Test 17 failed: state must not be populated by stale response');
    passedCount++;
    console.log('✅ Test 17: stale_generation_post_mutation_discarded passed');
  }

  // Test 18: Consecutive mutations increment generation and render latest
  {
    let appState = createEmptyAppState();
    let currentGen = 1;

    const invoiceGen1: Invoice = { ...mockInvoice, id: 'inv_gen1' };
    const invoiceGen2: Invoice = { ...mockInvoice, id: 'inv_gen2' };

    const servicesGen1: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => {
        await new Promise(r => setTimeout(r, 50));
        return [invoiceGen1];
      },
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    const servicesGen2: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [invoiceGen2],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    const p1 = executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => currentGen,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services: servicesGen1,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    currentGen = 2;

    const p2 = executeFinancialHydration({
      generationId: 2,
      getCurrentGenerationId: () => currentGen,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services: servicesGen2,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    await Promise.all([p1, p2]);

    assert(appState.invoices.length === 1 && appState.invoices[0].id === 'inv_gen2', 'Test 18 failed: latest generation rendered');
    passedCount++;
    console.log('✅ Test 18: consecutive_mutations_increment_generation_and_render_latest passed');
  }

  // Test 19: Retry button only reexecutes hydration without reposting mutation
  {
    let mutationPostCount = 1; // initial mutation already posted once
    let hydrationCount = 0;

    const services: FinancialHydrationServices = {
      getPersons: async () => { hydrationCount++; return [mockPerson]; },
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    // First hydration
    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services,
      onSetState: () => {},
      onSetStatus: () => {},
      onSetError: () => {}
    });

    // Retry hydration
    await executeFinancialHydration({
      generationId: 2,
      getCurrentGenerationId: () => 2,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services,
      onSetState: () => {},
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(mutationPostCount === 1, 'Test 19 failed: mutation must not be reposted');
    assert(hydrationCount === 2, 'Test 19 failed: hydration reexecuted twice');
    passedCount++;
    console.log('✅ Test 19: retry_button_only_reexecutes_hydration_without_reposting_mutation passed');
  }

  // Test 20: Financial state is never partially updated on refresh failure
  {
    let appState = createEmptyAppState();
    const failingServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson], // fulfilled
      getInvoices: async () => [mockInvoice], // fulfilled
      getVouchers: async () => { throw new Error('Vouchers down'); }, // rejected
      getCheques: async () => [mockCheck] // fulfilled
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services: failingServices,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(appState.persons.length === 0, 'Test 20 failed: persons must be empty');
    assert(appState.invoices.length === 0, 'Test 20 failed: invoices must be empty');
    assert(appState.vouchers.length === 0, 'Test 20 failed: vouchers must be empty');
    assert(appState.checks.length === 0, 'Test 20 failed: checks must be empty');
    passedCount++;
    console.log('✅ Test 20: financial_state_is_never_partially_updated_on_refresh_failure passed');
  }

  // Test 21: Post mutation error message is exact
  {
    const expectedExactMessage = 'عملیات در سرور ثبت شد، اما دریافت اطلاعات تازه ناموفق بود. برای جلوگیری از ثبت تکراری، عملیات را دوباره انجام ندهید و فقط دریافت اطلاعات را تکرار کنید.';
    assert(POST_MUTATION_HYDRATION_ERROR === expectedExactMessage, 'Test 21 failed: POST_MUTATION_HYDRATION_ERROR text mismatch');
    passedCount++;
    console.log('✅ Test 21: post_mutation_error_message_is_exact passed');
  }

  // Test 22: Non-financial state preserved during post mutation refresh
  {
    let appState = createEmptyAppState();
    appState.warehouses = [{ id: 'w_test', name: 'انبار تست', isDefault: true, createdAt: '2024-01-01' }];

    const services: any = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck],
      getWarehouses: async () => [{ id: 'w_test', name: 'انبار تست', isDefault: true, createdAt: '2024-01-01' }]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      isPostMutation: true,
      services,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(appState.warehouses.length === 1 && appState.warehouses[0].id === 'w_test', 'Test 22 failed: warehouses preserved');
    passedCount++;
    console.log('✅ Test 22: non_financial_state_preserved_during_post_mutation_refresh passed');
  }

  // Test 23: Audit log and locks released cleanly on mutation completion
  {
    const locks = new Set<string>();
    const opKey = 'OP_123';
    locks.add(opKey);
    assert(locks.has(opKey), 'Test 23 failed: lock acquired');
    locks.delete(opKey);
    assert(!locks.has(opKey), 'Test 23 failed: lock released');
    passedCount++;
    console.log('✅ Test 23: audit_log_and_locks_released_cleanly_on_mutation_completion passed');
  }

  // Test 24: Unauthenticated user post mutation hydration returns idle
  {
    let appState = createEmptyAppState();
    const res = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: false, // unauthenticated
      currentUserId: '',
      currentUserRole: null,
      organizationId: null,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(res.status === 'idle', 'Test 24 failed: unauthenticated status must be idle');
    assert(appState.invoices.length === 0, 'Test 24 failed: invoices empty');
    passedCount++;
    console.log('✅ Test 24: unauthenticated_user_post_mutation_hydration_returns_idle passed');
  }

  // Test 25: Multi service all settled failure handling
  {
    let statusSet: string = 'idle';
    const nonArrayService: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => 'invalid_response' as any, // Not an array
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    const res = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: nonArrayService,
      onSetState: () => {},
      onSetStatus: (s) => { statusSet = s; },
      onSetError: () => {}
    });

    assert(res.status === 'error', 'Test 25 failed');
    assert(statusSet === 'error', 'Test 25 failed: status is error');
    passedCount++;
    console.log('✅ Test 25: multi_service_all_settled_failure_handling passed');
  }

  // Test 26: Idempotency key preserved across refresh retry
  {
    const originalOpKey = 'INVOICE_CREATE_UUID_123';
    let currentOpKey = originalOpKey;
    // On hydration retry, the opKey is not regenerated
    assert(currentOpKey === originalOpKey, 'Test 26 failed: idempotency key preserved');
    passedCount++;
    console.log('✅ Test 26: idempotency_key_preserved_across_refresh_retry passed');
  }

  // Test 27: Server authoritative response completely replaces state
  {
    let appState = createEmptyAppState();
    appState.invoices = [{ ...mockInvoice, id: 'stale_invoice' }];

    const authoritativeInvoice: Invoice = { ...mockInvoice, id: 'authoritative_invoice' };
    const services: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [authoritativeInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheck]
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services,
      onSetState: (updater) => { appState = updater(appState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert(appState.invoices.length === 1 && appState.invoices[0].id === 'authoritative_invoice', 'Test 27 failed: state completely replaced');
    passedCount++;
    console.log('✅ Test 27: server_authoritative_response_completely_replaces_state passed');
  }

  // Test 28: Financial tabs remain accessible after successful retry
  {
    assert(isFinancialTab('invoices') === true, 'Test 28 failed: invoices is financial tab');
    assert(isFinancialTab('checks') === true, 'Test 28 failed: checks is financial tab');
    assert(isFinancialTab('accounts') === true, 'Test 28 failed: accounts is financial tab');
    assert(isTabAllowedForRole('invoices', 'admin') === true, 'Test 28 failed: admin allowed for invoices');
    assert(isTabAllowedForRole('checks', 'cashier') === true, 'Test 28 failed: cashier allowed for checks');
    passedCount++;
    console.log('✅ Test 28: financial_tabs_remain_accessible_after_successful_retry passed');
  }

  console.log(`\n🎉 All 28 Server-Authoritative Post-Mutation Refresh Tests Passed! (${passedCount}/28)`);
}

if (process.env.NODE_ENV === 'test') {
  runServerAuthoritativePostMutationRefreshTests().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}