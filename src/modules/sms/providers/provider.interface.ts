/**
 * Standard SMS Provider Interface
 * Defines uniform contract for all SMS gateways (Mock, Kavenegar, Ghasedak, etc.)
 */

import { SmsPriority, SmsProviderConfig, SmsSendResult, SmsStatus } from '../types';

export interface ISmsProvider {
  /**
   * Get configuration details of this provider
   */
  getProviderInfo(): SmsProviderConfig;

  /**
   * Send a standard text SMS message
   */
  sendSms(
    recipientPhone: string,
    content: string,
    priority?: SmsPriority
  ): Promise<SmsSendResult>;

  /**
   * Send a pattern-based service SMS (e.g., Kavenegar / Ghasedak OTP or structured template)
   */
  sendPatternSms(
    recipientPhone: string,
    patternId: string,
    tokens: Record<string, string>
  ): Promise<SmsSendResult>;

  /**
   * Query delivery status from provider API
   */
  checkDeliveryStatus(messageIdFromProvider: string): Promise<{
    status: SmsStatus;
    deliveredAt?: string;
    error?: string;
  }>;

  /**
   * Check account credit/balance with provider
   */
  getCreditBalance(): Promise<number>;

  /**
   * Test connection and gateway health status
   */
  testConnection?(): Promise<{
    success: boolean;
    message: string;
    latencyMs?: number;
  }>;
}
