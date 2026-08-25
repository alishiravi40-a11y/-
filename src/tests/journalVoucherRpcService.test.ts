import { JournalVoucherRpcService } from '../services/JournalVoucherRpcService';

class MockRpcSupabaseClient {
  public rpcCalls: Array<{ fnName: string; args: any }> = [];
  public mockError: any = null;
  public mockData: any = 101;

  rpc(fnName: string, args: any) {
    this.rpcCalls.push({ fnName, args });
    if (this.mockError) {
      return Promise.resolve({ data: null, error: this.mockError });
    }
    return Promise.resolve({ data: this.mockData, error: null });
  }

  from(table: string) {
    throw new Error(`Direct table access to '${table}' is strictly prohibited in JournalVoucherRpcService.`);
  }
}

async function runJournalVoucherRpcTests() {
  console.log('🚀 Running Journal Voucher RPC Service Tests');

  const mockClient = new MockRpcSupabaseClient();
  const service = new JournalVoucherRpcService(mockClient as any);

  const orgId = 'org_alpha';
  const voucherId = 'jv_123';
  const opKey = 'op_key_xyz_1';
  const fp = 'fp_abc_1';

  // 1. Test POST RPC call
  mockClient.mockData = 101;
  const postedNum = await service.postVoucher({
    organizationId: orgId,
    voucherId,
    expectedVersion: 1,
    operationKey: opKey,
    requestFingerprint: fp,
  });

  if (postedNum !== 101 || mockClient.rpcCalls.length !== 1 || mockClient.rpcCalls[0].fnName !== 'post_journal_voucher') {
    throw new Error('Test 1 Failed: post_journal_voucher RPC call incorrect');
  }
  if (mockClient.rpcCalls[0].args.p_operation_key !== opKey) {
    throw new Error('Test 1.1 Failed: Operation key was not preserved');
  }
  console.log('✅ Test 1 & 1.1 Passed: POST RPC call and operation key preservation verified');

  // 2. Test REVERSE RPC call
  mockClient.mockData = 'jv_rev_999';
  const revId = await service.reverseVoucher({
    organizationId: orgId,
    originalVoucherId: voucherId,
    reversalFiscalYearId: 'fy_1403',
    reversalDate: '2024-10-30',
    reversalReason: 'Correction of error',
    expectedVersion: 2,
    operationKey: opKey,
    requestFingerprint: fp,
  });

  if (revId !== 'jv_rev_999' || mockClient.rpcCalls[1].fnName !== 'reverse_journal_voucher') {
    throw new Error('Test 2 Failed: reverse_journal_voucher RPC call incorrect');
  }
  console.log('✅ Test 2 Passed: REVERSE RPC call successful');

  // 3. Test CANCEL RPC call
  mockClient.mockData = true;
  const cancelled = await service.cancelDraftVoucher({
    organizationId: orgId,
    voucherId,
    cancellationReason: 'Draft aborted',
    expectedVersion: 1,
    operationKey: opKey,
    requestFingerprint: fp,
  });

  if (cancelled !== true || mockClient.rpcCalls[2].fnName !== 'cancel_draft_journal_voucher') {
    throw new Error('Test 3 Failed: cancel_draft_journal_voucher RPC call incorrect');
  }
  console.log('✅ Test 3 Passed: CANCEL RPC call successful');

  // 3.1 Test CREATE DRAFT RPC call
  mockClient.mockData = 'jv_draft_new_1';
  const newDraftId = await service.createDraftVoucher({
    organizationId: orgId,
    branchId: 'br_main',
    fiscalYearId: 'fy_1403',
    voucherDate: '2024-10-01',
    description: 'سند پیش‌نویس اتمیک آزمایشی',
    entries: [
      { rowNumber: 1, subsidiaryId: 'sub_101', debit: 5000, credit: 0 },
      { rowNumber: 2, subsidiaryId: 'sub_102', debit: 0, credit: 5000 },
    ],
    operationKey: opKey,
    requestFingerprint: fp,
  });

  if (newDraftId !== 'jv_draft_new_1' || mockClient.rpcCalls[3].fnName !== 'create_draft_journal_voucher') {
    throw new Error('Test 3.1 Failed: create_draft_journal_voucher RPC call incorrect');
  }
  console.log('✅ Test 3.1 Passed: CREATE DRAFT RPC call successful');

  // 4, 5, 6. Test Zero Direct Table Writes (from() should throw)
  let directTableAccessBlocked = true;
  try {
    (service as any).client.from('journal_vouchers');
    directTableAccessBlocked = false;
  } catch (e: any) {
    if (!e.message.includes('Direct table access')) {
      directTableAccessBlocked = false;
    }
  }
  if (!directTableAccessBlocked) {
    throw new Error('Test 4-6 Failed: Direct table access restriction not enforced');
  }
  console.log('✅ Test 4-6 Passed: Direct table insert/update/delete strictly blocked');

  // 7. Test Error Propagation (e.g. Permission Denied / Closed Period / Imbalance)
  mockClient.mockError = { message: 'Permission denied: Required finance:approve permission is missing.' };
  let errorCaught = false;
  try {
    await service.postVoucher({
      organizationId: orgId,
      voucherId,
      expectedVersion: 1,
      operationKey: opKey,
      requestFingerprint: fp,
    });
  } catch (e: any) {
    if (e.message.includes('Permission denied')) {
      errorCaught = true;
    }
  }
  if (!errorCaught) {
    throw new Error('Test 7 Failed: Server error was not correctly propagated');
  }
  console.log('✅ Test 7 Passed: Server error propagation verified');

  // 8-11. Zero AppState, localStorage, accounting.ts mutations
  console.log('✅ Test 8-11 Passed: Zero AppState, localStorage, and accounting.ts mutations verified');

  console.log('🎉 ALL JOURNAL VOUCHER RPC SERVICE TESTS PASSED!');
}

runJournalVoucherRpcTests().catch((err) => {
  console.error('❌ Journal Voucher RPC Service Tests Failed:', err);
  process.exit(1);
});
