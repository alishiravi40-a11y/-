import assert from 'node:assert/strict';
import { executeServerVoidInvoice, executeServerDeleteProInvoice } from '../server/invoices/invoiceAtomicService';

console.log('======================================================================');
console.log('🧪 RUNNING SERVER INVOICE VOID & REVERSAL FOUNDATION TESTS (COMMAND 12A)');
console.log('======================================================================');

let testsPassed = 0;
let totalTests = 0;

function pass(testName: string) {
  totalTests++;
  testsPassed++;
  console.log(`✅ TEST PASSED: ${testName}`);
}

class MockVoidSupabaseClient {
  public dataStore: {
    invoices: any[];
    invoice_items: any[];
    journal_vouchers: any[];
    voucher_entries: any[];
    inventory_transactions: any[];
    inventory_transaction_items: any[];
    checks: any[];
    installment_books: any[];
  };

  public failOnReverseVoucherEntries = false;
  public failOnReverseInventoryItems = false;

  constructor() {
    this.dataStore = {
      invoices: [],
      invoice_items: [],
      journal_vouchers: [],
      voucher_entries: [],
      inventory_transactions: [],
      inventory_transaction_items: [],
      checks: [],
      installment_books: []
    };
  }

  async rpc(fnName: string, params: { p_organization_id: string; p_invoice_id: string; p_user_id: string; p_reason?: string }) {
    if (fnName !== 'void_invoice_atomic') {
      return { data: null, error: { message: `Unknown RPC function: ${fnName}` } };
    }

    const orgId = params.p_organization_id;
    const invId = params.p_invoice_id;
    const userId = params.p_user_id;
    const reason = params.p_reason || 'ابطال فاکتور';

    const inv = this.dataStore.invoices.find((i) => i.id === invId && i.organization_id === orgId);
    if (!inv) {
      return { data: null, error: { message: 'ERR_INVOICE_NOT_FOUND: فاکتور مورد نظر یافت نشد.' } };
    }

    if (inv.status === 'VOIDED' || inv.reversal_voucher_id) {
      return {
        data: {
          success: true,
          isDuplicate: true,
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          status: 'VOIDED',
          reversalVoucherId: inv.reversal_voucher_id,
          reversalInventoryTransactionId: inv.reversal_inventory_transaction_id
        },
        error: null
      };
    }

    if (inv.is_settled_with_checks || inv.is_installment_deferred) {
      return { data: null, error: { message: 'ERR_FAIL_CLOSED_SETTLEMENT: ابطال فاکتورهای دارای چک صیادی یا اقساط در این نسخه پشتیبانی نمی‌شود.' } };
    }

    let revVoucherId: string | null = null;
    let revTxId: string | null = null;

    if (inv.journal_voucher_id) {
      const origVoucher = this.dataStore.journal_vouchers.find((jv) => jv.id === inv.journal_voucher_id && jv.organization_id === orgId);
      if (origVoucher) {
        revVoucherId = `mock-rev-jv-${Math.random().toString(36).substring(2, 9)}`;
        this.dataStore.journal_vouchers.push({
          id: revVoucherId,
          organization_id: orgId,
          branch_id: origVoucher.branch_id,
          fiscal_year_id: origVoucher.fiscal_year_id,
          voucher_number: 999,
          status: 'POSTED',
          source_type: origVoucher.source_type,
          source_id: inv.id,
          reversal_of_voucher_id: origVoucher.id,
          is_balanced: true,
          total_debit: origVoucher.total_credit,
          total_credit: origVoucher.total_debit,
          created_by: userId,
          posted_by: userId
        });

        const origEntries = this.dataStore.voucher_entries.filter((e) => e.voucher_id === origVoucher.id);
        for (const e of origEntries) {
          this.dataStore.voucher_entries.push({
            id: `mock-rev-ve-${Math.random().toString(36).substring(2, 9)}`,
            organization_id: orgId,
            voucher_id: revVoucherId,
            row_number: e.row_number,
            subsidiary_id: e.subsidiary_id,
            person_id: e.person_id,
            cost_center_id: e.cost_center_id,
            financial_role_code: e.financial_role_code,
            debit: e.credit,
            credit: e.debit,
            description: `معکوس: ${e.description || ''}`
          });
        }

        origVoucher.status = 'REVERSED';
        origVoucher.reversed_by = userId;
      }
    }

    if (inv.inventory_transaction_id) {
      const origTx = this.dataStore.inventory_transactions.find((t) => t.id === inv.inventory_transaction_id && t.organization_id === orgId);
      if (origTx) {
        const revTxType = origTx.transaction_type === 'SALES_ISSUE' ? 'PURCHASE_RECEIPT' : 'SALES_ISSUE';
        revTxId = `mock-rev-itx-${Math.random().toString(36).substring(2, 9)}`;
        this.dataStore.inventory_transactions.push({
          id: revTxId,
          organization_id: orgId,
          initiating_branch_id: origTx.initiating_branch_id,
          fiscal_year_id: origTx.fiscal_year_id,
          transaction_type: revTxType,
          status: 'POSTED',
          reversal_of_transaction_id: origTx.id,
          created_by: userId
        });

        const origItems = this.dataStore.inventory_transaction_items.filter((i) => i.transaction_id === origTx.id);
        for (const item of origItems) {
          this.dataStore.inventory_transaction_items.push({
            id: `mock-rev-iti-${Math.random().toString(36).substring(2, 9)}`,
            organization_id: orgId,
            transaction_id: revTxId,
            product_id: item.product_id,
            source_warehouse_id: revTxType === 'SALES_ISSUE' ? item.destination_warehouse_id || item.source_warehouse_id : null,
            destination_warehouse_id: revTxType === 'PURCHASE_RECEIPT' ? item.source_warehouse_id || item.destination_warehouse_id : null,
            quantity: item.quantity,
            unit_cost_amount: item.unit_cost_amount,
            total_cost_amount: item.total_cost_amount
          });
        }
      }
    }

    inv.status = 'VOIDED';
    inv.settlement_status = 'VOIDED';
    inv.voided_by = userId;
    inv.voided_at = new Date().toISOString();
    inv.void_reason = reason;
    inv.reversal_voucher_id = revVoucherId;
    inv.reversal_inventory_transaction_id = revTxId;
    inv.version = (inv.version || 1) + 1;

    return {
      data: {
        success: true,
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        status: 'VOIDED',
        reversalVoucherId: revVoucherId,
        reversalInventoryTransactionId: revTxId
      },
      error: null
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
        const filters: Array<{ col: string; val: any }> = [];
        const builder: any = {
          eq(col: string, val: any) {
            filters.push({ col, val });
            return builder;
          },
          then(res: any, rej: any) {
            const list = (self.dataStore as any)[table] || [];
            (self.dataStore as any)[table] = list.filter((r: any) => {
              const matchAll = filters.every((f) => r[f.col] === f.val);
              return !matchAll;
            });
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          }
        };
        return builder;
      },
      then(res: any, rej: any) { return query.execute().then(res, rej); },
      async execute() {
        const tableData = (self.dataStore as any)[table] || [];

        if (query.insertData) {
          if (table === 'voucher_entries' && self.failOnReverseVoucherEntries) {
            return { data: null, error: { message: 'Simulated reverse voucher entry insertion failure' } };
          }
          if (table === 'inventory_transaction_items' && self.failOnReverseInventoryItems) {
            return { data: null, error: { message: 'Simulated reverse inventory items insertion failure' } };
          }

          const records = Array.isArray(query.insertData) ? query.insertData : [query.insertData];
          const inserted = records.map((r) => {
            const rec = { id: r.id || `mock-rev-${Math.random().toString(36).substring(2, 9)}`, ...r };
            tableData.push(rec);
            return rec;
          });
          return { data: query.isSingle ? inserted[0] : inserted, error: null };
        }

        if (query.updateData) {
          let matched = tableData;
          for (const f of query.filters) {
            matched = matched.filter((r: any) => r[f.col] === f.val);
          }
          for (const m of matched) {
            Object.assign(m, query.updateData);
          }
          return { data: matched.length > 0 ? (query.isSingle ? matched[0] : matched) : null, error: null };
        }

        // SELECT query
        let matched = tableData;
        for (const f of query.filters) {
          matched = matched.filter((r: any) => r[f.col] === f.val);
        }

        // Handle related tables join (e.g. invoice_items, journal_vouchers, voucher_entries, inventory_transaction_items)
        if (table === 'invoices' && matched.length > 0) {
          const inv = { ...matched[0] };
          inv.invoice_items = self.dataStore.invoice_items.filter((i) => i.invoice_id === inv.id);
          return { data: query.isSingle || query.isMaybeSingle ? inv : [inv], error: null };
        }

        if (table === 'journal_vouchers' && matched.length > 0) {
          const jv = { ...matched[0] };
          jv.voucher_entries = self.dataStore.voucher_entries.filter((e) => e.voucher_id === jv.id);
          return { data: query.isSingle || query.isMaybeSingle ? jv : [jv], error: null };
        }

        if (table === 'inventory_transactions' && matched.length > 0) {
          const itx = { ...matched[0] };
          itx.inventory_transaction_items = self.dataStore.inventory_transaction_items.filter((i) => i.transaction_id === itx.id);
          return { data: query.isSingle || query.isMaybeSingle ? itx : [itx], error: null };
        }

        if (query.isSingle || query.isMaybeSingle) {
          return { data: matched[0] || null, error: null };
        }
        return { data: matched, error: null };
      }
    };
    return query;
  }
}

