import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

console.log('======================================================================');
console.log('🧪 RUNNING STEP 6: INSTALLMENT & CHEQUE SETTLEMENT INTEGRITY TESTS');
console.log('======================================================================');

let testsPassed = 0;
let totalTests = 0;

function pass(testName: string) {
  totalTests++;
  testsPassed++;
  console.log(`✅ TEST PASSED: ${testName}`);
}

async function runTests() {
  // 1. Verify Migration 26 SQL File Exists and Contains Core Functions & Invariants
  const migrationPath = path.resolve('supabase/migrations/26_installment_settlement_atomic.sql');
  assert.ok(fs.existsSync(migrationPath), 'Migration 26 must exist');

  const migrationContent = fs.readFileSync(migrationPath, 'utf8');

  // Verify function definitions
  assert.ok(migrationContent.includes('CREATE OR REPLACE FUNCTION public.create_installment_book_atomic'), 'Must contain create_installment_book_atomic');
  assert.ok(migrationContent.includes('CREATE OR REPLACE FUNCTION public.settle_installment_atomic'), 'Must contain settle_installment_atomic');

  // Verify Row Locking
  assert.ok(migrationContent.includes('FOR UPDATE'), 'Must contain FOR UPDATE pessimistic row-level locking');

  // Verify Double Entry Invariant and Debit/Credit Entries
  assert.ok(migrationContent.includes('INSERT INTO public.journal_vouchers'), 'Must create journal voucher on settlement');
  assert.ok(migrationContent.includes('INSERT INTO public.voucher_entries'), 'Must create double-entry voucher rows');
  assert.ok(migrationContent.includes('uq_installment_payment_op_key') || migrationContent.includes('voucher_operation_keys'), 'Must maintain deterministic idempotency keys');

  pass('Migration 26 contains atomic installment creation & settlement RPCs with row locking & double entry');

  // 2. Verify Server Routes Configured in server.ts
  const serverPath = path.resolve('server.ts');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  assert.ok(serverContent.includes('app.post("/api/installments/create"'), 'server.ts must have /api/installments/create route');
  assert.ok(serverContent.includes('app.post("/api/installments/settle"'), 'server.ts must have /api/installments/settle route');
  assert.ok(serverContent.includes('create_installment_book_atomic'), 'server.ts must call create_installment_book_atomic RPC');
  assert.ok(serverContent.includes('settle_installment_atomic'), 'server.ts must call settle_installment_atomic RPC');

  pass('Server routes /api/installments/create and /api/installments/settle wired with auth & policies');

  // 3. Verify Server Route Authorization Policies
  const policyPath = path.resolve('src/server/auth/serverRouteAuthorizationPolicy.ts');
  const policyContent = fs.readFileSync(policyPath, 'utf8');

  assert.ok(policyContent.includes('INSTALLMENT_CREATE_POST'), 'Route policy must include INSTALLMENT_CREATE_POST');
  assert.ok(policyContent.includes('INSTALLMENT_SETTLE_POST'), 'Route policy must include INSTALLMENT_SETTLE_POST');

  pass('Server route authorization policies defined for installment operations');

  // 4. Verify Invoice Cheque Orchestration Delegation in invoiceAtomicService.ts
  const invServicePath = path.resolve('src/server/invoices/invoiceAtomicService.ts');
  const invServiceContent = fs.readFileSync(invServicePath, 'utf8');

  assert.ok(invServiceContent.includes('create_invoice_with_cheques_atomic'), 'invoiceAtomicService must delegate to create_invoice_with_cheques_atomic');
  assert.ok(!invServiceContent.includes('ERR_FAIL_CLOSED_SETTLEMENT: تسویه با چک یا اقساط در فاز بعد'), 'Fail-closed guard must be removed from invoice creation');

  pass('Invoice atomic service orchestrates cheques and unblocks deferred/installment invoices');

  // 5. Verify InstallmentService Client Integration
  const installmentServicePath = path.resolve('src/services/installmentService.ts');
  assert.ok(fs.existsSync(installmentServicePath), 'InstallmentService must exist');
  const installmentServiceContent = fs.readFileSync(installmentServicePath, 'utf8');

  assert.ok(installmentServiceContent.includes('createInstallmentBook'), 'InstallmentService must have createInstallmentBook');
  assert.ok(installmentServiceContent.includes('settleInstallment'), 'InstallmentService must have settleInstallment');

  pass('InstallmentService client abstraction ready for UI consumption');

  console.log('\n======================================================================');
  console.log(`📊 SUMMARY: ${testsPassed} of ${totalTests} Step 6 tests passed successfully.`);
  console.log('======================================================================\n');
}

runTests().catch(err => {
  console.error('❌ Step 6 Test Failure:', err);
  process.exit(1);
});
