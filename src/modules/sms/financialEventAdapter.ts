/**
 * Production Financial Event Adapter
 * Non-invasive event bridge connecting financial and business domain operations to the SMS system.
 *
 * Guaranteed Safety Rules:
 * 1. Zero modifications to financial engines or state calculations.
 * 2. 100% Non-blocking: Errors or delays in SMS processing never interrupt financial transactions.
 * 3. Respects eventIntegrationMode ('mock' vs 'production') to prevent accidental customer dispatches.
 * 4. Provides access-control filtering (e.g. Sales Agents only process events for their clients).
 */

import { SmsEventBus, SmsEventBusClass } from './eventBus';
import { SmsEventPayloadMapper } from './eventPayloadMapper';
import { SmsSettingsManager } from './smsSettings';
import { SmsLogger, globalSmsLogger } from './smsLogger';
import {
  SmsSystemEventName,
  InvoiceCreatedPayload,
  InstallmentBookCreatedPayload,
  InstallmentDueReminderPayload,
  InstallmentOverduePayload,
  InstallmentPaidPayload,
  CheckReceivedPayload,
  CheckDuePayload,
  CheckClearedPayload,
  CheckBouncedPayload,
  CustomerRegisteredPayload,
  OtpRequestedPayload,
} from './types';

export interface FinancialEventAdapterOptions {
  eventBus?: SmsEventBusClass;
  settingsManager?: SmsSettingsManager;
  logger?: SmsLogger;
}

export class FinancialEventAdapter {
  private eventBus: SmsEventBusClass;
  private settingsManager: SmsSettingsManager;
  private logger: SmsLogger;

  constructor(options: FinancialEventAdapterOptions = {}) {
    this.eventBus = options.eventBus || SmsEventBus;
    this.settingsManager = options.settingsManager || new SmsSettingsManager();
    this.logger = options.logger || globalSmsLogger;
  }

  /**
   * Safe asynchronous emit helper. Ensures exceptions are caught and logged without throwing.
   */
  private safeEmit(eventName: SmsSystemEventName, payload: any, currentUserRole?: string, assignedAgentId?: string) {
    try {
      const settings = this.settingsManager.getSettings();
      const mode = settings.eventIntegrationMode || 'mock';

      // Access Control Filter: Sales agent check
      if (currentUserRole === 'SALES_AGENT' && assignedAgentId && payload?.agentId) {
        if (payload.agentId !== assignedAgentId) {
          this.logger.log(
            'EVENT_DISPATCHED',
            `رویداد ${eventName} نادیده گرفته شد (خارج از دسترسی نماینده فروش)`
          );
          return;
        }
      }

      // Log event capture
      this.logger.log(
        'EVENT_RECEIVED',
        `رویداد مالی [${eventName}] توسط FinancialEventAdapter دریافت شد. (حالت: ${mode})`,
        { recipientPhone: payload?.customerPhone }
      );

      // Map payload to standard SMS variables (read-only)
      const mappedData = SmsEventPayloadMapper.mapPayloadToVariables(eventName, payload);

      const fullPayload = {
        ...payload,
        customerName: mappedData.recipientName,
        customerPhone: mappedData.phone,
        variables: mappedData.variables,
        integrationMode: mode,
      };

      // Publish to EventBus asynchronously
      this.eventBus.publish(eventName, fullPayload);
    } catch (err: any) {
      // NON-INVASIVE GUARANTEE: Log error quietly; never crash financial caller!
      this.logger.log(
        'EVENT_DISPATCHED',
        `خطای غیرمنتظره در پردازش رویداد پیامک ${eventName}: ${err.message}`
      );
    }
  }

  // --- Financial Event Triggers ---

  public emitInvoiceCreated(payload: InvoiceCreatedPayload, userRole?: string, agentId?: string) {
    this.safeEmit('INVOICE_CREATED', payload, userRole, agentId);
  }

  public emitInstallmentBookCreated(payload: InstallmentBookCreatedPayload, userRole?: string, agentId?: string) {
    this.safeEmit('INSTALLMENT_BOOK_CREATED', payload, userRole, agentId);
  }

  public emitInstallmentDueReminder(payload: InstallmentDueReminderPayload, userRole?: string, agentId?: string) {
    this.safeEmit('INSTALLMENT_DUE_REMINDER', payload, userRole, agentId);
  }

  public emitInstallmentOverdue(payload: InstallmentOverduePayload, userRole?: string, agentId?: string) {
    this.safeEmit('INSTALLMENT_OVERDUE', payload, userRole, agentId);
  }

  public emitInstallmentPaid(payload: InstallmentPaidPayload, userRole?: string, agentId?: string) {
    this.safeEmit('INSTALLMENT_PAID', payload, userRole, agentId);
  }

  public emitCheckReceived(payload: CheckReceivedPayload, userRole?: string, agentId?: string) {
    this.safeEmit('CHECK_RECEIVED', payload, userRole, agentId);
  }

  public emitCheckDue(payload: CheckDuePayload, userRole?: string, agentId?: string) {
    this.safeEmit('CHECK_DUE', payload, userRole, agentId);
  }

  public emitCheckCleared(payload: CheckClearedPayload, userRole?: string, agentId?: string) {
    this.safeEmit('CHECK_CLEARED', payload, userRole, agentId);
  }

  public emitCheckBounced(payload: CheckBouncedPayload, userRole?: string, agentId?: string) {
    this.safeEmit('CHECK_BOUNCED', payload, userRole, agentId);
  }

  public emitCustomerRegistered(payload: CustomerRegisteredPayload, userRole?: string, agentId?: string) {
    this.safeEmit('CUSTOMER_REGISTERED', payload, userRole, agentId);
  }

  public emitOtpRequested(payload: OtpRequestedPayload) {
    this.safeEmit('OTP_REQUESTED', payload);
  }

  public emitNesyehOrderSubmitted(payload: any, userRole?: string, agentId?: string) {
    this.safeEmit('ON_NESYEH_ORDER_SUBMITTED', payload, userRole, agentId);
  }

  public emitNesyehOrderStatusChanged(payload: any, userRole?: string, agentId?: string) {
    this.safeEmit('ON_NESYEH_ORDER_STATUS_CHANGED', payload, userRole, agentId);
  }

  public emitNesyehPaymentVerified(payload: any, userRole?: string, agentId?: string) {
    this.safeEmit('ON_NESYEH_PAYMENT_VERIFIED', payload, userRole, agentId);
  }

  public emitCreditLimitApproaching(payload: any, userRole?: string, agentId?: string) {
    this.safeEmit('ON_CREDIT_LIMIT_APPROACHING', payload, userRole, agentId);
  }
}

export const globalFinancialEventAdapter = new FinancialEventAdapter();
