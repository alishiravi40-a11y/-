/**
 * @file command2CalculatorDatabaseAuthority.test.ts
 * @description Comprehensive automated tests for Instruction 2: Calculator Database Authority
 * Validates server-authoritative CRUD, decoupled financial hydration error isolation,
 * zero local mutation in AgentManager / CalculatorManagementCenter, and memory purging on logout/org-switch.
 */

process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CalculatorService } from '../services/calculatorService';
import { executeFinancialHydration, FinancialHydrationServices } from '../App';
import { Calculator, AppState, Person, Invoice, JournalVoucher, Check } from '../types';
import { saveAppState, loadAppState, DEFAULT_SUBSIDIARIES } from '../utils/accounting';

const storageMap = new Map<string, string>();
if (typeof global.localStorage === 'undefined') {
  (global as any).localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, String(value)),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
    length: 0,
    key: (i: number) => Array.from(storageMap.keys())[i] ?? null,
  };
}

async function runAllTests() {
  console.log('================================================================');
  console.log('🧪 INSTRUCTION 2: CALCULATOR DATABASE AUTHORITY TEST SUITE');
  console.log('================================================================\n');

  storageMap.clear();

  // Test 1: Calculator CRUD routes communicate with server-authoritative API
  {
    console.log('[1/7] Testing Calculator CRUD routes via CalculatorService...');
    const mockCalculators: Calculator[] = [
      {
        id: 'calc-1',
        name: 'طرح صدی بازار',
        description: 'طرح اقساطی صدی بازار',
        type: 'sadi_bazaar',
        isActive: true,
        baseRatePercent: 7
      }
    ];

    const originalFetch = global.fetch;
    const fetchCalls: { url: string; method?: string; body?: any }[] = [];

    global.fetch = (async (url: string | URL | Request, options?: any) => {
      const urlStr = String(url);
      fetchCalls.push({ url: urlStr, method: options?.method, body: options?.body });

      if (urlStr.includes('/api/calculators') && (!options || !options.method || options.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({ success: true, data: mockCalculators })
        };
      }
      if (urlStr.includes('/api/calculators') && options?.method === 'POST') {
        const payload = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { id: 'calc-new-1', ...payload }
          })
        };
      }
      if (urlStr.includes('/api/calculators/calc-1') && options?.method === 'PUT') {
        const payload = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { id: 'calc-1', ...payload }
          })
        };
      }
      if (urlStr.includes('/api/calculators/calc-1') && options?.method === 'DELETE') {
        return {
          ok: true,
          json: async () => ({ success: true })
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
    }) as any;

    try {
      // GET
      const calcs = await CalculatorService.getCalculators();
      assert.equal(calcs.length, 1, 'Should fetch 1 calculator');
      assert.equal(calcs[0].id, 'calc-1', 'ID must match');

      // CREATE
      const created = await CalculatorService.createCalculator({
        name: 'ماشین‌حساب جدید',
        description: 'توضیحات پلکانی',
        type: 'pelkani',
        isActive: true,
        pelkaniTier1BaseRate: 8.5
      });
      assert.equal(created.id, 'calc-new-1', 'Created calculator must have assigned id');
      assert.equal(created.name, 'ماشین‌حساب جدید', 'Name must match');

      // UPDATE
      const updated = await CalculatorService.updateCalculator('calc-1', {
        isActive: false
      });
      assert.equal(updated.id, 'calc-1', 'Updated ID must match');
      assert.equal(updated.isActive, false, 'isActive must be updated to false');

      // DELETE
      const deleted = await CalculatorService.deleteCalculator('calc-1');
      assert.equal(deleted, true, 'Delete must succeed');

      console.log('✅ [1/7] CalculatorService CRUD operations verified.');
    } finally {
      global.fetch = originalFetch;
    }
  }

  // Test 2: Successful financial hydration populates calculators and core entities
  {
    console.log('[2/7] Testing successful financial hydration with calculators...');
    const mockCalculators: Calculator[] = [
      { id: 'c-1', name: 'ماشین حساب بتا', description: 'طرح بتا', type: 'beta', isActive: true, betaBankFeeRate: 5 }
    ];

    let hydratedState: Partial<AppState> = {};

    const mockServices: FinancialHydrationServices = {
      getPersons: async () => [],
      getInvoices: async () => [],
      getVouchers: async () => [],
      getCheques: async () => [],
      getCalculators: async () => mockCalculators
    };

    const res = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'user-admin',
      currentUserRole: 'admin',
      organizationId: 'org-test-1',
      services: mockServices,
      onSetState: (updater) => {
        hydratedState = updater(hydratedState as AppState);
      },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert.equal(res.status, 'ready', 'Hydration status must be ready');
    assert.deepEqual(hydratedState.calculators, mockCalculators, 'Calculators must be hydrated from server');
    console.log('✅ [2/7] Financial hydration with calculators passed.');
  }

  // Test 3: Failure of CalculatorService does NOT wipe or alter core financial data
  {
    console.log('[3/7] Testing error isolation: calculators failure does not affect core financial data...');
    const mockPersons = [{ id: 'p-1', name: 'علی', code: '101' }] as Person[];
    const mockInvoices = [{ id: 'inv-1', invoiceNumber: 1 }] as Invoice[];
    const mockVouchers = [{ id: 'v-1', voucherNumber: 1 }] as JournalVoucher[];
    const mockCheques = [{ id: 'chk-1', checkNumber: '123' }] as Check[];

    let hydratedState: Partial<AppState> = {
      calculators: [{ id: 'old-calc', name: 'قدیمی', description: 'قدیمی', type: 'sadi_bazaar', isActive: true }]
    };
    let capturedError = '';
    let capturedStatus = '';

    const mockServices: FinancialHydrationServices = {
      getPersons: async () => mockPersons,
      getInvoices: async () => mockInvoices,
      getVouchers: async () => mockVouchers,
      getCheques: async () => mockCheques,
      getCalculators: async () => { throw new Error('Network error on calculators endpoint'); }
    };

    const res = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'user-admin',
      currentUserRole: 'admin',
      organizationId: 'org-test-1',
      services: mockServices,
      onSetState: (updater) => {
        hydratedState = updater(hydratedState as AppState);
      },
      onSetStatus: (st) => { capturedStatus = st; },
      onSetError: (err) => { capturedError = err; }
    });

    // Decoupled error isolation: status is ready, core financial data is safely hydrated
    assert.equal(res.status, 'ready', 'Status must be ready even if calculators failed');
    assert.equal(capturedStatus, 'ready', 'Status callback must receive ready');
    assert.equal(capturedError, '', 'No error should block core financial data');
    assert.deepEqual(hydratedState.persons, mockPersons, 'Persons must be preserved');
    assert.deepEqual(hydratedState.invoices, mockInvoices, 'Invoices must be preserved');
    assert.deepEqual(hydratedState.vouchers, mockVouchers, 'Vouchers must be preserved');
    assert.deepEqual(hydratedState.checks, mockCheques, 'Checks must be preserved');
    assert.deepEqual(hydratedState.calculators, [], 'Calculators should default to empty array on failure');
    console.log('✅ [3/7] Decoupled error isolation verified.');
  }

  // Test 4: Core financial service failure triggers rollback for all core entities
  {
    console.log('[4/7] Testing core financial rollback when a core service fails...');
    let hydratedState: Partial<AppState> = {
      persons: [{ id: 'p-1', name: 'علی' }] as any,
      invoices: [{ id: 'inv-1' }] as any,
      vouchers: [{ id: 'v-1' }] as any,
      checks: [{ id: 'chk-1' }] as any,
      calculators: [{ id: 'c-1', name: 'ماشین حساب', description: 'تست', type: 'sadi_bazaar', isActive: true }]
    };
    let capturedError = '';
    let capturedStatus = '';

    const mockServices: FinancialHydrationServices = {
      getPersons: async () => { throw new Error('DB failure on persons'); },
      getInvoices: async () => [],
      getVouchers: async () => [],
      getCheques: async () => [],
      getCalculators: async () => []
    };

    const res = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: true,
      currentUserId: 'user-admin',
      currentUserRole: 'admin',
      organizationId: 'org-test-1',
      services: mockServices,
      onSetState: (updater) => {
        hydratedState = updater(hydratedState as AppState);
      },
      onSetStatus: (st) => { capturedStatus = st; },
      onSetError: (err) => { capturedError = err; }
    });

    assert.equal(res.status, 'error', 'Status must be error when core service fails');
    assert.equal(capturedStatus, 'error', 'Status callback must be error');
    assert(capturedError.length > 0, 'Error message must be reported');
    assert.deepEqual(hydratedState.persons, [], 'Persons must be rolled back');
    assert.deepEqual(hydratedState.invoices, [], 'Invoices must be rolled back');
    assert.deepEqual(hydratedState.vouchers, [], 'Vouchers must be rolled back');
    assert.deepEqual(hydratedState.checks, [], 'Checks must be rolled back');
    assert.deepEqual(hydratedState.calculators, [], 'Calculators must be rolled back');
    console.log('✅ [4/7] Core financial failure rollback verified.');
  }

  // Test 5: Switching organization or logging out clears calculators from memory
  {
    console.log('[5/7] Testing logout/org-switch purges calculators from memory...');
    let hydratedState: Partial<AppState> = {
      calculators: [{ id: 'c-1', name: 'ماشین حساب', description: 'تست', type: 'sadi_bazaar', isActive: true }]
    };

    const res = await executeFinancialHydration({
      generationId: 1,
      getCurrentGenerationId: () => 1,
      isLoggedIn: false, // logged out
      currentUserId: '',
      currentUserRole: null,
      organizationId: null,
      onSetState: (updater) => {
        hydratedState = updater(hydratedState as AppState);
      },
      onSetStatus: () => {},
      onSetError: () => {}
    });

    assert.equal(res.status, 'idle', 'Unauthenticated state must be idle');
    assert.deepEqual(hydratedState.calculators, [], 'Calculators must be purged on logout');
    console.log('✅ [5/7] Logout/org-switch state purge verified.');
  }

  // Test 6: saveAppState does not persist calculators in localStorage
  {
    console.log('[6/7] Testing saveAppState localStorage exclusion for calculators...');
    const dummyState: any = {
      persons: [],
      products: [],
      productCategories: [],
      subsidiaries: DEFAULT_SUBSIDIARIES,
      vouchers: [],
      checks: [],
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
      settings: {},
      calculators: [{ id: 'test-calc', name: 'تست', description: 'تست', type: 'sadi_bazaar', isActive: true }]
    };

    saveAppState(dummyState);
    assert.equal(localStorage.getItem('accounting_calculators'), null, 'accounting_calculators must never exist in localStorage');

    const loaded = loadAppState();
    assert.deepEqual(loaded.calculators, [], 'loadAppState must initialize calculators as empty array');
    console.log('✅ [6/7] saveAppState does not persist calculators in localStorage.');
  }

  // Test 7: Static audit of AgentManager.tsx and CalculatorManagementCenter.tsx
  {
    console.log('[7/7] Auditing AgentManager.tsx and CalculatorManagementCenter.tsx for zero local mutations...');
    const agentManagerContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AgentManager.tsx'), 'utf-8');
    const calcCenterContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/CalculatorManagementCenter.tsx'), 'utf-8');

    // Ensure CalculatorService is imported
    assert(agentManagerContent.includes("import { CalculatorService } from '../services/calculatorService'"), 'AgentManager must import CalculatorService');
    assert(calcCenterContent.includes("import { CalculatorService } from '../services/calculatorService'"), 'CalculatorManagementCenter must import CalculatorService');

    // Ensure no direct local mutations like `updatedCalculators = [...` or `updatedCalcs = ...` followed by saveAppState
    assert(!agentManagerContent.match(/saveAppState\(\s*\{\s*\.\.\.appState,\s*calculators/), 'AgentManager must not call saveAppState with mutated calculators');
    assert(!calcCenterContent.match(/saveAppState\(\s*\{\s*\.\.\.appState,\s*calculators/), 'CalculatorManagementCenter must not call saveAppState with mutated calculators');
    console.log('✅ [7/7] Zero local mutation pathways in AgentManager and CalculatorManagementCenter.');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 7 CALCULATOR DATABASE AUTHORITY TESTS PASSED!');
  console.log('================================================================\n');
}

runAllTests().catch((err) => {
  console.error('❌ Test Suite Failed:', err);
  process.exit(1);
});
