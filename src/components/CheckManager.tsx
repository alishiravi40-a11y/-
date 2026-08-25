/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, CheckSquare, Calendar, ChevronRight, RefreshCw, Landmark, AlertTriangle, CheckCircle, ArrowUpRight, ArrowDownLeft, Sparkles, Check, Search, Upload, Trash2, Edit2, X, FileText, Image as ImageIcon, ShieldCheck, Scale, History, Paperclip, Lock, Eye, Download, AlertCircle, Filter, Users, BookOpen, BookMarked, ArrowRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Check as CheckTypeModel, CheckType, Person, PersonAttachment, AccountSubsidiary, ReceivedCheckState, PaidCheckState, BouncedReceivedCheckSubState, BouncedPaidCheckSubState, AppState, CheckbookModel, CheckbookLeafModel } from '../types';
import { getCurrentJalaliDate, addMonthsToJalali, parseJalali, jalaliToGregorian, gregorianToJalali, formatJalali, normalizeJalaliDate, validateJalaliDate } from '../utils/jalali';
import { DEFAULT_SUBSIDIARIES, parseNumericValue, toEnglishDigits } from '../utils/accounting';
import PersonSelector from './PersonSelector';
import ReceivedChecksCentralReport from './ReceivedChecksCentralReport';
import ReceivedChecksTab from './checks/ReceivedChecksTab';
import IssuedChecksTab from './checks/IssuedChecksTab';
import CheckStatusChangeModal from './checks/CheckStatusChangeModal';
import { useCoaReadModel } from '../services/CoaReadService';

interface CheckManagerProps {
  checks: CheckTypeModel[];
  persons: Person[];
  onAddCheck: (checkData: Omit<CheckTypeModel, 'id' | 'currentState' | 'history' | 'createdAt'>) => void;
  onUpdateCheckState: (
    checkId: string, 
    newState: ReceivedCheckState | PaidCheckState, 
    newSubState?: BouncedReceivedCheckSubState | BouncedPaidCheckSubState,
    note?: string,
    bankId?: string,
    cashId?: string,
    endorsedPersonId?: string
  ) => void;
  onBulkUpdateCheckState?: (
    checkIds: string[], 
    newState: ReceivedCheckState | PaidCheckState, 
    newSubState?: BouncedReceivedCheckSubState | BouncedPaidCheckSubState,
    note?: string,
    bankId?: string,
    cashId?: string,
    endorsedPersonId?: string
  ) => void;
  currentUserRole?: 'admin' | 'agent';
  currentAgentId?: string;
  onEditCheck?: (check: CheckTypeModel) => void;
  onDeleteCheck?: (checkId: string, reason?: string) => void;
  onApproveCheck?: (checkId: string) => void;
  onBulkAddChecks?: (checks: Omit<CheckTypeModel, 'id' | 'currentState' | 'history' | 'createdAt'>[]) => void;
  onOpenAdvancedSearch?: () => void;
  prefilledPersonId?: string;
  prefilledIsAmani?: boolean;
  onClearPrefill?: () => void;
  onSaveCheckbook?: (checkbook: CheckbookModel) => void;
  onUpdateCheckbook?: (checkbook: CheckbookModel) => void;
  onDeleteCheckbook?: (checkbookId: string) => void;
  state?: AppState;
  onViewVoucher?: (voucherId: string) => void;
  onViewCheck?: (checkId: string) => void;
}

