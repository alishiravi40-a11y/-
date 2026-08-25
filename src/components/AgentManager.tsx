import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Check, CheckCircle, Plus, Search, Trash2, X, Users, DollarSign, 
  Copy, Upload, Shield, ShieldAlert, CreditCard, AlertTriangle, 
  MessageSquare, Landmark, RefreshCw, ChevronDown, ChevronUp, FileText,
  FileCheck, FileCheck2, CheckSquare, Coins, Scale, Sliders, ArrowRight, Award, History, User, Settings, Calculator,
  Activity, Link, Wrench, Share2, ToggleLeft, ToggleRight, Briefcase, Eye, Edit3, Send, ExternalLink, Lock, KeyRound,
  ShoppingBag, ShoppingCart, Layers, Tag, CheckCircle2, Circle
} from 'lucide-react';
import { AppState, Person, Check as CheckTypeModel, JournalVoucher, Invoice, BusinessPartner, AgencyType, PartnerRole, CreditFile, PartnerCreditRequestStatus, AccountSubsidiary, NesyehPartnerSettings, AgentFeatureToggles, AgentPortalLink } from '../types';
import { saveAppState, createCheckStateVoucher, calculatePersonBalances, DEFAULT_SUBSIDIARIES, toEnglishDigits, parseNumericValue, getNextVoucherNumber } from '../utils/accounting';
import { getCurrentJalaliDate, parseJalali, jalaliToGregorian } from '../utils/jalali';
import { isValidNationalId, isUniqueNationalId, normalizeDigits } from '../utils/validation';
import { generateUniquePersonCode } from '../utils/codeGenerator';
import { PersonService } from '../services/personService';
import { CreditPartnerService } from '../services/creditPartnerService';
import { CalculatorService } from '../services/calculatorService';
import { getDefaultAuthSessionService } from '../services/authSessionService';
import { getMatchingCreditPolicy } from '../utils/creditPolicyHelper';
import PersonForm from './PersonForm';
import PartnerFinancialDossierModal from './PartnerFinancialDossierModal';
import { NesyehPartnerOnboardingModal } from './NesyehPartnerOnboardingModal';
import { DataIntegrityEngine } from '../utils/integrityEngine';
import { syncPartnerToPerson } from '../utils/partnerSync';
import { resolvePartnerCreditRules, recordPartnerCreditRulesChange } from '../utils/partnerProcess';
import { AgentListTable } from './agents/AgentListTable';
import { AgentCommissionPanel } from './agents/AgentCommissionPanel';
import { AgentDossierModal } from './agents/AgentDossierModal';
import { VisitorNetworkManager } from './VisitorNetworkManager';
import { AgentCredentialsModal } from './AgentCredentialsModal';

export function formatRialInPersianWords(rialAmount: number): string {
  if (!rialAmount || isNaN(rialAmount) || rialAmount <= 0) return '';
  const tooman = Math.floor(rialAmount / 10);
  
  const formatWords = (num: number, unit: string) => {
    if (num >= 1000000000000) {
      const trillion = num / 1000000000000;
      return `${trillion % 1 === 0 ? trillion : trillion.toFixed(1)} هزار میلیارد (همت) ${unit}`;
    }
    if (num >= 1000000000) {
      const billion = num / 1000000000;
      return `${billion % 1 === 0 ? billion : billion.toFixed(1)} میلیارد ${unit}`;
    }
    if (num >= 1000000) {
      const million = num / 1000000;
      return `${million % 1 === 0 ? million : million.toFixed(1)} میلیون ${unit}`;
    }
    if (num >= 1000) {
      const thousand = num / 1000;
      return `${thousand % 1 === 0 ? thousand : thousand.toFixed(1)} هزار ${unit}`;
    }
    return `${num.toLocaleString('fa-IR')} ${unit}`;
  };

  const rialText = formatWords(rialAmount, 'ریال');
  const toomanText = formatWords(tooman, 'تومان');
  return `${rialText} ➔ معادل ${toomanText}`;
}

interface FormattedNumericInputProps {
  value: number;
  onChange: (val: number) => void;
  disabled?: boolean;
  onEnableEdit?: () => void;
  isCurrency?: boolean;
  isPercent?: boolean;
  placeholder?: string;
  className?: string;
  textColorClass?: string;
}

export const FormattedNumericInput: React.FC<FormattedNumericInputProps> = ({
  value,
  onChange,
  disabled = false,
  onEnableEdit,
  isCurrency = false,
  isPercent = false,
  placeholder = '0',
  className = '',
  textColorClass = 'text-zinc-800'
}) => {
  const [rawInput, setRawInput] = useState<string | null>(null);

  const cleanDigits = (str: string): string => {
    const en = toEnglishDigits(str);
    return isPercent ? en.replace(/[^0-9.]/g, '') : en.replace(/[^0-9]/g, '');
  };

  const displayVal = useMemo(() => {
    if (rawInput !== null) return rawInput;
    if (value === undefined || value === null) return '';
    if (isCurrency) {
      return value > 0 ? value.toLocaleString('en-US') : (value === 0 ? '0' : '');
    }
    return String(value);
  }, [rawInput, value, isCurrency]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    const clean = cleanDigits(text);

    if (clean === '') {
      setRawInput('');
      onChange(0);
      return;
    }

    if (isCurrency) {
      const parsed = parseInt(clean, 10);
      if (!isNaN(parsed)) {
        setRawInput(parsed.toLocaleString('en-US'));
        onChange(parsed);
      }
    } else if (isPercent) {
      setRawInput(clean);
      const parsed = parseFloat(clean);
      if (!isNaN(parsed)) {
        onChange(parsed);
      }
    } else {
      setRawInput(clean);
      const parsed = parseInt(clean, 10);
      if (!isNaN(parsed)) {
        onChange(parsed);
      }
    }
  };

  const handleBlur = () => {
    setRawInput(null);
  };

  return (
    <div className="relative group w-full">
      <input
        type="text"
        inputMode={isPercent ? "decimal" : "numeric"}
        dir="ltr"
        value={displayVal}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        onClick={() => {
          if (disabled && onEnableEdit) {
            onEnableEdit();
          }
        }}
        className={`w-full bg-zinc-50 border border-zinc-300 rounded-xl p-2.5 font-mono text-xs font-bold ${textColorClass} outline-none focus:border-indigo-500 focus:bg-white transition ${
          disabled ? 'opacity-70 cursor-pointer hover:border-amber-400' : ''
        } ${className}`}
      />

      {disabled && (
        <button
          type="button"
          onClick={() => onEnableEdit && onEnableEdit()}
          className="absolute inset-0 bg-transparent cursor-pointer flex items-center justify-end px-3 text-[11px] text-amber-800 font-bold opacity-0 group-hover:opacity-100 transition bg-amber-500/10 rounded-xl backdrop-blur-[1px] border border-amber-300"
          title="جهت ویرایش کلیک کنید"
        >
          <span>🔓 کلیک برای فعال‌سازی حالت ویرایش</span>
        </button>
      )}

      {isCurrency && value > 0 && (
        <p className="text-[10px] text-indigo-600 font-bold mt-1 text-right dir-rtl flex items-center gap-1">
          <Coins size={11} className="text-amber-500 shrink-0" />
          <span>{formatRialInPersianWords(value)}</span>
        </p>
      )}
    </div>
  );
};

export const defaultFeatureToggles: AgentFeatureToggles = {
  viewLedger: true,
  viewAccountBalance: true,
  viewCreditDossier: true,
  viewInstallments: true,
  viewChecks: true,
  viewContracts: true,
  viewDocuments: true,
  viewMessages: true,
  submitRequests: true,
  editAllowedProfile: true,
  uploadDocuments: true,
  allowCustomerRegister: true,
  allowDossierCreation: true,
  allowCreditRequest: true,
  allowViewHistory: true,
  allowViewReports: true,
  allowFuturePolicy: false,
  calcStandard: true,
  calcStepByStep: true,
  calcBeta: true,
  calcPercentage: true,
  calcFutureTool: false,
};

interface AgentManagerProps {
  appState: AppState;
  currentUserId: string;
  currentUserRole?: string | null;
  onSave: (newState: AppState) => void;
  onRefreshFinancials?: (isPostMutation?: boolean) => Promise<any>;
}

// Helper to calculate the difference in days between a Jalali date and today
function getDaysDifference(jalaliDateStr: string): number {
  const parsed = parseJalali(jalaliDateStr);
  if (!parsed) return 0;
  try {
    const gDate = jalaliToGregorian(parsed.jy, parsed.jm, parsed.jd);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    gDate.setHours(0, 0, 0, 0);
    const diffTime = today.getTime() - gDate.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  } catch (e) {
    return 0;
  }
}

// Helper to safely display confirmation dialogs without throwing exceptions inside sandboxed frames
const safeConfirm = (message: string, defaultValue = true): boolean => {
  try {
    return window.confirm(message);
  } catch (e) {
    console.warn("window.confirm is blocked or not supported in this environment:", e);
    return defaultValue;
  }
};

