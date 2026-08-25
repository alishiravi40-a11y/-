import {
  AuthorizationContextService,
  mapRoleCodesToUiRole,
} from '../server/auth/authorizationContextService';
import {
  createServerRoleMiddleware,
  createServerPermissionMiddleware,
  resolveUserServerRole,
  verifyServerAdminAccess,
} from '../server/auth/roleAuthorization';

/**
 * Creates a mock SupabaseClient to test AuthorizationContextService in memory without network or real DB.
 */
function createMockSupabaseClient(mockData: {
  user_profiles?: any[];
  organization_memberships?: any[];
  user_roles?: any[];
  role_permissions?: any[];
  errorOnTable?: string;
}) {
  return {
    from: (tableName: string) => {
      if (mockData.errorOnTable === tableName) {
        const errorChain: any = {
          select: () => errorChain,
          eq: () => errorChain,
          in: () => errorChain,
          single: async () => ({ data: null, error: { message: 'DB_ERROR' } }),
          then: (resolve: any) => resolve({ data: null, error: { message: 'DB_ERROR' } }),
        };
        return errorChain;
      }

      const rows = (mockData as any)[tableName] || [];

      const createQueryBuilder = (currentRows: any[]) => {
        const builder: any = {
          select: () => createQueryBuilder([...currentRows]),
          eq: (col: string, val: any) => {
            const nextRows = currentRows.filter((r) => r[col] === val);
            return createQueryBuilder(nextRows);
          },
          in: (col: string, vals: any[]) => {
            const nextRows = currentRows.filter((r) => vals.includes(r[col]));
            return createQueryBuilder(nextRows);
          },
          single: async () => {
            if (currentRows.length === 0) {
              return { data: null, error: { message: 'PGRST116: Not found' } };
            }
            return { data: currentRows[0], error: null };
          },
          then: (resolve: any, reject: any) => resolve({ data: currentRows, error: null }),
        };
        return builder;
      };

      return createQueryBuilder(rows);
    },
  } as any;
}

