/**
 * Investor Contract Lifecycle Engine Regression & Verification Tests
 * (تست‌های جامع موتور چرخه عمر قرارداد سرمایه‌گذاری)
 */

import { InvestorContractEngine } from '../modules/investors/investorContractEngine';
import { InvestorContract } from '../modules/investors/types';

function runInvestorContractEngineTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING INVESTOR CONTRACT ENGINE TEST SUITE');
  console.log('=======================================================');

  // ----------------------------------------------------
  // Test 1: Create Investor Contract
  // ----------------------------------------------------
  console.log('\n--- Test 1: Creating New Investor Contract ---');
  
  const { contract: c1, event: e1 } = InvestorContractEngine.createInvestorContract({
    investorPersonId: 'P_INV_9001',
    initialCapital: 10000000000, // 10 Billion Rials
    startDate: '1403/01/01',
    endDate: '1404/01/01',
    monthlyFeeRate: 3.0, // 3% monthly
    paymentFrequency: 'monthly',
    createdBy: 'investor_manager',
  });

  if (c1.initialCapital !== 10000000000 || c1.currentCapital !== 10000000000) {
    throw new Error('❌ Test 1 Failed: Capital amount mismatch.');
  }
  if (c1.monthlyFeeRate !== 3.0 || c1.status !== 'active') {
    throw new Error('❌ Test 1 Failed: Fee rate or status mismatch.');
  }
  if (e1.eventType !== 'contract_created' || e1.contractId !== c1.id) {
    throw new Error('❌ Test 1 Failed: Event creation mismatch.');
  }
  console.log('✅ Test 1 Passed: Contract created successfully with valid initial state and event.');

  // ----------------------------------------------------
  // Test 2: Increase Capital
  // ----------------------------------------------------
  console.log('\n--- Test 2: Increasing Investor Capital ---');

  const { contract: c2, event: e2 } = InvestorContractEngine.increaseInvestorCapital(c1, {
    amount: 5000000000, // +5 Billion Rials
    effectiveDate: '1403/04/01',
    description: 'افزایش سرمایه مرحله دوم',
    changedBy: 'financial_controller',
  });

  if (c2.currentCapital !== 15000000000) {
    throw new Error(`❌ Test 2 Failed: Capital expected 15,000,000,000 but got ${c2.currentCapital}`);
  }
  if (c2.initialCapital !== 10000000000) {
    throw new Error('❌ Test 2 Failed: Initial capital altered during increase.');
  }
  if (c2.changeLogs?.length !== 2) {
    throw new Error('❌ Test 2 Failed: Change log count expected 2.');
  }
  if (e2.eventType !== 'capital_increased' || e2.payload.addedAmount !== 5000000000) {
    throw new Error('❌ Test 2 Failed: Capital increase event payload invalid.');
  }
  console.log('✅ Test 2 Passed: Capital increased cleanly with historical log.');

  // ----------------------------------------------------
  // Test 3: Decrease Capital & Over-reduction Protection
  // ----------------------------------------------------
  console.log('\n--- Test 3: Decreasing Investor Capital & Safety Guard ---');

  const { contract: c3, event: e3 } = InvestorContractEngine.decreaseInvestorCapital(c2, {
    amount: 3000000000, // -3 Billion Rials
    effectiveDate: '1403/07/01',
    description: 'برداشت بخشی از اصل سرمایه',
    changedBy: 'financial_controller',
  });

  if (c3.currentCapital !== 12000000000) {
    throw new Error(`❌ Test 3 Failed: Capital expected 12,000,000,000 but got ${c3.currentCapital}`);
  }
  if (e3.eventType !== 'capital_decreased') {
    throw new Error('❌ Test 3 Failed: Capital decrease event type mismatch.');
  }

  // Verify Over-reduction Guard
  let overReductionErrorThrown = false;
  try {
    InvestorContractEngine.decreaseInvestorCapital(c3, {
      amount: 20000000000, // Exceeds 12 Billion Rials
      effectiveDate: '1403/08/01',
      description: 'کاهش بیش از حد',
    });
  } catch (err: any) {
    overReductionErrorThrown = true;
    console.log(`   (Caught expected safety error: "${err.message}")`);
  }

  if (!overReductionErrorThrown) {
    throw new Error('❌ Test 3 Failed: Over-reduction guard failed to throw error.');
  }

  console.log('✅ Test 3 Passed: Capital decrease and over-reduction safety guard verified.');

  // ----------------------------------------------------
  // Test 4: Rate Change & History Audit Trail
  // ----------------------------------------------------
  console.log('\n--- Test 4: Changing Monthly Fee Rate & Audit Trail ---');

  const { contract: c4, event: e4 } = InvestorContractEngine.changeInvestorRate(c3, {
    newRate: 3.5, // 3.5%
    effectiveDate: '1403/09/01',
    reason: 'توافق جدید بر سر بازدهی نیمه دوم سال',
    changedBy: 'investor_manager',
  });

  if (c4.monthlyFeeRate !== 3.5) {
    throw new Error('❌ Test 4 Failed: Fee rate was not updated.');
  }
  if (c4.history?.length !== 1 || c4.history[0].previousRate !== 3.0 || c4.history[0].newRate !== 3.5) {
    throw new Error('❌ Test 4 Failed: Rate history was not preserved correctly.');
  }
  if (e4.eventType !== 'rate_changed' || e4.payload.previousRate !== 3.0) {
    throw new Error('❌ Test 4 Failed: Rate change event payload invalid.');
  }

  console.log('✅ Test 4 Passed: Fee rate changed with preserved historical rate record.');

  // ----------------------------------------------------
  // Test 5: Contract Status Update & Termination
  // ----------------------------------------------------
  console.log('\n--- Test 5: Updating Status & Contract Termination ---');

  const { contract: c5, event: e5 } = InvestorContractEngine.updateContractStatus(c4, {
    newStatus: 'terminated',
    reason: 'تسویه کامل با سرمایه‌گذار در پایان دوره',
    changedBy: 'general_manager',
  });

  if (c5.status !== 'terminated') {
    throw new Error('❌ Test 5 Failed: Status update failed.');
  }
  if (e5.eventType !== 'contract_terminated') {
    throw new Error('❌ Test 5 Failed: Termination event type mismatch.');
  }

  // Ensure inactive contract prevents capital adjustments
  let inactiveAdjustmentBlocked = false;
  try {
    InvestorContractEngine.increaseInvestorCapital(c5, {
      amount: 1000000000,
      effectiveDate: '1403/10/01',
      description: 'افزایش روی قرارداد فسخ شده',
    });
  } catch (err: any) {
    inactiveAdjustmentBlocked = true;
  }

  if (!inactiveAdjustmentBlocked) {
    throw new Error('❌ Test 5 Failed: Operations on terminated contract were not blocked.');
  }

  console.log('✅ Test 5 Passed: Status transitions and terminated contract guards verified.');

  console.log('\n=======================================================');
  console.log('🎉 ALL INVESTOR CONTRACT ENGINE TESTS PASSED!');
  console.log('=======================================================');
}

runInvestorContractEngineTests();
