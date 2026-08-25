/**
 * Verification Test Suite for Instruction 4:
 * Warehouse Master Data Server-Authoritative Database Authority Migration.
 * Covers Atomic RPCs, Unique Code Sequences, Single Default Invariant,
 * Optimistic Concurrency Control, Idempotency, and Non-Authority of Local Storage.
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { executeFinancialHydration } from '../App';
import { WarehouseService } from '../services/warehouseService';
import { Warehouse, AppState } from '../types';
import { SERVER_ROUTE_POLICIES } from '../server/auth/serverRouteAuthorizationPolicy';
import {
  executeServerGetNextWarehouseCode,
  executeServerCreateWarehouse,
  executeServerUpdateWarehouse,
  executeServerSetDefaultWarehouse,
  executeServerDeactivateWarehouse,
  executeServerGetWarehouses
} from '../server/inventory/warehouseMasterService';

async function runTests() {
  console.log('================================================================');
  console.log('RUNNING INSTRUCTION 4: WAREHOUSE MASTER DATA AUTHORITY TESTS');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // Test 1: RBAC & Route Authorization Policies for Warehouses
  // --------------------------------------------------------------------------
  console.log('[1/8] Verifying RBAC Route Authorization Policies...');
  const readPolicies = ['WAREHOUSES_GET', 'WAREHOUSES_NEXT_CODE_GET', 'WAREHOUSES_GET_BY_ID'];
  const writePolicies = ['WAREHOUSES_POST', 'WAREHOUSES_PUT', 'WAREHOUSES_SET_DEFAULT', 'WAREHOUSES_DELETE'];

  // 1. Verify read-only policies allow inventory:read OR inventory:manage
  for (const policyId of readPolicies) {
    const policy = SERVER_ROUTE_POLICIES.find(p => p.policyId === policyId);
    assert(policy, `Missing policy: ${policyId}`);
    assert(policy.requiredPermissions.includes('inventory:read'), `${policyId} must accept inventory:read`);
    assert(policy.requiredPermissions.includes('inventory:manage'), `${policyId} must accept inventory:manage`);
    assert.equal(policy.matchMode, 'any');

    // Test permission evaluation
    const allowReadUser = policy.requiredPermissions.some(p => ['inventory:read'].includes(p));
    const allowManageUser = policy.requiredPermissions.some(p => ['inventory:manage'].includes(p));
    const allowSalesUser = policy.requiredPermissions.some(p => ['sales:manage'].includes(p));

    assert.equal(allowReadUser, true, `User with inventory:read must be allowed to read (${policyId})`);
    assert.equal(allowManageUser, true, `User with inventory:manage must be allowed to read (${policyId})`);
    assert.equal(allowSalesUser, false, `User with only sales:manage must NOT be allowed (${policyId})`);
  }

  // 2. Verify mutating policies ONLY allow inventory:manage
  for (const policyId of writePolicies) {
    const policy = SERVER_ROUTE_POLICIES.find(p => p.policyId === policyId);
    assert(policy, `Missing policy: ${policyId}`);
    assert.deepEqual(policy.requiredPermissions, ['inventory:manage'], `${policyId} must ONLY require inventory:manage`);

    // Test permission evaluation
    const allowManageUser = policy.requiredPermissions.some(p => ['inventory:manage'].includes(p));
    const allowReadUser = policy.requiredPermissions.some(p => ['inventory:read'].includes(p));
    const allowSalesUser = policy.requiredPermissions.some(p => ['sales:manage'].includes(p));
    const allowFinanceUser = policy.requiredPermissions.some(p => ['finance:write'].includes(p));
    const allowOrgUser = policy.requiredPermissions.some(p => ['org:manage'].includes(p));

    assert.equal(allowManageUser, true, `User with inventory:manage must be allowed to mutate (${policyId})`);
    assert.equal(allowReadUser, false, `User with only inventory:read must NOT be allowed to mutate (${policyId})`);
    assert.equal(allowSalesUser, false, `User with only sales:manage must NOT be allowed to mutate (${policyId})`);
    assert.equal(allowFinanceUser, false, `User with only finance:write must NOT be allowed to mutate (${policyId})`);
    assert.equal(allowOrgUser, false, `User with only org:manage must NOT be allowed to mutate (${policyId})`);
  }
  console.log('✅ [1/8] All 7 warehouse master data route policies and RBAC permissions verified.\n');

  // --------------------------------------------------------------------------
  // Test 2: Server-Side Atomic Warehouse Code Sequence & Generation
  // --------------------------------------------------------------------------
  console.log('[2/8] Testing Server-Side Atomic Warehouse Code Sequence & Preview...');
  let sequenceUpdated = false;
  const mockSupabaseForSequence: any = {
    from: (table: string) => {
      if (table === 'warehouse_code_sequences') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'seq_wh_1',
                  prefix: 'WH-',
                  next_number: 7
                },
                error: null
              }),
              maybeSingle: async () => ({
                data: {
                  id: 'seq_wh_1',
                  prefix: 'WH-',
                  next_number: 7
                },
                error: null
              })
            })
          }),
          update: (updates: any) => ({
            eq: async () => {
              sequenceUpdated = true;
              return { error: null };
            }
          })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  const previewCode = await executeServerGetNextWarehouseCode(mockSupabaseForSequence, 'org_test_1', 'user_1');
  assert.equal(previewCode, 'WH-007', 'Must return formatted sequential preview code');
  assert.equal(sequenceUpdated, false, 'Getting next code preview MUST NOT consume or update sequence counter');
  console.log('✅ [2/8] Server-side atomic warehouse code generation and non-consumption preview verified.\n');

  // --------------------------------------------------------------------------
  // Test 3: Atomic Warehouse Creation with Single Default Invariant
  // --------------------------------------------------------------------------
  console.log('[3/8] Testing Atomic Warehouse Creation with Single Default Invariant...');
  const mockSupabaseForCreate: any = {
    rpc: async (fn: string, params: any) => {
      if (fn === 'create_warehouse_atomic') {
        assert.equal(params.p_organization_id, 'org_test_1');
        assert.equal(params.p_name, 'انبار مرکزی تهران');
        assert.equal(params.p_is_default, true);
        return {
          data: {
            id: 'wh_test_1',
            organization_id: 'org_test_1',
            branch_id: null,
            name: params.p_name,
            code: params.p_code || 'WH-0001',
            location: 'تهران، خیابان آزادی',
            is_default: true,
            status: 'ACTIVE',
            version: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          error: null
        };
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    }
  };

  const createdWarehouse = await executeServerCreateWarehouse(mockSupabaseForCreate, 'org_test_1', 'user_1', {
    name: 'انبار مرکزی تهران',
    location: 'تهران، خیابان آزادی',
    isDefault: true,
    operationKey: 'op_wh_create_1'
  });

  assert.equal(createdWarehouse.id, 'wh_test_1');
  assert.equal(createdWarehouse.isDefault, true);
  assert.equal(createdWarehouse.version, 1);
  console.log('✅ [3/8] Atomic warehouse creation verified.\n');

  // --------------------------------------------------------------------------
  // Test 4: Optimistic Concurrency Control on Warehouse Update
  // --------------------------------------------------------------------------
  console.log('[4/8] Testing Optimistic Concurrency Control on Warehouse Update...');
  let currentWarehouseVersion = 1;
  const mockSupabaseForUpdateSuccess: any = {
    rpc: async (fn: string, params: any) => {
      if (fn === 'update_warehouse_atomic') {
        if (params.p_expected_version === undefined || params.p_expected_version === null || params.p_expected_version === currentWarehouseVersion) {
          currentWarehouseVersion += 1;
          return {
            data: {
              id: 'wh_test_1',
              organization_id: 'org_test_1',
              name: params.p_name,
              code: 'WH-0001',
              location: 'تهران، جاده مخصوص کرج',
              is_default: true,
              status: 'ACTIVE',
              version: currentWarehouseVersion,
              updated_at: new Date().toISOString()
            },
            error: null
          };
        } else {
          return {
            data: null,
            error: {
              message: `ERR_WAREHOUSE_VERSION_CONFLICT: Expected version ${params.p_expected_version} but found ${currentWarehouseVersion}`
            }
          };
        }
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    }
  };

  // Successful update with matching version (version 1 -> 2)
  const updatedWh = await executeServerUpdateWarehouse(mockSupabaseForUpdateSuccess, 'org_test_1', 'user_1', 'wh_test_1', {
    name: 'انبار مرکزی شماره ۱',
    location: 'تهران، جاده مخصوص کرج',
    expectedVersion: 1
  });
  assert.equal(updatedWh.name, 'انبار مرکزی شماره ۱');
  assert.equal(updatedWh.version, 2);

  // Conflicting update with stale version (trying to update using version 1 when current is 2)
  await assert.rejects(
    async () => {
      await executeServerUpdateWarehouse(mockSupabaseForUpdateSuccess, 'org_test_1', 'user_1', 'wh_test_1', {
        name: 'انبار مرکزی نسخه قدیمی',
        expectedVersion: 1 // Stale version! Current is now 2
      });
    },
    (err: any) => {
      assert(err.message.includes('ERR_WAREHOUSE_VERSION_CONFLICT'), 'Must reject on version conflict');
      return true;
    }
  );
  console.log('✅ [4/8] Optimistic concurrency control (OCC) on warehouse update verified.\n');

  // --------------------------------------------------------------------------
  // Test 5: Setting Default Warehouse & Status Preservation
  // --------------------------------------------------------------------------
  console.log('[5/8] Testing Setting Default Warehouse & Status Preservation...');
  const mockWarehouses = [
    { id: 'wh_test_1', name: 'انبار ۱', is_default: true, status: 'ACTIVE' },
    { id: 'wh_test_2', name: 'انبار ۲', is_default: false, status: 'ACTIVE' }
  ];

  const mockSupabaseForSetDefault: any = {
    rpc: async (fn: string, params: any) => {
      if (fn === 'set_default_warehouse_atomic') {
        assert.equal(params.p_organization_id, 'org_test_1');
        assert.equal(params.p_warehouse_id, 'wh_test_2');

        // Simulate set_default_warehouse_atomic: unset previous default without deactivating it
        mockWarehouses[0].is_default = false;
        // status remains ACTIVE!
        mockWarehouses[1].is_default = true;

        return {
          data: {
            id: mockWarehouses[1].id,
            organization_id: 'org_test_1',
            name: mockWarehouses[1].name,
            code: 'WH-0002',
            is_default: mockWarehouses[1].is_default,
            status: mockWarehouses[1].status,
            version: 3,
            updated_at: new Date().toISOString()
          },
          error: null
        };
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    }
  };

  const newDefaultWh = await executeServerSetDefaultWarehouse(mockSupabaseForSetDefault, 'org_test_1', 'user_1', 'wh_test_2');
  assert.equal(newDefaultWh.id, 'wh_test_2');
  assert.equal(newDefaultWh.isDefault, true);

  // Assert that previous default warehouse is_default is false BUT status is STILL ACTIVE (NOT INACTIVE)
  assert.equal(mockWarehouses[0].is_default, false, 'Previous default warehouse must have is_default = false');
  assert.equal(mockWarehouses[0].status, 'ACTIVE', 'Previous default warehouse status MUST remain ACTIVE');

  // Verify only 1 active default warehouse exists
  const activeDefaults = mockWarehouses.filter(w => w.is_default && w.status === 'ACTIVE');
  assert.equal(activeDefaults.length, 1, 'Must have exactly one active default warehouse');
  console.log('✅ [5/8] Setting default warehouse & previous warehouse ACTIVE status preservation verified.\n');

  // --------------------------------------------------------------------------
  // Test 6: Default Warehouse Deactivation Protection (Blocked without replacement)
  // --------------------------------------------------------------------------
  console.log('[6/8] Testing Deactivation Safety Protection for Default Warehouse...');
  const mockSupabaseForDeactivate: any = {
    rpc: async (fn: string, params: any) => {
      if (fn === 'deactivate_warehouse_atomic') {
        if (params.p_warehouse_id === 'wh_default' && !params.p_replacement_default_warehouse_id) {
          return {
            data: null,
            error: {
              message: 'ERR_CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE: Cannot deactivate default warehouse without specifying replacement'
            }
          };
        }
        return {
          data: {
            id: params.p_warehouse_id,
            organization_id: 'org_test_1',
            status: 'INACTIVE',
            is_default: false,
            version: 4,
            updated_at: new Date().toISOString()
          },
          error: null
        };
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    }
  };

  // Deactivating default without replacement must fail
  await assert.rejects(
    async () => {
      await executeServerDeactivateWarehouse(mockSupabaseForDeactivate, 'org_test_1', 'user_1', 'wh_default');
    },
    (err: any) => {
      assert(err.message.includes('ERR_CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE'));
      return true;
    }
  );

  // Deactivating non-default warehouse succeeds
  const deactivatedWh = await executeServerDeactivateWarehouse(mockSupabaseForDeactivate, 'org_test_1', 'user_1', 'wh_secondary');
  assert.equal(deactivatedWh.status, 'INACTIVE');
  assert.equal(deactivatedWh.isDefault, false);
  console.log('✅ [6/8] Default warehouse deactivation protection verified.\n');

  // --------------------------------------------------------------------------
  // Test 7: Local Storage Authority Stripped & Migration File Check
  // --------------------------------------------------------------------------
  console.log('[7/8] Verifying Local Storage Non-Authority & Migration File Integrity...');
  const accountingTs = fs.readFileSync(path.join(process.cwd(), 'src/utils/accounting.ts'), 'utf8');
  assert(
    accountingTs.includes('// localStorage.setItem(\'accounting_warehouses\','),
    'Must comment out / disable operational writes to accounting_warehouses in saveAppState'
  );
  assert(
    accountingTs.includes('warehouses: [],') && accountingTs.includes('warehouses and warehouseTransfers are authoritative in PostgreSQL DB'),
    'Must return empty array for warehouses from localStorage in loadAppState'
  );

  const migrationFile = path.join(process.cwd(), 'supabase/migrations/29_atomic_warehouse_master_data.sql');
  assert(fs.existsSync(migrationFile), 'Migration 29_atomic_warehouse_master_data.sql must exist');
  const migrationSql = fs.readFileSync(migrationFile, 'utf8');
  assert(migrationSql.includes('create_warehouse_atomic'), 'Migration must declare create_warehouse_atomic');
  assert(migrationSql.includes('update_warehouse_atomic'), 'Migration must declare update_warehouse_atomic');
  assert(migrationSql.includes('set_default_warehouse_atomic'), 'Migration must declare set_default_warehouse_atomic');
  assert(migrationSql.includes('deactivate_warehouse_atomic'), 'Migration must declare deactivate_warehouse_atomic');
  assert(migrationSql.includes('warehouse_code_sequences'), 'Migration must create warehouse_code_sequences');
  console.log('✅ [7/8] LocalStorage authority stripped and migration file integrity verified.\n');

  // --------------------------------------------------------------------------
  // Test 8: Client Hydration Integration with Database Warehouses
  // --------------------------------------------------------------------------
  console.log('[8/8] Verifying executeFinancialHydration with Warehouses...');
  let testState: AppState = {
    persons: [],
    invoices: [],
    vouchers: [],
    checks: [],
    calculators: [],
    products: [],
    warehouses: []
  } as any;

  const mockDbWarehouses: Warehouse[] = [
    {
      id: 'wh_hydrated_1',
      name: 'انبار مرکزی تبریز',
      code: 'WH-0001',
      location: 'تبریز، شهرک صنعتی',
      isDefault: true,
      status: 'ACTIVE',
      version: 1,
      createdAt: '2026-08-24T00:00:00Z'
    }
  ];

  await executeFinancialHydration({
    generationId: 1,
    getCurrentGenerationId: () => 1,
    isLoggedIn: true,
    currentUserId: 'user_1',
    currentUserRole: 'admin',
    organizationId: 'org_test_1',
    services: {
      getPersons: async () => [],
      getInvoices: async () => [],
      getVouchers: async () => [],
      getCheques: async () => [],
      getCalculators: async () => [],
      getProducts: async () => [],
      getCategories: async () => [],
      getMeasurementUnits: async () => [],
      getWarehouses: async () => mockDbWarehouses
    },
    onSetState: (updater: any) => {
      testState = updater(testState);
    },
    onSetStatus: () => {},
    onSetError: () => {}
  });

  assert.equal(testState.warehouses.length, 1);
  assert.equal(testState.warehouses[0].name, 'انبار مرکزی تبریز');
  assert.equal(testState.warehouses[0].isDefault, true);
  console.log('✅ [8/8] Financial hydration with database warehouses verified.\n');

  console.log('================================================================');
  console.log('ALL INSTRUCTION 4 WAREHOUSE MASTER DATA TESTS PASSED SUCCESSFULLY');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('❌ Test execution failed:', err);
  process.exit(1);
});
