import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { executeServerTransitionCheque, generateChequeTransitionFingerprint } from '../server/cheques/chequeService';

console.log('======================================================================');
console.log('🧪 RUNNING SERVER CHEQUE TRANSITION & ACCOUNTING CONTRACT TESTS (BLOCK 3 - COMMAND 6)');
console.log('======================================================================');

let testsPassed = 0;
let totalTests = 0;

function pass(testName: string) {
  totalTests++;
  testsPassed++;
  console.log(`✅ TEST PASSED: ${testName}`);
}

async function runTests() {
  // 1. Verify migration 21 exists
  const migPath = path.join(process.cwd(), 'supabase/migrations/21_cheque_atomic_transition.sql');
  assert.ok(fs.existsSync(migPath), 'Migration 21_cheque_atomic_transition.sql exists');
  pass('Migration 21 file exists');

  const migSql = fs.readFileSync(migPath, 'utf8');
  assert.ok(migSql.includes('CREATE OR REPLACE FUNCTION public.transition_cheque_atomic'), 'Defines transition_cheque_atomic function');
  assert.ok(migSql.includes('cheque_mutations'), 'Integrates cheque_mutations ledger');
  assert.ok(migSql.includes('FOR UPDATE'), 'Implements row-level locking');
  pass('Atomic transition SQL function structure & pessimistic locking verified');

  // 2. Test transition fingerprint generation
  const p1 = { toState: 'cleared', expectedVersion: 1, bankSubId: 'SUB_BANK_MELI' };
  const fp1 = generateChequeTransitionFingerprint(p1);
  const fp2 = generateChequeTransitionFingerprint(p1);
  assert.equal(fp1, fp2, 'Deterministic transition fingerprint generated');
  pass('Transition request fingerprinting works consistently');

  // 3. Mock supabase client test for unit logic & service contract
  let mockCheque = {
    id: 'chq-uuid-100',
    organization_id: 'org-1',
    cheque_type: 'received',
    current_state: 'present_in_cashbox',
    version: 1,
    check_number: 'CHK-999',
    amount: 2500000,
    person_id: 'person-1',
    investor_id: null
  };

  let mockInvestorCheque = {
    id: 'chq-inv-200',
    organization_id: 'org-1',
    cheque_type: 'paid',
    current_state: 'issued',
    version: 1,
    check_number: 'CHK-INV-001',
    amount: 10000000,
    person_id: 'person-investor-1',
    investor_id: 'inv-profile-999'
  };

  let mockMutations: any[] = [];
  let mockHistory: any[] = [];
  let mockVouchers: any[] = [];
  let rpcCallCount = 0;

  const mockSupabase = {
    from: (table: string) => {
      if (table !== 'cheques') throw new Error(`Unexpected table ${table}`);
      let targetId: string | null = null;
      let targetOrgId: string | null = null;
      const builder = {
        select: (_cols: string) => builder,
        eq: (col: string, val: any) => {
          if (col === 'id') targetId = val;
          if (col === 'organization_id') targetOrgId = val;
          return builder;
        },
        maybeSingle: async () => {
          if (targetId === mockCheque.id && targetOrgId === mockCheque.organization_id) {
            return { data: { ...mockCheque }, error: null };
          }
          if (targetId === mockInvestorCheque.id && targetOrgId === mockInvestorCheque.organization_id) {
            return { data: { ...mockInvestorCheque }, error: null };
          }
          return { data: null, error: null };
        }
      };
      return builder;
    },
    rpc: async (fnName: string, args: any) => {
      rpcCallCount++;
      if (fnName !== 'transition_cheque_atomic') return { error: { message: 'Unknown RPC' }};

      // Find active cheque
      const activeCheque = args.p_cheque_id === mockInvestorCheque.id ? mockInvestorCheque : mockCheque;

      // Check idempotency
      const existingMut = mockMutations.find(m => m.organization_id === args.p_organization_id && m.mutation_key === args.p_mutation_key);
      if (existingMut) {
        if (existingMut.request_fingerprint === args.p_request_fingerprint) {
          return { data: { ...existingMut, idempotent_replay: true }, error: null };
        } else {
          return { error: { message: 'ERR_IDEMPOTENCY_CONFLICT: Mutation key mismatch' }};
        }
      }

      // Check version
      if (activeCheque.version !== args.p_expected_version) {
        return { error: { message: `ERR_STALE_VERSION: Expected ${activeCheque.version}, got ${args.p_expected_version}` }};
      }

      // Check allowed transitions
      const t = args.p_to_state;
      const f = activeCheque.current_state;
      const type = activeCheque.cheque_type;
      let valid = false;
      if (type === 'received') {
        if (f === 'present_in_cashbox' && ['deposited_to_bank', 'cleared', 'passed_to_others', 'bounced'].includes(t)) valid = true;
        else if (f === 'deposited_to_bank' && ['cleared', 'bounced'].includes(t)) valid = true;
        else if (f === 'passed_to_others' && ['present_in_cashbox', 'bounced'].includes(t)) valid = true;
        else if (f === 'bounced' && t === 'cleared') valid = true;
      } else if (type === 'paid') {
        if (f === 'issued' && ['cleared', 'bounced'].includes(t)) valid = true;
      }

      if (!valid) {
        return { error: { message: `ERR_INVALID_TRANSITION: Invalid transition from ${f} to ${t}` }};
      }

      // Perform transition
      const vId = 'v-uuid-123';
      const hId = 'h-uuid-456';
      const mId = 'm-uuid-789';

      activeCheque.current_state = t;
      activeCheque.version += 1;

      mockMutations.push({
        id: mId,
        organization_id: args.p_organization_id,
        cheque_id: args.p_cheque_id,
        mutation_key: args.p_mutation_key,
        request_fingerprint: args.p_request_fingerprint,
        from_state: f,
        to_state: t,
        version_before: args.p_expected_version,
        version_after: activeCheque.version
      });

      mockHistory.push({
        id: hId,
        cheque_id: args.p_cheque_id,
        from_state: f,
        to_state: t
      });

      return {
        data: {
          id: activeCheque.id,
          organization_id: args.p_organization_id,
          from_state: f,
          to_state: t,
          version: activeCheque.version,
          voucher_id: vId,
          voucher_number: 10,
          history_id: hId,
          mutation_id: mId,
          idempotent_replay: false
        },
        error: null
      };
    }
  };

  // Test 1: Valid received transition: present_in_cashbox -> deposited_to_bank
  const res1 = await executeServerTransitionCheque(mockSupabase as any, 'org-1', 'user-1', mockCheque.id, {
    toState: 'deposited_to_bank',
    expectedVersion: 1,
    mutationKey: 'mut-1',
    description: 'واگذاری به بانک'
  });
  assert.equal(res1.to_state, 'deposited_to_bank');
  assert.equal(res1.version, 2);
  assert.equal(res1.idempotent_replay, false);
  pass('Received cheque transition present_in_cashbox -> deposited_to_bank succeeds atomically');

  // Test 2: Idempotent retry with same mutation key & fingerprint
  const res2 = await executeServerTransitionCheque(mockSupabase as any, 'org-1', 'user-1', mockCheque.id, {
    toState: 'deposited_to_bank',
    expectedVersion: 1, // note: expectedVersion in retry payload doesn't re-trigger version check if idempotent hit
    mutationKey: 'mut-1',
    description: 'واگذاری به بانک'
  });
  assert.equal(res2.idempotent_replay, true);
  pass('Idempotent retry with same mutation key returns committed result without double mutation');

  // Test 3: Idempotency conflict with modified payload
  try {
    await executeServerTransitionCheque(mockSupabase as any, 'org-1', 'user-1', mockCheque.id, {
      toState: 'cleared', // different payload
      expectedVersion: 2,
      mutationKey: 'mut-1', // same mutation key
    });
    assert.fail('Should reject idempotency conflict');
  } catch (err: any) {
    assert.ok(err.message.includes('ERR_IDEMPOTENCY_CONFLICT') || err.message.includes('mismatch'));
    pass('Idempotency conflict with modified payload strictly rejected');
  }

  // Test 4: Stale version check (optimistic concurrency)
  try {
    await executeServerTransitionCheque(mockSupabase as any, 'org-1', 'user-1', mockCheque.id, {
      toState: 'cleared',
      expectedVersion: 1, // stale version (current is 2)
      mutationKey: 'mut-2',
    });
    assert.fail('Should reject stale version');
  } catch (err: any) {
    assert.ok(err.message.includes('ERR_STALE_VERSION'));
    pass('Stale expectedVersion rejected with zero writes');
  }

  // Test 5: Successful next transition: deposited_to_bank -> cleared
  const res3 = await executeServerTransitionCheque(mockSupabase as any, 'org-1', 'user-1', mockCheque.id, {
    toState: 'cleared',
    expectedVersion: 2,
    mutationKey: 'mut-3',
    bankSubId: 'SUB_BANK_MELI'
  });
  assert.equal(res3.to_state, 'cleared');
  assert.equal(res3.version, 3);
  pass('Received cheque transition deposited_to_bank -> cleared succeeds and increments version exactly once');

  // Test 6: Invalid transition fail-closed test (cleared -> deposited_to_bank)
  try {
    await executeServerTransitionCheque(mockSupabase as any, 'org-1', 'user-1', mockCheque.id, {
      toState: 'deposited_to_bank',
      expectedVersion: 3,
      mutationKey: 'mut-4',
    });
    assert.fail('Should reject invalid transition');
  } catch (err: any) {
    assert.ok(err.message.includes('ERR_INVALID_TRANSITION'));
    pass('Invalid lifecycle transition strictly fails closed');
  }

  // ==============================================================================
  // PHASE 24-A: INVESTOR CHEQUE CLEARING SAFETY MITIGATION TESTS
  // ==============================================================================

  // Test 7: Cheque with investor_id attempting to clear is blocked
  const initialRpcCalls = rpcCallCount;
  const initialMutationsLength = mockMutations.length;
  const initialVersion = mockInvestorCheque.version;

  try {
    await executeServerTransitionCheque(mockSupabase as any, 'org-1', 'user-1', mockInvestorCheque.id, {
      toState: 'cleared',
      expectedVersion: 1,
      mutationKey: 'mut-inv-clear-1',
      bankSubId: 'SUB_BANK_MELI'
    });
    assert.fail('Should reject clearing investor cheque');
  } catch (err: any) {
    assert.ok(err.message.startsWith('ERR_INVESTOR_CHEQUE_CLASSIFICATION_UNSAFE'));
    assert.ok(err.message.includes('پاس‌کردن این چک موقتاً متوقف است'));
    pass('Phase 24-A: Cheque with investor_id attempting to clear is blocked with ERR_INVESTOR_CHEQUE_CLASSIFICATION_UNSAFE');
  }

  // Test 8: Verify RPC was called 0 times during blocked clearing attempt
  assert.equal(rpcCallCount, initialRpcCalls, 'RPC atomic transition function was called 0 times');
  pass('Phase 24-A: Zero RPC calls made when transition is blocked');

  // Test 9: Verify no mutation, history or version change occurred
  assert.equal(mockMutations.length, initialMutationsLength, 'No mutations recorded');
  assert.equal(mockInvestorCheque.version, initialVersion, 'Cheque version unchanged');
  assert.equal(mockInvestorCheque.current_state, 'issued', 'Cheque current_state remains issued');
  pass('Phase 24-A: Zero state, version, or ledger mutations on blocked clearing attempt');

  // Test 10: Client body spoofing investorId: null cannot bypass DB check
  try {
    await executeServerTransitionCheque(mockSupabase as any, 'org-1', 'user-1', mockInvestorCheque.id, {
      toState: 'cleared',
      expectedVersion: 1,
      mutationKey: 'mut-inv-clear-spoof',
      bankSubId: 'SUB_BANK_MELI',
      investorId: null as any
    } as any);
    assert.fail('Client body investorId: null spoofing should be ignored');
  } catch (err: any) {
    assert.ok(err.message.startsWith('ERR_INVESTOR_CHEQUE_CLASSIFICATION_UNSAFE'));
    pass('Phase 24-A: Client body investorId: null spoofing strictly blocked by DB authoritative read');
  }

  // Test 11: Non-existent cheque or org isolation failure rejected safely
  try {
    await executeServerTransitionCheque(mockSupabase as any, 'org-2', 'user-1', mockInvestorCheque.id, {
      toState: 'cleared',
      expectedVersion: 1,
      mutationKey: 'mut-inv-org-spoof'
    });
    assert.fail('Should reject cross-org or missing cheque');
  } catch (err: any) {
    assert.ok(err.message.startsWith('ERR_CHEQUE_NOT_FOUND'));
    pass('Phase 24-A: Cross-org or non-existent cheque rejected safely with ERR_CHEQUE_NOT_FOUND');
  }

  console.log(`\n🎉 ALL ${testsPassed}/${totalTests} SERVER CHEQUE TRANSITION TESTS PASSED!`);
  console.log('======================================================================\n');
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
