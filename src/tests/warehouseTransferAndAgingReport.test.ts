/**
 * @file warehouseTransferAndAgingReport.test.ts
 * Step 9 Automated Tests:
 * 1. Inventory Transfer Valuation (Weighted Average Cost & Cost Price Fallback)
 * 2. Balanced Double-Entry Voucher Generation (Debit = Credit = totalTransferValue)
 * 3. Jalali Date Parsing & Accurate Bucket Categorization in Debt Aging Report
 */

import { 
  createWarehouseTransferVoucher, 
  calculateAgingReport, 
  calculateProductStocks 
} from '../utils/accounting';
import { Product, WarehouseTransfer, Invoice, Person } from '../types';
import { getCurrentJalaliDate, addDaysToJalali } from '../utils/jalali';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✅ PASS: ${message}`);
}

console.log('======================================================================');
console.log('🧪 RUNNING STEP 9: WAREHOUSE TRANSFER VALUATION & JALALI AGING TESTS');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------------------
// SECTION 1: Warehouse Transfer Valuation Tests
// -----------------------------------------------------------------------------------------
console.log('--- SECTION 1: Warehouse Transfer Valuation & Balanced Double-Entry ---');

const mockProducts: Product[] = [
  {
    id: 'prod_1',
    code: 'P1001',
    name: 'گوشی سامسونگ A54',
    category: 'موبایل',
    unit: 'دستگاه',
    initialStock: 10,
    initialUnitCost: 150_000_000, // 150,000,000 Rials
    reorderPoint: 2,
    createdAt: '1404/01/01'
  },
  {
    id: 'prod_2',
    code: 'P1002',
    name: 'تبلت لنوو M10',
    category: 'تبلت',
    unit: 'دستگاه',
    initialStock: 5,
    initialUnitCost: 80_000_000,
    reorderPoint: 1,
    createdAt: '1404/01/01'
  }
];

const mockTransfer: WarehouseTransfer = {
  id: 'tr_101',
  fromWarehouseId: 'WH_CENTRAL',
  toWarehouseId: 'WH_BRANCH1',
  date: '1404/05/20',
  description: 'انتقال ۵ گوشی و ۲ تبلت به انبار شعبه ۱',
  items: [
    { productId: 'prod_1', quantity: 5 },
    { productId: 'prod_2', quantity: 2 }
  ]
};

// Scenario 1.1: Transfer using dynamic calculated average costs
const dynamicStocks: ReturnType<typeof calculateProductStocks> = {
  prod_1: {
    quantity: 20,
    totalCost: 3_200_000_000,
    averageCost: 160_000_000, // 160,000,000 Rials avg cost
    warehouseStocks: { WH_CENTRAL: 20 }
  },
  prod_2: {
    quantity: 10,
    totalCost: 850_000_000,
    averageCost: 85_000_000, // 85,000,000 Rials avg cost
    warehouseStocks: { WH_CENTRAL: 10 }
  }
};

const voucher1 = createWarehouseTransferVoucher(mockTransfer, mockProducts, 1001, dynamicStocks);

// Expected valuation: (5 * 160,000,000) + (2 * 85,000,000) = 800,000,000 + 170,000,000 = 970,000,000 Rials
const totalExpected1 = (5 * 160_000_000) + (2 * 85_000_000);
const sumDebit1 = voucher1.entries.reduce((sum, e) => sum + e.debit, 0);
const sumCredit1 = voucher1.entries.reduce((sum, e) => sum + e.credit, 0);

assert(sumDebit1 === totalExpected1, `Total debit equals expected valuation (${totalExpected1.toLocaleString()} Rials)`);
assert(sumCredit1 === totalExpected1, `Total credit equals expected valuation (${totalExpected1.toLocaleString()} Rials)`);
assert(sumDebit1 === sumCredit1, 'Double-entry invariant holds: Total Debit === Total Credit');
assert(sumDebit1 > 0, 'Transfer valuation is non-zero');
assert(voucher1.entries.length === 4, 'Contains 4 balanced entries (2 per transferred item)');
assert(voucher1.sourceType === 'transfer', 'Voucher sourceType is "transfer"');
assert(voucher1.sourceId === 'tr_101', 'Voucher sourceId points to transfer ID');

// Scenario 1.2: Transfer using product fallback unit costs (when currentStocks is not passed)
const voucher2 = createWarehouseTransferVoucher(mockTransfer, mockProducts, 1002);
// Expected valuation: (5 * 150,000,000) + (2 * 80,000,000) = 750,000,000 + 160,000,000 = 910,000,000 Rials
const totalExpected2 = (5 * 150_000_000) + (2 * 80_000_000);
const sumDebit2 = voucher2.entries.reduce((sum, e) => sum + e.debit, 0);
const sumCredit2 = voucher2.entries.reduce((sum, e) => sum + e.credit, 0);

assert(sumDebit2 === totalExpected2, `Fallback total debit equals expected valuation (${totalExpected2.toLocaleString()} Rials)`);
assert(sumCredit2 === totalExpected2, `Fallback total credit equals expected valuation (${totalExpected2.toLocaleString()} Rials)`);
assert(sumDebit2 === sumCredit2, 'Fallback double-entry invariant holds: Total Debit === Total Credit');
assert(sumDebit2 > 0, 'Fallback transfer valuation is non-zero');

// -----------------------------------------------------------------------------------------
// SECTION 2: Jalali Date Aging Report Tests
// -----------------------------------------------------------------------------------------
console.log('\n--- SECTION 2: Jalali Date Debt Aging Calculation & Bucketing ---');

const mockPersons: Person[] = [
  {
    id: 'cust_ali',
    name: 'علی احمدی',
    code: 'C1001',
    phone: '09121111111',
    role: 'debtor',
    createdAt: '1404/01/01'
  },
  {
    id: 'cust_reza',
    name: 'رضا حسینی',
    code: 'C1002',
    phone: '09122222222',
    role: 'debtor',
    createdAt: '1404/01/01'
  }
];

const todayJalali = getCurrentJalaliDate();

// Generate invoices with known Jalali offsets
const date_10_days_ago = addDaysToJalali(todayJalali, -10);
const date_45_days_ago = addDaysToJalali(todayJalali, -45);
const date_75_days_ago = addDaysToJalali(todayJalali, -75);
const date_120_days_ago = addDaysToJalali(todayJalali, -120);

const mockInvoices: Invoice[] = [
  // Ali: 10M (10 days ago -> 0-30 bucket), 20M (45 days ago -> 31-60 bucket)
  {
    id: 'inv_ali_1',
    invoiceNumber: 101,
    type: 'sell',
    personId: 'cust_ali',
    date: date_10_days_ago,
    totalAmount: 10_000_000,
    paidAmount: 0,
    discount: 0,
    taxPercent: 0,
    isProInvoice: false,
    isConverted: false,
    items: [],
    status: 'active',
    createdAt: '2026-08-19'
  },
  {
    id: 'inv_ali_2',
    invoiceNumber: 102,
    type: 'sell',
    personId: 'cust_ali',
    date: date_45_days_ago,
    totalAmount: 25_000_000,
    paidAmount: 5_000_000, // 20M remaining
    discount: 0,
    taxPercent: 0,
    isProInvoice: false,
    isConverted: false,
    items: [],
    status: 'active',
    createdAt: '2026-08-19'
  },
  // Reza: 30M (75 days ago -> 61-90 bucket), 50M (120 days ago -> 90+ bucket)
  {
    id: 'inv_reza_1',
    invoiceNumber: 201,
    type: 'sell',
    personId: 'cust_reza',
    date: date_75_days_ago,
    totalAmount: 30_000_000,
    paidAmount: 0,
    discount: 0,
    taxPercent: 0,
    isProInvoice: false,
    isConverted: false,
    items: [],
    status: 'active',
    createdAt: '2026-08-19'
  },
  {
    id: 'inv_reza_2',
    invoiceNumber: 202,
    type: 'sell',
    personId: 'cust_reza',
    date: date_120_days_ago,
    totalAmount: 60_000_000,
    paidAmount: 10_000_000, // 50M remaining
    discount: 0,
    taxPercent: 0,
    isProInvoice: false,
    isConverted: false,
    items: [],
    status: 'active',
    createdAt: '2026-08-19'
  },
  // Pro-forma or buy invoice (should be ignored)
  {
    id: 'inv_pro',
    invoiceNumber: 999,
    type: 'buy',
    personId: 'cust_ali',
    date: date_10_days_ago,
    totalAmount: 100_000_000,
    paidAmount: 0,
    discount: 0,
    taxPercent: 0,
    isProInvoice: false,
    isConverted: false,
    items: [],
    status: 'active',
    createdAt: '2026-08-19'
  }
];

const agingReport = calculateAgingReport(mockInvoices, mockPersons);

assert(agingReport.length === 2, 'Report contains entries for both customers with unpaid debt');

const aliReport = agingReport.find(r => r.personName === 'علی احمدی');
assert(!!aliReport, 'Ali Ahmadi report exists');
assert(aliReport!.totalDebt === 30_000_000, 'Ali total debt is 30,000,000 Rials (10M + 20M)');
assert(aliReport!.zeroToThirty === 10_000_000, 'Ali 0-30 days bucket has 10,000,000 Rials');
assert(aliReport!.thirtyToSixty === 20_000_000, 'Ali 31-60 days bucket has 20,000,000 Rials');
assert(aliReport!.sixtyToNinety === 0, 'Ali 61-90 days bucket has 0 Rials');
assert(aliReport!.overNinety === 0, 'Ali 90+ days bucket has 0 Rials');

const rezaReport = agingReport.find(r => r.personName === 'رضا حسینی');
assert(!!rezaReport, 'Reza Hosseini report exists');
assert(rezaReport!.totalDebt === 80_000_000, 'Reza total debt is 80,000,000 Rials (30M + 50M)');
assert(rezaReport!.zeroToThirty === 0, 'Reza 0-30 days bucket has 0 Rials');
assert(rezaReport!.thirtyToSixty === 0, 'Reza 31-60 days bucket has 0 Rials');
assert(rezaReport!.sixtyToNinety === 30_000_000, 'Reza 61-90 days bucket has 30,000,000 Rials');
assert(rezaReport!.overNinety === 50_000_000, 'Reza 90+ days bucket has 50,000,000 Rials');

console.log('\n======================================================================');
console.log('🎉 ALL STEP 9 TESTS (WAREHOUSE TRANSFER & JALALI AGING) PASSED!');
console.log('======================================================================');
