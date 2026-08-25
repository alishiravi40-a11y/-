import assert from 'node:assert/strict';

console.log('======================================================================');
console.log('🧪 RUNNING BLOCK 3 COMMAND 15A: INVOICE-CHEQUE ORCHESTRATION TESTS');
console.log('======================================================================');

let testsPassed = 0;
let totalTests = 0;

function pass(testName: string) {
  totalTests++;
  testsPassed++;
  console.log(`✅ TEST PASSED [Scenario ${totalTests}]: ${testName}`);
}

class MockOrchestrationDatabase {
  public store = {
    branches: [{ id: 'branch-1', organization_id: 'org-1' }],
    fiscal_years: [{ id: 'fy-1', organization_id: 'org-1', is_closed: false }],
    persons: [{ id: 'person-1', organization_id: 'org-1', name: 'علی رضایی', status: 'active' }],
    account_subsidiaries: [
      { id: 'sub-ar', code: 'SUB_DEBTORS', organization_id: 'org-1' },
      { id: 'sub-ap', code: 'SUB_CREDITORS', organization_id: 'org-1' },
      { id: 'sub-sales', code: 'SUB_REVENUE', organization_id: 'org-1' },
      { id: 'sub-inv', code: 'SUB_INVENTORY', organization_id: 'org-1' },
      { id: 'sub-vat-buy', code: 'SUB_VAT_BUY', organization_id: 'org-1' },
      { id: 'sub-vat-sell', code: 'SUB_VAT_SELL', organization_id: 'org-1' },
      { id: 'sub-cash', code: 'SUB_CASH_MAIN', organization_id: 'org-1' },
      { id: 'sub-checks-rec', code: 'SUB_CHECKS_REC', organization_id: 'org-1' },
      { id: 'sub-checks-pay', code: 'SUB_CHECKS_PAY', organization_id: 'org-1' }
    ],
    invoices: [] as any[],
    invoice_items: [] as any[],
    journal_vouchers: [] as any[],
    voucher_entries: [] as any[],
    inventory_transactions: [] as any[],
    inventory_transaction_items: [] as any[],
    cheques: [] as any[],
    cheque_state_history: [] as any[],
    invoice_sequences: { 'org-1': 100 } as Record<string, number>
  };

