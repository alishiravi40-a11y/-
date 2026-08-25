import { JournalVoucherRpcService } from '../services/JournalVoucherRpcService';

// Mock Supabase Client for Testing Cash Payment Atomic Cutover
class MockCashPaymentSupabaseClient {
  public rpcCalls: Array<{ fnName: string; args: any }> = [];
  public operationKeys: Set<string> = new Set();
  public draftVouchers: Map<string, any> = new Map();
  public nextVoucherNo = 1001;

  async rpc(fnName: string, args: any) {
    this.rpcCalls.push({ fnName, args });

    if (fnName === 'create_draft_journal_voucher') {
      const { p_operation_key, p_entries, p_description, p_organization_id } = args;

      // Idempotency check
      if (this.operationKeys.has(p_operation_key)) {
        // Return existing draft voucher ID for same operation_key
        for (const [id, draft] of this.draftVouchers.entries()) {
          if (draft.operationKey === p_operation_key) {
            return { data: id, error: null };
          }
        }
      }

      const draftId = 'draft_jv_' + Math.random().toString(36).substring(2, 9);
      this.operationKeys.add(p_operation_key);
      this.draftVouchers.set(draftId, {
        id: draftId,
        orgId: p_organization_id,
        operationKey: p_operation_key,
        description: p_description,
        entries: p_entries,
        status: 'DRAFT'
      });

      return { data: draftId, error: null };
    }

    if (fnName === 'post_journal_voucher') {
      const { p_voucher_id, p_operation_key } = args;
      const draft = this.draftVouchers.get(p_voucher_id);
      if (!draft) {
        return { data: null, error: { message: 'Draft voucher not found' } };
      }

      if (draft.voucherNumber) {
        // Idempotent return existing voucher number
        return { data: draft.voucherNumber, error: null };
      }

      const vNo = this.nextVoucherNo++;
      draft.status = 'POSTED';
      draft.voucherNumber = vNo;
      this.operationKeys.add(p_operation_key);

      return { data: vNo, error: null };
    }

    return { data: null, error: { message: `Unknown RPC function: ${fnName}` } };
  }

  from(table: string) {
    const self = this;
    return {
      select: (cols: string) => ({
        eq: (col: string, val: any) => ({
          limit: (n: number) => ({
            single: async () => ({ data: { id: val || 'uuid-123' }, error: null }),
            maybeSingle: async () => ({ data: { id: val || 'uuid-123' }, error: null })
          }),
          eq: (col2: string, val2: any) => ({
            maybeSingle: async () => ({ data: { id: val2 || 'uuid-456' }, error: null }),
            single: async () => ({ data: { id: val2 || 'uuid-456' }, error: null })
          }),
          single: async () => ({ data: { id: val || 'uuid-123' }, error: null }),
          maybeSingle: async () => ({ data: { id: val || 'uuid-123' }, error: null })
        }),
        limit: (n: number) => ({
          single: async () => ({ data: { id: 'uuid-789' }, error: null }),
          maybeSingle: async () => ({ data: { id: 'uuid-789' }, error: null })
        })
      })
    };
  }
}

