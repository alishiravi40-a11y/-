/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { AppState, Calculator, BusinessPartner, AgentCalculatorOverride, Person } from '../types';
import { DEFAULT_CALCULATOR_SETTINGS, resolveEffectiveCalculatorSettings, resolveCalculatorType, getAgentCalculatorOverride, getActiveCalculatorOverridesCount, hasActiveCalculatorOverrides } from '../utils/creditCalculatorEngine';
import { CalculatorService } from '../services/calculatorService';
import { 
  Calculator as CalculatorIcon, 
  Sliders, 
  UserCheck, 
  AlertTriangle, 
  CheckCircle2, 
  History, 
  Building2, 
  Search, 
  Plus, 
  Edit3, 
  Trash2,
  Check, 
  X, 
  RotateCcw,
  Percent,
  Layers,
  ShieldAlert,
  Info,
  ChevronRight,
  ChevronLeft,
  Loader2,
  RefreshCw
} from 'lucide-react';

interface CalculatorManagementCenterProps {
  state: AppState;
  onUpdateState: (newStateOrUpdater: AppState | ((prev: AppState) => AppState)) => void;
  currentUserRole?: string;
}

interface PendingChangeRecord {
  type: 'global_settings' | 'calculator_config' | 'agent_override';
  title: string;
  targetId?: string;
  targetName?: string;
  partnerId?: string;
  partnerName?: string;
  changes: {
    fieldLabel: string;
    fieldName: string;
    oldValue: string | number | boolean | undefined;
    newValue: string | number | boolean | undefined;
  }[];
  applyCallback: (reason: string) => Promise<void> | void;
}

interface AuditLogEntry {
  id: string;
  timestampIso: string;
  actor: string;
  type: 'global_settings' | 'calculator_config' | 'agent_override';
  targetName: string;
  changesSummary: string;
  reason?: string;
}

