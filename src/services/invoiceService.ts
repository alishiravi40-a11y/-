/**
 * Centralized Authoritative Invoice Service (Block 2 - Command 7 & Command 8)
 * Handles client communication with /api/invoices server-side endpoints.
 * Enforces explicit JWT authorization, UUID idempotency operation keys,
 * field mapping to PostgreSQL schema, and fail-closed gates for unmigrated settlements.
 */

import { Invoice, InvoiceItem, DocumentStatus } from '../types';
import { getDefaultAuthSessionService } from './authSessionService';

export interface InvoiceItemDbRecord {
  id: string;
  organization_id: string;
  invoice_id: string;
  row_number: number;
  product_id: string;
  warehouse_id: string;
  quantity: number | string;
  unit_price_amount: number | string;
  discount_amount: number | string;
  total_price_amount: number | string;
  unit_cost_amount?: number | string | null;
  total_cost_amount?: number | string | null;
  serial_numbers?: string[] | string | null;
  description?: string | null;
  created_at?: string;
}

export interface InvoiceDbRecord {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  fiscal_year_id?: string | null;
  invoice_number: number | string;
  invoice_type: 'BUY' | 'SELL';
  person_id: string;
  invoice_date: string;
  invoice_date_jalali: string;
  is_pro_invoice: boolean;
  is_converted?: boolean;
  subtotal_amount: number | string;
  discount_amount: number | string;
  tax_percent: number | string;
  tax_amount: number | string;
  total_amount: number | string;
  paid_amount: number | string;
  cash_paid_amount: number | string;
  pos_paid_amount: number | string;
  pos_terminal_id?: string | null;
  is_installment_deferred?: boolean;
  is_settled_with_checks?: boolean;
  is_paid_from_wallet?: boolean;
  delay_penalty_amount?: number | string;
  settlement_commission_amount?: number | string;
  cost_center_id?: string | null;
  purchase_manager_profit_rate?: number | string | null;
  description?: string | null;
  journal_voucher_id?: string | null;
  inventory_transaction_id?: string | null;
  reversal_voucher_id?: string | null;
  reversal_inventory_transaction_id?: string | null;
  settlement_status?: string;
  credit_rules_snapshot?: any;
  operation_key?: string | null;
  request_fingerprint?: string | null;
  status: 'DRAFT' | 'POSTED' | 'VOIDED';
  version?: number;
  created_by?: string | null;
  created_at: string;
  updated_at?: string;
  voided_by?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  invoice_items?: InvoiceItemDbRecord[];
}

/**
 * Transforms a server snake_case invoice item record to client InvoiceItem model
 */
export function mapDbItemToInvoiceItem(item: InvoiceItemDbRecord): InvoiceItem {
  let serials: string[] | undefined = undefined;
  if (Array.isArray(item.serial_numbers)) {
    serials = item.serial_numbers;
  } else if (typeof item.serial_numbers === 'string') {
    try {
      serials = JSON.parse(item.serial_numbers);
    } catch {
      serials = undefined;
    }
  }

  return {
    productId: item.product_id,
    quantity: Number(item.quantity) || 0,
    unitPrice: Number(item.unit_price_amount) || 0,
    discount: Number(item.discount_amount) || 0,
    warehouseId: item.warehouse_id,
    costPrice: item.unit_cost_amount !== null && item.unit_cost_amount !== undefined ? Number(item.unit_cost_amount) : undefined,
    totalCostPrice: item.total_cost_amount !== null && item.total_cost_amount !== undefined ? Number(item.total_cost_amount) : undefined,
    serialNumbers: serials
  };
}

/**
 * Transforms a server snake_case invoice record to client Invoice model
 */
