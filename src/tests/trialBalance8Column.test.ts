/**
 * @file trialBalance8Column.test.ts
 * Step 10 Automated Audit: 8-Column Trial Balance (تراز آزمایشی ۸ ستونی)
 * Tests double-entry balance and zero-sum invariants across all 8 columns.
 */

import { calculate8ColumnTrialBalance } from '../utils/accounting';
import { AccountSubsidiary, JournalVoucher } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✅ PASS: ${message}`);
}

console.log('======================================================================');
console.log('🧪 RUNNING STEP 10: 8-COLUMN TRIAL BALANCE AUDIT & INVARIANT TESTS');
console.log('======================================================================\n');

const mockSubsidiaries: AccountSubsidiary[] = [
  { id: 'sub_bank_1', code: '10101', name: 'بانک ملت', generalType: 'بانک‌ها', groupType: 'دارایی‌های جاری' },
  { id: 'sub_cash_1', code: '10201', name: 'صندوق مرکزی', generalType: 'صندوق‌ها', groupType: 'دارایی‌های جاری' },
  { id: 'sub_debtors_1', code: '10301', name: 'بدهکاران تجاری', generalType: 'بدهکاران تجاری', groupType: 'دارایی‌های جاری' },
  { id: 'sub_inv_1', code: '10501', name: 'موجودی کالای انبار', generalType: 'موجودی کالا', groupType: 'دارایی‌های جاری' },
  { id: 'sub_creditors_1', code: '20201', name: 'بستانکاران تجاری', generalType: 'بستانکاران تجاری', groupType: 'بدهی‌های جاری' },
  { id: 'sub_sales_1', code: '60101', name: 'درآمد حاصل از فروش کالا', generalType: 'فروش کالا', groupType: 'درآمدها' },
  { id: 'sub_cogs_1', code: '70101', name: 'بهای تمام شده کالای فروش رفته', generalType: 'بهای تمام شده کالای فروش رفته', groupType: 'هزینه‌ها' },
  { id: 'sub_opening_1', code: '99901', name: 'تراز افتتاحیه', generalType: 'تراز افتتاحیه', groupType: 'حقوق صاحبان سهام' },
];

const vouchers: JournalVoucher[] = [
  // 1. Opening Voucher (Date: 1404/12/29 - Prior to start date 1405/01/01)
  {
    id: 'v_open_1',
    voucherNumber: 1,
    date: '1404/12/29',
    gregorianDate: '2026-03-19',
    description: 'سند افتتاحیه دوره مالی جدید',
    isAutomatic: true,
    entries: [
      { subsidiaryId: 'sub_bank_1', debit: 50_000_000, credit: 0, description: 'موجودی بانک ملت' },
      { subsidiaryId: 'sub_inv_1', debit: 70_000_000, credit: 0, description: 'موجودی کالا' },
      { subsidiaryId: 'sub_creditors_1', debit: 0, credit: 40_000_000, description: 'بستانکاران' },
      { subsidiaryId: 'sub_opening_1', debit: 0, credit: 80_000_000, description: 'تراز افتتاحیه سرمایه' },
    ],
  },
  // 2. Period Voucher 1: Sale of goods (Date: 1405/02/10)
  {
    id: 'v_period_1',
    voucherNumber: 2,
    date: '1405/02/10',
    gregorianDate: '2026-04-30',
    description: 'فروش کالا نقدی و نسیه',
    isAutomatic: true,
    entries: [
      { subsidiaryId: 'sub_bank_1', debit: 20_000_000, credit: 0, description: 'دریافت نقدی بانک' },
      { subsidiaryId: 'sub_debtors_1', debit: 30_000_000, credit: 0, description: 'بدهکاران تجاری' },
      { subsidiaryId: 'sub_sales_1', debit: 0, credit: 50_000_000, description: 'فروش کالا' },
    ],
  },
  // 3. Period Voucher 2: COGS entry (Date: 1405/02/10)
  {
    id: 'v_period_2',
    voucherNumber: 3,
    date: '1405/02/10',
    gregorianDate: '2026-04-30',
    description: 'ثبت بهای تمام شده کالای فروش رفته',
    isAutomatic: true,
    entries: [
      { subsidiaryId: 'sub_cogs_1', debit: 25_000_000, credit: 0, description: 'بهای تمام شده' },
      { subsidiaryId: 'sub_inv_1', debit: 0, credit: 25_000_000, description: 'خروج کالا از انبار' },
    ],
  },
  // 4. Period Voucher 3: Payment to supplier (Date: 1405/03/15)
  {
    id: 'v_period_3',
    voucherNumber: 4,
    date: '1405/03/15',
    gregorianDate: '2026-06-05',
    description: 'تسویه بخشی از طلب تامین‌کننده',
    isAutomatic: true,
    entries: [
      { subsidiaryId: 'sub_creditors_1', debit: 15_000_000, credit: 0, description: 'بدهکار کردن بستانکار' },
      { subsidiaryId: 'sub_bank_1', debit: 0, credit: 15_000_000, description: 'واریز از حساب بانک' },
    ],
  },
];

console.log('--- SECTION 1: Calculating 8-Column Trial Balance ---');
const result = calculate8ColumnTrialBalance(
  vouchers,
  mockSubsidiaries,
  '1405/01/01',
  '1405/12/29',
  'subsidiary'
);

// 1. Double-entry balance check across all 8 columns
assert(result.isBalanced === true, 'Trial balance is overall balanced');

// 2. Col 1 & 2: Opening Debit === Opening Credit
assert(result.totals.openingDebit === result.totals.openingCredit, 'Opening Debit === Opening Credit');
assert(result.totals.openingDebit === 120_000_000, 'Opening Debit Total is 120,000,000 Rials');

// 3. Col 3 & 4: Period Debit === Period Credit
assert(result.totals.periodDebit === result.totals.periodCredit, 'Period Debit === Period Credit');
assert(result.totals.periodDebit === 90_000_000, 'Period Debit Total is 90,000,000 Rials');

// 4. Col 5 & 6: Total Debit === Total Credit
assert(result.totals.totalDebit === result.totals.totalCredit, 'Total Cumulative Debit === Total Cumulative Credit');
assert(result.totals.totalDebit === 210_000_000, 'Total Cumulative Debit is 210,000,000 Rials');

// 5. Col 7 & 8: Closing Debit === Closing Credit
assert(result.totals.closingDebit === result.totals.closingCredit, 'Closing Debit === Closing Credit');
assert(result.totals.closingDebit === 155_000_000, 'Closing Debit is 155,000,000 Rials');

// 6. Zero imbalances across all pairs
assert(result.imbalances.openingDiff === 0, 'Opening Diff is exactly 0');
assert(result.imbalances.periodDiff === 0, 'Period Diff is exactly 0');
assert(result.imbalances.totalDiff === 0, 'Total Diff is exactly 0');
assert(result.imbalances.closingDiff === 0, 'Closing Diff is exactly 0');

// 7. Verify individual account balances
const bankRow = result.rows.find(r => r.code === '10101');
assert(!!bankRow, 'Bank row found in trial balance');
assert(bankRow?.closingDebit === 55_000_000, 'Bank ending debit balance is 55,000,000 Rials');
assert(bankRow?.closingCredit === 0, 'Bank ending credit balance is 0');

const invRow = result.rows.find(r => r.code === '10501');
assert(!!invRow, 'Inventory row found');
assert(invRow?.closingDebit === 45_000_000, 'Inventory ending debit balance is 45,000,000 Rials');

const credRow = result.rows.find(r => r.code === '20201');
assert(!!credRow, 'Creditors row found');
assert(credRow?.closingCredit === 25_000_000, 'Creditors ending credit balance is 25,000,000 Rials');

console.log('\n======================================================================');
console.log('✅ ALL STEP 10 8-COLUMN TRIAL BALANCE AUDIT TESTS PASSED SUCCESSFULLY');
console.log('======================================================================');
