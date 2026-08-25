/**
 * SMS Rules Engine
 * Enforces policy rules, trigger master switches, quiet hours, daily quotas, and message priorities.
 */

import { SmsEventTrigger, SmsMessage, SmsPriority, SmsSettings } from './types';
import { SmsSchedulerEngine } from './schedulerEngine';

export interface RuleEvaluationResult {
  allowed: boolean;
  reason?: string;
  shouldDeferToQuietHoursEnd?: boolean;
}

export class SmsRulesEngine {
  /**
   * Evaluate whether an SMS message can be enqueued and dispatched based on rules
   */
  static evaluate(
    trigger: SmsEventTrigger | undefined,
    priority: SmsPriority,
    settings: SmsSettings,
    todaySentCount: number,
    currentTime: Date = new Date()
  ): RuleEvaluationResult {
    // 1. System Master Enable Switch
    if (!settings.enabled) {
      return {
        allowed: false,
        reason: 'سامانه پیامک در تنظیمات غیرفعال می‌باشد.',
      };
    }

    // 2. Event Trigger Enable Switch
    if (trigger && settings.enabledTriggers && settings.enabledTriggers[trigger] === false) {
      return {
        allowed: false,
        reason: `رویداد پیامکی "${trigger}" در تنظیمات غیرفعال گردیده است.`,
      };
    }

    // 3. Daily Quota Limit Check
    if (settings.dailySendLimit > 0 && todaySentCount >= settings.dailySendLimit) {
      return {
        allowed: false,
        reason: `سقف ارسال روزانه پیامک (${settings.dailySendLimit} پیام) تکمیل شده است.`,
      };
    }

    // 4. Quiet Hours Check
    const dispatchNow = SmsSchedulerEngine.shouldDispatchNow(priority, settings.quietHours, currentTime);
    if (!dispatchNow) {
      return {
        allowed: false,
        shouldDeferToQuietHoursEnd: true,
        reason: 'زمان ارسال در ساعات استراحت (Quiet Hours) قرار دارد.',
      };
    }

    return { allowed: true };
  }

  /**
   * Calculates next retry timestamp after failure
   */
  static calculateNextRetryDelayMinutes(
    attemptCount: number,
    baseIntervalMinutes: number = 5
  ): number {
    // Exponential backoff with cap: base * 2^(attempt - 1), capped at 120 mins
    const delay = baseIntervalMinutes * Math.pow(2, attemptCount - 1);
    return Math.min(delay, 120);
  }
}
