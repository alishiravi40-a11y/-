import assert from 'node:assert/strict';
import { JournalVoucher, VoucherEntry } from '../../types';

/**
 * Double-Entry Balance & Financial Ledger Integrity Test Suite
 * Master Invariant Verification based on GEMINI.md Specification:
 * 
 * 1. Double-Entry Balance: SUM(debit) === SUM(credit)
 * 2. Immutable Ledger & Zero-Tolerance Unbalanced Rejection (ERR_VOUCHER_UNBALANCED)
 * 3. POS Split Payment Ledger Leg Validation (exposing & trapping missing POS debit entries)
 * 4. Server-Authoritative Single Source of Truth (SSOT) Persistence Enforcement
 */

// Helper to compute voucher balance
function computeVoucherBalance(entries: Array<{ debit: number; credit: number }>) {
  const totalDebit = entries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0);
  const totalCredit = entries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0);
  return {
    totalDebit,
    totalCredit,
    isBalanced: totalDebit === totalCredit,
    difference: Math.abs(totalDebit - totalCredit)
  };
}

// Validator simulating database-level trigger & server RPC double-entry guard
function validateAndPostVoucher(voucher: {
  id: string;
  entries: Array<{ subsidiaryId: string; debit: number; credit: number; description?: string }>;
}) {
  if (!voucher.entries || voucher.entries.length === 0) {
    throw new Error('ERR_VOUCHER_EMPTY: سند بدون ردیف حسابداری قابل ثبت نیست.');
  }

  const { totalDebit, totalCredit, isBalanced } = computeVoucherBalance(voucher.entries);

  if (!isBalanced) {
    throw new Error(
      `ERR_VOUCHER_UNBALANCED: سند حسابداری تراز نیست (بدهکار: ${totalDebit.toLocaleString()}, بستانکار: ${totalCredit.toLocaleString()})`
    );
  }

  return {
    status: 'POSTED',
    isBalanced: true,
    totalDebit,
    totalCredit
  };
}

/**
 * Simulated Invoice Voucher Generator reflecting server/invoices/invoiceAtomicService.ts
 */
function generateInvoiceVoucherEntries(params: {
  invoiceType: 'SELL' | 'BUY';
  invoiceNumber: string;
  taxableBase: number;
  calculatedTax: number;
  calculatedTotal: number;
  cashPaidAmount: number;
  posPaidAmount: number;
  includePosDebitLeg: boolean; // Flag to simulate the missing POS debit bug vs corrected behavior
}) {
  const {
    invoiceType,
    invoiceNumber,
    taxableBase,
    calculatedTax,
    calculatedTotal,
    cashPaidAmount,
    posPaidAmount,
    includePosDebitLeg
  } = params;

  const entries: Array<{ subsidiaryId: string; debit: number; credit: number; description: string }> = [];

  if (invoiceType === 'SELL') {
    const remainingCredit = calculatedTotal - (cashPaidAmount + posPaidAmount);

    // Leg 1: Cash payment (if any)
    if (cashPaidAmount > 0) {
      entries.push({
        subsidiaryId: 'SUB_CASH',
        debit: cashPaidAmount,
        credit: 0,
        description: `دریافت نقدی بابت فاکتور فروش شماره ${invoiceNumber}`
      });
    }

    // Leg 2: POS payment (The Bug Scenario vs Fixed Scenario)
    if (posPaidAmount > 0 && includePosDebitLeg) {
      entries.push({
        subsidiaryId: 'SUB_BANK_POS',
        debit: posPaidAmount,
        credit: 0,
        description: `دریافت کارتخوان (POS) بابت فاکتور فروش شماره ${invoiceNumber}`
      });
    }

    // Leg 3: Remaining credit/debtors (if any)
    if (remainingCredit > 0 || (cashPaidAmount === 0 && posPaidAmount === 0)) {
      const actualDebt = remainingCredit > 0 ? remainingCredit : calculatedTotal;
      entries.push({
        subsidiaryId: 'SUB_DEBTORS',
        debit: actualDebt,
        credit: 0,
        description: `فروش نسیه - فاکتور شماره ${invoiceNumber}`
      });
    }

    // Leg 4: Revenue (Credit)
    entries.push({
      subsidiaryId: 'SUB_REVENUE',
      debit: 0,
      credit: taxableBase,
      description: `فروش کالا/خدمات طی فاکتور شماره ${invoiceNumber}`
    });

    // Leg 5: VAT (Credit)
    if (calculatedTax > 0) {
      entries.push({
        subsidiaryId: 'SUB_VAT_SELL',
        debit: 0,
        credit: calculatedTax,
        description: `مالیات بر ارزش افزوده فاکتور فروش ${invoiceNumber}`
      });
    }
  }

  return entries;
}

