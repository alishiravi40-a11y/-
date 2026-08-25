import { AppState, BusinessPartner, Person } from '../types';
import { ensurePartnerCreditRulesInSync, resolvePartnerCreditRules } from '../utils/partnerProcess';

console.log('🧪 RUNNING ARCHITECTURAL MIGRATION TEST: BUSINESS PARTNER CREDIT RULES SSOT');

const samplePersons: Person[] = [
  {
    id: 'p1',
    code: '1001',
    name: 'علی تقوی',
    mobile: '09121111111',
    creditLimit: 250000000,
    allowedDelayDays: 45,
    penaltyRate: 0.2,
    createdAt: new Date().toISOString()
  },
  {
    id: 'p2',
    code: '1002',
    name: 'سارا احمدی',
    mobile: '09122222222',
    creditLimit: 100000000,
    allowedDelayDays: 20,
    penaltyRate: 0.15,
    createdAt: new Date().toISOString()
  }
];

const sampleBPs: BusinessPartner[] = [
  {
    id: 'BP_p1',
    agencyType: 'CREDIT_ONLY' as any,
    personId: 'p1',
    status: 'active',
    roles: ['CREDIT_SALES_AGENT' as any],
    profile: {
      partnerId: 'BP_p1',
      contractStatus: 'active',
      creditLimit: 250000000
    },
    branches: [],
    users: [],
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  },
  {
    id: 'BP_p2',
    agencyType: 'INSTALLMENT_ONLY' as any,
    personId: 'p2',
    status: 'active',
    roles: ['DEFERRED_AGENT' as any],
    profile: {
      partnerId: 'BP_p2',
      contractStatus: 'active'
    },
    creditExtension: {
      creditRules: {
        maxCreditLimit: 100000000,
        defaultInstallmentDays: 20,
        penaltyRatePerMonth: 0.15
      }
    },
    branches: [],
    users: [],
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  }
];

const mockAppState = {
  persons: samplePersons,
  businessPartners: sampleBPs,
} as AppState;

// 1. Run Migration
const report = ensurePartnerCreditRulesInSync(mockAppState);

console.log('----------------------------------------');
console.log(`📊 گزارش ممیزی و مهاجرت قوانین اعتباری:`);
console.log(`- تعداد کل رکوردهای بررسی شده: ${report.totalChecked}`);
console.log(`- تعداد رکوردهای مهاجرت یافته: ${report.migratedCount}`);
console.log(`- تعداد رکوردهای دارای خطا: ${report.errorCount}`);
console.log(`- تعداد رکوردهایی که قبلاً صحیح بوده‌اند: ${report.alreadyValidCount}`);
console.log('----------------------------------------');

if (report.totalChecked !== 2) {
  throw new Error(`Test Failed: Expected 2 checked records, got ${report.totalChecked}`);
}

if (report.migratedCount !== 1) {
  throw new Error(`Test Failed: Expected 1 migrated record, got ${report.migratedCount}`);
}

if (report.alreadyValidCount !== 1) {
  throw new Error(`Test Failed: Expected 1 already valid record, got ${report.alreadyValidCount}`);
}

if (report.errorCount !== 0) {
  throw new Error(`Test Failed: Expected 0 error records, got ${report.errorCount}`);
}

// 2. Verify SSOT Resolution for migrated record
const migratedBP = report.updatedState.businessPartners.find(b => b.id === 'BP_p1');
if (!migratedBP?.creditExtension?.creditRules) {
  throw new Error('Test Failed: BP_p1 creditRules was not populated!');
}

if (migratedBP.creditExtension.creditRules.maxCreditLimit !== 250000000) {
  throw new Error(`Test Failed: maxCreditLimit mismatch! Expected 250000000, got ${migratedBP.creditExtension.creditRules.maxCreditLimit}`);
}

if (migratedBP.creditExtension.creditRules.defaultInstallmentDays !== 45) {
  throw new Error(`Test Failed: defaultInstallmentDays mismatch! Expected 45, got ${migratedBP.creditExtension.creditRules.defaultInstallmentDays}`);
}

if (migratedBP.creditExtension.creditRules.penaltyRatePerMonth !== 0.2) {
  throw new Error(`Test Failed: penaltyRatePerMonth mismatch! Expected 0.2, got ${migratedBP.creditExtension.creditRules.penaltyRatePerMonth}`);
}

// 3. Test SSOT Resolver function
const rulesP1 = resolvePartnerCreditRules('p1', report.updatedState.businessPartners);
if (rulesP1.maxCreditLimit !== 250000000 || rulesP1.defaultInstallmentDays !== 45 || rulesP1.penaltyRatePerMonth !== 0.2) {
  throw new Error('Test Failed: resolvePartnerCreditRules failed for p1!');
}

console.log('✅ ALL CREDIT RULES MIGRATION TESTS PASSED SUCCESSFULLY!');
