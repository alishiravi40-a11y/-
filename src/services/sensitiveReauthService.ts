import { SupabaseClient } from '@supabase/supabase-js';

export interface MaskedPhoneFactor {
  factorId: string;
  maskedPhone: string;
}

export type DiscoverFactorsResult =
  | { status: 'phone_factor_not_enrolled' }
  | { status: 'single_factor_selected'; factorId: string }
  | { status: 'multiple_factors_available'; factors: MaskedPhoneFactor[] };

export type AssuranceCheckResult =
  | { status: 'authenticated_and_ready' }
  | { status: 'unauthorized' }
  | { status: 'sensitive_reauth_required' }
  | { status: 'service_unavailable' }
  | { status: 'generic_error' };

export interface ReauthAttemptState {
  userId: string;
  step: 'password_verified' | 'challenge_sent' | 'mfa_verified';
  startTimeSec: number;
  factorId?: string;
  challengeId?: string;
  lastChallengeTimeSec?: number;
}

export function normalizeOtpCode(codeRaw: string): string {
  if (!codeRaw || typeof codeRaw !== 'string') {
    throw new Error('Invalid verification code format');
  }

  // Convert Persian and Arabic digits to Latin digits
  let cleaned = codeRaw
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

  // Remove whitespace
  cleaned = cleaned.replace(/\s/g, '');

  // Must be exactly 6 digits
  if (!/^\d{6}$/.test(cleaned)) {
    throw new Error('Invalid verification code format');
  }

  return cleaned;
}

export function maskPhoneNumber(phone?: string): string {
  if (!phone || typeof phone !== 'string') {
    return '***';
  }
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length < 4) {
    return '***';
  }
  const lastFour = digitsOnly.slice(-4);
  return `***${lastFour}`;
}

export class SensitiveReauthService {
  private client: SupabaseClient;
  private fetchImpl: typeof fetch;
  private getCurrentTimeSec: () => number;

  private activeAttempt: ReauthAttemptState | null = null;
  private verifiedFactorsCache: Array<{ factorId: string; maskedPhone: string }> = [];
  private isChallenging = false;

  constructor(
    client: SupabaseClient,
    customFetch?: typeof fetch,
    getCurrentTimeSec?: () => number
  ) {
    this.client = client;
    this.fetchImpl = customFetch ?? (typeof window !== 'undefined' ? window.fetch.bind(window) : fetch);
    this.getCurrentTimeSec = getCurrentTimeSec ?? (() => Math.floor(Date.now() / 1000));
  }

  private getTimeSec(): number {
    return this.getCurrentTimeSec();
  }

  /**
   * Helper to inspect current in-memory attempt state safely (no sensitive data).
   */
  getAttemptState(): { userId: string; step: string; isExpired: boolean } | null {
    if (!this.activeAttempt) return null;
    const isExpired = this.isAttemptExpired();
    if (isExpired) return null;
    return {
      userId: this.activeAttempt.userId,
      step: this.activeAttempt.step,
      isExpired: false,
    };
  }

  /**
   * Manually clears the active attempt state and cached factor selection.
   */
  clearAttempt(): void {
    this.activeAttempt = null;
    this.verifiedFactorsCache = [];
    this.isChallenging = false;
  }

  private isAttemptExpired(): boolean {
    if (!this.activeAttempt) return true;
    const nowSec = this.getTimeSec();
    // Boundary check: <= 300s is valid, > 300s is expired
    if (nowSec - this.activeAttempt.startTimeSec > 300) {
      this.clearAttempt();
      return true;
    }
    return false;
  }

