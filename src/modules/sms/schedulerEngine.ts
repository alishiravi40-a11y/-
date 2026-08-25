/**
 * SMS Scheduler Engine
 * Handles time-window evaluations (Quiet Hours), interval scheduling runner,
 * status tracking, and pause/resume controls without affecting main app execution.
 */

import { QuietHoursConfig, SmsPriority } from './types';
import { SmsQueueEngine } from './queueEngine';

export class SmsSchedulerEngine {
  private queueEngine?: SmsQueueEngine;
  private intervalTimer?: any;
  private intervalMs: number = 10000; // Default 10 seconds
  private isRunningState: boolean = false;
  private isPausedState: boolean = false;
  private lastTickTime?: string;

  constructor(queueEngine?: SmsQueueEngine, intervalMs: number = 10000) {
    this.queueEngine = queueEngine;
    this.intervalMs = intervalMs;
  }

  /**
   * Bind queue engine dynamically
   */
  setQueueEngine(queueEngine: SmsQueueEngine) {
    this.queueEngine = queueEngine;
  }

  /**
   * Start periodic scheduler worker
   */
  start(): boolean {
    if (this.isRunningState) return false;
    this.isRunningState = true;
    this.isPausedState = false;

    this.intervalTimer = setInterval(async () => {
      if (!this.isPausedState && this.queueEngine) {
        this.lastTickTime = new Date().toISOString();
        try {
          await this.queueEngine.processQueue();
        } catch (err) {
          console.error('[SmsSchedulerEngine] Queue processing tick error:', err);
        }
      }
    }, this.intervalMs);

    return true;
  }

  /**
   * Pause scheduler execution
   */
  pause(): void {
    this.isPausedState = true;
  }

  /**
   * Resume scheduler execution
   */
  resume(): void {
    this.isPausedState = false;
  }

  /**
   * Stop periodic scheduler
   */
  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
    this.isRunningState = false;
    this.isPausedState = false;
  }

  /**
   * Trigger single tick process immediately
   */
  async triggerImmediateTick(): Promise<{ processed: number; succeeded: number; failed: number } | null> {
    if (!this.queueEngine) return null;
    this.lastTickTime = new Date().toISOString();
    return await this.queueEngine.processQueue();
  }

  /**
   * Get current scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunningState,
      isPaused: this.isPausedState,
      intervalMs: this.intervalMs,
      lastTickTime: this.lastTickTime,
    };
  }

  /**
   * Check if a given time string (HH:mm) falls within Quiet Hours window
   */
  static isWithinQuietHours(
    quietHours: QuietHoursConfig,
    currentTime?: Date
  ): boolean {
    if (!quietHours || !quietHours.enabled) return false;

    const now = currentTime || new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTotalMinutes = currentHours * 60 + currentMinutes;

    const [startH, startM] = quietHours.startTime.split(':').map(Number);
    const [endH, endM] = quietHours.endTime.split(':').map(Number);

    const startTotal = (startH || 0) * 60 + (startM || 0);
    const endTotal = (endH || 0) * 60 + (endM || 0);

    if (startTotal === endTotal) return false;

    if (startTotal < endTotal) {
      // e.g. 13:00 to 16:00
      return currentTotalMinutes >= startTotal && currentTotalMinutes < endTotal;
    } else {
      // Overnight quiet hours, e.g. 22:00 to 08:00
      return currentTotalMinutes >= startTotal || currentTotalMinutes < endTotal;
    }
  }

  /**
   * Determine if a message can be dispatched immediately given its priority and quiet hours status
   */
  static shouldDispatchNow(
    priority: SmsPriority,
    quietHours: QuietHoursConfig,
    currentTime?: Date
  ): boolean {
    const isQuiet = this.isWithinQuietHours(quietHours, currentTime);

    if (!isQuiet) return true;

    // During quiet hours: check if critical priority messages are explicitly permitted
    if (priority === 'critical' && quietHours.allowCriticalDuringQuietHours) {
      return true;
    }

    return false;
  }

  /**
   * Helper to format Persian date (Shamsi) string for SMS content
   */
  static formatShamsiDate(isoDateString?: string): string {
    if (!isoDateString) return '';
    try {
      const d = new Date(isoDateString);
      return new Intl.DateTimeFormat('fa-IR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    } catch {
      return isoDateString;
    }
  }
}
