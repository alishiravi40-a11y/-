import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabaseClient';

/**
 * Standardizes Iranian phone numbers to international format (+989XXXXXXXXX).
 * Accepts Persian, Arabic, and Latin digits and formats like 09..., 98..., +98..., 0098...
 */
export function normalizeIranianPhoneNumber(phoneInput: string): string {
  if (!phoneInput || typeof phoneInput !== 'string') {
    throw new Error('Invalid phone number format');
  }

  // Convert Persian and Arabic digits to Latin digits
  let cleaned = phoneInput
    .replace(/[۰٠]/g, '0')
    .replace(/[۱١]/g, '1')
    .replace(/[۲٢]/g, '2')
    .replace(/[۳٣]/g, '3')
    .replace(/[۴٤]/g, '4')
    .replace(/[۵٥]/g, '5')
    .replace(/[۶٦]/g, '6')
    .replace(/[۷٧]/g, '7')
    .replace(/[۸٨]/g, '8')
    .replace(/[۹٩]/g, '9');

  // Remove whitespace, dashes, parentheses
  cleaned = cleaned.replace(/[\s\-\(\)\.]/g, '');

  // Strip leading 00 or +
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  // Match Iranian mobile prefix patterns
  if (cleaned.startsWith('09') && cleaned.length === 11) {
    cleaned = '98' + cleaned.slice(1);
  } else if (cleaned.startsWith('9') && cleaned.length === 10) {
    cleaned = '98' + cleaned;
  } else if (cleaned.startsWith('989') && cleaned.length === 12) {
    // Already 989XXXXXXXXX
  } else {
    throw new Error('Invalid phone number format');
  }

  // Final check: must be 12 digits starting with 989
  if (!/^989\d{9}$/.test(cleaned)) {
    throw new Error('Invalid phone number format');
  }

  return '+' + cleaned;
}

export type AuthServerCheckResult =
  | { status: 'authenticated'; userId: string }
  | { status: 'unauthorized' }
  | { status: 'service_unavailable' }
  | { status: 'identity_mismatch' };

export class AuthSessionService {
  private client: SupabaseClient;
  private fetchImpl: typeof fetch;
  private currentSession: any = null;
  private currentUserId: string | null = null;

  constructor(client: SupabaseClient, customFetch?: typeof fetch) {
    this.client = client;
    this.fetchImpl = customFetch ?? (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);
  }

  /**
   * Signs in user using mobile phone (or email) and password strictly via POST /api/auth/login.
   * NO fallback to client.auth.signInWithPassword on network or server errors.
   */
  async signInWithMobile(phoneInput: string, passwordInput: string): Promise<{ userId: string }> {
    if (!passwordInput || typeof passwordInput !== 'string' || passwordInput.trim() === '') {
      throw new Error('Authentication failed');
    }

    const trimmedInput = phoneInput ? phoneInput.trim() : '';
    if (!trimmedInput) {
      throw new Error('Authentication failed');
    }

    try {
      const response = await this.fetchImpl('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: trimmedInput,
          password: passwordInput,
        }),
      });

      if (!response || !response.ok) {
        throw new Error('Authentication failed');
      }

      const body = await response.json().catch(() => null);
      if (
        !body ||
        body.success !== true ||
        !body.userId ||
        !body.session ||
        !body.session.access_token ||
        !body.session.refresh_token
      ) {
        throw new Error('Authentication failed');
      }

      // Check user.id mismatch if user object is present in session
      if (body.session.user && body.session.user.id && body.session.user.id !== body.userId) {
        throw new Error('Authentication failed');
      }

      this.currentSession = body.session;
      this.currentUserId = body.userId;

      if (this.client?.auth?.setSession) {
        try {
          await this.client.auth.setSession({
            access_token: body.session.access_token,
            refresh_token: body.session.refresh_token,
          });
        } catch {
          // Gracefully handle storage errors in restricted browser iframes
        }
      }

      return { userId: body.userId };
    } catch {
      throw new Error('Authentication failed');
    }
  }

  /**
   * Retrieves the active session.
   */
  async getCurrentSession() {
    try {
      if (this.client?.auth?.getSession) {
        const { data } = await this.client.auth.getSession();
        if (data?.session) {
          return data.session;
        }
      }
    } catch {
      // Fall back to in-memory session
    }
    return this.currentSession;
  }

  /**
   * Retrieves access token strictly from the current session or memory.
   */
  async getAccessToken(): Promise<string | null> {
    let session = await this.getCurrentSession();
    let token = session?.access_token || this.currentSession?.access_token || null;

    if (!token) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      session = await this.getCurrentSession();
      token = session?.access_token || this.currentSession?.access_token || null;
    }

    return token;
  }

  /**
   * Retrieves authenticated user ID from session.user.id. Ignores user metadata.
   */
  async getCurrentUserId(): Promise<string | null> {
    const session = await this.getCurrentSession();
    return (session && session.user ? session.user.id : null) || this.currentUserId || null;
  }

  /**
   * Subscribes to auth state changes. Returns an unsubscribe function.
   */
  onAuthStateChange(callback: (event: string, session: any) => void) {
    if (this.client?.auth?.onAuthStateChange) {
      const { data: subscription } = this.client.auth.onAuthStateChange((event, session) => {
        callback(event, session);
      });
      return () => {
        subscription?.subscription?.unsubscribe?.();
      };
    }
    return () => {};
  }

  /**
   * Signs out the current session.
   */
  async signOut(): Promise<void> {
    this.currentSession = null;
    this.currentUserId = null;
    try {
      if (this.client?.auth?.signOut) {
        await this.client.auth.signOut();
      }
    } catch {
      // Safe sign out
    }
  }

  /**
   * Verifies the session token against the server endpoint /api/auth/me.
   * Sends token ONLY in Authorization header.
   */
  async verifySessionWithServer(): Promise<AuthServerCheckResult> {
    const token = await this.getAccessToken();
    const localUserId = await this.getCurrentUserId();

    if (!token || !localUserId) {
      return { status: 'unauthorized' };
    }

    try {
      const endpoint = '/api/auth/me';
      const response = await this.fetchImpl(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        return { status: 'unauthorized' };
      }

      if (response.status === 503) {
        return { status: 'service_unavailable' };
      }

      if (!response.ok) {
        return { status: 'service_unavailable' };
      }

      const body = await response.json();

      if (!body || body.authenticated !== true || !body.userId) {
        return { status: 'unauthorized' };
      }

      if (body.userId !== localUserId) {
        return { status: 'identity_mismatch' };
      }

      return { status: 'authenticated', userId: body.userId };
    } catch {
      return { status: 'service_unavailable' };
    }
  }
}

let defaultAuthSessionServiceInstance: AuthSessionService | null = null;

export function getDefaultAuthSessionService(): AuthSessionService {
  if (!defaultAuthSessionServiceInstance) {
    defaultAuthSessionServiceInstance = new AuthSessionService(getSupabase());
  }
  return defaultAuthSessionServiceInstance;
}