export function mapDbRecordToInvoice(record: InvoiceDbRecord): Invoice {
  let status: DocumentStatus = 'active';
  if (record.status === 'VOIDED') {
    status = 'voided';
  } else if (record.status === 'DRAFT') {
    status = 'draft';
  }

  const items = (record.invoice_items || [])
    .slice()
    .sort((a, b) => (Number(a.row_number) || 0) - (Number(b.row_number) || 0))
    .map(mapDbItemToInvoiceItem);

  return {
    id: record.id,
    invoiceNumber: Number(record.invoice_number),
    type: record.invoice_type === 'SELL' ? 'sell' : 'buy',
    isProInvoice: Boolean(record.is_pro_invoice),
    isConverted: Boolean(record.is_converted),
    date: record.invoice_date_jalali || record.invoice_date,
    personId: record.person_id,
    items,
    discount: Number(record.discount_amount) || 0,
    taxPercent: Number(record.tax_percent) || 0,
    description: record.description || undefined,
    voucherId: record.journal_voucher_id || undefined,
    totalAmount: Number(record.total_amount) || 0,
    paidAmount: Number(record.paid_amount) || 0,
    cashPaidAmount: Number(record.cash_paid_amount) || 0,
    posPaidAmount: Number(record.pos_paid_amount) || 0,
    posTerminalId: record.pos_terminal_id || undefined,
    isInstallmentDeferred: Boolean(record.is_installment_deferred),
    isSettledWithChecks: Boolean(record.is_settled_with_checks),
    isPaidFromWallet: Boolean(record.is_paid_from_wallet),
    delayPenaltyAmount: Number(record.delay_penalty_amount) || 0,
    settlementCommission: Number(record.settlement_commission_amount) || 0,
    costCenterId: record.cost_center_id || undefined,
    purchaseManagerProfitRate: record.purchase_manager_profit_rate ? Number(record.purchase_manager_profit_rate) : undefined,
    createdAt: record.created_at,
    createdBy: record.created_by || undefined,
    branchId: record.branch_id || undefined,
    organizationId: record.organization_id || undefined,
    status,
    voidedAt: record.voided_at || undefined,
    voidedBy: record.voided_by || undefined,
    voidReason: record.void_reason || undefined,
    reversalVoucherId: record.reversal_voucher_id || undefined,
    creditRulesSnapshot: record.credit_rules_snapshot || undefined
  };
}

export interface InvoiceItemClientPayload {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  warehouseId?: string;
  costPrice?: number;
  totalCostPrice?: number;
  serialNumbers?: string[];
}

export interface InvoiceClientCreatePayload {
  type: 'buy' | 'sell';
  personId: string;
  personName?: string;
  date?: string;
  dateJalali?: string;
  isProInvoice?: boolean;
  discount?: number;
  taxPercent?: number;
  description?: string;
  cashPaidAmount?: number;
  posPaidAmount?: number;
  posTerminalId?: string;
  isInstallmentDeferred?: boolean;
  isSettledWithChecks?: boolean;
  isPaidFromWallet?: boolean;
  settlementCommission?: number;
  costCenterId?: string;
  purchaseManagerProfitRate?: number;
  items: InvoiceItemClientPayload[];
  branchId?: string;
  fiscalYearId?: string;
}

export interface ServerInvoiceResult {
  success: boolean;
  invoiceId: string;
  invoiceNumber: number;
  journalVoucherId?: string | null;
  inventoryTransactionId?: string | null;
  totalAmount: number;
  subtotalAmount: number;
  taxAmount: number;
  totalDebit?: number;
  isProInvoice?: boolean;
}

export interface InvoiceApiError {
  status: number;
  code: string;
  message: string;
}

export class InvoiceService {
  private static baseUrl = '';

  public static setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  /**
   * Helper to generate standard RFC4122 v4 UUID
   */
  public static generateUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Resolves active Supabase user JWT token
   */
  private static async resolveToken(token?: string): Promise<string | undefined> {
    if (token) return token;
    try {
      const accessToken = await getDefaultAuthSessionService().getAccessToken();
      if (accessToken) {
        return accessToken;
      }
    } catch {
      // Fallback
    }
    return undefined;
  }

  private static getHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private static async handleResponse<T>(res: Response): Promise<T> {
    const body = await res.json().catch(() => null);

    if (!res.ok || (body && body.success === false)) {
      const error: any = new Error(body?.message || `HTTP Error ${res.status}`);
      error.status = res.status;
      error.code = body?.error || 'ERR_UNKNOWN';
      error.body = body;

      if (res.status === 401) {
        error.message = 'نشست کاری شما منقضی شده است. لطفاً مجدداً وارد شوید.';
      } else if (res.status === 403) {
        error.message = 'شما دسترسی لازم برای این عملیات را ندارید.';
      } else if (res.status === 404) {
        error.message = 'فاکتور مورد نظر در سازمان یافت نشد.';
      } else if (res.status === 409) {
        error.message = body?.message || 'تعارض در شماره یا شناسه فاکتور.';
      } else if (res.status === 503) {
        error.message = 'سرویس پایگاه‌داده موقتاً در دسترس نیست.';
      }

      throw error;
    }

    return body as T;
  }

