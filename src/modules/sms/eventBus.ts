/**
 * Isolated Event Bus for SMS Module.
 * Completely decoupled from accounting and financial core.
 * Ensures zero impact on business logic execution if event processing fails.
 */

export type EventHandler<T = any> = (payload: T) => void | Promise<void>;

export class SmsEventBusClass {
  private listeners: Map<string, Set<EventHandler>> = new Map();

  /**
   * Subscribe to an event.
   * Returns an unsubscribe function.
   */
  subscribe<T = any>(eventName: string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    const handlers = this.listeners.get(eventName)!;
    handlers.add(handler as EventHandler);

    return () => this.unsubscribe(eventName, handler);
  }

  /**
   * Unsubscribe a handler from an event.
   */
  unsubscribe<T = any>(eventName: string, handler: EventHandler<T>): void {
    const handlers = this.listeners.get(eventName);
    if (handlers) {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.listeners.delete(eventName);
      }
    }
  }

  /**
   * Publish an event to all subscribed listeners.
   * CRITICAL: Wrapped in try/catch for complete fault isolation.
   * Under no circumstances will a listener error crash the caller or financial flow.
   */
  publish<T = any>(eventName: string, payload: T): void {
    const handlers = this.listeners.get(eventName);
    if (!handlers || handlers.size === 0) {
      return;
    }

    // Execute each handler with fault isolation
    handlers.forEach((handler) => {
      try {
        const result = handler(payload);
        // Handle promise rejections if handler is async
        if (result && typeof (result as any).catch === 'function') {
          (result as any).catch((err: any) => {
            console.error(`[SmsEventBus] Async handler error for event "${eventName}":`, err);
          });
        }
      } catch (err) {
        console.error(`[SmsEventBus] Sync handler error for event "${eventName}":`, err);
      }
    });
  }

  /**
   * Clear all listeners (useful for testing or reset)
   */
  clearAllListeners(): void {
    this.listeners.clear();
  }

  /**
   * Get listener count for a specific event
   */
  getListenerCount(eventName?: string): number {
    if (!eventName) {
      let count = 0;
      this.listeners.forEach((set) => {
        count += set.size;
      });
      return count;
    }
    return this.listeners.get(eventName)?.size || 0;
  }
}

// Global Singleton Instance
export const SmsEventBus = new SmsEventBusClass();
