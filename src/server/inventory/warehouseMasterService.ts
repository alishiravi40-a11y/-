import { SupabaseClient } from '@supabase/supabase-js';
import { Warehouse } from '../../types';

export interface CreateWarehousePayload {
  name: string;
  code?: string;
  branchId?: string;
  location?: string;
  isDefault?: boolean;
  status?: 'ACTIVE' | 'INACTIVE' | 'DRAFT';
  operationKey?: string;
  requestFingerprint?: string;
}

export interface UpdateWarehousePayload {
  name?: string;
  code?: string;
  branchId?: string;
  location?: string;
  expectedVersion?: number;
  operationKey?: string;
  requestFingerprint?: string;
}

export async function executeServerGetWarehouses(
  supabaseClient: SupabaseClient,
  orgId: string,
  includeInactive: boolean = false
): Promise<Warehouse[]> {
  let query = supabaseClient
    .from('warehouses')
    .select(`
      id,
      organization_id,
      branch_id,
      code,
      name,
      location,
      is_default,
      status,
      version,
      created_at,
      updated_at,
      branch:branches(id, name, code)
    `)
    .eq('organization_id', orgId);

  if (!includeInactive) {
    query = query.in('status', ['ACTIVE', 'DRAFT']);
  }

  const { data, error } = await query
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`ERR_FETCH_WAREHOUSES_FAILED: ${error.message}`);
  }

  return (data || []).map((w: any) => ({
    id: w.id,
    code: w.code,
    name: w.name,
    branchId: w.branch_id,
    branchName: w.branch?.name || '',
    location: w.location || '',
    isDefault: Boolean(w.is_default),
    status: w.status,
    version: w.version,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    organizationId: w.organization_id,
  }));
}

export async function executeServerGetWarehouseById(
  supabaseClient: SupabaseClient,
  orgId: string,
  id: string
): Promise<Warehouse> {
  const { data, error } = await supabaseClient
    .from('warehouses')
    .select(`
      id,
      organization_id,
      branch_id,
      code,
      name,
      location,
      is_default,
      status,
      version,
      created_at,
      updated_at,
      branch:branches(id, name, code)
    `)
    .eq('id', id)
    .eq('organization_id', orgId)
    .single();

  if (error || !data) {
    throw new Error(`ERR_WAREHOUSE_NOT_FOUND: انبار با شناسه مشخص‌شده یافت نشد.`);
  }

  return {
    id: data.id,
    code: data.code,
    name: data.name,
    branchId: data.branch_id,
    branchName: (data as any).branch?.name || '',
    location: data.location || '',
    isDefault: Boolean(data.is_default),
    status: data.status,
    version: data.version,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    organizationId: data.organization_id,
  };
}

export async function executeServerGetNextWarehouseCode(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId?: string
): Promise<string> {
  try {
    const { data, error } = await supabaseClient.rpc('get_next_warehouse_code_atomic', {
      p_organization_id: orgId,
      p_user_id: userId || null,
    });

    if (!error && data) {
      return data;
    }
  } catch {
    // Fallback if RPC is not deployed in test/mock environment
  }

  // Direct sequence query fallback
  const { data: existingSeq } = await supabaseClient
    .from('warehouse_code_sequences')
    .select('prefix, next_number')
    .eq('organization_id', orgId)
    .single();

  if (existingSeq) {
    const prefix = existingSeq.prefix || 'WH-';
    const nextNum = existingSeq.next_number || 1;
    return `${prefix}${String(nextNum).padStart(3, '0')}`;
  }

  // Count existing warehouses fallback
  const { count } = await supabaseClient
    .from('warehouses')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  const nextNum = (count || 0) + 1;
  return `WH-${String(nextNum).padStart(3, '0')}`;
}

