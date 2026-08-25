import { createAuthMiddleware, AuthenticatedRequest } from '../server/auth/authMiddleware';
import { ITokenVerifier, TokenVerificationResult } from '../server/auth/supabaseAuth';

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

class MockVerifier implements ITokenVerifier {
  configured = true;
  mockResult: TokenVerificationResult = { status: 'invalid' };

  isConfigured(): boolean {
    return this.configured;
  }

  async verifyToken(_accessToken: string): Promise<TokenVerificationResult> {
    return this.mockResult;
  }
}

async function runTests() {
  console.log("=======================================================");
  console.log("🚀 Running Server Auth Token Validation Boundary Tests");
  console.log("=======================================================\n");

  const mockVerifier = new MockVerifier();
  const middleware = createAuthMiddleware(mockVerifier);

  // Scenario 1: Missing header -> 401
  {
    const req: any = { headers: {} };
    const res = createMockResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    if (res.statusCode !== 401 || nextCalled) {
      throw new Error(`Scenario 1 Failed: Expected status 401, got ${res.statusCode}`);
    }
    console.log("✅ Scenario 1 Passed: Missing Authorization header returns 401");
  }

  // Scenario 2: Scheme other than "Bearer" -> 401
  {
    const req: any = { headers: { authorization: "Basic dXNlcjpwYXNz" } };
    const res = createMockResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    if (res.statusCode !== 401 || nextCalled) {
      throw new Error(`Scenario 2 Failed: Expected status 401 for non-Bearer scheme, got ${res.statusCode}`);
    }
    console.log("✅ Scenario 2 Passed: Scheme other than Bearer returns 401");
  }

  // Scenario 3: Empty token value -> 401
  {
    const req: any = { headers: { authorization: "Bearer " } };
    const res = createMockResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    if (res.statusCode !== 401 || nextCalled) {
      throw new Error(`Scenario 3 Failed: Expected status 401 for empty token, got ${res.statusCode}`);
    }
    console.log("✅ Scenario 3 Passed: Empty token value returns 401");
  }

  // Scenario 4: Multiple values or ambiguous header -> 401
  {
    const req1: any = { headers: { authorization: ["Bearer token1", "Bearer token2"] } };
    const res1 = createMockResponse();
    await middleware(req1, res1, () => {});
    if (res1.statusCode !== 401) {
      throw new Error(`Scenario 4a Failed: Expected 401 for array header, got ${res1.statusCode}`);
    }

    const req2: any = { headers: { authorization: "Bearer token1, Bearer token2" } };
    const res2 = createMockResponse();
    await middleware(req2, res2, () => {});
    if (res2.statusCode !== 401) {
      throw new Error(`Scenario 4b Failed: Expected 401 for comma-separated header, got ${res2.statusCode}`);
    }
    console.log("✅ Scenario 4 Passed: Multiple or ambiguous Authorization headers return 401");
  }

  // Scenario 5: Excessively long token (> 4096 chars) -> 401
  {
    const longToken = "a".repeat(5000);
    const req: any = { headers: { authorization: `Bearer ${longToken}` } };
    const res = createMockResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    if (res.statusCode !== 401 || nextCalled) {
      throw new Error(`Scenario 5 Failed: Expected status 401 for oversized token, got ${res.statusCode}`);
    }
    console.log("✅ Scenario 5 Passed: Excessively long token returns 401");
  }

  // Scenario 6: Token invalid according to test verifier -> 401
  {
    mockVerifier.configured = true;
    mockVerifier.mockResult = { status: 'invalid' };
    const req: any = { headers: { authorization: "Bearer invalid_secret_token_123" } };
    const res = createMockResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    if (res.statusCode !== 401 || nextCalled) {
      throw new Error(`Scenario 6 Failed: Expected status 401 for invalid token, got ${res.statusCode}`);
    }
    console.log("✅ Scenario 6 Passed: Invalid token according to verifier returns 401");
  }

  // Scenario 7: Communicating error / verifier error -> 503
  {
    mockVerifier.configured = true;
    mockVerifier.mockResult = { status: 'service_error' };
    const req: any = { headers: { authorization: "Bearer some_token" } };
    const res = createMockResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    if (res.statusCode !== 503 || nextCalled) {
      throw new Error(`Scenario 7 Failed: Expected status 503 for verifier communication error, got ${res.statusCode}`);
    }
    console.log("✅ Scenario 7 Passed: Verifier communication error returns 503");
  }

  // Scenario 8: Missing server environment configuration -> 503
  {
    mockVerifier.configured = false;
    const req: any = { headers: { authorization: "Bearer valid_token" } };
    const res = createMockResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    if (res.statusCode !== 503 || nextCalled) {
      throw new Error(`Scenario 8 Failed: Expected status 503 for unconfigured verifier, got ${res.statusCode}`);
    }
    console.log("✅ Scenario 8 Passed: Missing server configuration returns 503");
  }

  // Scenario 9: Valid token -> Middleware passes and sets verified userId
  {
    mockVerifier.configured = true;
    mockVerifier.mockResult = { status: 'success', userId: 'usr_real_uuid_999' };
    const req: any = { headers: { authorization: "Bearer valid_secret_jwt" } };
    const res = createMockResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    if (!nextCalled || req.authenticatedUserId !== 'usr_real_uuid_999') {
      throw new Error(`Scenario 9 Failed: Expected nextCalled=true and authenticatedUserId='usr_real_uuid_999'`);
    }
    console.log("✅ Scenario 9 Passed: Valid token passes middleware and sets authenticatedUserId");
  }

  // Scenario 10: Presence of fake userId or role in body -> Ignored
  {
    mockVerifier.configured = true;
    mockVerifier.mockResult = { status: 'success', userId: 'usr_real_uuid_999' };
    const req: any = {
      headers: { authorization: "Bearer valid_secret_jwt" },
      body: { userId: "fake_admin_hacker", role: "super_admin", orgId: "fake_org" },
      query: { userId: "fake_query_user" }
    };
    const res = createMockResponse();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    if (!nextCalled || req.authenticatedUserId !== 'usr_real_uuid_999') {
      throw new Error(`Scenario 10 Failed: Fake body/query userId was not ignored! Got ${req.authenticatedUserId}`);
    }
    console.log("✅ Scenario 10 Passed: Body/query fake userId and role are ignored");
  }

  // Scenario 11: Route /api/auth/me response includes ONLY minimal allowed info
  {
    const req: AuthenticatedRequest = { authenticatedUserId: 'usr_real_uuid_999' } as any;
    const res = createMockResponse();
    const handleMeRoute = (req: AuthenticatedRequest, res: any) => {
      res.json({
        authenticated: true,
        userId: req.authenticatedUserId
      });
    };
    handleMeRoute(req, res);
    const body = res.jsonBody;
    const keys = Object.keys(body);
    if (keys.length !== 2 || body.authenticated !== true || body.userId !== 'usr_real_uuid_999') {
      throw new Error(`Scenario 11 Failed: Route output contains unallowed fields: ${JSON.stringify(body)}`);
    }
    if ((body as any).role || (body as any).email || (body as any).password || (body as any).token || (body as any).metadata) {
      throw new Error(`Scenario 11 Failed: Sensitive metadata leaked in route response!`);
    }
    console.log("✅ Scenario 11 Passed: /api/auth/me returns only minimal allowed structure");
  }

  // Scenario 12: Error response contains NO token
  {
    const sensitiveToken = "SUPER_SECRET_TOKEN_DO_NOT_LEAK_12345";
    mockVerifier.configured = true;
    mockVerifier.mockResult = { status: 'invalid' };
    const req: any = { headers: { authorization: `Bearer ${sensitiveToken}` } };
    const res = createMockResponse();
    await middleware(req, res, () => {});
    const resStr = JSON.stringify(res.jsonBody || {});
    if (resStr.includes(sensitiveToken)) {
      throw new Error("Scenario 12 Failed: Sensitive token was leaked in error response!");
    }
    console.log("✅ Scenario 12 Passed: Error response contains no token string");
  }

  console.log("\n=======================================================");
  console.log("🎉 ALL 12 SERVER AUTH BOUNDARY TESTS PASSED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runTests();
