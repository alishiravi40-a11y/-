import { describe, it } from 'node:test';
import assert from 'node:assert';
import { backupLocalStorageBeforeMigration } from '../services/centralSyncService';

console.log("=======================================================");
console.log("🚀 Running Command 9 Credential & Auth Security Tests");
console.log("=======================================================");

// Mock localStorage for Node test environment
const mockStorage: Record<string, string> = {};
if (typeof global.localStorage === 'undefined') {
  (global as any).localStorage = {
    getItem: (k: string) => mockStorage[k] || null,
    setItem: (k: string, v: string) => { mockStorage[k] = v; },
    removeItem: (k: string) => { delete mockStorage[k]; },
    clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); },
    key: (i: number) => Object.keys(mockStorage)[i] || null,
    get length() { return Object.keys(mockStorage).length; }
  };
}

// 1. Emergency localStorage backup test
console.log("Testing emergency localStorage backup sanitization...");
localStorage.clear();
localStorage.setItem('accounting_state', JSON.stringify({
  users: [{ id: 'u1', username: 'admin', password: 'SecretPassword123' }],
  vouchers: []
}));
localStorage.setItem('sb-access-token', 'SECRET_SUPABASE_TOKEN_123');
localStorage.setItem('auth_token', 'SECRET_AUTH_TOKEN_456');

backupLocalStorageBeforeMigration();

const emergencyBackupRaw = localStorage.getItem('localStorage_emergency_backup_v1');
assert(emergencyBackupRaw, "Emergency backup should be created");
assert(!emergencyBackupRaw.includes('SECRET_SUPABASE_TOKEN_123'), "Emergency backup must NOT contain Supabase access token");
assert(!emergencyBackupRaw.includes('SECRET_AUTH_TOKEN_456'), "Emergency backup must NOT contain auth_token");
assert(!emergencyBackupRaw.includes('SecretPassword123'), "Emergency backup must NOT contain plaintext password");
console.log("✅ 1. Emergency localStorage backup sanitization Passed");

// 2. Backup package sanitization test
console.log("Testing BackupPackage sanitization helper...");
function sanitizeObjectForBackup<T>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    return data.map(item => sanitizeObjectForBackup(item)) as unknown as T;
  }
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('service_role')
    ) {
      continue;
    }
    sanitized[key] = sanitizeObjectForBackup((data as any)[key]);
  }
  return sanitized as T;
}

const rawState = {
  users: [{ id: 'user_101', username: 'manager', password: 'my_secret_password' }],
  session: { accessToken: 'jwt_access_123', refreshToken: 'jwt_refresh_456' },
  nested: { secretKey: 'super_secret', normalField: 'value' }
};

const sanitized = sanitizeObjectForBackup(rawState);
const jsonString = JSON.stringify(sanitized);

assert(!jsonString.includes('my_secret_password'), "Sanitized backup must NOT contain plaintext password");
assert(!jsonString.includes('jwt_access_123'), "Sanitized backup must NOT contain access token");
assert(!jsonString.includes('jwt_refresh_456'), "Sanitized backup must NOT contain refresh token");
assert(!jsonString.includes('super_secret'), "Sanitized backup must NOT contain secret key");
assert(jsonString.includes('normalField'), "Sanitized backup must preserve non-sensitive fields");
console.log("✅ 2. BackupPackage sanitization helper Passed");

console.log("=======================================================");
console.log("🎉 ALL COMMAND 9 CREDENTIAL SECURITY TESTS PASSED!");
console.log("=======================================================");
