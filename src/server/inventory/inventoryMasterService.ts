import { SupabaseClient } from '@supabase/supabase-js';
import { Product, ProductCategory, MeasurementUnit } from '../../types';

export interface CreateCategoryPayload {
  title: string;
  code?: string;
  parentCategoryId?: string | null;
  description?: string | null;
}

export interface UpdateCategoryPayload {
  title?: string;
  code?: string;
  parentCategoryId?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export interface CreateUnitPayload {
  title: string;
  code?: string;
  allowsFraction?: boolean;
  decimalPlaces?: number;
  isSystem?: boolean;
}

export interface UpdateUnitPayload {
  title?: string;
  code?: string;
  allowsFraction?: boolean;
  decimalPlaces?: number;
  isActive?: boolean;
}

export interface CreateProductPayload {
  name: string;
  code?: string;
  category?: string;
  categoryId?: string;
  unit?: string;
  measurementUnitId?: string;
  isService?: boolean;
  productKind?: 'PRODUCT' | 'SERVICE';
  hasSerial?: boolean;
  isSerialized?: boolean;
  reorderPoint?: number;
  defaultSalePrice?: number;
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  operationKey?: string;
  requestFingerprint?: string;
}

export interface UpdateProductPayload {
  name?: string;
  code?: string;
  category?: string;
  categoryId?: string;
  unit?: string;
  measurementUnitId?: string;
  isService?: boolean;
  productKind?: 'PRODUCT' | 'SERVICE';
  hasSerial?: boolean;
  isSerialized?: boolean;
  reorderPoint?: number;
  defaultSalePrice?: number;
  status?: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
}

// ==============================================================================
// 1. MEASUREMENT UNITS
// ==============================================================================

export async function executeServerGetMeasurementUnits(
  supabaseClient: SupabaseClient,
  orgId: string
): Promise<MeasurementUnit[]> {
  const { data, error } = await supabaseClient
    .from('measurement_units')
    .select('*')
    .eq('organization_id', orgId)
    .order('title', { ascending: true });

  if (error) {
    throw new Error(`ERR_FETCH_UNITS_FAILED: ${error.message}`);
  }

  // If no units exist for this org, we can return empty or whatever is present
  return (data || []).map((u: any) => ({
    id: u.id,
    organizationId: u.organization_id,
    code: u.code,
    title: u.title,
    allowsFraction: Boolean(u.allows_fraction),
    decimalPlaces: Number(u.decimal_places || 0),
    isActive: Boolean(u.is_active),
    isSystem: Boolean(u.is_system),
    version: u.version,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  }));
}

export async function executeServerCreateMeasurementUnit(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  payload: CreateUnitPayload
): Promise<MeasurementUnit> {
  const title = (payload.title || '').trim();
  if (!title) {
    throw new Error('ERR_INVALID_UNIT_TITLE: عنوان واحد سنجش الزامی است.');
  }

  const allowsFraction = Boolean(payload.allowsFraction);
  const decimalPlaces = allowsFraction ? Math.min(3, Math.max(0, Number(payload.decimalPlaces || 0))) : 0;
  const code = (payload.code || `UNT-${Date.now().toString().slice(-5)}`).trim();

  const insertData = {
    organization_id: orgId,
    code,
    title,
    allows_fraction: allowsFraction,
    decimal_places: decimalPlaces,
    is_active: true,
    is_system: Boolean(payload.isSystem),
    created_by: userId,
  };

  const { data, error } = await supabaseClient
    .from('measurement_units')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw new Error(`ERR_CREATE_UNIT_FAILED: ${error.message}`);
  }