function getDaysDiff(d1: string, d2: string): number {
  const p1 = parseJalali(d1);
  const p2 = parseJalali(d2);
  if (!p1 || !p2) return 0;
  const g1 = jalaliToGregorian(p1.jy, p1.jm, p1.jd);
  const g2 = jalaliToGregorian(p2.jy, p2.jm, p2.jd);
  const diffTime = g1.getTime() - g2.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

function addDaysToJalaliDate(dateStr: string, days: number): string {
  const p = parseJalali(dateStr);
  if (!p) return dateStr;
  const gDate = jalaliToGregorian(p.jy, p.jm, p.jd);
  gDate.setDate(gDate.getDate() + days);
  const [jy, jm, jd] = gregorianToJalali(gDate.getFullYear(), gDate.getMonth() + 1, gDate.getDate());
  return formatJalali(jy, jm, jd);
}

export default function CheckManager({
  checks,
  persons,
  onAddCheck,
  onUpdateCheckState,
  onBulkUpdateCheckState,
  currentUserRole = 'admin',
  currentAgentId,
  onEditCheck,
  onDeleteCheck,
  onApproveCheck,
  onBulkAddChecks,
  onOpenAdvancedSearch,
  prefilledPersonId,
  prefilledIsAmani,
  onClearPrefill,
  onSaveCheckbook,
  onUpdateCheckbook,
  onDeleteCheckbook,
  state: stateProp,
  onViewVoucher,
  onViewCheck
}: CheckManagerProps) {
  const [activeTab, setActiveTab] = useState<CheckType>('received');
  const [innerTab, setInnerTab] = useState<'operations' | 'dashboard' | 'analytics' | 'legal'>('operations');
  const [analyticsTab, setAnalyticsTab] = useState<'liquidity_forecast' | 'entities_breakdown'>('liquidity_forecast');
  
  const reportState = useMemo(() => {
    if (stateProp) return stateProp;
    return {
      checks,
      persons,
      journalVouchers: [],
    } as unknown as AppState;
  }, [stateProp, checks, persons]);

  const [showAddForm, setShowAddForm] = useState(false);

  // Checkbook States
  const checkbooksList: CheckbookModel[] = useMemo(() => stateProp?.checkbooks || [], [stateProp?.checkbooks]);
  const [selectedCheckbookId, setSelectedCheckbookId] = useState<string>('');
  const [selectedLeafIndex, setSelectedLeafIndex] = useState<number | null>(null);

  const [showCheckbooksManagerModal, setShowCheckbooksManagerModal] = useState<boolean>(false);
  const [showCreateCheckbookModal, setShowCreateCheckbookModal] = useState<boolean>(false);
  const [viewingCheckbookId, setViewingCheckbookId] = useState<string | null>(null);

  // Create Checkbook Form States
  const [cbBankAccountId, setCbBankAccountId] = useState<string>('');
  const [cbTitle, setCbTitle] = useState<string>('');
  const [cbIssuerNationalId, setCbIssuerNationalId] = useState<string>('');
  const [cbTotalLeaves, setCbTotalLeaves] = useState<number>(25);
  const [cbStartSerial, setCbStartSerial] = useState<string>('10001');
  const [cbPrefix4Digits, setCbPrefix4Digits] = useState<string>('1001');
  const [cbMiddle8Digits, setCbMiddle8Digits] = useState<string>('12345678');
  const [cbLast4DigitsDefault, setCbLast4DigitsDefault] = useState<string>('0001');
  const [cbCustomLeavesLast4, setCbCustomLeavesLast4] = useState<Record<number, string>>({});
  const [cbError, setCbError] = useState<string | null>(null);
  const [cbLeafSearchQuery, setCbLeafSearchQuery] = useState<string>('');
  const leafInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({});

  // Leaves preview for checkbook creation
  const generatedLeavesPreview = useMemo(() => {
    if (!cbTotalLeaves || cbTotalLeaves <= 0) return [];
    const startNum = parseInt(toEnglishDigits(cbStartSerial)) || 10001;
    const prefixNum = parseInt(toEnglishDigits(cbPrefix4Digits)) || 1001;
    const midStr = toEnglishDigits(cbMiddle8Digits).padStart(8, '0').slice(0, 8);
    
    const leaves: CheckbookLeafModel[] = [];
    for (let i = 1; i <= cbTotalLeaves; i++) {
      const leafSerial = (startNum + i - 1).toString();
      const leafPrefix = (prefixNum + i - 1).toString().padStart(4, '0').slice(-4);
      const customLast4 = cbCustomLeavesLast4[i];
      const defaultForLeaf = (i === 1 ? (cbLast4DigitsDefault || '') : '');
      const leafLast4Val = customLast4 !== undefined ? customLast4 : defaultForLeaf;
      const leafLast4Padded = leafLast4Val ? leafLast4Val.padStart(4, '0').slice(-4) : '0000';
      const sayadi = `${leafPrefix}${midStr}${leafLast4Padded}`;
      leaves.push({
        leafIndex: i,
        checkNumber: leafSerial,
        sayadiNumber: sayadi,
        status: 'unused'
      });
    }
    return leaves;
  }, [cbTotalLeaves, cbStartSerial, cbPrefix4Digits, cbMiddle8Digits, cbLast4DigitsDefault, cbCustomLeavesLast4]);

  // Prefill effect
  React.useEffect(() => {
    if (prefilledPersonId) {
      setPersonId(prefilledPersonId);
      setShowAddForm(true);
      if (prefilledIsAmani !== undefined) {
        setIsAmani(prefilledIsAmani);
      }
      // Notify parent to clear prefill so it doesn't trigger again on tab switch
      if (onClearPrefill) onClearPrefill();
    }
  }, [prefilledPersonId, prefilledIsAmani, onClearPrefill]);
  const [editingCheckId, setEditingCheckId] = useState<string | null>(null);

  const editingCheck = useMemo(() => {
    return editingCheckId ? checks.find(c => c.id === editingCheckId) : null;
  }, [checks, editingCheckId]);

  const isEditingWithVoucher = useMemo(() => {
    if (!editingCheck) return false;
    return !!editingCheck.voucherId || (editingCheck.history && editingCheck.history.some(h => !!h.voucherId));
  }, [editingCheck]);
  const [selectedCheckForStateChange, setSelectedCheckForStateChange] = useState<CheckTypeModel | null>(null);
  const [selectedBulkChecks, setSelectedBulkChecks] = useState<string[]>([]);
  const [isBulkPanelExpanded, setIsBulkPanelExpanded] = useState(false);

  // Bulk action / Purpose states
  const [activeBulkAction, setActiveBulkAction] = useState<'ras' | 'deposit' | 'endorse' | 'list' | null>('ras');
  const [bulkBankId, setBulkBankId] = useState('SUB_BANK_MELI');
  const [bulkPersonId, setBulkPersonId] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [rasBaseDate, setRasBaseDate] = useState(getCurrentJalaliDate());
  const [bulkConfirmType, setBulkConfirmType] = useState<'deposit' | 'endorse' | 'clear_paid' | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Dedicated Check Dossier & Audit Trail States
  const [selectedCheckForDossier, setSelectedCheckForDossier] = useState<CheckTypeModel | null>(null);
  const [dossierTab, setDossierTab] = useState<'archive' | 'legal' | 'audit'>('archive');
  const [dossierMsg, setDossierMsg] = useState<string | null>(null);

  // Legal Dossier Fields
  const [dossierLegalCaseNo, setDossierLegalCaseNo] = useState('');
  const [dossierLegalAuthRef, setDossierLegalAuthRef] = useState('');
  const [dossierNonPayCertNo, setDossierNonPayCertNo] = useState('');
  const [dossierNonPayCertDate, setDossierNonPayCertDate] = useState('');
  const [dossierAssignedLawyer, setDossierAssignedLawyer] = useState('');
  const [dossierLastStatus, setDossierLastStatus] = useState('');
  const [dossierLastActionDate, setDossierLastActionDate] = useState('');

  // Image Modal Preview State
  const [previewImage, setPreviewImage] = useState<{ title: string; url: string } | null>(null);

  // Advanced Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [quickFilter, setQuickFilter] = useState<'all' | 'present_in_cashbox' | 'deposited_to_bank' | 'bounced'>('all');

  const handleQuickFilterClick = (filter: 'all' | 'present_in_cashbox' | 'deposited_to_bank' | 'bounced') => {
    setQuickFilter(filter);
    setStatusFilter('all'); // Clear standard filter to prevent conflicting states
  };
  const [bankFilter, setBankFilter] = useState<string>('all');
  const [legalOnlyFilter, setLegalOnlyFilter] = useState(false);
  const [missingImagesFilter, setMissingImagesFilter] = useState(false);
  const [overdueOnlyFilter, setOverdueOnlyFilter] = useState(false);

  React.useEffect(() => {
    if (selectedCheckForDossier) {
      setDossierLegalCaseNo(selectedCheckForDossier.legalCaseNumber || '');
      setDossierLegalAuthRef(selectedCheckForDossier.legalAuthorityReference || '');
      setDossierNonPayCertNo(selectedCheckForDossier.nonPaymentCertificateNumber || '');
      setDossierNonPayCertDate(selectedCheckForDossier.nonPaymentCertificateDate || '');
      setDossierAssignedLawyer(selectedCheckForDossier.legalAssignedLawyer || '');
      setDossierLastStatus(selectedCheckForDossier.legalLastStatus || '');
      setDossierLastActionDate(selectedCheckForDossier.legalLastActionDate || '');
      setDossierMsg(null);
    }
  }, [selectedCheckForDossier]);

  // Add Form States
  const [checkNumber, setCheckNumber] = useState('');
  const [sayadiNumber, setSayadiNumber] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [bankName, setBankName] = useState('');
  const [issuerBankAccountId, setIssuerBankAccountId] = useState('');
  const [dueDate, setDueDate] = useState(getCurrentJalaliDate());
  const [amount, setAmount] = useState<number>(0);
  const [personId, setPersonId] = useState('');
  const [isAmani, setIsAmani] = useState(false);
  const [totalChecksToEnter, setTotalChecksToEnter] = useState<string>('');
  const [enteredChecksCount, setEnteredChecksCount] = useState<number>(0);
  const [isBankListOpen, setIsBankListOpen] = useState(false);

  // Suggested Banks States
  const [suggestedBanks, setSuggestedBanks] = useState<string[]>(() => {
    const saved = localStorage.getItem('custom_banks');
    const defaults = ['ملی', 'ملت', 'صادرات', 'تجارت', 'سپه', 'مسکن', 'کشاورزی', 'پاسارگاد', 'سامان', 'پارسیان', 'رفاه', 'رسالت'];
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.from(new Set([...defaults, ...parsed]));
      } catch {
        return defaults;
      }
    }
    return defaults;
  });

  const [searchQuery, setSearchQuery] = useState('');

  // Checkbook selection & management helpers
  const handleSelectCheckbook = (cbId: string) => {
    setSelectedCheckbookId(cbId);
    if (!cbId) {
      setSelectedLeafIndex(null);
      return;
    }
    const cb = checkbooksList.find(c => c.id === cbId);
    if (!cb) return;

    if (cb.bankAccountId) {
      setIssuerBankAccountId(cb.bankAccountId);
    }
    if (cb.bankName) {
      setBankName(cb.bankName);
    }
    if (cb.issuerNationalId) {
      setNationalId(cb.issuerNationalId);
    }

    const firstUnused = cb.leaves.find(l => l.status === 'unused');
    if (firstUnused) {
      setCheckNumber(firstUnused.checkNumber);
      setSayadiNumber(firstUnused.sayadiNumber);
      setSelectedLeafIndex(firstUnused.leafIndex);
    } else {
      setSelectedLeafIndex(null);
      alert('⚠️ تمامی برگه‌های این دسته چک صادر یا باطل شده‌اند.');
    }
  };

  const handleCheckNumberChangeWithCheckbook = (val: string) => {
    const sanitized = toEnglishDigits(val);
    setCheckNumber(sanitized);

    if (selectedCheckbookId && activeTab === 'paid') {
      const cb = checkbooksList.find(c => c.id === selectedCheckbookId);
      if (cb) {
        const matchedLeaf = cb.leaves.find(l => l.checkNumber === sanitized);
        if (matchedLeaf) {
          setSayadiNumber(matchedLeaf.sayadiNumber);
          setSelectedLeafIndex(matchedLeaf.leafIndex);
        } else {
          setSelectedLeafIndex(null);
        }
      }
    }
  };

  const handleCreateCheckbookSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCbError(null);

    if (!cbBankAccountId) {
      setCbError('لطفاً حساب بانکی متصل را انتخاب کنید.');
      return;
    }
    if (!cbStartSerial || cbTotalLeaves <= 0) {
      setCbError('لطفاً شماره سریال شروع و تعداد برگه‌ها را به درستی وارد کنید.');
      return;
    }
    if (!cbPrefix4Digits || cbPrefix4Digits.length !== 4) {
      setCbError('۴ رقم اول کد صیادی باید دقیقاً ۴ رقم باشد.');
      return;
    }
    if (!cbMiddle8Digits || cbMiddle8Digits.length !== 8) {
      setCbError('۸ رقم وسط کد صیادی باید دقیقاً ۸ رقم باشد.');
      return;
    }

    const selectedBankSub = bankSubAccounts.find(b => b.id === cbBankAccountId);
    const bankTitle = selectedBankSub ? selectedBankSub.name : 'بانک';
    
    const newCheckbook: CheckbookModel = {
      id: `cb_${Date.now()}`,
      bankAccountId: cbBankAccountId,
      bankName: bankTitle,
      issuerNationalId: cbIssuerNationalId || undefined,
      totalLeaves: cbTotalLeaves,
      startSerial: cbStartSerial,
      endSerial: String(Number(cbStartSerial) + cbTotalLeaves - 1),
      prefix4Digits: cbPrefix4Digits,
      middle8Digits: cbMiddle8Digits,
      leaves: generatedLeavesPreview,
      createdAt: getCurrentJalaliDate(),
      status: 'active',
      title: cbTitle || `دسته چک ${cbTotalLeaves} برگی ${bankTitle}`
    };

    if (onSaveCheckbook) {
      onSaveCheckbook(newCheckbook);
    }

    setShowCreateCheckbookModal(false);
    // Reset form
    setCbTitle('');
    setCbIssuerNationalId('');
    setCbCustomLeavesLast4({});
    
    if (activeTab === 'paid') {
      handleSelectCheckbook(newCheckbook.id);
    }
  };

  const handleToggleLeafStatus = (checkbookId: string, leafIndex: number, currentStatus: string) => {
    const cb = checkbooksList.find(c => c.id === checkbookId);
    if (!cb) return;

    let newStatus: 'unused' | 'issued' | 'cancelled' = 'unused';
    if (currentStatus === 'unused') {
      newStatus = 'cancelled';
    } else if (currentStatus === 'cancelled') {
      newStatus = 'unused';
    } else {
      alert('برگه‌های صادر شده را نمی‌توان به طور مستقیم تغییر وضعیت داد.');
      return;
    }

    const updatedLeaves = cb.leaves.map(l => l.leafIndex === leafIndex ? { ...l, status: newStatus } : l);
    const allFinished = updatedLeaves.every(l => l.status === 'issued' || l.status === 'cancelled');
    const updatedCb: CheckbookModel = {
      ...cb,
      leaves: updatedLeaves,
      status: allFinished ? 'finished' : 'active'
    };

    if (onUpdateCheckbook) {
      onUpdateCheckbook(updatedCb);
    }
  };

  const [successFeedback, setSuccessFeedback] = useState<string | null>(null);

  // Custom confirmation modal state
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const changeBulkAction = (action: 'ras' | 'deposit' | 'endorse' | 'list' | null) => {
    setActiveBulkAction(action);
    setBulkConfirmType(null);
    setBulkError(null);
  };

  // Transition States
  const [selectedBankId, setSelectedBankId] = useState('SUB_BANK_MELI');
  const [selectedCashId, setSelectedCashId] = useState('SUB_CASH_MAIN');
  const [stateNote, setStateNote] = useState('');

  const { subsidiaries: activeSubsidiaries } = useCoaReadModel(stateProp?.subsidiaries);

  const bankSubAccounts = useMemo(() => {
    return activeSubsidiaries.filter(s => s.generalType === 'بانک‌ها');
  }, [activeSubsidiaries]);

  const banks = bankSubAccounts;

  // Single Paid Check Bank Auto-Select & Lock Resolution
  const isSinglePaidCheck = selectedCheckForStateChange?.type === 'paid';
  const resolvedSinglePaidBankId = useMemo(() => {
    if (!selectedCheckForStateChange || selectedCheckForStateChange.type !== 'paid') return null;
    if (selectedCheckForStateChange.issuerBankAccountId) {
      return selectedCheckForStateChange.issuerBankAccountId;
    }
    if (selectedCheckForStateChange.bankName) {
      const matched = bankSubAccounts.find(b => 
        b.name.trim().toLowerCase() === selectedCheckForStateChange.bankName.trim().toLowerCase() ||
        b.name.includes(selectedCheckForStateChange.bankName) ||
        selectedCheckForStateChange.bankName.includes(b.name)
      );
      if (matched) return matched.id;
    }
    return null;
  }, [selectedCheckForStateChange, bankSubAccounts]);

  useEffect(() => {
    if (selectedCheckForStateChange && selectedCheckForStateChange.type === 'paid') {
      if (resolvedSinglePaidBankId) {
        setSelectedBankId(resolvedSinglePaidBankId);
      } else if (bankSubAccounts[0]?.id) {
        setSelectedBankId(bankSubAccounts[0].id);
      }
    }
  }, [selectedCheckForStateChange, resolvedSinglePaidBankId, bankSubAccounts]);

  // Bulk Paid Checks Bank Analysis (Single Bank vs Multi Bank vs Legacy)
  const bulkEligiblePaidChecks = useMemo(() => {
    if (activeTab !== 'paid') return [];
    return selectedBulkChecks
      .map(id => checks.find(x => x.id === id))
      .filter((c): c is CheckTypeModel => !!c && c.type === 'paid' && c.currentState === 'issued');
  }, [selectedBulkChecks, checks, activeTab]);

  const bulkPaidBankAnalysis = useMemo(() => {
    if (activeTab !== 'paid' || bulkEligiblePaidChecks.length === 0) {
      return { isMultiBank: false, singleBankId: null, hasLegacyUnknown: false };
    }

    const resolvedIds = bulkEligiblePaidChecks.map(c => {
      if (c.issuerBankAccountId) return c.issuerBankAccountId;
      if (c.bankName) {
        const matched = bankSubAccounts.find(b => 
          b.name.trim().toLowerCase() === c.bankName.trim().toLowerCase() ||
          b.name.includes(c.bankName) ||
          c.bankName.includes(b.name)
        );
        if (matched) return matched.id;
      }
      return null;
    });

    const uniqueResolved = Array.from(new Set(resolvedIds.filter((id): id is string => id !== null)));
    const hasLegacyUnknown = resolvedIds.some(id => id === null);

    if (uniqueResolved.length === 1 && !hasLegacyUnknown) {
      return { isMultiBank: false, singleBankId: uniqueResolved[0], hasLegacyUnknown: false };
    } else if (uniqueResolved.length > 1) {
      return { isMultiBank: true, singleBankId: null, hasLegacyUnknown };
    } else if (uniqueResolved.length === 1 && hasLegacyUnknown) {
      return { isMultiBank: true, singleBankId: uniqueResolved[0], hasLegacyUnknown };
    } else {
      return { isMultiBank: false, singleBankId: null, hasLegacyUnknown: true };
    }
  }, [bulkEligiblePaidChecks, bankSubAccounts, activeTab]);

  useEffect(() => {
    if (activeTab === 'paid' && bulkPaidBankAnalysis.singleBankId) {
      setBulkBankId(bulkPaidBankAnalysis.singleBankId);
    }
  }, [activeTab, bulkPaidBankAnalysis.singleBankId]);

  const cashboxes = useMemo(() => {
    return DEFAULT_SUBSIDIARIES.filter(s => s.generalType === 'صندوق‌ها');
  }, []);

  const handleAddCustomBank = (newBank: string) => {
    const trimmed = newBank.trim();
    if (trimmed && !suggestedBanks.includes(trimmed)) {
      const updated = [...suggestedBanks, trimmed];
      setSuggestedBanks(updated);
      const defaults = ['ملی', 'ملت', 'صادرات', 'تجارت', 'سپه', 'مسکن', 'کشاورزی', 'پاسارگاد', 'سامان', 'پارسیان', 'رفاه', 'رسالت'];
      const customOnly = updated.filter(b => !defaults.includes(b));
      localStorage.setItem('custom_banks', JSON.stringify(customOnly));
    }
  };

  const incrementCheckNumber = (numStr: string): string => {
    const match = numStr.match(/(\d+)$/);
    if (!match) return numStr;
    const digits = match[1];
    const length = digits.length;
    try {
      const incremented = (BigInt(digits) + 1n).toString().padStart(length, '0');
      return numStr.substring(0, numStr.length - length) + incremented;
    } catch {
      return numStr; // Fallback
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveDossierFields = () => {
    if (!selectedCheckForDossier || !onEditCheck) return;
    const updated: CheckTypeModel = {
      ...selectedCheckForDossier,
      legalCaseNumber: dossierLegalCaseNo,
      legalAuthorityReference: dossierLegalAuthRef,
      nonPaymentCertificateNumber: dossierNonPayCertNo,
      nonPaymentCertificateDate: dossierNonPayCertDate,
      legalAssignedLawyer: dossierAssignedLawyer,
      legalLastStatus: dossierLastStatus,
      legalLastActionDate: dossierLastActionDate,
    };
    onEditCheck(updated);
    setSelectedCheckForDossier(updated);
    setDossierMsg('اطلاعات پرونده حقوقی با موفقیت ثبت شد.');
    setTimeout(() => setDossierMsg(null), 3000);
  };

  const handleUploadImageSlot = (
    slotKey: 'frontImage' | 'backImage' | 'endorsementImage' | 'nonPaymentCertificateImage',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCheckForDossier || !onEditCheck) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        const updated: CheckTypeModel = {
          ...selectedCheckForDossier,
          [slotKey]: dataUrl,
        };
        onEditCheck(updated);
        setSelectedCheckForDossier(updated);
        setDossierMsg('تصویر مدرک چک با موفقیت آپلود شد.');
        setTimeout(() => setDossierMsg(null), 3000);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUploadLegalDoc = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCheckForDossier || !onEditCheck) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        const newAttachment: PersonAttachment = {
          id: `att_check_legal_${Date.now()}`,
          name: file.name,
          url: dataUrl,
          type: file.type || 'application/pdf',
          uploadDate: getCurrentJalaliDate(),
          category: 'other'
        };
        const existing = selectedCheckForDossier.legalDocuments || [];
        const updated: CheckTypeModel = {
          ...selectedCheckForDossier,
          legalDocuments: [...existing, newAttachment]
        };
        onEditCheck(updated);
        setSelectedCheckForDossier(updated);
        setDossierMsg(`سند حقوقی «${file.name}» به بایگانی چک پیوست شد.`);
        setTimeout(() => setDossierMsg(null), 3000);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Expected headers: مبلغ, تاریخ, بانک, شماره چک, کد ملی (optional unless agent)
        const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);
        
        const newChecks: Omit<CheckTypeModel, 'id' | 'currentState' | 'history' | 'createdAt'>[] = [];
        
        for (const row of jsonData) {
          const checkAmount = parseNumericValue(row['مبلغ'] || row['amount'] || 0);
          const checkDate = row['تاریخ'] || row['date'] || getCurrentJalaliDate();
          const checkBank = row['بانک'] || row['bankName'] || '';
          const checkNo = row['شماره چک'] || row['checkNumber'] || '';
          const natId = row['کد ملی'] || row['nationalId'] || '';
          const pId = row['شناسه شخص'] || row['personId'] || (currentUserRole === 'agent' ? currentAgentId : personId); // default to selected person if not provided
          
          if (!checkAmount || !checkBank || !checkNo || !pId) continue;
          
          if (currentUserRole === 'agent' && !natId) continue; // Skip if agent and no national ID
          
          newChecks.push({
            type: activeTab,
            checkNumber: String(checkNo),
            bankName: String(checkBank),
            dueDate: String(checkDate),
            amount: checkAmount,
            personId: String(pId),
            nationalId: natId ? String(natId) : undefined,
            isApproved: currentUserRole === 'admin',
            submittedByAgentId: currentUserRole === 'agent' ? currentAgentId : undefined
          });
        }
        
        if (newChecks.length > 0) {
          if (onBulkAddChecks) {
            onBulkAddChecks(newChecks);
            alert(`تعداد ${newChecks.length} چک با موفقیت وارد شد.`);
          } else {
            // fallback if bulk add not supported, though it should be added to App.tsx
            newChecks.forEach(c => onAddCheck(c));
            alert(`تعداد ${newChecks.length} چک با موفقیت وارد شد.`);
          }
        } else {
          alert('هیچ چک معتبری در فایل یافت نشد. لطفاً ساختار ستون‌ها را بررسی کنید (مبلغ، تاریخ، بانک، شماره چک، کد ملی، شناسه شخص)');
        }
      } catch (err) {
        console.error(err);
        alert('خطا در خواندن فایل اکسل.');
      }
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsArrayBuffer(file);
  };

  const handleAddCheckSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!personId || !checkNumber || amount <= 0 || !bankName) {
      alert("لطفاً تمامی فیلدهای الزامی چک را پر کنید.");
      return;
    }

    const normalizedDueDate = normalizeJalaliDate(dueDate);
    if (!validateJalaliDate(normalizedDueDate)) {
      alert(`تاریخ سررسید وارد شده (${dueDate}) نامعتبر است. لطفاً تاریخ صحیح شمسی را به صورت YYYY/MM/DD وارد کنید.`);
      return;
    }
    setDueDate(normalizedDueDate);

    if (currentUserRole === 'agent' && !nationalId) {
      alert("وارد کردن کد ملی صاحب چک برای نمایندگان الزامی است.");
      return;
    }

    if (nationalId) {
      // Check if nationalId has bounced checks
      const hasBounced = checks.some(c => c.nationalId === nationalId && c.currentState === 'bounced');
      if (hasBounced) {
        if (!window.confirm("هشدار: این کد ملی دارای سابقه چک برگشتی است. آیا از ثبت این چک اطمینان دارید؟")) {
          return;
        }
      }
    }

    if (editingCheckId && onEditCheck) {
      const originalCheck = checks.find(c => c.id === editingCheckId);
      if (originalCheck) {
        const hasVoucher = !!originalCheck.voucherId || (originalCheck.history && originalCheck.history.some(h => !!h.voucherId));
        onEditCheck({
          ...originalCheck,
          checkNumber: hasVoucher ? originalCheck.checkNumber : checkNumber,
          sayadiNumber: hasVoucher ? originalCheck.sayadiNumber : (sayadiNumber || undefined),
          bankName: hasVoucher ? originalCheck.bankName : bankName,
          issuerBankAccountId: hasVoucher ? originalCheck.issuerBankAccountId : (activeTab === 'paid' ? issuerBankAccountId : undefined),
          dueDate: hasVoucher ? originalCheck.dueDate : normalizedDueDate,
          amount: hasVoucher ? originalCheck.amount : amount,
          personId: hasVoucher ? originalCheck.personId : personId,
          isAmani: hasVoucher ? originalCheck.isAmani : isAmani,
          nationalId: nationalId || undefined,
        });
      }
      setEditingCheckId(null);
      setShowAddForm(false);
      return;
    }

    onAddCheck({
      type: activeTab,
      checkNumber,
      sayadiNumber: sayadiNumber || undefined,
      bankName,
      issuerBankAccountId: activeTab === 'paid' ? issuerBankAccountId : undefined,
      checkbookId: activeTab === 'paid' ? (selectedCheckbookId || undefined) : undefined,
      leafIndex: activeTab === 'paid' ? (selectedLeafIndex || undefined) : undefined,
      dueDate: normalizedDueDate,
      amount,
      personId,
      nationalId: nationalId || undefined,
      isApproved: currentUserRole === 'admin',
      submittedByAgentId: currentUserRole === 'agent' ? currentAgentId : undefined,
      isAmani,
    });

    const currentEntered = enteredChecksCount + 1;
    setEnteredChecksCount(currentEntered);

    const totalToEnterNum = parseInt(toEnglishDigits(totalChecksToEnter));
    
    if (!isNaN(totalToEnterNum) && totalToEnterNum > 0 && currentEntered >= totalToEnterNum) {
      setSuccessFeedback(`تعداد ${totalToEnterNum} فقره چک ثبت شد. فرآیند ثبت متوالی به پایان رسید.`);
      setTimeout(() => setSuccessFeedback(null), 5000);
      setShowAddForm(false);
      
      // Reset fields fully so next time they open the form, they see blank inputs
      setCheckNumber('');
      setSayadiNumber('');
      setBankName('');
      setAmount(0);
      setPersonId('');
      setTotalChecksToEnter('');
      setEnteredChecksCount(0);
      setSelectedCheckbookId('');
      setSelectedLeafIndex(null);
    } else {
      const nextDueDate = addMonthsToJalali(normalizedDueDate, 1);
      
      // If checkbook is active, auto-advance to next unused leaf
      let nextCheckNumber = incrementCheckNumber(checkNumber);
      let nextSayadiNumber = '';
      
      if (activeTab === 'paid' && selectedCheckbookId) {
        const cb = checkbooksList.find(c => c.id === selectedCheckbookId);
        if (cb) {
          const unusedLeaves = cb.leaves.filter(l => l.status === 'unused' && l.leafIndex !== selectedLeafIndex);
          if (unusedLeaves.length > 0) {
            nextCheckNumber = unusedLeaves[0].checkNumber;
            nextSayadiNumber = unusedLeaves[0].sayadiNumber;
            setSelectedLeafIndex(unusedLeaves[0].leafIndex);
          } else {
            setSelectedLeafIndex(null);
          }
        }
      }

      let feedbackMsg = `چک شماره ${checkNumber} ثبت شد. فرم برای ثبت چک بعدی با شماره سریال ${nextCheckNumber} آماده شد.`;
      if (!isNaN(totalToEnterNum) && totalToEnterNum > 0) {
        feedbackMsg = `چک ${currentEntered} از ${totalToEnterNum} ثبت شد. فیلدها برای ثبت چک بعدی تغییر یافت.`;
      }
      setSuccessFeedback(feedbackMsg);
      setTimeout(() => setSuccessFeedback(null), 5000);

      // Continuous prefill updates
      setCheckNumber(nextCheckNumber);
      setDueDate(nextDueDate);
      setSayadiNumber(nextSayadiNumber);
    }
  };

  const filteredChecks = useMemo(() => {
    const today = getCurrentJalaliDate();
    return checks.filter(c => {
      if (c.type !== activeTab) return false;

      // Quick filter (only affects received tab)
      if (activeTab === 'received' && quickFilter !== 'all' && c.currentState !== quickFilter) return false;

      // Status Filter
      if (statusFilter !== 'all' && c.currentState !== statusFilter) return false;

      // Bank Filter
      if (bankFilter !== 'all' && c.bankName !== bankFilter) return false;

      // Legal Only Filter
      if (legalOnlyFilter && !(c.currentState === 'bounced' || c.currentSubState === 'in_legal_process' || c.legalCaseNumber || (c.legalDocuments && c.legalDocuments.length > 0))) {
        return false;
      }

      // Missing Images Filter
      if (missingImagesFilter && (c.frontImage && c.backImage)) {
        return false;
      }

      // Overdue Filter
      if (overdueOnlyFilter && (c.dueDate >= today || c.currentState === 'cleared')) {
        return false;
      }

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const person = persons.find(p => p.id === c.personId);
      return (
        c.amount.toString().includes(q) ||
        c.bankName.toLowerCase().includes(q) ||
        c.checkNumber.includes(q) ||
        (c.sayadiNumber && c.sayadiNumber.includes(q)) ||
        (c.legalCaseNumber && c.legalCaseNumber.toLowerCase().includes(q)) ||
        (person && person.name.toLowerCase().includes(q))
      );
    });
  }, [checks, activeTab, searchQuery, persons, statusFilter, bankFilter, legalOnlyFilter, missingImagesFilter, overdueOnlyFilter, quickFilter]);

  const getStateLabel = (state: string, subState?: string) => {
    switch (state) {
      case 'present_in_cashbox': return 'موجود در صندوق';
      case 'deposited_to_bank': return 'واگذار به بانک (جریان وصول)';
      case 'cleared': return activeTab === 'received' ? 'وصول شده' : 'پاس شده';
      case 'passed_to_others': return 'خرج شده به غیر';
      case 'bounced':
        if (subState === 'returned_to_customer') return 'برگشتی - عودت به مشتری';
        if (subState === 'in_legal_process') return 'برگشتی - در جریان حقوقی';
        if (subState === 'cleared_after_bounce') return 'برگشتی - وصول شده';
        if (subState === 'un_bounced_solved') return 'برگشتی - رفع سوء اثر شده';
        if (subState === 'provisioned_funds') return 'برگشتی - تامین موجودی';
        return 'برگشت خورده';
      case 'issued': return 'صادر شده';
      default: return state;
    }
  };

  const getStateColor = (state: string) => {
    switch (state) {
      case 'present_in_cashbox': return 'bg-zinc-100 text-zinc-700 border-zinc-200';
      case 'deposited_to_bank': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'cleared': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'passed_to_others': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'bounced': return 'bg-red-50 text-red-700 border-red-200';
      case 'issued': return 'bg-amber-50 text-amber-700 border-amber-200';
      default: return 'bg-zinc-100 text-zinc-700 border-zinc-200';
    }
  };

  const handleStartEditCheck = (check: CheckTypeModel) => {
    setEditingCheckId(check.id);
    setCheckNumber(check.checkNumber);
    setSayadiNumber(check.sayadiNumber || '');
    setNationalId(check.nationalId || '');
    setBankName(check.bankName);
    const matchedSub = bankSubAccounts.find(b => check.bankName && (b.name.includes(check.bankName) || check.bankName.includes(b.name)));
    setIssuerBankAccountId(check.issuerBankAccountId || matchedSub?.id || bankSubAccounts[0]?.id || '');
    setDueDate(check.dueDate);
    setAmount(check.amount);
    setPersonId(check.personId);
    setIsAmani(!!check.isAmani);
    setShowAddForm(true);
  };

  const handleOpenDossier = (check: CheckTypeModel) => {
    setSelectedCheckForDossier(check);
    setDossierTab('archive');
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 pb-20">
      {/* Sub-Header Tabs */}
      <div className="bg-white border-b border-zinc-100 px-4 py-3 sticky top-0 z-30 space-y-3">
        <div className="grid grid-cols-2 gap-2 bg-zinc-100 p-1 rounded-xl">
          <button
            onClick={() => { setActiveTab('received'); setSelectedCheckForStateChange(null); setQuickFilter('all'); }}
            className={`py-2 rounded-lg font-sans text-xs font-semibold text-center transition-all ${
              activeTab === 'received' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
            }`}
          >
            <div className="flex items-center justify-center space-x-1.5 space-x-reverse">
              <ArrowDownLeft size={13} className="text-emerald-500" />
              <span>چک‌های دریافتی</span>
            </div>
          </button>
          <button
            onClick={() => { setActiveTab('paid'); setSelectedCheckForStateChange(null); setQuickFilter('all'); }}
            className={`py-2 rounded-lg font-sans text-xs font-semibold text-center transition-all ${
              activeTab === 'paid' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
            }`}
          >
            <div className="flex items-center justify-center space-x-1.5 space-x-reverse">
              <ArrowUpRight size={13} className="text-amber-500" />
              <span>چک‌های پرداختی</span>
            </div>
          </button>
        </div>

        {/* Nested Sub-tabs for Received Checks */}
        {activeTab === 'received' && (
          <div className="grid grid-cols-4 gap-1 bg-zinc-100 p-1 rounded-xl border border-zinc-200/50">
            <button
              onClick={() => setInnerTab('operations')}
              className={`py-1.5 rounded-lg font-sans text-[10px] sm:text-xs font-bold text-center transition-all ${
                innerTab === 'operations' ? 'bg-emerald-650 bg-emerald-600 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50'
              }`}
            >
              عملیات
            </button>
            <button
              onClick={() => setInnerTab('dashboard')}
              className={`py-1.5 rounded-lg font-sans text-[10px] sm:text-xs font-bold text-center transition-all ${
                innerTab === 'dashboard' ? 'bg-emerald-650 bg-emerald-600 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50'
              }`}
            >
              داشبورد
            </button>
            <button
              onClick={() => setInnerTab('analytics')}
              className={`py-1.5 rounded-lg font-sans text-[10px] sm:text-xs font-bold text-center transition-all ${
                innerTab === 'analytics' ? 'bg-emerald-650 bg-emerald-600 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50'
              }`}
            >
              تحلیل
            </button>
            <button
              onClick={() => setInnerTab('legal')}
              className={`py-1.5 rounded-lg font-sans text-[10px] sm:text-xs font-bold text-center transition-all ${
                innerTab === 'legal' ? 'bg-emerald-650 bg-emerald-600 text-white shadow-xs' : 'text-zinc-600 hover:bg-zinc-200/50'
              }`}
            >
              حقوقی
            </button>
          </div>
        )}

        {/* Search Bar */}
        {(activeTab === 'paid' || innerTab === 'operations') && (
          <div className="flex items-center space-x-2 space-x-reverse">
            <div className="flex-1 bg-zinc-100 p-2 rounded-xl flex items-center space-x-2 space-x-reverse">
              <Search size={16} className="text-zinc-400 shrink-0" />
              <input
                type="text"
                placeholder="جستجو (مبلغ، نام بانک، شماره چک، نام شخص، پرونده)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none text-right"
              />
            </div>
            {onOpenAdvancedSearch && (
              <button
                onClick={onOpenAdvancedSearch}
                className="p-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 transition shadow-sm border border-emerald-100"
                title="جستجوی پیشرفته و هوشمند"
              >
                <Search size={18} />
              </button>
            )}
          </div>
        )}

        {/* Supplementary Filter Toolbar */}
        {(activeTab === 'paid' || innerTab === 'operations') && (
          <div className="flex items-center space-x-2 space-x-reverse overflow-x-auto pb-1 text-xs font-sans">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setQuickFilter('all'); // Clear quick filter to prevent conflicting filters
              }}
              className="bg-zinc-100 text-zinc-700 px-2.5 py-1.5 rounded-xl border border-zinc-200 text-[11px] focus:outline-none"
            >
              <option value="all">همه وضعیت‌ها</option>
              {activeTab === 'received' ? (
              <>
                <option value="present_in_cashbox">موجود در صندوق</option>
                <option value="deposited_to_bank">واگذار به بانک</option>
                <option value="cleared">وصول شده</option>
                <option value="passed_to_others">خرج شده</option>
                <option value="bounced">برگشتی / حقوقی</option>
              </>
            ) : (
              <>
                <option value="issued">صادر شده</option>
                <option value="cleared">پاس شده</option>
                <option value="bounced">برگشتی</option>
              </>
            )}
          </select>

          <button
            onClick={() => setLegalOnlyFilter(prev => !prev)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center space-x-1 space-x-reverse transition ${
              legalOnlyFilter ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200'
            }`}
          >
            <Scale size={13} />
            <span>پرونده حقوقی</span>
          </button>

          <button
            onClick={() => setOverdueOnlyFilter(prev => !prev)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center space-x-1 space-x-reverse transition ${
              overdueOnlyFilter ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200'
            }`}
          >
            <Calendar size={13} />
            <span>سررسید شده</span>
          </button>

          <button
            onClick={() => setMissingImagesFilter(prev => !prev)}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center space-x-1 space-x-reverse transition ${
              missingImagesFilter ? 'bg-purple-100 text-purple-800 border-purple-300' : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200'
            }`}
          >
            <ImageIcon size={13} />
            <span>فاقد تصویر مدارک</span>
          </button>
        </div>
        )}
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        {successFeedback && (
          <div className="bg-emerald-500/15 border border-emerald-500/30 rounded-2xl p-3.5 text-right font-sans text-xs text-emerald-400 flex items-start space-x-2 space-x-reverse animate-fade-in shadow-sm">
            <CheckCircle size={16} className="text-emerald-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <strong className="block">عملیات با موفقیت انجام شد</strong>
              <p className="text-[10px] text-zinc-300 leading-relaxed">{successFeedback}</p>
            </div>
          </div>
        )}

        {activeTab === 'received' && innerTab !== 'operations' ? (
          <div className="space-y-4">
            {innerTab === 'analytics' && (
              <div className="bg-white p-3 rounded-2xl border border-zinc-200 shadow-xs flex justify-center items-center gap-2 text-xs">
                <button
                  onClick={() => setAnalyticsTab('liquidity_forecast')}
                  className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    analyticsTab === 'liquidity_forecast'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  <Calendar size={14} />
                  <span>پیش‌بینی نقدینگی و سررسیدها</span>
                </button>
                <button
                  onClick={() => setAnalyticsTab('entities_breakdown')}
                  className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    analyticsTab === 'entities_breakdown'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  <Users size={14} />
                  <span>گزارش تفکیکی (مشتریان، نمایندگان، بانک‌ها)</span>
                </button>
              </div>
            )}
            
            <ReceivedChecksCentralReport
              state={reportState}
              forcedActiveTab={
                innerTab === 'dashboard' 
                  ? 'kpis_dashboard' 
                  : innerTab === 'analytics' 
                  ? analyticsTab 
                  : 'bounced_legal'
              }
              hideHeaderAndTabs={true}
              onViewVoucher={onViewVoucher}
              onViewCheck={onViewCheck}
              onEditCheck={onEditCheck}
              onDeleteCheck={onDeleteCheck}
              onApproveCheck={onApproveCheck}
              onUpdateCheckState={onUpdateCheckState}
              onBulkUpdateCheckState={onBulkUpdateCheckState}
              currentUserRole={currentUserRole}
            />
          </div>
        ) : (
          <>
            {/* Toggle Adding New Check */}
            {!showAddForm && !selectedCheckForStateChange && (
          <div className="flex space-x-2 space-x-reverse">
            <button
              onClick={() => {
                setCheckNumber('');
                setSayadiNumber('');
                setNationalId('');
                const defaultSub = bankSubAccounts[0];
                if (activeTab === 'paid' && defaultSub) {
                  setIssuerBankAccountId(defaultSub.id);
                  setBankName(defaultSub.name);
                } else {
                  setIssuerBankAccountId('');
                  setBankName('');
                }
                setDueDate(getCurrentJalaliDate());
                setAmount(0);
                setPersonId('');
                setIsAmani(false);
                setTotalChecksToEnter('');
                setEnteredChecksCount(0);
                setSuccessFeedback(null);
                setSelectedCheckbookId('');
                setSelectedLeafIndex(null);
                setShowAddForm(true);
              }}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-sans text-xs font-bold py-3 rounded-xl shadow-md transition flex items-center justify-center space-x-1.5 space-x-reverse"
            >
              <Plus size={16} />
              <span>ثبت چک {activeTab === 'received' ? 'دریافتی' : 'پرداختی'}</span>
            </button>
            {activeTab === 'paid' && (
              <button
                onClick={() => setShowCheckbooksManagerModal(true)}
                className="bg-amber-600 hover:bg-amber-500 text-white font-sans text-xs font-bold py-3 px-3.5 rounded-xl shadow-md transition flex items-center justify-center space-x-1.5 space-x-reverse whitespace-nowrap"
              >
                <BookOpen size={16} />
                <span>مدیریت دسته‌چک‌ها ({checkbooksList.length})</span>
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-sans text-xs font-bold py-3 px-4 rounded-xl shadow-md transition flex items-center justify-center space-x-1.5 space-x-reverse whitespace-nowrap"
            >
              <Upload size={16} />
              <span>ورود اکسل</span>
            </button>
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              className="hidden"
              ref={fileInputRef}
              onChange={handleExcelUpload}
            />
          </div>
        )}

        {/* Add Form */}
        {showAddForm && (
          <form onSubmit={handleAddCheckSubmit} className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
              <button type="button" onClick={() => { setShowAddForm(false); setEditingCheckId(null); }} className="text-zinc-400 text-xs font-semibold">انصراف / بستن</button>
              <div className="text-right">
                <span className="font-sans text-xs font-bold text-zinc-800">
                  {editingCheckId ? 'ویرایش چک' : `ثبت چک ${activeTab === 'received' ? 'دریافتی جدید' : 'پرداختی جدید'}`}
                </span>
                {!editingCheckId && <span className="block text-[9px] text-zinc-400 font-sans mt-0.5">ثبت متوالی (بچ) فعال است</span>}
              </div>
            </div>

            {isEditingWithVoucher && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-right font-sans text-xs text-amber-900 flex items-start space-x-2 space-x-reverse animate-fade-in">
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <strong className="block font-bold">قفل مالی اطلاعات اصلی چک</strong>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    این چک دارای سابقه حسابداری است. برای اصلاح اطلاعات مالی، ابتدا باید از مسیر ابطال رسمی و ثبت مجدد اقدام شود.
                  </p>
                </div>
              </div>
            )}

            {successFeedback && (
              <div className="bg-emerald-50 border border-emerald-150 rounded-xl p-3 text-right font-sans text-xs text-emerald-800 flex items-start space-x-2 space-x-reverse animate-fade-in">
                <Sparkles size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                <span>{successFeedback}</span>
              </div>
            )}

            <PersonSelector
              disabled={isEditingWithVoucher}
              persons={persons}
              selectedPersonId={personId}
              onSelect={setPersonId}
              onCreatePerson={(name) => {
                const newId = `p_check_${Date.now()}`;
                const customEvent = new CustomEvent('create_person_inline', { detail: { id: newId, name } });
                window.dispatchEvent(customEvent);
                return newId;
              }}
              label={activeTab === 'received' ? "پرداخت‌کننده چک" : "دریافت‌کننده چک"}
            />

            {/* Checkbook Selector for Paid Checks */}
            {activeTab === 'paid' && !editingCheckId && (
              <div className="bg-amber-50/70 border border-amber-200 p-3 rounded-xl space-y-2 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 space-x-reverse">
                    <BookOpen size={15} className="text-amber-600" />
                    <label className="text-[11px] font-bold text-amber-900 font-sans">
                      دسته چک صادرکننده (هوشمند)
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCbBankAccountId(issuerBankAccountId || bankSubAccounts[0]?.id || '');
                      setShowCreateCheckbookModal(true);
                    }}
                    className="text-[10px] text-amber-700 hover:text-amber-900 font-bold bg-amber-100 hover:bg-amber-200 px-2 py-1 rounded-lg transition"
                  >
                    + تعریف دسته چک جدید
                  </button>
                </div>

                <select
                  disabled={isEditingWithVoucher}
                  value={selectedCheckbookId}
                  onChange={(e) => handleSelectCheckbook(e.target.value)}
                  className="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-amber-500 shadow-xs"
                >
                  <option value="">-- ثبت آزاد (بدون استفاده از دسته چک) --</option>
                  {checkbooksList
                    .filter(cb => cb.status !== 'archived')
                    .map((cb) => {
                      const unusedCount = cb.leaves.filter(l => l.status === 'unused').length;
                      return (
                        <option key={cb.id} value={cb.id}>
                          {cb.title || cb.bankName} (مانده: {unusedCount} از {cb.totalLeaves} برگه - سریال {cb.startSerial} تا {cb.endSerial})
                        </option>
                      );
                    })}
                </select>

                {selectedCheckbookId && (
                  <div className="flex items-center justify-between text-[10px] text-amber-800 bg-white/80 p-2 rounded-lg border border-amber-200/50">
                    <span>
                      {selectedLeafIndex !== null ? (
                        <span className="font-bold text-emerald-700">
                          ✓ برگه شماره {selectedLeafIndex} فراخوانی شد (بانک، کد ملی، سریال و صیادی فرآخوانی گردید).
                        </span>
                      ) : (
                        <span className="text-rose-600">
                          ⚠️ شماره سریال وارد شده در این دسته چک وجود ندارد یا قبلاً صادر شده است.
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSelectCheckbook('')}
                      className="text-rose-500 hover:text-rose-700 text-[9px] underline"
                    >
                      انصراف از دسته چک
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Batch Entry Field */}
            {!editingCheckId && (
              <div className="flex items-center justify-between bg-zinc-50 p-2.5 rounded-xl border border-zinc-150 animate-fade-in">
                <div className="text-right">
                  <span className="text-[10px] text-zinc-500 font-sans block font-bold">تعداد فقره چک برای ثبت متوالی</span>
                  <span className="text-[8px] text-zinc-400 font-sans">تعداد کل چک‌های این سری را در صورت تمایل مشخص کنید (اختیاری)</span>
                </div>
                <div className="w-24">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={totalChecksToEnter}
                    onChange={(e) => setTotalChecksToEnter(toEnglishDigits(e.target.value))}
                    placeholder="مثال: ۴"
                    className="w-full bg-white border border-zinc-200 rounded-lg px-2 py-1.5 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <label className="block text-[10px] text-zinc-500 text-right mb-0.5">
                  {activeTab === 'received' ? 'نام بانک صادرکننده' : 'حساب بانک صادرکننده شرکت'}
                </label>
                {activeTab === 'paid' ? (
                  <select
                    disabled={isEditingWithVoucher}
                    value={issuerBankAccountId || bankSubAccounts[0]?.id || ''}
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      setIssuerBankAccountId(selectedId);
                      const sub = bankSubAccounts.find(b => b.id === selectedId);
                      if (sub) {
                        setBankName(sub.name);
                      }
                    }}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                    required
                  >
                    <option value="" disabled>انتخاب حساب بانکی شرکت...</option>
                    {bankSubAccounts.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} (کد {b.code})
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      type="text"
                      disabled={isEditingWithVoucher}
                      value={bankName}
                      onChange={(e) => {
                        setBankName(e.target.value);
                        setIsBankListOpen(true);
                      }}
                      onFocus={() => !isEditingWithVoucher && setIsBankListOpen(true)}
                      onBlur={() => {
                        // Slight delay to allow clicking on dropdown options
                        setTimeout(() => setIsBankListOpen(false), 200);
                      }}
                      placeholder="مانند: ملی، ملت"
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                      required
                    />
                    
                    {isBankListOpen && !isEditingWithVoucher && (
                      <div className="absolute z-50 right-0 left-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-zinc-50 animate-fade-in">
                        {suggestedBanks
                          .filter(bank => !bankName || bank.includes(bankName))
                          .map((bank) => (
                            <button
                              key={bank}
                              type="button"
                              onMouseDown={() => {
                                setBankName(bank);
                                setIsBankListOpen(false);
                              }}
                              className="w-full text-right px-3 py-2 font-sans text-xs text-zinc-700 hover:bg-zinc-50 transition-colors flex items-center justify-between"
                            >
                              <span className="text-[9px] text-zinc-400">بانک</span>
                              <span className="font-semibold">{bank}</span>
                            </button>
                          ))}
                        {bankName && !suggestedBanks.includes(bankName.trim()) && (
                          <button
                            type="button"
                            onMouseDown={() => {
                              handleAddCustomBank(bankName);
                              setIsBankListOpen(false);
                            }}
                            className="w-full text-right px-3 py-2 font-sans text-[10px] text-emerald-600 hover:bg-emerald-50 font-bold flex items-center justify-between"
                          >
                            <span>ثبت میانبر جدید</span>
                            <span className="font-mono">{bankName} +</span>
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 text-right mb-0.5">مبلغ چک (ریال)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  disabled={isEditingWithVoucher}
                  value={amount > 0 ? amount.toLocaleString() : ''}
                  onChange={(e) => {
                    setAmount(parseNumericValue(e.target.value));
                  }}
                  onFocus={(e) => e.target.select()}
                  placeholder="مبلغ به ریال"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-zinc-500 text-right mb-0.5">شماره سریال چک (قابل ویرایش)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  disabled={isEditingWithVoucher}
                  value={checkNumber}
                  onChange={(e) => handleCheckNumberChangeWithCheckbook(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder="سریال چک"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 text-right mb-0.5">شماره صیادی ۱۶ رقمی (دستی)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  disabled={isEditingWithVoucher}
                  value={sayadiNumber}
                  onChange={(e) => setSayadiNumber(toEnglishDigits(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  placeholder="کد صیادی"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-zinc-500 text-right mb-0.5">کد ملی صاحب حساب {currentUserRole === 'agent' && <span className="text-red-500">*</span>}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={nationalId}
                  onChange={(e) => setNationalId(toEnglishDigits(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  placeholder="کد ملی 10 رقمی"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                  required={currentUserRole === 'agent'}
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 text-right mb-0.5">تاریخ سررسید چک</label>
                <input
                  type="text"
                  disabled={isEditingWithVoucher}
                  value={dueDate}
                  onChange={(e) => setDueDate(toEnglishDigits(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  dir="ltr"
                  required
                />
              </div>
              <div className="flex flex-col justify-end items-end text-right">
                <label className={`flex items-center space-x-2 space-x-reverse cursor-pointer bg-zinc-50 px-3 py-2 rounded-xl border border-zinc-200 hover:bg-zinc-100 transition w-full ${isEditingWithVoucher ? 'opacity-60 cursor-not-allowed' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={isEditingWithVoucher}
                    checked={isAmani}
                    onChange={(e) => setIsAmani(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-zinc-300 focus:ring-emerald-500 disabled:cursor-not-allowed"
                  />
                  <span className="text-[11px] font-bold text-zinc-700">چک امانی / ضمانتی</span>
                </label>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-sans text-xs font-semibold py-2.5 rounded-xl shadow-md transition flex items-center justify-center space-x-1.5 space-x-reverse"
            >
              {editingCheckId ? (
                <>
                  <Check size={14} />
                  <span>ذخیره تغییرات</span>
                </>
              ) : (
                <>
                  <Plus size={14} />
                  <span>ذخیره و آماده‌سازی چک بعدی</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* Change State Panel */}
        <CheckStatusChangeModal
          selectedCheckForStateChange={selectedCheckForStateChange}
          onClose={() => setSelectedCheckForStateChange(null)}
          onUpdateCheckState={onUpdateCheckState}
          banks={bankSubAccounts}
          selectedBankId={selectedBankId}
          setSelectedBankId={setSelectedBankId}
          stateNote={stateNote}
          setStateNote={setStateNote}
          resolvedSinglePaidBankId={resolvedSinglePaidBankId || undefined}
          isSinglePaidCheck={isSinglePaidCheck}
        />

        {/* Checks List */}
        {activeTab === 'received' ? (
          <ReceivedChecksTab
            checks={checks}
            filteredChecks={filteredChecks}
            persons={persons}
            quickFilter={quickFilter}
            handleQuickFilterClick={handleQuickFilterClick}
            selectedBulkChecks={selectedBulkChecks}
            setSelectedBulkChecks={setSelectedBulkChecks}
            selectedCheckForStateChange={selectedCheckForStateChange}
            setSelectedCheckForStateChange={setSelectedCheckForStateChange}
            onOpenDossier={handleOpenDossier}
            currentUserRole={currentUserRole}
            onApproveCheck={onApproveCheck}
            onEditCheck={onEditCheck}
            onDeleteCheck={onDeleteCheck}
            setConfirmationModal={setConfirmationModal}
            getStateLabel={getStateLabel}
            getStateColor={getStateColor}
            onStartEditCheck={handleStartEditCheck}
          />
        ) : (
          <IssuedChecksTab
            checks={checks}
            filteredChecks={filteredChecks}
            persons={persons}
            selectedBulkChecks={selectedBulkChecks}
            setSelectedBulkChecks={setSelectedBulkChecks}
            selectedCheckForStateChange={selectedCheckForStateChange}
            setSelectedCheckForStateChange={setSelectedCheckForStateChange}
            onOpenDossier={handleOpenDossier}
            currentUserRole={currentUserRole}
            onApproveCheck={onApproveCheck}
            onEditCheck={onEditCheck}
            onDeleteCheck={onDeleteCheck}
            setConfirmationModal={setConfirmationModal}
            getStateLabel={getStateLabel}
            getStateColor={getStateColor}
            onStartEditCheck={handleStartEditCheck}
          />
        )}
          </>
        )}
      </div>

      {/* Floating Action Bar for Bulk Checks */}
      {selectedBulkChecks.length > 0 && (() => {
        const sumAmount = selectedBulkChecks.reduce((acc, id) => {
          const c = checks.find(x => x.id === id);
          return acc + (c ? c.amount : 0);
        }, 0);

        let sumWeightedDays = 0;
        let sumAmt = 0;
        const itemsList: { id: string; bankName: string; checkNumber: string; amount: number; dueDate: string; weight: number; days: number; personName: string }[] = [];
        let minDueDate = '';
        let maxDueDate = '';

        selectedBulkChecks.forEach(id => {
          const c = checks.find(x => x.id === id);
          if (c && c.dueDate) {
            const diffDays = getDaysDiff(c.dueDate, rasBaseDate);
            sumWeightedDays += diffDays * c.amount;
            sumAmt += c.amount;
            
            if (!minDueDate || c.dueDate < minDueDate) minDueDate = c.dueDate;
            if (!maxDueDate || c.dueDate > maxDueDate) maxDueDate = c.dueDate;
            
            const personName = persons.find(px => px.id === c.personId)?.name || 'ناشناس';
            itemsList.push({
              id: c.id,
              bankName: c.bankName,
              checkNumber: c.checkNumber,
              amount: c.amount,
              dueDate: c.dueDate,
              weight: 0,
              days: diffDays,
              personName
            });
          }
        });

        let formattedAvgDate = 'نامشخص';
        let daysFromBaseDate = 0;
        if (sumAmt > 0) {
          const avgDays = sumWeightedDays / sumAmt;
          daysFromBaseDate = Math.round(avgDays);
          formattedAvgDate = addDaysToJalaliDate(rasBaseDate, daysFromBaseDate);
        }

        const itemsWithWeight = itemsList.map(it => ({
          ...it,
          weight: sumAmt > 0 ? (it.amount / sumAmt) * 100 : 0
        }));

        const handleBulkDeposit = () => {
          setBulkError(null);
          if (!bulkBankId) {
            setBulkError("لطفاً بانک مقصد را انتخاب کنید.");
            return;
          }
          const eligibleChecks = selectedBulkChecks.filter(id => {
            const c = checks.find(x => x.id === id);
            return c && c.currentState === 'present_in_cashbox';
          });

          if (eligibleChecks.length === 0) {
            const selectedStates = selectedBulkChecks.map(id => {
              const c = checks.find(x => x.id === id);
              const label = c ? (c.currentState === 'present_in_cashbox' ? 'صندوق' : c.currentState === 'deposited_to_bank' ? 'واگذارشده به بانک' : c.currentState === 'cleared' ? 'وصول‌شده' : 'خرج‌شده/سایر') : 'نامشخص';
              return c ? `${c.bankName} - سریال ${c.checkNumber} (وضعیت: ${label})` : 'یافت نشد';
            }).join('\n');
            setBulkError(`هیچ‌کدام از چک‌های دریافتی انتخاب شده در وضعیت «موجود در صندوق» نیستند و امکان واگذاری ندارند.\n\nوضعیت چک‌های انتخابی شما:\n${selectedStates}`);
            return;
          }

          setBulkConfirmType('deposit');
        };

        const executeBulkDeposit = () => {
          const eligibleChecks = selectedBulkChecks.filter(id => {
            const c = checks.find(x => x.id === id);
            return c && c.currentState === 'present_in_cashbox';
          });

          if (onBulkUpdateCheckState) {
            onBulkUpdateCheckState(eligibleChecks, 'deposited_to_bank', undefined, bulkNote || 'واگذاری گروهی چک‌ها به بانک جهت وصول', bulkBankId);
          } else {
            eligibleChecks.forEach(id => {
              onUpdateCheckState(id, 'deposited_to_bank', undefined, bulkNote || 'واگذاری گروهی چک‌ها به بانک جهت وصول', bulkBankId);
            });
          }
          setSuccessFeedback(`واگذاری گروهی ${eligibleChecks.length} چک با موفقیت به بانک انجام شد و اسناد حسابداری ثبت گردید.`);
          setTimeout(() => setSuccessFeedback(null), 7000);
          setSelectedBulkChecks([]);
          setIsBulkPanelExpanded(false);
          changeBulkAction('ras');
          setBulkNote('');
        };

        const handleBulkEndorse = () => {
          setBulkError(null);
          if (!bulkPersonId) {
            setBulkError("لطفاً شخص بستانکار/گیرنده را انتخاب کنید.");
            return;
          }
          const eligibleChecks = selectedBulkChecks.filter(id => {
            const c = checks.find(x => x.id === id);
            return c && c.currentState === 'present_in_cashbox';
          });

          if (eligibleChecks.length === 0) {
            const selectedStates = selectedBulkChecks.map(id => {
              const c = checks.find(x => x.id === id);
              const label = c ? (c.currentState === 'present_in_cashbox' ? 'صندوق' : c.currentState === 'deposited_to_bank' ? 'واگذارشده به بانک' : c.currentState === 'cleared' ? 'وصول‌شده' : 'خرج‌شده/سایر') : 'نامشخص';
              return c ? `${c.bankName} - سریال ${c.checkNumber} (وضعیت: ${label})` : 'یافت نشد';
            }).join('\n');
            setBulkError(`هیچ‌کدام از چک‌های دریافتی انتخاب شده در وضعیت «موجود در صندوق» نیستند و امکان خرج کردن ندارند.\n\nوضعیت چک‌های انتخابی شما:\n${selectedStates}`);
            return;
          }

          setBulkConfirmType('endorse');
        };

        const executeBulkEndorse = () => {
          const eligibleChecks = selectedBulkChecks.filter(id => {
            const c = checks.find(x => x.id === id);
            return c && c.currentState === 'present_in_cashbox';
          });

          const targetPerson = persons.find(p => p.id === bulkPersonId);
          const personName = targetPerson ? targetPerson.name : 'شخص ناشناس';
          const fullNote = bulkNote 
            ? `${bulkNote} (خرج شده به ${personName})` 
            : `بابت تسویه بدهی به ${personName}`;

          if (onBulkUpdateCheckState) {
            onBulkUpdateCheckState(eligibleChecks, 'passed_to_others', undefined, fullNote, undefined, undefined, bulkPersonId);
          } else {
            eligibleChecks.forEach(id => {
              onUpdateCheckState(id, 'passed_to_others', undefined, fullNote, undefined, undefined, bulkPersonId);
            });
          }
          setSuccessFeedback(`خرج کردن گروهی ${eligibleChecks.length} چک با موفقیت به شخص ${personName} ثبت شد.`);
          setTimeout(() => setSuccessFeedback(null), 7000);
          setSelectedBulkChecks([]);
          setIsBulkPanelExpanded(false);
          changeBulkAction('ras');
          setBulkNote('');
          setBulkPersonId('');
        };

        const handleBulkClearPaid = () => {
          setBulkError(null);
          const eligibleChecks = selectedBulkChecks.filter(id => {
            const c = checks.find(x => x.id === id);
            return c && c.currentState === 'issued';
          });

          if (eligibleChecks.length === 0) {
            const selectedStates = selectedBulkChecks.map(id => {
              const c = checks.find(x => x.id === id);
              const label = c ? (c.currentState === 'issued' ? 'صادرشده' : c.currentState === 'cleared' ? 'پاس‌شده' : 'برگشتی/سایر') : 'نامشخص';
              return c ? `${c.bankName} - سریال ${c.checkNumber} (وضعیت: ${label})` : 'یافت نشد';
            }).join('\n');
            setBulkError(`هیچ‌کدام از چک‌های پرداختی انتخاب شده در وضعیت «صادر شده» نیستند و امکان پاس شدن ندارند.\n\nوضعیت چک‌های انتخابی شما:\n${selectedStates}`);
            return;
          }

          if (!bulkPaidBankAnalysis.isMultiBank && !bulkPaidBankAnalysis.singleBankId && !bulkBankId) {
            setBulkError("لطفاً بانک صادرکننده را انتخاب کنید.");
            return;
          }

          setBulkConfirmType('clear_paid');
        };

        const executeBulkClearPaid = () => {
          const eligibleChecks = selectedBulkChecks
            .map(id => checks.find(x => x.id === id))
            .filter((c): c is CheckTypeModel => !!c && c.type === 'paid' && c.currentState === 'issued');

          eligibleChecks.forEach(c => {
            let cBankId = c.issuerBankAccountId;
            if (!cBankId && c.bankName) {
              const matched = bankSubAccounts.find(b => 
                b.name.trim().toLowerCase() === c.bankName.trim().toLowerCase() ||
                b.name.includes(c.bankName) ||
                c.bankName.includes(b.name)
              );
              if (matched) cBankId = matched.id;
            }
            const finalBankId = cBankId || bulkBankId || bankSubAccounts[0]?.id || 'SUB_BANK_MELI';

            onUpdateCheckState(
              c.id, 
              'cleared', 
              undefined, 
              bulkNote || 'وصول و پاس شدن گروهی چک صادر شده از بانک', 
              finalBankId
            );
          });

          setSuccessFeedback(`پاس شدن گروهی ${eligibleChecks.length} چک پرداختی با موفقیت ثبت شد.`);
          setTimeout(() => setSuccessFeedback(null), 7000);
          setSelectedBulkChecks([]);
          setIsBulkPanelExpanded(false);
          changeBulkAction('ras');
          setBulkNote('');
        };

        // Determine names of selected items for draft accounting voucher preview
        const selectedBankName = banks.find(b => b.id === bulkBankId)?.name || 'بانک انتخاب نشده';
        const selectedPersonName = persons.find(p => p.id === bulkPersonId)?.name || 'شخص انتخاب نشده';

        if (!isBulkPanelExpanded) {
          return (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-md bg-zinc-950/95 text-white rounded-full shadow-2xl px-5 py-3 flex items-center justify-between z-50 border border-zinc-800 animate-fade-in backdrop-blur-md">
              <div className="flex items-center space-x-3 space-x-reverse text-right">
                <span className="bg-emerald-500 text-zinc-950 font-mono font-bold w-6 h-6 rounded-full flex items-center justify-center text-xs">
                  {selectedBulkChecks.length}
                </span>
                <div>
                  <span className="text-[10px] text-zinc-400 block font-sans">چک انتخاب شده ({activeTab === 'received' ? 'دریافتی' : 'پرداختی'})</span>
                  <strong className="font-mono text-emerald-400 text-xs">{sumAmount.toLocaleString()} ریال</strong>
                </div>
              </div>

              <div className="flex items-center space-x-2 space-x-reverse">
                <button
                  type="button"
                  onClick={() => setIsBulkPanelExpanded(true)}
                  className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-3.5 py-1.5 rounded-full font-sans text-xs font-bold transition flex items-center space-x-1 space-x-reverse shadow-md"
                >
                  <Sparkles size={13} />
                  <span>ادامه و عملیات گروهی</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBulkChecks([]);
                    setIsBulkPanelExpanded(false);
                  }}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 p-2 rounded-full transition border border-zinc-700"
                  title="لغو انتخاب"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        }

        return (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-lg bg-zinc-950 text-white rounded-3xl shadow-2xl p-5 flex flex-col space-y-4.5 z-50 border border-zinc-800 animate-fade-in max-h-[85vh] overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div className="text-right flex-1">
                <span className="font-sans text-xs font-bold text-zinc-100 flex items-center space-x-2 space-x-reverse">
                  <span className="bg-emerald-500 text-zinc-950 font-mono font-bold px-2 py-0.5 rounded-full text-[10px]">
                    {selectedBulkChecks.length}
                  </span>
                  <span>عملیات گروهی و محاسباتی چک‌ها ({activeTab === 'received' ? 'دریافتی' : 'پرداختی'})</span>
                </span>
              </div>
              <div className="flex items-center space-x-1.5 space-x-reverse">
                <button 
                  type="button"
                  onClick={() => setIsBulkPanelExpanded(false)}
                  className="text-zinc-400 hover:text-emerald-400 text-[10px] font-sans font-bold transition flex items-center space-x-1 bg-zinc-900 px-2.5 py-1 rounded-lg border border-zinc-850"
                  title="کوچک‌سازی نوار و بستن جزئیات"
                >
                  <span>کوچک‌سازی</span>
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    setSelectedBulkChecks([]);
                    setIsBulkPanelExpanded(false);
                    changeBulkAction('ras');
                  }}
                  className="text-zinc-400 hover:text-rose-400 text-[10px] font-sans font-bold transition flex items-center space-x-1 space-x-reverse bg-zinc-900 px-2.5 py-1 rounded-lg border border-zinc-850"
                >
                  <X size={13} />
                  <span>لغو انتخاب</span>
                </button>
              </div>
            </div>

            {/* Segmented Controller (Purposes/Actions) */}
            <div className="grid grid-cols-3 gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800/80">
              <button
                type="button"
                onClick={() => changeBulkAction('ras')}
                className={`py-1.5 rounded-lg font-sans text-[10px] font-bold text-center transition-all ${
                  activeBulkAction === 'ras' ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/10' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                تحلیل و راس‌گیری
              </button>
              
              {activeTab === 'received' ? (
                <>
                  <button
                    type="button"
                    onClick={() => changeBulkAction('deposit')}
                    className={`py-1.5 rounded-lg font-sans text-[10px] font-bold text-center transition-all ${
                      activeBulkAction === 'deposit' ? 'bg-zinc-800 text-blue-400 border border-blue-500/10' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    خواباندن به حساب
                  </button>
                  <button
                    type="button"
                    onClick={() => changeBulkAction('endorse')}
                    className={`py-1.5 rounded-lg font-sans text-[10px] font-bold text-center transition-all ${
                      activeBulkAction === 'endorse' ? 'bg-zinc-800 text-purple-400 border border-purple-500/10' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    خرج کردن چک
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => changeBulkAction('deposit')}
                    className={`py-1.5 rounded-lg font-sans text-[10px] font-bold text-center transition-all ${
                      activeBulkAction === 'deposit' ? 'bg-zinc-800 text-amber-400 border border-amber-500/10' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    ثبت وصول نقدی
                  </button>
                  <button
                    type="button"
                    onClick={() => changeBulkAction('list')}
                    className={`py-1.5 rounded-lg font-sans text-[10px] font-bold text-center transition-all ${
                      activeBulkAction === 'list' ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    لیست انتخابی
                  </button>
                </>
              )}
            </div>

            {bulkError && (
              <div className="bg-rose-500/15 border border-rose-500/30 rounded-2xl p-3 text-right font-sans text-xs text-rose-400 flex items-start space-x-2 space-x-reverse animate-fade-in">
                <AlertTriangle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <strong className="block">خطای اعتبارسنجی عملیات گروهی</strong>
                  <p className="text-[10px] text-zinc-300 leading-relaxed whitespace-pre-line">{bulkError}</p>
                </div>
              </div>
            )}

            {/* TAB CONTENT: 1. RAS / ANALYSIS */}
            {activeBulkAction === 'ras' && (
              <div className="space-y-3.5 animate-fade-in text-right">
                {/* Brand-new Intelligent Interactive Diagnostic Card */}
                <div className="bg-gradient-to-br from-emerald-950/40 to-zinc-900 border border-emerald-500/20 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between text-[11px] text-emerald-400 border-b border-emerald-500/10 pb-2">
                    <div className="flex items-center space-x-1.5 space-x-reverse">
                      <Sparkles size={14} className="text-emerald-400 animate-pulse" />
                      <strong>گزارش تحلیل راس زمانی چک‌ها (برخط)</strong>
                    </div>
                    <span className="font-mono bg-emerald-500/10 px-2 py-0.5 rounded text-[9px]">امروز: {getCurrentJalaliDate()}</span>
                  </div>
                  
                  {/* Base Date Selector for Ras Calculation */}
                  <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-850 flex flex-col gap-2 text-right">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-right">
                        <span className="text-[10px] text-zinc-400 block font-sans">تاریخ مبدأ راس‌گیری</span>
                        <span className="text-[8px] text-zinc-500 block font-sans mt-0.5">فاصله روزها نسبت به این مبدأ سنجیده می‌شود</span>
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          value={rasBaseDate}
                          onChange={(e) => setRasBaseDate(toEnglishDigits(e.target.value))}
                          placeholder="YYYY/MM/DD"
                          className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 font-mono text-xs text-center text-emerald-400 w-28 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                    
                    {/* Presets */}
                    <div className="flex flex-wrap gap-1.5 justify-end pt-1.5 border-t border-zinc-900">
                      <span className="text-[8px] text-zinc-500 self-center font-sans ml-1">تغییر سریع مبدأ:</span>
                      <button
                        type="button"
                        onClick={() => setRasBaseDate(getCurrentJalaliDate())}
                        className="bg-zinc-900 hover:bg-zinc-800 text-[9px] text-zinc-400 hover:text-emerald-400 px-2.5 py-0.5 rounded border border-zinc-800/80 transition"
                      >
                        امروز
                      </button>
                      {minDueDate && (
                        <button
                          type="button"
                          onClick={() => setRasBaseDate(minDueDate)}
                          className="bg-zinc-900 hover:bg-zinc-800 text-[9px] text-zinc-400 hover:text-emerald-400 px-2.5 py-0.5 rounded border border-zinc-800/80 transition"
                          title="اولین چک سررسید شده در لیست انتخابی"
                        >
                          اولین سررسید ({minDueDate})
                        </button>
                      )}
                      {maxDueDate && (
                        <button
                          type="button"
                          onClick={() => setRasBaseDate(maxDueDate)}
                          className="bg-zinc-900 hover:bg-zinc-800 text-[9px] text-zinc-400 hover:text-emerald-400 px-2.5 py-0.5 rounded border border-zinc-800/80 transition"
                          title="آخرین چک سررسید شده در لیست انتخابی"
                        >
                          آخرین سررسید ({maxDueDate})
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-zinc-200 leading-relaxed font-sans">
                    این <strong className="text-emerald-400 font-mono text-sm">{selectedBulkChecks.length}</strong> فقره چک انتخاب شده به ارزش مجموع <strong className="text-emerald-400 font-mono text-sm">{sumAmount.toLocaleString()}</strong> ریال، به طور میانگین دارای <strong className="text-amber-400 font-mono text-sm">{daysFromBaseDate}</strong> روز راس سررسید از تاریخ مبدأ راس‌گیری (معادل تاریخ راس <strong className="text-sky-400 font-sans text-xs underline decoration-dotted">{formattedAvgDate}</strong>) می‌باشند.
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-center text-[10px] bg-zinc-950/70 p-2.5 rounded-xl border border-zinc-850">
                    <div className="flex flex-col justify-center">
                      <span className="text-zinc-500 mb-0.5">فاصله تا مبدأ راس‌گیری</span>
                      <span className={`font-mono font-bold text-xs ${daysFromBaseDate >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                        {daysFromBaseDate >= 0 ? `${daysFromBaseDate} روز پس از مبدأ` : `${Math.abs(daysFromBaseDate)} روز پیش از مبدأ`}
                      </span>
                    </div>
                    <div className="flex flex-col justify-center border-r border-zinc-850">
                      <span className="text-zinc-500 mb-0.5">تاریخ راس زمانی (مطلق)</span>
                      <span className="font-sans font-bold text-xs text-sky-400">{formattedAvgDate}</span>
                    </div>
                  </div>
                </div>

                {/* List weights & day distances */}
                <div className="space-y-1.5">
                  <span className="text-zinc-500 text-[9px] font-sans block px-1">سهم وزنی و جزئیات روزشمار هر برگ چک:</span>
                  <div className="max-h-24 overflow-y-auto space-y-1.5 pr-1 text-right scrollbar-thin scrollbar-thumb-zinc-800">
                    {itemsWithWeight.map(it => (
                      <div key={it.id} className="bg-zinc-900 p-2.5 rounded-xl text-[10px] flex items-center justify-between border border-zinc-850">
                        <div className="text-left">
                          <div className="font-mono text-emerald-400 font-bold">{it.amount.toLocaleString()} ریال</div>
                          <div className="text-[8px] text-zinc-500 font-sans mt-0.5">وزن چک در راس: {it.weight.toFixed(1)}%</div>
                        </div>
                        <div className="font-sans text-zinc-300 flex items-center space-x-2 space-x-reverse">
                          <div className="text-right">
                            <span className="font-bold text-zinc-100 block">بانک {it.bankName} ({it.checkNumber})</span>
                            <span className="text-zinc-500 text-[8px]">واگذارکننده: {it.personName}</span>
                          </div>
                          <span className="text-zinc-600">•</span>
                          <div className="text-left">
                            <span className="text-zinc-400 font-mono block">{it.dueDate}</span>
                            <span className={`text-[8px] font-mono px-1 py-0.2 rounded block text-center ${it.days >= 0 ? 'bg-blue-500/10 text-blue-400' : 'bg-rose-500/10 text-rose-400'}`}>
                              {it.days >= 0 ? `${it.days} روز` : `${Math.abs(it.days)} روز قبل`}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: 2. DEPOSIT TO BANK (Or CLEAR PAID if activeTab === 'paid') */}
            {activeBulkAction === 'deposit' && (
              <div className="space-y-3.5 animate-fade-in text-right">
                <div className="bg-zinc-900/60 p-3 rounded-2xl border border-zinc-800 space-y-2">
                  <div className="flex items-center space-x-2 space-x-reverse text-blue-400">
                    <Landmark size={15} />
                    <strong className="text-xs font-sans">
                      {activeTab === 'received' ? 'خواباندن دسته جمعی چک‌ها به حساب بانک' : 'پاس کردن گروهی چک‌ها'}
                    </strong>
                  </div>
                  <p className="text-[10px] text-zinc-400 font-sans leading-relaxed">
                    {activeTab === 'received' 
                      ? 'تمامی چک‌های انتخابی که در وضعیت «موجود در صندوق» هستند به حساب بانکی منتخب واگذار (خوابانده) شده و سند حسابداری آن صادر می‌گردد.'
                      : 'تمامی چک‌های انتخابی که در وضعیت «صادر شده» هستند به «پاس شده» تغییر یافته و حساب بانکی منتخب بدهکار می‌گردد.'}
                  </p>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[9px] text-zinc-400 mb-1">
                      {activeTab === 'paid' ? (
                        bulkPaidBankAnalysis.isMultiBank ? (
                          <span className="text-amber-400 font-bold inline-flex items-center gap-1">
                            🔒 بانک صادرکننده چک‌ها (چند بانک مختلف - ثبت خودکار تفکیکی)
                          </span>
                        ) : bulkPaidBankAnalysis.singleBankId ? (
                          <span className="text-amber-400 font-bold inline-flex items-center gap-1">
                            🔒 بانک صادرکننده چک‌ها (تأییدشده و قفل)
                          </span>
                        ) : (
                          'حساب بانکی مبدا چک‌های قدیمی را انتخاب کنید'
                        )
                      ) : (
                        'حساب بانکی مقصد/مبدا را انتخاب کنید'
                      )}
                    </label>
                    {activeTab === 'paid' && bulkPaidBankAnalysis.isMultiBank ? (
                      <div className="w-full bg-zinc-950 border border-amber-500/40 rounded-xl px-3 py-2 font-sans text-xs text-amber-300 text-right flex items-center justify-between">
                        <span className="font-semibold text-[11px]">✨ اتصال هوشمند خودکار: سند هر چک به بانک صادرکننده خودش متصل می‌شود</span>
                        <span className="text-[9px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded border border-amber-500/30 font-bold shrink-0 mr-2">
                          چند بانکی
                        </span>
                      </div>
                    ) : (
                      <select
                        value={bulkBankId}
                        disabled={activeTab === 'paid' && !!bulkPaidBankAnalysis.singleBankId}
                        onChange={(e) => setBulkBankId(e.target.value)}
                        className={`w-full bg-zinc-900 border rounded-xl px-3 py-2 font-sans text-xs text-right focus:outline-none ${
                          activeTab === 'paid' && !!bulkPaidBankAnalysis.singleBankId
                            ? 'border-amber-500/40 text-amber-300 bg-amber-950/20 cursor-not-allowed font-semibold'
                            : 'border-zinc-800 text-zinc-200 focus:border-blue-500'
                        }`}
                      >
                        {banks.map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <label className="block text-[9px] text-zinc-400 mb-1">توضیحات کلی سند حسابداری</label>
                    <input
                      type="text"
                      value={bulkNote}
                      onChange={(e) => setBulkNote(e.target.value)}
                      placeholder="توضیحات بابت خواباندن گروهی چک‌ها"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 font-sans text-xs text-zinc-200 text-right focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Interactive Dynamic Accounting Voucher Draft Preview */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 space-y-2.5 font-sans">
                  <div className="text-[9px] font-bold text-zinc-400 flex items-center justify-between border-b border-zinc-850 pb-1.5">
                    <span>سند حسابداری خودکار پس از تایید</span>
                    <span className="text-blue-400">وضعیت: موقت و آماده ثبت</span>
                  </div>
                  
                  <div className="space-y-2 text-[10px]">
                    <div className="flex justify-between items-center bg-zinc-950/50 p-2 rounded-lg">
                      <div className="text-right">
                        <span className="text-emerald-400 font-bold">بدهکار (بد):</span>
                        <span className="text-zinc-300 mr-1.5">
                          {activeTab === 'received' ? `معین بانک‌ها (${selectedBankName})` : 'معین اسناد پرداختنی'}
                        </span>
                      </div>
                      <span className="font-mono text-emerald-400 font-semibold">{sumAmount.toLocaleString()} ریال</span>
                    </div>

                    <div className="flex justify-between items-center bg-zinc-950/50 p-2 rounded-lg">
                      <div className="text-right">
                        <span className="text-amber-500 font-bold">بستانکار (بس):</span>
                        <span className="text-zinc-300 mr-1.5">
                          {activeTab === 'received' 
                            ? 'معین اسناد در جریان وصول' 
                            : activeTab === 'paid' && bulkPaidBankAnalysis.isMultiBank
                              ? 'معین بانک‌ها (تفکیک خودکار به بانک صادرکننده هر چک)'
                              : `معین بانک‌ها (${selectedBankName})`}
                        </span>
                      </div>
                      <span className="font-mono text-amber-500 font-semibold">{sumAmount.toLocaleString()} ریال</span>
                    </div>
                  </div>

                  <p className="text-[8px] text-zinc-500 text-center leading-relaxed">
                    * سند فوق بلافاصله پس از کلیک به طور واقعی در ترازنامه و معین‌های حسابداری اثرگذاری مالی خواهد داشت.
                  </p>
                </div>

                {bulkConfirmType === (activeTab === 'received' ? 'deposit' : 'clear_paid') ? (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 space-y-3 text-right animate-fade-in">
                    <div className="flex items-start space-x-2 space-x-reverse text-amber-400 text-xs">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <strong className="block font-sans">تایید نهایی و ثبت سند مالی</strong>
                        <p className="text-[10px] text-zinc-300 leading-relaxed font-sans">
                          {activeTab === 'received'
                            ? `آیا از ثبت واگذاری گروهی و تولید اسناد دوبل متناظر برای تعداد ${selectedBulkChecks.filter(id => checks.find(x => x.id === id)?.currentState === 'present_in_cashbox').length} فقره چک به بانک «${selectedBankName}» اطمینان دارید؟`
                            : bulkPaidBankAnalysis.isMultiBank
                              ? `آیا از ثبت پاس شدن گروهی تعداد ${selectedBulkChecks.filter(id => checks.find(x => x.id === id)?.currentState === 'issued').length} فقره چک پرداختی و اتصال هوشمند سند هر چک به بانک صادرکننده خودش اطمینان دارید؟`
                              : `آیا از ثبت پاس شدن گروهی و بستانکار کردن حساب بانک برای ${selectedBulkChecks.filter(id => checks.find(x => x.id === id)?.currentState === 'issued').length} فقره چک پرداختی از «${selectedBankName}» اطمینان دارید؟`}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setBulkConfirmType(null)}
                        className="flex-1 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 py-2 rounded-xl text-xs font-sans font-medium transition"
                      >
                        انصراف
                      </button>
                      <button
                        type="button"
                        onClick={activeTab === 'received' ? executeBulkDeposit : executeBulkClearPaid}
                        className={`flex-1 text-white py-2 rounded-xl text-xs font-sans font-bold transition flex items-center justify-center gap-1.5 ${
                          activeTab === 'received' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-amber-600 hover:bg-amber-500'
                        }`}
                      >
                        <Check size={14} />
                        <span>بله، ثبت قطعی</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={activeTab === 'received' ? handleBulkDeposit : handleBulkClearPaid}
                    className={`w-full font-sans text-xs font-bold py-2.5 rounded-xl shadow-lg transition flex items-center justify-center space-x-1.5 space-x-reverse ${
                      activeTab === 'received' 
                        ? 'bg-blue-600 hover:bg-blue-500 text-white' 
                        : 'bg-amber-600 hover:bg-amber-500 text-white'
                    }`}
                  >
                    <CheckCircle size={15} />
                    <span>
                      {activeTab === 'received' 
                        ? `تایید و خواباندن گروهی ${selectedBulkChecks.filter(id => checks.find(x => x.id === id)?.currentState === 'present_in_cashbox').length} چک به حساب`
                        : `تایید پاس شدن گروهی ${selectedBulkChecks.filter(id => checks.find(x => x.id === id)?.currentState === 'issued').length} چک پرداختی`}
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* TAB CONTENT: 3. ENDORSE / TRANSFER TO PERSON */}
            {activeBulkAction === 'endorse' && activeTab === 'received' && (
              <div className="space-y-3.5 animate-fade-in text-right">
                <div className="bg-zinc-900/60 p-3 rounded-2xl border border-zinc-800 space-y-2">
                  <div className="flex items-center space-x-2 space-x-reverse text-purple-400">
                    <RefreshCw size={15} />
                    <strong className="text-xs font-sans">خرج کردن / واگذاری چک‌ها به همکار یا بستانکار (شخص ثالث)</strong>
                  </div>
                  <p className="text-[10px] text-zinc-400 font-sans leading-relaxed">
                    با خرج کردن گروهی چک‌ها، تمامی چک‌های انتخابی که وضعیت «موجود در صندوق» دارند، به شخص بستانکار منتقل شده و بدهی ما به او تسویه می‌گردد.
                  </p>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[9px] text-zinc-400 mb-1">شخص دریافت‌کننده چک (طلبکار/بستانکار)</label>
                    <select
                      value={bulkPersonId}
                      onChange={(e) => setBulkPersonId(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 font-sans text-xs text-zinc-200 text-right focus:outline-none focus:border-purple-500"
                    >
                      <option value="">-- انتخاب شخص گیرنده --</option>
                      {persons.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[9px] text-zinc-400 mb-1">توضیحات سند واگذاری</label>
                    <input
                      type="text"
                      value={bulkNote}
                      onChange={(e) => setBulkNote(e.target.value)}
                      placeholder="توضیحات بابت خرج کردن چک‌ها"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 font-sans text-xs text-zinc-200 text-right focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                {/* Interactive Dynamic Accounting Voucher Draft Preview for Endorsement */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 space-y-2.5 font-sans">
                  <div className="text-[9px] font-bold text-zinc-400 flex items-center justify-between border-b border-zinc-850 pb-1.5">
                    <span>سند حسابداری تسویه بدهی پس از واگذاری</span>
                    <span className="text-purple-400">وضعیت: موقت و آماده ثبت</span>
                  </div>
                  
                  <div className="space-y-2 text-[10px]">
                    <div className="flex justify-between items-center bg-zinc-950/50 p-2 rounded-lg">
                      <div className="text-right">
                        <span className="text-emerald-400 font-bold">بدهکار (بد):</span>
                        <span className="text-zinc-300 mr-1.5">
                          معین بستانکاران تجاری ({selectedPersonName})
                        </span>
                      </div>
                      <span className="font-mono text-emerald-400 font-semibold">{sumAmount.toLocaleString()} ریال</span>
                    </div>

                    <div className="flex justify-between items-center bg-zinc-950/50 p-2 rounded-lg">
                      <div className="text-right">
                        <span className="text-amber-500 font-bold">بستانکار (بس):</span>
                        <span className="text-zinc-300 mr-1.5">
                          معین اسناد دریافتنی (موجودی صندوق)
                        </span>
                      </div>
                      <span className="font-mono text-amber-500 font-semibold">{sumAmount.toLocaleString()} ریال</span>
                    </div>
                  </div>

                  <p className="text-[8px] text-zinc-500 text-center leading-relaxed">
                    * با تایید نهایی، بدهی ما به همکار «{selectedPersonName}» به اندازه مبلغ چک‌ها کسر گردیده و اسناد دریافتنی نیز کسر می‌گردد.
                  </p>
                </div>

                {bulkConfirmType === 'endorse' ? (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 space-y-3 text-right animate-fade-in font-sans">
                    <div className="flex items-start space-x-2 space-x-reverse text-amber-400 text-xs">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <strong className="block font-sans">تایید نهایی و خرج چک</strong>
                        <p className="text-[10px] text-zinc-300 leading-relaxed">
                          آیا از خرج کردن گروهی و صدور اسناد بدهکاری همکار «{selectedPersonName}» بابت {selectedBulkChecks.filter(id => checks.find(x => x.id === id)?.currentState === 'present_in_cashbox').length} فقره چک اطمینان دارید؟
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setBulkConfirmType(null)}
                        className="flex-1 bg-zinc-850 hover:bg-zinc-805 text-zinc-300 py-2 rounded-xl text-xs font-sans font-medium transition"
                      >
                        انصراف
                      </button>
                      <button
                        type="button"
                        onClick={executeBulkEndorse}
                        className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-xl text-xs font-sans font-bold transition flex items-center justify-center gap-1.5"
                      >
                        <Check size={14} />
                        <span>بله، ثبت قطعی خرج</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleBulkEndorse}
                    className="w-full bg-purple-600 hover:bg-purple-500 text-white font-sans text-xs font-bold py-2.5 rounded-xl shadow-lg transition flex items-center justify-center space-x-1.5 space-x-reverse"
                  >
                    <CheckCircle size={15} />
                    <span>
                      تایید و خرج گروهی {selectedBulkChecks.filter(id => checks.find(x => x.id === id)?.currentState === 'present_in_cashbox').length} چک به شخص منتخب
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* TAB CONTENT: 4. DETAILED LIST (Mainly for paid checks but general) */}
            {activeBulkAction === 'list' && (
              <div className="space-y-2 animate-fade-in text-right max-h-48 overflow-y-auto">
                <span className="text-zinc-500 text-[9px] font-sans block">لیست چک‌های انتخاب شده جهت اقدام:</span>
                <div className="space-y-1.5">
                  {itemsList.map(it => (
                    <div key={it.id} className="bg-zinc-900 p-2.5 rounded-xl text-[10px] flex items-center justify-between border border-zinc-800">
                      <div className="font-mono text-zinc-300">
                        {it.amount.toLocaleString()} ریال
                      </div>
                      <div className="font-sans text-zinc-300 flex items-center space-x-2 space-x-reverse">
                        <span className="font-bold text-zinc-100">بانک {it.bankName} ({it.checkNumber})</span>
                        <span className="text-zinc-500">•</span>
                        <span className="text-zinc-400 font-sans">{it.personName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        );
      })()}

    {/* Custom Confirmation Modal */}
    {confirmationModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" style={{ direction: 'rtl' }}>
        <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-zinc-150 text-right">
          <div className="flex items-center gap-3 text-amber-500 mb-4 justify-start">
            <AlertTriangle size={24} />
            <h3 className="font-sans font-bold text-lg text-zinc-900">{confirmationModal.title}</h3>
          </div>
          
          <p className="font-sans text-sm text-zinc-600 leading-relaxed mb-6 whitespace-pre-line">
            {confirmationModal.message}
          </p>
          
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setConfirmationModal(null)}
              className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-sans text-xs font-bold rounded-xl transition"
            >
              انصراف
            </button>
            <button
              onClick={() => {
                confirmationModal.onConfirm();
                setConfirmationModal(null);
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-sans text-xs font-bold rounded-xl transition shadow-lg shadow-red-500/20"
            >
              بله، تایید می‌شود
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Dedicated Check Dossier & Audit Trail Modal */}
    {selectedCheckForDossier && (() => {
      const isVouchered = !!selectedCheckForDossier.voucherId || (selectedCheckForDossier.history && selectedCheckForDossier.history.some(h => !!h.voucherId));
      const personObj = persons.find(p => p.id === selectedCheckForDossier.personId);

      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm overflow-y-auto" style={{ direction: 'rtl' }}>
          <div className="bg-white rounded-3xl p-5 sm:p-6 max-w-3xl w-full shadow-2xl border border-zinc-200 text-right space-y-4 max-h-[90vh] flex flex-col">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-zinc-100 pb-3 shrink-0">
              <button
                onClick={() => setSelectedCheckForDossier(null)}
                className="p-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-500 rounded-xl transition"
              >
                <X size={18} />
              </button>
              <div className="text-right">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <FileText className="text-indigo-600 shrink-0" size={20} />
                  <h3 className="font-sans font-bold text-base text-zinc-900">
                    بایگانی و پرونده حقوقی چک شماره {selectedCheckForDossier.checkNumber}
                  </h3>
                </div>
                <div className="text-[11px] text-zinc-500 font-sans mt-0.5 flex items-center space-x-2 space-x-reverse flex-wrap">
                  <span>بانک {selectedCheckForDossier.bankName}</span>
                  <span>•</span>
                  <span>مبلغ: <strong className="font-mono text-indigo-700">{selectedCheckForDossier.amount.toLocaleString()} ریال</strong></span>
                  <span>•</span>
                  <span>طرف حساب: <strong>{personObj?.name || 'ناشناس'}</strong></span>
                </div>
              </div>
            </div>

            {dossierMsg && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-800 font-sans flex items-center space-x-2 space-x-reverse">
                <CheckCircle size={16} className="text-emerald-600 shrink-0" />
                <span>{dossierMsg}</span>
              </div>
            )}

            {/* Modal Tabs */}
            <div className="grid grid-cols-3 gap-2 bg-zinc-100 p-1 rounded-2xl shrink-0 text-xs font-sans font-bold">
              <button
                onClick={() => setDossierTab('archive')}
                className={`py-2 rounded-xl transition flex items-center justify-center space-x-1.5 space-x-reverse ${
                  dossierTab === 'archive' ? 'bg-white text-indigo-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <ImageIcon size={15} />
                <span>تصاویر و بایگانی مدارک</span>
              </button>

              <button
                onClick={() => setDossierTab('legal')}
                className={`py-2 rounded-xl transition flex items-center justify-center space-x-1.5 space-x-reverse ${
                  dossierTab === 'legal' ? 'bg-white text-rose-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <Scale size={15} />
                <span>پرونده حقوقی</span>
              </button>

              <button
                onClick={() => setDossierTab('audit')}
                className={`py-2 rounded-xl transition flex items-center justify-center space-x-1.5 space-x-reverse ${
                  dossierTab === 'audit' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <History size={15} />
                <span>ردپای ممیزی (Audit Trail)</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">

              {/* TAB 1: ARCHIVE & IMAGES */}
              {dossierTab === 'archive' && (
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-900 flex items-start space-x-2 space-x-reverse">
                    <ShieldCheck size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      مدارک و تصاویر متصل به شناسه یکتای این چک طبق مقررات غیرقابل حذف فیزیکی بوده و پس از صدور سند حسابداری قفل امنیت اطلاعات مالی روی آنها اعمال می‌گردد.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* Front Image Slot */}
                    <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-3 flex flex-col items-center justify-between text-center space-y-2">
                      <span className="text-[11px] font-bold text-zinc-700">تصویر روی چک</span>
                      {selectedCheckForDossier.frontImage ? (
                        <div className="relative w-full h-24 rounded-xl overflow-hidden group border border-zinc-200">
                          <img src={selectedCheckForDossier.frontImage} alt="رو چک" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setPreviewImage({ title: 'تصویر روی چک', url: selectedCheckForDossier.frontImage! })}
                            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition"
                          >
                            <Eye size={18} />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-24 rounded-xl border-2 border-dashed border-zinc-300 flex flex-col items-center justify-center text-zinc-400 bg-white">
                          <ImageIcon size={24} />
                          <span className="text-[10px] mt-1">فاقد تصویر</span>
                        </div>
                      )}
                      <label className={`cursor-pointer w-full py-1.5 px-2 rounded-xl text-[10px] font-bold border transition text-center ${
                        isVouchered ? 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed' : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                      }`}>
                        <input
                          type="file"
                          accept="image/*"
                          disabled={isVouchered}
                          className="hidden"
                          onChange={(e) => handleUploadImageSlot('frontImage', e)}
                        />
                        <span>{selectedCheckForDossier.frontImage ? 'تغییر تصویر' : 'بارگذاری'}</span>
                      </label>
                    </div>

                    {/* Back Image Slot */}
                    <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-3 flex flex-col items-center justify-between text-center space-y-2">
                      <span className="text-[11px] font-bold text-zinc-700">تصویر پشت چک</span>
                      {selectedCheckForDossier.backImage ? (
                        <div className="relative w-full h-24 rounded-xl overflow-hidden group border border-zinc-200">
                          <img src={selectedCheckForDossier.backImage} alt="پشت چک" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setPreviewImage({ title: 'تصویر پشت چک', url: selectedCheckForDossier.backImage! })}
                            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition"
                          >
                            <Eye size={18} />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-24 rounded-xl border-2 border-dashed border-zinc-300 flex flex-col items-center justify-center text-zinc-400 bg-white">
                          <ImageIcon size={24} />
                          <span className="text-[10px] mt-1">فاقد تصویر</span>
                        </div>
                      )}
                      <label className={`cursor-pointer w-full py-1.5 px-2 rounded-xl text-[10px] font-bold border transition text-center ${
                        isVouchered ? 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed' : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                      }`}>
                        <input
                          type="file"
                          accept="image/*"
                          disabled={isVouchered}
                          className="hidden"
                          onChange={(e) => handleUploadImageSlot('backImage', e)}
                        />
                        <span>{selectedCheckForDossier.backImage ? 'تغییر تصویر' : 'بارگذاری'}</span>
                      </label>
                    </div>

                    {/* Endorsement Image Slot */}
                    <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-3 flex flex-col items-center justify-between text-center space-y-2">
                      <span className="text-[11px] font-bold text-zinc-700">تصویر ظهرنویسی</span>
                      {selectedCheckForDossier.endorsementImage ? (
                        <div className="relative w-full h-24 rounded-xl overflow-hidden group border border-zinc-200">
                          <img src={selectedCheckForDossier.endorsementImage} alt="ظهرنویسی" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setPreviewImage({ title: 'تصویر ظهرنویسی', url: selectedCheckForDossier.endorsementImage! })}
                            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition"
                          >
                            <Eye size={18} />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-24 rounded-xl border-2 border-dashed border-zinc-300 flex flex-col items-center justify-center text-zinc-400 bg-white">
                          <ImageIcon size={24} />
                          <span className="text-[10px] mt-1">فاقد تصویر</span>
                        </div>
                      )}
                      <label className="cursor-pointer w-full py-1.5 px-2 rounded-xl text-[10px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition text-center">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleUploadImageSlot('endorsementImage', e)}
                        />
                        <span>{selectedCheckForDossier.endorsementImage ? 'تغییر تصویر' : 'بارگذاری'}</span>
                      </label>
                    </div>

                    {/* Non-payment Cert Image Slot */}
                    <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-3 flex flex-col items-center justify-between text-center space-y-2">
                      <span className="text-[11px] font-bold text-zinc-700">گواهی عدم پرداخت</span>
                      {selectedCheckForDossier.nonPaymentCertificateImage ? (
                        <div className="relative w-full h-24 rounded-xl overflow-hidden group border border-zinc-200">
                          <img src={selectedCheckForDossier.nonPaymentCertificateImage} alt="گواهی عدم پرداخت" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setPreviewImage({ title: 'تصویر گواهی عدم پرداخت', url: selectedCheckForDossier.nonPaymentCertificateImage! })}
                            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition"
                          >
                            <Eye size={18} />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-24 rounded-xl border-2 border-dashed border-zinc-300 flex flex-col items-center justify-center text-zinc-400 bg-white">
                          <ImageIcon size={24} />
                          <span className="text-[10px] mt-1">فاقد تصویر</span>
                        </div>
                      )}
                      <label className="cursor-pointer w-full py-1.5 px-2 rounded-xl text-[10px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition text-center">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleUploadImageSlot('nonPaymentCertificateImage', e)}
                        />
                        <span>{selectedCheckForDossier.nonPaymentCertificateImage ? 'تغییر تصویر' : 'بارگذاری'}</span>
                      </label>
                    </div>
                  </div>

                  {/* Supplementary Legal Documents List */}
                  <div className="bg-white border border-zinc-200 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white font-sans text-xs font-bold py-1.5 px-3 rounded-xl shadow transition flex items-center space-x-1 space-x-reverse">
                        <Paperclip size={14} />
                        <span>پیوست سند حقوقی جدید</span>
                        <input type="file" className="hidden" onChange={handleUploadLegalDoc} />
                      </label>
                      <span className="font-bold text-xs text-zinc-800">سایر مدارک و پیوست‌های پرونده حقوقی</span>
                    </div>

                    {selectedCheckForDossier.legalDocuments && selectedCheckForDossier.legalDocuments.length > 0 ? (
                      <div className="space-y-2">
                        {selectedCheckForDossier.legalDocuments.map(doc => (
                          <div key={doc.id} className="flex items-center justify-between bg-zinc-50 p-2.5 rounded-xl border border-zinc-200 text-xs">
                            <div className="flex items-center space-x-2 space-x-reverse">
                              <a
                                href={doc.url}
                                download={doc.name}
                                className="p-1 bg-white border border-zinc-200 rounded-lg text-zinc-600 hover:text-indigo-600 transition"
                                title="دانلود مدرک"
                              >
                                <Download size={14} />
                              </a>
                              <span className="text-[10px] text-zinc-400 font-mono">{doc.uploadDate}</span>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-zinc-800 block text-[11px]">{doc.name}</span>
                              <span className="text-[9px] text-zinc-400">شناسه اتصال: {selectedCheckForDossier.id}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center text-zinc-400 text-xs py-3 font-sans">هیچ مدرک حقوقی جانبی هنوز پیوست نشده است.</p>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: LEGAL DOSSIER */}
              {dossierTab === 'legal' && (
                <div className="space-y-4">
                  <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-900 flex items-start space-x-2 space-x-reverse">
                    <Scale size={18} className="text-rose-600 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      ثبت و پیگیری کامل پرونده حقوقی چک‌های برگشتی، شماره گواهی عدم پرداخت، وکیل پیگیری‌کننده و آخرین اقدام قانونی.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-right">
                    <div>
                      <label className="block text-[11px] text-zinc-600 font-bold mb-1">شماره گواهی عدم پرداخت بانک</label>
                      <input
                        type="text"
                        value={dossierNonPayCertNo}
                        onChange={(e) => setDossierNonPayCertNo(e.target.value)}
                        placeholder="مثال: NOC-1402-987"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-right focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-zinc-600 font-bold mb-1">تاریخ دریافت گواهی عدم پرداخت</label>
                      <input
                        type="text"
                        value={dossierNonPayCertDate}
                        onChange={(e) => setDossierNonPayCertDate(e.target.value)}
                        placeholder="1402/11/05"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-right focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-zinc-600 font-bold mb-1">شماره پرونده حقوقی / اجراییه</label>
                      <input
                        type="text"
                        value={dossierLegalCaseNo}
                        onChange={(e) => setDossierLegalCaseNo(e.target.value)}
                        placeholder="مثال: 140291000123"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-right focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-zinc-600 font-bold mb-1">مرجع رسیدگی حقوقی</label>
                      <input
                        type="text"
                        value={dossierLegalAuthRef}
                        onChange={(e) => setDossierLegalAuthRef(e.target.value)}
                        placeholder="مثال: شعبه ۵ دادگاه عمومی حقوقی تهران / شورای حل اختلاف"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-zinc-600 font-bold mb-1">نام مسئول پیگیری / وکیل</label>
                      <input
                        type="text"
                        value={dossierAssignedLawyer}
                        onChange={(e) => setDossierAssignedLawyer(e.target.value)}
                        placeholder="مثال: وکیل صابری / واحد حقوقی"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] text-zinc-600 font-bold mb-1">تاریخ آخرین اقدام حقوقی</label>
                      <input
                        type="text"
                        value={dossierLastActionDate}
                        onChange={(e) => setDossierLastActionDate(e.target.value)}
                        placeholder="1402/11/10"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-right focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="col-span-1 sm:col-span-2">
                      <label className="block text-[11px] text-zinc-600 font-bold mb-1">آخرین وضعیت پرونده حقوقی</label>
                      <textarea
                        value={dossierLastStatus}
                        onChange={(e) => setDossierLastStatus(e.target.value)}
                        placeholder="توضیحات آخرین وضعیت ابلاغیه، صدور اجراییه یا جلب..."
                        rows={2}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-3 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-indigo-500 resize-none"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={handleSaveDossierFields}
                      className="bg-rose-600 hover:bg-rose-500 text-white font-sans text-xs font-bold py-2.5 px-6 rounded-xl shadow-md transition flex items-center space-x-1.5 space-x-reverse"
                    >
                      <Check size={16} />
                      <span>ذخیره مشخصات پرونده حقوقی</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: AUDIT TRAIL */}
              {dossierTab === 'audit' && (
                <div className="space-y-4">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-xs text-emerald-900 flex items-start space-x-2 space-x-reverse">
                    <ShieldCheck size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      ردپای ممیزی (Audit Trail) کامل و زنجیره‌ای. کلیه تغییرات وضعیت، سندهای صادرشده، کاربران ثبت‌کننده و زمانبندی بدون قابلیت ویرایش یا پاک‌سازی نگهداری می‌شوند.
                    </p>
                  </div>

                  <div className="relative border-r-2 border-indigo-200 mr-3 pr-4 space-y-4">
                    {selectedCheckForDossier.history && selectedCheckForDossier.history.length > 0 ? (
                      selectedCheckForDossier.history.map((h, idx) => (
                        <div key={idx} className="relative bg-zinc-50 p-3.5 rounded-2xl border border-zinc-200 space-y-2 text-right">
                          <div className="absolute -right-6 top-4 w-3.5 h-3.5 bg-indigo-600 rounded-full border-2 border-white" />
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-mono text-zinc-400">{h.timestamp || h.date}</span>
                            <span className="font-bold text-indigo-800">مرحله #{idx + 1}: {getStateLabel(h.state, h.subState)}</span>
                          </div>

                          <div className="text-xs text-zinc-700 font-sans space-y-1">
                            {h.note && <p><strong className="text-zinc-500 text-[10px]">توضیحات:</strong> {h.note}</p>}
                            {h.actorName && <p className="text-[10px] text-zinc-500">انجام توسط: <strong className="text-zinc-700">{h.actorName}</strong> ({h.userId || 'سیستم'})</p>}
                            {h.voucherId && (
                              <div className="bg-indigo-50 border border-indigo-150 rounded-lg p-2 text-[10px] text-indigo-900 font-mono flex items-center justify-between mt-1">
                                <span>کد سند حسابداری: {h.voucherId}</span>
                                <span className="font-sans font-bold text-indigo-600">سند صادرشده</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-zinc-400 text-xs text-center py-4">هیچ سابقه قبلی ثبت نشده است.</p>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      );
    })()}

    {/* Preview Image Modal */}
    {previewImage && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" style={{ direction: 'rtl' }}>
        <div className="bg-white rounded-3xl p-4 max-w-2xl w-full shadow-2xl space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <span className="font-bold text-xs text-zinc-800">{previewImage.title}</span>
            <button onClick={() => setPreviewImage(null)} className="p-1 bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-600">
              <X size={16} />
            </button>
          </div>
          <div className="max-h-[75vh] overflow-auto flex items-center justify-center">
            <img src={previewImage.url} alt={previewImage.title} className="max-w-full h-auto rounded-xl shadow" />
          </div>
        </div>
      </div>
    )}

    {/* Define New Checkbook Modal */}
    {showCreateCheckbookModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" style={{ direction: 'rtl' }}>
        <div className="bg-white rounded-3xl p-5 max-w-2xl w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-zinc-150 pb-3">
            <div className="flex items-center space-x-2 space-x-reverse">
              <BookOpen size={20} className="text-amber-600" />
              <h3 className="font-bold text-sm text-zinc-900 font-sans">تعریف دسته‌چک جدید صادرکننده</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateCheckbookModal(false)}
              className="p-1.5 bg-zinc-100 hover:bg-zinc-200 rounded-xl text-zinc-500 transition"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleCreateCheckbookSubmit} className="space-y-4">
            {cbError && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-800 flex items-center space-x-2 space-x-reverse">
                <AlertTriangle size={16} className="text-rose-600 shrink-0" />
                <span>{cbError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-zinc-600 mb-1">حساب بانکی صادرکننده (متصل به دسته‌چک) *</label>
                <select
                  value={cbBankAccountId}
                  onChange={(e) => setCbBankAccountId(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-sans text-zinc-800 text-right focus:outline-none focus:border-amber-500"
                  required
                >
                  <option value="" disabled>انتخاب حساب بانکی...</option>
                  {bankSubAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} (کد {b.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-600 mb-1">عنوان / توضیحات دسته‌چک (اختیاری)</label>
                <input
                  type="text"
                  value={cbTitle}
                  onChange={(e) => setCbTitle(e.target.value)}
                  placeholder="مثال: دسته‌چک ۲۵ برگی بانک ملی - جاری اصلی"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-sans text-zinc-800 text-right focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-600 mb-1">کد ملی صادرکننده (جهت درج خودکار)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={cbIssuerNationalId}
                  onChange={(e) => setCbIssuerNationalId(toEnglishDigits(e.target.value))}
                  placeholder="کد ملی ۱۰ رقمی"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono text-center text-zinc-800 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-600 mb-1">تعداد برگه‌ها *</label>
                <div className="flex gap-2">
                  {[10, 25, 50].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setCbTotalLeaves(num)}
                      className={`flex-1 py-2 rounded-xl font-bold text-xs border transition ${
                        cbTotalLeaves === num
                          ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                          : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                      }`}
                    >
                      {num} برگی
                    </button>
                  ))}
                  <input
                    type="number"
                    value={cbTotalLeaves}
                    onChange={(e) => setCbTotalLeaves(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 bg-zinc-50 border border-zinc-200 rounded-xl px-2 py-2 font-mono text-xs text-center text-zinc-800 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-600 mb-1">شماره سریال شروع *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={cbStartSerial}
                  onChange={(e) => setCbStartSerial(toEnglishDigits(e.target.value))}
                  placeholder="مثال: 10001"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono text-center text-zinc-800 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-600 mb-1">شماره سریال پایان (محاسبه خودکار)</label>
                <input
                  type="text"
                  disabled
                  value={String((parseInt(toEnglishDigits(cbStartSerial)) || 10001) + cbTotalLeaves - 1)}
                  className="w-full bg-zinc-100 border border-zinc-200 rounded-xl px-3 py-2 text-xs font-mono text-center text-zinc-600 opacity-80"
                />
              </div>
            </div>

            {/* Sayadi 16-Digit Pattern Builder */}
            <div className="bg-amber-50/80 border border-amber-200 p-3.5 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-amber-900">الگوی ساخت کد صیادی ۱۶ رقمی (از چپ به راست)</span>
                <span className="text-[10px] text-amber-700">۴ رقم مسلسل + ۸ رقم ثابت + ۴ رقم دلخواه/پیش‌فرض</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[9px] font-bold text-amber-900 mb-1">۴ رقم اول (شروع مسلسل - سمت چپ)</label>
                  <input
                    type="text"
                    maxLength={4}
                    inputMode="numeric"
                    value={cbPrefix4Digits}
                    onChange={(e) => setCbPrefix4Digits(toEnglishDigits(e.target.value))}
                    placeholder="مثال: 1001"
                    className="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 font-mono text-xs text-center text-zinc-800 focus:outline-none focus:border-amber-500"
                    required
                  />
                  <span className="text-[8px] text-amber-700 block mt-0.5">برای هر برگه ۱ واحد افزایش می‌یابد</span>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-amber-900 mb-1">۸ رقم وسط (ثابت تمام برگه‌ها)</label>
                  <input
                    type="text"
                    maxLength={8}
                    inputMode="numeric"
                    value={cbMiddle8Digits}
                    onChange={(e) => setCbMiddle8Digits(toEnglishDigits(e.target.value))}
                    placeholder="مثال: 12345678"
                    className="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 font-mono text-xs text-center text-zinc-800 focus:outline-none focus:border-amber-500"
                    required
                  />
                  <span className="text-[8px] text-amber-700 block mt-0.5">در تمامی ۲۵ برگه یکسان است</span>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-amber-900 mb-1">۴ رقم دلخواه (پیش‌فرض برگه ۱)</label>
                  <input
                    type="text"
                    maxLength={4}
                    inputMode="numeric"
                    value={cbLast4DigitsDefault}
                    onChange={(e) => setCbLast4DigitsDefault(toEnglishDigits(e.target.value))}
                    placeholder="مثال: 0001"
                    className="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 font-mono text-xs text-center text-zinc-800 focus:outline-none focus:border-amber-500"
                  />
                  <span className="text-[8px] text-amber-700 block mt-0.5">فقط برگه اول را پر می‌کند؛ برگه‌های بعدی خالی می‌مانند</span>
                </div>
              </div>
            </div>

            {/* Leaves Preview Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-zinc-800">
                <span>پیش‌نمایش و تنظیم برگه‌های دسته‌چک ({generatedLeavesPreview.length} برگه)</span>
                <span className="text-[10px] text-amber-800 font-medium">
                  ⚡ با تایپ ۴ رقم هر برگه، مکان‌نما خودکار به برگه بعدی منتقل می‌شود.
                </span>
              </div>

              <div className="max-h-56 overflow-y-auto border border-zinc-200 rounded-2xl divide-y divide-zinc-100 bg-zinc-50">
                {generatedLeavesPreview.map((leaf) => {
                  const prefix4 = leaf.sayadiNumber.slice(0, 4);
                  const middle8 = leaf.sayadiNumber.slice(4, 12);
                  const currentLast4 = cbCustomLeavesLast4[leaf.leafIndex] !== undefined 
                    ? cbCustomLeavesLast4[leaf.leafIndex] 
                    : (leaf.leafIndex === 1 ? (cbLast4DigitsDefault || '') : '');

                  return (
                    <div key={leaf.leafIndex} className="p-2.5 flex items-center justify-between text-xs hover:bg-white transition">
                      <div className="flex items-center space-x-2 space-x-reverse">
                        <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px] flex items-center justify-center font-mono">
                          {leaf.leafIndex}
                        </span>
                        <span className="font-mono text-zinc-700 font-bold text-[11px]">
                          برگه {leaf.leafIndex} (سریال {leaf.checkNumber}):
                        </span>
                      </div>

                      <div className="flex items-center space-x-1.5 font-mono text-xs" dir="ltr">
                        {/* Box 1 (Leftmost): 4 Digits Custom Editable Input */}
                        <input
                          ref={(el) => { leafInputRefs.current[leaf.leafIndex] = el; }}
                          type="text"
                          maxLength={4}
                          inputMode="numeric"
                          placeholder="خالی"
                          value={currentLast4}
                          onChange={(e) => {
                            const val = toEnglishDigits(e.target.value);
                            setCbCustomLeavesLast4(prev => ({
                              ...prev,
                              [leaf.leafIndex]: val
                            }));
                            if (val.length === 4 && leaf.leafIndex < generatedLeavesPreview.length) {
                              setTimeout(() => {
                                const nextInput = leafInputRefs.current[leaf.leafIndex + 1];
                                if (nextInput) {
                                  nextInput.focus();
                                  nextInput.select();
                                }
                              }, 20);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (leaf.leafIndex < generatedLeavesPreview.length) {
                                const nextInput = leafInputRefs.current[leaf.leafIndex + 1];
                                if (nextInput) {
                                  nextInput.focus();
                                  nextInput.select();
                                }
                              }
                            }
                          }}
                          className="w-16 bg-white border-2 border-amber-400 focus:border-amber-600 focus:bg-amber-100 rounded-lg px-1.5 py-1 text-center font-mono font-bold text-xs text-amber-950 focus:outline-none shadow-2xs transition placeholder:text-zinc-400"
                          title="۴ رقم سمت چپ (دلخواه و غیرمتعارف)"
                        />

                        <span className="text-zinc-300 font-bold text-xs">-</span>

                        {/* Box 2 (Middle): 8 Digits Fixed */}
                        <span className="bg-zinc-100 text-zinc-800 px-2.5 py-1 rounded-lg border border-zinc-200 font-bold text-[11px] shrink-0" title="۸ رقم وسط (ثابت)">
                          {middle8}
                        </span>

                        <span className="text-zinc-300 font-bold text-xs">-</span>

                        {/* Box 3 (Rightmost): 4 Digits Sequential */}
                        <span className="bg-amber-100 text-amber-900 px-2.5 py-1 rounded-lg border border-amber-300 font-bold text-[11px] shrink-0" title="۴ رقم سمت راست (مسلسل رو به افزایش)">
                          {prefix4}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex space-x-2 space-x-reverse pt-2">
              <button
                type="submit"
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2.5 rounded-xl shadow-sm text-xs transition"
              >
                ذخیره و ایجاد دسته‌چک
              </button>
              <button
                type="button"
                onClick={() => setShowCreateCheckbookModal(false)}
                className="px-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 font-bold py-2.5 rounded-xl text-xs transition"
              >
                انصراف
              </button>
            </div>
          </form>
        </div>
      </div>
    )}

    {/* Manage Checkbooks List & Leaves Panel Modal */}
    {showCheckbooksManagerModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" style={{ direction: 'rtl' }}>
        <div className="bg-white rounded-3xl p-5 max-w-4xl w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-zinc-150 pb-3">
            <div className="flex items-center space-x-2 space-x-reverse">
              <BookOpen size={22} className="text-amber-600" />
              <div>
                <h3 className="font-bold text-sm text-zinc-900 font-sans">مدیریت دسته‌چک‌های پرداختی شرکت</h3>
                <span className="text-[10px] text-zinc-400 font-sans">لیست دسته‌چک‌های فعال، وضعیت برگه‌ها و کنترل صیادی</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 space-x-reverse">
              <button
                type="button"
                onClick={() => {
                  setCbBankAccountId(bankSubAccounts[0]?.id || '');
                  setShowCreateCheckbookModal(true);
                }}
                className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow-xs transition flex items-center space-x-1 space-x-reverse"
              >
                <Plus size={14} />
                <span>تعریف دسته‌چک جدید</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCheckbooksManagerModal(false);
                  setViewingCheckbookId(null);
                }}
                className="p-1.5 bg-zinc-100 hover:bg-zinc-200 rounded-xl text-zinc-500 transition"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {viewingCheckbookId ? (
            /* Leaves Detailed Inspection View */
            (() => {
              const cb = checkbooksList.find(c => c.id === viewingCheckbookId);
              if (!cb) return null;

              const filteredLeaves = cb.leaves.filter(leaf => {
                if (!cbLeafSearchQuery) return true;
                const q = cbLeafSearchQuery.trim();
                return leaf.checkNumber.includes(q) || leaf.sayadiNumber.includes(q);
              });

              const unusedCount = cb.leaves.filter(l => l.status === 'unused').length;
              const issuedCount = cb.leaves.filter(l => l.status === 'issued').length;
              const cancelledCount = cb.leaves.filter(l => l.status === 'cancelled').length;

              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-amber-50/80 p-3 rounded-2xl border border-amber-200">
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <button
                        onClick={() => setViewingCheckbookId(null)}
                        className="p-1.5 bg-white hover:bg-amber-100 rounded-xl text-amber-800 transition"
                      >
                        <ArrowRight size={16} />
                      </button>
                      <div className="text-right">
                        <strong className="block text-xs text-amber-900 font-bold">{cb.title || cb.bankName}</strong>
                        <span className="text-[10px] text-amber-700">
                          سریال {cb.startSerial} تا {cb.endSerial} • بانک {cb.bankName} {cb.issuerNationalId ? `• کد ملی صادرکننده: ${cb.issuerNationalId}` : ''}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2 text-[10px] font-bold">
                      <span className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg">سفید (آماده): {unusedCount}</span>
                      <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded-lg">صادرشده: {issuedCount}</span>
                      <span className="bg-rose-100 text-rose-800 px-2 py-1 rounded-lg">باطل‌شده: {cancelledCount}</span>
                    </div>
                  </div>

                  {/* Search filter for leaves */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute right-3 top-2.5 text-zinc-400" />
                      <input
                        type="text"
                        value={cbLeafSearchQuery}
                        onChange={(e) => setCbLeafSearchQuery(toEnglishDigits(e.target.value))}
                        placeholder="جستجو در برگه‌ها با سریال یا کد صیادی..."
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pr-9 pl-3 py-1.5 text-xs text-zinc-800 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  {/* Leaves Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-96 overflow-y-auto p-1">
                    {filteredLeaves.map((leaf) => {
                      const connectedCheck = leaf.checkId ? checks.find(c => c.id === leaf.checkId) : undefined;
                      const recipientPerson = connectedCheck?.personId ? persons.find(p => p.id === connectedCheck.personId) : undefined;

                      const rawSayadi = leaf.sayadiNumber ? leaf.sayadiNumber.trim() : '';
                      const prefix4 = rawSayadi.length >= 4 ? rawSayadi.slice(0, 4) : '0000';
                      const middle8 = rawSayadi.length >= 12 ? rawSayadi.slice(4, 12) : '00000000';
                      const custom4 = rawSayadi.length >= 16 ? rawSayadi.slice(12, 16) : '0000';

                      return (
                        <div
                          key={leaf.leafIndex}
                          className={`p-3 rounded-2xl border text-right transition flex flex-col justify-between space-y-2 ${
                            leaf.status === 'unused'
                              ? 'bg-white border-zinc-200 hover:border-emerald-300 shadow-2xs'
                              : leaf.status === 'issued'
                              ? 'bg-amber-50/50 border-amber-200'
                              : 'bg-rose-50/40 border-rose-200 opacity-75'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1.5 space-x-reverse">
                              <span className="w-5 h-5 rounded-full bg-zinc-100 text-zinc-700 font-mono font-bold text-[10px] flex items-center justify-center">
                                {leaf.leafIndex}
                              </span>
                              <span className="font-mono font-bold text-xs text-zinc-900">
                                سریال: {leaf.checkNumber}
                              </span>
                            </div>

                            <span
                              className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                leaf.status === 'unused'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : leaf.status === 'issued'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {leaf.status === 'unused' ? 'سفید / آماده صدور' : leaf.status === 'issued' ? 'صادر شده' : 'باطل شده'}
                            </span>
                          </div>

                          <div className="bg-zinc-50 p-2 rounded-xl border border-zinc-150 flex items-center justify-between text-[11px]">
                            <span className="text-[9px] text-zinc-400 font-sans">کد صیادی ۱۶ رقمی:</span>
                            
                            <div className="flex items-center space-x-1.5 font-mono text-xs" dir="ltr">
                              {/* Box 1 (Leftmost): 4 Digits Custom / Non-standard */}
                              <span 
                                className="bg-amber-50 text-amber-950 px-2.5 py-1 rounded-lg border border-amber-300 font-bold text-[11px] shrink-0" 
                                title="۴ رقم سمت چپ (دلخواه و غیرمتعارف)"
                              >
                                {custom4}
                              </span>

                              <span className="text-zinc-300 font-bold text-xs">-</span>

                              {/* Box 2 (Middle): 8 Digits Fixed */}
                              <span 
                                className="bg-zinc-100 text-zinc-800 px-2.5 py-1 rounded-lg border border-zinc-200 font-bold text-[11px] shrink-0" 
                                title="۸ رقم وسط (ثابت)"
                              >
                                {middle8}
                              </span>

                              <span className="text-zinc-300 font-bold text-xs">-</span>

                              {/* Box 3 (Rightmost): 4 Digits Sequential */}
                              <span 
                                className="bg-amber-100 text-amber-900 px-2.5 py-1 rounded-lg border border-amber-300 font-bold text-[11px] shrink-0" 
                                title="۴ رقم سمت راست (مسلسل رو به افزایش)"
                              >
                                {prefix4}
                              </span>
                            </div>
                          </div>

                          {leaf.status === 'issued' && connectedCheck && (
                            <div className="bg-white p-2 rounded-xl border border-amber-200 text-[10px] space-y-1">
                              <div className="flex justify-between items-center">
                                <span className="text-zinc-500 font-sans">دریافت‌کننده: <strong className="text-zinc-800">{recipientPerson?.name || 'مشخص‌نشده'}</strong></span>
                                <span className="font-mono font-bold text-amber-900">{connectedCheck.amount.toLocaleString()} ریال</span>
                              </div>
                              <div className="flex justify-between items-center text-[9px] text-zinc-400">
                                <span>سررسید: {connectedCheck.dueDate}</span>
                                <button
                                  onClick={() => {
                                    setShowCheckbooksManagerModal(false);
                                    if (onViewCheck) onViewCheck(connectedCheck.id);
                                  }}
                                  className="text-indigo-600 hover:text-indigo-800 font-bold underline font-sans"
                                >
                                  مشاهده چک مربوطه
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="flex justify-end space-x-2 space-x-reverse pt-1 border-t border-zinc-100">
                            {leaf.status === 'unused' && (
                              <button
                                type="button"
                                onClick={() => handleToggleLeafStatus(cb.id, leaf.leafIndex, 'unused')}
                                className="text-[10px] font-bold text-rose-600 hover:text-rose-800 bg-rose-50 px-2 py-1 rounded-lg transition"
                              >
                                علامت‌گذاری به عنوان باطل‌شده
                              </button>
                            )}

                            {leaf.status === 'cancelled' && (
                              <button
                                type="button"
                                onClick={() => handleToggleLeafStatus(cb.id, leaf.leafIndex, 'cancelled')}
                                className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 bg-emerald-50 px-2 py-1 rounded-lg transition"
                              >
                                بازگردانی به سفید (آماده صدور)
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          ) : (
            /* Checkbooks List View */
            <div className="space-y-3">
              {checkbooksList.length === 0 ? (
                <div className="bg-zinc-50 p-8 rounded-3xl border border-dashed border-zinc-200 text-center space-y-3">
                  <BookOpen size={32} className="mx-auto text-zinc-400" />
                  <p className="text-xs text-zinc-500 font-sans">هنوز هیچ دسته‌چکی برای شرکت ثبت نشده است.</p>
                  <button
                    onClick={() => {
                      setCbBankAccountId(bankSubAccounts[0]?.id || '');
                      setShowCreateCheckbookModal(true);
                    }}
                    className="bg-amber-600 hover:bg-amber-500 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition inline-flex items-center space-x-1.5 space-x-reverse"
                  >
                    <Plus size={15} />
                    <span>تعریف اولین دسته‌چک</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {checkbooksList.map((cb) => {
                    const unusedCount = cb.leaves.filter(l => l.status === 'unused').length;
                    const issuedCount = cb.leaves.filter(l => l.status === 'issued').length;
                    const percentUsed = Math.round(((cb.totalLeaves - unusedCount) / cb.totalLeaves) * 100);

                    return (
                      <div
                        key={cb.id}
                        className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-2xs space-y-3 text-right hover:border-amber-300 transition"
                      >
                        <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                          <div className="flex items-center space-x-2 space-x-reverse">
                            <Landmark size={18} className="text-amber-600 shrink-0" />
                            <div>
                              <strong className="block text-xs text-zinc-900 font-bold">{cb.title || cb.bankName}</strong>
                              <span className="text-[10px] text-zinc-400">حساب متصل: {cb.bankName}</span>
                            </div>
                          </div>

                          <span
                            className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                              cb.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : cb.status === 'finished'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-zinc-100 text-zinc-600'
                            }`}
                          >
                            {cb.status === 'active' ? 'فعال' : cb.status === 'finished' ? 'تکمیل شده' : 'آرشیو'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px] font-sans text-zinc-700 bg-zinc-50 p-2.5 rounded-xl">
                          <div>
                            <span className="text-zinc-400 text-[9px] block">تعداد کل برگه‌ها:</span>
                            <span className="font-bold">{cb.totalLeaves} برگی</span>
                          </div>
                          <div>
                            <span className="text-zinc-400 text-[9px] block">بازه سریال:</span>
                            <span className="font-mono font-bold text-[10px]">{cb.startSerial} تا {cb.endSerial}</span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-zinc-500 font-sans">
                            <span>مصرف شده: {issuedCount} از {cb.totalLeaves} برگه ({percentUsed}٪)</span>
                            <span className="font-bold text-amber-700">مانده: {unusedCount} برگه</span>
                          </div>
                          <div className="w-full h-2 bg-zinc-100 rounded-full overflow-hidden flex">
                            <div
                              className="h-full bg-amber-500 transition-all duration-300"
                              style={{ width: `${percentUsed}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-zinc-100">
                          <button
                            onClick={() => setViewingCheckbookId(cb.id)}
                            className="bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs px-3 py-1.5 rounded-xl transition flex items-center space-x-1 space-x-reverse"
                          >
                            <Eye size={14} />
                            <span>مشاهده برگه‌ها ({cb.leaves.length})</span>
                          </button>

                          {onDeleteCheckbook && (
                            <button
                              onClick={() => {
                                if (window.confirm(`آیا از حذف دسته‌چک ${cb.title || cb.bankName} اطمینان دارید؟`)) {
                                  onDeleteCheckbook(cb.id);
                                }
                              }}
                              className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 transition"
                              title="حذف دسته‌چک"
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )}

  </div>
);
}
