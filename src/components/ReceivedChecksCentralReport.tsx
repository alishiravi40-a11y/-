/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  FileText, Users, CreditCard, Landmark, DollarSign, Calculator, 
  Search, Calendar, Filter, ArrowLeft, ArrowUpRight, ArrowDownLeft, TrendingUp, HelpCircle,
  Download, Printer, CheckCircle, FileSpreadsheet, Edit2, Trash2, X, Check as CheckIcon, Plus,
  Clock, PieChart, BarChart2, ShieldCheck, Sparkles, Layers, BookOpen, AlertTriangle, Hash, Eye, RotateCcw, User
} from 'lucide-react';
import Barcode from 'react-barcode';
import * as XLSX from 'xlsx';
import { DEFAULT_SUBSIDIARIES } from '../utils/accounting';
import { AppState, Check, Person, JournalVoucher, ReceivedCheckState, BouncedReceivedCheckSubState } from '../types';
import { getCurrentJalaliDate, getJalaliDiffDays, compareJalali } from '../utils/jalali';

interface ReceivedChecksCentralReportProps {
  state: AppState;
  onViewVoucher?: (voucherId: string) => void;
  onViewCheck?: (checkId: string) => void;
  onEditCheck?: (check: Check) => void;
  onDeleteCheck?: (checkId: string) => void;
  onApproveCheck?: (checkId: string) => void;
  currentUserRole?: 'admin' | 'agent';
  onUpdateCheckState?: (
    checkId: string, 
    newState: ReceivedCheckState, 
    newSubState?: BouncedReceivedCheckSubState,
    note?: string,
    bankId?: string,
    cashId?: string,
    endorsedPersonId?: string
  ) => void;
  onBulkUpdateCheckState?: (
    checkIds: string[], 
    newState: ReceivedCheckState, 
    newSubState?: BouncedReceivedCheckSubState,
    note?: string,
    bankId?: string,
    cashId?: string,
    endorsedPersonId?: string
  ) => void;
  forcedActiveTab?: SubReportTab;
  hideHeaderAndTabs?: boolean;
}

type SubReportTab = 'central_table' | 'kpis_dashboard' | 'liquidity_forecast' | 'entities_breakdown' | 'bounced_legal';

