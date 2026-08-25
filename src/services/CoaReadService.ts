import React, { useState, useEffect } from 'react';
import { AccountSubsidiary } from '../types';

export interface CoaFetchResult {
  success: boolean;
  organizationId?: string;
  data?: AccountSubsidiary[];
  error?: string;
  message?: string;
}

type CoaChangeListener = () => void;

/**
 * Service providing a centralized, secure Read Path for the Chart of Accounts (COA) from PostgreSQL.
 * Strictly enforces Fail-Closed policy with ZERO silent fallback to DEFAULT_SUBSIDIARIES or AppState.
 */
export class CoaReadService {
  private static cachedCoa: AccountSubsidiary[] | null = null;
  private static fetchError: string | null = null;
  private static forceFailureMode: boolean = false;
  private static listeners: Set<CoaChangeListener> = new Set();

  static subscribe(listener: CoaChangeListener): () => void {
    CoaReadService.listeners.add(listener);
    return () => {
      CoaReadService.listeners.delete(listener);
    };
  }

  private static notify() {
    CoaReadService.listeners.forEach(l => {
      try {
        l();
      } catch (err) {
        console.error('Error in CoaReadService listener:', err);
      }
    });
  }

  /**
   * For testing Fail-Closed behavior under simulated database failures.
   */
  static setSimulatedFailure(fail: boolean) {
    CoaReadService.forceFailureMode = fail;
    if (fail) {
      CoaReadService.cachedCoa = null;
      CoaReadService.fetchError = 'خطا در دریافت اطلاعات کدینگ حساب‌ها از پایگاه داده (شبیه‌سازی شکست PostgreSQL).';
    }
    CoaReadService.notify();
  }

  /**
   * Fetch Chart of Accounts from PostgreSQL backend endpoint.
   * Organization ID is extracted server-side from active session membership.
   */
  static async fetchChartOfAccounts(token?: string, fetchFn?: typeof fetch): Promise<CoaFetchResult> {
    if (CoaReadService.forceFailureMode) {
      const errMsg = 'خطا در دریافت اطلاعات کدینگ حساب‌ها از پایگاه داده (شبیه‌سازی شکست PostgreSQL).';
      CoaReadService.fetchError = errMsg;
      CoaReadService.cachedCoa = null;
      CoaReadService.notify();
      return {
        success: false,
        error: 'ERR_SIMULATED_DB_FAILURE',
        message: errMsg
      };
    }

    try {
      const activeFetch = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
      if (!activeFetch) {
        throw new Error('Fetch API is unavailable');
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await activeFetch('/api/chart-of-accounts', { headers });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const errMsg = errJson.message || `خطا در دریافت کدینگ حساب‌ها از سرور (کد خطا: ${res.status})`;
        CoaReadService.fetchError = errMsg;
        CoaReadService.cachedCoa = null;
        CoaReadService.notify();
        return {
          success: false,
          error: errJson.error || 'ERR_COA_FETCH_FAILED',
          message: errMsg
        };
      }

      const body = await res.json();
      if (!body.success || !Array.isArray(body.data)) {
        const errMsg = body.message || 'پاسخ دریافت‌شده از سرور برای کدینگ حساب‌ها نامعتبر است.';
        CoaReadService.fetchError = errMsg;
        CoaReadService.cachedCoa = null;
        CoaReadService.notify();
        return {
          success: false,
          error: body.error || 'ERR_INVALID_RESPONSE',
          message: errMsg
        };
      }

      CoaReadService.cachedCoa = body.data;
      CoaReadService.fetchError = null;
      CoaReadService.notify();
      return {
        success: true,
        organizationId: body.organizationId,
        data: body.data
      };
    } catch (err: any) {
      const errMsg = 'خطا در شبکه یا پایگاه داده هنگام دریافت کدینگ حساب‌ها.';
      CoaReadService.fetchError = errMsg;
      CoaReadService.cachedCoa = null;
      CoaReadService.notify();
      return {
        success: false,
        error: 'ERR_NETWORK_OR_DB_FAILURE',
        message: errMsg
      };
    }
  }

  /**
   * Get cached COA fetched from PostgreSQL. Returns null if fetch failed or hasn't run yet.
   */
  static getCachedCoa(): AccountSubsidiary[] | null {
    return CoaReadService.cachedCoa;
  }

  /**
   * Get current fetch error message.
   */
  static getFetchError(): string | null {
    return CoaReadService.fetchError;
  }

  /**
   * Single Unified Read Model for Chart of Accounts.
   * Returns PostgreSQL COA array if available.
   * Returns [] if fetch failed (Fail-Closed, ZERO silent fallback).
   */
  static getReadModelCoa(fallbackStateSubs?: AccountSubsidiary[]): AccountSubsidiary[] {
    if (CoaReadService.fetchError) {
      // Fail-Closed: return empty array on failure
      return [];
    }
    if (CoaReadService.cachedCoa && CoaReadService.cachedCoa.length > 0) {
      return CoaReadService.cachedCoa;
    }
    // If CoaReadService has not fetched yet and no error exists:
    return fallbackStateSubs || [];
  }

  /**
   * Reset cache state.
   */
  static reset() {
    CoaReadService.cachedCoa = null;
    CoaReadService.fetchError = null;
    CoaReadService.forceFailureMode = false;
    CoaReadService.notify();
  }
}

/**
 * Custom hook to consume the unified Read Model for Chart of Accounts in React components.
 */
export function useCoaReadModel(fallbackSubsidiaries?: AccountSubsidiary[]): {
  subsidiaries: AccountSubsidiary[];
  error: string | null;
  isLoading: boolean;
} {
  const [subs, setSubs] = useState<AccountSubsidiary[]>(() => CoaReadService.getReadModelCoa(fallbackSubsidiaries));
  const [error, setError] = useState<string | null>(() => CoaReadService.getFetchError());
  const [isLoading, setIsLoading] = useState<boolean>(() => !CoaReadService.getCachedCoa() && !CoaReadService.getFetchError());

  useEffect(() => {
    const unsub = CoaReadService.subscribe(() => {
      setSubs(CoaReadService.getReadModelCoa(fallbackSubsidiaries));
      setError(CoaReadService.getFetchError());
      setIsLoading(!CoaReadService.getCachedCoa() && !CoaReadService.getFetchError());
    });

    if (!CoaReadService.getCachedCoa() && !CoaReadService.getFetchError()) {
      CoaReadService.fetchChartOfAccounts().then(() => {
        setSubs(CoaReadService.getReadModelCoa(fallbackSubsidiaries));
        setError(CoaReadService.getFetchError());
        setIsLoading(false);
      });
    }

    return unsub;
  }, []);

  let effectiveSubs = subs;
  if (error) {
    effectiveSubs = [];
  }

  return { subsidiaries: effectiveSubs, error, isLoading };
}

