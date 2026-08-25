import assert from 'node:assert/strict';
import { 
  InvoiceService, 
  mapDbRecordToInvoice, 
  mapDbItemToInvoiceItem, 
  InvoiceDbRecord, 
  InvoiceItemDbRecord 
} from '../services/invoiceService';

console.log('======================================================================');
console.log('🧪 RUNNING COMMAND 8 INVOICE READ & HYDRATION CUTOVER TESTS');
console.log('======================================================================');

let testsPassed = 0;
let totalTests = 0;

function pass(testName: string) {
  totalTests++;
  testsPassed++;
  console.log(`✅ TEST PASSED: ${testName}`);
}

async function runTests() {
  // -------------------------------------------------------------------
  // 1. Single Invoice Item DB to Client Mapping
  // -------------------------------------------------------------------
  const sampleDbItem: InvoiceItemDbRecord = {
    id: '11111111-1111-1111-1111-111111111111',
    organization_id: 'org-test-uuid',
    invoice_id: 'inv-test-uuid',
    row_number: 1,
    product_id: 'prod-uuid-1',
    warehouse_id: 'wh-uuid-1',
    quantity: '5.000',
    unit_price_amount: '2000000',
    discount_amount: '100000',
    total_price_amount: '9900000',
    unit_cost_amount: '1500000',
    total_cost_amount: '7500000',
    serial_numbers: JSON.stringify(['SN12345', 'SN67890'])
  };

  const clientItem = mapDbItemToInvoiceItem(sampleDbItem);
  assert.equal(clientItem.productId, 'prod-uuid-1');
  assert.equal(clientItem.quantity, 5);
  assert.equal(clientItem.unitPrice, 2000000);
  assert.equal(clientItem.discount, 100000);
  assert.equal(clientItem.warehouseId, 'wh-uuid-1');
  assert.equal(clientItem.costPrice, 1500000);
  assert.equal(clientItem.totalCostPrice, 7500000);
  assert.deepEqual(clientItem.serialNumbers, ['SN12345', 'SN67890']);
  pass('mapDbItemToInvoiceItem correctly maps snake_case DB fields, parses JSON serial numbers, and converts numbers');

  // -------------------------------------------------------------------
  // 2. Full Invoice DB Record to Client Invoice Mapping & Sorting
  // -------------------------------------------------------------------
  const sampleDbInvoice: InvoiceDbRecord = {
    id: 'inv-uuid-888',
    organization_id: 'org-uuid-999',
    branch_id: 'branch-uuid-1',
    fiscal_year_id: 'fy-uuid-1',
    invoice_number: 42,
    invoice_type: 'SELL',
    person_id: 'person-uuid-7',
    invoice_date: '2026-08-15',
    invoice_date_jalali: '1405/05/24',
    is_pro_invoice: false,
    is_converted: false,
    subtotal_amount: '10000000',
    discount_amount: '500000',
    tax_percent: '10.00',
    tax_amount: '950000',
    total_amount: '10450000',
    paid_amount: '5000000',
    cash_paid_amount: '2000000',
    pos_paid_amount: '3000000',
    pos_terminal_id: 'pos-uuid-1',
    is_installment_deferred: false,
    is_settled_with_checks: false,
    is_paid_from_wallet: false,
    delay_penalty_amount: '0',
    settlement_commission_amount: '0',
    cost_center_id: 'cc-uuid-1',
    purchase_manager_profit_rate: '2.5',
    description: 'تست فاکتور فروش',
    journal_voucher_id: 'voucher-uuid-123',
    inventory_transaction_id: 'invtx-uuid-456',
    status: 'POSTED',
    version: 1,
    created_by: 'user-uuid-1',
    created_at: '2026-08-15T12:00:00Z',
    invoice_items: [
      {
        id: 'item-2',
        organization_id: 'org-uuid-999',
        invoice_id: 'inv-uuid-888',
        row_number: 2,
        product_id: 'prod-2',
        warehouse_id: 'wh-1',
        quantity: 2,
        unit_price_amount: 3000000,
        discount_amount: 0,
        total_price_amount: 6000000
      },
      {
        id: 'item-1',
        organization_id: 'org-uuid-999',
        invoice_id: 'inv-uuid-888',
        row_number: 1,
        product_id: 'prod-1',
        warehouse_id: 'wh-1',
        quantity: 1,
        unit_price_amount: 4000000,
        discount_amount: 0,
        total_price_amount: 4000000
      }
    ]
  };

  const clientInvoice = mapDbRecordToInvoice(sampleDbInvoice);
  assert.equal(clientInvoice.id, 'inv-uuid-888');
  assert.equal(clientInvoice.invoiceNumber, 42);
  assert.equal(clientInvoice.type, 'sell');
  assert.equal(clientInvoice.date, '1405/05/24');
  assert.equal(clientInvoice.personId, 'person-uuid-7');
  assert.equal(clientInvoice.totalAmount, 10450000);
  assert.equal(clientInvoice.paidAmount, 5000000);
  assert.equal(clientInvoice.cashPaidAmount, 2000000);
  assert.equal(clientInvoice.posPaidAmount, 3000000);
  assert.equal(clientInvoice.posTerminalId, 'pos-uuid-1');
  assert.equal(clientInvoice.costCenterId, 'cc-uuid-1');
  assert.equal(clientInvoice.voucherId, 'voucher-uuid-123');
  assert.equal(clientInvoice.status, 'active');
  assert.equal(clientInvoice.items.length, 2);
  assert.equal(clientInvoice.items[0].productId, 'prod-1', 'Items must be sorted by row_number ascending');
  assert.equal(clientInvoice.items[1].productId, 'prod-2');
  pass('mapDbRecordToInvoice preserves all header fields and sorts items by row_number');

  // -------------------------------------------------------------------
  // 3. Status Transformation (POSTED -> active, VOIDED -> voided, DRAFT -> draft)
  // -------------------------------------------------------------------
  const voidedInvoice = mapDbRecordToInvoice({
    ...sampleDbInvoice,
    status: 'VOIDED',
    void_reason: 'لغو به درخواست مشتری',
    voided_at: '2026-08-15T14:00:00Z',
    voided_by: 'user-uuid-admin'
  });
  assert.equal(voidedInvoice.status, 'voided');
  assert.equal(voidedInvoice.voidReason, 'لغو به درخواست مشتری');
  assert.equal(voidedInvoice.voidedBy, 'user-uuid-admin');

  const draftInvoice = mapDbRecordToInvoice({
    ...sampleDbInvoice,
    status: 'DRAFT'
  });
  assert.equal(draftInvoice.status, 'draft');
  pass('Status correctly maps between PostgreSQL enum and client DocumentStatus');

  // -------------------------------------------------------------------
  // 4. Buy Invoice Type Mapping
  // -------------------------------------------------------------------
  const buyInvoice = mapDbRecordToInvoice({
    ...sampleDbInvoice,
    invoice_type: 'BUY'
  });
  assert.equal(buyInvoice.type, 'buy');
  pass('BUY invoice_type correctly maps to buy');

  // -------------------------------------------------------------------
  // 5. Mocked Fetch Invoice Service Integration
  // -------------------------------------------------------------------
  const originalFetch = globalThis.fetch;

  try {
    // Test getInvoices
    globalThis.fetch = async (url: any, opts: any) => {
      assert.ok(String(url).includes('/api/invoices'));
      assert.equal(opts?.method, 'GET');
      assert.equal(opts?.headers?.['Authorization'], 'Bearer test-jwt-token');

      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [sampleDbInvoice]
        })
      } as any;
    };

    const invoices = await InvoiceService.getInvoices('test-jwt-token');
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].invoiceNumber, 42);
    pass('InvoiceService.getInvoices sends JWT bearer and returns mapped Invoice array');

    // Test getInvoiceById
    globalThis.fetch = async (url: any, opts: any) => {
      assert.ok(String(url).includes('/api/invoices/inv-uuid-888'));
      assert.equal(opts?.method, 'GET');

      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: sampleDbInvoice
        })
      } as any;
    };

    const singleInvoice = await InvoiceService.getInvoiceById('inv-uuid-888', 'test-jwt-token');
    assert.equal(singleInvoice.id, 'inv-uuid-888');
    assert.equal(singleInvoice.invoiceNumber, 42);
    pass('InvoiceService.getInvoiceById fetches and maps single invoice record');

    // Test 404 Not Found error handling
    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({
          success: false,
          error: 'ERR_NOT_FOUND',
          message: 'فاکتور مورد نظر در این سازمان یافت نشد.'
        })
      } as any;
    };

    try {
      await InvoiceService.getInvoiceById('missing-uuid', 'test-jwt-token');
      assert.fail('Should throw 404 error');
    } catch (err: any) {
      assert.equal(err.status, 404);
      pass('InvoiceService properly throws and normalizes 404 errors');
    }

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n======================================================================');
  console.log(`🎉 ALL ${testsPassed}/${totalTests} COMMAND 8 INVOICE READ TESTS PASSED`);
  console.log('======================================================================');
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
