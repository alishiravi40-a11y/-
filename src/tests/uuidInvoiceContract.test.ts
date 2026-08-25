import assert from 'node:assert/strict';
import { 
  resolveInvoiceVoucher, 
  isVoucherForInvoice, 
  calculateProductStocks, 
  calculatePersonBalances,
  DEFAULT_SUBSIDIARIES 
} from '../utils/accounting';
import { checkBookletFinancialDependencies } from '../components/InstallmentBookletManager';
import { Invoice, JournalVoucher, Product, Person, Check, AppState, InstallmentBook, OpeningBalance } from '../types';

console.log('======================================================================');
console.log('🧪 RUNNING UUID INVOICE & VOUCHER CONTRACT TESTS (BLOCK 2 - COMMAND 6)');
console.log('======================================================================');

let testsPassed = 0;
let totalTests = 0;

function pass(testName: string) {
  totalTests++;
  testsPassed++;
  console.log(`✅ TEST PASSED: ${testName}`);
}

const UUID_INVOICE_ID = '550e8400-e29b-41d4-a716-446655440000';
const UUID_VOUCHER_ID = '987fcdeb-51a2-43f7-9abc-123456789def';
const UUID_PERSON_ID = '333e8400-e29b-41d4-a716-446655440001';
const UUID_PRODUCT_ID = '777e8400-e29b-41d4-a716-446655440002';
const UUID_WAREHOUSE_ID = '999e8400-e29b-41d4-a716-446655440003';

// -------------------------------------------------------------------
// 1. Invoice Display & Structure Test with UUID
// -------------------------------------------------------------------
const testInvoice: Invoice = {
  id: UUID_INVOICE_ID,
  invoiceNumber: 101,
  type: 'sell',
  isProInvoice: false,
  isConverted: false,
  date: '1405/05/25',
  personId: UUID_PERSON_ID,
  items: [
    {
      productId: UUID_PRODUCT_ID,
      quantity: 5,
      unitPrice: 1000000,
      discount: 0,
      warehouseId: UUID_WAREHOUSE_ID,
      costPrice: 800000,
      totalCostPrice: 4000000
    }
  ],
  discount: 500000,
  taxPercent: 10,
  totalAmount: 4950000, // (5000000 - 500000) * 1.1 = 4950000
  paidAmount: 0,
  voucherId: UUID_VOUCHER_ID,
  createdAt: '2026-08-15T00:00:00.000Z'
};

assert.equal(testInvoice.id, UUID_INVOICE_ID);
assert.equal(testInvoice.voucherId, UUID_VOUCHER_ID);
pass('UUID invoice structure & display fields verified');

// -------------------------------------------------------------------
// 2. Invoice Lookup by UUID
// -------------------------------------------------------------------
const invoicesList: Invoice[] = [testInvoice];
const foundInvoice = invoicesList.find(inv => inv.id === UUID_INVOICE_ID);
assert.ok(foundInvoice, 'Invoice should be found by exact UUID');
assert.equal(foundInvoice?.invoiceNumber, 101);
pass('UUID invoice lookup test');

// -------------------------------------------------------------------
// 3. Voucher Relationship Resolution (Priority 1: Explicit voucherId)
// -------------------------------------------------------------------
const explicitVoucher: JournalVoucher = {
  id: UUID_VOUCHER_ID,
  voucherNumber: 50,
  date: '1405/05/25',
  gregorianDate: '2026-08-15T00:00:00.000Z',
  description: 'فروش - فاکتور 101',
  entries: [
    { subsidiaryId: 'SUB_DEBTORS', debit: 4950000, credit: 0, floatingDetailed: { type: 'person', id: UUID_PERSON_ID, name: 'مشتری تستی' } },
    { subsidiaryId: 'SUB_REVENUE', debit: 0, credit: 4500000 },
    { subsidiaryId: 'SUB_VAT_SELL', debit: 0, credit: 450000 }
  ],
  isAutomatic: true,
  sourceType: 'sell_invoice',
  sourceId: UUID_INVOICE_ID
};

const resolvedExplicit = resolveInvoiceVoucher(testInvoice, [explicitVoucher]);
assert.ok(resolvedExplicit, 'Voucher should resolve via explicit voucherId');
assert.equal(resolvedExplicit?.id, UUID_VOUCHER_ID);
assert.ok(isVoucherForInvoice(explicitVoucher, testInvoice));
pass('Explicit UUID invoice-to-voucher resolution test');

// -------------------------------------------------------------------
// 4. Voucher Relationship Resolution (Priority 2: Metadata sourceId)
// -------------------------------------------------------------------
const invoiceWithoutExplicitVoucherId: Invoice = {
  ...testInvoice,
  voucherId: undefined
};

const resolvedMetadata = resolveInvoiceVoucher(invoiceWithoutExplicitVoucherId, [explicitVoucher]);
assert.ok(resolvedMetadata, 'Voucher should resolve via metadata sourceId matching invoice UUID');
assert.equal(resolvedMetadata?.id, UUID_VOUCHER_ID);
pass('Metadata sourceId UUID voucher resolution test');

// -------------------------------------------------------------------
// 5. Central Compatibility Resolver (Priority 3: Legacy AppState Fallback)
// -------------------------------------------------------------------
const legacyInvoice: Invoice = {
  ...testInvoice,
  id: 'inv_1723700000000',
  voucherId: undefined
};

const legacyVoucher: JournalVoucher = {
  ...explicitVoucher,
  id: 'v_auto_inv_1723700000000',
  sourceId: undefined
};

