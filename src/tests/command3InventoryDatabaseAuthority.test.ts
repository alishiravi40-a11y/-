/**
 * Verification Test Suite for Instruction 3:
 * Product, Category, and Measurement Unit Server-Authoritative Database Migration.
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import { executeFinancialHydration, FinancialSyncStatus } from '../App';
import { ProductService } from '../services/productService';
import { AppState, Product, ProductCategory, MeasurementUnit } from '../types';
import { SERVER_ROUTE_POLICIES } from '../server/auth/serverRouteAuthorizationPolicy';
import {
  executeServerGetNextProductCode,
  executeServerCreateProduct,
  executeServerUpdateProduct,
  executeServerDeleteProduct,
  executeServerGetProducts,
  executeServerCreateCategory,
  executeServerUpdateCategory,
  executeServerDeleteCategory,
  executeServerGetCategories,
  executeServerCreateMeasurementUnit,
  executeServerUpdateMeasurementUnit,
  executeServerDeleteMeasurementUnit,
  executeServerGetMeasurementUnits
} from '../server/inventory/inventoryMasterService';

async function runTests() {
  console.log('================================================================');
  console.log('RUNNING INSTRUCTION 3: INVENTORY MASTER DATA AUTHORITY TESTS');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // Test 1: RBAC & Route Authorization Policies for Inventory Master Data
  // --------------------------------------------------------------------------
  console.log('[1/8] Verifying RBAC Route Authorization Policies...');
  const expectedPolicyIds = [
    'MEASUREMENT_UNITS_GET',
    'MEASUREMENT_UNITS_POST',
    'MEASUREMENT_UNITS_PUT',
    'MEASUREMENT_UNITS_DELETE',
    'PRODUCT_CATEGORIES_GET',
    'PRODUCT_CATEGORIES_POST',
    'PRODUCT_CATEGORIES_PUT',
    'PRODUCT_CATEGORIES_DELETE',
    'PRODUCTS_GET',
    'PRODUCTS_NEXT_CODE_GET',
    'PRODUCTS_GET_BY_ID',
    'PRODUCTS_POST',
    'PRODUCTS_PUT',
    'PRODUCTS_DELETE'
  ];

  for (const policyId of expectedPolicyIds) {
    const policy = SERVER_ROUTE_POLICIES.find(p => p.policyId === policyId);
    assert(policy, `Missing route policy: ${policyId}`);
    assert(policy.requiredPermissions && policy.requiredPermissions.length > 0, `Policy ${policyId} must have requiredPermissions`);
  }
  console.log('✅ [1/8] All 14 inventory master data route policies are registered and secured.\n');

  // --------------------------------------------------------------------------
  // Test 2: Server-Side Atomic Product Code Sequence & Generation
  // --------------------------------------------------------------------------
  console.log('[2/8] Testing Server-Side Atomic Product Code Sequence...');
  let sequenceUpdated = false;
  const mockSupabaseForSequence: any = {
    from: (table: string) => {
      if (table === 'product_code_sequences') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'seq_1',
                  prefix: 'PRD-',
                  next_number: 42
                },
                error: null
              })
            })
          }),
          update: (updates: any) => ({
            eq: async () => {
              sequenceUpdated = true;
              return { error: null };
            }
          })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  const nextCode = await executeServerGetNextProductCode(mockSupabaseForSequence, 'org_test_1', 'user_1');
  assert.equal(nextCode, 'PRD-0042', 'Must return formatted sequential code');
  assert.equal(sequenceUpdated, true, 'Must update sequence value');
  console.log('✅ [2/8] Server-side atomic product code generation verified.\n');

  // --------------------------------------------------------------------------
  // Test 3: Server-Side Product CRUD & Deactivation Policy
  // --------------------------------------------------------------------------
  console.log('[3/8] Testing Server-Side Product CRUD & Deactivation...');
  const createdProducts: any[] = [];
  const updatedProducts: any[] = [];

  const mockSupabaseForProducts: any = {
    from: (table: string) => {
      if (table === 'product_code_sequences') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { next_number: 105, prefix: 'PRD-' }, error: null })
            })
          }),
          insert: async () => ({ error: null }),
          update: () => ({
            eq: async () => ({ error: null })
          })
        };
      }
      if (table === 'products') {
        return {
          insert: (records: any) => ({
            select: () => ({
              single: async () => {
                const recData = Array.isArray(records) ? records[0] : records;
                const rec = { ...recData, id: 'prd_' + Date.now(), created_at: new Date().toISOString() };
                createdProducts.push(rec);
                return { data: rec, error: null };
              }
            })
          }),
          update: (updates: any) => ({
            eq: (col1: string, val1: string) => ({
              eq: (col2: string, val2: string) => ({
                select: () => ({
                  single: async () => {
                    const rec = { id: val1, organization_id: val2, ...updates, updated_at: new Date().toISOString() };
                    updatedProducts.push(rec);
                    return { data: rec, error: null };
                  }
                })
              })
            })
          }),
          select: (cols: string) => ({
            eq: (col1: string, val1: string) => {
              const chain: any = {
                order: () => Promise.resolve({ data: createdProducts, error: null }),
                then: (cb: any) => cb({ data: createdProducts, error: null })
              };
              return chain;
            }
          })
        };
      }
      if (table === 'product_categories') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'cat_general', title: 'عمومی' }, error: null })
              })
            })
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: 'cat_new', title: 'دسته جدید' }, error: null })
            })
          })
        };
      }
      if (table === 'measurement_units') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'unit_piece', title: 'عدد' }, error: null })
              })
            })
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: 'unit_new', title: 'واحد جدید' }, error: null })
            })
          })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  // Create Product
  const newProduct = await executeServerCreateProduct(mockSupabaseForProducts, 'org_test_1', 'user_1', {
    name: 'تلفن همراه مدل تست',
    category: 'موبایل',
    unit: 'دستگاه',
    hasSerial: true,
    defaultSalePrice: 150000000
  });

  assert(newProduct.id, 'Created product must have ID');
  assert.equal(newProduct.name, 'تلفن همراه مدل تست');
  assert.equal(newProduct.hasSerial, true);
  assert.equal(newProduct.defaultSalePrice, 150000000);
  assert.equal(createdProducts[0].status, 'ACTIVE', 'Initial product status must be ACTIVE');

  // Deactivate Product (Soft Delete)
  const deactivationResult = await executeServerDeleteProduct(mockSupabaseForProducts, 'org_test_1', newProduct.id);
  assert.equal(deactivationResult.success, true);
  assert.equal(updatedProducts[0].status, 'INACTIVE', 'Deletion must update status to INACTIVE');
  console.log('✅ [3/8] Server-side product create and soft-delete verified.\n');

  // --------------------------------------------------------------------------
  // Test 4: Server-Side Category & Measurement Unit Operations
  // --------------------------------------------------------------------------
  console.log('[4/8] Testing Server-Side Category & Measurement Unit Operations...');
  const catUpdates: any[] = [];
  const unitUpdates: any[] = [];

  const mockSupabaseMasterData: any = {
    from: (table: string) => {
      if (table === 'product_categories') {
        return {
          insert: (records: any) => ({
            select: () => ({
              single: async () => {
                const recData = Array.isArray(records) ? records[0] : records;
                return { data: { id: 'cat_1', ...recData }, error: null };
              }
            })
          }),
          update: (updates: any) => ({
            eq: (c1: string, v1: string) => ({
              eq: (c2: string, v2: string) => ({
                select: () => ({
                  single: async () => {
                    catUpdates.push(updates);
                    return { data: { id: v1, ...updates }, error: null };
                  }
                })
              })
            })
          }),
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [{ id: 'cat_1', title: 'لوازم جانبی', is_active: true }], error: null })
            })
          })
        };
      }
      if (table === 'measurement_units') {
        return {
          insert: (records: any) => ({
            select: () => ({
              single: async () => {
                const recData = Array.isArray(records) ? records[0] : records;
                return { data: { id: 'unit_1', ...recData }, error: null };
              }
            })
          }),
          update: (updates: any) => ({
            eq: (c1: string, v1: string) => ({
              eq: (c2: string, v2: string) => ({
                select: () => ({
                  single: async () => {
                    unitUpdates.push(updates);
                    return { data: { id: v1, ...updates }, error: null };
                  }
                })
              })
            })
          }),
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [{ id: 'unit_1', title: 'کیلوگرم', allows_fraction: true, decimal_places: 3, is_active: true }], error: null })
            })
          })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  // Category CRUD
  const cat = await executeServerCreateCategory(mockSupabaseMasterData, 'org_test_1', 'user_1', { title: 'لوازم جانبی' });
  assert.equal(cat.title, 'لوازم جانبی');
  await executeServerDeleteCategory(mockSupabaseMasterData, 'org_test_1', 'cat_1');
  assert.equal(catUpdates[0].is_active, false, 'Category delete must set is_active to false');

  // Unit CRUD
  const unit = await executeServerCreateMeasurementUnit(mockSupabaseMasterData, 'org_test_1', 'user_1', {
    title: 'کیلوگرم',
    allowsFraction: true,
    decimalPlaces: 3
  });
  assert.equal(unit.title, 'کیلوگرم');
  assert.equal(unit.allowsFraction, true);
  await executeServerDeleteMeasurementUnit(mockSupabaseMasterData, 'org_test_1', 'unit_1');
  assert.equal(unitUpdates[0].is_active, false, 'Unit delete must set is_active to false');
  console.log('✅ [4/8] Category and measurement unit CRUD and deactivation verified.\n');

  // --------------------------------------------------------------------------
  // Test 5: Client-Side ProductService API Layer
  // --------------------------------------------------------------------------
  console.log('[5/8] Testing ProductService Client Methods...');
  assert.equal(typeof ProductService.getProducts, 'function');
  assert.equal(typeof ProductService.getProductById, 'function');
  assert.equal(typeof ProductService.getNextProductCode, 'function');
  assert.equal(typeof ProductService.createProduct, 'function');
  assert.equal(typeof ProductService.updateProduct, 'function');
  assert.equal(typeof ProductService.deleteProduct, 'function');
  assert.equal(typeof ProductService.getCategories, 'function');
  assert.equal(typeof ProductService.createCategory, 'function');
  assert.equal(typeof ProductService.updateCategory, 'function');
  assert.equal(typeof ProductService.deleteCategory, 'function');
  assert.equal(typeof ProductService.getMeasurementUnits, 'function');
  assert.equal(typeof ProductService.createMeasurementUnit, 'function');
  assert.equal(typeof ProductService.updateMeasurementUnit, 'function');
  assert.equal(typeof ProductService.deleteMeasurementUnit, 'function');
  console.log('✅ [5/8] All ProductService client methods exist and are well-formed.\n');

  // --------------------------------------------------------------------------
  // Test 6: Hydration Resilience & Independence
  // --------------------------------------------------------------------------
  console.log('[6/8] Testing Hydration Resilience (Product failure does not wipe core financial data)...');
  let stateAccumulator: AppState = {
    users: [],
    persons: [],
    products: [{ id: 'p_existing', code: 'PRD-1', name: 'کالای قبلی', initialStock: 0, reorderPoint: 1, unit: 'عدد' } as any],
    productCategories: ['عمومی'],
    subsidiaries: {} as any,
    vouchers: [],
    checks: [],
    checkbooks: [],
    invoices: [],
    openingBalances: [],
    installmentBooks: [],
    installments: [],
    installmentRequests: [],
    installmentPlans: [],
    warehouses: [],
    warehouseTransfers: [],
    costCenters: [],
    bankTerminals: [],
    auditLogs: [],
    settings: {} as any,
    roles: [],
    permissions: [],
    rolePermissions: [],
    businessPartners: [],
    partnerCreditRequests: [],
    partnerSalesPlans: [],
    partnerOrders: [],
    partnerSettlements: [],
    calculators: [],
    projectNotes: [],
    creditFiles: [],
    creditPolicies: [],
    knowledgeCategories: [],
    knowledgeArticles: []
  };

  let status: FinancialSyncStatus = 'idle';
  let errorMsg = '';

  const mockServicesProductFail: any = {
    getPersons: async () => [{ id: 'person_1', name: 'علی رضایی', role: 'customer' }],
    getInvoices: async () => [{ id: 'inv_1', invoiceNumber: 101, items: [] }],
    getVouchers: async () => [{ id: 'v_1', voucherNumber: 1, entries: [] }],
    getCheques: async () => [{ id: 'chk_1', checkNumber: '123' }],
    getCalculators: async () => [{ id: 'calc_1', name: 'ماشین‌حساب بتا' }],
    // Product service fails
    getProducts: async () => { throw new Error('Product DB temporary network error'); },
    getCategories: async () => { throw new Error('Category service error'); },
    getMeasurementUnits: async () => []
  };

  const result = await executeFinancialHydration({
    generationId: 1,
    getCurrentGenerationId: () => 1,
    isLoggedIn: true,
    currentUserId: 'usr_1',
    currentUserRole: 'admin',
    organizationId: 'org_1',
    services: mockServicesProductFail,
    onSetState: (updater) => { stateAccumulator = updater(stateAccumulator); },
    onSetStatus: (s) => { status = s; },
    onSetError: (e) => { errorMsg = e; }
  });

  assert.equal(result.status, 'ready', 'Hydration must succeed even if products fail');
  assert.equal(stateAccumulator.persons.length, 1, 'Persons must be populated');
  assert.equal(stateAccumulator.invoices.length, 1, 'Invoices must be populated');
  assert.equal(stateAccumulator.vouchers.length, 1, 'Vouchers must be populated');
  assert.equal(stateAccumulator.checks.length, 1, 'Checks must be populated');
  assert.equal(stateAccumulator.calculators.length, 1, 'Calculators must be populated');
  assert.equal(errorMsg, '', 'No error should be shown for resilient hydration');
  console.log('✅ [6/8] Product service failure does not wipe core financial data.\n');

  // --------------------------------------------------------------------------
  // Test 7: Source Code Audit: No Direct saveAppState on Products/Categories in App.tsx
  // --------------------------------------------------------------------------
  console.log('[7/8] Auditing Source Code for Direct Local State Mutations...');
  const appTsx = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf-8');

  // Check handleSaveProduct does not contain saveAppState
  const saveProductRegex = /handleSaveProduct\s*=\s*async[\s\S]*?setIsAddingProduct\(false\);/m;
  const saveProductMatch = appTsx.match(saveProductRegex);
  assert(saveProductMatch, 'handleSaveProduct must be an async function');
  assert(!saveProductMatch[0].includes('saveAppState'), 'handleSaveProduct must NOT call saveAppState');
  assert(saveProductMatch[0].includes('ProductService.createProduct') || saveProductMatch[0].includes('ProductService.updateProduct'), 'handleSaveProduct must call ProductService');

  // Check handleDeleteProduct does not contain saveAppState
  const deleteProductRegex = /handleDeleteProduct\s*=\s*\([\s\S]*?setAppConfirmationModal\(\{[\s\S]*?onConfirm:\s*async[\s\S]*?ProductService\.deleteProduct/m;
  const deleteProductMatch = appTsx.match(deleteProductRegex);
  assert(deleteProductMatch, 'handleDeleteProduct must invoke ProductService.deleteProduct on confirm');

  // Check handleAddCategory and handleDeleteCategory
  assert(!appTsx.match(/handleAddCategory\s*=\s*\([^\)]*\)\s*=>\s*\{[\s\S]*?saveAppState/), 'handleAddCategory must NOT call saveAppState');
  assert(!appTsx.match(/handleDeleteCategory\s*=\s*\([^\)]*\)\s*=>\s*\{[\s\S]*?saveAppState/), 'handleDeleteCategory must NOT call saveAppState');
  console.log('✅ [7/8] Source code audit confirms all product and category mutations route through ProductService.\n');

  // --------------------------------------------------------------------------
  // Test 8: Migration Constraints & Atomic Functions Compliance (06 & 28)
  // --------------------------------------------------------------------------
  console.log('[8/10] Verifying Migration Constraints & Atomic Functions Compliance...');
  const migration06 = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/06_inventory_master_data.sql'), 'utf-8');
  assert(migration06.includes('CREATE TABLE IF NOT EXISTS public.products'), 'products table must be defined');
  assert(migration06.includes('CREATE TABLE IF NOT EXISTS public.product_categories'), 'product_categories table must be defined');
  assert(migration06.includes('CREATE TABLE IF NOT EXISTS public.measurement_units'), 'measurement_units table must be defined');
  assert(migration06.includes('CREATE TABLE IF NOT EXISTS public.product_code_sequences'), 'product_code_sequences table must be defined');
  assert(!migration06.includes('initial_stock'), 'products table must NOT contain initial_stock column');

  const migration28Path = path.join(process.cwd(), 'supabase/migrations/28_atomic_product_creation.sql');
  assert(fs.existsSync(migration28Path), 'Migration 28 must exist for atomic product creation');
  const migration28 = fs.readFileSync(migration28Path, 'utf-8');
  assert(migration28.includes('CREATE OR REPLACE FUNCTION public.create_product_atomic'), 'create_product_atomic function must be defined');
  assert(migration28.includes('CREATE OR REPLACE FUNCTION public.get_next_product_code_atomic'), 'get_next_product_code_atomic function must be defined');
  assert(migration28.includes('FOR UPDATE'), 'Atomic code generation must lock sequences row with FOR UPDATE');
  assert(migration28.includes('operation_key'), 'Atomic product creation must support operation_key idempotency');
  assert(migration28.includes('request_fingerprint'), 'Atomic product creation must support request_fingerprint verification');
  console.log('✅ [8/10] Migration 06 & 28 schema and atomic RPC constraints verified.\n');

  // --------------------------------------------------------------------------
  // Test 9: Zero LocalStorage Authority for Products & Categories in loadAppState / saveAppState
  // --------------------------------------------------------------------------
  console.log('[9/10] Verifying Zero LocalStorage Authority in loadAppState & saveAppState...');
  const accountingTs = fs.readFileSync(path.join(process.cwd(), 'src/utils/accounting.ts'), 'utf-8');
  assert(!accountingTs.includes("localStorage.setItem('accounting_products',"), 'saveAppState must NOT write to accounting_products');
  assert(!accountingTs.includes("localStorage.setItem('accounting_product_categories',"), 'saveAppState must NOT write to accounting_product_categories');
  assert(!accountingTs.includes("localStorage.getItem('accounting_products')"), 'loadAppState must NOT read from accounting_products');
  assert(!accountingTs.includes("localStorage.getItem('accounting_product_categories')"), 'loadAppState must NOT read from accounting_product_categories');
  console.log('✅ [9/10] loadAppState and saveAppState strictly decoupled from local product storage.\n');

  // --------------------------------------------------------------------------
  // Test 10: Atomic Server RPC Call Execution with Idempotency Support
  // --------------------------------------------------------------------------
  console.log('[10/10] Testing Atomic Server RPC Call Execution...');
  let rpcCalledWith: any = null;
  const mockSupabaseRpc: any = {
    from: () => ({
      select: () => {
        const chain: any = {
          eq: () => chain,
          maybeSingle: async () => ({ data: { id: 'cat_uuid_1', title: 'موبایل' }, error: null })
        };
        return chain;
      }
    }),
    rpc: async (funcName: string, params: any) => {
      rpcCalledWith = { funcName, params };
      if (funcName === 'create_product_atomic') {
        return {
          data: {
            id: 'prd_atomic_1',
            code: 'PRD-0088',
            name: params.p_name,
            category_id: params.p_category_id,
            measurement_unit_id: params.p_measurement_unit_id,
            product_kind: params.p_product_kind,
            is_serialized: params.p_is_serialized,
            reorder_point: params.p_reorder_point,
            default_sale_price_amount: params.p_default_sale_price_amount,
            status: params.p_status,
            version: 1,
            created_by: params.p_created_by,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            organization_id: params.p_organization_id,
            category: { id: 'cat_uuid_1', title: 'موبایل' },
            measurement_unit: { id: 'unit_uuid_1', title: 'عدد' }
          },
          error: null
        };
      }
      return { data: null, error: new Error('Unknown RPC') };
    }
  };

  const atomicProduct = await executeServerCreateProduct(mockSupabaseRpc, 'org_atomic_1', 'usr_admin', {
    name: 'لپ‌تاپ گیمینگ',
    categoryId: 'cat_uuid_1',
    measurementUnitId: 'unit_uuid_1',
    hasSerial: true,
    defaultSalePrice: 850000000,
    operationKey: 'op_test_key_123'
  });

  assert.equal(atomicProduct.id, 'prd_atomic_1');
  assert.equal(atomicProduct.name, 'لپ‌تاپ گیمینگ');
  assert.equal(rpcCalledWith.funcName, 'create_product_atomic');
  assert.equal(rpcCalledWith.params.p_operation_key, 'op_test_key_123');
  assert.equal(rpcCalledWith.params.p_is_serialized, true);
  console.log('✅ [10/10] Atomic Server RPC execution and parameter mapping validated.\n');

  console.log('================================================================');
  console.log('ALL INSTRUCTION 3 TESTS PASSED PERFECTLY (10/10)!');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
