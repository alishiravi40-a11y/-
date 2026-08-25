import { SupabaseClient } from '@supabase/supabase-js';
import { normalizeIranianPhoneNumber } from './authSessionService';
import { normalizeOtpCode } from './sensitiveReauthService';

export type PhoneMfaEnrollmentStatus =
  | 'ready_to_enroll'
  | 'already_enrolled'
  | 'pending_factor_requires_cleanup'
  | 'code_sent'
  | 'rate_limited'
  | 'invalid_code'
  | 'enrollment_complete'
  | 'unauthorized'
  | 'identity_mismatch'
  | 'service_unavailable'
  | 'cleanup_failed';

export interface PhoneMfaEnrollmentResult {
  status: PhoneMfaEnrollmentStatus;
  factorId?: string;
  challengeId?: string;
  message?: string;
}

export interface EnrollmentAttemptState {
  userId: string;
  factorId: string;
  challengeId?: string;
  startTimeSec: number;
  lastChallengeTimeSec?: number;
  step: 'enrolled' | 'challenge_sent' | 'verified';
}

export type GetTimeFn = () => number;

export class PhoneMfaEnrollmentService {
  private attempt: EnrollmentAttemptState | null = null;
  private isChallengeInFlight = false;

  constructor(
    private client: SupabaseClient,
    private fetchFn: typeof fetch = fetch,
    private getTime: GetTimeFn = () => Math.floor(Date.now() / 1000)
  ) {}

  public getAttemptState(): EnrollmentAttemptState | null {
    if (!this.attempt) return null;
    return { ...this.attempt };
  }

  public clearAttempt(): void {
    this.attempt = null;
  }

  private async verifySessionWithServer(accessToken: string): Promise<{ ok: boolean; userId?: string; status?: number }> {
    try {
      const response = await this.fetchFn('/api/auth/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        return { ok: false, status: response.status };
      }

      const data = await response.json();
      if (!data || data.authenticated === false) {
        return { ok: false, status: response.status };
      }

      const userId = data.userId || (data.user && data.user.id);
      return { ok: true, userId, status: 200 };
    } catch {
      return { ok: false, status: 503 };
    }
  }

  private async validateCurrentSession(): Promise<{
    ok: boolean;
    userId?: string;
    phone?: string;
    token?: string;
    status: PhoneMfaEnrollmentStatus;
  }> {
    const { data: sessionData, error: sessionErr } = await this.client.auth.getSession();
    if (sessionErr || !sessionData?.session || !sessionData.session.user) {
      return { ok: false, status: 'unauthorized' };
    }

    const user = sessionData.session.user;
    const rawPhone = user.phone;
    if (!rawPhone || typeof rawPhone !== 'string') {
      return { ok: false, status: 'unauthorized' };
    }

    let normalizedPhone = '';
    try {
      normalizedPhone = normalizeIranianPhoneNumber(rawPhone);
    } catch {
      return { ok: false, status: 'unauthorized' };
    }

    const token = sessionData.session.access_token;
    if (!token) {
      return { ok: false, status: 'unauthorized' };
    }

    const serverRes = await this.verifySessionWithServer(token);
    if (!serverRes.ok) {
      if (serverRes.status === 503) {
        return { ok: false, status: 'service_unavailable' };
      }
      return { ok: false, status: 'unauthorized' };
    }

    if (serverRes.userId && serverRes.userId !== user.id) {
      return { ok: false, status: 'identity_mismatch' };
    }

    return {
      ok: true,
      userId: user.id,
      phone: normalizedPhone,
      token,
      status: 'ready_to_enroll',
    };
  }

  private async checkExistingFactors(): Promise<{ status: PhoneMfaEnrollmentStatus; factorId?: string }> {
    const { data, error } = await this.client.auth.mfa.listFactors();
    if (error || !data) {
      return { status: 'service_unavailable' };
    }

    const allFactors: any[] = Array.isArray(data)
      ? data
      : (data as any).all || [];

    const phoneFactors = allFactors.filter((f: any) => f.factor_type === 'phone' || f.type === 'phone');

    const verifiedPhone = phoneFactors.find((f: any) => f.status === 'verified');
    if (verifiedPhone) {
      return { status: 'already_enrolled', factorId: verifiedPhone.id };
    }

    const unverifiedPhone = phoneFactors.find((f: any) => f.status === 'unverified');
    if (unverifiedPhone) {
      return { status: 'pending_factor_requires_cleanup', factorId: unverifiedPhone.id };
    }

    return { status: 'ready_to_enroll' };
  }

