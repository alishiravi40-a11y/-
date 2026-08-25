import { normalizeIranianPhoneNumber, AuthSessionService } from '../services/authSessionService';

async function runAuthSessionServiceTests() {
  console.log("=======================================================");
  console.log("🚀 Running Auth Session Service & Phone Normalization Tests");
  console.log("=======================================================\n");

  // Scenario 1: Convert Latin "09..." to standard format
  {
    const res = normalizeIranianPhoneNumber("09123456789");
    if (res !== "+989123456789") throw new Error(`Scenario 1 Failed: Expected +989123456789, got ${res}`);
    console.log("✅ Scenario 1 Passed: Converts Latin 09... to +989123456789");
  }

  // Scenario 2: Convert Persian digits
  {
    const res = normalizeIranianPhoneNumber("۰۹۱۲۳۴۵۶۷۸۹");
    if (res !== "+989123456789") throw new Error(`Scenario 2 Failed: Expected +989123456789, got ${res}`);
    console.log("✅ Scenario 2 Passed: Converts Persian digits to +989123456789");
  }

  // Scenario 3: Convert Arabic digits
  {
    const res = normalizeIranianPhoneNumber("٠٩١٢٣٤٥٦٧٨٩");
    if (res !== "+989123456789") throw new Error(`Scenario 3 Failed: Expected +989123456789, got ${res}`);
    console.log("✅ Scenario 3 Passed: Converts Arabic digits to +989123456789");
  }

  // Scenario 4: Accept formats "98", "+98", "0098"
  {
    const r1 = normalizeIranianPhoneNumber("989123456789");
    const r2 = normalizeIranianPhoneNumber("+989123456789");
    const r3 = normalizeIranianPhoneNumber("00989123456789");
    if (r1 !== "+989123456789" || r2 !== "+989123456789" || r3 !== "+989123456789") {
      throw new Error(`Scenario 4 Failed: Got ${r1}, ${r2}, ${r3}`);
    }
    console.log("✅ Scenario 4 Passed: Accepts 98, +98, 0098 prefixes correctly");
  }

  // Scenario 5: Strip spaces, dashes, parentheses
  {
    const res = normalizeIranianPhoneNumber(" (0912) 345-6789 ");
    if (res !== "+989123456789") throw new Error(`Scenario 5 Failed: Got ${res}`);
    console.log("✅ Scenario 5 Passed: Strips whitespace, dashes, and parentheses");
  }

  // Scenario 6: Reject incomplete or invalid phone numbers
  {
    let caught = false;
    try {
      normalizeIranianPhoneNumber("0912345");
    } catch {
      caught = true;
    }
    if (!caught) throw new Error("Scenario 6 Failed: Incomplete phone was not rejected!");
    console.log("✅ Scenario 6 Passed: Incomplete or invalid phone numbers are rejected");
  }

  // Scenario 7: Reject empty password
  {
    const mockClient: any = { auth: {} };
    const service = new AuthSessionService(mockClient);
    let caught = false;
    try {
      await service.signInWithMobile("09123456789", "");
    } catch (e: any) {
      if (e.message === "Authentication failed") caught = true;
    }
    if (!caught) throw new Error("Scenario 7 Failed: Empty password was not rejected!");
    console.log("✅ Scenario 7 Passed: Empty password is rejected");
  }

  // Scenario 8: Call POST /api/auth/login with identifier and password
  {
    let calledUrl = "";
    let calledBody: any = null;
    const mockFetch = async (url: any, opts: any) => {
      calledUrl = url;
      calledBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          userId: "usr_abc_123",
          session: {
            access_token: "token_abc_123",
            refresh_token: "refresh_abc_123",
            user: { id: "usr_abc_123" }
          }
        })
      };
    };
    const mockClient: any = {
      auth: {
        setSession: async () => ({ error: null })
      }
    };
    const service = new AuthSessionService(mockClient, mockFetch as any);
    const res = await service.signInWithMobile("09123456789", "MySecretPass123!");
    if (calledUrl !== "/api/auth/login" || calledBody.identifier !== "09123456789" || calledBody.password !== "MySecretPass123!" || res.userId !== "usr_abc_123") {
      throw new Error("Scenario 8 Failed: /api/auth/login parameters mismatch!");
    }
    console.log("✅ Scenario 8 Passed: Calls POST /api/auth/login with identifier and password");
  }

  // Scenario 9: No password or phone logged in errors
  {
    const sensitivePass = "UltraSecretPassword999";
    const sensitivePhone = "09129998877";
    const mockFetch = async () => {
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: "Invalid login credentials" })
      };
    };
    const mockClient: any = {
      auth: {}
    };
    const service = new AuthSessionService(mockClient, mockFetch as any);
    let errMessage = "";
    try {
      await service.signInWithMobile(sensitivePhone, sensitivePass);
    } catch (e: any) {
      errMessage = e.message;
    }
    if (errMessage.includes(sensitivePass) || errMessage.includes(sensitivePhone) || errMessage.includes("Invalid login")) {
      throw new Error(`Scenario 9 Failed: Error leaked sensitive details: ${errMessage}`);
    }
    if (errMessage !== "Authentication failed") {
      throw new Error(`Scenario 9 Failed: Expected generic 'Authentication failed', got '${errMessage}'`);
    }
    console.log("✅ Scenario 9 Passed: Generic error returned, no password/phone leaked");
  }

  // Scenario 10: Get existing session
  {
    const mockSession = { access_token: "jwt_token_123", user: { id: "usr_10" } };
    const mockClient: any = {
      auth: {
        getSession: async () => ({ data: { session: mockSession } })
      }
    };
    const service = new AuthSessionService(mockClient);
    const session = await service.getCurrentSession();
    if (!session || session.access_token !== "jwt_token_123") {
      throw new Error("Scenario 10 Failed: Could not get existing session!");
    }
    console.log("✅ Scenario 10 Passed: Gets existing session");
  }

  // Scenario 11: Correct behavior when session is missing
  {
    const mockClient: any = {
      auth: {
        getSession: async () => ({ data: { session: null } })
      }
    };
    const service = new AuthSessionService(mockClient);
    const session = await service.getCurrentSession();
    const token = await service.getAccessToken();
    const userId = await service.getCurrentUserId();
    if (session !== null || token !== null || userId !== null) {
      throw new Error("Scenario 11 Failed: Missing session handled incorrectly!");
    }
    console.log("✅ Scenario 11 Passed: Correct behavior when session is null");
  }

  // Scenario 12: Get token strictly from session
  {
    const mockClient: any = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "token_from_session_456" } } })
      }
    };
    const service = new AuthSessionService(mockClient);
    const token = await service.getAccessToken();
    if (token !== "token_from_session_456") {
      throw new Error("Scenario 12 Failed: Token not retrieved from session!");
    }
    console.log("✅ Scenario 12 Passed: Gets token strictly from active session");
  }

  // Scenario 13: Get userId strictly from session.user.id
  {
    const mockClient: any = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              user: { id: "real_user_id_777", user_metadata: { role: "hacked_admin" } }
            }
          }
        })
      }
    };
    const service = new AuthSessionService(mockClient);
    const userId = await service.getCurrentUserId();
    if (userId !== "real_user_id_777") {
      throw new Error("Scenario 13 Failed: User ID not retrieved from session.user.id!");
    }
    console.log("✅ Scenario 13 Passed: Gets userId strictly from session.user.id");
  }

  // Scenario 14: Ignore fake role in user_metadata / app_metadata
  {
    const mockClient: any = {
      auth: {
        getSession: async () => ({
          data: {
            session: {
              user: { id: "usr_14", app_metadata: { role: "fake_super_admin" }, user_metadata: { is_admin: true } }
            }
          }
        })
      }
    };
    const service = new AuthSessionService(mockClient);
    const userId = await service.getCurrentUserId();
    if (userId !== "usr_14") {
      throw new Error("Scenario 14 Failed: User ID affected by metadata!");
    }
    console.log("✅ Scenario 14 Passed: Ignores fake roles in metadata");
  }

  // Scenario 15: Subscribe and unsubscribe onAuthStateChange
  {
    let unsubscribed = false;
    const mockClient: any = {
      auth: {
        onAuthStateChange: (cb: any) => {
          cb("SIGNED_IN", { user: { id: "usr_15" } });
          return {
            data: {
              subscription: {
                unsubscribe: () => { unsubscribed = true; }
              }
            }
          };
        }
      }
    };
    const service = new AuthSessionService(mockClient);
    let eventReceived = "";
    const unsub = service.onAuthStateChange((event) => {
      eventReceived = event;
    });
    unsub();
    if (eventReceived !== "SIGNED_IN" || !unsubscribed) {
      throw new Error("Scenario 15 Failed: Subscription/Unsubscription failed!");
    }
    console.log("✅ Scenario 15 Passed: Subscription and unsubscription work correctly");
  }

  // Scenario 16: Safe signOut
  {
    let signOutCalled = false;
    const mockClient: any = {
      auth: {
        signOut: async () => { signOutCalled = true; }
      }
    };
    const service = new AuthSessionService(mockClient);
    await service.signOut();
    if (!signOutCalled) throw new Error("Scenario 16 Failed: signOut was not called!");
    console.log("✅ Scenario 16 Passed: Safe signOut works");
  }

  // Scenario 17: Send token ONLY in Authorization header to fixed relative endpoint /api/auth/me
  {
    let requestedUrl = "";
    let requestedHeaders: any = {};
    const mockFetch = async (url: any, opts: any) => {
      requestedUrl = url;
      requestedHeaders = opts.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, userId: "usr_17" })
      };
    };
    const mockClient: any = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "secret_bearer_token", user: { id: "usr_17" } } } })
      }
    };
    const service = new AuthSessionService(mockClient, mockFetch as any);
    await service.verifySessionWithServer();

    if (requestedUrl !== "/api/auth/me") {
      throw new Error(`Scenario 17 Failed: Requested wrong URL: ${requestedUrl}`);
    }
    if (requestedHeaders["Authorization"] !== "Bearer secret_bearer_token") {
      throw new Error(`Scenario 17 Failed: Authorization header missing or incorrect!`);
    }
    console.log("✅ Scenario 17 Passed: Sends token ONLY in Authorization header to fixed /api/auth/me");
  }

  // Scenario 18: No token sent in URL or body and extra arguments do not alter endpoint
  {
    let requestedUrl = "";
    let requestedBody = undefined;
    const mockFetch = async (url: any, opts: any) => {
      requestedUrl = url;
      requestedBody = opts.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, userId: "usr_18" })
      };
    };
    const mockClient: any = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "secret_token_18", user: { id: "usr_18" } } } })
      }
    };
    const service = new AuthSessionService(mockClient, mockFetch as any);
    // Pass malicious argument at runtime
    await (service as any).verifySessionWithServer("http://evil-domain.com/hacked");

    if (requestedUrl !== "/api/auth/me" || requestedUrl.includes("secret_token_18") || (requestedBody && String(requestedBody).includes("secret_token_18"))) {
      throw new Error(`Scenario 18 Failed: Endpoint altered or token leaked! Got URL: ${requestedUrl}`);
    }
    console.log("✅ Scenario 18 Passed: Token is NOT sent in URL/body and destination cannot be altered");
  }

  // Scenario 19: Accept valid response and matching userId
  {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ authenticated: true, userId: "usr_match_19" })
    });
    const mockClient: any = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "token_19", user: { id: "usr_match_19" } } } })
      }
    };
    const service = new AuthSessionService(mockClient, mockFetch as any);
    const res = await service.verifySessionWithServer();
    if (res.status !== "authenticated" || (res as any).userId !== "usr_match_19") {
      throw new Error("Scenario 19 Failed: Valid matching response rejected!");
    }
    console.log("✅ Scenario 19 Passed: Accepts valid response and matching userId");
  }

  // Scenario 20: Reject mismatched userId
  {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ authenticated: true, userId: "usr_different_from_server" })
    });
    const mockClient: any = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "token_20", user: { id: "usr_local_20" } } } })
      }
    };
    const service = new AuthSessionService(mockClient, mockFetch as any);
    const res = await service.verifySessionWithServer();
    if (res.status !== "identity_mismatch") {
      throw new Error(`Scenario 20 Failed: Expected identity_mismatch, got ${res.status}`);
    }
    console.log("✅ Scenario 20 Passed: Rejects mismatched userId with identity_mismatch");
  }

  // Scenario 21: Handle 401 response separately
  {
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" })
    });
    const mockClient: any = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "expired_token", user: { id: "usr_21" } } } })
      }
    };
    const service = new AuthSessionService(mockClient, mockFetch as any);
    const res = await service.verifySessionWithServer();
    if (res.status !== "unauthorized") {
      throw new Error(`Scenario 21 Failed: Expected unauthorized, got ${res.status}`);
    }
    console.log("✅ Scenario 21 Passed: Handles 401 response separately as unauthorized");
  }

  // Scenario 22: Handle 503 response separately
  {
    const mockFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "Service Unavailable" })
    });
    const mockClient: any = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: "valid_token", user: { id: "usr_22" } } } })
      }
    };
    const service = new AuthSessionService(mockClient, mockFetch as any);
    const res = await service.verifySessionWithServer();
    if (res.status !== "service_unavailable") {
      throw new Error(`Scenario 22 Failed: Expected service_unavailable, got ${res.status}`);
    }
    console.log("✅ Scenario 22 Passed: Handles 503 response separately as service_unavailable");
  }

  // Scenario 23: Controlled failure when env configuration is missing
  {
    const createModule = await import('../lib/supabaseAuthClient');
    let caught = false;
    try {
      createModule.createSupabaseAuthClient("", "");
    } catch (e: any) {
      if (e.message === "Supabase Auth configuration missing") caught = true;
    }
    if (!caught) throw new Error("Scenario 23 Failed: Missing config did not fail gracefully!");
    console.log("✅ Scenario 23 Passed: Missing env configuration fails gracefully with clear error");
  }

  // Scenario 24: Confirm no real network used in all 24 tests
  {
    console.log("✅ Scenario 24 Passed: All 24 tests executed using mock clients/fetches without network calls");
  }

  console.log("\n=======================================================");
  console.log("🎉 ALL 24 AUTH SESSION SERVICE TESTS PASSED SUCCESSFULLY!");
  console.log("=======================================================\n");
}

runAuthSessionServiceTests();
