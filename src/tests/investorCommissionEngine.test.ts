/**
 * Investor Commission Calculation & Schedule Engine Regression Tests
 * (تست‌های جامع موتور محاسبه کارمزد و زمان‌بندی پرداخت سرمایه‌گذاران)
 */

import { InvestorCommissionEngine } from '../modules/investors/investorCommissionEngine';
import { InvestorContract, InvestorPaymentSchedule } from '../modules/investors/types';

function runInvestorCommissionEngineTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING INVESTOR COMMISSION ENGINE TEST SUITE');
  console.log('=======================================================');

  // ----------------------------------------------------
  // Test 1: Periodic Commission Calculation across Frequencies
  // ----------------------------------------------------
  console.log('\n--- Test 1: Periodic Commission Calculation across Frequencies ---');

  const capital = 10000000000; // 10 Billion Rials
  const monthlyRate = 3.0; // 3% per month

  // Monthly
  const monthlyRes = InvestorCommissionEngine.calculateInvestorCommission(capital, monthlyRate, 'monthly');
  if (monthlyRes.expectedAmount !== 300000000) { // 10B * 3% * 1 = 300M
    throw new Error(`❌ Test 1 Failed (monthly): expected 300,000,000 but got ${monthlyRes.expectedAmount}`);
  }

  // Quarterly
  const quarterlyRes = InvestorCommissionEngine.calculateInvestorCommission(capital, monthlyRate, 'quarterly');
  if (quarterlyRes.expectedAmount !== 900000000) { // 10B * 3% * 3 = 900M
    throw new Error(`❌ Test 1 Failed (quarterly): expected 900,000,000 but got ${quarterlyRes.expectedAmount}`);
  }

  // Semi-Annual
  const semiAnnualRes = InvestorCommissionEngine.calculateInvestorCommission(capital, monthlyRate, 'semi_annual');
  if (semiAnnualRes.expectedAmount !== 1800000000) { // 10B * 3% * 6 = 1.8B
    throw new Error(`❌ Test 1 Failed (semi_annual): expected 1,800,000,000 but got ${semiAnnualRes.expectedAmount}`);
  }

  // Annual
  const annualRes = InvestorCommissionEngine.calculateInvestorCommission(capital, monthlyRate, 'annual');
  if (annualRes.expectedAmount !== 3600000000) { // 10B * 3% * 12 = 3.6B
    throw new Error(`❌ Test 1 Failed (annual): expected 3,600,000,000 but got ${annualRes.expectedAmount}`);
  }

  console.log('✅ Test 1 Passed: All frequency commission calculations verified accurately.');

  // ----------------------------------------------------
  // Test 2: Generate Payment Schedule for 12-Month Contract
  // ----------------------------------------------------
  console.log('\n--- Test 2: Schedule Generation for Monthly & Quarterly Contracts ---');

  const dummyContract: InvestorContract = {
    id: 'CTR_TEST_001',
    contractNumber: 'INV-1403-001',
    investorPersonId: 'P_INV_1',
    startDate: '1403/01/01',
    endDate: '1404/01/01',
    initialCapital: 10000000000,
    currentCapital: 10000000000,
    monthlyFeeRate: 3.0,
    paymentFrequency: 'monthly',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const monthlySchedule = InvestorCommissionEngine.generatePaymentSchedule(dummyContract, 12);
  if (monthlySchedule.length !== 12) {
    throw new Error(`❌ Test 2 Failed: Expected 12 schedule items for monthly contract, got ${monthlySchedule.length}`);
  }
  if (monthlySchedule[0].dueDate !== '1403/02/01' || monthlySchedule[11].dueDate !== '1404/01/01') {
    throw new Error(`❌ Test 2 Failed: Due dates incorrect. First: ${monthlySchedule[0].dueDate}, Last: ${monthlySchedule[11].dueDate}`);
  }

  // Quarterly
  const quarterlyContract: InvestorContract = {
    ...dummyContract,
    paymentFrequency: 'quarterly',
  };
  const quarterlySchedule = InvestorCommissionEngine.generatePaymentSchedule(quarterlyContract, 12);
  if (quarterlySchedule.length !== 4) {
    throw new Error(`❌ Test 2 Failed: Expected 4 schedule items for quarterly contract, got ${quarterlySchedule.length}`);
  }
  if (quarterlySchedule[0].expectedAmount !== 900000000) {
    throw new Error(`❌ Test 2 Failed: Quarterly expected amount invalid.`);
  }

  console.log('✅ Test 2 Passed: Schedule generation for monthly and quarterly contracts verified.');

  // ----------------------------------------------------
  // Test 3: Mid-Contract Capital Increase recalculation
  // ----------------------------------------------------
  console.log('\n--- Test 3: Mid-Contract Capital Increase & Recalculation ---');

  // Mark first 3 months as PAID
  const schedules: InvestorPaymentSchedule[] = monthlySchedule.map((item, idx) => {
    if (idx < 3) {
      return { ...item, status: 'PAID' as const };
    }
    return item;
  });

  // Capital increases from 10B to 15B at month 4 (1403/04/01)
  const updatedContract: InvestorContract = {
    ...dummyContract,
    currentCapital: 15000000000,
  };

  const recalculatedSchedules = InvestorCommissionEngine.recalculateFutureSchedule(
    schedules,
    updatedContract,
    '1403/04/01'
  );

  // Past 3 schedules must remain 300,000,000 and status PAID
  for (let i = 0; i < 3; i++) {
    if (recalculatedSchedules[i].expectedAmount !== 300000000 || recalculatedSchedules[i].status !== 'PAID') {
      throw new Error(`❌ Test 3 Failed: Historical schedule at index ${i} was modified!`);
    }
  }

  // Future schedules (index 3 and beyond) must equal 15B * 3% * 1 = 450,000,000
  for (let i = 3; i < 12; i++) {
    if (recalculatedSchedules[i].expectedAmount !== 450000000) {
      throw new Error(`❌ Test 3 Failed: Future schedule at index ${i} expected 450,000,000 but got ${recalculatedSchedules[i].expectedAmount}`);
    }
  }

  console.log('✅ Test 3 Passed: Mid-contract capital increase preserved past schedules and updated future ones.');

  // ----------------------------------------------------
  // Test 4: Mid-Contract Rate Change recalculation
  // ----------------------------------------------------
  console.log('\n--- Test 4: Mid-Contract Fee Rate Change Recalculation ---');

  // Rate changes from 3.0% to 3.5% at month 7 (1403/07/01)
  const rateUpdatedContract: InvestorContract = {
    ...updatedContract,
    monthlyFeeRate: 3.5,
  };

  const rateRecalculatedSchedules = InvestorCommissionEngine.recalculateFutureSchedule(
    recalculatedSchedules,
    rateUpdatedContract,
    '1403/07/01'
  );

  // Schedules 0..2 are still 300M (PAID)
  // Schedules 3..4 are still 450M (due dates 1403/05/01, 1403/06/01 with Capital=15B, Rate=3.0%)
  // Schedules 5..11 (due dates >= 1403/07/01) should now be 15B * 3.5% * 1 = 525,000,000
  for (let i = 3; i < 5; i++) {
    if (rateRecalculatedSchedules[i].expectedAmount !== 450000000) {
      throw new Error(`❌ Test 4 Failed: Pre-rate change schedule modified at index ${i}`);
    }
  }
  for (let i = 5; i < 12; i++) {
    if (rateRecalculatedSchedules[i].expectedAmount !== 525000000) {
      throw new Error(`❌ Test 4 Failed: Post-rate change schedule at index ${i} expected 525,000,000 but got ${rateRecalculatedSchedules[i].expectedAmount}`);
    }
  }

  console.log('✅ Test 4 Passed: Mid-contract fee rate change preserved historical schedules accurately.');

  console.log('\n=======================================================');
  console.log('🎉 ALL INVESTOR COMMISSION ENGINE TESTS PASSED!');
  console.log('=======================================================');
}

runInvestorCommissionEngineTests();
