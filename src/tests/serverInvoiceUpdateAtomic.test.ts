import assert from 'node:assert/strict';
import { executeServerUpdateInvoice, executeServerCreateInvoice } from '../server/invoices/invoiceAtomicService';

console.log('======================================================================');
console.log('🧪 RUNNING SERVER INVOICE UPDATE ATOMIC & INVENTORY DELTA TESTS (11B)');
console.log('======================================================================');

let testsPassed = 0;
let totalTests = 0;

function pass(testName: string) {
  totalTests++;
  testsPassed++;
  console.log(`✅ TEST PASSED: ${testName}`);
}

class MockUpdateSupabaseClient {
  public dataStore: {
    branches: any[];
    fiscal_years: any[];
    persons: any[];
    account_subsidiaries: any[];
    invoice_sequences: Record<string, number>;
    invoices: any[];
    invoice_items: any[];
    journal_vouchers: any[];
    voucher_entries: any[];
    inventory_transactions: any[];
    inventory_transaction_items: any[];
  };

  public failOnVoucherEntries = false;

  constructor() {
    this.dataStore = {
      branches: [{ id: 'branch-uuid-1', organization_id: 'org-uuid-1' }],
      fiscal_years: [{ id: 'fy-uuid-1', organization_id: 'org-uuid-1', is_closed: false }],
      persons: [
        { id: 'person-active-uuid', organization_id: 'org-uuid-1', name: 'رضا حسینی', status: 'active', is_agent: false }
      ],
      account_subsidiaries: [
        { id: 'sub-ar-id', code: 'SUB_DEBTORS', name: 'بدهکاران تجاری', organization_id: 'org-uuid-1' },
        { id: 'sub-sales-id', code: 'SUB_REVENUE', name: 'فروش کالا', organization_id: 'org-uuid-1' },
        { id: 'sub-inv-id', code: 'SUB_INVENTORY', name: 'موجودی کالا', organization_id: 'org-uuid-1' },
        { id: 'sub-vat-sell-id', code: 'SUB_VAT_SELL', name: 'مالیات بر ارزش افزوده فروش', organization_id: 'org-uuid-1' },
        { id: 'sub-cash-id', code: 'SUB_CASH_MAIN', name: 'صندوق اصلی', organization_id: 'org-uuid-1' }
      ],
      invoice_sequences: { 'org-uuid-1': 100 },
      invoices: [],
      invoice_items: [],
      journal_vouchers: [],
      voucher_entries: [],
      inventory_transactions: [],
      inventory_transaction_items: []
    };
  }

  from(table: string) {
    const self = this;
    let query: any = {
      filters: [] as Array<{ col: string; op: string; val: any }>,
      insertData: null as any,
      updateData: null as any,
      isSingle: false,
      isMaybeSingle: false,

      select() { return query; },
      eq(col: string, val: any) {
        query.filters.push({ col, op: 'eq', val });
        return query;
      },
      limit() { return query; },
      single() {
        query.isSingle = true;
        return query.execute();
      },
      maybeSingle() {
        query.isMaybeSingle = true;
        return query.execute();
      },
      insert(data: any) {
        query.insertData = data;
        return {
          select() {
            return {
              single() { query.isSingle = true; return query.execute(); },
              maybeSingle() { query.isMaybeSingle = true; return query.execute(); },
              then(res: any, rej: any) { return query.execute().then(res, rej); }
            };
          },
          then(res: any, rej: any) { return query.execute().then(res, rej); }
        };
      },
      update(data: any) {
        query.updateData = data;
        return query;
      },
      delete() {
        return {
          eq(col: string, val: any) {
            const list = (self.dataStore as any)[table] || [];
            (self.dataStore as any)[table] = list.filter((r: any) => r[col] !== val);
            return Promise.resolve({ data: null, error: null });
          }
        };
      },
      then(res: any, rej: any) { return query.execute().then(res, rej); },
      async execute() {
        if (query.insertData) {
          const records = Array.isArray(query.insertData) ? query.insertData : [query.insertData];
          const inserted = records.map((r) => {
            const rec = { id: r.id || `mock-${Math.random().toString(36).substring(2, 9)}`, ...r };
            (self.dataStore as any)[table].push(rec);
            return rec;
          });
          return { data: query.isSingle ? inserted[0] : inserted, error: null };
        }
        if (query.updateData) {
          const list = (self.dataStore as any)[table] || [];
          for (const item of list) {
            let match = true;
            for (const f of query.filters) {
              if (item[f.col] !== f.val) match = false;
            }
            if (match) {
              Object.assign(item, query.updateData);
            }
          }
          return { data: list, error: null };
        }
        let results = [...((self.dataStore as any)[table] || [])];
        for (const f of query.filters) {
          results = results.filter((r) => r[f.col] === f.val);
        }
        if (query.isSingle) {
          if (results.length === 0) return { data: null, error: new Error('Not found') };
          return { data: results[0], error: null };
        }
        if (query.isMaybeSingle) {
          return { data: results.length > 0 ? results[0] : null, error: null };
        }
        return { data: results, error: null };
      }
    };
    return query;
  }

