/**
 * SmsEventBridge Service
 * Non-invasive event bridge for Nesyeh credit operations and financial system events.
 * Connects financial actions to the decoupled SMS Event Bus & Dispatcher.
 * Guarantees zero blocking and zero side-effects on accounting calculations or financial ledgers.
 */

import { SmsEventBus, SmsEventBusClass } from './eventBus';
import { SmsEventDispatcher, SmsEventDispatcherClass } from './eventDispatcher';
import { globalFinancialEventAdapter, FinancialEventAdapter } from './financialEventAdapter';
import {
  SmsSystemEventName,
  NesyehOrderSubmittedPayload,
  NesyehOrderStatusChangedPayload,
  NesyehPaymentVerifiedPayload,
  CreditLimitApproachingPayload,
} from './types';

export class SmsEventBridgeClass {
  private eventBus: SmsEventBusClass;
  private dispatcher: SmsEventDispatcherClass;
  private adapter: FinancialEventAdapter;
  private isBridgeActive = false;

  constructor(
    eventBus: SmsEventBusClass = SmsEventBus,
    dispatcher: SmsEventDispatcherClass = SmsEventDispatcher,
    adapter: FinancialEventAdapter = globalFinancialEventAdapter
  ) {
    this.eventBus = eventBus;
    this.dispatcher = dispatcher;
    this.adapter = adapter;
    this.initializeBridge();
  }

  /**
   * Initializes the event bridge and starts listening to Nesyeh and financial events
   */
  public initializeBridge(): void {
    if (this.isBridgeActive) return;

    // Start event dispatcher listeners
    this.dispatcher.registerListeners();
    this.isBridgeActive = true;
  }

  /**
   * Safely dispatch Nesyeh Order Submitted event
   */
  public emitNesyehOrderSubmitted(payload: NesyehOrderSubmittedPayload, userRole?: string, agentId?: string): void {
    try {
      this.adapter.emitNesyehOrderSubmitted(payload, userRole, agentId);
    } catch (err) {
      console.warn('[SmsEventBridge] Non-blocking exception in emitNesyehOrderSubmitted:', err);
    }
  }

  /**
   * Safely dispatch Nesyeh Order Status Changed event
   */
  public emitNesyehOrderStatusChanged(payload: NesyehOrderStatusChangedPayload, userRole?: string, agentId?: string): void {
    try {
      this.adapter.emitNesyehOrderStatusChanged(payload, userRole, agentId);
    } catch (err) {
      console.warn('[SmsEventBridge] Non-blocking exception in emitNesyehOrderStatusChanged:', err);
    }
  }

  /**
   * Safely dispatch Nesyeh Payment Verified event
   */
  public emitNesyehPaymentVerified(payload: NesyehPaymentVerifiedPayload, userRole?: string, agentId?: string): void {
    try {
      this.adapter.emitNesyehPaymentVerified(payload, userRole, agentId);
    } catch (err) {
      console.warn('[SmsEventBridge] Non-blocking exception in emitNesyehPaymentVerified:', err);
    }
  }

  /**
   * Safely dispatch Credit Limit Approaching event (e.g. >= 80% limit reached)
   */
  public emitCreditLimitApproaching(payload: CreditLimitApproachingPayload, userRole?: string, agentId?: string): void {
    try {
      this.adapter.emitCreditLimitApproaching(payload, userRole, agentId);
    } catch (err) {
      console.warn('[SmsEventBridge] Non-blocking exception in emitCreditLimitApproaching:', err);
    }
  }

  /**
   * Stop bridge subscriptions
   */
  public destroyBridge(): void {
    this.dispatcher.unregisterListeners();
    this.isBridgeActive = false;
  }
}

export const SmsEventBridge = new SmsEventBridgeClass();
