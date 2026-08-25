process.env.NODE_ENV = 'test';
import { 
  executeFinancialHydration, 
  isFinancialTab, 
  isTabAllowedForRole, 
  FinancialHydrationParams, 
  FinancialHydrationServices,
  FinancialSyncStatus 
} from '../App';
import { AppState, Person, Invoice, JournalVoucher, Check } from '../types';
import TopSyncBanner from '../components/layout/TopSyncBanner';

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
    warehouses: [],
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
  taxPercent: 0,
  discount: 0,
  paidAmount: 5000000,
  createdAt: '2024-01-01T00:00:00.000Z'
};

const mockVoucher: JournalVoucher = {
  id: 'v_101',
  voucherNumber: 101,
  date: '1403/01/01',
  gregorianDate: '2024-01-01',
  description: 'سند تسویه فاکتور ۱۰۱',
  status: 'active',
  isAutomatic: false,
  entries: []
};

const mockCheque: Check = {
  id: 'chk_101',
  checkNumber: 'CHK-101',
  sayadiNumber: '1234567890123456',
  bankName: 'بانک ملت',
  amount: 2500000,
  dueDate: '1403/03/01',
  personId: 'p_101',
  type: 'received',
  currentState: 'present_in_cashbox',
  history: [],
  createdAt: '2024-01-01'
};

