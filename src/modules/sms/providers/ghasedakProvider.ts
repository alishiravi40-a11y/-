/**
 * Ghasedak SMS Gateway Provider Stub
 * Implements ISmsProvider for Ghasedak webservice.
 * Isolated structure with safe API key handling & zero hardcoded credentials.
 */

import { ISmsProvider } from './provider.interface';
import { SmsPriority, SmsProviderConfig, SmsSendResult, SmsStatus } from '../types';
import { sanitizeProviderConfig } from './securityUtils';

export class GhasedakSmsProvider implements ISmsProvider {
  private config: SmsProviderConfig;

  constructor(customConfig?: Partial<SmsProviderConfig>) {
    this.config = {
      id: 'ghasedak_primary',
      name: 'قاصدک (Ghasedak Gateway)',
      type: 'ghasedak',
      apiKey: customConfig?.apiKey || '',
      senderLine: customConfig?.senderLine || '300021',
      baseUrl: 'https://api.ghasedak.me/v2',
      isActive: customConfig?.isActive ?? false,
      isDefault: false,
      supportPattern: true,
      rateLimitPerMinute: 350,
      ...customConfig,
    };
  }

  getProviderInfo(): SmsProviderConfig {
    return sanitizeProviderConfig(this.config);
  }

  async sendSms(
    recipientPhone: string,
    content: string,
    _priority: SmsPriority = 'normal'
  ): Promise<SmsSendResult> {
    if (!this.config.apiKey) {
      return {
        success: false,
        error: 'کلید ارتباطی (API Key) قاصدک تنظیم نشده است.',
        errorCode: 'MISSING_API_KEY',
      };
    }

    return {
      success: true,
      messageId: `GHS_MSG_${Date.now()}`,
      cost: 150,
    };
  }

  async sendPatternSms(
    recipientPhone: string,
    patternId: string,
    tokens: Record<string, string>
  ): Promise<SmsSendResult> {
    if (!this.config.apiKey) {
      return {
        success: false,
        error: 'کلید ارتباطی (API Key) قاصدک تنظیم نشده است.',
        errorCode: 'MISSING_API_KEY',
      };
    }

    return {
      success: true,
      messageId: `GHS_PAT_${Date.now()}`,
      cost: 130,
    };
  }

  async checkDeliveryStatus(messageIdFromProvider: string): Promise<{
    status: SmsStatus;
    deliveredAt?: string;
    error?: string;
  }> {
    return { status: 'sent', deliveredAt: new Date().toISOString() };
  }

  async getCreditBalance(): Promise<number> {
    if (!this.config.apiKey) return 0;
    return 600000;
  }

  async testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    const start = Date.now();
    if (!this.config.apiKey) {
      return {
        success: false,
        message: 'کلید API قاصدک تنظیم نشده است',
        latencyMs: Date.now() - start,
      };
    }
    return {
      success: true,
      message: 'تنظیمات اولیه درگاه قاصدک برقرار است',
      latencyMs: Date.now() - start + 8,
    };
  }
}
