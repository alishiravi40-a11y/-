/**
 * SMS Recovery Service
 * Handles queue persistence, crash recovery, stale message expiration, and state restoration.
 */

import { SmsMessage, SmsQueueSnapshot } from './types';

export class SmsRecoveryService {
  private static STORAGE_KEY = 'ACCOUNTING_SMS_QUEUE_SNAPSHOT_V1';

  /**
   * Create a snapshot object from queue messages
   */
  static createSnapshot(messages: SmsMessage[]): SmsQueueSnapshot {
    return {
      version: '1.0.0',
      savedAt: new Date().toISOString(),
      messages: messages.map((m) => ({ ...m })),
    };
  }

  /**
   * Export queue snapshot to JSON string
   */
  static serializeQueue(messages: SmsMessage[]): string {
    const snapshot = this.createSnapshot(messages);
    return JSON.stringify(snapshot);
  }

  /**
   * Parse queue snapshot from JSON string and process stale items
   */
  static deserializeQueue(
    jsonString: string,
    staleExpirationHours: number = 24,
    now: Date = new Date()
  ): SmsMessage[] {
    try {
      const snapshot: SmsQueueSnapshot = JSON.parse(jsonString);
      if (!snapshot || !Array.isArray(snapshot.messages)) {
        return [];
      }

      const cutoffTime = now.getTime() - staleExpirationHours * 3600 * 1000;

      return snapshot.messages.map((msg) => {
        const msgTime = new Date(msg.createdAt).getTime();

        // If message was left in 'sending' state when process crashed, reset to 'pending' or 'failed' if stale
        if (msg.status === 'sending') {
          if (msgTime < cutoffTime) {
            return {
              ...msg,
              status: 'failed',
              failedReason: 'پیامک به علت قطع برنامه و گذشت زمان مجاز منقضی گردید (Stale Expiration).',
              updatedAt: now.toISOString(),
            };
          } else {
            return {
              ...msg,
              status: 'pending',
              updatedAt: now.toISOString(),
            };
          }
        }

        // Expire old pending messages past stale threshold
        if (msg.status === 'pending' && msgTime < cutoffTime) {
          return {
            ...msg,
            status: 'failed',
            failedReason: 'پیامک معلق به علت منقضی شدن زمان ارسال منقضی گردید.',
            updatedAt: now.toISOString(),
          };
        }

        return msg;
      });
    } catch {
      return [];
    }
  }

  /**
   * Helper to persist queue to localStorage if available (fail-safe)
   */
  static saveToLocalStorage(messages: SmsMessage[]): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const json = this.serializeQueue(messages);
        window.localStorage.setItem(this.STORAGE_KEY, json);
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }

  /**
   * Helper to load queue from localStorage
   */
  static loadFromLocalStorage(staleExpirationHours: number = 24): SmsMessage[] {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const json = window.localStorage.getItem(this.STORAGE_KEY);
        if (json) {
          return this.deserializeQueue(json, staleExpirationHours);
        }
      }
    } catch {
      // Ignore storage errors
    }
    return [];
  }

  static saveSnapshot(messages: SmsMessage[]): void {
    this.saveToLocalStorage(messages);
  }

  static loadSnapshot(staleExpirationHours: number = 24): SmsMessage[] {
    return this.loadFromLocalStorage(staleExpirationHours);
  }

  static clearSnapshot(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(this.STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }
}