  return {
    id: data.id,
    organizationId: data.organization_id,
    code: data.code,
    title: data.title,
    allowsFraction: Boolean(data.allows_fraction),
    decimalPlaces: Number(data.decimal_places || 0),
    isActive: Boolean(data.is_active),
    isSystem: Boolean(data.is_system),
    version: data.version,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function executeServerUpdateMeasurementUnit(
  supabaseClient: SupabaseClient,
  orgId: string,
  id: string,
  payload: UpdateUnitPayload
): Promise<MeasurementUnit> {
  const updateData: any = { updated_at: new Date().toISOString() };
  if (payload.title !== undefined) updateData.title = payload.title.trim();
  if (payload.code !== undefined) updateData.code = payload.code.trim();
  if (payload.isActive !== undefined) updateData.is_active = Boolean(payload.isActive);
  if (payload.allowsFraction !== undefined) {
    updateData.allows_fraction = Boolean(payload.allowsFraction);
    if (!updateData.allows_fraction) {
      updateData.decimal_places = 0;
    }
  }
  if (payload.decimalPlaces !== undefined && updateData.allows_fraction !== false) {
    updateData.decimal_places = Math.min(3, Math.max(0, Number(payload.decimalPlaces)));
  }

  const { data, error } = await supabaseClient
    .from('measurement_units')
    .update(updateData)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select()
    .single();

  if (error) {
    throw new Error(`ERR_UPDATE_UNIT_FAILED: ${error.message}`);
  }

  return {
    id: data.id,
    organizationId: data.organization_id,
    code: data.code,
    title: data.title,
    allowsFraction: Boolean(data.allows_fraction),
    decimalPlaces: Number(data.decimal_places || 0),
    isActive: Boolean(data.is_active),
    isSystem: Boolean(data.is_system),
    version: data.version,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function executeServerDeleteMeasurementUnit(
  supabaseClient: SupabaseClient,
  orgId: string,
  id: string
): Promise<{ success: boolean; id: string }> {
  // Enforce soft-deactivation to preserve historical references
  const { data, error } = await supabaseClient
    .from('measurement_units')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select()
    .single();

  if (error) {
    throw new Error(`ERR_DELETE_UNIT_FAILED: ${error.message}`);
  }

  return { success: true, id: data.id };
}

// ==============================================================================
// 2. PRODUCT CATEGORIES
// ==============================================================================

export async function executeServerGetCategories(
  supabaseClient: SupabaseClient,
  orgId: string
): Promise<ProductCategory[]> {
  const { data, error } = await supabaseClient
    .from('product_categories')
    .select('*')
    .eq('organization_id', orgId)
    .order('title', { ascending: true });

  if (error) {
    throw new Error(`ERR_FETCH_CATEGORIES_FAILED: ${error.message}`);
  }

  return (data || []).map((c: any) => ({
    id: c.id,
    organizationId: c.organization_id,
    parentCategoryId: c.parent_category_id,
    code: c.code,
    title: c.title,
    description: c.description,
    isActive: Boolean(c.is_active),
    version: c.version,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));
}

export async function executeServerCreateCategory(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  payload: CreateCategoryPayload
): Promise<ProductCategory> {
  const title = (payload.title || '').trim();
  if (!title) {
    throw new Error('ERR_INVALID_CATEGORY_TITLE: نام دسته‌بندی الزامی است.');
  }

  const code = (payload.code || `CAT-${Date.now().toString().slice(-5)}`).trim();

  const insertData = {
    organization_id: orgId,
    code,
    title,
    parent_category_id: payload.parentCategoryId || null,
    description: payload.description || null,
    is_active: true,
    created_by: userId,
  };

  const { data, error } = await supabaseClient
    .from('product_categories')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw new Error(`ERR_CREATE_CATEGORY_FAILED: ${error.message}`);
  }

  return {
    id: data.id,
    organizationId: data.organization_id,
    parentCategoryId: data.parent_category_id,
    code: data.code,
    title: data.title,
    description: data.description,
    isActive: Boolean(data.is_active),
    version: data.version,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function executeServerUpdateCategory(
  supabaseClient: SupabaseClient,
  orgId: string,
  id: string,
  payload: UpdateCategoryPayload
): Promise<ProductCategory> {
  const updateData: any = { updated_at: new Date().toISOString() };
  if (payload.title !== undefined) updateData.title = payload.title.trim();
  if (payload.code !== undefined) updateData.code = payload.code.trim();
  if (payload.description !== undefined) updateData.description = payload.description;
  if (payload.parentCategoryId !== undefined) updateData.parent_category_id = payload.parentCategoryId;
  if (payload.isActive !== undefined) updateData.is_active = Boolean(payload.isActive);

  const { data, error } = await supabaseClient
    .from('product_categories')
    .update(updateData)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select()
    .single();

  if (error) {
    throw new Error(`ERR_UPDATE_CATEGORY_FAILED: ${error.message}`);
  }

  return {
    id: data.id,
    organizationId: data.organization_id,
    parentCategoryId: data.parent_category_id,
    code: data.code,
    title: data.title,
    description: data.description,
    isActive: Boolean(data.is_active),
    version: data.version,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function executeServerDeleteCategory(
  supabaseClient: SupabaseClient,
  orgId: string,
  id: string
): Promise<{ success: boolean; id: string }> {
  // Enforce soft deactivation
  const { data, error } = await supabaseClient
    .from('product_categories')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select()
    .single();

  if (error) {
    throw new Error(`ERR_DELETE_CATEGORY_FAILED: ${error.message}`);
  }

  return { success: true, id: data.id };
}

// ==============================================================================
// 3. PRODUCT CODE SEQUENCES & HELPERS
// ==============================================================================

export async function executeServerGetNextProductCode(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId?: string
): Promise<string> {
  // Call atomic PostgreSQL function
  if (typeof supabaseClient.rpc === 'function') {
    const { data, error } = await supabaseClient.rpc('get_next_product_code_atomic', {
      p_organization_id: orgId,
      p_user_id: userId || null,
    });
    if (!error && data) {
      return data as string;
    }
  }

  // Fallback for environments where RPC is not defined in mock
  const { data: seqData, error: seqErr } = await supabaseClient
    .from('product_code_sequences')
    .select('*')
    .eq('organization_id', orgId)
    .maybeSingle();

  if (seqErr) {
    console.warn('[ProductSequence] Error reading sequence, falling back to timestamp:', seqErr.message);
    return `PRD-${Date.now().toString().slice(-5)}`;
  }

  if (!seqData) {
    // Initialize sequence
    const nextNum = 2;
    const prefix = 'PRD-';
    const initialCode = `${prefix}0001`;

    await supabaseClient
      .from('product_code_sequences')
      .insert({
        organization_id: orgId,
        prefix,
        next_number: nextNum,
        updated_at: new Date().toISOString(),
        updated_by: userId || null,
      });

    return initialCode;
  }

  const currentNum = Number(seqData.next_number || 1);
  const prefix = seqData.prefix || 'PRD-';
  const padded = String(currentNum).padStart(4, '0');
  const code = `${prefix}${padded}`;

  // Advance sequence
  await supabaseClient
    .from('product_code_sequences')
    .update({
      next_number: currentNum + 1,
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    })
    .eq('organization_id', orgId);

  return code;
}

// Helper to resolve or auto-provision category
async function resolveOrCreateCategoryId(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  categoryId?: string,
  categoryTitle?: string
): Promise<string> {
  const isUuid = (val?: string) =>
    val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

  if (categoryId && isUuid(categoryId)) {
    const { data } = await supabaseClient
      .from('product_categories')
      .select('id')
      .eq('id', categoryId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (data?.id) return data.id;
  }

  const title = (categoryTitle || categoryId || 'عمومی').trim();

  // Try finding category by title in this organization
  const { data: existingCat } = await supabaseClient
    .from('product_categories')
    .select('id')
    .eq('organization_id', orgId)
    .eq('title', title)
    .maybeSingle();

  if (existingCat?.id) {
    return existingCat.id;
  }

  // Create new category
  const code = `CAT-${Date.now().toString().slice(-4)}`;
  const { data: newCat, error: catErr } = await supabaseClient
    .from('product_categories')
    .insert({
      organization_id: orgId,
      code,
      title,
      is_active: true,
      created_by: userId,
    })
    .select('id')
    .single();

  if (catErr || !newCat) {
    throw new Error(`ERR_RESOLVE_CATEGORY_FAILED: ${catErr?.message || 'ناموفق در ایجاد دسته‌بندی'}`);
  }

  return newCat.id;
}

// Helper to resolve or auto-provision measurement unit
async function resolveOrCreateUnitId(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  unitId?: string,
  unitTitle?: string
): Promise<string> {
  const isUuid = (val?: string) =>
    val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

  if (unitId && isUuid(unitId)) {
    const { data } = await supabaseClient
      .from('measurement_units')
      .select('id')
      .eq('id', unitId)
      .eq('organization_id', orgId)
      .maybeSingle();

    if (data?.id) return data.id;
  }

  const title = (unitTitle || unitId || 'عدد').trim();

  // Try finding unit by title in this organization
  const { data: existingUnit } = await supabaseClient
    .from('measurement_units')
    .select('id')
    .eq('organization_id', orgId)
    .eq('title', title)
    .maybeSingle();

  if (existingUnit?.id) {
    return existingUnit.id;
  }

  // Create new unit
  const code = `UNT-${Date.now().toString().slice(-4)}`;
  const { data: newUnit, error: unitErr } = await supabaseClient
    .from('measurement_units')
    .insert({
      organization_id: orgId,
      code,
      title,
      allows_fraction: false,
      decimal_places: 0,
      is_active: true,
      is_system: false,
      created_by: userId,
    })
    .select('id')
    .single();

  if (unitErr || !newUnit) {
    throw new Error(`ERR_RESOLVE_UNIT_FAILED: ${unitErr?.message || 'ناموفق در ایجاد واحد سنجش'}`);
  }

  return newUnit.id;
}

// ==============================================================================
// 4. PRODUCTS (کالاها و خدمات)
// ==============================================================================

export async function executeServerGetProducts(
  supabaseClient: SupabaseClient,
  orgId: string,
  includeInactive: boolean = false
): Promise<Product[]> {
  let query = supabaseClient
    .from('products')
    .select(`
      *,
      category:product_categories(id, title, code),
      measurement_unit:measurement_units(id, title, code)
    `)
    .eq('organization_id', orgId);

  if (!includeInactive) {
    query = query.neq('status', 'INACTIVE');
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new Error(`ERR_FETCH_PRODUCTS_FAILED: ${error.message}`);
  }

  return (data || []).map((p: any) => {
    const isService = p.product_kind === 'SERVICE';
    const categoryTitle = p.category?.title || p.category_id || 'عمومی';
    const unitTitle = p.measurement_unit?.title || p.measurement_unit_id || 'عدد';

    return {
      id: p.id,
      code: p.code,
      name: p.name,
      category: categoryTitle,
      categoryId: p.category_id,
      unit: unitTitle,
      measurementUnitId: p.measurement_unit_id,
      isService,
      productKind: p.product_kind as 'PRODUCT' | 'SERVICE',
      initialStock: 0, // No opening stock in products table
      initialUnitCost: 0,
      reorderPoint: Number(p.reorder_point || 0),
      hasSerial: Boolean(p.is_serialized),
      isSerialized: Boolean(p.is_serialized),
      defaultSalePrice: Number(p.default_sale_price_amount || 0),
      status: p.status,
      isActive: p.status === 'ACTIVE',
      version: p.version,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      createdBy: p.created_by,
      organizationId: p.organization_id,
    };
  });
}

export async function executeServerGetProductById(
  supabaseClient: SupabaseClient,
  orgId: string,
  id: string
): Promise<Product> {
  const { data, error } = await supabaseClient
    .from('products')
    .select(`
      *,
      category:product_categories(id, title, code),
      measurement_unit:measurement_units(id, title, code)
    `)
    .eq('id', id)
    .eq('organization_id', orgId)
    .single();

  if (error || !data) {
    throw new Error(`ERR_PRODUCT_NOT_FOUND: ${error?.message || 'کالای مورد نظر یافت نشد.'}`);
  }

  const isService = data.product_kind === 'SERVICE';
  const categoryTitle = data.category?.title || data.category_id || 'عمومی';
  const unitTitle = data.measurement_unit?.title || data.measurement_unit_id || 'عدد';

  return {
    id: data.id,
    code: data.code,
    name: data.name,
    category: categoryTitle,
    categoryId: data.category_id,
    unit: unitTitle,
    measurementUnitId: data.measurement_unit_id,
    isService,
    productKind: data.product_kind as 'PRODUCT' | 'SERVICE',
    initialStock: 0,
    initialUnitCost: 0,
    reorderPoint: Number(data.reorder_point || 0),
    hasSerial: Boolean(data.is_serialized),
    isSerialized: Boolean(data.is_serialized),
    defaultSalePrice: Number(data.default_sale_price_amount || 0),
    status: data.status,
    isActive: data.status === 'ACTIVE',
    version: data.version,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    createdBy: data.created_by,
    organizationId: data.organization_id,
  };
}

export async function executeServerCreateProduct(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  payload: CreateProductPayload
): Promise<Product> {
  const name = (payload.name || '').trim();
  if (!name) {
    throw new Error('ERR_INVALID_PRODUCT_NAME: نام کالا/خدمت الزامی است.');
  }

  // 1. Resolve Category and Unit IDs
  const categoryId = await resolveOrCreateCategoryId(
    supabaseClient,
    orgId,
    userId,
    payload.categoryId,
    payload.category
  );

  const measurementUnitId = await resolveOrCreateUnitId(
    supabaseClient,
    orgId,
    userId,
    payload.measurementUnitId,
    payload.unit
  );

  // 2. Resolve Product Kind and Constraints
  const productKind: 'PRODUCT' | 'SERVICE' =
    payload.isService || payload.productKind === 'SERVICE' ? 'SERVICE' : 'PRODUCT';

  const isSerialized = productKind === 'SERVICE' ? false : Boolean(payload.hasSerial || payload.isSerialized);
  let reorderPoint = productKind === 'SERVICE' ? 0 : Math.max(0, Number(payload.reorderPoint || 0));
  if (isSerialized) {
    reorderPoint = Math.floor(reorderPoint);
  }

  const defaultSalePrice = Math.max(0, Number(payload.defaultSalePrice || 0));
  const status = payload.status || 'ACTIVE';

  // 3. Compute Deterministic Fingerprint and Operation Key
  const opPayload = {
    name,
    categoryId,
    measurementUnitId,
    productKind,
    isSerialized,
    reorderPoint,
    defaultSalePrice,
    status
  };
  const requestFingerprint = payload.requestFingerprint || JSON.stringify(opPayload);
  const operationKey = payload.operationKey || `op_prd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 4. Primary Path: Atomic PostgreSQL Function (create_product_atomic)
  if (typeof supabaseClient.rpc === 'function') {
    const { data: rpcData, error: rpcError } = await supabaseClient.rpc('create_product_atomic', {
      p_organization_id: orgId,
      p_code: payload.code ? payload.code.trim() : null,
      p_name: name,
      p_category_id: categoryId,
      p_measurement_unit_id: measurementUnitId,
      p_product_kind: productKind,
      p_is_serialized: isSerialized,
      p_reorder_point: reorderPoint,
      p_default_sale_price_amount: defaultSalePrice,
      p_status: status,
      p_created_by: userId || null,
      p_operation_key: operationKey,
      p_request_fingerprint: requestFingerprint
    });

    if (rpcError) {
      if (rpcError.message && (rpcError.message.includes('ERR_') || rpcError.message.includes('Operation key'))) {
        throw new Error(rpcError.message);
      }
    } else if (rpcData) {
      return {
        id: rpcData.id,
        code: rpcData.code,
        name: rpcData.name,
        category: rpcData.category?.title || payload.category || 'عمومی',
        categoryId: rpcData.category_id || rpcData.categoryId,
        unit: rpcData.measurement_unit?.title || payload.unit || 'عدد',
        measurementUnitId: rpcData.measurement_unit_id || rpcData.measurementUnitId,
        isService: rpcData.product_kind === 'SERVICE',
        productKind: rpcData.product_kind as 'PRODUCT' | 'SERVICE',
        initialStock: 0,
        initialUnitCost: 0,
        reorderPoint: Number(rpcData.reorder_point || 0),
        hasSerial: Boolean(rpcData.is_serialized),
        isSerialized: Boolean(rpcData.is_serialized),
        defaultSalePrice: Number(rpcData.default_sale_price_amount || 0),
        status: rpcData.status,
        isActive: rpcData.status === 'ACTIVE',
        version: rpcData.version || 1,
        createdAt: rpcData.created_at || new Date().toISOString(),
        updatedAt: rpcData.updated_at || new Date().toISOString(),
        createdBy: rpcData.created_by,
        organizationId: rpcData.organization_id,
      };
    }
  }

  // 5. Fallback path (for direct queries / unit test mocks)
  let code = (payload.code || '').trim();
  if (!code) {
    code = await executeServerGetNextProductCode(supabaseClient, orgId, userId);
  }

  const insertData = {
    organization_id: orgId,
    code,
    name,
    category_id: categoryId,
    measurement_unit_id: measurementUnitId,
    product_kind: productKind,
    is_serialized: isSerialized,
    reorder_point: reorderPoint,
    default_sale_price_amount: defaultSalePrice,
    status,
    created_by: userId,
    operation_key: operationKey,
    request_fingerprint: requestFingerprint
  };

  const { data, error } = await supabaseClient
    .from('products')
    .insert(insertData)
    .select(`
      *,
      category:product_categories(id, title, code),
      measurement_unit:measurement_units(id, title, code)
    `)
    .single();

  if (error) {
    throw new Error(`ERR_CREATE_PRODUCT_FAILED: ${error.message}`);
  }

  return {
    id: data.id,
    code: data.code,
    name: data.name,
    category: data.category?.title || payload.category || 'عمومی',
    categoryId: data.category_id,
    unit: data.measurement_unit?.title || payload.unit || 'عدد',
    measurementUnitId: data.measurement_unit_id,
    isService: data.product_kind === 'SERVICE',
    productKind: data.product_kind as 'PRODUCT' | 'SERVICE',
    initialStock: 0,
    initialUnitCost: 0,
    reorderPoint: Number(data.reorder_point || 0),
    hasSerial: Boolean(data.is_serialized),
    isSerialized: Boolean(data.is_serialized),
    defaultSalePrice: Number(data.default_sale_price_amount || 0),
    status: data.status,
    isActive: data.status === 'ACTIVE',
    version: data.version,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    createdBy: data.created_by,
    organizationId: data.organization_id,
  };
}

export async function executeServerUpdateProduct(
  supabaseClient: SupabaseClient,
  orgId: string,
  userId: string,
  id: string,
  payload: UpdateProductPayload
): Promise<Product> {
  const updateData: any = { updated_at: new Date().toISOString() };

  if (payload.name !== undefined) {
    const name = payload.name.trim();
    if (!name) throw new Error('ERR_INVALID_PRODUCT_NAME: نام کالا نمی‌تواند خالی باشد.');
    updateData.name = name;
  }

  if (payload.code !== undefined && payload.code.trim()) {
    updateData.code = payload.code.trim();
  }

  if (payload.categoryId || payload.category) {
    updateData.category_id = await resolveOrCreateCategoryId(
      supabaseClient,
      orgId,
      userId,
      payload.categoryId,
      payload.category
    );
  }

  if (payload.measurementUnitId || payload.unit) {
    updateData.measurement_unit_id = await resolveOrCreateUnitId(
      supabaseClient,
      orgId,
      userId,
      payload.measurementUnitId,
      payload.unit
    );
  }

  if (payload.isService !== undefined || payload.productKind !== undefined) {
    updateData.product_kind =
      payload.isService || payload.productKind === 'SERVICE' ? 'SERVICE' : 'PRODUCT';
  }

  if (payload.hasSerial !== undefined || payload.isSerialized !== undefined) {
    updateData.is_serialized = Boolean(payload.hasSerial || payload.isSerialized);
  }

  if (payload.reorderPoint !== undefined) {
    updateData.reorder_point = Math.max(0, Number(payload.reorderPoint));
  }

  if (payload.defaultSalePrice !== undefined) {
    updateData.default_sale_price_amount = Math.max(0, Number(payload.defaultSalePrice));
  }

  if (payload.status !== undefined) {
    updateData.status = payload.status;
  }

  // Enforce check constraints
  if (updateData.product_kind === 'SERVICE') {
    updateData.is_serialized = false;
    updateData.reorder_point = 0;
  } else if (updateData.is_serialized && updateData.reorder_point !== undefined) {
    updateData.reorder_point = Math.floor(updateData.reorder_point);
  }

  const { data, error } = await supabaseClient
    .from('products')
    .update(updateData)
    .eq('id', id)
    .eq('organization_id', orgId)
    .select(`
      *,
      category:product_categories(id, title, code),
      measurement_unit:measurement_units(id, title, code)
    `)
    .single();

  if (error) {
    throw new Error(`ERR_UPDATE_PRODUCT_FAILED: ${error.message}`);
  }

  return {
    id: data.id,
    code: data.code,
    name: data.name,
    category: data.category?.title || 'عمومی',
    categoryId: data.category_id,
    unit: data.measurement_unit?.title || 'عدد',
    measurementUnitId: data.measurement_unit_id,
    isService: data.product_kind === 'SERVICE',
    productKind: data.product_kind as 'PRODUCT' | 'SERVICE',
    initialStock: 0,
    initialUnitCost: 0,
    reorderPoint: Number(data.reorder_point || 0),
    hasSerial: Boolean(data.is_serialized),
    isSerialized: Boolean(data.is_serialized),
    defaultSalePrice: Number(data.default_sale_price_amount || 0),
    status: data.status,
    isActive: data.status === 'ACTIVE',
    version: data.version,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    createdBy: data.created_by,
    organizationId: data.organization_id,
  };
}

export async function executeServerDeleteProduct(
  supabaseClient: SupabaseClient,
  orgId: string,
  id: string
): Promise<{ success: boolean; id: string; status: string }> {
  // Invariant: Non-draft products MUST be deactivated rather than physically deleted.
  const { data, error } = await supabaseClient
    .from('products')
    .update({ status: 'INACTIVE', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', orgId)
    .select()
    .single();

  if (error) {
    throw new Error(`ERR_DELETE_PRODUCT_FAILED: ${error.message}`);
  }

  return { success: true, id: data.id, status: 'INACTIVE' };
}