export const CalculatorManagementCenter: React.FC<CalculatorManagementCenterProps> = ({
  state,
  onUpdateState,
  currentUserRole = 'admin',
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'calculators' | 'general' | 'agents' | 'history'>('calculators');

  // Loading & error state for server operations
  const [isLoadingCalculators, setIsLoadingCalculators] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Search & Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);

  // Modal State for Confirmation
  const [pendingChange, setPendingChange] = useState<PendingChangeRecord | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('تغییرات با موفقیت ذخیره شد');

  // Modal State for Adding/Editing Calculator
  const [editingCalculatorModal, setEditingCalculatorModal] = useState<{
    isOpen: boolean;
    isNew: boolean;
    calcData: Partial<Calculator>;
  }>({
    isOpen: false,
    isNew: false,
    calcData: {},
  });

  // Modal State for Delete Confirmation
  const [deletingCalculator, setDeletingCalculator] = useState<Calculator | null>(null);

  // Editing Global Settings Form State
  const [globalForm, setGlobalForm] = useState({
    sadiBazaarBaseRate: state.settings?.sadiBazaarBaseRate ?? DEFAULT_CALCULATOR_SETTINGS.sadiBazaarBaseRate,
    pelkaniTier1BaseRate: state.settings?.pelkaniTier1BaseRate ?? DEFAULT_CALCULATOR_SETTINGS.pelkaniTier1BaseRate,
    pelkaniTier2BaseRate: state.settings?.pelkaniTier2BaseRate ?? DEFAULT_CALCULATOR_SETTINGS.pelkaniTier2BaseRate,
    pelkaniTier3BaseRate: state.settings?.pelkaniTier3BaseRate ?? DEFAULT_CALCULATOR_SETTINGS.pelkaniTier3BaseRate,
    betaBankFeeRate: state.settings?.betaBankFeeRate ?? DEFAULT_CALCULATOR_SETTINGS.betaBankFeeRate,
  });

  // Local Audit Logs state initialized from settings if available
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => {
    return (state.settings as any)?.calculatorAuditLogs || [
      {
        id: 'log-init-1',
        timestampIso: new Date().toISOString(),
        actor: 'مدیر سیستم',
        type: 'global_settings',
        targetName: 'تنظیمات پایه نرخ‌ها',
        changesSummary: 'ثبت اولین نسخه پیکربندی Resolver مرکزمحور ماشین‌حساب‌ها',
        reason: 'راه‌اندازی معماری جدید مدیریت نرخ‌ها'
      }
    ];
  });

  // Helper to trigger toast
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 4000);
  };

  // Fetch calculators from backend
  const refreshCalculatorsFromServer = useCallback(async () => {
    setIsLoadingCalculators(true);
    setServerError(null);
    try {
      const serverCalculators = await CalculatorService.getCalculators();
      onUpdateState(prev => ({
        ...prev,
        calculators: serverCalculators,
      }));
    } catch (err: any) {
      console.error('Failed to load calculators from server:', err);
      setServerError(err.message || 'خطا در بارگذاری ماشین‌حساب‌ها از سرور');
    } finally {
      setIsLoadingCalculators(false);
    }
  }, [onUpdateState]);

  // Load calculators on component mount
  useEffect(() => {
    refreshCalculatorsFromServer();
  }, [refreshCalculatorsFromServer]);

  // Pure server-authoritative calculators list
  const calculatorsList: Calculator[] = useMemo(() => {
    return state.calculators || [];
  }, [state.calculators]);

  // Business Partners list with automatic synthesis for agents who don't have BP yet
  const businessPartners: BusinessPartner[] = useMemo(() => {
    const list = [...(state.businessPartners || [])];
    const existingPersonIds = new Set(list.map(bp => bp.personId).filter(Boolean));
    const existingBpIds = new Set(list.map(bp => (bp.id || "").replace("BP_", "").replace("p_", "")));
    
    (state.persons || []).forEach(p => {
      const cleanPid = (p.id || "").replace("BP_", "").replace("p_", "");
      if ((p.isAgent || p.role === 'agent') && !existingPersonIds.has(p.id) && !existingBpIds.has(cleanPid)) {
        list.push({
          id: `BP_${p.id}`,
          personId: p.id,
          status: 'active',
          profile: {
            partnerId: `BP_${p.id}`,
            partnerName: p.name,
            storeName: p.storeName || p.name,
            contractStatus: 'active',
            riskLevel: 'low',
            creditLimit: 500000000
          },
          allowedCalculatorIds: ['CALC_SADI', 'CALC_PELKANI', 'CALC_BETA_AGHILI', 'CALC_BETA_MEHDI', 'CALC_BETA_MANSOURI', 'CALC_BETA_HAMID', 'CALC_BETA_JAFARI'],
          branches: [],
          users: [],
          createdAt: new Date().toISOString()
        });
      }
    });
    return list;
  }, [state.businessPartners, state.persons]);

  // Map Person names for partners
  const personMap = useMemo(() => {
    const map = new Map<string, Person>();
    (state.persons || []).forEach(p => map.set(p.id, p));
    return map;
  }, [state.persons]);

  // Filtered partners
  const filteredPartners = useMemo(() => {
    if (!searchTerm.trim()) return businessPartners;
    const term = searchTerm.toLowerCase();
    return businessPartners.filter(bp => {
      const person = personMap.get(bp.personId);
      const name = person?.name || bp.profile?.partnerName || bp.profile?.storeName || '';
      const code = person?.code || bp.id;
      return name.toLowerCase().includes(term) || code.toLowerCase().includes(term);
    });
  }, [businessPartners, personMap, searchTerm]);

  // Currently Selected Partner
  const selectedPartner = useMemo(() => {
    if (!selectedPartnerId) return null;
    return businessPartners.find(bp => bp.id === selectedPartnerId || bp.personId === selectedPartnerId) || null;
  }, [businessPartners, selectedPartnerId]);

  // Helper to create a new audit log and return the updated logs array
  const generateAuditLogs = (entry: Omit<AuditLogEntry, 'id' | 'timestampIso'>) => {
    const newLog: AuditLogEntry = {
      ...entry,
      id: `log-${Date.now()}`,
      timestampIso: new Date().toISOString()
    };
    const updated = [newLog, ...auditLogs];
    setAuditLogs(updated);
    return updated;
  };

  // Handler for Saving Global Settings
  const handleRequestSaveGlobalSettings = () => {
    const changes: PendingChangeRecord['changes'] = [];
    
    if (globalForm.sadiBazaarBaseRate !== (state.settings?.sadiBazaarBaseRate ?? 7)) {
      changes.push({
        fieldLabel: 'نرخ پایه صدی بازار',
        fieldName: 'sadiBazaarBaseRate',
        oldValue: `${state.settings?.sadiBazaarBaseRate ?? 7}٪`,
        newValue: `${globalForm.sadiBazaarBaseRate}٪`
      });
    }
    if (globalForm.pelkaniTier1BaseRate !== (state.settings?.pelkaniTier1BaseRate ?? 7.5)) {
      changes.push({
        fieldLabel: 'نرخ پله ۱ پلکانی (۱ تا ۳ قسط)',
        fieldName: 'pelkaniTier1BaseRate',
        oldValue: `${state.settings?.pelkaniTier1BaseRate ?? 7.5}٪`,
        newValue: `${globalForm.pelkaniTier1BaseRate}٪`
      });
    }
    if (globalForm.pelkaniTier2BaseRate !== (state.settings?.pelkaniTier2BaseRate ?? 8.0)) {
      changes.push({
        fieldLabel: 'نرخ پله ۲ پلکانی (۴ تا ۶ قسط)',
        fieldName: 'pelkaniTier2BaseRate',
        oldValue: `${state.settings?.pelkaniTier2BaseRate ?? 8.0}٪`,
        newValue: `${globalForm.pelkaniTier2BaseRate}٪`
      });
    }
    if (globalForm.pelkaniTier3BaseRate !== (state.settings?.pelkaniTier3BaseRate ?? 8.5)) {
      changes.push({
        fieldLabel: 'نرخ پله ۳ پلکانی (۷ تا ۱۲ قسط)',
        fieldName: 'pelkaniTier3BaseRate',
        oldValue: `${state.settings?.pelkaniTier3BaseRate ?? 8.5}٪`,
        newValue: `${globalForm.pelkaniTier3BaseRate}٪`
      });
    }
    if (globalForm.betaBankFeeRate !== (state.settings?.betaBankFeeRate ?? 5)) {
      changes.push({
        fieldLabel: 'کارمزد بانک بتا',
        fieldName: 'betaBankFeeRate',
        oldValue: `${state.settings?.betaBankFeeRate ?? 5}٪`,
        newValue: `${globalForm.betaBankFeeRate}٪`
      });
    }

    if (changes.length === 0) {
      alert('هیچ تغییری برای ذخیره‌سازی یافت نشد.');
      return;
    }

    setPendingChange({
      type: 'global_settings',
      title: 'ویرایش نرخ‌های پایه عمومی سیستم',
      changes,
      applyCallback: (reason) => {
        const updatedState: AppState = {
          ...state,
          settings: {
            ...state.settings,
            sadiBazaarBaseRate: globalForm.sadiBazaarBaseRate,
            pelkaniTier1BaseRate: globalForm.pelkaniTier1BaseRate,
            pelkaniTier2BaseRate: globalForm.pelkaniTier2BaseRate,
            pelkaniTier3BaseRate: globalForm.pelkaniTier3BaseRate,
            betaBankFeeRate: globalForm.betaBankFeeRate
          }
        };

        const updatedLogs = generateAuditLogs({
          actor: currentUserRole === 'admin' ? 'مدیر سیستم' : 'کاربر ارشد',
          type: 'global_settings',
          targetName: 'تنظیمات عمومی نرخ‌ها',
          changesSummary: changes.map(c => `${c.fieldLabel}: ${c.oldValue} ⬅️ ${c.newValue}`).join(' | '),
          reason
        });

        onUpdateState(prev => ({
          ...prev,
          settings: {
            ...prev.settings,
            sadiBazaarBaseRate: globalForm.sadiBazaarBaseRate,
            pelkaniTier1BaseRate: globalForm.pelkaniTier1BaseRate,
            pelkaniTier2BaseRate: globalForm.pelkaniTier2BaseRate,
            pelkaniTier3BaseRate: globalForm.pelkaniTier3BaseRate,
            betaBankFeeRate: globalForm.betaBankFeeRate,
            calculatorAuditLogs: updatedLogs
          }
        }));
      }
    });
  };

  // Handler for Toggle Calculator Active Status
  const handleToggleCalculatorActive = (calc: Calculator) => {
    const newStatus = !calc.isActive;
    setPendingChange({
      type: 'calculator_config',
      title: `تغییر وضعیت فعال‌سازی ماشین‌حساب (${calc.name})`,
      targetId: calc.id,
      targetName: calc.name,
      changes: [
        {
          fieldLabel: 'وضعیت فعال‌سازی',
          fieldName: 'isActive',
          oldValue: calc.isActive ? 'فعال' : 'غیرفعال',
          newValue: newStatus ? 'فعال' : 'غیرفعال'
        }
      ],
      applyCallback: async (reason) => {
        try {
          setIsSubmitting(true);
          await CalculatorService.updateCalculator(calc.id, {
            ...calc,
            isActive: newStatus
          });

          const freshCalculators = await CalculatorService.getCalculators();

          const updatedLogs = generateAuditLogs({
            actor: currentUserRole === 'admin' ? 'مدیر سیستم' : 'کاربر ارشد',
            type: 'calculator_config',
            targetName: calc.name,
            changesSummary: `تغییر وضعیت به ${newStatus ? 'فعال' : 'غیرفعال'}`,
            reason
          });

          onUpdateState(prev => ({
            ...prev,
            calculators: freshCalculators,
            settings: {
              ...prev.settings,
              calculatorAuditLogs: updatedLogs
            } as any
          }));

          triggerToast(`وضعیت ماشین‌حساب «${calc.name}» با موفقیت تغییر کرد`);
        } catch (err: any) {
          console.error('Failed to toggle calculator active status:', err);
          alert(`خطا در به‌روزرسانی وضعیت در سرور: ${err.message || 'خطای ناشناخته'}`);
        } finally {
          setIsSubmitting(false);
        }
      }
    });
  };

  // Handler for creating/updating calculator
  const handleSaveCalculatorForm = async (calcData: Partial<Calculator>, isNew: boolean) => {
    try {
      setIsSubmitting(true);
      if (isNew) {
        await CalculatorService.createCalculator({
          name: calcData.name || 'ماشین‌حساب جدید',
          description: calcData.description || '',
          type: calcData.type || 'sadi_bazaar',
          isActive: calcData.isActive ?? true,
          agentBankId: calcData.agentBankId,
          bankName: calcData.bankName,
          baseRatePercent: calcData.baseRatePercent,
          pelkaniTier1BaseRate: calcData.pelkaniTier1BaseRate,
          pelkaniTier2BaseRate: calcData.pelkaniTier2BaseRate,
          pelkaniTier3BaseRate: calcData.pelkaniTier3BaseRate,
          betaBankFeeRate: calcData.betaBankFeeRate,
          maxInstallmentCount: calcData.maxInstallmentCount,
          decliningSlopePercentage: calcData.decliningSlopePercentage,
        });
      } else if (calcData.id) {
        await CalculatorService.updateCalculator(calcData.id, calcData);
      }

      const freshCalculators = await CalculatorService.getCalculators();
      onUpdateState(prev => ({
        ...prev,
        calculators: freshCalculators,
      }));
      triggerToast(isNew ? `ماشین‌حساب «${calcData.name || 'جدید'}» با موفقیت ایجاد شد` : `ماشین‌حساب «${calcData.name}» با موفقیت به‌روزرسانی شد`);
      setEditingCalculatorModal({ isOpen: false, isNew: false, calcData: {} });
    } catch (err: any) {
      console.error('Failed to save calculator:', err);
      alert(`خطا در ذخیره‌سازی ماشین‌حساب: ${err.message || 'خطای ناشناخته'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handler for deleting calculator
  const handleDeleteCalculator = async (calc: Calculator) => {
    try {
      setIsSubmitting(true);
      await CalculatorService.deleteCalculator(calc.id);
      const freshCalculators = await CalculatorService.getCalculators();
      onUpdateState(prev => ({
        ...prev,
        calculators: freshCalculators,
      }));
      triggerToast(`ماشین‌حساب «${calc.name}» حذف شد`);
      setDeletingCalculator(null);
    } catch (err: any) {
      console.error('Failed to delete calculator:', err);
      alert(`خطا در حذف ماشین‌حساب: ${err.message || 'خطای ناشناخته'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // State for Editing Override for a specific agent and calculator
  const [overrideForm, setOverrideForm] = useState<{
    calculatorId: string;
    baseRatePercent?: number;
    betaBankFeeRate?: number;
    pelkaniTier1BaseRate?: number;
    maxInstallmentCount?: number;
    minInstallmentCount?: number;
    maxCreditLimit?: number;
    customCommissionPercent?: number;
    decliningSlopePercentage?: number;
    isActive?: boolean;
  }>({
    calculatorId: 'CALC_SADI',
    isActive: true
  });

  // Helper to match partners across technical/canonical IDs (e.g. BP_1004 vs 1004 vs p_1004)
  const isSamePartner = (bp1: BusinessPartner, bp2: BusinessPartner): boolean => {
    if (!bp1 || !bp2) return false;
    if (bp1.id === bp2.id) return true;
    if (bp1.personId && bp2.personId && bp1.personId === bp2.personId) return true;
    
    const cleanId1 = (bp1.id || '').replace('BP_', '').replace('p_', '');
    const cleanId2 = (bp2.id || '').replace('BP_', '').replace('p_', '');
    if (cleanId1 && cleanId2 && cleanId1 === cleanId2) return true;

    if (bp1.personId) {
      const cleanPersonId1 = bp1.personId.replace('BP_', '').replace('p_', '');
      if (cleanPersonId1 && (cleanPersonId1 === cleanId2 || cleanPersonId1 === bp2.id || cleanPersonId1 === bp2.personId)) return true;
    }
    if (bp2.personId) {
      const cleanPersonId2 = bp2.personId.replace('BP_', '').replace('p_', '');
      if (cleanPersonId2 && (cleanPersonId2 === cleanId1 || cleanPersonId2 === bp1.id || cleanPersonId2 === bp1.personId)) return true;
    }

    if (bp1.profile?.partnerId && (bp1.profile.partnerId === bp2.id || bp1.profile.partnerId === bp2.personId)) return true;
    if (bp2.profile?.partnerId && (bp2.profile.partnerId === bp1.id || bp2.profile.partnerId === bp1.personId)) return true;

    return false;
  };

  // Load existing override when selecting calculator for partner
  const handleSelectPartnerCalculatorForEdit = (partner: BusinessPartner, calcId: string) => {
    const calcObj = calculatorsList.find(c => c.id === calcId);
    const existing = getAgentCalculatorOverride(partner.calculatorOverrides, calcId, calcObj);

    setOverrideForm({
      calculatorId: calcId,
      baseRatePercent: existing?.baseRatePercent,
      betaBankFeeRate: existing?.betaBankFeeRate,
      pelkaniTier1BaseRate: existing?.pelkaniTier1BaseRate,
      pelkaniTier2BaseRate: existing?.pelkaniTier2BaseRate,
      pelkaniTier3BaseRate: existing?.pelkaniTier3BaseRate,
      maxInstallmentCount: existing?.maxInstallmentCount,
      minInstallmentCount: existing?.minInstallmentCount,
      maxCreditLimit: existing?.maxCreditLimit,
      customCommissionPercent: existing?.customCommissionPercent,
      decliningSlopePercentage: existing?.decliningSlopePercentage,
      isActive: existing?.isActive ?? true
    });
  };

  // Request Save Agent Override
  const handleRequestSaveAgentOverride = (partner: BusinessPartner) => {
    const cleanPartnerId = (partner.id || "").replace("BP_", "").replace("p_", "");
    const person = partner.personId ? personMap.get(partner.personId) : (state.persons || []).find(p => (p.id || "").replace("BP_", "").replace("p_", "") === cleanPartnerId);
    const partnerName = person?.name || partner.profile?.partnerName || partner.profile?.storeName || partner.id;

    const resolvedCurrent = resolveEffectiveCalculatorSettings(
      overrideForm.calculatorId,
      partner,
      calculatorsList,
      state.settings
    );

    const calcObj = calculatorsList.find(c => c.id === overrideForm.calculatorId);
    const calcName = calcObj?.name || overrideForm.calculatorId;

    const changes: PendingChangeRecord['changes'] = [];

    if (overrideForm.baseRatePercent !== undefined && overrideForm.baseRatePercent !== resolvedCurrent.sadiBazaarBaseRate) {
      changes.push({
        fieldLabel: 'نرخ پایه اختصاصی',
        fieldName: 'baseRatePercent',
        oldValue: `${resolvedCurrent.sadiBazaarBaseRate}٪ (${resolvedCurrent.source})`,
        newValue: `${overrideForm.baseRatePercent}٪ (اختصاصی نماینده)`
      });
    }

    if (overrideForm.betaBankFeeRate !== undefined && overrideForm.betaBankFeeRate !== resolvedCurrent.betaBankFeeRate) {
      changes.push({
        fieldLabel: 'کارمزد بانک بتا اختصاصی',
        fieldName: 'betaBankFeeRate',
        oldValue: `${resolvedCurrent.betaBankFeeRate}٪ (${resolvedCurrent.source})`,
        newValue: `${overrideForm.betaBankFeeRate}٪ (اختصاصی نماینده)`
      });
    }

    if (overrideForm.pelkaniTier1BaseRate !== undefined && overrideForm.pelkaniTier1BaseRate !== resolvedCurrent.pelkaniTier1BaseRate) {
      changes.push({
        fieldLabel: 'نرخ پایه پله ۱ پلکانی (۱ تا ۶ ماهه)',
        fieldName: 'pelkaniTier1BaseRate',
        oldValue: `${resolvedCurrent.pelkaniTier1BaseRate}٪ (${resolvedCurrent.source})`,
        newValue: `${overrideForm.pelkaniTier1BaseRate}٪ (اختصاصی نماینده)`
      });
    }

    if (overrideForm.pelkaniTier2BaseRate !== undefined && overrideForm.pelkaniTier2BaseRate !== resolvedCurrent.pelkaniTier2BaseRate) {
      changes.push({
        fieldLabel: 'نرخ پایه پله ۲ پلکانی (۷ تا ۹ ماهه)',
        fieldName: 'pelkaniTier2BaseRate',
        oldValue: `${resolvedCurrent.pelkaniTier2BaseRate}٪ (${resolvedCurrent.source})`,
        newValue: `${overrideForm.pelkaniTier2BaseRate}٪ (اختصاصی نماینده)`
      });
    }

    if (overrideForm.pelkaniTier3BaseRate !== undefined && overrideForm.pelkaniTier3BaseRate !== resolvedCurrent.pelkaniTier3BaseRate) {
      changes.push({
        fieldLabel: 'نرخ پایه پله ۳ پلکانی (۱۰ ماه به بالا)',
        fieldName: 'pelkaniTier3BaseRate',
        oldValue: `${resolvedCurrent.pelkaniTier3BaseRate}٪ (${resolvedCurrent.source})`,
        newValue: `${overrideForm.pelkaniTier3BaseRate}٪ (اختصاصی نماینده)`
      });
    }

    if (overrideForm.maxInstallmentCount !== undefined) {
      changes.push({
        fieldLabel: 'حداکثر تعداد اقساط',
        fieldName: 'maxInstallmentCount',
        oldValue: resolvedCurrent.maxInstallmentCount ? `${resolvedCurrent.maxInstallmentCount} قسط` : 'تعریف‌نشده',
        newValue: `${overrideForm.maxInstallmentCount} قسط`
      });
    }

    if (overrideForm.maxCreditLimit !== undefined) {
      changes.push({
        fieldLabel: 'سقف اعتبار اختصاصی (ریال)',
        fieldName: 'maxCreditLimit',
        oldValue: resolvedCurrent.maxCreditLimit ? resolvedCurrent.maxCreditLimit.toLocaleString('fa-IR') : 'نامحدود',
        newValue: overrideForm.maxCreditLimit.toLocaleString('fa-IR')
      });
    }

    if (overrideForm.customCommissionPercent !== undefined) {
      changes.push({
        fieldLabel: 'حداکثر درصد کمیسیون مجاز (%)',
        fieldName: 'customCommissionPercent',
        oldValue: resolvedCurrent.maxCommissionPercent ? `${resolvedCurrent.maxCommissionPercent}٪` : 'پیش‌فرض عمومی',
        newValue: `${overrideForm.customCommissionPercent}٪`
      });
    }

    if (overrideForm.decliningSlopePercentage !== undefined) {
      changes.push({
        fieldLabel: 'درصد شیب اقساط (پلکانی نزولی)',
        fieldName: 'decliningSlopePercentage',
        oldValue: '۰٪',
        newValue: `${overrideForm.decliningSlopePercentage}٪`
      });
    }

    if (overrideForm.isActive !== undefined) {
      changes.push({
        fieldLabel: 'وضعیت دسترسی نماینده',
        fieldName: 'isActive',
        oldValue: 'فعال',
        newValue: overrideForm.isActive ? 'مجاز / فعال' : 'غیرمجاز / غیرفعال'
      });
    }

    if (changes.length === 0) {
      changes.push({
        fieldLabel: 'تنظیمات و نرخ‌های اختصاصی',
        fieldName: 'override',
        oldValue: 'ثبت‌نشده',
        newValue: 'اعمال یا به‌روزرسانی تنظیمات اختصاصی'
      });
    }

    setPendingChange({
      type: 'agent_override',
      title: `تعیین نرخ و شرایط اختصاصی برای نماینده (${partnerName})`,
      partnerId: partner.id,
      partnerName,
      targetId: overrideForm.calculatorId,
      targetName: calcName,
      changes,
      applyCallback: (reason) => {
        const targetCalcType = resolveCalculatorType(overrideForm.calculatorId, calcObj?.name);

        const newOverride: AgentCalculatorOverride = {
          calculatorId: overrideForm.calculatorId,
          baseRatePercent: overrideForm.baseRatePercent !== undefined ? Number(overrideForm.baseRatePercent) : undefined,
          betaBankFeeRate: overrideForm.betaBankFeeRate !== undefined ? Number(overrideForm.betaBankFeeRate) : undefined,
          pelkaniTier1BaseRate: overrideForm.pelkaniTier1BaseRate !== undefined ? Number(overrideForm.pelkaniTier1BaseRate) : undefined,
          pelkaniTier2BaseRate: overrideForm.pelkaniTier2BaseRate !== undefined ? Number(overrideForm.pelkaniTier2BaseRate) : undefined,
          pelkaniTier3BaseRate: overrideForm.pelkaniTier3BaseRate !== undefined ? Number(overrideForm.pelkaniTier3BaseRate) : undefined,
          maxInstallmentCount: overrideForm.maxInstallmentCount !== undefined ? Number(overrideForm.maxInstallmentCount) : undefined,
          minInstallmentCount: overrideForm.minInstallmentCount !== undefined ? Number(overrideForm.minInstallmentCount) : undefined,
          maxCreditLimit: overrideForm.maxCreditLimit !== undefined ? Number(overrideForm.maxCreditLimit) : undefined,
          customCommissionPercent: overrideForm.customCommissionPercent !== undefined ? Number(overrideForm.customCommissionPercent) : undefined,
          decliningSlopePercentage: overrideForm.decliningSlopePercentage !== undefined ? Number(overrideForm.decliningSlopePercentage) : undefined,
          isActive: overrideForm.isActive ?? true
        };

        const updatedPartners = [...(state.businessPartners || [])];
        let foundIndex = updatedPartners.findIndex(bp => isSamePartner(bp, partner));

        let currentRecord: Record<string, AgentCalculatorOverride> = {};
        if (foundIndex !== -1 && updatedPartners[foundIndex].calculatorOverrides) {
          const existingBp = updatedPartners[foundIndex];
          if (Array.isArray(existingBp.calculatorOverrides)) {
            existingBp.calculatorOverrides.forEach((o: any) => {
              if (o && o.calculatorId) {
                currentRecord[o.calculatorId] = o;
              }
            });
          } else {
            currentRecord = { ...(existingBp.calculatorOverrides as Record<string, AgentCalculatorOverride>) };
          }
        }

        // Save under exact ID, object ID, object type, resolved type, and canonical uppercase/lowercase keys so all resolvers find it
        currentRecord[overrideForm.calculatorId] = newOverride;
        if (calcObj?.id) currentRecord[calcObj.id] = newOverride;
        if (calcObj?.type && calcObj.type !== 'beta') {
          currentRecord[calcObj.type] = newOverride;
        }
        if (targetCalcType && targetCalcType !== 'beta') {
          currentRecord[targetCalcType] = newOverride;
          if (targetCalcType === 'sadi_bazaar') {
            currentRecord['CALC_SADI'] = newOverride;
            currentRecord['sadi_bazaar'] = newOverride;
          }
          if (targetCalcType === 'pelkani') {
            currentRecord['CALC_PELKANI'] = newOverride;
            currentRecord['pelkani'] = newOverride;
          }
        }

        const updatedPartnerObj: BusinessPartner = foundIndex !== -1 
          ? { ...updatedPartners[foundIndex], calculatorOverrides: currentRecord }
          : {
              ...(partner as any),
              id: partner.id || `BP_${partner.personId}`,
              calculatorOverrides: currentRecord
            };

        if (foundIndex !== -1) {
          updatedPartners[foundIndex] = updatedPartnerObj;
        } else {
          updatedPartners.push(updatedPartnerObj);
        }

        const updatedLogs = generateAuditLogs({
          actor: currentUserRole === 'admin' ? 'مدیر سیستم' : 'کاربر ارشد',
          type: 'agent_override',
          targetName: `نماینده: ${partnerName} | ماشین‌حساب: ${calcName}`,
          changesSummary: changes.map(c => `${c.fieldLabel}: ${c.oldValue} ⬅️ ${c.newValue}`).join(' | '),
          reason
        });

        onUpdateState(prev => ({
          ...prev,
          businessPartners: updatedPartners,
          settings: {
            ...prev.settings,
            calculatorAuditLogs: updatedLogs
          } as any
        }));
      }
    });
  };

  // Clear Override for a partner and calculator
  const handleClearAgentOverride = (partner: BusinessPartner, calcId: string) => {
    const cleanPartnerId = (partner.id || "").replace("BP_", "").replace("p_", "");
    const person = partner.personId ? personMap.get(partner.personId) : (state.persons || []).find(p => (p.id || "").replace("BP_", "").replace("p_", "") === cleanPartnerId);
    const partnerName = person?.name || partner.profile?.partnerName || partner.profile?.storeName || partner.id;

    setPendingChange({
      type: 'agent_override',
      title: `حذف نرخ اختصاصی و بازگشت به نرخ عمومی (${partnerName})`,
      partnerId: partner.id,
      partnerName,
      targetId: calcId,
      changes: [
        {
          fieldLabel: 'تنظیمات اختصاصی',
          fieldName: 'calculatorOverrides',
          oldValue: 'دارای نرخ اختصاصی',
          newValue: 'بازگشت به نرخ پایه عمومی (Resolver Level 3)'
        }
      ],
      applyCallback: (reason) => {
        const calcObj = calculatorsList.find(c => c.id === calcId);
        const targetCalcType = resolveCalculatorType(calcId, calcObj?.name);

        const updatedPartners = (state.businessPartners || []).map(bp => {
          if (isSamePartner(bp, partner)) {
            let currentRecord: Record<string, AgentCalculatorOverride> = {};
            if (bp.calculatorOverrides) {
              if (Array.isArray(bp.calculatorOverrides)) {
                bp.calculatorOverrides.forEach((o: any) => {
                  if (o && o.calculatorId) {
                    currentRecord[o.calculatorId] = o;
                  }
                });
              } else {
                currentRecord = { ...(bp.calculatorOverrides as Record<string, AgentCalculatorOverride>) };
              }
            }

            // Find any resolved override for this calculator
            const resolvedOverride = getAgentCalculatorOverride(currentRecord, calcId, calcObj);
            const overrideCalcId = resolvedOverride?.calculatorId;

            // Collect all matching keys to delete
            const keysToDelete = new Set<string>();
            keysToDelete.add(calcId);
            if (calcObj?.id) keysToDelete.add(calcObj.id);
            if (calcObj?.type) keysToDelete.add(calcObj.type);
            if (targetCalcType) keysToDelete.add(targetCalcType);
            if (calcId === 'CALC_SADI' || targetCalcType === 'sadi_bazaar') {
              keysToDelete.add('sadi_bazaar');
              keysToDelete.add('CALC_SADI');
            }
            if (calcId === 'CALC_PELKANI' || targetCalcType === 'pelkani') {
              keysToDelete.add('pelkani');
              keysToDelete.add('CALC_PELKANI');
            }
            if (overrideCalcId) {
              keysToDelete.add(overrideCalcId);
            }

            // Also search and delete any keys whose values correspond to this calculator
            Object.keys(currentRecord).forEach(key => {
              const o = currentRecord[key];
              if (o && (
                o === resolvedOverride || 
                o.calculatorId === calcId || 
                (calcObj?.id && o.calculatorId === calcObj.id) || 
                (overrideCalcId && o.calculatorId === overrideCalcId) ||
                (calcObj?.type && o.calculatorId === calcObj.type) ||
                (targetCalcType && o.calculatorId === targetCalcType)
              )) {
                keysToDelete.add(key);
              }
            });

            // Perform the deletion of all collected keys
            keysToDelete.forEach(key => {
              if (currentRecord[key]) {
                 currentRecord[key] = {
                   ...currentRecord[key],
                   customCommissionPercent: undefined
                 };
                 // If the record is now empty or only has the undefined commission, delete the whole record for that calculator?
                 // Wait, the requirement was to clean the field. Let's just unset it if it's there.
                 delete currentRecord[key].customCommissionPercent;
                 
                 // If it has no other meaningful overrides, maybe we should delete the key entirely
                 if (Object.keys(currentRecord[key]).filter(k => k !== 'calculatorId' && k !== 'isActive').length === 0) {
                   delete currentRecord[key];
                 }
              }
            });

            return {
              ...bp,
              calculatorOverrides: Object.keys(currentRecord).length > 0 ? currentRecord : undefined
            };
          }
          return bp;
        });

        const updatedLogs = generateAuditLogs({
          actor: currentUserRole === 'admin' ? 'مدیر سیستم' : 'کاربر ارشد',
          type: 'agent_override',
          targetName: `نماینده: ${partnerName} | ماشین‌حساب: ${calcId}`,
          changesSummary: 'حذف Override و بازگشت به نرخ عمومی',
          reason
        });

        onUpdateState(prev => ({
          ...prev,
          businessPartners: updatedPartners,
          settings: {
            ...prev.settings,
            calculatorAuditLogs: updatedLogs
          } as any
        }));
      }
    });
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-16 font-sans text-right" dir="rtl">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 shadow-xl border border-indigo-900/40 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3.5 bg-indigo-600/30 backdrop-blur-md rounded-2xl border border-indigo-400/30 text-indigo-300">
              <CalculatorIcon className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">مدیریت ماشین‌حساب‌ها و نرخ‌های اعتباری</h1>
              <p className="text-sm text-indigo-200 mt-1">
                تعریف پارامترهای عمومی و اختصاصی‌سازی نرخ‌ها برای نمایندگان
              </p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setActiveSubTab('calculators')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition flex items-center gap-1.5 ${
                activeSubTab === 'calculators' ? 'bg-white text-indigo-700 shadow-md' : 'bg-indigo-700/30 text-indigo-100 hover:bg-indigo-600/50'
              }`}
            >
              <CalculatorIcon size={16} />
              فهرست ماشین‌حساب‌ها
            </button>
            <button
              onClick={() => setActiveSubTab('general')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeSubTab === 'general' ? 'bg-white text-indigo-700 shadow-md' : 'bg-indigo-700/30 text-indigo-100 hover:bg-indigo-600/50'
              }`}
            >
              تنظیمات عمومی نرخ‌ها
            </button>
            <button
              onClick={() => setActiveSubTab('agents')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeSubTab === 'agents' ? 'bg-white text-indigo-700 shadow-md' : 'bg-indigo-700/30 text-indigo-100 hover:bg-indigo-600/50'
              }`}
            >
              نرخ‌های اختصاصی نمایندگان
            </button>
            <button
              onClick={() => setActiveSubTab('history')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeSubTab === 'history' ? 'bg-white text-indigo-700 shadow-md' : 'bg-indigo-700/30 text-indigo-100 hover:bg-indigo-600/50'
              }`}
            >
              تاریخچه تغییرات
            </button>
          </div>
        </div>
      </div>

      {/* Server Error Alert */}
      {serverError && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center justify-between text-rose-800 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-600 shrink-0" />
            <span>{serverError}</span>
          </div>
          <button
            onClick={refreshCalculatorsFromServer}
            className="px-3 py-1 bg-rose-100 hover:bg-rose-200 text-rose-900 rounded-xl text-xs font-bold transition flex items-center gap-1"
          >
            <RefreshCw size={14} />
            تلاش مجدد
          </button>
        </div>
      )}

      {/* SUB-TAB: CALCULATORS MANAGEMENT (CRUD) */}
      {activeSubTab === 'calculators' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-zinc-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2">
                <Sliders className="text-indigo-600" size={20} />
                فهرست و پیکربندی ماشین‌حساب‌های اعتباری
              </h2>
              <p className="text-xs text-zinc-500 mt-1">
                مدیریت طرح‌های محاسباتی، نرخ‌های پایه، سقف اقساط و وضعیت فعال‌سازی در دیتابیس سرور
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <button
                onClick={refreshCalculatorsFromServer}
                disabled={isLoadingCalculators}
                className="p-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50"
                title="تازه‌سازی از سرور"
              >
                <RefreshCw size={16} className={isLoadingCalculators ? 'animate-spin' : ''} />
                <span>به‌روزرسانی</span>
              </button>

              <button
                onClick={() => setEditingCalculatorModal({
                  isOpen: true,
                  isNew: true,
                  calcData: {
                    name: '',
                    type: 'sadi_bazaar',
                    isActive: true,
                    description: '',
                    baseRatePercent: 7,
                    maxInstallmentCount: 12,
                  }
                })}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2.5 rounded-xl text-sm shadow-md transition flex items-center gap-2"
              >
                <Plus size={18} />
                تعریف ماشین‌حساب جدید
              </button>
            </div>
          </div>

          {isLoadingCalculators && (
            <div className="text-center py-12 bg-white rounded-3xl border border-zinc-200 shadow-xs flex flex-col items-center gap-3">
              <Loader2 className="animate-spin text-indigo-600" size={32} />
              <span className="text-sm font-bold text-zinc-600">در حال دریافت اطلاعات ماشین‌حساب‌ها از سرور...</span>
            </div>
          )}

          {!isLoadingCalculators && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {calculatorsList.map(calc => (
                <div key={calc.id} className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-black text-zinc-900 text-base">{calc.name}</h3>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            calc.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-600'
                          }`}>
                            {calc.isActive ? 'فعال' : 'غیرفعال'}
                          </span>
                        </div>
                        <span className="text-[11px] text-indigo-600 font-mono font-bold block mt-0.5">
                          نوع: {calc.type || 'نامشخص'}
                        </span>
                      </div>

                      <button
                        onClick={() => handleToggleCalculatorActive(calc)}
                        title={calc.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${calc.isActive ? 'bg-indigo-600' : 'bg-zinc-200'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${calc.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>

                    <p className="text-xs text-zinc-500 line-clamp-2 min-h-[32px]">{calc.description || 'بدون توضیحات'}</p>

                    <div className="bg-zinc-50 rounded-2xl p-3 border border-zinc-100 space-y-1.5 text-xs">
                      {calc.bankName && (
                        <div className="flex justify-between text-zinc-600">
                          <span>بانک عامل:</span>
                          <span className="font-bold text-zinc-800">{calc.bankName}</span>
                        </div>
                      )}
                      {calc.baseRatePercent !== undefined && (
                        <div className="flex justify-between text-zinc-600">
                          <span>نرخ پایه:</span>
                          <span className="font-mono font-bold text-indigo-700">{calc.baseRatePercent}%</span>
                        </div>
                      )}
                      {calc.betaBankFeeRate !== undefined && (
                        <div className="flex justify-between text-zinc-600">
                          <span>کارمزد بانک:</span>
                          <span className="font-mono font-bold text-indigo-700">{calc.betaBankFeeRate}%</span>
                        </div>
                      )}
                      {calc.pelkaniTier1BaseRate !== undefined && (
                        <div className="flex justify-between text-zinc-600">
                          <span>نرخ پله ۱ (۱-۶ ماه):</span>
                          <span className="font-mono font-bold text-indigo-700">{calc.pelkaniTier1BaseRate}%</span>
                        </div>
                      )}
                      {calc.maxInstallmentCount !== undefined && (
                        <div className="flex justify-between text-zinc-600">
                          <span>حداکثر تعداد اقساط:</span>
                          <span className="font-mono font-bold text-zinc-800">{calc.maxInstallmentCount} قسط</span>
                        </div>
                      )}
                      {calc.decliningSlopePercentage !== undefined && (
                        <div className="flex justify-between text-zinc-600">
                          <span>درصد شیب اقساط:</span>
                          <span className="font-mono font-bold text-zinc-800">{calc.decliningSlopePercentage}%</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-4 border-t border-zinc-100 mt-4">
                    <button
                      onClick={() => setEditingCalculatorModal({
                        isOpen: true,
                        isNew: false,
                        calcData: { ...calc }
                      })}
                      className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl text-xs font-bold transition flex items-center gap-1"
                    >
                      <Edit3 size={14} />
                      ویرایش
                    </button>

                    <button
                      onClick={() => setDeletingCalculator(calc)}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition flex items-center gap-1"
                    >
                      <Trash2 size={14} />
                      حذف
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'general' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {calculatorsList.map(calc => (
              <div key={calc.id} className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-black text-zinc-900">{calc.name}</h3>
                    <button
                      onClick={() => handleToggleCalculatorActive(calc)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${calc.isActive ? 'bg-indigo-600' : 'bg-zinc-200'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${calc.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500 mb-4">{calc.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-3xl border border-zinc-200 p-6 shadow-xs">
            <h2 className="text-lg font-black text-zinc-900 mb-4">پارامترهای عمومی نرخ‌گذاری</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-zinc-700">نرخ پایه صدی بازار (درصد)</label>
                <input
                  type="number"
                  step="0.1"
                  value={globalForm.sadiBazaarBaseRate}
                  onChange={(e) => setGlobalForm({ ...globalForm, sadiBazaarBaseRate: parseFloat(e.target.value) })}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-zinc-700">نرخ پلکانی (۱ تا ۶ ماه)</label>
                <input
                  type="number"
                  step="0.1"
                  value={globalForm.pelkaniTier1BaseRate}
                  onChange={(e) => setGlobalForm({ ...globalForm, pelkaniTier1BaseRate: parseFloat(e.target.value) })}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-zinc-700">نرخ پلکانی (۷ تا ۱۲ ماه)</label>
                <input
                  type="number"
                  step="0.1"
                  value={globalForm.pelkaniTier2BaseRate}
                  onChange={(e) => setGlobalForm({ ...globalForm, pelkaniTier2BaseRate: parseFloat(e.target.value) })}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-zinc-700">نرخ پلکانی (۱۳ تا ۲۴ ماه)</label>
                <input
                  type="number"
                  step="0.1"
                  value={globalForm.pelkaniTier3BaseRate}
                  onChange={(e) => setGlobalForm({ ...globalForm, pelkaniTier3BaseRate: parseFloat(e.target.value) })}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-zinc-700">کارمزد بانک بتا (درصد)</label>
                <input
                  type="number"
                  step="0.1"
                  value={globalForm.betaBankFeeRate}
                  onChange={(e) => setGlobalForm({ ...globalForm, betaBankFeeRate: parseFloat(e.target.value) })}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleRequestSaveGlobalSettings}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-3 rounded-xl shadow-lg transition flex items-center gap-2"
              >
                <Check size={18} />
                ثبت تنظیمات عمومی
              </button>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'agents' && (
        <div className="grid grid-cols-1 md:grid-cols-10 gap-6">
          <div className="md:col-span-3 bg-white rounded-3xl border border-zinc-200 flex flex-col h-[600px] overflow-hidden shadow-xs">
            <div className="p-4 border-b border-zinc-100 bg-zinc-50/50">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                <input
                  type="text"
                  placeholder="جستجوی نماینده..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl pr-10 pl-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredPartners.length === 0 ? (
                <div className="text-center py-8 text-zinc-400 text-sm">نماینده‌ای یافت نشد.</div>
              ) : (
                filteredPartners.map(partner => {
                  const cleanPartnerId = (partner.id || "").replace("BP_", "").replace("p_", "");
                  const person = partner.personId ? personMap.get(partner.personId) : (state.persons || []).find(p => (p.id || "").replace("BP_", "").replace("p_", "") === cleanPartnerId);
                  const partnerName = person?.name || partner.profile?.partnerName || partner.profile?.storeName || partner.id;
                  const isSelected = selectedPartnerId === partner.id;
                  const overridesCount = getActiveCalculatorOverridesCount(partner.calculatorOverrides);
                  const hasOverrides = hasActiveCalculatorOverrides(partner);
                  
                  return (
                    <button
                      key={partner.id}
                      onClick={() => setSelectedPartnerId(partner.id)}
                      className={`w-full text-right p-3 rounded-2xl flex items-center justify-between transition ${
                        isSelected 
                          ? 'bg-indigo-50 border border-indigo-100' 
                          : 'hover:bg-zinc-50 border border-transparent'
                      }`}
                    >
                      <div>
                        <span className="font-bold text-zinc-900 text-xs block">{partnerName}</span>
                        <span className="text-[10px] text-zinc-400 block mt-0.5">کد: {person?.code || partner.id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasOverrides ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            دارای {overridesCount} نرخ اختصاصی
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-lg text-[10px] bg-zinc-100 text-zinc-500 border border-zinc-200">
                            نرخ عمومی
                          </span>
                        )}
                        <ChevronLeft size={16} className={isSelected ? 'text-indigo-600' : 'text-zinc-300'} />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel: Selected Agent Override Editor */}
          <div className="md:col-span-7 bg-white rounded-3xl border border-zinc-200 p-6 shadow-xs space-y-6">
            {!selectedPartner ? (
              <div className="text-center py-16 text-zinc-400 space-y-3">
                <UserCheck size={48} className="mx-auto text-zinc-300 stroke-[1.5]" />
                <p className="text-xs font-bold text-zinc-600">جهت مدیریت نرخ‌های اختصاصی، یک نماینده را از پنل راست انتخاب کنید.</p>
              </div>
            ) : (
              <div className="space-y-6">
                
                {/* Partner Identity Header */}
                <div className="bg-indigo-50/70 border border-indigo-100 rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-indigo-700 font-bold block">نماینده انتخاب‌شده:</span>
                    <h3 className="font-black text-indigo-950 text-base">
                      {personMap.get(selectedPartner.personId)?.name || selectedPartner.profile?.partnerName || selectedPartner.profile?.storeName || selectedPartner.id}
                    </h3>
                  </div>

                  <div className="text-left">
                    <span className="text-[10px] text-zinc-500 block">سطح اولویت در موتور محاسباتی:</span>
                    <span className="text-xs font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-lg">
                      Level 1: Agent Override
                    </span>
                  </div>
                </div>

                {/* Calculator Selector Tabs for this Partner */}
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-zinc-700">انتخاب ماشین‌حساب جهت اعمال نرخ اختصاصی:</label>
                  
                  <div className="grid grid-cols-3 gap-2">
                    {calculatorsList.map(calc => {
                      const isSelected = overrideForm.calculatorId === calc.id;
                      
                      const overrideObj = getAgentCalculatorOverride(selectedPartner.calculatorOverrides, calc.id, calc);
                      const hasOverride = !!overrideObj && overrideObj.isActive === true;

                      return (
                        <button
                          key={calc.id}
                          onClick={() => handleSelectPartnerCalculatorForEdit(selectedPartner, calc.id)}
                          className={`p-3 rounded-2xl border text-center transition space-y-1 ${
                            isSelected 
                              ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-md shadow-indigo-600/20' 
                              : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                          }`}
                        >
                          <span className="block text-xs font-black">{calc.name}</span>
                          <span className={`block text-[9px] ${
                            isSelected ? 'text-indigo-100' : hasOverride ? 'text-amber-600 font-bold' : 'text-zinc-400'
                          }`}>
                            {hasOverride ? 'دارای Override' : 'نرخ عمومی'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Override Fields Editor */}
                <div className="bg-zinc-50 rounded-2xl p-5 border border-zinc-200 space-y-4">
                  <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
                    <span className="font-bold text-zinc-900 text-xs">
                      تنظیمات اختصاصی ماشین‌حساب ({calculatorsList.find(c => c.id === overrideForm.calculatorId)?.name})
                    </span>

                    {/* Clear Override Button if exists */}
                    {(() => {
                      const overrideObj = getAgentCalculatorOverride(
                        selectedPartner.calculatorOverrides, 
                        overrideForm.calculatorId, 
                        calculatorsList.find(c => c.id === overrideForm.calculatorId)
                      );
                      return overrideObj && overrideObj.isActive === true;
                    })() && (
                      <button
                        onClick={() => handleClearAgentOverride(selectedPartner, overrideForm.calculatorId)}
                        className="text-[11px] text-red-600 hover:text-red-800 font-bold flex items-center gap-1 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-xl border border-red-200 transition"
                      >
                        <RotateCcw size={13} />
                        حذف نرخ اختصاصی (بازگشت به عمومی)
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Rate/Fee Override Inputs */}
                    {(() => {
                      const selectedCalcObj = calculatorsList.find(c => c.id === overrideForm.calculatorId);
                      const isBetaType = selectedCalcObj?.type === 'beta' || overrideForm.calculatorId === 'beta' || overrideForm.calculatorId?.startsWith('CALC_BETA_');
                      const isPelkaniType = selectedCalcObj?.type === 'pelkani' || overrideForm.calculatorId === 'pelkani' || overrideForm.calculatorId === 'CALC_PELKANI' || (selectedCalcObj?.name || '').includes('پلکانی');

                      if (isBetaType) {
                        return (
                          <>
                            {/* Beta Base Rate */}
                            <div className="space-y-1.5">
                              <label className="block text-xs font-bold text-zinc-700">
                                نرخ کارمزد پایه اختصاصی اقساط بتا (٪)
                              </label>
                              <input
                                type="number"
                                step="0.1"
                                value={overrideForm.baseRatePercent ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                  setOverrideForm({ ...overrideForm, baseRatePercent: val });
                                }}
                                placeholder="خالی = استفاده از نرخ عمومی"
                                className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              <span className="block text-[9px] text-zinc-400">
                                در صورت خالی بودن، نرخ عمومی سیستم اعمال می‌شود.
                              </span>
                            </div>

                            {/* Beta Bank Fee Rate */}
                            <div className="space-y-1.5">
                              <label className="block text-xs font-bold text-zinc-700">
                                حق کارمزد اختصاصی بانک بتا (٪)
                              </label>
                              <input
                                type="number"
                                step="0.1"
                                value={overrideForm.betaBankFeeRate ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                  setOverrideForm({ ...overrideForm, betaBankFeeRate: val });
                                }}
                                placeholder="خالی = استفاده از کارمزد عمومی"
                                className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              <span className="block text-[9px] text-zinc-400">
                                درصد کارمزد کسر شده توسط بانک (ویژه بتا).
                              </span>
                            </div>
                          </>
                        );
                      }

                      if (isPelkaniType) {
                        return (
                          <div className="col-span-full space-y-3 bg-amber-50/70 p-4 rounded-xl border border-amber-200">
                            <div className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                              <Sliders size={15} className="text-amber-600" />
                              <span>تنظیم نرخ پایه بازه‌های ۳ گانه ماشین‌حساب پلکانی برای این نماینده:</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              {/* Tier 1: 1 to 6 months */}
                              <div className="space-y-1">
                                <label className="block text-[11px] font-bold text-zinc-700">
                                  نرخ پایه (بازه ۱ تا ۶ ماهه) (٪)
                                </label>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={overrideForm.pelkaniTier1BaseRate ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                    setOverrideForm({ ...overrideForm, pelkaniTier1BaseRate: val });
                                  }}
                                  placeholder={`پیش‌فرض عمومی (${state.settings?.pelkaniTier1BaseRate ?? 7.5}٪)`}
                                  className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-amber-500 font-bold"
                                />
                              </div>

                              {/* Tier 2: 7 to 9 months */}
                              <div className="space-y-1">
                                <label className="block text-[11px] font-bold text-zinc-700">
                                  نرخ پایه (بازه ۷ تا ۹ ماهه) (٪)
                                </label>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={overrideForm.pelkaniTier2BaseRate ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                    setOverrideForm({ ...overrideForm, pelkaniTier2BaseRate: val });
                                  }}
                                  placeholder={`پیش‌فرض عمومی (${state.settings?.pelkaniTier2BaseRate ?? 8.0}٪)`}
                                  className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-amber-500 font-bold"
                                />
                              </div>

                              {/* Tier 3: 10+ months */}
                              <div className="space-y-1">
                                <label className="block text-[11px] font-bold text-zinc-700">
                                  نرخ پایه (بازه ۱۰ ماه به بالا) (٪)
                                </label>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={overrideForm.pelkaniTier3BaseRate ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                                    setOverrideForm({ ...overrideForm, pelkaniTier3BaseRate: val });
                                  }}
                                  placeholder={`پیش‌فرض عمومی (${state.settings?.pelkaniTier3BaseRate ?? 8.5}٪)`}
                                  className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-amber-500 font-bold"
                                />
                              </div>
                            </div>
                            <span className="block text-[10px] text-amber-900/80">
                              * ماشین‌حساب پلکانی برمبنای این ۳ بازه زمانی پایه محاسبات کارمزد خود را تعیین می‌کند. فیلدهایی که خالی رها شوند بر بر پایه نرخ‌های عمومی سیستم محاسبه خواهند شد.
                            </span>
                          </div>
                        );
                      }

                      // Non-Beta, Non-Pelkani Type (e.g., Sadi Bazaar)
                      return (
                        <div className="space-y-1.5">
                          <label className="block text-xs font-bold text-zinc-700">
                            نرخ پایه اختصاصی (٪)
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            value={overrideForm.baseRatePercent ?? ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                              setOverrideForm({ ...overrideForm, baseRatePercent: val });
                            }}
                            placeholder="خالی = استفاده از نرخ عمومی"
                            className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <span className="block text-[9px] text-zinc-400">
                            در صورت خالی بودن، نرخ عمومی سیستم اعمال می‌شود.
                          </span>
                        </div>
                      );
                    })()}

                    {/* Max Credit Limit */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-zinc-700">سقف اعتبار اختصاصی (ریال)</label>
                      <input
                        type="number"
                        value={overrideForm.maxCreditLimit ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                          setOverrideForm({ ...overrideForm, maxCreditLimit: val });
                        }}
                        placeholder="خالی = بدون سقف اختصاصی"
                        className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="block text-[9px] text-zinc-400">
                        سقف حداکثر اعتباری که این نماینده مجاز است با این ماشین‌حساب اعطا کند.
                      </span>
                    </div>

                    {/* Commission Percent */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-zinc-700">حداکثر درصد کمیسیون مجاز (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={overrideForm.customCommissionPercent ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                          setOverrideForm({ ...overrideForm, customCommissionPercent: val });
                        }}
                        placeholder="خالی = استفاده از نرخ عمومی سیستم"
                        className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="block text-[9px] text-zinc-400">
                        در صورت خالی بودن، حداکثر کمیسیون عمومی سیستم اعمال میشود.
                      </span>
                    </div>

                    {/* Max Installments */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-zinc-700">حداکثر تعداد اقساط مجاز</label>
                      <input
                        type="number"
                        value={overrideForm.maxInstallmentCount ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                          setOverrideForm({ ...overrideForm, maxInstallmentCount: val });
                        }}
                        placeholder="مثلاً ۱۲"
                        className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    {/* Declining Slope Percentage */}
                    <div className="space-y-1.5 col-span-1 md:col-span-2">
                      <label className="block text-xs font-bold text-zinc-700">درصد شیب اقساط (پلکانی نزولی)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={overrideForm.decliningSlopePercentage ?? ''}
                        onChange={(e) => {
                          const val = e.target.value === '' ? undefined : parseFloat(e.target.value);
                          setOverrideForm({ ...overrideForm, decliningSlopePercentage: val });
                        }}
                        placeholder="مثلاً ۲۰"
                        className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-mono text-center outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="block text-[9px] text-zinc-400">
                        در صورت خالی یا ۰ بودن، اقساط مساوی خواهند بود. درصد بالاتر باعث سنگینتر شدن چکهای اول میشود.
                      </span>
                    </div>

                    {/* Active State for Agent */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-zinc-700">دسترسی نماینده به این ماشین‌حساب</label>
                      <select
                        value={overrideForm.isActive ? 'true' : 'false'}
                        onChange={(e) => setOverrideForm({ ...overrideForm, isActive: e.target.value === 'true' })}
                        className="w-full bg-white border border-zinc-300 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="true">مجاز / فعال</option>
                        <option value="false">غیرمجاز / غیرفعال برای این نماینده</option>
                      </select>
                    </div>

                  </div>
                </div>

                <div className="flex items-center justify-end">
                  <button
                    onClick={() => handleRequestSaveAgentOverride(selectedPartner)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-2.5 rounded-xl text-xs shadow-lg shadow-indigo-600/20 transition flex items-center gap-2"
                  >
                    <Check size={16} />
                    بررسی و ثبت نرخ اختصاصی نماینده
                  </button>
                </div>

              </div>
            )}
          </div>

        </div>
      )}

      {/* SUB-TAB 4: Change History (Audit Log) */}
      {activeSubTab === 'history' && (
        <div className="bg-white rounded-3xl border border-zinc-200 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
            <div>
              <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2">
                <History className="text-indigo-600" size={20} />
                تاریخچه تغییرات نرخ‌ها و تنظیمات ماشین‌حساب‌ها
              </h2>
              <p className="text-xs text-zinc-500 mt-1">
                ثبت کلیه وقایع تغییر نرخ عمومی، فعال‌سازی و Override نمایندگان جهت ممیزی و بازرسی
              </p>
            </div>

            <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
              مجموع تغییرات: {auditLogs.length}
            </span>
          </div>

          <div className="space-y-3">
            {auditLogs.map(log => (
              <div 
                key={log.id}
                className="bg-zinc-50 rounded-2xl p-4 border border-zinc-200 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-zinc-900">{log.targetName}</span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-zinc-200 text-zinc-700">
                      {log.actor}
                    </span>
                  </div>
                  <p className="text-zinc-600 leading-relaxed font-mono">{log.changesSummary}</p>
                  {log.reason && (
                    <p className="text-[11px] text-zinc-500 italic">دلیل ثبت شده: «{log.reason}»</p>
                  )}
                </div>

                <div className="text-left text-[11px] text-zinc-400 shrink-0 font-mono">
                  {new Date(log.timestampIso).toLocaleString('fa-IR')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUCCESS TOAST */}
      {showSuccessToast && (
        <div className="fixed bottom-6 right-6 bg-emerald-500 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 z-50 animate-in fade-in duration-300">
          <Check size={20} className="shrink-0" />
          <div className="flex flex-col">
            <span className="font-bold text-sm">تغییرات با موفقیت ذخیره شد</span>
            <span className="text-xs text-emerald-100">تنظیمات در موتور محاسباتی اعمال گردید</span>
          </div>
        </div>
      )}

      {/* SAFETY CONFIRMATION MODAL */}
      {pendingChange && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-zinc-200 shadow-2xl max-w-xl w-full p-5 sm:p-6 space-y-4 sm:space-y-5 my-auto max-h-[90vh] flex flex-col justify-between overflow-y-auto animate-in fade-in duration-200">
            
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3 text-amber-600 shrink-0">
              <div className="flex items-center gap-3">
                <AlertTriangle size={28} className="shrink-0" />
                <div>
                  <h3 className="font-black text-zinc-900 text-sm sm:text-base">{pendingChange.title}</h3>
                  <span className="text-[11px] sm:text-xs text-zinc-500 block">تأییدیه نهایی و ثبت تغییرات در موتور محاسباتی</span>
                </div>
              </div>
              <button
                onClick={() => {
                  setPendingChange(null);
                  setChangeReason('');
                }}
                className="p-2 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-xl transition"
                title="بستن / انصراف"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1">
              {/* Changes Comparison Table */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-zinc-700">جدول مقایسه تغییرات پیشنهادی:</span>
                <div className="border border-zinc-200 rounded-2xl overflow-hidden text-xs">
                  <table className="w-full text-right">
                    <thead className="bg-zinc-100 text-zinc-700 font-bold border-b border-zinc-200">
                      <tr>
                        <th className="p-2.5">عنوان پارامتر</th>
                        <th className="p-2.5">مقدار قبلی</th>
                        <th className="p-2.5">مقدار جدید</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {pendingChange.changes.map((ch, idx) => (
                        <tr key={idx} className="hover:bg-zinc-50">
                          <td className="p-2.5 font-bold text-zinc-800">{ch.fieldLabel}</td>
                          <td className="p-2.5 text-zinc-500 font-mono">{String(ch.oldValue ?? 'خالی')}</td>
                          <td className="p-2.5 font-black text-indigo-700 font-mono">{String(ch.newValue ?? 'خالی')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mandatory Warning Alert */}
              <div className="bg-amber-500/10 border-2 border-amber-500/40 rounded-2xl p-3.5 space-y-1.5 text-amber-950">
                <div className="flex items-center gap-2 font-black text-xs text-amber-900">
                  <ShieldAlert size={18} className="text-amber-700 shrink-0" />
                  تأکید حیاتی بر عدم تغییر پرونده‌های قبلی:
                </div>
                <p className="text-xs font-bold leading-relaxed">
                  «تغییرات جدید فقط روی پرونده‌ها و محاسبات جدید اعمال می‌شود و پرونده‌ها، دفترچه‌ها و اسناد مالی قبلی بدون تغییر باقی می‌مانند.»
                </p>
              </div>

              {/* Change Reason Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-zinc-700">دلیل تغییر (جهت ثبت در لاگ سیستم):</label>
                <input
                  type="text"
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="مثلاً: به‌روزرسانی مصوبه کمیسیون اعتبارات..."
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-100 shrink-0">
              <button
                onClick={() => {
                  setPendingChange(null);
                  setChangeReason('');
                }}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-600 hover:bg-zinc-100 transition border border-zinc-200"
              >
                انصراف و بازگشت
              </button>

              <button
                onClick={async () => {
                  const btn = document.getElementById('btn-final-save');
                  if(btn) btn.innerHTML = 'در حال ذخیره‌سازی...';
                  try {
                    await pendingChange.applyCallback(changeReason || 'تغییر توسط مدیر');
                    setPendingChange(null);
                    setChangeReason('');
                    setShowSuccessToast(true);
                    setTimeout(() => setShowSuccessToast(false), 5000);
                  } catch (e) {
                    console.error(e);
                  }
                }}
                id="btn-final-save"
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-6 py-2.5 rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition flex items-center gap-2"
              >
                <Check size={16} />
                تأیید نهایی و ثبت تغییرات
              </button>
            </div>

          </div>
        </div>
      )}

      {/* EDIT / CREATE CALCULATOR MODAL */}
      {editingCalculatorModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-zinc-200 shadow-2xl max-w-2xl w-full p-5 sm:p-6 space-y-4 my-auto max-h-[90vh] flex flex-col justify-between overflow-y-auto animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3 text-indigo-600 shrink-0">
              <div className="flex items-center gap-3">
                <CalculatorIcon size={24} className="shrink-0" />
                <div>
                  <h3 className="font-black text-zinc-900 text-base">
                    {editingCalculatorModal.isNew ? 'تعریف ماشین‌حساب جدید' : `ویرایش ماشین‌حساب: ${editingCalculatorModal.calcData.name || ''}`}
                  </h3>
                  <span className="text-xs text-zinc-500 block">پیکربندی پارامترهای محاسباتی در دیتابیس سرور</span>
                </div>
              </div>
              <button
                onClick={() => setEditingCalculatorModal({ isOpen: false, isNew: false, calcData: {} })}
                className="p-2 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-xl transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-zinc-700">نام ماشین‌حساب *</label>
                  <input
                    type="text"
                    value={editingCalculatorModal.calcData.name || ''}
                    onChange={(e) => setEditingCalculatorModal(prev => ({
                      ...prev,
                      calcData: { ...prev.calcData, name: e.target.value }
                    }))}
                    placeholder="مثلاً: طرح چکی ویژه بهاره"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-zinc-700">نوع ماشین‌حساب *</label>
                  <select
                    value={editingCalculatorModal.calcData.type || 'sadi_bazaar'}
                    onChange={(e) => setEditingCalculatorModal(prev => ({
                      ...prev,
                      calcData: { ...prev.calcData, type: e.target.value as any }
                    }))}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                  >
                    <option value="sadi_bazaar">طرح صدی بازار (چکی ماهانه)</option>
                    <option value="pelkani">طرح پلکانی (پله‌های زمانی)</option>
                    <option value="beta">طرح سامانه بتا (بانکی)</option>
                    <option value="installment">اقساطی استاندارد</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-zinc-700">توضیحات و راهنمای طرح</label>
                <textarea
                  rows={2}
                  value={editingCalculatorModal.calcData.description || ''}
                  onChange={(e) => setEditingCalculatorModal(prev => ({
                    ...prev,
                    calcData: { ...prev.calcData, description: e.target.value }
                  }))}
                  placeholder="توضیحات مربوط به شیوه محاسبه و الزامات..."
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-zinc-700">نرخ پایه (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingCalculatorModal.calcData.baseRatePercent ?? ''}
                    onChange={(e) => setEditingCalculatorModal(prev => ({
                      ...prev,
                      calcData: { ...prev.calcData, baseRatePercent: e.target.value === '' ? undefined : parseFloat(e.target.value) }
                    }))}
                    placeholder="مثلاً 7"
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-center"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-zinc-700">کارمزد بانک (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingCalculatorModal.calcData.betaBankFeeRate ?? ''}
                    onChange={(e) => setEditingCalculatorModal(prev => ({
                      ...prev,
                      calcData: { ...prev.calcData, betaBankFeeRate: e.target.value === '' ? undefined : parseFloat(e.target.value) }
                    }))}
                    placeholder="مثلاً 5"
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-center"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-zinc-700">سقف تعداد اقساط</label>
                  <input
                    type="number"
                    value={editingCalculatorModal.calcData.maxInstallmentCount ?? ''}
                    onChange={(e) => setEditingCalculatorModal(prev => ({
                      ...prev,
                      calcData: { ...prev.calcData, maxInstallmentCount: e.target.value === '' ? undefined : parseInt(e.target.value, 10) }
                    }))}
                    placeholder="مثلاً 12"
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-center"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-zinc-700">نرخ پله ۱ (۱-۶ ماه %)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingCalculatorModal.calcData.pelkaniTier1BaseRate ?? ''}
                    onChange={(e) => setEditingCalculatorModal(prev => ({
                      ...prev,
                      calcData: { ...prev.calcData, pelkaniTier1BaseRate: e.target.value === '' ? undefined : parseFloat(e.target.value) }
                    }))}
                    placeholder="7.5"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-center"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-zinc-700">نرخ پله ۲ (۷-۱۲ ماه %)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingCalculatorModal.calcData.pelkaniTier2BaseRate ?? ''}
                    onChange={(e) => setEditingCalculatorModal(prev => ({
                      ...prev,
                      calcData: { ...prev.calcData, pelkaniTier2BaseRate: e.target.value === '' ? undefined : parseFloat(e.target.value) }
                    }))}
                    placeholder="8.0"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-center"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-zinc-700">نرخ پله ۳ (۱۳-۲۴ ماه %)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingCalculatorModal.calcData.pelkaniTier3BaseRate ?? ''}
                    onChange={(e) => setEditingCalculatorModal(prev => ({
                      ...prev,
                      calcData: { ...prev.calcData, pelkaniTier3BaseRate: e.target.value === '' ? undefined : parseFloat(e.target.value) }
                    }))}
                    placeholder="8.5"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-center"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-zinc-700">نام بانک عامل (در صورت وجود)</label>
                  <input
                    type="text"
                    value={editingCalculatorModal.calcData.bankName || ''}
                    onChange={(e) => setEditingCalculatorModal(prev => ({
                      ...prev,
                      calcData: { ...prev.calcData, bankName: e.target.value }
                    }))}
                    placeholder="مثلاً: بانک رفاه کارگران"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-zinc-700">درصد شیب اقساط (نزولی)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={editingCalculatorModal.calcData.decliningSlopePercentage ?? ''}
                    onChange={(e) => setEditingCalculatorModal(prev => ({
                      ...prev,
                      calcData: { ...prev.calcData, decliningSlopePercentage: e.target.value === '' ? undefined : parseFloat(e.target.value) }
                    }))}
                    placeholder="مثلاً 20"
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-center"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-100 shrink-0">
              <button
                onClick={() => setEditingCalculatorModal({ isOpen: false, isNew: false, calcData: {} })}
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-zinc-600 hover:bg-zinc-100 transition border border-zinc-200"
                disabled={isSubmitting}
              >
                انصراف
              </button>

              <button
                onClick={() => handleSaveCalculatorForm(editingCalculatorModal.calcData, editingCalculatorModal.isNew)}
                disabled={isSubmitting || !editingCalculatorModal.calcData.name}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-6 py-2.5 rounded-xl text-xs shadow-lg shadow-indigo-600/30 transition flex items-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {editingCalculatorModal.isNew ? 'ثبت و ساخت در سرور' : 'ذخیره تغییرات در سرور'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deletingCalculator && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl border border-zinc-200 shadow-2xl max-w-md w-full p-6 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle size={28} className="shrink-0" />
              <div>
                <h3 className="font-black text-zinc-900 text-base">حذف ماشین‌حساب</h3>
                <span className="text-xs text-zinc-500 block">حذف دائمی از دیتابیس سرور</span>
              </div>
            </div>

            <p className="text-xs text-zinc-700 leading-relaxed">
              آیا از حذف ماشین‌حساب <strong className="text-zinc-900">«{deletingCalculator.name}»</strong> مطمئن هستید؟ این عملیات غیرقابل بازگشت است.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-100">
              <button
                onClick={() => setDeletingCalculator(null)}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-600 hover:bg-zinc-100 transition border border-zinc-200"
              >
                انصراف
              </button>
              <button
                onClick={() => handleDeleteCalculator(deletingCalculator)}
                disabled={isSubmitting}
                className="bg-rose-600 hover:bg-rose-700 text-white font-black px-5 py-2 rounded-xl text-xs shadow-md transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                تأیید حذف
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default CalculatorManagementCenter;
