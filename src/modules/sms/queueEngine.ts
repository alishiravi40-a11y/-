/**
 * SMS Queue Engine
 * Advanced queue engine handling prioritization, deduplication, retry mechanics, rules evaluation,
 * and recovery persistence.
 */

import { ISmsProvider } from './providers/provider.interface';
import { SmsProviderManager } from './providers/providerManager';
import { SmsLogEntry, SmsMessage, SmsPriority, SmsSettings } from './types';
import { SmsDeduplicationGuard } from './deduplicationGuard';
import { SmsRulesEngine } from './rulesEngine';
import { SmsSettingsManager } from './smsSettings';
import { SmsRecoveryService } from './recoveryService';

export interface EnqueueOptions {
  skipDeduplication?: boolean;
  bypassRules?: boolean;
  deduplicationWindowMinutes?: number;
}

export interface EnqueueResult {
  success: boolean;
  message?: SmsMessage;
  reason?: string;
  isDuplicate?: boolean;
}

export class SmsQueueEngine {
  private static counter = 0;
  private queue: Map<string, SmsMessage> = new Map();
  private logs: SmsLogEntry[] = [];
  private provider: ISmsProvider;
  private providerManager?: SmsProviderManager;
  private settingsManager: SmsSettingsManager;

  constructor(
    provider: ISmsProvider,
    settingsManager?: SmsSettingsManager,
    providerManager?: SmsProviderManager
  ) {
    this.provider = provider;
    this.settingsManager = settingsManager || new SmsSettingsManager();
    this.providerManager = providerManager;
  }

  /**
   * Set active provider dynamically
   */
  setProvider(provider: ISmsProvider) {
    this.provider = provider;
  }

  /**
   * Set Provider Gateway Manager instance
   */
  setProviderManager(providerManager: SmsProviderManager) {
    this.providerManager = providerManager;
  }

  /**
   * Update or bind settings manager
   */
  setSettingsManager(settingsManager: SmsSettingsManager) {
    this.settingsManager = settingsManager;
  }

  /**
   * Calculate count of messages sent today
   */
  getTodaySentCount(now: Date = new Date()): number {
    const todayStr = now.toISOString().split('T')[0];
    return Array.from(this.queue.values()).filter(
      (m) => m.status === 'sent' && m.sentTime && m.sentTime.startsWith(todayStr)
    ).length;
  }

