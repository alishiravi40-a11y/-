/**
 * Centralized Authoritative Voucher Service (Block 2 - Command 10)
 * Handles client communication with /api/vouchers server-side read endpoints.
 * Enforces explicit JWT authorization and mapping from PostgreSQL schema to client JournalVoucher model.
 */

import { JournalVoucher, VoucherEntry } from '../types';
import { getDefaultAuthSessionService } from './authSessionService';

export interface VoucherEntryDbRecord {
  id: string;
  organization_id: string;
  voucher_id: string;
  row_number: number;
  subsidiary_id: string;
  person_id?: string | null;
  cost_center_id?: string | null;
  financial_role_code?: string | null;
  debit: number | string;
  credit: number | string;
  description?: string | null;
  contract_type?: string | null;
  created_at?: string;
}

export interface JournalVoucherDbRecord {
  id: string;
  organization_id: string;
  branch_id?: string | null;
  fiscal_year_id?: string | null;
  voucher_number?: number | string | null;
  voucher_date: string;
  description: string;
  status: 'DRAFT' | 'POSTED' | 'REVERSED' | 'CANCELLED';
  voucher_kind?: string;
  is_automatic?: boolean;
  source_type?: string | null;
  source_id?: string | null;
  source_event_key?: string | null;
  contract_type?: string | null;
  reversal_of_voucher_id?: string | null;
  version?: number;
  created_by?: string | null;
  created_at: string;
  updated_at?: string;
  posted_by?: string | null;
  posted_at?: string | null;
  reversed_by?: string | null;
  reversed_at?: string | null;
  reversal_reason?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  voucher_entries?: VoucherEntryDbRecord[];
}

export function mapDbRecordToJournalVoucher(record: JournalVoucherDbRecord): JournalVoucher {
  const sortedEntries = (record.voucher_entries || []).sort((a, b) => (a.row_number || 0) - (b.row_number || 0));

  const entries: VoucherEntry[] = sortedEntries.map(e => ({
    subsidiaryId: e.subsidiary_id,
    debit: Number(e.debit) || 0,
    credit: Number(e.credit) || 0,
    description: e.description || undefined,
    contractType: e.contract_type || undefined,
    floatingDetailed: e.person_id ? {
      type: 'person',
      id: e.person_id,
      name: ''
    } : undefined
  }));

  let clientStatus: 'active' | 'voided' | 'draft' = 'active';
  if (record.status === 'REVERSED' || record.status === 'CANCELLED') {
    clientStatus = 'voided';
  } else if (record.status === 'DRAFT') {
    clientStatus = 'draft';
  }

  let sourceType: JournalVoucher['sourceType'] = 'manual';
  if (record.source_type) {
    sourceType = record.source_type as any;
  }

  return {
    id: record.id,
    voucherNumber: Number(record.voucher_number) || 0,
    date: record.voucher_date,
    gregorianDate: record.voucher_date,
    description: record.description || '',
    entries,
    isAutomatic: !!record.is_automatic,
    sourceType,
    sourceId: record.source_id || undefined,
    createdBy: record.created_by || undefined,
    branchId: record.branch_id || undefined,
    organizationId: record.organization_id,
    contractType: record.contract_type || undefined,
    status: clientStatus,
    voidedAt: record.cancelled_at || record.reversed_at || undefined,
    voidedBy: record.cancelled_by || record.reversed_by || undefined,
    voidReason: record.cancellation_reason || record.reversal_reason || undefined,
    reversalVoucherId: record.reversal_of_voucher_id || undefined
  };
}

export const VoucherService = {
  async getVouchers(): Promise<JournalVoucher[]> {
    const token = await getDefaultAuthSessionService().getAccessToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch('/api/vouchers', {
      method: 'GET',
      headers,
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.message || json.error || 'Failed to fetch vouchers from server');
    }

    const records: JournalVoucherDbRecord[] = json.data || [];
    return records.map(mapDbRecordToJournalVoucher);
  },

  async getVoucherById(id: string): Promise<JournalVoucher | null> {
    const token = await getDefaultAuthSessionService().getAccessToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`/api/vouchers/${id}`, {
      method: 'GET',
      headers,
    });

    const json = await res.json();
    if (res.status === 404) {
      return null;
    }
    if (!res.ok || !json.success) {
      throw new Error(json.message || json.error || 'Failed to fetch voucher by ID');
    }

    return json.data ? mapDbRecordToJournalVoucher(json.data) : null;
  },

  normalizeError(err: any): { error: string; message: string } {
    if (err instanceof Error) {
      return { error: 'ERR_VOUCHER_SERVICE', message: err.message };
    }
    return { error: 'ERR_UNKNOWN', message: String(err || 'خطای ناشناخته') };
  }
};
