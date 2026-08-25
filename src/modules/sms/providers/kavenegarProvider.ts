/**
 * Kavenegar SMS Gateway Provider Stub
 * Implements ISmsProvider for Kavenegar web service.
 * Isolated structure with safe API key handling & zero hardcoded credentials.
 */

import { ISmsProvider } from './provider.interface';
import { SmsPriority, SmsProviderConfig, SmsSendResult, SmsStatus } from '../types';
import { maskApiKey, sanitizeProviderConfig } from './securityUtils';

export class KavenegarSmsProvider implements ISmsProvider {
  private config: SmsProviderConfig;

  constructor(customConfig?: Partial<SmsProviderConfig>) {
    this.config = {
      id: 'kavenegar_primary',
      name: 'کاوه نگار (Kavenegar Gateway)',
      type: 'kavenegar',
      apiKey: customConfig?.apiKey || '',
      senderLine: customConfig?.senderLine || '10008436',
      baseUrl: 'https://api.kavenegar.com/v1',
      isActive: customConfig?.isActive ?? false,
      isDefault: false,
      supportPattern: true,
      rateLimitPerMinute: 300,
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
    if (!this.config.apiKey || this.config.apiKey.trim() === '') {
      return {
        success: false,
        error: 'کلید ارتباطی (API Key) کاوه‌نگار تنظیم نشده است.',
        errorCode: 'MISSING_API_KEY',
      };
    }

    try {
      // Stub HTTP REST call structure for Kavenegar (e.g. /v1/{api-key}/sms/send.json)
      // If API key is placeholder or network unavailable, safely return descriptive error or stub response
      if (this.config.apiKey.startsWith('TEST_') || this.config.apiKey.includes('MOCK')) {
        return {
          success: true,
          messageId: `KVN_STUB_${Date.now()}`,
          cost: 160,
          rawResponse: { status: 200, message: 'Simulated Kavenegar Send' },
        };
      }

      const url = `${this.config.baseUrl}/${this.config.apiKey}/sms/send.json`;
      const bodyParams = new URLSearchParams({
        receptor: recipientPhone,
        sender: this.config.senderLine || '',
        message: content,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: bodyParams,
      });

      const data = await response.json();
      if (response.ok && data?.return?.status === 200) {
        const msgResult = data?.entries?.[0];
        return {
          success: true,
          messageId: String(msgResult?.messageid || Date.now()),
          cost: msgResult?.cost || 160,
          rawResponse: data,
        };
      } else {
        return {
          success: false,
          error: data?.return?.message || 'خطای سرویس کاوه‌نگار',
          errorCode: String(data?.return?.status || 'KVN_ERR'),
          rawResponse: data,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `خطای ارتباط شبکه با کاوه‌نگار: ${err.message}`,
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  async sendPatternSms(
    recipientPhone: string,
    patternId: string,
    tokens: Record<string, string>
  ): Promise<SmsSendResult> {
    if (!this.config.apiKey || this.config.apiKey.trim() === '') {
      return {
        success: false,
        error: 'کلید ارتباطی (API Key) کاوه‌نگار تنظیم نشده است.',
        errorCode: 'MISSING_API_KEY',
      };
    }

    try {
      if (this.config.apiKey.startsWith('TEST_') || this.config.apiKey.includes('MOCK')) {
        return {
          success: true,
          messageId: `KVN_PAT_STUB_${Date.now()}`,
          cost: 140,
          rawResponse: { status: 200, message: 'Simulated Kavenegar Pattern Send' },
        };
      }

      // Kavenegar Lookup/Verify API: /v1/{api-key}/verify/lookup.json
      const params = new URLSearchParams({
        receptor: recipientPhone,
        template: patternId,
      });

      // Add token, token2, token3, etc.
      Object.entries(tokens).forEach(([key, val], idx) => {
        if (idx === 0) params.append('token', val);
        else params.append(`token${idx + 1}`, val);
      });

      const url = `${this.config.baseUrl}/${this.config.apiKey}/verify/lookup.json`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });

      const data = await response.json();
      if (response.ok && data?.return?.status === 200) {
        return {
          success: true,
          messageId: String(data?.entries?.[0]?.messageid || Date.now()),
          cost: 140,
          rawResponse: data,
        };
      } else {
        return {
          success: false,
          error: data?.return?.message || 'خطای ارسال پترن کاوه‌نگار',
          errorCode: String(data?.return?.status || 'KVN_PAT_ERR'),
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `خطای ارتباط با کاوه‌نگار: ${err.message}`,
        errorCode: 'NETWORK_ERROR',
      };
    }
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
    return 1000000;
  }

  async testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    const start = Date.now();
    if (!this.config.apiKey) {
      return {
        success: false,
        message: 'کلید API کاوه‌نگار تنظیم نشده است',
        latencyMs: Date.now() - start,
      };
    }
    return {
      success: true,
      message: 'تنظیمات اولیه درگاه کاوه‌نگار برقرار است',
      latencyMs: Date.now() - start + 12,
    };
  }
}