  /**
   * Normalizes server error response into structured InvoiceApiError
   */
  public static normalizeError(err: any, defaultMessage = 'خطا در ثبت فاکتور'): InvoiceApiError {
    if (err && typeof err === 'object') {
      const status = err.status || 500;
      const code = err.code || err.error || 'ERR_INVOICE_FAILED';
      let message = err.message || defaultMessage;

      if (message.includes('ERR_INACTIVE_PERSON')) {
        message = 'طرف حساب انتخابی غیرفعال است و امکان صدور فاکتور برای او وجود ندارد.';
      } else if (message.includes('ERR_EMPTY_ITEMS')) {
        message = 'فاکتور باید حداقل دارای یک ردیف کالا باشد.';
      } else if (message.includes('ERR_INVALID_QUANTITY')) {
        message = 'تعداد کالای انتخابی نامعتبر است.';
      } else if (message.includes('ERR_FAIL_CLOSED_SETTLEMENT')) {
        message = 'ثبت فاکتور با تسویه چک یا اقساط در این مرحله به صورت یکپارچه سرور فعال نشده و قفل است.';
      } else if (message.includes('ERR_IDEMPOTENCY_CONFLICT')) {
        message = 'این فاکتور قبلاً با مشخصات متفاوتی ثبت شده است.';
      }

      return { status, code, message };
    }

    return {
      status: 500,
      code: 'ERR_UNKNOWN',
      message: defaultMessage
    };
  }

  /**
   * Fetch all authoritative invoices for authenticated user's active organization (Block 2 - Command 8)
   */
  public static async getInvoices(token?: string): Promise<Invoice[]> {
    const authToken = await this.resolveToken(token);
    const res = await fetch(`${this.baseUrl}/api/invoices`, {
      method: 'GET',
      headers: this.getHeaders(authToken),
    });
    const result = await this.handleResponse<{ success: boolean; data: InvoiceDbRecord[] }>(res);
    return (result.data || []).map(mapDbRecordToInvoice);
  }

  /**
   * Alias for getInvoices
   */
  public static async listInvoices(token?: string): Promise<Invoice[]> {
    return this.getInvoices(token);
  }

  /**
   * Fetch single authoritative invoice by UUID (Block 2 - Command 8)
   */
  public static async getInvoiceById(id: string, token?: string): Promise<Invoice> {
    const authToken = await this.resolveToken(token);
    const res = await fetch(`${this.baseUrl}/api/invoices/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: this.getHeaders(authToken),
    });
    const result = await this.handleResponse<{ success: boolean; data: InvoiceDbRecord }>(res);
    return mapDbRecordToInvoice(result.data);
  }

  /**
   * Authoritative API Call: POST /api/invoices (Block 2 - Command 7)
   */
  public static async createInvoice(
    payload: InvoiceClientCreatePayload,
    operationKey?: string,
    authToken?: string
  ): Promise<ServerInvoiceResult> {
    // 1. Validate essential fields
    if (!payload.personId) {
      const err = new Error('شناسه طرف حساب الزامی است.');
      (err as any).status = 400;
      (err as any).code = 'ERR_PERSON_REQUIRED';
      throw err;
    }

    if (!payload.items || payload.items.length === 0) {
      const err = new Error('فاکتور باید حداقل دارای یک ردیف کالا باشد.');
      (err as any).status = 400;
      (err as any).code = 'ERR_EMPTY_ITEMS';
      throw err;
    }

    // 3. Resolve JWT Token
    const token = await this.resolveToken(authToken);

    // 4. Assign or preserve idempotency operation key
    const effectiveOpKey = operationKey || this.generateUuid();

    // 5. Map payload to Server Schema Contract
    const serverPayload = {
      invoiceType: payload.type === 'buy' ? 'BUY' : 'SELL',
      personId: payload.personId,
      personName: payload.personName,
      date: payload.date,
      dateJalali: payload.dateJalali,
      isProInvoice: Boolean(payload.isProInvoice),
      discount: payload.discount || 0,
      taxPercent: payload.taxPercent || 0,
      description: payload.description,
      cashPaidAmount: payload.cashPaidAmount || 0,
      posPaidAmount: payload.posPaidAmount || 0,
      posTerminalId: payload.posTerminalId,
      isInstallmentDeferred: Boolean(payload.isInstallmentDeferred),
      isSettledWithChecks: Boolean(payload.isSettledWithChecks),
      isPaidFromWallet: Boolean(payload.isPaidFromWallet),
      settlementCommission: payload.settlementCommission || 0,
      costCenterId: payload.costCenterId,
      purchaseManagerProfitRate: payload.purchaseManagerProfitRate,
      operationKey: effectiveOpKey,
      branchId: payload.branchId,
      fiscalYearId: payload.fiscalYearId,
      items: payload.items.map(it => ({
        productId: it.productId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: it.discount || 0,
        warehouseId: it.warehouseId,
        costPrice: it.costPrice,
        totalCostPrice: it.totalCostPrice,
        serialNumbers: it.serialNumbers
      }))
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/api/invoices`, {
      method: 'POST',
      headers,
      body: JSON.stringify(serverPayload)
    });

    const json = await response.json();

    if (!response.ok || !json.success) {
      const errorObj: any = new Error(json.message || 'خطا در ثبت فاکتور در سرور');
      errorObj.status = response.status;
      errorObj.code = json.error || 'ERR_INVOICE_FAILED';
      throw errorObj;
    }

    return json.data as ServerInvoiceResult;
  }

