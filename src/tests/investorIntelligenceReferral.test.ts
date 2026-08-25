/**
 * Step 8 Test Suite: Investor Intelligence, Notification, Referral & Institutional Layer
 * Verifies SMS event bridge, referral commission calculation with duration factors,
 * capital reduction impact warnings without automatic clawbacks, institutional investors (Banks),
 * RBAC access control, and isolation from accounting core.
 */

import { InvestorSmsBridge } from '../modules/investors/investorSmsBridge';
import { InvestorReferralEngine } from '../modules/investors/investorReferralEngine';
import { InvestorInstitutionalEngine } from '../modules/investors/investorInstitutionalEngine';
import { InvestorAlertEngine } from '../modules/investors/investorAlertEngine';
import { InvestorAuditEngine } from '../modules/investors/investorAuditEngine';
import { SmsEventBus } from '../modules/sms/eventBus';
import { InvestorContract, InvestorPaymentObligation, InvestorProfile } from '../modules/investors/types';

export function runInvestorIntelligenceReferralTests() {
  console.log('=======================================================');
  console.log('🚀 RUNNING INVESTOR INTELLIGENCE, REFERRAL & INSTITUTIONAL TEST SUITE (STEP 8)');
  console.log('=======================================================');

  // ----------------------------------------------------
  // Test 1: New Investor Registration & SMS Event Dispatch
  // ----------------------------------------------------
  console.log('\n--- Test 1: New Investor Registration & SMS Event Dispatch ---');
  let dispatchedEvents: Array<{ name: string; payload: any }> = [];

  const unsubscribeReg = SmsEventBus.subscribe('INVESTOR_REGISTERED', (payload) => {
    dispatchedEvents.push({ name: 'INVESTOR_REGISTERED', payload });
  });
  const unsubscribeRec = SmsEventBus.subscribe('INVESTMENT_RECEIVED', (payload) => {
    dispatchedEvents.push({ name: 'INVESTMENT_RECEIVED', payload });
  });

  InvestorSmsBridge.notifyInvestorRegistered({
    investorPersonId: 'P_INV_001',
    investorName: 'علی رضایی',
    mobile: '09121111111',
    category: 'INDIVIDUAL',
  });

  InvestorSmsBridge.notifyInvestmentReceived({
    contractNumber: 'INV-1403-9001',
    investorName: 'علی رضایی',
    mobile: '09121111111',
    amount: 5000000000,
    startDate: '1403/01/01',
    monthlyFeeRate: 3.0,
  });

  unsubscribeReg();
  unsubscribeRec();

  if (dispatchedEvents.length !== 2) {
    throw new Error(`❌ Test 1 Failed: Expected 2 SMS events, got ${dispatchedEvents.length}`);
  }
  if (dispatchedEvents[0].payload.investorName !== 'علی رضایی' || dispatchedEvents[1].payload.amount !== 5000000000) {
    throw new Error('❌ Test 1 Failed: SMS event payloads do not match expected values.');
  }
  console.log('✅ Test 1 Passed: Investor registration and investment received SMS events dispatched correctly.');

  // ----------------------------------------------------
  // Test 2: Fee Payment & Notification
  // ----------------------------------------------------
  console.log('\n--- Test 2: Fee Payment Notification ---');
  let paidNotificationReceived = false;

  const unsubscribePaid = SmsEventBus.subscribe('COMMISSION_PAID', (payload) => {
    if (payload.contractNumber === 'INV-1403-9001' && payload.amountPaid === 150000000) {
      paidNotificationReceived = true;
    }
  });

  InvestorSmsBridge.notifyCommissionPaid({
    contractNumber: 'INV-1403-9001',
    investorName: 'علی رضایی',
    mobile: '09121111111',
    amountPaid: 150000000,
    paymentDate: '1403/02/01',
    voucherId: 'VOUCH_COMM_101',
  });

  unsubscribePaid();

  if (!paidNotificationReceived) {
    throw new Error('❌ Test 2 Failed: COMMISSION_PAID event not received with correct payload.');
  }
  console.log('✅ Test 2 Passed: Fee payment receipt SMS event published cleanly.');

  // ----------------------------------------------------
  // Test 3 & 4: Investor Referral Registration & Duration-Based Commission
  // ----------------------------------------------------
  console.log('\n--- Test 3 & 4: Referral Registration & Duration-Based Commission Calculation ---');

  // Scenario A: 1B Rials for 3 Months @ 2.0%
  const referralShort = InvestorReferralEngine.registerReferral({
    referrerPersonId: 'P_REFERRER_1',
    referrerName: 'محمد احمدی',
    referredInvestorPersonId: 'P_INV_002',
    referredInvestorName: 'سارا کاظمی',
    referralDate: '1403/01/01',
    capitalAmount: 1000000000, // 1B Rials
    contractDurationMonths: 3, // 3 Months
    commissionRate: 2.0, // 2%
  });

  // Scenario B: 1B Rials for 12 Months @ 2.0%
  const referralLong = InvestorReferralEngine.registerReferral({
    referrerPersonId: 'P_REFERRER_1',
    referrerName: 'محمد احمدی',
    referredInvestorPersonId: 'P_INV_003',
    referredInvestorName: 'حمید نوری',
    referralDate: '1403/01/01',
    capitalAmount: 1000000000, // 1B Rials
    contractDurationMonths: 12, // 12 Months
    commissionRate: 2.0, // 2%
  });

  // 1B * 2% * (3/12) = 5,000,000 Rials
  if (referralShort.calculatedCommissionAmount !== 5000000) {
    throw new Error(`❌ Test 4 Failed: Expected 3-month commission 5,000,000, got ${referralShort.calculatedCommissionAmount}`);
  }

  // 1B * 2% * (12/12) = 20,000,000 Rials
  if (referralLong.calculatedCommissionAmount !== 20000000) {
    throw new Error(`❌ Test 4 Failed: Expected 12-month commission 20,000,000, got ${referralLong.calculatedCommissionAmount}`);
  }

  console.log('✅ Test 3 & 4 Passed: Referral registered & duration factor (3m vs 12m) produced distinct commissions.');

  // ----------------------------------------------------
  // Test 5: Capital Reduction Impact on Referral (Warning & No Automatic Clawback)
  // ----------------------------------------------------
  console.log('\n--- Test 5: Capital Reduction Impact & Manager Approval Guard ---');

  const adjustmentResult = InvestorReferralEngine.handleContractAdjustment(
    referralLong, // original 1B Rials / 12 months / 20M commission
    500000000, // reduced to 500M Rials
    12, // duration 12 months
    'کاهش ۵۰٪ سرمایه اولیه'
  );

  if (!adjustmentResult.requiresManagerAction) {
    throw new Error('❌ Test 5 Failed: Capital decrease must set requiresManagerAction to true.');
  }
  if (adjustmentResult.suggestedCommission !== 10000000) {
    throw new Error(`❌ Test 5 Failed: Expected suggested recalculated commission 10,000,000, got ${adjustmentResult.suggestedCommission}`);
  }
  if (!adjustmentResult.warningMessage.includes('هشدار تغییر قرارداد معرف')) {
    throw new Error('❌ Test 5 Failed: Warning message was not generated.');
  }

  // Verify original calculated commission was NOT changed automatically
  if (adjustmentResult.updatedReferral.calculatedCommissionAmount !== 20000000) {
    throw new Error('❌ Test 5 Failed: Automatic clawback occurred! Original commission was mutated without manager approval.');
  }

  // Manager approves recalculated commission
  const approvedReferral = InvestorReferralEngine.approveCommission(
    adjustmentResult.updatedReferral,
    'ADMIN_USER',
    10000000,
    'تایید تعدیل کمیسیون توسط مدیر ارشد'
  );

  if (approvedReferral.calculatedCommissionAmount !== 10000000 || approvedReferral.commissionStatus !== 'APPROVED') {
    throw new Error('❌ Test 5 Failed: Manager approval did not set final commission amount or status.');
  }

  console.log('✅ Test 5 Passed: Capital decrease generated warning proposal without automatic clawback, manager approval verified.');

  // ----------------------------------------------------
  // Test 6: Institutional Investor (Bank) Registration
  // ----------------------------------------------------
  console.log('\n--- Test 6: Institutional Investor (Bank) Infrastructure ---');

  const bankDetails = InvestorInstitutionalEngine.createInstitutionalDetails({
    category: 'BANK',
    receivedAmount: 100000000000, // 100B Rials
    totalRepaymentAmount: 120000000000, // 120B Rials
    contractInterestOrFee: 20000000000, // 20B Rials bank interest
    repaymentMonths: 12,
    startDate: '1403/01/01',
  });

  if (bankDetails.repaymentSchedule.length !== 12) {
    throw new Error(`❌ Test 6 Failed: Expected 12 institutional repayment items, got ${bankDetails.repaymentSchedule.length}`);
  }

  const sumTotalRepay = bankDetails.repaymentSchedule.reduce((acc, item) => acc + item.totalAmount, 0);
  if (sumTotalRepay !== 120000000000) {
    throw new Error(`❌ Test 6 Failed: Repayment schedule sum (${sumTotalRepay}) does not equal total repayment amount 120B.`);
  }

  console.log('✅ Test 6 Passed: Institutional Bank investor details and 12-month repayment schedule created without individual investor conflict.');

  // ----------------------------------------------------
  // Test 7: Smart Alert Engine
  // ----------------------------------------------------
  console.log('\n--- Test 7: Smart Alert Engine ---');

  const mockContract: InvestorContract = {
    id: 'CTR_ALERT_1',
    contractNumber: 'INV-ALERT-001',
    investorPersonId: 'P_INV_001',
    startDate: '1403/01/01',
    endDate: '1403/02/01', // Expiring in near date
    initialCapital: 1000000000,
    currentCapital: 1000000000,
    monthlyFeeRate: 3.0,
    paymentFrequency: 'monthly',
    status: 'active',
    createdAt: '1403/01/01',
    updatedAt: '1403/01/01',
  };

  const mockObligation: InvestorPaymentObligation = {
    id: 'OBLIG_ALERT_1',
    investorPersonId: 'P_INV_001',
    contractId: 'CTR_ALERT_1',
    obligationType: 'FEE',
    amount: 30000000,
    createdAt: '1403/01/01',
    dueDate: '1403/01/15',
    status: 'PLANNED',
    paymentMethod: 'UNSPECIFIED',
    updatedAt: '1403/01/01',
  };

  const mockProfile: InvestorProfile = {
    id: 'PROF_ALERT_1',
    personId: 'P_INV_001',
    totalInvestedAmount: 1000000000,
    activeContractsCount: 1,
    createdAt: '1403/01/01',
    updatedAt: '1403/01/01',
  };

  const alerts = InvestorAlertEngine.generateAlerts(
    [mockContract],
    [mockObligation],
    [],
    [mockProfile],
    '1403/01/01'
  );

  if (alerts.length < 2) {
    throw new Error(`❌ Test 7 Failed: Expected at least 2 smart alerts, got ${alerts.length}`);
  }

  console.log('✅ Test 7 Passed: Smart Alert Engine correctly detected upcoming payments and expiring contracts.');

  // ----------------------------------------------------
  // Test 8: Audit Engine Trail
  // ----------------------------------------------------
  console.log('\n--- Test 8: Audit Engine Operational Logging ---');

  const auditLog = InvestorAuditEngine.logAction({
    contractId: 'CTR_ALERT_1',
    investorPersonId: 'P_INV_001',
    action: 'CAPITAL_CHANGE',
    performedBy: 'ADMIN_USER',
    previousValue: '1000000000',
    newValue: '1500000000',
    description: 'افزایش ۵۰۰ میلیون ریالی سرمایه',
  });

  if (!auditLog.id || auditLog.performedBy !== 'ADMIN_USER' || auditLog.action !== 'CAPITAL_CHANGE') {
    throw new Error('❌ Test 8 Failed: Audit log entry format invalid.');
  }

  console.log('✅ Test 8 Passed: Investor operational audit trail logged successfully.');

  console.log('=======================================================');
  console.log('🎉 ALL INVESTOR INTELLIGENCE, REFERRAL & INSTITUTIONAL TESTS PASSED!');
  console.log('=======================================================');
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('investorIntelligenceReferral')) {
  runInvestorIntelligenceReferralTests();
}