  public async checkEnrollmentEligibility(): Promise<PhoneMfaEnrollmentResult> {
    const sessionCheck = await this.validateCurrentSession();
    if (!sessionCheck.ok) {
      return { status: sessionCheck.status };
    }

    const factorCheck = await this.checkExistingFactors();
    return { status: factorCheck.status, factorId: factorCheck.factorId };
  }

  public async startEnrollment(): Promise<PhoneMfaEnrollmentResult> {
    if (this.isChallengeInFlight) {
      return { status: 'rate_limited' };
    }
    this.isChallengeInFlight = true;

    try {
      const sessionCheck = await this.validateCurrentSession();
      if (!sessionCheck.ok) {
        return { status: sessionCheck.status };
      }

      const factorCheck = await this.checkExistingFactors();
      if (factorCheck.status !== 'ready_to_enroll') {
        return { status: factorCheck.status, factorId: factorCheck.factorId };
      }

      const now = this.getTime();

      const { data: enrollData, error: enrollErr } = await this.client.auth.mfa.enroll({
        factorType: 'phone',
        phone: sessionCheck.phone!,
        friendlyName: 'Phone SMS Factor',
      });

      if (enrollErr || !enrollData || !enrollData.id) {
        return { status: 'service_unavailable' };
      }

      const enrolledType = (enrollData as any).type || (enrollData as any).factor_type;
      if (enrolledType !== 'phone') {
        return { status: 'service_unavailable' };
      }

      const factorId = enrollData.id;

      this.attempt = {
        userId: sessionCheck.userId!,
        factorId,
        startTimeSec: now,
        step: 'enrolled',
      };

      const challengeRes = await this.executeChallengeApi(factorId, now);
      if (challengeRes.status !== 'code_sent') {
        const cleanupSuccess = await this.cleanupFactorSilently(factorId);
        this.attempt = null;
        if (!cleanupSuccess) {
          return { status: 'cleanup_failed', factorId };
        }
        return { status: challengeRes.status };
      }

      return challengeRes;
    } finally {
      this.isChallengeInFlight = false;
    }
  }

  public async sendPhoneChallenge(): Promise<PhoneMfaEnrollmentResult> {
    if (this.isChallengeInFlight) {
      return { status: 'rate_limited' };
    }

    if (!this.attempt) {
      return { status: 'unauthorized' };
    }

    const now = this.getTime();

    if (now - this.attempt.startTimeSec > 300) {
      this.attempt = null;
      return { status: 'unauthorized' };
    }

    const sessionCheck = await this.validateCurrentSession();
    if (!sessionCheck.ok || sessionCheck.userId !== this.attempt.userId) {
      this.attempt = null;
      return { status: 'identity_mismatch' };
    }

    if (this.attempt.lastChallengeTimeSec !== undefined) {
      const elapsed = now - this.attempt.lastChallengeTimeSec;
      if (elapsed < 60) {
        return { status: 'rate_limited' };
      }
    }

    this.isChallengeInFlight = true;
    try {
      return await this.executeChallengeApi(this.attempt.factorId, now);
    } finally {
      this.isChallengeInFlight = false;
    }
  }

  private async executeChallengeApi(factorId: string, now: number): Promise<PhoneMfaEnrollmentResult> {
    try {
      const { data: challengeData, error: challengeErr } = await this.client.auth.mfa.challenge({
        factorId,
      });

      if (challengeErr || !challengeData || !challengeData.id) {
        return { status: 'service_unavailable' };
      }

      if (this.attempt && this.attempt.factorId === factorId) {
        this.attempt.challengeId = challengeData.id;
        this.attempt.lastChallengeTimeSec = now;
        this.attempt.step = 'challenge_sent';
      }

      return {
        status: 'code_sent',
        factorId,
        challengeId: challengeData.id,
      };
    } catch {
      return { status: 'service_unavailable' };
    }
  }