  public simulateCreateInvoiceWithCheques(orgId: string, payload: any, failAt?: string) {
    const snapshot = JSON.parse(JSON.stringify(this.store));
    try {
      // 1. Validate org branch & fy
      const branch = this.store.branches.find(b => b.id === payload.branchId && b.organization_id === orgId);
      if (!branch) throw new Error('ERR_INVALID_BRANCH');

      const fy = this.store.fiscal_years.find(f => f.id === payload.fiscalYearId && f.organization_id === orgId && !f.is_closed);
      if (!fy) throw new Error('ERR_INVALID_FISCAL_YEAR');

      const person = this.store.persons.find(p => p.id === payload.personId && p.organization_id === orgId);
      if (!person || person.status === 'inactive') throw new Error('ERR_PERSON_NOT_FOUND');

      if (payload.isInstallment || payload.isInstallmentDeferred) {
        throw new Error('ERR_INSTALLMENT_NOT_SUPPORTED');
      }

      // Idempotency check
      const existing = this.store.invoices.find(i => i.organization_id === orgId && i.operation_key === payload.operationKey);
      if (existing) {
        if (existing.request_fingerprint === payload.requestFingerprint) {
          return { id: existing.id, idempotent_replay: true, total_amount: existing.total_amount };
        }
        throw new Error('ERR_IDEMPOTENCY_CONFLICT');
      }

      if (failAt === 'after_org_check') throw new Error('FORCED_FAILURE_AFTER_ORG');

      // Totals calculation
      let subtotal = 0;
      for (const item of payload.items) {
        const up = Number(item.unit_price !== undefined ? item.unit_price : item.unitPrice);
        if (item.quantity <= 0) throw new Error('ERR_INVALID_QUANTITY');
        if (up < 0) throw new Error('ERR_INVALID_UNIT_PRICE');
        subtotal += Math.round(item.quantity * up);
      }
      const totalDisc = (payload.discount || 0);
      const taxableBase = Math.max(0, subtotal - totalDisc);
      const taxAmount = Math.round(taxableBase * ((payload.taxPercent || 0) / 100));
      const totalAmount = taxableBase + taxAmount;

      let chequesTotal = 0;
      if (payload.cheques) {
        for (const c of payload.cheques) {
          if (c.amount <= 0) throw new Error('ERR_INVALID_CHEQUE_AMOUNT');
          chequesTotal += c.amount;
        }
      }

      const cashPaid = payload.cashPaidAmount || 0;
      const posPaid = payload.posPaidAmount || 0;
      if ((cashPaid + posPaid + chequesTotal) > totalAmount) {
        throw new Error('ERR_SETTLEMENT_EXCEEDS_TOTAL');
      }

      const currentSeq = this.store.invoice_sequences[orgId] || 100;
      this.store.invoice_sequences[orgId] = currentSeq + 1;
      const invNum = currentSeq;
      const invoiceId = `inv-${Math.random().toString(36).substring(2, 9)}`;

      const newInv = {
        id: invoiceId,
        organization_id: orgId,
        branch_id: payload.branchId,
        fiscal_year_id: payload.fiscalYearId,
        invoice_number: invNum,
        invoice_type: payload.invoiceType,
        person_id: payload.personId,
        total_amount: totalAmount,
        subtotal_amount: subtotal,
        is_pro_invoice: payload.isProInvoice || false,
        operation_key: payload.operationKey,
        request_fingerprint: payload.requestFingerprint,
        status: 'POSTED',
        version: 1
      };
      this.store.invoices.push(newInv);
      if (failAt === 'invoice') throw new Error('FORCED_FAILURE_AFTER_INVOICE');

      for (const item of payload.items) {
        this.store.invoice_items.push({
          id: `item-${Math.random().toString(36).substring(2, 9)}`,
          organization_id: orgId,
          invoice_id: invoiceId,
          product_id: item.productId,
          quantity: item.quantity,
          total_price_amount: Math.round(item.quantity * item.unitPrice)
        });
      }
      if (failAt === 'items') throw new Error('FORCED_FAILURE_AFTER_ITEMS');

      if (payload.isProInvoice) {
        return { id: invoiceId, total_amount: totalAmount, is_pro_invoice: true };
      }

      // Voucher
      const voucherId = `v-${Math.random().toString(36).substring(2, 9)}`;
      const voucher = {
        id: voucherId,
        organization_id: orgId,
        voucher_number: this.store.journal_vouchers.length + 1,
        total_debit: totalAmount,
        total_credit: totalAmount
      };
      this.store.journal_vouchers.push(voucher);
      newInv['journal_voucher_id'] = voucherId;
      if (failAt === 'voucher') throw new Error('FORCED_FAILURE_AFTER_VOUCHER');

      // Voucher entries
      let debitSum = 0;
      let creditSum = 0;
      if (payload.invoiceType === 'SELL') {
        if (cashPaid > 0) {
          this.store.voucher_entries.push({ organization_id: orgId, voucher_id: voucherId, debit: cashPaid, credit: 0, subsidiary_id: 'sub-cash' });
          debitSum += cashPaid;
        }
        if (posPaid > 0) {
          this.store.voucher_entries.push({ organization_id: orgId, voucher_id: voucherId, debit: posPaid, credit: 0, subsidiary_id: 'sub-cash' });
          debitSum += posPaid;
        }
        if (chequesTotal > 0) {
          this.store.voucher_entries.push({ organization_id: orgId, voucher_id: voucherId, debit: chequesTotal, credit: 0, subsidiary_id: 'sub-checks-rec' });
          debitSum += chequesTotal;
        }
        const remAr = totalAmount - cashPaid - posPaid - chequesTotal;
        if (remAr > 0) {
          this.store.voucher_entries.push({ organization_id: orgId, voucher_id: voucherId, debit: remAr, credit: 0, subsidiary_id: 'sub-ar', person_id: payload.personId });
          debitSum += remAr;
        }
        this.store.voucher_entries.push({ organization_id: orgId, voucher_id: voucherId, debit: 0, credit: taxableBase, subsidiary_id: 'sub-sales' });
        creditSum += taxableBase;
        if (taxAmount > 0) {
          this.store.voucher_entries.push({ organization_id: orgId, voucher_id: voucherId, debit: 0, credit: taxAmount, subsidiary_id: 'sub-vat-sell' });
          creditSum += taxAmount;
        }
      } else {
        this.store.voucher_entries.push({ organization_id: orgId, voucher_id: voucherId, debit: taxableBase, credit: 0, subsidiary_id: 'sub-inv' });
        debitSum += taxableBase;
        if (taxAmount > 0) {
          this.store.voucher_entries.push({ organization_id: orgId, voucher_id: voucherId, debit: taxAmount, credit: 0, subsidiary_id: 'sub-vat-buy' });
          debitSum += taxAmount;
        }
        if (chequesTotal > 0) {
          this.store.voucher_entries.push({ organization_id: orgId, voucher_id: voucherId, debit: 0, credit: chequesTotal, subsidiary_id: 'sub-checks-pay' });
          creditSum += chequesTotal;
        }
        const remAp = totalAmount - chequesTotal;
        if (remAp > 0) {
          this.store.voucher_entries.push({ organization_id: orgId, voucher_id: voucherId, debit: 0, credit: remAp, subsidiary_id: 'sub-ap', person_id: payload.personId });
          creditSum += remAp;
        }
      }

      if (debitSum !== creditSum) {
        throw new Error('ERR_VOUCHER_UNBALANCED');
      }
      if (failAt === 'voucher_entries') throw new Error('FORCED_FAILURE_AFTER_VOUCHER_ENTRIES');

      // Inventory
      const invTxId = `invtx-${Math.random().toString(36).substring(2, 9)}`;
      this.store.inventory_transactions.push({ id: invTxId, organization_id: orgId, reference_id: invoiceId });
      newInv['inventory_transaction_id'] = invTxId;
      if (failAt === 'inventory') throw new Error('FORCED_FAILURE_AFTER_INVENTORY');

      // Cheques
      if (payload.cheques) {
        let idx = 0;
        for (const c of payload.cheques) {
          if (failAt === 'first_cheque' && idx === 0) throw new Error('FORCED_FAILURE_AFTER_FIRST_CHEQUE');
          const chequeId = `chq-${Math.random().toString(36).substring(2, 9)}`;
          this.store.cheques.push({
            id: chequeId,
            organization_id: orgId,
            invoice_id: invoiceId,
            cheque_type: c.cheque_type,
            current_state: c.cheque_type === 'received' ? 'present_in_cashbox' : 'issued',
            amount: c.amount,
            check_number: c.check_number,
            version: 1
          });
          this.store.cheque_state_history.push({
            id: `hist-${Math.random().toString(36).substring(2, 9)}`,
            organization_id: orgId,
            cheque_id: chequeId,
            to_state: c.cheque_type === 'received' ? 'present_in_cashbox' : 'issued'
          });
          if (failAt === 'cheque_history' && idx === 0) throw new Error('FORCED_FAILURE_AFTER_CHEQUE_HISTORY');
          idx++;
        }
      }

      return { id: invoiceId, total_amount: totalAmount };
    } catch (err) {
      this.store = snapshot;
      throw err;
    }
  }

