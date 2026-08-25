/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, ShoppingCart, Users, CreditCard, FileSpreadsheet, FileText, 
  UserPlus, PackagePlus, ArrowDownLeft, ArrowUpRight, TrendingUp, Sparkles, Plus, Calendar, Landmark,
  Menu, ArrowLeft, X, Search, Trash2, Edit2, Database, Download, Upload, Server, DollarSign, AlertTriangle, Package,
  Warehouse as WarehouseIcon, Target, History, BarChart3, CalendarClock, ChevronDown, List, Lock, ShieldCheck, ShieldAlert,
  ArrowRightLeft, Coins, BookOpen, FileCheck, ArrowRight, Calculator as CalculatorIcon, Shield, ShoppingBag, CheckSquare, Sliders,
  MessageSquare, RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  loadAppState, saveAppState, createInvoiceVoucher, updateCheckState, 
  getAvailableSerialNumbers, calculateSubsidiaryBalances, calculatePersonBalances, calculateProductStocks, DEFAULT_SUBSIDIARIES,
  parseNumericValue, toEnglishDigits, createAuditLog, checkCreditLimit, createTransferVoucher, createWarehouseTransferVoucher,
  createReverseVoucher, calculatePersistentCost, checkVoucherDeletionPolicy, getNextVoucherNumber, isValidCheckTransition,
  resolveInvoiceVoucher, isVoucherForInvoice
} from './utils/accounting';
import { getSupabase } from './lib/supabaseClient';
import { getCurrentJalaliDate } from './utils/jalali';
import { isValidNationalId, isUniqueNationalId } from './utils/validation';
import { ensurePartnerCreditRulesInSync, resolvePartnerCreditRules, deduplicateCreditFileVouchers } from './utils/partnerProcess';
import { generateUniquePersonCode } from './utils/codeGenerator';
import { 
  backupLocalStorageBeforeMigration, 
  fetchCentralAppState, 
  startLiveSync,
  pushAppStateToCentral
} from './services/centralSyncService';
import { PersonService } from './services/personService';
import { InvoiceService } from './services/invoiceService';
import { VoucherService } from './services/voucherService';
import { ChequeClientService, mapDbRecordToCheck } from './services/chequeService';
import { CalculatorService } from './services/calculatorService';
import { ProductService } from './services/productService';
import { WarehouseService } from './services/warehouseService';
import { CreditPartnerService } from './services/creditPartnerService';
import { InstallmentService } from './services/installmentService';
import { buildTransferFingerprint, buildReversalFingerprint } from './utils/idempotency';
import { 
  AppState, 
  Person, 
  Product, 
  Check, 
  CheckbookModel,
  CheckbookLeafModel,
  Invoice, 
  JournalVoucher, 
  VoucherEntry, 
  ReceivedCheckState, 
  PaidCheckState, 
  BouncedReceivedCheckSubState, 
  BouncedPaidCheckSubState, 
  AccountSubsidiary, 
  OpeningBalance, 
  Warehouse, 
  CostCenter, 
  WarehouseTransfer, 
  BankTerminal, 
  User, 
  CriticalDetails, 
  Calculator,
  KnowledgeArticle, 
  PartnerRole, 
  PartnerContractType,
  AgencyType,
  PartnerCreditRequest,
  CreditPolicy,
  CreditFile,
  ProjectNote,
  AgentCalculatorOverride,
  BusinessPartner
} from './types';

// Child components
import ProjectNotebook from './components/ProjectNotebook';
import PersonForm from './components/PersonForm';
import InvoiceForm from './components/InvoiceForm';
import CheckManager from './components/CheckManager';
import ManualVoucherForm from './components/ManualVoucherForm';
import ReportsView from './components/ReportsView';
import VoucherDetailModal from './components/VoucherDetailModal';
import CheckDetailModal from './components/CheckDetailModal';
import AccountsManager from './components/AccountsManager';
import CategoryManager from './components/CategoryManager';
import BackupManager from './components/BackupManager';
import AdvancedSearchModal from './components/AdvancedSearchModal';
import CashTransactionForm from './components/CashTransactionForm';
import AgentManager from './components/AgentManager';
import CentralPersonDirectory from './components/CentralPersonDirectory';
import InstallmentManager from './components/InstallmentManager';
import OpeningBalanceList from './components/OpeningBalanceList';
import OpeningBalanceForm from './components/OpeningBalanceForm';
import OpeningBalanceDetailModal from './components/OpeningBalanceDetailModal';
import InstallmentBookletManager from './components/InstallmentBookletManager';
import CentralCreditFileManager from './components/CentralCreditFileManager';
import { UserManager } from './components/UserManager';
import { RoleManager } from './components/RoleManager';
import { createOpeningBalanceVoucher } from './utils/accounting';
import CheckSettlementCalculator from './components/CheckSettlementCalculator';

import CriticalStatusPanel from './components/CriticalStatusPanel';
import PartnerDashboard from './components/PartnerDashboard';
import NesyehPartnerDashboard from './components/NesyehPartnerDashboard';
import { ProfitLossReport } from './components/ProfitLossReport';
import { BalanceSheetReport } from './components/BalanceSheetReport';
import { AgingReport } from './components/AgingReport';
import { WarehouseManager } from './components/WarehouseManager';
import { CostCenterManager } from './components/CostCenterManager';
import { AuditLogViewer } from './components/AuditLogViewer';
import { KnowledgeCenter } from './components/KnowledgeCenter';
import CreditCalculatorLab from './components/CreditCalculatorLab';
import CalculatorManagementCenter from './components/CalculatorManagementCenter';
import AgentTestEnvironment from './components/AgentTestEnvironment';
import { InvestorManagementCenter } from './modules/investors/components/InvestorManagementCenter';
import { InvestorVoucherDraftRequest } from './modules/investors/investorAccountingAdapter';

import { PartnerCreditRequestManager } from './components/PartnerCreditRequestManager';
import AgentDossierManager from './components/AgentDossierManager';
import { DataIntegrityEngine } from './utils/integrityEngine';
import SalesAgentCreditControl from './components/SalesAgentCreditControl';
import CreditControlApproval from './components/CreditControlApproval';
import { CreditPolicyManager } from './components/CreditPolicyManager';
import { SMSManagementCenter, globalFinancialEventAdapter } from './modules/sms';

import TopSyncBanner from './components/layout/TopSyncBanner';
import { SecureLoginPanel } from './components/auth/SecureLoginPanel';
import { AuthSessionService, getDefaultAuthSessionService } from './services/authSessionService';
import { getDefaultAuthContextService } from './services/authContextService';
import Sidebar from './components/layout/Sidebar';
import AppConfirmationModal from './components/modals/settings/AppConfirmationModal';
import InvoiceProfitLossModal from './components/modals/settings/InvoiceProfitLossModal';
import KnowledgeGuideModal from './components/modals/settings/KnowledgeGuideModal';
import { AgentCredentialsModal } from './components/AgentCredentialsModal';

function recalculateWalletBalances(persons: Person[], vouchers: JournalVoucher[]): Person[] {
  return persons.map(p => {
    if (!p.isAgent) return p;
    let balance = 0;
    vouchers.forEach(v => {
      v.entries.forEach(e => {
        if (e.subsidiaryId === 'SUB_PARTNER_WALLET' && e.floatingDetailed?.id === p.id) {
          balance += (e.credit || 0) - (e.debit || 0);
        }
      });
    });
    return {
      ...p,
      walletBalance: balance
    };
  });
}

type TabType = 'dashboard' | 'invoices' | 'people' | 'debtors' | 'creditors' | 'products' | 'checks' | 'reports' | 'accounts' | 'backup' | 'agents' | 'agent_checks' | 'installments' | 'opening_balances' | 'warehouses' | 'cost_centers' | 'audit_logs' | 'users' | 'knowledge_center' | 'partner_credit' | 'agent_dossiers' | 'calc_lab' | 'calc_management' | 'credit_control_agents' | 'agent_center' | 'credit_control_approval' | 'credit_policies' | 'agent_test_mode' | 'sms_management_center';

export type FinancialSyncStatus = 'idle' | 'loading' | 'ready' | 'error';

export const POST_MUTATION_HYDRATION_ERROR = 'عملیات در سرور ثبت شد، اما دریافت اطلاعات تازه ناموفق بود. برای جلوگیری از ثبت تکراری، عملیات را دوباره انجام ندهید و فقط دریافت اطلاعات را تکرار کنید.';
export const DEFAULT_HYDRATION_ERROR = 'اطلاعات مالی از سرور دریافت نشد. برای جلوگیری از نمایش اطلاعات قدیمی، داده‌های ذخیره‌شده روی این دستگاه نمایش داده نمی‌شوند.';

export interface FinancialHydrationServices {
  getPersons: () => Promise<Person[]>;
  getInvoices: () => Promise<Invoice[]>;
  getVouchers: () => Promise<JournalVoucher[]>;
  getCheques: () => Promise<Check[]>;
  getCalculators?: () => Promise<Calculator[]>;
  getProducts?: () => Promise<Product[]>;
  getCategories?: () => Promise<any[]>;
  getMeasurementUnits?: () => Promise<any[]>;
  getWarehouses?: () => Promise<Warehouse[]>;
  getTransfers?: () => Promise<any[]>;
  getInstallmentBooks?: () => Promise<any[]>;
  getBusinessPartners?: () => Promise<BusinessPartner[]>;
  getPartnerCreditRequests?: () => Promise<PartnerCreditRequest[]>;
  getCreditPolicies?: () => Promise<CreditPolicy[]>;
  getCreditFiles?: () => Promise<CreditFile[]>;
}

export interface FinancialHydrationParams {
  generationId: number;
  getCurrentGenerationId: () => number;
  isLoggedIn: boolean;
  currentUserId: string;
  currentUserRole: string | null;
  organizationId?: string | null;
  isPostMutation?: boolean;
  customErrorMessage?: string;
  services?: FinancialHydrationServices;
  onSetState: (updater: (prev: AppState) => AppState) => void;
  onSetStatus: (status: FinancialSyncStatus) => void;
  onSetError: (err: string) => void;
  onSetServerInvoiceIds?: (invoiceIds: string[]) => void;
}

export const isFinancialTab = (tab: string): boolean => {
  return ['invoices', 'people', 'debtors', 'creditors', 'checks', 'agent_checks', 'reports', 'accounts', 'opening_balances', 'installments'].includes(tab);
};

export const isTabAllowedForRole = (tab: string, role: string | null): boolean => {
  if (!role) return false;
  if (tab === 'knowledge_center' || tab === 'calc_lab' || tab === 'calc_management' || tab === 'credit_policies' || tab === 'agent_test_mode' || tab === 'sms_management_center') return true;
  if (role === 'admin' || role === 'agent') return true;
  if (role === 'accountant') return !['products', 'warehouses', 'opening_balances', 'backup', 'audit_logs'].includes(tab);
  if (role === 'cashier') return ['dashboard', 'people', 'checks', 'installments', 'reports'].includes(tab);
  if (role === 'seller') return ['dashboard', 'invoices', 'products', 'warehouses'].includes(tab);
  return false;
};

