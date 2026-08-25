/**
 * SMS Settings Structure & Default Configuration
 * Independent configuration manager for SMS system settings.
 */

import { SmsEventTrigger, SmsSettings } from './types';

export const DEFAULT_SMS_SETTINGS: SmsSettings = {
  enabled: true,
  activeProviderId: 'mock_provider_01',
  eventIntegrationMode: 'mock',
  quietHours: {
    enabled: true,
    startTime: '22:00',
    endTime: '08:00',
    allowCriticalDuringQuietHours: true,
  },
  defaultMaxRetries: 3,
  retryIntervalMinutes: 5,
  dailySendLimit: 1000,
  enabledTriggers: {
    cash_sale: true,
    installment_sale: true,
    installment_created: true,
    installment_due: true,
    installment_overdue: true,
    check_registered: true,
    check_due: true,
    check_deposited: true,
    check_cleared: true,
    check_bounced: true,
    customer_registered: true,
    credit_dossier_created: true,
    credit_approved: true,
    credit_rejected: true,
    agent_registered: false,
    agent_status_changed: false,
    installment_paid: true,
    otp_code: true,
    manual_custom: true,
    nesyeh_order_submitted: true,
    nesyeh_order_status_changed: true,
    nesyeh_payment_verified: true,
    credit_limit_approaching: true,
  },
  requireApprovalForMarketing: false,
  organizationSenderName: 'فروشگاه حسابداری',
  updatedAt: new Date().toISOString(),
};

export class SmsSettingsManager {
  private settings: SmsSettings;

  constructor(initialSettings?: SmsSettings) {
    this.settings = initialSettings ? { ...initialSettings } : { ...DEFAULT_SMS_SETTINGS };
  }

  getSettings(): SmsSettings {
    return { ...this.settings };
  }

  updateSettings(partial: Partial<SmsSettings>): SmsSettings {
    this.settings = {
      ...this.settings,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    return this.getSettings();
  }

  isTriggerEnabled(trigger: SmsEventTrigger): boolean {
    if (!this.settings.enabled) return false;
    return !!this.settings.enabledTriggers[trigger];
  }

  setTriggerEnabled(trigger: SmsEventTrigger, enabled: boolean): void {
    this.settings.enabledTriggers[trigger] = enabled;
    this.settings.updatedAt = new Date().toISOString();
  }
}
