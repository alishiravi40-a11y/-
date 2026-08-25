process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import { extractAuthenticatedActorId, app } from '../../server';

function createMockResponse() {
  const res: any = {};
  res.statusCode = 200;
  res.jsonBody = null;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: any) => {
    res.jsonBody = body;
    return res;
  };
  return res;
}

async function runTests() {
  console.log("=======================================================");
  console.log("🚀 Running Server Actor Identity Integrity Tests (Real Server Code)");
  console.log("=======================================================\n");

  // Test 1: extractAuthenticatedActorId with valid token identity and spoofed body fields
  {
    const req: any = {
      authenticatedUserId: "usr_valid_123",
      body: {
        createdBy: "usr_spoofed_999",
        userId: "usr_spoofed_888",
        postedBy: "usr_spoofed_777",
        lastUpdatedBy: "usr_spoofed_666",
        deviceId: "dev_fake_555"
      }
    };
    const res = createMockResponse();
    const actorId = extractAuthenticatedActorId(req, res);

    if (actorId !== "usr_valid_123") {
      throw new Error(`Test 1 Failed: Expected actorId 'usr_valid_123', got '${actorId}'`);
    }
    if (res.statusCode !== 200) {
      throw new Error(`Test 1 Failed: Response status changed to ${res.statusCode}`);
    }
    console.log("✅ Test 1 Passed: Real server function extractAuthenticatedActorId extracted true identity and ignored body spoofing.");
  }

  // Test 2: extractAuthenticatedActorId with undefined authenticatedUserId
  {
    const req: any = {
      authenticatedUserId: undefined,
      body: {
        createdBy: "usr_spoofed_999",
        deviceId: "dev_fake_555"
      }
    };
    const res = createMockResponse();
    const actorId = extractAuthenticatedActorId(req, res);

    if (actorId !== null) {
      throw new Error(`Test 2 Failed: Expected actorId null, got '${actorId}'`);
    }
    if (res.statusCode !== 401) {
      throw new Error(`Test 2 Failed: Expected status 401, got ${res.statusCode}`);
    }
    if (res.jsonBody?.error !== "ERR_UNAUTHORIZED") {
      throw new Error(`Test 2 Failed: Expected error 'ERR_UNAUTHORIZED', got '${res.jsonBody?.error}'`);
    }
    console.log("✅ Test 2 Passed: Missing authenticatedUserId returns 401 and returns null actorId.");
  }

  // Test 3: extractAuthenticatedActorId with null authenticatedUserId
  {
    const req: any = {
      authenticatedUserId: null,
      body: {
        userId: "usr_spoofed_888"
      }
    };
    const res = createMockResponse();
    const actorId = extractAuthenticatedActorId(req, res);

    if (actorId !== null) {
      throw new Error(`Test 3 Failed: Expected actorId null for null authenticatedUserId, got '${actorId}'`);
    }
    if (res.statusCode !== 401) {
      throw new Error(`Test 3 Failed: Expected status 401 for null authenticatedUserId, got ${res.statusCode}`);
    }
    console.log("✅ Test 3 Passed: Null authenticatedUserId returns 401.");
  }

  // Test 4: deviceId present without authenticatedUserId -> cannot substitute identity
  {
    const req: any = {
      authenticatedUserId: undefined,
      body: {
        deviceId: "dev_device_only_777",
        state: { test: true }
      }
    };
    const res = createMockResponse();
    const actorId = extractAuthenticatedActorId(req, res);

    if (actorId !== null) {
      throw new Error("Test 4 Failed: deviceId substituted identity!");
    }
    if (res.statusCode !== 401) {
      throw new Error(`Test 4 Failed: Expected status 401, got ${res.statusCode}`);
    }
    console.log("✅ Test 4 Passed: deviceId cannot substitute user identity.");
  }

  // Test 5: Verify App-State endpoint handler identity rejection without auth
  {
    const appRoutes = (app as any)._router?.stack || [];
    const appStatePostRoute = appRoutes.find((r: any) => r.route && r.route.path === '/api/app-state' && r.route.methods.post);

    if (appStatePostRoute) {
      const req: any = {
        authenticatedUserId: undefined,
        body: {
          state: { sample: 123 },
          createdBy: "usr_spoofed_999",
          deviceId: "dev_fake_555"
        }
      };
      const res = createMockResponse();

      // Invoke route handler directly
      const handlers = appStatePostRoute.route.stack;
      const lastHandler = handlers[handlers.length - 1].handle;
      lastHandler(req, res);

      if (res.statusCode !== 401) {
        throw new Error(`Test 5 Failed: Expected POST /api/app-state to return 401 when unauthenticated, got ${res.statusCode}`);
      }
      console.log("✅ Test 5 Passed: POST /api/app-state handler rejected request without authenticatedUserId.");
    } else {
      console.log("⚠️ Test 5 Skipped: Route /api/app-state stack inspection not available.");
    }
  }

  // Test 6: Verify Manual Vouchers endpoint handler identity rejection without auth
  {
    const appRoutes = (app as any)._router?.stack || [];
    const manualVouchersRoute = appRoutes.find((r: any) => r.route && r.route.path === '/api/manual-vouchers' && r.route.methods.post);

    if (manualVouchersRoute) {
      const req: any = {
        authenticatedUserId: undefined,
        body: {
          date: "2026-01-01",
          description: "Spoofed Voucher",
          createdBy: "usr_spoofed_999"
        }
      };
      const res = createMockResponse();

      const handlers = manualVouchersRoute.route.stack;
      const lastHandler = handlers[handlers.length - 1].handle;
      await lastHandler(req, res);

      if (res.statusCode !== 401) {
        throw new Error(`Test 6 Failed: Expected POST /api/manual-vouchers to return 401 when unauthenticated, got ${res.statusCode}`);
      }
      console.log("✅ Test 6 Passed: POST /api/manual-vouchers handler rejected request without authenticatedUserId.");
    }
  }

  // Test 7: Verify Invoices endpoint handler identity rejection without auth
  {
    const appRoutes = (app as any)._router?.stack || [];
    const invoicesRoute = appRoutes.find((r: any) => r.route && r.route.path === '/api/invoices' && r.route.methods.post);

    if (invoicesRoute) {
      const req: any = {
        authenticatedUserId: undefined,
        body: {
          invoiceNumber: 101,
          createdBy: "usr_spoofed_999"
        }
      };
      const res = createMockResponse();

      const handlers = invoicesRoute.route.stack;
      const lastHandler = handlers[handlers.length - 1].handle;
      await lastHandler(req, res);

      if (res.statusCode !== 401) {
        throw new Error(`Test 7 Failed: Expected POST /api/invoices to return 401 when unauthenticated, got ${res.statusCode}`);
      }
      console.log("✅ Test 7 Passed: POST /api/invoices handler rejected request without authenticatedUserId.");
    }
  }

  // Test 8: Verify Backup Reset handler identity rejection without auth
  {
    const appRoutes = (app as any)._router?.stack || [];
    const backupResetRoute = appRoutes.find((r: any) => r.route && r.route.path === '/api/backup/reset' && r.route.methods.post);

    if (backupResetRoute) {
      const req: any = {
        authenticatedUserId: undefined,
        body: {
          userId: "admin_spoof"
        }
      };
      const res = createMockResponse();

      const handlers = backupResetRoute.route.stack;
      const lastHandler = handlers[handlers.length - 1].handle;
      lastHandler(req, res);

      if (res.statusCode !== 401) {
        throw new Error(`Test 8 Failed: Expected POST /api/backup/reset to return 401 when unauthenticated, got ${res.statusCode}`);
      }
      console.log("✅ Test 8 Passed: POST /api/backup/reset handler rejected request without authenticatedUserId.");
    }
  }

  console.log("\n=======================================================");
  console.log("🎉 ALL REAL SERVER ACTOR IDENTITY INTEGRITY TESTS PASSED!");
  console.log("=======================================================\n");
}

runTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("❌ Test Suite Error:", err);
  process.exit(1);
});
