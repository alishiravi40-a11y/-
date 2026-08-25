import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PersonService, mapDbRecordToPerson, mapPersonToApiPayload } from '../services/personService';

console.log('=== Running PersonService Contract, Mapping & Boundary Tests ===');

// 1. Test Field Mapping: camelCase <-> snake_case
const sampleDbRecord: any = {
  id: '00000000-0000-0000-0000-000000000001',
  code: 'P1001',
  name: 'علی شیروانی',
  person_type: 'real',
  national_id: '1234567890',
  mobile: '09123456789',
  phone: '02188888888',
  status: 'active',
  role: 'both',
  province: 'تهران',
  city: 'تهران',
  credit_limit: 50000000,
  credit_score: 85,
  is_agent: true,
  is_documents_approved: true,
  created_at: '2026-08-15T00:00:00.000Z',
  updated_at: '2026-08-15T00:00:00.000Z'
};

const mappedPerson = mapDbRecordToPerson(sampleDbRecord);
assert.equal(mappedPerson.id, '00000000-0000-0000-0000-000000000001');
assert.equal(mappedPerson.code, 'P1001');
assert.equal(mappedPerson.name, 'علی شیروانی');
assert.equal(mappedPerson.nationalId, '1234567890');
assert.equal(mappedPerson.mobile, '09123456789');
assert.equal(mappedPerson.creditLimit, 50000000);
assert.equal(mappedPerson.creditScore, 85);
assert.equal(mappedPerson.isAgent, true);
assert.equal(mappedPerson.isDocumentsApproved, true);
console.log('✅ Test 1 Passed: mapDbRecordToPerson correctly translates snake_case to camelCase');

const payload = mapPersonToApiPayload(mappedPerson, 2);
assert.equal(payload.id, '00000000-0000-0000-0000-000000000001');
assert.equal(payload.code, 'P1001');
assert.equal(payload.name, 'علی شیروانی');
assert.equal(payload.national_id, '1234567890');
assert.equal(payload.mobile, '09123456789');
assert.equal(payload.credit_limit, 50000000);
assert.equal(payload.credit_score, 85);
assert.equal(payload.is_agent, true);
assert.equal(payload.expected_version, 2);
console.log('✅ Test 2 Passed: mapPersonToApiPayload correctly translates camelCase to snake_case payload');

// 2. Test Error Sanitization & Handling
async function testServiceErrorHandling() {
  const testPort = process.env.PORT || '3000';
  PersonService.setBaseUrl(`http://127.0.0.1:${testPort}`);
  // Test with invalid token against running dev server
  try {
    await PersonService.getPersons('invalid_token_xyz');
    assert.fail('Should have thrown 401 error');
  } catch (err: any) {
    assert.equal(err.status, 401);
    assert.ok(err.message.includes('نشست کاری'));
    console.log('✅ Test 3 Passed: 401 Unauthorized returns sanitized, Persian user message');
  }
}

testServiceErrorHandling().then(() => {
  console.log('\n============================================================');
  console.log('🎉 ALL PERSON SERVICE CONTRACT & MAPPING TESTS PASSED!');
  console.log('============================================================\n');
}).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
