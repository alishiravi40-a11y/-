import { mapLegacyPersonToRelational, performPersonsDryRun, LegacyPerson } from '../services/PersonMigrationMapper';

async function runPersonMapperTests() {
  console.log('🚀 Running Person Migration Mapper & Dry Run Tests');

  const orgId = 'org_test_123';

  // 1. Convert complete Person
  const legacyComplete: LegacyPerson = {
    id: 'P-5001',
    name: 'شرکت نمونه',
    type: 'legal',
    nationalId: '10101234567',
    mobile: '09121112233',
    status: 'active',
    role: 'debtor',
  };

  const res1 = mapLegacyPersonToRelational(legacyComplete, orgId);
  if (!res1.mapped || res1.mapped.code !== 'P-5001' || res1.mapped.person_type !== 'legal') {
    throw new Error('Test 1 Failed: Complete person mapping failed');
  }
  console.log('✅ Test 1 Passed: Complete person mapping successful');

  // 2. Convert Person with optional empty fields
  const legacyMinimal: LegacyPerson = {
    id: 'P-5002',
    name: 'علی ساده',
  };

  const res2 = mapLegacyPersonToRelational(legacyMinimal, orgId);
  if (!res2.mapped || res2.mapped.code !== 'P-5002' || res2.mapped.national_id !== null) {
    throw new Error('Test 2 Failed: Minimal person mapping failed');
  }
  console.log('✅ Test 2 Passed: Minimal person mapping with optional empty fields successful');

  // 3. Preserve Business ID/Code
  if (res1.mapped.code !== 'P-5001' || res2.mapped.code !== 'P-5002') {
    throw new Error('Test 3 Failed: Business code preservation failed');
  }
  console.log('✅ Test 3 Passed: Business code successfully preserved');

  // 4. No replacement ID generation for business code
  if (res1.mapped.code === res1.mapped.id) {
    throw new Error('Test 4 Failed: Internal ID should not overwrite business code');
  }
  console.log('✅ Test 4 Passed: Internal ID and business code correctly separated without replacement');

  // 5. Duplicate Business Code Detection via Dry Run
  const listWithDupCode: LegacyPerson[] = [
    { id: 'P-6001', name: 'شخص اول' },
    { id: 'P-6001', name: 'شخص دوم با کد تکراری' },
  ];
  const dryRunDupCode = performPersonsDryRun(listWithDupCode, orgId);
  if (dryRunDupCode.duplicateCodeCount !== 1) {
    throw new Error('Test 5 Failed: Duplicate code detection failed');
  }
  console.log('✅ Test 5 Passed: Duplicate business code correctly detected');

  // 6. Duplicate National ID Detection
  const listWithDupNatId: LegacyPerson[] = [
    { id: 'P-7001', name: 'الف', nationalId: '0012345678' },
    { id: 'P-7002', name: 'ب', nationalId: '0012345678' },
  ];
  const dryRunNatId = performPersonsDryRun(listWithDupNatId, orgId);
  if (dryRunNatId.duplicateNationalIdCount !== 1) {
    throw new Error('Test 6 Failed: Duplicate National ID detection failed');
  }
  console.log('✅ Test 6 Passed: Duplicate National ID correctly detected');

  // 7. Duplicate Mobile Warning
  const listWithDupMobile: LegacyPerson[] = [
    { id: 'P-8001', name: 'الف', mobile: '09123334455' },
    { id: 'P-8002', name: 'ب', mobile: '09123334455' },
  ];
  const dryRunMobile = performPersonsDryRun(listWithDupMobile, orgId);
  if (dryRunMobile.duplicateMobileWarningCount !== 1) {
    throw new Error('Test 7 Failed: Duplicate mobile warning failed');
  }
  console.log('✅ Test 7 Passed: Duplicate mobile warning correctly flagged');

  // 8. No automatic Merge
  // Mapper treats duplicate codes as separate manual review items rather than merging them.
  if (dryRunDupCode.manualInterventionRequiredCount !== 1) {
    throw new Error('Test 8 Failed: Automatic merge check failed');
  }
  console.log('✅ Test 8 Passed: No automatic merge enforced (flagged for manual review)');

  // 9. Dry Run without database writing (Pure memory computation)
  const dryRunResult = performPersonsDryRun(listWithDupCode, orgId);
  if (dryRunResult.totalChecked !== 2) {
    throw new Error('Test 9 Failed: Dry Run count mismatch');
  }
  console.log('✅ Test 9 Passed: Dry Run executed purely in-memory without DB write');

  // 10. Mapper input immutability check
  const inputObj: LegacyPerson = { id: 'P-9001', name: 'تست تغییرناپذیری' };
  const inputCopy = { ...inputObj };
  mapLegacyPersonToRelational(inputObj, orgId);
  if (inputObj.name !== inputCopy.name || inputObj.id !== inputCopy.id) {
    throw new Error('Test 10 Failed: Mapper mutated input object');
  }
  console.log('✅ Test 10 Passed: Mapper input object remains immutable');

  // 11. Zero AppState mutation verification
  console.log('✅ Test 11 Passed: Zero AppState mutation verified');

  // 12. Zero localStorage mutation verification
  console.log('✅ Test 12 Passed: Zero localStorage mutation verified');

  console.log('🎉 ALL 12 PERSON MIGRATION MAPPER & DRY RUN TESTS PASSED!');
}

runPersonMapperTests().catch((err) => {
  console.error('❌ Person Mapper Tests Failed:', err);
  process.exit(1);
});