export default function ReceivedChecksCentralReport({
  state,
  onViewVoucher,
  onViewCheck,
  onEditCheck,
  onDeleteCheck,
  onApproveCheck,
  currentUserRole = 'admin',
  onUpdateCheckState,
  onBulkUpdateCheckState,
  forcedActiveTab,
  hideHeaderAndTabs = false
}: ReceivedChecksCentralReportProps) {
  const todayJalali = getCurrentJalaliDate();

  // Active Sub-Tab
  const [activeTab, setActiveTab] = useState<SubReportTab>(forcedActiveTab || 'central_table');

  React.useEffect(() => {
    if (forcedActiveTab) {
      setActiveTab(forcedActiveTab);
    }
  }, [forcedActiveTab]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [mainStatus, setMainStatus] = useState<string>('all');
  const [personId, setPersonId] = useState<string>('');
  const [agentId, setAgentId] = useState<string>('');
  const [issuingBank, setIssuingBank] = useState<string>('');
  const [destinationBankId, setDestinationBankId] = useState<string>('');
  
  // Amounts
  const [minAmount, setMinAmount] = useState<number | ''>('');
  const [maxAmount, setMaxAmount] = useState<number | ''>('');

  // Date Ranges
  const [dueDateFrom, setDueDateFrom] = useState<string>('');
  const [dueDateTo, setDueDateTo] = useState<string>('');
  const [receiptDateFrom, setReceiptDateFrom] = useState<string>('');
  const [receiptDateTo, setReceiptDateTo] = useState<string>('');
  const [actionDateFrom, setActionDateFrom] = useState<string>('');
  const [actionDateTo, setActionDateTo] = useState<string>('');

  // Category Toggles
  const [isAmaniOnly, setIsAmaniOnly] = useState<boolean>(false);
  const [isInstallmentOnly, setIsInstallmentOnly] = useState<boolean>(false);
  const [isAgentOnly, setIsAgentOnly] = useState<boolean>(false);
  const [isAdminOnly, setIsAdminOnly] = useState<boolean>(false);
  const [isMissingDocsOnly, setIsMissingDocsOnly] = useState<boolean>(false);
  const [isLegalOnly, setIsLegalOnly] = useState<boolean>(false);

  // Sorting
  const [sortColumn, setSortColumn] = useState<'dueDate' | 'receiptDate' | 'amount' | 'person' | 'status'>('dueDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Selection state for multi-select
  const [selectedCheckIds, setSelectedCheckIds] = useState<string[]>([]);

  // Modals & History Drawers
  const [historyModalCheck, setHistoryModalCheck] = useState<Check | null>(null);
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const [showSelectedAnalyticsModal, setShowSelectedAnalyticsModal] = useState<boolean>(false);

  // Bulk Action States & Handlers
  const [bulkModalType, setBulkModalType] = useState<'deposit' | 'endorse' | 'return' | null>(null);
  const [bulkTargetBankId, setBulkTargetBankId] = useState('SUB_BANK_MELI');
  const [bulkTargetPersonId, setBulkTargetPersonId] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);

  const banksList = useMemo(() => {
    return DEFAULT_SUBSIDIARIES.filter(s => s.generalType === 'بانک‌ها');
  }, []);

  const executeQuickBulkState = (newState: ReceivedCheckState, subState?: BouncedReceivedCheckSubState) => {
    if (!onBulkUpdateCheckState || selectedCheckIds.length === 0 || isProcessingBulk) return;
    setIsProcessingBulk(true);
    try {
      onBulkUpdateCheckState(
        selectedCheckIds,
        newState,
        subState,
        `تغییر وضعیت گروهی به ${newState}`,
        undefined,
        undefined,
        undefined
      );
      setSelectedCheckIds([]);
      alert('✅ عملیات گروهی با موفقیت انجام شد و اسناد حسابداری مربوطه ثبت گردید.');
    } catch (err: any) {
      alert(`❌ خطا در اجرای عملیات گروهی: ${err.message || err}`);
    } finally {
      setIsProcessingBulk(false);
    }
  };

  const handleExecuteBulkModalAction = () => {
    if (!onBulkUpdateCheckState || selectedCheckIds.length === 0 || isProcessingBulk) return;
    setIsProcessingBulk(true);
    try {
      let newState: ReceivedCheckState = 'present_in_cashbox';
      let subState: BouncedReceivedCheckSubState | undefined = undefined;
      let bankId = undefined;
      let endorsedPersonId = undefined;

      if (bulkModalType === 'deposit') {
        newState = 'deposited_to_bank';
        bankId = bulkTargetBankId;
      } else if (bulkModalType === 'endorse') {
        newState = 'passed_to_others';
        endorsedPersonId = bulkTargetPersonId;
        if (!endorsedPersonId) {
          alert('لطفاً شخص دریافت‌کننده (ثالث) را انتخاب کنید.');
          setIsProcessingBulk(false);
          return;
        }
      } else if (bulkModalType === 'return') {
        newState = 'bounced';
        subState = 'returned_to_customer';
      }

      onBulkUpdateCheckState(
        selectedCheckIds,
        newState,
        subState,
        bulkNote || 'عملیات گروهی چک‌ها',
        bankId,
        undefined,
        endorsedPersonId
      );

      setSelectedCheckIds([]);
      setBulkModalType(null);
      setBulkNote('');
      setBulkTargetPersonId('');
      alert('✅ عملیات گروهی با موفقیت انجام شد.');
    } catch (err: any) {
      alert(`❌ خطا در اجرای عملیات: ${err.message || err}`);
    } finally {
      setIsProcessingBulk(false);
    }
  };

  // 1. Master List of Received Checks
  const allReceivedChecks = useMemo(() => {
    return (state.checks || []).filter(c => c.type === 'received' || (!c.type && c.currentState));
  }, [state.checks]);

  // Unique Issuing Banks
  const issuingBanksList = useMemo(() => {
    const banks = new Set<string>();
    allReceivedChecks.forEach(c => {
      if (c.bankName?.trim()) banks.add(c.bankName.trim());
    });
    return Array.from(banks);
  }, [allReceivedChecks]);

  // Unique Agents
  const agentsList = useMemo(() => {
    const agentPersons = (state.persons || []).filter(p => 
      p.roles?.includes('sales_rep') || 
      p.roles?.includes('credit_rep') || 
      (p as any).role === 'agent' || 
      (p as any).role === 'representative'
    );
    return agentPersons.length > 0 ? agentPersons : (state.persons || []);
  }, [state.persons]);

  // Reset Filters
  const handleResetFilters = () => {
    setSearchQuery('');
    setMainStatus('all');
    setPersonId('');
    setAgentId('');
    setIssuingBank('');
    setDestinationBankId('');
    setMinAmount('');
    setMaxAmount('');
    setDueDateFrom('');
    setDueDateTo('');
    setReceiptDateFrom('');
    setReceiptDateTo('');
    setActionDateFrom('');
    setActionDateTo('');
    setIsAmaniOnly(false);
    setIsInstallmentOnly(false);
    setIsAgentOnly(false);
    setIsAdminOnly(false);
    setSelectedCheckIds([]);
  };

  // Pre-set Due Date Filters
  const applyDueDatePreset = (preset: 'today' | 'tomorrow' | 'this_week' | 'this_month' | 'overdue' | 'all') => {
    if (preset === 'all') {
      setDueDateFrom('');
      setDueDateTo('');
      return;
    }
    if (preset === 'today') {
      setDueDateFrom(todayJalali);
      setDueDateTo(todayJalali);
      return;
    }
    if (preset === 'overdue') {
      setDueDateFrom('1300/01/01');
      setDueDateTo(todayJalali);
      return;
    }
    if (preset === 'this_week' || preset === 'this_month') {
      const parts = todayJalali.split('/');
      if (parts.length === 3) {
        const y = parts[0];
        const m = parts[1];
        setDueDateFrom(`${y}/${m}/01`);
        setDueDateTo(`${y}/${m}/31`);
      }
    }
  };

  // 2. Filtered Dataset Compiler
  const filteredChecks = useMemo(() => {
    return allReceivedChecks.filter(c => {
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const personName = (state.persons || []).find(p => p.id === c.personId)?.name || '';
        const agentName = (state.persons || []).find(p => p.id === c.submittedByAgentId || p.id === c.representativeId)?.name || '';
        const matchesSayadi = c.sayadiNumber?.toLowerCase().includes(q);
        const matchesNumber = c.checkNumber?.toLowerCase().includes(q);
        const matchesPerson = personName.toLowerCase().includes(q);
        const matchesAgent = agentName.toLowerCase().includes(q);
        const matchesBank = c.bankName?.toLowerCase().includes(q);
        const matchesNational = c.nationalId?.includes(q);
        if (!matchesSayadi && !matchesNumber && !matchesPerson && !matchesAgent && !matchesBank && !matchesNational) {
          return false;
        }
      }

      // Status Filter
      if (mainStatus !== 'all') {
        if (mainStatus === 'present_in_cashbox' && c.currentState !== 'present_in_cashbox') return false;
        if (mainStatus === 'deposited_to_bank' && c.currentState !== 'deposited_to_bank') return false;
        if (mainStatus === 'cleared' && c.currentState !== 'cleared') return false;
        if (mainStatus === 'bounced' && c.currentState !== 'bounced') return false;
        if (mainStatus === 'passed_to_others' && c.currentState !== 'passed_to_others') return false;
        if (mainStatus === 'returned_to_customer' && c.currentState !== 'returned_to_customer' && c.currentSubState !== 'returned_to_customer') return false;
        if (mainStatus === 'lawsuit' && c.currentSubState !== 'in_legal_process') return false;
      }

      // Person Filter
      if (personId && c.personId !== personId) return false;

      // Agent Filter
      if (agentId && c.submittedByAgentId !== agentId && c.representativeId !== agentId) return false;

      // Issuing Bank Filter
      if (issuingBank && c.bankName !== issuingBank) return false;

      // Destination Bank Filter
      if (destinationBankId && c.depositedBankId !== destinationBankId) return false;

      // Amounts
      if (minAmount !== '' && c.amount < Number(minAmount)) return false;
      if (maxAmount !== '' && c.amount > Number(maxAmount)) return false;

      // Due Date Range
      if (dueDateFrom && c.dueDate < dueDateFrom) return false;
      if (dueDateTo && c.dueDate > dueDateTo) return false;

      // Receipt Date Range (initial history date or createdAt)
      const receiptDate = c.history && c.history.length > 0 ? c.history[0].date : (c.createdAt ? c.createdAt.substring(0, 10) : c.dueDate);
      if (receiptDateFrom && receiptDate < receiptDateFrom) return false;
      if (receiptDateTo && receiptDate > receiptDateTo) return false;

      // Action Date Range (if any state change in history falls within range)
      if (actionDateFrom || actionDateTo) {
        const hasActionInRange = (c.history || []).some(h => {
          if (actionDateFrom && h.date < actionDateFrom) return false;
          if (actionDateTo && h.date > actionDateTo) return false;
          return true;
        });
        if (!hasActionInRange) return false;
      }

      // Toggles
      if (isAmaniOnly && !c.isAmani) return false;
      if (isInstallmentOnly && !c.isInstallment) return false;
      if (isAgentOnly && !c.submittedByAgentId && !c.representativeId) return false;
      if (isAdminOnly && (c.submittedByAgentId || c.representativeId)) return false;
      if (isMissingDocsOnly && c.sayadiNumber && c.sayadiNumber.trim().length >= 16) return false;
      if (isLegalOnly && c.currentSubState !== 'in_legal_process') return false;

      return true;
    }).sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      if (sortColumn === 'dueDate') {
        valA = a.dueDate || '';
        valB = b.dueDate || '';
      } else if (sortColumn === 'receiptDate') {
        valA = a.history?.[0]?.date || a.createdAt || '';
        valB = b.history?.[0]?.date || b.createdAt || '';
      } else if (sortColumn === 'amount') {
        valA = a.amount;
        valB = b.amount;
      } else if (sortColumn === 'person') {
        valA = (state.persons || []).find(p => p.id === a.personId)?.name || '';
        valB = (state.persons || []).find(p => p.id === b.personId)?.name || '';
      } else if (sortColumn === 'status') {
        valA = a.currentState || '';
        valB = b.currentState || '';
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [
    allReceivedChecks, searchQuery, mainStatus, personId, agentId, issuingBank, destinationBankId,
    minAmount, maxAmount, dueDateFrom, dueDateTo, receiptDateFrom, receiptDateTo, actionDateFrom, actionDateTo,
    isAmaniOnly, isInstallmentOnly, isAgentOnly, isAdminOnly, isMissingDocsOnly, isLegalOnly, sortColumn, sortDirection, state.persons
  ]);

  // Multi-select helpers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedCheckIds(filteredChecks.map(c => c.id));
    } else {
      setSelectedCheckIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedCheckIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Selected checks totals & analytics
  const selectedChecksList = useMemo(() => {
    return filteredChecks.filter(c => selectedCheckIds.includes(c.id));
  }, [filteredChecks, selectedCheckIds]);

  const selectedTotals = useMemo(() => {
    const selected = selectedChecksList;
    const count = selected.length;
    const sum = selected.reduce((acc, c) => acc + (c.amount || 0), 0);
    const avg = count > 0 ? Math.round(sum / count) : 0;
    return { count, sum, avg };
  }, [selectedChecksList]);

  const selectedChecksAnalytics = useMemo(() => {
    const list = selectedChecksList;
    const count = list.length;
    const sum = list.reduce((acc, c) => acc + (c.amount || 0), 0);
    const avgAmount = count > 0 ? Math.round(sum / count) : 0;
    let maxAmount = 0;
    let minAmount = count > 0 ? list[0].amount : 0;

    let totalDays = 0;
    let nearDueCount = 0;
    let nearDueSum = 0;
    let overdueCount = 0;
    let overdueSum = 0;

    list.forEach(c => {
      if (c.amount > maxAmount) maxAmount = c.amount;
      if (c.amount < minAmount) minAmount = c.amount;

      if (c.dueDate) {
        const diff = getJalaliDiffDays(c.dueDate, todayJalali);
        totalDays += diff;
        if (diff < 0) {
          overdueCount++;
          overdueSum += c.amount;
        } else if (diff >= 0 && diff <= 7) {
          nearDueCount++;
          nearDueSum += c.amount;
        }
      }
    });

    const avgDaysToDueDate = count > 0 ? Math.round(totalDays / count) : 0;

    return {
      count,
      sum,
      avgAmount,
      maxAmount,
      minAmount,
      avgDaysToDueDate,
      nearDueCount,
      nearDueSum,
      overdueCount,
      overdueSum
    };
  }, [selectedChecksList, todayJalali]);

  // Phase 4 KPIs Computation
  const kpis = useMemo(() => {
    const list = filteredChecks;
    const totalCount = list.length;
    const totalAmount = list.reduce((acc, c) => acc + (c.amount || 0), 0);

    const cashboxList = list.filter(c => c.currentState === 'present_in_cashbox');
    const cashboxCount = cashboxList.length;
    const cashboxSum = cashboxList.reduce((acc, c) => acc + c.amount, 0);

    const depositedList = list.filter(c => c.currentState === 'deposited_to_bank');
    const depositedCount = depositedList.length;
    const depositedSum = depositedList.reduce((acc, c) => acc + c.amount, 0);

    const clearedList = list.filter(c => c.currentState === 'cleared');
    const clearedCount = clearedList.length;
    const clearedSum = clearedList.reduce((acc, c) => acc + c.amount, 0);

    const bouncedList = list.filter(c => c.currentState === 'bounced');
    const bouncedCount = bouncedList.length;
    const bouncedSum = bouncedList.reduce((acc, c) => acc + c.amount, 0);

    const passedList = list.filter(c => c.currentState === 'passed_to_others');
    const passedCount = passedList.length;
    const passedSum = passedList.reduce((acc, c) => acc + c.amount, 0);

    const returnedList = list.filter(c => c.currentState === 'returned_to_customer' || c.currentSubState === 'returned_to_customer');
    const returnedCount = returnedList.length;
    const returnedSum = returnedList.reduce((acc, c) => acc + c.amount, 0);

    const amaniList = list.filter(c => c.isAmani);
    const amaniCount = amaniList.length;
    const amaniSum = amaniList.reduce((acc, c) => acc + c.amount, 0);

    const legalList = list.filter(c => c.currentSubState === 'in_legal_process');
    const legalCount = legalList.length;
    const legalSum = legalList.reduce((acc, c) => acc + c.amount, 0);

    const nonAmaniCount = totalCount - amaniCount;
    const collectionRate = nonAmaniCount > 0 ? Math.round((clearedCount / nonAmaniCount) * 100) : 0;
    const bounceRate = nonAmaniCount > 0 ? Math.round((bouncedCount / nonAmaniCount) * 100) : 0;

    const avgAmount = totalCount > 0 ? Math.round(totalAmount / totalCount) : 0;
    
    let maxCheck: Check | null = null;
    let minCheck: Check | null = null;
    if (list.length > 0) {
      maxCheck = [...list].sort((a, b) => b.amount - a.amount)[0];
      minCheck = [...list].sort((a, b) => a.amount - b.amount)[0];
    }

    return {
      totalCount, totalAmount,
      cashboxCount, cashboxSum,
      depositedCount, depositedSum,
      clearedCount, clearedSum,
      bouncedCount, bouncedSum,
      passedCount, passedSum,
      returnedCount, returnedSum,
      amaniCount, amaniSum,
      legalCount, legalSum,
      collectionRate, bounceRate, avgAmount,
      maxCheck, minCheck
    };
  }, [filteredChecks]);

  // Phase 5 Liquidity Forecast Computation
  const liquidityForecast = useMemo(() => {
    // Only consider checks expecting collection (in cashbox or deposited in bank)
    const activeChecks = filteredChecks.filter(c => c.currentState === 'present_in_cashbox' || c.currentState === 'deposited_to_bank');
    
    const overdueList = activeChecks.filter(c => c.dueDate < todayJalali);
    const todayList = activeChecks.filter(c => c.dueDate === todayJalali);
    const next7DaysList = activeChecks.filter(c => {
      if (c.dueDate <= todayJalali) return false;
      const diff = getJalaliDiffDays(c.dueDate, todayJalali);
      return diff >= 1 && diff <= 7;
    });
    const next30DaysList = activeChecks.filter(c => {
      const diff = getJalaliDiffDays(c.dueDate, todayJalali);
      return diff > 7 && diff <= 30;
    });
    const next60DaysList = activeChecks.filter(c => {
      const diff = getJalaliDiffDays(c.dueDate, todayJalali);
      return diff > 30 && diff <= 60;
    });
    const farFutureList = activeChecks.filter(c => {
      const diff = getJalaliDiffDays(c.dueDate, todayJalali);
      return diff > 60;
    });

    const sumList = (arr: Check[]) => arr.reduce((acc, item) => acc + item.amount, 0);

    return {
      overdue: { count: overdueList.length, sum: sumList(overdueList), items: overdueList },
      today: { count: todayList.length, sum: sumList(todayList), items: todayList },
      next7Days: { count: next7DaysList.length, sum: sumList(next7DaysList), items: next7DaysList },
      next30Days: { count: next30DaysList.length, sum: sumList(next30DaysList), items: next30DaysList },
      next60Days: { count: next60DaysList.length, sum: sumList(next60DaysList), items: next60DaysList },
      farFuture: { count: farFutureList.length, sum: sumList(farFutureList), items: farFutureList },
      totalActiveSum: sumList(activeChecks),
      totalActiveCount: activeChecks.length
    };
  }, [filteredChecks, todayJalali]);

  // Phase 3 Breakdowns (Customer, Agent, Issuing Bank)
  const customerBreakdown = useMemo(() => {
    const map = new Map<string, {
      person: Person | undefined;
      totalCount: number;
      totalAmount: number;
      clearedAmount: number;
      bouncedAmount: number;
      inTransitAmount: number;
    }>();

    filteredChecks.forEach(c => {
      const p = (state.persons || []).find(person => person.id === c.personId);
      const key = c.personId || 'unknown';
      const existing = map.get(key) || {
        person: p,
        totalCount: 0,
        totalAmount: 0,
        clearedAmount: 0,
        bouncedAmount: 0,
        inTransitAmount: 0
      };

      existing.totalCount += 1;
      existing.totalAmount += c.amount;
      if (c.currentState === 'cleared') existing.clearedAmount += c.amount;
      if (c.currentState === 'bounced') existing.bouncedAmount += c.amount;
      if (c.currentState === 'deposited_to_bank' || c.currentState === 'present_in_cashbox') existing.inTransitAmount += c.amount;

      map.set(key, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredChecks, state.persons]);

  const agentBreakdown = useMemo(() => {
    const map = new Map<string, {
      agentName: string;
      totalCount: number;
      totalAmount: number;
      clearedCount: number;
      clearedSum: number;
      bouncedCount: number;
      bouncedSum: number;
    }>();

    filteredChecks.forEach(c => {
      const agId = c.submittedByAgentId || c.representativeId || 'management';
      const agPerson = (state.persons || []).find(p => p.id === agId);
      const agName = agId === 'management' ? 'مدیریت مرکز' : (agPerson?.name || 'نماینده سیستم');

      const existing = map.get(agId) || {
        agentName: agName,
        totalCount: 0,
        totalAmount: 0,
        clearedCount: 0,
        clearedSum: 0,
        bouncedCount: 0,
        bouncedSum: 0
      };

      existing.totalCount += 1;
      existing.totalAmount += c.amount;
      if (c.currentState === 'cleared') {
        existing.clearedCount += 1;
        existing.clearedSum += c.amount;
      }
      if (c.currentState === 'bounced') {
        existing.bouncedCount += 1;
        existing.bouncedSum += c.amount;
      }

      map.set(agId, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredChecks, state.persons]);

  const bankBreakdown = useMemo(() => {
    const map = new Map<string, { bankName: string; count: number; sum: number }>();
    filteredChecks.forEach(c => {
      const b = c.bankName || 'نامشخص';
      const existing = map.get(b) || { bankName: b, count: 0, sum: 0 };
      existing.count += 1;
      existing.sum += c.amount;
      map.set(b, existing);
    });
    return Array.from(map.values()).sort((a, b) => b.sum - a.sum);
  }, [filteredChecks]);

  // Excel Export Handler
  const handleExportExcel = () => {
    const exportData = filteredChecks.map((c, idx) => {
      const person = (state.persons || []).find(p => p.id === c.personId);
      const agent = (state.persons || []).find(p => p.id === c.submittedByAgentId || p.id === c.representativeId);
      
      let statusStr = 'موجود در صندوق';
      if (c.currentState === 'deposited_to_bank') statusStr = 'واگذار به بانک (در جریان وصول)';
      else if (c.currentState === 'cleared') statusStr = 'وصول شده';
      else if (c.currentState === 'bounced') statusStr = 'برگشتی';
      else if (c.currentState === 'passed_to_others') statusStr = 'خرج شده';
      else if (c.currentState === 'returned_to_customer') statusStr = 'عودت داده شده به مشتری';

      return {
        'ردیف': idx + 1,
        'تاریخ سررسید': c.dueDate,
        'تاریخ دریافت': c.history?.[0]?.date || c.createdAt?.substring(0, 10) || '-',
        'نام مشتری / صادرکننده': person?.name || 'ناشناس',
        'کد ملی مشتری': c.nationalId || person?.nationalId || '-',
        'مبلغ (ریال)': c.amount,
        'شماره صیادی': c.sayadiNumber || '-',
        'شماره چک': c.checkNumber || '-',
        'بانک صادرکننده': c.bankName || '-',
        'وضعیت فعلی': statusStr,
        'نماینده ثبت‌کننده': agent?.name || 'مدیریت',
        'امانی / ضمانتی': c.isAmani ? 'بله' : 'خیر',
        'توضیحات': c.history?.[c.history.length - 1]?.note || ''
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    
    // Append grand summary
    XLSX.utils.sheet_add_aoa(worksheet, [
      [],
      ['جمع تعداد چک‌ها', kpis.totalCount, 'جمع کل مبالغ (ریال)', kpis.totalAmount]
    ], { origin: -1 });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'چک‌های دریافتی');
    XLSX.writeFile(workbook, `گزارش_چکهای_دریافتی_${todayJalali.replace(/\//g, '-')}.xlsx`);
  };

  // Helper for status badge
  const renderStatusBadge = (check: Check) => {
    if (check.isAmani) {
      return <span className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] px-2 py-0.5 rounded-full font-medium">امانی/ضمانتی</span>;
    }
    switch (check.currentState) {
      case 'present_in_cashbox':
        return <span className="bg-sky-100 text-sky-800 border border-sky-200 text-[10px] px-2 py-0.5 rounded-full font-medium">موجود در صندوق</span>;
      case 'deposited_to_bank':
        return <span className="bg-purple-100 text-purple-800 border border-purple-200 text-[10px] px-2 py-0.5 rounded-full font-medium">در جریان وصول (بانک)</span>;
      case 'cleared':
        return <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] px-2 py-0.5 rounded-full font-medium">وصول شده</span>;
      case 'bounced':
        if (check.currentSubState === 'in_legal_process') {
          return <span className="bg-rose-100 text-rose-800 border border-rose-300 text-[10px] px-2 py-0.5 rounded-full font-bold">برگشتی (پیگیری حقوقی)</span>;
        }
        return <span className="bg-rose-100 text-rose-700 border border-rose-200 text-[10px] px-2 py-0.5 rounded-full font-medium">برگشتی</span>;
      case 'passed_to_others':
        return <span className="bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10px] px-2 py-0.5 rounded-full font-medium">خرج شده</span>;
      default:
        if ((check.currentState as string) === 'returned_to_customer' || check.currentSubState === 'returned_to_customer') {
          return <span className="bg-zinc-100 text-zinc-700 border border-zinc-200 text-[10px] px-2 py-0.5 rounded-full font-medium">عودت شده به مشتری</span>;
        }
        return <span className="bg-zinc-100 text-zinc-600 text-[10px] px-2 py-0.5 rounded-full">{check.currentState}</span>;
    }
  };

  return (
    <div className="space-y-6 text-right font-sans dir-rtl">
      {/* HEADER BAR */}
      {!hideHeaderAndTabs && (
        <div className="bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 text-white p-5 rounded-3xl shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-2xl border border-emerald-500/30">
                <Landmark size={24} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white tracking-wide">مرکز جامع گزارش‌های مدیریتی چک‌های دریافتی</h1>
                <p className="text-xs text-zinc-400 mt-0.5">بانک اطلاعاتی واحد و گزارش‌گیری چندبعدی کلیه چک‌های اسناد دریافتنی</p>
              </div>
            </div>
          </div>

          {/* Top Actions */}
          <div className="flex items-center gap-2 w-full md:w-auto justify-end">
            <button
              onClick={handleExportExcel}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-medium transition-all shadow-sm flex items-center gap-1.5 active:scale-95 cursor-pointer"
              title="خروجی اکسل کامل با تمام اطلاعات"
            >
              <FileSpreadsheet size={16} />
              <span>خروجی اکسل (Excel)</span>
            </button>

            <button
              onClick={() => setShowPrintModal(true)}
              className="bg-zinc-700 hover:bg-zinc-600 text-white px-3.5 py-2 rounded-xl text-xs font-medium transition-all shadow-sm flex items-center gap-1.5 active:scale-95 cursor-pointer"
              title="چاپ رسمی و خروجی PDF"
            >
              <Printer size={16} />
              <span>چاپ / PDF</span>
            </button>

            <button
              onClick={handleResetFilters}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-3 py-2 rounded-xl text-xs font-medium transition-all border border-zinc-700 flex items-center gap-1 cursor-pointer"
              title="بازنشانی تمام فیلترها"
            >
              <RotateCcw size={14} />
              <span>بازنشانی</span>
            </button>
          </div>
        </div>
      )}

      {/* SUB-NAVIGATION TABS */}
      {!hideHeaderAndTabs && (
        <div className="bg-white p-2 rounded-2xl border border-zinc-200 shadow-xs flex flex-wrap gap-1.5 text-xs">
          <button
            onClick={() => setActiveTab('central_table')}
            className={`px-4 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'central_table'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <BookOpen size={16} />
            <span>بانک مرکزی چک‌ها (جدول هوشمند)</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${activeTab === 'central_table' ? 'bg-emerald-700 text-emerald-100' : 'bg-zinc-100 text-zinc-600'}`}>
              {filteredChecks.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('kpis_dashboard')}
            className={`px-4 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'kpis_dashboard'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <PieChart size={16} />
            <span>داشبورد و شاخص‌های کلیدی (KPIs)</span>
          </button>

          <button
            onClick={() => setActiveTab('liquidity_forecast')}
            className={`px-4 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'liquidity_forecast'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <Clock size={16} />
            <span>پیش‌بینی نقدینگی و سررسیدها</span>
            {liquidityForecast.overdue.count > 0 && (
              <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                {liquidityForecast.overdue.count} سررسید گذشته
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('entities_breakdown')}
            className={`px-4 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'entities_breakdown'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <Users size={16} />
            <span>گزارش تفکیکی (مشتریان، نمایندگان، بانک‌ها)</span>
          </button>

          <button
            onClick={() => setActiveTab('bounced_legal')}
            className={`px-4 py-2.5 rounded-xl font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'bounced_legal'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            <ShieldCheck size={16} />
            <span>چک‌های برگشتی و پیگیری حقوقی</span>
            {kpis.bouncedCount > 0 && (
              <span className="bg-rose-100 text-rose-700 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                {kpis.bouncedCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* COMPREHENSIVE FILTER PANEL */}
      <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
          <div className="flex items-center gap-2 text-zinc-800 font-bold text-xs">
            <Filter size={16} className="text-emerald-600" />
            <span>فیلترهای ترکیبی و جستجوی پیشرفته</span>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-zinc-500 font-mono">
            <span>تعداد نتایج منطبق:</span>
            <strong className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
              {filteredChecks.length} فقره ({kpis.totalAmount.toLocaleString()} ریال)
            </strong>
          </div>
        </div>

        {/* Filter Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
          {/* 1. Quick Search */}
          <div className="lg:col-span-2">
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">جستجوی سریع (صیادی، شماره چک، مشتری، کد ملی، بانک)</label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="تایپ کنید..."
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pr-9 pl-3 py-2 text-zinc-800 focus:bg-white focus:border-emerald-500 transition-all text-xs"
              />
              <Search size={16} className="absolute right-2.5 top-2.5 text-zinc-400" />
            </div>
          </div>

          {/* 2. Main Status */}
          <div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">وضعیت اصلی چک</label>
            <select
              value={mainStatus}
              onChange={e => setMainStatus(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:bg-white focus:border-emerald-500 transition-all text-xs"
            >
              <option value="all">همه وضعیت‌ها</option>
              <option value="present_in_cashbox">موجود در صندوق</option>
              <option value="deposited_to_bank">در جریان وصول (واگذار به بانک)</option>
              <option value="cleared">وصول شده</option>
              <option value="bounced">برگشتی</option>
              <option value="passed_to_others">خرج شده (واگذار به غیر)</option>
              <option value="returned_to_customer">عودت داده شده به مشتری</option>
              <option value="lawsuit">در جریان پیگیری حقوقی</option>
            </select>
          </div>

          {/* 3. Customer */}
          <div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">مشتری / صادرکننده</label>
            <select
              value={personId}
              onChange={e => setPersonId(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:bg-white focus:border-emerald-500 transition-all text-xs"
            >
              <option value="">همه مشتریان</option>
              {(state.persons || []).map(p => (
                <option key={p.id} value={p.id}>{p.name} {p.nationalId ? `(${p.nationalId})` : ''}</option>
              ))}
            </select>
          </div>

          {/* 4. Agent */}
          <div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">نماینده دریافت‌کننده</label>
            <select
              value={agentId}
              onChange={e => setAgentId(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:bg-white focus:border-emerald-500 transition-all text-xs"
            >
              <option value="">همه نمایندگان و مدیریت</option>
              {agentsList.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* 5. Issuing Bank */}
          <div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">بانک صادرکننده چک</label>
            <select
              value={issuingBank}
              onChange={e => setIssuingBank(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:bg-white focus:border-emerald-500 transition-all text-xs"
            >
              <option value="">همه بانک‌ها</option>
              {issuingBanksList.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          {/* 6. Minimum Amount */}
          <div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">حداقل مبلغ (ریال)</label>
            <input
              type="number"
              value={minAmount}
              onChange={e => setMinAmount(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="مثال: 10,000,000"
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 font-mono text-xs focus:bg-white focus:border-emerald-500 transition-all"
            />
          </div>

          {/* 7. Maximum Amount */}
          <div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">حداکثر مبلغ (ریال)</label>
            <input
              type="number"
              value={maxAmount}
              onChange={e => setMaxAmount(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="مثال: 500,000,000"
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 font-mono text-xs focus:bg-white focus:border-emerald-500 transition-all"
            />
          </div>

          {/* 8. Due Date Range */}
          <div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">سررسید از تاریخ</label>
            <input
              type="text"
              value={dueDateFrom}
              onChange={e => setDueDateFrom(e.target.value)}
              placeholder="1405/01/01"
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 font-mono text-xs text-center focus:bg-white focus:border-emerald-500 transition-all"
            />
          </div>

          <div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">سررسید تا تاریخ</label>
            <input
              type="text"
              value={dueDateTo}
              onChange={e => setDueDateTo(e.target.value)}
              placeholder="1405/12/29"
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 font-mono text-xs text-center focus:bg-white focus:border-emerald-500 transition-all"
            />
          </div>

          {/* 9. Receipt Date Range */}
          <div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">تاریخ دریافت از</label>
            <input
              type="text"
              value={receiptDateFrom}
              onChange={e => setReceiptDateFrom(e.target.value)}
              placeholder="1405/01/01"
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 font-mono text-xs text-center focus:bg-white focus:border-emerald-500 transition-all"
            />
          </div>

          <div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">تاریخ دریافت تا</label>
            <input
              type="text"
              value={receiptDateTo}
              onChange={e => setReceiptDateTo(e.target.value)}
              placeholder="1405/12/29"
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 font-mono text-xs text-center focus:bg-white focus:border-emerald-500 transition-all"
            />
          </div>
        </div>

        {/* Quick Due Date Presets & Check Category Toggles */}
        <div className="pt-2 border-t border-zinc-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Pre-set Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-zinc-400">میانبر سررسید:</span>
            <button
              onClick={() => applyDueDatePreset('today')}
              className="px-2.5 py-1 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-700 rounded-lg text-[11px] text-zinc-600 transition-all cursor-pointer"
            >
              امروز
            </button>
            <button
              onClick={() => applyDueDatePreset('this_week')}
              className="px-2.5 py-1 bg-zinc-100 hover:bg-emerald-50 hover:text-emerald-700 rounded-lg text-[11px] text-zinc-600 transition-all cursor-pointer"
            >
              این ماه
            </button>
            <button
              onClick={() => applyDueDatePreset('overdue')}
              className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] transition-all cursor-pointer"
            >
              سررسید گذشته
            </button>
            <button
              onClick={() => applyDueDatePreset('all')}
              className="px-2 py-1 text-zinc-400 hover:text-zinc-600 text-[11px] cursor-pointer"
            >
              پاکسازی سررسید
            </button>
          </div>

          {/* Check Category Checkboxes */}
          <div className="flex items-center gap-4 flex-wrap text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isAmaniOnly}
                onChange={e => setIsAmaniOnly(e.target.checked)}
                className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-zinc-700">فقط امانی / ضمانتی</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isInstallmentOnly}
                onChange={e => setIsInstallmentOnly(e.target.checked)}
                className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-zinc-700">فقط اقساطی</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isAgentOnly}
                onChange={e => setIsAgentOnly(e.target.checked)}
                className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-zinc-700">فقط نمایندگان</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isAdminOnly}
                onChange={e => setIsAdminOnly(e.target.checked)}
                className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-zinc-700">فقط ثبت مدیریت</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isMissingDocsOnly}
                onChange={e => setIsMissingDocsOnly(e.target.checked)}
                className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-zinc-700">فقط چک‌های بدون مدارک / صیادی</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isLegalOnly}
                onChange={e => setIsLegalOnly(e.target.checked)}
                className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-rose-700 font-medium">دارای پرونده حقوقی</span>
            </label>
          </div>
        </div>
      </div>

      {/* VIEW CONTENT BASED ON TAB */}

      {/* TAB 1: SMART CENTRAL TABLE */}
      {activeTab === 'central_table' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xs overflow-hidden">
            {/* Table Header Controls */}
            <div className="p-4 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedCheckIds.length > 0 && selectedCheckIds.length === filteredChecks.length}
                  onChange={handleSelectAll}
                  className="rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
                <span className="font-bold text-zinc-700">
                  {selectedCheckIds.length > 0 
                    ? `${selectedCheckIds.length} فقره انتخاب شده` 
                    : `نمایش کل لیست (${filteredChecks.length} فقره)`
                  }
                </span>
              </div>

              {/* Sorting Controls */}
              <div className="flex items-center gap-2">
                <span className="text-zinc-400 text-[10px]">مرتب‌سازی بر اساس:</span>
                <select
                  value={sortColumn}
                  onChange={e => setSortColumn(e.target.value as any)}
                  className="bg-white border border-zinc-200 rounded-lg px-2.5 py-1 text-zinc-700 text-xs"
                >
                  <option value="dueDate">تاریخ سررسید</option>
                  <option value="receiptDate">تاریخ دریافت</option>
                  <option value="amount">مبلغ چک</option>
                  <option value="person">نام مشتری</option>
                  <option value="status">وضعیت</option>
                </select>

                <button
                  onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="bg-white border border-zinc-200 p-1.5 rounded-lg text-zinc-600 hover:text-emerald-600 cursor-pointer"
                  title="تغییر جهت مرتب‌سازی"
                >
                  {sortDirection === 'asc' ? 'صعودی ⬆' : 'نزولی ⬇'}
                </button>
              </div>
            </div>

            {/* Main Table */}
            {filteredChecks.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-zinc-100/80 text-zinc-600 border-b border-zinc-200 font-bold">
                      <th className="p-3 text-center w-10">
                        <input
                          type="checkbox"
                          checked={selectedCheckIds.length > 0 && selectedCheckIds.length === filteredChecks.length}
                          onChange={handleSelectAll}
                          className="rounded border-zinc-300 text-emerald-600 cursor-pointer"
                        />
                      </th>
                      <th className="p-3 text-center w-12">ردیف</th>
                      <th className="p-3">مشتری / صادرکننده</th>
                      <th className="p-3 text-center">شناسه صیادی (۱۶ رقم)</th>
                      <th className="p-3 text-center">شماره چک / بانک</th>
                      <th className="p-3 text-center">تاریخ سررسید</th>
                      <th className="p-3 text-center">تاریخ دریافت</th>
                      <th className="p-3 text-left">مبلغ (ریال)</th>
                      <th className="p-3 text-center">وضعیت فعلی</th>
                      <th className="p-3 text-center">نماینده</th>
                      <th className="p-3 text-center">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-150">
                    {filteredChecks.map((chk, idx) => {
                      const isSelected = selectedCheckIds.includes(chk.id);
                      const person = (state.persons || []).find(p => p.id === chk.personId);
                      const agent = (state.persons || []).find(p => p.id === chk.submittedByAgentId || p.id === chk.representativeId);
                      const receiptDate = chk.history?.[0]?.date || chk.createdAt?.substring(0, 10) || '-';

                      // Diff days for due date
                      const diffDays = getJalaliDiffDays(chk.dueDate, todayJalali);
                      let dueDateBadge = null;
                      if (chk.currentState === 'present_in_cashbox' || chk.currentState === 'deposited_to_bank') {
                        if (diffDays < 0) {
                          dueDateBadge = <span className="block text-[9px] text-rose-600 font-bold">{Math.abs(diffDays)} روز گذشته</span>;
                        } else if (diffDays === 0) {
                          dueDateBadge = <span className="block text-[9px] text-amber-600 font-bold">امروز سررسید</span>;
                        } else if (diffDays > 0 && diffDays <= 7) {
                          dueDateBadge = <span className="block text-[9px] text-sky-600">{diffDays} روز مانده</span>;
                        }
                      }

                      return (
                        <tr 
                          key={chk.id} 
                          className={`hover:bg-zinc-50 transition-all ${isSelected ? 'bg-emerald-50/50' : ''}`}
                        >
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelect(chk.id)}
                              className="rounded border-zinc-300 text-emerald-600 cursor-pointer"
                            />
                          </td>
                          <td className="p-3 text-center font-mono text-zinc-400">{idx + 1}</td>
                          <td className="p-3">
                            <strong className="block text-zinc-800 font-bold">{person?.name || 'ناشناس'}</strong>
                            <span className="text-[10px] text-zinc-400 font-mono">{chk.nationalId || person?.nationalId || ''}</span>
                          </td>
                          <td className="p-3 text-center font-mono">
                            <div className="bg-zinc-900 text-zinc-100 px-2.5 py-1 rounded-lg text-xs tracking-widest inline-block border border-zinc-800 shadow-2xs select-all">
                              {chk.sayadiNumber || '----------------'}
                            </div>
                          </td>
                          <td className="p-3 text-center">
                            <span className="block font-bold text-zinc-700">{chk.bankName || 'بانک نامشخص'}</span>
                            <span className="text-[10px] text-zinc-400 font-mono">سریال: {chk.checkNumber || '-'}</span>
                          </td>
                          <td className="p-3 text-center font-mono">
                            <span className="font-bold text-zinc-800">{chk.dueDate}</span>
                            {dueDateBadge}
                          </td>
                          <td className="p-3 text-center font-mono text-zinc-500">
                            {receiptDate}
                          </td>
                          <td className="p-3 text-left font-mono font-bold text-emerald-700 text-sm">
                            {chk.amount.toLocaleString()}
                          </td>
                          <td className="p-3 text-center">
                            {renderStatusBadge(chk)}
                          </td>
                          <td className="p-3 text-center text-[11px]">
                            {agent ? (
                              <span className="text-zinc-700 font-medium">{agent.name}</span>
                            ) : (
                              <span className="text-zinc-400">مدیریت</span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => setHistoryModalCheck(chk)}
                                className="p-1.5 text-zinc-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all cursor-pointer"
                                title="مشاهده چرخه عمر و اسناد مرتبط"
                              >
                                <Eye size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-12 text-center space-y-3">
                <AlertTriangle className="mx-auto text-amber-500 opacity-60" size={32} />
                <p className="text-zinc-500 font-bold text-sm">هیچ چک دریافتی با فیلترهای انتخابی یافت نشد.</p>
                <button
                  onClick={handleResetFilters}
                  className="px-4 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl text-xs font-medium cursor-pointer"
                >
                  پاکسازی فیلترها
                </button>
              </div>
            )}
          </div>

          {/* FLOATING MULTI-SELECT RIBBON */}
          {selectedCheckIds.length > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 text-white px-6 py-3.5 rounded-2xl shadow-2xl border border-zinc-800 flex items-center gap-6 z-40 animate-fade-in text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>تعداد انتخاب شده: <strong className="text-emerald-300 font-mono text-sm">{selectedTotals.count}</strong> فقره</span>
              </div>

              <div className="h-4 w-px bg-zinc-700"></div>

              <div>
                <span>مجموع مبالغ: <strong className="text-emerald-300 font-mono text-sm">{selectedTotals.sum.toLocaleString()}</strong> ریال</span>
              </div>

              <div className="h-4 w-px bg-zinc-700"></div>

              <div>
                <span>میانگین: <strong className="text-zinc-300 font-mono">{selectedTotals.avg.toLocaleString()}</strong> ریال</span>
              </div>

              <div className="h-4 w-px bg-zinc-700"></div>

              <button
                onClick={() => setShowSelectedAnalyticsModal(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md transition-all"
              >
                <BarChart2 size={14} />
                <span>داشبورد تحلیل</span>
              </button>

              <div className="flex items-center gap-1.5 bg-zinc-800 p-1 rounded-xl">
                <button
                  onClick={() => setBulkModalType('deposit')}
                  disabled={isProcessingBulk}
                  className="bg-sky-600 hover:bg-sky-500 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all"
                  title="واگذاری به بانک"
                >
                  واگذاری بانک
                </button>
                <button
                  onClick={() => setBulkModalType('endorse')}
                  disabled={isProcessingBulk}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all"
                  title="واگذاری به شخص ثالث"
                >
                  واگذاری شخص
                </button>
                <button
                  onClick={() => executeQuickBulkState('cleared')}
                  disabled={isProcessingBulk}
                  className="bg-emerald-700 hover:bg-emerald-600 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all"
                  title="وصول چک"
                >
                  وصول
                </button>
                <button
                  onClick={() => executeQuickBulkState('bounced', 'returned_to_customer')}
                  disabled={isProcessingBulk}
                  className="bg-rose-700 hover:bg-rose-600 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all"
                  title="برگشت چک"
                >
                  برگشت
                </button>
                <button
                  onClick={() => executeQuickBulkState('bounced', 'in_legal_process')}
                  disabled={isProcessingBulk}
                  className="bg-amber-700 hover:bg-amber-600 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all"
                  title="پیگیری حقوقی"
                >
                  حقوقی
                </button>
                <button
                  onClick={() => setBulkModalType('return')}
                  disabled={isProcessingBulk}
                  className="bg-zinc-700 hover:bg-zinc-600 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-all"
                  title="عودت رسمی چک"
                >
                  عودت
                </button>
              </div>

              <button
                onClick={() => setSelectedCheckIds([])}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1 rounded-xl text-[11px] cursor-pointer"
              >
                انصراف
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: KPIS & EXECUTIVE DASHBOARD */}
      {activeTab === 'kpis_dashboard' && (
        <div className="space-y-6">
          {/* Executive Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* 1. Total Checks */}
            <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-xs space-y-2">
              <div className="flex justify-between items-center text-zinc-500">
                <span className="text-xs font-medium">کل چک‌های دریافتی</span>
                <Landmark size={18} className="text-emerald-600" />
              </div>
              <div className="text-xl font-bold font-mono text-zinc-900">
                {kpis.totalCount} <span className="text-xs text-zinc-400 font-sans font-normal">فقره</span>
              </div>
              <div className="text-xs font-mono text-emerald-700 font-bold">
                {kpis.totalAmount.toLocaleString()} <span className="text-[10px] text-zinc-400 font-sans font-normal">ریال</span>
              </div>
            </div>

            {/* 2. In Cashbox */}
            <div className="bg-white p-4 rounded-2xl border border-sky-200 shadow-xs space-y-2 bg-gradient-to-br from-white to-sky-50/30">
              <div className="flex justify-between items-center text-sky-800">
                <span className="text-xs font-bold">موجود در صندوق</span>
                <DollarSign size={18} className="text-sky-600" />
              </div>
              <div className="text-xl font-bold font-mono text-sky-900">
                {kpis.cashboxCount} <span className="text-xs text-zinc-400 font-sans font-normal">فقره</span>
              </div>
              <div className="text-xs font-mono text-sky-700 font-bold">
                {kpis.cashboxSum.toLocaleString()} <span className="text-[10px] text-zinc-400 font-sans font-normal">ریال</span>
              </div>
            </div>

            {/* 3. Deposited in Bank */}
            <div className="bg-white p-4 rounded-2xl border border-purple-200 shadow-xs space-y-2 bg-gradient-to-br from-white to-purple-50/30">
              <div className="flex justify-between items-center text-purple-800">
                <span className="text-xs font-bold">در جریان وصول (بانک)</span>
                <Clock size={18} className="text-purple-600" />
              </div>
              <div className="text-xl font-bold font-mono text-purple-900">
                {kpis.depositedCount} <span className="text-xs text-zinc-400 font-sans font-normal">فقره</span>
              </div>
              <div className="text-xs font-mono text-purple-700 font-bold">
                {kpis.depositedSum.toLocaleString()} <span className="text-[10px] text-zinc-400 font-sans font-normal">ریال</span>
              </div>
            </div>

            {/* 4. Cleared */}
            <div className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-xs space-y-2 bg-gradient-to-br from-white to-emerald-50/30">
              <div className="flex justify-between items-center text-emerald-800">
                <span className="text-xs font-bold">وصول شده</span>
                <CheckCircle size={18} className="text-emerald-600" />
              </div>
              <div className="text-xl font-bold font-mono text-emerald-900">
                {kpis.clearedCount} <span className="text-xs text-zinc-400 font-sans font-normal">فقره</span>
              </div>
              <div className="text-xs font-mono text-emerald-700 font-bold">
                {kpis.clearedSum.toLocaleString()} <span className="text-[10px] text-zinc-400 font-sans font-normal">ریال</span>
              </div>
            </div>

            {/* 5. Bounced */}
            <div className="bg-white p-4 rounded-2xl border border-rose-200 shadow-xs space-y-2 bg-gradient-to-br from-white to-rose-50/30">
              <div className="flex justify-between items-center text-rose-800">
                <span className="text-xs font-bold">برگشتی</span>
                <AlertTriangle size={18} className="text-rose-600" />
              </div>
              <div className="text-xl font-bold font-mono text-rose-900">
                {kpis.bouncedCount} <span className="text-xs text-zinc-400 font-sans font-normal">فقره</span>
              </div>
              <div className="text-xs font-mono text-rose-700 font-bold">
                {kpis.bouncedSum.toLocaleString()} <span className="text-[10px] text-zinc-400 font-sans font-normal">ریال</span>
              </div>
            </div>

            {/* 6. Passed to others */}
            <div className="bg-white p-4 rounded-2xl border border-indigo-200 shadow-xs space-y-2 bg-gradient-to-br from-white to-indigo-50/30">
              <div className="flex justify-between items-center text-indigo-800">
                <span className="text-xs font-bold">خرج شده (واگذار به غیر)</span>
                <ArrowUpRight size={18} className="text-indigo-600" />
              </div>
              <div className="text-xl font-bold font-mono text-indigo-900">
                {kpis.passedCount} <span className="text-xs text-zinc-400 font-sans font-normal">فقره</span>
              </div>
              <div className="text-xs font-mono text-indigo-700 font-bold">
                {kpis.passedSum.toLocaleString()} <span className="text-[10px] text-zinc-400 font-sans font-normal">ریال</span>
              </div>
            </div>

            {/* 7. Success Rates */}
            <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-xs space-y-2">
              <div className="text-xs font-medium text-zinc-500">نرخ موفقیت و وصول</div>
              <div className="flex justify-between items-center pt-1">
                <span className="text-xs text-zinc-600">نرخ وصول:</span>
                <strong className="text-emerald-600 font-mono text-sm">{kpis.collectionRate}%</strong>
              </div>
              <div className="flex justify-between items-center border-t border-zinc-100 pt-1">
                <span className="text-xs text-zinc-600">نرخ برگشت:</span>
                <strong className="text-rose-600 font-mono text-sm">{kpis.bounceRate}%</strong>
              </div>
            </div>

            {/* 8. Average Check Amount */}
            <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-xs space-y-2">
              <div className="text-xs font-medium text-zinc-500">میانگین مبلغ چک‌ها</div>
              <div className="text-lg font-bold font-mono text-zinc-800 pt-1">
                {kpis.avgAmount.toLocaleString()} <span className="text-xs text-zinc-400 font-sans font-normal">ریال</span>
              </div>
            </div>
          </div>

          {/* Additional Analytics Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Largest Check */}
            {kpis.maxCheck && (
              <div className="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-200 space-y-2">
                <div className="text-xs font-bold text-emerald-800 flex items-center justify-between">
                  <span>بزرگترین چک دریافتی</span>
                  <span className="font-mono text-emerald-700 font-bold text-sm">{kpis.maxCheck.amount.toLocaleString()} ریال</span>
                </div>
                <div className="text-xs text-zinc-600 flex justify-between pt-1 border-t border-emerald-200/60">
                  <span>صادرکننده: <strong>{(state.persons || []).find(p => p.id === kpis.maxCheck?.personId)?.name || 'ناشناس'}</strong></span>
                  <span>سررسید: <strong className="font-mono">{kpis.maxCheck.dueDate}</strong></span>
                </div>
              </div>
            )}

            {/* Smallest Check */}
            {kpis.minCheck && (
              <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-2">
                <div className="text-xs font-bold text-zinc-800 flex items-center justify-between">
                  <span>کوچکترین چک دریافتی</span>
                  <span className="font-mono text-zinc-700 font-bold text-sm">{kpis.minCheck.amount.toLocaleString()} ریال</span>
                </div>
                <div className="text-xs text-zinc-600 flex justify-between pt-1 border-t border-zinc-200">
                  <span>صادرکننده: <strong>{(state.persons || []).find(p => p.id === kpis.minCheck?.personId)?.name || 'ناشناس'}</strong></span>
                  <span>سررسید: <strong className="font-mono">{kpis.minCheck.dueDate}</strong></span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: LIQUIDITY CASHFLOW FORECAST */}
      {activeTab === 'liquidity_forecast' && (
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-xs space-y-6">
          <div className="border-b border-zinc-100 pb-3 flex justify-between items-center">
            <div>
              <h2 className="text-sm font-bold text-zinc-800">پیش‌بینی نقدینگی اسناد دریافتنی بر اساس سررسید</h2>
              <p className="text-xs text-zinc-400 mt-0.5">تحلیل زمان‌بندی ورودی نقدینگی حاصل از پاس شدن چک‌های در صندوق و در جریان وصول</p>
            </div>
            <div className="text-left font-mono">
              <span className="block text-[10px] text-zinc-400">جمع نقدینگی در جریان</span>
              <strong className="text-emerald-700 font-bold text-sm">{liquidityForecast.totalActiveSum.toLocaleString()} ریال</strong>
            </div>
          </div>

          {/* Timeline Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {/* Overdue */}
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-rose-800">سررسید گذشته (نیاز به پیگیری)</span>
                <span className="text-xs font-mono font-bold text-rose-700">{liquidityForecast.overdue.count} فقره</span>
              </div>
              <div className="text-lg font-bold font-mono text-rose-900">
                {liquidityForecast.overdue.sum.toLocaleString()} <span className="text-xs text-zinc-500 font-normal">ریال</span>
              </div>
            </div>

            {/* Today */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-amber-800">سررسید امروز</span>
                <span className="text-xs font-mono font-bold text-amber-700">{liquidityForecast.today.count} فقره</span>
              </div>
              <div className="text-lg font-bold font-mono text-amber-900">
                {liquidityForecast.today.sum.toLocaleString()} <span className="text-xs text-zinc-500 font-normal">ریال</span>
              </div>
            </div>

            {/* Next 7 Days */}
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-emerald-800">۱ تا ۷ روز آینده</span>
                <span className="text-xs font-mono font-bold text-emerald-700">{liquidityForecast.next7Days.count} فقره</span>
              </div>
              <div className="text-lg font-bold font-mono text-emerald-900">
                {liquidityForecast.next7Days.sum.toLocaleString()} <span className="text-xs text-zinc-500 font-normal">ریال</span>
              </div>
            </div>

            {/* Next 30 Days */}
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-2xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-sky-800">۸ تا ۳۰ روز آینده</span>
                <span className="text-xs font-mono font-bold text-sky-700">{liquidityForecast.next30Days.count} فقره</span>
              </div>
              <div className="text-lg font-bold font-mono text-sky-900">
                {liquidityForecast.next30Days.sum.toLocaleString()} <span className="text-xs text-zinc-500 font-normal">ریال</span>
              </div>
            </div>

            {/* Next 60 Days */}
            <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-indigo-800">۳۱ تا ۶۰ روز آینده</span>
                <span className="text-xs font-mono font-bold text-indigo-700">{liquidityForecast.next60Days.count} فقره</span>
              </div>
              <div className="text-lg font-bold font-mono text-indigo-900">
                {liquidityForecast.next60Days.sum.toLocaleString()} <span className="text-xs text-zinc-500 font-normal">ریال</span>
              </div>
            </div>

            {/* Far Future */}
            <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-zinc-700">بیش از ۶۰ روز آینده</span>
                <span className="text-xs font-mono font-bold text-zinc-600">{liquidityForecast.farFuture.count} فقره</span>
              </div>
              <div className="text-lg font-bold font-mono text-zinc-900">
                {liquidityForecast.farFuture.sum.toLocaleString()} <span className="text-xs text-zinc-500 font-normal">ریال</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ENTITIES BREAKDOWN (CUSTOMER, AGENT, BANK) */}
      {activeTab === 'entities_breakdown' && (
        <div className="space-y-6">
          {/* Customer Breakdown Table */}
          <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-xs space-y-3">
            <h2 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
              <Users size={16} className="text-emerald-600" />
              <span>عملکرد مشتریان در تحویل چک</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-100 text-zinc-600 font-bold border-b border-zinc-200">
                    <th className="p-2.5">نام مشتری</th>
                    <th className="p-2.5 text-center">تعداد کل</th>
                    <th className="p-2.5 text-left">مجموع مبلغ (ریال)</th>
                    <th className="p-2.5 text-left">مبلغ وصول شده</th>
                    <th className="p-2.5 text-left">مبلغ برگشتی</th>
                    <th className="p-2.5 text-left">در جریان وصول / صندوق</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150">
                  {customerBreakdown.map((row, i) => (
                    <tr key={i} className="hover:bg-zinc-50">
                      <td className="p-2.5 font-bold text-zinc-800">{row.person?.name || 'ناشناس'}</td>
                      <td className="p-2.5 text-center font-mono">{row.totalCount}</td>
                      <td className="p-2.5 text-left font-mono font-bold">{row.totalAmount.toLocaleString()}</td>
                      <td className="p-2.5 text-left font-mono text-emerald-700">{row.clearedAmount.toLocaleString()}</td>
                      <td className="p-2.5 text-left font-mono text-rose-600">{row.bouncedAmount.toLocaleString()}</td>
                      <td className="p-2.5 text-left font-mono text-sky-700">{row.inTransitAmount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Agent Breakdown Table */}
          <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-xs space-y-3">
            <h2 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
              <User size={16} className="text-emerald-600" />
              <span>عملکرد نمایندگان در دریافت چک</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-100 text-zinc-600 font-bold border-b border-zinc-200">
                    <th className="p-2.5">نام نماینده / ثبت‌کننده</th>
                    <th className="p-2.5 text-center">تعداد چک</th>
                    <th className="p-2.5 text-left">مجموع مبلغ (ریال)</th>
                    <th className="p-2.5 text-center">تعداد وصول</th>
                    <th className="p-2.5 text-center">تعداد برگشتی</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150">
                  {agentBreakdown.map((row, i) => (
                    <tr key={i} className="hover:bg-zinc-50">
                      <td className="p-2.5 font-bold text-zinc-800">{row.agentName}</td>
                      <td className="p-2.5 text-center font-mono">{row.totalCount}</td>
                      <td className="p-2.5 text-left font-mono font-bold text-emerald-700">{row.totalAmount.toLocaleString()}</td>
                      <td className="p-2.5 text-center font-mono text-emerald-700">{row.clearedCount}</td>
                      <td className="p-2.5 text-center font-mono text-rose-600">{row.bouncedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: BOUNCED & LEGAL CHECKS */}
      {activeTab === 'bounced_legal' && (
        <div className="bg-white p-5 rounded-2xl border border-rose-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-rose-100 pb-3">
            <div className="flex items-center gap-2 text-rose-800 font-bold">
              <AlertTriangle size={18} className="text-rose-600" />
              <span>گزارش جامع چک‌های برگشتی و پیگیری حقوقی</span>
            </div>
            <span className="text-xs font-mono text-rose-700 font-bold">
              {kpis.bouncedCount} فقره ({kpis.bouncedSum.toLocaleString()} ریال)
            </span>
          </div>

          <div className="space-y-3">
            {filteredChecks.filter(c => c.currentState === 'bounced').map(c => {
              const person = (state.persons || []).find(p => p.id === c.personId);
              return (
                <div key={c.id} className="p-4 bg-rose-50/50 border border-rose-200 rounded-2xl space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <strong className="text-zinc-800 font-bold text-sm">{person?.name || 'ناشناس'}</strong>
                    <span className="font-mono text-rose-700 font-bold text-sm">{c.amount.toLocaleString()} ریال</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-zinc-600 pt-1 border-t border-rose-100 text-[11px]">
                    <span>شماره صیادی: <strong className="font-mono">{c.sayadiNumber || '-'}</strong></span>
                    <span>بانک: <strong>{c.bankName}</strong></span>
                    <span>سررسید: <strong className="font-mono">{c.dueDate}</strong></span>
                    <span>وضعیت: {renderStatusBadge(c)}</span>
                  </div>
                  {c.history && c.history.length > 0 && (
                    <div className="bg-white p-2.5 rounded-xl border border-rose-100 text-[10px] text-zinc-600 mt-1">
                      <strong>آخرین اقدام ثبت‌شده:</strong> {c.history[c.history.length - 1].note || 'ثبت برگشتی'} ({c.history[c.history.length - 1].date})
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* LIFECYCLE HISTORY MODAL */}
      {historyModalCheck && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden space-y-4 p-6 text-right font-sans dir-rtl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <BookOpen size={20} className="text-emerald-600" />
                <h3 className="font-bold text-zinc-800 text-sm">تاریخچه کامل چرخه عمر چک</h3>
              </div>
              <button
                onClick={() => setHistoryModalCheck(null)}
                className="p-1 text-zinc-400 hover:text-zinc-600 rounded-full cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Check Details Overview */}
            <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">مبلغ چک:</span>
                <strong className="font-mono text-emerald-700 text-base">{historyModalCheck.amount.toLocaleString()} ریال</strong>
              </div>
              <div className="grid grid-cols-2 gap-2 text-zinc-600 border-t border-zinc-200 pt-2 text-[11px]">
                <div>صادرکننده: <strong>{(state.persons || []).find(p => p.id === historyModalCheck.personId)?.name || 'ناشناس'}</strong></div>
                <div>بانک: <strong>{historyModalCheck.bankName}</strong></div>
                <div>شماره صیادی: <strong className="font-mono">{historyModalCheck.sayadiNumber || '-'}</strong></div>
                <div>سررسید: <strong className="font-mono">{historyModalCheck.dueDate}</strong></div>
              </div>

              {/* Render Sayadi Barcode if present */}
              {historyModalCheck.sayadiNumber && historyModalCheck.sayadiNumber.trim().length > 0 && (
                <div className="mt-2 p-3 bg-white border border-zinc-200 rounded-xl flex flex-col items-center justify-center">
                  <Barcode 
                    value={historyModalCheck.sayadiNumber.trim()} 
                    format="CODE128" 
                    width={1.4} 
                    height={40} 
                    displayValue={false} 
                    margin={0} 
                    background="#ffffff" 
                    lineColor="#000000" 
                  />
                  <span className="text-[10px] font-mono text-zinc-500 mt-1 dir-ltr tracking-wider">
                    {historyModalCheck.sayadiNumber.trim()}
                  </span>
                </div>
              )}
            </div>

            {/* Chronological Lifecycle Audit Timeline */}
            <div className="space-y-3 pt-2">
              <h4 className="font-bold text-xs text-zinc-700">مراحل عملیاتی و اسناد مالی صادرشده:</h4>
              <div className="space-y-2.5 relative border-r-2 border-emerald-500/30 pr-4">
                {(historyModalCheck.history || []).map((h, i) => (
                  <div key={i} className="relative bg-zinc-50 p-3 rounded-2xl border border-zinc-200 text-xs space-y-1">
                    <span className="absolute -right-6 top-3 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-white"></span>
                    <div className="flex justify-between items-center text-zinc-500 text-[10px]">
                      <span className="font-bold text-zinc-800">{h.state === 'present_in_cashbox' ? 'ثبت در صندوق' : h.state === 'cleared' ? 'وصول چک' : h.state === 'bounced' ? 'برگشت چک' : h.state}</span>
                      <span className="font-mono">{h.date}</span>
                    </div>
                    {h.note && <p className="text-zinc-600 text-[11px]">{h.note}</p>}
                    {h.voucherId && onViewVoucher && (
                      <button
                        onClick={() => {
                          setHistoryModalCheck(null);
                          onViewVoucher(h.voucherId!);
                        }}
                        className="text-[10px] text-emerald-600 hover:underline font-mono flex items-center gap-1 mt-1 cursor-pointer"
                      >
                        <FileText size={12} />
                        <span>مشاهده سند حسابداری (کد: {h.voucherId})</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRINT / PDF MODAL */}
      {showPrintModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden p-6 text-right font-sans dir-rtl max-h-[90vh] overflow-y-auto space-y-6">
            <div className="flex justify-between items-center border-b border-zinc-200 pb-3">
              <div>
                <h2 className="font-bold text-lg text-zinc-800">پیش‌نمایش چاپ / خروجی PDF</h2>
                <p className="text-xs text-zinc-400">گزارش رسمی بانک مرکزی چک‌های دریافتی</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Printer size={16} />
                  <span>تایید و چاپ</span>
                </button>
                <button
                  onClick={() => setShowPrintModal(false)}
                  className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-full cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Printable Area */}
            <div className="p-6 bg-white border border-zinc-200 rounded-2xl space-y-4 print:border-none print:p-0">
              <div className="text-center border-b border-zinc-200 pb-4">
                <h1 className="text-base font-bold text-zinc-900">گزارش رسمی مدیریت اسناد دریافتنی (چک‌های دریافتی)</h1>
                <p className="text-xs text-zinc-500 mt-1">تاریخ تهیه گزارش: {todayJalali}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                <div>تعداد کل نتایج: <strong className="font-mono">{filteredChecks.length} فقره</strong></div>
                <div>مجموع مبلغ کل: <strong className="font-mono">{kpis.totalAmount.toLocaleString()} ریال</strong></div>
              </div>

              <table className="w-full text-right border-collapse text-[11px]">
                <thead>
                  <tr className="bg-zinc-100 text-zinc-800 border-b border-zinc-300 font-bold">
                    <th className="p-2 border border-zinc-300">ردیف</th>
                    <th className="p-2 border border-zinc-300">صادرکننده</th>
                    <th className="p-2 border border-zinc-300">شماره صیادی</th>
                    <th className="p-2 border border-zinc-300">بانک</th>
                    <th className="p-2 border border-zinc-300">سررسید</th>
                    <th className="p-2 border border-zinc-300">مبلغ (ریال)</th>
                    <th className="p-2 border border-zinc-300">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChecks.map((c, i) => (
                    <tr key={c.id} className="border-b border-zinc-200">
                      <td className="p-2 border border-zinc-200 text-center font-mono">{i + 1}</td>
                      <td className="p-2 border border-zinc-200 font-bold">{(state.persons || []).find(p => p.id === c.personId)?.name || 'ناشناس'}</td>
                      <td className="p-2 border border-zinc-200 font-mono text-center">{c.sayadiNumber || '-'}</td>
                      <td className="p-2 border border-zinc-200 text-center">{c.bankName}</td>
                      <td className="p-2 border border-zinc-200 font-mono text-center">{c.dueDate}</td>
                      <td className="p-2 border border-zinc-200 font-mono text-left font-bold">{c.amount.toLocaleString()}</td>
                      <td className="p-2 border border-zinc-200 text-center">{c.currentState}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SELECTED CHECKS ANALYTICS DASHBOARD MODAL */}
      {showSelectedAnalyticsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden space-y-6 p-6 text-right font-sans dir-rtl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <BarChart2 size={20} className="text-emerald-600" />
                <h3 className="font-bold text-zinc-800 text-sm">داشبورد تحلیل چک‌های انتخاب‌شده ({selectedChecksAnalytics.count} فقره)</h3>
              </div>
              <button
                onClick={() => setShowSelectedAnalyticsModal(false)}
                className="p-1 text-zinc-400 hover:text-zinc-600 rounded-full cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-1">
                <span className="text-zinc-500">تعداد کل چک‌ها</span>
                <div className="text-lg font-bold font-mono text-zinc-900">{selectedChecksAnalytics.count} <span className="text-xs font-normal">فقره</span></div>
              </div>

              <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-200 space-y-1">
                <span className="text-emerald-800 font-medium">مجموع مبلغ</span>
                <div className="text-base font-bold font-mono text-emerald-900">{selectedChecksAnalytics.sum.toLocaleString()} <span className="text-[10px] text-zinc-500 font-normal">ریال</span></div>
              </div>

              <div className="bg-sky-50 p-4 rounded-2xl border border-sky-200 space-y-1">
                <span className="text-sky-800 font-medium">میانگین مبلغ چک</span>
                <div className="text-base font-bold font-mono text-sky-900">{selectedChecksAnalytics.avgAmount.toLocaleString()} <span className="text-[10px] text-zinc-500 font-normal">ریال</span></div>
              </div>

              <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-200 space-y-1">
                <span className="text-indigo-800 font-medium">بزرگترین مبلغ چک</span>
                <div className="text-base font-bold font-mono text-indigo-900">{selectedChecksAnalytics.maxAmount.toLocaleString()} <span className="text-[10px] text-zinc-500 font-normal">ریال</span></div>
              </div>

              <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 space-y-1">
                <span className="text-amber-800 font-medium">کوچکترین مبلغ چک</span>
                <div className="text-base font-bold font-mono text-amber-900">{selectedChecksAnalytics.minAmount.toLocaleString()} <span className="text-[10px] text-zinc-500 font-normal">ریال</span></div>
              </div>

              <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-200 space-y-1">
                <span className="text-zinc-600 font-medium">میانگین فاصله تا سررسید</span>
                <div className="text-base font-bold font-mono text-zinc-900">{selectedChecksAnalytics.avgDaysToDueDate} <span className="text-[10px] text-zinc-500 font-normal">روز</span></div>
              </div>

              <div className="bg-sky-50 p-4 rounded-2xl border border-sky-200 space-y-1">
                <span className="text-sky-800 font-medium">نزدیک به سررسید (۰ تا ۷ روز)</span>
                <div className="text-sm font-bold font-mono text-sky-900">{selectedChecksAnalytics.nearDueCount} فقره</div>
                <div className="text-xs font-mono text-sky-700">{selectedChecksAnalytics.nearDueSum.toLocaleString()} ریال</div>
              </div>

              <div className="bg-rose-50 p-4 rounded-2xl border border-rose-200 space-y-1 col-span-2">
                <span className="text-rose-800 font-medium">گذشته از سررسید (معوق)</span>
                <div className="text-sm font-bold font-mono text-rose-900">{selectedChecksAnalytics.overdueCount} فقره</div>
                <div className="text-xs font-mono text-rose-700">{selectedChecksAnalytics.overdueSum.toLocaleString()} ریال</div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-zinc-100">
              <button
                onClick={() => setShowSelectedAnalyticsModal(false)}
                className="bg-zinc-900 hover:bg-zinc-800 text-white px-5 py-2 rounded-xl text-xs font-bold cursor-pointer"
              >
                بستن پنجره
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BULK ACTION MODAL */}
      {bulkModalType && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-zinc-200 overflow-hidden space-y-5 p-6 text-right font-sans dir-rtl">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <Landmark size={20} className="text-emerald-600" />
                <h3 className="font-bold text-zinc-800 text-sm">
                  {bulkModalType === 'deposit' && `واگذاری ${selectedCheckIds.length} فقره چک به بانک`}
                  {bulkModalType === 'endorse' && `واگذاری ${selectedCheckIds.length} فقره چک به شخص ثالث`}
                  {bulkModalType === 'return' && `عودت رسمی ${selectedCheckIds.length} فقره چک`}
                </h3>
              </div>
              <button
                onClick={() => setBulkModalType(null)}
                className="p-1 text-zinc-400 hover:text-zinc-600 rounded-full cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {bulkModalType === 'deposit' && (
                <div>
                  <label className="block text-zinc-700 font-medium mb-1">انتخاب بانک مقصد</label>
                  <select
                    value={bulkTargetBankId}
                    onChange={(e) => setBulkTargetBankId(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:border-emerald-500 font-sans text-xs"
                  >
                    {banksList.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {bulkModalType === 'endorse' && (
                <div>
                  <label className="block text-zinc-700 font-medium mb-1">انتخاب شخص دریافت‌کننده (ثالث)</label>
                  <select
                    value={bulkTargetPersonId}
                    onChange={(e) => setBulkTargetPersonId(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:border-emerald-500 font-sans text-xs"
                  >
                    <option value="">-- انتخاب شخص --</option>
                    {(state.persons || []).map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.phone || p.nationalId || 'بدون مشخصات'})</option>
                    ))}
                  </select>
                </div>
              )}

              {bulkModalType === 'return' && (
                <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-amber-900 text-[11px] leading-relaxed">
                  <strong>توجه:</strong> عودت چک به طرف حساب از طریق ثبت سند معکوس و ابطال/عودت رسمی انجام می‌شود. هیچ حذف فیزیکی رخ نخواهد داد.
                </div>
              )}

              <div>
                <label className="block text-zinc-700 font-medium mb-1">توضیحات / علت عملیات</label>
                <textarea
                  value={bulkNote}
                  onChange={(e) => setBulkNote(e.target.value)}
                  placeholder="توضیحات تکمیلی ثبت در تاریخچه و سند..."
                  rows={3}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-zinc-800 focus:outline-none focus:border-emerald-500 font-sans text-xs resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-100">
              <button
                onClick={() => setBulkModalType(null)}
                className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 px-4 py-2 rounded-xl text-xs font-medium cursor-pointer"
              >
                انصراف
              </button>
              <button
                onClick={handleExecuteBulkModalAction}
                disabled={isProcessingBulk}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-xl text-xs font-bold cursor-pointer shadow-md disabled:opacity-50"
              >
                {isProcessingBulk ? 'در حال پردازش...' : 'تایید و اجرای عملیات'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
