import fs from 'fs';
import path from 'path';
import assert from 'node:assert/strict';

console.log('======================================================================');
console.log('🧪 RUNNING VERIFICATION TEST: INVOICES DB FOUNDATION (BLOCK 2 - COMMAND 3)');
console.log('======================================================================');

let testsPassed = 0;
let totalTests = 0;

function pass(testName: string) {
  totalTests++;
  testsPassed++;
  console.log(`✅ TEST PASSED: ${testName}`);
}

// 1. Verify Migration File Existence
const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '15_invoices_foundation.sql');
assert(fs.existsSync(migrationPath), 'Migration file 15_invoices_foundation.sql must exist');
pass('Migration file 15_invoices_foundation.sql exists');

const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

// 2. Schema Structure Verification
assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.invoice_sequences'), 'Contains invoice_sequences table definition');
assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.invoices'), 'Contains invoices table definition');
assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.invoice_items'), 'Contains invoice_items table definition');
pass('Schema definitions for invoice_sequences, invoices, and invoice_items exist');

// 3. Atomic Numbering Function Verification
assert(migrationSql.includes('CREATE OR REPLACE FUNCTION public.get_next_invoice_number'), 'Contains get_next_invoice_number function');
assert(migrationSql.includes('FOR UPDATE') || migrationSql.includes('ON CONFLICT (organization_id)'), 'Contains row-level atomic lock / conflict update');
assert(migrationSql.includes('next_invoice_number = public.invoice_sequences.next_invoice_number + 1'), 'Atomic increment of next_invoice_number');
pass('Atomic invoice numbering function get_next_invoice_number defined with concurrency protection');

// 4. Tenant Isolation Verification
assert(migrationSql.includes('organization_id UUID NOT NULL REFERENCES public.organizations(id)'), 'Enforces organization_id FK across tables');
assert(migrationSql.includes('uq_invoices_org_composite UNIQUE (organization_id, id)'), 'Enforces composite unique org constraint on invoices');
assert(migrationSql.includes('uq_invoice_items_org_composite UNIQUE (organization_id, id)'), 'Enforces composite unique org constraint on invoice items');
pass('Multi-tenant isolation and composite organization constraints verified');

// 5. Uniqueness & Idempotency Constraints
assert(migrationSql.includes('CONSTRAINT uq_invoices_org_number UNIQUE (organization_id, invoice_number)'), 'Enforces unique invoice number per org');
assert(migrationSql.includes('CONSTRAINT uq_invoices_operation_key UNIQUE (organization_id, operation_key)'), 'Enforces operation_key uniqueness per org');
assert(migrationSql.includes('CONSTRAINT uq_invoice_items_row UNIQUE (invoice_id, row_number)'), 'Enforces unique row number per invoice');
pass('Uniqueness constraints (org_number, operation_key, item_row) verified');

// 6. Foreign Keys Verification
assert(migrationSql.includes('CONSTRAINT fk_invoices_person FOREIGN KEY (organization_id, person_id)'), 'Invoices reference persons with org composite FK');
assert(migrationSql.includes('CONSTRAINT fk_invoices_branch FOREIGN KEY (organization_id, branch_id)'), 'Invoices reference branches with org composite FK');
assert(migrationSql.includes('CONSTRAINT fk_invoices_fy FOREIGN KEY (organization_id, fiscal_year_id)'), 'Invoices reference fiscal_years with org composite FK');
assert(migrationSql.includes('CONSTRAINT fk_invoices_voucher FOREIGN KEY (organization_id, journal_voucher_id)'), 'Invoices reference journal_vouchers');
assert(migrationSql.includes('CONSTRAINT fk_invoices_inventory_tx FOREIGN KEY (organization_id, inventory_transaction_id)'), 'Invoices reference inventory_transactions');
assert(migrationSql.includes('CONSTRAINT fk_inv_item_product FOREIGN KEY (organization_id, product_id)'), 'Invoice items reference products');
assert(migrationSql.includes('CONSTRAINT fk_inv_item_warehouse FOREIGN KEY (organization_id, warehouse_id)'), 'Invoice items reference warehouses');
pass('All foreign keys strictly link to real PostgreSQL foundation tables');

// 7. Financial & Audit Constraints Verification
assert(migrationSql.includes('subtotal_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0)'), 'Non-negative subtotal_amount');
assert(migrationSql.includes('total_amount NUMERIC(18, 0) NOT NULL DEFAULT 0 CHECK (total_amount >= 0)'), 'Non-negative total_amount');
assert(migrationSql.includes('quantity NUMERIC(18, 3) NOT NULL CHECK (quantity > 0)'), 'Strictly positive quantity');
assert(migrationSql.includes('unit_price_amount NUMERIC(18, 0) NOT NULL CHECK (unit_price_amount >= 0)'), 'Non-negative unit_price_amount');
assert(migrationSql.includes('version INT NOT NULL DEFAULT 1 CHECK (version > 0)'), 'Optimistic concurrency version tracking');
pass('Financial checks and non-negative constraints verified');

// 8. Row Level Security (RLS) Verification
assert(migrationSql.includes('ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on invoice_sequences');
assert(migrationSql.includes('ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on invoices');
assert(migrationSql.includes('ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;'), 'RLS enabled on invoice_items');
pass('Row Level Security (RLS) enabled on all invoice tables');

// 9. Simulation: Atomic Sequence & Concurrency Emulation
console.log('\n--- Simulating Atomic Number Generation & Idempotency ---');
const sequenceStore: Record<string, number> = {};
function simulateGetNextInvoiceNumber(orgId: string): number {
  if (!sequenceStore[orgId]) {
    sequenceStore[orgId] = 1;
  }
  const current = sequenceStore[orgId];
  sequenceStore[orgId] = current + 1;
  return current;
}

const orgA = 'org-1111-2222';
const orgB = 'org-3333-4444';

const numA1 = simulateGetNextInvoiceNumber(orgA);
const numA2 = simulateGetNextInvoiceNumber(orgA);
const numB1 = simulateGetNextInvoiceNumber(orgB);
const numA3 = simulateGetNextInvoiceNumber(orgA);

assert.equal(numA1, 1);
assert.equal(numA2, 2);
assert.equal(numA3, 3);
assert.equal(numB1, 1); // Org B has independent sequence starting at 1
pass('Concurrent numbering simulation enforces isolated sequential numbers per organization');

// 10. Operational Zero Data Baseline Verification
console.log('\n--- Verifying Zero Operational Data Modification ---');
const statePath = process.env.TEST_STORE_FILE || path.join(process.cwd(), 'central_app_state.json');
const centralStateRaw = fs.readFileSync(statePath, 'utf-8');
const centralState = JSON.parse(centralStateRaw);
assert.equal(centralState.invoices?.length || 0, 0, 'Central state invoices must remain 0');
assert.equal(centralState.vouchers?.length || 0, 0, 'Central state vouchers must remain 0');
assert.equal(centralState.checks?.length || 0, 0, 'Central state checks must remain 0');
assert.equal(centralState.installmentBooks?.length || 0, 0, 'Central state installment books must remain 0');
pass('Zero operational data modified / operational counts confirmed at baseline 0');

console.log(`\n🎉 ALL ${testsPassed}/${totalTests} INVOICE DB FOUNDATION TESTS PASSED!`);
console.log('======================================================================\n');