export async function executeServerCreateWarehouse(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  payload: CreateWarehousePayload
): Promise<Warehouse> {
  const name = payload.name ? payload.name.trim() : '';
  if (!name) {
    throw new Error('ERR_INVALID_WAREHOUSE_NAME: نام انبار الزامی است.');
  }

  // 1. Try atomic PostgreSQL RPC first
  try {
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('create_warehouse_atomic', {
      p_organization_id: orgId,
      p_name: name,
      p_code: payload.code ? payload.code.trim() : null,
      p_branch_id: payload.branchId || null,
      p_location: payload.location ? payload.location.trim() : null,
      p_is_default: Boolean(payload.isDefault),
      p_status: payload.status || 'ACTIVE',
      p_created_by: userId,
      p_operation_key: payload.operationKey || null,
      p_request_fingerprint: payload.requestFingerprint || null,
    });

    if (!rpcError && rpcData) {
      return {
        id: rpcData.id,
        code: rpcData.code,
        name: rpcData.name,
        branchId: rpcData.branch_id || rpcData.branchId,
        branchName: rpcData.branch_name || rpcData.branchName || '',
        location: rpcData.location || '',
        isDefault: Boolean(rpcData.is_default !== undefined ? rpcData.is_default : rpcData.isDefault),
        status: rpcData.status || 'ACTIVE',
        version: rpcData.version || 1,
        createdAt: rpcData.created_at || rpcData.createdAt,
        updatedAt: rpcData.updated_at || rpcData.updatedAt,
        organizationId: rpcData.organization_id || rpcData.organizationId,
      };
    }
    if (rpcError && !rpcError.message.includes('function public.create_warehouse_atomic') && !rpcError.message.includes('does not exist')) {
      throw new Error(rpcError.message);
    }
  } catch (err: any) {
    if (err.message && (err.message.startsWith('ERR_') || !err.message.includes('create_warehouse_atomic'))) {
      throw err;
    }
  }

  // 2. Direct Query Fallback (for test mock environments without RPC)
  // Resolve branch
  let branchId = payload.branchId;
  let branchName = '';
  if (branchId) {
    const { data: bData, error: bErr } = await supabaseClient
      .from('branches')
      .select('id, name')
      .eq('id', branchId)
      .eq('organization_id', orgId)
      .single();
    if (bErr || !bData) {
      throw new Error('ERR_BRANCH_NOT_FOUND: شعبه مشخص‌شده یافت نشد.');
    }
    branchName = bData.name;
  } else {
    const { data: branches } = await supabaseClient
      .from('branches')
      .select('id, name')
      .eq('organization_id', orgId)
      .eq('is_active', true);

    if (branches && branches.length === 1) {
      branchId = branches[0].id;
      branchName = branches[0].name;
    } else if (branches && branches.length > 1) {
      throw new Error('ERR_BRANCH_REQUIRED: انتخاب شعبه برای انبار الزامی است.');
    } else if (branches && branches.length === 0) {
      // Create fallback branch if none
      const { data: anyBranch } = await supabaseClient
        .from('branches')
        .select('id, name')
        .eq('organization_id', orgId)
        .limit(1)
        .single();
      if (anyBranch) {
        branchId = anyBranch.id;
        branchName = anyBranch.name;
      } else {
        throw new Error('ERR_BRANCH_NOT_FOUND: هیچ شعبه‌ای برای این سازمان یافت نشد.');
      }
    }
  }

  // Check code uniqueness
  let code = payload.code ? payload.code.trim() : '';
  if (code) {
    const { data: existingWithCode } = await supabaseClient
      .from('warehouses')
      .select('id')
      .eq('organization_id', orgId)
      .eq('code', code)
      .maybeSingle();

    if (existingWithCode) {
      throw new Error(`ERR_DUPLICATE_WAREHOUSE_CODE: کد انبار "${code}" قبلاً ثبت شده است.`);
    }
  } else {
    code = await executeServerGetNextWarehouseCode(supabaseClient, orgId, userId);
  }

  // Check default warehouse
  const { data: existingWhs } = await supabaseClient
    .from('warehouses')
    .select('id, is_default, status')
    .eq('organization_id', orgId)
    .eq('branch_id', branchId)
    .eq('status', 'ACTIVE');

  let isDefault = Boolean(payload.isDefault);
  if (!existingWhs || existingWhs.length === 0) {
    isDefault = true;
  }

  if (isDefault) {
    await supabaseClient
      .from('warehouses')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .eq('branch_id', branchId)
      .eq('is_default', true);
  }

  const newRecord = {
    organization_id: orgId,
    branch_id: branchId,
    code,
    name,
    location: payload.location ? payload.location.trim() : null,
    is_default: isDefault,
    status: payload.status || 'ACTIVE',
    version: 1,
    created_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseClient
    .from('warehouses')
    .insert(newRecord)
    .select()
    .single();

  if (error) {
    throw new Error(`ERR_CREATE_WAREHOUSE_FAILED: ${error.message}`);
  }

  return {
    id: data.id,
    code: data.code,
    name: data.name,
    branchId: data.branch_id,
    branchName,
    location: data.location || '',
    isDefault: Boolean(data.is_default),
    status: data.status,
    version: data.version,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    organizationId: data.organization_id,
  };
}

export async function executeServerUpdateWarehouse(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  id: string,
  payload: UpdateWarehousePayload
): Promise<Warehouse> {
  // 1. Try atomic PostgreSQL RPC first
  try {
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('update_warehouse_atomic', {
      p_organization_id: orgId,
      p_warehouse_id: id,
      p_name: payload.name ? payload.name.trim() : '',
      p_location: payload.location !== undefined ? payload.location : null,
      p_code: payload.code ? payload.code.trim() : null,
      p_branch_id: payload.branchId || null,
      p_expected_version: payload.expectedVersion !== undefined ? payload.expectedVersion : null,
      p_updated_by: userId,
      p_operation_key: payload.operationKey || null,
      p_request_fingerprint: payload.requestFingerprint || null,
    });

    if (!rpcError && rpcData) {
      return {
        id: rpcData.id,
        code: rpcData.code,
        name: rpcData.name,
        branchId: rpcData.branch_id || rpcData.branchId,
        branchName: rpcData.branch_name || rpcData.branchName || '',
        location: rpcData.location || '',
        isDefault: Boolean(rpcData.is_default !== undefined ? rpcData.is_default : rpcData.isDefault),
        status: rpcData.status,
        version: rpcData.version,
        createdAt: rpcData.created_at || rpcData.createdAt,
        updatedAt: rpcData.updated_at || rpcData.updatedAt,
        organizationId: rpcData.organization_id || rpcData.organizationId,
      };
    }
    if (rpcError && !rpcError.message.includes('function public.update_warehouse_atomic') && !rpcError.message.includes('does not exist')) {
      throw new Error(rpcError.message);
    }
  } catch (err: any) {
    if (err.message && (err.message.startsWith('ERR_') || !err.message.includes('update_warehouse_atomic'))) {
      throw err;
    }
  }

  // 2. Direct Query Fallback
  const { data: existing, error: findErr } = await supabaseClient
    .from('warehouses')
    .select('*, branch:branches(id, name)')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single();

  if (findErr || !existing) {
    throw new Error('ERR_WAREHOUSE_NOT_FOUND: انبار مورد نظر یافت نشد.');
  }

  if (payload.expectedVersion !== undefined && existing.version !== payload.expectedVersion) {
    throw new Error(`ERR_CONCURRENCY_CONFLICT: نسخه اطلاعات انبار قدیمی است (نسخه کنونی: ${existing.version}, نسخه ارسالی: ${payload.expectedVersion}). لطفاً صفحه را تازه‌سازی کنید.`);
  }

  const updateData: any = {
    updated_at: new Date().toISOString(),
    version: (existing.version || 1) + 1,
  };

  if (payload.name !== undefined) {
    const name = payload.name.trim();
    if (!name) throw new Error('ERR_INVALID_WAREHOUSE_NAME: نام انبار نمی‌تواند خالی باشد.');
    updateData.name = name;
  }

  if (payload.location !== undefined) {
    updateData.location = payload.location ? payload.location.trim() : null;
  }

  if (payload.code !== undefined && payload.code.trim() && payload.code.trim() !== existing.code) {
    const newCode = payload.code.trim();
    const { data: codeConflict } = await supabaseClient
      .from('warehouses')
      .select('id')
      .eq('organization_id', orgId)
      .eq('code', newCode)
      .neq('id', id)
      .maybeSingle();

    if (codeConflict) {
      throw new Error(`ERR_DUPLICATE_WAREHOUSE_CODE: کد انبار "${newCode}" قبلاً ثبت شده است.`);
    }
    updateData.code = newCode;
  }

  if (payload.branchId !== undefined && payload.branchId !== existing.branch_id) {
    const { data: branchData, error: bErr } = await supabaseClient
      .from('branches')
      .select('id, name')
      .eq('id', payload.branchId)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .single();

    if (bErr || !branchData) {
      throw new Error('ERR_BRANCH_NOT_FOUND: شعبه جدید مشخص‌شده یافت نشد یا غیرفعال است.');
    }
    updateData.branch_id = payload.branchId;
  }

  const { data: updated, error: updateErr } = await supabaseClient
    .from('warehouses')
    .update(updateData)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*, branch:branches(id, name)')
    .single();

  if (updateErr) {
    throw new Error(`ERR_UPDATE_WAREHOUSE_FAILED: ${updateErr.message}`);
  }

  return {
    id: updated.id,
    code: updated.code,
    name: updated.name,
    branchId: updated.branch_id,
    branchName: updated.branch?.name || '',
    location: updated.location || '',
    isDefault: Boolean(updated.is_default),
    status: updated.status,
    version: updated.version,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
    organizationId: updated.organization_id,
  };
}

export async function executeServerSetDefaultWarehouse(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  id: string
): Promise<Warehouse> {
  // 1. Try atomic PostgreSQL RPC first
  try {
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('set_default_warehouse_atomic', {
      p_organization_id: orgId,
      p_warehouse_id: id,
      p_updated_by: userId,
    });

    if (!rpcError && rpcData) {
      return {
        id: rpcData.id,
        code: rpcData.code,
        name: rpcData.name,
        branchId: rpcData.branch_id || rpcData.branchId,
        branchName: rpcData.branch_name || rpcData.branchName || '',
        location: rpcData.location || '',
        isDefault: Boolean(rpcData.is_default !== undefined ? rpcData.is_default : rpcData.isDefault),
        status: rpcData.status || 'ACTIVE',
        version: rpcData.version || 1,
        createdAt: rpcData.created_at || rpcData.createdAt,
        updatedAt: rpcData.updated_at || rpcData.updatedAt,
        organizationId: rpcData.organization_id || rpcData.organizationId,
      };
    }
    if (rpcError && !rpcError.message.includes('function public.set_default_warehouse_atomic') && !rpcError.message.includes('does not exist')) {
      throw new Error(rpcError.message);
    }
  } catch (err: any) {
    if (err.message && (err.message.startsWith('ERR_') || !err.message.includes('set_default_warehouse_atomic'))) {
      throw err;
    }
  }

  // 2. Direct Query Fallback
  const { data: target, error: findErr } = await supabaseClient
    .from('warehouses')
    .select('*, branch:branches(id, name)')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single();

  if (findErr || !target) {
    throw new Error('ERR_WAREHOUSE_NOT_FOUND: انبار مورد نظر یافت نشد.');
  }

  if (target.status !== 'ACTIVE') {
    throw new Error('ERR_CANNOT_SET_INACTIVE_DEFAULT: انبار غیرفعال نمی‌تواند انبار پیش‌فرض باشد.');
  }

  // Clear previous default in branch
  await supabaseClient
    .from('warehouses')
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .eq('branch_id', target.branch_id)
    .eq('is_default', true);

  // Set new default
  const { data: updated, error: updateErr } = await supabaseClient
    .from('warehouses')
    .update({
      is_default: true,
      version: (target.version || 1) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*, branch:branches(id, name)')
    .single();

  if (updateErr) {
    throw new Error(`ERR_SET_DEFAULT_WAREHOUSE_FAILED: ${updateErr.message}`);
  }

  return {
    id: updated.id,
    code: updated.code,
    name: updated.name,
    branchId: updated.branch_id,
    branchName: updated.branch?.name || '',
    location: updated.location || '',
    isDefault: Boolean(updated.is_default),
    status: updated.status,
    version: updated.version,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
    organizationId: updated.organization_id,
  };
}

export async function executeServerDeactivateWarehouse(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  id: string,
  replacementDefaultId?: string
): Promise<Warehouse> {
  // 1. Try atomic PostgreSQL RPC first
  try {
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('deactivate_warehouse_atomic', {
      p_organization_id: orgId,
      p_warehouse_id: id,
      p_replacement_default_warehouse_id: replacementDefaultId || null,
      p_updated_by: userId,
    });

    if (!rpcError && rpcData) {
      return {
        id: rpcData.id,
        code: rpcData.code,
        name: rpcData.name,
        branchId: rpcData.branch_id || rpcData.branchId,
        branchName: rpcData.branch_name || rpcData.branchName || '',
        location: rpcData.location || '',
        isDefault: Boolean(rpcData.is_default !== undefined ? rpcData.is_default : rpcData.isDefault),
        status: rpcData.status || 'INACTIVE',
        version: rpcData.version,
        createdAt: rpcData.created_at || rpcData.createdAt,
        updatedAt: rpcData.updated_at || rpcData.updatedAt,
        organizationId: rpcData.organization_id || rpcData.organizationId,
      };
    }
    if (rpcError && !rpcError.message.includes('function public.deactivate_warehouse_atomic') && !rpcError.message.includes('does not exist')) {
      throw new Error(rpcError.message);
    }
  } catch (err: any) {
    if (err.message && (err.message.startsWith('ERR_') || !err.message.includes('deactivate_warehouse_atomic'))) {
      throw err;
    }
  }

  // 2. Direct Query Fallback
  const { data: target, error: findErr } = await supabaseClient
    .from('warehouses')
    .select('*, branch:branches(id, name)')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single();

  if (findErr || !target) {
    throw new Error('ERR_WAREHOUSE_NOT_FOUND: انبار مورد نظر یافت نشد.');
  }

  if (target.is_default) {
    if (replacementDefaultId) {
      if (replacementDefaultId === id) {
        throw new Error('ERR_INVALID_REPLACEMENT_DEFAULT: انبار جایگزین نمی‌تواند همان انبار در حال غیرفعال‌سازی باشد.');
      }
      const { data: repl, error: replErr } = await supabaseClient
        .from('warehouses')
        .select('id, status, branch_id')
        .eq('id', replacementDefaultId)
        .eq('organization_id', orgId)
        .eq('branch_id', target.branch_id)
        .eq('status', 'ACTIVE')
        .single();

      if (replErr || !repl) {
        throw new Error('ERR_INVALID_REPLACEMENT_DEFAULT: انبار جایگزین پیش‌فرض در این شعبه یافت نشد یا غیرفعال است.');
      }

      await supabaseClient
        .from('warehouses')
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq('id', replacementDefaultId);
    } else {
      const { data: otherActive } = await supabaseClient
        .from('warehouses')
        .select('id')
        .eq('organization_id', orgId)
        .eq('branch_id', target.branch_id)
        .eq('status', 'ACTIVE')
        .neq('id', id);

      if (otherActive && otherActive.length > 0) {
        throw new Error('ERR_CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE: غیرفعال‌سازی انبار پیش‌فرض تا زمانی که انبار پیش‌فرض جایگزین تعیین نشده است مسدود می‌باشد.');
      }
    }
  }

  const { data: updated, error: updateErr } = await supabaseClient
    .from('warehouses')
    .update({
      status: 'INACTIVE',
      is_default: false,
      version: (target.version || 1) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select('*, branch:branches(id, name)')
    .single();

  if (updateErr) {
    throw new Error(`ERR_DEACTIVATE_WAREHOUSE_FAILED: ${updateErr.message}`);
  }

  return {
    id: updated.id,
    code: updated.code,
    name: updated.name,
    branchId: updated.branch_id,
    branchName: updated.branch?.name || '',
    location: updated.location || '',
    isDefault: Boolean(updated.is_default),
    status: updated.status,
    version: updated.version,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
    organizationId: updated.organization_id,
  };
}