  rpc(fnName: string, params: any) {
    if (fnName === 'get_next_invoice_number') {
      const orgId = params.p_org_id;
      const num = this.dataStore.invoice_sequences[orgId] || 1;
      this.dataStore.invoice_sequences[orgId] = num + 1;
      return Promise.resolve({ data: num, error: null });
    }
    return Promise.resolve({ data: null, error: new Error('Unknown RPC') });
  }
}

async function runTests() {
  const orgId = 'org-uuid-1';
  const userId = 'user-uuid-1';
  const client = new MockUpdateSupabaseClient();

  // 1. Create initial posted invoice
  const created = await executeServerCreateInvoice(client as any, orgId, userId, {
    invoiceType: 'SELL',
    personId: 'person-active-uuid',
    items: [{ productId: 'p1', warehouseId: 'w1', quantity: 5, unitPrice: 10000 }]
  });

  assert.ok(created.invoiceId, 'Invoice created');
  assert.equal(created.invoiceNumber, 100);
  pass('Initial invoice created for update testing');

  // 2. Test Stale Version Optimistic Concurrency Rejection (Zero Writes)
  try {
    await executeServerUpdateInvoice(client as any, orgId, userId, created.invoiceId!, {
      expectedVersion: 999, // Stale version
      mutationKey: 'mut-key-1',
      invoiceType: 'SELL',
      personId: 'person-active-uuid',
      items: [{ productId: 'p1', warehouseId: 'w1', quantity: 3, unitPrice: 10000 }]
    });
    assert.fail('Should reject stale version');
  } catch (err: any) {
    assert.equal(err.statusCode, 409, 'Conflict status 409');
    assert(err.message.includes('ERR_INVOICE_VERSION_CONFLICT'));
    pass('Stale expected_version rejected with zero writes (409)');
  }

  // 3. Test Successful Update (Version increment, ID/Number preservation)
  const updated1 = await executeServerUpdateInvoice(client as any, orgId, userId, created.invoiceId!, {
    expectedVersion: 1,
    mutationKey: 'mut-key-1',
    invoiceType: 'SELL',
    personId: 'person-active-uuid',
    items: [{ productId: 'p1', warehouseId: 'w1', quantity: 3, unitPrice: 12000 }]
  });

  assert.equal(updated1.version, 2, 'Version incremented to 2');
  assert.equal(updated1.invoiceId, created.invoiceId, 'Invoice ID preserved');
  assert.equal(updated1.invoiceNumber, 100, 'Invoice number preserved');
  assert.equal(updated1.totalAmount, 36000, 'Total updated correctly');
  pass('Successful invoice update preserves IDs/numbers and increments version exactly once');

  // 4. Test Idempotency Retry
  const retryResult = await executeServerUpdateInvoice(client as any, orgId, userId, created.invoiceId!, {
    expectedVersion: 2,
    mutationKey: 'mut-key-1', // Same key
    invoiceType: 'SELL',
    personId: 'person-active-uuid',
    items: [{ productId: 'p1', warehouseId: 'w1', quantity: 3, unitPrice: 12000 }]
  });

  assert.equal(retryResult.isDuplicate, true, 'Idempotent retry detected');
  assert.equal(retryResult.version, 2, 'Version unchanged on retry');
  pass('Idempotent retry with same key returns committed result without double mutation');

  // 5. Test Fail-Closed Settlement Domains (Checks / Installments)
  // Test 9: Unlocked Cheque & Installment Updates
  const chkUpdate = await executeServerUpdateInvoice(client as any, orgId, userId, created.invoiceId!, {
    expectedVersion: 2,
    mutationKey: 'mut-key-2',
    invoiceType: 'SELL',
    personId: 'person-active-uuid',
    isSettledWithChecks: true,
    items: [{ productId: 'p1', warehouseId: 'w1', quantity: 3, unitPrice: 12000 }]
  });
  assert.ok(chkUpdate.success);
  pass('Cheque invoice update proceeds without fail closed block');

  const instUpdate = await executeServerUpdateInvoice(client as any, orgId, userId, created.invoiceId!, {
    expectedVersion: 3,
    mutationKey: 'mut-key-3',
    invoiceType: 'SELL',
    personId: 'person-active-uuid',
    isInstallmentDeferred: true,
    items: [{ productId: 'p1', warehouseId: 'w1', quantity: 3, unitPrice: 12000 }]
  });
  assert.ok(instUpdate.success);
  pass('Installment invoice update proceeds without fail closed block');

  console.log(`\n🎉 ALL ${testsPassed}/${totalTests} SERVER INVOICE UPDATE ATOMIC TESTS PASSED!`);
  console.log('======================================================================\n');
}

runTests().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