  /**
   * Enqueue a new SMS message with deduplication & rules evaluation
   */
  enqueue(
    message: Omit<SmsMessage, 'id' | 'status' | 'retryCount' | 'createdAt' | 'updatedAt' | 'maxRetries'> & {
      maxRetries?: number;
    },
    options: EnqueueOptions = {}
  ): EnqueueResult {
    const existingList = Array.from(this.queue.values());

    // 1. Deduplication Guard Check
    if (!options.skipDeduplication) {
      const dedupCheck = SmsDeduplicationGuard.isDuplicate(
        message,
        existingList,
        options.deduplicationWindowMinutes || 15
      );

      if (dedupCheck.isDuplicate) {
        this.addLog(
          'CANCELLED',
          dedupCheck.existingMessageId || 'N/A',
          message.recipientPhone,
          `از ثبت پیامک تکراری جلوگیری شد: ${dedupCheck.reason}`
        );
        return {
          success: false,
          reason: dedupCheck.reason,
          isDuplicate: true,
        };
      }
    }

    // 2. Rules Engine Check
    const settings = this.settingsManager.getSettings();
    if (!options.bypassRules) {
      const todaySentCount = this.getTodaySentCount();
      const ruleEval = SmsRulesEngine.evaluate(message.trigger, message.priority, settings, todaySentCount);

      if (!ruleEval.allowed && !ruleEval.shouldDeferToQuietHoursEnd) {
        this.addLog('CANCELLED', 'N/A', message.recipientPhone, `ارسال پیامک با قوانین مغایرت دارد: ${ruleEval.reason}`);
        return {
          success: false,
          reason: ruleEval.reason,
        };
      }
    }

    // 3. Construct Message
    const id = `SMS_MSG_${Date.now()}_${++SmsQueueEngine.counter}_${Math.random().toString(36).substring(2, 7)}`;
    const deduplicationKey =
      message.deduplicationKey ||
      SmsDeduplicationGuard.generateKey(
        message.recipientPhone,
        message.trigger || message.content,
        message.metadata?.entityId || message.metadata?.invoiceNumber || message.metadata?.installmentId
      );

    const fullMessage: SmsMessage = {
      ...message,
      id,
      deduplicationKey,
      status: 'pending',
      retryCount: 0,
      maxRetries: message.maxRetries || settings.defaultMaxRetries || 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.queue.set(id, fullMessage);
    this.addLog('QUEUED', id, message.recipientPhone, `پیامک با اولویت ${message.priority} در صف ثبت گردید.`);
    
    // Auto sync to storage if available
    SmsRecoveryService.saveToLocalStorage(Array.from(this.queue.values()));

    return {
      success: true,
      message: fullMessage,
    };
  }

  /**
   * Directly enqueue a raw SmsMessage (e.g. for restored or demo data)
   */
  enqueueRawMessage(msg: SmsMessage): void {
    this.queue.set(msg.id, msg);
    this.addLog('QUEUED', msg.id, msg.recipientPhone, `پیامک خام در صف ثبت گردید.`);
    SmsRecoveryService.saveToLocalStorage(Array.from(this.queue.values()));
  }

  /**
   * Retrieve message by ID
   */
  getMessage(id: string): SmsMessage | undefined {
    return this.queue.get(id);
  }

  /**
   * Get all messages in queue
   */
  getAllMessages(): SmsMessage[] {
    return Array.from(this.queue.values());
  }

  /**
   * Priority numeric weight: critical=4, high=3, normal=2, low=1
   */
  private getPriorityWeight(priority: SmsPriority): number {
    switch (priority) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'normal':
        return 2;
      case 'low':
        return 1;
      default:
        return 2;
    }
  }

  /**
   * Process pending items in queue sorted by priority and creation time
   */
  async processQueue(
    maxBatchSize: number = 10,
    currentTime: Date = new Date()
  ): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const settings = this.settingsManager.getSettings();

    // Check system enable
    if (!settings.enabled) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    const pendingItems = Array.from(this.queue.values())
      .filter((m) => m.status === 'pending' || m.status === 'queued')
      .filter((m) => {
        // Evaluate rules & quiet hours per message
        const todaySent = this.getTodaySentCount(currentTime);
        const ruleEval = SmsRulesEngine.evaluate(m.trigger, m.priority, settings, todaySent, currentTime);
        return ruleEval.allowed;
      })
      .sort((a, b) => {
        const weightDiff = this.getPriorityWeight(b.priority) - this.getPriorityWeight(a.priority);
        if (weightDiff !== 0) return weightDiff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })
      .slice(0, maxBatchSize);

    let succeeded = 0;
    let failed = 0;

