import { BusinessPartner, PartnerCreditRequest, CreditPolicy, CreditFile } from '../types';
import { authenticatedFetch } from './authenticatedRequestService';

export class CreditPartnerService {
  /**
   * Fetch business partners / credit agents for the current organization from server
   */
  static async getBusinessPartners(): Promise<BusinessPartner[]> {
    const res = await authenticatedFetch('/api/business-partners');
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در دریافت لیست نمایندگان');
    }
    const data = await res.json();
    return data.businessPartners || [];
  }

  /**
   * Create or save a business partner
   */
  static async saveBusinessPartner(bp: BusinessPartner, operationKey?: string): Promise<BusinessPartner> {
    const method = bp.id ? 'PUT' : 'POST';
    const url = bp.id ? `/api/business-partners/${bp.id}` : '/api/business-partners';
    const res = await authenticatedFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...bp, operationKey: operationKey || (bp as any).operationKey })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در ثبت اطلاعات نماینده');
    }
    const data = await res.json();
    return data.businessPartner;
  }

  /**
   * Fetch partner credit requests from server
   */
  static async getPartnerCreditRequests(): Promise<PartnerCreditRequest[]> {
    const res = await authenticatedFetch('/api/partner-credit-requests');
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در دریافت درخواست‌های اعتبار نمایندگان');
    }
    const data = await res.json();
    return data.partnerCreditRequests || [];
  }

  /**
   * Save (create or update) a partner credit request
   */
  static async savePartnerCreditRequest(req: PartnerCreditRequest, operationKey?: string): Promise<PartnerCreditRequest> {
    const isUpdate = Boolean(req.id);
    const method = isUpdate ? 'PUT' : 'POST';
    const url = isUpdate ? `/api/partner-credit-requests/${req.id}` : '/api/partner-credit-requests';
    const res = await authenticatedFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req, operationKey: operationKey || (req as any).operationKey })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در ثبت درخواست اعتبار');
    }
    const data = await res.json();
    return data.partnerCreditRequest;
  }

  /**
   * Fetch credit policies from server
   */
  static async getCreditPolicies(): Promise<CreditPolicy[]> {
    const res = await authenticatedFetch('/api/credit-policies');
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در دریافت سیاست‌های اعتباری');
    }
    const data = await res.json();
    return data.creditPolicies || [];
  }

  /**
   * Save (create or update) credit policies
   */
  static async saveCreditPolicies(policies: CreditPolicy[], operationKey?: string): Promise<CreditPolicy[]> {
    const res = await authenticatedFetch('/api/credit-policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creditPolicies: policies, operationKey })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در ثبت سیاست‌های اعتباری');
    }
    const data = await res.json();
    return data.creditPolicies || [];
  }

  /**
   * Fetch credit files from server
   */
  static async getCreditFiles(): Promise<CreditFile[]> {
    const res = await authenticatedFetch('/api/credit-files');
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در دریافت پرونده‌های اعتباری');
    }
    const data = await res.json();
    return data.creditFiles || [];
  }

  /**
   * Create a new credit file on server
   */
  static async createCreditFile(file: CreditFile, operationKey?: string): Promise<CreditFile> {
    const res = await authenticatedFetch('/api/credit-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...file, operationKey: operationKey || (file as any).operationKey })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در ایجاد پرونده اعتباری');
    }
    const data = await res.json();
    return data.creditFile;
  }

  /**
   * Update an existing credit file on server
   */
  static async updateCreditFile(id: string, file: Partial<CreditFile>, operationKey?: string): Promise<CreditFile> {
    const res = await authenticatedFetch(`/api/credit-files/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...file, operationKey: operationKey || (file as any).operationKey })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در به‌روزرسانی پرونده اعتباری');
    }
    const data = await res.json();
    return data.creditFile;
  }

  /**
   * Delete or soft-cancel a credit file on server
   */
  static async deleteCreditFile(id: string, reason?: string): Promise<void> {
    const res = await authenticatedFetch(`/api/credit-files/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletionReason: reason, cancellationReason: reason })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || errData.message || 'خطا در حذف یا لغو پرونده اعتباری');
    }
  }

  /**
   * Get active documents for a credit file from relational table
   */
  static async getCreditFileDocuments(fileId: string): Promise<any[]> {
    const res = await authenticatedFetch(`/api/credit-files/${fileId}/documents`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در دریافت مدارک پرونده اعتباری');
    }
    const data = await res.json();
    return data.documents || [];
  }

  /**
   * Upload / attach a document to credit file storing metadata in relational table
   */
  static async uploadCreditFileDocument(
    fileId: string, 
    docData: { documentType: string; originalName: string; mimeType?: string; sizeBytes?: number; file?: File | Blob; fileData?: any }, 
    operationKey?: string
  ): Promise<any> {
    if (docData.file instanceof File || docData.file instanceof Blob) {
      const formData = new FormData();
      const filename = docData.originalName || (docData.file instanceof File ? docData.file.name : 'file');
      formData.append('file', docData.file, filename);
      formData.append('documentType', docData.documentType);
      formData.append('originalName', filename);
      if (operationKey) formData.append('operationKey', operationKey);

      const res = await authenticatedFetch(`/api/credit-files/${fileId}/documents`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || 'خطا در بارگذاری مدرک پرونده اعتباری');
      }
      const data = await res.json();
      return data.document;
    } else {
      const res = await authenticatedFetch(`/api/credit-files/${fileId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...docData, operationKey })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || 'خطا در بارگذاری مدرک پرونده اعتباری');
      }
      const data = await res.json();
      return data.document;
    }
  }

  /**
   * Soft remove a document from credit file (sets status = REMOVED)
   */
  static async removeCreditFileDocument(fileId: string, docId: string, reason?: string): Promise<void> {
    const res = await authenticatedFetch(`/api/credit-files/${fileId}/documents/${docId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'خطا در حذف مدرک پرونده اعتباری');
    }
  }
}
