/**
 * SMS Module Types and Interfaces
 * Fully isolated, self-contained types for SMS infrastructure.
 */

export type SmsPriority = 'critical' | 'high' | 'normal' | 'low';

export type SmsStatus = 'pending' | 'queued' | 'sending' | 'sent' | 'failed' | 'canceled' | 'scheduled';

export type SmsEventCategory = 'sales' | 'installments' | 'checks' | 'credit' | 'system' | 'marketing';

export type SmsEventTrigger =
  | 'cash_sale'
  | 'installment_sale'
  | 'installment_created'
  | 'installment_due'
  | 'installment_overdue'
  | 'installment_paid'
  | 'check_registered'
  | 'check_due'
  | 'check_deposited'
  | 'check_cleared'
  | 'check_bounced'
  | 'customer_registered'
  | 'otp_code'
  | 'credit_dossier_created'
  | 'credit_approved'
  | 'credit_rejected'
  | 'agent_registered'
  | 'agent_status_changed'
  | 'manual_custom'
  | 'nesyeh_order_submitted'
  | 'nesyeh_order_status_changed'
  | 'nesyeh_payment_verified'
  | 'credit_limit_approaching';

export type SmsSystemEventName =
  | 'INVOICE_CREATED'
  | 'INSTALLMENT_BOOK_CREATED'
  | 'INSTALLMENT_DUE_REMINDER'
  | 'INSTALLMENT_OVERDUE'
  | 'INSTALLMENT_PAID'
  | 'CHECK_RECEIVED'
  | 'CHECK_DUE'
  | 'CHECK_CLEARED'
  | 'CHECK_BOUNCED'
  | 'CUSTOMER_REGISTERED'
  | 'OTP_REQUESTED'
  | 'ON_NESYEH_ORDER_SUBMITTED'
  | 'ON_NESYEH_ORDER_STATUS_CHANGED'
  | 'ON_NESYEH_PAYMENT_VERIFIED'
  | 'ON_CREDIT_LIMIT_APPROACHING';

export interface BaseEventPayload {
  eventId?: string;
  timestamp?: string;
  customerName?: string;
  customerPhone?: string;
}

export interface NesyehOrderSubmittedPayload extends BaseEventPayload {
  orderNumber: string;
  partnerName: string;
  totalAmount: number;
  itemCount?: number;
}

export interface NesyehOrderStatusChangedPayload extends BaseEventPayload {
  orderNumber: string;
  partnerName: string;
  oldStatus?: string;
  newStatus: string;
  totalAmount?: number;
}

export interface NesyehPaymentVerifiedPayload extends BaseEventPayload {
  declarationId: string;
  partnerName: string;
  paymentType: string;
  amount: number;
  receiptNo?: string;
  checkNo?: string;
}

export interface CreditLimitApproachingPayload extends BaseEventPayload {
  partnerName: string;
  currentDebt: number;
  creditLimit: number;
  debtRatioPercent: number;
}

export interface InvoiceCreatedPayload extends BaseEventPayload {
  invoiceNumber: string;
  totalAmount: number;
  isCash: boolean;
  dueDate?: string;
}

export interface InstallmentBookCreatedPayload extends BaseEventPayload {
  bookNumber: string;
  totalInstallments: number;
  totalAmount: number;
}

export interface InstallmentDueReminderPayload extends BaseEventPayload {
  installmentNumber: number;
  dueDate: string;
  amount: number;
  invoiceNumber?: string;
}

export interface InstallmentOverduePayload extends BaseEventPayload {
  installmentNumber: number;
  dueDate: string;
  amount: number;
  daysOverdue: number;
}

export interface InstallmentPaidPayload extends BaseEventPayload {
  installmentNumber: number;
  amountPaid: number;
  remainingBalance?: number;
}

export interface CheckReceivedPayload extends BaseEventPayload {
  checkNumber: string;
  bankName: string;
  dueDate: string;
  amount: number;
}

export interface CheckDuePayload extends BaseEventPayload {
  checkNumber: string;
  bankName: string;
  dueDate: string;
  amount: number;
}

export interface CheckClearedPayload extends BaseEventPayload {
  checkNumber: string;
  bankName: string;
  amount: number;
}

