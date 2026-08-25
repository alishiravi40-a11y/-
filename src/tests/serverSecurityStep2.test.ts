import { createAuthMiddleware } from '../server/auth/authMiddleware';
import { createSensitiveAuthMiddleware } from '../server/auth/sensitiveAuthMiddleware';
import { ITokenVerifier, ISensitiveTokenVerifier, TokenVerificationResult, DetailedTokenVerificationResult, validateClaims } from '../server/auth/supabaseAuth';

class MockSecurityVerifier implements ISensitiveTokenVerifier {
  public configured: boolean = true;
  public mockUserId: string = 'user_test_123';
  public mockRole: string = 'authenticated';
  public mockAal: string = 'aal1';
  public getUserError: boolean = false;

  isConfigured(): boolean {
    return this.configured;
  }

  async verifyToken(token: string): Promise<TokenVerificationResult> {
    if (!this.configured) return { status: 'unconfigured' };
    if (this.getUserError) return { status: 'service_error' };
    if (!token || token === 'invalid_token' || token === 'anon') return { status: 'invalid' };
    return { status: 'success', userId: this.mockUserId };
  }

  async verifyTokenWithClaims(token: string, currentTimeSec?: number): Promise<DetailedTokenVerificationResult> {
    if (!this.configured) return { status: 'unconfigured' };
    if (this.getUserError) return { status: 'service_error' };
    if (!token || token === 'invalid_token' || token === 'anon') return { status: 'invalid' };

    const now = currentTimeSec ?? 1000000;
    const claims = {
      sub: this.mockUserId,
      aud: 'authenticated',
      role: 'authenticated',
      is_anonymous: false,
      session_id: 'sess_sec_123',
      exp: now + 3600,
      iat: now - 100,
      aal: this.mockAal,
      iss: 'https://example.supabase.co/auth/v1',
      amr: this.mockAal === 'aal2' ? [
        { method: 'password', timestamp: now - 50 },
        { method: 'otp', timestamp: now - 20 }
      ] : [
        { method: 'password', timestamp: now - 50 }
      ]
    };

    const context = validateClaims(claims, this.mockUserId, now, 'https://example.supabase.co');
    if (!context) return { status: 'invalid' };
    return { status: 'success', context };
  }
}

function mockRes() {
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

async function runStep2SecurityTests() {
  console.log("=======================================================");
  console.log("🚀 Running Step 2 Server Security Boundary Tests");
  console.log("=======================================================\n");

  const verifier = new MockSecurityVerifier();
  const authMw = createAuthMiddleware(verifier);
  const sensitiveMw = createSensitiveAuthMiddleware(verifier, () => 1000000);

  // 1. /api/app-state tests
  {
    // Anonymous GET -> 401
    verifier.mockUserId = 'user_test_123';
    const req: any = { headers: {} };
    const res = mockRes();
    let nextCalled = false;
    await authMw(req, res, () => { nextCalled = true; });
    if (res.statusCode !== 401 || nextCalled) {
      throw new Error(`AppState GET Anonymous test failed: expected 401, got ${res.statusCode}`);
    }
    console.log("✅ Test 1 Passed: Anonymous GET /api/app-state rejected with 401");

    // Valid token GET -> 200 / success
    const reqValid: any = { headers: { authorization: "Bearer valid_jwt_token" } };
    const resValid = mockRes();
    nextCalled = false;
    await authMw(reqValid, resValid, () => { nextCalled = true; });
    if (!nextCalled || resValid.statusCode !== 200 || reqValid.authenticatedUserId !== 'user_test_123') {
      throw new Error(`AppState GET Valid token failed`);
    }
    console.log("✅ Test 2 Passed: Valid authenticated GET /api/app-state allowed");
  }

  // 2. /api/supabase-config tests (POST requires sensitive / management auth)
  {
    // Anonymous POST -> 401
    const reqAnon: any = { headers: {}, body: { url: "https://db.supabase.co", key: "anon" } };
    const resAnon = mockRes();
    let nextCalled = false;
    await sensitiveMw(reqAnon, resAnon, () => { nextCalled = true; });
    if (resAnon.statusCode !== 401 || nextCalled) {
      throw new Error(`SupabaseConfig POST Anonymous test failed: expected 401`);
    }
    console.log("✅ Test 3 Passed: Anonymous POST /api/supabase-config rejected with 401");

    // Regular user (aal1) POST -> 403 SENSITIVE_REAUTH_REQUIRED
    verifier.mockAal = 'aal1';
    const reqAal1: any = { headers: { authorization: "Bearer aal1_token" }, body: { url: "https://db.supabase.co", key: "anon" } };
    const resAal1 = mockRes();
    nextCalled = false;
    await sensitiveMw(reqAal1, resAal1, () => { nextCalled = true; });
    if (resAal1.statusCode !== 403 || resAal1.jsonBody?.error !== "SENSITIVE_REAUTH_REQUIRED" || nextCalled) {
      throw new Error(`SupabaseConfig POST Aal1 test failed: expected 403 SENSITIVE_REAUTH_REQUIRED, got ${resAal1.statusCode}`);
    }
    console.log("✅ Test 4 Passed: Regular user (aal1) POST /api/supabase-config rejected with 403");

    // Manager (aal2) POST -> 200 / allowed
    verifier.mockAal = 'aal2';
    const reqAal2: any = { headers: { authorization: "Bearer aal2_token" }, body: { url: "https://db.supabase.co", key: "anon" } };
    const resAal2 = mockRes();
    nextCalled = false;
    await sensitiveMw(reqAal2, resAal2, () => { nextCalled = true; });
    if (!nextCalled || resAal2.statusCode !== 200) {
      throw new Error(`SupabaseConfig POST Aal2 test failed`);
    }
    console.log("✅ Test 5 Passed: Manager (aal2) POST /api/supabase-config allowed");
  }

  // 3. /api/download-zip tests
  {
    // Anonymous GET -> 401
    const reqAnon: any = { headers: {} };
    const resAnon = mockRes();
    let nextCalled = false;
    await sensitiveMw(reqAnon, resAnon, () => { nextCalled = true; });
    if (resAnon.statusCode !== 401 || nextCalled) {
      throw new Error(`DownloadZip Anonymous test failed: expected 401`);
    }
    console.log("✅ Test 6 Passed: Anonymous GET /api/download-zip rejected with 401");

    // Regular user (aal1) GET -> 403
    verifier.mockAal = 'aal1';
    const reqAal1: any = { headers: { authorization: "Bearer aal1_token" } };
    const resAal1 = mockRes();
    nextCalled = false;
    await sensitiveMw(reqAal1, resAal1, () => { nextCalled = true; });
    if (resAal1.statusCode !== 403 || nextCalled) {
      throw new Error(`DownloadZip Aal1 test failed: expected 403`);
    }
    console.log("✅ Test 7 Passed: Regular user (aal1) GET /api/download-zip rejected with 403");
  }

  console.log("\n=======================================================");
  console.log("🎉 ALL STEP 2 SECURITY BOUNDARY TESTS PASSED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runStep2SecurityTests();
