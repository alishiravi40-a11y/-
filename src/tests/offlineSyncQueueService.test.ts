import assert from 'node:assert/strict';
import {
  validateVoucherBalance,
  enqueueOfflineOperation,
  loadOfflineQueue,
  processOfflineQueue,
  OfflineQueueItem,
} from '../services/offlineSyncQueueService';

console.log('======================================================================');
console.log('🧪 RUNNING OFFLINE SYNC QUEUE SERVICE & INTEGRITY TESTS (BLOCK 10 - STEP 2)');
console.log('======================================================================');

let testsPassed = 0;
let totalTests = 0;

function pass(testName: string) {
  totalTests++;
  testsPassed++;
  console.log(`✅ TEST PASSED: ${testName}`);
}

// Mock localStorage in test runner environment
const mockStorage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => { mockStorage[key] = val; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  },
  key: (i: number) => Object.keys(mockStorage)[i] || null,
  length: 0,
};

async function runTests() {
  (globalThis as any).localStorage.clear();

  // Test 1: Double-Entry Mathematical Balance validation
  const balancedEntries = [
    { debit: 1000000, credit: 0 },
    { debit: 0, credit: 1000000 },
  ];
  const balancedCheck = validateVoucherBalance(balancedEntries);
  assert.equal(balancedCheck.isValid, true, 'Balanced entries must be valid');
  assert.equal(balancedCheck.totalDebit, 1000000);
  assert.equal(balancedCheck.totalCredit, 1000000);
  assert.equal(balancedCheck.difference, 0);
  pass('Strictly validates double-entry mathematical balance');

  // Test 2: Reject unbalanced journal vouchers (Fail-Closed)
  const unbalancedEntries = [
    { debit: 1000000, credit: 0 },
    { debit: 0, credit: 950000 },
  ];
  const unbalancedCheck = validateVoucherBalance(unbalancedEntries);
  assert.equal(unbalancedCheck.isValid, false, 'Unbalanced entries must be rejected');
  assert.equal(unbalancedCheck.difference, 50000);

  const unbalancedResult = enqueueOfflineOperation({
    type: 'VOUCHER_CREATE',
    organizationId: 'org_test_123',
    operationKey: 'op_unbalanced_1',
    payload: { entries: unbalancedEntries },
    autoProcess: false,
  });
  assert.equal(unbalancedResult.success, false, 'Unbalanced voucher queueing must fail');
  assert.ok(unbalancedResult.error?.includes('تراز سند دوبل معتبر نیست'));
  assert.equal(loadOfflineQueue().length, 0, 'No items queued on unbalanced voucher');
  pass('Rejects enqueueing unbalanced journal vouchers (Fail-Closed)');

  // Test 3: Successfully enqueues balanced vouchers and preserves idempotency operation key
  const balancedResult = enqueueOfflineOperation({
    type: 'VOUCHER_CREATE',
    organizationId: 'org_test_123',
    operationKey: 'op_balanced_1',
    payload: { entries: balancedEntries },
    autoProcess: false,
  });
  assert.equal(balancedResult.success, true);
  assert.ok(balancedResult.queueId);

  const queue = loadOfflineQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].operationKey, 'op_balanced_1');
  assert.equal(queue[0].status, 'PENDING');
  pass('Successfully enqueues balanced vouchers and preserves idempotency operation key');

  // Test 4: Duplicate enqueue with same operationKey reuses queue item without duplication
  const duplicateResult = enqueueOfflineOperation({
    type: 'VOUCHER_CREATE',
    organizationId: 'org_test_123',
    operationKey: 'op_balanced_1',
    payload: { entries: balancedEntries },
    autoProcess: false,
  });
  assert.equal(duplicateResult.success, true);
  assert.equal(loadOfflineQueue().length, 1, 'Duplicate key must not increase queue length');
  pass('Duplicate operationKey does not produce duplicate queue item');

  // Test 5: Process offline queue with mocked fetch
  (globalThis as any).localStorage.clear();
  (globalThis as any).fetch = async () => ({
    ok: true,
    json: async () => ({ success: true }),
  });

  enqueueOfflineOperation({
    type: 'INVOICE_CREATE',
    organizationId: 'org_test_123',
    operationKey: 'op_invoice_1',
    payload: { invoiceNumber: 101, totalAmount: 500000 },
    autoProcess: false,
  });

  assert.equal(loadOfflineQueue().length, 1, 'Item present in queue prior to processing');

  const summary = await processOfflineQueue();
  assert.equal(summary.processed, 1, 'Processed 1 offline operation');
  assert.equal(summary.failed, 0, '0 failed operations');
  assert.equal(loadOfflineQueue().length, 0, 'Completed items pruned from pending queue');
  pass('Processes offline queue items when online and clears completed items');

  console.log('======================================================================');
  console.log(`🎉 ALL ${testsPassed}/${totalTests} OFFLINE QUEUE & INTEGRITY TESTS PASSED!`);
  console.log('======================================================================');
}

runTests().catch((err) => {
  console.error('❌ OFFLINE QUEUE TEST SUITE FAILED:', err);
  process.exit(1);
});