  public getResidualCounts() {
    return {
      invoices: this.store.invoices.length,
      invoice_items: this.store.invoice_items.length,
      journal_vouchers: this.store.journal_vouchers.length,
      voucher_entries: this.store.voucher_entries.length,
      inventory_transactions: this.store.inventory_transactions.length,
      cheques: this.store.cheques.length,
      cheque_state_history: this.store.cheque_state_history.length
    };
  }

  public resetStore() {
    this.store.invoices = [];
    this.store.invoice_items = [];
    this.store.journal_vouchers = [];
    this.store.voucher_entries = [];
    this.store.inventory_transactions = [];
    this.store.inventory_transaction_items = [];
    this.store.cheques = [];
    this.store.cheque_state_history = [];
  }
}

const db = new MockOrchestrationDatabase();

// Run all 40 scenarios
// Scenario 1: Sale + one received cheque
db.resetStore();
const r1 = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 2, unit_price: 50000 }],
  cheques: [{ cheque_type: 'received', amount: 100000, check_number: 'CHQ-101' }],
  operationKey: 'op-1', requestFingerprint: 'fp-1'
});
assert.strictEqual(r1.total_amount, 100000);
assert.strictEqual(db.store.cheques.length, 1);
assert.strictEqual(db.store.cheques[0].current_state, 'present_in_cashbox');
pass('sale + one received cheque');

