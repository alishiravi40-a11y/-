/**
 * SMS Event Payload Mapper
 * Read-only mapper converting financial and business system event payloads
 * into standardized SMS template variables and key-value pairs.
 * Pure function with zero side-effects on financial data.
 */

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

export interface MappedSmsVariables {
  phone: string;
  recipientName: string;
  variables: Record<string, string>;
}

export class SmsEventPayloadMapper {
  /**
   * Format numbers to localized Persian numbers or comma separated values
   */
  public static formatAmount(amount: number): string {
    if (amount === undefined || amount === null) return '0';
    return amount.toLocaleString('fa-IR');
  }

  /**
   * Maps generic system event name and payload to template variables
   */
  public static mapPayloadToVariables(
    eventName: SmsSystemEventName,
    payload: any
  ): MappedSmsVariables {
    const basePhone = payload?.customerPhone || payload?.recipientPhone || payload?.phone || '';
    const baseName = payload?.customerName || payload?.recipientName || 'مشتری گرامی';

    const vars: Record<string, string> = {
      customer_name: baseName,
    };

    switch (eventName) {
      case 'INVOICE_CREATED': {
        const p = payload as InvoiceCreatedPayload;
        vars['invoice_no'] = p.invoiceNumber || '';
        vars['amount'] = this.formatAmount(p.totalAmount || 0);
        vars['sale_type'] = p.isCash ? 'نقدی' : 'اقساطی';
        if (p.dueDate) vars['due_date'] = p.dueDate;
        break;
      }

      case 'INSTALLMENT_BOOK_CREATED': {
        const p = payload as InstallmentBookCreatedPayload;
        vars['book_no'] = p.bookNumber || '';
        vars['total_installments'] = String(p.totalInstallments || 0);
        vars['amount'] = this.formatAmount(p.totalAmount || 0);
        break;
      }

      case 'INSTALLMENT_DUE_REMINDER': {
        const p = payload as InstallmentDueReminderPayload;
        vars['installment_no'] = String(p.installmentNumber || 1);
        vars['due_date'] = p.dueDate || '';
        vars['amount'] = this.formatAmount(p.amount || 0);
        if (p.invoiceNumber) vars['invoice_no'] = p.invoiceNumber;
        break;
      }

      case 'INSTALLMENT_OVERDUE': {
        const p = payload as InstallmentOverduePayload;
        vars['installment_no'] = String(p.installmentNumber || 1);
        vars['due_date'] = p.dueDate || '';
        vars['amount'] = this.formatAmount(p.amount || 0);
        vars['days_overdue'] = String(p.daysOverdue || 0);
        break;
      }

      case 'INSTALLMENT_PAID': {
        const p = payload as InstallmentPaidPayload;
        vars['installment_no'] = String(p.installmentNumber || 1);
        vars['amount'] = this.formatAmount(p.amountPaid || 0);
        if (p.remainingBalance !== undefined) {
          vars['remaining_balance'] = this.formatAmount(p.remainingBalance);
        }
        break;
      }

      case 'CHECK_RECEIVED':
      case 'CHECK_DUE': {
        const p = payload as CheckReceivedPayload;
        vars['check_no'] = p.checkNumber || '';
        vars['bank_name'] = p.bankName || '';
        vars['due_date'] = p.dueDate || '';
        vars['amount'] = this.formatAmount(p.amount || 0);
        break;
      }

      case 'CHECK_CLEARED': {
        const p = payload as CheckClearedPayload;
        vars['check_no'] = p.checkNumber || '';
        vars['bank_name'] = p.bankName || '';
        vars['amount'] = this.formatAmount(p.amount || 0);
        break;
      }

      case 'CHECK_BOUNCED': {
        const p = payload as CheckBouncedPayload;
        vars['check_no'] = p.checkNumber || '';
        vars['bank_name'] = p.bankName || '';
        vars['amount'] = this.formatAmount(p.amount || 0);
        if (p.reason) vars['reason'] = p.reason;
        break;
      }

      case 'CUSTOMER_REGISTERED': {
        const p = payload as CustomerRegisteredPayload;
        vars['registration_date'] = p.registrationDate || new Date().toLocaleDateString('fa-IR');
        if (p.customerCode) vars['customer_code'] = p.customerCode;
        break;
      }

      case 'OTP_REQUESTED': {
        const p = payload as OtpRequestedPayload;
        vars['code'] = p.otpCode || '';
        vars['valid_minutes'] = String(p.validMinutes || 3);
        break;
      }

      case 'ON_NESYEH_ORDER_SUBMITTED': {
        vars['partner_name'] = payload.partnerName || baseName;
        vars['order_number'] = payload.orderNumber || '';
        vars['total_amount'] = this.formatAmount(payload.totalAmount || 0);
        vars['amount'] = this.formatAmount(payload.totalAmount || 0);
        break;
      }

      case 'ON_NESYEH_ORDER_STATUS_CHANGED': {
        vars['partner_name'] = payload.partnerName || baseName;
        vars['order_number'] = payload.orderNumber || '';
        vars['old_status'] = payload.oldStatus || '';
        vars['new_status'] = payload.newStatus || '';
        break;
      }

      case 'ON_NESYEH_PAYMENT_VERIFIED': {
        vars['partner_name'] = payload.partnerName || baseName;
        vars['amount'] = this.formatAmount(payload.amount || 0);
        vars['payment_type'] = payload.paymentType || '';
        break;
      }

      case 'ON_CREDIT_LIMIT_APPROACHING': {
        vars['partner_name'] = payload.partnerName || baseName;
        vars['current_debt'] = this.formatAmount(payload.currentDebt || 0);
        vars['credit_limit'] = this.formatAmount(payload.creditLimit || 0);
        vars['debt_ratio'] = String(payload.debtRatioPercent || 80);
        break;
      }
    }

    return {
      phone: basePhone,
      recipientName: baseName,
      variables: vars,
    };
  }
}
