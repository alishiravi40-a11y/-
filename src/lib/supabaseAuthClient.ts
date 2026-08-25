import { createClient, SupabaseClient } from '@supabase/supabase-js';

const resolveEnvValue = (...keys: string[]): string => {
  for (const key of keys) {
    if (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.[key]) {
      const val = (import.meta as any).env[key];
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
    }
  }
  return '';
};

const normalizeAuthUrl = (rawUrl?: string): string => {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('postgresql://') || trimmed.startsWith('postgres://')) {
    const match = trimmed.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
    return match && match[1] ? `https://${match[1]}.supabase.co` : trimmed;
  }
  return trimmed;
};

export function createSupabaseAuthClient(
  customUrl?: string,
  customKey?: string,
  customStorage?: Storage
): SupabaseClient {
  const rawUrl = customUrl ?? resolveEnvValue('VITE_SUPABASE_URL');
  const url = normalizeAuthUrl(rawUrl);
  const key = customKey ?? resolveEnvValue('VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_KEY');

  if (!url || !key || url === '' || key.trim() === '' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    throw new Error('Supabase Auth configuration missing');
  }

  const storage = customStorage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);

  return createClient(url, key, {
    auth: {
      storageKey: 'supabase_auth_standalone_session',
      storage: storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