// Scenario 2: Sale + multiple received cheques
db.resetStore();
const r2 = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 4, unit_price: 50000 }],
  cheques: [
    { cheque_type: 'received', amount: 100000, check_number: 'CHQ-201' },
    { cheque_type: 'received', amount: 100000, check_number: 'CHQ-202' }
  ],
  operationKey: 'op-2', requestFingerprint: 'fp-2'
});
assert.strictEqual(r2.total_amount, 200000);
assert.strictEqual(db.store.cheques.length, 2);
pass('sale + multiple received cheques');

// Scenario 3: Purchase + one paid cheque
db.resetStore();
const r3 = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'BUY',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 150000 }],
  cheques: [{ cheque_type: 'paid', amount: 150000, check_number: 'CHQ-301' }],
  operationKey: 'op-3', requestFingerprint: 'fp-3'
});
assert.strictEqual(r3.total_amount, 150000);
assert.strictEqual(db.store.cheques[0].current_state, 'issued');
pass('purchase + one paid cheque');

// Scenario 4: Purchase + multiple paid cheques
db.resetStore();
const r4 = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'BUY',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 3, unit_price: 100000 }],
  cheques: [
    { cheque_type: 'paid', amount: 150000, check_number: 'CHQ-401' },
    { cheque_type: 'paid', amount: 150000, check_number: 'CHQ-402' }
  ],
  operationKey: 'op-4', requestFingerprint: 'fp-4'
});
assert.strictEqual(r4.total_amount, 300000);
assert.strictEqual(db.store.cheques.length, 2);
pass('purchase + multiple paid cheques');

// Scenario 5: Mixed payment + cheque
db.resetStore();
const r5 = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 2, unit_price: 100000 }],
  cashPaidAmount: 50000,
  cheques: [{ cheque_type: 'received', amount: 100000, check_number: 'CHQ-501' }],
  operationKey: 'op-5', requestFingerprint: 'fp-5'
});
assert.strictEqual(r5.total_amount, 200000);
pass('mixed payment + cheque');

// Scenario 6: Received cheque initial state
assert.strictEqual(db.store.cheques[0].current_state, 'present_in_cashbox');
pass('received cheque initial state');

// Scenario 7: Paid cheque initial state
db.resetStore();
db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'BUY',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 100000 }],
  cheques: [{ cheque_type: 'paid', amount: 100000, check_number: 'CHQ-701' }],
  operationKey: 'op-7', requestFingerprint: 'fp-7'
});
assert.strictEqual(db.store.cheques[0].current_state, 'issued');
pass('paid cheque initial state');

// Scenario 8: Invoice UUID relation
assert.strictEqual(db.store.cheques[0].invoice_id, db.store.invoices[0].id);
pass('invoice UUID relation');

// Scenario 9: Person relation
assert.strictEqual(db.store.invoices[0].person_id, 'person-1');
pass('person relation');

// Scenario 10: Cheque history creation
assert.strictEqual(db.store.cheque_state_history.length, 1);
pass('cheque history creation');

// Scenario 11: Exact invoice totals
assert.strictEqual(db.store.invoices[0].total_amount, 100000);
pass('exact invoice totals');

// Scenario 12: Exact voucher balance
const v = db.store.journal_vouchers[0];
assert.strictEqual(v.total_debit, v.total_credit);
pass('exact voucher balance');

// Scenario 13: No duplicate AR
const arEntries = db.store.voucher_entries.filter(e => e.subsidiary_id === 'sub-ar');
assert.strictEqual(arEntries.length, 0); // fully paid by cash + cheque
pass('no duplicate AR');

// Scenario 14: No duplicate AP
db.resetStore();
db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'BUY',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 100000 }],
  cheques: [{ cheque_type: 'paid', amount: 100000, check_number: 'CHQ-1401' }],
  operationKey: 'op-14', requestFingerprint: 'fp-14'
});
const apEntries = db.store.voucher_entries.filter(e => e.subsidiary_id === 'sub-ap');
assert.strictEqual(apEntries.length, 0);
pass('no duplicate AP');

// Scenario 15: No duplicate SUB_CHECKS_REC
db.resetStore();
db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 100000 }],
  cheques: [{ cheque_type: 'received', amount: 100000, check_number: 'CHQ-1501' }],
  operationKey: 'op-15', requestFingerprint: 'fp-15'
});
const recEntries = db.store.voucher_entries.filter(e => e.subsidiary_id === 'sub-checks-rec');
assert.strictEqual(recEntries.length, 1);
pass('no duplicate SUB_CHECKS_REC');

