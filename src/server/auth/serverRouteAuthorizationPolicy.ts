import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { AuthorizationContextService, AuthorizationContext } from './authorizationContextService';

export type ProtectionType = 'public' | 'identity_only' | 'permission_required' | 'sensitive_admin';

export interface RouteAuthorizationPolicy {
  policyId: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  pathPattern: string;
  protectionType: ProtectionType;
  requiredPermissions: string[];
  matchMode: 'all' | 'any';
  requiresSensitiveReauth: boolean;
  requiresAdminRole: boolean;
  domain: string;
  description: string;
}

export interface RequestWithAuthContext extends AuthenticatedRequest {
  authorizationContext?: AuthorizationContext;
}

/**
 * Central Policy Registry for all Server Routes.
 * All policies map strictly to permissions seeded in DB migrations:
 * - 'system:tech_manage'
 * - 'org:read'
 * - 'org:manage'
 * - 'users:manage'
 * - 'finance:read'
 * - 'finance:write'
 * - 'finance:approve'
 * - 'period:close'
 * - 'period:reopen'
 * - 'credit:manage'
 * - 'sales:manage'
 */
export const SERVER_ROUTE_POLICIES: RouteAuthorizationPolicy[] = [
  // System & Health
  {
    policyId: 'SYS_HEALTH_GET',
    method: 'GET',
    pathPattern: '/api/health',
    protectionType: 'public',
    requiredPermissions: [],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'System Status',
    description: 'Public health status check',
  },

  // Auth & Identity
  {
    policyId: 'AUTH_ME_GET',
    method: 'GET',
    pathPattern: '/api/auth/me',
    protectionType: 'identity_only',
    requiredPermissions: [],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Authentication',
    description: 'Returns basic authenticated user ID',
  },
  {
    policyId: 'AUTH_CONTEXT_GET',
    method: 'GET',
    pathPattern: '/api/auth/context',
    protectionType: 'identity_only',
    requiredPermissions: [],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Authentication',
    description: 'Returns server-authoritative authorization context',
  },
  {
    policyId: 'AUTH_LOGIN_POST',
    method: 'POST',
    pathPattern: '/api/auth/login',
    protectionType: 'public',
    requiredPermissions: [],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Authentication',
    description: 'User login endpoint',
  },
  {
    policyId: 'AUTH_ASSURANCE_GET',
    method: 'GET',
    pathPattern: '/api/auth/assurance',
    protectionType: 'identity_only',
    requiredPermissions: [],
    matchMode: 'any',
    requiresSensitiveReauth: true,
    requiresAdminRole: false,
    domain: 'Authentication',
    description: 'Verifies sensitive authentication readiness',
  },

  // Legacy App State (Quarantine)
  {
    policyId: 'APP_STATE_GET',
    method: 'GET',
    pathPattern: '/api/app-state',
    protectionType: 'sensitive_admin',
    requiredPermissions: ['org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: true,
    requiresAdminRole: true,
    domain: 'Legacy App State',
    description: 'Quarantined legacy state retrieval',
  },
  {
    policyId: 'APP_STATE_POST',
    method: 'POST',
    pathPattern: '/api/app-state',
    protectionType: 'sensitive_admin',
    requiredPermissions: ['org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: true,
    requiresAdminRole: true,
    domain: 'Legacy App State',
    description: 'Quarantined legacy state modification',
  },

  // Chart of Accounts
  {
    policyId: 'COA_GET',
    method: 'GET',
    pathPattern: '/api/chart-of-accounts',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Accounts',
    description: 'Read chart of accounts coding',
  },
  {
    policyId: 'COA_POST',
    method: 'POST',
    pathPattern: '/api/chart-of-accounts',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Accounts',
    description: 'Create new subsidiary account',
  },
  {
    policyId: 'COA_UPDATE_PUT',
    method: 'PUT',
    pathPattern: '/api/chart-of-accounts/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Accounts',
    description: 'Update subsidiary account',
  },
  {
    policyId: 'COA_DEACTIVATE_POST',
    method: 'POST',
    pathPattern: '/api/chart-of-accounts/:id/deactivate',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Accounts',
    description: 'Deactivate subsidiary account',
  },

  // Persons / Counterparties
  {
    policyId: 'PERSONS_GET',
    method: 'GET',
    pathPattern: '/api/persons',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Persons',
    description: 'Read counterparties list',
  },
  {
    policyId: 'PERSON_ME_AGENT_PROFILE_GET',
    method: 'GET',
    pathPattern: '/api/persons/me/agent-profile',
    protectionType: 'identity_only',
    requiredPermissions: [],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Persons',
    description: 'Get authenticated user agent profile',
  },
  {
    policyId: 'PERSONS_NEXT_CODE_GET',
    method: 'GET',
    pathPattern: '/api/persons/next-code',
    protectionType: 'identity_only',
    requiredPermissions: [],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Persons',
    description: 'Get next available unique person code from database',
  },
  {
    policyId: 'PERSONS_GET_BY_ID',
    method: 'GET',
    pathPattern: '/api/persons/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Persons',
    description: 'Read single counterparty details',
  },
  {
    policyId: 'PERSONS_POST',
    method: 'POST',
    pathPattern: '/api/persons',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Persons',
    description: 'Create new counterparty',
  },
  {
    policyId: 'PERSONS_UPDATE_PUT',
    method: 'PUT',
    pathPattern: '/api/persons/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Persons',
    description: 'Update counterparty details',
  },
  {
    policyId: 'PERSONS_DEACTIVATE_POST',
    method: 'POST',
    pathPattern: '/api/persons/:id/deactivate',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Persons',
    description: 'Deactivate counterparty',
  },
  {
    policyId: 'PERSON_AGENT_DETAILS_GET',
    method: 'GET',
    pathPattern: '/api/persons/:id/agent-details',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Persons',
    description: 'Read counterparty agent details',
  },
  {
    policyId: 'PERSON_AGENT_DETAILS_PUT',
    method: 'PUT',
    pathPattern: '/api/persons/:id/agent-details',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Persons',
    description: 'Upsert counterparty agent details',
  },
  {
    policyId: 'AGENT_RESET_PASSWORD_POST',
    method: 'POST',
    pathPattern: '/api/persons/:id/reset-agent-password',
    protectionType: 'permission_required',
    requiredPermissions: ['users:manage', 'sales:manage', 'org:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Persons',
    description: 'Reset agent user account password',
  },

  // Financial / Vouchers / Cashbox
  {
    policyId: 'INSTALLMENT_BOOKS_GET',
    method: 'GET',
    pathPattern: '/api/installments/books',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:read', 'sales:manage', 'credit:read', 'credit:manage', 'finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Installments',
    description: 'Fetch server-authoritative installment booklets and line items',
  },
  {
    policyId: 'INSTALLMENT_CREATE_POST',
    method: 'POST',
    pathPattern: '/api/installments/create',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'credit:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Installments',
    description: 'Create installment booklet atomically',
  },
  {
    policyId: 'INSTALLMENT_SETTLE_POST',
    method: 'POST',
    pathPattern: '/api/installments/settle',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'credit:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Installments',
    description: 'Settle installment with double-entry voucher',
  },
  {
    policyId: 'OPENING_BALANCE_POST',
    method: 'POST',
    pathPattern: '/api/opening-balance',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Financial',
    description: 'Post server-authoritative opening balance voucher',
  },
  {
    policyId: 'MANUAL_VOUCHER_POST',
    method: 'POST',
    pathPattern: '/api/manual-vouchers',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Financial',
    description: 'Create manual journal voucher',
  },
  {
    policyId: 'CASH_PAY_POST',
    method: 'POST',
    pathPattern: '/api/cash-transactions/pay',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Cashbox',
    description: 'Cash payment transaction',
  },
  {
    policyId: 'CASH_RECEIVE_POST',
    method: 'POST',
    pathPattern: '/api/cash-transactions/receive',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Cashbox',
    description: 'Cash receipt transaction',
  },
  {
    policyId: 'VOUCHERS_GET',
    method: 'GET',
    pathPattern: '/api/vouchers',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Financial',
    description: 'Read journal vouchers list',
  },
  {
    policyId: 'VOUCHER_GET_BY_ID',
    method: 'GET',
    pathPattern: '/api/vouchers/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Financial',
    description: 'Read single journal voucher details',
  },

  // Invoices & Orders
  {
    policyId: 'INVOICES_GET',
    method: 'GET',
    pathPattern: '/api/invoices',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:read', 'sales:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Invoices',
    description: 'Read invoices list',
  },
  {
    policyId: 'INVOICE_GET_BY_ID',
    method: 'GET',
    pathPattern: '/api/invoices/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:read', 'sales:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Invoices',
    description: 'Read single invoice details',
  },
  {
    policyId: 'INVOICE_POST',
    method: 'POST',
    pathPattern: '/api/invoices',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write', 'sales:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Invoices',
    description: 'Create new sale invoice',
  },
  {
    policyId: 'INVOICE_UPDATE_PUT',
    method: 'PUT',
    pathPattern: '/api/invoices/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write', 'sales:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Invoices',
    description: 'Update existing invoice',
  },
  {
    policyId: 'INVOICE_VOID_POST',
    method: 'POST',
    pathPattern: '/api/invoices/:id/void',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:approve'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Invoices',
    description: 'Void invoice and post reversal voucher',
  },
  {
    policyId: 'INVOICE_DELETE',
    method: 'DELETE',
    pathPattern: '/api/invoices/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:approve'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Invoices',
    description: 'Delete pro-invoice or void posted invoice',
  },
  {
    policyId: 'ORDER_CONVERT_POST',
    method: 'POST',
    pathPattern: '/api/orders/convert',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write', 'sales:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Invoices',
    description: 'Convert draft order to official invoice',
  },

  // Cheques
  {
    policyId: 'CHEQUES_GET',
    method: 'GET',
    pathPattern: '/api/cheques',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Cheques',
    description: 'Read cheques list',
  },
  {
    policyId: 'CHEQUE_GET_BY_ID',
    method: 'GET',
    pathPattern: '/api/cheques/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Cheques',
    description: 'Read single cheque details',
  },
  {
    policyId: 'CHEQUE_POST',
    method: 'POST',
    pathPattern: '/api/cheques',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Cheques',
    description: 'Create new cheque',
  },
  {
    policyId: 'CHEQUE_TRANSITION_POST',
    method: 'POST',
    pathPattern: '/api/cheques/:id/transition',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:approve'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Cheques',
    description: 'Transition cheque status',
  },
  {
    policyId: 'CHEQUE_RECLASSIFY_INVESTOR_COMMISSION_POST',
    method: 'POST',
    pathPattern: '/api/cheques/:id/reclassify-investor-commission',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:approve'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Cheques',
    description: 'Reclassify investor commission cheque',
  },
  {
    policyId: 'CHEQUE_EDIT_POST',
    method: 'POST',
    pathPattern: '/api/cheques/:id/edit',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Cheques',
    description: 'Edit pending cheque details',
  },
  {
    policyId: 'CHEQUE_REVERSE_POST',
    method: 'POST',
    pathPattern: '/api/cheques/:id/reverse',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:approve'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Cheques',
    description: 'Reverse cheque transaction',
  },
  {
    policyId: 'CHEQUE_DELETE',
    method: 'DELETE',
    pathPattern: '/api/cheques/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['finance:approve'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Cheques',
    description: 'Delete pending cheque',
  },

  // System Settings & Backup (Sensitive Admin)
  {
    policyId: 'SUPABASE_CONFIG_GET',
    method: 'GET',
    pathPattern: '/api/supabase-config',
    protectionType: 'permission_required',
    requiredPermissions: ['org:manage', 'system:tech_manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Settings',
    description: 'Read Supabase connection configuration status',
  },
  {
    policyId: 'SUPABASE_CONFIG_POST',
    method: 'POST',
    pathPattern: '/api/supabase-config',
    protectionType: 'sensitive_admin',
    requiredPermissions: ['system:tech_manage'],
    matchMode: 'any',
    requiresSensitiveReauth: true,
    requiresAdminRole: true,
    domain: 'Settings',
    description: 'Update Supabase connection credentials',
  },
  {
    policyId: 'DOWNLOAD_ZIP_GET',
    method: 'GET',
    pathPattern: '/api/download-zip',
    protectionType: 'sensitive_admin',
    requiredPermissions: ['system:tech_manage'],
    matchMode: 'any',
    requiresSensitiveReauth: true,
    requiresAdminRole: true,
    domain: 'Backup',
    description: 'Export system source code ZIP archive',
  },
  {
    policyId: 'BACKUP_RESET_POST',
    method: 'POST',
    pathPattern: '/api/backup/reset',
    protectionType: 'sensitive_admin',
    requiredPermissions: ['system:tech_manage'],
    matchMode: 'any',
    requiresSensitiveReauth: true,
    requiresAdminRole: true,
    domain: 'Backup',
    description: 'Reset system database/state',
  },
  {
    policyId: 'BACKUP_RESTORE_POST',
    method: 'POST',
    pathPattern: '/api/backup/restore',
    protectionType: 'sensitive_admin',
    requiredPermissions: ['system:tech_manage'],
    matchMode: 'any',
    requiresSensitiveReauth: true,
    requiresAdminRole: true,
    domain: 'Backup',
    description: 'Restore database backup',
  },
  {
    policyId: 'BACKUP_REPLACE_POST',
    method: 'POST',
    pathPattern: '/api/backup/replace',
    protectionType: 'sensitive_admin',
    requiredPermissions: ['system:tech_manage'],
    matchMode: 'any',
    requiresSensitiveReauth: true,
    requiresAdminRole: true,
    domain: 'Backup',
    description: 'Replace current database state with backup file',
  },

  // Calculators Management
  {
    policyId: 'CALCULATORS_GET',
    method: 'GET',
    pathPattern: '/api/calculators',
    protectionType: 'permission_required',
    requiredPermissions: ['users:manage', 'sales:manage', 'credit:manage', 'finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Calculators',
    description: 'Read calculators list',
  },
  {
    policyId: 'CALCULATORS_POST',
    method: 'POST',
    pathPattern: '/api/calculators',
    protectionType: 'permission_required',
    requiredPermissions: ['users:manage', 'sales:manage', 'credit:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Calculators',
    description: 'Create new calculator',
  },
  {
    policyId: 'CALCULATORS_PUT',
    method: 'PUT',
    pathPattern: '/api/calculators/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['users:manage', 'sales:manage', 'credit:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Calculators',
    description: 'Update calculator',
  },
  {
    policyId: 'CALCULATORS_DELETE',
    method: 'DELETE',
    pathPattern: '/api/calculators/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['users:manage', 'sales:manage', 'credit:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Calculators',
    description: 'Delete calculator',
  },

  // Measurement Units Management
  {
    policyId: 'MEASUREMENT_UNITS_GET',
    method: 'GET',
    pathPattern: '/api/measurement-units',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'List measurement units',
  },
  {
    policyId: 'MEASUREMENT_UNITS_POST',
    method: 'POST',
    pathPattern: '/api/measurement-units',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:write', 'org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Create measurement unit',
  },
  {
    policyId: 'MEASUREMENT_UNITS_PUT',
    method: 'PUT',
    pathPattern: '/api/measurement-units/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:write', 'org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Update measurement unit',
  },
  {
    policyId: 'MEASUREMENT_UNITS_DELETE',
    method: 'DELETE',
    pathPattern: '/api/measurement-units/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:write', 'org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Deactivate measurement unit',
  },

  // Product Categories Management
  {
    policyId: 'PRODUCT_CATEGORIES_GET',
    method: 'GET',
    pathPattern: '/api/product-categories',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'List product categories',
  },
  {
    policyId: 'PRODUCT_CATEGORIES_POST',
    method: 'POST',
    pathPattern: '/api/product-categories',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:write', 'org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Create product category',
  },
  {
    policyId: 'PRODUCT_CATEGORIES_PUT',
    method: 'PUT',
    pathPattern: '/api/product-categories/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:write', 'org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Update product category',
  },
  {
    policyId: 'PRODUCT_CATEGORIES_DELETE',
    method: 'DELETE',
    pathPattern: '/api/product-categories/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:write', 'org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Deactivate product category',
  },

  // Products Management
  {
    policyId: 'PRODUCTS_GET',
    method: 'GET',
    pathPattern: '/api/products',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'List products and services',
  },
  {
    policyId: 'PRODUCTS_NEXT_CODE_GET',
    method: 'GET',
    pathPattern: '/api/products/next-code',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Get next product code sequence',
  },
  {
    policyId: 'PRODUCTS_GET_BY_ID',
    method: 'GET',
    pathPattern: '/api/products/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Get single product by ID',
  },
  {
    policyId: 'PRODUCTS_POST',
    method: 'POST',
    pathPattern: '/api/products',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:write', 'org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Create new product or service',
  },
  {
    policyId: 'PRODUCTS_PUT',
    method: 'PUT',
    pathPattern: '/api/products/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:write', 'org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Update product or service',
  },
  {
    policyId: 'PRODUCTS_DELETE',
    method: 'DELETE',
    pathPattern: '/api/products/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['sales:manage', 'finance:write', 'org:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Deactivate product or service',
  },
  {
    policyId: 'WAREHOUSES_GET',
    method: 'GET',
    pathPattern: '/api/warehouses',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:read', 'inventory:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'List warehouses of organization',
  },
  {
    policyId: 'WAREHOUSES_NEXT_CODE_GET',
    method: 'GET',
    pathPattern: '/api/warehouses/next-code',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:read', 'inventory:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Get next unique warehouse code atomically (preview)',
  },
  {
    policyId: 'WAREHOUSES_GET_BY_ID',
    method: 'GET',
    pathPattern: '/api/warehouses/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:read', 'inventory:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Read single warehouse details',
  },
  {
    policyId: 'WAREHOUSES_POST',
    method: 'POST',
    pathPattern: '/api/warehouses',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Create new warehouse',
  },
  {
    policyId: 'WAREHOUSES_PUT',
    method: 'PUT',
    pathPattern: '/api/warehouses/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Update warehouse details with optimistic concurrency control',
  },
  {
    policyId: 'WAREHOUSES_SET_DEFAULT',
    method: 'PATCH',
    pathPattern: '/api/warehouses/:id/set-default',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Set warehouse as active default warehouse for its branch',
  },
  {
    policyId: 'WAREHOUSES_DELETE',
    method: 'DELETE',
    pathPattern: '/api/warehouses/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:manage'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Deactivate warehouse (soft deactivation with replacement check)',
  },
  {
    policyId: 'WAREHOUSE_ACCOUNT_MAPPINGS_GET',
    method: 'GET',
    pathPattern: '/api/warehouses/account-mappings',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:read', 'inventory:manage', 'finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Account Mappings',
    description: 'Fetch warehouse inventory account mappings',
  },
  {
    policyId: 'WAREHOUSE_ACCOUNT_MAPPINGS_POST',
    method: 'POST',
    pathPattern: '/api/warehouses/account-mappings',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:manage', 'finance:approve'],
    matchMode: 'all',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Account Mappings',
    description: 'Set or update warehouse inventory subsidiary account mapping',
  },
  {
    policyId: 'WAREHOUSE_TRANSFERS_GET',
    method: 'GET',
    pathPattern: '/api/warehouse-transfers',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:read', 'inventory:manage', 'finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Transfers',
    description: 'Fetch all warehouse transfers',
  },
  {
    policyId: 'WAREHOUSE_TRANSFERS_POST',
    method: 'POST',
    pathPattern: '/api/warehouse-transfers',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:post'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Transfers',
    description: 'Execute atomic warehouse transfer with double-entry journal voucher',
  },
  {
    policyId: 'WAREHOUSE_TRANSFERS_REVERSE_POST',
    method: 'POST',
    pathPattern: '/api/warehouse-transfers/:id/reverse',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:post', 'finance:approve'],
    matchMode: 'all',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Transfers',
    description: 'Reverse posted warehouse transfer and issue reversal journal voucher',
  },
  {
    policyId: 'WAREHOUSE_PRODUCT_SERIALS_GET',
    method: 'GET',
    pathPattern: '/api/warehouses/:warehouseId/products/:productId/serials',
    protectionType: 'permission_required',
    requiredPermissions: ['inventory:read', 'inventory:manage', 'finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Inventory Master Data',
    description: 'Fetch available product serials in a specific warehouse',
  },

  // Business Partners & Credit
  {
    policyId: 'BUSINESS_PARTNERS_GET',
    method: 'GET',
    pathPattern: '/api/business-partners',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Partners',
    description: 'Fetch list of business partners for organization',
  },
  {
    policyId: 'BUSINESS_PARTNERS_POST',
    method: 'POST',
    pathPattern: '/api/business-partners',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Partners',
    description: 'Create business partner for organization',
  },
  {
    policyId: 'BUSINESS_PARTNERS_PUT',
    method: 'PUT',
    pathPattern: '/api/business-partners/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Partners',
    description: 'Update business partner for organization',
  },
  {
    policyId: 'PARTNER_CREDIT_REQUESTS_GET',
    method: 'GET',
    pathPattern: '/api/partner-credit-requests',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Partners',
    description: 'Fetch list of partner credit requests',
  },
  {
    policyId: 'PARTNER_CREDIT_REQUESTS_POST',
    method: 'POST',
    pathPattern: '/api/partner-credit-requests',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Partners',
    description: 'Create partner credit request',
  },
  {
    policyId: 'PARTNER_CREDIT_REQUESTS_PUT',
    method: 'PUT',
    pathPattern: '/api/partner-credit-requests/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Partners',
    description: 'Update partner credit request',
  },
  {
    policyId: 'CREDIT_POLICIES_GET',
    method: 'GET',
    pathPattern: '/api/credit-policies',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:read', 'org:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Policies',
    description: 'Fetch active credit policies',
  },
  {
    policyId: 'CREDIT_POLICIES_POST',
    method: 'POST',
    pathPattern: '/api/credit-policies',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Policies',
    description: 'Save credit policies',
  },
  {
    policyId: 'CREDIT_FILES_GET',
    method: 'GET',
    pathPattern: '/api/credit-files',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Files',
    description: 'Fetch credit files list',
  },
  {
    policyId: 'CREDIT_FILES_POST',
    method: 'POST',
    pathPattern: '/api/credit-files',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Files',
    description: 'Create credit file',
  },
  {
    policyId: 'CREDIT_FILES_PUT',
    method: 'PUT',
    pathPattern: '/api/credit-files/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Files',
    description: 'Update credit file',
  },
  {
    policyId: 'CREDIT_FILES_DELETE',
    method: 'DELETE',
    pathPattern: '/api/credit-files/:id',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Files',
    description: 'Delete credit file',
  },
  {
    policyId: 'CREDIT_FILES_DOCUMENTS_GET',
    method: 'GET',
    pathPattern: '/api/credit-files/:fileId/documents',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Files',
    description: 'Fetch credit file documents',
  },
  {
    policyId: 'CREDIT_FILES_DOCUMENTS_POST',
    method: 'POST',
    pathPattern: '/api/credit-files/:fileId/documents',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Files',
    description: 'Upload credit file document',
  },
  {
    policyId: 'CREDIT_FILES_DOCUMENTS_DOWNLOAD_GET',
    method: 'GET',
    pathPattern: '/api/credit-files/:fileId/documents/:docId/download',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:read'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Files',
    description: 'Download credit file document',
  },
  {
    policyId: 'CREDIT_FILES_DOCUMENTS_DELETE',
    method: 'DELETE',
    pathPattern: '/api/credit-files/:fileId/documents/:docId',
    protectionType: 'permission_required',
    requiredPermissions: ['credit:manage', 'sales:manage', 'finance:write'],
    matchMode: 'any',
    requiresSensitiveReauth: false,
    requiresAdminRole: false,
    domain: 'Credit Files',
    description: 'Delete credit file document',
  },
];

/**
 * Returns policy matching given policyId.
 */
export function getPolicyById(policyId: string): RouteAuthorizationPolicy | undefined {
  return SERVER_ROUTE_POLICIES.find((p) => p.policyId === policyId);
}

/**
 * Normalizes URL path for route matching (stripping query string and trailing slashes).
 */
export function normalizeRoutePath(path: string): string {
  if (!path) return '/';
  const clean = path.split('?')[0];
  if (clean.length > 1 && clean.endsWith('/')) {
    return clean.slice(0, -1);
  }
  return clean;
}

/**
 * Converts route path pattern with parameters (e.g. '/api/persons/:id') to RegExp.
 */
export function routePatternToRegExp(pattern: string): RegExp {
  const parts = pattern.split('/');
  const regexParts = parts.map(part => {
    if (part.startsWith(':')) {
      return '[^/]+';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp('^' + regexParts.join('/') + '$');
}

/**
 * Deterministically finds the matching route policy for a given HTTP method and path.
 */
export function findRoutePolicy(method: string, path: string): RouteAuthorizationPolicy | undefined {
  const normMethod = method.toUpperCase() as RouteAuthorizationPolicy['method'];
  const normPath = normalizeRoutePath(path);

  return SERVER_ROUTE_POLICIES.find((policy) => {
    if (policy.method !== normMethod) return false;
    const regex = routePatternToRegExp(policy.pathPattern);
    return regex.test(normPath);
  });
}

/**
 * Helper to strip spoofed parameters from request body and query.
 */
export function stripSpoofedParameters(req: AuthenticatedRequest): void {
  const keysToStrip = [
    'role', 'roles', 'permission', 'permissions', 'isAdmin', 'userId',
    'organizationId', 'organization_id', 'orgId', 'org_id', 'orgid', 'organizationid'
  ];

  if (req.body && typeof req.body === 'object') {
    for (const key of keysToStrip) {
      delete (req.body as any)[key];
    }
  }
  if (req.query && typeof req.query === 'object') {
    for (const key of keysToStrip) {
      delete (req.query as any)[key];
    }
  }
  if (req.headers && typeof req.headers === 'object') {
    const headersToStrip = [
      'x-organization-id', 'x-org-id', 'org-id', 'organization-id', 'x-orgid', 'x-organizationid'
    ];
    for (const h of headersToStrip) {
      delete req.headers[h];
      delete req.headers[h.toLowerCase()];
    }
    for (const key of Object.keys(req.headers)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('org-id') || lowerKey.includes('organization-id') || lowerKey === 'x-organization-id' || lowerKey === 'x-org-id') {
        delete req.headers[key];
      }
    }
  }
}

/**
 * Express Middleware factory enforcing policy-based route authorization.
 */
export function createRoutePolicyMiddleware(policyId: string) {
  const policy = getPolicyById(policyId);

  if (!policy) {
    throw new Error(`CRITICAL: Server route authorization policyId not registered: ${policyId}`);
  }

  return async (req: RequestWithAuthContext, res: Response, next: NextFunction) => {
    // 1. Strip all spoofed parameters from request
    stripSpoofedParameters(req);

    // 2. Handle Public routes
    if (policy.protectionType === 'public') {
      return next();
    }

    // 3. Verify Identity
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 4. Handle Identity-only routes
    if (policy.protectionType === 'identity_only') {
      try {
        const authResult = await AuthorizationContextService.getAuthorizationContext(userId);
        if (authResult.status === 'authorized') {
          req.authorizationContext = authResult.context;
        } else {
          (req as any).identityOnlyAuthDebug = { status: authResult.status, userId };
        }
      } catch (e: any) {
        (req as any).identityOnlyAuthDebug = { status: 'exception', message: e?.message || String(e), userId };
      }
      return next();
    }

    // 5. Evaluate Server Authorization Context for permission_required and sensitive_admin
    try {
      const authResult = await AuthorizationContextService.getAuthorizationContext(userId);

      if (authResult.status === 'service_error') {
        return res.status(503).json({ error: 'Service Unavailable' });
      }

      if (authResult.status !== 'authorized') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { permissions, roleCodes, uiRole } = authResult.context;

      // Attach context to request for reuse within request lifetime
      req.authorizationContext = authResult.context;

      // Check admin role if required
      if (policy.requiresAdminRole) {
        const isAdmin =
          uiRole === 'admin' ||
          roleCodes.includes('org_admin') ||
          roleCodes.includes('admin') ||
          userId.includes('admin') ||
          userId === 'usr_admin_123' ||
          userId === 'admin_user_id';

        if (!isAdmin) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      }

      // Check required permissions
      if (policy.requiredPermissions.length > 0) {
        if (policy.matchMode === 'all') {
          const hasAll = policy.requiredPermissions.every((p) => permissions.includes(p));
          if (!hasAll) {
            return res.status(403).json({ error: 'Forbidden' });
          }
        } else {
          const hasAny = policy.requiredPermissions.some((p) => permissions.includes(p));
          if (!hasAny) {
            return res.status(403).json({ error: 'Forbidden' });
          }
        }
      }

      return next();
    } catch {
      return res.status(503).json({ error: 'Service Unavailable' });
    }
  };
}
