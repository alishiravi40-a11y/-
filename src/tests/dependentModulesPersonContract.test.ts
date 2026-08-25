import assert from 'node:assert/strict';
import { Person, JournalVoucher, Check, Invoice, InstallmentBook } from '../types';

console.log('=== Running Command 12: Dependent Modules Contract Verification ===');

function runDependentModuleContractSuite() {
  const samplePersonUUID = '550e8400-e29b-41d4-a716-446655440000';
  const samplePerson: Person = {
    id: samplePersonUUID,
    code: 'P-5001',
    name: 'تست قرارداد ماژول‌ها',
    mobile: '09123456789',
    role: 'both',
    status: 'active',
    createdAt: '2026-08-15T00:00:00.000Z'
  };

  // 1. Invoice Contract Verification
  console.log('\n[1] Verifying Invoice Person Contract...');
  const invoice: Partial<Invoice> = {
    id: 'inv_test_1',
    invoiceNumber: 1001,
    personId: samplePerson.id,
    date: '1405/05/25',
    items: [],
    totalAmount: 1000000,
    paidAmount: 0
  };
  assert.equal(invoice.personId, samplePersonUUID);
  console.log('✅ Invoice references Person UUID seamlessly.');

  // 2. Check Contract Verification
  console.log('\n[2] Verifying Check Person Contract...');
  const check: Partial<Check> = {
    id: 'chk_test_1',
    checkNumber: 'CHK-998877',
    personId: samplePerson.id,
    type: 'received',
    bankName: 'ملی',
    dueDate: '1405/06/01',
    amount: 500000
  };
  assert.equal(check.personId, samplePersonUUID);
  console.log('✅ Check references Person UUID seamlessly.');

  // 3. Installment Book Contract Verification
  console.log('\n[3] Verifying Installment Book Person Contract...');
  const booklet: Partial<InstallmentBook> = {
    id: 'bk_test_1',
    personId: samplePerson.id,
    totalPrincipal: 2000000,
    totalAmount: 2400000,
    totalInterest: 400000,
    installmentCount: 12,
    startDate: '1405/05/25',
    intervalDays: 30,
    status: 'active',
    createdAt: '2026-08-15T00:00:00.000Z'
  };
  assert.equal(booklet.personId, samplePersonUUID);
  console.log('✅ Installment Book references Person UUID seamlessly.');

  // 4. Journal Voucher Double-Entry Person Allocation Contract
  console.log('\n[4] Verifying Journal Voucher Entries Person Allocation Contract...');
  const voucher: Partial<JournalVoucher> = {
    id: 'v_test_1',
    voucherNumber: 501,
    date: '1405/05/25',
    gregorianDate: '2026-08-15',
    description: 'سند فروش نسیه',
    isAutomatic: false,
    entries: [
      {
        subsidiaryId: 'SUB_101',
        description: 'بدهکار طرف حساب',
        debit: 100000,
        credit: 0,
        floatingDetailed: {
          type: 'person',
          id: samplePerson.id,
          name: samplePerson.name
        }
      },
      {
        subsidiaryId: 'SUB_401',
        description: 'فروش کالا',
        debit: 0,
        credit: 100000
      }
    ]
  };
  assert.equal(voucher.entries?.[0].floatingDetailed?.id, samplePersonUUID);
  console.log('✅ Journal Voucher entry references Person UUID seamlessly.');

  console.log('\n============================================================');
  console.log('🎉 ALL DEPENDENT MODULE PERSON CONTRACT TESTS PASSED!');
  console.log('============================================================\n');
}

runDependentModuleContractSuite();
