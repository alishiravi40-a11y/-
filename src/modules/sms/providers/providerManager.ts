/**
 * SMS Provider Gateway Manager
 * Central Gateway for all SMS dispatches with automated Failover,
 * Health monitoring, Logging, Credential protection, and Deduplication safety.
 */

import { ISmsProvider } from './provider.interface';
import { SmsProviderRegistry, globalSmsProviderRegistry } from './providerRegistry';
import { SmsProviderHealthChecker, globalSmsProviderHealthChecker } from './providerHealthChecker';
import { SmsSettingsManager } from '../smsSettings';
import { SmsLogger, globalSmsLogger } from '../smsLogger';
import { SmsMessage, SmsPriority, SmsSendResult, ProviderHealthResult } from '../types';

export interface ProviderGatewayDispatchOptions {
  recipientPhone: string;
  content: string;
  priority?: SmsPriority;
  patternId?: string;
  patternTokens?: Record<string, string>;
  messageId?: string; // Internal SMS Message ID for tracking
}

export interface ProviderGatewayDispatchResult extends SmsSendResult {
  providerIdUsed: string;
  providerNameUsed: string;
  isFailoverUsed: boolean;
  attemptCount: number;
}

export class SmsProviderManager {
  private registry: SmsProviderRegistry;
  private healthChecker: SmsProviderHealthChecker;
  private settingsManager: SmsSettingsManager;
  private logger: SmsLogger;

  constructor(
    registry: SmsProviderRegistry = globalSmsProviderRegistry,
    healthChecker: SmsProviderHealthChecker = globalSmsProviderHealthChecker,
    settingsManager: SmsSettingsManager = new SmsSettingsManager(),
    logger: SmsLogger = globalSmsLogger
  ) {
    this.registry = registry;
    this.healthChecker = healthChecker;
    this.settingsManager = settingsManager;
    this.logger = logger;
  }

  /**
   * Set settings manager instance
   */
  setSettingsManager(manager: SmsSettingsManager) {
    this.settingsManager = manager;
  }

  /**
   * Get Primary active provider instance
   */
  getPrimaryProvider(): ISmsProvider {
    const settings = this.settingsManager.getSettings();
    const activeId = settings.activeProviderId;
    const provider = this.registry.getProvider(activeId);

    if (provider) return provider;

    // Fallback to default mock if configured provider is missing
    return this.registry.getDefaultMockProvider();
  }

  /**
   * Get Fallback secondary provider instance
   */
  getFallbackProvider(): ISmsProvider | undefined {
    const settings = this.settingsManager.getSettings();
    if (settings.fallbackProviderId) {
      const fallback = this.registry.getProvider(settings.fallbackProviderId);
      if (fallback) return fallback;
    }

    // Default secondary fallback is Mock Provider if primary is real
    const primary = this.getPrimaryProvider();
    if (primary.getProviderInfo().type !== 'mock') {
      return this.registry.getDefaultMockProvider();
    }

    return undefined;
  }

