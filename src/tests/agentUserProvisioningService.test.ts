import {
  AgentUserProvisioningService,
  generateSecurePassword,
  ProvisionAgentUserParams,
} from '../server/auth/agentUserProvisioningService';

export async function runAgentUserProvisioningServiceTests() {
  console.log('🚀 Running Agent User Provisioning Service Unit & Regression Tests');

  // Test 1: Password generator produces secure 12-char random passwords
  {
    const pwd1 = generateSecurePassword(12);
    const pwd2 = generateSecurePassword(12);
    if (pwd1.length !== 12 || pwd2.length !== 12) {
      throw new Error(`Test 1 Failed: Expected password length 12, got ${pwd1.length}`);
    }
    if (pwd1 === pwd2) {
      throw new Error('Test 1 Failed: Passwords must be randomly generated and unique.');
    }
    console.log('✅ Test 1 Passed: Secure random password generator functions properly.');
  }

  // Test 2: Skip provisioning if person is not an agent
  {
    const nonAgentPerson = {
      id: 'p_101',
      name: 'مشتری عادی',
      mobile: '09121112233',
      is_agent: false,
      owner_user_id: null,
    };
    const result = await AgentUserProvisioningService.provisionAgentUserAccount({
      person: nonAgentPerson,
      organizationId: 'org_test_1',
      grantedByUserId: 'admin_1',
    });
    if (!result.success || result.generatedPassword) {
      throw new Error('Test 2 Failed: Non-agent person should not trigger password generation.');
    }
    console.log('✅ Test 2 Passed: Non-agent person is ignored without provisioning.');
  }

  // Test 3: Skip provisioning if person already has an owner_user_id
  {
    const existingAgentPerson = {
      id: 'p_102',
      name: 'نماینده موجود',
      mobile: '09121112244',
      is_agent: true,
      owner_user_id: 'usr_already_linked',
    };
    const result = await AgentUserProvisioningService.provisionAgentUserAccount({
      person: existingAgentPerson,
      organizationId: 'org_test_1',
      grantedByUserId: 'admin_1',
    });
    if (!result.success || result.generatedPassword) {
      throw new Error('Test 3 Failed: Person with existing owner_user_id should not re-provision.');
    }
    console.log('✅ Test 3 Passed: Existing agent with owner_user_id is skipped.');
  }

  // Test 4: Rejects agent without mobile number
  {
    const noMobileAgent = {
      id: 'p_103',
      name: 'نماینده بدون موبایل',
      mobile: '',
      is_agent: true,
      owner_user_id: null,
    };
    const result = await AgentUserProvisioningService.provisionAgentUserAccount({
      person: noMobileAgent,
      organizationId: 'org_test_1',
      grantedByUserId: 'admin_1',
    });
    if (result.success || result.error !== 'ERR_AGENT_MOBILE_REQUIRED') {
      throw new Error('Test 4 Failed: Agent without mobile should return ERR_AGENT_MOBILE_REQUIRED.');
    }
    console.log('✅ Test 4 Passed: Agent without mobile is rejected with clear error.');
  }

  // Test 5: Rejects duplicate mobile number registered in user_profiles
  {
    const duplicateMobileAgent = {
      id: 'p_104',
      name: 'نماینده تکراری',
      mobile: '09123456789',
      is_agent: true,
      owner_user_id: null,
    };

    const mockClientWithDuplicate: any = {
      from: (table: string) => {
        if (table === 'user_profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'usr_existing_123', full_name: 'کاربر دیگر', mobile: '09123456789' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      },
    };

    const result = await AgentUserProvisioningService.provisionAgentUserAccount({
      person: duplicateMobileAgent,
      organizationId: 'org_test_1',
      grantedByUserId: 'admin_1',
      customClient: mockClientWithDuplicate,
    });

    if (result.success || result.error !== 'ERR_DUPLICATE_USER_MOBILE') {
      throw new Error(`Test 5 Failed: Expected ERR_DUPLICATE_USER_MOBILE, got ${result.error}`);
    }
    console.log('✅ Test 5 Passed: Duplicate user mobile returns ERR_DUPLICATE_USER_MOBILE.');
  }

  // Test 6: Full successful provisioning flow with role assignment
  {
    const validAgentPerson = {
      id: 'p_105',
      name: 'نماینده فروش جدید',
      mobile: '09351234567',
      national_id: '0012345678',
      is_agent: true,
      owner_user_id: null,
    };

    let createdAuthUser: any = null;
    let insertedProfile: any = null;
    let insertedMembership: any = null;
    let insertedRole: any = null;
    let updatedPersonRecord: any = null;

    const mockClientSuccess: any = {
      auth: {
        admin: {
          createUser: async (payload: any) => {
            createdAuthUser = { id: 'usr_new_agent_999', ...payload };
            return { data: { user: createdAuthUser }, error: null };
          },
          deleteUser: async () => ({ data: null, error: null }),
        },
      },
      from: (table: string) => {
        if (table === 'user_profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            insert: async (data: any) => {
              insertedProfile = data;
              return { data, error: null };
            },
          };
        }
        if (table === 'organization_memberships') {
          return {
            insert: (data: any) => ({
              select: () => ({
                single: async () => {
                  insertedMembership = { id: 'memb_999', ...data };
                  return { data: insertedMembership, error: null };
                },
              }),
            }),
          };
        }
        if (table === 'roles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'role_credit_agent_id', code: 'credit_agent' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'user_roles') {
          return {
            insert: async (data: any) => {
              insertedRole = data;
              return { data, error: null };
            },
          };
        }
        if (table === 'persons') {
          return {
            update: (data: any) => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => {
                      updatedPersonRecord = { ...validAgentPerson, ...data };
                      return { data: updatedPersonRecord, error: null };
                    },
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    };

    const result = await AgentUserProvisioningService.provisionAgentUserAccount({
      person: validAgentPerson,
      organizationId: 'org_test_1',
      grantedByUserId: 'admin_1',
      agencyRole: 'credit',
      customClient: mockClientSuccess,
    });

    if (!result.success) {
      throw new Error(`Test 6 Failed: Expected success, got error: ${result.error} - ${result.message}`);
    }
    if (!result.generatedPassword || result.generatedPassword.length !== 12) {
      throw new Error('Test 6 Failed: Missing generatedPassword in result.');
    }
    if (result.loginIdentifier !== '09351234567') {
      throw new Error(`Test 6 Failed: Expected loginIdentifier 09351234567, got ${result.loginIdentifier}`);
    }
    if (!insertedProfile || insertedProfile.id !== 'usr_new_agent_999') {
      throw new Error('Test 6 Failed: user_profiles record not inserted properly.');
    }
    if (!insertedMembership || insertedMembership.user_id !== 'usr_new_agent_999') {
      throw new Error('Test 6 Failed: organization_memberships record not inserted.');
    }
    if (!insertedRole || insertedRole.role_id !== 'role_credit_agent_id') {
      throw new Error('Test 6 Failed: user_roles record not created with credit_agent.');
    }
    if (!updatedPersonRecord || updatedPersonRecord.owner_user_id !== 'usr_new_agent_999') {
      throw new Error('Test 6 Failed: persons.owner_user_id was not updated.');
    }

    console.log('✅ Test 6 Passed: Full automatic agent user provisioning completed successfully.');
  }

  // Test 7: Rollback cleans up auth user on database failure
  {
    const rollbackAgentPerson = {
      id: 'p_106',
      name: 'نماینده رول‌بک',
      mobile: '09129998877',
      is_agent: true,
      owner_user_id: null,
    };

    let userDeleted = false;

    const mockClientWithFailure: any = {
      auth: {
        admin: {
          createUser: async (payload: any) => ({
            data: { user: { id: 'usr_fail_123', ...payload } },
            error: null,
          }),
          deleteUser: async (uid: string) => {
            if (uid === 'usr_fail_123') userDeleted = true;
            return { data: null, error: null };
          },
        },
      },
      from: (table: string) => {
        if (table === 'user_profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
            insert: async () => {
              // Simulated database error
              return { data: null, error: { message: 'Database disk error' } };
            },
            delete: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          };
        }
        if (table === 'organization_memberships' || table === 'user_roles') {
          return {
            delete: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          };
        }
        return {};
      },
    };

    const result = await AgentUserProvisioningService.provisionAgentUserAccount({
      person: rollbackAgentPerson,
      organizationId: 'org_test_1',
      grantedByUserId: 'admin_1',
      customClient: mockClientWithFailure,
    });

    if (result.success) {
      throw new Error('Test 7 Failed: Expected failure due to simulated DB error.');
    }
    if (!userDeleted) {
      throw new Error('Test 7 Failed: Auth user was not rolled back / deleted after error.');
    }

    console.log('✅ Test 7 Passed: Rollback logic successfully cleans up created user on downstream error.');
  }

  console.log('🎉 All Agent User Provisioning Service Tests Passed Successfully!');
}

runAgentUserProvisioningServiceTests().catch((e) => {
  console.error('❌ AgentUserProvisioningService Tests Failed:', e);
  process.exit(1);
});