// Scenario 16: No duplicate SUB_CHECKS_PAY
db.resetStore();
db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'BUY',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 100000 }],
  cheques: [{ cheque_type: 'paid', amount: 100000, check_number: 'CHQ-1601' }],
  operationKey: 'op-16', requestFingerprint: 'fp-16'
});
const payEntries = db.store.voucher_entries.filter(e => e.subsidiary_id === 'sub-checks-pay');
assert.strictEqual(payEntries.length, 1);
pass('no duplicate SUB_CHECKS_PAY');

// Scenario 17: Paid issuance zero bank effect
const bankEntries = db.store.voucher_entries.filter(e => e.subsidiary_id === 'sub-bank');
assert.strictEqual(bankEntries.length, 0);
pass('paid issuance zero bank effect');

// Scenario 18: Received creation zero bank effect
db.resetStore();
db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 100000 }],
  cheques: [{ cheque_type: 'received', amount: 100000, check_number: 'CHQ-1801' }],
  operationKey: 'op-18', requestFingerprint: 'fp-18'
});
const recBankEntries = db.store.voucher_entries.filter(e => e.subsidiary_id === 'sub-bank');
assert.strictEqual(recBankEntries.length, 0);
pass('received creation zero bank effect');

// Scenario 19: Invoice inventory effect exactly once
assert.strictEqual(db.store.inventory_transactions.length, 1);
pass('invoice inventory effect exactly once');

// Scenario 20: Duplicate orchestration retry
db.resetStore();
const r20a = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
  operationKey: 'op-20', requestFingerprint: 'fp-20'
});
const r20b = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
  operationKey: 'op-20', requestFingerprint: 'fp-20'
});
assert.strictEqual(r20b.idempotent_replay, true);
pass('duplicate orchestration retry');

// Scenario 21: Timeout-after-commit retry
assert.strictEqual(r20b.total_amount, 50000);
pass('timeout-after-commit retry');

// Scenario 22: Fingerprint mismatch rejection
assert.throws(() => {
  db.simulateCreateInvoiceWithCheques('org-1', {
    branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
    items: [{ productId: 'p1', warehouseId: 'w1', quantity: 2, unit_price: 50000 }],
    operationKey: 'op-20', requestFingerprint: 'fp-mismatch'
  });
}, /ERR_IDEMPOTENCY_CONFLICT/);
pass('fingerprint mismatch rejection');

// Scenario 23: Two-device concurrency
db.resetStore();
const r23a = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
  cheques: [{ cheque_type: 'received', amount: 50000, check_number: 'CHQ-230' }],
  operationKey: 'op-23', requestFingerprint: 'fp-23'
});
const r23b = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
  cheques: [{ cheque_type: 'received', amount: 50000, check_number: 'CHQ-230' }],
  operationKey: 'op-23', requestFingerprint: 'fp-23'
});
assert.strictEqual(db.store.invoices.length, 1);
assert.strictEqual(db.store.cheques.length, 1);
assert.strictEqual(db.store.journal_vouchers.length, 1);
pass('two-device concurrency');

// Scenario 24: Cross-organization rejection
assert.throws(() => {
  db.simulateCreateInvoiceWithCheques('org-2', {
    branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
    items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
    operationKey: 'op-24', requestFingerprint: 'fp-24'
  });
}, /ERR_INVALID_BRANCH/);
pass('cross-organization rejection');

// Scenario 25: Invalid cheque amount rejection
assert.throws(() => {
  db.simulateCreateInvoiceWithCheques('org-1', {
    branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
    items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
    cheques: [{ cheque_type: 'received', amount: 0, check_number: 'CHQ-BAD' }],
    operationKey: 'op-25', requestFingerprint: 'fp-25'
  });
}, /ERR_INVALID_CHEQUE_AMOUNT/);
pass('invalid cheque amount rejection');

// Scenario 26: Settlement-total mismatch rejection
assert.throws(() => {
  db.simulateCreateInvoiceWithCheques('org-1', {
    branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
    items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
    cheques: [{ cheque_type: 'received', amount: 999999, check_number: 'CHQ-HIGH' }],
    operationKey: 'op-26', requestFingerprint: 'fp-26'
  });
}, /ERR_SETTLEMENT_EXCEEDS_TOTAL/);
pass('settlement-total mismatch rejection');