  /**
   * Dispatch SMS through Gateway (with automatic failover)
   */
  async dispatchSms(options: ProviderGatewayDispatchOptions): Promise<ProviderGatewayDispatchResult> {
    const primaryProvider = this.getPrimaryProvider();
    const primaryInfo = primaryProvider.getProviderInfo();

    this.logger.log(
      'EVENT_DISPATCHED',
      `شروع ارسال پیامک از طریق درگاه [${primaryInfo.name}] به شماره ${options.recipientPhone}`,
      { messageId: options.messageId, recipientPhone: options.recipientPhone }
    );

    let attemptCount = 1;

    // Attempt 1: Primary Provider
    const primaryResult = await this.executeProviderSend(primaryProvider, options);

    if (primaryResult.success) {
      this.logger.log(
        'SEND_SUCCESS',
        `پیامک با موفقیت توسط درگاه [${primaryInfo.name}] ارسال شد. شناسه درگاه: ${primaryResult.messageId}`,
        { messageId: options.messageId, recipientPhone: options.recipientPhone, providerId: primaryInfo.id, cost: primaryResult.cost }
      );

      return {
        ...primaryResult,
        providerIdUsed: primaryInfo.id,
        providerNameUsed: primaryInfo.name,
        isFailoverUsed: false,
        attemptCount: 1,
      };
    }

    // Primary Provider failed -> Log failure
    this.logger.log(
      'SEND_FAILED',
      `ارسال پیامک با درگاه اصلی [${primaryInfo.name}] ناموفق بود: ${primaryResult.error}`,
      { messageId: options.messageId, recipientPhone: options.recipientPhone, providerId: primaryInfo.id, errorCode: primaryResult.errorCode }
    );

    // Attempt Failover if fallback provider is available
    const fallbackProvider = this.getFallbackProvider();
    if (fallbackProvider && fallbackProvider.getProviderInfo().id !== primaryInfo.id) {
      const fallbackInfo = fallbackProvider.getProviderInfo();
      attemptCount = 2;

      this.logger.log(
        'FAILOVER_TRIGGERED',
        `انتقال خودکار ارسال پیامک به درگاه پشتیبان [${fallbackInfo.name}] به دلیل خطای درگاه اصلی.`,
        { messageId: options.messageId, recipientPhone: options.recipientPhone }
      );

      const fallbackResult = await this.executeProviderSend(fallbackProvider, options);

      if (fallbackResult.success) {
        this.logger.log(
          'SEND_SUCCESS',
          `ارسال موفقیت‌آمیز پیامک از طریق درگاه جایگزین [${fallbackInfo.name}]. شناسه: ${fallbackResult.messageId}`,
          { messageId: options.messageId, recipientPhone: options.recipientPhone, providerId: fallbackInfo.id, isFailover: true }
        );

        return {
          ...fallbackResult,
          providerIdUsed: fallbackInfo.id,
          providerNameUsed: fallbackInfo.name,
          isFailoverUsed: true,
          attemptCount: 2,
        };
      } else {
        this.logger.log(
          'SEND_FAILED',
          `ارسال پیامک با درگاه پشتیبان [${fallbackInfo.name}] نیز ناموفق بود: ${fallbackResult.error}`,
          { messageId: options.messageId, recipientPhone: options.recipientPhone, providerId: fallbackInfo.id, errorCode: fallbackResult.errorCode }
        );
      }
    }

    // Both primary & fallback failed
    return {
      success: false,
      error: primaryResult.error || 'خطای نا مشخص در ارسال پیامک',
      errorCode: primaryResult.errorCode || 'GATEWAY_ERROR',
      providerIdUsed: primaryInfo.id,
      providerNameUsed: primaryInfo.name,
      isFailoverUsed: false,
      attemptCount,
    };
  }

  /**
   * Internal helper to execute send via a specific provider instance
   */
  private async executeProviderSend(
    provider: ISmsProvider,
    options: ProviderGatewayDispatchOptions
  ): Promise<SmsSendResult> {
    try {
      if (options.patternId && options.patternTokens && provider.getProviderInfo().supportPattern) {
        return await provider.sendPatternSms(
          options.recipientPhone,
          options.patternId,
          options.patternTokens
        );
      } else {
        return await provider.sendSms(
          options.recipientPhone,
          options.content,
          options.priority
        );
      }
    } catch (err: any) {
      return {
        success: false,
        error: `استثنای درگاه پیامک: ${err.message}`,
        errorCode: 'PROVIDER_EXCEPTION',
      };
    }
  }

  /**
   * Run health checks on active and fallback providers
   */
  async runHealthChecks(): Promise<ProviderHealthResult[]> {
    const providers = this.registry.getAllProviders();
    const results = await this.healthChecker.checkAllHealth(providers);

    results.forEach((res) => {
      this.logger.log(
        'PROVIDER_HEALTH_CHECK',
        `بررسی وضعیت درگاه [${res.providerName}]: ${res.isHealthy ? 'سالم' : 'دارای خطا (${res.error})'} - اعتبار: ${res.creditBalance} ریال - تاخیر: ${res.latencyMs}ms`
      );
    });

    return results;
  }
}

export const globalSmsProviderManager = new SmsProviderManager();
