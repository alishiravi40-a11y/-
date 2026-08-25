import { SupabaseClient } from '@supabase/supabase-js';

export interface WarehouseAccountMapping {
  id: string;
  organizationId: string;
  warehouseId: string;
  warehouseName?: string;
  subsidiaryId: string;
  subsidiaryCode?: string;
  subsidiaryName?: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status: 'CURRENT' | 'EXPIRED' | 'PLANNED' | 'CANCELLED';
  changeReason?: string | null;
  createdAt: string;
}

export interface WarehouseTransferItemInput {
  productId: string;
  quantity: number;
  serialNumbers?: string[];
}

export interface ExecuteWarehouseTransferInput {
  organizationId: string;
  userId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  transferDate: string;
  description: string;
  operationKey: string;
  requestFingerprint: string;
  items: WarehouseTransferItemInput[];
}

export interface ExecuteWarehouseTransferResult {
  transactionId: string;
  documentNumber: number;
  journalVoucherId: string;
  voucherNumber: number;
  totalTransferCost: number;
  status: string;
  isReplay: boolean;
}

export interface ReverseWarehouseTransferInput {
  organizationId: string;
  userId: string;
  transactionId: string;
  reversalReason: string;
  operationKey: string;
  requestFingerprint: string;
}

/**
 * Retrieves warehouse inventory account mappings.
 */
export async function executeGetWarehouseAccountMappings(
  supabase: SupabaseClient,
  organizationId: string,
  warehouseId?: string
): Promise<WarehouseAccountMapping[]> {
  const { data, error } = await supabase.rpc('rpc_get_warehouse_account_mappings', {
    p_organization_id: organizationId,
    p_warehouse_id: warehouseId || null
  });

  if (error) {
    throw new Error(`Failed to fetch warehouse account mappings: ${error.message}`);
  }

  return (data || []) as WarehouseAccountMapping[];
}

/**
 * Sets or updates warehouse inventory account mapping with temporal tracking.
 */
export async function executeSetWarehouseAccountMapping(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  warehouseId: string,
  subsidiaryId: string,
  changeReason: string
): Promise<WarehouseAccountMapping> {
  const { data, error } = await supabase.rpc('rpc_set_warehouse_account_mapping', {
    p_organization_id: organizationId,
    p_warehouse_id: warehouseId,
    p_subsidiary_id: subsidiaryId,
    p_change_reason: changeReason,
    p_user_id: userId
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as WarehouseAccountMapping;
}

/**
 * Executes an atomic warehouse transfer with double-entry journal voucher creation.
 */
export async function executeWarehouseTransferAtomic(
  supabase: SupabaseClient,
  input: ExecuteWarehouseTransferInput
): Promise<ExecuteWarehouseTransferResult> {
  const { data, error } = await supabase.rpc('rpc_execute_warehouse_transfer_atomic', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_source_warehouse_id: input.sourceWarehouseId,
    p_destination_warehouse_id: input.destinationWarehouseId,
    p_transfer_date: input.transferDate,
    p_description: input.description,
    p_operation_key: input.operationKey,
    p_request_fingerprint: input.requestFingerprint,
    p_items: input.items
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as ExecuteWarehouseTransferResult;
}

/**
 * Reverses a posted warehouse transfer atomically.
 */
export async function executeReverseWarehouseTransferAtomic(
  supabase: SupabaseClient,
  input: ReverseWarehouseTransferInput
): Promise<any> {
  const { data, error } = await supabase.rpc('rpc_reverse_warehouse_transfer_atomic', {
    p_organization_id: input.organizationId,
    p_user_id: input.userId,
    p_transaction_id: input.transactionId,
    p_reversal_reason: input.reversalReason,
    p_operation_key: input.operationKey,
    p_request_fingerprint: input.requestFingerprint
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

/**
 * Fetches all warehouse transfers for an organization from the database.
 */
export async function executeGetWarehouseTransfers(
  supabase: SupabaseClient,
  organizationId: string
): Promise<any[]> {
  const { data, error } = await supabase
    .from('inventory_transactions')
    .select(`
      id,
      organization_id,
      document_number,
      transaction_date,
      transaction_type,
      transaction_kind,
      status,
      description,
      journal_voucher_id,
      created_at,
      created_by,
      inventory_transaction_items (
        id,
        product_id,
        source_warehouse_id,
        destination_warehouse_id,
        quantity,
        unit_cost_amount,
        total_cost_amount
      )
    `)
    .eq('organization_id', organizationId)
    .eq('transaction_type', 'TRANSFER')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch warehouse transfers: ${error.message}`);
  }

  return data || [];
}

/**
 * Fetches available product serial numbers in a specific warehouse.
 */
export async function executeGetProductSerials(
  supabase: SupabaseClient,
  organizationId: string,
  warehouseId: string,
  productId: string
): Promise<Array<{ id: string; serialNumber: string; status: string; warehouseId: string }>> {
  const { data, error } = await supabase
    .from('product_serials')
    .select('id, serial_number_raw, serial_number_normalized, status, current_warehouse_id')
    .eq('organization_id', organizationId)
    .eq('product_id', productId)
    .eq('current_warehouse_id', warehouseId)
    .eq('status', 'AVAILABLE');

  if (error) {
    throw new Error(`Failed to fetch product serials: ${error.message}`);
  }

  return (data || []).map((s: any) => ({
    id: s.id,
    serialNumber: s.serial_number_raw || s.serial_number_normalized,
    status: s.status,
    warehouseId: s.current_warehouse_id
  }));
}