export interface CheckBouncedPayload extends BaseEventPayload {
  checkNumber: string;
  bankName: string;
  amount: number;
  reason?: string;
}

export interface CustomerRegisteredPayload extends BaseEventPayload {
  registrationDate?: string;
  customerCode?: string;
}

export interface OtpRequestedPayload extends BaseEventPayload {
  recipientPhone: string;
  otpCode: string;
  validMinutes?: number;
}

export interface SmsTemplateVariable {
  key: string;
  label: string;
  description: string;
  example: string;
}

export interface SmsMetrics {
  totalSent: number;
  totalPending: number;
  totalFailed: number;
  totalQueued: number;
  totalCost: number;
  deliveryRatePercent: number;
  sentTodayCount: number;
}

export interface SmsTemplate {
  id: string;
  name: string;
  title?: string;
  trigger: SmsEventTrigger;
  category: SmsEventCategory;
  patternId?: string; // Pattern ID for service lines (e.g., Kavenegar / Ghasedak)
  bodyTemplate: string; // e.g., "سلام {customer_name}، فاکتور {invoice_number} به مبلغ {amount} ریال ثبت شد."
  description?: string;
  isActive: boolean;
  variables: string[]; // List of expected variable keys in bodyTemplate
  createdAt: string;
  updatedAt: string;
}

export interface SmsMessage {
  id: string;
  recipientPhone: string;
  recipient?: string; // Optional alias for recipientPhone
  recipientName?: string;
  templateId?: string;
  trigger?: SmsEventTrigger;
  category?: SmsEventCategory;
  content: string;
  patternId?: string;
  patternTokens?: Record<string, string>;
  priority: SmsPriority;
  status: SmsStatus;
  retryCount: number;
  maxRetries: number;
  scheduledTime?: string; // ISO date string or HH:mm
  sentTime?: string;
  sentAt?: string; // Optional alias for sentTime
  failedReason?: string;
  providerId?: string;
  messageIdFromProvider?: string;
  cost?: number; // In Rials or credits
  metadata?: Record<string, any>;
  deduplicationKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SmsQueueSnapshot {
  version: string;
  savedAt: string;
  messages: SmsMessage[];
}

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  cost?: number;
  error?: string;
  errorCode?: string;
  rawResponse?: any;
}

export interface SmsProviderConfig {
  id: string;
  name: string;
  type: 'mock' | 'kavenegar' | 'ghasedak' | 'farazsms' | 'custom_rest';
  apiKey?: string;
  senderLine?: string;
  baseUrl?: string;
  isActive: boolean;
  isDefault: boolean;
  supportPattern: boolean;
  rateLimitPerMinute: number;
}

export interface QuietHoursConfig {
  enabled: boolean;
  startTime: string; // e.g., "22:00"
  endTime: string; // e.g., "08:00"
  allowCriticalDuringQuietHours: boolean;
}

export interface ProviderHealthResult {
  providerId: string;
  providerName: string;
  isHealthy: boolean;
  creditBalance: number;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

export interface SmsSettings {
  enabled: boolean;
  activeProviderId: string;
  fallbackProviderId?: string;
  eventIntegrationMode?: 'mock' | 'production';
  quietHours: QuietHoursConfig;
  defaultMaxRetries: number;
  retryIntervalMinutes: number;
  dailySendLimit: number;
  enabledTriggers: Record<SmsEventTrigger, boolean>;
  requireApprovalForMarketing: boolean;
  organizationSenderName: string;
  updatedAt: string;
}

export type SmsLogAction =
  | 'SEND_SUCCESS'
  | 'SEND_FAILED'
  | 'QUEUED'
  | 'RETRY_ATTEMPT'
  | 'CANCELLED'
  | 'TEMPLATE_UPDATED'
  | 'SETTINGS_UPDATED'
  | 'PROVIDER_CHANGED'
  | 'PROVIDER_HEALTH_CHECK'
  | 'FAILOVER_TRIGGERED'
  | 'EVENT_RECEIVED'
  | 'EVENT_DISPATCHED';

export interface SmsLogEntry {
  id: string;
  timestamp: string;
  action: SmsLogAction;
  level?: 'info' | 'warn' | 'error' | 'success';
  messageId?: string;
  recipientPhone?: string;
  details: string;
  userId?: string;
  meta?: Record<string, any>;
}