  public async verifyPhoneChallenge(codeRaw: string): Promise<PhoneMfaEnrollmentResult> {
    if (!this.attempt || !this.attempt.factorId || !this.attempt.challengeId) {
      return { status: 'invalid_code' };
    }

    const now = this.getTime();

    if (now - this.attempt.startTimeSec > 300) {
      this.attempt = null;
      return { status: 'invalid_code' };
    }

    const sessionCheck = await this.validateCurrentSession();
    if (!sessionCheck.ok || sessionCheck.userId !== this.attempt.userId) {
      this.attempt = null;
      return { status: 'identity_mismatch' };
    }

    let normalizedCode = '';
    try {
      normalizedCode = normalizeOtpCode(codeRaw);
    } catch {
      return { status: 'invalid_code' };
    }

    const { data: verifyData, error: verifyErr } = await this.client.auth.mfa.verify({
      factorId: this.attempt.factorId,
      challengeId: this.attempt.challengeId,
      code: normalizedCode,
    });

    if (verifyErr || !verifyData) {
      return { status: 'invalid_code' };
    }

    if (!verifyData.user || verifyData.user.id !== this.attempt.userId) {
      this.attempt = null;
      return { status: 'identity_mismatch' };
    }

    const verifyToken = (verifyData as any).access_token || (verifyData as any).session?.access_token;
    if (!verifyToken) {
      return { status: 'unauthorized' };
    }

    const { data: freshSessionData, error: freshSessionErr } = await this.client.auth.getSession();
    if (freshSessionErr || !freshSessionData?.session?.user) {
      return { status: 'unauthorized' };
    }

    if (freshSessionData.session.user.id !== this.attempt.userId) {
      this.attempt = null;
      return { status: 'identity_mismatch' };
    }

    const { data: aalData, error: aalErr } = await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalErr || !aalData || aalData.currentLevel !== 'aal2') {
      return { status: 'unauthorized' };
    }

    const { data: factorListData, error: factorListErr } = await this.client.auth.mfa.listFactors();
    if (factorListErr || !factorListData) {
      return { status: 'service_unavailable' };
    }

    const allFactors: any[] = Array.isArray(factorListData)
      ? factorListData
      : (factorListData as any).all || [];

    const enrolledFactorInList = allFactors.find(
      (f: any) => f.id === this.attempt!.factorId && f.status === 'verified'
    );

    if (!enrolledFactorInList) {
      return { status: 'service_unavailable' };
    }

    const finalServerCheck = await this.verifySessionWithServer(freshSessionData.session.access_token);
    if (!finalServerCheck.ok) {
      if (finalServerCheck.status === 503) {
        return { status: 'service_unavailable' };
      }
      return { status: 'unauthorized' };
    }

    if (finalServerCheck.userId && finalServerCheck.userId !== this.attempt.userId) {
      this.attempt = null;
      return { status: 'identity_mismatch' };
    }

    this.attempt = null;
    return { status: 'enrollment_complete' };
  }

  public async cancelEnrollment(): Promise<PhoneMfaEnrollmentResult> {
    if (!this.attempt) {
      const factorCheck = await this.checkExistingFactors();
      if (factorCheck.status === 'pending_factor_requires_cleanup' && factorCheck.factorId) {
        const cleaned = await this.cleanupFactorSilently(factorCheck.factorId);
        if (cleaned) {
          return { status: 'ready_to_enroll' };
        }
        return { status: 'cleanup_failed' };
      }
      return { status: 'ready_to_enroll' };
    }

    const factorIdToClean = this.attempt.factorId;

    const { data: listData } = await this.client.auth.mfa.listFactors();
    const allFactors: any[] = Array.isArray(listData)
      ? listData
      : (listData as any)?.all || [];

    const factorInList = allFactors.find((f: any) => f.id === factorIdToClean);

    if (factorInList && factorInList.status === 'verified') {
      this.attempt = null;
      return { status: 'ready_to_enroll' };
    }

    const success = await this.cleanupFactorSilently(factorIdToClean);
    if (success) {
      this.attempt = null;
      return { status: 'ready_to_enroll' };
    } else {
      return { status: 'cleanup_failed' };
    }
  }

  private async cleanupFactorSilently(factorId: string): Promise<boolean> {
    try {
      const { data: listData } = await this.client.auth.mfa.listFactors();
      const allFactors: any[] = Array.isArray(listData)
        ? listData
        : (listData as any)?.all || [];

      const factor = allFactors.find((f: any) => f.id === factorId);
      if (factor && factor.status === 'verified') {
        return false;
      }

      const { error } = await this.client.auth.mfa.unenroll({ factorId });
      return !error;
    } catch {
      return false;
    }
  }
}
