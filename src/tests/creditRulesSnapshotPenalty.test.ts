/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SalesAgentCreditControlEngine } from '../modules/creditControl/creditControlEngine';
import { CreditControlEngineInput } from '../modules/creditControl/creditControl.types';
import { Person, BusinessPartner, AgencyType, Invoice } from '../types';

function runSnapshotPenaltyTests() {
  console.log('=======================================================');
  console.log('🧪 RUNNING CREDIT RULES SNAPSHOT PENALTY REGRESSION TESTS');
  console.log('=======================================================');

  const mockAgent: Person = {
    id: 'agent_snapshot_test',
    code: 'P9002',
    name: 'نماینده تست اسنپ‌شات',
    nationalId: '0987654321',
    isAgent: true,
    role: 'creditor',
    createdAt: new Date().toISOString()
  };

  const mockPartner: BusinessPartner = {
    id: 'BP_agent_snapshot_test',
    personId: 'agent_snapshot_test',
    status: 'active',
    agencyType: AgencyType.INSTALLMENT_ONLY,
    roles: [],
    profile: {
      partnerId: 'BP_agent_snapshot_test',
      contractStatus: 'active'
    },
    creditExtension: {
      creditRules: {
        maxCreditLimit: 200000000,
        defaultInstallmentDays: 30,
        penaltyRatePerMonth: 0.5 // Updated partner rule to 0.5% daily (5% per 10 days)
      }
    },
    branches: [],
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  };

  const policy = SalesAgentCreditControlEngine.createDefaultPolicy(mockAgent.id, 200000000);
  policy.paymentTermDays = 30;
  policy.gracePeriodDays = 0;
  policy.lateFeeDailyPercentage = 0.5;

  // -------------------------------------------------------------
  // Scenario 1: Invoice 1 issued with 0.3% snapshot penalty rate
  // Later partner rate was changed to 0.5%, but Invoice 1 must still calculate with 0.3%
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 1: Invoice with 0.3% snapshot calculated at 0.3% even after partner rate updated to 0.5%...');
  const inv1: Invoice = {
    id: 'inv_snapshot_1',
    invoiceNumber: 5001,
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
      maxCreditLimit: 200000000,
      defaultInstallmentDays: 30,
      penaltyRatePerMonth: 0.3, // 0.3% snapshot rate
      snapshotCreatedAt: new Date().toISOString()
    }
  };

  const input1: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy,
    invoices: [inv1],
    vouchers: [],
    checks: [],
    currentDate: '1405/02/05' // 34 days elapsed (4 days late after 30 days term)
  };

  const output1 = SalesAgentCreditControlEngine.process(input1);
  const pending1 = output1.pendingLateFees.find(f => f.invoiceId === 'inv_snapshot_1');

  if (!pending1) {
    throw new Error('❌ Scenario 1 Failed: No pending late fee record generated for Invoice 1!');
  }
  if (pending1.penaltyRate !== 0.3) {
    throw new Error(`❌ Scenario 1 Failed: Expected penalty rate 0.3%, got ${pending1.penaltyRate}%`);
  }
  // 10,000,000 * (0.3 / 100) = 30,000 daily penalty
  if (pending1.calculatedPenaltyAmount !== 30000) {
    throw new Error(`❌ Scenario 1 Failed: Expected daily penalty 30,000, got ${pending1.calculatedPenaltyAmount}`);
  }
  console.log('✅ Scenario 1 Passed: Invoice 1 calculated strictly with its 0.3% snapshot rate.');

  // -------------------------------------------------------------
  // Scenario 2: Invoice 2 issued after rule change with 0.5% snapshot
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 2: Invoice 2 issued with 0.5% snapshot calculated at 0.5%...');
  const inv2: Invoice = {
    id: 'inv_snapshot_2',
    invoiceNumber: 5002,
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
      maxCreditLimit: 200000000,
      defaultInstallmentDays: 30,
      penaltyRatePerMonth: 0.5, // 0.5% snapshot rate
      snapshotCreatedAt: new Date().toISOString()
    }
  };

  const input2: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy,
    invoices: [inv2],
    vouchers: [],
    checks: [],
    currentDate: '1405/02/05'
  };

  const output2 = SalesAgentCreditControlEngine.process(input2);
  const pending2 = output2.pendingLateFees.find(f => f.invoiceId === 'inv_snapshot_2');

  if (!pending2) {
    throw new Error('❌ Scenario 2 Failed: No pending late fee record generated for Invoice 2!');
  }
  if (pending2.penaltyRate !== 0.5) {
    throw new Error(`❌ Scenario 2 Failed: Expected penalty rate 0.5%, got ${pending2.penaltyRate}%`);
  }
  // 10,000,000 * (0.5 / 100) = 50,000 daily penalty
  if (pending2.calculatedPenaltyAmount !== 50000) {
    throw new Error(`❌ Scenario 2 Failed: Expected daily penalty 50,000, got ${pending2.calculatedPenaltyAmount}`);
  }
  console.log('✅ Scenario 2 Passed: Invoice 2 calculated strictly with its 0.5% snapshot rate.');

  // -------------------------------------------------------------
  // Scenario 3: Legacy Invoice without snapshot uses Fallback partner rules without error
  // -------------------------------------------------------------
  console.log('🔹 Testing Scenario 3: Legacy Invoice without snapshot falls back to BusinessPartner credit rules...');
  const legacyInv: Invoice = {
    id: 'inv_legacy_3',
    invoiceNumber: 5003,
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
    createdAt: new Date().toISOString()
    // No creditRulesSnapshot
  };

  const input3: CreditControlEngineInput = {
    agent: mockAgent,
    partner: mockPartner,
    policy,
    invoices: [legacyInv],
    vouchers: [],
    checks: [],
    currentDate: '1405/02/05'
  };

  const output3 = SalesAgentCreditControlEngine.process(input3);
  const pending3 = output3.pendingLateFees.find(f => f.invoiceId === 'inv_legacy_3');

  if (!pending3) {
    throw new Error('❌ Scenario 3 Failed: No pending late fee record generated for legacy invoice!');
  }
  if (pending3.penaltyRate !== 0.5) {
    throw new Error(`❌ Scenario 3 Failed: Fallback penalty rate expected 0.5%, got ${pending3.penaltyRate}%`);
  }
  console.log('✅ Scenario 3 Passed: Legacy Invoice without snapshot calculated gracefully using Fallback rules.');

  console.log('=======================================================');
  console.log('🎉 ALL CREDIT RULES SNAPSHOT PENALTY TESTS PASSED!');
  console.log('=======================================================');
}

runSnapshotPenaltyTests();
