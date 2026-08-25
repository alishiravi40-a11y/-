/**
 * SMS Module Dedicated Audit Logger
 * Isolated audit logging system for tracking SMS dispatches, config updates, and errors.
 */

import { SmsLogAction, SmsLogEntry } from './types';

export class SmsLogger {
  private logs: SmsLogEntry[] = [];
  private maxLogsCount: number = 1000;

  constructor(maxLogsCount: number = 1000) {
    this.maxLogsCount = maxLogsCount;
  }

  log(
    action: SmsLogAction,
    details: string,
    meta?: {
      messageId?: string;
      recipientPhone?: string;
      userId?: string;
      [key: string]: any;
    }
  ): SmsLogEntry {
    const entry: SmsLogEntry = {
      id: `LOG_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      timestamp: new Date().toISOString(),
      action,
      details,
      messageId: meta?.messageId,
      recipientPhone: meta?.recipientPhone,
      userId: meta?.userId,
      meta,
    };

    this.logs.unshift(entry); // Newest first

    if (this.logs.length > this.maxLogsCount) {
      this.logs = this.logs.slice(0, this.maxLogsCount);
    }

    return entry;
  }

  getLogs(filterAction?: SmsLogAction): SmsLogEntry[] {
    if (!filterAction) return [...this.logs];
    return this.logs.filter((l) => l.action === filterAction);
  }

  clearLogs(): void {
    this.logs = [];
  }
}

export const globalSmsLogger = new SmsLogger();