  /**
   * Step 1: Re-authenticates user with password.
   * Reads phone strictly from the active session.
   */
  async reauthenticatePassword(passwordInput: string): Promise<{ userId: string }> {
    if (!passwordInput || typeof passwordInput !== 'string' || passwordInput.trim() === '') {
      throw new Error('Authentication failed');
    }

    const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
    if (sessionError || !sessionData || !sessionData.session || !sessionData.session.user) {
      throw new Error('Authentication failed');
    }

    const sessionUser = sessionData.session.user;
    const initialUserId = sessionUser.id;
    const sessionPhone = sessionUser.phone;

    if (!initialUserId || !sessionPhone || typeof sessionPhone !== 'string' || sessionPhone.trim() === '') {
      throw new Error('Authentication failed');
    }

    try {
      const { data: signInData, error: signInError } = await this.client.auth.signInWithPassword({
        phone: sessionPhone,
        password: passwordInput,
      });

      if (signInError || !signInData || !signInData.user || !signInData.session) {
        throw new Error('Authentication failed');
      }

      const reauthUserId = signInData.user.id;

      // Identity check: If user ID changed during re-auth, fail closed and clear everything
      if (reauthUserId !== initialUserId) {
        await this.client.auth.signOut();
        this.clearAttempt();
        throw new Error('Authentication failed');
      }

      const nowSec = this.getTimeSec();
      this.activeAttempt = {
        userId: reauthUserId,
        step: 'password_verified',
        startTimeSec: nowSec,
      };

      return { userId: reauthUserId };
    } catch (err: any) {
      if (err.message === 'Authentication failed') {
        throw err;
      }
      throw new Error('Authentication failed');
    }
  }

  /**
   * Step 2: Discovers verified phone MFA factors.
   */
  async discoverPhoneFactors(): Promise<DiscoverFactorsResult> {
    if (!this.activeAttempt || this.isAttemptExpired()) {
      throw new Error('Reauthentication required');
    }

    const { data: sessionData } = await this.client.auth.getSession();
    if (!sessionData || !sessionData.session || !sessionData.session.user || sessionData.session.user.id !== this.activeAttempt.userId) {
      this.clearAttempt();
      throw new Error('Reauthentication required');
    }

    try {
      const { data, error } = await this.client.auth.mfa.listFactors();
      if (error || !data) {
        throw new Error('Failed to discover factors');
      }

      let rawFactors: any[] = [];
      if (Array.isArray(data)) {
        rawFactors = data;
      } else if (Array.isArray((data as any).all)) {
        rawFactors = (data as any).all;
      } else if (Array.isArray((data as any).phone)) {
        rawFactors = (data as any).phone;
      }

      const verifiedPhoneFactors = rawFactors.filter((f: any) => {
        const isPhone = f.factor_type === 'phone' || f.type === 'phone' || (f.phone && !f.totp);
        const isVerified = f.status === 'verified';
        return isPhone && isVerified;
      });

      if (verifiedPhoneFactors.length === 0) {
        return { status: 'phone_factor_not_enrolled' };
      }

      this.verifiedFactorsCache = verifiedPhoneFactors.map((f: any) => ({
        factorId: f.id,
        maskedPhone: maskPhoneNumber(f.phone || f.friendly_name),
      }));

      if (verifiedPhoneFactors.length === 1) {
        const singleFactorId = verifiedPhoneFactors[0].id;
        this.activeAttempt.factorId = singleFactorId;
        return { status: 'single_factor_selected', factorId: singleFactorId };
      }

      return {
        status: 'multiple_factors_available',
        factors: this.verifiedFactorsCache.map((item) => ({
          factorId: item.factorId,
          maskedPhone: item.maskedPhone,
        })),
      };
    } catch (err: any) {
      if (err.message === 'Reauthentication required' || err.message === 'Failed to discover factors') {
        throw err;
      }
      throw new Error('Failed to discover factors');
    }
  }

  /**
   * Explicitly selects a factor from the discovered list.
   */
  selectFactor(factorIdInput: string): void {
    if (!this.activeAttempt || this.isAttemptExpired()) {
      throw new Error('Reauthentication required');
    }

    const isValid = this.verifiedFactorsCache.some((f) => f.factorId === factorIdInput);
    if (!isValid) {
      throw new Error('Invalid factor selected');
    }

    this.activeAttempt.factorId = factorIdInput;
  }