export default function AgentManager({ appState, currentUserId, currentUserRole, onSave, onRefreshFinancials }: AgentManagerProps) {
  const [activeUnit, setActiveUnit] = useState<'credit_agents' | 'sales_agents' | 'investors' | 'visitors' | 'contract_partners' | null>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'approvals' | 'credit_files'>('list');
  const [selectedCommandAgentId, setSelectedCommandAgentId] = useState<string | null>(null);
  const [commandCenterTab, setCommandCenterTab] = useState<'dossier' | 'command_center' | 'financial'>('command_center');
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [activeCustomerFolder, setActiveCustomerFolder] = useState<string | null>(null);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [partnerSubTab, setPartnerSubTab] = useState<'overview' | 'access' | 'tools' | 'ops' | 'terms' | 'link' | 'portal_link' | 'docs' | 'wallet' | 'penalties' | 'history'>('overview');
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [initialEditState, setInitialEditState] = useState<any>(null);
  const [selectedDossierAgent, setSelectedDossierAgent] = useState<Person | null>(null);
  const [newlyCreatedAgentCredentials, setNewlyCreatedAgentCredentials] = useState<{
    name: string;
    loginIdentifier: string;
    password?: string;
  } | null>(null);

  // Phase 1 Onboarding & Nesyeh Settings States
  const [onboardingData, setOnboardingData] = useState<{ partner: BusinessPartner | null; person: Person | null } | null>(null);
  const [editingNesyehPartner, setEditingNesyehPartner] = useState<BusinessPartner | null>(null);
  const [nesyehFormData, setNesyehFormData] = useState<NesyehPartnerSettings>({
    creditLimit: 0,
    paymentTermDays: 30,
    lateFeePercentage: 0.5,
    isPurchaseAllowed: true,
    contractNotes: ''
  });

  // Open Nesyeh contract settings modal for a partner
  const handleEditNesyehClick = (bp: BusinessPartner, agentPerson: Person | null) => {
    setEditingNesyehPartner(bp);
    const rules = resolvePartnerCreditRules(agentPerson || bp.personId, appState.businessPartners);
    const existing = bp.salesExtension?.nesyehSettings || bp.nesyehSettings || {
      creditLimit: rules.maxCreditLimit,
      paymentTermDays: rules.defaultInstallmentDays,
      lateFeePercentage: rules.penaltyRatePerMonth,
      isPurchaseAllowed: true,
      contractNotes: ''
    };
    setNesyehFormData(existing);
  };

  // Save Nesyeh contract settings (Server-Authoritative)
  const handleSaveNesyehSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNesyehPartner) return;

    const personId = editingNesyehPartner.personId;
    if (!personId) {
      alert('❌ خطا: شناسه شخص نماینده برای ذخیره‌سازی در پایگاه‌داده یافت نشد.');
      return;
    }

    try {
      // 1. Update credit limit on person record in server database
      await PersonService.updatePerson(personId, {
        creditLimit: nesyehFormData.creditLimit,
        agencyCreditLimit: nesyehFormData.creditLimit,
      });

      // 2. Update sales agent contract details in person_agent_details table
      await PersonService.updateAgentDetails(personId, {
        payment_term_days: nesyehFormData.paymentTermDays,
        late_fee_percentage: nesyehFormData.lateFeePercentage,
        is_purchase_allowed: nesyehFormData.isPurchaseAllowed,
        contract_notes: nesyehFormData.contractNotes,
      });

      // 3. Hydrate/refresh agents from server to keep UI in sync with DB SSOT
      await fetchAgentsFromServer();

      if (onRefreshFinancials) {
        try {
          await onRefreshFinancials(true);
        } catch (hydrationErr) {
          console.error('Post-nesyeh hydration error:', hydrationErr);
        }
      }

      setEditingNesyehPartner(null);
      alert('✅ تنظیمات قرارداد نسیه نماینده فروش با موفقیت در پایگاه‌داده سرور ذخیره شد.');
    } catch (err: any) {
      const errorMsg = err?.message || (typeof err === 'string' ? err : 'خطای ناشناخته در برقراری ارتباط با سرور.');
      alert(`❌ خطا در ذخیره‌سازی تنظیمات در پایگاه‌داده سرور:\n${errorMsg}`);
    }
  };

  // Save Onboarding Modal (Server-Authoritative)
  const handleSaveOnboarding = async (updatedPartner: BusinessPartner, updatedPerson?: Person) => {
    const personToUpdate = updatedPerson || (effectivePersons ? effectivePersons.find(p => p && p.id === updatedPartner.personId) : undefined) || (appState.persons ? appState.persons.find(p => p && p.id === updatedPartner.personId) : undefined);
    
    if (!personToUpdate) {
      alert('خطا: رکورد هویتی شخص برای ذخیره‌سازی در سرور یافت نشد.');
      return;
    }

    const isSalesAgent = updatedPartner.agencyType === AgencyType.INSTALLMENT_ONLY || updatedPartner.agencyType === AgencyType.BOTH;
    const isCreditAgent = updatedPartner.agencyType === AgencyType.CREDIT_ONLY || updatedPartner.agencyType === AgencyType.BOTH;
    const mappedAgencyRole = (isSalesAgent && isCreditAgent) ? 'both' : (isCreditAgent ? 'credit' : 'sales');
    const partnerStatus = updatedPartner.status as string;
    const mappedAgencyStatus = (partnerStatus === 'inactive' || partnerStatus === 'blocked' || partnerStatus === 'suspended') ? 'suspended' : (partnerStatus === 'pending' ? 'pending' : 'active');
    const creditLimitVal = updatedPartner.profile?.creditLimit || updatedPartner.salesExtension?.nesyehSettings?.creditLimit || personToUpdate.creditLimit || 0;

    const personUpdatePayload: Partial<Person> = {
      name: updatedPerson?.name || personToUpdate.name,
      nationalId: updatedPerson?.nationalId !== undefined ? updatedPerson.nationalId : personToUpdate.nationalId,
      mobile: updatedPerson?.mobile !== undefined ? updatedPerson.mobile : personToUpdate.mobile,
      phone: updatedPerson?.phone !== undefined ? updatedPerson.phone : personToUpdate.phone,
      address: updatedPerson?.address !== undefined ? updatedPerson.address : personToUpdate.address,
      province: updatedPerson?.province !== undefined ? updatedPerson.province : personToUpdate.province,
      city: updatedPerson?.city !== undefined ? updatedPerson.city : personToUpdate.city,
      isAgent: true,
      agencyRole: mappedAgencyRole,
      agencyStatus: mappedAgencyStatus,
      agencyCreditLimit: creditLimitVal,
      creditLimit: creditLimitVal,
      isDocumentsApproved: true,
      role: (isSalesAgent && isCreditAgent) ? 'both' : (isCreditAgent ? 'creditor' : 'debtor')
    };

    const storeNameVal = updatedPartner.profile?.storeName || personToUpdate.agentDetails?.storeName || '';
    const storeAddressVal = updatedPerson?.address || personToUpdate.agentDetails?.storeAddress || personToUpdate.address || '';

    // Step 1: Update person on the server
    let savedPerson: Person;
    try {
      const accessToken = await getDefaultAuthSessionService().getAccessToken();
      const res = await PersonService.updatePerson(
        personToUpdate.id,
        personUpdatePayload,
        accessToken || undefined,
        (personToUpdate as any).version
      );

      if (!res || !res.id) {
        throw new Error('پاسخ معتبری از سرور برای به‌روزرسانی اطلاعات شخص دریافت نشد.');
      }
      savedPerson = res;
    } catch (personErr: any) {
      const errorMsg = personErr?.message || (typeof personErr === 'string' ? personErr : 'خطای نامشخص در ثبت اطلاعات شخص در سرور.');
      alert(`❌ خطا در ذخیره‌سازی اطلاعات هویتی شخص در سرور:\n${errorMsg}`);
      return;
    }

    // Step 2: Update agent store details on the server
    try {
      const accessToken = await getDefaultAuthSessionService().getAccessToken();
      await PersonService.updateAgentDetails(
        savedPerson.id,
        {
          store_name: storeNameVal,
          store_address: storeAddressVal,
        },
        accessToken || undefined
      );
    } catch (detailsErr: any) {
      const errorMsg = detailsErr?.message || (typeof detailsErr === 'string' ? detailsErr : 'خطای نامشخص در ذخیره مشخصات فروشگاه.');
      alert(`⚠️ اطلاعات هویتی شخص ذخیره شد، ولی خطا در ذخیره مشخصات فروشگاه در سرور:\n${errorMsg}`);
      return;
    }

    // Step 3: Refresh agents list from server (server-authoritative)
    await fetchAgentsFromServer();

    if (onRefreshFinancials) {
      try {
        await onRefreshFinancials(true);
      } catch (hydrationErr) {
        console.error('Post-onboarding hydration failed:', hydrationErr);
      }
    }

    setOnboardingData(null);
    if (savedPerson.generatedPassword) {
      setNewlyCreatedAgentCredentials({
        name: savedPerson.name,
        loginIdentifier: savedPerson.loginIdentifier || savedPerson.mobile || '',
        password: savedPerson.generatedPassword,
      });
    } else {
      alert(`✅ اطلاعات هویتی و فروشگاهی نماینده «${savedPerson.name}» با موفقیت در پایگاه‌داده سرور ثبت و ذخیره شد.`);
    }
  };

  // Agent Password Reset States & Handler
  const [showResetConfirmModal, setShowResetConfirmModal] = useState<Person | null>(null);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  const handleResetAgentPassword = async (agent: Person) => {
    setIsResettingPassword(true);
    try {
      const accessToken = await getDefaultAuthSessionService().getAccessToken();
      const res = await PersonService.resetAgentPassword(agent.id, accessToken || undefined);
      if (res.generatedPassword) {
        setNewlyCreatedAgentCredentials({
          name: res.name || agent.name,
          loginIdentifier: res.loginIdentifier || agent.mobile || '',
          password: res.generatedPassword,
        });
      }
      setShowResetConfirmModal(null);
    } catch (err: any) {
      const errorMsg = err?.message || (typeof err === 'string' ? err : 'خطای نامشخص در تولید رمز عبور جدید.');
      alert(`❌ خطا در تولید رمز عبور جدید برای نماینده:\n${errorMsg}`);
    } finally {
      setIsResettingPassword(false);
    }
  };

  // Beta Calculator Management State
  const [showBetaCalcModal, setShowBetaCalcModal] = useState(false);
  const [newBetaCalcName, setNewBetaCalcName] = useState('');
  const [newBetaBankName, setNewBetaBankName] = useState('');
  const [newBetaAgentBankId, setNewBetaAgentBankId] = useState('');
  const [editingBetaCalcId, setEditingBetaCalcId] = useState<string | null>(null);
  const [editBetaBankName, setEditBetaBankName] = useState('');
  const [editBetaAgentBankId, setEditBetaAgentBankId] = useState('');


  // Custom confirmation modal state for role revocation
  const [roleRevocationAgentId, setRoleRevocationAgentId] = useState<string | null>(null);
  const [roleRevocationError, setRoleRevocationError] = useState<string | null>(null);
  const [roleRevocationSuccess, setRoleRevocationSuccess] = useState<string | null>(null);

  // Agent Addition Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedPersonForAgency, setSelectedPersonForAgency] = useState<Person | null>(null);
  const [personSearchQuery, setPersonSearchQuery] = useState('');
  const [agencyTypeChoice, setAgencyTypeChoice] = useState<'sales_rep' | 'credit_rep' | 'both'>('credit_rep');
  const [agencyStatusChoice, setAgencyStatusChoice] = useState<'active' | 'inactive' | 'pending' | 'blocked'>('pending');
  const [newAgencyCommission, setNewAgencyCommission] = useState<number>(5);
  const [newAgencyCreditLimit, setNewAgencyCreditLimit] = useState<number>(500000000);
  const [newAgencyStoreName, setNewAgencyStoreName] = useState('');
  const [newAgencyStoreAddress, setNewAgencyStoreAddress] = useState('');

  // Wallet Charge Form State (Per-Agent inside list)
  const [chargeAmount, setChargeAmount] = useState<number>(0);
  const [chargeAccount, setChargeAccount] = useState<string>('SUB_BANK_MELI');
  const [chargeDesc, setChargeDesc] = useState<string>('');

  // Approval Form
  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null);
  const [commissionAmount, setCommissionAmount] = useState<number>(0);
  const [netAmount, setNetAmount] = useState<number>(0);

  // Credit File States
  const [inquiryNationalId, setInquiryNationalId] = useState('');
  const [customerStatus, setCustomerStatus] = useState<'new' | 'existing_no_debt' | 'existing_with_debt' | null>(null);
  const [foundCustomer, setFoundCustomer] = useState<Person | null>(null);
  const [showRegisterForm, setShowRegisterForm] = useState(false);

  // Edit fields for active expanded partner
  const [editWholesale, setEditWholesale] = useState(false);
  const [editInstallment, setEditInstallment] = useState(false);
  const [editDocsApproved, setEditDocsApproved] = useState(false);
  const [editCreditLimit, setEditCreditLimit] = useState(0);
  const [editDelayDays, setEditDelayDays] = useState(30);
  const [editPenaltyRate, setEditPenaltyRate] = useState(0.1);
  const [editCommissionRate, setEditCommissionRate] = useState(2);
  const [editRiskLevel, setEditRiskLevel] = useState<'low' | 'medium' | 'high'>('low');
  const [editCalculators, setEditCalculators] = useState<string[]>([]);
  const [editFeatureToggles, setEditFeatureToggles] = useState<AgentFeatureToggles>(defaultFeatureToggles);
  const [editPortalLinks, setEditPortalLinks] = useState<AgentPortalLink[]>([]);
  const [newPortalLinkDesc, setNewPortalLinkDesc] = useState('');

  // Credit Agent Extension Edit States
  const [editMaxPerDossierLimit, setEditMaxPerDossierLimit] = useState<number>(100000000);
  const [editAllowedTenors, setEditAllowedTenors] = useState<number[]>([6, 12, 18, 24]);
  const [editCreditRequiredDocs, setEditCreditRequiredDocs] = useState<string[]>(['کارت ملی', 'شناسنامه', 'چک صیادی بنام']);
  const [editCreditPlans, setEditCreditPlans] = useState<string[]>([]);
  const [editCanCreateDossier, setEditCanCreateDossier] = useState<boolean>(true);
  const [editCanSubmitCreditRequest, setEditCanSubmitCreditRequest] = useState<boolean>(true);
  const [editCanViewCustomerCreditHistory, setEditCanViewCustomerCreditHistory] = useState<boolean>(true);

  // Sales Agent Extension Edit States
  const [editNesyehPurchaseLimit, setEditNesyehPurchaseLimit] = useState<number>(500000000);
  const [editSpecialDiscountRate, setEditSpecialDiscountRate] = useState<number>(0);
  const [editBlockOnOverdue, setEditBlockOnOverdue] = useState<boolean>(true);
  const [editCanPlaceOrders, setEditCanPlaceOrders] = useState<boolean>(true);
  const [editCanSubmitPurchaseRequest, setEditCanSubmitPurchaseRequest] = useState<boolean>(true);
  const [editCanViewPersonalLedger, setEditCanViewPersonalLedger] = useState<boolean>(true);
  const [editAllowedCategories, setEditAllowedCategories] = useState<string[]>([]);
  const [editRequiredAgencyDocs, setEditRequiredAgencyDocs] = useState<string[]>(['جواز کسب معتبر', 'چک ضمانت نمایندگی']);
  const [editAllowedDepositAccounts, setEditAllowedDepositAccounts] = useState<string[]>(['SUB_BANK_MELI', 'SUB_CASH_MAIN']);

  // Selected Command Center Role Mode
  const [commandCenterRoleMode, setCommandCenterRoleMode] = useState<'credit' | 'sales'>('credit');

  // Diagnostic log for troubleshooting agency creation on mobile/screen
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);
  const [isSubmittingAgency, setIsSubmittingAgency] = useState<boolean>(false);

  // Server-authoritative Persons state
  const [serverPersons, setServerPersons] = useState<Person[]>(() => appState.persons || []);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);

  const fetchAgentsFromServer = useCallback(async () => {
    try {
      setIsLoadingAgents(true);
      const fetched = await PersonService.getPersons();
      if (Array.isArray(fetched)) {
        setServerPersons(fetched);
      }
    } catch (err) {
      console.error('Failed to fetch agents from server:', err);
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    fetchAgentsFromServer();
  }, [fetchAgentsFromServer]);

  // Sync if appState.persons changes and serverPersons is empty
  useEffect(() => {
    if (appState.persons && appState.persons.length > 0 && serverPersons.length === 0) {
      setServerPersons(appState.persons);
    }
  }, [appState.persons, serverPersons.length]);

  const effectivePersons = useMemo(() => {
    return serverPersons.length > 0 ? serverPersons : (appState.persons || []);
  }, [serverPersons, appState.persons]);

  const agents = useMemo(() => {
    return effectivePersons.filter(p => {
      const isCreditRole = Boolean(p.isAgent && (p.agencyRole === 'credit' || p.agencyRole === 'both'));
      const isSalesRole = Boolean(p.isAgent && (p.agencyRole === 'sales' || p.agencyRole === 'both'));

      if (activeUnit === 'credit_agents') {
        return isCreditRole;
      }

      if (activeUnit === 'sales_agents') {
        return isSalesRole;
      }

      return isCreditRole || isSalesRole;
    });
  }, [effectivePersons, activeUnit]);

  const { creditAgentsCount, salesAgentsCount } = useMemo(() => {
    let credit = 0;
    let sales = 0;

    for (const p of effectivePersons) {
      const isCreditAgent = Boolean(p.isAgent && (p.agencyRole === 'credit' || p.agencyRole === 'both'));
      const isSalesAgent = Boolean(p.isAgent && (p.agencyRole === 'sales' || p.agencyRole === 'both'));

      if (isCreditAgent) credit++;
      if (isSalesAgent) sales++;
    }

    return { creditAgentsCount: credit, salesAgentsCount: sales };
  }, [effectivePersons]);
  const pendingChecks = appState.checks.filter(c => c.isApproved === false);

  const resetAgentForm = () => {
    setSelectedPersonForAgency(null);
    setPersonSearchQuery('');
    setAgencyTypeChoice('credit_rep');
    setAgencyStatusChoice('pending');
    setNewAgencyCommission(5);
    setNewAgencyCreditLimit(500000000);
    setNewAgencyStoreName('');
    setNewAgencyStoreAddress('');
    setShowAddForm(false);
  };

  const handleInquiry = () => {
    if (!inquiryNationalId) return;
    const searchId = normalizeDigits(inquiryNationalId);
    if (!searchId) return;
    
    const found = appState.persons.find(p => normalizeDigits(p.nationalId || '') === searchId);
    setFoundCustomer(found || null);
    
    if (!found) {
      setCustomerStatus('new');
    } else {
      // Perform full high-speed check on all tables
      const hasActiveBook = (appState.installmentBooks || []).some(
        b => b.personId === found.id && b.status === 'active'
      );
      
      const hasActiveInstallmentReq = (appState.installmentRequests || []).some(
        r => r.personId === found.id && r.status !== 'rejected' && r.status !== 'canceled'
      );
      
      const hasActivePartnerCreditReq = (appState.partnerCreditRequests || []).some(
        r => r.customerPersonId === found.id && r.status !== PartnerCreditRequestStatus.REJECTED && r.status !== PartnerCreditRequestStatus.CANCELLED
      );
      
      const hasOpenChecks = (appState.checks || []).some(
        c => c.personId === found.id && !c.isAmani && c.currentState !== 'cleared' && c.currentState !== 'CANCELLED' as any
      );
      
      const hasUnpaidInvoice = (appState.invoices || []).some(
        inv => inv.personId === found.id && inv.type === 'sell' && !inv.isProInvoice && (inv.totalAmount - (inv.paidAmount || 0) > 0)
      );
      
      const personBals = calculatePersonBalances(appState.vouchers, found.id, ['SUB_DEBTORS', 'SUB_DEBTORS_INSTALLMENT']);
      const hasDebtorBalance = Object.values(personBals).some(b => b.net > 0 && b.nature === 'بدهکار');
      
      const hasDebtOrOpenAccount = hasActiveBook || hasActiveInstallmentReq || hasActivePartnerCreditReq || hasOpenChecks || hasUnpaidInvoice || hasDebtorBalance;
      
      setCustomerStatus(hasDebtOrOpenAccount ? 'existing_with_debt' : 'existing_no_debt');
    }
  };

  const handleCreateAgency = async () => {
    if (!selectedPersonForAgency) {
      alert('لطفاً یک شخص را از لیست انتخاب کنید.');
      return;
    }

    setIsSubmittingAgency(true);
    const logEntries: string[] = [];
    const addLog = (msg: string) => {
      console.log(`[AgencyDiagnostic] ${msg}`);
      logEntries.push(`[${new Date().toLocaleTimeString('fa-IR')}] ${msg}`);
      setDiagnosticLogs([...logEntries]);
    };

    addLog(`شروع فرآیند ایجاد نمایندگی برای: ${selectedPersonForAgency.name} (id: ${selectedPersonForAgency.id})`);

    const mappedAgencyRole = agencyTypeChoice === 'both' ? 'both' : (agencyTypeChoice === 'credit_rep' ? 'credit' : 'sales');
    const mappedAgencyStatus = agencyStatusChoice === 'blocked' ? 'suspended' : agencyStatusChoice;

    const personUpdatePayload: Partial<Person> = {
      isAgent: true,
      agencyRole: mappedAgencyRole,
      agencyStatus: mappedAgencyStatus,
      agencyCreditLimit: newAgencyCreditLimit,
      creditLimit: newAgencyCreditLimit,
      isDocumentsApproved: agencyStatusChoice === 'active' ? true : (selectedPersonForAgency.isDocumentsApproved !== undefined ? selectedPersonForAgency.isDocumentsApproved : true),
    };

    let finalPerson: Person;

    // Step 1: Update person on the server (sets is_agent, agency_role, agency_status, agency_credit_limit)
    try {
      addLog(`در حال ارسال درخواست مرحله ۱ (PUT /api/persons/${selectedPersonForAgency.id})...`);
      const accessToken = await getDefaultAuthSessionService().getAccessToken();
      const savedPerson = await PersonService.updatePerson(
        selectedPersonForAgency.id,
        personUpdatePayload,
        accessToken || undefined,
        (selectedPersonForAgency as any).version
      );

      if (!savedPerson || !savedPerson.id) {
        throw new Error('پاسخ معتبری از سرور برای به‌روزرسانی اطلاعات شخص دریافت نشد.');
      }
      finalPerson = savedPerson;

      const step1Msg = `مرحله ۱ موفق. person_id: ${finalPerson.id} | is_agent برگشتی از سرور: ${String(finalPerson.isAgent)} | agency_role برگشتی: ${finalPerson.agencyRole || '-'} | agency_status: ${finalPerson.agencyStatus || '-'}`;
      addLog(step1Msg);

      if (savedPerson.generatedPassword) {
        setNewlyCreatedAgentCredentials({
          name: savedPerson.name,
          loginIdentifier: savedPerson.loginIdentifier || savedPerson.mobile || '',
          password: savedPerson.generatedPassword,
        });
      }
    } catch (personErr: any) {
      const errorMsg = personErr?.message || (typeof personErr === 'string' ? personErr : 'خطای نامشخص در ثبت اطلاعات شخص در سرور.');
      const fullError = `خطا در مرحله ۱ (PersonService.updatePerson): ${errorMsg}`;
      addLog(fullError);
      setIsSubmittingAgency(false);
      alert(`خطا در ذخیره‌سازی اطلاعات نماینده در سرور:\n${errorMsg}\n\nگزارش تشخیصی:\n${logEntries.join('\n')}`);
      return;
    }

    // Step 2: Update agent details (store_name, store_address) on the server
    try {
      addLog(`در حال ارسال درخواست مرحله ۲ (PUT /api/persons/${finalPerson.id}/agent-details) با store_address: "${newAgencyStoreAddress || ''}" و store_name: "${newAgencyStoreName || ''}"...`);
      const accessToken = await getDefaultAuthSessionService().getAccessToken();
      const detailsResult = await PersonService.updateAgentDetails(
        finalPerson.id,
        {
          store_name: newAgencyStoreName || '',
          store_address: newAgencyStoreAddress || '',
        },
        accessToken || undefined
      );

      const step2Msg = `مرحله ۲ موفق. store_address ذخیره‌شده: "${detailsResult.store_address || detailsResult.storeAddress || ''}" | store_name: "${detailsResult.store_name || detailsResult.storeName || ''}"`;
      addLog(step2Msg);
    } catch (detailsErr: any) {
      const errorMsg = detailsErr?.message || (typeof detailsErr === 'string' ? detailsErr : 'خطای نامشخص در ذخیره اطلاعات تکمیلی فروشگاه.');
      const fullError = `خطا در مرحله ۲ (PersonService.updateAgentDetails): ${errorMsg}`;
      addLog(fullError);
      setIsSubmittingAgency(false);
      alert(`مرحله ۱ با موفقیت انجام شد، اما خطا در مرحله ۲ (مشخصات فروشگاه):\n${errorMsg}\n\nگزارش تشخیصی:\n${logEntries.join('\n')}`);
      return;
    }

    // Step 3: Refresh agents list from server (server-authoritative)
    try {
      addLog('در حال واکشی مجدد اطلاعات نمایندگان از سرور...');
      await fetchAgentsFromServer();
      addLog('اطلاعات نمایندگان با موفقیت از سرور به‌روزرسانی شد.');
    } catch (fetchErr: any) {
      addLog(`هشدار در بازخوانی سرور: ${fetchErr?.message || fetchErr}`);
    }

    if (onRefreshFinancials) {
      try {
        await onRefreshFinancials(true);
      } catch (hydrationErr) {
        console.error('Post-agency creation hydration failed:', hydrationErr);
      }
    }

    setIsSubmittingAgency(false);
    resetAgentForm();
    
    const summaryMsg = `عملیات کامل شد:\n${logEntries.join('\n')}`;
    if (!finalPerson.generatedPassword) {
      alert(`پرونده نمایندگی با موفقیت ثبت شد.\n\n${summaryMsg}`);
    }
  };

  const handleApproveCheck = (checkId: string) => {
    if (commissionAmount + netAmount <= 0) {
      alert('لطفاً مبالغ را وارد کنید');
      return;
    }

    const checkIndex = appState.checks.findIndex(c => c.id === checkId);
    if (checkIndex === -1) return;
    
    const check = appState.checks[checkIndex];
    if (check.amount !== commissionAmount + netAmount) {
      alert('مجموع کارمزد و مبلغ خالص باید برابر با مبلغ کل چک باشد');
      return;
    }

    const agent = appState.persons.find(p => p.id === check.submittedByAgentId);
    const personName = agent?.name || 'ناشناس';

    const nextVoucherNo = getNextVoucherNumber(appState.vouchers);
    
    const voucher: JournalVoucher = {
      id: `v_${Date.now()}`,
      voucherNumber: nextVoucherNo,
      date: getCurrentJalaliDate(),
      gregorianDate: new Date().toISOString(),
      description: `تایید چک نماینده ${personName} - شماره ${check.checkNumber}`,
      isAutomatic: true,
      sourceType: 'manual',
      entries: [
        {
          subsidiaryId: 'SUB_CHECKS_REC',
          debit: check.amount,
          credit: 0,
          description: `دریافت چک بابت نماینده ${personName}`
        },
        {
          subsidiaryId: 'SUB_COMMISSION_REV',
          debit: 0,
          credit: commissionAmount,
          description: `کارمزد اعتباری چک ${check.checkNumber}`
        },
        {
          subsidiaryId: 'SUB_CREDITORS',
          floatingDetailed: agent ? { type: 'person', id: agent.id, name: agent.name } : undefined,
          debit: 0,
          credit: netAmount,
          description: `بستانکار بابت تایید چک`
        }
      ]
    };

    const updatedCheck: CheckTypeModel = {
      ...check,
      isApproved: true,
      history: [
        ...check.history,
        {
          state: 'present_in_cashbox',
          date: getCurrentJalaliDate(),
          voucherId: voucher.id,
          note: 'تایید توسط مدیریت'
        }
      ]
    };

    const newState = {
      ...appState,
      checks: appState.checks.map(c => c.id === checkId ? updatedCheck : c),
      vouchers: [...appState.vouchers, voucher]
    };

    onSave(newState);
    saveAppState(newState);
    
    setSelectedCheckId(null);
    setCommissionAmount(0);
    setNetAmount(0);
  };

  // Helper to dynamically calculate partner wallet balance from standard journal entries
  const getDeletionEligibility = (agentId: string) => {
    const reasons: string[] = [];
    if ((appState.invoices || []).some(inv => (inv as any).submittedByAgentId === agentId || (inv as any).agentId === agentId)) reasons.push('فاکتور فروش ثبت‌شده به عنوان نماینده');
    if ((((appState as any).creditFiles || []) as any[]).some(cf => cf.submittedByAgentId === agentId)) reasons.push('پرونده اعتباری ارسالی');
    if ((appState.vouchers || []).some(v => v.entries?.some(e => e.subsidiaryId === 'SUB_PARTNER_WALLET' && e.floatingDetailed?.id === agentId))) reasons.push('سند مالی کیف‌پول همکار');
    if ((appState.checks || []).some(c => (c as any).submittedByAgentId === agentId)) reasons.push('چک ارسالی نماینده');
    
    const bp = (appState.businessPartners || []).find(b => b.personId === agentId);
    if (bp) {
      if ((appState.partnerOrders || []).some(o => o.businessPartnerId === bp.id)) reasons.push('سفارش همکار');
      if ((appState.nesyehPurchaseOrders || []).some(o => o.partnerId === bp.id || o.partnerId === agentId)) reasons.push('سفارش خرید نسیه');
      if ((appState.partnerSettlements || []).some(s => s.businessPartnerId === bp.id)) reasons.push('تسویه حساب همکار');
      if ((appState.partnerCreditRequests || []).some(cr => cr.businessPartnerId === bp.id)) reasons.push('درخواست اعتبار همکار');
    }
    
    return { eligible: reasons.length === 0, reasons };
  };

  const handleDeleteAgent = (agentId: string) => {
    console.log('handleDeleteAgent called for:', agentId, 'currentUserRole:', currentUserRole);
    if (currentUserRole !== 'admin') {
      setRoleRevocationError('شما دسترسی لغو نقش همکار را ندارید.');
      return;
    }

    const person = effectivePersons.find(p => p.id === agentId);
    if (!person) {
      setRoleRevocationError('شخص مورد نظر یافت نشد.');
      return;
    }

    setRoleRevocationAgentId(agentId);
  };

  const executeRoleRevocation = async (agentId: string) => {
    const person = effectivePersons.find(p => p.id === agentId);
    if (!person) {
      setRoleRevocationError('شخص مورد نظر یافت نشد.');
      setRoleRevocationAgentId(null);
      return;
    }

    if (activeUnit === 'sales_agents') {
      const isSales = person.agencyRole === 'sales' || person.agencyRole === 'both';
      if (!isSales) {
        setRoleRevocationError('این شخص دارای نقش نماینده فروش نمی‌باشد.');
        setRoleRevocationAgentId(null);
        return;
      }

      const newAgencyRole = person.agencyRole === 'both' ? 'credit' : null;
      const newIsAgent = newAgencyRole !== null;

      try {
        await PersonService.updatePerson(agentId, {
          isAgent: newIsAgent,
          agencyRole: newAgencyRole,
        });

        await fetchAgentsFromServer();
        setRoleRevocationSuccess('✅ نقش «نماینده فروش» با موفقیت لغو شد و پرونده شخص در سیستم حفظ گردید.');
      } catch (err: any) {
        console.error('Failed to revoke sales agent role:', err);
        setRoleRevocationError(err?.message || 'خطا در لغو نقش نماینده فروش در سرور.');
      } finally {
        setRoleRevocationAgentId(null);
      }
    } else if (activeUnit === 'credit_agents') {
      const isCredit = person.agencyRole === 'credit' || person.agencyRole === 'both';
      if (!isCredit) {
        setRoleRevocationError('این شخص دارای نقش نماینده اعتباری نمی‌باشد.');
        setRoleRevocationAgentId(null);
        return;
      }

      const newAgencyRole = person.agencyRole === 'both' ? 'sales' : null;
      const newIsAgent = newAgencyRole !== null;

      try {
        await PersonService.updatePerson(agentId, {
          isAgent: newIsAgent,
          agencyRole: newAgencyRole,
        });

        await fetchAgentsFromServer();
        setRoleRevocationSuccess('✅ نقش «نماینده اعتباری» با موفقیت لغو شد و پرونده شخص در سیستم حفظ گردید.');
      } catch (err: any) {
        console.error('Failed to revoke credit agent role:', err);
        setRoleRevocationError(err?.message || 'خطا در لغو نقش نماینده اعتباری در سرور.');
      } finally {
        setRoleRevocationAgentId(null);
      }
    }
  };

  // Helper to dynamically calculate partner wallet balance from standard journal entries
  const getPartnerWalletBalance = (partnerId: string): number => {
    let balance = 0;
    appState.vouchers.forEach(v => {
      v.entries.forEach(e => {
        if (e.subsidiaryId === 'SUB_PARTNER_WALLET' && e.floatingDetailed?.id === partnerId) {
          // Credits increase liability/prepaid credit for them (Wallet is credited on charge)
          // Debits decrease the credit balance (Wallet is debited on purchases or penalty debits)
          balance += (e.credit || 0) - (e.debit || 0);
        }
      });
    });
    return balance;
  };

  // Fetch all transactions registered on Partner Wallet subsidiary for this partner
  const getWalletTransactions = (partnerId: string) => {
    const transactions: {
      id: string;
      date: string;
      voucherNumber: number;
      description: string;
      debit: number;
      credit: number;
    }[] = [];

    appState.vouchers.forEach(v => {
      v.entries.forEach((e, idx) => {
        if (e.subsidiaryId === 'SUB_PARTNER_WALLET' && e.floatingDetailed?.id === partnerId) {
          transactions.push({
            id: `${v.id}_${idx}`,
            date: v.date,
            voucherNumber: v.voucherNumber,
            description: e.description || v.description,
            debit: e.debit || 0,
            credit: e.credit || 0
          });
        }
      });
    });

    return transactions.sort((a, b) => b.voucherNumber - a.voucherNumber);
  };

  // Charge wallet credit and post a balanced double-entry voucher
  const handleChargeWallet = (partnerId: string) => {
    if (chargeAmount <= 0) {
      alert('لطفاً مبلغ شارژ معتبر وارد کنید.');
      return;
    }

    const partner = appState.persons.find(p => p.id === partnerId);
    if (!partner) return;

    if (!partner.isDocumentsApproved) {
      alert('امکان شارژ کیف پول همکار تا زمان تایید نهایی مدارک و تضامین وجود ندارد.');
      return;
    }

    const nextVoucherNo = appState.vouchers.length > 0 ? Math.max(...appState.vouchers.map(v => v.voucherNumber)) + 1 : 1;
    const descText = chargeDesc.trim() || `شارژ کیف پول همکار ${partner.name}`;

    const voucher: JournalVoucher = {
      id: `v_wallet_charge_${Date.now()}`,
      voucherNumber: nextVoucherNo,
      date: getCurrentJalaliDate(),
      gregorianDate: new Date().toISOString(),
      description: descText,
      isAutomatic: true,
      sourceType: 'manual',
      entries: [
        {
          subsidiaryId: chargeAccount, // Selected bank or cash
          debit: chargeAmount,
          credit: 0,
          description: `دریافت وجه بابت شارژ کیف پول همکار ${partner.name}`
        },
        {
          subsidiaryId: 'SUB_PARTNER_WALLET',
          floatingDetailed: { type: 'person', id: partner.id, name: partner.name },
          debit: 0,
          credit: chargeAmount,
          description: `افزایش اعتبار کیف پول همکار ${partner.name}`
        }
      ]
    };

    const updatedPersons = appState.persons.map(p => {
      if (p.id === partnerId) {
        return {
          ...p,
          walletBalance: (p.walletBalance || 0) + chargeAmount
        };
      }
      return p;
    });

    const newState = {
      ...appState,
      persons: updatedPersons,
      vouchers: [...appState.vouchers, voucher]
    };

    onSave(newState);
    saveAppState(newState);

    setChargeAmount(0);
    setChargeDesc('');
    alert(`کیف پول همکار ${partner.name} به مبلغ ${chargeAmount.toLocaleString()} ریال با موفقیت شارژ شد و سند شماره ${nextVoucherNo} صادر گردید.`);
  };

  // Penalty Calculation Engine for overdue invoices
  const getPartnerOverdueInvoices = (partnerId: string) => {
    const partner = appState.persons.find(p => p.id === partnerId);
    if (!partner) return [];

    const fallbackRules = resolvePartnerCreditRules(partner, appState.businessPartners);

    return appState.invoices.filter(invoice => {
      if (invoice.type !== 'sell' || invoice.personId !== partnerId || invoice.isProInvoice) return false;
      const unpaid = invoice.totalAmount - (invoice.paidAmount || 0);
      if (unpaid <= 0) return false;

      const allowedDays = invoice.creditRulesSnapshot?.defaultInstallmentDays ?? fallbackRules.defaultInstallmentDays;
      const elapsedDays = getDaysDifference(invoice.date);
      return elapsedDays > allowedDays;
    }).map(invoice => {
      const unpaid = invoice.totalAmount - (invoice.paidAmount || 0);
      const allowedDays = invoice.creditRulesSnapshot?.defaultInstallmentDays ?? fallbackRules.defaultInstallmentDays;
      const penaltyRate = invoice.creditRulesSnapshot?.penaltyRatePerMonth ?? fallbackRules.penaltyRatePerMonth;

      const elapsedDays = getDaysDifference(invoice.date);
      const overdueDays = elapsedDays - allowedDays;
      const calculatedPenalty = Math.round(unpaid * (penaltyRate / 100) * overdueDays);

      // Staged Warning SMS Levels
      let alertStage = 'مرحله ۱: پیامک دوستانه';
      let alertColor = 'text-blue-700 bg-blue-50 border-blue-200';
      if (overdueDays > 7 && overdueDays <= 15) {
        alertStage = 'مرحله ۲: پیامک هشدار جدی';
        alertColor = 'text-amber-700 bg-amber-50 border-amber-200';
      } else if (overdueDays > 15) {
        alertStage = 'مرحله ۳: اخطار قانونی رسمی';
        alertColor = 'text-rose-700 bg-rose-50 border-rose-200';
      }

      return {
        ...invoice,
        unpaid,
        elapsedDays,
        overdueDays,
        calculatedPenalty,
        alertStage,
        alertColor
      };
    });
  };

  // Register penalty and issue integrated voucher
  const handleApplyPenalty = (partnerId: string, invoiceId: string, penaltyAmount: number, invoiceNum: number) => {
    if (penaltyAmount <= 0) return;

    const partner = appState.persons.find(p => p.id === partnerId);
    if (!partner) return;

    const todayJalali = getCurrentJalaliDate();
    const voucherId = `v_penalty_${invoiceId}_${todayJalali.replace(/\//g, '_')}`;

    // Check idempotency - prevent duplicate voucher for this invoice on the same date
    const voucherExists = (appState.vouchers || []).some(
      v => v.id === voucherId || v.sourceId === `PEN_${invoiceId}_${todayJalali}`
    );
    if (voucherExists) {
      alert(`خطا: سند حسابداری جریمه برای فاکتور شماره ${invoiceNum} در تاریخ امروز (${todayJalali}) قبلاً ثبت شده است.`);
      return;
    }

    const nextVoucherNo = appState.vouchers.length > 0 ? Math.max(...appState.vouchers.map(v => v.voucherNumber)) + 1 : 1;
    const descText = `ثبت جریمه دیرکرد فاکتور فروش ${invoiceNum} - همکار ${partner.name}`;

    const voucher: JournalVoucher = {
      id: voucherId,
      voucherNumber: nextVoucherNo,
      date: todayJalali,
      gregorianDate: new Date().toISOString(),
      description: descText,
      isAutomatic: true,
      sourceType: 'manual',
      sourceId: `PEN_${invoiceId}_${todayJalali}`,
      status: 'active',
      entries: [
        {
          subsidiaryId: 'SUB_DEBTORS', // بدهکاران تجاری - حساب جاری نماینده
          floatingDetailed: { type: 'person', id: partner.id, name: partner.name },
          debit: penaltyAmount,
          credit: 0,
          description: `بدهکار بابت جریمه دیرکرد فاکتور شماره ${invoiceNum}`
        },
        {
          subsidiaryId: 'SUB_OTHER_REVENUE', // درآمد کارمزد جریمه دیرکرد
          debit: 0,
          credit: penaltyAmount,
          description: `بستانکار بابت درآمد کارمزد جریمه دیرکرد فاکتور ${invoiceNum}`
        }
      ]
    };

    // Update state safely without mutating totalAmount or walletBalance
    const updatedInvoices = appState.invoices.map(inv => {
      if (inv.id === invoiceId) {
        return {
          ...inv,
          delayPenaltyAmount: (inv.delayPenaltyAmount || 0) + penaltyAmount
          // Note: totalAmount is deliberately NOT modified to avoid compound penalties
        };
      }
      return inv;
    });

    const newState = {
      ...appState,
      invoices: updatedInvoices,
      vouchers: [...appState.vouchers, voucher]
    };

    onSave(newState);
    saveAppState(newState);
    alert(`جریمه دیرکرد به مبلغ ${penaltyAmount.toLocaleString()} ریال با موفقیت ثبت و سند حسابداری شماره ${nextVoucherNo} صادر گردید.`);
  };

  // Save modified partner parameters (Limit, Toggles, Overdue terms)
  const savePartnerSettings = (partnerId: string) => {
    if (!hasUnsavedChanges()) {
      alert('تغییری برای ذخیره وجود ندارد.');
      setIsEditingSettings(false);
      return;
    }

    const currentAgent = appState.persons.find(p => p.id === partnerId);
    if (!currentAgent) {
      alert('❌ خطا در ذخیره تنظیمات: همکار مورد نظر در سیستم پیدا نشد.');
      return;
    }

    // 1. Validation of required inputs & numeric fields
    if (editCreditLimit === undefined || editCreditLimit === null || isNaN(editCreditLimit) || editCreditLimit < 0) {
      alert('❌ خطا در ذخیره تنظیمات: فیلد اجباری سقف اعتبار خرید تکمیل نشده یا مقدار واردشده معتبر نیست.');
      return;
    }

    if (editDelayDays === undefined || editDelayDays === null || isNaN(editDelayDays) || editDelayDays < 0) {
      alert('❌ خطا در ذخیره تنظیمات: فیلد اجباری مهلت پرداخت نسیه تکمیل نشده یا مقدار واردشده معتبر نیست.');
      return;
    }

    if (editPenaltyRate === undefined || editPenaltyRate === null || isNaN(editPenaltyRate) || editPenaltyRate < 0) {
      alert('❌ خطا در ذخیره تنظیمات: فیلد اجباری نرخ جریمه دیرکرد تکمیل نشده یا مقدار واردشده معتبر نیست.');
      return;
    }

    // 2. Validation of selected calculators
    const selectedBetaCalcs = editCalculators.filter(id => {
      const c = appState.calculators?.find(x => x.id === id);
      return c ? (c.type === 'beta' || (c.name || '').includes('بتا') || (c.id || '').toLowerCase().includes('beta')) : false;
    });

    if (selectedBetaCalcs.length > 1) {
      alert('❌ خطا در ذخیره تنظیمات: چند ماشین‌حساب بتا همزمان انتخاب شده است. هر همکار تنها می‌تواند یک ماشین‌حساب بتای فعال داشته باشد.');
      return;
    }

    if (editInstallment && editCalculators.length === 0) {
      alert('❌ خطا در ذخیره تنظیمات: هیچ ماشین‌حسابی انتخاب نشده است. با توجه به فعال بودن امکان فروش اقساطی برای این همکار، انتخاب حداقل یک ماشین‌حساب الزامی است.');
      return;
    }

    const wasApproved = currentAgent?.isDocumentsApproved || false;
    const isNowApproved = editDocsApproved;

    const engine = DataIntegrityEngine.getInstance();
    
    // 1. Update Person (identity details only)
    const personUpdates = {
      isOfflineWholesaleEnabled: editWholesale,
      isInstallmentEnabled: editInstallment,
      isDocumentsApproved: editDocsApproved
    };
    
    const personResult = engine.updatePerson(partnerId, personUpdates, appState as any);
    if (!personResult.success) {
      alert(`خطا در ویرایش اطلاعات شخص:\n${personResult.errors?.join('\n')}`);
      return;
    }

    let finalState = personResult.updatedState;
    const partnerIndex = appState.businessPartners.findIndex(bp => bp.personId === partnerId);
    
    if (partnerIndex !== -1) {
      const partner = appState.businessPartners[partnerIndex];
      const user = appState.users.find(u => u.name === currentAgent?.name || u.personId === partnerId);
      let updatedUsers = [...(partner.users || [])];
      if (user && !updatedUsers.includes(user.id)) {
        updatedUsers.push(user.id);
      }
      
      const partnerUpdates = {
        agencyType: partner.agencyType || AgencyType.BOTH,
        roles: partner.roles && partner.roles.length > 0 ? partner.roles : [PartnerRole.CREDIT_SALES_AGENT, 'CREDIT_AGENT' as any],
        status: isNowApproved ? 'active' : 'pending',
        users: updatedUsers,
        profile: {
          ...partner.profile,
          contractStatus: isNowApproved ? 'فعال' : 'در انتظار بررسی مدارک',
          creditLimit: editCreditLimit,
          riskLevel: editRiskLevel as any
        },
        allowedCalculatorIds: editCalculators,
        creditExtension: {
          ...recordPartnerCreditRulesChange(
            partner,
            {
              ...(partner.creditExtension?.creditRules || {}),
              maxCreditLimit: editCreditLimit,
              maxPerDossierLimit: editMaxPerDossierLimit,
              defaultInstallmentDays: editDelayDays,
              penaltyRatePerMonth: editPenaltyRate,
              commissionRate: editCommissionRate,
              requiredDocuments: editCreditRequiredDocs,
              allowedTenors: editAllowedTenors
            },
            { changeReason: 'ویرایش اطلاعات و قوانین اعتباری همکار' }
          ),
          creditPlans: editCreditPlans,
          canCreateDossier: editCanCreateDossier,
          canSubmitCreditRequest: editCanSubmitCreditRequest,
          canViewCustomerCreditHistory: editCanViewCustomerCreditHistory,
          allowedCalculators: editCalculators
        },
        salesExtension: {
          ...partner.salesExtension,
          salesRules: {
            ...(partner.salesExtension?.salesRules || {}),
            nesyehPurchaseLimit: editNesyehPurchaseLimit,
            specialDiscountRate: editSpecialDiscountRate,
            allowedCategories: editAllowedCategories,
            requiredAgencyDocs: editRequiredAgencyDocs,
            allowedDepositAccountIds: editAllowedDepositAccounts
          },
          salesControls: {
            ...(partner.salesExtension?.salesControls || {}),
            canPlaceOrders: editCanPlaceOrders,
            blockOnOverdue: editBlockOnOverdue,
            canViewPersonalLedger: editCanViewPersonalLedger,
            canSubmitPurchaseRequest: editCanSubmitPurchaseRequest
          }
        },
        contract: partner.contract ? {
          ...partner.contract,
          creditLimit: editCreditLimit,
          commissionRate: editCommissionRate,
          status: isNowApproved ? 'active' : 'suspended'
        } : undefined,
        featureToggles: {
          ...editFeatureToggles,
          allowDossierCreation: editCanCreateDossier,
          allowCreditRequest: editCanSubmitCreditRequest,
          allowViewHistory: editCanViewCustomerCreditHistory,
          submitRequests: editCanSubmitPurchaseRequest,
          viewLedger: editCanViewPersonalLedger
        },
        portalLinks: editPortalLinks
      };
      
      const partnerResult = engine.updateBusinessPartner(partner.id, partnerUpdates as any, finalState);
      if (!partnerResult.success) {
        alert(`خطا در ویرایش اطلاعات همکار تجاری:\n${partnerResult.errors?.join('\n')}`);
        return;
      }
      finalState = partnerResult.updatedState;
    } else {
      const user = appState.users.find(u => u.name === currentAgent?.name || u.personId === partnerId);
      const newBpId = `BP_${Date.now()}`;
      const newPartner = {
        id: newBpId,
        personId: partnerId,
        status: isNowApproved ? ('active' as const) : ('pending' as const),
        agencyType: 'CREDIT_ONLY' as any,
        roles: ['CREDIT_SALES_AGENT' as any],
        profile: {
          partnerId: newBpId,
          contractStatus: isNowApproved ? 'فعال' : 'در انتظار بررسی مدارک',
          riskLevel: editRiskLevel as any,
          creditLimit: editCreditLimit,
        },
        allowedCalculatorIds: editCalculators,
        creditExtension: {
          ...recordPartnerCreditRulesChange(
            { id: newBpId },
            {
              maxCreditLimit: editCreditLimit,
              maxPerDossierLimit: editMaxPerDossierLimit,
              defaultInstallmentDays: editDelayDays,
              penaltyRatePerMonth: editPenaltyRate,
              commissionRate: editCommissionRate,
              requiredDocuments: editCreditRequiredDocs,
              allowedTenors: editAllowedTenors
            },
            { changeReason: 'ثبت پرونده اعتباری همکار جدید' }
          ),
          creditPlans: editCreditPlans,
          canCreateDossier: editCanCreateDossier,
          canSubmitCreditRequest: editCanSubmitCreditRequest,
          canViewCustomerCreditHistory: editCanViewCustomerCreditHistory,
          allowedCalculators: editCalculators
        },
        salesExtension: {
          salesRules: {
            nesyehPurchaseLimit: editNesyehPurchaseLimit,
            specialDiscountRate: editSpecialDiscountRate,
            allowedCategories: editAllowedCategories,
            requiredAgencyDocs: editRequiredAgencyDocs,
            allowedDepositAccountIds: editAllowedDepositAccounts
          },
          salesControls: {
            canPlaceOrders: editCanPlaceOrders,
            blockOnOverdue: editBlockOnOverdue,
            canViewPersonalLedger: editCanViewPersonalLedger,
            canSubmitPurchaseRequest: editCanSubmitPurchaseRequest
          }
        },
        branches: [
          {
            id: `BR_${Date.now()}`,
            partnerId: newBpId,
            name: 'شعبه مرکزی',
            address: currentAgent?.agentDetails?.storeAddress || '',
            phone: currentAgent?.mobile || '',
            managerName: currentAgent?.name || '',
            isActive: true,
            createdAt: new Date().toISOString()
          }
        ],
        contract: {
          id: `CON_${Date.now()}`,
          partnerId: newBpId,
          type: 'CREDIT_AGENT' as any,
          startDate: getCurrentJalaliDate(),
          status: isNowApproved ? ('active' as const) : ('suspended' as const),
          creditLimit: editCreditLimit,
          hasRepresentativeGuarantee: true,
          commissionRate: editCommissionRate,
          createdAt: new Date().toISOString()
        },
        users: user ? [user.id] : [],
        createdAt: new Date().toISOString(),
        createdBy: currentUserId || 'system',
        featureToggles: editFeatureToggles,
        portalLinks: editPortalLinks
      };
      
      const partnerResult = engine.createBusinessPartner(newPartner, finalState);
      if (!partnerResult.success) {
        alert(`خطا در ایجاد همکار تجاری:\n${partnerResult.errors?.join('\n')}`);
        return;
      }
      finalState = partnerResult.updatedState;
    }

    onSave(finalState as any);
    saveAppState(finalState as any);
    setIsEditingSettings(false);
    setInitialEditState({
      editWholesale,
      editInstallment,
      editDocsApproved,
      editCreditLimit,
      editDelayDays,
      editPenaltyRate,
      editCommissionRate,
      editRiskLevel,
      editCalculators,
      editFeatureToggles,
      editPortalLinks,
      editMaxPerDossierLimit,
      editAllowedTenors,
      editCreditRequiredDocs,
      editCreditPlans,
      editCanCreateDossier,
      editCanSubmitCreditRequest,
      editCanViewCustomerCreditHistory,
      editNesyehPurchaseLimit,
      editSpecialDiscountRate,
      editBlockOnOverdue,
      editCanPlaceOrders,
      editCanSubmitPurchaseRequest,
      editCanViewPersonalLedger,
      editAllowedCategories,
      editRequiredAgencyDocs,
      editAllowedDepositAccounts
    });
    alert('✅ تنظیمات اعتباری و دسترسی همکار با موفقیت ذخیره گردید.');
  };

  const hasUnsavedChanges = () => {
    if (!initialEditState) {
      console.warn("[SAVE SYSTEM] hasUnsavedChanges: initialEditState is null");
      return false;
    }
    const changes = {
      editWholesale: editWholesale !== initialEditState.editWholesale,
      editInstallment: editInstallment !== initialEditState.editInstallment,
      editDocsApproved: editDocsApproved !== initialEditState.editDocsApproved,
      editCreditLimit: editCreditLimit !== initialEditState.editCreditLimit,
      editDelayDays: editDelayDays !== initialEditState.editDelayDays,
      editPenaltyRate: editPenaltyRate !== initialEditState.editPenaltyRate,
      editCommissionRate: editCommissionRate !== initialEditState.editCommissionRate,
      editRiskLevel: editRiskLevel !== initialEditState.editRiskLevel,
      editMaxPerDossierLimit: editMaxPerDossierLimit !== initialEditState.editMaxPerDossierLimit,
      editCanCreateDossier: editCanCreateDossier !== initialEditState.editCanCreateDossier,
      editCanSubmitCreditRequest: editCanSubmitCreditRequest !== initialEditState.editCanSubmitCreditRequest,
      editCanViewCustomerCreditHistory: editCanViewCustomerCreditHistory !== initialEditState.editCanViewCustomerCreditHistory,
      editNesyehPurchaseLimit: editNesyehPurchaseLimit !== initialEditState.editNesyehPurchaseLimit,
      editSpecialDiscountRate: editSpecialDiscountRate !== initialEditState.editSpecialDiscountRate,
      editBlockOnOverdue: editBlockOnOverdue !== initialEditState.editBlockOnOverdue,
      editCanPlaceOrders: editCanPlaceOrders !== initialEditState.editCanPlaceOrders,
      editCanSubmitPurchaseRequest: editCanSubmitPurchaseRequest !== initialEditState.editCanSubmitPurchaseRequest,
      editCanViewPersonalLedger: editCanViewPersonalLedger !== initialEditState.editCanViewPersonalLedger,
      editCalculators: JSON.stringify(editCalculators) !== JSON.stringify(initialEditState.editCalculators),
      editFeatureToggles: JSON.stringify(editFeatureToggles) !== JSON.stringify(initialEditState.editFeatureToggles),
      editPortalLinks: JSON.stringify(editPortalLinks) !== JSON.stringify(initialEditState.editPortalLinks),
      editAllowedTenors: JSON.stringify(editAllowedTenors) !== JSON.stringify(initialEditState.editAllowedTenors),
      editCreditRequiredDocs: JSON.stringify(editCreditRequiredDocs) !== JSON.stringify(initialEditState.editCreditRequiredDocs),
      editCreditPlans: JSON.stringify(editCreditPlans) !== JSON.stringify(initialEditState.editCreditPlans),
      editAllowedCategories: JSON.stringify(editAllowedCategories) !== JSON.stringify(initialEditState.editAllowedCategories),
      editRequiredAgencyDocs: JSON.stringify(editRequiredAgencyDocs) !== JSON.stringify(initialEditState.editRequiredAgencyDocs),
      editAllowedDepositAccounts: JSON.stringify(editAllowedDepositAccounts) !== JSON.stringify(initialEditState.editAllowedDepositAccounts),
    };

    const hasAnyChange = Object.values(changes).some(Boolean);
    if (hasAnyChange) {
      console.log("[SAVE SYSTEM] Unsaved changes detected:", Object.entries(changes).filter(([_, v]) => v).map(([k]) => k));
    }
    return hasAnyChange;
  };

  // Toggle open partner details row and populate edit states
  const toggleAgentDetails = (agent: Person, forceOpen?: boolean) => {
    if (expandedAgentId) {
      if (isEditingSettings && hasUnsavedChanges()) {
        const confirmClose = safeConfirm('تغییرات ذخیره نشده است. آیا قصد خروج بدون ذخیره را دارید؟');
        if (!confirmClose) return;
      }
    }

    if (expandedAgentId === agent.id && !forceOpen) {
      setExpandedAgentId(null);
      setIsEditingSettings(false);
      setInitialEditState(null);
    } else {
      setExpandedAgentId(agent.id);
      setIsEditingSettings(false);
      const isOfflineWholesaleEnabled = agent.isOfflineWholesaleEnabled !== false;
      const isInstallmentEnabled = agent.isInstallmentEnabled !== false;
      const bpForDocs = appState.businessPartners?.find(p => p.personId === agent.id || p.id === agent.id);
      const isDocsApproved = agent.isDocumentsApproved !== undefined 
        ? agent.isDocumentsApproved 
        : (bpForDocs ? (bpForDocs.status === 'active' || bpForDocs.profile?.contractStatus === 'فعال' || bpForDocs.profile?.contractStatus === 'تایید شده و فعال') : true);
      
      setEditWholesale(isOfflineWholesaleEnabled);
      setEditInstallment(isInstallmentEnabled);
      setEditDocsApproved(isDocsApproved);
      
      const rules = resolvePartnerCreditRules(agent, appState.businessPartners);
      const bp = appState.businessPartners?.find(p => p.personId === agent.id);
      
      setEditCreditLimit(rules.maxCreditLimit);
      setEditDelayDays(rules.defaultInstallmentDays);
      setEditPenaltyRate(rules.penaltyRatePerMonth);
      
      const loadedCommissionRate = bp?.contract?.commissionRate || 2;
      setEditCommissionRate(loadedCommissionRate);
      
      const rLevel = bp?.profile?.riskLevel || 'low';
      setEditRiskLevel(rLevel);
      const extCalcs = bp?.creditExtension?.allowedCalculators;
      const bpCalcs = bp?.allowedCalculatorIds;
      const rawCalcs = (extCalcs && extCalcs.length > 0)
        ? extCalcs
        : (bpCalcs && bpCalcs.length > 0)
          ? bpCalcs
          : [];
      let betaFound = false;
      const sanitizedCalcs = rawCalcs.filter(id => {
        const c = appState.calculators?.find(x => x.id === id);
        const isB = c ? (c.type === 'beta' || (c.name || '').includes('بتا') || (c.id || '').toLowerCase().includes('beta')) : false;
        if (isB) {
          if (betaFound) return false;
          betaFound = true;
        }
        return true;
      });
      setEditCalculators(sanitizedCalcs);

      const loadedToggles = bp?.featureToggles || { ...defaultFeatureToggles };
      let loadedLinks = bp?.portalLinks || [];
      if (loadedLinks.length === 0 && agent && agent.id) {
        const initialLinkId = "LNK_" + Date.now();
        const roleParamStr = commandCenterRoleMode === "credit" ? "&role=credit" : "&role=sales";
        const baseUrl = import.meta.env.VITE_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
        const initialUrl = `${baseUrl}/?agent_token=${agent.id}&link_id=${initialLinkId}${roleParamStr}&name=${encodeURIComponent(agent.name || "")}`;
        loadedLinks = [{
          id: initialLinkId,
          url: initialUrl,
          createdAt: getCurrentJalaliDate(),
          isActive: true,
          description: "لینک اختصاصی اولیه پرتال"
        }];
        if (bp) {
          bp.portalLinks = loadedLinks;
        }
      }
      
      setEditFeatureToggles(loadedToggles);
      setEditPortalLinks(loadedLinks);

      // Populate Credit Extension States
      const maxPerDossier = bp?.creditExtension?.creditRules?.maxPerDossierLimit || 100000000;
      const allowedTenors = bp?.creditExtension?.creditRules?.allowedTenors || [6, 12, 18, 24];
      const creditDocs = bp?.creditExtension?.creditRules?.requiredDocuments || ['کارت ملی', 'شناسنامه', 'چک صیادی بنام'];
      const creditPlans = bp?.creditExtension?.creditPlans || bp?.allowedSalesPlanIds || [];
      const canCreateDossier = bp?.creditExtension?.canCreateDossier ?? bp?.featureToggles?.allowDossierCreation ?? true;
      const canSubmitCreditReq = bp?.creditExtension?.canSubmitCreditRequest ?? bp?.featureToggles?.allowCreditRequest ?? true;
      const canViewCustomerHist = bp?.creditExtension?.canViewCustomerCreditHistory ?? bp?.featureToggles?.allowViewHistory ?? true;

      setEditMaxPerDossierLimit(maxPerDossier);
      setEditAllowedTenors(allowedTenors);
      setEditCreditRequiredDocs(creditDocs);
      setEditCreditPlans(creditPlans);
      setEditCanCreateDossier(canCreateDossier);
      setEditCanSubmitCreditRequest(canSubmitCreditReq);
      setEditCanViewCustomerCreditHistory(canViewCustomerHist);

      // Populate Sales Extension States
      const nesyehLimit = bp?.salesExtension?.salesRules?.nesyehPurchaseLimit || rules.maxCreditLimit || 500000000;
      const specDiscount = bp?.salesExtension?.salesRules?.specialDiscountRate || 0;
      const blockOverdue = bp?.salesExtension?.salesControls?.blockOnOverdue ?? true;
      const canPlaceOrders = bp?.salesExtension?.salesControls?.canPlaceOrders ?? true;
      const canSubmitPurchaseReq = bp?.salesExtension?.salesControls?.canSubmitPurchaseRequest ?? bp?.featureToggles?.submitRequests ?? true;
      const canViewPersonalLedger = bp?.salesExtension?.salesControls?.canViewPersonalLedger ?? bp?.featureToggles?.viewLedger ?? true;
      const allowedCats = bp?.salesExtension?.salesRules?.allowedCategories || appState.productCategories || [];
      const agencyDocs = bp?.salesExtension?.salesRules?.requiredAgencyDocs || ['جواز کسب معتبر', 'چک ضمانت نمایندگی'];
      const depositAccounts = bp?.salesExtension?.salesRules?.allowedDepositAccountIds || ['SUB_BANK_MELI', 'SUB_CASH_MAIN'];

      setEditNesyehPurchaseLimit(nesyehLimit);
      setEditSpecialDiscountRate(specDiscount);
      setEditBlockOnOverdue(blockOverdue);
      setEditCanPlaceOrders(canPlaceOrders);
      setEditCanSubmitPurchaseRequest(canSubmitPurchaseReq);
      setEditCanViewPersonalLedger(canViewPersonalLedger);
      setEditAllowedCategories(allowedCats);
      setEditRequiredAgencyDocs(agencyDocs);
      setEditAllowedDepositAccounts(depositAccounts);

      // Default role mode selection inside Command Center
      if (activeUnit === 'sales_agents') {
        setCommandCenterRoleMode('sales');
      } else {
        setCommandCenterRoleMode('credit');
      }

      setInitialEditState({
        editWholesale: isOfflineWholesaleEnabled,
        editInstallment: isInstallmentEnabled,
        editDocsApproved: isDocsApproved,
        editCreditLimit: rules.maxCreditLimit,
        editDelayDays: rules.defaultInstallmentDays,
        editPenaltyRate: rules.penaltyRatePerMonth,
        editCommissionRate: loadedCommissionRate,
        editRiskLevel: rLevel,
        editCalculators: sanitizedCalcs,
        editFeatureToggles: loadedToggles,
        editPortalLinks: loadedLinks,
        editMaxPerDossierLimit: maxPerDossier,
        editAllowedTenors: allowedTenors,
        editCreditRequiredDocs: creditDocs,
        editCreditPlans: creditPlans,
        editCanCreateDossier: canCreateDossier,
        editCanSubmitCreditRequest: canSubmitCreditReq,
        editCanViewCustomerCreditHistory: canViewCustomerHist,
        editNesyehPurchaseLimit: nesyehLimit,
        editSpecialDiscountRate: specDiscount,
        editBlockOnOverdue: blockOverdue,
        editCanPlaceOrders: canPlaceOrders,
        editCanSubmitPurchaseRequest: canSubmitPurchaseReq,
        editCanViewPersonalLedger: canViewPersonalLedger,
        editAllowedCategories: allowedCats,
        editRequiredAgencyDocs: agencyDocs,
        editAllowedDepositAccounts: depositAccounts
      });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-50" dir="rtl">
      {/* STEP 3: ROOT HEADQUARTERS PAGE (WHEN NO UNIT IS SELECTED) */}
      {activeUnit === null && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 max-w-5xl mx-auto w-full">
          {/* Banner */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 sm:p-8 rounded-3xl border border-indigo-500/30 shadow-xl space-y-3">
            <div className="flex items-center gap-3">
              <span className="bg-indigo-500/20 text-indigo-300 p-2 rounded-2xl border border-indigo-400/30 text-xs font-bold flex items-center gap-1.5">
                <Landmark size={18} />
                <span>مرکز مدیریت نمایندگان</span>
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white">
              قرارگاه فرماندهی مدیریت نمایندگان
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-3xl">
              مرکز یکپارچه راهبری، نظارت و مدیریت واحدهای پنج‌گانه نمایندگان سیستم. جهت ورود به هر واحد عملیاتی و مدیریت پرونده‌ها، روی واحد مربوطه کلیک نمایید.
            </p>
          </div>

          {/* 5 Vertical Units */}
          <div className="space-y-3.5">
            {/* 1. Credit Agents */}
            <div
              onClick={() => { setActiveUnit('credit_agents'); setSelectedCommandAgentId(null); setAgentSearchQuery(''); }}
              className="bg-white hover:bg-indigo-50/50 p-5 rounded-2xl border border-zinc-200/90 shadow-sm hover:border-indigo-400 cursor-pointer transition flex items-center justify-between gap-4 group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition">
                  <Shield size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-zinc-900 group-hover:text-indigo-700 transition">
                      ۱- واحد نمایندگان اعتباری
                    </h3>
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                      فعال ({creditAgentsCount} نماینده)
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    مدیریت نمایندگان اعتباری، تخصیص سقف اعتبار، کنترل چک‌ها و تضامین و سیاست‌های ریسک
                  </p>
                </div>
              </div>
              <ArrowRight size={18} className="text-zinc-400 group-hover:text-indigo-600 group-hover:-translate-x-1 transition shrink-0 rotate-180" />
            </div>

            {/* 2. Sales Agents */}
            <div
              onClick={() => { setActiveUnit('sales_agents'); setSelectedCommandAgentId(null); setAgentSearchQuery(''); }}
              className="bg-white hover:bg-teal-50/50 p-5 rounded-2xl border border-zinc-200/90 shadow-sm hover:border-teal-400 cursor-pointer transition flex items-center justify-between gap-4 group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-teal-100 text-teal-700 flex items-center justify-center shrink-0 group-hover:bg-teal-600 group-hover:text-white transition">
                  <Users size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-zinc-900 group-hover:text-teal-700 transition">
                      ۲- واحد نمایندگان فروش
                    </h3>
                    <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                      فعال ({salesAgentsCount} نماینده)
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    مدیریت نمایندگان فروش اقساطی، پورسانت‌ها، روابط فروشگاهی و تسهیلات نسیه
                  </p>
                </div>
              </div>
              <ArrowRight size={18} className="text-zinc-400 group-hover:text-teal-600 group-hover:-translate-x-1 transition shrink-0 rotate-180" />
            </div>

            {/* 3. Investors */}
            <div
              className="bg-zinc-100/70 p-5 rounded-2xl border border-zinc-200/80 opacity-70 flex items-center justify-between gap-4 select-none"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <Landmark size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-zinc-700">
                      ۳- واحد سرمایه‌گذاران
                    </h3>
                    <span className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                      غیرفعال — درحال توسعه
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    مدیریت سرمایه‌گذاران، حساب‌های مشارکت و فرآیندهای تامین مالی
                  </p>
                </div>
              </div>
            </div>

            {/* 4. Marketing & Visitor */}
            <div
              className="bg-zinc-100/70 p-5 rounded-2xl border border-zinc-200/80 opacity-70 flex items-center justify-between gap-4 select-none"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                  <Coins size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-zinc-700">
                      ۴- واحد بازاریابی و ویزیتوری
                    </h3>
                    <span className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                      غیرفعال — درحال توسعه
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    شبکه ویزیتوران، پورسانت‌های بازاریابی و پاداش جذب مشتری
                  </p>
                </div>
              </div>
            </div>

            {/* 5. Contract Partners */}
            <div
              className="bg-zinc-100/70 p-5 rounded-2xl border border-zinc-200/80 opacity-70 flex items-center justify-between gap-4 select-none"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                  <CheckSquare size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-zinc-700">
                      ۵- واحد شرکای پیمانی
                    </h3>
                    <span className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                      غیرفعال — درحال توسعه
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    مدیریت قراردادهای پیمانی، تفاهم‌نامه‌های سازمانی و همکاری‌های استراتژیک
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WHEN A UNIT IS SELECTED */}
      {activeUnit !== null && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Unit Top Header */}
          <div className="bg-slate-900 text-white px-4 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setActiveUnit(null); setSelectedCommandAgentId(null); }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold px-3 py-1.5 rounded-xl transition flex items-center gap-1.5"
              >
                <ArrowRight size={14} />
                <span>بازگشت به قرارگاه فرماندهی</span>
              </button>
              <div className="h-4 w-px bg-slate-700" />
              <div className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                {activeUnit === 'credit_agents' && <Shield size={15} />}
                {activeUnit === 'sales_agents' && <Users size={15} />}
                <span>
                  {activeUnit === 'credit_agents' && 'واحد نمایندگان اعتباری'}
                  {activeUnit === 'sales_agents' && 'واحد نمایندگان فروش'}
                  {activeUnit === 'investors' && 'واحد سرمایه‌گذاران'}
                  {activeUnit === 'visitors' && 'واحد بازاریابی و ویزیتوری'}
                  {activeUnit === 'contract_partners' && 'واحد شرکای پیمانی'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { setActiveUnit('credit_agents'); setSelectedCommandAgentId(null); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${activeUnit === 'credit_agents' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                نمایندگان اعتباری
              </button>
              <button
                onClick={() => { setActiveUnit('sales_agents'); setSelectedCommandAgentId(null); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition ${activeUnit === 'sales_agents' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                نمایندگان فروش
              </button>
            </div>
          </div>

          {/* Visitor Network Unit */}
          {activeUnit === 'visitors' && (
            <div className="p-4">
              <VisitorNetworkManager state={appState} onUpdateState={onSave} />
            </div>
          )}

          {/* Under-Development Units Banner */}
          {(activeUnit === 'investors' || activeUnit === 'contract_partners') && (
            <div className="p-8 text-center space-y-3 bg-white m-4 rounded-3xl border border-zinc-200 shadow-sm">
              <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-2xl mx-auto flex items-center justify-center">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-sm font-bold text-zinc-800">
                {activeUnit === 'investors' && 'واحد سرمایه‌گذاران'}
                {activeUnit === 'contract_partners' && 'واحد شرکای پیمانی'}
              </h3>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                این واحد در نقشه راه مرکز مدیریت نمایندگان تعریف شده است. ساختار پرونده و اتاق فرمان اختصاصی این واحد پس از تکمیل فاز اولیه فعال خواهد شد.
              </p>
              <button
                onClick={() => setActiveUnit('credit_agents')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition shadow-sm"
              >
                بازگشت به واحد نمایندگان اعتباری
              </button>
            </div>
          )}

          {(activeUnit === 'credit_agents' || activeUnit === 'sales_agents') && (
            <>
              {/* Unit Navigation Sub-Tabs */}
              <div className="flex border-b border-zinc-200 bg-white p-2">
                <button
                  onClick={() => { setActiveTab('list'); setSelectedCommandAgentId(null); }}
                  className={`flex-1 py-2 px-4 rounded-xl text-[13px] font-bold font-sans transition ${activeTab === 'list' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
                >
                  فهرست نمایندگان و اتاق فرمان
                </button>
                <button
                  onClick={() => { setActiveTab('approvals'); setSelectedCommandAgentId(null); }}
                  className={`flex-1 py-2 px-4 rounded-xl text-[13px] font-bold font-sans transition relative ${activeTab === 'approvals' ? 'bg-emerald-600 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
                >
                  بررسی چک‌های همکاران
                  {pendingChecks.length > 0 && (
                    <span className="absolute top-1 left-1 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                      {pendingChecks.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => { setActiveTab('credit_files'); setSelectedCommandAgentId(null); }}
                  className={`flex-1 py-2 px-4 rounded-xl text-[13px] font-bold font-sans transition ${activeTab === 'credit_files' ? 'bg-indigo-600 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
                >
                  پرونده‌های اعتباری
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-right">
                {activeTab === 'list' && (
                  <>
                    {/* STEP 4: TOP SECTION TOOLS INSIDE UNIT (SEARCH & CREATE NEW REPRESENTATIVE ONLY) */}
                    {selectedCommandAgentId === null && (
                      <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
                        {/* Tool 1: Search Agent */}
                        <div className="relative flex-1 w-full">
                          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                          <input
                            type="text"
                            placeholder="جستجوی نماینده (نام، کد، شماره موبایل)..."
                            value={agentSearchQuery}
                            onChange={e => setAgentSearchQuery(e.target.value)}
                            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pr-9 pl-3 py-2 text-xs font-bold outline-none focus:border-indigo-500 transition"
                          />
                        </div>

                        {/* Tool 2: Create New Agent & Onboarding */}
                        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                          <button
                            onClick={() => setOnboardingData({ partner: null, person: null })}
                            className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition shadow flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
                            title="تکمیل پرونده هویتی، اسناد و ایجاد رابطه نمایندگی جدید"
                          >
                            <Plus size={16} />
                            <span>
                              {activeUnit === 'sales_agents' ? 'ایجاد نماینده فروش جدید' : 'ایجاد نماینده اعتباری جدید'}
                            </span>
                          </button>
                        </div>
                      </div>
                    )}

                    {showAddForm && selectedCommandAgentId === null && (
                      <div className="bg-white p-6 rounded-2xl border border-zinc-200/60 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                  <button type="button" onClick={resetAgentForm} className="text-zinc-400 text-[13px] font-bold hover:text-zinc-600">انصراف</button>
                  <span className="font-sans text-[13px] font-bold text-zinc-800">تعریف رابطه نمایندگی برای شخص موجود</span>
                </div>

                {!selectedPersonForAgency ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">جستجوی شخص (نام، کد ملی، شماره موبایل):</label>
                      <input 
                        type="text" 
                        placeholder="جستجو در پرونده‌های اشخاص..." 
                        value={personSearchQuery}
                        onChange={e => setPersonSearchQuery(e.target.value)}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-zinc-500"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1.5 border border-zinc-100 rounded-xl p-2 bg-zinc-50">
                      {(effectivePersons || appState.persons || [])
                        .filter((p, index, self) => index === self.findIndex(t => t.id === p.id))
                        .filter(p => {
                          const query = personSearchQuery.trim();
                          if (!query) return true;
                          return (
                            p.name.includes(query) ||
                            (p.nationalId && p.nationalId.includes(query)) ||
                            (p.mobile && p.mobile.includes(query)) ||
                            p.code.includes(query)
                          );
                        })
                        .map(p => {
                          const existingBp = (appState.businessPartners || []).find(bp => bp.personId === p.id);
                          const isAlreadyCreditPartner = Boolean(
                            (p.isAgent && (p.agencyRole === 'credit' || p.agencyRole === 'both')) ||
                            (existingBp && (
                              existingBp.agencyType === AgencyType.CREDIT_ONLY ||
                              existingBp.agencyType === AgencyType.BOTH ||
                              (existingBp.roles || []).includes(PartnerRole.CREDIT_SALES_AGENT) ||
                              (existingBp.roles || []).includes('CREDIT_AGENT' as any)
                            ))
                          );

                          return (
                            <div 
                              key={p.id}
                              onClick={() => {
                                if (isAlreadyCreditPartner) {
                                  alert('این شخص قبلاً دارای پرونده نمایندگی اعتباری می‌باشد. ایجاد پرونده اعتباری تکراری برای یک شخص امکان‌پذیر نیست.');
                                  return;
                                }
                                setSelectedPersonForAgency(p);
                                setNewAgencyStoreName(p.companyName || existingBp?.profile?.storeName || '');
                              }}
                              className={`p-2.5 rounded-xl border text-[13px] flex justify-between items-center transition ${
                                isAlreadyCreditPartner 
                                  ? 'bg-zinc-100 border-zinc-200 cursor-not-allowed opacity-70' 
                                  : 'bg-white border-zinc-200 hover:border-zinc-400 cursor-pointer'
                              }`}
                            >
                              <div>
                                <div className="font-bold text-zinc-800 flex items-center gap-2">
                                  {p.name}
                                  {isAlreadyCreditPartner && (
                                    <span className="text-xs bg-red-100 text-red-800 border border-red-200 px-2 py-0.5 rounded font-bold">
                                      پرونده اعتباری فعال دارد
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-zinc-600 font-mono mt-0.5">
                                  کد: {p.code} | کد ملی: {p.nationalId || 'ندارد'} | موبایل: {p.mobile || 'ندارد'}
                                </div>
                              </div>
                              <button 
                                type="button" 
                                disabled={isAlreadyCreditPartner}
                                className={`px-3 py-1 rounded-lg text-xs font-bold ${
                                  isAlreadyCreditPartner 
                                    ? 'bg-zinc-200 text-zinc-600 cursor-not-allowed' 
                                    : 'bg-zinc-900 text-white hover:bg-zinc-800'
                                }`}
                              >
                                {isAlreadyCreditPartner ? 'ثبت شده (تکراری)' : 'انتخاب شخص'}
                              </button>
                            </div>
                          );
                        })}
                      {appState.persons.length === 0 && (
                        <div className="text-center text-zinc-400 text-[13px] py-4">هیچ شخص ثبت‌شده‌ای وجود ندارد. ابتدا شخص را در بخش «مدیریت اشخاص» ایجاد کنید.</div>
                      )}
                    </div>
                    <div className="text-xs text-zinc-400 bg-amber-50 p-2 rounded-lg border border-amber-200 text-amber-700">
                      توجه: ایجاد شخص جدید در اینجا انجام نمی‌شود. اطلاعات هویتی مستقیماً از پرونده اصلی شخص خوانده می‌شود.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-200 space-y-1.5">
                      <div className="flex justify-between items-center">
                        <div className="text-xs text-emerald-800 font-bold">مشخصات هویتی شخص (خوانده شده از پرونده اصلی - غیرقابل ویرایش در این بخش):</div>
                        <button 
                          type="button" 
                          onClick={() => setSelectedPersonForAgency(null)}
                          className="text-xs text-indigo-600 font-bold hover:underline bg-white px-2 py-0.5 rounded border border-indigo-200 shadow-sm"
                        >
                          تغییر شخص
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                        <div><span className="text-zinc-600">نام و نام خانوادگی:</span> <span className="font-bold text-zinc-900">{selectedPersonForAgency.name}</span></div>
                        <div><span className="text-zinc-600">کد شخص:</span> <span className="font-mono font-bold text-zinc-900">{selectedPersonForAgency.code}</span></div>
                        <div><span className="text-zinc-600">کد ملی:</span> <span className="font-mono text-zinc-900">{selectedPersonForAgency.nationalId || 'ثبت نشده'}</span></div>
                        <div><span className="text-zinc-600">شماره موبایل:</span> <span className="font-mono text-zinc-900">{selectedPersonForAgency.mobile || 'ثبت نشده'}</span></div>
                        <div className="col-span-2"><span className="text-zinc-600">آدرس:</span> <span className="text-zinc-900">{selectedPersonForAgency.address || 'ثبت نشده'}</span></div>
                        {selectedPersonForAgency.bankInfo && (
                          <div className="col-span-2"><span className="text-zinc-600">اطلاعات بانکی:</span> <span className="font-mono text-zinc-900">{selectedPersonForAgency.bankInfo.bankName || ''} - شبا: {selectedPersonForAgency.bankInfo.sheba || 'ثبت نشده'}</span></div>
                        )}
                      </div>
                    </div>

                    <div>
                      <span className="block text-xs text-zinc-600 mb-1">نوع نقش نمایندگی</span>
                      <div className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-[13px] font-bold text-zinc-800">
                        نماینده اعتباری / مالی (Credit Agent)
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">وضعیت اولیه نمایندگی</label>
                      <select 
                        value={agencyStatusChoice} 
                        onChange={e => setAgencyStatusChoice(e.target.value as any)} 
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-zinc-500"
                      >
                        <option value="pending">در انتظار بررسی مدارک (Pending)</option>
                        <option value="active">فعال و تایید شده (Active)</option>
                        <option value="inactive">غیرفعال (Inactive)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">نام فروشگاه / شعبه</label>
                      <input 
                        type="text" 
                        value={newAgencyStoreName} 
                        onChange={e => setNewAgencyStoreName(e.target.value)} 
                        placeholder="مثال: فروشگاه مرکزی ..."
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-zinc-500" 
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">سقف اعتبار (ریال)</label>
                      <input 
                        type="number" 
                        value={newAgencyCreditLimit} 
                        onChange={e => setNewAgencyCreditLimit(parseInt(e.target.value || '0'))} 
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-zinc-500 font-mono" 
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">آدرس فروشگاه / محل نمایندگی</label>
                      <textarea 
                        value={newAgencyStoreAddress} 
                        onChange={e => setNewAgencyStoreAddress(e.target.value)} 
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-zinc-500 h-16 resize-none" 
                      />
                    </div>

                    <button 
                      type="button" 
                      onClick={handleCreateAgency} 
                      disabled={isSubmittingAgency}
                      className={`w-full ${isSubmittingAgency ? 'bg-zinc-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500'} text-white font-bold py-2.5 rounded-lg text-[13px] transition shadow`}
                    >
                      {isSubmittingAgency ? 'در حال ثبت در پایگاه‌داده...' : 'ثبت و ایجاد رابطه نمایندگی'}
                    </button>

                    {diagnosticLogs.length > 0 && (
                      <div className="mt-3 p-3 bg-zinc-900 text-zinc-100 rounded-xl text-xs font-mono space-y-1.5 border border-zinc-800 text-left dir-ltr select-all">
                        <div className="flex items-center justify-between text-zinc-400 pb-1 border-b border-zinc-800 text-[11px]">
                          <span>گزارش تشخیصی سرور (Diagnostic Log)</span>
                          <button 
                            type="button" 
                            onClick={() => setDiagnosticLogs([])}
                            className="text-zinc-400 hover:text-zinc-200 text-[10px]"
                          >
                            پاک کردن
                          </button>
                        </div>
                        <div className="max-h-40 overflow-y-auto space-y-1 text-[11px] leading-relaxed">
                          {diagnosticLogs.map((log, idx) => (
                            <div key={idx} className={log.includes('خطا') ? 'text-rose-400 font-semibold' : log.includes('موفق') ? 'text-emerald-400' : 'text-zinc-300'}>
                              {log}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              {selectedCommandAgentId ? (
                /* DEDICATED AGENT MANAGEMENT PAGE */
                (() => {
                  const agent = appState.persons.find(p => p.id === selectedCommandAgentId);
                  if (!agent) {
                    return (
                      <div className="bg-white p-6 rounded-2xl border text-center space-y-3">
                        <p className="text-sm text-zinc-500">نماینده یافت نشد.</p>
                        <button onClick={() => setSelectedCommandAgentId(null)} className="px-4 py-2 bg-zinc-900 text-white text-xs font-bold rounded-xl">بازگشت به لیست</button>
                      </div>
                    );
                  }

                  const dynamicWalletBal = getPartnerWalletBalance(agent.id);
                  const agencyRoleParam = activeUnit === 'sales_agents' ? 'sales' : activeUnit === 'credit_agents' ? 'credit' : '';
                  const roleParamStr = agencyRoleParam ? `&agency_role=${agencyRoleParam}` : '';
                  const baseUrl = import.meta.env.VITE_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
                  const secretLink = `${baseUrl}/?agent_token=${agent.id}${roleParamStr}${agent.name ? `&name=${encodeURIComponent(agent.name)}` : ''}${agent.agentDetails?.storeName ? `&store=${encodeURIComponent(agent.agentDetails.storeName)}` : ''}`;
                  const overdueInvoices = getPartnerOverdueInvoices(agent.id);
                  const partner = appState.businessPartners?.find(bp => bp.personId === agent.id);

                  const isCreditRole = Boolean(agent.agencyRole === 'credit' || agent.agencyRole === 'both');
                  const isSalesRole = Boolean(agent.agencyRole === 'sales' || agent.agencyRole === 'both');
                  const effectiveRoleMode = !isCreditRole && isSalesRole ? 'sales' : (!isSalesRole && isCreditRole ? 'credit' : commandCenterRoleMode);

                  return (
                    <div className="space-y-4">
                      {/* Dedicated Header & Navigation */}
                      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 pb-4">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => {
                                setSelectedCommandAgentId(null);
                                setExpandedAgentId(null);
                              }}
                              className="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-bold px-3 py-2 rounded-xl transition flex items-center gap-1.5"
                            >
                              <ArrowRight size={14} />
                              <span>بازگشت به لیست نمایندگان</span>
                            </button>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="text-base font-black text-zinc-900">
                                  مدیریت نماینده: {agent.name}
                                </h2>
                                <span className="text-xs font-mono bg-zinc-100 px-2 py-0.5 rounded text-zinc-700 font-bold">
                                  کد: {agent.code}
                                </span>
                                {agent.isDocumentsApproved ? (
                                  <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-200">
                                    مدارک تایید شده
                                  </span>
                                ) : (
                                  <span className="bg-rose-50 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded border border-rose-200">
                                    مدارک معلق
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-zinc-500 mt-1">
                                فروشگاه / شعبه: {agent.agentDetails?.storeName || partner?.profile?.storeName || 'دفتر نماینده اعتباری'} | شماره تماس: {agent.mobile || 'ثبت نشده'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={async () => {
                                const bp = appState.businessPartners?.find(b => b.personId === agent.id) || null;
                                let targetAgent = agent;
                                try {
                                  const details = await PersonService.getAgentDetails(agent.id);
                                  if (details) {
                                    targetAgent = {
                                      ...agent,
                                      agentDetails: {
                                        storeName: details.store_name || details.storeName || '',
                                        storeAddress: details.store_address || details.storeAddress || '',
                                        guarantors: agent.agentDetails?.guarantors || [],
                                        guaranteeChecks: agent.agentDetails?.guaranteeChecks || [],
                                      },
                                    };
                                  }
                                } catch (e) {
                                  console.error('Error pre-fetching agent details:', e);
                                }
                                setOnboardingData({ partner: bp, person: targetAgent });
                              }}
                              className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 text-xs font-bold px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                              title="تکمیل پرونده، مدارک و اسناد قرارداد آنبوردینگ"
                            >
                              <FileText size={14} />
                              <span>پرونده آنبوردینگ</span>
                            </button>
                            {partner && (agent.agencyRole === 'sales' || agent.agencyRole === 'both') && (
                              <button
                                onClick={() => handleEditNesyehClick(partner, agent)}
                                className="bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                                title="ویرایش سقف خرید نسیه، مهلت تسویه و درصد جریمه تاخیر"
                              >
                                <Settings size={14} />
                                <span>تنظیمات قرارداد نسیه</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setShowResetConfirmModal(agent)}
                              className="bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                              title="تولید و تخصیص یک رمز عبور تصادفی جدید برای حساب کاربری نماینده"
                            >
                              <KeyRound size={14} />
                              <span>تولید رمز عبور جدید برای نماینده</span>
                            </button>
                            {isCreditRole && (
                              <div className="bg-zinc-50 border border-zinc-200 px-3.5 py-1.5 rounded-xl text-left">
                                <div className="text-[10px] text-zinc-400 font-bold">موجودی کیف پول اعتباری</div>
                                <div className="text-xs font-mono font-bold text-zinc-800">
                                  {dynamicWalletBal.toLocaleString()} ریال
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 3 Main Architectural View Mode Buttons */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-zinc-100/80 p-1.5 rounded-2xl border border-zinc-200/60">
                          <button
                            onClick={() => setCommandCenterTab('dossier')}
                            className={`py-3 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                              commandCenterTab === 'dossier'
                                ? 'bg-white text-zinc-900 shadow border border-zinc-200 ring-2 ring-indigo-500/20'
                                : 'text-zinc-600 hover:text-zinc-900 hover:bg-white/50'
                            }`}
                          >
                            <FileText size={16} className={commandCenterTab === 'dossier' ? 'text-indigo-600' : 'text-zinc-500'} />
                            <span>۱. 👤 مشخصات فردی و هویتی</span>
                          </button>

                          <button
                            onClick={() => setCommandCenterTab('command_center')}
                            className={`py-3 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                              commandCenterTab === 'command_center'
                                ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-400/30'
                                : 'text-zinc-600 hover:text-zinc-900 hover:bg-white/50'
                            }`}
                          >
                            <Sliders size={16} />
                            <span>۲. 🎛️ اتاق فرمان اختصاصی</span>
                          </button>

                          <button
                            onClick={() => setCommandCenterTab('financial')}
                            className={`py-3 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                              commandCenterTab === 'financial'
                                ? 'bg-emerald-700 text-white shadow-md ring-2 ring-emerald-400/30'
                                : 'text-zinc-600 hover:text-zinc-900 hover:bg-white/50'
                            }`}
                          >
                            <Landmark size={16} />
                            <span>۳. 🏛️ پرونده مالی نماینده</span>
                          </button>
                        </div>
                      </div>

                      {/* VIEW 1: IDENTITY DOSSIER */}
                      {commandCenterTab === 'dossier' && (
                        <AgentDossierModal
                          agent={agent}
                          appState={appState}
                          partner={partner}
                          onOpenCustomerFolder={(agentId) => setActiveCustomerFolder(agentId)}
                          onOpenFinancialDossier={(agent) => setSelectedDossierAgent(agent)}
                        />
                      )}


                      {/* VIEW 2: DEDICATED COMMAND CENTER */}
                      {commandCenterTab === 'command_center' && (
                        <div className="space-y-4">
                          {/* Role Selection Mode Header inside Command Center */}
                          <div className="flex flex-col sm:flex-row items-center justify-between bg-zinc-900 text-white p-3.5 rounded-2xl shadow-md gap-3">
                            <div className="flex items-center gap-2.5">
                              <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
                                <Shield size={20} />
                              </div>
                              <div>
                                <h3 className="text-xs font-bold text-white">اتاق فرمان اختصاصی نمایندگان</h3>
                                <p className="text-[11px] text-zinc-400 mt-0.5">مدیریت لایه دسترسی‌ها، سقف‌های اعتباری و مجوزهای نمایندگان</p>
                              </div>
                            </div>

                            <div className="flex bg-zinc-800/90 p-1 rounded-xl gap-1 border border-zinc-700/60 w-full sm:w-auto justify-stretch">
                              {isCreditRole && (
                                <button
                                  onClick={() => {
                                    setCommandCenterRoleMode('credit');
                                    setPartnerSubTab('overview');
                                  }}
                                  className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
                                    effectiveRoleMode === 'credit'
                                      ? 'bg-amber-500 text-zinc-950 shadow-md font-black'
                                      : 'text-zinc-300 hover:text-white hover:bg-zinc-700/50'
                                  }`}
                                >
                                  <Landmark size={15} />
                                  <span>🏛️ اتاق فرمان نماینده اعتباری</span>
                                </button>
                              )}
                              {isSalesRole && (
                                <button
                                  onClick={() => {
                                    setCommandCenterRoleMode('sales');
                                    setPartnerSubTab('overview');
                                  }}
                                  className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-2 ${
                                    effectiveRoleMode === 'sales'
                                      ? 'bg-blue-600 text-white shadow-md font-black'
                                      : 'text-zinc-300 hover:text-white hover:bg-zinc-700/50'
                                  }`}
                                >
                                  <ShoppingBag size={15} />
                                  <span>🛍️ اتاق فرمان نماینده فروش</span>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Dynamic Sub-Tabs for Active Role Mode */}
                          <div className="flex border-b border-zinc-200 bg-white p-1 rounded-xl shadow-sm overflow-x-auto custom-scrollbar gap-1">
                            {(effectiveRoleMode === 'credit'
                              ? [
                                  { id: 'overview', label: 'داشبورد اعتباری', icon: Landmark },
                                  { id: 'credit_rules', label: 'سقف‌ها و مهلت پرداخت', icon: Scale },
                                  { id: 'calculators_plans', label: 'ماشین‌حساب‌ها و طرح‌ها', icon: Wrench },
                                  { id: 'dossier_requests', label: 'پرونده و درخواست‌ها', icon: FileCheck },
                                  { id: 'required_docs', label: 'مدارک و تضامین اعتباری', icon: FileText },
                                  { id: 'feature_access', label: 'دسترسی‌ها و فیچرها', icon: Shield },
                                  { id: 'portal_link', label: 'لینک اختصاصی', icon: Link },
                                  { id: 'history', label: 'تاریخچه دستورات اعتباری', icon: History }
                                ]
                              : [
                                  { id: 'overview', label: 'داشبورد فروشگاه', icon: ShoppingBag },
                                  { id: 'sales_rules', label: 'سقف خرید نسیه و تخفیف', icon: Tag },
                                  { id: 'order_controls', label: 'کنترل ثبت سفارش', icon: ShoppingCart },
                                  { id: 'allowed_categories', label: 'دسته‌بندی‌های مجاز', icon: Layers },
                                  { id: 'agency_docs', label: 'مدارک نمایندگی', icon: FileText },
                                  { id: 'deposit_accounts', label: 'حساب‌های واریز مجاز', icon: CreditCard },
                                  { id: 'portal_link', label: 'لینک اختصاصی فروشگاه', icon: Link },
                                  { id: 'history', label: 'تاریخچه دستورات نمایندگی', icon: History }
                                ]
                            ).map(subTab => {
                              const Icon = subTab.icon;
                              const isActive = partnerSubTab === subTab.id;
                              return (
                                <button
                                  key={subTab.id}
                                  onClick={() => setPartnerSubTab(subTab.id as any)}
                                  className={`py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 shrink-0 ${
                                    isActive 
                                      ? (effectiveRoleMode === 'credit' ? 'bg-amber-500 text-zinc-950 font-black shadow' : 'bg-blue-600 text-white font-black shadow') 
                                      : 'text-zinc-600 hover:text-zinc-800 hover:bg-zinc-100'
                                  }`}
                                >
                                  <Icon size={14} />
                                  <span>{subTab.label}</span>
                                </button>
                              );
                            })}
                          </div>

                          {/* CREDIT AGENT COMMAND CENTER CONTENT */}
                          {effectiveRoleMode === 'credit' && (
                            <div className="space-y-4">
                              {/* Edit Mode Quick Info Banner */}
                              {partnerSubTab !== 'overview' && partnerSubTab !== 'history' && (
                                <>
                                  {!isEditingSettings ? (
                                    <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
                                      <div className="flex items-center gap-3">
                                        <div className="p-2 bg-amber-500/10 text-amber-600 rounded-xl shrink-0">
                                          <Sliders size={18} />
                                        </div>
                                        <div className="text-right">
                                          <h5 className="font-bold text-[13px]">حالت «فقط مشاهده» فعال است</h5>
                                          <p className="text-[11px] text-zinc-500 mt-0.5">در این حالت، تنظیمات قابل تغییر نیستند. جهت اعمال هرگونه تغییر بر روی ماشین‌حساب‌ها یا سیاست‌ها، دکمه ویرایش را کلیک کنید.</p>
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setIsEditingSettings(true)}
                                        className="bg-amber-500 hover:bg-amber-600 text-zinc-950 font-black text-xs px-4 py-2 rounded-xl shadow-sm transition shrink-0 flex items-center gap-1.5"
                                      >
                                        <span>🔓 فعال‌سازی حالت ویرایش</span>
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
                                      <div className="flex items-center gap-3">
                                        <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-xl shrink-0">
                                          <CheckCircle2 size={18} className="text-emerald-600" />
                                        </div>
                                        <div className="text-right">
                                          <h5 className="font-bold text-[13px] text-emerald-800">حالت «ویرایش تنظیمات» فعال است</h5>
                                          <p className="text-[11px] text-emerald-600 mt-0.5">تغییرات خود را در هر یک از بخش‌ها اعمال کنید و سپس برای ثبت نهایی دکمه ذخیره را کلیک کنید.</p>
                                        </div>
                                      </div>
                                      <div className="flex gap-2 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => savePartnerSettings(agent.id)}
                                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs px-4 py-2 rounded-xl shadow-md transition flex items-center gap-1.5"
                                        >
                                          <span>💾 ذخیره تغییرات</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (hasUnsavedChanges()) {
                                              if (!window.confirm('تغییرات ذخیره نشده است. آیا قصد خروج بدون ذخیره را دارید؟')) return;
                                            }
                                            setIsEditingSettings(false);
                                            if (initialEditState) {
                                              setEditWholesale(initialEditState.editWholesale);
                                              setEditInstallment(initialEditState.editInstallment);
                                              setEditDocsApproved(initialEditState.editDocsApproved);
                                              setEditCreditLimit(initialEditState.editCreditLimit);
                                              setEditDelayDays(initialEditState.editDelayDays);
                                              setEditPenaltyRate(initialEditState.editPenaltyRate);
                                              setEditCommissionRate(initialEditState.editCommissionRate);
                                              setEditRiskLevel(initialEditState.editRiskLevel);
                                              setEditCalculators(initialEditState.editCalculators);
                                              setEditFeatureToggles(initialEditState.editFeatureToggles);
                                              setEditPortalLinks(initialEditState.editPortalLinks);
                                              setEditMaxPerDossierLimit(initialEditState.editMaxPerDossierLimit);
                                              setEditAllowedTenors(initialEditState.editAllowedTenors);
                                              setEditCreditRequiredDocs(initialEditState.editCreditRequiredDocs);
                                              setEditCreditPlans(initialEditState.editCreditPlans);
                                              setEditNesyehPurchaseLimit(initialEditState.editNesyehPurchaseLimit);
                                              setEditSpecialDiscountRate(initialEditState.editSpecialDiscountRate);
                                              setEditBlockOnOverdue(initialEditState.editBlockOnOverdue);
                                              setEditCanPlaceOrders(initialEditState.editCanPlaceOrders);
                                              setEditCanSubmitPurchaseRequest(initialEditState.editCanSubmitPurchaseRequest);
                                              setEditCanViewPersonalLedger(initialEditState.editCanViewPersonalLedger);
                                              setEditAllowedCategories(initialEditState.editAllowedCategories);
                                              setEditRequiredAgencyDocs(initialEditState.editRequiredAgencyDocs);
                                              setEditAllowedDepositAccounts(initialEditState.editAllowedDepositAccounts);
                                            }
                                          }}
                                          className="bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-700 font-bold text-xs px-4 py-2 rounded-xl transition"
                                        >
                                          <span>انصراف</span>
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}

                              {/* Subtab: Overview */}
                              {partnerSubTab === 'overview' && (() => {
                                const currentDebt = appState.invoices
                                  .filter(inv => inv.type === 'sell' && inv.personId === agent.id && !inv.isProInvoice)
                                  .reduce((sum, inv) => sum + (inv.totalAmount - (inv.paidAmount || 0)), 0);
                                const remainingCredit = editCreditLimit - currentDebt;
                                return (
                                  <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                                    <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex justify-between items-center">
                                      <span className="flex items-center gap-1.5">
                                        <Landmark size={16} className="text-amber-600" />
                                        <span>داشبورد اتاق فرمان نماینده اعتباری</span>
                                      </span>
                                      <span className="text-xs text-zinc-400 font-mono">کد همکار: {agent.code}</span>
                                    </h4>

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-amber-50/50 p-3 rounded-xl border border-amber-200/60">
                                      <div className="bg-white p-3 rounded-xl border border-zinc-150 flex flex-col">
                                        <span className="text-[10px] text-zinc-500 font-bold">سقف اعتبار کل نماینده</span>
                                        <span className="text-sm font-mono font-black text-indigo-700 mt-1">{editCreditLimit.toLocaleString()} ریال</span>
                                      </div>
                                      <div className="bg-white p-3 rounded-xl border border-zinc-150 flex flex-col">
                                        <span className="text-[10px] text-zinc-500 font-bold">سقف هر پرونده اعتباری</span>
                                        <span className="text-sm font-mono font-black text-amber-700 mt-1">{editMaxPerDossierLimit.toLocaleString()} ریال</span>
                                      </div>
                                      <div className="bg-white p-3 rounded-xl border border-zinc-150 flex flex-col">
                                        <span className="text-[10px] text-zinc-500 font-bold">اعتبار باقی‌مانده</span>
                                        <span className={`text-sm font-mono font-black mt-1 ${remainingCredit < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                          {remainingCredit.toLocaleString()} ریال
                                        </span>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 space-y-2 text-xs">
                                        <div className="font-bold text-zinc-800 border-b pb-1 flex justify-between">
                                          <span>مجوزهای کلیدی پرونده</span>
                                          <CheckCircle2 size={14} className="text-emerald-600" />
                                        </div>
                                        <div className="flex justify-between py-1 border-b border-zinc-100">
                                          <span>تشکیل پرونده اعتباری:</span>
                                          <span className={`font-bold ${editCanCreateDossier ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {editCanCreateDossier ? 'مجاز' : 'غیرمجاز'}
                                          </span>
                                        </div>
                                        <div className="flex justify-between py-1 border-b border-zinc-100">
                                          <span>ارسال درخواست اعتبار:</span>
                                          <span className={`font-bold ${editCanSubmitCreditRequest ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {editCanSubmitCreditRequest ? 'مجاز' : 'غیرمجاز'}
                                          </span>
                                        </div>
                                        <div className="flex justify-between py-1">
                                          <span>مشاهده سوابق مشتریان:</span>
                                          <span className={`font-bold ${editCanViewCustomerCreditHistory ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {editCanViewCustomerCreditHistory ? 'مجاز' : 'غیرمجاز'}
                                          </span>
                                        </div>
                                      </div>

                                      <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 space-y-2 text-xs">
                                        <div className="font-bold text-zinc-800 border-b pb-1 flex justify-between">
                                          <span>تنظیمات اقساط و کارمزد</span>
                                          <Sliders size={14} className="text-indigo-600" />
                                        </div>
                                        <div className="flex justify-between py-1 border-b border-zinc-100">
                                          <span>تعداد اقساط مجاز:</span>
                                          <span className="font-mono font-bold text-indigo-700">{editAllowedTenors.join(' / ')} ماه</span>
                                        </div>
                                        <div className="flex justify-between py-1">
                                          <span>کمیسیون نماینده:</span>
                                          <span className="font-mono font-bold text-emerald-700">{editCommissionRate}%</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Subtab: Credit Rules & Limits */}
                              {partnerSubTab === 'credit_rules' && (
                                <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                                  <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                    <Scale size={16} className="text-amber-600" />
                                    <span>سقف‌های اعتباری و مهلت بازپرداخت اقساط</span>
                                  </h4>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                    <div className="space-y-1.5">
                                      <label className="block text-zinc-700 font-bold">سقف کل اعتبار نماینده (ریال)</label>
                                      <FormattedNumericInput
                                        value={editCreditLimit}
                                        disabled={!isEditingSettings}
                                        onEnableEdit={() => setIsEditingSettings(true)}
                                        isCurrency={true}
                                        onChange={(val) => setEditCreditLimit(val)}
                                        textColorClass="text-indigo-700"
                                      />
                                      <p className="text-[10px] text-zinc-400">حداکثر سقف اعتبار اعطایی به مجموع پرونده‌های این نماینده</p>
                                    </div>

                                    <div className="space-y-1.5">
                                      <label className="block text-zinc-700 font-bold">حداکثر سقف هر پرونده اعتباری (ریال)</label>
                                      <FormattedNumericInput
                                        value={editMaxPerDossierLimit}
                                        disabled={!isEditingSettings}
                                        onEnableEdit={() => setIsEditingSettings(true)}
                                        isCurrency={true}
                                        onChange={(val) => setEditMaxPerDossierLimit(val)}
                                        textColorClass="text-amber-700"
                                      />
                                      <p className="text-[10px] text-zinc-400">سقف مجاز برای ثبت یک پرونده اعتباری تک مشتری</p>
                                    </div>

                                    <div className="space-y-1.5">
                                      <label className="block text-zinc-700 font-bold">حداکثر درصد کمیسیون مجاز این نماینده (%)</label>
                                      <FormattedNumericInput
                                        value={editCommissionRate}
                                        disabled={!isEditingSettings}
                                        onEnableEdit={() => setIsEditingSettings(true)}
                                        isPercent={true}
                                        onChange={(val) => setEditCommissionRate(val)}
                                        textColorClass="text-emerald-700"
                                      />
                                    </div>
                                  </div>

                                  <div className="pt-2 border-t border-zinc-150 space-y-2 text-xs">
                                    <label className="block text-zinc-700 font-bold">تعداد اقساط (بازه‌های زمانی) مجاز برای پرونده‌ها</label>
                                    <div className="flex flex-wrap gap-2">
                                      {[3, 6, 9, 12, 18, 24, 36].map(months => {
                                        const isSelected = editAllowedTenors.includes(months);
                                        return (
                                          <button
                                            key={months}
                                            type="button"
                                            onClick={() => {
                                              if (!isEditingSettings) {
                                                setIsEditingSettings(true);
                                              }
                                              if (isSelected) {
                                                setEditAllowedTenors(editAllowedTenors.filter(m => m !== months));
                                              } else {
                                                setEditAllowedTenors([...editAllowedTenors, months].sort((a, b) => a - b));
                                              }
                                            }}
                                            className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold transition flex items-center gap-1.5 ${
                                              isSelected
                                                ? 'bg-amber-500 text-zinc-950 border-amber-600 shadow-sm'
                                                : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100'
                                            } ${!isEditingSettings ? 'hover:border-amber-400 cursor-pointer' : ''}`}
                                          >
                                            {isSelected ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                                            <span>{months} ماهه</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Subtab: Calculators & Plans */}
                              {partnerSubTab === 'calculators_plans' && (
                                <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                                  <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                    <Wrench size={16} className="text-amber-600" />
                                    <span>انتخاب ماشین‌حساب‌ها و طرح‌های اعتباری مجاز</span>
                                  </h4>

                                  <div className="space-y-3">
                                    <label className="block text-xs font-bold text-zinc-700">ماشین‌حساب‌های اقساط مجاز برای نماینده:</label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                      {(appState.calculators || []).map(calc => {
                                        const isSelected = editCalculators.includes(calc.id);
                                        return (
                                          <div
                                            key={calc.id}
                                            onClick={() => {
                                              if (!isEditingSettings) return;
                                              if (isSelected) {
                                                setEditCalculators(editCalculators.filter(id => id !== calc.id));
                                              } else {
                                                setEditCalculators([...editCalculators, calc.id]);
                                              }
                                            }}
                                            className={`p-3 rounded-xl border text-xs transition flex items-center justify-between ${
                                              isSelected
                                                ? 'bg-amber-50 border-amber-300 text-zinc-900 font-bold shadow-sm'
                                                : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                                            } ${!isEditingSettings ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                          >
                                            <div className="flex items-center gap-2">
                                              <Calculator size={14} className={isSelected ? 'text-amber-600' : 'text-zinc-400'} />
                                              <span>{calc.name}</span>
                                            </div>
                                            {isSelected && <Check size={14} className="text-amber-600 shrink-0" />}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  <div className="pt-3 border-t border-zinc-150 space-y-3">
                                    <label className="block text-xs font-bold text-zinc-700">طرح‌های فروش اعتباری مجاز:</label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                      {['طرح اقساط طلایی', 'طرح اعتباری سازمانی', 'طرح چک صیادی موعددار', 'طرح اعتبار بازنشستگان'].map(planName => {
                                        const isSelected = editCreditPlans.includes(planName);
                                        return (
                                          <div
                                            key={planName}
                                            onClick={() => {
                                              if (!isEditingSettings) return;
                                              if (isSelected) {
                                                setEditCreditPlans(editCreditPlans.filter(p => p !== planName));
                                              } else {
                                                setEditCreditPlans([...editCreditPlans, planName]);
                                              }
                                            }}
                                            className={`p-3 rounded-xl border transition flex items-center justify-between ${
                                              isSelected
                                                ? 'bg-indigo-50 border-indigo-200 text-indigo-900 font-bold'
                                                : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                                            } ${!isEditingSettings ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                          >
                                            <span>{planName}</span>
                                            {isSelected ? <CheckCircle2 size={14} className="text-indigo-600" /> : <Circle size={14} className="text-zinc-400" />}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Subtab: Dossier & Requests */}
                              {partnerSubTab === 'dossier_requests' && (
                                <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                                  <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                    <FileCheck size={16} className="text-amber-600" />
                                    <span>کنترل‌های تشکیل پرونده و درخواست اعتبار مشتریان</span>
                                  </h4>

                                  <div className="space-y-3 text-xs">
                                    <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200 flex items-center justify-between">
                                      <div>
                                        <div className="font-bold text-zinc-800">امکان تشکیل پرونده اعتباری جدید</div>
                                        <div className="text-[11px] text-zinc-500 mt-0.5">مجوز ثبت اولیه پرونده برای متقاضیان جدید در سامانه</div>
                                      </div>
                                      <input
                                        type="checkbox"
                                        checked={editCanCreateDossier}
                                        onChange={(e) => setEditCanCreateDossier(e.target.checked)}
                                        className="w-5 h-5 accent-amber-500 cursor-pointer"
                                      />
                                    </div>

                                    <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200 flex items-center justify-between">
                                      <div>
                                        <div className="font-bold text-zinc-800">امکان ارسال درخواست اعتبار</div>
                                        <div className="text-[11px] text-zinc-500 mt-0.5">ارسال نهایی پرونده مشتری به کارتابل اعتبارسنجی مرکزی</div>
                                      </div>
                                      <input
                                        type="checkbox"
                                        checked={editCanSubmitCreditRequest}
                                        onChange={(e) => setEditCanSubmitCreditRequest(e.target.checked)}
                                        className="w-5 h-5 accent-amber-500 cursor-pointer"
                                      />
                                    </div>

                                    <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200 flex items-center justify-between">
                                      <div>
                                        <div className="font-bold text-zinc-800">مشاهده سوابق اعتباری مشتریان</div>
                                        <div className="text-[11px] text-zinc-500 mt-0.5">دستور اجازه استعلام و مشاهده سوابق چک و اقساط گذشته مشتری</div>
                                      </div>
                                      <input
                                        type="checkbox"
                                        checked={editCanViewCustomerCreditHistory}
                                        onChange={(e) => setEditCanViewCustomerCreditHistory(e.target.checked)}
                                        className="w-5 h-5 accent-amber-500 cursor-pointer"
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Subtab: Required Credit Docs */}
                              {partnerSubTab === 'required_docs' && (
                                <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                                  <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                    <FileText size={16} className="text-amber-600" />
                                    <span>مدارک و تضامین الزامی برای تشکیل پرونده اعتباری</span>
                                  </h4>

                                  <div className="space-y-3 text-xs">
                                    <label className="block font-bold text-zinc-700">فهرست مدارک الزامی از مشتری جهت تشکیل پرونده:</label>
                                    <div className="flex flex-wrap gap-2">
                                      {editCreditRequiredDocs.map((doc, idx) => (
                                        <span key={idx} className="bg-amber-50 text-amber-900 border border-amber-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-2">
                                          <span>{doc}</span>
                                          <button
                                            type="button"
                                            onClick={() => setEditCreditRequiredDocs(editCreditRequiredDocs.filter((_, i) => i !== idx))}
                                            className="text-amber-700 hover:text-rose-600"
                                          >
                                            <X size={12} />
                                          </button>
                                        </span>
                                      ))}
                                    </div>

                                    <div className="flex gap-2 pt-2">
                                      <input
                                        type="text"
                                        id="newCreditDocInput"
                                        placeholder="نام مدرک جدید (مثلاً: گواهی کسر از حقوق)"
                                        className="flex-1 bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-amber-500"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const el = document.getElementById('newCreditDocInput') as HTMLInputElement;
                                          if (el && el.value.trim()) {
                                            setEditCreditRequiredDocs([...editCreditRequiredDocs, el.value.trim()]);
                                            el.value = '';
                                          }
                                        }}
                                        className="bg-amber-500 hover:bg-amber-600 text-zinc-950 font-bold px-4 py-2 rounded-xl text-xs transition"
                                      >
                                        + افزودن مدرک
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}

                          {/* Subtab: Feature Access */}
                          {partnerSubTab === 'feature_access' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                <Shield size={16} className="text-amber-600" />
                                <span>تنظیمات دقیق دسترسی‌ها و فیچرهای پنل اعتباری</span>
                              </h4>

                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                                {Object.entries(editFeatureToggles).map(([key, value]) => {
                                  let label = key;
                                  if (key === 'viewLedger') label = 'مشاهده دفترچه اقساط';
                                  else if (key === 'viewAccountBalance') label = 'مشاهده مانده اعتباری';
                                  else if (key === 'viewCreditDossier') label = 'مشاهده پرونده اعتباری';
                                  else if (key === 'viewInstallments') label = 'مشاهده جدول اقساط';
                                  else if (key === 'viewChecks') label = 'مشاهده وضعیت چک‌ها';
                                  else if (key === 'viewContracts') label = 'مشاهده قرارداد اعتباری';
                                  else if (key === 'viewDocuments') label = 'مشاهده مدارک بارگذاری شده';
                                  else if (key === 'uploadDocuments') label = 'بارگذاری مدارک جدید';
                                  else if (key === 'allowCustomerRegister') label = 'ثبت مشتری اعتباری جدید';
                                  else if (key === 'allowViewReports') label = 'مشاهده گزارشات مالی اعتباری';

                                  return (
                                    <div
                                      key={key}
                                      onClick={() => setEditFeatureToggles({ ...editFeatureToggles, [key]: !value })}
                                      className={`p-3 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                                        value
                                          ? 'bg-amber-50 border-amber-300 text-amber-950 font-bold'
                                          : 'bg-zinc-50 border-zinc-200 text-zinc-500'
                                      }`}
                                    >
                                      <span>{label}</span>
                                      <input
                                        type="checkbox"
                                        checked={value}
                                        readOnly
                                        className="w-4 h-4 accent-amber-500 cursor-pointer"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* SUB-TAB: Operational Policies (سیاست‌های عملیاتی) */}
                          {partnerSubTab === 'ops' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex justify-between items-center">
                                <span className="flex items-center gap-1.5">
                                  <Settings size={16} className="text-indigo-600" />
                                  <span>تنظیمات سیاست‌های عملیاتی و فرآیندهای زنجیره‌ای همکار</span>
                                </span>
                              </h4>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {[
                                  { key: 'allowCustomerRegister', label: 'اجازه ثبت مستقیم مشتری در سیستم', desc: 'امکان ورود دستی اطلاعات هویتی و شماره تماس مشتریان توسط همکار' },
                                  { key: 'allowDossierCreation', label: 'اجازه تشکیل پرونده اقساط و بارگذاری مدارک مشتری', desc: 'امکان تکمیل فرم تضمین‌ها و الصاق مستندات' },
                                  { key: 'allowCreditRequest', label: 'اجازه ارسال درخواست گشایش حد اعتباری', desc: 'ارسال تقاضای خرید اعتباری عمده به کارتابل دفتر مرکزی' },
                                  { key: 'allowViewHistory', label: 'اجازه مشاهده سوابق مالی و تراکنش‌های تاریخی مشتریان', desc: 'گزارش خریدها و پرداخت‌های گذشته مشتری همکار' },
                                  { key: 'allowViewReports', label: 'اجازه مشاهده گزارش‌های فروش و کمیسیون‌های دریافتی همکار', desc: 'آمار نموداری فروش و درصدهای کارمزد ماهانه' },
                                  { key: 'allowFuturePolicy', label: 'اجازه پیاده‌سازی و اعمال خودکار قوانین پیشرفته آینده', desc: 'اعمال فیلترهای هوشمند خودکار بدون نیاز به تایید دستی' },
                                ].map((toggle) => (
                                  <div key={toggle.key} className="flex items-start justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-200">
                                    <div className="ml-4">
                                      <div className="text-[12px] font-bold text-zinc-700">{toggle.label}</div>
                                      <div className="text-[10px] text-zinc-400 mt-0.5">{toggle.desc}</div>
                                    </div>
                                    <input 
                                      type="checkbox" 
                                      checked={!!editFeatureToggles[toggle.key as keyof AgentFeatureToggles]} 
                                      disabled={!isEditingSettings}
                                      onChange={(e) => {
                                        setEditFeatureToggles(prev => ({
                                          ...prev,
                                          [toggle.key]: e.target.checked
                                        }));
                                      }}
                                      className="w-4 h-4 text-zinc-900 border-zinc-300 rounded focus:ring-zinc-950 disabled:opacity-50 cursor-pointer shrink-0 mt-0.5"
                                    />
                                  </div>
                                ))}
                              </div>

                              {/* Save/Edit Actions */}
                              {!isEditingSettings ? (
                                <button
                                  onClick={() => setIsEditingSettings(true)}
                                  className="w-full bg-zinc-900 hover:bg-black text-white text-[13px] font-bold py-2.5 rounded-xl transition shadow-sm"
                                >
                                  فعال‌سازی ویرایش سیاست‌ها
                                </button>
                              ) : (
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => savePartnerSettings(agent.id)}
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-bold py-2.5 rounded-xl transition shadow"
                                  >
                                    ذخیره و اعمال سیاست‌ها
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (hasUnsavedChanges()) {
                                        if (!window.confirm('تغییرات ذخیره نشده است. آیا قصد خروج بدون ذخیره را دارید؟')) return;
                                      }
                                      setIsEditingSettings(false);
                                      if (initialEditState) {
                                        setEditFeatureToggles(initialEditState.editFeatureToggles);
                                      }
                                    }}
                                    className="flex-1 bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-800 text-[13px] font-bold py-2.5 rounded-xl transition shadow-sm"
                                  >
                                    انصراف
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* SUB-TAB: Cooperation Terms (تنظیمات همکاری) */}
                          {partnerSubTab === 'terms' && (() => {
                            const currentDebt = appState.invoices
                              .filter(inv => inv.type === 'sell' && inv.personId === agent.id && !inv.isProInvoice)
                              .reduce((sum, inv) => sum + (inv.totalAmount - (inv.paidAmount || 0)), 0);
                            const remainingCredit = editCreditLimit - currentDebt;
                            const isOverlimit = editCreditLimit < currentDebt;

                            return (
                              <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                                <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex justify-between items-center">
                                  <span className="flex items-center gap-1.5">
                                    <Sliders size={16} className="text-indigo-600" />
                                    <span>تنظیم سقف‌های اعتباری، کارمزد، دیرکرد و سطوح همکاری</span>
                                  </span>
                                </h4>

                                {/* Alerts */}
                                {isOverlimit && (
                                  <div className="bg-rose-50 text-rose-700 text-xs p-3 rounded-xl border border-rose-200 flex items-start gap-2 leading-relaxed">
                                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-600" />
                                    <div>
                                      <strong>هشدار بدهی انباشته:</strong> بدهی فعلی همکار ({currentDebt.toLocaleString()} ریال) بیشتر از سقف مجاز تعیین‌شده است. ثبت سفارشات نسیه تا زمان تسویه مسدود خواهد ماند.
                                    </div>
                                  </div>
                                )}

                                {!editDocsApproved && (
                                  <div className="bg-amber-50 text-amber-700 text-xs p-3 rounded-xl border border-amber-200 flex items-start gap-2 leading-relaxed">
                                    <ShieldAlert size={15} className="mt-0.5 shrink-0 text-amber-600" />
                                    <div>
                                      <strong>مدارک تایید نشده نهایی:</strong> به دلیل وضعیت پرونده "معلق"، استفاده از حد اعتبار، صدور دفترچه‌های قسط و تراکنش‌های کیف پول در پرتال همکار به صورت موقت مسدود است.
                                    </div>
                                  </div>
                                )}

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-3">
                                    <div>
                                      <label className="block text-xs text-zinc-600 font-bold mb-1">سقف اعتبار خرید مجاز (ریال)</label>
                                      <FormattedNumericInput 
                                        value={editCreditLimit} 
                                        disabled={!isEditingSettings}
                                        onEnableEdit={() => setIsEditingSettings(true)}
                                        isCurrency={true}
                                        onChange={(val) => setEditCreditLimit(val)}
                                      />
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="block text-xs text-zinc-600 font-bold mb-1">مهلت تسویه فاکتورهای نسیه (روز)</label>
                                        <FormattedNumericInput 
                                          value={editDelayDays} 
                                          disabled={!isEditingSettings}
                                          onEnableEdit={() => setIsEditingSettings(true)}
                                          onChange={(val) => setEditDelayDays(val)}
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs text-zinc-600 font-bold mb-1">ارزیابی ریسک همکار</label>
                                        <select
                                          value={editRiskLevel}
                                          disabled={!isEditingSettings}
                                          onChange={(e) => setEditRiskLevel(e.target.value as any)}
                                          className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-2 text-[13px] font-bold outline-none focus:border-zinc-900 disabled:opacity-70"
                                        >
                                          <option value="low">کم‌ریسک (سبز)</option>
                                          <option value="medium">ریسک متوسط (زرد)</option>
                                          <option value="high">پُرریسک (قرمز)</option>
                                        </select>
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="block text-xs text-zinc-600 font-bold mb-1 flex justify-between">
                                          <span>نرخ جریمه دیرکرد (%)</span>
                                        </label>
                                        <FormattedNumericInput 
                                          value={editPenaltyRate} 
                                          disabled={!isEditingSettings}
                                          onEnableEdit={() => setIsEditingSettings(true)}
                                          isPercent={true}
                                          onChange={(val) => setEditPenaltyRate(val)}
                                        />
                                      </div>
                                      <div>
                                        <label className="block text-xs text-zinc-600 font-bold mb-1">حداکثر درصد کمیسیون مجاز این نماینده (%)</label>
                                        <FormattedNumericInput 
                                          value={editCommissionRate} 
                                          disabled={!isEditingSettings}
                                          onEnableEdit={() => setIsEditingSettings(true)}
                                          isPercent={true}
                                          onChange={(val) => setEditCommissionRate(val)}
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-3 bg-zinc-50/60 p-4 rounded-xl border border-zinc-200 self-start">
                                    <div className="text-xs font-bold text-zinc-600 border-b pb-1">دسترسی به بخش‌های عملیاتی کلان</div>
                                    
                                    <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-zinc-200">
                                      <div>
                                        <div className="text-[12px] font-bold text-zinc-700">دسترسی عمده‌فروشی آفلاین</div>
                                        <div className="text-[10px] text-zinc-400">امکان خرید نقدی و نسیه عمده همکار</div>
                                      </div>
                                      <input 
                                        type="checkbox" 
                                        checked={editWholesale} 
                                        disabled={!isEditingSettings}
                                        onChange={(e) => setEditWholesale(e.target.checked)}
                                        className="w-4 h-4 text-zinc-900 border-zinc-300 rounded focus:ring-zinc-950 disabled:opacity-50 cursor-pointer"
                                      />
                                    </div>

                                    <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-zinc-200">
                                      <div>
                                        <div className="text-[12px] font-bold text-zinc-700">دسترسی فروش اقساطی</div>
                                        <div className="text-[10px] text-zinc-400">امکان ثبت دفترچه اقساط برای مشتریان</div>
                                      </div>
                                      <input 
                                        type="checkbox" 
                                        checked={editInstallment} 
                                        disabled={!isEditingSettings}
                                        onChange={(e) => setEditInstallment(e.target.checked)}
                                        className="w-4 h-4 text-zinc-900 border-zinc-300 rounded focus:ring-zinc-950 disabled:opacity-50 cursor-pointer"
                                      />
                                    </div>

                                    <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-zinc-200">
                                      <div>
                                        <div className="text-[12px] font-bold text-zinc-700">وضعیت تایید مدارک و ضمانت‌نامه‌ها</div>
                                        <div className="text-[10px] text-zinc-400">تایید نهایی مدارک همکار بابت گشایش سقف خرید</div>
                                      </div>
                                      <input 
                                        type="checkbox" 
                                        checked={editDocsApproved} 
                                        disabled={!isEditingSettings}
                                        onChange={(e) => setEditDocsApproved(e.target.checked)}
                                        className="w-4 h-4 text-zinc-900 border-zinc-300 rounded focus:ring-zinc-950 disabled:opacity-50 cursor-pointer"
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* Save/Edit Actions */}
                                {!isEditingSettings ? (
                                  <button
                                    onClick={() => setIsEditingSettings(true)}
                                    className="w-full bg-zinc-900 hover:bg-black text-white text-[13px] font-bold py-2.5 rounded-xl transition shadow-sm"
                                  >
                                    فعال‌سازی ویرایش شرایط همکاری
                                  </button>
                                ) : (
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => savePartnerSettings(agent.id)}
                                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-bold py-2.5 rounded-xl transition shadow"
                                    >
                                      ذخیره و اعمال تنظیمات همکاری
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (hasUnsavedChanges()) {
                                          if (!window.confirm('تغییرات ذخیره نشده است. آیا قصد خروج بدون ذخیره را دارید؟')) return;
                                        }
                                        setIsEditingSettings(false);
                                        if (initialEditState) {
                                          setEditWholesale(initialEditState.editWholesale);
                                          setEditInstallment(initialEditState.editInstallment);
                                          setEditDocsApproved(initialEditState.editDocsApproved);
                                          setEditCreditLimit(initialEditState.editCreditLimit);
                                          setEditDelayDays(initialEditState.editDelayDays);
                                          setEditPenaltyRate(initialEditState.editPenaltyRate);
                                          setEditCommissionRate(initialEditState.editCommissionRate);
                                          setEditRiskLevel(initialEditState.editRiskLevel);
                                        }
                                      }}
                                      className="flex-1 bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-800 text-[13px] font-bold py-2.5 rounded-xl transition shadow-sm"
                                    >
                                      انصراف
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* SUB-TAB: Dedicated Portal Links (ارتباط با نماینده) */}
                          {partnerSubTab === 'portal_link' && (() => {
                            const agencyRoleParam = activeUnit === 'sales_agents' ? 'sales' : activeUnit === 'credit_agents' ? 'credit' : '';
                            const roleParamStr = agencyRoleParam ? `&agency_role=${agencyRoleParam}` : '';
                            const baseUrl = import.meta.env.VITE_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
                            const secretLink = `${baseUrl}/?agent_token=${agent.id}${roleParamStr}${agent.name ? `&name=${encodeURIComponent(agent.name)}` : ''}${agent.agentDetails?.storeName ? `&store=${encodeURIComponent(agent.agentDetails.storeName)}` : ''}`;
                            
                            return (
                              <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                                <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex justify-between items-center">
                                  <span className="flex items-center gap-1.5">
                                    <Link size={16} className="text-indigo-600" />
                                    <span>مدیریت لینک‌های اختصاصی و توکن‌های پورتال همکار</span>
                                  </span>
                                </h4>

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                  {/* Create link form */}
                                  <div className="bg-indigo-50/40 border border-indigo-200/60 p-4 rounded-xl space-y-3 self-start">
                                    <div className="text-[12px] font-bold text-indigo-950 flex items-center gap-1">
                                      <Plus size={14} />
                                      <span>صدور توکن و لینک دسترسی جدید</span>
                                    </div>
                                    <div>
                                      <label className="block text-[10px] text-zinc-600 mb-1">نام یا شرح کاربری لینک دسترسی</label>
                                      <input 
                                        type="text" 
                                        value={newPortalLinkDesc} 
                                        onChange={(e) => setNewPortalLinkDesc(e.target.value)}
                                        placeholder="مثلاً: پرتال فاکتورهای شعبه مرکزی"
                                        className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500" 
                                      />
                                    </div>
                                    <button
                                      disabled={!newPortalLinkDesc.trim()}
                                      onClick={() => {
                                        const desc = newPortalLinkDesc.trim();
                                         if (!desc) return;
                                         if (editPortalLinks.some(l => l.description === desc)) {
                                           alert("خطا: لینکی با این عنوان قبلا ثبت شده است (جلوگیری از ایجاد لینک تکراری).");
                                           return;
                                         }
                                         const newLinkId = `LNK_${Date.now()}`;
                                         const baseUrl = import.meta.env.VITE_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
                                         const newLinkUrl = `${baseUrl}/?agent_token=${agent.id}&link_id=${newLinkId}${roleParamStr}${agent.name ? `&name=${encodeURIComponent(agent.name)}` : ''}`;
                                         const newLink: AgentPortalLink = {
                                           id: newLinkId,
                                           url: newLinkUrl,
                                           createdAt: getCurrentJalaliDate(),
                                           isActive: true,
                                           description: desc
                                         };
                                         const updatedLinks = [...editPortalLinks, newLink];
                                         setEditPortalLinks(updatedLinks);
                                         setNewPortalLinkDesc('');

                                         // Save immediately to BusinessPartner (SSOT)
                                         const bp = appState.businessPartners?.find(p => p.personId === agent.id);
                                         if (bp) {
                                           const engine = DataIntegrityEngine.getInstance();
                                           const res = engine.updateBusinessPartner(bp.id, { portalLinks: updatedLinks }, appState as any);
                                           if (res.success && typeof onSave === "function") {
                                             onSave(res.updatedState as any);
                                             if (typeof saveAppState === "function") {
                                               saveAppState(res.updatedState as any);
                                             }
                                           }
                                         }
                                         alert("✅ لینک اختصاصی جدید ایجاد و بلافاصله ذخیره شد.");}}
                                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-300 text-white text-xs font-bold py-2 rounded-lg shadow-sm transition disabled:cursor-not-allowed"
                                    >
                                      ایجاد لینک جدید
                                    </button>
                                  </div>

                                  {/* List of active links */}
                                  <div className="lg:col-span-2 space-y-3">
                                    <div className="bg-indigo-50/60 border border-indigo-200/80 p-3 rounded-xl space-y-2">
                                      <div className="text-xs font-bold text-indigo-950 flex items-center justify-between">
                                        <span>🔗 لینک پیش‌فرض و مادام‌العمر پرتال</span>
                                        <span className="text-[9px] bg-indigo-200/60 text-indigo-800 px-1.5 py-0.5 rounded font-mono font-bold">Default Permanent Link</span>
                                      </div>
                                      <div className="flex items-center justify-between bg-white border border-indigo-150 rounded-lg p-2 gap-2">
                                        <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[280px]" dir="ltr">
                                          {secretLink}
                                        </span>
                                        <div className="flex gap-1 shrink-0">
                                          <button
                                            onClick={() => {
                                              navigator.clipboard.writeText(secretLink);
                                              alert('لینک اختصاصی همکار با موفقیت کپی شد.');
                                            }}
                                            className="bg-zinc-100 hover:bg-zinc-200 text-zinc-800 px-2.5 py-1 rounded-md text-[10px] font-bold transition flex items-center gap-1"
                                          >
                                            <Copy size={11} />
                                            <span>کپی</span>
                                          </button>
                                          <a
                                            href={`https://wa.me/?text=${encodeURIComponent(`سلام همکار گرامی، لینک اختصاصی پرتال شما:\n\n${secretLink}`)}`}
                                            target="_blank"
                                            referrerPolicy="no-referrer"
                                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-md text-[10px] font-bold transition flex items-center gap-1"
                                          >
                                            <Share2 size={11} />
                                            <span>ارسال</span>
                                          </a>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Custom links list */}
                                    <div className="space-y-2">
                                      <span className="text-xs font-bold text-zinc-600 block">توکن‌ها و مسیرهای فرعی فعال همکار</span>
                                      <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                                        {editPortalLinks.map((link) => (
                                          <div key={link.id} className="bg-zinc-50 border border-zinc-200 rounded-lg p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                              <div className="flex items-center gap-2">
                                                <span className={`w-1.5 h-1.5 rounded-full ${link.isActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                                <span className="text-xs font-bold text-zinc-700 truncate block max-w-[200px]">{link.description || 'بدون عنوان'}</span>
                                                <span className="text-[9px] text-zinc-400 font-mono">ایجاد: {link.createdAt}</span>
                                              </div>
                                              <span className="text-[9px] text-zinc-400 font-mono truncate block max-w-[280px]" dir="ltr">{link.url}</span>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                                              <button
                                                onClick={() => {
                                                  const updatedLinks = editPortalLinks.map(p => p.id === link.id ? { ...p, isActive: !p.isActive } : p);
                                                  setEditPortalLinks(updatedLinks);
                                                  const bp = appState.businessPartners?.find(p => p.personId === agent.id);
                                                  if (bp) {
                                                    const engine = DataIntegrityEngine.getInstance();
                                                    const res = engine.updateBusinessPartner(bp.id, { portalLinks: updatedLinks }, appState as any);
                                                    if (res.success && typeof onSave === "function") {
                                                      onSave(res.updatedState as any);
                                                      if (typeof saveAppState === "function") {
                                                        saveAppState(res.updatedState as any);
                                                      }
                                                    }
                                                  }
                                                }}
                                                className={`px-2 py-0.5 rounded text-[9px] font-bold border transition ${
                                                  link.isActive 
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' 
                                                    : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                                }`}
                                              >
                                                {link.isActive ? 'فعال' : 'غیرفعال'}
                                              </button>
                                              <button
                                                onClick={() => {
                                                  navigator.clipboard.writeText(link.url);
                                                  alert('لینک کپی شد.');
                                                }}
                                                className="bg-white border border-zinc-250 hover:bg-zinc-100 text-zinc-700 p-1 rounded-md transition"
                                                title="کپی لینک"
                                              >
                                                <Copy size={11} />
                                              </button>
                                              <button
                                                onClick={() => {
                                                  if (window.confirm('آیا قصد حذف این لینک را دارید؟')) {
                                                    const updatedLinks = editPortalLinks.filter(p => p.id !== link.id);
                                                    setEditPortalLinks(updatedLinks);
                                                    const bp = appState.businessPartners?.find(p => p.personId === agent.id);
                                                    if (bp) {
                                                      const engine = DataIntegrityEngine.getInstance();
                                                      const res = engine.updateBusinessPartner(bp.id, { portalLinks: updatedLinks }, appState as any);
                                                      if (res.success && typeof onSave === "function") {
                                                        onSave(res.updatedState as any);
                                                        if (typeof saveAppState === "function") {
                                                          saveAppState(res.updatedState as any);
                                                        }
                                                      }
                                                    }
                                                  }
                                                }}
                                                className="bg-white border border-zinc-250 hover:bg-rose-50 text-rose-600 p-1 rounded-md transition"
                                                title="حذف"
                                              >
                                                <Trash2 size={11} />
                                              </button>
                                            </div>
                                          </div>
                                        ))}
                                        {editPortalLinks.length === 0 && (
                                          <div className="text-[10px] text-zinc-400 text-center py-4 italic bg-zinc-50 rounded-lg border border-dashed border-zinc-200">
                                            هیچ لینک فرعی ایجاد نشده است. از فرم بغل اقدام کنید.
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Save/Edit Actions */}
                                {!isEditingSettings ? (
                                  <button
                                    onClick={() => setIsEditingSettings(true)}
                                    className="w-full bg-zinc-900 hover:bg-black text-white text-[13px] font-bold py-2.5 rounded-xl transition shadow-sm"
                                  >
                                    فعال‌سازی ویرایش لینک‌ها
                                  </button>
                                ) : (
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => savePartnerSettings(agent.id)}
                                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-bold py-2.5 rounded-xl transition shadow"
                                    >
                                      ذخیره و اعمال لینک‌ها
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (hasUnsavedChanges()) {
                                          if (!window.confirm('تغییرات ذخیره نشده است. آیا قصد خروج بدون ذخیره را دارید؟')) return;
                                        }
                                        setIsEditingSettings(false);
                                        if (initialEditState) {
                                          setEditPortalLinks(initialEditState.editPortalLinks);
                                        }
                                      }}
                                      className="flex-1 bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-800 text-[13px] font-bold py-2.5 rounded-xl transition shadow-sm"
                                    >
                                      انصراف
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* SUB-TAB 2: Credit Document & Guarantee Policy Rules (No identity info here) */}
                          {partnerSubTab === 'docs' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <div className="bg-blue-50/60 border border-blue-200/80 p-3.5 rounded-xl flex items-start gap-2.5 text-xs text-blue-900 leading-relaxed">
                                <FileText size={18} className="text-blue-600 shrink-0 mt-0.5" />
                                <div>
                                  <strong>اتاق فرمان — سیاست‌های مدارک اعتباری و تضامین:</strong>
                                  <p className="mt-1 text-blue-800">
                                    اطلاعات هویتی، مدارک شخصی و پرونده ثبتی ضامنین در <strong>بخش اول (مشخصات فردی و هویتی)</strong> نگهداری می‌شوند. این صفحه صرفاً مربوط به تنظیم ضوابط و سیاست‌های تضامین اعتباری است.
                                  </p>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 space-y-3">
                                  <div className="font-bold text-xs text-zinc-800 border-b pb-2 flex items-center justify-between">
                                    <span>ضریب تضامین و چک‌های صیادی مجاز</span>
                                    <span className="text-[10px] text-zinc-400 font-mono">Policy Engine</span>
                                  </div>
                                  <div className="space-y-2 text-xs">
                                    <div className="flex justify-between items-center bg-white p-2.5 rounded-lg border border-zinc-150">
                                      <span className="text-zinc-600">ضریب چک صیادی نسبت به سقف اعتبار:</span>
                                      <span className="font-bold text-zinc-800 font-mono">۱.۲ برابر</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-white p-2.5 rounded-lg border border-zinc-150">
                                      <span className="text-zinc-600">وضعیت استعلام صیادی بنفش:</span>
                                      <span className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">الزامی (وضعیت سفید)</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-white p-2.5 rounded-lg border border-zinc-150">
                                      <span className="text-zinc-600">تعداد ضامن معتبر مورد نیاز:</span>
                                      <span className="font-bold text-zinc-800 font-mono">حداقل ۱ ضامن کارمندی/کاسب</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 space-y-3">
                                  <div className="font-bold text-xs text-zinc-800 border-b pb-2 flex items-center justify-between">
                                    <span>فهرست مدارک اعتباری الزامی</span>
                                    <span className="text-[10px] text-zinc-400">سیستمی</span>
                                  </div>
                                  <div className="space-y-1.5 text-xs">
                                    <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-zinc-150">
                                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                      <span className="text-zinc-700 font-medium">گزارش اعتبارسنجی بانکی (بتای رفاه/آیس)</span>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-zinc-150">
                                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                      <span className="text-zinc-700 font-medium">تصویر جواز کسب یا گواهی اشتغال به کار</span>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-zinc-150">
                                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                      <span className="text-zinc-700 font-medium">تصویر سند/اجاره‌نامه محل کسب</span>
                                    </div>
                                  </div>

                                  <button
                                    onClick={() => setCommandCenterTab('dossier')}
                                    className="w-full mt-2 bg-white hover:bg-zinc-100 text-zinc-800 text-xs font-bold py-2 rounded-lg border border-zinc-300 transition flex items-center justify-center gap-1.5 shadow-sm"
                                  >
                                    <FileText size={13} className="text-indigo-600" />
                                    <span>مشاهده اسناد هویتی در پرونده (بخش ۱)</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* SUB-TAB 3: Wallet transaction ledger and wallet charging */}
                          {partnerSubTab === 'wallet' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2">شارژ و تراکنش‌های کیف پول همکار</h4>

                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {/* Charge Form */}
                                <div className="bg-amber-50/40 border border-amber-200/60 p-4 rounded-xl space-y-3">
                                  <div className="text-[13px] font-bold text-amber-900 flex items-center gap-1">
                                    <Coins size={14} />
                                    <span>شارژ مستقیم کیف پول</span>
                                  </div>

                                  <div>
                                    <label className="block text-[10px] text-zinc-600 mb-1">مبلغ شارژ (ریال) *</label>
                                    <input 
                                      type="number" 
                                      value={chargeAmount || ''} 
                                      onChange={(e) => setChargeAmount(parseInt(e.target.value || '0'))}
                                      placeholder="مبلغ به ریال"
                                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-[13px] font-mono outline-none focus:border-amber-500" 
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[10px] text-zinc-600 mb-1">واریز به حساب صندوق / بانک *</label>
                                    <select 
                                      value={chargeAccount}
                                      onChange={(e) => setChargeAccount(e.target.value)}
                                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
                                    >
                                      <option value="SUB_BANK_MELI">بانک ملی ایران (صرفاً تستی)</option>
                                      <option value="SUB_CASH_MAIN">صندوق نقدی اصلی</option>
                                    </select>
                                  </div>

                                  <div>
                                    <label className="block text-[10px] text-zinc-600 mb-1">شرح سند حسابداری</label>
                                    <input 
                                      type="text" 
                                      value={chargeDesc} 
                                      onChange={(e) => setChargeDesc(e.target.value)}
                                      placeholder="مثلاً: شارژ اعتباری بابت واریز حواله"
                                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 text-[13px] outline-none" 
                                    />
                                  </div>

                                  <button
                                    onClick={() => handleChargeWallet(agent.id)}
                                    className="w-full bg-amber-600 hover:bg-amber-500 text-white text-[13px] font-bold py-2 rounded-lg shadow-sm transition"
                                  >
                                    ثبت سند حسابداری شارژ کیف پول
                                  </button>
                                </div>

                                {/* Transaction Ledger list */}
                                <div className="lg:col-span-2 space-y-2">
                                  <div className="text-xs font-bold text-zinc-600 flex justify-between">
                                    <span>دفتر کل معین کیف پول همکار (تراکنش‌های زنجیر شده)</span>
                                    <span>موجودی واقعی: {dynamicWalletBal.toLocaleString()} ریال</span>
                                  </div>

                                  <div className="bg-zinc-50 border border-zinc-150 rounded-xl overflow-hidden text-right max-h-[220px] overflow-y-auto">
                                    <table className="w-full text-right border-collapse text-xs">
                                      <thead className="bg-zinc-100 text-zinc-600 font-bold sticky top-0 border-b">
                                        <tr>
                                          <th className="p-2">تاریخ</th>
                                          <th className="p-2">شرح تراکنش</th>
                                          <th className="p-2 text-left">بدهکار (خرید)</th>
                                          <th className="p-2 text-left">بستانکار (واریز)</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-zinc-200 bg-white">
                                        {getWalletTransactions(agent.id).map(t => (
                                          <tr key={t.id} className="hover:bg-zinc-50">
                                            <td className="p-2 font-mono text-zinc-600">{t.date}</td>
                                            <td className="p-2 font-medium text-zinc-700">{t.description}</td>
                                            <td className="p-2 text-left text-rose-600 font-mono font-bold">
                                              {t.debit > 0 ? t.debit.toLocaleString() : '-'}
                                            </td>
                                            <td className="p-2 text-left text-emerald-600 font-mono font-bold">
                                              {t.credit > 0 ? t.credit.toLocaleString() : '-'}
                                            </td>
                                          </tr>
                                        ))}
                                        {getWalletTransactions(agent.id).length === 0 && (
                                          <tr>
                                            <td colSpan={4} className="text-center py-6 text-zinc-400 text-[13px]">
                                              هیچ واریزی یا خریدی با این کیف پول ثبت نشده است
                                            </td>
                                          </tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* SUB-TAB 4: Overdue and penalties engine */}
                          {partnerSubTab === 'penalties' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2">محاسبه خودکار وجه التزام و هشدارهای پیامکی پلکانی</h4>

                              <div className="space-y-3">
                                {overdueInvoices.map(inv => (
                                  <div key={inv.id} className="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200 grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
                                    <div>
                                      <div className="text-[13px] font-bold text-zinc-800">فاکتور شماره {inv.invoiceNumber}</div>
                                      <div className="text-xs text-zinc-400 mt-1">تاریخ فاکتور: {inv.date}</div>
                                      <div className="text-xs text-zinc-400">مهلت مجاز: {agent.allowedDelayDays || 30} روز</div>
                                    </div>

                                    <div className="text-right sm:text-center">
                                      <div className="text-[10px] text-zinc-400">کل مبلغ / مانده بدهی</div>
                                      <div className="text-[13px] font-mono font-bold text-zinc-700">
                                        {inv.totalAmount.toLocaleString()} / {inv.unpaid.toLocaleString()} ریال
                                      </div>
                                      <div className="text-xs text-rose-500 font-bold mt-1">
                                        {inv.overdueDays} روز دیرکرد ثبت شده
                                      </div>
                                    </div>

                                    <div>
                                      <span className={`inline-block text-[10px] font-bold px-2 py-1 rounded border ${inv.alertColor}`}>
                                        {inv.alertStage}
                                      </span>
                                      <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1">
                                        <MessageSquare size={10} />
                                        <span>پیامک خودکار مرحله فعال شد</span>
                                      </div>
                                    </div>

                                    <div className="text-left">
                                      <div className="text-[10px] text-zinc-400">جریمه دیرکرد محاسبه شده:</div>
                                      <div className="text-[13px] font-mono font-bold text-rose-600 mb-2">
                                        {inv.calculatedPenalty.toLocaleString()} ریال
                                      </div>

                                      {inv.calculatedPenalty > 0 && (
                                        <button
                                          onClick={() => handleApplyPenalty(agent.id, inv.id, inv.calculatedPenalty, inv.invoiceNumber)}
                                          className="bg-rose-100 text-rose-700 hover:bg-rose-200 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-all"
                                        >
                                          صدور سند جریمه دیرکرد
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}

                                {overdueInvoices.length === 0 && (
                                  <div className="text-center py-6 text-zinc-400 text-[13px] bg-zinc-50 border border-dashed border-zinc-200 rounded-xl">
                                    هیچ فاکتور معوقه‌ای با مهلت پرداخت بیش از {agent.allowedDelayDays || 30} روز برای این همکار یافت نشد. وضعیت حساب کاملاً نرمال است.
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* SUB-TAB 5: History of Command Changes */}
                          {partnerSubTab === 'history' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                <History size={16} className="text-indigo-600" />
                                <span>تاریخچه تغییر قوانین اعتباری و دستورات صادره برای همکار</span>
                              </h4>

                              {(() => {
                                const historyLogs = partner?.creditExtension?.history || [];
                                if (historyLogs.length === 0) {
                                  return (
                                    <div className="text-center py-8 text-zinc-400 text-[13px] bg-zinc-50 border border-dashed border-zinc-200 rounded-xl">
                                      هیچ سابقه تغییر دستوری برای این همکار تا کنون ثبت نشده است.
                                    </div>
                                  );
                                }

                                return (
                                  <div className="bg-zinc-50 border border-zinc-200 rounded-xl overflow-hidden">
                                    <table className="w-full text-right border-collapse text-xs">
                                      <thead className="bg-zinc-100 text-zinc-700 font-bold border-b">
                                        <tr>
                                          <th className="p-3">تاریخ تغییر</th>
                                          <th className="p-3">تغییر دهنده</th>
                                          <th className="p-3">سقف اعتبار قبلی / جدید</th>
                                          <th className="p-3">شرح تغییر و دستور</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-zinc-200 bg-white">
                                        {historyLogs.map((log: any, idx: number) => (
                                          <tr key={idx} className="hover:bg-zinc-50">
                                            <td className="p-3 font-mono text-zinc-600">{log.date}</td>
                                            <td className="p-3 font-bold text-zinc-800">{log.changedBy || 'مدیر سیستم'}</td>
                                            <td className="p-3 font-mono">
                                              <span className="text-rose-600 line-through ml-1">{(log.previousLimit || 0).toLocaleString()}</span>
                                              <span className="text-emerald-600 font-bold">{(log.newLimit || 0).toLocaleString()} ریال</span>
                                            </td>
                                            <td className="p-3 text-zinc-700">{log.notes || 'تغییر سقف اعتباری و دسترسی‌ها'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                          {/* Unified Save/Edit Actions Bar for Credit Mode */}
                          {partnerSubTab !== 'overview' && partnerSubTab !== 'history' && (
                            <div className="bg-white p-4 rounded-2xl border border-zinc-200 mt-4 shadow-sm">
                              {!isEditingSettings ? (
                                <button
                                  onClick={() => setIsEditingSettings(true)}
                                  className="w-full bg-zinc-900 hover:bg-black text-white text-[13px] font-bold py-2.5 rounded-xl transition shadow-sm flex items-center justify-center gap-2"
                                >
                                  <Sliders size={16} />
                                  <span>⚙️ فعال‌سازی ویرایش سیاست‌ها و تنظیمات اعتباری</span>
                                </button>
                              ) : (
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => savePartnerSettings(agent.id)}
                                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-zinc-950 text-[13px] font-black py-2.5 rounded-xl transition shadow"
                                  >
                                    💾 ذخیره و اعمال تنظیمات همکار
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (hasUnsavedChanges()) {
                                        if (!window.confirm('تغییرات ذخیره نشده است. آیا قصد خروج بدون ذخیره را دارید؟')) return;
                                      }
                                      setIsEditingSettings(false);
                                      if (initialEditState) {
                                        setEditWholesale(initialEditState.editWholesale);
                                        setEditInstallment(initialEditState.editInstallment);
                                        setEditDocsApproved(initialEditState.editDocsApproved);
                                        setEditCreditLimit(initialEditState.editCreditLimit);
                                        setEditDelayDays(initialEditState.editDelayDays);
                                        setEditPenaltyRate(initialEditState.editPenaltyRate);
                                        setEditCommissionRate(initialEditState.editCommissionRate);
                                        setEditRiskLevel(initialEditState.editRiskLevel);
                                        setEditCalculators(initialEditState.editCalculators);
                                        setEditFeatureToggles(initialEditState.editFeatureToggles);
                                        setEditPortalLinks(initialEditState.editPortalLinks);
                                        setEditMaxPerDossierLimit(initialEditState.editMaxPerDossierLimit);
                                        setEditAllowedTenors(initialEditState.editAllowedTenors);
                                        setEditCreditRequiredDocs(initialEditState.editCreditRequiredDocs);
                                        setEditCreditPlans(initialEditState.editCreditPlans);
                                        setEditNesyehPurchaseLimit(initialEditState.editNesyehPurchaseLimit);
                                        setEditSpecialDiscountRate(initialEditState.editSpecialDiscountRate);
                                        setEditBlockOnOverdue(initialEditState.editBlockOnOverdue);
                                        setEditCanPlaceOrders(initialEditState.editCanPlaceOrders);
                                        setEditCanSubmitPurchaseRequest(initialEditState.editCanSubmitPurchaseRequest);
                                        setEditCanViewPersonalLedger(initialEditState.editCanViewPersonalLedger);
                                        setEditAllowedCategories(initialEditState.editAllowedCategories);
                                        setEditRequiredAgencyDocs(initialEditState.editRequiredAgencyDocs);
                                        setEditAllowedDepositAccounts(initialEditState.editAllowedDepositAccounts);
                                      }
                                    }}
                                    className="flex-1 bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-800 text-[13px] font-bold py-2.5 rounded-xl transition shadow-sm"
                                  >
                                    ❌ انصراف
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* SECTION B: SALES AGENT COMMAND CENTER */}
                      {effectiveRoleMode === 'sales' && (
                        <div className="space-y-4">
                          {/* Edit Mode Quick Info Banner for Sales */}
                          {partnerSubTab !== 'overview' && partnerSubTab !== 'history' && (
                            <>
                              {!isEditingSettings ? (
                                <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
                                  <div className="flex items-center gap-3">
                                    <div className="p-2 bg-amber-500/10 text-amber-600 rounded-xl shrink-0">
                                      <Sliders size={18} />
                                    </div>
                                    <div className="text-right">
                                      <h5 className="font-bold text-[13px]">حالت «فقط مشاهده» فعال است</h5>
                                      <p className="text-[11px] text-zinc-500 mt-0.5">در این حالت، تنظیمات فروشگاه قابل تغییر نیستند. جهت اعمال هرگونه تغییر بر روی سیاست‌ها، سقف خرید نسیه، یا دسترسی‌ها دکمه ویرایش را کلیک کنید.</p>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setIsEditingSettings(true)}
                                    className="bg-amber-500 hover:bg-amber-600 text-zinc-950 font-black text-xs px-4 py-2 rounded-xl shadow-sm transition shrink-0 flex items-center gap-1.5"
                                  >
                                    <span>🔓 فعال‌سازی حالت ویرایش</span>
                                  </button>
                                </div>
                              ) : (
                                <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
                                  <div className="flex items-center gap-3">
                                    <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-xl shrink-0">
                                      <CheckCircle2 size={18} className="text-emerald-600" />
                                    </div>
                                    <div className="text-right">
                                      <h5 className="font-bold text-[13px] text-emerald-800">حالت «ویرایش تنظیمات فروشگاه» فعال است</h5>
                                      <p className="text-[11px] text-emerald-600 mt-0.5">تغییرات خود را در هر یک از بخش‌ها اعمال کنید و سپس برای ثبت نهایی دکمه ذخیره را کلیک کنید.</p>
                                    </div>
                                  </div>
                                  <div className="flex gap-2 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => savePartnerSettings(agent.id)}
                                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs px-4 py-2 rounded-xl shadow-md transition flex items-center gap-1.5"
                                    >
                                      <span>💾 ذخیره تغییرات</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (hasUnsavedChanges()) {
                                          if (!window.confirm('تغییرات ذخیره نشده است. آیا قصد خروج بدون ذخیره را دارید؟')) return;
                                        }
                                        setIsEditingSettings(false);
                                        if (initialEditState) {
                                          setEditWholesale(initialEditState.editWholesale);
                                          setEditInstallment(initialEditState.editInstallment);
                                          setEditDocsApproved(initialEditState.editDocsApproved);
                                          setEditCreditLimit(initialEditState.editCreditLimit);
                                          setEditDelayDays(initialEditState.editDelayDays);
                                          setEditPenaltyRate(initialEditState.editPenaltyRate);
                                          setEditCommissionRate(initialEditState.editCommissionRate);
                                          setEditRiskLevel(initialEditState.editRiskLevel);
                                          setEditCalculators(initialEditState.editCalculators);
                                          setEditFeatureToggles(initialEditState.editFeatureToggles);
                                          setEditPortalLinks(initialEditState.editPortalLinks);
                                          setEditMaxPerDossierLimit(initialEditState.editMaxPerDossierLimit);
                                          setEditAllowedTenors(initialEditState.editAllowedTenors);
                                          setEditCreditRequiredDocs(initialEditState.editCreditRequiredDocs);
                                          setEditCreditPlans(initialEditState.editCreditPlans);
                                          setEditNesyehPurchaseLimit(initialEditState.editNesyehPurchaseLimit);
                                          setEditSpecialDiscountRate(initialEditState.editSpecialDiscountRate);
                                          setEditBlockOnOverdue(initialEditState.editBlockOnOverdue);
                                          setEditCanPlaceOrders(initialEditState.editCanPlaceOrders);
                                          setEditCanSubmitPurchaseRequest(initialEditState.editCanSubmitPurchaseRequest);
                                          setEditCanViewPersonalLedger(initialEditState.editCanViewPersonalLedger);
                                          setEditAllowedCategories(initialEditState.editAllowedCategories);
                                          setEditRequiredAgencyDocs(initialEditState.editRequiredAgencyDocs);
                                          setEditAllowedDepositAccounts(initialEditState.editAllowedDepositAccounts);
                                        }
                                      }}
                                      className="bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-700 font-bold text-xs px-4 py-2 rounded-xl transition"
                                    >
                                      <span>انصراف</span>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}

                          {/* Sales Overview Subtab */}
                          {partnerSubTab === 'overview' && (() => {
                            const currentDebt = appState.invoices
                              .filter(inv => inv.type === 'sell' && inv.personId === agent.id && !inv.isProInvoice)
                              .reduce((sum, inv) => sum + (inv.totalAmount - (inv.paidAmount || 0)), 0);
                            const remainingNesyeh = editNesyehPurchaseLimit - currentDebt;
                            return (
                              <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                                <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex justify-between items-center">
                                  <span className="flex items-center gap-1.5">
                                    <ShoppingBag size={16} className="text-blue-600" />
                                    <span>داشبورد اتاق فرمان نماینده فروش</span>
                                  </span>
                                  <span className="text-xs text-zinc-400 font-mono">کد همکار: {agent.code}</span>
                                </h4>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-blue-50/50 p-3 rounded-xl border border-blue-200/60">
                                  <div className="bg-white p-3 rounded-xl border border-zinc-150 flex flex-col">
                                    <span className="text-[10px] text-zinc-500 font-bold">سقف خرید نسیه / اعتباری</span>
                                    <span className="text-sm font-mono font-black text-blue-700 mt-1">{editNesyehPurchaseLimit.toLocaleString()} ریال</span>
                                  </div>
                                  <div className="bg-white p-3 rounded-xl border border-zinc-150 flex flex-col">
                                    <span className="text-[10px] text-zinc-500 font-bold">درصد تخفیف ویژه همکار</span>
                                    <span className="text-sm font-mono font-black text-emerald-700 mt-1">{editSpecialDiscountRate}%</span>
                                  </div>
                                  <div className="bg-white p-3 rounded-xl border border-zinc-150 flex flex-col">
                                    <span className="text-[10px] text-zinc-500 font-bold">اعتبار خرید نسیه باقی‌مانده</span>
                                    <span className={`text-sm font-mono font-black mt-1 ${remainingNesyeh < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                      {remainingNesyeh.toLocaleString()} ریال
                                    </span>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 space-y-2 text-xs">
                                    <div className="font-bold text-zinc-800 border-b pb-1 flex justify-between">
                                      <span>دستورات و وضعیت‌های تجاری</span>
                                      <ShoppingCart size={14} className="text-blue-600" />
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-zinc-100">
                                      <span>امکان ثبت سفارش خرید:</span>
                                      <span className={`font-bold ${editCanPlaceOrders ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {editCanPlaceOrders ? 'فعال' : 'مسدود'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-zinc-100">
                                      <span>انسداد خودکار در سررسید معوق:</span>
                                      <span className={`font-bold ${editBlockOnOverdue ? 'text-rose-600' : 'text-zinc-500'}`}>
                                        {editBlockOnOverdue ? 'فعال (خودکار)' : 'غیرفعال'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between py-1">
                                      <span>امکان ثبت درخواست خرید:</span>
                                      <span className={`font-bold ${editCanSubmitPurchaseRequest ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {editCanSubmitPurchaseRequest ? 'مجاز' : 'غیرمجاز'}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 space-y-2 text-xs">
                                    <div className="font-bold text-zinc-800 border-b pb-1 flex justify-between">
                                      <span>دسترسی‌ها و تنوع کالا</span>
                                      <Layers size={14} className="text-purple-600" />
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-zinc-100">
                                      <span>دسته‌بندی‌های مجاز کالا:</span>
                                      <span className="font-bold text-zinc-800">{editAllowedCategories.length} دسته‌بندی</span>
                                    </div>
                                    <div className="flex justify-between py-1 border-b border-zinc-100">
                                      <span>مشاهده ریزحساب شخصی:</span>
                                      <span className={`font-bold ${editCanViewPersonalLedger ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {editCanViewPersonalLedger ? 'مجاز' : 'غیرمجاز'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between py-1">
                                      <span>حساب‌های واریزی مجاز:</span>
                                      <span className="font-mono font-bold text-indigo-700">{editAllowedDepositAccounts.length} حساب</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Subtab: Sales Rules */}
                          {partnerSubTab === 'sales_rules' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                <Tag size={16} className="text-blue-600" />
                                <span>سقف خرید نسیه و درصد تخفیف ویژه نمایندگی</span>
                              </h4>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                                <div className="space-y-1.5">
                                  <label className="block text-zinc-700 font-bold">سقف خرید نسیه / اعتباری همکار (ریال)</label>
                                  <FormattedNumericInput
                                    value={editNesyehPurchaseLimit}
                                    disabled={!isEditingSettings}
                                    onEnableEdit={() => setIsEditingSettings(true)}
                                    isCurrency={true}
                                    onChange={(val) => setEditNesyehPurchaseLimit(val)}
                                    textColorClass="text-blue-700"
                                  />
                                  <p className="text-[10px] text-zinc-400">حداکثر مانده بدهی نسیه مجاز برای ثبت سفارشات خرید جدید</p>
                                </div>

                                <div className="space-y-1.5">
                                  <label className="block text-zinc-700 font-bold">درصد تخفیف ویژه نمایندگی (%)</label>
                                  <FormattedNumericInput
                                    value={editSpecialDiscountRate}
                                    disabled={!isEditingSettings}
                                    onEnableEdit={() => setIsEditingSettings(true)}
                                    isPercent={true}
                                    onChange={(val) => setEditSpecialDiscountRate(val)}
                                    textColorClass="text-emerald-700"
                                  />
                                  <p className="text-[10px] text-zinc-400">تخفیف مستقیم روی فاکتورهای عمده‌فروشی این نماینده</p>
                                </div>
                              </div>

                              <div className="p-3.5 bg-rose-50/50 rounded-xl border border-rose-100 flex items-center justify-between text-xs mt-2">
                                <div>
                                  <div className="font-bold text-rose-900">مسدودسازی خودکار ثبت سفارش در صورت داشتن بدهی معوق</div>
                                  <div className="text-[11px] text-rose-700 mt-0.5">در صورت سررسید شدن فاکتور نسیه، امکان ثبت سفارش جدید کاملاً قفل می‌شود</div>
                                </div>
                                <input
                                  type="checkbox"
                                  checked={editBlockOnOverdue}
                                  disabled={!isEditingSettings}
                                  onChange={(e) => setEditBlockOnOverdue(e.target.checked)}
                                  className="w-5 h-5 accent-rose-600 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                />
                              </div>
                            </div>
                          )}

                          {/* Subtab: Order Controls */}
                          {partnerSubTab === 'order_controls' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                <ShoppingCart size={16} className="text-blue-600" />
                                <span>کنترل‌های ثبت سفارش و مشاهده حساب شخصی</span>
                              </h4>

                              <div className="space-y-3 text-xs">
                                <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200 flex items-center justify-between">
                                  <div>
                                    <div className="font-bold text-zinc-800">امکان ثبت سفارش خرید کالا</div>
                                    <div className="text-[11px] text-zinc-500 mt-0.5">اجازه دادن به نماینده برای ثبت فاکتور عمده‌فروشی یا خرید کالا</div>
                                  </div>
                                  <input
                                    type="checkbox"
                                    checked={editCanPlaceOrders}
                                    disabled={!isEditingSettings}
                                    onChange={(e) => setEditCanPlaceOrders(e.target.checked)}
                                    className="w-5 h-5 accent-blue-600 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                  />
                                </div>

                                <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200 flex items-center justify-between">
                                  <div>
                                    <div className="font-bold text-zinc-800">امکان ثبت درخواست خرید (پیش‌فاکتور)</div>
                                    <div className="text-[11px] text-zinc-500 mt-0.5">ثبت درخواست ثبت سفارش اولیه جهت استعلام موجودی و قیمت</div>
                                  </div>
                                  <input
                                    type="checkbox"
                                    checked={editCanSubmitPurchaseRequest}
                                    disabled={!isEditingSettings}
                                    onChange={(e) => setEditCanSubmitPurchaseRequest(e.target.checked)}
                                    className="w-5 h-5 accent-blue-600 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                  />
                                </div>

                                <div className="p-3.5 bg-zinc-50 rounded-xl border border-zinc-200 flex items-center justify-between">
                                  <div>
                                    <div className="font-bold text-zinc-800">دسترسی به مشاهده ریزحساب شخصی</div>
                                    <div className="text-[11px] text-zinc-500 mt-0.5">اجازه مشاهده فاکتورها، بدهی‌ها و گردش مانده در پنل اختصاصی</div>
                                  </div>
                                  <input
                                    type="checkbox"
                                    checked={editCanViewPersonalLedger}
                                    disabled={!isEditingSettings}
                                    onChange={(e) => setEditCanViewPersonalLedger(e.target.checked)}
                                    className="w-5 h-5 accent-blue-600 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Subtab: Allowed Categories */}
                          {partnerSubTab === 'allowed_categories' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                <Layers size={16} className="text-blue-600" />
                                <span>دسته‌بندی‌های کالایی مجاز برای خرید نماینده</span>
                              </h4>

                              <div className="space-y-3 text-xs">
                                <label className="block font-bold text-zinc-700">انتخاب دسته‌بندی‌هایی که این نماینده مجاز به سفارش آن‌ها است:</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                  {(appState.productCategories && appState.productCategories.length > 0
                                    ? appState.productCategories
                                    : ['طلا و جواهرات', 'کالای دیجیتال', 'لوازم خانگی', 'خودرو و وسایل نقلیه', 'ابزار و تجهیزات']
                                  ).map(catName => {
                                    const isSelected = editAllowedCategories.includes(catName);
                                    return (
                                      <div
                                        key={catName}
                                        onClick={() => {
                                          if (!isEditingSettings) return;
                                          if (isSelected) {
                                            setEditAllowedCategories(editAllowedCategories.filter(c => c !== catName));
                                          } else {
                                            setEditAllowedCategories([...editAllowedCategories, catName]);
                                          }
                                        }}
                                        className={`p-3 rounded-xl border transition flex items-center justify-between ${
                                          isSelected
                                            ? 'bg-blue-50 border-blue-300 text-blue-950 font-bold'
                                            : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                                        } ${!isEditingSettings ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                      >
                                        <span>{catName}</span>
                                        {isSelected ? <CheckCircle2 size={14} className="text-blue-600" /> : <Circle size={14} className="text-zinc-400" />}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Subtab: Agency Documents */}
                          {partnerSubTab === 'agency_docs' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                <FileText size={16} className="text-blue-600" />
                                <span>مدارک و ضمانت‌نامه‌های الزامی اخذ شده نمایندگی</span>
                              </h4>

                              <div className="space-y-3 text-xs">
                                <label className="block font-bold text-zinc-700">فهرست اسناد ثبتی و حقوقی نمایندگی:</label>
                                <div className="flex flex-wrap gap-2">
                                  {editRequiredAgencyDocs.map((doc, idx) => (
                                    <span key={idx} className="bg-blue-50 text-blue-900 border border-blue-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-2">
                                      <span>{doc}</span>
                                      <button
                                        type="button"
                                        disabled={!isEditingSettings}
                                        onClick={() => setEditRequiredAgencyDocs(editRequiredAgencyDocs.filter((_, i) => i !== idx))}
                                        className={`text-blue-700 hover:text-rose-600 ${!isEditingSettings ? 'opacity-40 cursor-not-allowed' : ''}`}
                                      >
                                        <X size={12} />
                                      </button>
                                    </span>
                                  ))}
                                </div>

                                <div className="flex gap-2 pt-2">
                                  <input
                                    type="text"
                                    id="newAgencyDocInput"
                                    disabled={!isEditingSettings}
                                    placeholder={isEditingSettings ? "عنوان مدرک نمایندگی جدید" : "جهت افزودن مدرک، ابتدا حالت ویرایش را فعال کنید"}
                                    className="flex-1 bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                                  />
                                  <button
                                    type="button"
                                    disabled={!isEditingSettings}
                                    onClick={() => {
                                      const el = document.getElementById('newAgencyDocInput') as HTMLInputElement;
                                      if (el && el.value.trim()) {
                                        setEditRequiredAgencyDocs([...editRequiredAgencyDocs, el.value.trim()]);
                                        el.value = '';
                                      }
                                    }}
                                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 text-white font-bold px-4 py-2 rounded-xl text-xs transition disabled:cursor-not-allowed"
                                  >
                                    + افزودن مدرک
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Subtab: Deposit Accounts */}
                          {partnerSubTab === 'deposit_accounts' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                <CreditCard size={16} className="text-blue-600" />
                                <span>حساب‌های بانکی و صندوق‌های مجاز جهت واریز وجه</span>
                              </h4>

                              <div className="space-y-3 text-xs">
                                <label className="block font-bold text-zinc-700">حساب‌هایی که نماینده مجاز به اعلام واریزی به آن‌ها می‌باشد:</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {[
                                    { id: 'SUB_BANK_MELI', name: 'حساب جاری بانک ملی ایران (حساب اصلی)' },
                                    { id: 'SUB_CASH_MAIN', name: 'صندوق نقدی دفتر مرکزی' },
                                    { id: 'SUB_BANK_MELLAT', name: 'حساب بانک ملت شبا اختصاصی' }
                                  ].map(acc => {
                                    const isSelected = editAllowedDepositAccounts.includes(acc.id);
                                    return (
                                      <div
                                        key={acc.id}
                                        onClick={() => {
                                          if (!isEditingSettings) return;
                                          if (isSelected) {
                                            setEditAllowedDepositAccounts(editAllowedDepositAccounts.filter(id => id !== acc.id));
                                          } else {
                                            setEditAllowedDepositAccounts([...editAllowedDepositAccounts, acc.id]);
                                          }
                                        }}
                                        className={`p-3 rounded-xl border transition flex items-center justify-between ${
                                          isSelected
                                            ? 'bg-indigo-50 border-indigo-300 text-indigo-950 font-bold'
                                            : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                                        } ${!isEditingSettings ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                                      >
                                        <span>{acc.name}</span>
                                        {isSelected ? <CheckCircle2 size={14} className="text-indigo-600" /> : <Circle size={14} className="text-zinc-400" />}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Subtab: Sales Portal Link */}
                          {partnerSubTab === 'portal_link' && (() => {
                            const baseUrl = import.meta.env.VITE_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '');
                            const salesSecretLink = `${baseUrl}/?agent_token=${agent.id}&agency_role=sales${agent.name ? `&name=${encodeURIComponent(agent.name)}` : ''}${agent.agentDetails?.storeName ? `&store=${encodeURIComponent(agent.agentDetails.storeName)}` : ''}`;
                            return (
                              <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                                <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                  <Link size={16} className="text-blue-600" />
                                  <span>لینک اختصاصی فروشگاه و ثبت سفارش نماینده</span>
                                </h4>

                                <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-3 text-xs">
                                  <p className="text-zinc-700 leading-relaxed">
                                    لینک اختصاصی کاتالوگ و ثبت سفارشات عمده برای پنل اختصاصی نماینده فروش:
                                  </p>
                                  <div className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-blue-200 font-mono text-blue-700 font-bold">
                                    <span className="flex-1 truncate" dir="ltr">{salesSecretLink}</span>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(salesSecretLink);
                                        alert('لینک اختصاصی فروشگاه کپی گردید.');
                                      }}
                                      className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs hover:bg-blue-700 transition shrink-0"
                                    >
                                      کپی لینک
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Subtab: Sales History */}
                          {partnerSubTab === 'history' && (
                            <div className="bg-white p-5 rounded-2xl border border-zinc-200 space-y-4 shadow-sm">
                              <h4 className="text-[13px] font-bold text-zinc-800 border-b pb-2 flex items-center gap-2">
                                <History size={16} className="text-blue-600" />
                                <span>تاریخچه دستورات و تنظیمات نمایندگی فروش</span>
                              </h4>

                              <div className="text-center py-8 text-zinc-400 text-xs bg-zinc-50 border border-dashed border-zinc-200 rounded-xl">
                                تاریخچه دستورات نمایندگی فروش بر روی پرونده ثبت گردیده و در دسترس می‌باشد.
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* VIEW 3: FINANCIAL DOSSIER */}
                      {commandCenterTab === 'financial' && (
                        <PartnerFinancialDossierModal
                          agent={agent}
                          appState={appState}
                          onClose={() => setCommandCenterTab('command_center')}
                          onUpdateAppState={(newState) => onSave(newState)}
                        />
                      )}
                    </div>
                  );
                })()
              ) : (
                /* REGULAR AGENT LIST VIEW */
                <AgentListTable
                  agents={agents}
                  appState={appState}
                  activeUnit={activeUnit}
                  agentSearchQuery={agentSearchQuery}
                  showAddForm={showAddForm}
                  getPartnerWalletBalance={getPartnerWalletBalance}
                  onSelectAgent={(agentId, tab) => {
                    setSelectedCommandAgentId(agentId);
                    setExpandedAgentId(agentId);
                    setCommandCenterTab(tab);
                    const foundAgent = agents.find(a => a.id === agentId);
                    if (foundAgent) {
                      toggleAgentDetails(foundAgent, true);
                    }
                  }}
                  onDeleteAgent={handleDeleteAgent}
                />
              )}
            </div>
          </>
        )}

        {activeTab === 'credit_files' && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-150 space-y-6">
            <h3 className="text-sm font-bold text-zinc-800">استعلام و تشکیل پرونده اعتباری</h3>
            
            {!foundCustomer && customerStatus !== 'new' && (
              <div className="flex gap-2">
                <input 
                  type="tel" 
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  placeholder="کد ملی مشتری را وارد کنید" 
                  value={inquiryNationalId}
                  onChange={e => setInquiryNationalId(toEnglishDigits(e.target.value).replace(/\D/g, ''))}
                  className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 text-[13px] outline-none font-mono"
                />
                <button onClick={handleInquiry} className="bg-zinc-900 text-white px-6 py-2 rounded-xl text-[13px] font-bold">استعلام</button>
              </div>
            )}

            {customerStatus === 'new' && (
              <div className="space-y-4">
                <p className="text-[13px] text-amber-600 font-bold">مشتری جدید است. لطفاً ثبت‌نام کنید.</p>
                <PersonForm 
                  initialNationalId={inquiryNationalId}
                  existingPersons={appState.persons}
                  onSave={async (personData) => {
                    // Logic to register customer via PersonService and then create credit file
                    const nextCode = generateUniquePersonCode(appState.persons);
                    const newPersonPayload: Partial<Person> = {
                      ...personData as Person,
                      code: nextCode,
                      createdAt: new Date().toISOString(),
                    };
                    try {
                      const savedPerson = await PersonService.createPerson(newPersonPayload);
                      const newState = { ...appState, persons: [...appState.persons, savedPerson] };
                      onSave(newState);
                      setFoundCustomer(savedPerson);
                      setCustomerStatus('existing_no_debt');
                    } catch (err: any) {
                      console.error('Failed to create customer in AgentManager:', err);
                      alert(`خطا در ثبت مشتری در پایگاه‌داده: ${err.message || 'خطای ناشناخته'}`);
                    }
                  }}
                  onCancel={() => setCustomerStatus(null)}
                />
              </div>
            )}

            {foundCustomer && (
              <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-200 space-y-3">
                <div className="text-[13px] font-bold">مشتری: {foundCustomer.name}</div>
                {customerStatus === 'existing_with_debt' && (
                  <p className="text-[13px] text-rose-600">مشتری دارای بدهی فعال است. امکان تشکیل پرونده وجود ندارد.</p>
                )}
                {customerStatus === 'existing_no_debt' && (
                  <button 
                    onClick={() => {
                      const agentPersonId = appState.users?.find(u => u.id === currentUserId)?.personId || 
                        appState.persons.find(p => p.id === currentUserId)?.id || 
                        currentUserId;
                      const matchedPolicy = getMatchingCreditPolicy(0, appState.creditPolicies || []);
                      const newFile: CreditFile = {
                        id: `cf_${Date.now()}`,
                        personId: foundCustomer.id,
                        representativeId: agentPersonId,
                        createdAt: new Date().toISOString(),
                        status: 'draft',
                        requestedAmount: 0,
                        plan: '',
                        agentCommissionAmount: 0,
                        policyId: matchedPolicy.id,
                        policySnapshot: matchedPolicy
                      };
                      CreditPartnerService.createCreditFile(newFile).then(() => {
                        onSave({ ...appState, creditFiles: [...appState.creditFiles, newFile] });
                        alert('پرونده اعتباری با موفقیت ایجاد و در دیتابیس مرکزی ثبت شد.');
                      }).catch((err) => {
                        console.error('Error creating credit file:', err);
                        alert('خطا در ثبت پرونده اعتباری در دیتابیس مرکزی: ' + err.message);
                      });
                    }}
                    className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[13px] font-bold"
                  >
                    ایجاد پرونده اعتباری جدید
                  </button>
                )}
                <button onClick={() => { setFoundCustomer(null); setCustomerStatus(null); setInquiryNationalId(''); }} className="text-[13px] text-zinc-600 underline">بازگشت</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'approvals' && (
          <AgentCommissionPanel
            appState={appState}
            pendingChecks={pendingChecks}
            selectedCheckId={selectedCheckId}
            commissionAmount={commissionAmount}
            netAmount={netAmount}
            onSelectCheck={(checkId, amount) => {
              if (checkId === null) {
                setSelectedCheckId(null);
              } else {
                setSelectedCheckId(checkId);
                setCommissionAmount(0);
                setNetAmount(amount);
              }
            }}
            onChangeCommission={(commission, net) => {
              setCommissionAmount(commission);
              setNetAmount(net);
            }}
            onChangeNet={(net, commission) => {
              setNetAmount(net);
              setCommissionAmount(commission);
            }}
            onApproveCheck={handleApproveCheck}
          />
        )}
      </div>
      </>
      )}
    </div>
  )}

      <AnimatePresence>
        {activeCustomerFolder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col h-[500px]"
            >
              <div className="flex items-center justify-between p-4 border-b border-zinc-100 bg-zinc-50">
                <div>
                  <h3 className="font-sans font-bold text-sm text-zinc-800">پرونده مستندات همکار</h3>
                  <p className="text-xs text-zinc-600 mt-1">مدارک هویتی، اسناد تضامین ملکی یا بانکی بارگذاری شده</p>
                </div>
                <button
                  onClick={() => setActiveCustomerFolder(null)}
                  className="p-2 text-zinc-400 hover:text-red-500 transition-colors rounded-xl hover:bg-red-50"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 flex-1 overflow-y-auto space-y-4">
                {(() => {
                  const person = appState.persons.find(p => p.id === activeCustomerFolder);
                  if (!person) return null;
                  
                  return (
                    <>
                      {/* Upload Section */}
                      <div className="border-2 border-dashed border-zinc-200 rounded-xl p-6 text-center hover:bg-zinc-50 transition cursor-pointer relative">
                        <input 
                          type="file" 
                          multiple
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                              const newAttachments = Array.from(e.target.files).map((file: File) => ({
                                id: `att_${Date.now()}_${Math.random()}`,
                                name: file.name,
                                url: URL.createObjectURL(file),
                                type: file.type,
                                uploadDate: new Date().toISOString()
                              }));
                              
                              const updatedPersons = appState.persons.map(p => 
                                p.id === person.id 
                                  ? { ...p, attachments: [...(p.attachments || []), ...newAttachments] } 
                                  : p
                              );
                              onSave({ ...appState, persons: updatedPersons });
                            }
                          }}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <Upload size={24} className="mx-auto text-zinc-400 mb-2" />
                        <div className="text-[13px] font-bold text-zinc-700">برای بارگذاری کلیک کنید</div>
                        <div className="text-xs text-zinc-400 mt-1">یا فایل‌ها را اینجا رها کنید</div>
                      </div>

                      {/* Attachments List */}
                      <div className="space-y-2">
                        <div className="text-xs font-bold text-zinc-600">مدارک ذخیره شده ({person.attachments?.length || 0})</div>
                        {person.attachments?.map(att => (
                          <div key={att.id} className="flex items-center justify-between p-3 bg-zinc-50 border border-zinc-100 rounded-xl">
                            <div className="flex items-center space-x-3 space-x-reverse">
                              <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-200 flex items-center justify-center">
                                {att.type.startsWith('image/') ? (
                                  <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                                ) : (
                                  <span className="text-[10px] font-mono font-bold text-zinc-600 uppercase">{att.name.split('.').pop()}</span>
                                )}
                              </div>
                              <div className="text-right">
                                <div className="text-[13px] font-bold text-zinc-800 line-clamp-1" dir="ltr">{att.name}</div>
                                <div className="text-[10px] text-zinc-600 mt-0.5">{new Date(att.uploadDate).toLocaleDateString('fa-IR')}</div>
                              </div>
                            </div>
                            <button 
                              onClick={() => {
                                if(safeConfirm('حذف مدرک؟')) {
                                  const updatedPersons = appState.persons.map(p => 
                                    p.id === person.id 
                                      ? { ...p, attachments: p.attachments?.filter(a => a.id !== att.id) } 
                                      : p
                                  );
                                  onSave({ ...appState, persons: updatedPersons });
                                }
                              }}
                              className="p-2 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        {(!person.attachments || person.attachments.length === 0) && (
                          <div className="text-center py-6 text-zinc-400 text-[13px] bg-zinc-50 rounded-xl border border-dashed border-zinc-200">
                            هیچ مدرکی برای این مشتری ثبت نشده است
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Partner Financial Dossier Modal */}
      {selectedDossierAgent && (
        <PartnerFinancialDossierModal
          agent={selectedDossierAgent}
          appState={appState}
          onClose={() => setSelectedDossierAgent(null)}
        />
      )}

      {/* Beta Calculators & Bank Binding Management Modal */}
      <AnimatePresence>
        {showBetaCalcModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 w-full max-w-lg space-y-6 shadow-2xl border border-zinc-100"
            >
              <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
                    <Landmark size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-zinc-900">مدیریت ماشین‌حساب‌های بتا و بانک‌های عامل</h3>
                    <p className="text-xs text-zinc-600 mt-0.5">تعریف بانک‌های عامل ثابت برای هر ماشین‌حساب طرح بتا</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowBetaCalcModal(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 rounded-xl hover:bg-zinc-100 transition"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Add New Beta Calculator Form */}
              <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-3">
                <div className="text-[13px] font-bold text-zinc-800 flex items-center gap-1.5">
                  <Plus size={14} className="text-blue-600" /> تعریف ماشین‌حساب بتای جدید
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-zinc-600 mb-1">عنوان ماشین‌حساب</label>
                    <input 
                      type="text" 
                      placeholder="مثلاً: ماشین حساب بتا - جعفری"
                      value={newBetaCalcName}
                      onChange={(e) => setNewBetaCalcName(e.target.value)}
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-[13px] font-bold text-zinc-800 outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-600 mb-1">بانک عامل (عقد قرارداد)</label>
                    <input 
                      type="text" 
                      placeholder="مثلاً: بانک رفاه - قرارداد جعفری"
                      value={newBetaBankName}
                      onChange={(e) => setNewBetaBankName(e.target.value)}
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-[13px] font-bold text-zinc-800 outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-600 mb-1">حساب معین مرتبط</label>
                    <select
                      value={newBetaAgentBankId}
                      onChange={(e) => setNewBetaAgentBankId(e.target.value)}
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-[13px] font-bold text-zinc-800 outline-none focus:border-blue-500"
                    >
                      <option value="">-- ایجاد خودکار حساب معین جدید --</option>
                      {(appState.subsidiaries || DEFAULT_SUBSIDIARIES).map(sub => (
                        <option key={sub.id} value={sub.id}>
                          {sub.code} - {sub.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!newBetaCalcName.trim() || !newBetaBankName.trim()) {
                      alert('لطفاً عنوان ماشین‌حساب و نام بانک عامل را وارد کنید.');
                      return;
                    }

                    const allSubs = appState.subsidiaries || DEFAULT_SUBSIDIARIES;
                    let targetSubId = newBetaAgentBankId;
                    let updatedSubsidiaries = [...allSubs];

                    if (!targetSubId) {
                      const debtorSubCodes = allSubs
                        .filter(s => s.generalType === 'بدهکاران تجاری' || (s.code && s.code.startsWith('103')))
                        .map(s => parseInt(s.code, 10))
                        .filter(num => !isNaN(num));

                      const maxCode = debtorSubCodes.length > 0 ? Math.max(...debtorSubCodes) : 10309;
                      const nextCode = String(maxCode + 1);
                      targetSubId = `SUB_BETA_${Date.now()}`;

                      const newSubAccount: AccountSubsidiary = {
                        id: targetSubId,
                        generalType: 'بدهکاران تجاری',
                        groupType: 'دارایی‌های جاری',
                        name: `حساب واسط سامانه بتا (${newBetaBankName.trim()})`,
                        code: nextCode
                      };
                      updatedSubsidiaries.push(newSubAccount);
                    }

                    try {
                      await CalculatorService.createCalculator({
                        name: newBetaCalcName.trim(),
                        description: `طرح بتا - ${newBetaBankName.trim()}`,
                        isActive: true,
                        type: 'beta',
                        agentBankId: targetSubId,
                        bankName: newBetaBankName.trim()
                      });

                      const freshCalculators = await CalculatorService.getCalculators();
                      const updatedState = { ...appState, calculators: freshCalculators, subsidiaries: updatedSubsidiaries };
                      onSave(updatedState);
                      setNewBetaCalcName('');
                      setNewBetaBankName('');
                      setNewBetaAgentBankId('');
                    } catch (err: any) {
                      console.error('Failed to create Beta calculator on server:', err);
                      alert(err?.message || 'خطا در ثبت ماشین‌حساب بتا در سرور');
                    }
                  }}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[13px] rounded-xl shadow-sm transition"
                >
                  ثبت ماشین‌حساب بتای جدید
                </button>
              </div>

              {/* List of Existing Beta Calculators */}
              <div className="space-y-3">
                <div className="text-[13px] font-bold text-zinc-700">ماشین‌حساب‌های بتا موجود در سیستم</div>
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1 custom-scrollbar">
                  {appState.calculators?.filter(c => c.type === 'beta' || (c.name || '').includes('بتا')).map(calc => {
                    const subAcc = (appState.subsidiaries || DEFAULT_SUBSIDIARIES).find(s => s.id === calc.agentBankId);
                    return (
                      <div key={calc.id} className="bg-white p-4 rounded-xl border border-zinc-200/60 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between gap-3">
                        <div className="space-y-1 flex-1">
                          <div className="text-[13px] font-bold text-zinc-900">{calc.name}</div>
                          {editingBetaCalcId === calc.id ? (
                            <div className="space-y-2 mt-2">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] font-bold text-zinc-600 mb-0.5">نام بانک عامل / قرارداد</label>
                                  <input 
                                    type="text" 
                                    value={editBetaBankName}
                                    onChange={(e) => setEditBetaBankName(e.target.value)}
                                    placeholder="نام بانک عامل..."
                                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1 text-[13px] font-bold text-zinc-800 outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-bold text-zinc-600 mb-0.5">حساب معین مرتبط</label>
                                  <select
                                    value={editBetaAgentBankId}
                                    onChange={(e) => setEditBetaAgentBankId(e.target.value)}
                                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1 text-[13px] font-bold text-zinc-800 outline-none"
                                  >
                                    {(appState.subsidiaries || DEFAULT_SUBSIDIARIES).map(sub => (
                                      <option key={sub.id} value={sub.id}>
                                        {sub.code} - {sub.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 justify-end pt-1">
                                <button
                                  onClick={async () => {
                                    if (!editBetaBankName.trim()) return;
                                    try {
                                      await CalculatorService.updateCalculator(calc.id, {
                                        bankName: editBetaBankName.trim(),
                                        agentBankId: editBetaAgentBankId
                                      });
                                      const freshCalculators = await CalculatorService.getCalculators();
                                      const updatedState = { ...appState, calculators: freshCalculators };
                                      onSave(updatedState);
                                      setEditingBetaCalcId(null);
                                    } catch (err: any) {
                                      console.error('Failed to update Beta calculator on server:', err);
                                      alert(err?.message || 'خطا در به‌روزرسانی ماشین‌حساب بتا در سرور');
                                    }
                                  }}
                                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition"
                                >
                                  ذخیره تغییرات
                                </button>
                                <button
                                  onClick={() => setEditingBetaCalcId(null)}
                                  className="px-3 py-1 bg-zinc-200 hover:bg-zinc-300 text-zinc-600 text-xs font-bold rounded-lg transition"
                                >
                                  لغو
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md inline-block border border-emerald-100">
                                بانک عامل: {calc.bankName || 'بانک رفاه'}
                              </div>
                              <div className="text-xs text-zinc-600">
                                حساب معین مرتبط: <span className="font-bold text-zinc-700">{subAcc?.name || 'تعریف‌نشده'}</span> (کد معین: <span className="font-bold text-blue-700">{subAcc?.code || '-'}</span>)
                              </div>
                            </div>
                          )}
                        </div>
                        {editingBetaCalcId !== calc.id && (
                          <button
                            onClick={() => {
                              setEditingBetaCalcId(calc.id);
                              setEditBetaBankName(calc.bankName || 'بانک رفاه');
                              setEditBetaAgentBankId(calc.agentBankId || '');
                            }}
                            className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold rounded-xl transition"
                          >
                            ویرایش
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => setShowBetaCalcModal(false)}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[13px] rounded-xl transition"
                >
                  بستن
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Onboarding & Contract Dossier Modal */}
      {onboardingData && (
        <NesyehPartnerOnboardingModal
          state={appState}
          partner={onboardingData.partner}
          person={onboardingData.person}
          activeUnit={activeUnit}
          onClose={() => setOnboardingData(null)}
          onSave={handleSaveOnboarding}
        />
      )}

      {/* Contract Settings Modal */}
      {editingNesyehPartner && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-zinc-200 text-right space-y-4">
            
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                <Settings className="w-4 h-4 text-teal-600" />
                تنظیمات قرارداد نسیه: {editingNesyehPartner.profile?.partnerName || editingNesyehPartner.id}
              </h3>
              <button
                onClick={() => setEditingNesyehPartner(null)}
                className="text-zinc-400 hover:text-zinc-600 text-xs cursor-pointer font-bold"
              >
                بستن ×
              </button>
            </div>

            <form onSubmit={handleSaveNesyehSettings} className="space-y-4 text-xs">
              
              <div>
                <label className="block font-bold text-zinc-700 mb-1">سقف خرید نسیه (ریال):</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={nesyehFormData.creditLimit !== undefined ? Number(nesyehFormData.creditLimit).toLocaleString('en-US') : '0'}
                  onChange={e => {
                    const rawValue = e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '');
                    const numValue = rawValue ? parseInt(rawValue, 10) : 0;
                    setNesyehFormData({ ...nesyehFormData, creditLimit: numValue });
                  }}
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-zinc-800 font-mono font-bold focus:outline-none focus:border-teal-500 text-left"
                  dir="ltr"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-zinc-700 mb-1">مهلت پرداخت تسویه (روز):</label>
                  <select
                    value={nesyehFormData.paymentTermDays}
                    onChange={e => setNesyehFormData({ ...nesyehFormData, paymentTermDays: Number(e.target.value) })}
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-zinc-800 font-mono focus:outline-none focus:border-teal-500 cursor-pointer"
                  >
                    {Array.from({ length: 30 }, (_, i) => i + 1).map(day => (
                      <option key={day} value={day}>{day} روزه</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-zinc-700 mb-1">درصد جریمه تاخیر ماهانه (%):</label>
                  <select
                    value={nesyehFormData.lateFeePercentage}
                    onChange={e => setNesyehFormData({ ...nesyehFormData, lateFeePercentage: parseFloat(e.target.value) || 0.5 })}
                    className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-zinc-800 font-mono focus:outline-none focus:border-teal-500 cursor-pointer text-left"
                    dir="ltr"
                  >
                    {Array.from({ length: 20 }, (_, i) => {
                      const val = parseFloat(((i + 1) * 0.1).toFixed(1));
                      return (
                        <option key={val} value={val}>
                          {val} %
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200 flex items-center justify-between">
                <div>
                  <span className="font-bold text-zinc-800 block">اجازه ثبت سفارش خرید جدید</span>
                  <span className="text-[10px] text-zinc-500">فعال بودن ثبت خرید نسیه توسط این نماینده</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nesyehFormData.isPurchaseAllowed}
                    onChange={e => setNesyehFormData({ ...nesyehFormData, isPurchaseAllowed: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                </label>
              </div>

              <div>
                <label className="block font-bold text-zinc-700 mb-1">توضیحات و ملاحظات قرارداد:</label>
                <textarea
                  rows={3}
                  value={nesyehFormData.contractNotes || ''}
                  onChange={e => setNesyehFormData({ ...nesyehFormData, contractNotes: e.target.value })}
                  placeholder="یادداشت‌های اختصاصی قرارداد نسیه..."
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-xl p-3 text-zinc-800 focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setEditingNesyehPartner(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  ذخیره تنظیمات قرارداد
                </button>
              </div>


            </form>
          </div>
        </div>
      )}

      {/* Role Revocation Confirmation Modal */}
      <AnimatePresence>
        {roleRevocationAgentId && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-zinc-200 text-right space-y-5"
            >
              <div className="flex items-center gap-3 border-b border-zinc-100 pb-3 text-red-600">
                <AlertTriangle className="w-6 h-6 shrink-0" />
                <h3 className="text-sm font-bold">تأیید لغو نقش نمایندگی</h3>
              </div>
              
              <div className="text-xs text-zinc-600 leading-relaxed space-y-2">
                <p>
                  آیا از لغو نقش <span className="font-bold text-zinc-900">{activeUnit === 'sales_agents' ? 'نماینده فروش' : 'نماینده اعتباری'}</span> برای همکار گرامی <span className="font-bold text-zinc-900">«{effectivePersons.find(p => p.id === roleRevocationAgentId)?.name || 'شخص انتخاب شده'}»</span> اطمینان دارید؟
                </p>
                <p className="bg-zinc-50 border border-zinc-200 p-3 rounded-xl text-[11px] text-zinc-500">
                  💡 تمام اطلاعات هویتی، اسناد، پرونده‌ها و سوابق تراکنش‌های مالی این همکار در سیستم به صورت کامل حفظ خواهد شد و این عمل صرفاً نقش جاری را لغو می‌کند.
                </p>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setRoleRevocationAgentId(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs cursor-pointer transition"
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={() => executeRoleRevocation(roleRevocationAgentId)}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md cursor-pointer transition flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  بله، لغو نقش نمایندگی
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Role Revocation Error Alert Modal */}
      <AnimatePresence>
        {roleRevocationError && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-zinc-200 text-right space-y-4"
            >
              <div className="flex items-center gap-2.5 text-rose-600">
                <ShieldAlert className="w-6 h-6 shrink-0" />
                <h3 className="text-sm font-bold">عدم دسترسی کافی</h3>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed">
                {roleRevocationError}
              </p>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setRoleRevocationError(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs cursor-pointer transition"
                >
                  فهمیدم
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Role Revocation Success Alert Modal */}
      <AnimatePresence>
        {roleRevocationSuccess && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-zinc-200 text-right space-y-4"
            >
              <div className="flex items-center gap-2.5 text-emerald-600">
                <CheckCircle className="w-6 h-6 shrink-0" />
                <h3 className="text-sm font-bold">عملیات موفق</h3>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed">
                {roleRevocationSuccess}
              </p>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setRoleRevocationSuccess(null)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer transition"
                >
                  باشه
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reset Agent Password Confirmation Modal */}
      <AnimatePresence>
        {showResetConfirmModal && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-zinc-200 text-right space-y-5"
            >
              <div className="flex items-center gap-3 border-b border-zinc-100 pb-3 text-purple-700">
                <KeyRound className="w-6 h-6 shrink-0" />
                <h3 className="text-sm font-bold">تأیید بازنشانی و ساخت رمز عبور جدید</h3>
              </div>
              
              <div className="text-xs text-zinc-600 leading-relaxed space-y-2">
                <p>
                  رمز عبور فعلی این نماینده باطل شده و یک رمز جدید ساخته می‌شود. آیا مطمئن هستید؟
                </p>
                <div className="bg-purple-50 border border-purple-200 p-3 rounded-xl text-[11px] text-purple-900 space-y-1">
                  <div><strong>نماینده:</strong> {showResetConfirmModal.name}</div>
                  <div><strong>نام کاربری / شناسه ورود:</strong> <span className="font-mono font-bold">{showResetConfirmModal.mobile || showResetConfirmModal.name}</span></div>
                  <div className="text-purple-700 mt-1">💡 بلافاصله پس از تأیید، رمز جدید تولید شده و اطلاعات حساب جهت اشتراک‌گذاری به شما نمایش داده خواهد شد.</div>
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-zinc-100">
                <button
                  type="button"
                  disabled={isResettingPassword}
                  onClick={() => setShowResetConfirmModal(null)}
                  className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs cursor-pointer transition disabled:opacity-50"
                >
                  انصراف
                </button>
                <button
                  type="button"
                  disabled={isResettingPassword}
                  onClick={() => handleResetAgentPassword(showResetConfirmModal)}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md cursor-pointer transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isResettingPassword ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>در حال تولید رمز جدید...</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      <span>تأیید و ساخت رمز جدید</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Agent User Account Credentials Modal */}
      <AgentCredentialsModal
        isOpen={Boolean(newlyCreatedAgentCredentials)}
        onClose={() => setNewlyCreatedAgentCredentials(null)}
        agentName={newlyCreatedAgentCredentials?.name || ''}
        loginIdentifier={newlyCreatedAgentCredentials?.loginIdentifier || ''}
        generatedPassword={newlyCreatedAgentCredentials?.password}
      />
    </div>
  );
}
