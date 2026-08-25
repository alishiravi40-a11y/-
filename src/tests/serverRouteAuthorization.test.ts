process.env.NODE_ENV = 'test';
import {
  SERVER_ROUTE_POLICIES,
  findRoutePolicy,
  createRoutePolicyMiddleware,
  stripSpoofedParameters,
} from '../server/auth/serverRouteAuthorizationPolicy';
import { verifyServerRouteCoverage } from '../server/auth/serverRouteCoverageAudit';
import { AuthorizationContextService } from '../server/auth/authorizationContextService';
import { app as mainApp } from '../../server';

function createMockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.body = null;
  res.headers = {};
  res.status = function (code: number) {
    res.statusCode = code;
    return res;
  };
  res.json = function (data: any) {
    res.body = data;
    return res;
  };
  res.setHeader = function (key: string, val: string) {
    res.headers[key] = val;
    return res;
  };
  return res;
}

async function runTests() {
  console.log('=======================================================');
  console.log('🚀 Running Server Route Authorization & Coverage Tests');
  console.log('=======================================================');

  // Test 1: Unique policy IDs
  {
    const ids = SERVER_ROUTE_POLICIES.map((p) => p.policyId);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new Error('Test 1 Failed: Duplicate policy IDs found across server route policies');
    }
    console.log('✅ Test 1 Passed: Unique policy IDs across all routes verified');
  }

  // Test 2: Valid permissions
  {
    const validPermissions = [
      'system:tech_manage',
      'org:read',
      'org:manage',
      'users:manage',
      'finance:read',
      'finance:write',
      'finance:approve',
      'period:close',
      'period:reopen',
      'credit:manage',
      'credit:read',
      'sales:manage',
      'sales:read',
      'inventory:read',
      'inventory:manage',
      'inventory:post',
    ];

    for (const policy of SERVER_ROUTE_POLICIES) {
      if (policy.protectionType === 'permission_required' || policy.protectionType === 'sensitive_admin') {
        if (policy.requiredPermissions.length === 0) {
          throw new Error(`Test 2 Failed: Policy ${policy.policyId} requires permissions but list is empty`);
        }
        for (const perm of policy.requiredPermissions) {
          if (!validPermissions.includes(perm)) {
            throw new Error(`Test 2 Failed: Policy ${policy.policyId} has invalid permission ${perm}`);
          }
        }
      }
    }
    console.log('✅ Test 2 Passed: Valid DB permission codes verified');
  }

  // Test 3: Parameterized routes matching
  {
    const personsPolicy = findRoutePolicy('GET', '/api/persons/123e4567-e89b-12d3-a456-426614174000');
    if (!personsPolicy || personsPolicy.policyId !== 'PERSONS_GET_BY_ID') {
      throw new Error('Test 3 Failed: Parameterized route /api/persons/:id not matched correctly');
    }

    const voidInvoicePolicy = findRoutePolicy('POST', '/api/invoices/inv_999/void');
    if (!voidInvoicePolicy || voidInvoicePolicy.policyId !== 'INVOICE_VOID_POST') {
      throw new Error('Test 3 Failed: Parameterized route /api/invoices/:id/void not matched correctly');
    }
    console.log('✅ Test 3 Passed: Parameterized route matching verified');
  }

  // Test 4: Strip spoofed parameters
  {
    const fakeReq: any = {
      body: {
        role: 'org_admin',
        permissions: ['finance:write'],
        isAdmin: true,
        userId: 'admin_user_id',
        amount: 1000,
      },
      query: {
        role: 'admin',
        organizationId: 'org_spoofed',
      },
    };

    stripSpoofedParameters(fakeReq);

    if (fakeReq.body.role !== undefined || fakeReq.body.permissions !== undefined || fakeReq.body.isAdmin !== undefined || fakeReq.body.userId !== undefined || fakeReq.body.amount !== 1000) {
      throw new Error('Test 4 Failed: Spoofed body parameters not stripped correctly');
    }
    if (fakeReq.query.role !== undefined || fakeReq.query.organizationId !== undefined) {
      throw new Error('Test 4 Failed: Spoofed query parameters not stripped correctly');
    }
    console.log('✅ Test 4 Passed: Spoofed client parameters stripped successfully');
  }

  // Test 5: Route coverage audit
  {
    const audit = verifyServerRouteCoverage(mainApp);
    if (audit.uncoveredRoutes.length > 0) {
      console.log('Uncovered routes:', audit.uncoveredRoutes);
    }
    if (!audit.success || audit.uncoveredRoutes.length > 0 || audit.unprotectedWriteRoutes.length > 0 || audit.totalCoveredRoutes < 35) {
      throw new Error(`Test 5 Failed: Route coverage audit failed. Covered: ${audit.totalCoveredRoutes}, Uncovered: ${audit.uncoveredRoutes.length}, Unprotected: ${audit.unprotectedWriteRoutes.length}`);
    }
    console.log(`✅ Test 5 Passed: 100% route coverage audit passed (${audit.totalCoveredRoutes} routes verified)`);
  }

  // Test 6: Middleware Access Control - 401 Unauthorized
  {
    const middleware = createRoutePolicyMiddleware('MANUAL_VOUCHER_POST');
    const req: any = { body: { amount: 500 } };
    const res = createMockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await middleware(req, res, next);

    if (res.statusCode !== 401 || res.body?.error !== 'Unauthorized' || nextCalled) {
      throw new Error(`Test 6 Failed: Expected 401 Unauthorized, got status ${res.statusCode}`);
    }
    console.log('✅ Test 6 Passed: 401 Unauthorized returned when no authenticated user ID');
  }

  // Test 7: Middleware Access Control - viewer financial write 403
  {
    const originalGetContext = AuthorizationContextService.getAuthorizationContext;
    (AuthorizationContextService as any).getAuthorizationContext = async () => ({
      status: 'authorized',
      context: {
        userId: 'usr_viewer_001',
        organizationId: 'org_default_001',
        roleCodes: ['viewer'],
        uiRole: 'viewer',
        permissions: ['finance:read', 'org:read'],
      },
    });

    const middleware = createRoutePolicyMiddleware('MANUAL_VOUCHER_POST');
    const req: any = { authenticatedUserId: 'usr_viewer_001', body: { amount: 500 } };
    const res = createMockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await middleware(req, res, next);
    (AuthorizationContextService as any).getAuthorizationContext = originalGetContext;

    if (res.statusCode !== 403 || res.body?.error !== 'Forbidden' || nextCalled) {
      throw new Error(`Test 7 Failed: Expected 403 Forbidden for viewer financial write, got status ${res.statusCode}`);
    }
    console.log('✅ Test 7 Passed: Viewer blocked from financial write with 403');
  }

  // Test 8: Middleware Access Control - system_tech_admin 403
  {
    const originalGetContext = AuthorizationContextService.getAuthorizationContext;
    (AuthorizationContextService as any).getAuthorizationContext = async () => ({
      status: 'authorized',
      context: {
        userId: 'usr_tech_admin',
        organizationId: 'org_default_001',
        roleCodes: ['system_tech_admin'],
        uiRole: 'admin',
        permissions: ['system:tech_manage'],
      },
    });

    const writeMw = createRoutePolicyMiddleware('MANUAL_VOUCHER_POST');
    const reqWrite: any = { authenticatedUserId: 'usr_tech_admin', body: { amount: 500 } };
    const resWrite = createMockRes();
    let nextWriteCalled = false;
    await writeMw(reqWrite, resWrite, () => { nextWriteCalled = true; });

    if (resWrite.statusCode !== 403 || nextWriteCalled) {
      throw new Error(`Test 8 Failed: system_tech_admin allowed financial write`);
    }

    const readMw = createRoutePolicyMiddleware('VOUCHERS_GET');
    const reqRead: any = { authenticatedUserId: 'usr_tech_admin' };
    const resRead = createMockRes();
    let nextReadCalled = false;
    await readMw(reqRead, resRead, () => { nextReadCalled = true; });
    (AuthorizationContextService as any).getAuthorizationContext = originalGetContext;

    if (resRead.statusCode !== 403 || nextReadCalled) {
      throw new Error(`Test 8 Failed: system_tech_admin allowed financial read`);
    }
    console.log('✅ Test 8 Passed: system_tech_admin blocked from financial write and read');
  }

  // Test 9: Middleware Access Control - accountant finance:write allowed
  {
    const originalGetContext = AuthorizationContextService.getAuthorizationContext;
    (AuthorizationContextService as any).getAuthorizationContext = async () => ({
      status: 'authorized',
      context: {
        userId: 'usr_accountant_1',
        organizationId: 'org_default_001',
        roleCodes: ['accountant'],
        uiRole: 'user',
        permissions: ['finance:read', 'finance:write'],
      },
    });

    const middleware = createRoutePolicyMiddleware('MANUAL_VOUCHER_POST');
    const req: any = { authenticatedUserId: 'usr_accountant_1', body: { amount: 500 } };
    const res = createMockRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    (AuthorizationContextService as any).getAuthorizationContext = originalGetContext;

    if (!nextCalled || req.authorizationContext?.userId !== 'usr_accountant_1') {
      throw new Error(`Test 9 Failed: Accountant with finance:write permission was blocked`);
    }
    console.log('✅ Test 9 Passed: Accountant with finance:write successfully authorized');
  }

  // Test 10: Middleware Access Control - DB service error 503
  {
    const originalGetContext = AuthorizationContextService.getAuthorizationContext;
    (AuthorizationContextService as any).getAuthorizationContext = async () => ({
      status: 'service_error',
      error: 'DB connection error',
    });

    const middleware = createRoutePolicyMiddleware('MANUAL_VOUCHER_POST');
    const req: any = { authenticatedUserId: 'usr_accountant_1', body: { amount: 500 } };
    const res = createMockRes();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    (AuthorizationContextService as any).getAuthorizationContext = originalGetContext;

    if (res.statusCode !== 503 || res.body?.error !== 'Service Unavailable' || nextCalled) {
      throw new Error(`Test 10 Failed: Expected 503 Service Unavailable, got status ${res.statusCode}`);
    }
    console.log('✅ Test 10 Passed: Service error correctly returns 503 Service Unavailable');
  }

  console.log('=======================================================');
  console.log('🎉 ALL SERVER ROUTE AUTHORIZATION & COVERAGE TESTS PASSED!');
  console.log('=======================================================');
}

runTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('❌ Test Suite Error:', err);
  process.exit(1);
});