  /**
   * Step 3: Sends SMS challenge for the chosen factor.
   */
  async sendPhoneChallenge(factorIdInput?: string): Promise<{ challengeId: string }> {
    if (!this.activeAttempt || this.isAttemptExpired()) {
      throw new Error('Reauthentication required');
    }

    const { data: sessionData } = await this.client.auth.getSession();
    if (!sessionData || !sessionData.session || !sessionData.session.user || sessionData.session.user.id !== this.activeAttempt.userId) {
      this.clearAttempt();
      throw new Error('Reauthentication required');
    }

    const targetFactorId = factorIdInput ?? this.activeAttempt.factorId;
    if (!targetFactorId) {
      throw new Error('Invalid factor');
    }

    const isFactorInCache = this.verifiedFactorsCache.some((f) => f.factorId === targetFactorId);
    if (!isFactorInCache) {
      throw new Error('Invalid factor');
    }

    const nowSec = this.getTimeSec();

    // Resend restriction: Must wait at least 60s
    if (this.activeAttempt.lastChallengeTimeSec && (nowSec - this.activeAttempt.lastChallengeTimeSec) < 60) {
      throw new Error('Challenge rate limited');
    }

    // Concurrent duplicate request guard
    if (this.isChallenging) {
      throw new Error('Challenge request already in progress');
    }

    this.isChallenging = true;

    try {
      const { data, error } = await this.client.auth.mfa.challenge({ factorId: targetFactorId });
      if (error || !data) {
        throw new Error('Challenge creation failed');
      }

      const challengeId = data.id || (data as any).challengeId;
      if (!challengeId || typeof challengeId !== 'string' || challengeId.trim() === '') {
        throw new Error('Challenge creation failed');
      }

      this.activeAttempt.factorId = targetFactorId;
      this.activeAttempt.challengeId = challengeId;
      this.activeAttempt.lastChallengeTimeSec = nowSec;
      this.activeAttempt.step = 'challenge_sent';

      return { challengeId };
    } finally {
      this.isChallenging = false;
    }
  }

  /**
   * Step 4: Verifies the SMS OTP code.
   */
  async verifyPhoneChallenge(codeRaw: string): Promise<void> {
    const normalizedCode = normalizeOtpCode(codeRaw);

    if (!this.activeAttempt || this.isAttemptExpired()) {
      throw new Error('Reauthentication required');
    }

    if (!this.activeAttempt.factorId || !this.activeAttempt.challengeId) {
      throw new Error('No active challenge');
    }

    const { data: sessionData } = await this.client.auth.getSession();
    if (!sessionData || !sessionData.session || !sessionData.session.user || sessionData.session.user.id !== this.activeAttempt.userId) {
      this.clearAttempt();
      throw new Error('Reauthentication required');
    }

    const factorId = this.activeAttempt.factorId;
    const challengeId = this.activeAttempt.challengeId;

    const { data, error } = await this.client.auth.mfa.verify({
      factorId,
      challengeId,
      code: normalizedCode,
    });

    if (error || !data) {
      throw new Error('Invalid verification code');
    }

    const verifiedUserId = (data as any).user?.id || (data as any).session?.user?.id;
    if (!verifiedUserId || verifiedUserId !== this.activeAttempt.userId) {
      await this.client.auth.signOut();
      this.clearAttempt();
      throw new Error('Authentication failed');
    }

    this.activeAttempt.step = 'mfa_verified';
  }

  /**
   * Step 5: Final server-side assurance check against /api/auth/assurance.
   */
  async finalizeAndVerifyAssurance(): Promise<AssuranceCheckResult> {
    if (!this.activeAttempt || this.isAttemptExpired()) {
      this.clearAttempt();
      return { status: 'unauthorized' };
    }

    if (this.activeAttempt.step !== 'mfa_verified') {
      return { status: 'sensitive_reauth_required' };
    }

    const attemptUserId = this.activeAttempt.userId;

    try {
      const { data: sessionData } = await this.client.auth.getSession();
      if (!sessionData || !sessionData.session || !sessionData.session.user || !sessionData.session.access_token) {
        this.clearAttempt();
        return { status: 'unauthorized' };
      }

      const freshSession = sessionData.session;
      if (freshSession.user.id !== attemptUserId) {
        this.clearAttempt();
        return { status: 'unauthorized' };
      }

      const token = freshSession.access_token;
      const endpoint = '/api/auth/assurance';

      const response = await this.fetchImpl(endpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        this.clearAttempt();
        return { status: 'unauthorized' };
      }

      if (response.status === 403) {
        this.clearAttempt();
        return { status: 'sensitive_reauth_required' };
      }

      if (response.status === 503) {
        this.clearAttempt();
        return { status: 'service_unavailable' };
      }

      if (!response.ok) {
        this.clearAttempt();
        return { status: 'generic_error' };
      }

      const body = await response.json();

      if (!body || body.authenticated !== true || body.sensitiveAuthReady !== true) {
        this.clearAttempt();
        return { status: 'generic_error' };
      }

      this.clearAttempt();
      return { status: 'authenticated_and_ready' };
    } catch {
      this.clearAttempt();
      return { status: 'service_unavailable' };
    }
  }
}
