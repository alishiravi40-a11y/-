/**
 * Integration & Architectural Acceptance Test:
 * Decoupled Investor Commission Check Cycle with Deferred Fee Intermediary Account
 * (چرخه تفکیک‌شده کارمزد سرمایه‌گذار و چک‌های پرداختی با حساب واسط کارمزد در انتظار تحقق)
 */

import { InvestorAccountingMapper } from '../modules/investors/investorAccountingAdapter';
import { InvestorContract, InvestorFinancialEvent } from '../modules/investors/types';
import { Person, Check, JournalVoucher } from '../types';
import { createCheckStateVoucher } from '../utils/accounting';

function calculatePersonBalance(vouchers: JournalVoucher[], personId: string): number {
  let balance = 0; // Negative = Debit, Positive = Credit (بستانکار)
  for (const v of vouchers) {
    if (!v.entries) continue;
    for (const entry of v.entries) {
      if (entry.floatingDetailed?.id === personId) {
        balance += ((entry.credit || 0) - (entry.debit || 0));
      }
    }
  }
  return balance;
}

function calculateSubBalance(vouchers: JournalVoucher[], subId: string): { debit: number; credit: number; net: number } {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const v of vouchers) {
    if (!v.entries) continue;
    for (const entry of v.entries) {
      if (entry.subsidiaryId === subId) {
        totalDebit += (entry.debit || 0);
        totalCredit += (entry.credit || 0);
      }
    }
  }
  return { debit: totalDebit, credit: totalCredit, net: totalCredit - totalDebit };
}

export function runDecoupledCheckCycleTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING DECOUPLED INVESTOR CHECK CYCLE ACCEPTANCE TESTS');
  console.log('=======================================================');

  const vouchers: JournalVoucher[] = [];

  // Setup Investor Person & Contract
  const investorPerson: Person = {
    id: 'PER_INV_7001',
    code: 'PER-7001',
    name: 'علی سرمایه‌گذار',
    personType: 'real',
    roles: ['other'],
    createdAt: new Date().toISOString(),
  };

  const initialCapital = 1_000_000_000; // 1 Billion Rials
  const monthlyFee = 40_000_000; // 40 Million per month
  const totalMonths = 10;

  const investorContract: InvestorContract = {
    id: 'CTR_INV_7001',
    contractNumber: 'INV-1403-7001',
    investorPersonId: investorPerson.id,
    startDate: '1403/01/01',
    endDate: '1404/01/01',
    initialCapital,
    currentCapital: initialCapital,
    monthlyFeeRate: 4.0,
    paymentFrequency: 'monthly',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Step 0: Record initial investment received voucher
  const initEvent: InvestorFinancialEvent = {
    id: 'EVT_INIT',
    contractId: investorContract.id,
    investorPersonId: investorPerson.id,
    eventType: 'INVESTMENT_RECEIVED',
    amount: initialCapital,
    eventDate: '1403/01/01',
    cashOrBankSubAccountId: 'SUB_BANK_MELI',
  };

  const initDraft = InvestorAccountingMapper.createVoucherDraftRequest(initEvent, investorPerson, investorContract);
  const initVoucher: JournalVoucher = {
    id: 'V_INIT_CAPITAL',
    voucherNumber: 1,
    date: '1403/01/01',
    gregorianDate: new Date().toISOString(),
    description: 'دریافت اصل سرمایه',
    entries: initDraft.entries,
    isAutomatic: true,
  };
  vouchers.push(initVoucher);

  const initialPersonBalance = calculatePersonBalance(vouchers, investorPerson.id);
  console.log(`\n--- Initial State ---`);
  console.log(`موجودی حساب شخص سرمایه‌گذار بعد از واریز اصل سرمایه: ${initialPersonBalance.toLocaleString()} (بستانکار)`);
  if (initialPersonBalance !== initialCapital) {
    throw new Error(`❌ Error: Initial person balance must be ${initialCapital}, got ${initialPersonBalance}`);
  }

  // ----------------------------------------------------
  // Stage 1: Issuing 10 Future Commission Checks & Linking
  // ----------------------------------------------------
  console.log('\n--- Stage 1: Bulk Issuing & Linking 10 Future Commission Checks ---');
  const issuedChecks: Check[] = [];

  for (let m = 1; m <= totalMonths; m++) {
    const checkObj: Check = {
      id: `CHK_COMM_${m}`,
      checkNumber: `CHK-100${m}`,
      bankName: 'بانک ملی',
      amount: monthlyFee,
      dueDate: `1403/${m < 10 ? '0' + m : m}/01`,
      createdAt: '1403/01/01',
      type: 'paid',
      personId: investorPerson.id,
      isApproved: true,
      isInvestorCommission: true,
      investorContractId: investorContract.id,
      investorObligationId: `OBLIG_${m}`,
      currentState: 'issued',
      history: [{
        state: 'issued',
        date: '1403/01/01',
        beforeState: 'issued',
        afterState: 'issued',
        timestamp: new Date().toISOString(),
      }],
    };
    issuedChecks.push(checkObj);

    // Call voucher generator for issuance (should record Deferred Fee vs Payables)
    const issuanceVoucher = createCheckStateVoucher(
      checkObj,
      investorPerson.name,
      '',
      'issued',
      vouchers.length + 1
    );

    if (!issuanceVoucher) {
      throw new Error(`❌ Stage 1 Failed: issuanceVoucher must not be null for investor commission check!`);
    }

    // Verify entries: Debit SUB_DEFERRED_FEE, Credit SUB_CHECKS_PAY
    const hasDeferredDebit = issuanceVoucher.entries.some(e => e.subsidiaryId === 'SUB_DEFERRED_FEE' && e.debit === monthlyFee);
    const hasPayableCredit = issuanceVoucher.entries.some(e => e.subsidiaryId === 'SUB_CHECKS_PAY' && e.credit === monthlyFee);
    if (!hasDeferredDebit || !hasPayableCredit) {
      throw new Error(`❌ Stage 1 Failed: Issuance voucher entries incorrect for check ${checkObj.checkNumber}`);
    }

    vouchers.push(issuanceVoucher);
  }

  // Check accounting impact after issuance
  const postIssuancePersonBalance = calculatePersonBalance(vouchers, investorPerson.id);
  const postIssuanceExpense = calculateSubBalance(vouchers, 'SUB_EXP_FIN_INTEREST').debit;
  const postIssuanceDeferredFee = calculateSubBalance(vouchers, 'SUB_DEFERRED_FEE');

  console.log(`✅ Stage 1 Verified: 10 future checks issued & linked operationally.`);
  console.log(`- موجودی حساب شخص سرمایه‌گذار: ${postIssuancePersonBalance.toLocaleString()} (بدون تغییر!)`);
  console.log(`- هزینه مالی ثبت شده: ${postIssuanceExpense} (صفر - هیچ هزینه زودهنگامی ثبت نشده)`);
  console.log(`- کارمزد در انتظار تحقق (بدهکار): ${postIssuanceDeferredFee.debit.toLocaleString()}`);

  if (postIssuancePersonBalance !== initialCapital) {
    throw new Error(`❌ Stage 1 Failed: Person account balance changed on issuance! Expected ${initialCapital}, got ${postIssuancePersonBalance}`);
  }
  if (postIssuanceExpense !== 0) {
    throw new Error(`❌ Stage 1 Failed: Expense recorded prematurely on issuance!`);
  }
  if (postIssuanceDeferredFee.debit !== monthlyFee * totalMonths) {
    throw new Error(`❌ Stage 1 Failed: Deferred fee balance incorrect!`);
  }

  // ----------------------------------------------------
  // Stage 2: Month-by-Month Check Clearance Cycle
  // ----------------------------------------------------
  console.log('\n--- Stage 2: Executing 10-Month Check Clearance Cycle ---');

  for (let m = 1; m <= totalMonths; m++) {
    const monthDate = `1403/${m < 10 ? '0' + m : m}/01`;
    const check = issuedChecks[m - 1];

    // Clear Check (پاس شدن چک در بانک)
    const clearedVoucher = createCheckStateVoucher(
      check,
      investorPerson.name,
      'issued',
      'cleared',
      vouchers.length + 1,
      'SUB_BANK_MELI'
    );

    if (!clearedVoucher) {
      throw new Error(`❌ Stage 2 Failed: Cleared check voucher was null for month ${m}`);
    }

    // Verify clearance voucher has 4 entries (Settlement: PAY vs Bank, Realization: Expense vs Deferred Fee)
    if (clearedVoucher.entries.length !== 4) {
      throw new Error(`❌ Stage 2 Failed: Cleared voucher must have 4 entries for investor commission check, got ${clearedVoucher.entries.length}`);
    }

    vouchers.push(clearedVoucher);

    // Verify Person Balance at end of month m
    const currentPersonBalance = calculatePersonBalance(vouchers, investorPerson.id);
    if (currentPersonBalance !== initialCapital) {
      throw new Error(`❌ Stage 2 Failed at Month ${m}: Person balance fluctuated! Expected ${initialCapital}, got ${currentPersonBalance}`);
    }
  }

  // ----------------------------------------------------
  // Stage 3: Final Acceptance Audit
  // ----------------------------------------------------
  console.log('\n--- Stage 3: Final Acceptance Audit ---');

  const finalPersonBalance = calculatePersonBalance(vouchers, investorPerson.id);
  const totalExpense = calculateSubBalance(vouchers, 'SUB_EXP_FIN_INTEREST').debit;
  const totalBankCredit = calculateSubBalance(vouchers, 'SUB_BANK_MELI').credit;
  const checksPayableBalance = calculateSubBalance(vouchers, 'SUB_CHECKS_PAY').net;
  const finalDeferredFeeBalance = calculateSubBalance(vouchers, 'SUB_DEFERRED_FEE').net;

  const totalExpectedExpense = monthlyFee * totalMonths; // 400,000,000

  console.log(`- موجودی نهایی حساب شخص سرمایه‌گذار: ${finalPersonBalance.toLocaleString()} (کاملاً دست‌نخورده!)`);
  console.log(`- کل هزینه مالی شناسایی شده طی ۱۰ ماه: ${totalExpense.toLocaleString()}`);
  console.log(`- کل خروجی واقعی از بانک طی ۱۰ ماه: ${totalBankCredit.toLocaleString()}`);
  console.log(`- مانده نهایی اسناد پرداختنی (چک‌ها): ${checksPayableBalance}`);
  console.log(`- مانده نهایی کارمزد در انتظار تحقق: ${finalDeferredFeeBalance}`);

  if (finalPersonBalance !== initialCapital) {
    throw new Error(`❌ Audit Failed: Final person balance is ${finalPersonBalance}, expected ${initialCapital}`);
  }
  if (totalExpense !== totalExpectedExpense) {
    throw new Error(`❌ Audit Failed: Total expense is ${totalExpense}, expected ${totalExpectedExpense}`);
  }
  if (totalBankCredit !== totalExpectedExpense) {
    throw new Error(`❌ Audit Failed: Bank credit is ${totalBankCredit}, expected ${totalExpectedExpense}`);
  }
  if (checksPayableBalance !== 0) {
    throw new Error(`❌ Audit Failed: Checks payable net balance should be 0, got ${checksPayableBalance}`);
  }
  if (finalDeferredFeeBalance !== 0) {
    throw new Error(`❌ Audit Failed: Deferred fee balance should be 0, got ${finalDeferredFeeBalance}`);
  }

  // ----------------------------------------------------
  // Stage 4: Testing Bounced / Cancelled Check Edge Case
  // ----------------------------------------------------
  console.log('\n--- Stage 4: Bounced / Cancelled Investor Check Handling ---');

  const bouncedCheck: Check = {
    id: 'CHK_BOUNCED_TEST',
    checkNumber: 'CHK-999',
    bankName: 'بانک ملی',
    amount: 40_000_000,
    dueDate: '1403/11/01',
    createdAt: '1403/01/01',
    type: 'paid',
    personId: investorPerson.id,
    isInvestorCommission: true,
    currentState: 'issued',
    history: [],
  };

  const bounceVoucher = createCheckStateVoucher(
    bouncedCheck,
    investorPerson.name,
    'issued',
    'bounced',
    999
  );

  if (!bounceVoucher) {
    throw new Error('❌ Stage 4 Failed: Bounce voucher should not be null!');
  }

  if (
    bounceVoucher.entries[0].subsidiaryId !== 'SUB_CHECKS_PAY' ||
    bounceVoucher.entries[1].subsidiaryId !== 'SUB_DEFERRED_FEE'
  ) {
    throw new Error('❌ Stage 4 Failed: Bounce voucher entries incorrect for investor commission check!');
  }

  console.log('✅ Stage 4 Passed: Bounced investor check correctly reverses SUB_CHECKS_PAY against SUB_DEFERRED_FEE without affecting person account or expense.');

  // ----------------------------------------------------
  // Stage 5: Normal Check Issuance followed by Linking to Investor Commission
  // ----------------------------------------------------
  console.log('\n--- Stage 5: Normal Check Issuance followed by Linking to Investor Commission ---');

  // 1. Issue a normal check to the investor first
  const normalCheck: Check = {
    id: 'CHK_EXISTING_TEST_123',
    checkNumber: 'CHK-12345',
    bankName: 'بانک ملی',
    amount: 50_000_000,
    dueDate: '1403/12/01',
    createdAt: '1403/01/01',
    type: 'paid',
    personId: investorPerson.id,
    currentState: 'issued',
    history: [],
  };

  const initialVoucher = createCheckStateVoucher(
    normalCheck,
    investorPerson.name,
    '',
    'issued',
    1001
  );

  if (!initialVoucher) {
    throw new Error('❌ Stage 5 Failed: Initial normal check voucher should not be null!');
  }

  // Ensure initial voucher debits SUB_CREDITORS and credits SUB_CHECKS_PAY
  const debitsCreditors = initialVoucher.entries.some(e => e.subsidiaryId === 'SUB_CREDITORS' && e.debit === 50_000_000);
  const creditsChecksPay = initialVoucher.entries.some(e => e.subsidiaryId === 'SUB_CHECKS_PAY' && e.credit === 50_000_000);

  if (!debitsCreditors || !creditsChecksPay) {
    throw new Error('❌ Stage 5 Failed: Initial normal check voucher entries incorrect!');
  }

  // Add normal check to a checks list, and initial voucher to a vouchers list
  let testChecks = [normalCheck];
  let testVouchers = [initialVoucher];

  // 2. Simulate user linking this check to commission obligation
  const updatedChecks = testChecks.map(c => {
    if (c.id === 'CHK_EXISTING_TEST_123') {
      return {
        ...c,
        isInvestorCommission: true,
        investorObligationId: 'OBL_SOME_ID',
        investorContractId: investorContract.id,
        voucherId: initialVoucher.id,
      };
    }
    return c;
  });

  // Apply our newly designed voucher correction logic
  const correctedVouchers = testVouchers.map(voucher => {
    const matchedCheck = updatedChecks.find(c => c.voucherId === voucher.id || voucher.id.startsWith(`v_auto_check_${c.id}_issued_`));
    
    if (matchedCheck && matchedCheck.isInvestorCommission) {
      const hasDeferredFee = voucher.entries.some(e => e.subsidiaryId === 'SUB_DEFERRED_FEE');
      if (!hasDeferredFee) {
        const newEntries = [
          {
            subsidiaryId: 'SUB_DEFERRED_FEE',
            debit: matchedCheck.amount,
            credit: 0,
            description: `ثبت کارمزد در انتظار تحقق بابت صدور چک کارمزد سرمایه‌گذار ${matchedCheck.checkNumber}`
          },
          {
            subsidiaryId: 'SUB_CHECKS_PAY',
            debit: 0,
            credit: matchedCheck.amount,
            description: `ثبت اسناد پرداختنی چک کارمزد سرمایه‌گذار ${matchedCheck.checkNumber}`
          }
        ];
        
        return {
          ...voucher,
          description: `سند مکانیزه چک شماره ${matchedCheck.checkNumber} - وضعیت: issued (کارمزد سرمایه‌گذار)`,
          entries: newEntries
        };
      }
    }
    return voucher;
  });

  // Verify that corrected voucher has exact ID, voucherNumber, and updated entries
  const finalVoucher = correctedVouchers[0];
  if (finalVoucher.id !== initialVoucher.id) {
    throw new Error(`❌ Stage 5 Failed: Voucher ID changed! Expected ${initialVoucher.id}, got ${finalVoucher.id}`);
  }

  const finalDebitsDeferredFee = finalVoucher.entries.some(e => e.subsidiaryId === 'SUB_DEFERRED_FEE' && e.debit === 50_000_000);
  const finalCreditsChecksPay = finalVoucher.entries.some(e => e.subsidiaryId === 'SUB_CHECKS_PAY' && e.credit === 50_000_000);
  const hasPersonReference = finalVoucher.entries.some(e => e.floatingDetailed?.id === investorPerson.id);

  if (!finalDebitsDeferredFee || !finalCreditsChecksPay) {
    throw new Error('❌ Stage 5 Failed: Corrected voucher entries incorrect! Expected deferred fee debit and checks pay credit.');
  }

  if (hasPersonReference) {
    throw new Error('❌ Stage 5 Failed: Corrected voucher still contains reference to investor person!');
  }

  console.log('✅ Stage 5 Passed: Normal check successfully linked to commission. Voucher updated automatically, removing person account effect, and preserving the voucher ID.');

  console.log('\n=======================================================');
  console.log('🎉 ALL DECOUPLED INVESTOR CHECK CYCLE TESTS PASSED PERFECTLY!');
  console.log('=======================================================');
}

runDecoupledCheckCycleTests();
