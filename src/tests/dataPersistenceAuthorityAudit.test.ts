/**
 * @file dataPersistenceAuthorityAudit.test.ts
 * @description Structural audit and guard test against uncatalogued persistence paths.
 * Enforces the Data Persistence Authority Matrix defined in docs/data-persistence-authority-matrix.md.
 */

process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Valid authority status classifications
export type AuthorityStatus =
  | 'DATABASE_AUTHORITATIVE' // پایگاه‌داده منبع قطعی
  | 'TRANSIENT_MEMORY_ALLOWED' // فقط حافظه موقت مجاز
  | 'BROWSER_STORAGE_BLOCKER' // حافظه مرورگر منبع اصلی و مانع
  | 'IN_MEMORY_ONLY_BLOCKER' // فقط حافظه موقت برنامه و مانع
  | 'DUAL_PATH_BLOCKER' // مسیر دوگانه و مانع
  | 'NO_PERSISTENCE_PATH'; // فاقد مسیر ذخیره‌سازی

/**
 * Authoritative field classification registry for AppState
 */
export const APP_STATE_AUTHORITY_REGISTRY: Record<string, {
  status: AuthorityStatus;
  persistedLocation: string;
  serverRoute?: string;
  dbTableOrRpc?: string;
}> = {
  users: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + auth.users',
    serverRoute: '/api/auth/*',
    dbTableOrRpc: 'users, memberships'
  },
  persons: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/persons',
    dbTableOrRpc: 'persons, person_roles, rpc_create_person'
  },
  products: {
    status: 'DATABASE_AUTHORITATIVE',
    persistedLocation: 'PostgreSQL DB (products, measurement_units, product_code_sequences)',
    serverRoute: '/api/products',
    dbTableOrRpc: 'products, product_code_sequences, rpc_create_product_atomic (migration 06/28)'
  },
  productCategories: {
    status: 'DATABASE_AUTHORITATIVE',
    persistedLocation: 'PostgreSQL DB (product_categories)',
    serverRoute: '/api/product-categories',
    dbTableOrRpc: 'product_categories (migration 06/28)'
  },
  subsidiaries: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/chart-of-accounts',
    dbTableOrRpc: 'subsidiary_accounts, rpc_create_subsidiary'
  },
  vouchers: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/vouchers, /api/manual-vouchers',
    dbTableOrRpc: 'journal_vouchers, voucher_entries, rpc_create_journal_voucher_draft'
  },
  checks: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/cheques',
    dbTableOrRpc: 'cheques, cheque_mutations, rpc_create_cheque'
  },
  checkbooks: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage',
    dbTableOrRpc: 'checkbooks (migration 19)'
  },
  invoices: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/invoices',
    dbTableOrRpc: 'invoices, invoice_items, rpc_create_invoice_atomic'
  },
  openingBalances: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/opening-balance',
    dbTableOrRpc: 'journal_vouchers, rpc_create_opening_balance_atomic'
  },
  installmentBooks: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/installments/create',
    dbTableOrRpc: 'installment_books, rpc_create_installment_book_atomic'
  },
  installments: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/installments/settle',
    dbTableOrRpc: 'installments, rpc_settle_installment_atomic'
  },
  installmentRequests: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage',
    dbTableOrRpc: 'installment_requests (migration 14)'
  },
  installmentPlans: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage',
    dbTableOrRpc: 'installment_plans (migration 14)'
  },
  warehouses: {
    status: 'DATABASE_AUTHORITATIVE',
    persistedLocation: 'PostgreSQL DB (warehouses, warehouse_code_sequences)',
    serverRoute: '/api/warehouses',
    dbTableOrRpc: 'warehouses, warehouse_code_sequences, rpc_create_warehouse_atomic (migration 06/29)'
  },
  warehouseTransfers: {
    status: 'DATABASE_AUTHORITATIVE',
    persistedLocation: 'PostgreSQL DB (inventory_transactions, inventory_transaction_items, warehouse_inventory_account_mappings)',
    serverRoute: '/api/warehouse-transfers',
    dbTableOrRpc: 'inventory_transactions, rpc_execute_warehouse_transfer_atomic (migration 07/30)'
  },
  costCenters: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage + central_app_state.json'
  },
  bankTerminals: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage + central_app_state.json'
  },
  auditLogs: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage + central_app_state.json',
    dbTableOrRpc: 'audit_logs'
  },
  settings: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage + central_app_state.json',
    serverRoute: '/api/app-state',
    dbTableOrRpc: 'app_state_store (migration 11)'
  },
  roles: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/auth/context',
    dbTableOrRpc: 'roles (migration 02)'
  },
  permissions: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/auth/context',
    dbTableOrRpc: 'permissions (migration 02)'
  },
  rolePermissions: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/auth/context',
    dbTableOrRpc: 'role_permissions (migration 02)'
  },
  knowledgeCategories: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (accounting_knowledge_categories)'
  },
  knowledgeArticles: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (accounting_knowledge_articles)'
  },
  knowledgeSteps: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (accounting_knowledge_steps)'
  },
  knowledgeErrors: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (accounting_knowledge_errors)'
  },
  knowledgeGlossary: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (accounting_knowledge_glossary)'
  },
  knowledgeVersions: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (accounting_knowledge_versions)'
  },
  businessPartners: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + DB',
    serverRoute: '/api/persons/:id/agent-details',
    dbTableOrRpc: 'business_partners (migration 27)'
  },
  partnerCreditRequests: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (accounting_partner_credit_requests)'
  },
  partnerSalesPlans: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (accounting_partner_sales_plans)'
  },
  partnerOrders: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage (accounting_partner_orders) + DB conversion',
    serverRoute: '/api/orders/convert',
    dbTableOrRpc: 'invoices (migration 18)'
  },
  partnerSettlements: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (accounting_partner_settlements)'
  },
  creditFiles: {
    status: 'DUAL_PATH_BLOCKER',
    persistedLocation: 'localStorage + Direct Supabase client',
    dbTableOrRpc: 'credit_files (migration 01)'
  },
  creditPolicies: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (accounting_credit_policies)'
  },
  calculators: {
    status: 'DATABASE_AUTHORITATIVE',
    persistedLocation: 'Server DB only',
    serverRoute: '/api/calculators',
    dbTableOrRpc: 'calculators'
  },
  partnerTickets: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state'
  },
  syncTests: {
    status: 'TRANSIENT_MEMORY_ALLOWED',
    persistedLocation: 'React in-memory state'
  },
  projectNotes: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (project_notes)'
  },
  nesyehCatalog: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state'
  },
  nesyehPurchaseOrders: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state'
  },
  nesyehPaymentDeclarations: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state'
  },
  creditControlDrafts: {
    status: 'TRANSIENT_MEMORY_ALLOWED',
    persistedLocation: 'React in-memory state'
  },
  investorProfiles: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state (sample mock generator)'
  },
  investorContracts: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state (sample mock generator)'
  },
  investorPaymentSchedules: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state (sample mock generator)'
  },
  investorPaymentObligations: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state (sample mock generator)'
  },
  investorReferrals: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state (sample mock generator)'
  },
  investorReturnRequests: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state (sample mock generator)'
  },
  investorAuditLogs: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state (sample mock generator)'
  },
  smsSettings: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage'
  },
  smsTemplates: {
    status: 'BROWSER_STORAGE_BLOCKER',
    persistedLocation: 'localStorage (smsTemplates)'
  },
  visitorProfiles: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state'
  },
  referrerNodes: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state'
  },
  visitorCommissions: {
    status: 'IN_MEMORY_ONLY_BLOCKER',
    persistedLocation: 'React in-memory state'
  },
};