  public static async updateInvoice(
    invoiceId: string,
    expectedVersion: number,
    mutationKey: string,
    payload: {
      type: 'buy' | 'sell';
      personId: string;
      personName?: string;
      date?: string;
      dateJalali?: string;
      isProInvoice?: boolean;
      discount?: number;
      taxPercent?: number;
      description?: string;
      cashPaidAmount?: number;
      posPaidAmount?: number;
      posTerminalId?: string;
      isInstallmentDeferred?: boolean;
      isSettledWithChecks?: boolean;
      isPaidFromWallet?: boolean;
      settlementCommission?: number;
      costCenterId?: string;
      purchaseManagerProfitRate?: number;
      branchId?: string;
      fiscalYearId?: string;
      items: Array<{
        productId: string;
        quantity: number;
        unitPrice: number;
        discount?: number;
        warehouseId: string;
        costPrice?: number;
        totalCostPrice?: number;
        serialNumbers?: string[];
      }>;
    },
    operationKey?: string,
    authToken?: string
  ): Promise<ServerInvoiceResult> {
    const token = await this.resolveToken(authToken);

    const serverPayload = {
      expectedVersion,
      mutationKey,
      invoiceType: payload.type === 'buy' ? 'BUY' : 'SELL',
      personId: payload.personId,
      personName: payload.personName,
      date: payload.date,
      dateJalali: payload.dateJalali,
      isProInvoice: Boolean(payload.isProInvoice),
      discount: payload.discount || 0,
      taxPercent: payload.taxPercent || 0,
      description: payload.description,
      cashPaidAmount: payload.cashPaidAmount || 0,
      posPaidAmount: payload.posPaidAmount || 0,
      posTerminalId: payload.posTerminalId,
      isInstallmentDeferred: Boolean(payload.isInstallmentDeferred),
      isSettledWithChecks: Boolean(payload.isSettledWithChecks),
      isPaidFromWallet: Boolean(payload.isPaidFromWallet),
      settlementCommission: payload.settlementCommission || 0,
      costCenterId: payload.costCenterId,
      purchaseManagerProfitRate: payload.purchaseManagerProfitRate,
      items: payload.items.map(it => ({
        productId: it.productId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: it.discount || 0,
        warehouseId: it.warehouseId,
        costPrice: it.costPrice,
        totalCostPrice: it.totalCostPrice,
        serialNumbers: it.serialNumbers
      }))
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/api/invoices/${invoiceId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(serverPayload)
    });

    const json = await response.json();

    if (!response.ok || !json.success) {
      const errorObj: any = new Error(json.message || 'خطا در ویرایش فاکتور در سرور');
      errorObj.status = response.status;
      errorObj.code = json.error || 'ERR_INVOICE_UPDATE_FAILED';
      throw errorObj;
    }

    return json.data as ServerInvoiceResult;
  }

  /**
   * Authoritative API Call: POST /api/invoices/:id/void (Command 12A & Command 22)
   */
  public static async voidInvoice(
    invoiceId: string,
    reason: string = 'ابطال فاکتور',
    token?: string
  ): Promise<{ success: boolean; data: any; message: string }> {
    const authToken = await this.resolveToken(token);
    const res = await fetch(`${this.baseUrl}/api/invoices/${encodeURIComponent(invoiceId)}/void`, {
      method: 'POST',
      headers: this.getHeaders(authToken),
      body: JSON.stringify({ reason })
    });
    return this.handleResponse<{ success: boolean; data: any; message: string }>(res);
  }

  /**
   * Authoritative API Call: DELETE /api/invoices/:id (Command 12A & Command 22)
   */
  public static async deleteProInvoice(
    invoiceId: string,
    token?: string
  ): Promise<{ success: boolean; data: any; message: string }> {
    const authToken = await this.resolveToken(token);
    const res = await fetch(`${this.baseUrl}/api/invoices/${encodeURIComponent(invoiceId)}`, {
      method: 'DELETE',
      headers: this.getHeaders(authToken),
    });
    return this.handleResponse<{ success: boolean; data: any; message: string }>(res);
  }
}

