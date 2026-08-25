/**
 * Centralized, Secure Person Service
 * Handles communication with /api/persons server-side endpoints.
 * Enforces explicit JWT authorization and snake_case <-> camelCase mapping.
 * Protects against database leakage, raw bank storage, and concurrent overwrites.
 */

import { Person, PersonStatusType, PersonRoleType } from '../types';
import { getDefaultAuthSessionService } from './authSessionService';

export interface PersonApiError {
  status: number;
  code: string;
  message: string;
}

export interface PersonAgentDetailsRecord {
  id?: string;
  organization_id?: string;
  person_id: string;
  store_name?: string | null;
  store_address?: string | null;
  storeName?: string | null;
  storeAddress?: string | null;
  payment_term_days?: number | null;
  paymentTermDays?: number | null;
  late_fee_percentage?: number | null;
  lateFeePercentage?: number | null;
  is_purchase_allowed?: boolean | null;
  isPurchaseAllowed?: boolean | null;
  contract_notes?: string | null;
  contractNotes?: string | null;
  created_by?: string | null;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface PersonDbRecord {
  id: string;
  organization_id?: string;
  branch_id?: string;
  code: string;
  name: string;
  person_type: 'real' | 'legal';
  national_id?: string | null;
  mobile?: string | null;
  phone?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
  father_name?: string | null;
  birth_date?: string | null;
  company_name?: string | null;
  status: 'draft' | 'active' | 'inactive' | 'blocked';
  role: 'debtor' | 'creditor' | 'both';
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  postal_code?: string | null;
  bank_name?: string | null;
  account_holder_name?: string | null;
  card_number_masked?: string | null;
  sheba_number_masked?: string | null;
  account_number_masked?: string | null;
  credit_limit?: number;
  credit_score?: number;
  penalty_rate?: number;
  allowed_delay_days?: number;
  is_offline_wholesale_enabled?: boolean;
  is_installment_enabled?: boolean;
  is_documents_approved?: boolean;
  is_agent?: boolean;
  agency_role?: string | null;
  agency_status?: string | null;
  agency_credit_limit?: number | null;
  owner_user_id?: string | null;
  agent_details?: PersonAgentDetailsRecord | null;
  person_agent_details?: PersonAgentDetailsRecord | PersonAgentDetailsRecord[] | null;
  internal_notes?: string | null;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Transforms a server snake_case record to a client Person model
 */
export function mapDbRecordToPerson(record: PersonDbRecord): Person {
  const details = record.agent_details || (Array.isArray(record.person_agent_details) ? record.person_agent_details[0] : record.person_agent_details);

  return {
    id: record.id,
    code: record.code,
    name: record.name,
    nationalId: record.national_id || undefined,
    mobile: record.mobile || undefined,
    phone: record.phone || undefined,
    personType: record.person_type || 'real',
    gender: record.gender || undefined,
    fatherName: record.father_name || undefined,
    birthDate: record.birth_date || undefined,
    companyName: record.company_name || undefined,
    status: (record.status === 'draft' ? 'active' : record.status) as PersonStatusType,
    role: record.role || 'both',
    province: record.province || undefined,
    city: record.city || undefined,
    district: record.district || undefined,
    address: record.address || undefined,
    postalCode: record.postal_code || undefined,
    bankName: record.bank_name || undefined,
    accountHolderName: record.account_holder_name || undefined,
    cardNumber: record.card_number_masked || undefined,
    shebaNumber: record.sheba_number_masked || undefined,
    creditLimit: record.credit_limit || 0,
    creditScore: record.credit_score || 0,
    isAgent: Boolean(record.is_agent),
    agencyRole: record.agency_role || undefined,
    agencyStatus: record.agency_status || undefined,
    agencyCreditLimit: record.agency_credit_limit !== undefined && record.agency_credit_limit !== null ? Number(record.agency_credit_limit) : undefined,
    isDocumentsApproved: Boolean(record.is_documents_approved),
    ownerUserId: record.owner_user_id || undefined,
    agentDetails: details ? {
      storeName: details.store_name || details.storeName || '',
      storeAddress: details.store_address || details.storeAddress || '',
      guarantors: [],
      guaranteeChecks: [],
    } : undefined,
    internalNotes: record.internal_notes || undefined,
    createdAt: record.created_at || new Date().toISOString(),
    updatedAt: record.updated_at,
  };
}

/**
 * Transforms client Person model to API payload
 */
export function mapPersonToApiPayload(person: Partial<Person>, expectedVersion?: number): any {
  const payload: any = {};

  if (person.id) payload.id = person.id;
  if (person.code) payload.code = String(person.code).trim();
  if (person.name) payload.name = String(person.name).trim();
  if (person.personType) payload.person_type = person.personType;
  if (person.nationalId !== undefined) payload.national_id = person.nationalId ? String(person.nationalId).trim() : null;
  if (person.mobile !== undefined) payload.mobile = person.mobile ? String(person.mobile).trim() : null;
  if (person.phone !== undefined) payload.phone = person.phone ? String(person.phone).trim() : null;
  if (person.gender !== undefined) payload.gender = person.gender || null;
  if (person.fatherName !== undefined) payload.father_name = person.fatherName ? String(person.fatherName).trim() : null;
  if (person.birthDate !== undefined) payload.birth_date = person.birthDate || null;
  if (person.companyName !== undefined) payload.company_name = person.companyName ? String(person.companyName).trim() : null;
  if (person.status) payload.status = person.status;
  if (person.role) payload.role = person.role;
  if (person.province !== undefined) payload.province = person.province ? String(person.province).trim() : null;
  if (person.city !== undefined) payload.city = person.city ? String(person.city).trim() : null;
  if (person.district !== undefined) payload.district = person.district ? String(person.district).trim() : null;
  if (person.address !== undefined) payload.address = person.address ? String(person.address).trim() : null;
  if (person.postalCode !== undefined) payload.postal_code = person.postalCode ? String(person.postalCode).trim() : null;
  if (person.bankName !== undefined) payload.bank_name = person.bankName ? String(person.bankName).trim() : null;
  if (person.accountHolderName !== undefined) payload.account_holder_name = person.accountHolderName ? String(person.accountHolderName).trim() : null;
  if (person.creditLimit !== undefined) payload.credit_limit = Number(person.creditLimit) || 0;
  if (person.creditScore !== undefined) payload.credit_score = Number(person.creditScore) || 0;
  if (person.isAgent !== undefined) payload.is_agent = Boolean(person.isAgent);
  if (person.agencyRole !== undefined) payload.agency_role = person.agencyRole ? String(person.agencyRole).trim() : null;
  if ((person as any).agency_role !== undefined) payload.agency_role = (person as any).agency_role ? String((person as any).agency_role).trim() : null;
  if (person.agencyStatus !== undefined) payload.agency_status = person.agencyStatus ? String(person.agencyStatus).trim() : null;
  if ((person as any).agency_status !== undefined) payload.agency_status = (person as any).agency_status ? String((person as any).agency_status).trim() : null;
  if (person.agencyCreditLimit !== undefined) payload.agency_credit_limit = Number(person.agencyCreditLimit) || 0;
  if ((person as any).agency_credit_limit !== undefined) payload.agency_credit_limit = Number((person as any).agency_credit_limit) || 0;
  if (person.isDocumentsApproved !== undefined) payload.is_documents_approved = Boolean(person.isDocumentsApproved);
  if (person.internalNotes !== undefined) payload.internal_notes = person.internalNotes ? String(person.internalNotes).trim() : null;

  if (expectedVersion !== undefined) {
    payload.expected_version = expectedVersion;
  }

  return payload;
}

export class PersonService {
  private static baseUrl = '';

  public static setBaseUrl(url: string) {
    this.baseUrl = url;
  }

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

  private static getHeaders(token?: string): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private static async handleResponse<T>(res: Response): Promise<T> {
    const contentType = res.headers.get('content-type') || '';
    let body: any = null;
    if (contentType.includes('application/json')) {
      try {
        body = await res.json();
      } catch (e) {}
    }

    if (!res.ok) {
      const serverMessage = body?.message || body?.error;
      const error: PersonApiError = {
        status: res.status,
        code: body?.code || body?.error || `ERR_HTTP_${res.status}`,
        message: serverMessage || 'خطا در ارتباط با سرویس اشخاص.'
      };

      if (res.status === 401) {
        error.message = body?.message || 'نشست کاری شما منقضی شده است. لطفاً مجدداً وارد شوید.';
      } else if (res.status === 403) {
        error.message = body?.message || 'شما دسترسی لازم برای این عملیات را ندارید.';
      } else if (res.status === 404) {
        error.message = body?.message || 'شخص مورد نظر در سازمان یافت نشد.';
      } else if (res.status === 409) {
        error.message = body?.message || 'تعارض در نسخه اطلاعات یا تکراری بودن کد شخص.';
      } else if (res.status === 503) {
        error.message = body?.message || 'سرویس پایگاه‌داده موقتاً در دسترس نیست.';
      }

      throw error;
    }

    return body as T;
  }

  /**
   * Fetch all persons for authenticated user's active organization
   */
  static async getPersons(token?: string, includeInactive: boolean = false): Promise<Person[]> {
    const authToken = await this.resolveToken(token);
    const query = includeInactive ? '?includeInactive=true' : '';
    const res = await fetch(`${this.baseUrl}/api/persons${query}`, {
      method: 'GET',
      headers: this.getHeaders(authToken),
    });
    const result = await this.handleResponse<{ success: boolean; data: PersonDbRecord[] }>(res);
    return (result.data || []).map(mapDbRecordToPerson);
  }

  /**
   * Alias for getPersons
   */
  static async listPersons(token?: string, includeInactive: boolean = false): Promise<Person[]> {
    return this.getPersons(token, includeInactive);
  }

  /**
   * Get single person by UUID
   */
  static async getPersonById(id: string, token?: string): Promise<Person> {
    const authToken = await this.resolveToken(token);
    const res = await fetch(`${this.baseUrl}/api/persons/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: this.getHeaders(authToken),
    });
    const result = await this.handleResponse<{ success: boolean; data: PersonDbRecord }>(res);
    return mapDbRecordToPerson(result.data);
  }

  /**
   * Create a new Person record
   */
  static async createPerson(person: Partial<Person>, token?: string): Promise<Person> {
    const authToken = await this.resolveToken(token);
    const payload = mapPersonToApiPayload(person);
    const res = await fetch(`${this.baseUrl}/api/persons`, {
      method: 'POST',
      headers: this.getHeaders(authToken),
      body: JSON.stringify(payload),
    });
    const result = await this.handleResponse<{
      success: boolean;
      data: PersonDbRecord;
      generatedPassword?: string;
      loginIdentifier?: string;
    }>(res);
    const mapped = mapDbRecordToPerson(result.data);
    if (result.generatedPassword) {
      mapped.generatedPassword = result.generatedPassword;
      mapped.loginIdentifier = result.loginIdentifier;
    }
    return mapped;
  }

  /**
   * Update an existing Person record with optimistic concurrency protection
   */
  static async updatePerson(
    id: string,
    person: Partial<Person>,
    token?: string,
    expectedVersion?: number
  ): Promise<Person> {
    const authToken = await this.resolveToken(token);
    const payload = mapPersonToApiPayload(person, expectedVersion);
    const res = await fetch(`${this.baseUrl}/api/persons/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.getHeaders(authToken),
      body: JSON.stringify(payload),
    });
    const result = await this.handleResponse<{
      success: boolean;
      data: PersonDbRecord;
      generatedPassword?: string;
      loginIdentifier?: string;
    }>(res);
    const mapped = mapDbRecordToPerson(result.data);
    if (result.generatedPassword) {
      mapped.generatedPassword = result.generatedPassword;
      mapped.loginIdentifier = result.loginIdentifier;
    }
    return mapped;
  }

  /**
   * Soft deactivate a person record
   */
  static async deactivatePerson(id: string, token?: string): Promise<Person> {
    const authToken = await this.resolveToken(token);
    const res = await fetch(`${this.baseUrl}/api/persons/${encodeURIComponent(id)}/deactivate`, {
      method: 'POST',
      headers: this.getHeaders(authToken),
    });
    const result = await this.handleResponse<{ success: boolean; data: PersonDbRecord }>(res);
    return mapDbRecordToPerson(result.data);
  }

  /**
   * Get agent details (store_name, store_address) for a specific person
   */
  static async getAgentDetails(personId: string, token?: string): Promise<PersonAgentDetailsRecord | null> {
    const authToken = await this.resolveToken(token);
    const res = await fetch(`${this.baseUrl}/api/persons/${encodeURIComponent(personId)}/agent-details`, {
      method: 'GET',
      headers: this.getHeaders(authToken),
    });
    const result = await this.handleResponse<{ success: boolean; data: PersonAgentDetailsRecord | null }>(res);
    if (!result.data) return null;
    const storeName = result.data.store_name || result.data.storeName || '';
    const storeAddress = result.data.store_address || result.data.storeAddress || '';
    return {
      ...result.data,
      storeName,
      storeAddress,
      store_name: storeName,
      store_address: storeAddress,
    };
  }

  /**
   * Upsert agent details (store_name, store_address, contract rules) for a specific person
   */
  static async updateAgentDetails(
    personId: string,
    data: {
      storeName?: string | null;
      storeAddress?: string | null;
      store_name?: string | null;
      store_address?: string | null;
      paymentTermDays?: number | null;
      payment_term_days?: number | null;
      lateFeePercentage?: number | null;
      late_fee_percentage?: number | null;
      isPurchaseAllowed?: boolean | null;
      is_purchase_allowed?: boolean | null;
      contractNotes?: string | null;
      contract_notes?: string | null;
    },
    token?: string
  ): Promise<PersonAgentDetailsRecord> {
    const authToken = await this.resolveToken(token);
    const payload: any = {};
    if (data.store_name !== undefined || data.storeName !== undefined) {
      payload.store_name = data.store_name !== undefined ? data.store_name : data.storeName;
    }
    if (data.store_address !== undefined || data.storeAddress !== undefined) {
      payload.store_address = data.store_address !== undefined ? data.store_address : data.storeAddress;
    }
    if (data.payment_term_days !== undefined || data.paymentTermDays !== undefined) {
      payload.payment_term_days = data.payment_term_days !== undefined ? data.payment_term_days : data.paymentTermDays;
    }
    if (data.late_fee_percentage !== undefined || data.lateFeePercentage !== undefined) {
      payload.late_fee_percentage = data.late_fee_percentage !== undefined ? data.late_fee_percentage : data.lateFeePercentage;
    }
    if (data.is_purchase_allowed !== undefined || data.isPurchaseAllowed !== undefined) {
      payload.is_purchase_allowed = data.is_purchase_allowed !== undefined ? data.is_purchase_allowed : data.isPurchaseAllowed;
    }
    if (data.contract_notes !== undefined || data.contractNotes !== undefined) {
      payload.contract_notes = data.contract_notes !== undefined ? data.contract_notes : data.contractNotes;
    }
    const res = await fetch(`${this.baseUrl}/api/persons/${encodeURIComponent(personId)}/agent-details`, {
      method: 'PUT',
      headers: this.getHeaders(authToken),
      body: JSON.stringify(payload),
    });
    const result = await this.handleResponse<{ success: boolean; data: PersonAgentDetailsRecord }>(res);
    return result.data;
  }

  /**
   * Get the current authenticated user's agent profile
   */
  static async getMyAgentProfile(token?: string): Promise<Person | null> {
    const authToken = await this.resolveToken(token);
    const res = await fetch(`${this.baseUrl}/api/persons/me/agent-profile`, {
      headers: this.getHeaders(authToken),
    });
    const result = await this.handleResponse<{ success: boolean; data: PersonDbRecord | null }>(res);
    if (!result.data) return null;
    return mapDbRecordToPerson(result.data);
  }

  /**
   * Get the next available unique person code from the server
   */
  static async getNextPersonCode(token?: string): Promise<string> {
    const authToken = await this.resolveToken(token);
    const res = await fetch(`${this.baseUrl}/api/persons/next-code`, {
      headers: this.getHeaders(authToken),
    });
    const result = await this.handleResponse<{ success: boolean; nextCode: string }>(res);
    return result.nextCode || 'P1001';
  }

  /**
   * Reset password for an existing agent user account
   */
  static async resetAgentPassword(
    personId: string,
    token?: string
  ): Promise<{ success: boolean; generatedPassword: string; loginIdentifier: string; name: string }> {
    const authToken = await this.resolveToken(token);
    const res = await fetch(`${this.baseUrl}/api/persons/${encodeURIComponent(personId)}/reset-agent-password`, {
      method: 'POST',
      headers: this.getHeaders(authToken),
    });
    const result = await this.handleResponse<{
      success: boolean;
      generatedPassword?: string;
      loginIdentifier?: string;
      name?: string;
      data?: { generatedPassword?: string; loginIdentifier?: string; name?: string };
    }>(res);
    return {
      success: result.success,
      generatedPassword: result.generatedPassword || result.data?.generatedPassword || '',
      loginIdentifier: result.loginIdentifier || result.data?.loginIdentifier || '',
      name: result.name || result.data?.name || '',
    };
  }
}
