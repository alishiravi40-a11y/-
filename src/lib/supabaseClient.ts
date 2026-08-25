import { createClient } from '@supabase/supabase-js';

const normalizeSupabaseUrl = (rawUrl?: string): string => {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('postgresql://') || trimmed.startsWith('postgres://')) {
    const match = trimmed.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
    return match && match[1] ? `https://${match[1]}.supabase.co` : 'https://kzbaencltepwisdxcbbb.supabase.co';
  }
  return trimmed;
};

const resolveEnvValue = (...keys: string[]): string => {
  for (const key of keys) {
    if (typeof window !== 'undefined') {
      try {
        const metaGetter = new Function('return import.meta.env');
        const env = metaGetter();
        if (env && env[key]) {
          const val = env[key];
          if (typeof val === 'string' && val.trim() !== '') return val.trim();
        }
      } catch (e) {
        // Ignore evaluation errors
      }
    }
  }
  return '';
};

let rawSupabaseUrl = resolveEnvValue('VITE_SUPABASE_URL', 'VITE_SUPABASE_KEY');
let supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl);
let supabaseAnonKey = resolveEnvValue('VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_KEY');

// Check local storage for runtime user-supplied Supabase keys
try {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('custom_supabase_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.url && parsed.key) {
        supabaseUrl = normalizeSupabaseUrl(parsed.url);
        supabaseAnonKey = parsed.key;
      }
    }
  }
} catch (e) {
  // Ignore localStorage read errors
}

let supabaseClient: any = null;

export const setSupabaseConfig = (url: string, key: string) => {
  const normalizedUrl = normalizeSupabaseUrl(url);
  if (normalizedUrl && !normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    throw new Error("Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.");
  }
  supabaseUrl = normalizedUrl;
  supabaseAnonKey = key ? key.trim() : '';
  supabaseClient = null; // reset instance so next getSupabase reinitializes
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    localStorage.setItem('custom_supabase_config', JSON.stringify({ url: normalizedUrl, key: supabaseAnonKey }));
  }
};

export const getSupabaseConfig = () => {
  return { url: supabaseUrl, key: supabaseAnonKey };
};

export const isSupabaseConfigured = (): boolean => {
  return Boolean(supabaseUrl && supabaseAnonKey && (supabaseUrl.startsWith('http://') || supabaseUrl.startsWith('https://')));
};

export const getSupabase = (): any => {
  if (!supabaseClient && supabaseUrl && supabaseAnonKey) {
    if (supabaseUrl.startsWith('http://') || supabaseUrl.startsWith('https://')) {
      try {
        supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
          global: {
            headers: { 'x-client-info': 'nesyeh-accounting-safe-client' },
          },
        });
      } catch (e) {
        console.error('Failed to initialize Supabase client:', e);
      }
    }
  }
  return supabaseClient;
};

/**
 * Safe query executor that catches network and timeout exceptions
 * preventing unhandled promise rejections or UI crashes.
 */
export async function safeSupabaseQuery<T>(
  queryFn: (client: any) => Promise<{ data: T | null; error: any }>,
  fallbackValue: T | null = null,
  timeoutMs: number = 8000
): Promise<{ data: T | null; error: any; isOfflineOrTimeout?: boolean }> {
  const client = getSupabase();
  if (!client) {
    return { data: fallbackValue, error: new Error('Supabase client not configured'), isOfflineOrTimeout: true };
  }

  try {
    const timeoutPromise = new Promise<{ data: null; error: any; isOfflineOrTimeout: boolean }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error('Supabase request timeout'), isOfflineOrTimeout: true }), timeoutMs)
    );

    const result = await Promise.race([
      queryFn(client).then(res => ({ ...res, isOfflineOrTimeout: false })),
      timeoutPromise
    ]);

    return result;
  } catch (err: any) {
    console.warn('Supabase query intercepted by safe error guard:', err?.message || err);
    return { data: fallbackValue, error: err, isOfflineOrTimeout: true };
  }
}

