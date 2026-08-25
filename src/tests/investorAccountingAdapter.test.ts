/**
 * Investor Accounting Adapter Integration & Safety Regression Tests
 * (تست‌های لایه لایه اتصال سرمایه‌گذاران به حسابداری)
 */

import { InvestorAccountingMapper } from '../modules/investors/investorAccountingAdapter';
import { InvestorContract, InvestorFinancialEvent } from '../modules/investors/types';
import { Person } from '../types';

function runInvestorAccountingAdapterTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING INVESTOR ACCOUNTING ADAPTER TEST SUITE');
  console.log('=======================================================');

  const testPerson: Person = {
    id: 'P_INV_5001',
    code: 'PER-5001',
    name: 'رضا سرمایه‌گذار',
    personType: 'real',
    roles: ['other'],
    createdAt: new Date().toISOString(),
  };

  const testContract: InvestorContract = {
    id: 'CTR_INV_5001',
    contractNumber: 'INV-1403-555',
    investorPersonId: testPerson.id,
    startDate: '1403/01/01',
    endDate: '1404/01/01',
    initialCapital: 2000000000, // 2 Billion Rials
    currentCapital: 2000000000,
    monthlyFeeRate: 3.5,
    paymentFrequency: 'monthly',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // ----------------------------------------------------
  // Test 1: INVESTMENT_RECEIVED Mapping
  // ----------------------------------------------------
  console.log('\n--- Test 1: INVESTMENT_RECEIVED Voucher Mapping ---');

  const eventReceived: InvestorFinancialEvent = {
    id: 'EVT_FIN_1',
    contractId: testContract.id,
    investorPersonId: testPerson.id,
    eventType: 'INVESTMENT_RECEIVED',
    amount: 2000000000,
    eventDate: '1403/01/01',
    cashOrBankSubAccountId: 'SUB_BANK_MELI',
  };

  const draftReceived = InvestorAccountingMapper.createVoucherDraftRequest(
    eventReceived,
    testPerson,
    testContract
  );

  if (!draftReceived.isBalanced || draftReceived.totalDebit !== 2000000000 || draftReceived.totalCredit !== 2000000000) {
    throw new Error('❌ Test 1 Failed: INVESTMENT_RECEIVED voucher is not balanced!');
  }
  if (draftReceived.entries[0].subsidiaryId !== 'SUB_BANK_MELI' || draftReceived.entries[0].debit !== 2000000000) {
    throw new Error('❌ Test 1 Failed: Bank debit entry invalid.');
  }
  if (
    draftReceived.entries[1].subsidiaryId !== 'SUB_INVESTOR_PAYABLES' ||
    draftReceived.entries[1].credit !== 2000000000 ||
    draftReceived.entries[1].floatingDetailed?.id !== testPerson.id
  ) {
    throw new Error('❌ Test 1 Failed: Investor Payables credit entry or floating person missing.');
  }

  console.log('✅ Test 1 Passed: INVESTMENT_RECEIVED voucher mapped cleanly with balanced entries.');

  // ----------------------------------------------------
  // Test 2: INVESTMENT_RETURNED Mapping
  // ----------------------------------------------------
  console.log('\n--- Test 2: INVESTMENT_RETURNED Voucher Mapping ---');

  const eventReturned: InvestorFinancialEvent = {
    id: 'EVT_FIN_2',
    contractId: testContract.id,
    investorPersonId: testPerson.id,
    eventType: 'INVESTMENT_RETURNED',
    amount: 500000000, // 500 Million Rials returned
    eventDate: '1403/06/01',
    cashOrBankSubAccountId: 'SUB_BANK_MELI',
  };

  const draftReturned = InvestorAccountingMapper.createVoucherDraftRequest(
    eventReturned,
    testPerson,
    testContract
  );

  if (!draftReturned.isBalanced || draftReturned.totalDebit !== 500000000) {
    throw new Error('❌ Test 2 Failed: INVESTMENT_RETURNED voucher balance check failed.');
  }
  if (draftReturned.entries[0].debit !== 500000000 || draftReturned.entries[0].floatingDetailed?.id !== testPerson.id) {
    throw new Error('❌ Test 2 Failed: Investor payables debit entry invalid.');
  }
  if (draftReturned.entries[1].credit !== 500000000 || draftReturned.entries[1].subsidiaryId !== 'SUB_BANK_MELI') {
    throw new Error('❌ Test 2 Failed: Bank credit entry invalid.');
  }

  console.log('✅ Test 2 Passed: INVESTMENT_RETURNED voucher mapped cleanly.');

  // ----------------------------------------------------
  // Test 3: COMMISSION_ACCRUED Mapping
  // ----------------------------------------------------
  console.log('\n--- Test 3: COMMISSION_ACCRUED Voucher Mapping ---');

  const eventAccrued: InvestorFinancialEvent = {
    id: 'EVT_FIN_3',
    contractId: testContract.id,
    investorPersonId: testPerson.id,
    eventType: 'COMMISSION_ACCRUED',
    amount: 70000000, // 70 Million Rials commission accrued
    eventDate: '1403/02/01',
  };

  const draftAccrued = InvestorAccountingMapper.createVoucherDraftRequest(
    eventAccrued,
    testPerson,
    testContract
  );

  if (!draftAccrued.isBalanced || draftAccrued.totalDebit !== 70000000) {
    throw new Error('❌ Test 3 Failed: COMMISSION_ACCRUED voucher balance error.');
  }
  if (draftAccrued.entries[0].subsidiaryId !== 'SUB_EXP_FIN_INTEREST' || draftAccrued.entries[0].debit !== 70000000) {
    throw new Error('❌ Test 3 Failed: Financial expense debit entry invalid.');
  }
  if (draftAccrued.entries[1].subsidiaryId !== 'SUB_INVESTOR_PAYABLES' || draftAccrued.entries[1].credit !== 70000000) {
    throw new Error('❌ Test 3 Failed: Investor payables credit entry invalid.');
  }

  console.log('✅ Test 3 Passed: COMMISSION_ACCRUED voucher mapped cleanly (Expense debit / Payables credit).');

  // ----------------------------------------------------
  // Test 4: COMMISSION_PAID Mapping
  // ----------------------------------------------------
  console.log('\n--- Test 4: COMMISSION_PAID Voucher Mapping ---');

  const eventPaid: InvestorFinancialEvent = {
    id: 'EVT_FIN_4',
    contractId: testContract.id,
    investorPersonId: testPerson.id,
    eventType: 'COMMISSION_PAID',
    amount: 70000000,
    eventDate: '1403/02/05',
    cashOrBankSubAccountId: 'SUB_BANK_MELI',
  };

  const draftPaid = InvestorAccountingMapper.createVoucherDraftRequest(
    eventPaid,
    testPerson,
    testContract
  );

  if (!draftPaid.isBalanced || draftPaid.totalDebit !== 70000000) {
    throw new Error('❌ Test 4 Failed: COMMISSION_PAID voucher balance error.');
  }
  if (draftPaid.entries[0].debit !== 70000000 || draftPaid.entries[0].floatingDetailed?.id !== testPerson.id) {
    throw new Error('❌ Test 4 Failed: Investor payables debit entry invalid.');
  }
  if (draftPaid.entries[1].credit !== 70000000 || draftPaid.entries[1].subsidiaryId !== 'SUB_BANK_MELI') {
    throw new Error('❌ Test 4 Failed: Bank credit entry invalid.');
  }

  console.log('✅ Test 4 Passed: COMMISSION_PAID voucher mapped cleanly (Payables debit / Bank credit).');

  // ----------------------------------------------------
  // Test 5: Validation Guards & Invalid Inputs
  // ----------------------------------------------------
  console.log('\n--- Test 5: Validation Guards & Fault Tolerance ---');

  // Negative amount check
  const invalidAmountEvent: InvestorFinancialEvent = {
    ...eventPaid,
    amount: -1000,
  };

  const valRes = InvestorAccountingMapper.validateFinancialEvent(invalidAmountEvent, testPerson, testContract);
  if (valRes.isValid) {
    throw new Error('❌ Test 5 Failed: Validation permitted negative amount!');
  }

  // Terminated contract check
  const terminatedContract: InvestorContract = {
    ...testContract,
    status: 'terminated',
  };

  const termValRes = InvestorAccountingMapper.validateFinancialEvent(eventPaid, testPerson, terminatedContract);
  if (termValRes.isValid) {
    throw new Error('❌ Test 5 Failed: Validation permitted event on terminated contract!');
  }

  console.log('✅ Test 5 Passed: All validation guards effectively blocked invalid financial requests.');

  console.log('\n=======================================================');
  console.log('🎉 ALL INVESTOR ACCOUNTING ADAPTER TESTS PASSED!');
  console.log('=======================================================');
}

runInvestorAccountingAdapterTests();
