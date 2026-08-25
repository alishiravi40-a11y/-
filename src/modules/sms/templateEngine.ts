/**
 * SMS Template Engine
 * Handles template creation, placeholder parameter interpolation, and default templates.
 */

import { SmsEventCategory, SmsEventTrigger, SmsTemplate } from './types';

export const DEFAULT_SMS_TEMPLATES: SmsTemplate[] = [
  {
    id: 'tpl_cash_sale',
    name: 'اطلاع‌رسانی فروش نقدی',
    trigger: 'cash_sale',
    category: 'sales',
    bodyTemplate: 'مشتری گرامی {customer_name}، فاکتور خرید نقدی شماره {invoice_number} به مبلغ {amount} ریال با موفقیت ثبت گردید. با تشکر از خرید شما.',
    isActive: true,
    variables: ['customer_name', 'invoice_number', 'amount'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_installment_sale',
    name: 'اطلاع‌رسانی فروش اقساطی',
    trigger: 'installment_sale',
    category: 'sales',
    bodyTemplate: 'مشتری گرامی {customer_name}، فاکتور اقساطی شماره {invoice_number} با پیش‌پرداخت {down_payment} ریال و {installment_count} قسط ثبت شد.',
    isActive: true,
    variables: ['customer_name', 'invoice_number', 'down_payment', 'installment_count'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_installment_created',
    name: 'تشکیل دفترچه اقساط',
    trigger: 'installment_created',
    category: 'installments',
    bodyTemplate: 'مشتری گرامی {customer_name}، دفترچه اقساط شما به شماره {booklet_number} به مبلغ کل {total_amount} ریال شامل {installment_count} قسط فعال شد.',
    isActive: true,
    variables: ['customer_name', 'booklet_number', 'total_amount', 'installment_count'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_installment_due',
    name: 'یادآوری سررسید قسط',
    trigger: 'installment_due',
    category: 'installments',
    bodyTemplate: 'یادآوری: مشتری گرامی {customer_name}، قسط شماره {installment_number} به مبلغ {amount} ریال در تاریخ {due_date} سررسید می‌شود.',
    isActive: true,
    variables: ['customer_name', 'installment_number', 'amount', 'due_date'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_installment_overdue',
    name: 'هشدار تأخیر قسط',
    trigger: 'installment_overdue',
    category: 'installments',
    bodyTemplate: 'هشدار: مشتری گرامی {customer_name}، قسط شماره {installment_number} به مبلغ {amount} ریال دارای {delay_days} روز تأخیر می‌باشد. لطفاً نسبت به تسویه اقدام فرمایید.',
    isActive: true,
    variables: ['customer_name', 'installment_number', 'amount', 'delay_days'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_check_registered',
    name: 'ثبت چک دریافتی',
    trigger: 'check_registered',
    category: 'checks',
    bodyTemplate: 'چک شماره {check_number} به مبلغ {amount} ریال عهده بانک {bank_name} با موفقیت در سیستم ثبت گردید.',
    isActive: true,
    variables: ['check_number', 'amount', 'bank_name'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_check_due',
    name: 'یادآوری سررسید چک',
    trigger: 'check_due',
    category: 'checks',
    bodyTemplate: 'یادآوری: سررسید چک شماره {check_number} به مبلغ {amount} ریال در تاریخ {due_date} می‌باشد.',
    isActive: true,
    variables: ['check_number', 'amount', 'due_date'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_check_cleared',
    name: 'وصول چک',
    trigger: 'check_cleared',
    category: 'checks',
    bodyTemplate: 'چک شماره {check_number} به مبلغ {amount} ریال با موفقیت در بانک {bank_name} وصول گردید.',
    isActive: true,
    variables: ['check_number', 'amount', 'bank_name'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_check_bounced',
    name: 'برگشت چک',
    trigger: 'check_bounced',
    category: 'checks',
    bodyTemplate: 'هشدار: چک شماره {check_number} به مبلغ {amount} ریال برگشت خورده است. جهت پیگیری تماس بگیرید.',
    isActive: true,
    variables: ['check_number', 'amount'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_customer_registered',
    name: 'خوش‌آمدگویی ثبت شخص',
    trigger: 'customer_registered',
    category: 'credit',
    bodyTemplate: 'مشتری گرامی {customer_name}، اطلاعات شما در سیستم ثبت گردید. کد تفصیلی: {person_code}.',
    isActive: true,
    variables: ['customer_name', 'person_code'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_credit_approved',
    name: 'تأیید پرونده اعتباری',
    trigger: 'credit_approved',
    category: 'credit',
    bodyTemplate: 'پرونده اعتباری شما با سقف اعتبار {credit_limit} ریال با موفقیت تأیید گردید.',
    isActive: true,
    variables: ['credit_limit'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_credit_rejected',
    name: 'رد پرونده اعتباری',
    trigger: 'credit_rejected',
    category: 'credit',
    bodyTemplate: 'پرونده اعتباری شما مورد تأیید قرار نگرفت. علت: {reject_reason}.',
    isActive: true,
    variables: ['reject_reason'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_installment_paid',
    name: 'رسید پرداخت قسط',
    trigger: 'installment_paid',
    category: 'installments',
    bodyTemplate: 'مشتری گرامی {customer_name}، قسط شماره {installment_number} به مبلغ {amount_paid} ریال با موفقیت دریافت و ثبت گردید.',
    isActive: true,
    variables: ['customer_name', 'installment_number', 'amount_paid'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_otp_code',
    name: 'کد تایید ورود (OTP)',
    trigger: 'otp_code',
    category: 'system',
    bodyTemplate: 'کد تأیید شما: {otp_code}. این کد تا {valid_minutes} دقیقه معتبر است.',
    isActive: true,
    variables: ['otp_code', 'valid_minutes'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_nesyeh_order_submitted',
    name: 'ثبت سفارش خرید نسیه',
    trigger: 'nesyeh_order_submitted',
    category: 'sales',
    bodyTemplate: 'نماینده گرامی {partner_name}، سفارش نسیه شماره {order_number} به مبلغ {total_amount} ریال با موفقیت ثبت گردید و در انتظار بررسی است.',
    isActive: true,
    variables: ['partner_name', 'order_number', 'total_amount'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_nesyeh_order_status_changed',
    name: 'تغییر وضعیت سفارش نسیه',
    trigger: 'nesyeh_order_status_changed',
    category: 'sales',
    bodyTemplate: 'نماینده گرامی {partner_name}، وضعیت سفارش نسیه شماره {order_number} به {new_status} تغییر یافت.',
    isActive: true,
    variables: ['partner_name', 'order_number', 'new_status'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_nesyeh_payment_verified',
    name: 'تایید اعلام پرداخت نسیه',
    trigger: 'nesyeh_payment_verified',
    category: 'credit',
    bodyTemplate: 'نماینده گرامی {partner_name}، اعلام پرداخت شما به مبلغ {amount} ریال با موفقیت تایید و سند بستانکاری صادر شد.',
    isActive: true,
    variables: ['partner_name', 'amount'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'tpl_credit_limit_approaching',
    name: 'هشدار نزدیک شدن بدهی به سقف اعتبار',
    trigger: 'credit_limit_approaching',
    category: 'credit',
    bodyTemplate: 'هشدار اعتبار: بدهی شما ({current_debt} ریال) به {debt_ratio}٪ سقف اعتبار ({credit_limit} ریال) رسیده است.',
    isActive: true,
    variables: ['partner_name', 'current_debt', 'debt_ratio', 'credit_limit'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export class SmsTemplateEngine {
  private templates: Map<string, SmsTemplate> = new Map();

  constructor(initialTemplates?: SmsTemplate[]) {
    const list = initialTemplates || DEFAULT_SMS_TEMPLATES;
    list.forEach((tpl) => this.templates.set(tpl.id, { ...tpl }));
  }

  /**
   * Get all loaded templates
   */
  getAllTemplates(): SmsTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get template by ID
   */
  getTemplateById(id: string): SmsTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Find active template by trigger
   */
  getTemplateByTrigger(trigger: SmsEventTrigger): SmsTemplate | undefined {
    return Array.from(this.templates.values()).find(
      (tpl) => tpl.trigger === trigger && tpl.isActive
    );
  }

  /**
   * Upsert a template
   */
  saveTemplate(template: SmsTemplate): void {
    this.templates.set(template.id, {
      ...template,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Extract placeholder keys inside curly braces e.g. "Hello {name}" -> ["name"]
   */
  static extractVariables(bodyTemplate: string): string[] {
    const matches = bodyTemplate.match(/\{([a-zA-Z0-9_]+)\}/g);
    if (!matches) return [];
    return Array.from(new Set(matches.map((m) => m.slice(1, -1))));
  }

  /**
   * Interpolate parameters into body template safely
   */
  render(templateIdOrBody: string, params: Record<string, string | number>): string {
    let rawText = templateIdOrBody;

    const tpl = this.templates.get(templateIdOrBody);
    if (tpl) {
      rawText = tpl.bodyTemplate;
    }

    return rawText.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
      if (params && Object.prototype.hasOwnProperty.call(params, key)) {
        const val = params[key];
        return val !== undefined && val !== null ? String(val) : '';
      }
      return match; // Keep unreplaced if parameter missing
    });
  }
}