/**
 * Audited list of known localStorage keys in the codebase
 */
export const AUDITED_LOCAL_STORAGE_KEYS = new Set([
  'accounting_initialized',
  'accounting_persons',
  'accounting_products',
  'accounting_product_categories',
  'accounting_subsidiaries',
  'accounting_vouchers',
  'accounting_checks',
  'accounting_invoices',
  'accounting_opening_balances',
  'accounting_installment_books',
  'accounting_installments_details',
  'accounting_installments',
  'accounting_installment_plans',
  'accounting_warehouses',
  'accounting_transfers',
  'accounting_cost_centers',
  'accounting_bank_terminals',
  'accounting_audit_logs',
  'accounting_settings',
  'accounting_roles',
  'accounting_permissions',
  'accounting_role_permissions',
  'accounting_users',
  'accounting_business_partners',
  'accounting_partner_credit_requests',
  'accounting_partner_sales_plans',
  'accounting_partner_orders',
  'accounting_partner_settlements',
  'project_notes',
  'accounting_credit_files',
  'accounting_credit_policies',
  'accounting_knowledge_categories',
  'accounting_knowledge_articles',
  'accounting_knowledge_steps',
  'accounting_knowledge_errors',
  'accounting_knowledge_glossary',
  'accounting_knowledge_versions',
  'smsTemplates',
  'smsEventsConfig',
  'sms_recovery_queue',
  'offline_sync_queue',
  'custom_supabase_config',
  'localStorage_emergency_backup_v1',
  'central_sync_last_time',
  'custom_banks',
  'AGENT_SYNC_TEST',
]);

