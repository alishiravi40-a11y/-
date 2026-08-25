import { SupabaseClient } from '@supabase/supabase-js';

export interface PostVoucherParams {
  organizationId: string;
  voucherId: string;
  expectedVersion: number;
  operationKey: string;
  requestFingerprint: string;
}

export interface ReverseVoucherParams {
  organizationId: string;
  originalVoucherId: string;
  reversalFiscalYearId: string;
  reversalDate: string;
  reversalReason: string;
  expectedVersion: number;
  operationKey: string;
  requestFingerprint: string;
}

export interface CancelDraftVoucherParams {
  organizationId: string;
  voucherId: string;
  cancellationReason: string;
  expectedVersion: number;
  operationKey: string;
  requestFingerprint: string;
}

export interface CreateDraftVoucherParams {
  organizationId: string;
  branchId: string;
  fiscalYearId: string;
  voucherDate: string;
  description: string;
  entries: Array<{
    rowNumber: number;
    subsidiaryId: string;
    personId?: string | null;
    costCenterId?: string | null;
    debit: number;
    credit: number;
    description?: string | null;
    financialRoleCode?: string | null;
    contractType?: string | null;
  }>;
  operationKey: string;
  requestFingerprint: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceEventKey?: string | null;
}

/**
 * Isolated RPC service gateway for Journal Vouchers.
 * Strictly calls underlying Migration 05 PostgreSQL RPC functions.
 * NO direct table inserts, updates, or deletes are performed here.
 */
export class JournalVoucherRpcService {
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  /**
   * Calls post_journal_voucher RPC to atomically post a DRAFT voucher.
   */
  async postVoucher(params: PostVoucherParams): Promise<number> {
    const { data, error } = await this.client.rpc('post_journal_voucher', {
      p_organization_id: params.organizationId,
      p_voucher_id: params.voucherId,
      p_expected_version: params.expectedVersion,
      p_operation_key: params.operationKey,
      p_request_fingerprint: params.requestFingerprint,
    });

    if (error) {
      throw new Error(`Failed to post journal voucher: ${error.message}`);
    }

    return Number(data);
  }

  /**
   * Calls reverse_journal_voucher RPC to reverse a POSTED voucher.
   */
  async reverseVoucher(params: ReverseVoucherParams): Promise<string> {
    const { data, error } = await this.client.rpc('reverse_journal_voucher', {
      p_organization_id: params.organizationId,
      p_original_voucher_id: params.originalVoucherId,
      p_reversal_fiscal_year_id: params.reversalFiscalYearId,
      p_reversal_date: params.reversalDate,
      p_reversal_reason: params.reversalReason,
      p_expected_version: params.expectedVersion,
      p_operation_key: params.operationKey,
      p_request_fingerprint: params.requestFingerprint,
    });

    if (error) {
      throw new Error(`Failed to reverse journal voucher: ${error.message}`);
    }

    return String(data);
  }

  /**
   * Calls cancel_draft_journal_voucher RPC to cancel a DRAFT voucher.
   */
  async cancelDraftVoucher(params: CancelDraftVoucherParams): Promise<boolean> {
    const { data, error } = await this.client.rpc('cancel_draft_journal_voucher', {
      p_organization_id: params.organizationId,
      p_voucher_id: params.voucherId,
      p_cancellation_reason: params.cancellationReason,
      p_expected_version: params.expectedVersion,
      p_operation_key: params.operationKey,
      p_request_fingerprint: params.requestFingerprint,
    });

    if (error) {
      throw new Error(`Failed to cancel draft journal voucher: ${error.message}`);
    }

    return Boolean(data);
  }

  /**
   * Calls create_draft_journal_voucher RPC to atomically create a DRAFT voucher and its entries.
   */
  async createDraftVoucher(params: CreateDraftVoucherParams): Promise<string> {
    const formattedEntries = params.entries.map((e) => ({
      row_number: e.rowNumber,
      subsidiary_id: e.subsidiaryId,
      person_id: e.personId || null,
      cost_center_id: e.costCenterId || null,
      debit: e.debit,
      credit: e.credit,
      description: e.description || null,
      financial_role_code: e.financialRoleCode || null,
      contract_type: e.contractType || null,
    }));

    const { data, error } = await this.client.rpc('create_draft_journal_voucher', {
      p_organization_id: params.organizationId,
      p_branch_id: params.branchId,
      p_fiscal_year_id: params.fiscalYearId,
      p_voucher_date: params.voucherDate,
      p_description: params.description,
      p_entries: formattedEntries,
      p_operation_key: params.operationKey,
      p_request_fingerprint: params.requestFingerprint,
      p_source_type: params.sourceType || null,
      p_source_id: params.sourceId || null,
      p_source_event_key: params.sourceEventKey || null,
    });

    if (error) {
      throw new Error(`Failed to create draft journal voucher: ${error.message}`);
    }

    return String(data);
  }
}
