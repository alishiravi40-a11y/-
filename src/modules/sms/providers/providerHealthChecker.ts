/**
 * SMS Provider Health Checker
 * Evaluates operational availability, latency, and credit balance of providers safely.
 */

import { ISmsProvider } from './provider.interface';
import { ProviderHealthResult } from '../types';

export class SmsProviderHealthChecker {
  /**
   * Check health of a single provider safely
   */
  async checkProviderHealth(provider: ISmsProvider): Promise<ProviderHealthResult> {
    const info = provider.getProviderInfo();
    const startTime = Date.now();

    try {
      let isHealthy = true;
      let errorMsg: string | undefined = undefined;

      // Check test connection if supported
      if (provider.testConnection) {
        const testRes = await provider.testConnection();
        if (!testRes.success) {
          isHealthy = false;
          errorMsg = testRes.message;
        }
      }

      // Check credit balance
      let creditBalance = 0;
      try {
        creditBalance = await provider.getCreditBalance();
        if (creditBalance <= 0 && isHealthy) {
          isHealthy = false;
          errorMsg = 'اعتبار حساب پیامک صفر است';
        }
      } catch (err: any) {
        isHealthy = false;
        errorMsg = `خطای دریافت اعتبار: ${err.message}`;
      }

      const latencyMs = Date.now() - startTime;

      return {
        providerId: info.id,
        providerName: info.name,
        isHealthy,
        creditBalance,
        latencyMs,
        checkedAt: new Date().toISOString(),
        error: errorMsg,
      };
    } catch (err: any) {
      return {
        providerId: info.id,
        providerName: info.name,
        isHealthy: false,
        creditBalance: 0,
        latencyMs: Date.now() - startTime,
        checkedAt: new Date().toISOString(),
        error: `تست سلامت ناموفق: ${err.message}`,
      };
    }
  }

  /**
   * Check health of multiple providers in parallel
   */
  async checkAllHealth(providers: ISmsProvider[]): Promise<ProviderHealthResult[]> {
    const promises = providers.map((p) => this.checkProviderHealth(p));
    return Promise.all(promises);
  }
}

export const globalSmsProviderHealthChecker = new SmsProviderHealthChecker();
