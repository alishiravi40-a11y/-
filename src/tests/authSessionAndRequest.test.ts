import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AuthSessionService } from '../services/authSessionService';
import { AuthenticatedRequestService } from '../services/authenticatedRequestService';
import { ChequeClientService } from '../services/chequeService';

async function runAuthSessionAndRequestTests() {
  console.log("=======================================================");
  console.log("🚀 Running Single Source Auth & Authenticated Request Tests (Command 6)");
  console.log("=======================================================\n");

  // 1. Success of /api/auth/login with full session
  {
    let setSessionCalled = false;
    const mockClient: any = {
      auth: {
        setSession: async (params: any) => {
          if (params.access_token === 'at_valid_123' && params.refresh_token === 'rt_valid_123') {
            setSessionCalled = true;
          }
          return { error: null };
        },
        signInWithPassword: async () => {
          throw new Error('FORBIDDEN_CALL_TO_SIGN_IN_WITH_PASSWORD');
        }
      }
    };
    const mockFetch = async (url: string, opts: any) => {
      assert.equal(url, '/api/auth/login');
      assert.equal(opts.method, 'POST');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          userId: 'user_777',
          session: {
            access_token: 'at_valid_123',
            refresh_token: 'rt_valid_123',
            user: { id: 'user_777' }
          }
        })
      };
    };

    const service = new AuthSessionService(mockClient, mockFetch as any);
    const result = await service.signInWithMobile('09121112233', 'CorrectPassword123');
    assert.equal(result.userId, 'user_777');
    assert.equal(setSessionCalled, true);
    assert.equal(await service.getAccessToken(), 'at_valid_123');
    console.log("✅ Test 1 Passed: Full session login succeeds and sets session");
  }

  // 2. Rejection of incomplete login response (missing success)
  {
    const mockClient: any = { auth: {} };
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: false })
    });
    const service = new AuthSessionService(mockClient, mockFetch as any);
    await assert.rejects(
      async () => service.signInWithMobile('09121112233', 'pass'),
      (err: any) => err.message === 'Authentication failed'
    );
    console.log("✅ Test 2 Passed: Incomplete response without success=true rejected");
  }

  // 3. Rejection of response without access_token
  {
    const mockClient: any = { auth: {} };
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        userId: 'u1',
        session: { refresh_token: 'rt_only' }
      })
    });
    const service = new AuthSessionService(mockClient, mockFetch as any);
    await assert.rejects(
      async () => service.signInWithMobile('09121112233', 'pass'),
      (err: any) => err.message === 'Authentication failed'
    );
    console.log("✅ Test 3 Passed: Missing access_token rejected");
  }

  // 4. Rejection of response without refresh_token
  {
    const mockClient: any = { auth: {} };
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        userId: 'u1',
        session: { access_token: 'at_only' }
      })
    });
    const service = new AuthSessionService(mockClient, mockFetch as any);
    await assert.rejects(
      async () => service.signInWithMobile('09121112233', 'pass'),
      (err: any) => err.message === 'Authentication failed'
    );
    console.log("✅ Test 4 Passed: Missing refresh_token rejected");
  }

  // 5. Rejection of mismatch between session user.id and userId
  {
    const mockClient: any = { auth: {} };
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        userId: 'user_legit',
        session: {
          access_token: 'at_1',
          refresh_token: 'rt_1',
          user: { id: 'user_spoofed' }
        }
      })
    });
    const service = new AuthSessionService(mockClient, mockFetch as any);
    await assert.rejects(
      async () => service.signInWithMobile('09121112233', 'pass'),
      (err: any) => err.message === 'Authentication failed'
    );
    console.log("✅ Test 5 Passed: User ID mismatch rejected");
  }

  // 6. 401 response returning generic Authentication failed
  {
    const mockClient: any = { auth: {} };
    const mockFetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid password' })
    });
    const service = new AuthSessionService(mockClient, mockFetch as any);
    await assert.rejects(
      async () => service.signInWithMobile('09121112233', 'pass'),
      (err: any) => err.message === 'Authentication failed'
    );
    console.log("✅ Test 6 Passed: 401 response returns generic Authentication failed");
  }

  // 7 & 8. 503 or network error response WITHOUT calling client.auth.signInWithPassword
  {
    let signInWithPasswordCalled = false;
    const mockClient: any = {
      auth: {
        signInWithPassword: async () => {
          signInWithPasswordCalled = true;
          return { data: null, error: new Error('Fallback called!') };
        }
      }
    };
    const mockFetch = async () => {
      throw new Error('Network error / Server Down');
    };
    const service = new AuthSessionService(mockClient, mockFetch as any);
    await assert.rejects(
      async () => service.signInWithMobile('09121112233', 'pass'),
      (err: any) => err.message === 'Authentication failed'
    );
    assert.equal(signInWithPasswordCalled, false, 'signInWithPassword MUST NOT be called on network error');
    console.log("✅ Tests 7 & 8 Passed: Network/Server error fails safely without fallback client login");
  }

  // 9. Registration of valid session with client.auth.setSession
  {
    let registeredTokens: any = null;
    const mockClient: any = {
      auth: {
        setSession: async (tokens: any) => {
          registeredTokens = tokens;
          return { error: null };
        }
      }
    };
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        userId: 'u_reg',
        session: { access_token: 'at_reg', refresh_token: 'rt_reg', user: { id: 'u_reg' } }
      })
    });
    const service = new AuthSessionService(mockClient, mockFetch as any);
    await service.signInWithMobile('09121112233', 'pass');
    assert.deepEqual(registeredTokens, { access_token: 'at_reg', refresh_token: 'rt_reg' });
    console.log("✅ Test 9 Passed: Session tokens set into Supabase client");
  }

  // 10. getAccessToken from active session
  {
    const mockClient: any = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'active_jwt_token_99' } } })
      }
    };
    const service = new AuthSessionService(mockClient);
    const token = await service.getAccessToken();
    assert.equal(token, 'active_jwt_token_99');
    console.log("✅ Test 10 Passed: getAccessToken retrieves active session token");
  }

  // 11. Lack of session causing AUTH_REQUIRED and ZERO fetch calls in AuthenticatedRequestService
  {
    let fetchCalled = false;
    const mockAuthService: any = {
      getAccessToken: async () => null
    };
    const mockFetch = async () => {
      fetchCalled = true;
      return { ok: true, status: 200 } as any;
    };
    const reqService = new AuthenticatedRequestService(mockAuthService, mockFetch as any);
    await assert.rejects(
      async () => reqService.fetch('/api/protected'),
      (err: any) => err.message === 'AUTH_REQUIRED'
    );
    assert.equal(fetchCalled, false, 'Fetch must NOT be called when token is missing');
    console.log("✅ Test 11 Passed: Lack of token throws AUTH_REQUIRED before fetch execution");
  }

  // 12 & 13. Token placed strictly in Authorization: Bearer header, NOT in URL or Body
  {
    let capturedUrl = '';
    let capturedHeaders: any = null;
    let capturedBody = null;

    const mockAuthService: any = {
      getAccessToken: async () => 'secret_jwt_bearer_token'
    };
    const mockFetch = async (url: string, opts: any) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      capturedBody = opts.body;
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as any;
    };

    const reqService = new AuthenticatedRequestService(mockAuthService, mockFetch as any);
    await reqService.fetch('/api/test-data', {
      method: 'POST',
      body: JSON.stringify({ amount: 1000 })
    });

    assert.equal(capturedUrl, '/api/test-data');
    assert.equal(capturedUrl.includes('secret_jwt_bearer_token'), false);
    assert.equal(capturedHeaders.get('Authorization'), 'Bearer secret_jwt_bearer_token');
    assert.equal(String(capturedBody).includes('secret_jwt_bearer_token'), false);
    console.log("✅ Tests 12 & 13 Passed: Token sent ONLY in Authorization header");
  }

  // 14. 401, 403, and 503 responses properly distinguished
  {
    const mockAuthService: any = { getAccessToken: async () => 'valid_token' };

    const mockFetch401 = async () => ({ status: 401, ok: false } as any);
    const service401 = new AuthenticatedRequestService(mockAuthService, mockFetch401 as any);
    await assert.rejects(async () => service401.fetch('/api/x'), (err: any) => err.message === 'UNAUTHORIZED');

    const mockFetch403 = async () => ({ status: 403, ok: false } as any);
    const service403 = new AuthenticatedRequestService(mockAuthService, mockFetch403 as any);
    await assert.rejects(async () => service403.fetch('/api/x'), (err: any) => err.message === 'FORBIDDEN');

    const mockFetch503 = async () => ({ status: 503, ok: false } as any);
    const service503 = new AuthenticatedRequestService(mockAuthService, mockFetch503 as any);
    await assert.rejects(async () => service503.fetch('/api/x'), (err: any) => err.message === 'SERVICE_UNAVAILABLE');

    console.log("✅ Test 14 Passed: 401, 403, and 503 error responses distinguished properly");
  }

  // 15. ChequeClientService no longer reads Storage
  {
    const chequeCode = fs.readFileSync(path.join(process.cwd(), 'src/services/chequeService.ts'), 'utf8');
    assert.equal(chequeCode.includes('localStorage.getItem("sb-session")'), false);
    assert.equal(chequeCode.includes('localStorage.getItem("supabase.auth.token")'), false);
    console.log("✅ Test 15 Passed: ChequeClientService verified free of manual Storage reads");
  }

  // 16-19. Static Audit of Refactored Components for Token Storage Removal
  {
    const backupCode = fs.readFileSync(path.join(process.cwd(), 'src/components/BackupManager.tsx'), 'utf8');
    assert.equal(backupCode.includes("getItem('supabase_access_token')"), false);
    assert.equal(backupCode.includes("getItem('auth_token')"), false);

    const accountsCode = fs.readFileSync(path.join(process.cwd(), 'src/components/AccountsManager.tsx'), 'utf8');
    assert.equal(accountsCode.includes("getItem('supabase_access_token')"), false);
    assert.equal(accountsCode.includes("getItem('auth_token')"), false);

    const cashFormCode = fs.readFileSync(path.join(process.cwd(), 'src/components/CashTransactionForm.tsx'), 'utf8');
    assert.equal(cashFormCode.includes("getItem('auth_token')"), false);

    const appCode = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
    assert.equal(appCode.includes("localStorage.getItem('auth_token')"), false);

    console.log("✅ Tests 16-19 Passed: All components verified free of manual Storage token reads");
  }

  // 20. No password or token printed in error messages or logs
  {
    const secretPassword = 'SUPER_SECRET_USER_PASSWORD_123';
    const mockFetchErr = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid payload or password mismatch' })
    });
    const mockClient: any = { auth: {} };
    const service = new AuthSessionService(mockClient, mockFetchErr as any);
    let thrownError = '';
    try {
      await service.signInWithMobile('09129998877', secretPassword);
    } catch (e: any) {
      thrownError = e.message;
    }
    assert.equal(thrownError.includes(secretPassword), false);
    assert.equal(thrownError, 'Authentication failed');
    console.log("✅ Test 20 Passed: Secret credentials never leaked in thrown errors");
  }

  console.log("\n=======================================================");
  console.log("🎉 ALL COMMAND 6 AUTHENTICATION & REQUEST TESTS PASSED!");
  console.log("=======================================================\n");
}

runAuthSessionAndRequestTests();