async function runDoubleEntryTestSuite() {
  console.log('======================================================================');
  console.log('🧪 RUNNING MASTER INTEGRITY SUITE: Double-Entry Accounting Invariants');
  console.log('======================================================================\n');

  let passedCount = 0;

  // -------------------------------------------------------------------------
  // TEST 1: Rejection of unbalanced voucher drafts with ERR_VOUCHER_UNBALANCED
  // -------------------------------------------------------------------------
  console.log('▶ TEST 1: Rejection of unbalanced voucher drafts (SUM(debit) !== SUM(credit))...');
  {
    const unbalancedDraft = {
      id: 'VOUCHER_DRAFT_001',
      entries: [
        { subsidiaryId: 'SUB_CASH', debit: 10000000, credit: 0, description: 'دریافت نقدی' },
        { subsidiaryId: 'SUB_REVENUE', debit: 0, credit: 9500000, description: 'فروش کالا با اختلاف ۵۰۰ هزار ریال' }
      ]
    };

    const balanceCheck = computeVoucherBalance(unbalancedDraft.entries);
    assert.equal(balanceCheck.isBalanced, false, 'Voucher must be flagged as unbalanced');
    assert.equal(balanceCheck.difference, 500000, 'Difference must exactly equal 500,000 Rials');

    assert.throws(
      () => validateAndPostVoucher(unbalancedDraft),
      (err: Error) => {
        assert.ok(
          err.message.includes('ERR_VOUCHER_UNBALANCED'),
          `Error message should contain ERR_VOUCHER_UNBALANCED, received: ${err.message}`
        );
        return true;
      },
      'Unbalanced voucher draft must be rejected atomically by double-entry invariant'
    );

    console.log('  ✅ TEST 1 PASSED: Unbalanced voucher correctly trapped with ERR_VOUCHER_UNBALANCED.\n');
    passedCount++;
  }

  // -------------------------------------------------------------------------
  // TEST 2: Validation that valid balanced entries pass mathematical check
  // -------------------------------------------------------------------------
  console.log('▶ TEST 2: Validation that valid balanced multi-leg entries pass mathematical check...');
  {
    const balancedVoucher = {
      id: 'VOUCHER_BALANCED_002',
      entries: [
        { subsidiaryId: 'SUB_INVENTORY', debit: 50000000, credit: 0, description: 'خرید موجودی کالا' },
        { subsidiaryId: 'SUB_VAT_BUY', debit: 5000000, credit: 0, description: 'مالیات بر ارزش افزوده خرید' },
        { subsidiaryId: 'SUB_CREDITORS', debit: 0, credit: 55000000, description: 'بستانکاران تجاری (تامین‌کننده)' }
      ]
    };

    const balanceCheck = computeVoucherBalance(balancedVoucher.entries);
    assert.equal(balanceCheck.isBalanced, true, 'Voucher must be strictly balanced');
    assert.equal(balanceCheck.totalDebit, 55000000, 'Total debit must be 55,000,000 Rials');
    assert.equal(balanceCheck.totalCredit, 55000000, 'Total credit must be 55,000,000 Rials');

    const postResult = validateAndPostVoucher(balancedVoucher);
    assert.equal(postResult.status, 'POSTED');
    assert.equal(postResult.isBalanced, true);

    console.log('  ✅ TEST 2 PASSED: Balanced multi-leg journal entries validated and posted successfully.\n');
    passedCount++;
  }

  // -------------------------------------------------------------------------
  // TEST 3: Verification of POS payment split & trapping missing POS debit bug
  // -------------------------------------------------------------------------
  console.log('▶ TEST 3: POS payment split verification (50% Cash + 50% POS) & bug trap...');
  {
    const invoiceTotal = 20000000; // 20,000,000 Rials
    const cashPortion = 10000000;  // 50% Cash (10,000,000 Rials)
    const posPortion = 10000000;   // 50% POS (10,000,000 Rials)

    // Scenario 3A: Simulating the known bug where POS debit leg is omitted from voucher entries
    const buggedVoucherEntries = generateInvoiceVoucherEntries({
      invoiceType: 'SELL',
      invoiceNumber: 'INV-2026-BUG',
      taxableBase: 20000000,
      calculatedTax: 0,
      calculatedTotal: invoiceTotal,
      cashPaidAmount: cashPortion,
      posPaidAmount: posPortion,
      includePosDebitLeg: false // Simulating the missing POS debit leg
    });

    const buggedBalance = computeVoucherBalance(buggedVoucherEntries);
    assert.equal(buggedBalance.totalDebit, 10000000, 'Debit only captures Cash portion');
    assert.equal(buggedBalance.totalCredit, 20000000, 'Credit captures full Revenue');
    assert.equal(buggedBalance.isBalanced, false, 'Omission of POS debit creates 10,000,000 Rials imbalance');

    // Assert that the invariant engine traps this bug with ERR_VOUCHER_UNBALANCED
    assert.throws(
      () => validateAndPostVoucher({ id: 'VOUCHER_BUGGED_POS', entries: buggedVoucherEntries }),
      (err: Error) => {
        assert.ok(err.message.includes('ERR_VOUCHER_UNBALANCED'));
        return true;
      },
      'Missing POS debit leg MUST trigger ERR_VOUCHER_UNBALANCED and block database commit'
    );

    // Scenario 3B: Corrected behavior where POS debit leg is properly recorded
    const fixedVoucherEntries = generateInvoiceVoucherEntries({
      invoiceType: 'SELL',
      invoiceNumber: 'INV-2026-FIXED',
      taxableBase: 20000000,
      calculatedTax: 0,
      calculatedTotal: invoiceTotal,
      cashPaidAmount: cashPortion,
      posPaidAmount: posPortion,
      includePosDebitLeg: true // Correctly adding SUB_BANK_POS debit
    });

    const fixedBalance = computeVoucherBalance(fixedVoucherEntries);
    assert.equal(fixedBalance.totalDebit, 20000000, 'Debit captures Cash (10M) + POS (10M)');
    assert.equal(fixedBalance.totalCredit, 20000000, 'Credit captures full Revenue (20M)');
    assert.equal(fixedBalance.isBalanced, true, 'Balanced with complete payment legs');

    const fixedPostResult = validateAndPostVoucher({ id: 'VOUCHER_FIXED_POS', entries: fixedVoucherEntries });
    assert.equal(fixedPostResult.status, 'POSTED');

    console.log('  ✅ TEST 3 PASSED: Missing POS debit trapped by ERR_VOUCHER_UNBALANCED; fixed split posts cleanly.\n');
    passedCount++;
  }

  // -------------------------------------------------------------------------
  // TEST 4: Verification of Opening Balance persistence & SSOT enforcement
  // -------------------------------------------------------------------------
  console.log('▶ TEST 4: Verification of Opening Balance persistence & Single Source of Truth (SSOT)...');
  {
    // Simulated mock database ledger
    const databaseLedger: Array<{ id: string; voucherNumber: number; totalDebit: number; totalCredit: number }> = [];

    // Client-side local state
    const clientLocalState = {
      openingBalances: {
        'SUB_CASH': 15000000,
        'SUB_BANK': 85000000,
        'SUB_CAPITAL': 100000000
      }
    };

    // Assertion 1: Local state mutation without server RPC yields 0 rows in database ledger
    assert.equal(databaseLedger.length, 0, 'Database ledger must have 0 rows prior to authoritative RPC execution');

    // Persistence Check Function: Asserts server ledger backing for any active balance
    function checkPersistenceIntegrity(accountBalances: Record<string, number>, dbLedger: typeof databaseLedger) {
      const totalLocalBalance = Object.values(accountBalances).reduce((sum, b) => sum + b, 0);
      if (totalLocalBalance > 0 && dbLedger.length === 0) {
        throw new Error('ERR_SSOT_PERSISTENCE_VIOLATION: مانده‌های مالی در پایگاه داده اصلی (PostgreSQL) ثبت نشده‌اند.');
      }
      return true;
    }

    // Local mutation must fail the persistence check
    assert.throws(
      () => checkPersistenceIntegrity(clientLocalState.openingBalances, databaseLedger),
      (err: Error) => {
        assert.ok(err.message.includes('ERR_SSOT_PERSISTENCE_VIOLATION'));
        return true;
      },
      'Client-only local mutation without database persistence MUST fail SSOT check'
    );

    // Authoritative RPC execution: Creates real balanced opening voucher in DB
    const openingVoucherEntries = [
      { subsidiaryId: 'SUB_CASH', debit: 15000000, credit: 0 },
      { subsidiaryId: 'SUB_BANK', debit: 85000000, credit: 0 },
      { subsidiaryId: 'SUB_CAPITAL', debit: 0, credit: 100000000 }
    ];
    const postedVoucher = validateAndPostVoucher({ id: 'VOUCHER_OPENING_001', entries: openingVoucherEntries });

    // Commit to authoritative database ledger
    databaseLedger.push({
      id: 'VOUCHER_OPENING_001',
      voucherNumber: 1,
      totalDebit: postedVoucher.totalDebit,
      totalCredit: postedVoucher.totalCredit
    });

    // Verify persistence integrity passes once backed by database ledger
    const persistenceResult = checkPersistenceIntegrity(clientLocalState.openingBalances, databaseLedger);
    assert.equal(persistenceResult, true, 'Persistence integrity check passes when backed by authoritative DB ledger');
    assert.equal(databaseLedger.length, 1, 'Database ledger holds the authoritative opening record');

    console.log('  ✅ TEST 4 PASSED: Local-only state mutation rejected; authoritative database persistence enforced.\n');
    passedCount++;
  }

  // -------------------------------------------------------------------------
  // TEST 5: Comprehensive Mixed Settlement Invoice (Cash + POS + Discount + 10% VAT)
  // -------------------------------------------------------------------------
  console.log('▶ TEST 5: Complex Mixed Settlement Invoice (Cash + POS + Line & General Discounts + 10% VAT)...');
  {
    // Multi-line invoice calculation:
    // Line 1: 5 units @ 2,000,000 = 10,000,000 Rials (Line discount: 500,000)
    // Line 2: 10 units @ 1,500,000 = 15,000,000 Rials (Line discount: 1,000,000)
    // Subtotal: 25,000,000 Rials
    // Total Line Discounts: 1,500,000 Rials
    // Invoice General Discount: 1,500,000 Rials
    // Combined Discount: 3,000,000 Rials
    // Taxable Base: 25,000,000 - 3,000,000 = 22,000,000 Rials
    // VAT (10%): 2,200,000 Rials
    // Final Total: 24,200,000 Rials
    //
    // Mixed Settlement Allocation:
    // Cash Paid: 5,000,000 Rials
    // POS Paid: 10,000,000 Rials
    // Remaining Credit/Debtors: 9,200,000 Rials (24,200,000 - 15,000,000)

    const complexMixedVoucherEntries = generateInvoiceVoucherEntries({
      invoiceType: 'SELL',
      invoiceNumber: 'INV-2026-MIXED-COMPLEX',
      taxableBase: 22000000,
      calculatedTax: 2200000,
      calculatedTotal: 24200000,
      cashPaidAmount: 5000000,
      posPaidAmount: 10000000,
      includePosDebitLeg: true
    });

    const balanceCheck = computeVoucherBalance(complexMixedVoucherEntries);
    assert.equal(balanceCheck.isBalanced, true, 'Complex mixed settlement voucher must be mathematically balanced');
    assert.equal(balanceCheck.totalDebit, 24200000, 'Total Debit must equal 24,200,000 Rials');
    assert.equal(balanceCheck.totalCredit, 24200000, 'Total Credit must equal 24,200,000 Rials');
    assert.equal(balanceCheck.difference, 0, 'Ledger imbalance difference must be exactly zero');

    // Verify all individual legs exist and match expected amounts
    const cashLeg = complexMixedVoucherEntries.find(e => e.subsidiaryId === 'SUB_CASH');
    const posLeg = complexMixedVoucherEntries.find(e => e.subsidiaryId === 'SUB_BANK_POS');
    const debtorLeg = complexMixedVoucherEntries.find(e => e.subsidiaryId === 'SUB_DEBTORS');
    const revenueLeg = complexMixedVoucherEntries.find(e => e.subsidiaryId === 'SUB_REVENUE');
    const vatLeg = complexMixedVoucherEntries.find(e => e.subsidiaryId === 'SUB_VAT_SELL');

    assert.ok(cashLeg && cashLeg.debit === 5000000, 'Cash debit leg must be 5,000,000');
    assert.ok(posLeg && posLeg.debit === 10000000, 'POS debit leg must be 10,000,000');
    assert.ok(debtorLeg && debtorLeg.debit === 9200000, 'Debtor debit leg must be 9,200,000');
    assert.ok(revenueLeg && revenueLeg.credit === 22000000, 'Revenue credit leg must be 22,000,000');
    assert.ok(vatLeg && vatLeg.credit === 2200000, 'VAT credit leg must be 2,200,000');

    const postResult = validateAndPostVoucher({
      id: 'VOUCHER_MIXED_001',
      entries: complexMixedVoucherEntries
    });
    assert.equal(postResult.status, 'POSTED');
    assert.equal(postResult.isBalanced, true);

    console.log('  ✅ TEST 5 PASSED: Complex mixed settlement verified with zero ledger imbalance across 5 accounting legs.\n');
    passedCount++;
  }

  // -------------------------------------------------------------------------
  // TEST 6: Installment Settlement Overpayment Guard (ERR_INSTALLMENT_OVERPAYMENT_EXCEEDS_DEBT)
  // -------------------------------------------------------------------------
  console.log('▶ TEST 6: Installment Settlement Overpayment Guard (ERR_INSTALLMENT_OVERPAYMENT_EXCEEDS_DEBT)...');
  {
    // Simulate target active installments with total unpaid amount of 8,000,000 Rials
    const targetInstallments = [
      { id: 'inst_1', amount: 5000000, paid_amount: 1000000 }, // unpaid: 4,000,000
      { id: 'inst_2', amount: 4000000, paid_amount: 0 }        // unpaid: 4,000,000
    ];

    const totalUnpaid = targetInstallments.reduce((sum, inst) => sum + (inst.amount - (inst.paid_amount || 0)), 0);
    assert.equal(totalUnpaid, 8000000, 'Total unpaid debt must equal 8,000,000 Rials');

    const validateInstallmentSettlement = (paymentAmount: number, installments: typeof targetInstallments) => {
      const v_total_unpaid = installments.reduce((sum, inst) => sum + (inst.amount - (inst.paid_amount || 0)), 0);
      if (paymentAmount > v_total_unpaid) {
        throw new Error('ERR_INSTALLMENT_OVERPAYMENT_EXCEEDS_DEBT: مبلغ پرداختی نمی‌تواند از مجموع بدهی اقساط انتخاب‌شده بیشتر باشد.');
      }
      return { success: true, allocated: paymentAmount };
    };

    // Case A: Overpayment attempt (10,000,000 Rials against 8,000,000 Rials unpaid)
    assert.throws(
      () => validateInstallmentSettlement(10000000, targetInstallments),
      (err: Error) => {
        assert.ok(
          err.message.includes('ERR_INSTALLMENT_OVERPAYMENT_EXCEEDS_DEBT'),
          `Error message should contain ERR_INSTALLMENT_OVERPAYMENT_EXCEEDS_DEBT, received: ${err.message}`
        );
        return true;
      },
      'Settlement overpayment must be blocked with ERR_INSTALLMENT_OVERPAYMENT_EXCEEDS_DEBT'
    );

    // Case B: Exact settlement (8,000,000 Rials)
    const exactResult = validateInstallmentSettlement(8000000, targetInstallments);
    assert.equal(exactResult.success, true);
    assert.equal(exactResult.allocated, 8000000);

    // Case C: Partial settlement (5,000,000 Rials)
    const partialResult = validateInstallmentSettlement(5000000, targetInstallments);
    assert.equal(partialResult.success, true);
    assert.equal(partialResult.allocated, 5000000);

    console.log('  ✅ TEST 6 PASSED: Overpayment validation guard correctly trapped overpayment attempt and allowed valid/partial settlements.\n');
    passedCount++;
  }

  console.log('======================================================================');
  console.log(`🎉 ALL ${passedCount}/6 MASTER INTEGRITY TESTS PASSED FLAWLESSLY!`);
  console.log('======================================================================');
}

runDoubleEntryTestSuite();