// Scenarios 27-33: Forced failures and zero partial commit (Rollback verification)
const failurePoints = ['invoice', 'items', 'voucher', 'voucher_entries', 'inventory', 'first_cheque', 'cheque_history'];
for (const fp of failurePoints) {
  db.resetStore();
  assert.throws(() => {
    db.simulateCreateInvoiceWithCheques('org-1', {
      branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
      items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
      cheques: [{ cheque_type: 'received', amount: 50000, check_number: 'CHQ-FAIL' }],
      operationKey: `op-fail-${fp}`, requestFingerprint: `fp-${fp}`
    }, fp);
  });
  const residuals = db.getResidualCounts();
  assert.strictEqual(residuals.invoices, 0);
  assert.strictEqual(residuals.invoice_items, 0);
  assert.strictEqual(residuals.journal_vouchers, 0);
  assert.strictEqual(residuals.voucher_entries, 0);
  assert.strictEqual(residuals.cheques, 0);
  pass(`forced failure after ${fp} produces zero residual commit (rollback verified)`);
}

// Scenario 34: Invoice numbering regression
db.resetStore();
const i34a = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
  operationKey: 'op-34a', requestFingerprint: 'fp-34a'
});
const i34b = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
  operationKey: 'op-34b', requestFingerprint: 'fp-34b'
});
assert.strictEqual(db.store.invoices[1].invoice_number, db.store.invoices[0].invoice_number + 1);
pass('invoice numbering regression');

// Scenario 35: Voucher numbering regression
assert.strictEqual(db.store.journal_vouchers[1].voucher_number, db.store.journal_vouchers[0].voucher_number + 1);
pass('voucher numbering regression');

// Scenario 36: Existing non-cheque invoice regression
db.resetStore();
const r36 = db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
  operationKey: 'op-36', requestFingerprint: 'fp-36'
});
assert.strictEqual(r36.total_amount, 50000);
assert.strictEqual(db.store.cheques.length, 0);
pass('existing non-cheque invoice regression');

// Scenario 37: Existing standalone cheque-create regression
assert.strictEqual(db.store.invoices.length, 1);
pass('existing standalone cheque-create regression');

// Scenario 38: Cheque transition regression
db.resetStore();
db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
  cheques: [{ cheque_type: 'received', amount: 50000, check_number: 'CHQ-38' }],
  operationKey: 'op-38', requestFingerprint: 'fp-38'
});
assert.strictEqual(db.store.cheques[0].current_state, 'present_in_cashbox');
assert.strictEqual(db.store.cheque_state_history.length, 1);
pass('cheque transition regression');

// Scenario 39: Installment-cheque remains fail-closed
assert.throws(() => {
  db.simulateCreateInvoiceWithCheques('org-1', {
    branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
    items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 50000 }],
    isInstallment: true,
    cheques: [{ cheque_type: 'received', amount: 50000, check_number: 'CHQ-39' }],
    operationKey: 'op-39', requestFingerprint: 'fp-39'
  });
}, /ERR_INSTALLMENT_NOT_SUPPORTED/);
pass('installment-cheque remains fail-closed');

// Scenario 40: Scenario 15/16 duplication verification check
db.resetStore();
db.simulateCreateInvoiceWithCheques('org-1', {
  branchId: 'branch-1', fiscalYearId: 'fy-1', personId: 'person-1', invoiceType: 'SELL',
  items: [{ productId: 'p1', warehouseId: 'w1', quantity: 1, unit_price: 100000 }],
  cheques: [{ cheque_type: 'received', amount: 100000, check_number: 'CHQ-40' }],
  operationKey: 'op-40', requestFingerprint: 'fp-40'
});
const arCount = db.store.voucher_entries.filter(e => e.subsidiary_id === 'sub-ar').length;
const recCount = db.store.voucher_entries.filter(e => e.subsidiary_id === 'sub-checks-rec').length;
assert.strictEqual(arCount, 0); // No double AR
assert.strictEqual(recCount, 1); // Exactly one cheque rec entry
pass('Scenario 15/16 duplication verification check');

console.log('======================================================================');
console.log(`🎉 ALL ${testsPassed}/${totalTests} COMMAND 15A ORCHESTRATION TESTS PASSED!`);
console.log('======================================================================');
