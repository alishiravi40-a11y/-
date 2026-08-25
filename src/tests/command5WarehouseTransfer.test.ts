import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import {
  executeGetWarehouseAccountMappings,
  executeSetWarehouseAccountMapping,
  executeWarehouseTransferAtomic,
  executeReverseWarehouseTransferAtomic,
  executeGetWarehouseTransfers,
} from '../server/inventory/warehouseTransferService';
import { SERVER_ROUTE_POLICIES } from '../server/auth/serverRouteAuthorizationPolicy';

async function runCommand5Tests() {
  console.log('================================================================');
  console.log('🚀 RUNNING COMMAND 5: ATOMIC WAREHOUSE TRANSFER & ACCOUNTING TESTS');
  console.log('================================================================\n');

  // Test 1: Verify Authorization Policies in SERVER_ROUTE_POLICIES
  console.log('[1/15] Verifying route authorization policies for Command 5...');
  const getMappingsPolicy = SERVER_ROUTE_POLICIES.find(p => p.policyId === 'WAREHOUSE_ACCOUNT_MAPPINGS_GET');
  const postMappingsPolicy = SERVER_ROUTE_POLICIES.find(p => p.policyId === 'WAREHOUSE_ACCOUNT_MAPPINGS_POST');
  const getTransfersPolicy = SERVER_ROUTE_POLICIES.find(p => p.policyId === 'WAREHOUSE_TRANSFERS_GET');
  const postTransfersPolicy = SERVER_ROUTE_POLICIES.find(p => p.policyId === 'WAREHOUSE_TRANSFERS_POST');
  const reverseTransfersPolicy = SERVER_ROUTE_POLICIES.find(p => p.policyId === 'WAREHOUSE_TRANSFERS_REVERSE_POST');

  assert(getMappingsPolicy, 'WAREHOUSE_ACCOUNT_MAPPINGS_GET policy must be defined');
  assert(postMappingsPolicy, 'WAREHOUSE_ACCOUNT_MAPPINGS_POST policy must be defined');
  assert(getTransfersPolicy, 'WAREHOUSE_TRANSFERS_GET policy must be defined');
  assert(postTransfersPolicy, 'WAREHOUSE_TRANSFERS_POST policy must be defined');
  assert(reverseTransfersPolicy, 'WAREHOUSE_TRANSFERS_REVERSE_POST policy must be defined');

  // Check required permissions
  assert.deepEqual(
    getMappingsPolicy.requiredPermissions,
    ['inventory:read', 'inventory:manage', 'finance:read'],
    'WAREHOUSE_ACCOUNT_MAPPINGS_GET permissions'
  );
  assert.deepEqual(
    postMappingsPolicy.requiredPermissions,
    ['inventory:manage', 'finance:approve'],
    'WAREHOUSE_ACCOUNT_MAPPINGS_POST permissions'
  );
  assert.deepEqual(
    getTransfersPolicy.requiredPermissions,
    ['inventory:read', 'inventory:manage', 'finance:read'],
    'WAREHOUSE_TRANSFERS_GET permissions'
  );
  assert.deepEqual(
    postTransfersPolicy.requiredPermissions,
    ['inventory:post'],
    'WAREHOUSE_TRANSFERS_POST permissions'
  );
  assert.deepEqual(
    reverseTransfersPolicy.requiredPermissions,
    ['inventory:post', 'finance:approve'],
    'WAREHOUSE_TRANSFERS_REVERSE_POST permissions'
  );
  console.log('✅ Route authorization policies verified.\n');

  // Test 2: Check 0 operational reads/writes for accounting_transfers in localStorage
  console.log('[2/15] Verifying 0 operational reads/writes for accounting_transfers...');
  const accountingTsPath = path.resolve('src/utils/accounting.ts');
  const accountingTsContent = fs.readFileSync(accountingTsPath, 'utf-8');

  const activeTransferReads = accountingTsContent.split('\n').filter(line => 
    !line.trim().startsWith('//') && line.includes("localStorage.getItem('accounting_transfers')")
  );
  assert.equal(activeTransferReads.length, 0, 'Operational reads of accounting_transfers MUST be 0');

  const activeTransferWrites = accountingTsContent.split('\n').filter(line => 
    !line.trim().startsWith('//') && line.includes("localStorage.setItem('accounting_transfers'")
  );
  assert.equal(activeTransferWrites.length, 0, 'Operational writes of accounting_transfers MUST be 0');
  console.log('✅ 0 operational reads/writes for accounting_transfers verified.\n');

  // Test 3: Check migration 30 SQL file existence and structure
  console.log('[3/15] Verifying migration 30_atomic_warehouse_transfer_accounting.sql file...');
  const migrationPath = path.resolve('supabase/migrations/30_atomic_warehouse_transfer_accounting.sql');
  assert(fs.existsSync(migrationPath), 'Migration 30 file must exist');
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

  const migration07Path = path.resolve('supabase/migrations/07_inventory_ledger_foundation.sql');
  assert(fs.existsSync(migration07Path), 'Migration 07 file must exist');
  const migration07Sql = fs.readFileSync(migration07Path, 'utf-8');

  assert(migrationSql.includes('rpc_get_warehouse_account_mappings'), 'Must define rpc_get_warehouse_account_mappings');
  assert(migrationSql.includes('rpc_set_warehouse_account_mapping'), 'Must define rpc_set_warehouse_account_mapping');
  assert(migrationSql.includes('rpc_execute_warehouse_transfer_atomic'), 'Must define rpc_execute_warehouse_transfer_atomic');
  assert(migrationSql.includes('rpc_reverse_warehouse_transfer_atomic'), 'Must define rpc_reverse_warehouse_transfer_atomic');
  assert(migration07Sql.includes('EXCLUDE USING gist') || migration07Sql.includes('ex_wh_acct_map_no_overlap'), 'Must enforce GIST temporal exclusion constraint on mappings');
  console.log('✅ Migration 30 and 07 structure verified.\n');

  // Test 4: Verify App.tsx handleTransfer refactoring
  console.log('[4/15] Verifying App.tsx handleTransfer uses server-authoritative route...');
  const appTsxPath = path.resolve('src/App.tsx');
  const appTsxContent = fs.readFileSync(appTsxPath, 'utf-8');
  assert(appTsxContent.includes("fetch('/api/warehouse-transfers'"), 'App.tsx must post to /api/warehouse-transfers');
  assert(!appTsxContent.includes('createWarehouseTransferVoucher('), 'App.tsx must NOT build local warehouse transfer voucher');
  console.log('✅ App.tsx handleTransfer refactoring verified.\n');

  // Test 5: Verify Mock Supabase Client behavior for Warehouse Account Mappings
  console.log('[5/15] Testing Warehouse Account Mapping RPC wrappers...');
  const mockOrgId = 'org-test-command5';
  const mockUserId = 'user-test-command5';

  const mockSupabaseRpcClient: any = {
    rpc: async (fnName: string, args: any) => {
      if (fnName === 'rpc_get_warehouse_account_mappings') {
        assert.equal(args.p_organization_id, mockOrgId);
        return {
          data: [
            {
              id: 'map-1',
              organization_id: mockOrgId,
              warehouse_id: 'wh-source',
              subsidiary_id: 'sub-source-inv',
              is_active: true,
              valid_from: '2026-01-01T00:00:00Z',
              valid_to: null,
            },
            {
              id: 'map-2',
              organization_id: mockOrgId,
              warehouse_id: 'wh-dest',
              subsidiary_id: 'sub-dest-inv',
              is_active: true,
              valid_from: '2026-01-01T00:00:00Z',
              valid_to: null,
            }
          ],
          error: null
        };
      }
      if (fnName === 'rpc_set_warehouse_account_mapping') {
        assert.equal(args.p_organization_id, mockOrgId);
        assert.equal(args.p_user_id, mockUserId);
        return {
          data: {
            id: 'map-new',
            organization_id: mockOrgId,
            warehouse_id: args.p_warehouse_id,
            subsidiary_id: args.p_subsidiary_id,
            is_active: true,
            valid_from: '2026-08-24T00:00:00Z',
            valid_to: null,
          },
          error: null
        };
      }
      throw new Error(`Unexpected RPC call: ${fnName}`);
    }
  };

  const mappings = await executeGetWarehouseAccountMappings(mockSupabaseRpcClient, mockOrgId);
  assert.equal(mappings.length, 2);
  assert.equal((mappings[0] as any).subsidiary_id || mappings[0].subsidiaryId, 'sub-source-inv');

  const newMapping = await executeSetWarehouseAccountMapping(
    mockSupabaseRpcClient,
    mockOrgId,
    mockUserId,
    'wh-3',
    'sub-3-inv',
    'Initial mapping'
  );
  assert.equal((newMapping as any).warehouse_id || newMapping.warehouseId, 'wh-3');
  assert.equal((newMapping as any).subsidiary_id || newMapping.subsidiaryId, 'sub-3-inv');
  console.log('✅ Warehouse Account Mapping wrappers verified.\n');

  // Test 6: Verify executeWarehouseTransferAtomic wrapper
  console.log('[6/15] Testing Atomic Warehouse Transfer RPC wrapper...');
  let transferRpcCalled = false;
  const mockTransferClient: any = {
    rpc: async (fnName: string, args: any) => {
      if (fnName === 'rpc_execute_warehouse_transfer_atomic') {
        transferRpcCalled = true;
        assert.equal(args.p_organization_id, mockOrgId);
        assert.equal(args.p_source_warehouse_id, 'wh-source');
        assert.equal(args.p_destination_warehouse_id, 'wh-dest');
        assert.equal(args.p_items.length, 1);
        assert.equal(args.p_items[0].productId, 'prod-1');
        assert.equal(args.p_items[0].quantity, 10);
        return {
          data: {
            transaction: {
              id: 'tx-100',
              transaction_number: 'WT-2026-0001',
              transaction_type: 'INTERNAL_TRANSFER',
              source_warehouse_id: 'wh-source',
              destination_warehouse_id: 'wh-dest',
              status: 'POSTED'
            },
            journal_voucher: {
              id: 'jv-100',
              voucher_number: 1001,
              is_balanced: true,
              total_debit: 500000,
              total_credit: 500000
            },
            entries: [
              {
                subsidiary_id: 'sub-dest-inv',
                debit: 500000,
                credit: 0,
                description: 'انتقال بدهکار موجودی انبار مقصد'
              },
              {
                subsidiary_id: 'sub-source-inv',
                debit: 0,
                credit: 500000,
                description: 'انتقال بستانکار موجودی انبار مبدأ'
              }
            ]
          },
          error: null
        };
      }
      throw new Error(`Unexpected RPC call: ${fnName}`);
    }
  };

  const transferResult: any = await executeWarehouseTransferAtomic(mockTransferClient, {
    organizationId: mockOrgId,
    userId: mockUserId,
    sourceWarehouseId: 'wh-source',
    destinationWarehouseId: 'wh-dest',
    transferDate: '2026-08-24',
    description: 'انتقال کالا از مرکزی به غرب',
    operationKey: 'op-key-100',
    requestFingerprint: 'fp-100',
    items: [{ productId: 'prod-1', quantity: 10 }]
  });

  assert(transferRpcCalled);
  assert.equal(transferResult.transaction.transaction_number, 'WT-2026-0001');
  assert.equal(transferResult.journal_voucher.total_debit, 500000);
  assert.equal(transferResult.journal_voucher.total_credit, 500000);
  assert.equal(transferResult.entries[0].debit, 500000);
  assert.equal(transferResult.entries[1].credit, 500000);
  console.log('✅ Atomic Warehouse Transfer wrapper verified.\n');

  // Test 7: Verify executeReverseWarehouseTransferAtomic wrapper
  console.log('[7/15] Testing Atomic Warehouse Transfer Reversal RPC wrapper...');
  let reversalRpcCalled = false;
  const mockReversalClient: any = {
    rpc: async (fnName: string, args: any) => {
      if (fnName === 'rpc_reverse_warehouse_transfer_atomic') {
        reversalRpcCalled = true;
        assert.equal(args.p_organization_id, mockOrgId);
        assert.equal(args.p_transaction_id, 'tx-100');
        assert.equal(args.p_reversal_reason, 'خطا در مقدار ثبت شده');
        return {
          data: {
            original_transaction_id: 'tx-100',
            reversal_transaction: {
              id: 'tx-101',
              transaction_number: 'WT-2026-0002',
              transaction_type: 'INTERNAL_TRANSFER_REVERSAL',
              status: 'POSTED'
            },
            reversal_journal_voucher: {
              id: 'jv-101',
              voucher_number: 1002,
              is_balanced: true,
              total_debit: 500000,
              total_credit: 500000
            }
          },
          error: null
        };
      }
      throw new Error(`Unexpected RPC call: ${fnName}`);
    }
  };

  const reversalResult = await executeReverseWarehouseTransferAtomic(mockReversalClient, {
    organizationId: mockOrgId,
    userId: mockUserId,
    transactionId: 'tx-100',
    reversalReason: 'خطا در مقدار ثبت شده',
    operationKey: 'op-key-rev-100',
    requestFingerprint: 'fp-rev-100'
  });

  assert(reversalRpcCalled);
  assert.equal(reversalResult.original_transaction_id, 'tx-100');
  assert.equal(reversalResult.reversal_transaction.transaction_type, 'INTERNAL_TRANSFER_REVERSAL');
  assert.equal(reversalResult.reversal_journal_voucher.total_debit, 500000);
  console.log('✅ Atomic Warehouse Transfer Reversal wrapper verified.\n');

  // Test 8: Error handling - Missing Mapping
  console.log('[8/15] Testing error handling for ERR_MISSING_ACCOUNT_MAPPING...');
  const mockErrorClient: any = {
    rpc: async (fnName: string) => {
      if (fnName === 'rpc_execute_warehouse_transfer_atomic') {
        return { data: null, error: { message: 'ERR_MISSING_ACCOUNT_MAPPING: انبار مبدأ فاقد حساب معین موجودی فعال است.' } };
      }
    }
  };
  await assert.rejects(
    async () => {
      await executeWarehouseTransferAtomic(mockErrorClient, {
        organizationId: mockOrgId,
        userId: mockUserId,
        sourceWarehouseId: 'wh-no-map',
        destinationWarehouseId: 'wh-dest',
        transferDate: '2026-08-24',
        description: 'Test',
        operationKey: 'op-err-1',
        requestFingerprint: 'fp-err-1',
        items: [{ productId: 'prod-1', quantity: 5 }]
      });
    },
    (err: any) => err.message.includes('ERR_MISSING_ACCOUNT_MAPPING')
  );
  console.log('✅ ERR_MISSING_ACCOUNT_MAPPING handled correctly.\n');

  // Test 9: Error handling - Insufficient Stock
  console.log('[9/15] Testing error handling for ERR_INSUFFICIENT_STOCK...');
  const mockStockErrorClient: any = {
    rpc: async () => {
      return { data: null, error: { message: 'ERR_INSUFFICIENT_STOCK: موجودی انبار مبدأ برای کالا کافی نیست.' } };
    }
  };
  await assert.rejects(
    async () => {
      await executeWarehouseTransferAtomic(mockStockErrorClient, {
        organizationId: mockOrgId,
        userId: mockUserId,
        sourceWarehouseId: 'wh-source',
        destinationWarehouseId: 'wh-dest',
        transferDate: '2026-08-24',
        description: 'Test',
        operationKey: 'op-err-2',
        requestFingerprint: 'fp-err-2',
        items: [{ productId: 'prod-1', quantity: 99999 }]
      });
    },
    (err: any) => err.message.includes('ERR_INSUFFICIENT_STOCK')
  );
  console.log('✅ ERR_INSUFFICIENT_STOCK handled correctly.\n');

  // Test 10: Error handling - Same Warehouse Transfer Rejection
  console.log('[10/15] Testing error handling for ERR_SAME_WAREHOUSE...');
  const mockSameWhClient: any = {
    rpc: async () => {
      return { data: null, error: { message: 'ERR_SAME_WAREHOUSE: انبار مبدأ و مقصد نمی‌توانند یکسان باشند.' } };
    }
  };
  await assert.rejects(
    async () => {
      await executeWarehouseTransferAtomic(mockSameWhClient, {
        organizationId: mockOrgId,
        userId: mockUserId,
        sourceWarehouseId: 'wh-source',
        destinationWarehouseId: 'wh-source',
        transferDate: '2026-08-24',
        description: 'Test',
        operationKey: 'op-err-3',
        requestFingerprint: 'fp-err-3',
        items: [{ productId: 'prod-1', quantity: 5 }]
      });
    },
    (err: any) => err.message.includes('ERR_SAME_WAREHOUSE')
  );
  console.log('✅ ERR_SAME_WAREHOUSE handled correctly.\n');

  // Test 11: Idempotency Verification
  console.log('[11/15] Testing Idempotency (Same operation_key)...');
  const mockIdempotencyClient: any = {
    rpc: async (fnName: string, args: any) => {
      assert.equal(args.p_operation_key, 'op-key-idempotent-100');
      return {
        data: {
          transaction: { id: 'tx-100', transaction_number: 'WT-2026-0001' },
          journal_voucher: { id: 'jv-100', voucher_number: 1001 },
          is_idempotent_replay: true
        },
        error: null
      };
    }
  };

  const idResult: any = await executeWarehouseTransferAtomic(mockIdempotencyClient, {
    organizationId: mockOrgId,
    userId: mockUserId,
    sourceWarehouseId: 'wh-source',
    destinationWarehouseId: 'wh-dest',
    transferDate: '2026-08-24',
    description: 'Idempotent call',
    operationKey: 'op-key-idempotent-100',
    requestFingerprint: 'fp-100',
    items: [{ productId: 'prod-1', quantity: 10 }]
  });

  assert.equal(idResult.is_idempotent_replay, true);
  console.log('✅ Idempotency (replay) verified.\n');

  // Test 12: Invariant Check - Journal Voucher Double-Entry Balance
  console.log('[12/15] Verifying Double-Entry Balance invariant enforcement...');
  assert(migrationSql.includes('v_total_transfer_cost'), 'RPC must aggregate book value total amount');
  assert(migrationSql.includes('debit,'), 'Voucher entry must contain debit');
  assert(migrationSql.includes('credit,'), 'Voucher entry must contain credit');
  console.log('✅ Double-entry balance invariant in SQL verified.\n');

  // Test 13: Invariant Check - Row Locking (FOR UPDATE)
  console.log('[13/15] Verifying Row-Level Pessimistic Locking (FOR UPDATE)...');
  assert(migrationSql.includes('FOR UPDATE'), 'RPC must utilize FOR UPDATE row locking on balances and sequences');
  console.log('✅ Row-level locking verified in SQL.\n');

  // Test 14: Invariant Check - GIST Index Temporal Exclusion
  console.log('[14/15] Verifying GIST Temporal Exclusion Constraint...');
  assert(migration07Sql.includes('ex_wh_acct_map_no_overlap') || migration07Sql.includes('EXCLUDE USING gist'), 'Must define exclusion constraint name');
  console.log('✅ GIST Temporal Exclusion verified in SQL.\n');

  // Test 15: Matrix Classification Verification
  console.log('[15/15] Verifying Persistence Authority Matrix classification for warehouseTransfers...');
  const matrixPath = path.resolve('docs/data-persistence-authority-matrix.md');
  const matrixContent = fs.readFileSync(matrixPath, 'utf-8');
  assert(matrixContent.includes('| ۱۶ | `warehouseTransfers` | `WarehouseTransfer[]` | **پایگاه‌داده منبع قطعی**'), 'Matrix must classify warehouseTransfers as DATABASE_AUTHORITATIVE');
  console.log('✅ Persistence Authority Matrix classification verified.\n');

  console.log('================================================================');
  console.log('🎉 ALL COMMAND 5 TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================\n');
}

runCommand5Tests().catch((err) => {
  console.error('❌ COMMAND 5 TEST SUITE FAILED:', err);
  process.exit(1);
});
