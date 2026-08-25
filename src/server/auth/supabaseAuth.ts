import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient, getSupabaseServerConfig } from '../lib/supabaseServerClient';

export interface AuthenticationMethod {
  method: string;
  timestamp: number;
}

export interface VerifiedAuthContext {
  userId: string;
  aal: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  amr: AuthenticationMethod[];
}

export type TokenVerificationResult =
  | { status: 'success'; userId: string }
  | { status: 'invalid' }
  | { status: 'unconfigured' }
  | { status: 'service_error' };

export type DetailedTokenVerificationResult =
  | { status: 'success'; context: VerifiedAuthContext }
  | { status: 'invalid' }
  | { status: 'unconfigured' }
  | { status: 'service_error' };

export interface ITokenVerifier {
  isConfigured(): boolean;
  verifyToken(accessToken: string): Promise<TokenVerificationResult>;
  verifyTokenWithClaims?(accessToken: string, currentTimeSec?: number): Promise<DetailedTokenVerificationResult>;
}

export interface ISensitiveTokenVerifier extends ITokenVerifier {
  verifyTokenWithClaims(accessToken: string, currentTimeSec?: number): Promise<DetailedTokenVerificationResult>;
}

export function validateClaims(
  claims: any,
  verifiedUserId: string,
  nowSec: number,
  expectedSupabaseUrl?: string
): VerifiedAuthContext | null {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    return null;
  }

  // 1. sub must match verifiedUserId exactly
  if (typeof claims.sub !== 'string' || claims.sub !== verifiedUserId) {
    return null;
  }

  // 2. aud must include "authenticated"
  if (typeof claims.aud === 'string') {
    if (claims.aud !== 'authenticated') return null;
  } else if (Array.isArray(claims.aud)) {
    if (!claims.aud.includes('authenticated')) return null;
  } else {
    return null;
  }

  // 3. role must be "authenticated"
  if (typeof claims.role !== 'string' || claims.role !== 'authenticated') {
    return null;
  }

  // 4. is_anonymous MUST be present and strictly false
  if (typeof claims.is_anonymous !== 'boolean' || claims.is_anonymous !== false) {
    return null;
  }

  // 5. session_id MUST be present and non-empty string. Guess sid fallback is rejected.
  if (typeof claims.session_id !== 'string' || claims.session_id.trim() === '') {
    return null;
  }
  const sessionId = claims.session_id;

  // 6. aal MUST be strictly 'aal1' or 'aal2'
  if (claims.aal !== 'aal1' && claims.aal !== 'aal2') {
    return null;
  }
  const aal = claims.aal;

  // 7. iat and exp MUST be valid, finite integers
  const isInteger = (val: any) => typeof val === 'number' && Number.isFinite(val) && Math.floor(val) === val;
  if (!isInteger(claims.exp) || !isInteger(claims.iat)) {
    return null;
  }

  // 8. exp in future, iat <= nowSec + 30, and iat <= exp
  if (claims.exp <= nowSec || claims.iat > nowSec + 30 || claims.iat > claims.exp) {
    return null;
  }

  // 9. iss MUST match server configured Supabase URL with official suffix /auth/v1
  if (typeof claims.iss !== 'string' || claims.iss.trim() === '') {
    return null;
  }

  if (expectedSupabaseUrl && expectedSupabaseUrl.trim() !== '') {
    const formattedUrl = expectedSupabaseUrl.replace(/\/+$/, '');
    const expectedIss = `${formattedUrl}/auth/v1`;
    if (claims.iss !== expectedIss) {
      return null;
    }
  } else {
    if (!claims.iss.endsWith('/auth/v1')) {
      return null;
    }
  }

  // 10. amr array processing
  const amr: AuthenticationMethod[] = [];
  if (Array.isArray(claims.amr)) {
    for (const item of claims.amr) {
      if (item && typeof item === 'object') {
        if (typeof item.method === 'string' && typeof item.timestamp === 'number') {
          amr.push({ method: item.method, timestamp: item.timestamp });
        }
      }
    }
  }

  return {
    userId: verifiedUserId,
    aal,
    sessionId,
    issuedAt: claims.iat,
    expiresAt: claims.exp,
    amr,
  };
}

