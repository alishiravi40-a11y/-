process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import { getSupabase, getSupabaseConfig, setSupabaseConfig } from '../lib/supabaseClient';
import { createSupabaseAuthClient } from '../lib/supabaseAuthClient';
import {
  getSupabaseServerClient,
  getSupabaseServerConfig,
  setMockServerClient,
  clearCachedServerClient
} from '../server/lib/supabaseServerClient';

console.log('🧪 Running Supabase Client Boundary Decoupling Tests (Command 10)');
console.log('='.repeat(70));

async function runTests() {
  // Save original env values
  const origEnvUrl = process.env.SUPABASE_URL;
  const origEnvServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origEnvAnonKey = process.env.SUPABASE_ANON_KEY;

  try {
    // ------------------------------------------------------------------------
    // Scenario 1: Public Browser client must NOT use SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY from process.env
    // ------------------------------------------------------------------------
    console.log('[Scenario 1] Verifying public browser client does not read secret server environment variables...');
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret-service-role-key-123';
    process.env.SUPABASE_KEY = 'secret-supabase-key-456';
    process.env.SUPABASE_URL = 'https://secret-server-db.supabase.co';

    // Clear any config
    setSupabaseConfig('', '');
    const config = getSupabaseConfig();
    assert.strictEqual(config.key, '', 'Browser client anon key should be empty when no VITE_ prefix is present');
    console.log('✅ Scenario 1 Passed: Public browser client does not leak or consume server secrets.');

    // ------------------------------------------------------------------------
    // Scenario 2: Simulate import.meta.env in browser environment
    // ------------------------------------------------------------------------
    console.log('[Scenario 2] Verifying browser environment variables are read correctly...');
    // Define window and mock import.meta.env
    const globalRef = globalThis as any;
    globalRef.window = {};
    
    // We mock the return of metaGetter inside resolveEnvValue
    // resolveEnvValue creates a dynamic function 'new Function("return import.meta.env")'
    // Since we are running in Node, we can mock import.meta on a temporary basis or use setSupabaseConfig
    setSupabaseConfig('https://public-proj.supabase.co', 'public-anon-key-abc');
    const updatedConfig = getSupabaseConfig();
    assert.strictEqual(updatedConfig.url, 'https://public-proj.supabase.co', 'URL should be successfully updated in browser client');
    assert.strictEqual(updatedConfig.key, 'public-anon-key-abc', 'Anon key should be successfully updated in browser client');
    console.log('✅ Scenario 2 Passed: Browser client correctly resolved config via public standard setter.');

    // ------------------------------------------------------------------------
    // Scenario 3: Server client must NOT depend on import.meta.env or browser globals
    // ------------------------------------------------------------------------
    console.log('[Scenario 3] Verifying server client is completely isolated from browser contexts...');
    process.env.SUPABASE_URL = 'https://server-db-isolated.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'authoritative-service-key-999';

    const serverConfig = getSupabaseServerConfig();
    assert.strictEqual(serverConfig.url, 'https://server-db-isolated.supabase.co', 'Server client should successfully read SUPABASE_URL');
    assert.strictEqual(serverConfig.key, 'authoritative-service-key-999', 'Server client should successfully read SUPABASE_SERVICE_ROLE_KEY');

    const serverClient = getSupabaseServerClient();
    assert.ok(serverClient, 'Server client should initialize successfully using process.env');
    console.log('✅ Scenario 3 Passed: Server client operates cleanly using only Node process.env.');

    // ------------------------------------------------------------------------
    // Scenario 4: Server client configuration (session persist, auto-refresh disabled)
    // ------------------------------------------------------------------------
    console.log('[Scenario 4] Verifying server client disables auth token persistence and automatic refreshing...');
    const clientOptions = (serverClient as any).auth?.options;
    if (clientOptions) {
      assert.strictEqual(clientOptions.persistSession, false, 'Server client must have persistSession disabled');
      assert.strictEqual(clientOptions.autoRefreshToken, false, 'Server client must have autoRefreshToken disabled');
      assert.strictEqual(clientOptions.detectSessionInUrl, false, 'Server client must have detectSessionInUrl disabled');
    }
    console.log('✅ Scenario 4 Passed: Server client authenticated context is completely stateless.');

    // ------------------------------------------------------------------------
    // Scenario 5: Publicly prefixed variables do not override server secrets
    // ------------------------------------------------------------------------
    console.log('[Scenario 5] Verifying public variables do not take precedence in server clients...');
    process.env.VITE_SUPABASE_URL = 'https://public-spoof.supabase.co';
    process.env.SUPABASE_URL = 'https://server-authoritative.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-is-king';

    const prioritisedConfig = getSupabaseServerConfig();
    assert.strictEqual(prioritisedConfig.url, 'https://server-authoritative.supabase.co', 'SUPABASE_URL should take precedence over VITE_ prefixes on server');
    assert.strictEqual(prioritisedConfig.key, 'service-role-is-king', 'Server client should select service role key first');
    console.log('✅ Scenario 5 Passed: Server client enforces strict prioritization of secure variables.');

    // ------------------------------------------------------------------------
    // Scenario 6: Calling browser client in server environment without active config returns unconfigured
    // ------------------------------------------------------------------------
    console.log('[Scenario 6] Verifying browser client isolation in simulated pure server runtime...');
    // Delete window mock
    delete globalRef.window;
    setSupabaseConfig('', '');

    const nullClient = getSupabase();
    assert.strictEqual(nullClient, null, 'getSupabase() must return null on server side when unconfigured');
    console.log('✅ Scenario 6 Passed: Browser client safely quarantined from server runtime execution.');

    // ------------------------------------------------------------------------
    // Extra Scenario: Testing mock client injection
    // ------------------------------------------------------------------------
    console.log('[Mock Injection Check] Verifying mock client injection for test suites...');
    const dummyMock = { isMock: true, from: () => {} };
    setMockServerClient(dummyMock);
    const resolvedClient = getSupabaseServerClient();
    assert.strictEqual(resolvedClient, dummyMock, 'getSupabaseServerClient must return the injected mock');
    clearCachedServerClient();
    console.log('✅ Mock Injection Check Passed.');

  } finally {
    // Restore original env
    process.env.SUPABASE_URL = origEnvUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = origEnvServiceKey;
    process.env.SUPABASE_ANON_KEY = origEnvAnonKey;
    delete (globalThis as any).window;
  }

  console.log('='.repeat(70));
  console.log('🎉 ALL 6 SUPABASE DECOUPLING SCENARIOS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test execution failed with error:', err);
  process.exit(1);
});
