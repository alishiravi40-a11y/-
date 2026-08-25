/**
 * Mock SMS Provider
 * Fully featured in-memory provider for testing, sandbox verification, and offline usage.
 */

import { ISmsProvider } from './provider.interface';
import { SmsPriority, SmsProviderConfig, SmsSendResult, SmsStatus } from '../types';

export class MockSmsProvider implements ISmsProvider {
  private config: SmsProviderConfig;
  private sentMessagesLog: Array<{
    id: string;
    recipientPhone: string;
    content: string;
    patternId?: string;
    tokens?: Record<string, string>;
    timestamp: string;
    status: SmsStatus;
  }> = [];

  private mockBalance: number = 500000; // 500,000 Rials credit
  private shouldFailNextSend: boolean = false;
  private failureReason: string = 'Simulated network connection timeout';
  private simulatedDelayMs: number = 0;
  private isServiceOutage: boolean = false;

  constructor(customConfig?: Partial<SmsProviderConfig>) {
    this.config = {
      id: 'mock_provider_01',
      name: 'سامانه آزمایشی پیامک (Mock Provider)',
      type: 'mock',
      apiKey: 'MOCK_API_KEY_1234567890',
      senderLine: '3000990099',
      baseUrl: 'https://mock.sms.api.local',
      isActive: true,
      isDefault: true,
      supportPattern: true,
      rateLimitPerMinute: 600,
      ...customConfig,
    };
  }

  getProviderInfo(): SmsProviderConfig {
    return { ...this.config };
  }

  /**
   * Set simulated failure condition for testing error handling & retries
   */
  setSimulatedFailure(shouldFail: boolean, reason?: string) {
    this.shouldFailNextSend = shouldFail;
    if (reason) this.failureReason = reason;
  }

  /**
   * Set network delay simulation in milliseconds
   */
  setSimulatedDelayMs(delayMs: number) {
    this.simulatedDelayMs = Math.max(0, delayMs);
  }

  /**
   * Set complete service outage state
   */
  setServiceOutage(outage: boolean) {
    this.isServiceOutage = outage;
  }

  /**
   * Set mock account credit balance
   */
  setMockBalance(balance: number) {
    this.mockBalance = balance;
  }

  /**
   * Get all sent messages stored in mock memory
   */
  getSentMessagesLog() {
    return [...this.sentMessagesLog];
  }

  /**
   * Clear mock message log
   */
  clearLog() {
    this.sentMessagesLog = [];
  }

  async sendSms(
    recipientPhone: string,
    content: string,
    _priority: SmsPriority = 'normal'
  ): Promise<SmsSendResult> {
    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
    }

    if (this.isServiceOutage) {
      return {
        success: false,
        error: 'سرویس‌دهنده پیامک در دسترس نیست (سرویس قطعی سناریو آزمایشی)',
        errorCode: 'PROVIDER_OUTAGE',
      };
    }

    if (this.shouldFailNextSend) {
      return {
        success: false,
        error: this.failureReason,
        errorCode: 'MOCK_ERR_TIMEOUT',
      };
    }

    if (this.mockBalance <= 0) {
      return {
        success: false,
        error: 'اعتبار حساب پیامک کافی نیست',
        errorCode: 'INSUFFICIENT_CREDIT',
      };
    }

    if (!recipientPhone || recipientPhone.length < 10) {
      return {
        success: false,
        error: 'شماره گیرنده نامعتبر است',
        errorCode: 'INVALID_RECIPIENT',
      };
    }

    const messageId = `MOCK_MSG_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const cost = 150; // 150 Rials per SMS segment

    this.mockBalance = Math.max(0, this.mockBalance - cost);

    this.sentMessagesLog.push({
      id: messageId,
      recipientPhone,
      content,
      timestamp: new Date().toISOString(),
      status: 'sent',
    });

    return {
      success: true,
      messageId,
      cost,
      rawResponse: { provider: 'mock', status: 'DELIVERED_TO_GATEWAY', time: new Date().toISOString() },
    };
  }

  async sendPatternSms(
    recipientPhone: string,
    patternId: string,
    tokens: Record<string, string>
  ): Promise<SmsSendResult> {
    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
    }

    if (this.isServiceOutage) {
      return {
        success: false,
        error: 'سرویس‌دهنده پیامک در دسترس نیست (سرویس قطعی سناریو آزمایشی)',
        errorCode: 'PROVIDER_OUTAGE',
      };
    }

    if (this.shouldFailNextSend) {
      return {
        success: false,
        error: this.failureReason,
        errorCode: 'MOCK_ERR_TIMEOUT',
      };
    }

    if (this.mockBalance <= 0) {
      return {
        success: false,
        error: 'اعتبار حساب پیامک کافی نیست',
        errorCode: 'INSUFFICIENT_CREDIT',
      };
    }

    const messageId = `MOCK_PAT_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const tokenStr = Object.entries(tokens)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    const simulatedContent = `[Pattern: ${patternId}] Tokens: ${tokenStr}`;

    const cost = 120; // Pattern SMS cost
    this.mockBalance = Math.max(0, this.mockBalance - cost);

    this.sentMessagesLog.push({
      id: messageId,
      recipientPhone,
      content: simulatedContent,
      patternId,
      tokens,
      timestamp: new Date().toISOString(),
      status: 'sent',
    });

    return {
      success: true,
      messageId,
      cost,
      rawResponse: { provider: 'mock', patternId, tokens, time: new Date().toISOString() },
    };
  }

  async checkDeliveryStatus(messageIdFromProvider: string): Promise<{
    status: SmsStatus;
    deliveredAt?: string;
    error?: string;
  }> {
    const found = this.sentMessagesLog.find((m) => m.id === messageIdFromProvider);
    if (!found) {
      return { status: 'failed', error: 'پیامک در سامانه یافت نشد' };
    }
    return { status: 'sent', deliveredAt: found.timestamp };
  }

  async getCreditBalance(): Promise<number> {
    return this.mockBalance;
  }

  async testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    const start = Date.now();
    if (this.isServiceOutage) {
      return {
        success: false,
        message: 'اتصال به درگاه پیامک ناموفق بود (قطعی سرویس)',
        latencyMs: Date.now() - start,
      };
    }
    return {
      success: true,
      message: 'اتصال به درگاه آزمایشی پیامک برقرار است',
      latencyMs: Date.now() - start + 5,
    };
  }
}
