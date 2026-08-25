import { AdminBootstrapService, BootstrapAdminParams } from '../server/auth/adminBootstrapService';

export async function runAdminBootstrapServiceTests() {
  console.log('🚀 Running Admin Bootstrap Service Infrastructure Tests');

  const validParams: BootstrapAdminParams = {
    email: 'admin@system.local',
    password: 'SecurePassword123!',
    fullName: 'مدیر ارشد سیستم',
    mobile: '09123456789',
    organizationId: '11111111-1111-1111-1111-111111111111',
    branchId: '22222222-2222-2222-2222-222222222222',
  };

  // Test 1: Missing Service Role Key -> Throws explicit error
  try {
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await AdminBootstrapService.bootstrapFirstAdmin(validParams, {
      overrideServiceKey: '',
      overrideSupabaseUrl: 'https://example.supabase.co',
    });
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    throw new Error('Test 1 Failed: Should have thrown error for missing Service Role Key.');
  } catch (err: any) {
    if (!err.message.includes('SUPABASE_SERVICE_ROLE_KEY environment variable is missing')) {
      throw new Error(`Test 1 Failed with unexpected message: ${err.message}`);
    }
    console.log('✅ Test 1 Passed: Missing Service Role Key throws explicit error.');
  }

  // Test 2: Missing mandatory parameters -> Throws explicit error
  try {
    const invalidParams = { ...validParams, email: '' };
    await AdminBootstrapService.bootstrapFirstAdmin(invalidParams, {
      overrideServiceKey: 'mock_service_key',
      overrideSupabaseUrl: 'https://example.supabase.co',
    });
    throw new Error('Test 2 Failed: Should have thrown error for missing email.');
  } catch (err: any) {
    if (!err.message.includes('Email is required')) {
      throw new Error(`Test 2 Failed with unexpected message: ${err.message}`);
    }
    console.log('✅ Test 2 Passed: Missing mandatory parameter throws explicit error.');
  }

  // Test 3: Existing admin present -> Prevents bootstrap re-execution ('BOOTSTRAP_ALREADY_COMPLETED')
  try {
    const mockClientWithExistingAdmin: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [{ id: 'existing_role_id' }], error: null }),
          }),
        }),
      }),
    };

    await AdminBootstrapService.bootstrapFirstAdmin(validParams, {
      overrideServiceKey: 'mock_service_key',
      overrideSupabaseUrl: 'https://example.supabase.co',
      customClient: mockClientWithExistingAdmin,
    });
    throw new Error('Test 3 Failed: Promised resolved despite existing admin.');
  } catch (err: any) {
    if (!err.message.includes('BOOTSTRAP_ALREADY_COMPLETED')) {
      throw new Error(`Test 3 Failed: ${err.message}`);
    }
    console.log('✅ Test 3 Passed: Existing admin prevents re-execution.');
  }

  // Test 4: Auth user creation failure -> Domain setup is not attempted
  try {
    let rpcAttempted = false;
    const mockClientAuthFailure: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      auth: {
        admin: {
          createUser: async () => ({ data: null, error: { message: 'Invalid email format' } }),
        },
      },
      rpc: async () => {
        rpcAttempted = true;
        return { data: null, error: null };
      },
    };

    await AdminBootstrapService.bootstrapFirstAdmin(validParams, {
      overrideServiceKey: 'mock_service_key',
      overrideSupabaseUrl: 'https://example.supabase.co',
      customClient: mockClientAuthFailure,
    });
    throw new Error('Test 4 Failed: Should have failed auth creation.');
  } catch (err: any) {
    if (!err.message.includes('BOOTSTRAP_AUTH_FAILED')) {
      throw new Error(`Test 4 Failed unexpected error: ${err.message}`);
    }
    console.log('✅ Test 4 Passed: Auth failure stops process before domain setup.');
  }

  // Test 5: Domain setup failure after Auth creation -> Compensating deleteUser is triggered
  let deleteUserCalledWith: string | null = null;
  try {
    const mockClientDomainFailure: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'auth_user_999' } }, error: null }),
          deleteUser: async (id: string) => {
            deleteUserCalledWith = id;
            return { data: {}, error: null };
          },
        },
      },
      rpc: async () => ({ data: null, error: { message: 'INVALID_BRANCH' } }),
    };

    await AdminBootstrapService.bootstrapFirstAdmin(validParams, {
      overrideServiceKey: 'mock_service_key',
      overrideSupabaseUrl: 'https://example.supabase.co',
      customClient: mockClientDomainFailure,
    });
    throw new Error('Test 5 Failed: Should have thrown domain setup failure.');
  } catch (err: any) {
    if (deleteUserCalledWith !== 'auth_user_999') {
      throw new Error(`Test 5 Failed: Compensating deleteUser was not called with created user ID! Got: ${deleteUserCalledWith}`);
    }
    if (!err.message.includes('BOOTSTRAP_DOMAIN_FAILED')) {
      throw new Error(`Test 5 Failed unexpected error: ${err.message}`);
    }
    console.log('✅ Test 5 Passed: Domain failure triggers compensating auth.deleteUser.');
  }

  // Test 6: Verify Service Role Key is absent from VITE_ client bundle
  const metaEnv = (import.meta as any).env || {};
  const viteKeys = Object.keys(metaEnv).filter(k => k.includes('SERVICE_ROLE'));
  if (viteKeys.length > 0) {
    throw new Error(`Test 6 Failed: Service Role Key detected in VITE_ env: ${viteKeys.join(', ')}`);
  }
  console.log('✅ Test 6 Passed: Service Role Key is absent from VITE_ client bundle.');

  // Test 7: Successful Bootstrap Flow with Mock Client
  try {
    const mockClientSuccess: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'auth_user_real_uuid' } }, error: null }),
        },
      },
      rpc: async (fnName: string, args: any) => {
        if (fnName === 'bootstrap_first_org_admin' && args.p_user_id === 'auth_user_real_uuid') {
          return { data: 'membership_uuid_123', error: null };
        }
        return { data: null, error: { message: 'Unknown RPC' } };
      },
    };

    const res = await AdminBootstrapService.bootstrapFirstAdmin(validParams, {
      overrideServiceKey: 'mock_service_key',
      overrideSupabaseUrl: 'https://example.supabase.co',
      customClient: mockClientSuccess,
    });

    if (!res.success || res.userId !== 'auth_user_real_uuid' || res.membershipId !== 'membership_uuid_123') {
      throw new Error('Test 7 Failed: Result payload does not match expected output.');
    }
    console.log('✅ Test 7 Passed: Successful atomic bootstrap flow verified via mock client.');
  } catch (err: any) {
    throw new Error(`Test 7 Failed: ${err.message}`);
  }

  // Test 8: Domain failure + Failed compensating deleteUser -> Throws BOOTSTRAP_CRITICAL_ORPHAN
  try {
    const mockClientCompensatingFailure: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      auth: {
        admin: {
          createUser: async () => ({ data: { user: { id: 'auth_user_orphan_777' } }, error: null }),
          deleteUser: async () => ({ data: null, error: { message: 'Network connection lost' } }),
        },
      },
      rpc: async () => ({ data: null, error: { message: 'DB_CONSTRAINT_VIOLATION' } }),
    };

    await AdminBootstrapService.bootstrapFirstAdmin(validParams, {
      overrideServiceKey: 'mock_service_key',
      overrideSupabaseUrl: 'https://example.supabase.co',
      customClient: mockClientCompensatingFailure,
    });
    throw new Error('Test 8 Failed: Should have thrown BOOTSTRAP_CRITICAL_ORPHAN.');
  } catch (err: any) {
    if (!err.message.includes('BOOTSTRAP_CRITICAL_ORPHAN') || !err.message.includes('auth_user_orphan_777')) {
      throw new Error(`Test 8 Failed unexpected error: ${err.message}`);
    }
    console.log('✅ Test 8 Passed: Failed compensating rollback explicitly reports BOOTSTRAP_CRITICAL_ORPHAN with orphaned user ID.');
  }

  // Test 9: Bootstrap with existing userId (does NOT trigger createUser, preserves user on domain failure)
  try {
    let createUserCalled = false;
    let deleteUserCalled = false;
    const existingUserId = '00fba501-ad6d-4abf-b8d0-fe76cca18672';

    const mockClientExistingUserFailure: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      auth: {
        admin: {
          createUser: async () => {
            createUserCalled = true;
            return { data: { user: { id: 'should_not_be_created' } }, error: null };
          },
          deleteUser: async () => {
            deleteUserCalled = true;
            return { data: {}, error: null };
          },
        },
      },
      rpc: async () => ({ data: null, error: { message: 'DB_DUPLICATE' } }),
    };

    const existingUserParams: BootstrapAdminParams = {
      userId: existingUserId,
      fullName: 'علی شیروی',
      mobile: '09131128163',
      orgName: 'درناتل',
      branchName: 'الماس شهر',
      fiscalYearTitle: '۱۴۰۵',
      startDate: '2026-03-21',
      endDate: '2027-03-20',
    };

    await AdminBootstrapService.bootstrapFirstAdmin(existingUserParams, {
      overrideServiceKey: 'mock_service_key',
      overrideSupabaseUrl: 'https://example.supabase.co',
      customClient: mockClientExistingUserFailure,
    });
    throw new Error('Test 9 Failed: Should have thrown domain error for existing user.');
  } catch (err: any) {
    if (!err.message.includes('BOOTSTRAP_DOMAIN_FAILED') || !err.message.includes('Pre-existing user was preserved')) {
      throw new Error(`Test 9 Failed with unexpected error: ${err.message}`);
    }
    console.log('✅ Test 9 Passed: Existing userId path bypasses createUser and preserves user on domain error.');
  }

  // Test 10: Successful Bootstrap with existing userId and Org/Branch/FiscalYear parameters
  try {
    let rpcPassedArgs: any = null;
    const existingUserId = '00fba501-ad6d-4abf-b8d0-fe76cca18672';

    const mockClientExistingUserSuccess: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      auth: { admin: {} },
      rpc: async (fnName: string, args: any) => {
        if (fnName === 'bootstrap_first_org_admin') {
          rpcPassedArgs = args;
          return { data: 'membership_dornatel_123', error: null };
        }
        return { data: null, error: { message: 'Unknown RPC' } };
      },
    };

    const existingUserParams: BootstrapAdminParams = {
      userId: existingUserId,
      fullName: 'علی شیروی',
      mobile: '09131128163',
      orgName: 'درناتل',
      branchCode: 'ALMAS',
      branchName: 'الماس شهر',
      fiscalYearTitle: '۱۴۰۵',
      startDate: '2026-03-21',
      endDate: '2027-03-20',
    };

    const res = await AdminBootstrapService.bootstrapFirstAdmin(existingUserParams, {
      overrideServiceKey: 'mock_service_key',
      overrideSupabaseUrl: 'https://example.supabase.co',
      customClient: mockClientExistingUserSuccess,
    });

    if (!res.success || res.userId !== existingUserId || res.membershipId !== 'membership_dornatel_123') {
      throw new Error('Test 10 Failed: Result payload does not match expected output.');
    }
    if (
      rpcPassedArgs.p_user_id !== existingUserId ||
      rpcPassedArgs.p_org_name !== 'درناتل' ||
      rpcPassedArgs.p_branch_name !== 'الماس شهر' ||
      rpcPassedArgs.p_fiscal_year_title !== '۱۴۰۵'
    ) {
      throw new Error('Test 10 Failed: RPC arguments do not match provided parameters.');
    }
    console.log('✅ Test 10 Passed: Successful bootstrap with existing userId and Org/Branch/FiscalYear parameters verified.');
  } catch (err: any) {
    throw new Error(`Test 10 Failed: ${err.message}`);
  }

  console.log('🎉 ALL ADMIN BOOTSTRAP SERVICE INFRASTRUCTURE TESTS PASSED!');
}

runAdminBootstrapServiceTests().catch((e) => {
  console.error('❌ AdminBootstrapService Tests Failed:', e);
  process.exit(1);
});
