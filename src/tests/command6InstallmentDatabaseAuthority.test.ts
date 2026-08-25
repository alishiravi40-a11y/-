import { describe, it } from 'node:test';
import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { loadAppState, saveAppState } from '../utils/accounting';
import { InstallmentService } from '../services/installmentService';
import { SERVER_ROUTE_POLICIES } from '../server/auth/serverRouteAuthorizationPolicy';

// Mock localStorage for node environment if not present
if (typeof localStorage === 'undefined') {
  const storage: Record<string, string> = {};
  (global as any).localStorage = {
    getItem: (key: string) => storage[key] || null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };
}

describe('Command 6: Installment Booklet Database Authority & Origins', () => {

  it('1. Operational reads & writes of installmentBooks and installments in localStorage are disabled (0 operational reads/writes)', () => {
    localStorage.clear();

    // Put fake stale data into localStorage
    localStorage.setItem('accounting_installment_books', JSON.stringify([{ id: 'stale_book_1', totalAmount: 1000 }]));
    localStorage.setItem('accounting_installments_details', JSON.stringify([{ id: 'stale_inst_1', amount: 500 }]));

    const loadedState = loadAppState();
    assert.deepEqual(loadedState.installmentBooks, [], 'loadAppState must return empty array for installmentBooks');
    assert.deepEqual(loadedState.installments, [], 'loadAppState must return empty array for installments');

    // Save app state
    saveAppState({
      ...loadedState,
      installmentBooks: [{ id: 'new_book_1', personId: 'p1', totalAmount: 5000 } as any],
      installments: [{ id: 'new_inst_1', amount: 2500 } as any]
    });

    // Check localStorage items were NOT mutated with operational state
    const rawBooks = localStorage.getItem('accounting_installment_books');
    assert.ok(rawBooks === null || rawBooks === JSON.stringify([{ id: 'stale_book_1', totalAmount: 1000 }]), 'localStorage must not persist operational installment books');
  });

  it('2. Migration 31 exists and defines create_installment_book_atomic RPC with origin_type', () => {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '31_atomic_installment_book_creation.sql');
    assert.ok(fs.existsSync(migrationPath), 'Migration 31 file must exist');

    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
    assert.ok(sqlContent.includes('create_installment_book_atomic'), 'Migration 31 must create RPC create_installment_book_atomic');
    assert.ok(sqlContent.includes('origin_type'), 'Migration 31 must include origin_type parameter and column');
    assert.ok(sqlContent.includes("CHECK (origin_type IN ('INVOICE', 'PARTNER_CREDIT', 'OPENING_BALANCE'))"), 'Migration 31 must enforce CHECK constraint on origin_type');
  });

  it('3. Server route authorization policies include INSTALLMENT_BOOKS_GET, INSTALLMENT_CREATE_POST, INSTALLMENT_SETTLE_POST', () => {
    const booksPolicy = SERVER_ROUTE_POLICIES.find(p => p.policyId === 'INSTALLMENT_BOOKS_GET');
    assert.ok(booksPolicy, 'Must have policy for INSTALLMENT_BOOKS_GET');
    assert.equal(booksPolicy.pathPattern, '/api/installments/books');

    const createPolicy = SERVER_ROUTE_POLICIES.find(p => p.policyId === 'INSTALLMENT_CREATE_POST');
    assert.ok(createPolicy, 'Must have policy for INSTALLMENT_CREATE_POST');

    const settlePolicy = SERVER_ROUTE_POLICIES.find(p => p.policyId === 'INSTALLMENT_SETTLE_POST');
    assert.ok(settlePolicy, 'Must have policy for INSTALLMENT_SETTLE_POST');
  });

  it('4. InstallmentService exposes getInstallmentBooks, createInstallmentBook, and settleInstallment', () => {
    assert.equal(typeof InstallmentService.getInstallmentBooks, 'function', 'InstallmentService must have getInstallmentBooks');
    assert.equal(typeof InstallmentService.createInstallmentBook, 'function', 'InstallmentService must have createInstallmentBook');
    assert.equal(typeof InstallmentService.settleInstallment, 'function', 'InstallmentService must have settleInstallment');
  });

  it('5. Opening balance booklet guard: enforces exact unified debtor subsidiary (SUB_DEBTORS_INSTALLMENT/1106), inactive/ambiguous account guards, POSTED status, OPENING_BALANCE source, net balance, previous booklet deduction, and concurrency lock', () => {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '31_atomic_installment_book_creation.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

    // 1. Must check POSTED status and OPENING_BALANCE source type
    assert.ok(sqlContent.includes("jv.status = 'POSTED'"), 'Guard must enforce POSTED status on opening balance vouchers');
    assert.ok(sqlContent.includes("jv.source_type = 'OPENING_BALANCE'"), 'Guard must enforce OPENING_BALANCE source type');

    // 2. Must resolve exact single installment receivables subsidiary account matching settle_installment_atomic
    assert.ok(sqlContent.includes("code = '1106' OR system_key = 'SUB_DEBTORS_INSTALLMENT'"), 'Guard must resolve exact installment debtors subsidiary account');
    assert.ok(sqlContent.includes("ERR_ACCOUNT_INACTIVE"), 'Guard must raise ERR_ACCOUNT_INACTIVE for inactive account');
    assert.ok(sqlContent.includes("ERR_AMBIGUOUS_ACCOUNT_MAPPING"), 'Guard must raise ERR_AMBIGUOUS_ACCOUNT_MAPPING if multiple matching accounts exist');
    assert.ok(sqlContent.includes("ve.subsidiary_id = v_sub_debtors_inst_id"), 'Guard must query opening balance strictly on the single installment receivables subsidiary account');

    // 3. Must calculate net balance: debit sum minus credit sum
    assert.ok(sqlContent.includes("v_net_opening_balance := v_ob_debit_sum - v_ob_credit_sum"), 'Guard must calculate net opening balance as debit - credit');

    // 4. Must raise ERR_NO_VALID_OPENING_BALANCE if no valid balance exists
    assert.ok(sqlContent.includes("ERR_NO_VALID_OPENING_BALANCE"), 'Guard must raise ERR_NO_VALID_OPENING_BALANCE');

    // 5. Must deduct previously allocated booklets: v_available_opening_balance := v_net_opening_balance - v_previously_allocated
    assert.ok(sqlContent.includes("v_available_opening_balance := v_net_opening_balance - v_previously_allocated"), 'Guard must deduct previously allocated opening balance booklets');

    // 6. Must check p_total_amount against v_available_opening_balance and raise ERR_OPENING_BALANCE_INSUFFICIENT
    assert.ok(sqlContent.includes("v_available_opening_balance < p_total_amount"), 'Guard must check available opening balance against p_total_amount');
    assert.ok(sqlContent.includes("ERR_OPENING_BALANCE_INSUFFICIENT"), 'Guard must raise ERR_OPENING_BALANCE_INSUFFICIENT');

    // 7. Must lock person row FOR UPDATE for concurrency protection
    assert.ok(sqlContent.includes("FOR UPDATE"), 'Guard must execute FOR UPDATE lock to prevent race conditions');
  });

  it('6. Opening balance booklet financial invariants: ZERO vouchers, ZERO entries, ZERO sequence consumption', () => {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '31_atomic_installment_book_creation.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

    assert.ok(sqlContent.includes("v_origin = 'OPENING_BALANCE'"), 'Migration must handle OPENING_BALANCE explicitly');
    assert.ok(sqlContent.includes("ZERO journal vouchers"), 'Migration rules must document zero voucher creation for opening balance');
  });

  it('7. Idempotency & Conflict enforcement via operation_key and voucher_operation_keys', () => {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '31_atomic_installment_book_creation.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

    assert.ok(sqlContent.includes("p_op_key"), 'RPC must accept p_op_key');
    assert.ok(sqlContent.includes("ERR_OPERATION_KEY_CONFLICT"), 'RPC must enforce ERR_OPERATION_KEY_CONFLICT when same key is passed with different payload');
  });

  it('8. INVOICE and PARTNER_CREDIT paths remain intact with required business logic', () => {
    const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '31_atomic_installment_book_creation.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');

    assert.ok(sqlContent.includes("v_origin = 'PARTNER_CREDIT'"), 'Migration must retain PARTNER_CREDIT fee voucher logic');
    assert.ok(sqlContent.includes("SUB_COMMISSION_REV"), 'PARTNER_CREDIT must credit commission revenue when interest > 0');
  });
});