async function runAllHydrationTests() {
  console.log('================================================================');
  console.log('🚀 Running Server-Authoritative Financial Hydration Test Suite');
  console.log('================================================================\n');

  // Scenario 1: Initial state without auth sets status to idle and clears financial collections
  {
    let currentState = createEmptyAppState();
    currentState.persons = [mockPerson];
    let currentStatus = 'loading' as FinancialSyncStatus;
    let currentError = 'some error';

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: false,
      currentUserId: '',
      currentUserRole: null,
      organizationId: null,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: (err) => { currentError = err; }
    });

    assert(result.status === 'idle', 'Scenario 1: Expected status to be idle');
    assert(currentStatus === 'idle', 'Scenario 1: Callback status must be idle');
    assert(currentError === '', 'Scenario 1: Error message must be cleared');
    assert(currentState.persons.length === 0, 'Scenario 1: persons must be empty');
    assert(currentState.invoices.length === 0, 'Scenario 1: invoices must be empty');
    assert(currentState.vouchers.length === 0, 'Scenario 1: vouchers must be empty');
    assert(currentState.checks.length === 0, 'Scenario 1: checks must be empty');
    console.log('✅ Scenario 1 Passed: Unauthenticated state resets to idle and purges local financial state.');
  }

  // Scenario 2: Successful atomic hydration with all 4 services returning valid arrays
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'idle' as FinancialSyncStatus;
    let currentError = '';

    const mockServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheque]
    };

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: mockServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: (err) => { currentError = err; }
    });

    assert(result.status === 'ready', 'Scenario 2: Result status must be ready');
    assert(currentStatus === 'ready', 'Scenario 2: Callback status must be ready');
    assert(currentError === '', 'Scenario 2: Error must be empty on success');
    assert(currentState.persons.length === 1 && currentState.persons[0].id === 'p_101', 'Scenario 2: persons correctly populated');
    assert(currentState.invoices.length === 1 && currentState.invoices[0].id === 'inv_101', 'Scenario 2: invoices correctly populated');
    assert(currentState.vouchers.length === 1 && currentState.vouchers[0].id === 'v_101', 'Scenario 2: vouchers correctly populated');
    assert(currentState.checks.length === 1 && currentState.checks[0].id === 'chk_101', 'Scenario 2: checks correctly populated');
    console.log('✅ Scenario 2 Passed: Successful atomic fetch hydrates all four financial entities into state.');
  }

  // Scenario 3: PersonService failure triggers atomic rollback and error state
  {
    let currentState = createEmptyAppState();
    currentState.persons = [mockPerson];
    let currentStatus = 'idle' as FinancialSyncStatus;
    let currentError = '';

    const mockServices: FinancialHydrationServices = {
      getPersons: async () => { throw new Error('Network error on persons'); },
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheque]
    };

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: mockServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: (err) => { currentError = err; }
    });

    assert(result.status === 'error', 'Scenario 3: Expected error status');
    assert(currentStatus === 'error', 'Scenario 3: Callback status must be error');
    assert(currentError.includes('اطلاعات مالی از سرور دریافت نشد'), 'Scenario 3: Persian error message required');
    assert(currentState.persons.length === 0, 'Scenario 3: persons must be reset to empty');
    assert(currentState.invoices.length === 0, 'Scenario 3: invoices must be reset to empty');
    assert(currentState.vouchers.length === 0, 'Scenario 3: vouchers must be reset to empty');
    assert(currentState.checks.length === 0, 'Scenario 3: checks must be reset to empty');
    console.log('✅ Scenario 3 Passed: PersonService failure triggers complete atomic state purge.');
  }

  // Scenario 4: InvoiceService failure triggers atomic rollback and error state
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'idle' as FinancialSyncStatus;
    let currentError = '';

    const mockServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => { throw new Error('Network error on invoices'); },
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheque]
    };

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: mockServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: (err) => { currentError = err; }
    });

    assert(result.status === 'error', 'Scenario 4: Expected error status');
    assert(currentState.invoices.length === 0, 'Scenario 4: invoices must be empty');
    assert(currentState.persons.length === 0, 'Scenario 4: persons must be empty');
    console.log('✅ Scenario 4 Passed: InvoiceService failure triggers atomic rollback.');
  }

  // Scenario 5: VoucherService failure triggers atomic rollback and error state
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'idle' as FinancialSyncStatus;
    let currentError = '';

    const mockServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => { throw new Error('Network error on vouchers'); },
      getCheques: async () => [mockCheque]
    };

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: mockServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: (err) => { currentError = err; }
    });

    assert(result.status === 'error', 'Scenario 5: Expected error status');
    assert(currentState.vouchers.length === 0, 'Scenario 5: vouchers must be empty');
    console.log('✅ Scenario 5 Passed: VoucherService failure triggers atomic rollback.');
  }

  // Scenario 6: ChequeClientService failure triggers atomic rollback and error state
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'idle' as FinancialSyncStatus;
    let currentError = '';

    const mockServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => { throw new Error('Network error on cheques'); }
    };

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: mockServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: (err) => { currentError = err; }
    });

    assert(result.status === 'error', 'Scenario 6: Expected error status');
    assert(currentState.checks.length === 0, 'Scenario 6: checks must be empty');
    console.log('✅ Scenario 6 Passed: ChequeClientService failure triggers atomic rollback.');
  }

  // Scenario 7: Non-array response from any service is treated as failure
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'idle' as FinancialSyncStatus;
    let currentError = '';

    const mockServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => ({ invalid: 'object' } as any),
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheque]
    };

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: mockServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: (err) => { currentError = err; }
    });

    assert(result.status === 'error', 'Scenario 7: Invalid payload must result in error status');
    assert(currentState.invoices.length === 0, 'Scenario 7: State must remain empty on invalid payload');
    console.log('✅ Scenario 7 Passed: Non-array payload is rejected and triggers error state.');
  }

  // Scenario 8: Stale generation fetch response is discarded and does not overwrite current state
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'idle' as FinancialSyncStatus;
    let currentError = '';
    let currentGeneration = 2; // Server is on generation 2

    const slowMockServices: FinancialHydrationServices = {
      getPersons: async () => {
        await new Promise(res => setTimeout(res, 50));
        return [mockPerson];
      },
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheque]
    };

    // Trigger fetch for generation 1 while currentGeneration is 2
    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => currentGeneration,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: slowMockServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: (err) => { currentError = err; }
    });

    assert(result.discarded === true, 'Scenario 8: Stale fetch must be discarded');
    assert(currentStatus === 'loading', 'Scenario 8: State should not transition to ready for stale gen');
    console.log('✅ Scenario 8 Passed: Stale generation response is safely discarded.');
  }

  // Scenario 9: Retry after error triggers new generation and succeeds
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'error' as FinancialSyncStatus;
    let currentError = 'قبلی خراب بود';
    let activeGeneration = 1;

    // Retry with generation 2 and working services
    activeGeneration = 2;
    const workingServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => [mockCheque]
    };

    const result = await executeFinancialHydration({
      generationId: 2,
      getCurrentGenerationId: () => activeGeneration,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: workingServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: (err) => { currentError = err; }
    });

    assert(result.status === 'ready', 'Scenario 9: Retry must succeed');
    assert(currentStatus === 'ready', 'Scenario 9: Status must become ready');
    assert(currentError === '', 'Scenario 9: Error must be cleared');
    assert(currentState.persons.length === 1, 'Scenario 9: Persons populated on retry');
    console.log('✅ Scenario 9 Passed: Retry successfully transitions from error to ready.');
  }

  // Scenario 10: Missing organizationId triggers idle and state reset
  {
    let currentState = createEmptyAppState();
    currentState.persons = [mockPerson];
    let currentStatus = 'loading' as FinancialSyncStatus;
    let currentError = '';

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: null, // No organization
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: (err) => { currentError = err; }
    });

    assert(result.status === 'idle', 'Scenario 10: Missing org must result in idle status');
    assert(currentState.persons.length === 0, 'Scenario 10: Data must be cleared');
    console.log('✅ Scenario 10 Passed: Missing organizationId purges state and sets idle.');
  }

  // Scenario 11: isFinancialTab identifies all required financial tabs
  {
    const financialTabs = [
      'invoices', 
      'people', 
      'debtors', 
      'creditors', 
      'checks', 
      'agent_checks', 
      'reports', 
      'accounts', 
      'opening_balances', 
      'installments'
    ];

    for (const tab of financialTabs) {
      assert(isFinancialTab(tab) === true, `Scenario 11: Tab ${tab} must be recognized as financial tab`);
    }

    const nonFinancialTabs = [
      'dashboard', 
      'products', 
      'warehouses', 
      'cost_centers', 
      'knowledge_center', 
      'calc_lab', 
      'calc_management', 
      'credit_policies', 
      'agent_test_mode', 
      'sms_management_center',
      'audit_logs',
      'backup'
    ];

    for (const tab of nonFinancialTabs) {
      assert(isFinancialTab(tab) === false, `Scenario 11: Tab ${tab} must NOT be recognized as financial tab`);
    }

    console.log('✅ Scenario 11 Passed: isFinancialTab correctly categorizes all application tabs.');
  }

  // Scenario 12: isTabAllowedForRole enforces role boundaries
  {
    // Admin has access to all standard tabs
    assert(isTabAllowedForRole('invoices', 'admin') === true, 'Admin can access invoices');
    assert(isTabAllowedForRole('products', 'admin') === true, 'Admin can access products');
    assert(isTabAllowedForRole('backup', 'admin') === true, 'Admin can access backup');

    // Accountant cannot access products, warehouses, opening_balances, backup, audit_logs
    assert(isTabAllowedForRole('invoices', 'accountant') === true, 'Accountant can access invoices');
    assert(isTabAllowedForRole('reports', 'accountant') === true, 'Accountant can access reports');
    assert(isTabAllowedForRole('products', 'accountant') === false, 'Accountant CANNOT access products');
    assert(isTabAllowedForRole('warehouses', 'accountant') === false, 'Accountant CANNOT access warehouses');
    assert(isTabAllowedForRole('backup', 'accountant') === false, 'Accountant CANNOT access backup');
    assert(isTabAllowedForRole('audit_logs', 'accountant') === false, 'Accountant CANNOT access audit_logs');

    // Cashier can only access dashboard, people, checks, installments, reports
    assert(isTabAllowedForRole('dashboard', 'cashier') === true, 'Cashier can access dashboard');
    assert(isTabAllowedForRole('people', 'cashier') === true, 'Cashier can access people');
    assert(isTabAllowedForRole('checks', 'cashier') === true, 'Cashier can access checks');
    assert(isTabAllowedForRole('installments', 'cashier') === true, 'Cashier can access installments');
    assert(isTabAllowedForRole('reports', 'cashier') === true, 'Cashier can access reports');
    assert(isTabAllowedForRole('invoices', 'cashier') === false, 'Cashier CANNOT access invoices');
    assert(isTabAllowedForRole('products', 'cashier') === false, 'Cashier CANNOT access products');

    // Seller can only access dashboard, invoices, products, warehouses
    assert(isTabAllowedForRole('dashboard', 'seller') === true, 'Seller can access dashboard');
    assert(isTabAllowedForRole('invoices', 'seller') === true, 'Seller can access invoices');
    assert(isTabAllowedForRole('products', 'seller') === true, 'Seller can access products');
    assert(isTabAllowedForRole('warehouses', 'seller') === true, 'Seller can access warehouses');
    assert(isTabAllowedForRole('checks', 'seller') === false, 'Seller CANNOT access checks');
    assert(isTabAllowedForRole('reports', 'seller') === false, 'Seller CANNOT access reports');

    // Unauthenticated role (null) gets false for everything
    assert(isTabAllowedForRole('invoices', null) === false, 'Null role cannot access invoices');
    assert(isTabAllowedForRole('dashboard', null) === false, 'Null role cannot access dashboard');

    console.log('✅ Scenario 12 Passed: isTabAllowedForRole strictly validates access across all user roles.');
  }

  // Scenario 13: TopSyncBanner presentational contract verification
  {
    const mockSyncStatus = {
      connected: true,
      syncing: false,
      lastSyncTime: '14:30:00'
    };

    // Verify TopSyncBanner does not throw and handles all status props
    const loadingBanner = TopSyncBanner({
      syncStatus: mockSyncStatus,
      financialSyncStatus: 'loading',
      financialSyncError: '',
      onRetryFinancialSync: () => {}
    });
    assert(loadingBanner !== null, 'Scenario 13: TopSyncBanner renders in loading state');

    const errorBanner = TopSyncBanner({
      syncStatus: mockSyncStatus,
      financialSyncStatus: 'error',
      financialSyncError: 'خطای سرور',
      onRetryFinancialSync: () => {}
    });
    assert(errorBanner !== null, 'Scenario 13: TopSyncBanner renders in error state');

    const readyBanner = TopSyncBanner({
      syncStatus: mockSyncStatus,
      financialSyncStatus: 'ready',
      financialSyncError: '',
      onRetryFinancialSync: () => {}
    });
    assert(readyBanner !== null, 'Scenario 13: TopSyncBanner renders header strip when ready');

    const idleBanner = TopSyncBanner({
      syncStatus: mockSyncStatus,
      financialSyncStatus: 'idle',
      financialSyncError: '',
      onRetryFinancialSync: () => {}
    });
    assert(idleBanner !== null, 'Scenario 13: TopSyncBanner renders header strip when idle');

    console.log('✅ Scenario 13 Passed: TopSyncBanner adheres strictly to presentational contract without side effects.');
  }

  // Scenario 14: Exact Persian error text validation
  {
    const expectedPersianError = 'اطلاعات مالی از سرور دریافت نشد. برای جلوگیری از نمایش اطلاعات قدیمی، داده‌های ذخیره‌شده روی این دستگاه نمایش داده نمی‌شوند.';

    let capturedError = '';
    const failingServices: FinancialHydrationServices = {
      getPersons: async () => { throw new Error('DB Down'); },
      getInvoices: async () => [],
      getVouchers: async () => [],
      getCheques: async () => []
    };

    await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: failingServices,
      onSetState: () => {},
      onSetStatus: () => {},
      onSetError: (err) => { capturedError = err; }
    });

    assert(capturedError === expectedPersianError, `Scenario 14: Error text mismatch.\nExpected: ${expectedPersianError}\nGot: ${capturedError}`);
    console.log('✅ Scenario 14 Passed: Persian error message matches canonical specification verbatim.');
  }

  // Scenario 15: All 4 services reject concurrently
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'idle' as FinancialSyncStatus;

    const allFailingServices: FinancialHydrationServices = {
      getPersons: async () => { throw new Error('Err1'); },
      getInvoices: async () => { throw new Error('Err2'); },
      getVouchers: async () => { throw new Error('Err3'); },
      getCheques: async () => { throw new Error('Err4'); }
    };

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: allFailingServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: () => {}
    });

    assert(result.status === 'error', 'Scenario 15: Must return error');
    assert(currentStatus === 'error', 'Scenario 15: Status callback must be error');
    assert(currentState.persons.length === 0, 'Scenario 15: Persons empty');
    assert(currentState.invoices.length === 0, 'Scenario 15: Invoices empty');
    assert(currentState.vouchers.length === 0, 'Scenario 15: Vouchers empty');
    assert(currentState.checks.length === 0, 'Scenario 15: Checks empty');
    console.log('✅ Scenario 15 Passed: Concurrent total service failure handled cleanly.');
  }

  // Scenario 16: Multiple rapid sequential calls ensure only latest active generation completes
  {
    let currentState = createEmptyAppState();
    let activeGeneration = 1;

    let resolveGen1: (val: any) => void = () => {};
    const gen1Promise = new Promise(res => { resolveGen1 = res; });

    const gen1Services: FinancialHydrationServices = {
      getPersons: async () => { await gen1Promise; return [{ ...mockPerson, name: 'Gen1 Person' }]; },
      getInvoices: async () => [],
      getVouchers: async () => [],
      getCheques: async () => []
    };

    const gen2Services: FinancialHydrationServices = {
      getPersons: async () => [{ ...mockPerson, name: 'Gen2 Person' }],
      getInvoices: async () => [],
      getVouchers: async () => [],
      getCheques: async () => []
    };

    // Start Gen 1 (slow)
    const p1 = executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => activeGeneration,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: gen1Services,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    // Bump generation to 2 immediately
    activeGeneration = 2;

    // Start Gen 2 (fast)
    const p2 = executeFinancialHydration({
      generationId: 2,
      getCurrentGenerationId: () => activeGeneration,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: gen2Services,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    // Wait for gen 2 to finish
    await p2;
    assert(currentState.persons[0]?.name === 'Gen2 Person', 'Gen2 state should be present');

    // Now let Gen 1 finish
    resolveGen1(true);
    const r1 = await p1;

    assert(r1.discarded === true, 'Gen 1 must report discarded');
    assert(currentState.persons[0]?.name === 'Gen2 Person', 'Gen2 data must NOT be overwritten by late Gen1');
    console.log('✅ Scenario 16 Passed: Rapid sequential generations handle async out-of-order resolution cleanly.');
  }

  // Scenario 17: General public and special tabs accessible by all roles
  {
    const universalTabs = ['knowledge_center', 'calc_lab', 'calc_management', 'credit_policies', 'agent_test_mode', 'sms_management_center'];
    const testRoles: Array<'admin' | 'agent' | 'accountant' | 'cashier' | 'seller'> = ['admin', 'agent', 'accountant', 'cashier', 'seller'];

    for (const tab of universalTabs) {
      for (const role of testRoles) {
        assert(isTabAllowedForRole(tab, role) === true, `Scenario 17: ${tab} must be accessible by ${role}`);
      }
    }
    console.log('✅ Scenario 17 Passed: Universal system and calculator tabs accessible by all authenticated roles.');
  }

  // Scenario 18: Zero-length array returns from services count as valid hydration
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'idle' as FinancialSyncStatus;

    const emptyValidServices: FinancialHydrationServices = {
      getPersons: async () => [],
      getInvoices: async () => [],
      getVouchers: async () => [],
      getCheques: async () => []
    };

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: emptyValidServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: () => {}
    });

    assert(result.status === 'ready', 'Scenario 18: Empty database is valid hydration');
    assert(currentStatus === 'ready', 'Scenario 18: Status is ready');
    assert(currentState.persons.length === 0, 'Scenario 18: Persons is empty array');
    console.log('✅ Scenario 18 Passed: Empty database (clean organization) hydrates to ready status.');
  }

  // Scenario 19: Null user role immediately sets idle
  {
    let currentState = createEmptyAppState();
    currentState.persons = [mockPerson];
    let currentStatus = 'loading' as FinancialSyncStatus;

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: null, // Null role
      organizationId: 'org_main',
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: () => {}
    });

    assert(result.status === 'idle', 'Scenario 19: Null role must be idle');
    assert(currentStatus === 'idle', 'Scenario 19: Status must be idle');
    assert(currentState.persons.length === 0, 'Scenario 19: State must be cleared');
    console.log('✅ Scenario 19 Passed: Null role prevents hydration and clears state.');
  }

  // Scenario 20: Empty user ID prevents hydration
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'loading' as FinancialSyncStatus;

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: '', // Empty user ID
      currentUserRole: 'admin',
      organizationId: 'org_main',
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: () => {}
    });

    assert(result.status === 'idle', 'Scenario 20: Empty user ID must be idle');
    assert(currentStatus === 'idle', 'Scenario 20: Status must be idle');
    console.log('✅ Scenario 20 Passed: Empty user ID prevents hydration.');
  }

  // Scenario 21: Partial fulfillment (3 fulfilled, 1 rejected) is treated as failure
  {
    let currentState = createEmptyAppState();
    let currentStatus = 'idle' as FinancialSyncStatus;

    const partialFailServices: FinancialHydrationServices = {
      getPersons: async () => [mockPerson],
      getInvoices: async () => [mockInvoice],
      getVouchers: async () => [mockVoucher],
      getCheques: async () => { throw new Error('Cheque service unreachable'); }
    };

    const result = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'usr_admin',
      currentUserRole: 'admin',
      organizationId: 'org_main',
      services: partialFailServices,
      onSetState: (updater) => { currentState = updater(currentState); },
      onSetStatus: (status) => { currentStatus = status; },
      onSetError: () => {}
    });

    assert(result.status === 'error', 'Scenario 21: Partial failure must result in error status');
    assert(currentState.persons.length === 0, 'Scenario 21: Persons must be purged');
    assert(currentState.invoices.length === 0, 'Scenario 21: Invoices must be purged');
    assert(currentState.vouchers.length === 0, 'Scenario 21: Vouchers must be purged');
    assert(currentState.checks.length === 0, 'Scenario 21: Checks must be purged');
    console.log('✅ Scenario 21 Passed: Atomic boundary guarantees all-or-nothing data hydration.');
  }

  console.log('\n================================================================');
  console.log('✨ All 21 Server-Authoritative Financial Hydration Scenarios Passed!');
  console.log('================================================================\n');
}

runAllHydrationTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
