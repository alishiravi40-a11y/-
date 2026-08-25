/**
 * SMS Deduplication Guard
 * Prevents duplicate SMS dispatches for the same recipient, trigger, or entity within a configurable time window.
 */

import { SmsMessage } from './types';

export interface DeduplicationCheckResult {
  isDuplicate: boolean;
  existingMessageId?: string;
  reason?: string;
}

export class SmsDeduplicationGuard {
  /**
   * Generates a deterministic deduplication key for a message
   */
  static generateKey(
    recipientPhone: string,
    triggerOrContent: string,
    entityReferenceId?: string
  ): string {
    const cleanPhone = recipientPhone.replace(/\s+/g, '').replace(/^\+98/, '0');
    const entityPart = entityReferenceId ? `_REF_${entityReferenceId}` : '';
    const rawContentPart = triggerOrContent.trim().toLowerCase();
    
    // Hash-like string construction
    return `DEDUP_${cleanPhone}_${rawContentPart}${entityPart}`;
  }

  /**
   * Check if a message is a duplicate against active queue and recently sent messages
   */
  static isDuplicate(
    message: {
      recipientPhone: string;
      content: string;
      trigger?: string;
      deduplicationKey?: string;
      metadata?: Record<string, any>;
    },
    existingMessages: SmsMessage[],
    windowMinutes: number = 15,
    now: Date = new Date()
  ): DeduplicationCheckResult {
    const key =
      message.deduplicationKey ||
      this.generateKey(
        message.recipientPhone,
        message.trigger || message.content,
        message.metadata?.entityId || message.metadata?.invoiceNumber || message.metadata?.installmentId
      );

    const cutoffTime = new Date(now.getTime() - windowMinutes * 60 * 1000).getTime();

    for (const existing of existingMessages) {
      // Ignore failed or canceled messages when checking for duplicates
      if (existing.status === 'failed' || existing.status === 'canceled') {
        continue;
      }

      const existingKey =
        existing.deduplicationKey ||
        this.generateKey(
          existing.recipientPhone,
          existing.trigger || existing.content,
          existing.metadata?.entityId || existing.metadata?.invoiceNumber || existing.metadata?.installmentId
        );

      if (existingKey === key) {
        const existingCreatedAt = new Date(existing.createdAt).getTime();

        // If pending/queued/sending, it's immediately a duplicate
        if (existing.status === 'pending' || existing.status === 'queued' || existing.status === 'sending') {
          return {
            isDuplicate: true,
            existingMessageId: existing.id,
            reason: `پیام مشابه در صف ارسال (وضعیت: ${existing.status}) وجود دارد.`,
          };
        }

        // If sent within sliding window, it's a duplicate
        if (existing.status === 'sent' && existingCreatedAt >= cutoffTime) {
          const minutesAgo = Math.round((now.getTime() - existingCreatedAt) / (60 * 1000));
          return {
            isDuplicate: true,
            existingMessageId: existing.id,
            reason: `پیام مشابه ${minutesAgo} دقیقه پیش ارسال شده است (محدوده مجاز: ${windowMinutes} دقیقه).`,
          };
        }
      }
    }

    return { isDuplicate: false };
  }
}