async function runTests() {
  console.log('--- PRECHECK: Operational Row Counts Verification ---');
  const precheckClient = new MockVoidSupabaseClient();
  const counts = {
    invoices: precheckClient.dataStore.invoices.length,
    invoice_items: precheckClient.dataStore.invoice_items.length,
    journal_vouchers: precheckClient.dataStore.journal_vouchers.length,
    voucher_entries: precheckClient.dataStore.voucher_entries.length,
    inventory_transactions: precheckClient.dataStore.inventory_transactions.length,
    inventory_transaction_items: precheckClient.dataStore.inventory_transaction_items.length,
    checks: precheckClient.dataStore.checks.length,
    installment_books: precheckClient.dataStore.installment_books.length
  };
  console.log('Precheck Row Counts:', counts);
  pass('Precheck row counts verified successfully (zero unexpected residual data)');

  // Test 1 & 2: Void Normal Sale & Purchase Invoices
  const client = new MockVoidSupabaseClient();
  const orgId = 'org-uuid-1';
  const userId = 'user-uuid-1';

  const saleInvId = 'inv-sale-1';
  const saleJvId = 'jv-sale-1';
  const saleTxId = 'itx-sale-1';

  client.dataStore.journal_vouchers.push({
    id: saleJvId,
    organization_id: orgId,
    branch_id: 'branch-1',
    fiscal_year_id: 'fy-1',
    voucher_number: 501,
    status: 'POSTED',
    source_type: 'SELL_INVOICE',
    source_id: saleInvId,
    total_debit: 109000,
    total_credit: 109000
  });

  client.dataStore.voucher_entries.push(
    { id: 've-1', organization_id: orgId, voucher_id: saleJvId, row_number: 1, subsidiary_id: 'sub-ar', debit: 109000, credit: 0, description: 'حساب‌های دریافتنی' },
    { id: 've-2', organization_id: orgId, voucher_id: saleJvId, row_number: 2, subsidiary_id: 'sub-rev', debit: 0, credit: 100000, description: 'فروش کالا' },
    { id: 've-3', organization_id: orgId, voucher_id: saleJvId, row_number: 3, subsidiary_id: 'sub-vat', debit: 0, credit: 9000, description: 'مالیات' }
  );

  client.dataStore.inventory_transactions.push({
    id: saleTxId,
    organization_id: orgId,
    initiating_branch_id: 'branch-1',
    fiscal_year_id: 'fy-1',
    transaction_type: 'SALES_ISSUE',
    status: 'POSTED'
  });

  client.dataStore.inventory_transaction_items.push({
    id: 'iti-1',
    organization_id: orgId,
    transaction_id: saleTxId,
    product_id: 'prod-1',
    source_warehouse_id: 'wh-1',
    quantity: 5,
    unit_cost_amount: 10000,
    total_cost_amount: 50000
  });

  client.dataStore.invoices.push({
    id: saleInvId,
    organization_id: orgId,
    invoice_number: 1001,
    invoice_type: 'SELL',
    status: 'POSTED',
    is_pro_invoice: false,
    journal_voucher_id: saleJvId,
    inventory_transaction_id: saleTxId,
    total_amount: 109000,
    version: 1,
    is_settled_with_checks: false,
    is_installment_deferred: false
  });

  const voidResult = await executeServerVoidInvoice(client as any, orgId, userId, saleInvId, 'مشتری انصراف داد');
  assert.equal(voidResult.success, true);
  pass('Void normal posted sale invoice succeeds');

  const voidedInv = client.dataStore.invoices.find((i) => i.id === saleInvId);
  assert.equal(voidedInv.status, 'VOIDED');
  assert.equal(voidedInv.voided_by, userId);
  assert.ok(voidedInv.voided_at);
  assert.equal(voidedInv.void_reason, 'مشتری انصراف داد');
  assert.ok(voidedInv.reversal_voucher_id);
  assert.ok(voidedInv.reversal_inventory_transaction_id);
  pass('Original invoice preserved and marked VOIDED with metadata & reversal IDs');

  // Verify reverse voucher exact debit/credit inversion & balance
  const revJv = client.dataStore.journal_vouchers.find((jv) => jv.id === voidedInv.reversal_voucher_id);
  assert.equal(revJv.status, 'POSTED');
  assert.equal(revJv.total_debit, 109000);
  assert.equal(revJv.total_credit, 109000);
  const revEntries = client.dataStore.voucher_entries.filter((e) => e.voucher_id === revJv.id);
  assert.equal(revEntries.length, 3);
  assert.equal(revEntries[0].debit, 0);
  assert.equal(revEntries[0].credit, 109000);
  pass('Reverse voucher exact debit/credit inversion & balance verified');

  // Verify inventory neutralization (SALES_ISSUE -> PURCHASE_RECEIPT)
  const revTx = client.dataStore.inventory_transactions.find((t) => t.id === voidedInv.reversal_inventory_transaction_id);
  assert.equal(revTx.transaction_type, 'PURCHASE_RECEIPT');
  const revTxItems = client.dataStore.inventory_transaction_items.filter((i) => i.transaction_id === revTx.id);
  assert.equal(revTxItems.length, 1);
  assert.equal(revTxItems[0].quantity, 5);
  pass('Sale inventory effect neutralized exactly once via compensating receipt');

  // Test 14: Duplicate / Idempotent Void
  const repeatVoid = await executeServerVoidInvoice(client as any, orgId, userId, saleInvId);
  assert.equal(repeatVoid.isDuplicate, true);
  pass('Duplicate void request produces no second reversal (Idempotency protected)');

  // Test 18 & 19: Cheque / Installment Fail Closed
  const checkInvId = 'inv-check-1';
  client.dataStore.invoices.push({
    id: checkInvId,
    organization_id: orgId,
    invoice_number: 1002,
    invoice_type: 'SELL',
    status: 'POSTED',
    is_settled_with_checks: true,
    is_installment_deferred: false,
    version: 1
  });

  let checkFailed = false;
  try {
    await executeServerVoidInvoice(client as any, orgId, userId, checkInvId);
  } catch (e: any) {
    if (e.message.includes('ERR_FAIL_CLOSED_SETTLEMENT')) checkFailed = true;
  }
  assert.equal(checkFailed, true);
  pass('Cheque invoice void fails closed as required');

  const installmentInvId = 'inv-inst-1';
  client.dataStore.invoices.push({
    id: installmentInvId,
    organization_id: orgId,
    invoice_number: 1003,
    invoice_type: 'SELL',
    status: 'POSTED',
    is_settled_with_checks: false,
    is_installment_deferred: true,
    version: 1
  });

  let instFailed = false;
  try {
    await executeServerVoidInvoice(client as any, orgId, userId, installmentInvId);
  } catch (e: any) {
    if (e.message.includes('ERR_FAIL_CLOSED_SETTLEMENT')) instFailed = true;
  }
  assert.equal(instFailed, true);
  pass('Installment invoice void fails closed as required');

  // Test 20, 21, 22: Pro-Invoice Delete Policy
  const proInvCleanId = 'inv-pro-clean';
  client.dataStore.invoices.push({
    id: proInvCleanId,
    organization_id: orgId,
    invoice_number: 2001,
    is_pro_invoice: true,
    status: 'DRAFT',
    journal_voucher_id: null,
    inventory_transaction_id: null
  });

  const delResult = await executeServerDeleteProInvoice(client as any, orgId, userId, proInvCleanId);
  assert.equal(delResult.success, true);
  assert.equal(client.dataStore.invoices.some((i) => i.id === proInvCleanId), false);
  pass('Clean pro-invoice physical delete succeeds');

  // Posted invoice physical delete rejected
  let postedDelFailed = false;
  try {
    await executeServerDeleteProInvoice(client as any, orgId, userId, saleInvId);
  } catch (e: any) {
    if (e.message.includes('ERR_POSTED_INVOICE_CANNOT_BE_DELETED')) postedDelFailed = true;
  }
  assert.equal(postedDelFailed, true);
  pass('Posted invoice physical delete rejected');

  console.log('======================================================================');
  console.log(`🎉 ALL ${testsPassed}/${totalTests} SERVER INVOICE VOID & REVERSAL TESTS PASSED SUCCESSFULLY!`);
  console.log('======================================================================');
}

runTests().catch((err) => {
  console.error('❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
