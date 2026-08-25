/**
 * Mock Event Source Adapter
 * Simulates standard financial and system events for testing the SMS Event Bridge.
 * Completely isolated from real financial core tables and procedures.
 */

import { SmsEventBus, SmsEventBusClass } from './eventBus';
import {
  InvoiceCreatedPayload,
  InstallmentDueReminderPayload,
  CheckBouncedPayload,
  CustomerRegisteredPayload,
  OtpRequestedPayload,
  CheckClearedPayload,
  InstallmentPaidPayload,
} from './types';

export class SmsMockEventSource {
  private eventBus: SmsEventBusClass;

  constructor(eventBus: SmsEventBusClass = SmsEventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Simulate INVOICE_CREATED Event
   */
  public simulateInvoiceCreated(customPayload?: Partial<InvoiceCreatedPayload>): InvoiceCreatedPayload {
    const payload: InvoiceCreatedPayload = {
      eventId: `evt_inv_${Date.now()}`,
      timestamp: new Date().toISOString(),
      invoiceNumber: customPayload?.invoiceNumber || `INV-${Math.floor(1000 + Math.random() * 9000)}`,
      customerName: customPayload?.customerName || 'علی رضایی',
      customerPhone: customPayload?.customerPhone || '09121111111',
      totalAmount: customPayload?.totalAmount ?? 150000000,
      isCash: customPayload?.isCash ?? true,
      dueDate: customPayload?.dueDate || '۱۴۰۵/۰۲/۲۰',
    };

    this.eventBus.publish('INVOICE_CREATED', payload);
    return payload;
  }

  /**
   * Simulate INSTALLMENT_DUE_REMINDER Event
   */
  public simulateInstallmentDueReminder(
    customPayload?: Partial<InstallmentDueReminderPayload>
  ): InstallmentDueReminderPayload {
    const payload: InstallmentDueReminderPayload = {
      eventId: `evt_inst_${Date.now()}`,
      timestamp: new Date().toISOString(),
      customerName: customPayload?.customerName || 'مریم کاظمی',
      customerPhone: customPayload?.customerPhone || '09122222222',
      installmentNumber: customPayload?.installmentNumber ?? 3,
      amount: customPayload?.amount ?? 25000000,
      dueDate: customPayload?.dueDate || '۱۴۰۵/۰۲/۲۵',
      invoiceNumber: customPayload?.invoiceNumber || 'INV-1002',
    };

    this.eventBus.publish('INSTALLMENT_DUE_REMINDER', payload);
    return payload;
  }

  /**
   * Simulate CHECK_BOUNCED Event
   */
  public simulateCheckBounced(customPayload?: Partial<CheckBouncedPayload>): CheckBouncedPayload {
    const payload: CheckBouncedPayload = {
      eventId: `evt_chk_bounced_${Date.now()}`,
      timestamp: new Date().toISOString(),
      customerName: customPayload?.customerName || 'حسن محمدی',
      customerPhone: customPayload?.customerPhone || '09123333333',
      checkNumber: customPayload?.checkNumber || `CHK-${Math.floor(100000 + Math.random() * 900000)}`,
      bankName: customPayload?.bankName || 'بانک ملی',
      amount: customPayload?.amount ?? 85000000,
      reason: customPayload?.reason || 'کسری موجودی در حساب جاری',
    };

    this.eventBus.publish('CHECK_BOUNCED', payload);
    return payload;
  }

  /**
   * Simulate CUSTOMER_REGISTERED Event
   */
  public simulateCustomerRegistered(
    customPayload?: Partial<CustomerRegisteredPayload>
  ): CustomerRegisteredPayload {
    const payload: CustomerRegisteredPayload = {
      eventId: `evt_cust_${Date.now()}`,
      timestamp: new Date().toISOString(),
      customerName: customPayload?.customerName || 'رضا اکبری',
      customerPhone: customPayload?.customerPhone || '09124444444',
      customerCode: customPayload?.customerCode || 'PR-9042',
      registrationDate: customPayload?.registrationDate || new Date().toISOString().split('T')[0],
    };

    this.eventBus.publish('CUSTOMER_REGISTERED', payload);
    return payload;
  }

  /**
   * Simulate OTP_REQUESTED Event
   */
  public simulateOtpRequested(customPayload?: Partial<OtpRequestedPayload>): OtpRequestedPayload {
    const payload: OtpRequestedPayload = {
      eventId: `evt_otp_${Date.now()}`,
      timestamp: new Date().toISOString(),
      recipientPhone: customPayload?.recipientPhone || '09125555555',
      otpCode: customPayload?.otpCode || `${Math.floor(100000 + Math.random() * 900000)}`,
      validMinutes: customPayload?.validMinutes ?? 5,
    };

    this.eventBus.publish('OTP_REQUESTED', payload);
    return payload;
  }

  /**
   * Simulate CHECK_CLEARED Event
   */
  public simulateCheckCleared(customPayload?: Partial<CheckClearedPayload>): CheckClearedPayload {
    const payload: CheckClearedPayload = {
      eventId: `evt_chk_cleared_${Date.now()}`,
      timestamp: new Date().toISOString(),
      customerName: customPayload?.customerName || 'سارا حسینی',
      customerPhone: customPayload?.customerPhone || '09126666666',
      checkNumber: customPayload?.checkNumber || `CHK-${Math.floor(100000 + Math.random() * 900000)}`,
      bankName: customPayload?.bankName || 'بانک ملت',
      amount: customPayload?.amount ?? 42000000,
    };

    this.eventBus.publish('CHECK_CLEARED', payload);
    return payload;
  }

  /**
   * Simulate INSTALLMENT_PAID Event
   */
  public simulateInstallmentPaid(customPayload?: Partial<InstallmentPaidPayload>): InstallmentPaidPayload {
    const payload: InstallmentPaidPayload = {
      eventId: `evt_inst_paid_${Date.now()}`,
      timestamp: new Date().toISOString(),
      customerName: customPayload?.customerName || 'کامران نوری',
      customerPhone: customPayload?.customerPhone || '09127777777',
      installmentNumber: customPayload?.installmentNumber ?? 1,
      amountPaid: customPayload?.amountPaid ?? 30000000,
      remainingBalance: customPayload?.remainingBalance ?? 60000000,
    };

    this.eventBus.publish('INSTALLMENT_PAID', payload);
    return payload;
  }
}

export const mockEventSource = new SmsMockEventSource();
