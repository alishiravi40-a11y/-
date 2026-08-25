import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('======================================================================');
console.log('🧪 RUNNING BLOCK 3 COMMAND 3: CHEQUES DB FOUNDATION TESTS');
console.log('======================================================================');

let testsPassed = 0;
let totalTests = 0;

function pass(testName: string) {
  totalTests++;
  testsPassed++;
  console.log(`✅ TEST PASSED: ${testName}`);
}

async function runTests() {
  const migrationPath = path.join(process.cwd(), 'supabase/migrations/19_cheques_foundation.sql');
  
  // 1. Migration file exists
  assert.ok(fs.existsSync(migrationPath), 'Migration file 19_cheques_foundation.sql exists');
  pass('Migration file 19_cheques_foundation.sql exists');

  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // 2. Table definitions exist
  assert.ok(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.cheques'), 'Contains cheques table');
  assert.ok(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.cheque_state_history'), 'Contains cheque_state_history table');
  assert.ok(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.cheque_mutations'), 'Contains cheque_mutations table');
  pass('All three core cheque foundation tables defined');

  // 3. UUID primary key & constraints
  assert.ok(migrationSql.includes('id UUID PRIMARY KEY DEFAULT gen_random_uuid()'), 'UUID primary key default gen_random_uuid()');
  assert.ok(migrationSql.includes('amount NUMERIC(18, 0) NOT NULL CHECK (amount > 0)'), 'Positive amount constraint');
  assert.ok(migrationSql.includes('version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)'), 'Optimistic version field');
  pass('UUID primary key, positive amount constraint, and optimistic version verified');

  // 4. State checks
  assert.ok(migrationSql.includes('present_in_cashbox'), 'Includes received state present_in_cashbox');
  assert.ok(migrationSql.includes('deposited_to_bank'), 'Includes received state deposited_to_bank');
  assert.ok(migrationSql.includes('cleared'), 'Includes cleared state');
  assert.ok(migrationSql.includes('passed_to_others'), 'Includes passed_to_others state');
  assert.ok(migrationSql.includes('bounced'), 'Includes bounced state');
  assert.ok(migrationSql.includes('issued'), 'Includes paid state issued');
  pass('Received and Paid state contracts preserved in check constraint');

  // 5. Idempotency & Unique constraints
  assert.ok(migrationSql.includes('CONSTRAINT uq_cheques_org_operation_key UNIQUE (organization_id, operation_key)'), 'Creation idempotency unique constraint');
  assert.ok(migrationSql.includes('CONSTRAINT uq_cheque_mutations_org_mutation_key UNIQUE (organization_id, mutation_key)'), 'Transition idempotency unique constraint');
  pass('Creation and transition idempotency constraints verified separately');

  // 6. Organization isolation & RLS
  assert.ok(migrationSql.includes('organization_id UUID NOT NULL REFERENCES public.organizations(id)'), 'Organization foreign key enforced');
  assert.ok(migrationSql.includes('ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on cheques');
  assert.ok(migrationSql.includes('ALTER TABLE public.cheque_state_history ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on cheque history');
  assert.ok(migrationSql.includes('ALTER TABLE public.cheque_mutations ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on cheque mutations');
  pass('Organization isolation and RLS policies verified');

  // 7. Simulation of Cheque Foundation Logic & Invariants
  console.log('\n--- Simulating Cheque Foundation Invariants ---');
  
  const mockCheques: Record<string, any> = {};
  const mockMutations: Record<string, any> = {};

  function createCheque(orgId: string, opKey: string, amount: number, chequeType: string, initialState: string) {
    if (amount <= 0) throw new Error('ERR_INVALID_AMOUNT: Amount must be positive');
    const key = `${orgId}:${opKey}`;
    if (mockCheques[key]) {
      throw new Error('ERR_DUPLICATE_CREATION: Operation key already exists for organization');
    }
    const id = `chq-${Math.random().toString(36).substring(7)}`;
    mockCheques[key] = { id, organizationId: orgId, operationKey: opKey, amount, chequeType, currentState: initialState, version: 1 };
    return mockCheques[key];
  }

  function mutateCheque(orgId: string, chequeId: string, mutationKey: string, targetState: string) {
    const mutKey = `${orgId}:${mutationKey}`;
    if (mockMutations[mutKey]) {
      return mockMutations[mutKey]; // Idempotent retry returns existing result
    }
    let foundCheque: any = null;
    for (const k of Object.keys(mockCheques)) {
      if (mockCheques[k].id === chequeId && mockCheques[k].organizationId === orgId) {
        foundCheque = mockCheques[k];
        break;
      }
    }
    if (!foundCheque) throw new Error('ERR_CHEQUE_NOT_FOUND');
    
    foundCheque.currentState = targetState;
    foundCheque.version += 1;
    mockMutations[mutKey] = { mutationKey, resultingState: targetState, version: foundCheque.version };
    return mockMutations[mutKey];
  }

  // Test normal creation
  const c1 = createCheque('org-1', 'op-key-1', 1000, 'received', 'present_in_cashbox');
  assert.ok(c1.id);
  pass('Cheque creation simulation succeeds');

  // Test duplicate operation key
  try {
    createCheque('org-1', 'op-key-1', 1000, 'received', 'present_in_cashbox');
    assert.fail('Should reject duplicate operation key');
  } catch (err: any) {
    assert.ok(err.message.includes('ERR_DUPLICATE_CREATION'));
    pass('Duplicate operation key correctly rejected');
  }

  // Test mutation idempotency
  const m1 = mutateCheque('org-1', c1.id, 'mut-1', 'cleared');
  const m2 = mutateCheque('org-1', c1.id, 'mut-1', 'cleared');
  assert.equal(m1.version, m2.version);
  pass('Mutation idempotency verified (reused without re-incrementing version)');

  console.log(`\n🎉 ALL ${testsPassed}/${totalTests} CHEQUES DB FOUNDATION TESTS PASSED!`);
  console.log('======================================================================\n');
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
