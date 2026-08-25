/**
 * SMS Event Dispatcher
 * Listens to standard system events from SmsEventBus and converts them to queued SMS messages.
 * Does NOT invoke SMS provider sending directly. Only enqueues into SMS queue engine.
 */

import { SmsEventBus, SmsEventBusClass } from './eventBus';
import { SmsQueueEngine } from './queueEngine';
import { SmsTemplateEngine } from './templateEngine';
import { SmsSettingsManager } from './smsSettings';
import { SmsLogger, globalSmsLogger } from './smsLogger';
import {
  SmsSystemEventName,
  SmsEventTrigger,
  SmsPriority,
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

export interface EventDispatcherStats {
  lastReceivedEventName?: string;
  lastReceivedEventPayload?: any;
  lastReceivedTimestamp?: string;
  eventsProcessedCount: number;
  queueItemsCreatedCount: number;
}

export class SmsEventDispatcherClass {
  private queueEngine?: SmsQueueEngine;
  private templateEngine: SmsTemplateEngine;
  private settingsManager: SmsSettingsManager;
  private logger: SmsLogger;
  private eventBus: SmsEventBusClass;
  private isSubscribed: boolean = false;
  private unsubscribeFns: Array<() => void> = [];

  private stats: EventDispatcherStats = {
    eventsProcessedCount: 0,
    queueItemsCreatedCount: 0,
  };

  constructor(
    eventBus: SmsEventBusClass = SmsEventBus,
    queueEngine?: SmsQueueEngine,
    templateEngine?: SmsTemplateEngine,
    settingsManager?: SmsSettingsManager,
    logger: SmsLogger = globalSmsLogger
  ) {
    this.eventBus = eventBus;
    this.queueEngine = queueEngine;
    this.templateEngine = templateEngine || new SmsTemplateEngine();
    this.settingsManager = settingsManager || new SmsSettingsManager();
    this.logger = logger;
  }

  public setQueueEngine(queueEngine: SmsQueueEngine) {
    this.queueEngine = queueEngine;
  }

  public setTemplateEngine(templateEngine: SmsTemplateEngine) {
    this.templateEngine = templateEngine;
  }

  public setSettingsManager(settingsManager: SmsSettingsManager) {
    this.settingsManager = settingsManager;
  }

  public getStats(): EventDispatcherStats {
    return { ...this.stats };
  }

  /**
   * Subscribe dispatcher to standard system events on eventBus
   */
  public registerListeners(): void {
    if (this.isSubscribed) return;

    const events: SmsSystemEventName[] = [
      'INVOICE_CREATED',
      'INSTALLMENT_BOOK_CREATED',
      'INSTALLMENT_DUE_REMINDER',
      'INSTALLMENT_OVERDUE',
      'INSTALLMENT_PAID',
      'CHECK_RECEIVED',
      'CHECK_DUE',
      'CHECK_CLEARED',
      'CHECK_BOUNCED',
      'CUSTOMER_REGISTERED',
      'OTP_REQUESTED',
      'ON_NESYEH_ORDER_SUBMITTED',
      'ON_NESYEH_ORDER_STATUS_CHANGED',
      'ON_NESYEH_PAYMENT_VERIFIED',
      'ON_CREDIT_LIMIT_APPROACHING',
    ];

    events.forEach((eventName) => {
      const unsub = this.eventBus.subscribe(eventName, (payload) => {
        this.handleEvent(eventName, payload);
      });
      this.unsubscribeFns.push(unsub);
    });

    this.isSubscribed = true;
  }

  public unregisterListeners(): void {
    this.unsubscribeFns.forEach((fn) => fn());
    this.unsubscribeFns = [];
    this.isSubscribed = false;
  }

  /**
   * Handle incoming event and convert to queued SMS without sending directly.
   */
  public handleEvent(eventName: SmsSystemEventName, payload: any): void {
    this.stats.lastReceivedEventName = eventName;
    this.stats.lastReceivedEventPayload = payload;
    this.stats.lastReceivedTimestamp = new Date().toISOString();
    this.stats.eventsProcessedCount += 1;

    this.logger.log('EVENT_RECEIVED', `رویداد سیستم دریافت شد: ${eventName}`);

    const settings = this.settingsManager.getSettings();

    // Check module active
    if (!settings.enabled) {
      this.logger.log('EVENT_DISPATCHED', `ماژول پیامک غیرفعال است. رویداد ${eventName} نادیده گرفته شد.`);
      return;
    }

    // Determine Trigger, Phone, Variables, Priority based on Event
    const { trigger, phone, variables, priority, recipientName } = this.mapEventToSmsConfig(eventName, payload);

    if (!phone) {
      this.logger.log('EVENT_DISPATCHED', `شماره گیرنده برای رویداد ${eventName} یافت نشد.`);
      return;
    }

    // Check trigger enabled in settings
    if (trigger && settings.enabledTriggers && settings.enabledTriggers[trigger] === false) {
      this.logger.log('EVENT_DISPATCHED', `محرک ${trigger} در تنظیمات غیرفعال شده است.`);
      return;
    }

    // Find template for trigger
    const template = this.templateEngine.getTemplateByTrigger(trigger);
    let bodyText = '';

    if (template && template.isActive) {
      bodyText = this.templateEngine.render(template.bodyTemplate, variables);
    } else {
      // Fallback text if template not found
      bodyText = this.createFallbackText(eventName, variables);
    }

    if (!bodyText) {
      this.logger.log('EVENT_DISPATCHED', `متن پیامک برای رویداد ${eventName} تولید نشد.`);
      return;
    }

    // Enqueue message into SMS queue (NO DIRECT SEND)
    if (this.queueEngine) {
      const result = this.queueEngine.enqueue({
        recipientPhone: phone,
        recipient: phone,
        recipientName: recipientName || payload.customerName,
        content: bodyText,
        trigger,
        category: template?.category || 'sales',
        templateId: template?.id,
        priority,
        maxRetries: settings.defaultMaxRetries || 3,
        metadata: {
          sourceEvent: eventName,
          eventId: payload.eventId || `evt_${Date.now()}`,
          ...payload,
        },
      });

      if (result.success) {
        this.stats.queueItemsCreatedCount += 1;
        this.logger.log(
          'EVENT_DISPATCHED',
          `پیامک مربوط به رویداد ${eventName} در صف قرار گرفت. شناسه: ${result.message?.id}`
        );
      } else {
        this.logger.log(
          'EVENT_DISPATCHED',
          `افزودن پیامک به صف برای رویداد ${eventName} ناموفق بود: ${result.reason}`
        );
      }
    }
  }

  private mapEventToSmsConfig(
    eventName: SmsSystemEventName,
    payload: any
  ): {
    trigger: SmsEventTrigger;
    phone: string;
    recipientName?: string;
    variables: Record<string, string | number>;
    priority: SmsPriority;
  } {
    const phone = payload.customerPhone || payload.recipientPhone || '';
    const recipientName = payload.customerName || '';

    switch (eventName) {
      case 'INVOICE_CREATED': {
        const p = payload as InvoiceCreatedPayload;
        const trigger: SmsEventTrigger = p.isCash ? 'cash_sale' : 'installment_sale';
        return {
          trigger,
          phone,
          recipientName,
          variables: {
            customer_name: p.customerName || 'مشتری گرامی',
            invoice_number: p.invoiceNumber || '',
            amount: (p.totalAmount || 0).toLocaleString('fa-IR'),
            down_payment: '۰',
            installment_count: '۱',
          },
          priority: 'normal',
        };
      }

      case 'INSTALLMENT_BOOK_CREATED': {
        const p = payload as InstallmentBookCreatedPayload;
        return {
          trigger: 'installment_created',
          phone,
          recipientName,
          variables: {
            customer_name: p.customerName || 'مشتری گرامی',
            booklet_number: p.bookNumber || '',
            total_amount: (p.totalAmount || 0).toLocaleString('fa-IR'),
            installment_count: p.totalInstallments || 0,
          },
          priority: 'normal',
        };
      }

      case 'INSTALLMENT_DUE_REMINDER': {
        const p = payload as InstallmentDueReminderPayload;
        return {
          trigger: 'installment_due',
          phone,
          recipientName,
          variables: {
            customer_name: p.customerName || 'مشتری گرامی',
            installment_number: p.installmentNumber || 1,
            amount: (p.amount || 0).toLocaleString('fa-IR'),
            due_date: p.dueDate || '',
          },
          priority: 'high',
        };
      }

      case 'INSTALLMENT_OVERDUE': {
        const p = payload as InstallmentOverduePayload;
        return {
          trigger: 'installment_overdue',
          phone,
          recipientName,
          variables: {
            customer_name: p.customerName || 'مشتری گرامی',
            installment_number: p.installmentNumber || 1,
            amount: (p.amount || 0).toLocaleString('fa-IR'),
            delay_days: p.daysOverdue || 1,
          },
          priority: 'critical',
        };
      }

      case 'INSTALLMENT_PAID': {
        const p = payload as InstallmentPaidPayload;
        return {
          trigger: 'installment_paid',
          phone,
          recipientName,
          variables: {
            customer_name: p.customerName || 'مشتری گرامی',
            installment_number: p.installmentNumber || 1,
            amount_paid: (p.amountPaid || 0).toLocaleString('fa-IR'),
          },
          priority: 'normal',
        };
      }

      case 'CHECK_RECEIVED': {
        const p = payload as CheckReceivedPayload;
        return {
          trigger: 'check_registered',
          phone,
          recipientName,
          variables: {
            check_number: p.checkNumber || '',
            amount: (p.amount || 0).toLocaleString('fa-IR'),
            bank_name: p.bankName || 'بانک',
          },
          priority: 'normal',
        };
      }

      case 'CHECK_DUE': {
        const p = payload as CheckDuePayload;
        return {
          trigger: 'check_due',
          phone,
          recipientName,
          variables: {
            check_number: p.checkNumber || '',
            amount: (p.amount || 0).toLocaleString('fa-IR'),
            due_date: p.dueDate || '',
          },
          priority: 'high',
        };
      }

      case 'CHECK_CLEARED': {
        const p = payload as CheckClearedPayload;
        return {
          trigger: 'check_cleared',
          phone,
          recipientName,
          variables: {
            check_number: p.checkNumber || '',
            amount: (p.amount || 0).toLocaleString('fa-IR'),
            bank_name: p.bankName || 'بانک',
          },
          priority: 'normal',
        };
      }

      case 'CHECK_BOUNCED': {
        const p = payload as CheckBouncedPayload;
        return {
          trigger: 'check_bounced',
          phone,
          recipientName,
          variables: {
            check_number: p.checkNumber || '',
            amount: (p.amount || 0).toLocaleString('fa-IR'),
            reason: p.reason || 'کسری موجودی',
          },
          priority: 'critical',
        };
      }

      case 'CUSTOMER_REGISTERED': {
        const p = payload as CustomerRegisteredPayload;
        return {
          trigger: 'customer_registered',
          phone,
          recipientName,
          variables: {
            customer_name: p.customerName || 'مشتری گرامی',
            person_code: p.customerCode || '---',
          },
          priority: 'normal',
        };
      }

      case 'OTP_REQUESTED': {
        const p = payload as OtpRequestedPayload;
        return {
          trigger: 'otp_code',
          phone: p.recipientPhone || phone,
          recipientName,
          variables: {
            otp_code: p.otpCode || '',
            valid_minutes: p.validMinutes || 5,
          },
          priority: 'critical',
        };
      }

      case 'ON_NESYEH_ORDER_SUBMITTED': {
        return {
          trigger: 'nesyeh_order_submitted',
          phone,
          recipientName,
          variables: {
            partner_name: payload.partnerName || recipientName || 'نماینده گرامی',
            order_number: payload.orderNumber || '',
            total_amount: (payload.totalAmount || 0).toLocaleString('fa-IR'),
          },
          priority: 'normal',
        };
      }

      case 'ON_NESYEH_ORDER_STATUS_CHANGED': {
        return {
          trigger: 'nesyeh_order_status_changed',
          phone,
          recipientName,
          variables: {
            partner_name: payload.partnerName || recipientName || 'نماینده گرامی',
            order_number: payload.orderNumber || '',
            new_status: payload.newStatus || '',
          },
          priority: 'high',
        };
      }

      case 'ON_NESYEH_PAYMENT_VERIFIED': {
        return {
          trigger: 'nesyeh_payment_verified',
          phone,
          recipientName,
          variables: {
            partner_name: payload.partnerName || recipientName || 'نماینده گرامی',
            amount: (payload.amount || 0).toLocaleString('fa-IR'),
          },
          priority: 'high',
        };
      }

      case 'ON_CREDIT_LIMIT_APPROACHING': {
        return {
          trigger: 'credit_limit_approaching',
          phone,
          recipientName,
          variables: {
            partner_name: payload.partnerName || recipientName || 'نماینده گرامی',
            current_debt: (payload.currentDebt || 0).toLocaleString('fa-IR'),
            credit_limit: (payload.creditLimit || 0).toLocaleString('fa-IR'),
            debt_ratio: String(payload.debtRatioPercent || 80),
          },
          priority: 'critical',
        };
      }

      default: {
        return {
          trigger: 'manual_custom',
          phone,
          recipientName,
          variables: {},
          priority: 'normal',
        };
      }
    }
  }

  private createFallbackText(
    eventName: SmsSystemEventName,
    vars: Record<string, string | number>
  ): string {
    switch (eventName) {
      case 'INVOICE_CREATED':
        return `فاکتور شماره ${vars.invoice_number} به مبلغ ${vars.amount} ریال برای ${vars.customer_name} ثبت شد.`;
      case 'INSTALLMENT_DUE_REMINDER':
        return `یادآوری: قسط شماره ${vars.installment_number} به مبلغ ${vars.amount} ریال در تاریخ ${vars.due_date} سررسید می‌شود.`;
      case 'CHECK_BOUNCED':
        return `هشدار: چک شماره ${vars.check_number} به مبلغ ${vars.amount} ریال برگشت خورد.`;
      case 'OTP_REQUESTED':
        return `کد تایید شما: ${vars.otp_code}`;
      default:
        return `اطلاعیه جدید: رویداد ${eventName} ثبت گردید.`;
    }
  }
}

// Default Singleton Dispatcher
export const SmsEventDispatcher = new SmsEventDispatcherClass();