async function runTests() {
  console.log('------------------------------------------------------------');
  console.log('🧪 Running Test Suite: Command 7 Server Authorization Context Service');
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

  // -------------------------------------------------------------------
  // [Test 1] Mapping DB Role Codes to UI Role
  // -------------------------------------------------------------------
  console.log('\n[Test 1] Role Code to UI Role Mapping Logic');
  assert(mapRoleCodesToUiRole(['org_admin']) === 'admin', 'org_admin maps to admin');
  assert(mapRoleCodesToUiRole(['admin']) === 'admin', 'legacy admin maps to admin');
  assert(mapRoleCodesToUiRole(['financial_manager']) === 'accountant', 'financial_manager maps to accountant');
  assert(mapRoleCodesToUiRole(['accountant']) === 'accountant', 'accountant maps to accountant');
  assert(mapRoleCodesToUiRole(['cashier']) === 'cashier', 'cashier maps to cashier');
  assert(mapRoleCodesToUiRole(['seller']) === 'seller', 'seller maps to seller');
  assert(mapRoleCodesToUiRole(['sales_agent']) === 'agent', 'sales_agent maps to agent');
  assert(mapRoleCodesToUiRole(['credit_agent']) === 'agent', 'credit_agent maps to agent');
  assert(mapRoleCodesToUiRole(['agent']) === 'agent', 'legacy agent maps to agent');
  assert(mapRoleCodesToUiRole(['system_tech_admin']) === null, 'system_tech_admin maps uiRole to null');
  assert(mapRoleCodesToUiRole(['customer', 'unknown_role']) === null, 'unknown roles map uiRole to null');

  // Priority test: admin > accountant > cashier > seller > agent
  assert(mapRoleCodesToUiRole(['seller', 'accountant', 'org_admin']) === 'admin', 'Priority 1: admin wins over accountant/seller');
  assert(mapRoleCodesToUiRole(['sales_agent', 'cashier', 'financial_manager']) === 'accountant', 'Priority 2: accountant wins over cashier/agent');

  // -------------------------------------------------------------------
  // [Test 2] Invalid User ID Handling
  // -------------------------------------------------------------------
  console.log('\n[Test 2] Invalid or Empty User ID');
  const resEmpty = await AuthorizationContextService.getAuthorizationContext('');
  assert(resEmpty.status === 'user_inactive', 'Empty userId returns user_inactive status');

  // -------------------------------------------------------------------
  // [Test 3] Inactive User Profile
  // -------------------------------------------------------------------
  console.log('\n[Test 3] Inactive User Profile (user_profiles.is_active = false)');
  const clientInactiveProfile = createMockSupabaseClient({
    user_profiles: [{ id: 'usr_inactive_1', is_active: false }],
  });
  const resInactive = await AuthorizationContextService.getAuthorizationContext('usr_inactive_1', {
    customClient: clientInactiveProfile,
  });
  assert(resInactive.status === 'user_inactive', 'Inactive user profile returns user_inactive status');

  // -------------------------------------------------------------------
  // [Test 4] No Active Membership
  // -------------------------------------------------------------------
  console.log('\n[Test 4] User With No Active Organization Memberships');
  const clientNoMembership = createMockSupabaseClient({
    user_profiles: [{ id: 'usr_no_mem_1', is_active: true }],
    organization_memberships: [],
  });
  const resNoMem = await AuthorizationContextService.getAuthorizationContext('usr_no_mem_1', {
    customClient: clientNoMembership,
  });
  assert(resNoMem.status === 'no_active_membership', 'No active memberships returns no_active_membership status');

  // -------------------------------------------------------------------
  // [Test 5] Single Default Active Membership Selection
  // -------------------------------------------------------------------
  console.log('\n[Test 5] Exactly One Default Active Membership Selection');
  const clientSingleDefault = createMockSupabaseClient({
    user_profiles: [{ id: 'usr_1', is_active: true }],
    organization_memberships: [
      { id: 'mem_1', user_id: 'usr_1', organization_id: 'org_1', default_branch_id: 'br_1', is_active: true, is_default: true },
      { id: 'mem_2', user_id: 'usr_1', organization_id: 'org_2', default_branch_id: null, is_active: true, is_default: false },
    ],
    user_roles: [
      { membership_id: 'mem_1', organization_id: 'org_1', role_id: 'role_admin_id', roles: { code: 'org_admin' } },
    ],
    role_permissions: [
      { role_id: 'role_admin_id', permissions: { code: 'org:manage' } },
      { role_id: 'role_admin_id', permissions: { code: 'finance:read' } },
    ],
  });
  const resSingleDef = await AuthorizationContextService.getAuthorizationContext('usr_1', {
    customClient: clientSingleDefault,
  });
  assert(resSingleDef.status === 'authorized', 'Single default membership authorized');
  if (resSingleDef.status === 'authorized') {
    assert(resSingleDef.context.organizationId === 'org_1', 'Correct organizationId selected');
    assert(resSingleDef.context.membershipId === 'mem_1', 'Correct membershipId selected');
    assert(resSingleDef.context.uiRole === 'admin', 'Correct uiRole mapped (admin)');
    assert(resSingleDef.context.roleCodes.includes('org_admin'), 'roleCodes includes org_admin');
    assert(resSingleDef.context.permissions.includes('finance:read'), 'permissions includes finance:read');
  }

  // -------------------------------------------------------------------
  // [Test 6] Single Active Membership Without Default Flag
  // -------------------------------------------------------------------
  console.log('\n[Test 6] Single Active Membership Without Default Flag');
  const clientSingleNoDefault = createMockSupabaseClient({
    user_profiles: [{ id: 'usr_2', is_active: true }],
    organization_memberships: [
      { id: 'mem_alone', user_id: 'usr_2', organization_id: 'org_alone', default_branch_id: null, is_active: true, is_default: false },
    ],
    user_roles: [
      { membership_id: 'mem_alone', organization_id: 'org_alone', role_id: 'role_acct_id', roles: { code: 'accountant' } },
    ],
    role_permissions: [],
  });
  const resSingleNoDef = await AuthorizationContextService.getAuthorizationContext('usr_2', {
    customClient: clientSingleNoDefault,
  });
  assert(resSingleNoDef.status === 'authorized', 'Single non-default active membership selected automatically');
  if (resSingleNoDef.status === 'authorized') {
    assert(resSingleNoDef.context.uiRole === 'accountant', 'uiRole correctly mapped to accountant');
  }

  // -------------------------------------------------------------------
  // [Test 7] Multiple Default Active Memberships Conflict
  // -------------------------------------------------------------------
  console.log('\n[Test 7] Multiple Default Active Memberships (System Stays Closed)');
  const clientMultiDefault = createMockSupabaseClient({
    user_profiles: [{ id: 'usr_conflict', is_active: true }],
    organization_memberships: [
      { id: 'mem_a', user_id: 'usr_conflict', organization_id: 'org_a', is_active: true, is_default: true },
      { id: 'mem_b', user_id: 'usr_conflict', organization_id: 'org_b', is_active: true, is_default: true },
    ],
  });
  const resMultiDef = await AuthorizationContextService.getAuthorizationContext('usr_conflict', {
    customClient: clientMultiDefault,
  });
  assert(resMultiDef.status === 'invalid_organization_state', 'Multiple defaults returns invalid_organization_state');

  // -------------------------------------------------------------------
  // [Test 8] Multiple Active Memberships None Default
  // -------------------------------------------------------------------
  console.log('\n[Test 8] Multiple Active Memberships None Default (Organization Selection Required)');
  const clientMultiNoDefault = createMockSupabaseClient({
    user_profiles: [{ id: 'usr_multi', is_active: true }],
    organization_memberships: [
      { id: 'mem_x', user_id: 'usr_multi', organization_id: 'org_x', is_active: true, is_default: false },
      { id: 'mem_y', user_id: 'usr_multi', organization_id: 'org_y', is_active: true, is_default: false },
    ],
  });
  const resMultiNoDef = await AuthorizationContextService.getAuthorizationContext('usr_multi', {
    customClient: clientMultiNoDefault,
  });
  assert(resMultiNoDef.status === 'organization_selection_required', 'Returns organization_selection_required when multiple orgs active with no default');

  // -------------------------------------------------------------------
  // [Test 9] Database Service Error Handling
  // -------------------------------------------------------------------
  console.log('\n[Test 9] Database Error Handling');
  const clientDbError = createMockSupabaseClient({
    user_profiles: [{ id: 'usr_1', is_active: true }],
    errorOnTable: 'organization_memberships',
  });
  const resDbErr = await AuthorizationContextService.getAuthorizationContext('usr_1', {
    customClient: clientDbError,
  });
  assert(resDbErr.status === 'service_error', 'Database failure returns service_error status');

  // -------------------------------------------------------------------
  // [Test 10] Server Role Authorization Helpers & Middlewares
  // -------------------------------------------------------------------
  console.log('\n[Test 10] Server Role Authorization Middleware Tests');

  const adminRole = await resolveUserServerRole('usr_1', { customClient: clientSingleDefault });
  assert(adminRole === 'admin', 'resolveUserServerRole returns admin for usr_1');

  const isAdminAccess = await verifyServerAdminAccess('usr_1', { customClient: clientSingleDefault });
  assert(isAdminAccess === true, 'verifyServerAdminAccess returns true for usr_1');

  const roleMiddleware = createServerRoleMiddleware(['admin'], { customClient: clientSingleDefault });

  let nextCalled: boolean = false;
  let statusResult: number | null = null;
  let jsonResult: any = null;

  const mockReq: any = {
    authenticatedUserId: 'usr_1',
    body: { role: 'hacked_admin', organizationId: 'fake_org' },
    query: { role: 'hacked_admin' },
  };
  const mockRes: any = {
    status: (code: number) => {
      statusResult = code;
      return mockRes;
    },
    json: (payload: any) => {
      jsonResult = payload;
      return mockRes;
    },
  };
  const mockNext = () => {
    nextCalled = true;
  };

  await roleMiddleware(mockReq, mockRes, mockNext);
  assert(Boolean(nextCalled) === true, 'Role middleware allowed user with valid server admin role');
  assert(mockReq.body.role === undefined, 'Client spoofed role parameter stripped from req.body');

  // Test permission middleware
  console.log('\n[Test 11] Server Permission Middleware Tests');

  const permMiddlewareSuccess = createServerPermissionMiddleware(['finance:read'], { customClient: clientSingleDefault });
  nextCalled = false;
  await permMiddlewareSuccess(mockReq, mockRes, mockNext);
  assert(Boolean(nextCalled) === true, 'Permission middleware allowed user with required finance:read permission');

  const permMiddlewareFail = createServerPermissionMiddleware(['finance:super_secret_action'], { customClient: clientSingleDefault });
  nextCalled = false;
  statusResult = null;
  await permMiddlewareFail(mockReq, mockRes, mockNext);
  assert(nextCalled === false, 'Permission middleware blocked user lacking required permission');
  assert(statusResult === 403, 'Permission middleware returned 403 Forbidden');

  console.log('------------------------------------------------------------');
  console.log(`🎉 SERVER AUTHORIZATION CONTEXT TESTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('------------------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
