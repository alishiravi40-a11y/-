import { AuthenticatedRequestService } from "./authenticatedRequestService";
import { getDefaultAuthSessionService } from "./authSessionService";

export interface CreateInstallmentBookPayload {
  branchId?: string;
  personId: string;
  originType?: "INVOICE" | "PARTNER_CREDIT" | "OPENING_BALANCE";
  invoiceId?: string;
  creditFileId?: string;
  calculatorId?: string;
  totalPrincipal: number;
  totalInterest: number;
  totalAmount: number;
  installmentCount: number;
  startDate?: string;
  intervalDays?: number;
  installments: Array<{
    installmentNumber: number;
    dueDate: string;
    amount: number;
    principalPart?: number;
    interestPart?: number;
  }>;
  operationKey?: string;
}

export interface SettleInstallmentPayload {
  branchId?: string;
  fiscalYearId?: string;
  personId: string;
  installmentIds: string[];
  amount: number;
  paymentMethod?: "CASH" | "POS" | "TRANSFER" | "CHEQUE" | "OTHER";
  paymentDate?: string;
  bankOrCashSubId?: string;
  posTerminalId?: string;
  description?: string;
  operationKey?: string;
}

export class InstallmentService {
  private static requestService = new AuthenticatedRequestService(getDefaultAuthSessionService());

  /**
   * Fetches all server-authoritative installment booklets and line items.
   */
  public static async getInstallmentBooks(): Promise<any[]> {
    const response = await this.requestService.fetch("/api/installments/books", {
      method: "GET",
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      const err = new Error(result.message || result.error || "خطا در دریافت دفترچه‌های اقساط از سرور");
      (err as any).code = result.error || "ERR_FETCH_BOOKS_FAILED";
      throw err;
    }

    return result.books || [];
  }

  /**
   * Creates an installment booklet atomically on the server.
   */
  public static async createInstallmentBook(payload: CreateInstallmentBookPayload): Promise<any> {
    const response = await this.requestService.fetch("/api/installments/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      const err = new Error(result.message || result.error || "خطا در ایجاد دفترچه اقساط");
      (err as any).code = result.error || "ERR_INSTALLMENT_BOOK_FAILED";
      throw err;
    }

    return result.data;
  }

  /**
   * Settles an installment line item atomically on the server with double-entry voucher generation.
   */
  public static async settleInstallment(payload: SettleInstallmentPayload): Promise<any> {
    const response = await this.requestService.fetch("/api/installments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      const err = new Error(result.message || result.error || "خطا در تسویه قسط");
      (err as any).code = result.error || "ERR_SETTLE_INSTALLMENT_FAILED";
      throw err;
    }

    return result.data;
  }
}
