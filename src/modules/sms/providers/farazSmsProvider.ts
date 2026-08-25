/**
 * FarazSMS (IPPanel) Gateway Provider Stub
 * Implements ISmsProvider for FarazSMS / IPPanel webservice.
 * Isolated structure with safe API key handling & zero hardcoded credentials.
 */

import { ISmsProvider } from './provider.interface';
import { SmsPriority, SmsProviderConfig, SmsSendResult, SmsStatus } from '../types';
import { sanitizeProviderConfig } from './securityUtils';

export class FarazSmsProvider implements ISmsProvider {
  private config: SmsProviderConfig;

  constructor(customConfig?: Partial<SmsProviderConfig>) {
    this.config = {
      id: 'farazsms_primary',
      name: 'فراز اس‌ام‌اس / IPPanel (FarazSMS Gateway)',
      type: 'farazsms',
      apiKey: customConfig?.apiKey || '',
      senderLine: customConfig?.senderLine || '3000505',
      baseUrl: 'https://ippanel.com/api/select',
      isActive: customConfig?.isActive ?? false,
      isDefault: false,
      supportPattern: true,
      rateLimitPerMinute: 400,
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
        error: 'کلید ارتباطی (API Key) فراز اس‌ام‌اس تنظیم نشده است.',
        errorCode: 'MISSING_API_KEY',
      };
    }

    if (this.config.apiKey.startsWith('TEST_') || this.config.apiKey.includes('MOCK')) {
      return {
        success: true,
        messageId: `FRZ_STUB_${Date.now()}`,
        cost: 155,
        rawResponse: { status: 'OK', code: 200 },
      };
    }

    return {
      success: true,
      messageId: `FRZ_MSG_${Date.now()}`,
      cost: 155,
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
        error: 'کلید ارتباطی (API Key) فراز اس‌ام‌اس تنظیم نشده است.',
        errorCode: 'MISSING_API_KEY',
      };
    }

    return {
      success: true,
      messageId: `FRZ_PAT_${Date.now()}`,
      cost: 135,
      rawResponse: { patternId, tokens },
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
    return 750000;
  }

  async testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    const start = Date.now();
    if (!this.config.apiKey) {
      return {
        success: false,
        message: 'کلید API فراز اس‌ام‌اس تنظیم نشده است',
        latencyMs: Date.now() - start,
      };
    }
    return {
      success: true,
      message: 'تنظیمات اولیه درگاه فراز اس‌ام‌اس برقرار است',
      latencyMs: Date.now() - start + 10,
    };
  }
}
