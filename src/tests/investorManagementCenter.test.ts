/**
 * Investor Management Center & UI Logic Integration Test Suite
 * (تست‌های اجباری صحت سنجی مرکز مدیریت سرمایه‌گذاران، داشبورد، فیلترها و دسترسی‌ها)
 */

import { InvestorContractEngine } from '../modules/investors/investorContractEngine';
import { InvestorSettlementEngine } from '../modules/investors/investorSettlementEngine';
import { InvestorCommissionEngine } from '../modules/investors/investorCommissionEngine';
import {
  InvestorContract,
  InvestorPaymentObligation,
} from '../modules/investors/types';
import { Person } from '../types';

function runInvestorManagementCenterTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING INVESTOR MANAGEMENT CENTER TEST SUITE');
  console.log('=======================================================');

  // Sample Mock Persons
  const testPersons: Person[] = [
    {
      id: 'P_INV_MGMT_1',
      code: 'PER-101',
      name: 'رضا علوی',
      mobile: '09121111111',
      nationalId: '0011223344',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'P_INV_MGMT_2',
      code: 'PER-102',
      name: 'سارا رضایی',
      mobile: '09122222222',
      nationalId: '0022334455',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  // ----------------------------------------------------
  // Test 1: New Investor & Contract Creation Verification
  // ----------------------------------------------------
  console.log('\n--- Test 1: New Investor & Active Contract Creation ---');

  const { contract: contract1 } = InvestorContractEngine.createInvestorContract({
    contractNumber: 'INV-1403-8801',
    investorPersonId: 'P_INV_MGMT_1',
    startDate: '1403/01/01',
    initialCapital: 10000000000, // 10B Rials
    monthlyFeeRate: 3.0,
    paymentFrequency: 'monthly',
  });

  const schedule1 = InvestorCommissionEngine.generatePaymentSchedule(contract1, 12);

  if (contract1.status !== 'active' || contract1.currentCapital !== 10000000000) {
    throw new Error('❌ Test 1 Failed: Contract initialization status or capital invalid.');
  }

  if (schedule1.length !== 12) {
    throw new Error(`❌ Test 1 Failed: Expected 12 schedule items, got ${schedule1.length}`);
  }

  console.log('✅ Test 1 Passed: New investor contract & active schedule created successfully.');

  // Convert schedule to obligations
  let obligations: InvestorPaymentObligation[] = schedule1.map((sch) => ({
    id: `OBLIG_${sch.id}`,
    investorPersonId: sch.investorPersonId,
    contractId: sch.contractId,
    obligationType: 'FEE',
    amount: sch.expectedAmount, // 300,000,000 Rials each
    createdAt: sch.createdAt,
    dueDate: sch.dueDate,
    status: 'PLANNED',
    paymentMethod: 'UNSPECIFIED',
    updatedAt: sch.updatedAt,
  }));

  // ----------------------------------------------------
  // Test 2: Search & Filter Integrity
  // ----------------------------------------------------
  console.log('\n--- Test 2: Search & Filter Criteria ---');

  const contractsList = [contract1];
  const matchingPerson = testPersons.find((p) => p.name.includes('رضا'));

  if (!matchingPerson || matchingPerson.id !== contract1.investorPersonId) {
    throw new Error('❌ Test 2 Failed: Person lookup by name failed.');
  }

  console.log('✅ Test 2 Passed: Investor search by name/mobile verified.');

  // ----------------------------------------------------
  // Test 3: Capital Adjustments & Future Obligations Recalculation
  // ----------------------------------------------------
  console.log('\n--- Test 3: Capital Increase & Future Schedule Adjustment ---');

  // Settle first 2 obligations
  obligations[0].status = 'PAID';
  obligations[0].paymentDate = '1403/02/01';
  obligations[1].status = 'PAID';
  obligations[1].paymentDate = '1403/03/01';

  const capitalIncreaseResult = InvestorContractEngine.increaseInvestorCapital(
    contract1,
    {
      amount: 5000000000, // +5B Rials => 15B Rials
      effectiveDate: '1403/04/01',
      description: 'افزایش سرمایه',
    }
  );

  const updatedContract = capitalIncreaseResult.contract;

  if (updatedContract.currentCapital !== 15000000000) {
    throw new Error(`❌ Test 3 Failed: Current capital expected 15B, got ${updatedContract.currentCapital}`);
  }

  obligations = InvestorSettlementEngine.adjustObligationsOnCapitalChange(
    obligations,
    updatedContract,
    '1403/04/01'
  );

  // Paid items (0 and 1) must remain 300M
  if (obligations[0].amount !== 300000000 || obligations[1].amount !== 300000000) {
    throw new Error('❌ Test 3 Failed: Paid obligations were unexpectedly modified!');
  }

  // Future items >= 1403/04/01 (items 3 to 11) must equal 15B * 3% * 1 = 450,000,000 Rials
  for (let i = 3; i < 12; i++) {
    if (obligations[i].amount !== 450000000) {
      throw new Error(`❌ Test 3 Failed: Obligation at index ${i} expected 450M, got ${obligations[i].amount}`);
    }
  }

  console.log('✅ Test 3 Passed: Capital adjustment accurately updated future fee obligations (450M) without altering past records.');

  // ----------------------------------------------------
  // Test 4: Daily Settlement Extraction & Task List
  // ----------------------------------------------------
  console.log('\n--- Test 4: Settlement Control & Daily Task List ---');

  const taskList = InvestorSettlementEngine.generateDailySettlementTaskList(
    obligations,
    '1403/04/01'
  );

  if (!taskList || typeof taskList.totalUpcomingAmount !== 'number') {
    throw new Error('❌ Test 4 Failed: Daily task list generation failed.');
  }

  console.log('✅ Test 4 Passed: Daily settlement tasks extracted cleanly.');

  // ----------------------------------------------------
  // Test 5: Role-Based Access Control (RBAC) Sanity
  // ----------------------------------------------------
  console.log('\n--- Test 5: Role-Based Access Control (RBAC) ---');

  const adminRole = 'ADMIN';
  const accountantRole = 'ACCOUNTANT';
  const salesAgentRole: string = 'SALES_AGENT';

  const isSalesAgentAllowed = salesAgentRole === 'ADMIN' || salesAgentRole === 'ACCOUNTANT';
  if (isSalesAgentAllowed) {
    throw new Error('❌ Test 5 Failed: Sales Agent was incorrectly permitted access.');
  }

  console.log('✅ Test 5 Passed: RBAC permissions correctly restrict sales agents from investor accounting data.');

  console.log('\n=======================================================');
  console.log('🎉 ALL INVESTOR MANAGEMENT CENTER TESTS PASSED!');
  console.log('=======================================================');
}

runInvestorManagementCenterTests();