    for (const msg of pendingItems) {
      msg.status = 'sending';
      msg.updatedAt = currentTime.toISOString();

      let result;
      if (this.providerManager) {
        result = await this.providerManager.dispatchSms({
          recipientPhone: msg.recipientPhone,
          content: msg.content,
          priority: msg.priority,
          patternId: msg.patternId,
          patternTokens: msg.patternTokens,
          messageId: msg.id,
        });
      } else if (msg.patternId && msg.patternTokens) {
        result = await this.provider.sendPatternSms(msg.recipientPhone, msg.patternId, msg.patternTokens);
      } else {
        result = await this.provider.sendSms(msg.recipientPhone, msg.content, msg.priority);
      }

      if (result.success) {
        msg.status = 'sent';
        msg.sentTime = new Date().toISOString();
        msg.messageIdFromProvider = result.messageId;
        msg.cost = result.cost;
        msg.updatedAt = new Date().toISOString();
        succeeded++;

        this.addLog('SEND_SUCCESS', msg.id, msg.recipientPhone, `ارسال موفق توسط پنل پیامک. کد پیگیری: ${result.messageId}`);
      } else {
        msg.retryCount += 1;
        msg.failedReason = result.error || 'خطای نا مشخص پنل پیامک';
        msg.updatedAt = new Date().toISOString();

        if (msg.retryCount < msg.maxRetries) {
          msg.status = 'pending'; // Re-queue for retry
          this.addLog('RETRY_ATTEMPT', msg.id, msg.recipientPhone, `تلاش شماره ${msg.retryCount}/${msg.maxRetries} ناموفق بود: ${msg.failedReason}`);
        } else {
          msg.status = 'failed';
          this.addLog('SEND_FAILED', msg.id, msg.recipientPhone, `ارسال پس از ${msg.maxRetries} تلاش ناموفق بود. علت نهایی: ${msg.failedReason}`);
        }
        failed++;
      }
    }

    SmsRecoveryService.saveToLocalStorage(Array.from(this.queue.values()));

    return { processed: pendingItems.length, succeeded, failed };
  }

  /**
   * Cancel pending message
   */
  cancelMessage(id: string): boolean {
    const msg = this.queue.get(id);
    if (!msg) return false;
    if (msg.status === 'pending' || msg.status === 'queued') {
      msg.status = 'canceled';
      msg.updatedAt = new Date().toISOString();
      this.addLog('CANCELLED', id, msg.recipientPhone, 'پیامک با درخواست کاربر لغو گردید.');
      SmsRecoveryService.saveToLocalStorage(Array.from(this.queue.values()));
      return true;
    }
    return false;
  }

  /**
   * Retry failed message
   */
  retryMessage(id: string): boolean {
    const msg = this.queue.get(id);
    if (!msg) return false;
    if (msg.status === 'failed' || msg.status === 'canceled') {
      msg.status = 'pending';
      msg.retryCount = 0;
      msg.failedReason = undefined;
      msg.updatedAt = new Date().toISOString();
      this.addLog('RETRY_ATTEMPT', id, msg.recipientPhone, 'بازنشانی و تلاش مجدد دستی ثبت شد.');
      SmsRecoveryService.saveToLocalStorage(Array.from(this.queue.values()));
      return true;
    }
    return false;
  }

  /**
   * Restore queue state from snapshot
   */
  clearQueue(): void {
    this.queue.clear();
    this.addLog('CANCELLED', 'ALL', 'N/A', 'صف پیامک به صورت کامل پاکسازی گردید.');
    SmsRecoveryService.saveToLocalStorage([]);
  }

  /**
   * Restore queue state from snapshot
   */
  restoreQueue(messages: SmsMessage[]): void {
    this.queue.clear();
    for (const msg of messages) {
      this.queue.set(msg.id, msg);
    }
  }

  /**
   * Get all messages in the queue
   */
  getQueue(): SmsMessage[] {
    return Array.from(this.queue.values());
  }

  /**
   * Get queue statistics
   */
  getMetrics() {
    const all = Array.from(this.queue.values());
    return {
      total: all.length,
      pending: all.filter((m) => m.status === 'pending' || m.status === 'queued').length,
      sending: all.filter((m) => m.status === 'sending').length,
      sent: all.filter((m) => m.status === 'sent').length,
      failed: all.filter((m) => m.status === 'failed').length,
      canceled: all.filter((m) => m.status === 'canceled').length,
    };
  }

  /**
   * Get internal audit logs
   */
  getLogs(): SmsLogEntry[] {
    return [...this.logs];
  }

  private addLog(action: SmsLogEntry['action'], messageId: string, recipientPhone: string, details: string) {
    this.logs.push({
      id: `LOG_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      action,
      messageId,
      recipientPhone,
      details,
    });
  }
}
