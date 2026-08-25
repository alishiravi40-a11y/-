import { AuthContextService } from '../services/authContextService';

function createMockResponse(status: number, bodyObj?: any): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => bodyObj,
  } as Response;
}

async function runClientAuthContextTests() {
  console.log('------------------------------------------------------------');
  console.log('🧪 Running Test Suite: Command 7 Client Auth Context Service');
  console.log('------------------------------------------------------------');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, description: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${description}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${description}`);
      failed++;
    }
  }

  // Backup storage state to verify zero mutations
  const initialLocalKeysCount = typeof localStorage !== 'undefined' ? localStorage.length : 0;
  const initialSessionKeysCount = typeof sessionStorage !== 'undefined' ? sessionStorage.length : 0;

  // -------------------------------------------------------------------
  // [Test 1] Successful Fetch & Memory Storage
  // -------------------------------------------------------------------
  console.log('\n[Test 1] Successful Authorization Context Fetch');

  const mockCustomFetchSuccess = async (url: string, init?: any): Promise<Response> => {
    return createMockResponse(200, {
      status: 'authorized',
      userId: 'usr_valid_123',
      membershipId: 'mem_valid_123',
      organizationId: 'org_valid_123',
      defaultBranchId: 'br_123',
      roleCodes: ['org_admin'],
      permissions: ['finance:read', 'finance:write'],
      uiRole: 'admin',
    });
  };

  const clientService = new AuthContextService();
  const resSuccess = await clientService.fetchAuthContext('usr_valid_123', {
    customFetch: mockCustomFetchSuccess as any,
  });

  assert(resSuccess.status === 'authorized', 'Fetch returned authorized status');
  assert(clientService.getUiRole() === 'admin', 'getUiRole() returned admin');
  assert(clientService.getAuthContext()?.organizationId === 'org_valid_123', 'In-memory organizationId stored');
  assert(clientService.getAuthContext()?.membershipId === 'mem_valid_123', 'In-memory membershipId stored');

  // -------------------------------------------------------------------
  // [Test 2] Identity Mismatch Protection
  // -------------------------------------------------------------------
  console.log('\n[Test 2] Identity Mismatch Protection (expectedUserId !== returned userId)');

  const mockFetchMismatch = async (): Promise<Response> => {
    return createMockResponse(200, {
      status: 'authorized',
      userId: 'usr_ATTACKER',
      membershipId: 'mem_valid_123',
      organizationId: 'org_valid_123',
      uiRole: 'admin',
    });
  };

  const resMismatch = await clientService.fetchAuthContext('usr_VICTIM', {
    customFetch: mockFetchMismatch as any,
  });

  assert(resMismatch.status === 'unauthorized', 'Identity mismatch rejected as unauthorized');
  assert(clientService.getUiRole() === null, 'In-memory uiRole cleared to null on mismatch');
  assert(clientService.getAuthContext() === null, 'In-memory context cleared on mismatch');

  // -------------------------------------------------------------------
  // [Test 3] HTTP Error Code Handling (401, 403, 409, 503)
  // -------------------------------------------------------------------
  console.log('\n[Test 3] HTTP Error Code Responses');

  const mockFetch401 = async () => createMockResponse(401, { error: 'Unauthorized' });
  const res401 = await clientService.fetchAuthContext('usr_1', { customFetch: mockFetch401 as any });
  assert(res401.status === 'unauthorized', '401 response mapped to unauthorized');

  const mockFetch403 = async () => createMockResponse(403, { error: 'Forbidden' });
  const res403 = await clientService.fetchAuthContext('usr_1', { customFetch: mockFetch403 as any });
  assert(res403.status === 'forbidden', '403 response mapped to forbidden');

  const mockFetch409 = async () => createMockResponse(409, { error: 'ORGANIZATION_SELECTION_REQUIRED' });
  const res409 = await clientService.fetchAuthContext('usr_1', { customFetch: mockFetch409 as any });
  assert(res409.status === 'organization_selection_required', '409 response mapped to organization_selection_required');

  const mockFetch503 = async () => createMockResponse(503, { error: 'Service Unavailable' });
  const res503 = await clientService.fetchAuthContext('usr_1', { customFetch: mockFetch503 as any });
  assert(res503.status === 'service_unavailable', '503 response mapped to service_unavailable');

  // -------------------------------------------------------------------
  // [Test 4] Invalid Payload Structure
  // -------------------------------------------------------------------
  console.log('\n[Test 4] Malformed Payload Handling');

  const mockFetchMalformed = async () => createMockResponse(200, { status: 'authorized', userId: 'usr_1' /* missing membershipId */ });
  const resMalformed = await clientService.fetchAuthContext('usr_1', { customFetch: mockFetchMalformed as any });
  assert(resMalformed.status === 'error', 'Malformed payload rejected with error');
  assert(clientService.getUiRole() === null, 'In-memory uiRole remains null');

  // -------------------------------------------------------------------
  // [Test 5] Clear Function
  // -------------------------------------------------------------------
  console.log('\n[Test 5] Manual Clear State');
  await clientService.fetchAuthContext('usr_valid_123', { customFetch: mockCustomFetchSuccess as any });
  assert(clientService.getUiRole() === 'admin', 'Populated state verified');
  clientService.clear();
  assert(clientService.getAuthContext() === null, 'Context cleared successfully');
  assert(clientService.getUiRole() === null, 'uiRole cleared successfully');

  // -------------------------------------------------------------------
  // [Test 6] Storage Mutation Verification
  // -------------------------------------------------------------------
  console.log('\n[Test 6] Zero Storage Mutation Check');
  const finalLocalKeysCount = typeof localStorage !== 'undefined' ? localStorage.length : 0;
  const finalSessionKeysCount = typeof sessionStorage !== 'undefined' ? sessionStorage.length : 0;

  assert(initialLocalKeysCount === finalLocalKeysCount, 'Zero localStorage keys added or mutated');
  assert(initialSessionKeysCount === finalSessionKeysCount, 'Zero sessionStorage keys added or mutated');

  console.log('------------------------------------------------------------');
  console.log(`🎉 CLIENT AUTH CONTEXT TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('------------------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runClientAuthContextTests();
