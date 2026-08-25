import { Check } from "../types";
import { getDefaultAuthSessionService } from "./authSessionService";

export interface ClientChequePayload {
  chequeType: "received" | "paid";
  currentState?: string;
  personId?: string;
  invoiceId?: string;
  installmentBookId?: string;
  investorId?: string;
  checkNumber: string;
  sayadiIdentifier?: string;
  amount: number;
  bankName?: string;
  branchName?: string;
  accountNumber?: string;
  issueDate?: string;
  dueDate?: string;
  receivedDate?: string;
  clearanceDate?: string;
  returnDate?: string;
  description?: string;
  branchId?: string;
  fiscalYearId?: string;
  operationKey?: string;
  legacyId?: string;
}

export interface ClientTransitionPayload {
  toState: string;
  expectedVersion: number;
  mutationKey?: string;
  bankSubId?: string;
  endorsedPersonId?: string;
  description?: string;
  fiscalYearId?: string;
}

export interface ClientEditPayload {
  expectedVersion: number;
  mutationKey?: string;
  checkNumber?: string;
  dueDate?: string;
  bankName?: string;
  personId?: string;
  sayadiIdentifier?: string;
  branchName?: string;
  accountNumber?: string;
  issueDate?: string;
  description?: string;
}

export interface ClientReversalPayload {
  expectedVersion: number;
  mutationKey?: string;
  description?: string;
}

export function mapDbRecordToCheck(record: any): Check {
  return {
    id: record.id,
    type: record.cheque_type,
    voucherId: record.journal_voucher_id || undefined,
    checkNumber: record.check_number,
    sayadiNumber: record.sayadi_identifier || undefined,
    bankName: record.bank_name || 'نامشخص',
    dueDate: record.due_date || '',
    amount: Number(record.amount) || 0,
    personId: record.person_id || '',
    invoiceId: record.invoice_id || undefined,
    installmentBookId: record.installment_book_id || undefined,
    investorId: record.investor_id || undefined,
    currentState: record.current_state,
    version: record.version || 1,
    legacyId: record.legacy_id || undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    history: record.cheque_state_history ? record.cheque_state_history.map((h: any) => ({
      state: h.to_state,
      date: h.performed_at ? new Date(h.performed_at).toLocaleDateString('fa-IR') : '',
      voucherId: h.journal_voucher_id || undefined
    })) : [
      {
        state: record.current_state,
        date: record.created_at ? new Date(record.created_at).toLocaleDateString('fa-IR') : '',
        voucherId: record.journal_voucher_id || undefined
      }
    ]
  };
}

export class ChequeClientService {
  private static async resolveToken(token?: string): Promise<string | undefined> {
    if (token) return token;
    try {
      const activeToken = await getDefaultAuthSessionService().getAccessToken();
      if (activeToken) return activeToken;
    } catch {}
    return undefined;
  }

  private static async getHeaders(token?: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const authToken = await this.resolveToken(token);
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }
    return headers;
  }

  static async createCheque(payload: ClientChequePayload, token?: string) {
    const headers = await this.getHeaders(token);
    const response = await fetch("/api/cheques", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || json.error || "خطا در ثبت چک.");
    }
    return json.data;
  }

  static async getCheques(filters?: { chequeType?: string; currentState?: string; personId?: string }, token?: string): Promise<Check[]> {
    const headers = await this.getHeaders(token);
    let url = "/api/cheques";
    const params = new URLSearchParams();
    if (filters?.chequeType) params.append("chequeType", filters.chequeType);
    if (filters?.currentState) params.append("currentState", filters.currentState);
    if (filters?.personId) params.append("personId", filters.personId);
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, { headers });
    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || json.error || "خطا در دریافت لیست چک‌ها.");
    }
    const rawList = json.data || [];
    return rawList.map((r: any) => mapDbRecordToCheck(r));
  }

  static async getChequeById(id: string, token?: string): Promise<Check> {
    const headers = await this.getHeaders(token);
    const response = await fetch(`/api/cheques/${id}`, { headers });
    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || json.error || "خطا در دریافت اطلاعات چک.");
    }
    return mapDbRecordToCheck(json.data);
  }

  static async transitionCheque(id: string, payload: ClientTransitionPayload, token?: string) {
    const headers = await this.getHeaders(token);
    const response = await fetch(`/api/cheques/${id}/transition`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || json.error || "خطا در تغییر وضعیت چک.");
    }
    return json.data;
  }

  static async editCheque(id: string, payload: ClientEditPayload, token?: string) {
    const headers = await this.getHeaders(token);
    const response = await fetch(`/api/cheques/${id}/edit`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || json.error || "خطا در ویرایش چک.");
    }
    return json.data;
  }

  static async reverseCheque(id: string, payload: ClientReversalPayload, token?: string) {
    const headers = await this.getHeaders(token);
    const response = await fetch(`/api/cheques/${id}/reverse`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || json.error || "خطا در ابطال/اصلاح سند چک.");
    }
    return json.data;
  }

  static async deleteCheque(id: string, expectedVersion: number, token?: string) {
    const headers = await this.getHeaders(token);
    const response = await fetch(`/api/cheques/${id}?expectedVersion=${expectedVersion}`, {
      method: "DELETE",
      headers,
    });

    const json = await response.json();
    if (!response.ok || !json.success) {
      throw new Error(json.message || json.error || "خطا در حذف چک.");
    }
    return json.data;
  }
}

// Backward-compatible standalone exports
export async function createCheque(payload: ClientChequePayload, token?: string) {
  return ChequeClientService.createCheque(payload, token);
}

export async function transitionCheque(id: string, payload: ClientTransitionPayload, token?: string) {
  return ChequeClientService.transitionCheque(id, payload, token);
}

export async function editCheque(id: string, payload: ClientEditPayload, token?: string) {
  return ChequeClientService.editCheque(id, payload, token);
}

export async function reverseCheque(id: string, payload: ClientReversalPayload, token?: string) {
  return ChequeClientService.reverseCheque(id, payload, token);
}

export async function deleteCheque(id: string, expectedVersion: number, token?: string) {
  return ChequeClientService.deleteCheque(id, expectedVersion, token);
}

export async function getCheques(filters?: { chequeType?: string; currentState?: string; personId?: string }, token?: string): Promise<Check[]> {
  return ChequeClientService.getCheques(filters, token);
}

export async function getChequeById(id: string, token?: string): Promise<Check> {
  return ChequeClientService.getChequeById(id, token);
}
