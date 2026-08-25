/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { recordPartnerCreditRulesChange } from '../utils/partnerProcess';
import { SalesAgentCreditControlEngine } from '../modules/creditControl/creditControlEngine';
import { CreditControlEngineInput } from '../modules/creditControl/creditControl.types';
import { Person, BusinessPartner, AgencyType, Invoice } from '../types';

function runCreditRulesAuditHistoryTests() {
  console.log('=======================================================');
  console.log('🧪 RUNNING CREDIT RULES AUDIT HISTORY REGRESSION TESTS');
  console.log('=======================================================');

  const initialPartner: BusinessPartner = {
    id: 'BP_audit_test_1',
    personId: 'P_audit_test_1',
    status: 'active',
    agencyType: AgencyType.INSTALLMENT_ONLY,
    roles: [],
    profile: {
      partnerId: 'BP_audit_test_1',
      contractStatus: 'active',
      creditLimit: 500000000
    },
    creditExtension: {
      creditRules: {
        maxCreditLimit: 500000000,
        defaultInstallmentDays: 30,
        penaltyRatePerMonth: 0.1
      },
      history: []
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  };

  // -------------------------------------------------------------
  // Scenario 1: Initial credit limit 500,000,000 changed to 1,000,000,000
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 1: Max credit limit change from 500M to 1,000M...');
  const updatedExt1 = recordPartnerCreditRulesChange(
    initialPartner,
    {
      maxCreditLimit: 1000000000,
      defaultInstallmentDays: 30,
      penaltyRatePerMonth: 0.1
    },
    { changeReason: 'افزایش سقف اعتباری نماینده' }
  );

  if (!updatedExt1.history || updatedExt1.history.length !== 1) {
    throw new Error(`❌ Scenario 1 Failed: Expected 1 history entry, got ${updatedExt1.history?.length}`);
  }

  const h1 = updatedExt1.history[0];
  if (h1.previousRules?.maxCreditLimit !== 500000000) {
    throw new Error(`❌ Scenario 1 Failed: Expected previous maxCreditLimit 500M, got ${h1.previousRules?.maxCreditLimit}`);
  }
  if (h1.newRules.maxCreditLimit !== 1000000000) {
    throw new Error(`❌ Scenario 1 Failed: Expected new maxCreditLimit 1,000M, got ${h1.newRules.maxCreditLimit}`);
  }
  console.log('✅ Scenario 1 Passed: Credit limit change correctly audited in history.');

  // -------------------------------------------------------------
  // Scenario 2: Only penalty rate changes (from 0.1% to 0.3%)
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 2: Penalty rate change from 0.1% to 0.3%...');
  const partnerAfterScenario1: BusinessPartner = {
    ...initialPartner,
    creditExtension: updatedExt1
  };

  const updatedExt2 = recordPartnerCreditRulesChange(
    partnerAfterScenario1,
    {
      maxCreditLimit: 1000000000,
      defaultInstallmentDays: 30,
      penaltyRatePerMonth: 0.3
    },
    { changeReason: 'تغییر نرخ جریمه دیرکرد' }
  );

  if (!updatedExt2.history || updatedExt2.history.length !== 2) {
    throw new Error(`❌ Scenario 2 Failed: Expected 2 history entries, got ${updatedExt2.history?.length}`);
  }

  const h2 = updatedExt2.history[0]; // Most recent entry is prepended
  if (h2.previousRules?.penaltyRatePerMonth !== 0.1) {
    throw new Error(`❌ Scenario 2 Failed: Expected previous penalty rate 0.1%, got ${h2.previousRules?.penaltyRatePerMonth}%`);
  }
  if (h2.newRules.penaltyRatePerMonth !== 0.3) {
    throw new Error(`❌ Scenario 2 Failed: Expected new penalty rate 0.3%, got ${h2.newRules.penaltyRatePerMonth}%`);
  }
  console.log('✅ Scenario 2 Passed: Penalty rate change correctly audited in history.');

  // -------------------------------------------------------------
  // Scenario 3: No actual change performed
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 3: No actual rule changes (same values)...');
  const partnerAfterScenario2: BusinessPartner = {
    ...initialPartner,
    creditExtension: updatedExt2
  };

  const updatedExt3 = recordPartnerCreditRulesChange(
    partnerAfterScenario2,
    {
      maxCreditLimit: 1000000000,
      defaultInstallmentDays: 30,
      penaltyRatePerMonth: 0.3
    },
    { changeReason: 'حفظ همان قوانین بدون تغییر' }
  );

  if (updatedExt3.history?.length !== 2) {
    throw new Error(`❌ Scenario 3 Failed: Expected history length to remain 2, got ${updatedExt3.history?.length}`);
  }
  console.log('✅ Scenario 3 Passed: No history record generated when no actual changes occurred.');

  // -------------------------------------------------------------
  // Scenario 4: Rule change after existing invoices with creditRulesSnapshot
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 4: Rule change after existing invoice with locked snapshot...');
  const mockAgent: Person = {
    id: 'P_audit_test_1',
    code: 'P9003',
    name: 'نماینده ممیزی',
    isAgent: true,
    role: 'creditor',
    createdAt: new Date().toISOString()
  };

  // Invoice issued with snapshot of old rule (penalty 0.1%)
  const lockedInvoice: Invoice = {
    id: 'inv_locked_snapshot',
    invoiceNumber: 9901,
    type: 'sell',
    isProInvoice: false,
    isConverted: false,
    date: '1405/01/01',
    personId: mockAgent.id,
    items: [],
    discount: 0,
    taxPercent: 0,
    totalAmount: 10000000,
    paidAmount: 0,
    createdAt: new Date().toISOString(),
    creditRulesSnapshot: {
      maxCreditLimit: 500000000,
      defaultInstallmentDays: 30,
      penaltyRatePerMonth: 0.1, // Locked at 0.1%
      snapshotCreatedAt: new Date().toISOString()
    }
  };

  // Partner rule is updated to 0.5% after invoice was issued
  const partnerWithNewRules: BusinessPartner = {
    ...partnerAfterScenario2,
    creditExtension: recordPartnerCreditRulesChange(
      partnerAfterScenario2,
      {
        maxCreditLimit: 1000000000,
        defaultInstallmentDays: 30,
        penaltyRatePerMonth: 0.5 // Updated to 0.5%
      },
      { changeReason: 'افزایش نرخ جریمه دیرکرد به ۰.۵ درصد' }
    )
  };

  const policy = SalesAgentCreditControlEngine.createDefaultPolicy(mockAgent.id, 1000000000);
  policy.paymentTermDays = 30;
  policy.gracePeriodDays = 0;
  policy.lateFeeDailyPercentage = 0.5; // Updated policy rate

  const input: CreditControlEngineInput = {
    agent: mockAgent,
    partner: partnerWithNewRules,
    policy,
    invoices: [lockedInvoice],
    vouchers: [],
    checks: [],
    currentDate: '1405/02/05' // 34 days elapsed
  };

  const output = SalesAgentCreditControlEngine.process(input);
  const pendingFee = output.pendingLateFees.find(f => f.invoiceId === 'inv_locked_snapshot');

  if (!pendingFee) {
    throw new Error('❌ Scenario 4 Failed: No pending late fee record generated!');
  }
  if (pendingFee.penaltyRate !== 0.1) {
    throw new Error(`❌ Scenario 4 Failed: Invoice snapshot rate was overridden! Expected 0.1%, got ${pendingFee.penaltyRate}%`);
  }
  // 10,000,000 * (0.1 / 100) = 10,000 daily penalty
  if (pendingFee.calculatedPenaltyAmount !== 10000) {
    throw new Error(`❌ Scenario 4 Failed: Calculated penalty amount changed! Expected 10,000, got ${pendingFee.calculatedPenaltyAmount}`);
  }

  if (lockedInvoice.creditRulesSnapshot?.penaltyRatePerMonth !== 0.1) {
    throw new Error('❌ Scenario 4 Failed: invoice.creditRulesSnapshot object was mutated!');
  }

  console.log('✅ Scenario 4 Passed: Rule change logged in History without affecting existing invoice snapshot or calculations.');

  console.log('=======================================================');
  console.log('🎉 ALL CREDIT RULES AUDIT HISTORY TESTS PASSED!');
  console.log('=======================================================');
}

runCreditRulesAuditHistoryTests();