export class ServerSupabaseAuthVerifier implements ISensitiveTokenVerifier {
  private client: SupabaseClient | null = null;
  private supabaseUrl: string | undefined;

  constructor(supabaseUrl?: string, supabaseAnonKey?: string) {
    let url = supabaseUrl;
    let key = supabaseAnonKey;

    if (!url || !key) {
      const config = getSupabaseServerConfig();
      url = url || config.url;
      key = key || config.key;
    }

    if (url && (url.startsWith('postgresql://') || url.startsWith('postgres://'))) {
      const match = url.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
      if (match && match[1]) {
        url = `https://${match[1]}.supabase.co`;
      }
    }

    if (url && key && url.trim() !== '' && key.trim() !== '') {
      const trimmedUrl = url.trim();
      if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
        this.supabaseUrl = trimmedUrl;
        try {
          // If no custom URL/key were passed, we can reuse the cached singleton client
          if (!supabaseUrl && !supabaseAnonKey) {
            this.client = getSupabaseServerClient();
          } else {
            this.client = createClient(trimmedUrl, key, {
              auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
              },
            });
          }
        } catch (e) {
          console.error('Failed to initialize ServerSupabaseAuthVerifier client:', e);
        }
      }
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async verifyToken(accessToken: string): Promise<TokenVerificationResult> {
    if (!this.client) {
      return { status: 'unconfigured' };
    }

    try {
      const { data, error } = await this.client.auth.getUser(accessToken);
      if (error) {
        if (error.status && error.status >= 500) {
          return { status: 'service_error' };
        }
        return { status: 'invalid' };
      }

      if (!data || !data.user || !data.user.id) {
        return { status: 'invalid' };
      }

      return { status: 'success', userId: data.user.id };
    } catch (err) {
      return { status: 'service_error' };
    }
  }

  async verifyTokenWithClaims(accessToken: string, currentTimeSec?: number): Promise<DetailedTokenVerificationResult> {
    if (!this.client) {
      return { status: 'unconfigured' };
    }

    const nowSec = currentTimeSec ?? Math.floor(Date.now() / 1000);

    try {
      const { data: userData, error: userError } = await this.client.auth.getUser(accessToken);
      if (userError) {
        if (userError.status && userError.status >= 500) {
          return { status: 'service_error' };
        }
        return { status: 'invalid' };
      }

      if (!userData || !userData.user || !userData.user.id) {
        return { status: 'invalid' };
      }

      const verifiedUserId = userData.user.id;

      type AuthClientWithGetClaims = {
        getClaims: (token: string) => Promise<{
          data: { claims: any; header?: any; signature?: string } | null;
          error: any;
        }>;
      };

      const authInstance = this.client.auth as unknown as Partial<AuthClientWithGetClaims>;
      if (typeof authInstance.getClaims !== 'function') {
        return { status: 'service_error' };
      }

      const { data: claimsResponseData, error: claimsError } = await authInstance.getClaims(accessToken);

      if (claimsError) {
        if (claimsError.status && claimsError.status >= 500) {
          return { status: 'service_error' };
        }
        return { status: 'invalid' };
      }

      if (!claimsResponseData || !claimsResponseData.claims) {
        return { status: 'invalid' };
      }

      const verifiedContext = validateClaims(claimsResponseData.claims, verifiedUserId, nowSec, this.supabaseUrl);
      if (!verifiedContext) {
        return { status: 'invalid' };
      }

      return { status: 'success', context: verifiedContext };
    } catch (err) {
      return { status: 'service_error' };
    }
  }
}
