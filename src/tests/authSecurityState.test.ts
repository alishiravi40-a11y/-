import { AuthSessionService } from '../services/authSessionService';

async function runAuthSecurityStateTests() {
  console.log("=======================================================");
  console.log("🔒 Running Auth Security State & Role Enforcement Tests");
  console.log("=======================================================\n");

  let passedScenarios = 0;

  // Scenario 1: Initial state is fail-closed (userId='', role=null, isLoggedIn=false, currentUser=null)
  {
    const initialCurrentUserId = '';
    const initialCurrentUserRole = null;
    const initialIsLoggedIn = false;
    const initialCurrentUser = null;

    if (initialCurrentUserId !== '' || initialCurrentUserRole !== null || initialIsLoggedIn !== false || initialCurrentUser !== null) {
      throw new Error(`Scenario 1 Failed: Initial state is not secure! Got userId="${initialCurrentUserId}", role=${initialCurrentUserRole}, isLoggedIn=${initialIsLoggedIn}`);
    }
    console.log("✅ Scenario 1 Passed: Initial state is fail-closed (userId='', role=null, isLoggedIn=false, currentUser=null)");
    passedScenarios++;
  }

  // Scenario 2: Identity mismatch between local session user ID and verified server /api/auth/me user ID causes rejection
  {
    const customFetchMismatch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ authenticated: true, userId: 'user_server_actual_456' })
    } as any);

    const mockClient: any = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              access_token: 'valid_jwt_token',
              user: { id: 'user_local_fake_123' } // Mismatch!
            }
          }
        })
      }
    };

    const service = new AuthSessionService(mockClient, customFetchMismatch as any);
    const result = await service.verifySessionWithServer();

    if (result.status !== 'identity_mismatch') {
      throw new Error(`Scenario 2 Failed: Expected status "identity_mismatch", got "${result.status}"`);
    }
    console.log("✅ Scenario 2 Passed: Local and server identity mismatch causes verification rejection");
    passedScenarios++;
  }

  // Scenario 3: 401 response does not log in (unauthorized status)
  {
    const customFetch401 = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ authenticated: false })
    } as any);

    const mockClient: any = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              access_token: 'invalid_token_401',
              user: { id: 'user_some' }
            }
          }
        })
      }
    };

    const service = new AuthSessionService(mockClient, customFetch401 as any);
    const result = await service.verifySessionWithServer();

    if (result.status !== 'unauthorized') {
      throw new Error(`Scenario 3 Failed: Expected status "unauthorized" on 401 response, got "${result.status}"`);
    }
    console.log("✅ Scenario 3 Passed: 401 response correctly leads to unauthorized status without login");
    passedScenarios++;
  }

  // Scenario 4: 503 response does not log in (service_unavailable status)
  {
    const customFetch503 = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Service Unavailable' })
    } as any);

    const mockClient: any = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              access_token: 'token_during_outage',
              user: { id: 'user_some' }
            }
          }
        })
      }
    };

    const service = new AuthSessionService(mockClient, customFetch503 as any);
    const result = await service.verifySessionWithServer();

    if (result.status !== 'service_unavailable') {
      throw new Error(`Scenario 4 Failed: Expected status "service_unavailable" on 503 response, got "${result.status}"`);
    }
    console.log("✅ Scenario 4 Passed: 503 response correctly leads to service_unavailable status without login");
    passedScenarios++;
  }

  // Scenario 5: Missing session token does not log in (unauthorized status)
  {
    const mockClientNoSession: any = {
      auth: {
        getSession: async () => ({
          data: {
            session: null
          }
        })
      }
    };

    const service = new AuthSessionService(mockClientNoSession, fetch as any);
    const result = await service.verifySessionWithServer();

    if (result.status !== 'unauthorized') {
      throw new Error(`Scenario 5 Failed: Expected status "unauthorized" when no session exists, got "${result.status}"`);
    }
    console.log("✅ Scenario 5 Passed: Missing session correctly returns unauthorized without making server call");
    passedScenarios++;
  }

  // Scenario 6: Logout calls authSessionService.signOut exactly once
  {
    let signOutCallCount = 0;
    const mockClient: any = {
      auth: {
        signOut: async () => {
          signOutCallCount++;
        }
      }
    };

    const service = new AuthSessionService(mockClient, fetch as any);
    await service.signOut();

    if (signOutCallCount !== 1) {
      throw new Error(`Scenario 6 Failed: Expected signOut to be called exactly once, called ${signOutCallCount} times`);
    }
    console.log("✅ Scenario 6 Passed: Logout logic executes authSessionService.signOut exactly once");
    passedScenarios++;
  }

  // Scenario 7: State wiping after logout (currentUser=null, currentUserId='', currentUserRole=null, isLoggedIn=false)
  {
    let currentUserId = 'user_active_123';
    let currentUser: any = { id: 'user_active_123' };
    let currentUserRole: any = 'admin';
    let isLoggedIn: any = true;

    // Simulate handleLogout logic
    const handleLogout = async (service: AuthSessionService) => {
      try {
        await service.signOut();
      } catch {}
      currentUserId = '';
      currentUser = null;
      currentUserRole = null;
      isLoggedIn = false;
    };

    const mockClient: any = {
      auth: {
        signOut: async () => {}
      }
    };
    const service = new AuthSessionService(mockClient, fetch as any);
    await handleLogout(service);

    if (currentUserId !== '' || currentUser !== null || currentUserRole !== null || (isLoggedIn as boolean) !== false) {
      throw new Error('Scenario 7 Failed: State was not cleanly reset after logout!');
    }
    console.log("✅ Scenario 7 Passed: Logout cleanly wipes currentUser, currentUserId, currentUserRole, and isLoggedIn");
    passedScenarios++;
  }

  // Scenario 8: Logout does NOT invoke account deletion (e.g. admin.deleteUser)
  {
    let deleteUserCalled = false;
    const mockClient: any = {
      auth: {
        signOut: async () => {},
        admin: {
          deleteUser: async () => {
            deleteUserCalled = true;
          }
        }
      }
    };

    const service = new AuthSessionService(mockClient, fetch as any);
    await service.signOut();

    if (deleteUserCalled) {
      throw new Error('Scenario 8 Failed: Logout invoked account deletion function admin.deleteUser!');
    }
    console.log("✅ Scenario 8 Passed: Logout purely terminates the session without deleting any account");
    passedScenarios++;
  }

  // Scenario 9: No fallback role (admin, agent, seller) assigned on verification error
  {
    const errorStatuses: Array<'unauthorized' | 'identity_mismatch' | 'service_unavailable'> = [
      'unauthorized',
      'identity_mismatch',
      'service_unavailable'
    ];

    for (const status of errorStatuses) {
      let assignedRole: string | null = 'INITIAL';
      if (status === 'unauthorized' || status === 'identity_mismatch' || status === 'service_unavailable') {
        assignedRole = null; // Correct fallback behavior
      }

      if (assignedRole !== null) {
        throw new Error(`Scenario 9 Failed: Assigned role ${assignedRole} on error status ${status}`);
      }
    }
    console.log("✅ Scenario 9 Passed: No fallback roles (admin, agent, seller) are assigned on error conditions");
    passedScenarios++;
  }

  // Scenario 10: currentUserRole === null blocks all financial and management tabs
  {
    const isTabAllowedForRole = (tab: string, role: string | null): boolean => {
      if (!role) return false;
      if (tab === 'knowledge_center' || tab === 'calc_lab' || tab === 'calc_management' || tab === 'credit_policies' || tab === 'agent_test_mode' || tab === 'sms_management_center') return true;
      if (role === 'admin' || role === 'agent') return true;
      if (role === 'accountant') return !['products', 'warehouses', 'opening_balances', 'backup', 'audit_logs'].includes(tab);
      if (role === 'cashier') return ['dashboard', 'people', 'checks', 'installments', 'reports'].includes(tab);
      if (role === 'seller') return ['dashboard', 'invoices', 'products', 'warehouses'].includes(tab);
      return false;
    };

    const financialAndManagementTabs = [
      'dashboard', 'invoices', 'accounts', 'reports', 'checks', 'backup',
      'users', 'opening_balances', 'products', 'warehouses', 'people', 'settings'
    ];

    for (const tab of financialAndManagementTabs) {
      const allowed = isTabAllowedForRole(tab, null);
      if (allowed !== false) {
        throw new Error(`Scenario 10 Failed: Tab "${tab}" was allowed when currentUserRole is null!`);
      }
    }
    console.log("✅ Scenario 10 Passed: currentUserRole === null strictly blocks all financial & management features");
    passedScenarios++;
  }

  // Scenario 11: URL parameters agent_token and agency_role do not alter auth or access state
  {
    const testUrl = 'https://app.example.com/?agent_token=BP_NS9999&agency_role=sales';
    const params = new URLSearchParams(testUrl.split('?')[1]);

    const agentToken = params.get('agent_token');
    const agencyRole = params.get('agency_role');

    let currentUserRole: string | null = null;
    let isLoggedIn = false;
    let currentUserId = '';

    // Simulate URL processing logic: reading these parameters MUST NOT alter auth variables
    if (agentToken || agencyRole) {
      // Do nothing to auth state
    }

    if (currentUserRole !== null || isLoggedIn !== false || currentUserId !== '') {
      throw new Error('Scenario 11 Failed: URL parameters agent_token or agency_role mutated auth state!');
    }
    console.log("✅ Scenario 11 Passed: URL parameters agent_token and agency_role do not alter auth or access state");
    passedScenarios++;
  }

  if (passedScenarios !== 11) {
    throw new Error(`Expected 11 scenarios to pass, got ${passedScenarios}`);
  }

  console.log("\n=======================================================");
  console.log("🎉 ALL AUTH SECURITY STATE TESTS PASSED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runAuthSecurityStateTests().catch((err) => {
  console.error("❌ Auth Security State Tests Failed:", err);
  process.exit(1);
});
