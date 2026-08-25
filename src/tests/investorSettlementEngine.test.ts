/**
 * Investor Obligation & Settlement Engine Regression Test Suite
 * (تست‌های جامع لایه مدیریت تعهدات، سررسیدها و پرداخت‌های سرمایه‌گذاران)
 */

import { InvestorSettlementEngine } from '../modules/investors/investorSettlementEngine';
import { InvestorCommissionEngine } from '../modules/investors/investorCommissionEngine';
import { InvestorContract, InvestorPaymentObligation } from '../modules/investors/types';

function runInvestorSettlementEngineTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING INVESTOR SETTLEMENT ENGINE TEST SUITE');
  console.log('=======================================================');

  const testContract: InvestorContract = {
    id: 'CTR_OBLIG_1001',
    contractNumber: 'INV-1403-900',
    investorPersonId: 'P_OBLIG_INV_1',
    startDate: '1403/01/01',
    endDate: '1404/01/01',
    initialCapital: 10000000000, // 10 Billion Rials
    currentCapital: 10000000000,
    monthlyFeeRate: 3.0, // 3% monthly
    paymentFrequency: 'monthly',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // ----------------------------------------------------
  // Test 1 & 2: Generate 1-Year Contract with 12 Payment Obligations
  // ----------------------------------------------------
  console.log('\n--- Test 1 & 2: 12-Month Obligations Generation ---');

  const scheduleItems = InvestorCommissionEngine.generatePaymentSchedule(testContract, 12);
  let obligations: InvestorPaymentObligation[] = scheduleItems.map((sch) => ({
    id: `OBLIG_${sch.id}`,
    investorPersonId: sch.investorPersonId,
    contractId: sch.contractId,
    obligationType: 'FEE',
    amount: sch.expectedAmount, // 300,000,000
    createdAt: sch.createdAt,
    dueDate: sch.dueDate,
    status: 'PLANNED',
    paymentMethod: 'UNSPECIFIED',
    updatedAt: sch.updatedAt,
  }));

  if (obligations.length !== 12) {
    throw new Error(`❌ Test 1/2 Failed: Expected 12 obligations, got ${obligations.length}`);
  }

  // Monthly expected fee: 10B * 3% * 1 = 300M
  obligations.forEach((item, idx) => {
    if (item.amount !== 300000000) {
      throw new Error(`❌ Test 1/2 Failed: Obligation amount at index ${idx} expected 300,000,000 but got ${item.amount}`);
    }
  });

  console.log('✅ Test 1 & 2 Passed: 12 future payment obligations created cleanly (300,000,000 Rials each).');

  // ----------------------------------------------------
  // Test 3: Capital Reduction in Month 6 (from 10B to 6B Rials)
  // ----------------------------------------------------
  console.log('\n--- Test 3: Capital Reduction in Month 6 & Future Obligations Adjustment ---');

  // Mark first 5 months as PAID
  for (let i = 0; i < 5; i++) {
    obligations[i].status = 'PAID';
    obligations[i].paymentDate = obligations[i].dueDate;
  }

  const reducedContract: InvestorContract = {
    ...testContract,
    currentCapital: 6000000000, // Reduced to 6 Billion
  };

  // Capital reduction effective at 1403/07/01 (Month 6)
  obligations = InvestorSettlementEngine.adjustObligationsOnCapitalChange(
    obligations,
    reducedContract,
    '1403/07/01'
  );

  // Months 0..4 (PAID) must remain 300M
  for (let i = 0; i < 5; i++) {
    if (obligations[i].amount !== 300000000 || obligations[i].status !== 'PAID') {
      throw new Error(`❌ Test 3 Failed: Historical obligation at index ${i} was altered!`);
    }
  }

  // Month 5 onwards (due dates >= 1403/07/01) must equal 6B * 3% * 1 = 180,000,000
  for (let i = 5; i < 12; i++) {
    if (obligations[i].amount !== 180000000 || obligations[i].status !== 'ADJUSTED') {
      throw new Error(`❌ Test 3 Failed: Future obligation at index ${i} expected 180,000,000 (ADJUSTED) but got ${obligations[i].amount} (${obligations[i].status})`);
    }
  }

  console.log('✅ Test 3 Passed: Capital decrease correctly adjusted future obligations (180M Rials) preserving past paid ones.');

  // ----------------------------------------------------
  // Test 4: Capital Increase in Month 9 (from 6B to 12B Rials)
  // ----------------------------------------------------
  console.log('\n--- Test 4: Capital Increase in Month 9 & Recalculation ---');

  // Mark months 5 to 7 as PAID with 180M
  for (let i = 5; i <= 7; i++) {
    obligations[i].status = 'PAID';
  }

  const increasedContract: InvestorContract = {
    ...reducedContract,
    currentCapital: 12000000000, // Increased to 12 Billion
  };

  // Capital increase effective at 1403/10/01 (Month 9)
  obligations = InvestorSettlementEngine.adjustObligationsOnCapitalChange(
    obligations,
    increasedContract,
    '1403/10/01'
  );

  // Months 0..4 = 300M (PAID)
  // Months 5..7 = 180M (PAID)
  // Months 8..11 = 12B * 3% * 1 = 360,000,000
  for (let i = 8; i < 12; i++) {
    if (obligations[i].amount !== 360000000) {
      throw new Error(`❌ Test 4 Failed: Post-increase obligation at index ${i} expected 360,000,000 but got ${obligations[i].amount}`);
    }
  }

  console.log('✅ Test 4 Passed: Capital increase correctly recalculated future obligations to 360M Rials.');

  // ----------------------------------------------------
  // Test 5: Linking Issued Check to Fee Obligation (Accrual Principle)
  // ----------------------------------------------------
  console.log('\n--- Test 5: Linking Issued Check to Fee Obligation (Accrual Guard) ---');

  const targetObligation = obligations[8]; // Due date 1403/10/01
  const linkedObligation = InvestorSettlementEngine.linkIssuedCheckToObligation(
    targetObligation,
    {
      checkId: 'CHK_99001',
      checkNumber: '778811',
      checkDueDate: '1403/10/01',
      bankName: 'بانک ملی',
    }
  );

  if (linkedObligation.paymentMethod !== 'CHECK' || linkedObligation.checkNumber !== '778811') {
    throw new Error('❌ Test 5 Failed: Check details not linked cleanly.');
  }

  // Accrual guard: Status MUST NOT automatically become PAID on check linking day
  if (linkedObligation.status === 'PAID') {
    throw new Error('❌ Test 5 Failed Accrual Rule: Check linking prematurely marked obligation as PAID!');
  }

  console.log('✅ Test 5 Passed: Check linked cleanly without premature status change (Accrual Principle maintained).');

  // ----------------------------------------------------
  // Test 6: Bank Settlement & Duplicate Settlement Guard
  // ----------------------------------------------------
  console.log('\n--- Test 6: Bank Settlement & Duplicate Settlement Guard ---');

  const settlementResult = InvestorSettlementEngine.registerBankSettlement(
    linkedObligation,
    {
      paymentDate: '1403/10/01',
      bankName: 'بانک پاسارگاد',
      trackingNumber: 'TRK_770192',
      destinationAccount: 'IR660570000000000000000001',
    }
  );

  const settledObligation = settlementResult.updatedObligation;
  if (settledObligation.status !== 'PAID' || settledObligation.bankDetails?.trackingNumber !== 'TRK_770192') {
    throw new Error('❌ Test 6 Failed: Bank settlement registration failed.');
  }

  // Attempt duplicate settlement on settled obligation
  try {
    InvestorSettlementEngine.registerBankSettlement(settledObligation, {
      paymentDate: '1403/10/02',
      trackingNumber: 'TRK_DUP_999',
    });
    throw new Error('❌ Test 6 Failed: Duplicate settlement was allowed!');
  } catch (err: any) {
    if (!err.message.includes('قبلاً') && !err.message.includes('تسویه شده است')) {
      throw err;
    }
    console.log('  (Caught expected error blocking duplicate settlement: ' + err.message + ')');
  }

  console.log('✅ Test 6 Passed: Bank settlement recorded & duplicate settlement guard verified.');

  // ----------------------------------------------------
  // Test 7: Daily Task List Extraction
  // ----------------------------------------------------
  console.log('\n--- Test 7: Daily Settlement Task List Extraction ---');

  const taskList = InvestorSettlementEngine.generateDailySettlementTaskList(obligations, '1403/11/01');
  if (!taskList.reportDate) {
    throw new Error('❌ Test 7 Failed: Task list report date missing.');
  }

  console.log('✅ Test 7 Passed: Daily settlement task list generated successfully.');

  console.log('\n=======================================================');
  console.log('🎉 ALL INVESTOR SETTLEMENT ENGINE TESTS PASSED!');
  console.log('=======================================================');
}

runInvestorSettlementEngineTests();