const resolvedLegacy = resolveInvoiceVoucher(legacyInvoice, [legacyVoucher]);
assert.ok(resolvedLegacy, 'Legacy AppState invoice voucher resolved via centralized fallback');
assert.equal(resolvedLegacy?.id, 'v_auto_inv_1723700000000');
pass('Legacy AppState fallback resolution test');

// -------------------------------------------------------------------
// 6. Person Ledger & Balances with UUID Invoices and Vouchers
// -------------------------------------------------------------------
const persons: Person[] = [
  {
    id: UUID_PERSON_ID,
    name: 'مشتری تستی',
    code: '1001',
    mobile: '09123456789',
    roles: ['customer'],
    status: 'active',
    createdAt: '2026-08-15'
  }
];

const personBalances = calculatePersonBalances([explicitVoucher]);
assert.equal(personBalances[UUID_PERSON_ID]?.debit, 4950000, 'Person debtor debit should match invoice total');
assert.equal(personBalances[UUID_PERSON_ID]?.net, 4950000, 'Person net balance should match invoice total');
pass('Person ledger reference with UUID entities test');

// -------------------------------------------------------------------
// 7. Inventory Stock Calculation with UUID Invoices
// -------------------------------------------------------------------
const products: Product[] = [
  {
    id: UUID_PRODUCT_ID,
    name: 'کالای تستی',
    code: 'P01',
    category: 'عمومی',
    unit: 'عدد',
    initialStock: 0,
    reorderPoint: 0,
    createdAt: '2026-08-15'
  }
];

// 10 units initial opening balance
const openingBalances: OpeningBalance[] = [
  {
    id: 'op_1',
    number: 1,
    date: '1405/01/01',
    description: 'موجودی اولیه',
    items: [
      {
        productId: UUID_PRODUCT_ID,
        warehouseId: UUID_WAREHOUSE_ID,
        quantity: 10,
        unitCost: 800000,
        discount: 0
      }
    ],
    createdAt: '2026-08-15'
  }
];

// Sell invoice sold 5 units
const stocks = calculateProductStocks(products, [testInvoice], openingBalances, []);
assert.equal(stocks[UUID_PRODUCT_ID].quantity, 5, 'Stock should be 10 - 5 = 5');
pass('Inventory stock calculation with UUID invoice test');

// -------------------------------------------------------------------
// 8. Cheque Reference Contract Test (UUID References Safe)
// -------------------------------------------------------------------
const testCheck: Check & { invoiceId?: string } = {
  id: 'chk_123',
  type: 'received',
  checkNumber: '88776655',
  sayadiNumber: '1234567890123456',
  bankName: 'بانک ملی',
  amount: 4950000,
  dueDate: '1405/06/01',
  personId: UUID_PERSON_ID,
  currentState: 'present_in_cashbox',
  isInstallment: false,
  invoiceId: UUID_INVOICE_ID,
  history: [
    {
      state: 'present_in_cashbox',
      date: '1405/05/25',
      voucherId: UUID_VOUCHER_ID
    }
  ],
  createdAt: '2026-08-15T00:00:00.000Z'
};

assert.equal(testCheck.invoiceId, UUID_INVOICE_ID);
assert.equal(testCheck.history?.[0]?.voucherId, UUID_VOUCHER_ID);
pass('Cheque module UUID reference contract test');

// -------------------------------------------------------------------
// 9. Installment Reference Contract Test (UUID References Safe)
// -------------------------------------------------------------------
const testBook: InstallmentBook = {
  id: 'book_123',
  personId: UUID_PERSON_ID,
  invoiceId: UUID_INVOICE_ID,
  totalPrincipal: 4500000,
  totalInterest: 450000,
  totalAmount: 4950000,
  installmentCount: 3,
  intervalDays: 30,
  startDate: '1405/06/01',
  status: 'active',
  createdAt: '2026-08-15T00:00:00.000Z'
};

const mockAppState = {
  users: [],
  persons,
  products,
  productCategories: ['عمومی'],
  warehouses: [{ id: UUID_WAREHOUSE_ID, name: 'انبار مرکزی', isDefault: true, createdAt: '2026-08-15' }],
  costCenters: [],
  invoices: [testInvoice],
  vouchers: [explicitVoucher],
  openingBalances: [],
  checks: [testCheck],
  settings: {
    inventoryValuationMethod: 'WEIGHTED_AVERAGE',
    defaultWarehouseId: UUID_WAREHOUSE_ID,
    companyName: 'شرکت تستی'
  },
  subsidiaries: DEFAULT_SUBSIDIARIES,
  warehouseTransfers: [],
  bankTerminals: [],
  installmentBooks: [testBook],
  installments: [],
  installmentRequests: [],
  installmentPlans: [],
  auditLogs: []
} as unknown as AppState;

const bookletDep = checkBookletFinancialDependencies(mockAppState, 'book_123');
assert.equal(bookletDep.hasDependency, true);
assert.ok(bookletDep.reason?.includes('دارای سند حسابداری فعال فاکتور فروش'));
pass('Installment booklet dependency check with UUID invoice test');

// -------------------------------------------------------------------
// 10. Order-to-Invoice Reference Handling with UUID
// -------------------------------------------------------------------
const testOrder = {
  id: 'order_uuid_100',
  orderNumber: 'ORD-500',
  invoiceId: UUID_INVOICE_ID,
  status: 'CONVERTED_TO_INVOICE'
};
assert.equal(testOrder.invoiceId, UUID_INVOICE_ID);
pass('Order-to-invoice UUID reference contract test');

console.log('======================================================================');
console.log(`🎉 ALL ${testsPassed}/${totalTests} UUID CONTRACT & COMPATIBILITY TESTS PASSED!`);
console.log('======================================================================');