export async function executeFinancialHydration(params: FinancialHydrationParams): Promise<{ status: FinancialSyncStatus; error?: string; discarded?: boolean }> {
  const {
    generationId,
    getCurrentGenerationId,
    isLoggedIn,
    currentUserId,
    currentUserRole,
    organizationId,
    isPostMutation = false,
    customErrorMessage,
    services = {
      getPersons: () => PersonService.getPersons(),
      getInvoices: () => InvoiceService.getInvoices(),
      getVouchers: () => VoucherService.getVouchers(),
      getCheques: () => ChequeClientService.getCheques(),
      getCalculators: () => CalculatorService.getCalculators(),
      getProducts: () => ProductService.getProducts(),
      getCategories: () => ProductService.getCategories(),
      getMeasurementUnits: () => ProductService.getMeasurementUnits(),
      getWarehouses: () => WarehouseService.getWarehouses(),
      getTransfers: () => WarehouseService.getTransfers(),
      getInstallmentBooks: () => InstallmentService.getInstallmentBooks(),
      getBusinessPartners: () => CreditPartnerService.getBusinessPartners(),
      getPartnerCreditRequests: () => CreditPartnerService.getPartnerCreditRequests(),
      getCreditPolicies: () => CreditPartnerService.getCreditPolicies(),
      getCreditFiles: () => CreditPartnerService.getCreditFiles()
    },
    onSetState,
    onSetStatus,
    onSetError,
    onSetServerInvoiceIds
  } = params;

  if (!isLoggedIn || !currentUserId || !organizationId || !currentUserRole) {
    onSetStatus('idle');
    onSetError('');
    onSetServerInvoiceIds?.([]);
    onSetState(prev => ({
      ...prev,
      persons: [],
      invoices: [],
      vouchers: [],
      checks: [],
      calculators: [],
      products: [],
      warehouses: [],
      installmentBooks: [],
      installments: [],
      businessPartners: [],
      partnerCreditRequests: [],
      creditPolicies: [],
      creditFiles: []
    }));
    return { status: 'idle' };
  }

  onSetStatus('loading');
  onSetError('');
  onSetState(prev => ({
    ...prev,
    persons: [],
    invoices: [],
    vouchers: [],
    checks: [],
    calculators: [],
    products: [],
    warehouses: [],
    installmentBooks: [],
    installments: [],
    businessPartners: [],
    partnerCreditRequests: [],
    creditPolicies: [],
    creditFiles: []
  }));

  const failureErrorMsg = customErrorMessage || (isPostMutation ? POST_MUTATION_HYDRATION_ERROR : DEFAULT_HYDRATION_ERROR);

  try {
    const [
      personsRes,
      invoicesRes,
      vouchersRes,
      chequesRes,
      calculatorsRes,
      productsRes,
      categoriesRes,
      warehousesRes,
      transfersRes,
      installmentBooksRes,
      businessPartnersRes,
      partnerCreditRequestsRes,
      creditPoliciesRes,
      creditFilesRes
    ] = await Promise.allSettled([
      services.getPersons(),
      services.getInvoices(),
      services.getVouchers(),
      services.getCheques(),
      services.getCalculators ? services.getCalculators() : CalculatorService.getCalculators(),
      services.getProducts ? services.getProducts() : ProductService.getProducts(),
      services.getCategories ? services.getCategories() : ProductService.getCategories(),
      services.getWarehouses ? services.getWarehouses() : WarehouseService.getWarehouses(),
      services.getTransfers ? services.getTransfers() : WarehouseService.getTransfers(),
      services.getInstallmentBooks ? services.getInstallmentBooks() : InstallmentService.getInstallmentBooks(),
      services.getBusinessPartners ? services.getBusinessPartners() : CreditPartnerService.getBusinessPartners(),
      services.getPartnerCreditRequests ? services.getPartnerCreditRequests() : CreditPartnerService.getPartnerCreditRequests(),
      services.getCreditPolicies ? services.getCreditPolicies() : CreditPartnerService.getCreditPolicies(),
      services.getCreditFiles ? services.getCreditFiles() : CreditPartnerService.getCreditFiles()
    ]);

    if (generationId !== getCurrentGenerationId()) {
      console.log('[Hydration] Discarding stale financial fetch response for generation', generationId);
      return { status: 'loading', discarded: true };
    }

    const isCoreFinancialFulfilled = 
      personsRes.status === 'fulfilled' && Array.isArray(personsRes.value) &&
      invoicesRes.status === 'fulfilled' && Array.isArray(invoicesRes.value) &&
      vouchersRes.status === 'fulfilled' && Array.isArray(vouchersRes.value) &&
      chequesRes.status === 'fulfilled' && Array.isArray(chequesRes.value);

    if (isCoreFinancialFulfilled) {
      const dbPersons = personsRes.value;
      const dbInvoices = invoicesRes.value;
      const dbVouchers = vouchersRes.value;
      const dbCheques = chequesRes.value;
      const dbCalculators = (calculatorsRes.status === 'fulfilled' && Array.isArray(calculatorsRes.value))
        ? calculatorsRes.value
        : [];
      const dbProducts = (productsRes && productsRes.status === 'fulfilled' && Array.isArray(productsRes.value))
        ? productsRes.value
        : [];
      const dbCategories = (categoriesRes && categoriesRes.status === 'fulfilled' && Array.isArray(categoriesRes.value))
        ? categoriesRes.value.map((c: any) => c.title)
        : [];
      const dbWarehouses = (warehousesRes && warehousesRes.status === 'fulfilled' && Array.isArray(warehousesRes.value))
        ? warehousesRes.value
        : [];
      const dbTransfers = (transfersRes && transfersRes.status === 'fulfilled' && Array.isArray(transfersRes.value))
        ? transfersRes.value
        : [];
      const dbBooks = (installmentBooksRes && installmentBooksRes.status === 'fulfilled' && Array.isArray(installmentBooksRes.value))
        ? installmentBooksRes.value
        : [];
      const dbInstallmentLines = dbBooks.flatMap((b: any) => b.installments || []);

      const dbPartners = (businessPartnersRes && businessPartnersRes.status === 'fulfilled' && Array.isArray(businessPartnersRes.value))
        ? businessPartnersRes.value
        : [];
      const dbPartnerReqs = (partnerCreditRequestsRes && partnerCreditRequestsRes.status === 'fulfilled' && Array.isArray(partnerCreditRequestsRes.value))
        ? partnerCreditRequestsRes.value
        : [];
      const dbPolicies = (creditPoliciesRes && creditPoliciesRes.status === 'fulfilled' && Array.isArray(creditPoliciesRes.value))
        ? creditPoliciesRes.value
        : [];
      const dbFiles = (creditFilesRes && creditFilesRes.status === 'fulfilled' && Array.isArray(creditFilesRes.value))
        ? creditFilesRes.value
        : [];

      onSetServerInvoiceIds?.(dbInvoices.map(inv => inv.id));
      onSetState(prev => ({
        ...prev,
        persons: dbPersons,
        invoices: dbInvoices,
        vouchers: dbVouchers,
        checks: dbCheques,
        calculators: dbCalculators,
        products: dbProducts,
        productCategories: dbCategories,
        warehouses: dbWarehouses,
        warehouseTransfers: dbTransfers,
        installmentBooks: dbBooks,
        installments: dbInstallmentLines,
        businessPartners: dbPartners,
        partnerCreditRequests: dbPartnerReqs,
        creditPolicies: dbPolicies,
        creditFiles: dbFiles
      }));
      onSetStatus('ready');
      onSetError('');
      return { status: 'ready' };
    } else {
      onSetServerInvoiceIds?.([]);
      onSetState(prev => ({
        ...prev,
        persons: [],
        invoices: [],
        vouchers: [],
        checks: [],
        calculators: [],
        products: [],
        productCategories: [],
        warehouses: [],
        businessPartners: [],
        partnerCreditRequests: [],
        creditPolicies: [],
        creditFiles: []
      }));
      onSetStatus('error');
      onSetError(failureErrorMsg);
      return { status: 'error', error: failureErrorMsg };
    }
  } catch (err) {
    if (generationId !== getCurrentGenerationId()) {
      return { status: 'loading', discarded: true };
    }
    onSetServerInvoiceIds?.([]);
    onSetState(prev => ({
      ...prev,
      persons: [],
      invoices: [],
      vouchers: [],
      checks: [],
      calculators: [],
      products: [],
      warehouses: [],
      businessPartners: [],
      partnerCreditRequests: [],
      creditPolicies: [],
      creditFiles: []
    }));
    onSetStatus('error');
    onSetError(failureErrorMsg);
    return { status: 'error', error: failureErrorMsg };
  }
}

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const initialState: AppState = {
      users: [],
      persons: [],
      products: [],
      productCategories: ['موبایل', 'لپ‌تاپ', 'لوازم خانگی', 'خدمات'],
      subsidiaries: DEFAULT_SUBSIDIARIES,
      vouchers: [],
      checks: [],
      checkbooks: [],
      invoices: [],
      openingBalances: [],
      installmentBooks: [],
      installments: [],
      installmentRequests: [],
      installmentPlans: [
        { id: 'beta', name: 'طرح بتا (بازنشستگان)', interestRate: 2, penaltyRate: 4, maxTerm: 12, prepaymentPercent: 0, isActive: true },
        { id: 'gold', name: 'طرح وثیقه طلا', interestRate: 1.5, penaltyRate: 3, maxTerm: 24, prepaymentPercent: 10, isActive: true },
        { id: 'partner', name: 'ضمانت همکار', interestRate: 3, penaltyRate: 5, maxTerm: 10, prepaymentPercent: 20, isActive: true },
      ],
    warehouses: [],
    warehouseTransfers: [],
    costCenters: [],
    bankTerminals: [],
    auditLogs: [],
    businessPartners: [
      {
        id: 'BP_DEMO_1',
        agencyType: 'CREDIT_ONLY' as any,
        personId: 'p_c_1',
        status: 'active',
        roles: [PartnerRole.CREDIT_SALES_AGENT],
        profile: {
          partnerId: 'BP_DEMO_1',
          contractStatus: 'فعال',
          riskLevel: 'low',
          creditLimit: 500000000,
        },
        branches: [
          {
            id: 'BR_1_1',
            partnerId: 'BP_DEMO_1',
            name: 'شعبه مرکزی (تهران)',
            address: 'تهران، خیابان ولیعصر',
            phone: '021-88888888',
            managerName: 'علی رضایی',
            isActive: true,
            createdAt: new Date().toISOString()
          },
          {
            id: 'BR_1_2',
            partnerId: 'BP_DEMO_1',
            name: 'شعبه غرب',
            address: 'تهران، سعادت آباد',
            phone: '021-22222222',
            managerName: 'رضا علوی',
            isActive: true,
            createdAt: new Date().toISOString()
          }
        ],
        contract: {
          id: 'CON_1',
          partnerId: 'BP_DEMO_1',
          type: PartnerContractType.CREDIT_AGENT,
          startDate: '1402/01/01',
          status: 'active',
          creditLimit: 500000000,
          hasRepresentativeGuarantee: true,
          commissionRate: 2,
          createdAt: new Date().toISOString()
        },
        allowedCalculatorIds: ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI', 'CALC_BETA_MEHDI', 'CALC_BETA_MANSOURI', 'CALC_BETA_HAMID', 'CALC_BETA_JAFARI'],
        creditExtension: {
          allowedCalculators: ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI', 'CALC_BETA_MEHDI', 'CALC_BETA_MANSOURI', 'CALC_BETA_HAMID', 'CALC_BETA_JAFARI']
        },
        users: ['user_test_seller'],
        createdAt: new Date().toISOString(),
        createdBy: 'system'
      },
      {
        id: 'BP_agent_1',
        agencyType: 'INSTALLMENT_ONLY' as any,
        personId: 'agent_1',
        status: 'active',
        roles: ['DEFERRED_AGENT' as any],
        profile: {
          partnerId: 'BP_agent_1',
          partnerName: 'سهراب علوی',
          storeName: 'فروشگاه آنلاین سهراب',
          contractStatus: 'active',
          riskLevel: 'low',
          creditLimit: 150000000
        },
        nesyehOnboarding: {
          onboardingStatus: 'ACTIVE' as const,
          nesyehPartnerId: 'agent_link_1',
          linkCreatedAt: new Date().toISOString(),
          isLinkActive: true,
          guarantees: [],
          statusHistory: []
        },
        allowedCalculatorIds: ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI', 'CALC_BETA_MEHDI', 'CALC_BETA_MANSOURI', 'CALC_BETA_HAMID', 'CALC_BETA_JAFARI'],
        creditExtension: {
          allowedCalculators: ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI', 'CALC_BETA_MEHDI', 'CALC_BETA_MANSOURI', 'CALC_BETA_HAMID', 'CALC_BETA_JAFARI']
        },
        branches: [],
        users: ['user_agent_link_1'],
        createdAt: new Date().toISOString(),
        createdBy: 'system'
      },
      {
        id: 'BP_agent_2',
        agencyType: 'INSTALLMENT_ONLY' as any,
        personId: 'agent_2',
        status: 'active',
        roles: ['DEFERRED_AGENT' as any],
        profile: {
          partnerId: 'BP_agent_2',
          partnerName: 'نیلوفر مرادی',
          storeName: 'هایپر مارکت نیلوفر',
          contractStatus: 'active',
          riskLevel: 'medium',
          creditLimit: 150000000
        },
        nesyehOnboarding: {
          onboardingStatus: 'ACTIVE' as const,
          nesyehPartnerId: 'agent_link_2',
          linkCreatedAt: new Date().toISOString(),
          isLinkActive: true,
          guarantees: [],
          statusHistory: []
        },
        allowedCalculatorIds: ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI', 'CALC_BETA_MEHDI', 'CALC_BETA_MANSOURI', 'CALC_BETA_HAMID', 'CALC_BETA_JAFARI'],
        creditExtension: {
          allowedCalculators: ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI', 'CALC_BETA_MEHDI', 'CALC_BETA_MANSOURI', 'CALC_BETA_HAMID', 'CALC_BETA_JAFARI']
        },
        branches: [],
        users: ['user_agent_link_2'],
        createdAt: new Date().toISOString(),
        createdBy: 'system'
      },
      {
        id: 'BP_agent_3',
        agencyType: 'INSTALLMENT_ONLY' as any,
        personId: 'agent_3',
        status: 'active',
        roles: ['DEFERRED_AGENT' as any],
        profile: {
          partnerId: 'BP_agent_3',
          partnerName: 'کیوان صدری',
          storeName: '',
          contractStatus: 'active',
          riskLevel: 'low',
          creditLimit: 150000000
        },
        nesyehOnboarding: {
          onboardingStatus: 'ACTIVE' as const,
          nesyehPartnerId: 'agent_link_3',
          linkCreatedAt: new Date().toISOString(),
          isLinkActive: true,
          guarantees: [],
          statusHistory: []
        },
        allowedCalculatorIds: ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI', 'CALC_BETA_MEHDI', 'CALC_BETA_MANSOURI', 'CALC_BETA_HAMID', 'CALC_BETA_JAFARI'],
        creditExtension: {
          allowedCalculators: ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI', 'CALC_BETA_MEHDI', 'CALC_BETA_MANSOURI', 'CALC_BETA_HAMID', 'CALC_BETA_JAFARI']
        },
        branches: [],
        users: ['user_agent_link_3'],
        createdAt: new Date().toISOString(),
        createdBy: 'system'
      }
    ],
    partnerCreditRequests: [],
    creditFiles: [],
    creditPolicies: [
      { id: 'pol_1', title: 'اعتبار خرد (تا ۵۰ میلیون تومان)', minAmount: 0, maxAmount: 50000000, needsValidation: true, needsBackSignature: false, needsCollateral: false, needsGuarantorInfo: false, needsGuarantorValidation: false, needsAmaniCheck: false, amaniReminderDays: 10, isActive: true },
      { id: 'pol_2', title: 'اعتبار متوسط (۵۰ تا ۲۰۰ میلیون تومان)', minAmount: 50000001, maxAmount: 200000000, needsValidation: true, needsBackSignature: true, needsCollateral: false, needsGuarantorInfo: true, needsGuarantorValidation: true, needsAmaniCheck: false, amaniReminderDays: 10, isActive: true },
      { id: 'pol_3', title: 'اعتبار کلان (بیش از ۲۰۰ میلیون تومان)', minAmount: 200000001, maxAmount: 5000000000, needsValidation: true, needsBackSignature: true, needsCollateral: true, needsGuarantorInfo: true, needsGuarantorValidation: true, needsAmaniCheck: true, amaniReminderDays: 10, isActive: true },
    ],
    partnerOrders: [],
    partnerSalesPlans: [
      {
        id: 'PLAN_6M',
        name: 'طرح ۶ ماهه استاندارد',
        description: 'بازپرداخت ۶ ماهه با سود بانکی متعارف',
        isActive: true,
        minAmount: 10000000,
        maxAmount: 500000000,
        allowedTerms: [6],
        interestRate: 18,
        commissionRate: 20,
        paymentPeriods: [30]
      },
      {
        id: 'PLAN_12M',
        name: 'طرح ۱۲ ماهه بلند مدت',
        description: 'بازپرداخت یکساله برای خریدهای سرمایه‌ای',
        isActive: true,
        minAmount: 50000000,
        maxAmount: 1000000000,
        allowedTerms: [12],
        interestRate: 21,
        commissionRate: 15,
        paymentPeriods: [30, 60]
      },
      {
        id: 'PLAN_QUARTERLY',
        name: 'طرح فصلی (سه ماهه)',
        description: 'مناسب برای تامین کالای سریع',
        isActive: true,
        minAmount: 5000000,
        maxAmount: 200000000,
        allowedTerms: [3],
        interestRate: 15,
        commissionRate: 25,
        paymentPeriods: [30, 90]
      }
    ],
    settings: {
      inventoryValuationMethod: 'WEIGHTED_AVERAGE',
      defaultWarehouseId: 'DEFAULT',
      companyName: 'سیستم حسابداری هوشمند',
      sadiBazaarBaseRate: 7
    },
    calculators: [],
    projectNotes: []
    };
    
    const loaded = loadAppState();
    const sanitizedCalculators: Calculator[] = [];

    // Merge default subsidiaries if missing in loaded state
    const rawSubs = (loaded.subsidiaries && loaded.subsidiaries.length > 0) ? loaded.subsidiaries : DEFAULT_SUBSIDIARIES;
    const sanitizedSubs = [...rawSubs];
    DEFAULT_SUBSIDIARIES.forEach(defaultSub => {
      const idx = sanitizedSubs.findIndex(s => s.id === defaultSub.id);
      if (idx === -1) {
        sanitizedSubs.push(defaultSub);
      } else {
        const existing = sanitizedSubs[idx];
        if (
          existing.name !== defaultSub.name || 
          existing.code !== defaultSub.code || 
          existing.generalType !== defaultSub.generalType || 
          existing.groupType !== defaultSub.groupType
        ) {
          sanitizedSubs[idx] = { 
            ...existing, 
            name: defaultSub.name, 
            code: defaultSub.code, 
            generalType: defaultSub.generalType, 
            groupType: defaultSub.groupType 
          };
        }
      }
    });

    const rawState: AppState = {
      ...initialState,
      ...loaded,
      persons: [],
      invoices: [],
      vouchers: [],
      checks: [],
      products: [],
      productCategories: [],
      warehouses: [],
      businessPartners: (loaded.businessPartners && loaded.businessPartners.length > 0) ? loaded.businessPartners : initialState.businessPartners,
      partnerCreditRequests: loaded.partnerCreditRequests || initialState.partnerCreditRequests,
      partnerSalesPlans: loaded.partnerSalesPlans || initialState.partnerSalesPlans,
      creditFiles: loaded.creditFiles || initialState.creditFiles,
      creditPolicies: loaded.creditPolicies || initialState.creditPolicies,
      calculators: [],
      subsidiaries: sanitizedSubs,
      projectNotes: loaded.projectNotes || initialState.projectNotes
    };

    // Canonicalize calculator overrides across all business partners
    const canonicalPartners = rawState.businessPartners.map(bp => {
      if (!bp.calculatorOverrides) return bp;
      const newOverrides: Record<string, AgentCalculatorOverride> = {};

      const processOverride = (key: string, override: AgentCalculatorOverride) => {
        if (!override) return;
        const calcId = override.calculatorId || key;
        
        // Match exact ID first to prevent mismatching with different specific calculators of the same type
        let matchingCalc = sanitizedCalculators.find(c => c.id === key || c.id === calcId);
        if (!matchingCalc) {
          matchingCalc = sanitizedCalculators.find(c => c.type === key || c.type === calcId);
        }
        
        const targetId = matchingCalc ? matchingCalc.id : calcId;
        const targetType = matchingCalc?.type;

        const normalizedOverride = {
          ...override,
          calculatorId: targetId
        };

        newOverrides[targetId] = normalizedOverride;
        if (key) newOverrides[key] = normalizedOverride;
        if (targetType && targetType !== 'beta') {
          newOverrides[targetType] = normalizedOverride;
        }
      };

      if (Array.isArray(bp.calculatorOverrides)) {
        bp.calculatorOverrides.forEach((o: any) => {
          if (!o) return;
          processOverride(o.calculatorId, o);
        });
      } else {
        for (const [key, override] of Object.entries(bp.calculatorOverrides as Record<string, AgentCalculatorOverride>)) {
          processOverride(key, override);
        }
      }
      return {
        ...bp,
        calculatorOverrides: newOverrides
      };
    });

    const stateWithCanonicalOverrides = {
      ...rawState,
      businessPartners: canonicalPartners
    };

    // --- Hardcoded migration for Haji Hassan (P1004) ---
    const hajiHassanPerson = stateWithCanonicalOverrides.persons.find(p => 
      p.code === 'P1004' || (p.name && p.name.includes('حاجی حسن')) || (p.name && p.name.includes('صدری')) || (p.name && p.name.includes('حاج حسن'))
    );
    
    if (hajiHassanPerson) {
      const partners = [...stateWithCanonicalOverrides.businessPartners];
      let bpIndex = partners.findIndex(bp => bp.personId === hajiHassanPerson.id || bp.id === `BP_${hajiHassanPerson.id}`);
      
      let bp = bpIndex !== -1 ? { ...partners[bpIndex] } : {
        id: `BP_${hajiHassanPerson.id}`,
        personId: hajiHassanPerson.id,
        status: 'active',
        profile: {
          partnerId: `BP_${hajiHassanPerson.id}`,
          partnerName: hajiHassanPerson.name,
          storeName: hajiHassanPerson.name,
          contractStatus: 'active',
          riskLevel: 'low',
          creditLimit: 500000000
        },
        allowedCalculatorIds: ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI'],
        branches: [],
        users: [],
        createdAt: new Date().toISOString(),
        calculatorOverrides: {}
      } as BusinessPartner;

      let overrides = { ...(bp.calculatorOverrides as Record<string, AgentCalculatorOverride> || {}) };
      
      if (!overrides['CALC_SADI'] || overrides['CALC_SADI'].baseRatePercent !== 25) {
        const newOverride: AgentCalculatorOverride = {
          calculatorId: 'CALC_SADI',
          baseRatePercent: 25,
          isActive: true
        };
        overrides['CALC_SADI'] = newOverride;
        overrides['sadi_bazaar'] = newOverride;
        
        bp.calculatorOverrides = overrides;
        
        if (bpIndex !== -1) {
          partners[bpIndex] = bp;
        } else {
          partners.push(bp);
        }
        
        stateWithCanonicalOverrides.businessPartners = partners;
      }
    }
    // --------------------------------------------------

    const migrationResult = ensurePartnerCreditRulesInSync(stateWithCanonicalOverrides);
    return deduplicateCreditFileVouchers(migrationResult.updatedState);
  });

  const handleUpdateState = (newStateOrUpdater: AppState | ((prev: AppState) => AppState)) => {
    setState((prev) => {
      const resolvedState = typeof newStateOrUpdater === 'function' ? (newStateOrUpdater as Function)(prev) : newStateOrUpdater;
      const deduplicatedState = deduplicateCreditFileVouchers(resolvedState);
      saveAppState(deduplicatedState);
      return deduplicatedState;
    });
  };

  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [peopleSubTab, setPeopleSubTab] = useState<'central' | 'debtors' | 'debtors_installment' | 'creditors' | 'agents'>('central');
  const [currentUserRole, setCurrentUserRole] = useState<'admin' | 'accountant' | 'cashier' | 'seller' | 'agent' | null>(null);
  const [currentAgentId, setCurrentAgentId] = useState<string>('');
  
  // Server-Authoritative Financial Hydration State
  const [financialSyncStatus, setFinancialSyncStatus] = useState<FinancialSyncStatus>('idle');
  const [financialSyncError, setFinancialSyncError] = useState<string>('');
  const financialFetchGenerationRef = useRef<number>(0);
  const serverPersistedInvoiceIdsRef = useRef<Set<string>>(new Set<string>());

  // Real Login & Authentication State
  const authSessionService = useMemo(() => getDefaultAuthSessionService(), []);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [loginUsername, setLoginUsername] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [agentNationalId, setAgentNationalId] = useState<string>('');
  const [agentCredentialsModalData, setAgentCredentialsModalData] = useState<{
    name: string;
    loginIdentifier: string;
    password?: string;
  } | null>(null);

  // Operational Idempotency Guard & Processing Lock Refs
  const activeCheckOpLocks = useRef<Set<string>>(new Set());
  const completedCheckOps = useRef<Map<string, number>>(new Map());

  // Central Permission Guard for Check Operations
  const checkCheckOperationPermission = (
    action: 'CREATE' | 'APPROVE' | 'UPDATE_STATE' | 'VOID' | 'EDIT',
    check?: Check,
    _checkData?: any
  ): { allowed: boolean; reason?: string } => {
    if (currentUserRole === 'agent') {
      if (action === 'APPROVE') {
        return { allowed: false, reason: 'تأیید نهایی چک‌ها فقط توسط مدیر سیستم یا حسابدار مجاز است.' };
      }
      if (action === 'VOID') {
        return { allowed: false, reason: 'ابطال رسمی چک فقط توسط مدیر سیستم یا مدیر مالی مجاز است.' };
      }
      if (check && check.submittedByAgentId && check.submittedByAgentId !== currentAgentId) {
        return { allowed: false, reason: 'شما فقط به چک‌های ثبت‌شده توسط حوزه نمایندگی خود دسترسی دارید.' };
      }
    }

    if (currentUserRole === 'cashier') {
      if (action === 'VOID') {
        return { allowed: false, reason: 'کاربر تحویل‌دار اجازه ابطال چک را ندارد.' };
      }
    }

    if (currentUserRole === 'seller') {
      if (action === 'APPROVE' || action === 'VOID') {
        return { allowed: false, reason: 'فروشنده اجازه اجرای این عملیات روی چک را ندارد.' };
      }
    }

    return { allowed: true };
  };

  const acquireCheckOpLock = (opKey: string): { acquired: boolean; reason?: string } => {
    if (activeCheckOpLocks.current.has(opKey)) {
      return { acquired: false, reason: '⚠️ این عملیات روی چک هم‌اکنون در حال پردازش توسط سیستم است. لطفاً چند لحظه شکیبا باشید.' };
    }
    const lastDoneTime = completedCheckOps.current.get(opKey);
    if (lastDoneTime && (Date.now() - lastDoneTime) < 30000) {
      return { acquired: false, reason: '⚠️ این عملیات قبلاً با موفقیت پردازش شده و از ثبت تکراری مسدود گردید.' };
    }
    activeCheckOpLocks.current.add(opKey);
    return { acquired: true };
  };

  const releaseCheckOpLock = (opKey: string, markSuccess = true) => {
    activeCheckOpLocks.current.delete(opKey);
    if (markSuccess) {
      completedCheckOps.current.set(opKey, Date.now());
    }
  };
  
  const pendingAgentsCount = useMemo(() => {
    return state.persons.filter(p => p.isAgent && !p.isDocumentsApproved).length;
  }, [state.persons]);
  
  const [selectedPersonForCritical, setSelectedPersonForCritical] = useState<Person | null>(null);

  // Real auth session initialization and verification on app load
  useEffect(() => {
    let isMounted = true;
    const verifyInitialSession = async () => {
      try {
        const result = await authSessionService.verifySessionWithServer();
        if (!isMounted) return;
        if (result.status === 'authenticated' && result.userId) {
          const cleanUserId = result.userId.trim();
          setCurrentUserId(cleanUserId);
          setCurrentUser({ id: cleanUserId, role: null } as any);
          setIsLoggedIn(true);

          const contextRes = await getDefaultAuthContextService().fetchAuthContext(cleanUserId);
          if (!isMounted) return;
          if (contextRes.status === 'authorized' && contextRes.context.userId === cleanUserId) {
            setCurrentUserRole(contextRes.context.uiRole);
          } else {
            setCurrentUserRole(null);
          }
        } else {
          getDefaultAuthContextService().clear();
          setCurrentUserId('');
          setCurrentUser(null);
          setCurrentUserRole(null);
          setIsLoggedIn(false);
        }
      } catch {
        if (!isMounted) return;
        getDefaultAuthContextService().clear();
        setCurrentUserId('');
        setCurrentUser(null);
        setCurrentUserRole(null);
        setIsLoggedIn(false);
      }
    };

    verifyInitialSession();
    return () => {
      isMounted = false;
    };
  }, [authSessionService]);

  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const isApplyingRemoteSyncRef = useRef<boolean>(false);

  const [syncStatus, setSyncStatus] = useState<{ connected: boolean; syncing: boolean; lastSyncTime: string | null }>({
    connected: false,
    syncing: false,
    lastSyncTime: null
  });

  // Automatically push state to central server on local changes
  useEffect(() => {
    if (isInitialLoading) return;
    if (isApplyingRemoteSyncRef.current) {
      isApplyingRemoteSyncRef.current = false;
      return;
    }
    pushAppStateToCentral(state);
  }, [state, isInitialLoading]);

  // Central Supabase Sync & Backup Initialization
  useEffect(() => {
    // 1. Perform emergency backup of localStorage
    backupLocalStorageBeforeMigration();

    // 2. Fetch central state from Express server or Supabase on startup
    fetchCentralAppState().then((res) => {
      if (res && res.state) {
        console.log('Central AppState loaded from central store:', res.timestamp, 'source:', res.source);
        isApplyingRemoteSyncRef.current = true;
        setState((prev) => {
          const merged = { ...prev, ...res.state };
          
          // Enforce that relational financial entities are NEVER injected from central state JSON
          merged.persons = prev.persons;
          merged.invoices = prev.invoices;
          merged.vouchers = prev.vouchers;
          merged.journalVouchers = prev.journalVouchers || prev.vouchers;
          merged.checks = prev.checks;

          if (prev.businessPartners && res.state.businessPartners) {
            merged.businessPartners = res.state.businessPartners.map(remoteBp => {
              const localBp = prev.businessPartners.find(lbp => lbp.id === remoteBp.id);
              if (localBp && localBp.calculatorOverrides && Object.keys(localBp.calculatorOverrides).length > 0) {
                 // Preserve local overrides if remote lacks them (due to central sync lag)
                 if (!remoteBp.calculatorOverrides || Object.keys(remoteBp.calculatorOverrides).length === 0) {
                    return { ...remoteBp, calculatorOverrides: localBp.calculatorOverrides };
                 }
              }
              return remoteBp;
            });
            
            // Also ensure we don't lose local BPs that haven't synced yet
            prev.businessPartners.forEach(localBp => {
              if (!merged.businessPartners.find(rbp => rbp.id === localBp.id)) {
                 merged.businessPartners.push(localBp);
              }
            });
          }

          const migrationResult = ensurePartnerCreditRulesInSync(merged);
          return migrationResult.updatedState;
        });
      }
    }).finally(() => {
      setIsInitialLoading(false);
    });

    // 3. Start live sync channel & polling for multi-device test
    const stopSync = startLiveSync(
      (remoteState) => {
        isApplyingRemoteSyncRef.current = true;
        setState((prev) => {
          const merged = { 
            ...prev, 
            ...remoteState, 
            persons: prev.persons, 
            invoices: prev.invoices, 
            vouchers: prev.vouchers, 
            journalVouchers: prev.journalVouchers,
            checks: prev.checks
          };
          const migrationResult = ensurePartnerCreditRulesInSync(merged);
          return migrationResult.updatedState;
        });
      },
      (status) => {
        setSyncStatus(status);
      }
    );

    return () => {
      stopSync();
    };
  }, []);

  // Atomic Server-Authoritative Financial Hydration
  const loadServerAuthoritativeFinancialData = async (generationId: number, isPostMutation = false, customErrorMessage?: string) => {
    const authCtx = getDefaultAuthContextService().getAuthContext();
    return await executeFinancialHydration({
      generationId,
      getCurrentGenerationId: () => financialFetchGenerationRef.current,
      isLoggedIn,
      currentUserId,
      currentUserRole,
      organizationId: authCtx?.organizationId,
      isPostMutation,
      customErrorMessage,
      onSetState: setState,
      onSetStatus: setFinancialSyncStatus,
      onSetError: setFinancialSyncError,
      onSetServerInvoiceIds: (ids: string[]) => {
        serverPersistedInvoiceIdsRef.current = new Set(ids);
      }
    });
  };

  const authOrgId = getDefaultAuthContextService().getAuthContext()?.organizationId;

  useEffect(() => {
    if (!isLoggedIn || !currentUserId || !currentUserRole) {
      setFinancialSyncStatus('idle');
      setFinancialSyncError('');
      serverPersistedInvoiceIdsRef.current.clear();
      setState(prev => ({
        ...prev,
        persons: [],
        invoices: [],
        vouchers: [],
        checks: [],
        calculators: []
      }));
      return;
    }

    const authCtx = getDefaultAuthContextService().getAuthContext();
    if (!authCtx || !authCtx.organizationId) {
      setFinancialSyncStatus('idle');
      serverPersistedInvoiceIdsRef.current.clear();
      return;
    }

    serverPersistedInvoiceIdsRef.current.clear();
    const nextGen = ++financialFetchGenerationRef.current;
    loadServerAuthoritativeFinancialData(nextGen);
  }, [isLoggedIn, currentUserId, currentUserRole, authOrgId]);

  // Synchronize agent login to find the correct currentUserId
  const [isAuthInitialized, setIsAuthInitialized] = useState(false);

  // Force Haji Hassan migration to be saved to localStorage immediately on load
  useEffect(() => {
    if (isInitialLoading) return;
    const hajiHassanPerson = state.persons.find(p => 
      p.code === 'P1004' || p.name.includes('حاجی حسن') || p.name.includes('صدری')
    );
    if (hajiHassanPerson) {
      const bp = state.businessPartners?.find(b => b.personId === hajiHassanPerson.id || b.id === `BP_${hajiHassanPerson.id}`);
      if (bp && bp.calculatorOverrides && (bp.calculatorOverrides as any)['CALC_SADI']?.baseRatePercent === 25) {
        // If it exists in state, make sure it's fully pushed to localStorage
        saveAppState(state);
      }
    }
  }, [state, isInitialLoading]);

  useEffect(() => {
    if (isInitialLoading) return;
    if (!isLoggedIn || currentUserRole !== 'agent') return;
    if (isAuthInitialized) return;

    const activeToken = currentAgentId;

    if (activeToken) {
      const cleanToken = activeToken.trim();
      const cleanId = cleanToken.replace('BP_', '');
      const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      const urlName = urlParams.get('name') || urlParams.get('agent_name');
      const urlStore = urlParams.get('store') || urlParams.get('store_name') || urlParams.get('storeName');
      const targetUserId = `user_${cleanToken}`;

      // A. Try to find the BusinessPartner record first
      const existingBp = state.businessPartners?.find(bp => 
        bp.id === cleanToken ||
        bp.personId === cleanToken ||
        bp.nesyehOnboarding?.nesyehPartnerId === cleanToken ||
        bp.profile?.partnerId === cleanToken
      );

      // B. Try to find the Person record using the bp personId or clean token / cleanId
      const existingPerson = state.persons?.find(p => 
        p.id === cleanToken || 
        p.id === cleanId || 
        p.id === `p_${cleanId.replace('p_', '')}` ||
        p.agentDetails?.agentToken === cleanToken ||
        p.code === cleanToken ||
        (existingBp && p.id === existingBp.personId)
      );

      const resolvedName = existingPerson?.name || urlName || "نماینده فروش";
      const resolvedStore = existingBp?.profile?.storeName || existingPerson?.agentDetails?.storeName || urlStore || "";
      const defaultCalcIds = ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI', 'CALC_BETA_MEHDI', 'CALC_BETA_MANSOURI', 'CALC_BETA_HAMID', 'CALC_BETA_JAFARI'];

      // 2. State update to inject/update Person, User, and BusinessPartner
      setState(prev => {
        const engine = DataIntegrityEngine.getInstance();
        let runningState = { ...prev };

        // A. Update or Create Person
        const pIdx = runningState.persons.findIndex(p => 
          p.id === cleanToken || p.id === cleanId || p.id === `p_${cleanId.replace('p_', '')}` || (existingBp && p.id === existingBp.personId)
        );

        if (pIdx !== -1) {
          const personToUpdate = runningState.persons[pIdx];
          const personUpdates = {
            isAgent: true,
            name: (personToUpdate.name && personToUpdate.name !== 'نماینده فروش') ? personToUpdate.name : resolvedName
          };
          const personResult = engine.updatePerson(personToUpdate.id, personUpdates, runningState);
          if (personResult.success) {
            runningState = personResult.updatedState;
          }
        } else {
          const newPerson: Person = {
            id: cleanToken,
            code: `P_${cleanId}`,
            name: resolvedName,
            isAgent: true,
            agentDetails: {
              storeName: resolvedStore
            },
            role: 'creditor',
            createdAt: new Date().toISOString()
          };
          const personResult = engine.createPerson(newPerson, runningState);
          if (personResult.success) {
            runningState = personResult.updatedState;
          }
        }

        // B. Inject/Update User
        const updatedUsers = [...(runningState.users || [])];
        const uIdx = updatedUsers.findIndex(u => u.id === targetUserId);
        const userUpdates = {
          id: targetUserId,
          name: resolvedName,
          personId: existingPerson?.id || cleanToken,
          role: 'agent' as const,
          isActive: true
        };
        if (uIdx !== -1) {
          updatedUsers[uIdx] = { ...updatedUsers[uIdx], ...userUpdates };
        } else {
          updatedUsers.push(userUpdates);
        }
        runningState.users = updatedUsers;

        // C. Update or Create BusinessPartner via DataIntegrityEngine
        const isNesyehToken = cleanToken.toLowerCase().includes('nesyeh') || cleanToken.toUpperCase().startsWith('NS') || cleanToken.toUpperCase().startsWith('BP_NS') || cleanToken.toUpperCase().startsWith('BP-NS');

        const bpIndex = runningState.businessPartners.findIndex(bp => 
          bp.personId === cleanToken || 
          bp.personId === cleanId || 
          bp.id === cleanToken || 
          bp.id === `BP_${cleanToken}` ||
          bp.nesyehOnboarding?.nesyehPartnerId === cleanToken ||
          bp.profile?.partnerId === cleanToken ||
          (existingPerson && bp.personId === existingPerson.id)
        );

        if (bpIndex === -1) {
          const brandNewPartner = {
            id: cleanToken.startsWith('BP_') ? cleanToken : `BP_${cleanToken}`,
            personId: existingPerson?.id || cleanToken,
            status: 'active' as const,
            agencyType: isNesyehToken ? AgencyType.INSTALLMENT_ONLY : undefined,
            roles: isNesyehToken ? ['DEFERRED_AGENT' as any] : [PartnerRole.CREDIT_SALES_AGENT],
            contract: isNesyehToken ? {
              type: PartnerContractType.DEFERRED_AGENT,
              startDate: new Date().toISOString(),
              status: 'active'
            } : undefined,
            allowedCalculatorIds: defaultCalcIds,
            creditExtension: { allowedCalculators: defaultCalcIds },
            profile: {
              partnerId: cleanToken.startsWith('BP_') ? cleanToken : `BP_${cleanToken}`,
              partnerName: resolvedName,
              storeName: resolvedStore,
              contractStatus: 'active',
              riskLevel: 'medium' as any,
              creditLimit: 150000000
            },
            nesyehSettings: isNesyehToken ? {
              creditLimit: 150000000,
              paymentTermDays: 30,
              lateFeePercentage: 1.5,
              isPurchaseAllowed: true
            } : undefined,
            nesyehOnboarding: isNesyehToken ? {
              onboardingStatus: 'ACTIVE' as const,
              nesyehPartnerId: cleanToken,
              linkCreatedAt: new Date().toISOString(),
              isLinkActive: true,
              guarantees: [],
              statusHistory: [{
                status: 'ACTIVE' as const,
                date: new Date().toLocaleDateString('fa-IR'),
                userName: 'سیستم',
                comment: 'افتتاح و فعال‌سازی خودکار از طریق لینک اختصاصی'
              }]
            } : undefined,
            branches: [],
            users: [targetUserId]
          };
          const partnerResult = engine.createBusinessPartner(brandNewPartner as any, runningState);
          if (partnerResult.success) {
            runningState = partnerResult.updatedState;
          }
        } else {
          const existingBpInState = runningState.businessPartners[bpIndex];
          const existingOnboarding = existingBpInState.nesyehOnboarding;
          const isNesyeh = isNesyehToken || !!existingOnboarding || existingBpInState.agencyType === AgencyType.INSTALLMENT_ONLY || (existingBpInState.roles as any[])?.includes('DEFERRED_AGENT');

          const partnerUpdates = {
            status: 'active' as const,
            agencyType: (() => {
              if (existingBpInState.agencyType === AgencyType.BOTH) {
                return AgencyType.BOTH;
              }
              if (existingBpInState.agencyType === AgencyType.CREDIT_ONLY && isNesyeh) {
                return AgencyType.BOTH;
              }
              return isNesyeh ? AgencyType.INSTALLMENT_ONLY : existingBpInState.agencyType;
            })(),
            roles: isNesyeh ? Array.from(new Set([...(existingBpInState.roles || []), 'DEFERRED_AGENT' as any])) : existingBpInState.roles,
            contract: isNesyeh && !existingBpInState.contract ? {
              type: PartnerContractType.DEFERRED_AGENT,
              startDate: new Date().toISOString(),
              status: 'active'
            } : existingBpInState.contract,
            allowedCalculatorIds: (existingBpInState.allowedCalculatorIds && existingBpInState.allowedCalculatorIds.length > 0)
              ? existingBpInState.allowedCalculatorIds
              : defaultCalcIds,
            creditExtension: {
              ...(existingBpInState.creditExtension || {}),
              allowedCalculators: (existingBpInState.creditExtension?.allowedCalculators && existingBpInState.creditExtension.allowedCalculators.length > 0)
                ? existingBpInState.creditExtension.allowedCalculators
                : (existingBpInState.allowedCalculatorIds && existingBpInState.allowedCalculatorIds.length > 0
                    ? existingBpInState.allowedCalculatorIds
                    : defaultCalcIds)
            },
            profile: {
              ...existingBpInState.profile,
              partnerName: (existingBpInState.profile?.partnerName && existingBpInState.profile.partnerName !== 'نماینده فروش') ? existingBpInState.profile.partnerName : resolvedName,
              storeName: existingBpInState.profile?.storeName || resolvedStore,
            },
            nesyehSettings: isNesyeh && !existingBpInState.nesyehSettings ? {
              creditLimit: 150000000,
              paymentTermDays: 30,
              lateFeePercentage: 1.5,
              isPurchaseAllowed: true
            } : existingBpInState.nesyehSettings,
            nesyehOnboarding: isNesyeh ? {
              ...(existingOnboarding || {
                onboardingStatus: 'ACTIVE' as const,
                nesyehPartnerId: cleanToken,
                linkCreatedAt: new Date().toISOString(),
                isLinkActive: true,
                guarantees: [],
                statusHistory: []
              }),
              lastLogin: new Date().toLocaleDateString('fa-IR') + ' ' + new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
            } : existingOnboarding,
            users: Array.from(new Set([...(existingBpInState.users || []), targetUserId]))
          };
          const partnerResult = engine.updateBusinessPartner(existingBpInState.id, partnerUpdates as any, runningState);
          if (partnerResult.success) {
            runningState = partnerResult.updatedState;
          }
        }

        saveAppState(runningState);
        return runningState;
      });

      setIsAuthInitialized(true);
    }
  }, [state.persons, state.businessPartners, isAuthInitialized, isLoggedIn, currentUserRole, currentAgentId, isInitialLoading]);

  // Selected details for view
  const [selectedPersonForLedger, setSelectedPersonForLedger] = useState<Person | undefined>(undefined);
  const [selectedVoucherForView, setSelectedVoucherForView] = useState<JournalVoucher | undefined>(undefined);
  const [selectedCheckForView, setSelectedCheckForView] = useState<Check | undefined>(undefined);
  const [selectedVoucherForEdit, setSelectedVoucherForEdit] = useState<JournalVoucher | undefined>(undefined);

  // Search Modal State
  const [searchModalState, setSearchModalState] = useState<{ isOpen: boolean; type: 'checks' | 'vouchers' | 'invoices' }>({ isOpen: false, type: 'checks' });

  const handleSearchResultSelect = (type: 'check' | 'voucher' | 'invoice', id: string) => {
    if (type === 'check') {
      setActiveTab('checks');
      // For check, we don't have a specific view modal right now, the CheckManager handles it.
      // A search query update would be ideal, but navigating to checks is enough.
    } else if (type === 'invoice') {
      setActiveTab('invoices');
      const inv = state.invoices.find(i => i.id === id);
      if (inv) {
        setSelectedInvoiceForView(inv);
        setShowInvoiceForm(true);
      }
    } else if (type === 'voucher') {
      setActiveTab('reports');
      // The user wants to see general journal, or open the voucher.
      const v = state.vouchers.find(v => v.id === id);
      if (v) setSelectedVoucherForView(v);
    }
  };

  // Creation overlays / flows
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceFormType, setInvoiceFormType] = useState<'buy' | 'sell'>('sell');
  const [selectedInvoiceForView, setSelectedInvoiceForView] = useState<Invoice | undefined>(undefined);
  const [invoiceUpdateMutationKey, setInvoiceUpdateMutationKey] = useState<string>(() => crypto.randomUUID());
  const [activeKnowledgeArticle, setActiveKnowledgeArticle] = useState<KnowledgeArticle | null>(null);
  
  const [showManualVoucherForm, setShowManualVoucherForm] = useState(false);
  const [showInstallmentBooklet, setShowInstallmentBooklet] = useState(false);
  const [initialInvoiceForInstallment, setInitialInvoiceForInstallment] = useState<string | undefined>(undefined);
  const [initialPersonForInstallment, setInitialPersonForInstallment] = useState<string | undefined>(undefined);

  // Transfer and settlement of installment debtor states (Point 3 & 4)
  const [transferModalPerson, setTransferModalPerson] = useState<Person | undefined>(undefined);
  const [transferAmount, setTransferAmount] = useState<number>(0);
  const [transferDescription, setTransferDescription] = useState<string>('');

  const [settleInstallmentPerson, setSettleInstallmentPerson] = useState<Person | undefined>(undefined);
  const [settleMethod, setSettleMethod] = useState<'cash_pos' | 'booklet' | 'checks' | 'beta'>('cash_pos');
  const [settleCashAmount, setSettleCashAmount] = useState<number>(0);
  const [settlePosAmount, setSettlePosAmount] = useState<number>(0);
  const [settlePosTerminalId, setSettlePosTerminalId] = useState<string>('');
  
  // Settle with BETA system
  const [settleBetaAmount, setSettleBetaAmount] = useState<number>(0);
  const [settleBetaDescription, setSettleBetaDescription] = useState<string>('');

  // Settle with checks
  const [settleCheckBank, setSettleCheckBank] = useState<string>('');
  const [settleCheckNumber, setSettleCheckNumber] = useState<string>('');
  const [settleCheckDueDate, setSettleCheckDueDate] = useState<string>('');
  const [settleCheckAmount, setSettleCheckAmount] = useState<number>(0);
  const [settleCheckSayyadId, setSettleCheckSayyadId] = useState<string>('');

  // Opening Balances states
  const [showOpeningBalanceForm, setShowOpeningBalanceForm] = useState(false);
  const [editingOpeningBalance, setEditingOpeningBalance] = useState<OpeningBalance | undefined>(undefined);
  const [viewingOpeningBalance, setViewingOpeningBalance] = useState<OpeningBalance | undefined>(undefined);

  // Custom confirmation modal state
  const [appConfirmationModal, setAppConfirmationModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm?: () => void;
    confirmText?: string;
    cancelText?: string;
  } | null>(null);

  // Gross Profit/Loss view state for sales invoices
  const [invoiceProfitLoss, setInvoiceProfitLoss] = useState<{
    isOpen: boolean;
    invoiceNumber: number;
    revenue: number;
    cogs: number;
    profitLoss: number;
    isProfit: boolean;
  } | null>(null);

  // Track if a long press was triggered to avoid launching the default onClick view
  const isLongPressRef = React.useRef(false);
  const longPressTimerRef = React.useRef<NodeJS.Timeout | null>(null);


  // Automatic POS Transfer Schedule
  useEffect(() => {
    const checkTransfers = async () => {
      const activeTerminals = state.bankTerminals.filter(t => t.isActive);
      const todayJalali = getCurrentJalaliDate();
      let createdVoucher = false;

      for (const terminal of activeTerminals) {
        const untransferredInvoices = state.invoices.filter(inv => 
          inv.type === 'sell' && 
          inv.posTerminalId === terminal.id && 
          (inv.posPaidAmount || 0) > 0 &&
          !state.vouchers.some(v => v.sourceType === 'transfer' && v.sourceId === inv.id)
        );

        if (untransferredInvoices.length === 0) continue;

        const invDate = new Date(untransferredInvoices[0].date.replace(/\//g, '-'));
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - invDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= terminal.delayDays) {
          const totalAmount = untransferredInvoices.reduce((sum, inv) => sum + (inv.posPaidAmount || 0), 0);
          const batchId = `batch_transfer_${terminal.id}_${todayJalali}`;
          const voucher = createTransferVoucher(totalAmount, terminal.intermediateAccountId, terminal.bankAccountId, todayJalali, 1, batchId);

          try {
            const token = (await authSessionService.getAccessToken()) || '';
            const res = await fetch('/api/manual-vouchers', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
              },
              body: JSON.stringify({
                date: voucher.date,
                description: voucher.description,
                entries: voucher.entries
              })
            });
            const json = await res.json();
            if (json.success) {
              createdVoucher = true;
            }
          } catch (e) {
            console.error('Failed to post automatic POS transfer voucher:', e);
          }
        }
      }

      if (createdVoucher) {
        const nextGen = ++financialFetchGenerationRef.current;
        await loadServerAuthoritativeFinancialData(nextGen, true);
      }
    };

    const intervalId = setInterval(checkTransfers, 60000 * 5); // Check every 5 minutes
    return () => clearInterval(intervalId);
  }, [state.bankTerminals, state.invoices, state.vouchers]);

  // Set up event listeners for inline fast creations from selectors
  useEffect(() => {
    const handleCreatePersonInline = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const nId = detail.nationalId ? detail.nationalId.trim() : '';
      if (nId && !isUniqueNationalId(nId, state.persons)) {
        alert('این کد ملی قبلاً در سیستم ثبت شده است و امکان ثبت مجدد وجود ندارد.');
        return;
      }
      const nextCode = generateUniquePersonCode(state.persons);
      const newPersonData: Partial<Person> = {
        id: detail.id || crypto.randomUUID(),
        code: nextCode,
        name: detail.name,
        nationalId: detail.nationalId,
        mobile: detail.mobile,
        phone: detail.phone,
        address: detail.address,
        role: detail.role || 'both',
        createdAt: new Date().toISOString(),
      };

      try {
        const savedPerson = await PersonService.createPerson(newPersonData);
        setState(prev => {
          const updated = { ...prev, persons: [...prev.persons, savedPerson] };
          saveAppState(updated);
          return updated;
        });
      } catch (err: any) {
        console.error('Failed to create person via PersonService:', err);
        alert(`خطا در ثبت شخص در پایگاه‌داده: ${err.message || 'خطای ناشناخته'}`);
      }
    };

    const handleCreateProductInline = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      try {
        await ProductService.createProduct({
          name: detail.name,
          category: detail.category,
          unit: detail.unit,
          reorderPoint: detail.reorderPoint,
          hasSerial: !!detail.serialNumber,
          isSerialized: !!detail.serialNumber,
          defaultSalePrice: detail.defaultSalePrice,
        });

        const refreshedProducts = await ProductService.getProducts();
        setState(prev => ({
          ...prev,
          products: refreshedProducts
        }));
      } catch (err: any) {
        console.error('Failed to create inline product on server:', err);
        alert(`خطا در ثبت کالا در سرور: ${err.message || 'خطای ناشناخته'}`);
      }
    };

    const handleUpdatePersonCritical = (e: any) => {
      const { id, criticalDetails } = e.detail;
      setState(prev => {
        const updated = {
          ...prev,
          persons: prev.persons.map(p => {
            if (p.id === id) {
              return {
                ...p,
                criticalDetails: {
                  ...p.criticalDetails,
                  ...criticalDetails
                }
              };
            }
            return p;
          })
        };
        saveAppState(updated);
        return updated;
      });
    };

    window.addEventListener('create_person_inline', handleCreatePersonInline);
    window.addEventListener('create_product_inline', handleCreateProductInline);
    window.addEventListener('update_person_critical', handleUpdatePersonCritical);

    return () => {
      window.removeEventListener('create_person_inline', handleCreatePersonInline);
      window.removeEventListener('create_product_inline', handleCreateProductInline);
      window.removeEventListener('update_person_critical', handleUpdatePersonCritical);
    };
  }, [state.persons, state.products]);

  // Derived Accounting Calculations
  const subsidiaryBalances = useMemo(() => {
    return calculateSubsidiaryBalances(state.vouchers);
  }, [state.vouchers]);

  const personBalances = useMemo(() => {
    return calculatePersonBalances(state.vouchers);
  }, [state.vouchers]);

  const normalDebtorBalances = useMemo(() => {
    return calculatePersonBalances(state.vouchers, undefined, 'SUB_DEBTORS');
  }, [state.vouchers]);

  const installmentDebtorBalances = useMemo(() => {
    return calculatePersonBalances(state.vouchers, undefined, 'SUB_DEBTORS_INSTALLMENT');
  }, [state.vouchers]);

  const creditorBalances = useMemo(() => {
    return calculatePersonBalances(state.vouchers, undefined, 'SUB_CREDITORS');
  }, [state.vouchers]);

  const productStocks = useMemo(() => {
    return calculateProductStocks(state.products, state.invoices, state.openingBalances, state.warehouseTransfers);
  }, [state.products, state.invoices, state.openingBalances, state.warehouseTransfers]);

  const overdueInstallments = useMemo(() => {
    return (state.installments || []).filter(inst => {
      const today = getCurrentJalaliDate();
      return inst.status === 'overdue' || (inst.status !== 'paid' && inst.dueDate < today);
    });
  }, [state.installments]);

  // Contacts and Products manual creation states
  const [personFormName, setPersonFormName] = useState('');
  const [personFormMobile, setPersonFormMobile] = useState('');
  const [personFormPhone, setPersonFormPhone] = useState('');
  const [personFormNationalId, setPersonFormNationalId] = useState('');
  const [personFormAddress, setPersonFormAddress] = useState('');

  const [isAddingDebtor, setIsAddingDebtor] = useState(false);
  const [isAddingCreditor, setIsAddingCreditor] = useState(false);
  const [registerAmaniCheckSimultaneously, setRegisterAmaniCheckSimultaneously] = useState(false);
  const [checkPrefillPersonId, setCheckPrefillPersonId] = useState<string | undefined>(undefined);
  const [showCashTransactionForm, setShowCashTransactionForm] = useState(false);
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [selectedProductHistory, setSelectedProductHistory] = useState<Product | null>(null);
  const [debtorSearchQuery, setDebtorSearchQuery] = useState('');
  const [creditorSearchQuery, setCreditorSearchQuery] = useState('');
  const [productSearchQuery, setProductSearchQuery] = useState('');

  const [newProductName, setNewProductName] = useState('');
  const [newProductCategory, setNewProductCategory] = useState('');
  const [newProductStock, setNewProductStock] = useState<number>(0);
  const [newProductInitialCost, setNewProductInitialCost] = useState<number>(0);
  const [newProductPrice, setNewProductPrice] = useState<number>(0);
  const [newProductUnit, setNewProductUnit] = useState('عدد');
  const [newProductHasSerial, setNewProductHasSerial] = useState(false);
  const [newProductCode, setNewProductCode] = useState('');
  const [newProductReorderPoint, setNewProductReorderPoint] = useState<number>(0);

  useEffect(() => {
    if (editingProduct) {
      setNewProductName(editingProduct.name);
      setNewProductCategory(editingProduct.category);
      setNewProductStock(editingProduct.initialStock);
      setNewProductInitialCost(editingProduct.initialUnitCost || 0);
      setNewProductPrice(editingProduct.defaultSalePrice || 0);
      setNewProductUnit(editingProduct.unit);
      setNewProductHasSerial(editingProduct.hasSerial || false);
      setNewProductCode(editingProduct.code);
      setNewProductReorderPoint(editingProduct.reorderPoint);
    } else {
      setNewProductName('');
      setNewProductCategory('');
      setNewProductStock(0);
      setNewProductInitialCost(0);
      setNewProductPrice(0);
      setNewProductUnit('عدد');
      setNewProductHasSerial(false);
      setNewProductCode('');
      setNewProductReorderPoint(0);
    }
  }, [editingProduct]);

  // Populate form fields when editingPerson changes
  useEffect(() => {
    if (editingPerson) {
      setPersonFormName(editingPerson.name);
      setPersonFormMobile(editingPerson.mobile || '');
      setPersonFormPhone(editingPerson.phone || '');
      setPersonFormNationalId(editingPerson.nationalId || '');
      setPersonFormAddress(editingPerson.address || '');
    } else {
      setPersonFormName('');
      setPersonFormMobile('');
      setPersonFormPhone('');
      setPersonFormNationalId('');
      setPersonFormAddress('');
    }
  }, [editingPerson]);

  // Add or Edit Person manually
  const handleAddPersonFromComponent = async (personData: Partial<Person>, registerAmaniCheck: boolean, isDebtorRole: boolean) => {
    // Validation
    const nId = personData.nationalId?.trim() || '';
    if (nId && !isValidNationalId(nId)) {
      alert('کد ملی نامعتبر است. کد ملی باید ۱۰ رقم باشد.');
      return;
    }
    if (nId && !isUniqueNationalId(nId, state.persons, editingPerson?.id)) {
      alert('این کد ملی قبلاً ثبت شده است.');
      return;
    }

    if (editingPerson) {
      try {
        const savedPerson = await PersonService.updatePerson(
          editingPerson.id,
          personData,
          undefined,
          (editingPerson as any).version
        );
        setState(prev => {
          const updatedPersons = prev.persons.map(p => (p.id === editingPerson.id ? savedPerson : p));
          const updated = { ...prev, persons: updatedPersons };
          saveAppState(updated);
          return updated;
        });
        if (savedPerson.generatedPassword) {
          setAgentCredentialsModalData({
            name: savedPerson.name,
            loginIdentifier: savedPerson.loginIdentifier || savedPerson.mobile || '',
            password: savedPerson.generatedPassword,
          });
        }
        setEditingPerson(null);
      } catch (err: any) {
        console.error('Failed to update person via PersonService:', err);
        alert(`خطا در ذخیره تغییرات شخص: ${err.message || 'خطای ناشناخته'}`);
        return;
      }
    } else {
      const nextCode = personData.code || generateUniquePersonCode(state.persons);
      const newPersonPayload: Partial<Person> = {
        code: nextCode,
        name: personData.name || '',
        mobile: personData.mobile,
        phone: personData.phone,
        nationalId: personData.nationalId,
        address: personData.address,
        fatherName: personData.fatherName,
        birthDate: personData.birthDate,
        companyName: personData.companyName,
        roles: personData.roles,
        status: personData.status || 'active',
        cardNumber: personData.cardNumber,
        shebaNumber: personData.shebaNumber,
        bankName: personData.bankName,
        internalNotes: personData.internalNotes,
        attachments: personData.attachments,
        personType: personData.personType || 'real',
        gender: personData.gender,
        accountHolderName: personData.accountHolderName,
        province: personData.province,
        city: personData.city,
        district: personData.district,
        postalCode: personData.postalCode,
        role: personData.role || (isDebtorRole ? 'debtor' : (isAddingCreditor ? 'creditor' : 'both')),
        createdAt: new Date().toISOString(),
        createdBy: currentUserId,
        ...personData
      };

      try {
        const savedPerson = await PersonService.createPerson(newPersonPayload);
        setState(prev => {
          const updated = { ...prev, persons: [...prev.persons, savedPerson] };
          saveAppState(updated);

          // Non-blocking event notification for SMS module
          globalFinancialEventAdapter.emitCustomerRegistered({
            customerName: savedPerson.name,
            customerPhone: savedPerson.mobile || savedPerson.phone,
            customerCode: savedPerson.code,
            registrationDate: getCurrentJalaliDate(),
          }, currentUserRole, currentAgentId);

          return updated;
        });
        if (savedPerson.generatedPassword) {
          setAgentCredentialsModalData({
            name: savedPerson.name,
            loginIdentifier: savedPerson.loginIdentifier || savedPerson.mobile || '',
            password: savedPerson.generatedPassword,
          });
        }
        if (registerAmaniCheck) {
          setCheckPrefillPersonId(savedPerson.id);
          setActiveTab('checks');
        }
      } catch (err: any) {
        console.error('Failed to create person via PersonService:', err);
        alert(`خطا در ثبت شخص در پایگاه‌داده: ${err.message || 'خطای ناشناخته'}`);
        return;
      }
    }
    setIsAddingDebtor(false);
    setIsAddingCreditor(false);
  };

  // Legacy inline handler
  const handleAddPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personFormName.trim()) return;

    // Validation
    const nId = personFormNationalId.trim();
    if (!isValidNationalId(nId)) {
      alert('کد ملی نامعتبر است. کد ملی باید ۱۰ رقم باشد.');
      return;
    }
    if (!isUniqueNationalId(nId, state.persons, editingPerson?.id)) {
      alert('این کد ملی قبلاً ثبت شده است.');
      return;
    }

    if (editingPerson) {
      // Edit logic
      try {
        const updateData: Partial<Person> = {
          name: personFormName.trim(),
          mobile: personFormMobile.trim() || undefined,
          phone: personFormPhone.trim() || undefined,
          nationalId: personFormNationalId.trim() || undefined,
          address: personFormAddress.trim() || undefined,
        };
        const savedPerson = await PersonService.updatePerson(
          editingPerson.id,
          updateData,
          undefined,
          (editingPerson as any).version
        );
        setState(prev => {
          const updatedPersons = prev.persons.map(p => (p.id === editingPerson.id ? savedPerson : p));
          const updated = { ...prev, persons: updatedPersons };
          saveAppState(updated);
          return updated;
        });
        setEditingPerson(null);
      } catch (err: any) {
        console.error('Failed to update person via PersonService:', err);
        alert(`خطا در ویرایش شخص: ${err.message || 'خطای ناشناخته'}`);
        return;
      }
    } else {
      // Add logic
      const nextCode = generateUniquePersonCode(state.persons);
      const newPersonPayload: Partial<Person> = {
        code: nextCode,
        name: personFormName.trim(),
        mobile: personFormMobile.trim() || undefined,
        phone: personFormPhone.trim() || undefined,
        nationalId: personFormNationalId.trim() || undefined,
        address: personFormAddress.trim() || undefined,
        role: isAddingDebtor ? 'debtor' : (isAddingCreditor ? 'creditor' : 'both'),
        createdAt: new Date().toISOString(),
      };

      try {
        const savedPerson = await PersonService.createPerson(newPersonPayload);
        setState(prev => {
          const updated = { ...prev, persons: [...prev.persons, savedPerson] };
          saveAppState(updated);
          return updated;
        });

        if (registerAmaniCheckSimultaneously) {
          setCheckPrefillPersonId(savedPerson.id);
          setActiveTab('checks');
        }
      } catch (err: any) {
        console.error('Failed to create person via PersonService:', err);
        alert(`خطا در ثبت شخص در پایگاه‌داده: ${err.message || 'خطای ناشناخته'}`);
        return;
      }
    }

    setPersonFormName('');
    setPersonFormMobile('');
    setPersonFormPhone('');
    setPersonFormNationalId('');
    setPersonFormAddress('');
    setIsAddingDebtor(false);
    setIsAddingCreditor(false);
    setRegisterAmaniCheckSimultaneously(false);
  };

  // Check if person has no financial activity and is deletable
  const isPersonDeletable = (personId: string) => {
    const bp = state.businessPartners?.find(b => b.personId === personId);
    const bpId = bp?.id;

    const hasInvoice = state.invoices?.some(inv => inv.personId === personId || (inv as any).customerId === personId);
    const hasCheck = state.checks?.some(c => c.personId === personId);
    const hasInstallmentBook = state.installmentBooks?.some(b => b.personId === personId);
    const hasOpeningBalance = state.openingBalances?.some(ob => ob.personId === personId);
    const hasVoucher = state.vouchers?.some(v => v.entries?.some(ent => 
      (ent.floatingDetailed?.type === 'person' && ent.floatingDetailed.id === personId) ||
      (bpId && ent.floatingDetailed?.id === bpId)
    ));
    const hasCreditFile = state.creditFiles?.some(cf => cf.personId === personId || cf.representativeId === personId);
    const hasOrders = (state.nesyehPurchaseOrders as any[])?.some(o => o.partnerId === personId || (bpId && o.partnerId === bpId));
    const hasDeclarations = (state.nesyehPaymentDeclarations as any[])?.some(d => d.partnerId === personId || (bpId && d.partnerId === bpId));

    return !(hasInvoice || hasCheck || hasInstallmentBook || hasOpeningBalance || hasVoucher || hasCreditFile || hasOrders || hasDeclarations);
  };

  const handleDeletePerson = (personId: string) => {
    const person = state.persons.find(p => p.id === personId);
    if (!person) return;

    if (!isPersonDeletable(personId)) {
      setAppConfirmationModal({
        isOpen: true,
        title: 'عدم امکان حذف طرف حساب',
        message: `امکان حذف طرف حساب "${person.name}" وجود ندارد زیرا تراکنش مالی، فاکتور، سند حسابداری، چک، پیش‌پرداخت یا سابقه اقساط برای ایشان ثبت شده است.`,
      });
      return;
    }

    setAppConfirmationModal({
      isOpen: true,
      title: 'تایید حذف طرف حساب',
      message: `آیا از حذف طرف حساب "${person.name}" اطمینان دارید؟ تمامی اطلاعات مرتبط با پروفایل او (شامل پرونده همکار و حساب کاربری متصل) غیرفعال/حذف خواهد شد.`,
      confirmText: 'بله، حذف شود',
      cancelText: 'انصراف',
      onConfirm: async () => {
        try {
          await PersonService.deactivatePerson(personId);
        } catch (err: any) {
          console.error('Failed to deactivate person in database:', err);
          setAppConfirmationModal({
            isOpen: true,
            title: 'خطا در غیرفعال‌سازی طرف حساب',
            message: `خطا در حذف/غیرفعال‌سازی شخص در پایگاه‌داده: ${err?.message || 'خطای ناشناخته رخ داده است.'}`,
          });
          return;
        }

        setState(prev => {
          const updatedPersons = prev.persons.filter(p => p.id !== personId);
          const updatedPartners = prev.businessPartners ? prev.businessPartners.filter(bp => bp.personId !== personId) : [];
          const updatedUsers = prev.users ? prev.users.filter(u => u.personId !== personId) : [];
          const updated = { 
            ...prev, 
            persons: updatedPersons,
            businessPartners: updatedPartners,
            users: updatedUsers
          };
          saveAppState(updated);
          return updated;
        });
      }
    });
  };

  // handler for Point 3: Transfer normal debtor balance to installment debtor
  const handleTransferNormalToInstallment = async (personId: string, amount: number, desc: string) => {
    const person = state.persons.find(p => p.id === personId);
    if (!person || amount <= 0) return;

    try {
      const token = (await authSessionService.getAccessToken()) || '';
      const jalaliDate = getCurrentJalaliDate();
      const payload = {
        date: jalaliDate,
        description: desc || `انتقال بدهی عادی به بدهی اقساطی برای ${person.name}`,
        entries: [
          {
            subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
            floatingDetailed: { type: 'person', id: person.id, name: person.name },
            debit: amount,
            credit: 0,
            description: desc || `انتقال بدهی از معین بدهکاران عادی به بدهکاران اقساطی`
          },
          {
            subsidiaryId: 'SUB_DEBTORS',
            floatingDetailed: { type: 'person', id: person.id, name: person.name },
            debit: 0,
            credit: amount,
            description: desc || `انتقال بدهی از معین بدهکاران عادی به بدهکاران اقساطی`
          }
        ]
      };

      const res = await fetch('/api/manual-vouchers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || 'خطا در ثبت سند انتقال در پایگاه داده');
      }

      alert('سند انتقال به بدهی اقساطی با موفقیت در سرور ثبت شد.');
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      console.error('Error transferring normal debt to installment:', err);
      alert(`خطا در ثبت سند انتقال: ${err.message || err}`);
    }
  };

  // handler for Point 4: Settle installment debtor via Cash/POS
  const handleSettleInstallmentCashPos = async (personId: string, cashAmount: number, posAmount: number, posTerminalId: string) => {
    const person = state.persons.find(p => p.id === personId);
    if (!person || (cashAmount <= 0 && posAmount <= 0)) return;

    try {
      const token = (await authSessionService.getAccessToken()) || '';
      const jalaliDate = getCurrentJalaliDate();
      const entries: VoucherEntry[] = [];
      const totalSettle = cashAmount + posAmount;

      if (cashAmount > 0) {
        entries.push({
          subsidiaryId: 'SUB_CASH_MAIN',
          debit: cashAmount,
          credit: 0,
          description: `تسویه نقدی بدهی اقساطی برای ${person.name}`
        });
      }

      if (posAmount > 0) {
        let targetBankSub = 'SUB_BANK_MELI'; // default
        if (posTerminalId) {
          const terminal = state.bankTerminals.find(t => t.id === posTerminalId);
          if (terminal && terminal.intermediateAccountId) {
            targetBankSub = terminal.intermediateAccountId;
          }
        }
        entries.push({
          subsidiaryId: targetBankSub,
          debit: posAmount,
          credit: 0,
          description: `تسویه کارتخوان بدهی اقساطی برای ${person.name}`
        });
      }

      entries.push({
        subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
        floatingDetailed: { type: 'person', id: person.id, name: person.name },
        debit: 0,
        credit: totalSettle,
        description: `تسویه حساب بدهی اقساطی (نقدی / کارتخوان) برای ${person.name}`
      });

      const payload = {
        date: jalaliDate,
        description: `تسویه حساب بدهی اقساطی برای ${person.name}`,
        entries
      };

      const res = await fetch('/api/manual-vouchers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || 'خطا در ثبت سند تسویه نقدی/کارتخوان در سرور');
      }

      alert('سند تسویه بدهی اقساطی با موفقیت در سرور ثبت شد.');
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      console.error('Error settling installment via Cash/POS:', err);
      alert(`خطا در تسویه نقدی/کارتخوان: ${err.message || err}`);
    }
  };

  // handler for Point 4: Settle installment debtor via BETA System
  const handleSettleInstallmentBeta = async (personId: string, amount: number, desc: string) => {
    const person = state.persons.find(p => p.id === personId);
    if (!person || amount <= 0) return;

    try {
      const token = (await authSessionService.getAccessToken()) || '';
      const jalaliDate = getCurrentJalaliDate();

      const activeBook = state.installmentBooks?.find(b => b.personId === person.id && b.status === 'active' && b.agentBankId);
      const activeFile = state.creditFiles?.find(f => f.personId === person.id && f.agentBankId);
      const targetCalc = state.calculators?.find(c => c.id === activeBook?.calculatorId || c.id === activeFile?.calculatorId);
      const betaSubId = activeBook?.agentBankId || activeFile?.agentBankId || targetCalc?.agentBankId || 'SUB_BETA_SYSTEM';

      const payload = {
        date: jalaliDate,
        description: desc || `تسویه بدهی اقساطی از طریق سامانه بتا برای ${person.name}`,
        entries: [
          {
            subsidiaryId: betaSubId,
            debit: amount,
            credit: 0,
            description: desc || `وصولی سامانه بتا بابت بدهی اقساطی ${person.name}`
          },
          {
            subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
            floatingDetailed: { type: 'person', id: person.id, name: person.name },
            debit: 0,
            credit: amount,
            description: desc || `تسویه بدهی اقساطی از طریق سامانه بتا (بانک رفاه)`
          }
        ]
      };

      const res = await fetch('/api/manual-vouchers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || 'خطا در ثبت سند تسویه بتا در سرور');
      }

      alert('سند تسویه سامانه بتا با موفقیت در سرور ثبت شد.');
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      console.error('Error settling installment via Beta:', err);
      alert(`خطا در تسویه سامانه بتا: ${err.message || err}`);
    }
  };

  const handleSettleInstallmentMultipleChecks = async (personId: string, cheques: Omit<Check, 'id' | 'currentState' | 'history' | 'createdAt'>[], commissionAmount: number) => {
    const person = state.persons.find(p => p.id === personId);
    if (!person || !cheques || cheques.length === 0) return;

    try {
      const token = (await authSessionService.getAccessToken()) || '';
      const jalaliDate = getCurrentJalaliDate();

      for (const c of cheques) {
        await ChequeClientService.createCheque({
          chequeType: 'received',
          bankName: c.bankName,
          checkNumber: c.checkNumber,
          amount: c.amount,
          dueDate: c.dueDate,
          sayadiIdentifier: c.sayadiNumber,
          personId: person.id,
          description: `دریافت چک شماره ${c.checkNumber} بابت تسویه بدهی اقساطی ${person.name} (صدی بازار)`
        });
      }

      if (commissionAmount > 0) {
        const commPayload = {
          date: jalaliDate,
          description: `کارمزد تقسیط مجدد بازار (صدی بازار) بابت بدهکار اقساطی ${person.name}`,
          entries: [
            {
              subsidiaryId: 'SUB_DEBTORS_INSTALLMENT',
              floatingDetailed: { type: 'person', id: person.id, name: person.name },
              debit: commissionAmount,
              credit: 0,
              description: `افزایش بدهکاری بابت کارمزد تقسیط مجدد (صدی بازار)`
            },
            {
              subsidiaryId: 'SUB_COMMISSION_REV',
              debit: 0,
              credit: commissionAmount,
              description: `درآمد کارمزد اقساط (صدی بازار) بابت مشتری ${person.name}`
            }
          ]
        };

        const commRes = await fetch('/api/manual-vouchers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify(commPayload)
        });
        const commJson = await commRes.json();
        if (!commJson.success) {
          console.warn('Commission voucher warning:', commJson.message);
        }
      }

      alert('چک‌های تسویه اقساطی با موفقیت در سامانه ثبت و اسناد حسابداری صادر شدند.');
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      console.error('Error settling installment via multiple checks:', err);
      alert(`خطا در ثبت چک‌های تسویه: ${err.message || err}`);
    }
  };

  // handler for Point 4: Settle installment debtor via check
  const handleSettleInstallmentCheck = async (personId: string, checkBank: string, checkNo: string, dueDate: string, amount: number, sayyadId: string) => {
    const person = state.persons.find(p => p.id === personId);
    if (!person || amount <= 0 || !checkNo || !dueDate) return;

    try {
      await ChequeClientService.createCheque({
        chequeType: 'received',
        bankName: checkBank,
        checkNumber: checkNo,
        amount,
        dueDate,
        sayadiIdentifier: sayyadId,
        personId: person.id,
        description: `دریافت چک شماره ${checkNo} بابت تسویه بدهی اقساطی ${person.name}`
      });

      alert('چک صیادی با موفقیت در سامانه ثبت و سند حسابداری صادر شد.');
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      console.error('Error settling installment via check:', err);
      alert(`خطا در ثبت چک تسویه: ${err.message || err}`);
    }
  };

  // Long press calculation and triggers
  const startLongPress = (invoice: Invoice) => {
    isLongPressRef.current = false;
    if (invoice.type !== 'sell') return;

    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      
      // Calculate gross profit
      let subtotal = 0;
      let totalDiscount = invoice.discount;
      invoice.items.forEach(it => {
        subtotal += it.quantity * it.unitPrice;
        totalDiscount += it.discount;
      });
      const revenue = subtotal - totalDiscount;
      
      let totalCogs = 0;
      invoice.items.forEach(it => {
        const avgCost = productStocks[it.productId]?.averageCost || 0;
        totalCogs += it.quantity * avgCost;
      });

      const profitLoss = revenue - totalCogs;
      const isProfit = profitLoss >= 0;

      setInvoiceProfitLoss({
        isOpen: true,
        invoiceNumber: invoice.invoiceNumber,
        revenue,
        cogs: totalCogs,
        profitLoss,
        isProfit
      });
    }, 3000); // 3 seconds hold
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Populate form fields when editingProduct changes
  useEffect(() => {
    if (editingProduct) {
      setNewProductName(editingProduct.name);
      setNewProductCategory(editingProduct.category || '');
      setNewProductStock(editingProduct.initialStock);
      setNewProductInitialCost(editingProduct.initialUnitCost || 0);
      setNewProductPrice(editingProduct.defaultSalePrice || 0);
      setIsAddingProduct(true);
    } else {
      setNewProductName('');
      setNewProductCategory('');
      setNewProductStock(0);
      setNewProductInitialCost(0);
      setNewProductPrice(0);
    }
  }, [editingProduct]);

  // Add Product manually
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim()) return;

    try {
      if (editingProduct) {
        // Edit logic via server
        await ProductService.updateProduct(editingProduct.id, {
          name: newProductName.trim(),
          category: newProductCategory || 'عمومی',
          unit: newProductUnit,
          hasSerial: newProductHasSerial,
          isSerialized: newProductHasSerial,
          code: newProductCode || editingProduct.code,
          reorderPoint: newProductReorderPoint,
          defaultSalePrice: newProductPrice || undefined,
        });
        setEditingProduct(null);
      } else {
        // Create logic via server
        await ProductService.createProduct({
          name: newProductName.trim(),
          category: newProductCategory || 'عمومی',
          unit: newProductUnit,
          hasSerial: newProductHasSerial,
          isSerialized: newProductHasSerial,
          code: newProductCode.trim() || undefined,
          reorderPoint: newProductReorderPoint,
          defaultSalePrice: newProductPrice || undefined,
        });
      }

      const refreshedProducts = await ProductService.getProducts();
      setState(prev => ({
        ...prev,
        products: refreshedProducts
      }));

      setNewProductName('');
      setNewProductStock(0);
      setNewProductInitialCost(0);
      setNewProductPrice(0);
      setNewProductCategory('');
      setNewProductUnit('عدد');
      setNewProductHasSerial(false);
      setNewProductCode('');
      setNewProductReorderPoint(0);
      setIsAddingProduct(false);
    } catch (err: any) {
      console.error('Failed to save product on server:', err);
      alert(`❌ خطا در ثبت کالا در پایگاه‌داده: ${err.message || 'خطای ناشناخته'}`);
    }
  };

  const handleOpeningBalanceSubmit = async (obData: Omit<OpeningBalance, 'id' | 'createdAt' | 'voucherId'>) => {
    try {
      const obId = editingOpeningBalance?.id || `ob_${Date.now()}`;
      const tempOB: OpeningBalance = {
        ...obData,
        id: obId,
        createdAt: editingOpeningBalance?.createdAt || new Date().toISOString()
      };

      // Construct Double-Entry Voucher Entries
      const localVoucher = createOpeningBalanceVoucher(tempOB, state.products, 1);
      const token = (await authSessionService.getAccessToken()) || '';
      const opKey = `op_ob_${obId}_${Date.now()}`;

      const res = await fetch('/api/opening-balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          date: tempOB.date,
          description: `ثبت سند تراز افتتاحیه شماره ${tempOB.number}`,
          entries: localVoucher.entries,
          operationKey: opKey
        })
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || 'خطا در ثبت سند افتتاحیه در سرور.');
      }

      const serverVoucherId = json.data?.voucher_id || json.data?.id;
      const finalOB: OpeningBalance = {
        ...tempOB,
        voucherId: serverVoucherId
      };

      setState(prev => {
        let updatedOpeningBalances = [...prev.openingBalances];
        if (editingOpeningBalance) {
          const index = updatedOpeningBalances.findIndex(ob => ob.id === editingOpeningBalance.id);
          if (index !== -1) {
            updatedOpeningBalances[index] = finalOB;
          }
        } else {
          updatedOpeningBalances.push(finalOB);
        }
        const updated = { ...prev, openingBalances: updatedOpeningBalances };
        saveAppState(updated);
        return updated;
      });

      setShowOpeningBalanceForm(false);
      setEditingOpeningBalance(undefined);

      // Rule 20: Server-Authoritative Post-Mutation Hydration
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      alert(`خطا در ثبت سند افتتاحیه: ${err.message}`);
      throw err;
    }
  };

  const handleDeleteOpeningBalance = async (id: string) => {
    if (!window.confirm('آیا از حذف این سند موجودی افتتاحیه اطمینان دارید؟ با حذف این سند، موجودی کالاهای مربوطه و سند حسابداری آن نیز حذف خواهد شد.')) return;
    
    const targetOB = state.openingBalances.find(o => o.id === id);
    const voucherId = targetOB?.voucherId || state.vouchers.find(v => v.id === `v_ob_${id}` || (v.sourceType === 'opening_balance' && v.sourceId === id))?.id;

    try {
      const token = (await authSessionService.getAccessToken()) || '';
      
      // Dispatch authenticated server API request to void/delete the opening balance voucher in PostgreSQL
      const endpoint = voucherId 
        ? `/api/manual-vouchers/${encodeURIComponent(voucherId)}/void`
        : `/api/opening-balance/${encodeURIComponent(id)}/void`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          voucherId,
          openingBalanceId: id,
          reason: 'ابطال و حذف سند موجودی افتتاحیه اول دوره'
        })
      });

      if (!res.ok) {
        // Fallback endpoint if route is structured as DELETE /api/opening-balance/:id
        const fallbackRes = await fetch(`/api/opening-balance/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ voucherId })
        });

        if (!fallbackRes.ok && res.status !== 404 && fallbackRes.status !== 404) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'خطا در ابطال سند افتتاحیه در سرور.');
        }
      }

      alert('سند موجودی افتتاحیه با موفقیت در سرور ابطال و حذف شد.');

      // Server-Authoritative Post-Mutation Hydration
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      console.error('Error voiding/deleting opening balance voucher on server:', err);
      alert(`❌ خطا در حذف سند افتتاحیه: ${err.message || err}`);
    }
  };

  const handleAddCategory = async (category: string) => {
    if (!category.trim()) return;
    try {
      await ProductService.createCategory({ title: category.trim() });
      const cats = await ProductService.getCategories();
      setState(prev => ({
        ...prev,
        productCategories: cats.map(c => c.title)
      }));
    } catch (err: any) {
      console.error('Failed to create category on server:', err);
      alert(`❌ خطا در ایجاد دسته‌بندی در سرور: ${err.message || 'خطای ناشناخته'}`);
    }
  };

  const handleDeleteCategory = async (category: string) => {
    if (!window.confirm(`آیا از حذف دسته‌بندی "${category}" اطمینان دارید؟`)) return;
    try {
      const cats = await ProductService.getCategories();
      const targetCat = cats.find(c => c.title === category);
      if (targetCat) {
        await ProductService.deleteCategory(targetCat.id);
      }
      const refreshedCats = await ProductService.getCategories();
      setState(prev => ({
        ...prev,
        productCategories: refreshedCats.map(c => c.title)
      }));
    } catch (err: any) {
      console.error('Failed to delete category on server:', err);
      alert(`❌ خطا در حذف دسته‌بندی: ${err.message || 'خطای ناشناخته'}`);
    }
  };

  const handleAddUser = (user: User) => {
    setState(prev => {
      const updated = { ...prev, users: [...prev.users, user] };
      saveAppState(updated);
      return updated;
    });
  };

  const handleUpdateUser = (updatedUser: User) => {
    setState(prev => {
      const updated = {
        ...prev,
        users: prev.users.map(u => u.id === updatedUser.id ? updatedUser : u)
      };
      saveAppState(updated);
      return updated;
    });
  };

  const handleDeleteUser = (id: string) => {
    setState(prev => {
      const updated = { ...prev, users: prev.users.filter(u => u.id !== id) };
      saveAppState(updated);
      return updated;
    });
  };

  const handleAddWarehouse = async (w: Partial<Warehouse>) => {
    try {
      await WarehouseService.createWarehouse({
        name: w.name,
        code: w.code,
        location: w.location,
        isDefault: w.isDefault,
        branchId: w.branchId,
        operationKey: `op_wh_create_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      });
      const freshWarehouses = await WarehouseService.getWarehouses();
      setState(prev => ({ ...prev, warehouses: freshWarehouses }));
    } catch (err: any) {
      console.error('Error creating warehouse:', err);
      alert(`خطا در ایجاد انبار: ${err.message || 'خطای سرور'}`);
    }
  };

  const handleDeleteWarehouse = async (id: string) => {
    const target = state.warehouses.find(w => w.id === id);
    if (!target) return;
    if (target.isDefault) {
      alert('غیرفعال‌سازی انبار پیش‌فرض مجاز نیست مگر اینکه ابتدا انبار پیش‌فرض دیگری برای این شعبه تعیین شود.');
      return;
    }
    if (!window.confirm(`آیا از غیرفعال‌سازی انبار "${target.name}" اطمینان دارید؟`)) return;

    try {
      await WarehouseService.deactivateWarehouse(id);
      const freshWarehouses = await WarehouseService.getWarehouses();
      setState(prev => ({ ...prev, warehouses: freshWarehouses }));
    } catch (err: any) {
      console.error('Error deactivating warehouse:', err);
      alert(`خطا در غیرفعال‌سازی انبار: ${err.message || 'خطای سرور'}`);
    }
  };

  const handleUpdateWarehouse = async (updatedWh: Warehouse) => {
    try {
      await WarehouseService.updateWarehouse(updatedWh.id, {
        name: updatedWh.name,
        location: updatedWh.location,
        code: updatedWh.code,
        branchId: updatedWh.branchId,
        expectedVersion: updatedWh.version,
      });
      const freshWarehouses = await WarehouseService.getWarehouses();
      setState(prev => ({ ...prev, warehouses: freshWarehouses }));
    } catch (err: any) {
      console.error('Error updating warehouse:', err);
      alert(`خطا در ویرایش انبار: ${err.message || 'خطای سرور'}`);
    }
  };

  const handleSetDefaultWarehouse = async (id: string) => {
    try {
      await WarehouseService.setDefaultWarehouse(id);
      const freshWarehouses = await WarehouseService.getWarehouses();
      setState(prev => ({ ...prev, warehouses: freshWarehouses }));
    } catch (err: any) {
      console.error('Error setting default warehouse:', err);
      alert(`خطا در تنظیم انبار پیش‌فرض: ${err.message || 'خطای سرور'}`);
    }
  };

  const handleTransfer = async (t: WarehouseTransfer & { serialNumbers?: string[] }) => {
    try {
      const token = (await authSessionService.getAccessToken()) || '';
      const transferDate = t.date || getCurrentJalaliDate();
      const itemsPayload = t.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        serialNumbers: (item as any).serialNumbers || t.serialNumbers
      }));

      const orgId = state.organizationId || 'default-org';
      const operationKey = `tr_op_${t.fromWarehouseId}_${t.toWarehouseId}_${Date.now()}`;
      const requestFingerprint = buildTransferFingerprint(
        orgId,
        t.fromWarehouseId,
        t.toWarehouseId,
        transferDate,
        itemsPayload
      );

      const payload = {
        sourceWarehouseId: t.fromWarehouseId,
        destinationWarehouseId: t.toWarehouseId,
        transferDate,
        description: t.description || 'انتقال بین انبارها',
        operationKey,
        requestFingerprint,
        items: itemsPayload
      };

      const res = await fetch('/api/warehouse-transfers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || 'خطا در ثبت انتقال انبار در سرور');
      }

      alert('انتقال بین انبارها همراه با صدور سند حسابداری اتمیک با موفقیت ثبت شد.');
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      console.error('Error recording warehouse transfer:', err);
      alert(`خطا در ثبت انتقال انبار: ${err.message || err}`);
    }
  };

  const handleReverseTransfer = async (transactionId: string, reason: string) => {
    try {
      const orgId = state.organizationId || 'default-org';
      const operationKey = `rev_op_${transactionId}_${Date.now()}`;
      const requestFingerprint = buildReversalFingerprint(orgId, transactionId, reason);

      const res = await WarehouseService.reverseTransfer(transactionId, reason, operationKey, requestFingerprint);
      if (res && res.success === false) {
        throw new Error(res.message || 'خطا در برگشت انتقال انبار');
      }

      alert('برگشت انتقال انبار و صدور سند معکوس با موفقیت ثبت شد.');
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      console.error('Error reversing warehouse transfer:', err);
      alert(`خطا در برگشت انتقال انبار: ${err.message || err}`);
    }
  };

  const handleAddCostCenter = (cc: CostCenter) => {
    setState(prev => {
      const updated = { ...prev, costCenters: [...prev.costCenters, cc] };
      saveAppState(updated);
      return updated;
    });
  };

  const handleDeleteCostCenter = (id: string) => {
    setAppConfirmationModal({
      isOpen: true,
      title: 'تایید حذف مرکز هزینه',
      message: 'آیا از حذف این مرکز هزینه اطمینان دارید؟',
      confirmText: 'بله، حذف شود',
      cancelText: 'انصراف',
      onConfirm: () => {
        setState(prev => {
          const updated = { ...prev, costCenters: prev.costCenters.filter(cc => cc.id !== id) };
          saveAppState(updated);
          return updated;
        });
      }
    });
  };

  const handleDeleteProduct = (productId: string) => {
    const product = state.products.find(p => p.id === productId);
    
    if (!product) return;

    // Check for history
    const hasInvoiceHistory = state.invoices.some(inv => inv.items.some(item => item.productId === productId));
    const hasVoucherHistory = state.vouchers.some(v => v.entries.some(e => e.floatingDetailed?.type === 'product' && e.floatingDetailed?.id === productId));
    
    // Check for inventory (stock)
    const hasStock = product.initialStock > 0;
    
    if (hasInvoiceHistory || hasVoucherHistory || hasStock) {
      setAppConfirmationModal({
        isOpen: true,
        title: 'عدم امکان حذف کالا',
        message: `کالای "${product.name}" به دلیل داشتن سابقه تراکنش یا موجودی اولیه در انبار، قابل حذف نیست.`,
      });
      return;
    }

    setAppConfirmationModal({
      isOpen: true,
      title: 'تایید حذف / غیرفعال‌سازی کالا',
      message: `آیا از غیرفعال‌سازی کالای "${product.name}" اطمینان دارید؟`,
      confirmText: 'بله، حذف / غیرفعال شود',
      cancelText: 'انصراف',
      onConfirm: async () => {
        try {
          await ProductService.deleteProduct(productId);
          const refreshedProducts = await ProductService.getProducts();
          setState(prev => ({
            ...prev,
            products: refreshedProducts
          }));
        } catch (err: any) {
          console.error('Failed to deactivate product on server:', err);
          alert(`❌ خطا در غیرفعال‌سازی کالا: ${err.message || 'خطای ناشناخته'}`);
        }
      }
    });
  };

  // Invoice Handlers
  const handleInvoiceSubmit = async (
    invoiceData: Omit<Invoice, 'id' | 'invoiceNumber' | 'createdAt' | 'isConverted' | 'voucherId'>,
    cheques?: Omit<Check, 'id' | 'currentState' | 'history' | 'createdAt'>[],
    settlementCommission?: number,
    criticalDetails?: CriticalDetails
  ) => {
    const person = state.persons.find(p => p.id === invoiceData.personId);
    if (!person) return;

    // Cheque / Installment Settlement Safety Gate (Phase 6 / Fail-Closed)
    if ((invoiceData.isInstallmentDeferred || invoiceData.isSettledWithChecks || (cheques && cheques.length > 0)) && !invoiceData.isProInvoice) {
      alert('تسویه با چک یا اقساط در فاز بعد به تراکنش سرور متصل خواهد شد و در حال حاضر این مسیر غیرفعال (Fail-Closed) است.');
      return;
    }

    if (invoiceData.type === 'sell' && !invoiceData.isProInvoice) {
      const calculatedItems = [];
      for (const item of invoiceData.items) {
        const prod = state.products.find(p => p.id === item.productId);
        if (!prod) {
          alert(`❌ کالای با کد ${item.productId} پیدا نشد.`);
          return;
        }
        const isSerialProduct = prod.hasSerial || prod.category === 'موبایل';
        const method = isSerialProduct ? 'serial' : (state.settings.inventoryValuationMethod === 'FIFO' ? 'fifo' : 'average');

        try {
          const costData = calculatePersistentCost(item, {
            products: state.products,
            invoices: state.invoices,
            openingBalances: state.openingBalances
          }, method);

          if (!costData || costData.costPrice <= 0 || costData.totalCostPrice <= 0) {
            throw new Error(`مبلغ بهای تمام‌شده غیرمنطقی است (${costData?.costPrice || 0}).`);
          }

          calculatedItems.push({
            ...item,
            costPrice: costData.costPrice,
            totalCostPrice: costData.totalCostPrice
          });
        } catch (err: any) {
          alert(`❌ خطای محاسبه بهای تمام شده برای کالای «${prod.name}»:\n${err.message || err}`);
          return;
        }
      }
      invoiceData.items = calculatedItems;
    }

    // Feature 5: Credit Limit Check
    if (invoiceData.type === 'sell' && !invoiceData.isProInvoice) {
      const creditStatus = checkCreditLimit(person, state.vouchers, invoiceData.totalAmount);
      if (!creditStatus.allowed) {
        if (state.settings.controlCreditLimit) {
          // Fallback log instead of blocking alert
          console.error(`❌ خطای سقف اعتبار مشتری: سقف اعتبار این مشتری (${person.creditLimit?.toLocaleString()} ریال) تکمیل شده است.`);
        } else {
          console.warn(`هشدار اعتبار: سقف اعتبار این مشتری (${person.creditLimit?.toLocaleString()} ریال) تکمیل شده است.`);
        }
      }
    }

    // Authoritative Server API Execution (POST /api/invoices)
    let serverResult;
    try {
      serverResult = await InvoiceService.createInvoice({
        type: invoiceData.type,
        personId: invoiceData.personId,
        personName: person.name,
        date: invoiceData.date,
        dateJalali: invoiceData.date,
        isProInvoice: Boolean(invoiceData.isProInvoice),
        discount: invoiceData.discount || 0,
        taxPercent: invoiceData.taxPercent || 0,
        description: invoiceData.description,
        cashPaidAmount: invoiceData.cashPaidAmount || 0,
        posPaidAmount: invoiceData.posPaidAmount || 0,
        posTerminalId: invoiceData.posTerminalId,
        isInstallmentDeferred: Boolean(invoiceData.isInstallmentDeferred),
        isSettledWithChecks: Boolean(invoiceData.isSettledWithChecks),
        isPaidFromWallet: Boolean(invoiceData.isPaidFromWallet),
        settlementCommission: settlementCommission || 0,
        costCenterId: invoiceData.costCenterId,
        purchaseManagerProfitRate: invoiceData.purchaseManagerProfitRate,
        items: invoiceData.items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount || 0,
          warehouseId: item.warehouseId,
          costPrice: item.costPrice,
          totalCostPrice: item.totalCostPrice,
          serialNumbers: item.serialNumbers
        }))
      });
    } catch (err: any) {
      const norm = InvoiceService.normalizeError(err);
      alert(`❌ خطای سرور در ثبت فاکتور:\n${norm.message}`);
      return;
    }

    const newInvoice: Invoice = {
      ...invoiceData,
      id: serverResult.invoiceId,
      invoiceNumber: serverResult.invoiceNumber,
      isConverted: false,
      createdAt: new Date().toISOString(),
      settlementCommission: settlementCommission,
      voucherId: serverResult.journalVoucherId || undefined
    };

    if (newInvoice.type === 'sell' && !newInvoice.creditRulesSnapshot) {
      const rules = resolvePartnerCreditRules(person, state.businessPartners);
      newInvoice.creditRulesSnapshot = {
        maxCreditLimit: rules.maxCreditLimit,
        defaultInstallmentDays: rules.defaultInstallmentDays,
        penaltyRatePerMonth: rules.penaltyRatePerMonth,
        snapshotCreatedAt: new Date().toISOString()
      };
    }

    // Feature 9: Audit Log
    const log = createAuditLog(
      'CREATE',
      'INVOICE',
      serverResult.invoiceId,
      `ثبت فاکتور ${invoiceData.type === 'sell' ? 'فروش' : 'خرید'} شماره ${serverResult.invoiceNumber}`,
      undefined,
      newInvoice
    );

    setState(prev => ({
      ...prev,
      auditLogs: [...prev.auditLogs, log]
    }));

    // Non-blocking event notification for SMS module
    globalFinancialEventAdapter.emitInvoiceCreated({
      invoiceNumber: String(newInvoice.invoiceNumber),
      totalAmount: newInvoice.totalAmount,
      isCash: !newInvoice.isInstallmentDeferred && (newInvoice.cashPaidAmount || 0) > 0,
      customerName: person.name,
      customerPhone: person.mobile || person.phone,
      dueDate: newInvoice.date,
    }, currentUserRole, currentAgentId);

    setShowInvoiceForm(false);
    setSelectedInvoiceForView(undefined);

    // Rule 20: Server-Authoritative Post-Mutation Hydration
    const nextGen = ++financialFetchGenerationRef.current;
    await loadServerAuthoritativeFinancialData(nextGen, true);
  };

  const handleConvertToRealInvoice = async (invoiceId: string) => {
    const targetInvIndex = state.invoices.findIndex(inv => inv.id === invoiceId);
    if (targetInvIndex === -1) return;

    const invoice = state.invoices[targetInvIndex];
    if (!invoice.isProInvoice) return; // already real

    const opKey = `CONVERT_PRO_INVOICE_${invoice.id}_${Date.now()}`;
    const isServerPersisted = serverPersistedInvoiceIdsRef.current.has(invoice.id);

    try {
      if (isServerPersisted) {
        // Mode 1: Authoritative Update on existing server pro-invoice
        await InvoiceService.updateInvoice(
          invoice.id,
          invoice.version || 1,
          opKey,
          {
            type: invoice.type,
            personId: invoice.personId,
            personName: state.persons.find(p => p.id === invoice.personId)?.name,
            date: invoice.date,
            dateJalali: invoice.date,
            isProInvoice: false,
            discount: invoice.discount || 0,
            taxPercent: invoice.taxPercent || 0,
            description: invoice.description,
            cashPaidAmount: invoice.cashPaidAmount || 0,
            posPaidAmount: invoice.posPaidAmount || 0,
            posTerminalId: invoice.posTerminalId,
            isInstallmentDeferred: Boolean(invoice.isInstallmentDeferred),
            isSettledWithChecks: Boolean(invoice.isSettledWithChecks),
            isPaidFromWallet: Boolean(invoice.isPaidFromWallet),
            settlementCommission: invoice.settlementCommission || 0,
            costCenterId: invoice.costCenterId,
            purchaseManagerProfitRate: invoice.purchaseManagerProfitRate,
            items: invoice.items.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount || 0,
              warehouseId: item.warehouseId || (state.settings?.defaultWarehouseId || 'WH-MAIN'),
              costPrice: item.costPrice,
              totalCostPrice: item.totalCostPrice,
              serialNumbers: item.serialNumbers
            }))
          }
        );
      } else {
        // Mode 2: Pro-invoice is local/unmigrated, create authoritative real invoice on server
        await InvoiceService.createInvoice(
          {
            type: invoice.type,
            personId: invoice.personId,
            personName: state.persons.find(p => p.id === invoice.personId)?.name,
            date: invoice.date,
            dateJalali: invoice.date,
            isProInvoice: false,
            discount: invoice.discount || 0,
            taxPercent: invoice.taxPercent || 0,
            description: invoice.description,
            cashPaidAmount: invoice.cashPaidAmount || 0,
            posPaidAmount: invoice.posPaidAmount || 0,
            posTerminalId: invoice.posTerminalId,
            isInstallmentDeferred: Boolean(invoice.isInstallmentDeferred),
            isSettledWithChecks: Boolean(invoice.isSettledWithChecks),
            isPaidFromWallet: Boolean(invoice.isPaidFromWallet),
            settlementCommission: invoice.settlementCommission || 0,
            costCenterId: invoice.costCenterId,
            purchaseManagerProfitRate: invoice.purchaseManagerProfitRate,
            items: invoice.items.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount || 0,
              warehouseId: item.warehouseId || (state.settings?.defaultWarehouseId || 'WH-MAIN'),
              costPrice: item.costPrice,
              totalCostPrice: item.totalCostPrice,
              serialNumbers: item.serialNumbers
            }))
          },
          opKey
        );
      }

      setSelectedInvoiceForView(undefined);
      setShowInvoiceForm(false);
      alert('پیش‌فاکتور با موفقیت به فاکتور قطعی تبدیل و در پایگاه‌داده ثبت شد.');

      // Server-Authoritative Post-Mutation Hydration
      try {
        const nextGen = ++financialFetchGenerationRef.current;
        await loadServerAuthoritativeFinancialData(nextGen, true);
      } catch (refreshErr) {
        console.error('Post-mutation hydration failed:', refreshErr);
        alert(POST_MUTATION_HYDRATION_ERROR);
      }
    } catch (err: any) {
      console.error('Error converting pro-invoice to real invoice:', err);
      const norm = InvoiceService.normalizeError(err, 'خطا در تبدیل پیش‌فاکتور به فاکتور قطعی در سرور');
      alert(`❌ خطای تبدیل پیش‌فاکتور:\n${norm.message}`);
    }
  };

  // Investor Accounting Voucher Callback Handler
  const handleInvestorVoucherCreation = async (voucherDraft: InvestorVoucherDraftRequest) => {
    if (!voucherDraft || !voucherDraft.isBalanced || !voucherDraft.entries || voucherDraft.entries.length === 0) {
      console.error('درخواست ساخت سند حسابداری سرمایه‌گذار نامعتبر یا نامتوازن است:', voucherDraft);
      alert('خطا: سند حسابداری سرمایه‌گذار نامعتبر یا نامتوازن است.');
      return;
    }

    try {
      const token = (await authSessionService.getAccessToken()) || '';
      const payload = {
        date: voucherDraft.date || getCurrentJalaliDate(),
        description: voucherDraft.description,
        entries: voucherDraft.entries.map((entry) => ({
          subsidiaryId: entry.subsidiaryId,
          floatingDetailed: entry.floatingDetailed,
          debit: entry.debit,
          credit: entry.credit,
          description: entry.description || voucherDraft.description,
        }))
      };

      const res = await fetch('/api/manual-vouchers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || 'خطا در ثبت سند سرمایه‌گذار در سرور');
      }

      const serverVoucherId = json.data?.voucher_id || json.data?.id;
      const auditLog = createAuditLog(
        'CREATE',
        'VOUCHER' as any,
        serverVoucherId || `v_inv_${Date.now()}`,
        `ثبت سند حسابداری سرمایه‌گذار - قرارداد ${voucherDraft.contractNumber} - رویداد ${voucherDraft.eventType}`
      );

      setState(prev => {
        const updated = {
          ...prev,
          auditLogs: [...(prev.auditLogs || []), auditLog],
        };
        saveAppState(updated);
        return updated;
      });

      alert('سند حسابداری سرمایه‌گذار با موفقیت در سرور ثبت شد.');
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      console.error('Error creating investor voucher on server:', err);
      alert(`خطا در ثبت سند سرمایه‌گذار: ${err.message || err}`);
    }
  };

  // Checkbook Handlers
  const handleSaveCheckbook = (newCheckbook: CheckbookModel) => {
    setState(prev => {
      const updatedCheckbooks = [...(prev.checkbooks || []), newCheckbook];
      const auditLog = createAuditLog(
        'CREATE',
        'APP_STATE' as any,
        newCheckbook.id,
        `تعریف دسته چک جدید برای بانک ${newCheckbook.bankName} با ${newCheckbook.totalLeaves} برگه (سریال ${newCheckbook.startSerial} تا ${newCheckbook.endSerial})`
      );
      const updated = {
        ...prev,
        checkbooks: updatedCheckbooks,
        auditLogs: [...(prev.auditLogs || []), auditLog]
      };
      saveAppState(updated);
      return updated;
    });
  };

  const handleUpdateCheckbook = (updatedCheckbook: CheckbookModel) => {
    setState(prev => {
      const updatedCheckbooks = (prev.checkbooks || []).map(cb => cb.id === updatedCheckbook.id ? updatedCheckbook : cb);
      const updated = {
        ...prev,
        checkbooks: updatedCheckbooks
      };
      saveAppState(updated);
      return updated;
    });
  };

  const handleDeleteCheckbook = (checkbookId: string) => {
    setState(prev => {
      const cb = (prev.checkbooks || []).find(c => c.id === checkbookId);
      if (cb && cb.leaves.some(l => l.status === 'issued')) {
        alert('❌ امکان حذف دسته چکی که برگه‌های صادر شده دارد وجود ندارد. می‌توانید آن را آرشیو کنید.');
        return prev;
      }
      const updatedCheckbooks = (prev.checkbooks || []).filter(c => c.id !== checkbookId);
      const updated = {
        ...prev,
        checkbooks: updatedCheckbooks
      };
      saveAppState(updated);
      return updated;
    });
  };

  // Check Handlers (Authoritative PostgreSQL Create Cutover - Command 9)
  const handleAddCheck = async (checkData: Omit<Check, 'id' | 'currentState' | 'history' | 'createdAt'>) => {
    const perm = checkCheckOperationPermission('CREATE', undefined, checkData);
    if (!perm.allowed) {
      alert(`❌ خطای دسترسی: ${perm.reason}`);
      return;
    }

    const opKey = `CREATE_${checkData.checkNumber}_${checkData.personId}_${checkData.amount}_${checkData.dueDate}`;
    const lock = acquireCheckOpLock(opKey);
    if (!lock.acquired) {
      alert(lock.reason);
      return;
    }

    try {
      const initialHistoryState = checkData.type === 'received' ? 'present_in_cashbox' : 'issued';

      const createdDbRecord = await ChequeClientService.createCheque({
        chequeType: checkData.type,
        currentState: initialHistoryState,
        personId: checkData.personId,
        invoiceId: checkData.invoiceId,
        installmentBookId: checkData.installmentBookId,
        investorId: checkData.investorId,
        checkNumber: checkData.checkNumber,
        sayadiIdentifier: checkData.sayadiNumber,
        amount: checkData.amount,
        bankName: checkData.bankName,
        dueDate: checkData.dueDate,
        issueDate: (checkData as any).issueDate,
        description: (checkData as any).description,
        operationKey: opKey,
      });

      const newCheck = mapDbRecordToCheck(createdDbRecord);

      const auditLog = createAuditLog(
        'CREATE',
        'CHECK' as any,
        newCheck.id,
        `[IdempotencyKey: ${opKey}] ثبت اولیه چک شماره ${checkData.checkNumber} به مبلغ ${checkData.amount.toLocaleString()} ریال در سرور`
      );

      setState(prev => {
        let updatedCheckbooks = prev.checkbooks || [];
        if (checkData.checkbookId && checkData.type === 'paid') {
          updatedCheckbooks = updatedCheckbooks.map(cb => {
            if (cb.id === checkData.checkbookId) {
              const newLeaves = cb.leaves.map(leaf => {
                if (
                  (checkData.leafIndex && leaf.leafIndex === checkData.leafIndex) ||
                  leaf.checkNumber === checkData.checkNumber
                ) {
                  return {
                    ...leaf,
                    status: 'issued' as const,
                    checkId: newCheck.id,
                    issuedDate: newCheck.createdAt || new Date().toISOString()
                  };
                }
                return leaf;
              });
              const allFinished = newLeaves.every(l => l.status === 'issued' || l.status === 'cancelled');
              return {
                ...cb,
                leaves: newLeaves,
                status: allFinished ? ('finished' as const) : cb.status
              };
            }
            return cb;
          });
        }

        return {
          ...prev,
          checkbooks: updatedCheckbooks,
          auditLogs: [...(prev.auditLogs || []), auditLog]
        };
      });

      releaseCheckOpLock(opKey, true);

      // Rule 20: Server-Authoritative Post-Mutation Hydration
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      releaseCheckOpLock(opKey, false);
      console.error('Error adding check:', err);
      alert(`❌ خطای ثبت چک در دیتابیس: ${err.message || err}`);
    }
  };

  const handleIssueInvestorCheck = async (
    _obligationId: string,
    _checkData: Omit<Check, 'id' | 'currentState' | 'history' | 'createdAt'>
  ) => {
    alert('برچسب‌گذاری چک کارمزد سرمایه‌گذار تا تکمیل بازطبقه‌بندی اتمیک همان چک در سرور موقتاً غیرفعال است. چک اولیه بدون تغییر باقی ماند و هیچ چک یا سند جدیدی ثبت نشد.');
  };

  const handleEditCheck = async (updatedCheck: Check, customDescription?: string) => {
    const perm = checkCheckOperationPermission('EDIT', updatedCheck);
    if (!perm.allowed) {
      alert(`❌ خطای دسترسی: ${perm.reason}`);
      return;
    }

    const oldCheck = state.checks.find(c => c.id === updatedCheck.id);
    if (!oldCheck) return;

    const opKey = `EDIT_${updatedCheck.id}_${oldCheck.version || 1}`;
    const lock = acquireCheckOpLock(opKey);
    if (!lock.acquired) {
      alert(lock.reason);
      return;
    }

    try {
      await ChequeClientService.editCheque(updatedCheck.id, {
        expectedVersion: oldCheck.version || 1,
        mutationKey: opKey,
        checkNumber: updatedCheck.checkNumber,
        dueDate: updatedCheck.dueDate,
        bankName: updatedCheck.bankName,
        personId: updatedCheck.personId,
        sayadiIdentifier: updatedCheck.sayadiNumber,
        description: customDescription || 'ویرایش مشخصات چک'
      });

      const auditLog = createAuditLog(
        'UPDATE',
        'CHECK' as any,
        updatedCheck.id,
        `[IdempotencyKey: ${opKey}] ویرایش مشخصات چک شماره ${updatedCheck.checkNumber} در سرور`
      );

      setState(prev => ({
        ...prev,
        auditLogs: [...(prev.auditLogs || []), auditLog]
      }));

      releaseCheckOpLock(opKey, true);

      // Rule 20: Server-Authoritative Post-Mutation Hydration
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      releaseCheckOpLock(opKey, false);
      console.error('Error editing check:', err);
      alert(`❌ خطا در ویرایش چک در سرور: ${err.message || err}`);
    }
  };

  const handleDeleteCheck = async (checkId: string, customVoidReason?: string) => {
    const checkToProcess = state.checks.find(c => c.id === checkId);
    if (!checkToProcess) return;

    const perm = checkCheckOperationPermission('VOID', checkToProcess);
    if (!perm.allowed) {
      alert(`❌ خطای دسترسی: ${perm.reason}`);
      return;
    }

    if (checkToProcess.status === 'voided') {
      alert('⚠️ این چک قبلاً ابطال گردیده است.');
      return;
    }

    const opKey = `PROCESS_CHECK_${checkId}_${checkToProcess.version || 1}`;
    const lock = acquireCheckOpLock(opKey);
    if (!lock.acquired) {
      alert(lock.reason);
      return;
    }

    try {
      try {
        await ChequeClientService.deleteCheque(checkId, checkToProcess.version || 1);
      } catch (delErr: any) {
        await ChequeClientService.reverseCheque(checkId, {
          expectedVersion: checkToProcess.version || 1,
          mutationKey: opKey,
          description: customVoidReason || 'ابطال رسمی چک'
        });
      }

      const auditLog = createAuditLog(
        'DELETE',
        'CHECK' as any,
        checkId,
        `[IdempotencyKey: ${opKey}] ابطال یا حذف چک در سرور`
      );

      setState(prev => ({
        ...prev,
        auditLogs: [...(prev.auditLogs || []), auditLog]
      }));

      releaseCheckOpLock(opKey, true);

      // Rule 20: Server-Authoritative Post-Mutation Hydration
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      releaseCheckOpLock(opKey, false);
      console.error('Error processing check deletion/reversal:', err);
      alert(`❌ خطا در ابطال/حذف چک: ${err.message || err}`);
    }
  };

  const handleUpdateBankTerminals = (terminals: BankTerminal[]) => {
    setState(prev => {
      const updated = { ...prev, bankTerminals: terminals };
      saveAppState(updated);
      return updated;
    });
  };

  const handleUpdateCheckState = async (
    checkId: string, 
    newState: ReceivedCheckState | PaidCheckState, 
    newSubState?: BouncedReceivedCheckSubState | BouncedPaidCheckSubState,
    note?: string,
    bankId?: string,
    cashId?: string,
    endorsedPersonId?: string
  ) => {
    const checkToUpdate = state.checks.find(c => c.id === checkId);
    if (!checkToUpdate) return;

    const perm = checkCheckOperationPermission('UPDATE_STATE', checkToUpdate);
    if (!perm.allowed) {
      alert(`❌ خطای دسترسی: ${perm.reason}`);
      return;
    }

    const transitionCheck = isValidCheckTransition(checkToUpdate.type, checkToUpdate.currentState, newState, newSubState);
    if (!transitionCheck.allowed) {
      alert(`❌ این عملیات با وضعیت فعلی چک مجاز نیست.`);
      return;
    }

    if (checkToUpdate.currentState === newState && checkToUpdate.currentSubState === newSubState) {
      alert('⚠️ چک هم‌اکنون در این وضعیت قرار دارد.');
      return;
    }

    const opKey = `UPDATE_STATE_${checkId}_${newState}_${newSubState || ''}`;
    const lock = acquireCheckOpLock(opKey);
    if (!lock.acquired) {
      alert(lock.reason);
      return;
    }

    try {
      await ChequeClientService.transitionCheque(checkId, {
        toState: newState,
        expectedVersion: checkToUpdate.version || 1,
        mutationKey: opKey,
        bankSubId: bankId,
        endorsedPersonId,
        description: note || 'تغییر وضعیت چک'
      });

      const auditLog = createAuditLog(
        'UPDATE',
        'CHECK' as any,
        checkId,
        `[IdempotencyKey: ${opKey}] تغییر وضعیت چک شماره ${checkToUpdate.checkNumber} از ${checkToUpdate.currentState} به ${newState} در سرور`
      );

      setState(prev => ({
        ...prev,
        auditLogs: [...(prev.auditLogs || []), auditLog]
      }));

      releaseCheckOpLock(opKey, true);

      // Rule 20: Server-Authoritative Post-Mutation Hydration
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      releaseCheckOpLock(opKey, false);
      console.error('Error updating check state:', err);
      alert(`❌ خطا در تغییر وضعیت چک در دیتابیس: ${err.message || err}`);
    }
  };

  const handleApproveCheck = async (checkId: string) => {
    const checkToApprove = state.checks.find(c => c.id === checkId);
    if (!checkToApprove) return;

    const perm = checkCheckOperationPermission('APPROVE', checkToApprove);
    if (!perm.allowed) {
      alert(`❌ خطای دسترسی: ${perm.reason}`);
      return;
    }

    if (checkToApprove.isApproved) {
      alert('⚠️ این چک قبلاً تأیید نهایی شده است.');
      return;
    }

    const opKey = `APPROVE_${checkId}`;
    const lock = acquireCheckOpLock(opKey);
    if (!lock.acquired) {
      alert(lock.reason);
      return;
    }

    try {
      const targetState = checkToApprove.currentState || (checkToApprove.type === 'received' ? 'present_in_cashbox' : 'issued');
      await ChequeClientService.transitionCheque(checkId, {
        toState: targetState,
        expectedVersion: checkToApprove.version || 1,
        mutationKey: opKey,
        description: 'تأیید و ثبت نهایی چک در سیستم'
      });

      const auditLog = createAuditLog(
        'UPDATE',
        'CHECK' as any,
        checkId,
        `[IdempotencyKey: ${opKey}] تأیید نهایی چک شماره ${checkToApprove.checkNumber} توسط کاربر ${currentUserId || 'سیستم'} (${currentUserRole})`
      );

      setState(prev => ({
        ...prev,
        auditLogs: [...(prev.auditLogs || []), auditLog]
      }));

      releaseCheckOpLock(opKey, true);
      alert('چک با موفقیت در پایگاه‌داده تأیید شد.');

      // Server-Authoritative Post-Mutation Hydration
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      releaseCheckOpLock(opKey, false);
      console.error('Error approving check:', err);
      alert(`❌ خطا در تأیید چک در سرور: ${err.message || err}`);
    }
  };

  const handleBulkUpdateCheckState = (
    _checkIds: string[],
    _newState: ReceivedCheckState | PaidCheckState,
    _newSubState?: BouncedReceivedCheckSubState | BouncedPaidCheckSubState,
    _note?: string,
    _bankId?: string,
    _cashId?: string,
    _endorsedPersonId?: string
  ) => {
    alert('تغییر گروهی وضعیت چک‌ها تا ایجاد عملیات اتمیک سرور موقتاً غیرفعال است. برای جلوگیری از ثبت ناقص، وضعیت هر چک را جداگانه تغییر دهید.');
  };

  // Manual Voucher Handler (Cutover to PostgreSQL Atomic RPC infrastructure)
  const handleManualVoucherSubmit = async (voucherData: Omit<JournalVoucher, 'id' | 'voucherNumber' | 'gregorianDate' | 'isAutomatic'>) => {
    if (selectedVoucherForEdit) {
      setState(prev => {
        const updatedVouchers = prev.vouchers.map(v => {
          if (v.id === selectedVoucherForEdit.id) {
            return {
              ...v,
              ...voucherData,
              gregorianDate: new Date().toISOString()
            };
          }
          return v;
        });
        const updated = { ...prev, vouchers: updatedVouchers };
        saveAppState(updated);
        return updated;
      });
      setSelectedVoucherForEdit(undefined);
      setShowManualVoucherForm(false);
      return;
    }

    try {
      const token = (await authSessionService.getAccessToken()) || '';
      const res = await fetch('/api/manual-vouchers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(voucherData)
      });
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || 'خطا در ثبت سند دستی در پایگاه داده');
      }

      setShowManualVoucherForm(false);
      setSelectedVoucherForEdit(undefined);
      alert(json.message || 'سند حسابداری دستی با موفقیت در پایگاه داده ثبت و قطعی شد.');

      // Rule 20: Server-Authoritative Post-Mutation Hydration
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      alert(`خطا در ثبت سند دستی: ${err.message}`);
      throw err;
    }
  };

  const handleAddSubsidiary = (newSub: AccountSubsidiary) => {
    setState(prev => {
      const updated = { ...prev, subsidiaries: [...prev.subsidiaries, newSub] };
      saveAppState(updated);
      return updated;
    });
  };

  const handleEditSubsidiary = (updatedSub: AccountSubsidiary) => {
    setState(prev => {
      const updated = {
        ...prev,
        subsidiaries: prev.subsidiaries.map(s => s.id === updatedSub.id ? updatedSub : s)
      };
      saveAppState(updated);
      return updated;
    });
  };

  const handleUpdateInvoice = async (updatedInvoice: Invoice) => {
    // 7. Fail-Closed Settlement Boundary
    if (updatedInvoice.isSettledWithChecks || updatedInvoice.isInstallmentDeferred) {
      alert('ویرایش فاکتورهای دارای چک صیادی یا اقساط در این نسخه پشتیبانی نمی‌شود.');
      return;
    }

    const currentInvoice = state.invoices.find(inv => inv.id === updatedInvoice.id);
    if (!currentInvoice) {
      alert('فاکتور مورد نظر یافت نشد.');
      return;
    }

    const person = state.persons.find(p => p.id === updatedInvoice.personId);

    try {
      await InvoiceService.updateInvoice(
        updatedInvoice.id,
        currentInvoice.version || 1,
        invoiceUpdateMutationKey,
        {
          type: updatedInvoice.type === 'buy' ? 'buy' : 'sell',
          personId: updatedInvoice.personId,
          personName: person?.name || "",
          date: updatedInvoice.date,
          dateJalali: updatedInvoice.date,
          isProInvoice: Boolean(updatedInvoice.isProInvoice),
          discount: updatedInvoice.discount || 0,
          taxPercent: updatedInvoice.taxPercent || 0,
          description: updatedInvoice.description,
          cashPaidAmount: updatedInvoice.cashPaidAmount || 0,
          posPaidAmount: updatedInvoice.posPaidAmount || 0,
          posTerminalId: updatedInvoice.posTerminalId,
          isInstallmentDeferred: Boolean(updatedInvoice.isInstallmentDeferred),
          isSettledWithChecks: Boolean(updatedInvoice.isSettledWithChecks),
          isPaidFromWallet: Boolean(updatedInvoice.isPaidFromWallet),
          settlementCommission: updatedInvoice.settlementCommission || 0,
          costCenterId: updatedInvoice.costCenterId,
          purchaseManagerProfitRate: updatedInvoice.purchaseManagerProfitRate,
          items: updatedInvoice.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount || 0,
            warehouseId: item.warehouseId,
            costPrice: item.costPrice,
            totalCostPrice: item.totalCostPrice,
            serialNumbers: item.serialNumbers
          }))
        }
      );

      // Generate a new mutationKey for next update action
      setInvoiceUpdateMutationKey(crypto.randomUUID());
      setShowInvoiceForm(false);
      setSelectedInvoiceForView(undefined);

      // Rule 20: Server-Authoritative Post-Mutation Hydration
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (err: any) {
      if (err.status === 409 || (err.message && err.message.includes('version'))) {
        // Concurrency conflict (409 / stale version)
        try {
          const nextGen = ++financialFetchGenerationRef.current;
          await loadServerAuthoritativeFinancialData(nextGen, true);
          alert('فاکتور مورد نظر توسط کاربر دیگری تغییر یافته است. آخرین تغییرات بارگذاری شد. لطفا مجددا بررسی کنید.');
        } catch (refreshErr) {
          alert('خطای تداخل نسخه (409). امکان بارگذاری آخرین تغییرات میسر نشد.');
        }
        return;
      }

      // Other failure: Zero local mutation, show sanitized error
      const norm = InvoiceService.normalizeError(err);
      alert(`❌ خطای سرور در ویرایش فاکتور:
${norm.message}`);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    const invoice = state.invoices.find(inv => inv.id === invoiceId);
    if (!invoice) return;

    const isServerPersisted = serverPersistedInvoiceIdsRef.current.has(invoiceId);

    try {
      if (invoice.isProInvoice) {
        if (isServerPersisted) {
          await InvoiceService.deleteProInvoice(invoiceId);
        } else {
          // Local-only draft pro-invoice
          setState(prev => {
            const nextInvoices = prev.invoices.filter(inv => inv.id !== invoiceId);
            const updated = { ...prev, invoices: nextInvoices };
            saveAppState(updated);
            return updated;
          });
        }
        alert('پیش‌فاکتور با موفقیت حذف شد.');
      } else {
        // Real Invoice Voiding via Authoritative Server Endpoint
        if (!isServerPersisted) {
          alert('❌ این فاکتور در پایگاه‌داده سرور ثبت نشده است و امکان ابطال سروری آن وجود ندارد.');
          return;
        }
        await InvoiceService.voidInvoice(invoiceId, 'ابطال فاکتور');
        alert('فاکتور با موفقیت ابطال و سند معکوس آن در سرور صادر شد.');
      }

      setShowInvoiceForm(false);
      setSelectedInvoiceForView(undefined);

      // Server-Authoritative Post-Mutation Hydration
      try {
        const nextGen = ++financialFetchGenerationRef.current;
        await loadServerAuthoritativeFinancialData(nextGen, true);
      } catch (refreshErr) {
        console.error('Post-mutation hydration failed:', refreshErr);
        alert(POST_MUTATION_HYDRATION_ERROR);
      }
    } catch (err: any) {
      console.error('Error voiding/deleting invoice:', err);
      const norm = InvoiceService.normalizeError(err, 'خطا در ابطال/حذف فاکتور در سرور');
      alert(`❌ خطای ابطال فاکتور:\n${norm.message}`);
    }
  };

  const handleDeleteVoucher = async (voucherId: string) => {
    const targetVoucher = state.vouchers.find(v => v.id === voucherId);
    if (targetVoucher) {
      const policy = checkVoucherDeletionPolicy(targetVoucher);
      if (!policy.allowed) {
        alert(policy.reason || 'این سند حسابداری توسط سیستم ایجاد شده و حذف مستقیم آن امکان‌پذیر نیست. برای اصلاح یا بی‌اثر کردن سند، از فرآیند ابطال یا سند معکوس استفاده کنید.');
        return;
      }

      if (targetVoucher.sourceType === 'buy_invoice' || targetVoucher.sourceType === 'sell_invoice') {
        const inv = state.invoices.find(i => i.voucherId === voucherId || (targetVoucher && isVoucherForInvoice(targetVoucher, i)));
        if (inv) {
          await handleDeleteInvoice(inv.id);
          setSelectedVoucherForView(undefined);
          return;
        }
      }
    }

    setState(prev => {
      const nextVouchers = prev.vouchers.filter(v => v.id !== voucherId);
      const nextInvoices = prev.invoices.map(inv => {
        if (inv.voucherId === voucherId || (targetVoucher && isVoucherForInvoice(targetVoucher, inv))) {
          return { ...inv, isProInvoice: true, voucherId: undefined };
        }
        return inv;
      });
      const updated = {
        ...prev,
        vouchers: nextVouchers,
        invoices: nextInvoices,
        persons: recalculateWalletBalances(prev.persons, nextVouchers)
      };
      saveAppState(updated);
      return updated;
    });

    setSelectedVoucherForView(undefined);

    try {
      const nextGen = ++financialFetchGenerationRef.current;
      await loadServerAuthoritativeFinancialData(nextGen, true);
    } catch (refreshErr) {
      console.error('Post-mutation hydration failed:', refreshErr);
    }
  };

  const handleEditVoucherFromLedger = (voucher: JournalVoucher) => {
    if (voucher.sourceType === 'buy_invoice' || voucher.sourceType === 'sell_invoice') {
      const inv = state.invoices.find(i => i.id === voucher.sourceId);
      if (inv) {
        setSelectedInvoiceForView(inv);
        setShowInvoiceForm(true);
      }
    } else if (voucher.sourceType === 'manual' || !voucher.sourceType) {
      setSelectedVoucherForEdit(voucher);
    } else if (voucher.sourceType === 'opening_balance') {
      const ob = state.openingBalances.find(o => o.id === voucher.sourceId || o.voucherId === voucher.id);
      if (ob) {
        setEditingOpeningBalance(ob);
        setShowOpeningBalanceForm(true);
      }
    }
  };

  const handleDeleteVoucherFromLedger = async (voucher: JournalVoucher) => {
    const policy = checkVoucherDeletionPolicy(voucher);
    if (!policy.allowed) {
      alert(policy.reason || 'این سند حسابداری توسط سیستم ایجاد شده و حذف مستقیم آن امکان‌پذیر نیست. برای اصلاح یا بی‌اثر کردن سند، از فرآیند ابطال یا سند معکوس استفاده کنید.');
      return;
    }

    if (voucher.sourceType === 'buy_invoice' || voucher.sourceType === 'sell_invoice') {
      if (window.confirm('آیا از ابطال فاکتور مربوط به این سند اطمینان دارید؟ با ابطال فاکتور، سند حسابداری آن نیز حذف می‌شود.')) {
        if (voucher.sourceId) await handleDeleteInvoice(voucher.sourceId);
      }
    } else if (voucher.sourceType === 'opening_balance') {
      if (window.confirm('آیا از ابطال تراز افتتاحیه مربوط به این سند اطمینان دارید؟')) {
        const obId = voucher.sourceId || state.openingBalances.find(o => o.voucherId === voucher.id)?.id;
        if (obId) handleDeleteOpeningBalance(obId);
      }
    } else {
      if (window.confirm('آیا از ابطال این سند اطمینان دارید؟')) {
        await handleDeleteVoucher(voucher.id);
      }
    }
  };

  // Dashboard Stats
  const dashboardStats = useMemo(() => {
    // 1. Bank balances sum
    let bankSum = 0;
    state.subsidiaries.forEach(sub => {
      if (sub.generalType === 'بانک‌ها') {
        const bal = subsidiaryBalances[sub.id]?.balance || 0;
        bankSum += bal;
      }
    });

    // 2. Cashbox balances sum
    let cashSum = 0;
    state.subsidiaries.forEach(sub => {
      if (sub.generalType === 'صندوق‌ها') {
        const bal = subsidiaryBalances[sub.id]?.balance || 0;
        cashSum += bal;
      }
    });

    // 3. Receivables & Payables sum
    let totalReceivables = 0;
    let totalPayables = 0;
    Object.keys(personBalances).forEach(pId => {
      const pb = personBalances[pId];
      if (pb.nature === 'بدهکار') totalReceivables += pb.net;
      if (pb.nature === 'بستانکار') totalPayables += pb.net;
    });

    // 4. Checks due today
    const today = getCurrentJalaliDate();
    const todayChecksCount = state.checks.filter(c => c.dueDate === today && c.currentState !== 'cleared').length;

    return {
      bankSum,
      cashSum,
      totalReceivables,
      totalPayables,
      todayChecksCount
    };
  }, [subsidiaryBalances, personBalances, state.checks, state.subsidiaries]);

  const getPersonTransactions = (personId: string) => {
    const list: Array<{
      type: 'invoice' | 'voucher' | 'check';
      id: string;
      voucherId?: string;
      date: string;
      title: string;
      description: string;
      debit: number;
      credit: number;
      referenceObject?: any;
    }> = [];

    state.vouchers.forEach(v => {
      v.entries.forEach(e => {
        if (e.floatingDetailed && e.floatingDetailed.type === 'person' && e.floatingDetailed.id === personId) {
          const matchedInvoice = state.invoices.find(inv => inv.voucherId === v.id);
          const matchedCheck = state.checks.find(ch => 
            ch.id === v.sourceId ||
            (v.sourceType === 'check_state_change' && v.sourceId === ch.id) ||
            ch.history?.some(h => h.voucherId === v.id) ||
            v.id.includes(`_auto_check_${ch.id}`) ||
            (v.description && (v.description.includes(ch.checkNumber) || e.description?.includes(ch.checkNumber)))
          );

          if (matchedInvoice) {
            list.push({
              type: 'invoice',
              id: matchedInvoice.id,
              voucherId: v.id,
              date: v.date,
              title: matchedInvoice.type === 'buy' ? `فاکتور خرید شماره ${matchedInvoice.invoiceNumber}` : `فاکتور فروش شماره ${matchedInvoice.invoiceNumber}`,
              description: e.description || v.description || matchedInvoice.description || '',
              debit: e.debit,
              credit: e.credit,
              referenceObject: matchedInvoice
            });
          } else if (matchedCheck) {
            const checkStateLabel = matchedCheck.currentState === 'present_in_cashbox' ? 'موجود در صندوق' 
              : matchedCheck.currentState === 'cleared' ? 'وصول شده'
              : matchedCheck.currentState === 'bounced' ? 'برگشتی'
              : matchedCheck.currentState === 'deposited_to_bank' ? 'واگذار به بانک'
              : matchedCheck.currentState === 'passed_to_others' ? 'خرج شده' : matchedCheck.currentState;

            list.push({
              type: 'check',
              id: matchedCheck.id,
              voucherId: v.id,
              date: v.date,
              title: `چک شماره ${matchedCheck.checkNumber} (${matchedCheck.bankName})`,
              description: `سررسید: ${matchedCheck.dueDate}${matchedCheck.sayadiNumber ? ` | صیادی: ${matchedCheck.sayadiNumber}` : ''} | وضعیت: ${checkStateLabel}`,
              debit: e.debit,
              credit: e.credit,
              referenceObject: matchedCheck
            });
          } else {
            list.push({
              type: 'voucher',
              id: v.id,
              voucherId: v.id,
              date: v.date,
              title: `سند حسابداری شماره ${v.voucherNumber}`,
              description: e.description || v.description || '',
              debit: e.debit,
              credit: e.credit,
              referenceObject: v
            });
          }
        }
      });
    });

    return list;
  };

  const getPersonLedger = (personId: string) => {
    const transactions = getPersonTransactions(personId);
    // Sort chronologically (oldest to newest)
    transactions.sort((a, b) => a.date.localeCompare(b.date));

    let runningBalance = 0;
    const ledger = transactions.map(t => {
      const diff = (t.debit || 0) - (t.credit || 0);
      runningBalance += diff;
      return {
        ...t,
        runningBalance,
        nature: runningBalance > 0 ? 'بدهکار' : runningBalance < 0 ? 'بستانکار' : 'بی‌حساب'
      };
    });

    // Return reversed for display (newest on top)
    return ledger.reverse();
  };

  const handleLogout = async () => {
    try {
      await authSessionService.signOut();
    } catch {
      // Safe signout
    }
    getDefaultAuthContextService().clear();
    serverPersistedInvoiceIdsRef.current.clear();
    setCurrentUserId('');
    setCurrentUser(null);
    setCurrentUserRole(null);
    setIsLoggedIn(false);
  };

  const registeredAgents = useMemo(() => {
    const bpIds = (state.businessPartners || []).map(bp => bp.personId);
    const list = state.persons.filter(p => p.isAgent || p.role === 'agent' || bpIds.includes(p.id));
    if (list.length === 0) {
      const defaultAgent = state.persons.find(p => p.id === 'p_c_1');
      if (defaultAgent) return [defaultAgent];
    }
    return list;
  }, [state.persons, state.businessPartners]);

  const handleAddProjectNote = (note: Omit<ProjectNote, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newNote: ProjectNote = {
      ...note,
      id: Math.random().toString(36).substr(2, 9),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setState(prev => ({
      ...prev,
      projectNotes: [newNote, ...(prev.projectNotes || [])]
    }));
  };

  const handleUpdateProjectNote = (id: string, updates: Partial<ProjectNote>) => {
    setState(prev => ({
      ...prev,
      projectNotes: (prev.projectNotes || []).map(n => 
        n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
      )
    }));
  };

  const handleDeleteProjectNote = (id: string) => {
    setState(prev => ({
      ...prev,
      projectNotes: (prev.projectNotes || []).filter(n => n.id !== id)
    }));
  };


  const currentPartnerRecord = useMemo(() => {
    let found = null;
    if (currentAgentId) {
      const cleanId = currentAgentId.replace('BP_', '');
      found = (state.businessPartners || []).find(p => 
        p.personId === currentAgentId || 
        p.personId === cleanId || 
        p.id === currentAgentId || 
        p.id === `BP_${cleanId}` ||
        p.profile?.partnerId === currentAgentId
      );
    }
    if (!found) {
      found = (state.businessPartners || []).find(p => (p.users || []).includes(currentUserId));
    }
    return found;
  }, [state.businessPartners, currentUserId, currentAgentId]);

  const isNesyehAgent = useMemo(() => {
    if (!currentPartnerRecord) {
      if (currentAgentId && (currentAgentId.toLowerCase().includes('nesyeh') || currentAgentId.toUpperCase().startsWith('NS') || currentAgentId.toUpperCase().startsWith('BP_NS'))) {
        return true;
      }
      return false;
    }
    const type = currentPartnerRecord.agencyType as any;
    if (type === AgencyType.INSTALLMENT_ONLY || type === 'INSTALLMENT_ONLY' || type === 'DEFERRED_AGENT') {
      return true;
    }
    if (currentPartnerRecord.roles && ((currentPartnerRecord.roles as any[]).includes('DEFERRED_AGENT') || (currentPartnerRecord.roles as any[]).includes('INSTALLMENT_ONLY'))) {
      return true;
    }
    if (currentPartnerRecord.contract?.type === PartnerContractType.DEFERRED_AGENT || (currentPartnerRecord.contract?.type as any) === 'DEFERRED_AGENT') {
      return true;
    }
    if (currentPartnerRecord.nesyehOnboarding || currentPartnerRecord.nesyehSettings) {
      return true;
    }
    if (currentAgentId && (currentAgentId.toLowerCase().includes('nesyeh') || currentAgentId.toUpperCase().startsWith('NS') || currentAgentId.toUpperCase().startsWith('BP_NS'))) {
      return true;
    }
    return false;
  }, [currentPartnerRecord, currentAgentId]);

  if (currentUserRole === 'agent') {
    const partnerIdVal = currentPartnerRecord?.id || currentAgentId || 'N/A';
    const agencyTypeVal = currentPartnerRecord?.agencyType || 'N/A';
    const contractTypeVal = currentPartnerRecord?.contract?.type || (currentPartnerRecord?.nesyehOnboarding ? 'DEFERRED_AGENT' : 'N/A');
    const rolesVal = JSON.stringify(currentPartnerRecord?.roles || []);
    const isNesyehVal = isNesyehAgent;
    const dashboardSelected = isNesyehVal ? 'NesyehPartnerDashboard' : 'PartnerDashboard';
    
    let reasonForPartnerDashboard = 'N/A';
    if (!isNesyehVal) {
      const reasons = [];
      if (!currentPartnerRecord) reasons.push('BusinessPartner Missing');
      if (currentPartnerRecord && !currentPartnerRecord.agencyType) reasons.push('AgencyType Missing');
      if (currentPartnerRecord && !currentPartnerRecord.roles?.includes('DEFERRED_AGENT' as any)) reasons.push('Role Missing');
      if (currentPartnerRecord && !currentPartnerRecord.contract && !currentPartnerRecord.nesyehOnboarding) reasons.push('Contract/Onboarding Missing');
      reasonForPartnerDashboard = reasons.join(', ') || 'General Fallback';
    }

    console.log('--- NESYEH AGENT ROUTING AUDIT ---');
    console.log('Agent Token:', currentAgentId);
    console.log('Partner Id:', partnerIdVal);
    console.log('AgencyType:', agencyTypeVal);
    console.log('ContractType:', contractTypeVal);
    console.log('Roles:', rolesVal);
    console.log('isNesyehAgent:', isNesyehVal);
    console.log('Dashboard Selected:', dashboardSelected);
    if (!isNesyehVal) {
      console.log('Reason PartnerDashboard selected:', reasonForPartnerDashboard);
    }
    console.log('-----------------------------------');

    const nesyehOnboarding = currentPartnerRecord?.nesyehOnboarding;
    const isNesyehBlocked = isNesyehAgent && nesyehOnboarding && (
      nesyehOnboarding.isLinkActive === false ||
      nesyehOnboarding.onboardingStatus === 'SUSPENDED' ||
      nesyehOnboarding.onboardingStatus === 'TERMINATED'
    );

    if (isNesyehBlocked) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 text-right" dir="rtl">
          <div className="bg-white rounded-3xl max-w-md w-full p-8 text-center space-y-6 shadow-2xl border border-rose-500/30">
            <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
              <Lock className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-black text-zinc-900">دسترسی به سامانه نسیه مسدود است</h2>
              <p className="text-xs text-zinc-600 leading-relaxed">
                پوسته نمایندگی نسیه شما به دلیل تعلیق قرارداد، پایان همکاری یا غیرفعال شدن لینک اختصاصی توسط مدیریت موقتاً مسدود شده است. لطفاً با دفتر مرکزی تماس بگیرید.
              </p>
            </div>
            <button
              onClick={() => {
                setIsLoggedIn(false);
                setCurrentUserRole(null);
                window.location.href = window.location.pathname;
              }}
              className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-3 rounded-xl text-xs transition-colors cursor-pointer"
            >
              بازگشت به صفحه اصلی
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col text-right" dir="rtl">

        <div className="w-full h-[calc(100vh-40px)] bg-zinc-50 flex flex-col relative overflow-hidden">
          {isNesyehAgent ? (
            <NesyehPartnerDashboard 
              state={state} 
              currentUserId={currentUserId}
              currentAgentId={currentAgentId}
              onLogout={handleLogout}
              onUpdateState={handleUpdateState}
            />
          ) : (
            <PartnerDashboard 
              state={state} 
              currentUserId={currentUserId}
              currentAgentId={currentAgentId}
              onLogout={handleLogout}
              onAddCustomer={async (personData) => {
                const nextCode = generateUniquePersonCode(state.persons);
                const newPersonPayload: Partial<Person> = {
                  code: nextCode,
                  name: personData.name || '',
                  mobile: personData.mobile,
                  phone: personData.phone,
                  nationalId: personData.nationalId,
                  address: personData.address,
                  role: 'debtor',
                  createdAt: new Date().toISOString(),
                  createdBy: currentUserId,
                  representativeId: currentAgentId
                };
                try {
                  const savedPerson = await PersonService.createPerson(newPersonPayload);
                  setState(prev => {
                    const updated = { ...prev, persons: [...prev.persons, savedPerson] };
                    saveAppState(updated);
                    return updated;
                  });
                } catch (err: any) {
                  console.error('Failed to create customer in PartnerDashboard:', err);
                  alert(`خطا در ثبت مشتری در سرور: ${err.message || 'خطای ناشناخته'}`);
                }
              }}
              onUpdateState={handleUpdateState}
            />
          )}
        </div>
        <ProjectNotebook 
          notes={state.projectNotes || []}
          onAddNote={handleAddProjectNote}
          onUpdateNote={handleUpdateProjectNote}
          onDeleteNote={handleDeleteProjectNote}
        />
      </div>
    );
  }

  if (isInitialLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col justify-center items-center p-6 text-right" dir="rtl">
        <div className="w-full max-w-md mx-auto bg-white p-8 rounded-3xl border border-zinc-150 shadow-sm text-center space-y-6 font-sans">
          <div className="inline-flex bg-indigo-50 border border-indigo-100 p-4 rounded-3xl animate-pulse">
            <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-zinc-800 font-sans">در حال همگام‌سازی و بارگذاری اطلاعات...</h2>
            <p className="text-[10px] text-zinc-400 mt-2 font-sans leading-relaxed">
              لطفاً چند لحظه شکیبا باشید. در حال دریافت اطلاعات از سرور مرکزی و اتصال امن هستیم.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-zinc-50 flex justify-center items-center p-0 text-right" dir="rtl">
        <div className="w-full h-screen max-w-md mx-auto bg-zinc-50 flex flex-col justify-center relative p-6 font-sans">

          {/* Header */}
          <div className="text-center pt-8">
            <div className="inline-flex bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 p-3.5 rounded-3xl mb-4 animate-bounce">
              <ShieldCheck size={40} className="stroke-[2.5]" />
            </div>
            <h2 className="text-sm font-extrabold text-zinc-800 font-sans">
              سیستم مدیریت مالی زنجیره‌ای
            </h2>
            <p className="text-[10px] text-zinc-400 mt-1 font-sans">
              احراز هویت و مدیریت دسترسی امن (Supabase Auth)
            </p>
          </div>

          {/* Form */}
          <div className="bg-white p-5 rounded-3xl border border-zinc-150 shadow-sm space-y-4">
            <SecureLoginPanel
              authSessionService={authSessionService}
              onAuthenticated={async (verifiedUserId) => {
                if (!verifiedUserId || typeof verifiedUserId !== 'string' || !verifiedUserId.trim()) {
                  return;
                }
                const cleanId = verifiedUserId.trim();
                setCurrentUserId(cleanId);
                setCurrentUser({
                  id: cleanId,
                  role: null,
                } as any);
                setCurrentUserRole(null);
                setIsLoggedIn(true);
                setActiveTab('dashboard');
                setLoginError('');

                const contextRes = await getDefaultAuthContextService().fetchAuthContext(cleanId);
                if (contextRes.status === 'authorized' && contextRes.context.userId === cleanId) {
                  setCurrentUserRole(contextRes.context.uiRole);
                } else {
                  setCurrentUserRole(null);
                }
              }}
            />
          </div>

        </div>
        <ProjectNotebook 
          notes={state.projectNotes || []}
          onAddNote={handleAddProjectNote}
          onUpdateNote={handleUpdateProjectNote}
          onDeleteNote={handleDeleteProjectNote}
        />
      </div>
    );
  }

  if (isLoggedIn && currentUserRole === null) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col justify-center items-center p-6 text-right" dir="rtl">
        <div className="w-full max-w-md bg-white p-8 rounded-3xl border border-zinc-200 shadow-sm text-center font-sans space-y-4">
          <div className="inline-flex bg-amber-50 text-amber-600 p-4 rounded-full border border-amber-200 mb-2">
            <ShieldCheck size={36} className="stroke-[2.5]" />
          </div>
          <h3 className="text-sm font-extrabold text-zinc-800 font-sans">
            هویت شما تأیید شده است؛ سطح دسترسی معتبر هنوز دریافت نشده است.
          </h3>
          <p className="text-xs text-zinc-500 leading-relaxed font-medium font-sans">
            حساب کاربری شما متصل شده است، اما سطح دسترسی یا نقش معتبری از سیستم مرکزی دریافت نشده است.
          </p>
          <button
            onClick={handleLogout}
            className="mt-4 w-full bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-3 rounded-2xl text-xs transition cursor-pointer font-sans"
          >
            خروج از حساب کاربری
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col text-right" dir="rtl">
      {/* Top Supabase Online Sync Banner */}
      <TopSyncBanner 
        syncStatus={syncStatus} 
        financialSyncStatus={financialSyncStatus}
        financialSyncError={financialSyncError}
        onRetryFinancialSync={() => {
          const nextGen = ++financialFetchGenerationRef.current;
          loadServerAuthoritativeFinancialData(nextGen);
        }}
      />

      <div className="w-full h-[calc(100vh-40px)] bg-zinc-50 flex flex-col relative">

        {/* Dynamic Inner Container Content */}
        <div className="flex-1 overflow-hidden relative">
          
          {/* Overlay Flows */}
          <AnimatePresence>
            {showInvoiceForm && (
              <motion.div 
                initial={{ opacity: 0, y: '100%' }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 180 }}
                className="absolute inset-0 bg-zinc-50 z-50 flex flex-col"
              >
                <InvoiceForm
                  persons={state.persons}
                  products={state.products}
                  productCategories={state.productCategories}
                  currentStocks={productStocks}
                  onAddCategory={handleAddCategory}
                  onSubmit={handleInvoiceSubmit}
                  onCancel={() => { setShowInvoiceForm(false); setSelectedInvoiceForView(undefined); }}
                  initialInvoice={selectedInvoiceForView}
                  initialType={invoiceFormType}
                  mode={selectedInvoiceForView ? 'view' : 'create'}
                  onConvertToReal={handleConvertToRealInvoice}
                  onUpdate={handleUpdateInvoice}
                  onDelete={handleDeleteInvoice}
                  allInvoices={state.invoices}
                  vouchers={state.vouchers}
                  appState={state}
                  currentUser={currentUser}
                  onNew={(type) => {
                    setSelectedInvoiceForView(undefined);
                    setInvoiceFormType(type);
                    setShowInvoiceForm(true);
                  }}
                  onOpenAdvancedSearch={() => setSearchModalState({ isOpen: true, type: 'invoices' })}
                />
              </motion.div>
            )}

            {(showManualVoucherForm || selectedVoucherForEdit) && (
              <motion.div 
                initial={{ opacity: 0, y: '100%' }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 180 }}
                className="absolute inset-0 bg-zinc-50 z-50 flex flex-col"
              >
                <ManualVoucherForm
                  subsidiaries={state.subsidiaries}
                  persons={state.persons}
                  businessPartners={state.businessPartners}
                  onSubmit={handleManualVoucherSubmit}
                  onCancel={() => {
                    setShowManualVoucherForm(false);
                    setSelectedVoucherForEdit(undefined);
                  }}
                  onNew={() => {
                    setSelectedVoucherForEdit(undefined);
                    setShowManualVoucherForm(false);
                    setTimeout(() => setShowManualVoucherForm(true), 10);
                  }}
                  onDelete={(id) => {
                    handleDeleteVoucher(id);
                    setShowManualVoucherForm(false);
                    setSelectedVoucherForEdit(undefined);
                  }}
                  nextVoucherNumber={selectedVoucherForEdit ? selectedVoucherForEdit.voucherNumber : getNextVoucherNumber(state.vouchers)}
                  initialVoucher={selectedVoucherForEdit}
                  onOpenAdvancedSearch={() => setSearchModalState({ isOpen: true, type: 'vouchers' })}
                />
              </motion.div>
            )}

            {showInstallmentBooklet && (
              <motion.div 
                initial={{ opacity: 0, y: '100%' }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 180 }}
                className="absolute inset-0 bg-zinc-50 z-50 flex flex-col text-right"
              >
                <InstallmentBookletManager 
                  appState={state} 
                  onSave={setState} 
                  onRefresh={() => loadServerAuthoritativeFinancialData(financialFetchGenerationRef.current, true).then(() => {})}
                  initialInvoiceId={initialInvoiceForInstallment}
                  initialPersonId={initialPersonForInstallment}
                  onClose={() => {
                    setShowInstallmentBooklet(false);
                    setInitialInvoiceForInstallment(undefined);
                    setInitialPersonForInstallment(undefined);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* MAIN TABS */}
          {!isTabAllowedForRole(activeTab, currentUserRole) ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-zinc-50 font-sans pr-12 text-right" dir="rtl">
              <div className="bg-rose-50 text-rose-600 p-4 rounded-full shadow-md mb-4 border border-rose-150 animate-bounce">
                <Lock size={32} className="stroke-[2.5]" />
              </div>
              <h3 className="text-sm font-extrabold text-zinc-800 font-sans">خطای عدم دسترسی (حفاظت سخت‌افزاری)</h3>
              <p className="text-xs text-zinc-500 mt-2 max-w-sm leading-relaxed font-semibold font-sans">
                نقش کاربری فعلی شما <span className="bg-rose-50 text-rose-700 px-2 py-0.5 rounded-md font-bold">{currentUserRole === 'seller' ? 'فروشنده' : currentUserRole === 'cashier' ? 'صندوقدار' : currentUserRole === 'accountant' ? 'حسابدار' : currentUserRole === 'agent' ? 'نماینده فروش' : 'مدیر'}</span> اجازه دسترسی به این بخش را ندارد.
              </p>
            </div>
          ) : isFinancialTab(activeTab) && financialSyncStatus === 'loading' ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-zinc-50 font-sans pr-12 text-right" dir="rtl">
              <div className="bg-amber-50 text-amber-600 p-4 rounded-full shadow-md mb-4 border border-amber-150 animate-spin">
                <RefreshCw size={32} className="stroke-[2.5]" />
              </div>
              <h3 className="text-sm font-extrabold text-zinc-800 font-sans">در حال دریافت دفاتر مالی از سرور مرکزی...</h3>
              <p className="text-xs text-zinc-500 mt-2 max-w-sm leading-relaxed font-medium font-sans">
                اطلاعات حسابداری مستقیماً و به صورت بلادرنگ از سرور در حال بارگذاری هستند. لطفاً شکیبا باشید.
              </p>
            </div>
          ) : isFinancialTab(activeTab) && financialSyncStatus === 'error' ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-zinc-50 font-sans pr-12 text-right" dir="rtl">
              <div className="bg-rose-50 text-rose-600 p-4 rounded-full shadow-md mb-4 border border-rose-150">
                <AlertTriangle size={32} className="stroke-[2.5]" />
              </div>
              <h3 className="text-sm font-extrabold text-zinc-800 font-sans">عدم دسترسی موقت به دفاتر مالی</h3>
              <p className="text-xs text-zinc-500 mt-2 max-w-sm leading-relaxed font-semibold font-sans">
                {financialSyncError || 'اطلاعات مالی از سرور دریافت نشد. برای جلوگیری از نمایش اطلاعات قدیمی، داده‌های ذخیره‌شده روی این دستگاه نمایش داده نمی‌شوند.'}
              </p>
              <button
                onClick={() => {
                  const nextGen = ++financialFetchGenerationRef.current;
                  loadServerAuthoritativeFinancialData(nextGen);
                }}
                className="mt-4 bg-rose-600 hover:bg-rose-700 text-white font-sans text-xs font-bold px-4 py-2 rounded-xl shadow transition cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw size={14} />
                تلاش مجدد دریافت اطلاعات مالی
              </button>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
            <div className="h-full overflow-y-auto p-4 space-y-4 pr-12">
              
              {/* Pending Agent Dossiers Notification Banner */}
              {pendingAgentsCount > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gradient-to-r from-amber-50 to-rose-50 border-r-4 border-rose-500 p-4 rounded-2xl shadow-sm text-right flex items-center justify-between"
                  dir="rtl"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-rose-100 text-rose-600 p-2 rounded-xl animate-pulse shrink-0">
                      <ShieldCheck size={20} className="stroke-[2.5]" />
                    </div>
                    <div>
                      <strong className="block text-zinc-800 text-[11px] font-extrabold font-sans">بررسی پرونده نمایندگان در انتظار</strong>
                      <span className="block text-[10px] text-zinc-500 font-sans font-medium mt-1">
                        تعداد <span className="text-rose-600 font-black font-mono">{pendingAgentsCount} پرونده نماینده جدید</span> در انتظار بررسی و تایید مدارک است.
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('agent_dossiers')}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-sans text-[10px] font-bold px-3.5 py-1.5 rounded-xl shadow transition shrink-0 mr-4"
                  >
                    مشاهده و بررسی سریع
                  </button>
                </motion.div>
              )}

              {/* Overdue Installments Warning Banner */}
              {state.settings.notifyOverdueInstallments && overdueInstallments.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gradient-to-r from-rose-50 to-amber-50 border-r-4 border-rose-600 p-4 rounded-2xl shadow-sm text-right flex items-center justify-between"
                  dir="rtl"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-rose-100 text-rose-700 p-2 rounded-xl animate-pulse shrink-0">
                      <CalendarClock size={20} className="stroke-[2.5]" />
                    </div>
                    <div>
                      <strong className="block text-zinc-800 text-[11px] font-extrabold font-sans">هشدار اقساط سررسید گذشته (معوقه)</strong>
                      <span className="block text-[10px] text-zinc-500 font-sans font-medium mt-1">
                        تعداد <span className="text-rose-600 font-black font-mono">{overdueInstallments.length} قسط پرداخت‌نشده</span> از سررسید مقرر عبور کرده‌اند. لطفاً جهت پیگیری مطالبات اقدام فرمایید.
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('installments')}
                    className="bg-rose-600 hover:bg-rose-700 text-white font-sans text-[10px] font-bold px-3.5 py-1.5 rounded-xl shadow transition shrink-0 mr-4"
                  >
                    مشاهده و پیگیری
                  </button>
                </motion.div>
              )}
              
              {/* Management Overview Card */}
              <div className="bg-gradient-to-br from-emerald-500 to-teal-500 text-white p-5 rounded-3xl shadow-xl relative overflow-hidden">
                <div className="absolute -right-10 -bottom-10 w-36 h-36 bg-white/10 rounded-full pointer-events-none" />
                <span className="font-sans text-[10px] text-emerald-50 block mb-1">خلاصه گزارش مدیریتی شرکت</span>
                <h3 className="font-sans text-xs font-bold text-white">مجموع دارایی نقدی در بازار</h3>
                
                <div className="font-mono text-xl font-black text-white mt-1.5" dir="ltr">
                  {(dashboardStats.bankSum + dashboardStats.cashSum).toLocaleString()} <span className="text-xs font-sans">ریال</span>
                </div>

                <div className="h-px bg-white/20 my-3" />

                <div className="grid grid-cols-2 gap-3 font-sans text-[11px]">
                  <div className="text-right">
                    <span className="text-emerald-50 block">طلبکاران تجاری:</span>
                    <strong className="font-mono text-white text-xs">{(dashboardStats.totalReceivables).toLocaleString()} ریال</strong>
                  </div>
                  <div className="text-right">
                    <span className="text-emerald-50 block">بستانکاران تجاری:</span>
                    <strong className="font-mono text-white text-xs">{(dashboardStats.totalPayables).toLocaleString()} ریال</strong>
                  </div>
                </div>
              </div>

              {/* Agent Dossiers Management Center Widget */}
              <div className="bg-white p-5 rounded-3xl border border-zinc-150 shadow-sm space-y-4 text-right relative overflow-hidden">
                <div className="absolute top-0 left-0 bg-rose-50 text-rose-600 px-3 py-1 text-[9px] font-bold rounded-br-xl">
                  پرونده نمایندگان جدید
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="bg-rose-100 text-rose-600 p-2 rounded-2xl">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h4 className="font-sans text-xs font-bold text-zinc-800">پرونده نمایندگان</h4>
                    <span className="text-[9px] text-zinc-400 block mt-0.5">مدیریت هویتی، تایید مدارک، تضامین و فعال‌سازی دسترسی همکاران</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3.5 pt-1.5">
                  <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-100 flex flex-col justify-between">
                    <span className="text-[9px] text-zinc-500 font-sans">در انتظار تایید مدارک</span>
                    <div className="flex items-baseline justify-between mt-1">
                      <strong className="text-lg font-black font-mono text-rose-600">{pendingAgentsCount}</strong>
                      <span className="text-[8px] font-sans font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded-lg">بررسی نشده</span>
                    </div>
                  </div>

                  <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-100 flex flex-col justify-between">
                    <span className="text-[9px] text-zinc-500 font-sans">کل نمایندگان فعال</span>
                    <div className="flex items-baseline justify-between mt-1">
                      <strong className="text-lg font-black font-mono text-zinc-700">
                        {state.persons.filter(p => p.isAgent && p.isDocumentsApproved).length}
                      </strong>
                      <span className="text-[8px] font-sans font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-lg">فعال</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setActiveTab('agent_dossiers')}
                  className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white font-sans text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
                >
                  <span>ورود به سامانه پرونده نمایندگان</span>
                  <ArrowRight size={14} className="rotate-180" />
                </button>
              </div>

              {/* Quick Actions Grid */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setShowInvoiceForm(true); }}
                  className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right transition-all shadow-sm active:bg-zinc-50 flex flex-col justify-between"
                >
                  <FileText className="text-emerald-500 mb-2 shrink-0" size={18} />
                  <div>
                    <strong className="block text-[11px] font-bold text-zinc-800 font-sans">ثبت فاکتور</strong>
                    <span className="block text-[8px] text-zinc-400 mt-0.5">جدید (خرید یا فروش)</span>
                  </div>
                </button>

                <div className="bg-white border border-zinc-150 p-4 rounded-2xl text-right shadow-sm flex flex-col justify-between">
                   <Landmark className="text-amber-500 mb-2 shrink-0" size={18} />
                   <div>
                     <strong className="block text-[11px] font-bold text-zinc-800 font-sans">مانده کل بدهکاران</strong>
                     <span className="font-mono text-xs text-zinc-600 mt-0.5">{dashboardStats.totalReceivables.toLocaleString()} ریال</span>
                   </div>
                </div>

                <button
                  onClick={() => setShowManualVoucherForm(true)}
                  className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right transition-all shadow-sm active:bg-zinc-50 flex flex-col justify-between"
                >
                  <FileText className="text-purple-500 mb-2 shrink-0" size={18} />
                  <div>
                    <strong className="block text-[11px] font-bold text-zinc-800 font-sans">سند حسابداری دستی</strong>
                    <span className="block text-[8px] text-zinc-400 mt-0.5">ثبت دستی بدهکار و بستانکار دوبل</span>
                  </div>
                </button>

                <button
                  onClick={() => setActiveTab('reports')}
                  className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right transition-all shadow-sm active:bg-zinc-50 flex flex-col justify-between"
                >
                  <TrendingUp className="text-teal-500 mb-2 shrink-0" size={18} />
                  <div>
                    <strong className="block text-[11px] font-bold text-zinc-800 font-sans">گزارش‌های دوره‌ای</strong>
                    <span className="block text-[8px] text-zinc-400 mt-0.5">سود و زیان، چک‌ها، معین</span>
                  </div>
                </button>
              </div>

              {/* Cash & Bank Highlight */}
              <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-3 text-right">
                <span className="font-sans text-xs font-bold text-zinc-800 block">مانده حساب صندوق‌ها و بانک‌ها</span>
                <div className="space-y-2">
                  {state.subsidiaries.filter(s => s.generalType === 'صندوق‌ها' || s.generalType === 'بانک‌ها').map(sub => {
                    const balance = subsidiaryBalances[sub.id]?.balance || 0;
                    return (
                      <div key={sub.id} className="flex justify-between items-center bg-zinc-50 p-2.5 rounded-xl text-right font-sans text-xs border border-zinc-100">
                        <span className="font-mono font-bold text-emerald-600">{balance.toLocaleString()} ریال</span>
                        <span className="text-zinc-700 font-medium">{sub.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Today's due checks alert banner */}
              {dashboardStats.todayChecksCount > 0 && (
                <div className="bg-amber-50 border border-amber-100 text-amber-800 p-3.5 rounded-2xl text-right font-sans text-xs flex items-center justify-between shadow-sm animate-pulse">
                  <span className="bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full font-bold text-[10px]">{dashboardStats.todayChecksCount} فقره</span>
                  <div className="flex-1 pr-3">
                    <strong>سررسید چک‌های امروز:</strong>
                    <span className="block text-[10px] text-amber-700 mt-0.5">جهت تغییر وضعیت و خواباندن به حساب اقدام کنید.</span>
                  </div>
                </div>
              )}

              {/* System Settings & Rules Panel (For Admin and Accountant) */}
              {(currentUserRole === 'admin' || currentUserRole === 'accountant') && (
                <div className="bg-white p-5 rounded-2xl border border-zinc-150 shadow-sm space-y-4 text-right">
                  <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="bg-blue-50 text-blue-600 p-1.5 rounded-lg border border-blue-100">
                        <Server size={16} />
                      </div>
                      <span className="font-sans text-xs font-bold text-zinc-800">تنظیمات موتور هشدار و قوانین برنامه‌ریزی</span>
                    </div>
                    {currentUserRole === 'accountant' && (
                      <span className="text-[10px] bg-amber-50 text-amber-700 px-2.5 py-1 rounded font-bold border border-amber-200/50 flex items-center gap-1 font-sans">
                        <Lock size={12} /> مخصوص مدیر ارشد
                      </span>
                    )}
                  </div>

                  <div className="space-y-3 font-sans text-xs">
                    {/* 1. Prevent Negative Inventory */}
                    <label className="flex items-start gap-2.5 p-2.5 hover:bg-zinc-50 rounded-xl cursor-pointer transition select-none">
                      <input 
                        type="checkbox"
                        checked={state.settings.preventNegativeStock || false}
                        disabled={currentUserRole === 'accountant'}
                        onChange={(e) => {
                          setState(prev => {
                            const updated = {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                preventNegativeStock: e.target.checked
                              }
                            };
                            saveAppState(updated);
                            return updated;
                          });
                        }}
                        className="mt-0.5 w-4 h-4 text-emerald-600 border-zinc-300 rounded focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <div className="flex-1 text-right">
                        <strong className="block text-zinc-800 text-[11px]">جلوگیری از منفی شدن انبار</strong>
                        <span className="block text-[9px] text-zinc-400 mt-0.5 leading-relaxed">
                          با فعال‌سازی این قانون، ثبت فاکتورهای فروش با کالای فاقد موجودی در انبار کاملاً مسدود شده و خطا صادر می‌شود.
                        </span>
                      </div>
                    </label>

                    {/* 2. Control Credit Limit */}
                    <label className="flex items-start gap-2.5 p-2.5 hover:bg-zinc-50 rounded-xl cursor-pointer transition select-none">
                      <input 
                        type="checkbox"
                        checked={state.settings.controlCreditLimit || false}
                        disabled={currentUserRole === 'accountant'}
                        onChange={(e) => {
                          setState(prev => {
                            const updated = {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                controlCreditLimit: e.target.checked
                              }
                            };
                            saveAppState(updated);
                            return updated;
                          });
                        }}
                        className="mt-0.5 w-4 h-4 text-emerald-600 border-zinc-300 rounded focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <div className="flex-1 text-right">
                        <strong className="block text-zinc-800 text-[11px]">کنترل سقف اعتبار مشتری</strong>
                        <span className="block text-[9px] text-zinc-400 mt-0.5 leading-relaxed">
                          در صورت تجاوز بدهی مشتری از سقف اعتبار ثبت‌شده، سیستم از ثبت هرگونه فاکتور نسیه یا اقساطی جدید جلوگیری می‌کند.
                        </span>
                      </div>
                    </label>

                    {/* 3. Notify Overdue Installments */}
                    <label className="flex items-start gap-2.5 p-2.5 hover:bg-zinc-50 rounded-xl cursor-pointer transition select-none">
                      <input 
                        type="checkbox"
                        checked={state.settings.notifyOverdueInstallments || false}
                        disabled={currentUserRole === 'accountant'}
                        onChange={(e) => {
                          setState(prev => {
                            const updated = {
                              ...prev,
                              settings: {
                                ...prev.settings,
                                notifyOverdueInstallments: e.target.checked
                              }
                            };
                            saveAppState(updated);
                            return updated;
                          });
                        }}
                        className="mt-0.5 w-4 h-4 text-emerald-600 border-zinc-300 rounded focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <div className="flex-1 text-right">
                        <strong className="block text-zinc-800 text-[11px]">اعلان اقساط معوقه فعال</strong>
                        <span className="block text-[9px] text-zinc-400 mt-0.5 leading-relaxed">
                          تعداد کل اقساطی که از تاریخ سررسید آن‌ها گذشته و پرداخت نشده‌اند را به صورت اعلان پررنگ بالای پیشخوان نشان می‌دهد.
                        </span>
                      </div>
                    </label>

                    {/* 4. Sadi Bazaar Base Rate */}
                    <div className="pt-3 border-t border-zinc-100 mt-2 space-y-2">
                      <label className="block text-zinc-800 text-[11px] font-bold">نرخ پایه (درصد اصلی) صدی بازار</label>
                      <div className="flex gap-2">
                        <span className="text-zinc-400 self-center text-xs font-bold">٪</span>
                        <input 
                          type="number"
                          inputMode="decimal"
                          value={state.settings.sadiBazaarBaseRate ?? 7}
                          disabled={currentUserRole === 'accountant'}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            setState(prev => {
                              const updated = {
                                ...prev,
                                settings: {
                                  ...prev.settings,
                                  sadiBazaarBaseRate: val
                                }
                              };
                              saveAppState(updated);
                              return updated;
                            });
                          }}
                          className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-mono text-center font-bold"
                          placeholder="مثلاً ۷"
                        />
                      </div>
                      <span className="block text-[9px] text-zinc-400 leading-relaxed">
                        این نرخ پایه مستقیماً در محاسبات صدی بازار نمایندگان اعمال می‌شود و آن‌ها امکان ویرایش یا مشاهده مستقیم برای تغییر آن را نخواهند داشت.
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'partner_credit' && (
            <div className="h-full overflow-y-auto p-4 pr-12">
              <PartnerCreditRequestManager state={state} setState={handleUpdateState} currentUserId={currentUserId} />
            </div>
          )}

          {activeTab === 'credit_policies' && (
            <div className="h-full overflow-y-auto p-4 pr-12">
              <CreditPolicyManager
                policies={state.creditPolicies || []}
                onUpdatePolicies={(newPolicies) => {
                  setState(prev => ({ ...prev, creditPolicies: newPolicies }));
                }}
              />
            </div>
          )}

          {activeTab === 'sms_management_center' && (
            <div className="h-full overflow-y-auto p-4 pr-12">
              <SMSManagementCenter
                appState={state}
                onUpdateAppState={handleUpdateState}
                currentUserId={currentUserId}
              />
            </div>
          )}

          {activeTab === 'investor_center' && (
            <div className="h-full overflow-y-auto p-4 pr-12">
              <InvestorManagementCenter
                appState={state}
                onUpdateAppState={handleUpdateState}
                currentUserRole={currentUserRole as any}
                currentUserId={currentUserId}
                onRequestVoucherCreation={handleInvestorVoucherCreation}
                onIssueInvestorCheck={handleIssueInvestorCheck}
              />
            </div>
          )}

          {activeTab === 'agent_dossiers' && (
            <div className="h-full overflow-y-auto p-4 pr-12 space-y-8">
              <CentralCreditFileManager state={state} onUpdateState={handleUpdateState} />
              <div className="border-t border-zinc-200 pt-8 mt-8">
                <AgentDossierManager state={state} onUpdateState={handleUpdateState} currentUserId={currentUserId} />
              </div>
            </div>
          )}

          {activeTab === 'agent_center' && (
            <div className="h-full overflow-y-auto p-4 pr-12">
              <AgentManager
                appState={state}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                onSave={handleUpdateState}
                onRefreshFinancials={async (isPostMutation) => {
                  const nextGen = ++financialFetchGenerationRef.current;
                  return await loadServerAuthoritativeFinancialData(nextGen, isPostMutation ?? true);
                }}
              />
            </div>
          )}

          {activeTab === 'credit_control_agents' && (
            <div className="h-full overflow-y-auto p-4 pr-12">
              <SalesAgentCreditControl state={state} setState={handleUpdateState} />
            </div>
          )}

          {activeTab === 'credit_control_approval' && (
            <div className="h-full overflow-y-auto p-4 pr-12">
              <CreditControlApproval state={state} setState={handleUpdateState} />
            </div>
          )}

          {activeTab === 'users' && (
            <div className="h-full overflow-y-auto p-4 pr-12">
              <UserManager
                users={state.users}
                warehouses={state.warehouses}
                persons={state.persons}
                roles={state.roles || []}
                onAddUser={handleAddUser}
                onUpdateUser={handleUpdateUser}
                onDeleteUser={handleDeleteUser}
              />
            </div>
          )}

          {activeTab === 'roles' && (
            <div className="h-full overflow-y-auto p-4 pr-12">
              <RoleManager
                roles={state.roles || []}
                permissions={state.permissions || []}
                rolePermissions={state.rolePermissions || []}
                onAddRole={(newRole) => {
                  const updatedRoles = [...(state.roles || []), newRole];
                  const log = createAuditLog('CREATE', 'ROLE' as any, newRole.id, `نقش جدید "${newRole.name}" ایجاد شد.`);
                  const newState = { 
                    ...state, 
                    roles: updatedRoles,
                    auditLogs: [...(state.auditLogs || []), log]
                  };
                  setState(newState);
                  saveAppState(newState);
                }}
                onUpdateRole={(updatedRole) => {
                  const updatedRoles = (state.roles || []).map(r => r.id === updatedRole.id ? updatedRole : r);
                  const log = createAuditLog('UPDATE', 'ROLE' as any, updatedRole.id, `نقش "${updatedRole.name}" ویرایش شد.`);
                  const newState = { 
                    ...state, 
                    roles: updatedRoles,
                    auditLogs: [...(state.auditLogs || []), log]
                  };
                  setState(newState);
                  saveAppState(newState);
                }}
                onDeleteRole={(roleId) => {
                  const roleName = (state.roles || []).find(r => r.id === roleId)?.name || roleId;
                  const updatedRoles = (state.roles || []).filter(r => r.id !== roleId);
                  const updatedMappings = (state.rolePermissions || []).filter(rp => rp.roleId !== roleId);
                  const log = createAuditLog('DELETE', 'ROLE' as any, roleId, `نقش "${roleName}" حذف شد.`);
                  const newState = { 
                    ...state, 
                    roles: updatedRoles, 
                    rolePermissions: updatedMappings,
                    auditLogs: [...(state.auditLogs || []), log]
                  };
                  setState(newState);
                  saveAppState(newState);
                }}
                onUpdateRolePermissions={(updatedRolePermissions) => {
                  const log = createAuditLog('UPDATE', 'ROLE' as any, 'permissions', `مجوزهای دسترسی نقش بروزرسانی شدند.`);
                  const newState = { 
                    ...state, 
                    rolePermissions: updatedRolePermissions,
                    auditLogs: [...(state.auditLogs || []), log]
                  };
                  setState(newState);
                  saveAppState(newState);
                }}
              />
            </div>
          )}

          {activeTab === 'invoices' && (
            <div className="h-full overflow-y-auto p-4 space-y-4 pr-12" data-knowledge-code="INV-001">
              <div className="flex items-center justify-between">
                <div className="flex space-x-1.5 space-x-reverse">
                  <button
                    onClick={() => { setInvoiceFormType('sell'); setShowInvoiceForm(true); }}
                    className="bg-emerald-600 text-white font-sans text-xs font-semibold px-3 py-2 rounded-lg"
                  >
                    فروش جدید
                  </button>
                  <button
                    onClick={() => { setInvoiceFormType('buy'); setShowInvoiceForm(true); }}
                    className="bg-blue-600 text-white font-sans text-xs font-semibold px-3 py-2 rounded-lg"
                  >
                    خرید جدید
                  </button>
                  <button
                    onClick={() => setSearchModalState({ isOpen: true, type: 'invoices' })}
                    className="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition shadow-sm border border-amber-100"
                    title="جستجوی پیشرفته فاکتورها"
                  >
                    <Search size={16} />
                  </button>
                </div>
                <span className="font-sans text-xs font-bold text-zinc-800">لیست کل فاکتورها</span>
              </div>

              <div className="space-y-3">
                {state.invoices.length > 0 ? (
                  [...state.invoices].reverse().map(invoice => {
                    const person = state.persons.find(p => p.id === invoice.personId);
                    
                    // Sum items
                    let amt = 0;
                    invoice.items.forEach(it => amt += it.quantity * it.unitPrice - it.discount);
                    amt = amt - invoice.discount + Math.round(amt * (invoice.taxPercent / 100));

                    return (
                      <div
                        key={invoice.id}
                        onMouseDown={() => startLongPress(invoice)}
                        onMouseUp={cancelLongPress}
                        onMouseLeave={cancelLongPress}
                        onTouchStart={() => startLongPress(invoice)}
                        onTouchEnd={cancelLongPress}
                        onContextMenu={(e) => {
                          if (invoice.type === 'sell') {
                            e.preventDefault();
                          }
                        }}
                        onClick={() => {
                          if (isLongPressRef.current) {
                            isLongPressRef.current = false;
                            return;
                          }
                          setSelectedInvoiceForView(invoice);
                          setShowInvoiceForm(true);
                        }}
                        title={invoice.type === 'sell' ? "انگشت خود را ۳ ثانیه روی فاکتور نگه دارید تا سود یا زیان ناخالص آن نشان داده شود" : undefined}
                        className={`bg-white p-3.5 rounded-2xl border border-zinc-150 hover:border-emerald-500/40 active:bg-zinc-50 cursor-pointer shadow-sm text-right space-y-2 relative overflow-hidden select-none transition-all active:scale-[0.98] ${
                          invoice.isProInvoice ? 'border-amber-300 bg-amber-50/10' : ''
                        }`}
                      >
                        {invoice.isProInvoice && (
                          <div className="absolute top-0 left-0 bg-amber-400 text-white text-[8px] font-sans font-bold px-2.5 py-0.5 rounded-br">
                            پیش‌فاکتور (قرنطینه)
                          </div>
                        )}

                        <div className="flex justify-between items-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setAppConfirmationModal({
                                isOpen: true,
                                title: 'حذف فاکتور',
                                message: 'آیا از حذف این فاکتور اطمینان دارید؟ تمامی اسناد حسابداری و بستانکاران/بدهکاران مرتبط با آن نیز به روز خواهند شد.',
                                onConfirm: () => {
                                  handleDeleteInvoice(invoice.id);
                                }
                              });
                            }}
                            className="text-red-500 hover:text-red-700 p-1"
                          >
                            <Trash2 size={12} />
                          </button>
                          <span className="font-mono text-xs font-bold text-emerald-600">{amt.toLocaleString()} ریال</span>
                          <strong className="font-sans text-xs text-zinc-800">
                            {invoice.type === 'buy' ? 'فاکتور خرید' : 'فاکتور فروش'} #{invoice.invoiceNumber}
                          </strong>
                        </div>

                        <div className="flex justify-between items-center text-[10px] text-zinc-400">
                          <span>تاریخ: {invoice.date}</span>
                          <span>طرف حساب: <strong>{person?.name || 'ناشناس'}</strong></span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="bg-white p-12 rounded-2xl border border-zinc-100 text-center font-sans text-xs text-zinc-400">
                    هیچ فاکتوری ثبت نشده است. از دکمه‌های بالا برای ثبت خرید یا فروش استفاده کنید.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'people' && (
            <div className="h-full overflow-y-auto p-4 space-y-4 text-right pr-12" data-knowledge-code="REP-041">
              {/* Segmented control to switch between Central Directory, Debtors, Creditors, and Agents */}
              <div className="bg-zinc-150 p-1.5 rounded-2xl flex space-x-1.5 space-x-reverse max-w-3xl mx-auto shadow-sm border border-zinc-200">
                <button
                  type="button"
                  onClick={() => setPeopleSubTab('central')}
                  className={`flex-1 py-2.5 rounded-xl text-center font-sans text-xs font-bold transition-all duration-200 ${
                    peopleSubTab === 'central'
                      ? 'bg-teal-700 text-white shadow-md scale-[1.02]'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
                  }`}
                >
                  بانک مرکزی اشخاص
                </button>
                <button
                  type="button"
                  onClick={() => setPeopleSubTab('debtors')}
                  className={`flex-1 py-2.5 rounded-xl text-center font-sans text-xs font-bold transition-all duration-200 ${
                    peopleSubTab === 'debtors'
                      ? 'bg-zinc-900 text-white shadow-md scale-[1.02]'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
                  }`}
                >
                  بدهکاران عادی
                </button>
                <button
                  type="button"
                  onClick={() => setPeopleSubTab('debtors_installment')}
                  className={`flex-1 py-2.5 rounded-xl text-center font-sans text-xs font-bold transition-all duration-200 ${
                    peopleSubTab === 'debtors_installment'
                      ? 'bg-zinc-900 text-white shadow-md scale-[1.02]'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
                  }`}
                >
                  بدهکاران اقساطی
                </button>
                <button
                  type="button"
                  onClick={() => setPeopleSubTab('creditors')}
                  className={`flex-1 py-2.5 rounded-xl text-center font-sans text-xs font-bold transition-all duration-200 ${
                    peopleSubTab === 'creditors'
                      ? 'bg-zinc-900 text-white shadow-md scale-[1.02]'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
                  }`}
                >
                  بستانکاران (همکاران)
                </button>
                <button
                  type="button"
                  onClick={() => setPeopleSubTab('agents')}
                  className={`flex-1 py-2.5 rounded-xl text-center font-sans text-xs font-bold transition-all duration-200 ${
                    peopleSubTab === 'agents'
                      ? 'bg-zinc-900 text-white shadow-md scale-[1.02]'
                      : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200/50'
                  }`}
                >
                  نمایندگان فروش
                </button>
              </div>

              {peopleSubTab === 'central' && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150">
                  <CentralPersonDirectory
                    appState={state}
                    onSelectPersonForLedger={setSelectedPersonForLedger}
                    onSelectPersonForCritical={setSelectedPersonForCritical}
                    onEditPerson={(p) => {
                      setEditingPerson(p);
                      setIsAddingDebtor(true);
                      setPeopleSubTab('debtors');
                    }}
                    onDeletePerson={handleDeletePerson}
                    onAddPerson={() => {
                      setEditingPerson(null);
                      setIsAddingDebtor(true);
                      setPeopleSubTab('debtors');
                    }}
                    onCashTransaction={() => setShowCashTransactionForm(true)}
                  />
                </div>
              )}

              {peopleSubTab === 'debtors' && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-zinc-150 pb-2">
                    <span className="font-sans text-xs font-bold text-red-600 bg-red-50 px-2.5 py-0.5 rounded-full">بدهکاران تجاری (مشتریان)</span>
                    <span className="font-sans text-[10px] text-zinc-400">طرف حساب‌های بدهکار و خریداران</span>
                  </div>

                  {/* Toggleable Form for Creating Person */}
                  {!isAddingDebtor && !editingPerson ? (
                    <div className="flex justify-end gap-2">
                      <button 
                        type="button"
                        onClick={() => setShowCashTransactionForm(true)}
                        className="flex items-center space-x-1.5 space-x-reverse bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-bold px-4 py-2.5 rounded-xl shadow transition"
                      >
                        <DollarSign size={16} className="stroke-[3px]" />
                        <span>دریافت / پرداخت نقدی</span>
                      </button>
                      <button 
                        type="button"
                        onClick={() => setIsAddingDebtor(true)}
                        className="flex items-center space-x-1.5 space-x-reverse bg-red-600 hover:bg-red-700 text-white font-sans text-xs font-bold px-4 py-2.5 rounded-xl shadow transition"
                      >
                        <Plus size={16} className="stroke-[3px]" />
                        <span>مشتری جدید</span>
                      </button>
                    </div>
                  ) : (
                    <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm transition-all duration-200">
                      <PersonForm
                        initialPerson={editingPerson}
                        onSave={(personData, registerAmaniCheck) => handleAddPersonFromComponent(personData, registerAmaniCheck, true)}
                        onCancel={() => { setIsAddingDebtor(false); setEditingPerson(null); }}
                        isDebtor={true}
                        existingPersons={state.persons}
                      />
                    </div>
                  )}

                  {/* Search Bar */}
                  <div className="bg-white p-2.5 rounded-2xl border border-zinc-150 shadow-sm flex items-center space-x-2 space-x-reverse">
                    <Search size={16} className="text-zinc-400 shrink-0" />
                    <input
                      type="text"
                      placeholder="جستجو در بین بدهکاران تجاری (نام یا شماره تلفن)..."
                      value={debtorSearchQuery}
                      onChange={(e) => setDebtorSearchQuery(e.target.value)}
                      className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none text-right"
                    />
                    {debtorSearchQuery && (
                      <button type="button" onClick={() => setDebtorSearchQuery('')} className="text-zinc-400 hover:text-zinc-600">
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* List of Persons */}
                  <div className="space-y-2.5">
                    <span className="block font-sans text-xs font-bold text-zinc-800">لیست بدهکاران تجاری فعال</span>
                    <div className="grid grid-cols-1 gap-2">
                      {(() => {
                        const filteredDebtors = state.persons.filter(p => {
                          if (p.role !== 'debtor') return false;
                          
                          // Exclude agents/partners from ordinary debtors list
                          const isAgentOrPartner = p.isAgent || (state.businessPartners || []).some(bp => bp.personId === p.id);
                          if (isAgentOrPartner) return false;
                          
                          // If they have 0 normal balance but have active installment balance, exclude them from normal list
                          const normalBal = normalDebtorBalances[p.id]?.net || 0;
                          const instBal = installmentDebtorBalances[p.id]?.net || 0;
                          if (normalBal === 0 && instBal > 0) return false;
                          
                          if (!debtorSearchQuery.trim()) return true;
                          const q = debtorSearchQuery.toLowerCase().trim();
                          return (
                            p.name.toLowerCase().includes(q) ||
                            (p.mobile && p.mobile.includes(q)) ||
                            (p.phone && p.phone.includes(q)) ||
                            (p.nationalId && p.nationalId.includes(q)) ||
                            p.code.toLowerCase().includes(q)
                          );
                        });

                        return filteredDebtors.length > 0 ? (
                          filteredDebtors.map(p => {
                            const balance = normalDebtorBalances[p.id] || { net: 0, nature: 'بی‌حساب' };
                            return (
                              <div 
                                key={p.id} 
                                onClick={() => setSelectedPersonForLedger(p)}
                                className="bg-white p-3.5 rounded-2xl border border-zinc-150 hover:border-red-500/40 active:bg-zinc-50 cursor-pointer flex items-center justify-between text-right font-sans text-xs shadow-sm transition"
                              >
                                <span className={`font-mono font-bold text-[10px] ${
                                  balance.nature === 'بدهکار' ? 'text-red-600' : balance.nature === 'بستانکار' ? 'text-emerald-600' : 'text-zinc-400'
                                }`}>
                                  {balance.net > 0 ? `${balance.net.toLocaleString()} ریال (${balance.nature === 'بدهکار' ? 'بدهکار عادی' : balance.nature})` : 'بی‌حساب'}
                                </span>
                                <div className="flex items-center space-x-2 space-x-reverse">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedPersonForCritical(p);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500 hover:text-rose-700 transition shrink-0"
                                    title="وضعیت بحرانی و امانات"
                                  >
                                    <ShieldCheck size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeletePerson(p.id);
                                    }}
                                    className={`p-1.5 rounded-lg transition shrink-0 ${
                                      isPersonDeletable(p.id)
                                        ? 'hover:bg-red-50 text-red-500 hover:text-red-700'
                                        : 'text-zinc-200 cursor-not-allowed hover:bg-zinc-50'
                                    }`}
                                    title={isPersonDeletable(p.id) ? "حذف طرف حساب" : "امکان حذف وجود ندارد (دارای سابقه تراکنش)"}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingPerson(p);
                                      setIsAddingDebtor(true);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-red-600 transition shrink-0"
                                    title="ویرایش مشخصات"
                                  >
                                    <Edit2 size={13} />
                                  </button>
                                  <div className="flex flex-col text-right">
                                    <strong className="text-zinc-800">{p.name}</strong>
                                    <span className="text-[9px] text-zinc-400 mt-0.5">{p.mobile || 'بدون موبایل'} • کد: {p.code}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="bg-white p-6 rounded-2xl border border-zinc-100 text-center font-sans text-xs text-zinc-400">
                            {debtorSearchQuery ? 'هیچ موردی با این مشخصات یافت نشد.' : 'هیچ شخص بدهکاری تعریف نشده است.'}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {peopleSubTab === 'debtors_installment' && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-zinc-150 pb-2">
                    <span className="font-sans text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full">بدهکاران اقساطی (مشتریان اقساط)</span>
                    <span className="font-sans text-[10px] text-zinc-400">طرف حساب‌های بدهکار بخش اقساطی</span>
                  </div>

                  {/* Search Bar */}
                  <div className="bg-white p-2.5 rounded-2xl border border-zinc-150 shadow-sm flex items-center space-x-2 space-x-reverse">
                    <Search size={16} className="text-zinc-400 shrink-0" />
                    <input
                      type="text"
                      placeholder="جستجو در بین بدهکاران اقساطی (نام یا شماره تلفن)..."
                      value={debtorSearchQuery}
                      onChange={(e) => setDebtorSearchQuery(e.target.value)}
                      className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none text-right"
                    />
                    {debtorSearchQuery && (
                      <button type="button" onClick={() => setDebtorSearchQuery('')} className="text-zinc-400 hover:text-zinc-600">
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* List of Persons */}
                  <div className="space-y-2.5">
                    <span className="block font-sans text-xs font-bold text-zinc-800">لیست بدهکاران بخش اقساطی</span>
                    <div className="grid grid-cols-1 gap-2">
                      {(() => {
                        const filteredDebtors = state.persons.filter(p => {
                          if (p.role !== 'debtor') return false;
                          
                          // Exclude agents/partners from installment debtors list
                          const isAgentOrPartner = p.isAgent || (state.businessPartners || []).some(bp => bp.personId === p.id);
                          if (isAgentOrPartner) return false;
                          
                          // Exclude if no installment balance but has active normal balance
                          const normalBal = normalDebtorBalances[p.id]?.net || 0;
                          const instBal = installmentDebtorBalances[p.id]?.net || 0;
                          if (instBal === 0 && normalBal > 0) return false;
                          
                          if (!debtorSearchQuery.trim()) return true;
                          const q = debtorSearchQuery.toLowerCase().trim();
                          return (
                            p.name.toLowerCase().includes(q) ||
                            (p.mobile && p.mobile.includes(q)) ||
                            (p.phone && p.phone.includes(q)) ||
                            p.code.toLowerCase().includes(q)
                          );
                        });

                        return filteredDebtors.length > 0 ? (
                          filteredDebtors.map(p => {
                            const balance = installmentDebtorBalances[p.id] || { net: 0, nature: 'بی‌حساب' };
                            return (
                              <div 
                                key={p.id} 
                                onClick={() => setSelectedPersonForLedger(p)}
                                className="bg-white p-3.5 rounded-2xl border border-zinc-150 hover:border-indigo-500/40 active:bg-zinc-50 cursor-pointer flex items-center justify-between text-right font-sans text-xs shadow-sm transition"
                              >
                                <span className={`font-mono font-bold text-[10px] ${
                                  balance.nature === 'بدهکار' ? 'text-indigo-600' : balance.nature === 'بستانکار' ? 'text-emerald-600' : 'text-zinc-400'
                                }`}>
                                  {balance.net > 0 ? `${balance.net.toLocaleString()} ریال (${balance.nature === 'بدهکار' ? 'بدهکار اقساطی' : balance.nature})` : 'بی‌حساب'}
                                </span>
                                <div className="flex items-center space-x-2 space-x-reverse">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedPersonForCritical(p);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500 hover:text-rose-700 transition shrink-0"
                                    title="وضعیت بحرانی و امانات"
                                  >
                                    <ShieldCheck size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeletePerson(p.id);
                                    }}
                                    className={`p-1.5 rounded-lg transition shrink-0 ${
                                      isPersonDeletable(p.id)
                                        ? 'hover:bg-red-50 text-red-500 hover:text-red-700'
                                        : 'text-zinc-200 cursor-not-allowed hover:bg-zinc-50'
                                    }`}
                                    title={isPersonDeletable(p.id) ? "حذف طرف حساب" : "امکان حذف وجود ندارد (دارای سابقه تراکنش)"}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingPerson(p);
                                      setPeopleSubTab('debtors');
                                      setIsAddingDebtor(true);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-indigo-600 transition shrink-0"
                                    title="ویرایش مشخصات"
                                  >
                                    <Edit2 size={13} />
                                  </button>
                                  <div className="flex flex-col text-right">
                                    <strong className="text-zinc-800">{p.name}</strong>
                                    <span className="text-[9px] text-zinc-400 mt-0.5">{p.mobile || 'بدون موبایل'} • کد: {p.code}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="bg-white p-6 rounded-2xl border border-zinc-100 text-center font-sans text-xs text-zinc-400">
                            {debtorSearchQuery ? 'هیچ موردی با این مشخصات یافت نشد.' : 'هیچ شخص بدهکار اقساطی فعال با مانده حساب وجود ندارد.'}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {peopleSubTab === 'creditors' && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150">
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-zinc-150 pb-2">
                    <span className="font-sans text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">بستانکاران تجاری (تأمین‌کنندگان)</span>
                    <span className="font-sans text-[10px] text-zinc-400">طرف حساب‌های بستانکار و همکاران</span>
                  </div>

                  {/* Toggleable Form for Creating Person */}
                  {!isAddingCreditor && !editingPerson ? (
                    <div className="flex justify-end gap-2">
                      <button 
                        type="button"
                        onClick={() => setShowCashTransactionForm(true)}
                        className="flex items-center space-x-1.5 space-x-reverse bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-bold px-4 py-2.5 rounded-xl shadow transition"
                      >
                        <DollarSign size={16} className="stroke-[3px]" />
                        <span>دریافت / پرداخت نقدی</span>
                      </button>
                      <button 
                        type="button"
                        onClick={() => setIsAddingCreditor(true)}
                        className="flex items-center space-x-1.5 space-x-reverse bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-bold px-4 py-2.5 rounded-xl shadow transition"
                      >
                        <Plus size={16} className="stroke-[3px]" />
                        <span>همکار جدید</span>
                      </button>
                    </div>
                  ) : (
                    <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm transition-all duration-200">
                      <PersonForm
                        initialPerson={editingPerson}
                        onSave={(personData, registerAmaniCheck) => handleAddPersonFromComponent(personData, registerAmaniCheck, false)}
                        onCancel={() => { setIsAddingCreditor(false); setEditingPerson(null); }}
                        isCreditor={true}
                        existingPersons={state.persons}
                      />
                    </div>
                  )}

                  {/* Search Bar */}
                  <div className="bg-white p-2.5 rounded-2xl border border-zinc-150 shadow-sm flex items-center space-x-2 space-x-reverse">
                    <Search size={16} className="text-zinc-400 shrink-0" />
                    <input
                      type="text"
                      placeholder="جستجو در بین بستانکاران تجاری (نام یا شماره تلفن)..."
                      value={creditorSearchQuery}
                      onChange={(e) => setCreditorSearchQuery(e.target.value)}
                      className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none text-right"
                    />
                    {creditorSearchQuery && (
                      <button type="button" onClick={() => setCreditorSearchQuery('')} className="text-zinc-400 hover:text-zinc-600">
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* List of Persons */}
                  <div className="space-y-2.5">
                    <span className="block font-sans text-xs font-bold text-zinc-800">لیست بستانکاران تجاری فعال</span>
                    <div className="grid grid-cols-1 gap-2">
                      {(() => {
                        const filteredCreditors = state.persons.filter(p => {
                          if (p.role !== 'creditor') return false;
                          
                          if (!creditorSearchQuery.trim()) return true;
                          const q = creditorSearchQuery.toLowerCase().trim();
                          return (
                            p.name.toLowerCase().includes(q) ||
                            (p.mobile && p.mobile.includes(q)) ||
                            (p.phone && p.phone.includes(q)) ||
                            (p.nationalId && p.nationalId.includes(q)) ||
                            p.code.toLowerCase().includes(q)
                          );
                        });

                        return filteredCreditors.length > 0 ? (
                          filteredCreditors.map(p => {
                            const balance = personBalances[p.id] || { net: 0, nature: 'بی‌حساب' };
                            return (
                              <div 
                                key={p.id} 
                                onClick={() => setSelectedPersonForLedger(p)}
                                className="bg-white p-3.5 rounded-2xl border border-zinc-150 hover:border-emerald-500/40 active:bg-zinc-50 cursor-pointer flex items-center justify-between text-right font-sans text-xs shadow-sm transition"
                              >
                                <span className={`font-mono font-bold text-[10px] ${
                                  balance.nature === 'بستانکار' ? 'text-emerald-600' : balance.nature === 'بدهکار' ? 'text-red-600' : 'text-zinc-400'
                                }`}>
                                  {balance.net > 0 ? `${balance.net.toLocaleString()} ریال (${balance.nature})` : 'بی‌حساب'}
                                </span>
                                <div className="flex items-center space-x-2 space-x-reverse">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeletePerson(p.id);
                                    }}
                                    className={`p-1.5 rounded-lg transition shrink-0 ${
                                      isPersonDeletable(p.id)
                                        ? 'hover:bg-red-50 text-red-500 hover:text-red-700'
                                        : 'text-zinc-200 cursor-not-allowed hover:bg-zinc-50'
                                    }`}
                                    title={isPersonDeletable(p.id) ? "حذف طرف حساب" : "امکان حذف وجود ندارد (دارای سابقه تراکنش)"}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingPerson(p);
                                      setIsAddingCreditor(true);
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-emerald-600 transition shrink-0"
                                    title="ویرایش مشخصات"
                                  >
                                    <Edit2 size={13} />
                                  </button>
                                  <div className="flex flex-col text-right">
                                    <strong className="text-zinc-800">{p.name}</strong>
                                    <span className="text-[9px] text-zinc-400 mt-0.5">{p.mobile || 'بدون موبایل'} • کد: {p.code}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="bg-white p-6 rounded-2xl border border-zinc-100 text-center font-sans text-xs text-zinc-400">
                            {creditorSearchQuery ? 'هیچ موردی با این مشخصات یافت نشد.' : 'هیچ شخص بستانکاری تعریف نشده است.'}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {peopleSubTab === 'agents' && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150 bg-white p-5 rounded-3xl border border-zinc-150 shadow-sm">
                  <AgentManager
                    appState={state}
                    currentUserId={currentUserId}
                    currentUserRole={currentUserRole}
                    onSave={handleUpdateState}
                    onRefreshFinancials={async (isPostMutation) => {
                      const nextGen = ++financialFetchGenerationRef.current;
                      return await loadServerAuthoritativeFinancialData(nextGen, isPostMutation ?? true);
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === 'products' && (
            <div className="h-full overflow-y-auto p-4 space-y-4 text-right pr-12">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-150 pb-2">
                <span className="font-sans text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full">کالاهای انبار و موجودی کالا</span>
                <span className="font-sans text-[10px] text-zinc-400">مدیریت موجودی کالاها و قیمت‌ها</span>
              </div>

              {/* Toggleable Products Form */}
              {!isAddingProduct ? (
                <div className="flex justify-between">
                  <div className="flex-1 ml-2">
                    <CategoryManager
                        categories={state.productCategories}
                        onAddCategory={handleAddCategory}
                        onDeleteCategory={handleDeleteCategory}
                    />
                  </div>
                  <button 
                    type="button"
                    onClick={() => setIsAddingProduct(true)}
                    className="flex items-center space-x-1.5 space-x-reverse bg-blue-600 hover:bg-blue-700 text-white font-sans text-xs font-bold px-4 py-2.5 rounded-xl shadow transition"
                  >
                    <Plus size={16} className="stroke-[3px]" />
                    <span>کالای جدید</span>
                  </button>
                </div>
              ) : (
                <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-3 transition-all duration-200">
                  <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                    <span className="block font-sans text-xs font-bold text-zinc-800">تعریف کالای جدید در انبار</span>
                    <button 
                      type="button"
                      onClick={() => { setIsAddingProduct(false); setEditingProduct(null); }}
                      className="text-zinc-400 hover:text-zinc-600 transition"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  
                  <form key={editingProduct ? editingProduct.id : 'new'} onSubmit={handleSaveProduct} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-[10px] text-zinc-400 mb-0.5">نام کالا (اجباری)</label>
                        <input
                          type="text"
                          placeholder="نام کالای جدید در انبار..."
                          value={newProductName}
                          onChange={(e) => setNewProductName(e.target.value)}
                          className="w-full bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-blue-500"
                          required
                        />
                      </div>
                      
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">کد کالا / بارکد</label>
                        <input
                          type="text"
                          placeholder="کد کالا (مثبت K1001)..."
                          value={newProductCode}
                          onChange={(e) => setNewProductCode(e.target.value)}
                          className="w-full bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-left focus:outline-none focus:border-blue-500"
                          dir="ltr"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">دسته‌بندی</label>
                        <select
                          value={newProductCategory}
                          onChange={(e) => setNewProductCategory(e.target.value)}
                          className="w-full bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-blue-500"
                          dir="rtl"
                        >
                          <option value="">بدون دسته</option>
                          {state.productCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">واحد سنجش</label>
                        <select
                          value={newProductUnit}
                          onChange={(e) => setNewProductUnit(e.target.value)}
                          className="w-full bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-blue-500"
                          dir="rtl"
                        >
                          <option value="دستگاه">دستگاه</option>
                          <option value="عدد">عدد</option>
                          <option value="پک">پک</option>
                        </select>
                      </div>

                      <div className="flex items-center mt-6">
                        {/* Serial number checkbox removed as requested */}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2 bg-blue-50 p-3 rounded-xl border border-blue-100 mb-2">
                        <p className="text-[10px] text-blue-700 leading-relaxed font-bold">
                          💡 برای ثبت موجودی اولیه این کالا، پس از تعریف کالا به منوی «موجودی افتتاحیه» مراجعه کنید. تمام موجودی‌ها باید دارای سند معتبر باشند.
                        </p>
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">نقطه سفارش</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="۱"
                          value={newProductReorderPoint > 0 ? newProductReorderPoint.toLocaleString() : ''}
                          onChange={(e) => setNewProductReorderPoint(parseNumericValue(e.target.value))}
                          className="w-full bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-0.5">قیمت فروش پیش‌فرض</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="قیمت فروش"
                          value={newProductPrice > 0 ? newProductPrice.toLocaleString() : ''}
                          onChange={(e) => setNewProductPrice(parseNumericValue(e.target.value))}
                          className="w-full bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-xl flex items-center justify-center space-x-1 space-x-reverse font-sans text-xs font-semibold shadow transition">
                      <PackagePlus size={14} />
                      <span>افزودن کالا به انبار</span>
                    </button>
                  </form>
                </div>
              )}

              {/* Product Search Bar */}
              <div className="bg-white p-2.5 rounded-2xl border border-zinc-150 shadow-sm flex items-center space-x-2 space-x-reverse">
                <Search size={16} className="text-zinc-400 shrink-0" />
                <input
                  type="text"
                  placeholder="جستجو در بین کالاهای انبار (نام کالا یا کد)..."
                  value={productSearchQuery}
                  onChange={(e) => setProductSearchQuery(e.target.value)}
                  className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none text-right"
                />
                {productSearchQuery && (
                  <button type="button" onClick={() => setProductSearchQuery('')} className="text-zinc-400 hover:text-zinc-600">
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Products List */}
              <div className="space-y-2.5">
                <span className="block font-sans text-xs font-bold text-zinc-800">لیست فیزیکی انبار کالا</span>
                <div className="grid grid-cols-1 gap-2.5">
                  {(() => {
                    const filteredProducts = state.products.filter(p => {
                      if (!productSearchQuery.trim()) return true;
                      const q = productSearchQuery.toLowerCase().trim();
                      return (
                        p.name.toLowerCase().includes(q) ||
                        p.code.toLowerCase().includes(q)
                      );
                    });

                    return filteredProducts.length > 0 ? (
                      filteredProducts.map(p => {
                        const stockObj = productStocks[p.id];
                        const stock = stockObj ? stockObj.quantity : 0;
                        return (
                          <div key={p.id} className="bg-white p-3.5 rounded-2xl border border-zinc-150 flex items-center justify-between text-right font-sans text-xs shadow-sm hover:border-blue-500/40 transition">
                            <span className={`font-mono font-bold ${stock <= p.reorderPoint ? 'text-rose-600 bg-rose-50 px-2.5 py-0.5 rounded-xl animate-pulse' : 'text-zinc-600 bg-zinc-100 px-2.5 py-0.5 rounded-xl'}`}>
                              {stock} {p.unit}
                            </span>
                            <div className="flex flex-col text-right">
                              <strong className="text-zinc-800 cursor-pointer hover:text-blue-600 transition" onClick={() => setSelectedProductHistory(p)}>{p.name}</strong>
                              <span className="text-[9px] text-zinc-400 mt-0.5">
                                {p.defaultSalePrice ? `قیمت فروش: ${p.defaultSalePrice.toLocaleString()} ریال • ` : ''}نقطه سفارش: {p.reorderPoint} • کد: {p.code}
                              </span>
                            </div>
                            <div className="flex items-center">
                                <button onClick={(e) => { e.stopPropagation(); setEditingProduct(p); }} className="text-blue-500 hover:text-blue-700 p-2">
                                    <Edit2 size={16} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleDeleteProduct(p.id); }} className="text-rose-500 hover:text-rose-700 p-2">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="bg-white p-6 rounded-2xl border border-zinc-100 text-center font-sans text-xs text-zinc-400">
                        {productSearchQuery ? 'هیچ موردی با این مشخصات یافت نشد.' : 'هیچ کالایی در انبار ثبت نشده است.'}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'checks' && (
            <div className="h-full overflow-y-auto pr-12 text-right" data-knowledge-code="CHK-014">
              <CheckManager
                checks={currentUserRole === 'agent' ? state.checks.filter(c => c.submittedByAgentId === currentAgentId) : state.checks}
                persons={state.persons}
                onAddCheck={handleAddCheck}
                onUpdateCheckState={handleUpdateCheckState}
                onBulkUpdateCheckState={handleBulkUpdateCheckState}
                currentUserRole={currentUserRole}
                currentAgentId={currentAgentId}
                onEditCheck={handleEditCheck}
                onDeleteCheck={handleDeleteCheck}
                onApproveCheck={handleApproveCheck}
                onBulkAddChecks={(checks) => {
                  checks.forEach(c => handleAddCheck(c));
                }}
                onOpenAdvancedSearch={() => setSearchModalState({ isOpen: true, type: 'checks' })}
                prefilledPersonId={checkPrefillPersonId}
                prefilledIsAmani={true}
                onClearPrefill={() => setCheckPrefillPersonId(undefined)}
                onSaveCheckbook={handleSaveCheckbook}
                onUpdateCheckbook={handleUpdateCheckbook}
                onDeleteCheckbook={handleDeleteCheckbook}
                state={state}
                onViewCheck={(checkId) => setSelectedCheckForView(state.checks.find(c => c.id === checkId))}
                onViewVoucher={(voucherId) => {
                  const found = state.vouchers?.find(v => v.id === voucherId) || state.journalVouchers?.find(v => v.id === voucherId);
                  if (found) setSelectedVoucherForView(found);
                }}
              />
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="h-full overflow-y-auto pr-12 text-right">
              <ReportsView 
                state={state} 
                onViewCheck={(checkId) => setSelectedCheckForView(state.checks.find(c => c.id === checkId))} 
                currentUserRole={currentUserRole}
                onEditCheck={handleEditCheck}
                onDeleteCheck={handleDeleteCheck}
                onApproveCheck={handleApproveCheck}
                onViewVoucher={(voucherId) => setSelectedVoucherForView(state.vouchers.find(v => v.id === voucherId))}
                onNewVoucher={(type) => {
                  if (type === 'manual') {
                    setSelectedVoucherForEdit(undefined);
                    setShowManualVoucherForm(true);
                  }
                }}
                onEditVoucher={(voucher) => {
                  setSelectedVoucherForEdit(voucher);
                  setShowManualVoucherForm(true);
                }}
                onDeleteVoucher={(voucher) => handleDeleteVoucher(voucher.id)}
                onOpenAdvancedSearch={() => setSearchModalState({ isOpen: true, type: 'vouchers' })}
                onUpdateCheckState={handleUpdateCheckState}
                onBulkUpdateCheckState={handleBulkUpdateCheckState}
              />
            </div>
          )}

          {activeTab === 'accounts' && (
            <div className="h-full overflow-y-auto pr-12 text-right">
              <AccountsManager 
                state={state}
                onViewVoucher={(voucherId) => setSelectedVoucherForView(state.vouchers.find(v => v.id === voucherId))}
                onViewCheck={(checkId) => setSelectedCheckForView(state.checks.find(c => c.id === checkId))} 
                onAddSubsidiary={handleAddSubsidiary} 
                onEditSubsidiary={handleEditSubsidiary}
                onAddManualVoucher={handleManualVoucherSubmit}
                subsidiaryBalances={subsidiaryBalances}
                personBalances={personBalances}
                onUpdateCheckState={handleUpdateCheckState}
                onNavigate={(tab) => setActiveTab(tab as any)}
                onEditVoucher={handleEditVoucherFromLedger}
                onDeleteVoucher={handleDeleteVoucherFromLedger}
                onNewVoucher={() => setShowManualVoucherForm(true)}
                onUpdateBankTerminals={handleUpdateBankTerminals}
              />
            </div>
          )}

          {activeTab === 'backup' && (
            <div className="h-full overflow-y-auto pr-12 text-right">
              <BackupManager 
                appState={state} 
                onRestore={(newState) => {
                  setState(newState);
                  saveAppState(newState);
                  setActiveTab('dashboard');
                }} 
              />
            </div>
          )}

          {activeTab === 'installments' && (
            <div className="h-full overflow-y-auto pr-12 text-right" data-knowledge-code="INS-023">
              <InstallmentBookletManager 
                appState={state} 
                onSave={handleUpdateState} 
                onRefresh={() => loadServerAuthoritativeFinancialData(financialFetchGenerationRef.current, true).then(() => {})}
                initialPersonId={initialPersonForInstallment}
                onClose={() => setInitialPersonForInstallment(undefined)}
              />
            </div>
          )}

          {activeTab === 'opening_balances' && (
            <div className="h-full overflow-y-auto p-4 space-y-4 text-right pr-12">
              {!showOpeningBalanceForm ? (
                <OpeningBalanceList
                  openingBalances={state.openingBalances}
                  products={state.products}
                  onAdd={() => setShowOpeningBalanceForm(true)}
                  onEdit={(ob) => {
                    setEditingOpeningBalance(ob);
                    setShowOpeningBalanceForm(true);
                  }}
                  onDelete={handleDeleteOpeningBalance}
                  onView={setViewingOpeningBalance}
                />
              ) : (
                <OpeningBalanceForm
                  initialData={editingOpeningBalance}
                  products={state.products}
                  productCategories={state.productCategories}
                  currentStocks={productStocks}
                  onAddCategory={handleAddCategory}
                  onCreateProduct={(name, category, unit, initialStock, reorderPoint, serialNumber, defaultSalePrice) => {
                    // Reuse the existing inline creation logic if needed, or just handle it simply
                    const newId = `p_inline_${Date.now()}`;
                    window.dispatchEvent(new CustomEvent('create_product_inline', { 
                      detail: { name, category, unit, initialStock, reorderPoint, serialNumber, defaultSalePrice } 
                    }));
                    return newId;
                  }}
                  nextNumber={state.openingBalances.length > 0 ? Math.max(...state.openingBalances.map(o => o.number)) + 1 : 1}
                  onSave={handleOpeningBalanceSubmit}
                  onCancel={() => {
                    setShowOpeningBalanceForm(false);
                    setEditingOpeningBalance(undefined);
                  }}
                  appState={state}
                />
              )}
            </div>
          )}

          {activeTab === 'warehouses' && (
            <div className="h-full overflow-y-auto p-6 space-y-4 text-right pr-12" data-knowledge-code="STK-051">
              <WarehouseManager 
                warehouses={state.warehouses} 
                onAddWarehouse={handleAddWarehouse} 
                onDeleteWarehouse={handleDeleteWarehouse} 
                onUpdateWarehouse={handleUpdateWarehouse}
                onSetDefaultWarehouse={handleSetDefaultWarehouse}
                products={state.products}
                currentStocks={productStocks}
                onTransfer={handleTransfer}
                onReverseTransfer={handleReverseTransfer}
                subsidiaries={state.subsidiaries}
                transfers={state.warehouseTransfers || []}
                currentUserPermissions={state.currentUserPermissions || []}
              />
            </div>
          )}

          {activeTab === 'cost_centers' && (
            <div className="h-full overflow-y-auto p-6 space-y-4 text-right pr-12">
              <CostCenterManager 
                costCenters={state.costCenters} 
                onAdd={handleAddCostCenter} 
                onDelete={handleDeleteCostCenter} 
              />
            </div>
          )}

          {activeTab === 'audit_logs' && (
            <div className="h-full overflow-y-auto p-6 space-y-4 text-right pr-12">
              <AuditLogViewer logs={state.auditLogs} />
            </div>
          )}

          {activeTab === 'knowledge_center' && (
            <div className="h-full overflow-y-auto p-6 space-y-4 text-right pr-12">
              <KnowledgeCenter
                categories={state.knowledgeCategories || []}
                articles={state.knowledgeArticles || []}
                steps={state.knowledgeSteps || []}
                errors={state.knowledgeErrors || []}
                glossary={state.knowledgeGlossary || []}
                versions={state.knowledgeVersions || []}
                currentUserRole={currentUserRole}
                onAddArticle={(newArt) => {
                  const updatedArticles = [newArt, ...(state.knowledgeArticles || [])];
                  const log = createAuditLog('CREATE', 'KNOWLEDGE' as any, newArt.id, `افزودن مقاله دانش جدید: ${newArt.title} (${newArt.knowledgeCode})`);
                  const newState = { 
                    ...state, 
                    knowledgeArticles: updatedArticles,
                    auditLogs: [...(state.auditLogs || []), log]
                  };
                  setState(newState);
                  saveAppState(newState);
                }}
                onDeleteArticle={(id) => {
                  const updatedArticles = (state.knowledgeArticles || []).filter(a => a.id !== id);
                  const log = createAuditLog('DELETE', 'KNOWLEDGE' as any, id, `حذف مقاله دانش با شناسه: ${id}`);
                  const newState = { 
                    ...state, 
                    knowledgeArticles: updatedArticles,
                    auditLogs: [...(state.auditLogs || []), log]
                  };
                  setState(newState);
                  saveAppState(newState);
                }}
                onAddStep={(newStep) => {
                  const updatedSteps = [...(state.knowledgeSteps || []), newStep];
                  const newState = { ...state, knowledgeSteps: updatedSteps };
                  setState(newState);
                  saveAppState(newState);
                }}
                onAddError={(newErr) => {
                  const updatedErrors = [...(state.knowledgeErrors || []), newErr];
                  const newState = { ...state, knowledgeErrors: updatedErrors };
                  setState(newState);
                  saveAppState(newState);
                }}
                onNavigateToTab={(tabId) => {
                  setActiveTab(tabId as TabType);
                }}
              />
            </div>
          )}

          {activeTab === 'calc_lab' && (
            <div className="h-full overflow-y-auto p-6 space-y-4 text-right pr-12">
              <CreditCalculatorLab settings={state.settings} />
            </div>
          )}

          {activeTab === 'calc_management' && (
            <div className="h-full overflow-y-auto p-6 space-y-4 text-right pr-12">
              <CalculatorManagementCenter
                state={state}
                onUpdateState={handleUpdateState}
                currentUserRole={currentUserRole}
              />
            </div>
          )}

          {activeTab === 'agent_test_mode' && (
            <div className="h-full overflow-y-auto pr-12">
              <AgentTestEnvironment realState={state} />
            </div>
          )}
        </>
      )}

          {/* POINTER/HOVER-TO-EXPAND VERTICAL SIDEBAR */}
          <Sidebar
            currentUserRole={currentUserRole}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            peopleSubTab={peopleSubTab}
            setPeopleSubTab={setPeopleSubTab}
            pendingAgentsCount={pendingAgentsCount}
            onOpenManualVoucher={() => setShowManualVoucherForm(true)}
            setSelectedPersonForLedger={setSelectedPersonForLedger}
          />

          {/* Detail Modals */}
          {viewingOpeningBalance && (
            <OpeningBalanceDetailModal
              openingBalance={viewingOpeningBalance}
              products={state.products}
              onClose={() => setViewingOpeningBalance(undefined)}
              onEdit={(ob) => {
                setEditingOpeningBalance(ob);
                setShowOpeningBalanceForm(true);
              }}
              onDelete={handleDeleteOpeningBalance}
              onNew={() => setShowOpeningBalanceForm(true)}
            />
          )}

          {/* CHRONOLOGICAL DRILL-DOWN LEDGER HISTORY OVERLAY */}
          <AnimatePresence>
            {selectedPersonForLedger && (
              <motion.div
                initial={{ opacity: 0, x: '100%' }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 180 }}
                className="absolute inset-0 bg-zinc-50 z-45 flex flex-col"
                dir="rtl"
              >
                {/* Header */}
                <div className="bg-white border-b border-zinc-150 px-4 py-3 flex items-center justify-between sticky top-0 z-30 shadow-sm">
                  <button 
                    onClick={() => setSelectedPersonForLedger(undefined)} 
                    className="text-zinc-500 hover:text-zinc-800 p-1 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div className="text-center">
                    <span className="font-sans text-xs font-bold text-zinc-800">کارت معین تفصیلی شخص</span>
                    <strong className="block text-[11px] text-emerald-600 font-sans mt-0.5">{selectedPersonForLedger.name} ({selectedPersonForLedger.code})</strong>
                  </div>
                  <div className="w-8 h-8" />
                </div>

                {/* Body scroll */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Summary Profile */}
                  <div className="bg-zinc-900 text-white p-4 rounded-2xl shadow-md space-y-3 text-right">
                    <span className="text-[10px] text-zinc-400 block border-b border-white/10 pb-1.5 font-sans">مشخصات طرف حساب</span>
                    
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-sans">
                      <div>
                        <span className="text-zinc-400">تلفن همراه: </span>
                        <strong className="font-mono text-zinc-200">{selectedPersonForLedger.mobile || 'ثبت نشده'}</strong>
                      </div>
                      <div>
                        <span className="text-zinc-400">تلفن ثابت: </span>
                        <strong className="font-mono text-zinc-200">{selectedPersonForLedger.phone || 'ثبت نشده'}</strong>
                      </div>
                      <div className="col-span-2">
                        <span className="text-zinc-400">شناسه/کد ملی: </span>
                        <strong className="font-mono text-zinc-200">{selectedPersonForLedger.nationalId || 'ثبت نشده'}</strong>
                      </div>
                      <div className="col-span-2 mt-1">
                        <span className="text-zinc-400 block mb-0.5">آدرس پستی:</span>
                        <p className="text-zinc-300 bg-white/5 p-2 rounded border border-white/5 leading-relaxed text-[10px]">
                          {selectedPersonForLedger.address || 'نشانی برای این فرد در سیستم ثبت نشده است.'}
                        </p>
                      </div>
                    </div>

                    <div className="h-px bg-white/10 my-1" />
                    
                    {/* Critical Status Summary */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 flex gap-2">
                        {selectedPersonForLedger.criticalDetails?.phoneBoxStatus === 'at_store' && (
                          <div className="bg-rose-500/20 text-rose-300 px-2 py-1 rounded text-[9px] border border-rose-500/30">امانت کارتن</div>
                        )}
                        {selectedPersonForLedger.criticalDetails?.ownershipStatus === 'at_store' && (
                          <div className="bg-rose-500/20 text-rose-300 px-2 py-1 rounded text-[9px] border border-rose-500/30">امانت سند</div>
                        )}
                        {(!selectedPersonForLedger.criticalDetails?.phoneBoxStatus || selectedPersonForLedger.criticalDetails?.phoneBoxStatus === 'returned') && 
                         (!selectedPersonForLedger.criticalDetails?.ownershipStatus || selectedPersonForLedger.criticalDetails?.ownershipStatus === 'returned') && (
                          <div className="bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded text-[9px] border border-emerald-500/30">وضعیت امانات: پاک</div>
                        )}
                      </div>
                      <button
                        onClick={() => setSelectedPersonForCritical(selectedPersonForLedger)}
                        className="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-xl border border-white/10 text-[10px] font-bold flex items-center gap-1.5 transition"
                      >
                        <ShieldCheck size={14} className="text-rose-400" />
                        <span>مدیریت وضعیت بحرانی</span>
                      </button>
                    </div>

                    <div className="h-px bg-white/10 my-1" />

                    {/* Breakdown of Subsidiary Balances */}
                    <div className="space-y-1.5 text-[10px] font-sans">
                      {(() => {
                        const norm = normalDebtorBalances[selectedPersonForLedger.id];
                        const inst = installmentDebtorBalances[selectedPersonForLedger.id];
                        const cred = creditorBalances[selectedPersonForLedger.id];
                        const showNorm = norm && norm.net > 0;
                        const showInst = inst && inst.net > 0;
                        const showCred = cred && cred.net > 0;

                        if (!showNorm && !showInst && !showCred) return null;

                        return (
                          <div className="bg-white/5 p-2.5 rounded-xl border border-white/10 space-y-1.5">
                            <span className="text-zinc-400 block text-[9px] border-b border-white/5 pb-1 mb-1 text-right">ریز حساب‌های معین تفصیلی:</span>
                            {showNorm && (
                              <div className="flex justify-between items-center">
                                <span className="text-zinc-400">بدهی تجاری عادی (مشتری):</span>
                                <span className="text-red-400 font-mono font-bold">{norm.net.toLocaleString()} ریال</span>
                              </div>
                            )}
                            {showInst && (
                              <div className="flex justify-between items-center">
                                <span className="text-zinc-400">بدهی اقساطی (مشتری اقساط):</span>
                                <span className="text-indigo-400 font-mono font-bold">{inst.net.toLocaleString()} ریال</span>
                              </div>
                            )}
                            {showCred && (
                              <div className="flex justify-between items-center">
                                <span className="text-zinc-400">بستانکاری تجاری (همکار):</span>
                                <span className="text-emerald-400 font-mono font-bold">{cred.net.toLocaleString()} ریال</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="h-px bg-white/10 my-1" />

                    {/* Net Balance Highlight */}
                    <div className="flex justify-between items-center bg-white/5 p-2 rounded-xl border border-white/10">
                      <span className="text-zinc-400 text-[10px]">آخرین وضعیت مانده حساب کل:</span>
                      <strong className={`font-mono text-xs ${
                        (personBalances[selectedPersonForLedger.id]?.nature === 'بدهکار')
                          ? 'text-red-400'
                          : (personBalances[selectedPersonForLedger.id]?.nature === 'بستانکار')
                            ? 'text-emerald-400'
                            : 'text-zinc-300'
                      }`}>
                        {personBalances[selectedPersonForLedger.id]?.net > 0 
                          ? `${personBalances[selectedPersonForLedger.id]?.net?.toLocaleString() || '0'} ریال (${personBalances[selectedPersonForLedger.id]?.nature || ''})`
                          : 'کاملاً بی‌حساب / تسویه'
                        }
                      </strong>
                    </div>
                  </div>

                  {/* Active Installment Booklets Notification Banner */}
                  {(() => {
                    const activeBooks = (state.installmentBooks || []).filter(
                      b => b.personId === selectedPersonForLedger.id && b.status === 'active'
                    );

                    if (activeBooks.length === 0) return null;

                    return (
                      <div className="space-y-2.5" dir="rtl">
                        {activeBooks.map(book => {
                          const bookInstallments = (state.installments || []).filter(i => i.bookId === book.id);
                          const totalCount = book.installmentCount || bookInstallments.length || 0;
                          const paidCount = bookInstallments.filter(
                            i => i.status === 'paid' || (i.paidAmount || 0) >= (i.amount || 0)
                          ).length;
                          const remainingCount = Math.max(0, totalCount - paidCount);
                          const remainingAmount = bookInstallments
                            .filter(i => i.status !== 'paid' && (i.paidAmount || 0) < (i.amount || 0))
                            .reduce((sum, i) => sum + Math.max(0, (i.amount || 0) - (i.paidAmount || 0)), 0);

                          return (
                            <div 
                              key={book.id}
                              onClick={() => {
                                setInitialPersonForInstallment(selectedPersonForLedger.id);
                                setShowInstallmentBooklet(true);
                              }}
                              className="bg-linear-to-r from-emerald-900/90 via-zinc-900 to-indigo-950/90 text-white p-4 rounded-2xl border border-emerald-500/40 shadow-lg hover:border-emerald-400 hover:shadow-emerald-900/20 transition cursor-pointer group relative overflow-hidden"
                            >
                              {/* Ambient Background Accent */}
                              <div className="absolute -left-10 -top-10 w-28 h-28 bg-emerald-500/15 rounded-full blur-2xl group-hover:bg-emerald-500/25 transition" />

                              <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-3 relative z-10">
                                <div className="flex items-center gap-2.5">
                                  <div className="bg-emerald-500/20 text-emerald-400 p-2 rounded-xl border border-emerald-500/30 shrink-0">
                                    <BookOpen size={18} />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-black text-emerald-300">این مشتری دارای دفترچه اقساط فعال است</span>
                                      <span className="bg-emerald-500/20 text-emerald-300 text-[9px] font-bold px-2 py-0.5 rounded-full border border-emerald-500/30">
                                        فعال
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-zinc-400 font-mono block mt-0.5">
                                      شماره دفترچه: {book.id} {book.startDate ? `| تاریخ صدور: ${book.startDate}` : ''}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1 text-[11px] text-emerald-400 group-hover:text-emerald-300 font-bold transition shrink-0 bg-emerald-500/10 px-2.5 py-1 rounded-xl border border-emerald-500/20">
                                  <span>ورود به دفترچه</span>
                                  <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                                </div>
                              </div>

                              {/* Booklet Stats Grid */}
                              <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-sans relative z-10">
                                <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                                  <span className="text-zinc-400 block text-[9px] mb-0.5">تعداد کل اقساط</span>
                                  <strong className="font-mono text-zinc-100 font-bold text-xs">{totalCount} قسط</strong>
                                </div>
                                <div className="bg-emerald-500/10 p-2 rounded-xl border border-emerald-500/20">
                                  <span className="text-emerald-300 block text-[9px] mb-0.5">اقساط پرداخت‌شده</span>
                                  <strong className="font-mono text-emerald-400 font-bold text-xs">{paidCount} قسط</strong>
                                </div>
                                <div className="bg-amber-500/10 p-2 rounded-xl border border-amber-500/20">
                                  <span className="text-amber-300 block text-[9px] mb-0.5">اقساط باقیمانده</span>
                                  <strong className="font-mono text-amber-400 font-bold text-xs">{remainingCount} قسط</strong>
                                </div>
                              </div>

                              {remainingAmount > 0 && (
                                <div className="mt-2.5 pt-2 border-t border-white/10 flex justify-between items-center text-[10px] relative z-10">
                                  <span className="text-zinc-400 font-sans">مبلغ کل اقساط باقیمانده:</span>
                                  <span className="text-amber-300 font-mono font-bold text-[11px]">
                                    {remainingAmount.toLocaleString()} ریال
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Sub-ledger actions section (Point 3 & 4) */}
                  {(() => {
                    const normBal = normalDebtorBalances[selectedPersonForLedger.id]?.net || 0;
                    const instBal = installmentDebtorBalances[selectedPersonForLedger.id]?.net || 0;
                    
                    if (normBal === 0 && instBal === 0) return null;

                    return (
                      <div className="bg-white p-3.5 rounded-2xl border border-zinc-150 shadow-sm space-y-3" dir="rtl">
                        <span className="block font-sans text-[11px] font-black text-zinc-800 border-b border-zinc-100 pb-1.5">عملیات مالی ویژه تفصیلی</span>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {normBal > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setTransferModalPerson(selectedPersonForLedger);
                                setTransferAmount(normBal);
                                setTransferDescription(`انتقال بدهی عادی به بدهی اقساطی برای ${selectedPersonForLedger.name}`);
                              }}
                              className="w-full bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-sans text-[10px] font-bold px-3 py-2 rounded-xl shadow-xs transition flex items-center justify-center gap-2"
                            >
                              <ArrowRightLeft size={13} className="shrink-0" />
                              <span>انتقال بدهی عادی به اقساطی</span>
                            </button>
                          )}

                          {instBal > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setSettleInstallmentPerson(selectedPersonForLedger);
                                setSettleMethod('cash_pos');
                                setSettleCashAmount(instBal);
                                setSettlePosAmount(0);
                                setSettlePosTerminalId(state.bankTerminals[0]?.id || '');
                                setSettleBetaAmount(instBal);
                                setSettleBetaDescription(`تسویه بدهی اقساطی از طریق سامانه بتا (بانک رفاه) برای ${selectedPersonForLedger.name}`);
                                setSettleCheckAmount(instBal);
                                setSettleCheckBank('');
                                setSettleCheckNumber('');
                                setSettleCheckDueDate(getCurrentJalaliDate());
                                setSettleCheckSayyadId('');
                              }}
                              className="w-full bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-sans text-[10px] font-bold px-3 py-2 rounded-xl shadow-xs transition flex items-center justify-center gap-2"
                            >
                              <CreditCard size={13} className="shrink-0" />
                              <span>تعیین تکلیف / تسویه اقساطی</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Transactions list */}
                  <div className="space-y-3">
                    <span className="block font-sans text-xs font-bold text-zinc-800">ریز گردش عملیات حساب (تراکنش‌ها)</span>

                    {getPersonLedger(selectedPersonForLedger.id).length > 0 ? (
                      <div className="space-y-2">
                        {getPersonLedger(selectedPersonForLedger.id).map((tx, idx) => {
                          const getTxIcon = () => {
                            if (tx.type === 'invoice') return ShoppingCart;
                            if (tx.type === 'check') return CreditCard;
                            return FileText;
                          };
                          const IconComponent = getTxIcon();

                          const getTxLabel = () => {
                            if (tx.type === 'invoice') {
                              return tx.referenceObject?.type === 'buy' ? 'فاکتور خرید' : 'فاکتور فروش';
                            }
                            if (tx.type === 'check') {
                              return tx.referenceObject?.type === 'received' ? 'چک دریافتی' : 'چک پرداختی';
                            }
                            if (tx.type === 'voucher') {
                              return tx.debit > 0 ? 'سند پرداخت نقدی' : 'سند دریافت';
                            }
                            return tx.title;
                          };

                          return (
                            <div 
                              key={idx}
                              onClick={() => {
                                if (tx.type === 'invoice') {
                                  setSelectedInvoiceForView(tx.referenceObject);
                                  setShowInvoiceForm(true);
                                } else if (tx.type === 'voucher') {
                                  setSelectedVoucherForView(tx.referenceObject);
                                } else if (tx.type === 'check') {
                                  setSelectedCheckForView(tx.referenceObject);
                                }
                              }}
                              className="bg-white hover:bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 cursor-pointer transition flex items-center justify-between text-right font-sans text-xs shadow-xs hover:border-emerald-500/30 group"
                            >
                              <div className="flex items-center space-x-2 space-x-reverse min-w-0">
                                <span className={`p-1.5 rounded-lg shrink-0 ${
                                  tx.type === 'invoice' 
                                    ? tx.referenceObject?.type === 'buy' ? 'bg-blue-50 text-blue-600' : 'bg-rose-50 text-rose-600'
                                    : tx.type === 'check' 
                                      ? 'bg-purple-50 text-purple-600' 
                                      : 'bg-zinc-100 text-zinc-600'
                                }`}>
                                  <IconComponent size={14} />
                                </span>
                                
                                <div className="flex flex-col text-right min-w-0">
                                  <strong className="text-zinc-800 text-[11px] group-hover:text-emerald-700 transition">
                                    {getTxLabel()}
                                  </strong>
                                  <span className="text-[9px] text-zinc-400 mt-0.5 truncate max-w-[180px]">
                                    {tx.date} • {tx.description || 'بدون بابت'}
                                  </span>
                                </div>
                              </div>

                              <div className="text-left font-mono shrink-0">
                                <span className={`font-bold text-[11px] block ${
                                  tx.debit > 0 ? 'text-red-600' : 'text-emerald-600'
                                }`}>
                                  {((tx.debit || 0) + (tx.credit || 0)).toLocaleString()} ریال
                                </span>
                                <span className="text-[8px] text-zinc-400 block mt-0.5">
                                  مانده: {Math.abs(tx.runningBalance ?? 0).toLocaleString()} ({tx.nature})
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="bg-white p-12 rounded-2xl border border-zinc-100 text-center font-sans text-xs text-zinc-400">
                        هیچ رویداد مالی برای این شخص ثبت نشده است.
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 1. BALANCE TRANSFER MODAL (Point 3) */}
          <AnimatePresence>
            {transferModalPerson && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4" dir="rtl">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 15 }}
                  className="bg-white rounded-3xl shadow-xl w-full max-w-md p-6 overflow-hidden text-right font-sans relative border border-zinc-150"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-zinc-100 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <div className="bg-rose-100 text-rose-700 p-2 rounded-xl">
                        <ArrowRightLeft size={18} />
                      </div>
                      <h3 className="text-xs font-black text-zinc-800">صدور سند انتقال بدهی</h3>
                    </div>
                    <button
                      onClick={() => setTransferModalPerson(undefined)}
                      className="text-zinc-400 hover:text-zinc-700 bg-zinc-50 p-1.5 rounded-lg transition"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Info Block */}
                  <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-150 mb-4 text-xs space-y-2">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">طرف حساب:</span>
                      <strong className="text-zinc-800">{transferModalPerson.name}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">مانده بدهی عادی جاری:</span>
                      <strong className="text-rose-600 font-mono">{(normalDebtorBalances[transferModalPerson.id]?.net || 0).toLocaleString()} ریال</strong>
                    </div>
                  </div>

                  {/* Form Fields */}
                  <div className="space-y-4 text-xs">
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-700 mb-1">مبلغ انتقال (ریال)</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={transferAmount || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          const max = normalDebtorBalances[transferModalPerson.id]?.net || 0;
                          setTransferAmount(Math.min(val, max));
                        }}
                        placeholder="مبلغ را به ریال وارد کنید..."
                        className="w-full bg-zinc-50 border border-zinc-200 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 rounded-xl px-3.5 py-2.5 text-left font-mono font-bold text-zinc-800 outline-none transition"
                      />
                      <span className="block text-[9px] text-zinc-400 mt-1">حداکثر مبلغ مجاز: {(normalDebtorBalances[transferModalPerson.id]?.net || 0).toLocaleString()} ریال</span>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-zinc-700 mb-1">شرح سند (بابت)</label>
                      <textarea
                        rows={2}
                        value={transferDescription}
                        onChange={(e) => setTransferDescription(e.target.value)}
                        placeholder="توضیحات سند انتقال..."
                        className="w-full bg-zinc-50 border border-zinc-200 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 rounded-xl px-3.5 py-2.5 text-zinc-800 outline-none transition leading-relaxed"
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2.5 mt-6 border-t border-zinc-100 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        handleTransferNormalToInstallment(transferModalPerson.id, transferAmount, transferDescription);
                        setTransferModalPerson(undefined);
                      }}
                      disabled={transferAmount <= 0}
                      className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:bg-zinc-200 disabled:text-zinc-400 text-white font-sans text-[11px] font-bold py-2.5 rounded-xl shadow transition"
                    >
                      ثبت و صدور سند انتقال
                    </button>
                    <button
                      type="button"
                      onClick={() => setTransferModalPerson(undefined)}
                      className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-sans text-[11px] font-bold px-4 py-2.5 rounded-xl transition"
                    >
                      انصراف
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* 2. COMPREHENSIVE INSTALLMENT SETTLEMENT MODAL (Point 4) */}
          <AnimatePresence>
            {settleInstallmentPerson && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4" dir="rtl">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 15 }}
                  className={`bg-white rounded-3xl shadow-xl w-full ${settleMethod === 'checks' ? 'lg:max-w-6xl md:max-w-4xl max-w-xl' : 'max-w-xl'} p-6 overflow-hidden text-right font-sans relative border border-zinc-150 max-h-[95vh] flex flex-col transition-all duration-350`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between border-b border-zinc-100 pb-3 mb-4 shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="bg-indigo-100 text-indigo-700 p-2 rounded-xl">
                        <CreditCard size={18} />
                      </div>
                      <div>
                        <h3 className="text-xs font-black text-zinc-800">تعیین تکلیف و تسویه بدهی اقساطی</h3>
                        <span className="block text-[9px] text-zinc-500 mt-0.5">طرف حساب: {settleInstallmentPerson.name}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setSettleInstallmentPerson(undefined)}
                      className="text-zinc-400 hover:text-zinc-700 bg-zinc-50 p-1.5 rounded-lg transition"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Quick Info Box */}
                  <div className="bg-zinc-50 p-3.5 rounded-2xl border border-zinc-150 mb-4 text-xs flex justify-between items-center shrink-0">
                    <span className="text-zinc-500">مانده بدهکاری در معین بدهکاران اقساطی:</span>
                    <strong className="text-indigo-600 font-mono text-sm">{(installmentDebtorBalances[settleInstallmentPerson.id]?.net || 0).toLocaleString()} ریال</strong>
                  </div>

                  {/* Navigation Tabs */}
                  <div className="flex border-b border-zinc-150 mb-4 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSettleMethod('cash_pos')}
                      className={`flex-1 pb-2.5 text-[10px] font-bold text-center border-b-2 transition flex items-center justify-center gap-1.5 ${
                        settleMethod === 'cash_pos'
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-zinc-400 hover:text-zinc-600'
                      }`}
                    >
                      <Coins size={13} />
                      <span>نقدی کارتخوان</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettleMethod('checks')}
                      className={`flex-1 pb-2.5 text-[10px] font-bold text-center border-b-2 transition flex items-center justify-center gap-1.5 ${
                        settleMethod === 'checks'
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-zinc-400 hover:text-zinc-600'
                      }`}
                    >
                      <FileText size={13} />
                      <span>تقسیط مجدد و دریافت چک</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSettleMethod('beta')}
                      className={`flex-1 pb-2.5 text-[10px] font-bold text-center border-b-2 transition flex items-center justify-center gap-1.5 ${
                        settleMethod === 'beta'
                          ? 'border-indigo-600 text-indigo-600'
                          : 'border-transparent text-zinc-400 hover:text-zinc-600'
                      }`}
                    >
                      <Sparkles size={13} />
                      <span>سامانه بتا رفاه</span>
                    </button>
                  </div>

                  {/* Tab Contents */}
                  <div className="flex-1 overflow-y-auto space-y-4 text-xs px-1 min-h-[220px]">
                    {settleMethod === 'cash_pos' && (
                      <div className="space-y-4">
                        <p className="text-zinc-500 leading-relaxed text-[10px]">
                          مبلغ دریافتی بابت تسویه بدهی اقساطی مشتری را به تفکیک نقدی (صندوق اصلی) و کارتخوان وارد نمایید:
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                          <div>
                            <label className="block text-[11px] font-bold text-zinc-700 mb-1">پرداخت نقدی به صندوق (ریال)</label>
                            <input
                              type="number"
                              inputMode="decimal"
                              value={settleCashAmount || ''}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                const limit = (installmentDebtorBalances[settleInstallmentPerson.id]?.net || 0) - settlePosAmount;
                                setSettleCashAmount(Math.min(val, limit));
                              }}
                              placeholder="مبلغ نقدی..."
                              className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-xl px-3 py-2.5 text-left font-mono font-bold text-zinc-800 outline-none transition"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-zinc-700 mb-1">پرداخت با کارتخوان بانک (ریال)</label>
                            <input
                              type="number"
                              inputMode="decimal"
                              value={settlePosAmount || ''}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                const limit = (installmentDebtorBalances[settleInstallmentPerson.id]?.net || 0) - settleCashAmount;
                                setSettlePosAmount(Math.min(val, limit));
                              }}
                              placeholder="مبلغ کارتخوان..."
                              className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-xl px-3 py-2.5 text-left font-mono font-bold text-zinc-800 outline-none transition"
                            />
                          </div>
                        </div>

                        {settlePosAmount > 0 && (
                          <div>
                            <label className="block text-[11px] font-bold text-zinc-700 mb-1">پایانه کارتخوان مقصد (حساب بانک)</label>
                            <select
                              value={settlePosTerminalId}
                              onChange={(e) => setSettlePosTerminalId(e.target.value)}
                              className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 rounded-xl px-3 py-2.5 text-zinc-800 outline-none transition font-bold"
                            >
                              {state.bankTerminals.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.name} ({t.terminalNumber})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div className="flex justify-between items-center bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 text-[10px] text-indigo-800">
                          <span>جمع مبالغ تسویه نقدی و کارتخوان:</span>
                          <strong className="font-mono">{(settleCashAmount + settlePosAmount).toLocaleString()} ریال</strong>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            handleSettleInstallmentCashPos(settleInstallmentPerson.id, settleCashAmount, settlePosAmount, settlePosTerminalId);
                            setSettleInstallmentPerson(undefined);
                          }}
                          disabled={settleCashAmount + settlePosAmount <= 0}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-200 disabled:text-zinc-400 text-white font-sans text-[11px] font-bold py-2.5 rounded-xl shadow transition"
                        >
                          ثبت و صدور سند تسویه نقدی/کارتخوان
                        </button>
                      </div>
                    )}

                    {settleMethod === 'checks' && (
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        {/* Right Column: Sadi Bazar Calculator */}
                        <div className="lg:col-span-7 bg-zinc-50/50 p-4 rounded-2xl border border-zinc-150 space-y-4">
                          <div className="flex items-center gap-2 border-b border-zinc-200 pb-2">
                            <CalculatorIcon size={16} className="text-emerald-600" />
                            <h4 className="font-sans text-xs font-bold text-zinc-800">ماشین‌حساب صدی بازار</h4>
                          </div>

                          <CheckSettlementCalculator
                            isInline={true}
                            remainingAmount={installmentDebtorBalances[settleInstallmentPerson.id]?.net || 0}
                            personId={settleInstallmentPerson.id}
                            persons={state.persons}
                            state={state}
                            onConfirm={(cheques, commission) => {
                              handleSettleInstallmentMultipleChecks(settleInstallmentPerson.id, cheques, commission);
                              setSettleInstallmentPerson(undefined);
                            }}
                            onCancel={() => {}}
                          />
                        </div>

                        {/* Left Column: Manual Check Registration */}
                        <div className="lg:col-span-5 space-y-4 lg:border-r lg:border-zinc-150 lg:pr-6">
                          <div className="flex items-center gap-2 border-b border-zinc-200 pb-2">
                            <FileText size={16} className="text-indigo-600" />
                            <h4 className="font-sans text-xs font-bold text-zinc-800">ثبت مشخصات چک صیادی (دستی)</h4>
                          </div>

                          <p className="text-zinc-500 leading-relaxed text-[10px]">
                            با دریافت چک صیادی مدت‌دار از مشتری بابت تسویه بدهی اقساطی، مشخصات کامل برگه چک صیادی را ثبت کنید تا سند اتوماتیک حسابداری صادر شود:
                          </p>
                          
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-bold text-zinc-700 mb-1">بانک صادرکننده</label>
                              <input
                                type="text"
                                value={settleCheckBank}
                                onChange={(e) => setSettleCheckBank(e.target.value)}
                                placeholder="مثال: رفاه، ملی، ملت..."
                                className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 text-zinc-800 outline-none transition font-semibold"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-zinc-700 mb-1">شناسه صیاد (۱۶ رقمی)</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={16}
                                value={settleCheckSayyadId}
                                onChange={(e) => setSettleCheckSayyadId(e.target.value)}
                                placeholder="۱۶ رقم شناسه..."
                                className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 text-zinc-800 outline-none transition font-mono font-bold text-left"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-zinc-700 mb-1">شماره سریال چک</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={settleCheckNumber}
                                onChange={(e) => setSettleCheckNumber(e.target.value)}
                                placeholder="سریال چک..."
                                className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 text-zinc-800 outline-none transition font-mono font-bold text-left"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold text-zinc-700 mb-1">تاریخ سررسید (شمسی)</label>
                              <input
                                type="text"
                                value={settleCheckDueDate}
                                onChange={(e) => setSettleCheckDueDate(e.target.value)}
                                placeholder="۱۴۰۵/۰۲/۱۵"
                                className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 text-zinc-800 outline-none transition font-mono font-bold text-left"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-zinc-700 mb-1">مبلغ چک صیادی (ریال)</label>
                            <input
                              type="number"
                              inputMode="decimal"
                              value={settleCheckAmount || ''}
                              onChange={(e) => setSettleCheckAmount(Math.min(parseInt(e.target.value) || 0, installmentDebtorBalances[settleInstallmentPerson.id]?.net || 0))}
                              placeholder="مبلغ چک به ریال..."
                              className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2.5 text-left font-mono font-bold text-zinc-800 outline-none transition"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              handleSettleInstallmentCheck(settleInstallmentPerson.id, settleCheckBank, settleCheckNumber, settleCheckDueDate, settleCheckAmount, settleCheckSayyadId);
                              setSettleInstallmentPerson(undefined);
                            }}
                            disabled={settleCheckAmount <= 0 || !settleCheckNumber || !settleCheckDueDate}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-200 disabled:text-zinc-400 text-white font-sans text-[11px] font-bold py-2.5 rounded-xl shadow transition"
                          >
                            ثبت دریافت چک صیادی و کسر بدهی اقساطی
                          </button>

                          {/* Secondary flow: booklet redirect */}
                          <div className="pt-2 border-t border-zinc-100 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setSettleInstallmentPerson(undefined);
                                setSelectedPersonForLedger(undefined);
                                setActiveTab('installments');
                                setInitialPersonForInstallment(settleInstallmentPerson.id);
                                setShowInstallmentBooklet(true);
                              }}
                              className="text-indigo-600 hover:text-indigo-800 font-sans text-[10px] font-bold flex items-center justify-center gap-1.5 mx-auto"
                            >
                              <BookOpen size={11} />
                              <span>صدور دفترچه اقساط منظم بدون چک (پنجره تقسیط هوشمند)</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settleMethod === 'beta' && (
                      <div className="space-y-4">
                        <div className="bg-indigo-50 border border-indigo-150 p-4 rounded-2xl flex items-center gap-3">
                          <div className="bg-indigo-100 text-indigo-700 p-2 rounded-xl">
                            <Sparkles size={16} />
                          </div>
                          <p className="text-indigo-800 leading-relaxed text-[10px]">
                            <strong>سامانه اعتباری بتا (بانک رفاه کارگران ویژه بازنشستگان)</strong><br />
                            کسر اعتبار مستقیم ماهانه از فیش حقوقی تامین اجتماعی بازنشستگان کل کشور. با کسر وجه از اعتبار بتا، وصولی را ثبت نمایید:
                          </p>
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-zinc-700 mb-1">مبلغ کسر شده از اعتبار بتا (ریال)</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            value={settleBetaAmount ? settleBetaAmount.toLocaleString() : ''}
                            onChange={(e) => setSettleBetaAmount(Math.min(parseNumericValue(e.target.value) || 0, installmentDebtorBalances[settleInstallmentPerson.id]?.net || 0))}
                            placeholder="مبلغ وصولی..."
                            className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2.5 text-left font-mono font-bold text-zinc-800 outline-none transition"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-zinc-700 mb-1">شرح سند / توضیحات وصولی</label>
                          <textarea
                            rows={2}
                            value={settleBetaDescription}
                            onChange={(e) => setSettleBetaDescription(e.target.value)}
                            placeholder="توضیحات وصولی..."
                            className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2.5 text-zinc-800 outline-none transition"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            handleSettleInstallmentBeta(settleInstallmentPerson.id, settleBetaAmount, settleBetaDescription);
                            setSettleInstallmentPerson(undefined);
                          }}
                          disabled={settleBetaAmount <= 0}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-200 disabled:text-zinc-400 text-white font-sans text-[11px] font-bold py-2.5 rounded-xl shadow transition"
                        >
                          تایید و ثبت وصولی از سامانه بتا
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

        </div>

      </div>

      {/* DOUBLE-ENTRY DETAILED VIEW MODAL */}
      
        {selectedCheckForView && (
          <CheckDetailModal
            check={selectedCheckForView}
            appState={state}
            onClose={() => setSelectedCheckForView(undefined)}
            onEditCheck={(updatedCheck) => {
              handleEditCheck(updatedCheck);
              setSelectedCheckForView(updatedCheck);
            }}
            onViewVoucher={(voucherId) => {
              setSelectedCheckForView(undefined);
              setSelectedVoucherForView(state.vouchers.find(v => v.id === voucherId));
            }}
          />
        )}
  
        {selectedVoucherForView && (
        <VoucherDetailModal
          voucher={selectedVoucherForView}
          onClose={() => setSelectedVoucherForView(undefined)}
          onDelete={(voucherId) => {
            const v = state.vouchers.find(voc => voc.id === voucherId);
            if (!v) return;
            if (v.sourceType === 'sell_invoice' || v.sourceType === 'buy_invoice') {
              if (v.sourceId) handleDeleteInvoice(v.sourceId);
            } else if (v.sourceType === 'opening_balance') {
              const obId = v.sourceId || state.openingBalances.find(o => o.voucherId === v.id)?.id;
              if (obId) handleDeleteOpeningBalance(obId);
            } else {
              handleDeleteVoucher(v.id);
            }
          }}
          onEdit={(voucher) => setSelectedVoucherForEdit(voucher)}
          onEditInvoice={(invoiceId) => {
            const inv = state.invoices.find(i => i.id === invoiceId);
            if (inv) {
              setSelectedInvoiceForView(inv);
              setShowInvoiceForm(true);
            }
          }}
          onEditOpeningBalance={(obId) => {
            const ob = state.openingBalances.find(o => o.id === obId);
            if (ob) {
              setEditingOpeningBalance(ob);
              setShowOpeningBalanceForm(true);
            }
          }}
          onNew={(sourceType) => {
            if (sourceType === 'sell_invoice') {
              setActiveTab('invoices');
              setShowInvoiceForm(true);
            } else if (sourceType === 'buy_invoice') {
              setActiveTab('invoices');
              setShowInvoiceForm(true);
            } else {
              setShowManualVoucherForm(true);
            }
          }}
        />
      )}

      {showCashTransactionForm && (
        <CashTransactionForm
          appState={state}
          onSave={handleUpdateState}
          onClose={() => setShowCashTransactionForm(false)}
          onFinancialMutationCommitted={async () => {
            const nextGen = ++financialFetchGenerationRef.current;
            await loadServerAuthoritativeFinancialData(nextGen, true);
          }}
          onPostMutationHydration={async () => {
            const nextGen = ++financialFetchGenerationRef.current;
            await loadServerAuthoritativeFinancialData(nextGen, true);
          }}
        />
      )}

      {selectedProductHistory && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto"
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-sans text-lg font-bold">سابقه تراکنش‌های کالا: {selectedProductHistory.name}</h2>
              <button onClick={() => setSelectedProductHistory(null)}><X size={20} /></button>
            </div>
            
            <div className="space-y-4">
              {selectedProductHistory.initialStock > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-xl flex justify-between items-center">
                  <div className="text-right">
                    <p className="font-sans text-sm font-bold text-emerald-800">موجودی افتتاحیه (اول دوره)</p>
                    <p className="text-emerald-600 text-[10px]">ثبت شده در مشخصات کالا</p>
                  </div>
                  <div className="text-left font-mono font-bold text-emerald-700">
                    {selectedProductHistory.initialStock} {selectedProductHistory.unit}
                  </div>
                </div>
              )}


              {selectedProductHistory.hasSerial && (
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl space-y-2">
                  <h3 className="font-bold text-blue-800 text-sm mb-2 text-right">شماره سریال‌های موجود در انبار</h3>
                  {(() => {
                    const availableSerials = getAvailableSerialNumbers(selectedProductHistory.id, state);
                    return availableSerials.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {availableSerials.map((sn, idx) => (
                          <div key={idx} className="bg-white px-2 py-1.5 border border-blue-100 rounded text-xs font-mono text-center shadow-sm">
                            {sn}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-blue-500 text-right">هیچ شماره سریالی در انبار موجود نیست.</p>
                    );
                  })()}
                </div>
              )}

              {state.invoices
                .filter(inv => inv.items.some(item => item.productId === selectedProductHistory.id))
                .map(inv => (
                  <div key={inv.id} className="border border-zinc-150 p-3 rounded-xl cursor-pointer hover:bg-zinc-50 transition" onClick={() => {
                    setSelectedInvoiceForView(inv);
                    setShowInvoiceForm(true);
                    setSelectedProductHistory(null);
                  }}>
                     <p className="font-sans text-sm">شماره فاکتور: {inv.invoiceNumber} - تاریخ: {inv.date}</p>
                     <p className="text-zinc-500 text-xs">نوع: {inv.type === 'buy' ? 'خرید' : 'فروش'}</p>
                  </div>
                ))}
              {state.invoices.filter(inv => inv.items.some(item => item.productId === selectedProductHistory.id)).length === 0 && (
                <p className="text-center text-zinc-500 font-sans text-sm">هیچ سابقه تراکنشی برای این کالا یافت نشد.</p>
              )}
            </div>
          </motion.div>
        </div>
      )}

      <InvoiceProfitLossModal
        data={invoiceProfitLoss}
        onClose={() => setInvoiceProfitLoss(null)}
      />

      <AdvancedSearchModal
        isOpen={searchModalState.isOpen}
        onClose={() => setSearchModalState(prev => ({ ...prev, isOpen: false }))}
        type={searchModalState.type}
        state={state}
        onSelectResult={handleSearchResultSelect}
      />

      <AppConfirmationModal
        modal={appConfirmationModal}
        onClose={() => setAppConfirmationModal(null)}
      />

      {selectedPersonForCritical && (
        <CriticalStatusPanel
          person={selectedPersonForCritical}
          appState={state}
          onClose={() => setSelectedPersonForCritical(null)}
          onUpdateNotes={(notes) => {
            const customEvent = new CustomEvent('update_person_critical', {
              detail: { id: selectedPersonForCritical.id, criticalDetails: { manualNotes: notes } }
            });
            window.dispatchEvent(customEvent);
            // Also update local state for immediate feedback
            setSelectedPersonForCritical(prev => prev ? { ...prev, criticalDetails: { ...prev.criticalDetails, manualNotes: notes } as any } : null);
          }}
          onUpdateStatus={(status) => {
            const customEvent = new CustomEvent('update_person_critical', {
              detail: { id: selectedPersonForCritical.id, criticalDetails: status }
            });
            window.dispatchEvent(customEvent);
            // Also update local state for immediate feedback
            setSelectedPersonForCritical(prev => prev ? { ...prev, criticalDetails: { ...prev.criticalDetails, ...status } as any } : null);
          }}
        />
      )}

      <KnowledgeGuideModal
        activeTab={activeTab}
        activeKnowledgeArticle={activeKnowledgeArticle}
        appState={state}
        setActiveKnowledgeArticle={setActiveKnowledgeArticle}
        setActiveTab={setActiveTab}
      />
      {/* Project Notebook - Visible for all during development */}
      <ProjectNotebook 
        notes={state.projectNotes || []}
        onAddNote={handleAddProjectNote}
        onUpdateNote={handleUpdateProjectNote}
        onDeleteNote={handleDeleteProjectNote}
      />

      {/* Agent User Account Credentials Modal */}
      <AgentCredentialsModal
        isOpen={Boolean(agentCredentialsModalData)}
        onClose={() => setAgentCredentialsModalData(null)}
        agentName={agentCredentialsModalData?.name || ''}
        loginIdentifier={agentCredentialsModalData?.loginIdentifier || ''}
        generatedPassword={agentCredentialsModalData?.password}
      />
    </div>
  );
}
