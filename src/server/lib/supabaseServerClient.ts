import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

let cachedServerClient: SupabaseClient | null = null;
let mockServerClient: any = null;

const CONFIG_FILE = path.join(process.cwd(), 'supabase_config.json');

export function setMockServerClient(client: any): void {
  mockServerClient = client;
}

export function clearCachedServerClient(): void {
  cachedServerClient = null;
  mockServerClient = null;
}

export function getSupabaseServerConfig(): { url: string; key: string } {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    throw new Error('ERR_ENV_NOT_SUPPORTED: Confidential server client is only supported in a pure server-side runtime.');
  }

  let url = process.env.SUPABASE_URL || '';
  let key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  // Normalize postgresql URL if needed
  if (url && (url.startsWith('postgresql://') || url.startsWith('postgres://'))) {
    const match = url.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
    url = match && match[1] ? `https://${match[1]}.supabase.co` : 'https://kzbaencltepwisdxcbbb.supabase.co';
  }

  return { url: url.trim(), key: key.trim() };
}

export function getSupabaseServerClient(): SupabaseClient {
  if (mockServerClient) {
    return mockServerClient;
  }

  if (cachedServerClient && process.env.NODE_ENV !== 'test') {
    return cachedServerClient;
  }

  const { url, key } = getSupabaseServerConfig();

  if (!url || !key) {
    throw new Error('ERR_DB_UNCONFIGURED: Supabase server configuration is missing.');
  }

  try {
    const client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    if (process.env.NODE_ENV !== 'test') {
      cachedServerClient = client;
    }
    return client;
  } catch (err: any) {
    throw new Error(`ERR_CLIENT_INIT_FAILED: Failed to initialize Supabase server client. ${err?.message || ''}`);
  }
}