/**
 * Recursively find all source files in a directory
 */
function findSourceFiles(dir: string, ext = ['.ts', '.tsx']): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
        results.push(...findSourceFiles(fullPath, ext));
      }
    } else if (entry.isFile() && ext.some(e => entry.name.endsWith(e))) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extract top-level field names from AppState interface in src/types.ts
 */
function extractAppStateFields(): string[] {
  const typesPath = path.resolve('src/types.ts');
  const content = fs.readFileSync(typesPath, 'utf-8');

  // Match the interface block
  const appStateMatch = content.match(/export\s+interface\s+AppState\s*\{([\s\S]*?)\n\}/);
  assert(appStateMatch, 'AppState interface must exist in src/types.ts');

  const body = appStateMatch[1];
  const lines = body.split('\n');
  const fields: string[] = [];

  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    // Only extract when at the top-level depth of AppState
    if (braceDepth === 0) {
      const fieldMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*\??\s*:/);
      if (fieldMatch) {
        fields.push(fieldMatch[1]);
      }
    }

    // Track braces
    for (const char of trimmed) {
      if (char === '{') braceDepth++;
      else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    }
  }

  return fields;
}

/**
 * Scan all non-test source files for localStorage literal keys
 */
function scanLocalStorageKeys(): { key: string; file: string; line: number }[] {
  const srcDir = path.resolve('src');
  const allFiles = findSourceFiles(srcDir).filter(f => !f.includes('/tests/'));
  const occurrences: { key: string; file: string; line: number }[] = [];

  const regex = /localStorage\s*\.\s*(?:getItem|setItem|removeItem)\s*\(\s*['"`]([a-zA-Z0-9_\-]+)['"`]/g;

  for (const file of allFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let match;
      while ((match = regex.exec(lines[i])) !== null) {
        occurrences.push({
          key: match[1],
          file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
          line: i + 1,
        });
      }
    }
  }

  return occurrences;
}

/**
 * Scan UI components for direct Supabase mutations (insert/update/delete/upsert)
 */
function scanDirectSupabaseClientMutations(): { file: string; line: number; table: string; operation: string }[] {
  const srcDir = path.resolve('src');
  const uiFiles = findSourceFiles(srcDir).filter(f => !f.includes('/tests/') && !f.includes('/server/'));
  const mutations: { file: string; line: number; table: string; operation: string }[] = [];

  const regex = /supabase\s*\.\s*from\s*\(\s*['"`]([a-zA-Z0-9_]+)['"`]\s*\)\s*\.\s*(insert|update|delete|upsert)\s*\(/g;

  for (const file of uiFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let match;
      while ((match = regex.exec(lines[i])) !== null) {
        mutations.push({
          file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
          line: i + 1,
          table: match[1],
          operation: match[2],
        });
      }
    }
  }

  return mutations;
}

/**
 * Scan for all saveAppState calls
 */
function scanSaveAppStateCalls(): { file: string; line: number }[] {
  const srcDir = path.resolve('src');
  const nonTestFiles = findSourceFiles(srcDir).filter(f => !f.includes('/tests/'));
  const calls: { file: string; line: number }[] = [];

  const regex = /\bsaveAppState\s*\(/g;

  for (const file of nonTestFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let match;
      while ((match = regex.exec(lines[i])) !== null) {
        calls.push({
          file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
          line: i + 1,
        });
      }
    }
  }

  return calls;
}

function runAuditTests() {
  console.log('================================================================');
  console.log('🧪 DATA PERSISTENCE AUTHORITY AUDIT & GUARD TEST (INSTRUCTION 1)');
  console.log('================================================================\n');

  // 1. Extract real AppState fields
  const extractedFields = extractAppStateFields();
  console.log(`[1/5] Extracted ${extractedFields.length} top-level fields from AppState in src/types.ts:`);
  console.log(`      ${extractedFields.join(', ')}\n`);

  assert(extractedFields.length > 0, 'AppState must contain fields');

  // 2. Verify all extracted fields are in the authority registry
  console.log('[2/5] Verifying every field in AppState has an explicit authority status...');
  const uncataloguedFields: string[] = [];

  for (const field of extractedFields) {
    if (!APP_STATE_AUTHORITY_REGISTRY[field]) {
      uncataloguedFields.push(field);
    }
  }

  if (uncataloguedFields.length > 0) {
    console.error('❌ FATAL: Uncatalogued AppState fields detected without persistence authority mapping:');
    uncataloguedFields.forEach(f => console.error(`   - ${f}`));
    assert.fail(`Found ${uncataloguedFields.length} uncatalogued fields in AppState.`);
  }

  // Verify reverse: no phantom fields in registry that don't exist in AppState
  const registryKeys = Object.keys(APP_STATE_AUTHORITY_REGISTRY);
  const phantomFields = registryKeys.filter(k => !extractedFields.includes(k));
  if (phantomFields.length > 0) {
    console.error('❌ FATAL: Registry contains fields not present in AppState:');
    phantomFields.forEach(f => console.error(`   - ${f}`));
    assert.fail(`Found ${phantomFields.length} phantom fields in authority registry.`);
  }

  console.log(`✅ 100% of AppState fields (${extractedFields.length}/${extractedFields.length}) are mapped to authoritative classifications.\n`);

  // Count by classification
  const counts: Record<AuthorityStatus, number> = {
    DATABASE_AUTHORITATIVE: 0,
    TRANSIENT_MEMORY_ALLOWED: 0,
    BROWSER_STORAGE_BLOCKER: 0,
    IN_MEMORY_ONLY_BLOCKER: 0,
    DUAL_PATH_BLOCKER: 0,
    NO_PERSISTENCE_PATH: 0,
  };

  for (const field of extractedFields) {
    const entry = APP_STATE_AUTHORITY_REGISTRY[field];
    counts[entry.status]++;
  }

  console.log('📊 AppState Field Classification Breakdown:');
  console.log(`   - DUAL_PATH_BLOCKER       (مسیر دوگانه و مانع)          : ${counts.DUAL_PATH_BLOCKER}`);
  console.log(`   - BROWSER_STORAGE_BLOCKER (حافظه مرورگر منبع اصلی و مانع): ${counts.BROWSER_STORAGE_BLOCKER}`);
  console.log(`   - IN_MEMORY_ONLY_BLOCKER  (فقط حافظه موقت برنامه و مانع): ${counts.IN_MEMORY_ONLY_BLOCKER}`);
  console.log(`   - TRANSIENT_MEMORY_ALLOWED(فقط حافظه موقت مجاز)         : ${counts.TRANSIENT_MEMORY_ALLOWED}`);
  console.log(`   - DATABASE_AUTHORITATIVE  (پایگاه‌داده منبع قطعی)        : ${counts.DATABASE_AUTHORITATIVE}`);
  console.log(`   - NO_PERSISTENCE_PATH     (فاقد مسیر ذخیره‌سازی)        : ${counts.NO_PERSISTENCE_PATH}`);
  console.log('');

  // 3. Audit localStorage keys across codebase
  console.log('[3/5] Auditing localStorage keys across all non-test source files...');
  const detectedLocalStorageCalls = scanLocalStorageKeys();
  const detectedKeys = new Set(detectedLocalStorageCalls.map(c => c.key));

  console.log(`      Detected ${detectedLocalStorageCalls.length} localStorage invocations across ${detectedKeys.size} unique keys.`);

  const uncataloguedStorageKeys: string[] = [];
  for (const key of detectedKeys) {
    if (!AUDITED_LOCAL_STORAGE_KEYS.has(key)) {
      uncataloguedStorageKeys.push(key);
    }
  }

  if (uncataloguedStorageKeys.length > 0) {
    console.error('❌ FATAL: Uncatalogued localStorage keys detected in codebase:');
    uncataloguedStorageKeys.forEach(k => console.error(`   - ${k}`));
    assert.fail(`Found ${uncataloguedStorageKeys.length} uncatalogued localStorage keys.`);
  }

  console.log(`✅ All ${detectedKeys.size} discovered localStorage keys are registered in the audited inventory.\n`);

  // 4. Audit direct Supabase mutations from UI
  console.log('[4/5] Auditing direct Supabase client mutations from UI components...');
  const directMutations = scanDirectSupabaseClientMutations();
  console.log(`      Detected ${directMutations.length} direct Supabase client mutation calls in UI files:`);

  directMutations.forEach(m => {
    console.log(`      • [${m.operation.toUpperCase()}] table '${m.table}' in ${m.file}:${m.line}`);
  });

  // Verify that all direct client mutations are catalogued against credit_files
  const nonCreditFileMutations = directMutations.filter(m => m.table !== 'credit_files');
  assert.equal(
    nonCreditFileMutations.length,
    0,
    `Only 'credit_files' table has legacy direct UI mutations, but found other tables: ${JSON.stringify(nonCreditFileMutations)}`
  );
  console.log(`✅ Direct UI Supabase mutations strictly isolated and documented for Step 2 remediation.\n`);

  // 5. Audit saveAppState invocations
  console.log('[5/5] Auditing saveAppState invocations across source files...');
  const saveCalls = scanSaveAppStateCalls();
  console.log(`      Detected ${saveCalls.length} calls to saveAppState in codebase.`);
  assert(saveCalls.length > 0, 'saveAppState calls must be detected and tracked');
  console.log(`✅ saveAppState invocations catalogued across components.\n`);

  // 6. Verify documentation file exists
  const matrixDocPath = path.resolve('docs/data-persistence-authority-matrix.md');
  assert(fs.existsSync(matrixDocPath), 'docs/data-persistence-authority-matrix.md must exist');
  const docContent = fs.readFileSync(matrixDocPath, 'utf-8');
  assert(docContent.includes('ماتریس مرجع مسیرهای ذخیره‌سازی'), 'Matrix doc header must be present');
  console.log('✅ Documentation file docs/data-persistence-authority-matrix.md verified.\n');

  // 7. Verify Operational Zero Reads/Writes for accounting_warehouses
  console.log('[6/6] Verifying 0 operational reads/writes for accounting_warehouses...');
  const accountingTsPath = path.resolve('src/utils/accounting.ts');
  const accountingTsContent = fs.readFileSync(accountingTsPath, 'utf-8');
  
  // Check that setItem('accounting_warehouses') is commented out / not active
  const activeWarehouseWrites = accountingTsContent.split('\n').filter(line => 
    !line.trim().startsWith('//') && line.includes("localStorage.setItem('accounting_warehouses'")
  );
  assert.equal(activeWarehouseWrites.length, 0, 'Operational writes to accounting_warehouses MUST be 0');

  // Check that getItem('accounting_warehouses') operational active read is not used to populate AppState
  const activeWarehouseReads = accountingTsContent.split('\n').filter(line => 
    !line.trim().startsWith('//') && line.includes("localStorage.getItem('accounting_warehouses')")
  );
  assert.equal(activeWarehouseReads.length, 0, 'Operational reads of accounting_warehouses MUST be 0');

  // Check 0 operational active reads & writes for accounting_transfers
  const activeTransferReads = accountingTsContent.split('\n').filter(line => 
    !line.trim().startsWith('//') && line.includes("localStorage.getItem('accounting_transfers')")
  );
  assert.equal(activeTransferReads.length, 0, 'Operational reads of accounting_transfers MUST be 0');

  const activeTransferWrites = accountingTsContent.split('\n').filter(line => 
    !line.trim().startsWith('//') && line.includes("localStorage.setItem('accounting_transfers'")
  );
  assert.equal(activeTransferWrites.length, 0, 'Operational writes of accounting_transfers MUST be 0');

  // Verify legacy keys are preserved in AUDITED_LOCAL_STORAGE_KEYS
  assert(AUDITED_LOCAL_STORAGE_KEYS.has('accounting_warehouses'), 'Legacy key accounting_warehouses must NOT be deleted from audited keys inventory');
  assert(AUDITED_LOCAL_STORAGE_KEYS.has('accounting_transfers'), 'Warehouse transfers key must remain in audited inventory');
  assert(APP_STATE_AUTHORITY_REGISTRY['warehouseTransfers'], 'warehouseTransfers must remain registered in authority registry');

  console.log('✅ Operational reads of accounting_warehouses: 0');
  console.log('✅ Operational writes of accounting_warehouses: 0');
  console.log('✅ Operational reads of accounting_transfers: 0');
  console.log('✅ Operational writes of accounting_transfers: 0');
  console.log('✅ Legacy keys accounting_warehouses and accounting_transfers preserved in audited inventory.\n');

  console.log('================================================================');
  console.log('🎉 AUDIT SUCCESS: Persistence Authority Matrix & Guard Validated!');
  console.log('================================================================');
}

runAuditTests();