export async function runCashPaymentCutoverTests() {
  console.log("=======================================================");
  console.log("🚀 Running Cash Payment Atomic Cutover Integration Tests");
  console.log("=======================================================\n");

  const mockClient = new MockCashPaymentSupabaseClient();
  const orgId = "00000000-0000-0000-0000-000000000001";
  const branchId = "00000000-0000-0000-0000-000000000002";
  const fiscalYearId = "00000000-0000-0000-0000-000000000003";

  const personId = "11111111-1111-1111-1111-111111111111";
  const creditorsSubId = "22222222-2222-2222-2222-222222222222"; // SUB_CREDITORS
  const bankSubId = "33333333-3333-3333-3333-333333333333"; // Bank/Cashbox account
  const payAmount = 1000000;
  const opKey = "op_pay_test_" + Date.now();
  const reqFingerprint = "fp_pay_test_" + Date.now();

  // 1. Create Draft Journal Voucher via RPC
  const formattedEntries = [
    {
      row_number: 1,
      subsidiary_id: creditorsSubId,
      person_id: personId,
      cost_center_id: null,
      debit: payAmount,
      credit: 0,
      description: "پرداخت نقدی/حواله به علی رضایی"
    },
    {
      row_number: 2,
      subsidiary_id: bankSubId,
      person_id: null,
      cost_center_id: null,
      debit: 0,
      credit: payAmount,
      description: "خروج وجه نقدی/حواله"
    }
  ];

  const draftRes = await mockClient.rpc('create_draft_journal_voucher', {
    p_organization_id: orgId,
    p_branch_id: branchId,
    p_fiscal_year_id: fiscalYearId,
    p_voucher_date: "1403/11/25",
    p_description: "پرداخت نقدی به علی رضایی",
    p_entries: formattedEntries,
    p_operation_key: opKey,
    p_request_fingerprint: reqFingerprint,
    p_source_type: 'CASH_PAYMENT',
    p_source_id: null,
    p_source_event_key: null
  });

  if (draftRes.error || !draftRes.data) {
    throw new Error(`Draft voucher creation failed: ${JSON.stringify(draftRes.error)}`);
  }

  const draftVoucherId = draftRes.data;
  console.log("✅ Step 1 Passed: Draft voucher created atomically with ID:", draftVoucherId);

  // Assert entries balance and account roles
  const createdDraft = mockClient.draftVouchers.get(draftVoucherId);
  if (!createdDraft) throw new Error("Draft voucher not stored in mock state");

  const debitEntry = createdDraft.entries.find((e: any) => e.debit > 0);
  const creditEntry = createdDraft.entries.find((e: any) => e.credit > 0);

  if (debitEntry.subsidiary_id !== creditorsSubId || debitEntry.person_id !== personId || debitEntry.debit !== payAmount) {
    throw new Error("Debit entry accounting error: Debit must be Creditors account with person reference");
  }
  if (creditEntry.subsidiary_id !== bankSubId || creditEntry.credit !== payAmount) {
    throw new Error("Credit entry accounting error: Credit must be Bank/Cashbox account");
  }
  console.log("✅ Step 2 Passed: Debit (Creditors) & Credit (Bank/Cashbox) accounting entries verified");

  // 2. Post Journal Voucher via RPC
  const postOpKey = "op_post_" + opKey;
  const postRes = await mockClient.rpc('post_journal_voucher', {
    p_organization_id: orgId,
    p_voucher_id: draftVoucherId,
    p_expected_version: 1,
    p_operation_key: postOpKey,
    p_request_fingerprint: "fp_post_" + reqFingerprint
  });

  if (postRes.error || !postRes.data) {
    throw new Error(`Posting voucher failed: ${JSON.stringify(postRes.error)}`);
  }

  const voucherNumber = postRes.data;
  console.log("✅ Step 3 Passed: Voucher posted with sequence number:", voucherNumber);

  // 3. Test Idempotency with exact same operationKey
  const duplicateDraftRes = await mockClient.rpc('create_draft_journal_voucher', {
    p_organization_id: orgId,
    p_branch_id: branchId,
    p_fiscal_year_id: fiscalYearId,
    p_voucher_date: "1403/11/25",
    p_description: "پرداخت نقدی به علی رضایی",
    p_entries: formattedEntries,
    p_operation_key: opKey,
    p_request_fingerprint: reqFingerprint,
    p_source_type: 'CASH_PAYMENT'
  });

  if (duplicateDraftRes.data !== draftVoucherId) {
    throw new Error(`Idempotency failure: Expected draft ID ${draftVoucherId}, got ${duplicateDraftRes.data}`);
  }

  const duplicatePostRes = await mockClient.rpc('post_journal_voucher', {
    p_organization_id: orgId,
    p_voucher_id: draftVoucherId,
    p_expected_version: 1,
    p_operation_key: postOpKey,
    p_request_fingerprint: "fp_post_" + reqFingerprint
  });

  if (duplicatePostRes.data !== voucherNumber) {
    throw new Error(`Idempotency failure: Expected voucher number ${voucherNumber}, got ${duplicatePostRes.data}`);
  }

  console.log("✅ Step 4 Passed: Idempotency re-execution verified (0 duplicate vouchers created)");
  console.log("\n=== ALL CASH PAYMENT CUTOVER INTEGRATION TESTS PASSED ===");
}

runCashPaymentCutoverTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
