/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  FileText, Users, CreditCard, Landmark, DollarSign, Calculator, 
  Search, Calendar, Filter, ArrowLeft, ArrowUpRight, ArrowDownLeft, TrendingUp, HelpCircle,
  Download, Printer, CheckCircle, FileSpreadsheet, Edit2, Trash2, X, Check as CheckIcon, Plus,
  Clock, PieChart, BarChart2, ShieldCheck, Sparkles, Layers, BookOpen
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { 
  AppState, AccountSubsidiary, Person, Product, JournalVoucher, Check, Invoice 
} from '../types';
import ReceivedChecksCentralReport from './ReceivedChecksCentralReport';
import TrialBalanceReport from './reports/TrialBalanceReport';
import GeneralLedgerReport from './reports/GeneralLedgerReport';
import PersonLedgerReport from './reports/PersonLedgerReport';
import ProfitAndLossReport from './reports/ProfitAndLossReport';
import { DEFAULT_SUBSIDIARIES, calculateProfitAndLoss, calculateDetailedProfitAndLoss, calculateSubsidiaryBalances, calculatePersonBalances } from '../utils/accounting';
import { getCurrentJalaliDate, getJalaliDiffDays } from '../utils/jalali';
import { useCoaReadModel } from '../services/CoaReadService';

interface ReportsViewProps {
  state: AppState;
  currentUserRole?: 'admin' | 'agent';
  onEditCheck?: (check: Check) => void;
  onDeleteCheck?: (checkId: string) => void;
  onApproveCheck?: (checkId: string) => void;
  onViewVoucher?: (voucherId: string) => void;
  onViewCheck?: (checkId: string) => void;
  onNewVoucher?: (type: 'manual' | 'automatic') => void;
  onEditVoucher?: (voucher: JournalVoucher) => void;
  onDeleteVoucher?: (voucher: JournalVoucher) => void;
  onOpenAdvancedSearch?: () => void;
  onUpdateCheckState?: any;
  onBulkUpdateCheckState?: any;
}

type ReportType = 'none' | 'person_ledger' | 'received_checks' | 'paid_checks' | 'general_subsidiary_ledger' | 'cash_bank_ledger' | 'pnl_dual' | 'best_selling_products' | 'top_customers' | 'debtors_list' | 'bounced_checks' | 'gross_profit_per_purchase' | 'trial_balance' | 'installment_aging' | 'unearned_interest' | 'installment_portfolio' | 'general_journal';

export default function ReportsView({ 
  state, 
  currentUserRole = 'admin', 
  onEditCheck, 
  onDeleteCheck, 
  onApproveCheck,
  onViewVoucher,
  onNewVoucher,
  onEditVoucher,
  onDeleteVoucher,
  onOpenAdvancedSearch,
  onViewCheck,
  onUpdateCheckState,
  onBulkUpdateCheckState
}: ReportsViewProps) {
  const { subsidiaries: activeSubsidiaries } = useCoaReadModel(state.subsidiaries);
  const [selectedReport, setSelectedReport] = useState<ReportType>('none');
  const [isFilterSubmitted, setIsFilterSubmitted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Common Filters
  const [startDate, setStartDate] = useState('1405/01/01');
  const [endDate, setEndDate] = useState('1405/12/29');

  // Specific Filters
  const [filterPersonId, setFilterPersonId] = useState('');
  const [filterCheckStatus, setFilterCheckStatus] = useState('');
  const [filterCheckMinAmount, setFilterCheckMinAmount] = useState<number>(0);
  const [filterMinAmount, setFilterMinAmount] = useState<number>(0);
  const [filterMaxAmount, setFilterMaxAmount] = useState<number>(0);
  const [filterSubId, setFilterSubId] = useState('');
  const [pnlMethod, setPnlMethod] = useState<'fifo' | 'average' | 'serial'>('average');

  // Trial Balance State
  const [trialBalanceType, setTrialBalanceType] = useState<'4_column' | '6_column' | '8_column'>('8_column');
  const [trialBalanceLevel, setTrialBalanceLevel] = useState<'general' | 'subsidiary' | 'detailed'>('subsidiary');

  // Check Editing state inside Reports
  const [editingCheck, setEditingCheck] = useState<Check | null>(null);
  const [editBankName, setEditBankName] = useState('');
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editCheckNumber, setEditCheckNumber] = useState('');
  const [editSayadiNumber, setEditSayadiNumber] = useState('');
  const [editNationalId, setEditNationalId] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editPersonId, setEditPersonId] = useState('');

  const handleResetFilters = () => {
    setIsFilterSubmitted(false);
    setFilterPersonId('');
    setFilterCheckStatus('');
    setFilterCheckMinAmount(0);
    setFilterMinAmount(0);
    setFilterMaxAmount(0);
    setFilterSubId('');
    setTrialBalanceType('4_column');
    setTrialBalanceLevel('subsidiary');
    setSearchQuery('');
  };

  // 2. RECEIVED CHECKS COMPILER
  const receivedChecksResult = useMemo(() => {
    if (selectedReport !== 'received_checks' || !isFilterSubmitted) return null;

    return state.checks.filter(c => {
      if (c.type !== 'received') return false;
      if (c.dueDate < startDate || c.dueDate > endDate) return false;
      if (filterCheckStatus && c.currentState !== filterCheckStatus) return false;
      if (filterCheckMinAmount > 0 && c.amount < filterCheckMinAmount) return false;
      if (filterPersonId && c.personId !== filterPersonId) return false;
      return true;
    });
  }, [selectedReport, isFilterSubmitted, state.checks, startDate, endDate, filterCheckStatus, filterCheckMinAmount, filterPersonId]);

  // 3. PAID CHECKS COMPILER
  const paidChecksResult = useMemo(() => {
    if (selectedReport !== 'paid_checks' || !isFilterSubmitted) return null;

    return state.checks.filter(c => {
      if (c.type !== 'paid') return false;
      if (c.dueDate < startDate || c.dueDate > endDate) return false;
      if (filterCheckStatus && c.currentState !== filterCheckStatus) return false;
      if (filterCheckMinAmount > 0 && c.amount < filterCheckMinAmount) return false;
      if (filterPersonId && c.personId !== filterPersonId) return false;
      return true;
    });
  }, [selectedReport, isFilterSubmitted, state.checks, startDate, endDate, filterCheckStatus, filterCheckMinAmount, filterPersonId]);

  // 7. DEBTORS LIST COMPILER
  const debtorsListResult = useMemo(() => {
    if (selectedReport !== 'debtors_list' || !isFilterSubmitted) return null;

    const personBalances = calculatePersonBalances(state.vouchers);
    const normalBalances = calculatePersonBalances(state.vouchers, undefined, 'SUB_DEBTORS');
    const installmentBalances = calculatePersonBalances(state.vouchers, undefined, 'SUB_DEBTORS_INSTALLMENT');
    
    // Convert to array and filter for those who have a balance, and sort by debt amount (debit > credit)
    const debtors = Object.entries(personBalances)
      .map(([id, bal]) => ({ id, ...bal }))
      .filter(b => b.nature === 'بدهکار')
      .sort((a, b) => b.net - a.net);

    return debtors.map(d => ({
      person: state.persons.find(p => p.id === d.id),
      net: d.net,
      normalNet: normalBalances[d.id]?.nature === 'بدهکار' ? normalBalances[d.id].net : 0,
      installmentNet: installmentBalances[d.id]?.nature === 'بدهکار' ? installmentBalances[d.id].net : 0
    })).filter(d => !!d.person);
  }, [selectedReport, isFilterSubmitted, state]);

  // 8. BEST SELLING PRODUCTS COMPILER
  const bestSellingProductsResult = useMemo(() => {
    if (selectedReport !== 'best_selling_products' || !isFilterSubmitted) return null;

    const productSales: { [productId: string]: number } = {};

    state.vouchers.forEach(v => {
      if (v.date >= startDate && v.date <= endDate && v.sourceType === 'sell_invoice') {
        const invoice = state.invoices.find(inv => inv.id === v.sourceId);
        if (invoice) {
          invoice.items.forEach(item => {
            productSales[item.productId] = (productSales[item.productId] || 0) + item.quantity;
          });
        }
      }
    });

    return Object.entries(productSales)
      .map(([productId, totalQuantity]) => ({
        product: state.products.find(p => p.id === productId),
        totalQuantity
      }))
      .filter(item => item.product)
      .sort((a, b) => b.totalQuantity - a.totalQuantity);
  }, [selectedReport, isFilterSubmitted, state.vouchers, state.invoices, state.products, startDate, endDate]);

  // 10. INSTALLMENT AGING COMPILER
  const installmentAgingResult = useMemo(() => {
    if (selectedReport !== 'installment_aging' || !isFilterSubmitted) return null;

    const today = endDate; // We age as of end date
    const aging = {
      notDue: 0,
      overdue1_30: 0,
      overdue31_60: 0,
      overdue61_90: 0,
      overdue90Plus: 0,
      total: 0,
      details: [] as any[]
    };

    state.installments.forEach(inst => {
      if (inst.status === 'paid') return;
      const remaining = inst.amount - inst.paidAmount;
      if (remaining <= 0) return;

      const diff = getJalaliDiffDays(today, inst.dueDate);
      const book = state.installmentBooks.find(b => b.id === inst.bookId);
      const person = state.persons.find(p => p.id === book?.personId);

      const detail = {
        personName: person?.name || 'ناشناس',
        dueDate: inst.dueDate,
        amount: remaining,
        delayDays: diff > 0 ? diff : 0,
        installmentNumber: inst.installmentNumber
      };

      if (diff <= 0) {
        aging.notDue += remaining;
      } else if (diff <= 30) {
        aging.overdue1_30 += remaining;
      } else if (diff <= 60) {
        aging.overdue31_60 += remaining;
      } else if (diff <= 90) {
        aging.overdue61_90 += remaining;
      } else {
        aging.overdue90Plus += remaining;
      }

      if (diff > 0) {
        aging.details.push(detail);
      }
      aging.total += remaining;
    });

    aging.details.sort((a, b) => b.delayDays - a.delayDays);
    return aging;
  }, [selectedReport, isFilterSubmitted, state.installments, state.installmentBooks, state.persons, endDate]);

  // 11. UNEARNED INTEREST COMPILER
  const unearnedInterestResult = useMemo(() => {
    if (selectedReport !== 'unearned_interest' || !isFilterSubmitted) return null;

    let totalInterest = 0;
    let earnedInterest = 0;
    let unearnedInterest = 0;

    state.installmentBooks.forEach(book => {
      totalInterest += book.totalInterest;
      
      const installments = state.installments.filter(i => i.bookId === book.id);
      installments.forEach(inst => {
        if (inst.status === 'paid') {
          earnedInterest += inst.interestPart;
        } else if (inst.status === 'partially_paid') {
            const ratio = inst.paidAmount / inst.amount;
            earnedInterest += inst.interestPart * ratio;
            unearnedInterest += inst.interestPart * (1 - ratio);
        } else {
          unearnedInterest += inst.interestPart;
        }
      });
    });

    return {
      totalInterest,
      earnedInterest,
      unearnedInterest,
      ratio: totalInterest > 0 ? (earnedInterest / totalInterest) * 100 : 0
    };
  }, [selectedReport, isFilterSubmitted, state.installmentBooks, state.installments]);

  // 12. INSTALLMENT PORTFOLIO COMPILER
  const installmentPortfolioResult = useMemo(() => {
    if (selectedReport !== 'installment_portfolio' || !isFilterSubmitted) return null;

    const portfolio = state.installmentBooks.map(book => {
      const person = state.persons.find(p => p.id === book.personId);
      const installments = state.installments.filter(i => i.bookId === book.id);
      
      const paidAmount = installments.reduce((sum, inst) => sum + inst.paidAmount, 0);
      const totalAmount = book.totalAmount;
      const remainingAmount = totalAmount - paidAmount;
      
      const overdueCount = installments.filter(i => i.status === 'overdue' || (i.status === 'partially_paid' && i.dueDate < endDate)).length;
      
      return {
        book,
        person,
        paidAmount,
        remainingAmount,
        overdueCount,
        progress: (paidAmount / totalAmount) * 100
      };
    });

    const totals = {
      totalBooks: portfolio.length,
      totalPrincipal: state.installmentBooks.reduce((sum, b) => sum + b.totalPrincipal, 0),
      totalInterest: state.installmentBooks.reduce((sum, b) => sum + b.totalInterest, 0),
      totalOutstanding: portfolio.reduce((sum, p) => sum + p.remainingAmount, 0),
      activeBooks: state.installmentBooks.filter(b => b.status === 'active').length
    };

    return { portfolio, totals };
  }, [selectedReport, isFilterSubmitted, state.installmentBooks, state.installments, state.persons, endDate]);

  // GENERAL JOURNAL COMPILER
  const generalJournalResult = useMemo(() => {
    if (selectedReport !== 'general_journal' || !isFilterSubmitted) return null;

    let filteredVouchers = [...state.vouchers];
    filteredVouchers.sort((a, b) => a.date.localeCompare(b.date));

    // Filter by date
    if (startDate) {
      filteredVouchers = filteredVouchers.filter(v => v.date >= startDate);
    }
    if (endDate) {
      filteredVouchers = filteredVouchers.filter(v => v.date <= endDate);
    }

    // Filter by amount
    if (filterMinAmount > 0) {
      filteredVouchers = filteredVouchers.filter(v => {
        const totalAmount = v.entries.reduce((sum, e) => sum + e.debit, 0);
        return totalAmount >= filterMinAmount;
      });
    }
    if (filterMaxAmount > 0) {
      filteredVouchers = filteredVouchers.filter(v => {
        const totalAmount = v.entries.reduce((sum, e) => sum + e.debit, 0);
        return totalAmount <= filterMaxAmount;
      });
    }

    // Search Query
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      filteredVouchers = filteredVouchers.filter(v => {
        return (
          v.voucherNumber.toString().includes(query) ||
          v.description.toLowerCase().includes(query) ||
          v.entries.some(e => e.description && e.description.toLowerCase().includes(query))
        );
      });
    }

    let totalDebit = 0;
    let totalCredit = 0;

    filteredVouchers.forEach(v => {
      v.entries.forEach(e => {
        totalDebit += e.debit;
        totalCredit += e.credit;
      });
    });

    return {
      vouchers: filteredVouchers,
      totalDebit,
      totalCredit
    };
  }, [selectedReport, isFilterSubmitted, state.vouchers, startDate, endDate, filterMinAmount, filterMaxAmount, searchQuery]);

  const renderFilterForm = () => {
    return (
      <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-4">
        <div className="flex items-center space-x-2 space-x-reverse text-emerald-600 mb-2">
          <Filter size={16} />
          <span className="font-sans text-xs font-bold">فیلترهای گزارش سفارشی</span>
        </div>

        {/* Date Ranges */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-zinc-500 text-right mb-1">تاریخ شروع (شمس)</label>
            <input
              type="text"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center"
              placeholder="1405/01/01"
            />
          </div>
          <div>
            <label className="block text-[10px] text-zinc-500 text-right mb-1">تاریخ پایان (شمس)</label>
            <input
              type="text"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center"
              placeholder="1405/12/29"
            />
          </div>
        </div>

        {/* Specialized Installment Reports Notice */}
        {(selectedReport === 'installment_aging' || selectedReport === 'installment_portfolio' || selectedReport === 'unearned_interest') && (
          <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 text-right">
            <p className="text-[10px] text-indigo-700 font-sans leading-relaxed">
              این گزارش تخصصی بر اساس وضعیت دفترچه‌ها و اقساط تا تاریخ <strong>{endDate}</strong> محاسبه می‌گردد.
            </p>
          </div>
        )}

        {selectedReport === 'general_journal' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-zinc-500 text-right mb-1">حداقل مبلغ سند (ریال)</label>
              <input
                type="number"
                inputMode="decimal"
                value={filterMinAmount || ''}
                onChange={(e) => setFilterMinAmount(Number(e.target.value))}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-left"
                placeholder="بدون محدودیت"
              />
            </div>
            <div>
              <label className="block text-[10px] text-zinc-500 text-right mb-1">حداکثر مبلغ سند (ریال)</label>
              <input
                type="number"
                inputMode="decimal"
                value={filterMaxAmount || ''}
                onChange={(e) => setFilterMaxAmount(Number(e.target.value))}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-left"
                placeholder="بدون محدودیت"
              />
            </div>
          </div>
        )}

        {/* Report-specific inputs */}
        {selectedReport === 'person_ledger' && (
          <div>
            <label className="block text-[10px] text-zinc-500 text-right mb-1">انتخاب شخص (طرف حساب)</label>
            <select
              value={filterPersonId}
              onChange={(e) => setFilterPersonId(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right"
            >
              <option value="">انتخاب کنید...</option>
              {state.persons.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
          </div>
        )}

        {(selectedReport === 'received_checks' || selectedReport === 'paid_checks') && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-zinc-500 text-right mb-1">حداقل مبلغ چک (ریال)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={filterCheckMinAmount || ''}
                  onChange={(e) => setFilterCheckMinAmount(parseInt(e.target.value) || 0)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center"
                  placeholder="مثال: 1,000,000"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 text-right mb-1">وضعیت چک</label>
                <select
                  value={filterCheckStatus}
                  onChange={(e) => setFilterCheckStatus(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right"
                >
                  <option value="">همه وضعیت‌ها</option>
                  {selectedReport === 'received_checks' ? (
                    <>
                      <option value="present_in_cashbox">موجود در صندوق</option>
                      <option value="deposited_to_bank">واگذار به بانک</option>
                      <option value="cleared">وصول شده</option>
                      <option value="passed_to_others">خرج شده</option>
                      <option value="bounced">برگشتی</option>
                    </>
                  ) : (
                    <>
                      <option value="issued">صادر شده</option>
                      <option value="cleared">پاس شده</option>
                      <option value="bounced">برگشتی</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-zinc-500 text-right mb-1">فیلتر طرف حساب چک (اختیاری)</label>
              <select
                value={filterPersonId}
                onChange={(e) => setFilterPersonId(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right"
              >
                <option value="">همه اشخاص</option>
                {state.persons.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {(selectedReport === 'general_subsidiary_ledger' || selectedReport === 'cash_bank_ledger') && (
          <div>
            <label className="block text-[10px] text-zinc-500 text-right mb-1">حساب معین مقصد</label>
            <select
              value={filterSubId}
              onChange={(e) => setFilterSubId(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right"
            >
              <option value="">{selectedReport === 'cash_bank_ledger' ? 'همه صندوق‌ها و بانک‌ها' : 'انتخاب حساب معین...'}</option>
              {activeSubsidiaries
                .filter(s => selectedReport !== 'cash_bank_ledger' || s.generalType === 'صندوق‌ها' || s.generalType === 'بانک‌ها')
                .map(sub => (
                  <option key={sub.id} value={sub.id}>({sub.code}) - {sub.name}</option>
                ))
              }
            </select>
          </div>
        )}

        {selectedReport === 'pnl_dual' && (
          <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-100/60 space-y-2">
            <span className="block text-[11px] font-bold text-zinc-700 text-right flex items-center justify-end space-x-1 space-x-reverse">
              <span>کانال محاسباتی سود و زیان را انتخاب کنید</span>
              <HelpCircle size={12} className="text-emerald-600" />
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPnlMethod('average')}
                className={`py-2 px-1 rounded-lg font-sans text-[10px] font-bold text-center transition ${
                  pnlMethod === 'average' 
                    ? 'bg-emerald-600 text-white shadow-sm font-extrabold' 
                    : 'bg-white text-zinc-600 border border-zinc-200'
                }`}
              >
                میانگین موزون
              </button>
              <button
                type="button"
                onClick={() => setPnlMethod('fifo')}
                className={`py-2 px-1 rounded-lg font-sans text-[10px] font-bold text-center transition ${
                  pnlMethod === 'fifo' 
                    ? 'bg-emerald-600 text-white shadow-sm font-extrabold' 
                    : 'bg-white text-zinc-600 border border-zinc-200'
                }`}
              >
                اولین صادره (FIFO)
              </button>
              <button
                type="button"
                onClick={() => setPnlMethod('serial')}
                className={`py-2 px-1 rounded-lg font-sans text-[10px] font-bold text-center transition ${
                  pnlMethod === 'serial' 
                    ? 'bg-emerald-600 text-white shadow-sm font-extrabold' 
                    : 'bg-white text-zinc-600 border border-zinc-200'
                }`}
              >
                رهگیری سریال/IMEI
              </button>
            </div>
            <p className="font-sans text-[9px] text-zinc-500 text-right leading-relaxed mt-1">
              {pnlMethod === 'average' && 'در این روش سود بر اساس کل خریدهای تاریخی کالا و میانگین قیمت تمام‌شده موزون حساب می‌شود.'}
              {pnlMethod === 'fifo' && 'در این روش سود بر اساس ترتیب دقیق خریدها محاسبه شده و خریدهای قدیمی‌تر ابتدا تمام می‌شوند.'}
              {pnlMethod === 'serial' && 'ویژه موبایل: محاسبه سود دقیق بر اساس ردیابی شماره سریال (IMEI) فاکتور فروش در مقابل فاکتور خرید.'}
            </p>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={() => {
            if (selectedReport === 'person_ledger' && !filterPersonId) {
              alert("لطفاً طرف حساب را انتخاب کنید.");
              return;
            }
            if (selectedReport === 'general_subsidiary_ledger' && !filterSubId) {
              alert("لطفاً حساب معین مورد نظر را انتخاب کنید.");
              return;
            }
            setIsFilterSubmitted(true);
          }}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-sans text-xs font-bold py-3 rounded-xl shadow transition flex items-center justify-center space-x-1.5 space-x-reverse"
        >
          <Search size={15} />
          <span>تهیه و بارگذاری گزارش</span>
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 pb-20">
      {/* Subheader */}
      <div className="bg-white border-b border-zinc-100 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        {selectedReport !== 'none' ? (
          <button 
            onClick={() => { setSelectedReport('none'); handleResetFilters(); }} 
            className="text-zinc-500 hover:text-zinc-800 p-1"
          >
            <ArrowLeft size={18} />
          </button>
        ) : (
          <div className="w-6" />
        )}
        <span className="font-sans text-sm font-bold text-zinc-800">
          {selectedReport === 'none' ? 'گزارش‌های پیشرفته حسابداری' : 'مشاهده گزارش'}
        </span>
        <div className="w-6" />
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        {/* REPORT SELECTOR MENU */}
        {selectedReport === 'none' && (
          <div className="grid grid-cols-1 gap-3">
            {/* General Journal */}
            <button
              onClick={() => setSelectedReport('general_journal')}
              className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
            >
              <BookOpen className="text-emerald-500 shrink-0" size={20} />
              <div className="mr-3 flex-1">
                <strong className="block text-xs font-bold text-zinc-800">دفتر روزنامه (اسناد حسابداری)</strong>
                <span className="block text-[10px] text-zinc-400 mt-0.5">مشاهده و جستجوی جامع اسناد حسابداری بر اساس تاریخ و مبلغ</span>
              </div>
            </button>
            {/* 1. Person ledger */}
            <button
              onClick={() => setSelectedReport('person_ledger')}
              className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
            >
              <Users className="text-emerald-500 shrink-0" size={20} />
              <div className="mr-3 flex-1">
                <strong className="block text-xs font-bold text-zinc-800">ریز حساب بدهکاران و بستانکاران</strong>
                <span className="block text-[10px] text-zinc-400 mt-0.5">مشاهده ماهیت حساب، تراکنش‌ها و مانده اشخاص</span>
              </div>
            </button>

            {/* 3. Paid checks */}
            <button
              onClick={() => setSelectedReport('paid_checks')}
              className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
            >
              <ArrowUpRight className="text-amber-500 shrink-0" size={20} />
              <div className="mr-3 flex-1">
                <strong className="block text-xs font-bold text-zinc-800">دفتر چک‌های پرداختی (صادره)</strong>
                <span className="block text-[10px] text-zinc-400 mt-0.5">کنترل سررسید و پاس شدن چک‌های پرداختی</span>
              </div>
            </button>

            {/* 4. General / Subsidiary ledger */}
            <button
              onClick={() => setSelectedReport('general_subsidiary_ledger')}
              className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
            >
              <FileText className="text-emerald-500 shrink-0" size={20} />
              <div className="mr-3 flex-1">
                <strong className="block text-xs font-bold text-zinc-800">گزارش دفاتر کل و معین</strong>
                <span className="block text-[10px] text-zinc-400 mt-0.5">کنترل دقیق گردش حساب‌های دارایی، بدهی و هزینه‌ها</span>
              </div>
            </button>

            {/* 5. Cash / Bank ledger */}
            <button
              onClick={() => setSelectedReport('cash_bank_ledger')}
              className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
            >
              <Landmark className="text-emerald-500 shrink-0" size={20} />
              <div className="mr-3 flex-1">
                <strong className="block text-xs font-bold text-zinc-800">گزارش ریز بانک‌ها و صندوق‌ها</strong>
                <span className="block text-[10px] text-zinc-400 mt-0.5">ردیف مالی مجزای بانک‌ها و صندوق صندوق‌ها</span>
              </div>
            </button>

            {/* 6. PNL Dual */}
            <button
              onClick={() => setSelectedReport('pnl_dual')}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white p-4 rounded-2xl text-right font-sans transition-all shadow-md flex items-center justify-between"
            >
              <TrendingUp className="text-white shrink-0" size={20} />
              <div className="mr-3 flex-1">
                <strong className="block text-xs font-bold text-white">گزارش سود و زیان (دوکاناله)</strong>
                <span className="block text-[10px] text-emerald-100 mt-0.5">محاسبه آنی سود فاکتورها به روش FIFO یا میانگین</span>
              </div>
            </button>
            
            {/* 7. Best selling */}
            <button
              onClick={() => setSelectedReport('best_selling_products')}
              className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
            >
              <TrendingUp className="text-blue-500 shrink-0" size={20} />
              <div className="mr-3 flex-1">
                <strong className="block text-xs font-bold text-zinc-800">کالاهای پرفروش</strong>
                <span className="block text-[10px] text-zinc-400 mt-0.5">لیست کالاهای پرگردش بر اساس تعداد فروش</span>
              </div>
            </button>

            {/* 8. Top customers */}
            <button
              onClick={() => setSelectedReport('top_customers')}
              className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
            >
              <Users className="text-purple-500 shrink-0" size={20} />
              <div className="mr-3 flex-1">
                <strong className="block text-xs font-bold text-zinc-800">مشتریان وفادار</strong>
                <span className="block text-[10px] text-zinc-400 mt-0.5">لیست مشتریان با بیشترین حجم خرید</span>
              </div>
            </button>

            {/* 9. Debtors list */}
            <button
              onClick={() => setSelectedReport('debtors_list')}
              className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
            >
              <DollarSign className="text-rose-500 shrink-0" size={20} />
              <div className="mr-3 flex-1">
                <strong className="block text-xs font-bold text-zinc-800">لیست بدهکاران (سنوات)</strong>
                <span className="block text-[10px] text-zinc-400 mt-0.5">رتبه‌بندی بدهکاران و مانده حساب‌ها</span>
              </div>
            </button>

            {/* 10. Dynamic Trial Balance */}
            <button
              onClick={() => setSelectedReport('trial_balance')}
              className="bg-white border border-zinc-150 hover:border-emerald-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
            >
              <Calculator className="text-teal-600 shrink-0" size={20} />
              <div className="mr-3 flex-1">
                <strong className="block text-xs font-bold text-zinc-800">تراز آزمایشی پویا</strong>
                <span className="block text-[10px] text-zinc-400 mt-0.5">تراز آزمایشی ۴ و ۶ ستونی در سطوح کل، معین و تفصیلی</span>
              </div>
            </button>

            {/* Specialized Installment Reports Section */}
            <div className="pt-6 pb-2">
              <div className="flex items-center gap-2 mb-4 justify-end">
                <div className="h-px bg-zinc-200 flex-1" />
                <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider text-right whitespace-nowrap">گزارشات تخصصی فروش اقساطی</h3>
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => setSelectedReport('installment_aging')}
                  className="bg-white border border-zinc-150 hover:border-indigo-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
                >
                  <Clock className="text-indigo-500 shrink-0" size={20} />
                  <div className="mr-3 flex-1">
                    <strong className="block text-xs font-bold text-zinc-800">گزارش سن بدهی اقساط</strong>
                    <span className="block text-[10px] text-zinc-400 mt-0.5">تحلیل اقساط معوق بر اساس بازه‌های زمانی (۱-۳۰، ۳۱-۶۰ و ...)</span>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedReport('unearned_interest')}
                  className="bg-white border border-zinc-150 hover:border-indigo-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
                >
                  <Sparkles className="text-amber-500 shrink-0" size={20} />
                  <div className="mr-3 flex-1">
                    <strong className="block text-xs font-bold text-zinc-800">تحلیل سود تحقق‌نیافته</strong>
                    <span className="block text-[10px] text-zinc-400 mt-0.5">تفکیک سودهای دریافت شده از سودهای آتی (Deferred Income)</span>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedReport('installment_portfolio')}
                  className="bg-white border border-zinc-150 hover:border-indigo-500/40 p-4 rounded-2xl text-right font-sans transition-all shadow-sm active:bg-zinc-50 flex items-center justify-between"
                >
                  <Layers className="text-indigo-500 shrink-0" size={20} />
                  <div className="mr-3 flex-1">
                    <strong className="block text-xs font-bold text-zinc-800">کیفیت پرتفوی اقساط</strong>
                    <span className="block text-[10px] text-zinc-400 mt-0.5">خلاصه وضعیت کل دفترچه‌ها، مانده اصل و سود و ریسک معوقات</span>
                  </div>
                </button>
              </div>
            </div>

          </div>
        )}

        {/* RECEIVED CHECKS CENTRAL REPORT VIEW */}
        {selectedReport === 'received_checks' && (
          <ReceivedChecksCentralReport
            state={state}
            onViewVoucher={onViewVoucher}
            onViewCheck={onViewCheck}
            onEditCheck={onEditCheck}
            onDeleteCheck={onDeleteCheck}
            onApproveCheck={onApproveCheck}
            currentUserRole={currentUserRole}
            onUpdateCheckState={onUpdateCheckState}
            onBulkUpdateCheckState={onBulkUpdateCheckState}
          />
        )}

        {/* FILTER FORM DISPLAY */}
        {selectedReport !== 'none' && selectedReport !== 'received_checks' && !isFilterSubmitted && renderFilterForm()}

        {/* RESULTS SCREEN */}
        {selectedReport !== 'none' && selectedReport !== 'received_checks' && isFilterSubmitted && (
          <div className="space-y-4">
            {/* Filter Metadata strip */}
            <div className="bg-zinc-100 px-3.5 py-2.5 rounded-xl flex items-center justify-between text-right font-sans text-[10px] text-zinc-500">
              <button 
                onClick={() => setIsFilterSubmitted(false)}
                className="text-emerald-600 hover:text-emerald-500 font-bold"
              >
                تغییر فیلترها
              </button>
              <span>دوره گزارش: <strong>{startDate}</strong> تا <strong>{endDate}</strong></span>
            </div>

            {/* General Journal Render */}
            {selectedReport === 'general_journal' && (
              <GeneralLedgerReport
                selectedReport="general_journal"
                state={state}
                startDate={startDate}
                endDate={endDate}
                isFilterSubmitted={isFilterSubmitted}
                filterSubId={filterSubId}
                filterMinAmount={filterMinAmount}
                filterMaxAmount={filterMaxAmount}
                onViewVoucher={onViewVoucher}
                onViewCheck={onViewCheck}
                onNewVoucher={onNewVoucher}
                onEditVoucher={onEditVoucher}
                onDeleteVoucher={onDeleteVoucher}
                onOpenAdvancedSearch={onOpenAdvancedSearch}
              />
            )}

            {/* A. Person Ledger Render */}
            {selectedReport === 'person_ledger' && (
              <PersonLedgerReport
                state={state}
                startDate={startDate}
                endDate={endDate}
                isFilterSubmitted={isFilterSubmitted}
                filterPersonId={filterPersonId}
                currentUserRole={currentUserRole}
                onNewVoucher={onNewVoucher}
                onEditVoucher={onEditVoucher}
                onDeleteVoucher={onDeleteVoucher}
                onViewVoucher={onViewVoucher}
                onViewCheck={onViewCheck}
                onApproveCheck={onApproveCheck}
                onEditCheck={onEditCheck}
                onDeleteCheck={onDeleteCheck}
                setEditingCheck={setEditingCheck}
                setEditBankName={setEditBankName}
                setEditAmount={setEditAmount}
                setEditCheckNumber={setEditCheckNumber}
                setEditSayadiNumber={setEditSayadiNumber}
                setEditNationalId={setEditNationalId}
                setEditDueDate={setEditDueDate}
                setEditPersonId={setEditPersonId}
              />
            )}

            {/* C. Paid Checks Render */}
            {selectedReport === 'paid_checks' && paidChecksResult && (
              <div className="space-y-3">
                <span className="block text-right font-sans text-xs text-zinc-500">تعداد چک‌های منطبق: {paidChecksResult.length} فقره</span>
                {paidChecksResult.map(c => {
                  const person = state.persons.find(p => p.id === c.personId);
                  return (
                    <div key={c.id} className="bg-white p-3.5 rounded-xl border border-zinc-150 text-right space-y-2 font-sans text-xs">
                      <div className="flex justify-between">
                        <span className="font-mono text-amber-600 font-bold">{c.amount.toLocaleString()} ریال</span>
                        <span className="font-bold text-zinc-800">بانک {c.bankName}</span>
                      </div>
                      <div className="text-zinc-500 text-[10px] flex justify-between items-center pt-1 border-t border-zinc-100">
                        <span>سررسید: {c.dueDate}</span>
                        <span>صیادی: {c.checkNumber}</span>
                      </div>
                      <div className="text-zinc-500 text-[10px] flex justify-between items-center pt-1">
                        <span className="bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">{c.currentState === 'cleared' ? 'پاس شده' : 'صادر شده'}</span>
                        <span>همکار: <strong>{person?.name || 'ناشناس'}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* D. General Subsidiary Ledger Render */}
            {selectedReport === 'general_subsidiary_ledger' && (
              <GeneralLedgerReport
                selectedReport="general_subsidiary_ledger"
                state={state}
                startDate={startDate}
                endDate={endDate}
                isFilterSubmitted={isFilterSubmitted}
                filterSubId={filterSubId}
                filterMinAmount={filterMinAmount}
                filterMaxAmount={filterMaxAmount}
                onViewVoucher={onViewVoucher}
                onViewCheck={onViewCheck}
                onNewVoucher={onNewVoucher}
                onEditVoucher={onEditVoucher}
                onDeleteVoucher={onDeleteVoucher}
              />
            )}

            {/* E. Cash Bank Ledger Render */}
            {selectedReport === 'cash_bank_ledger' && (
              <GeneralLedgerReport
                selectedReport="cash_bank_ledger"
                state={state}
                startDate={startDate}
                endDate={endDate}
                isFilterSubmitted={isFilterSubmitted}
                filterSubId={filterSubId}
                filterMinAmount={filterMinAmount}
                filterMaxAmount={filterMaxAmount}
                onViewVoucher={onViewVoucher}
                onViewCheck={onViewCheck}
                onNewVoucher={onNewVoucher}
                onEditVoucher={onEditVoucher}
                onDeleteVoucher={onDeleteVoucher}
              />
            )}

            {/* F. Dual Channel PNL Render */}
            {selectedReport === 'pnl_dual' && (
              <ProfitAndLossReport
                state={state}
                startDate={startDate}
                endDate={endDate}
                isFilterSubmitted={isFilterSubmitted}
                pnlMethod={pnlMethod}
              />
            )}

            {/* G. Debtors List Render */}
            {selectedReport === 'debtors_list' && debtorsListResult && (
              <div className="space-y-3">
                <span className="block text-right font-sans text-xs text-zinc-500">تعداد بدهکاران شناسایی‌شده: {debtorsListResult.length} نفر</span>
                {debtorsListResult.map((d, idx) => (
                  <div key={idx} className="bg-white p-3.5 rounded-xl border border-zinc-150 text-right space-y-2 font-sans text-xs flex flex-col justify-between shadow-sm">
                    <div className="flex justify-between items-center w-full">
                      <span className="font-mono text-rose-600 font-bold">{d.net.toLocaleString()} ریال</span>
                      <strong className="font-bold text-zinc-800">{d.person?.name}</strong>
                    </div>
                    {(d.normalNet > 0 || d.installmentNet > 0) && (
                      <div className="grid grid-cols-2 gap-2 text-[9px] text-zinc-400 font-sans border-t border-zinc-100 pt-1.5 mt-1.5 text-center">
                        <div>
                          <span>بدهی عادی: </span>
                          <strong className="font-mono text-zinc-600">{d.normalNet.toLocaleString()} ریال</strong>
                        </div>
                        <div>
                          <span>بدهی اقساطی: </span>
                          <strong className="font-mono text-indigo-600">{d.installmentNet.toLocaleString()} ریال</strong>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* H. Best Selling Products Render */}
            {selectedReport === 'best_selling_products' && bestSellingProductsResult && (
              <div className="space-y-3">
                <span className="block text-right font-sans text-xs text-zinc-500">تعداد کالاهای فروخته شده: {bestSellingProductsResult.length} قلم</span>
                {bestSellingProductsResult.map((item, idx) => (
                  <div key={idx} className="bg-white p-3.5 rounded-xl border border-zinc-150 text-right space-y-2 font-sans text-xs flex justify-between items-center">
                    <span className="font-mono text-emerald-600 font-bold">{item.totalQuantity.toLocaleString()}</span>
                    <strong className="font-bold text-zinc-800">{item.product?.name}</strong>
                  </div>
                ))}
              </div>
            )}

            {/* I. Dynamic Trial Balance Render */}
            {selectedReport === 'trial_balance' && (
              <TrialBalanceReport
                state={state}
                startDate={startDate}
                endDate={endDate}
                isFilterSubmitted={isFilterSubmitted}
                trialBalanceType={trialBalanceType}
                setTrialBalanceType={setTrialBalanceType}
                trialBalanceLevel={trialBalanceLevel}
                setTrialBalanceLevel={setTrialBalanceLevel}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
              />
            )}

            {selectedReport === 'installment_aging' && installmentAgingResult && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="bg-white p-3 rounded-2xl border border-zinc-150 shadow-sm text-center">
                    <span className="block text-[10px] text-zinc-400 mb-1">سررسید نشده</span>
                    <span className="block text-xs font-bold text-zinc-800">{installmentAgingResult.notDue.toLocaleString()}</span>
                  </div>
                  <div className="bg-amber-50 p-3 rounded-2xl border border-amber-100 shadow-sm text-center">
                    <span className="block text-[10px] text-amber-600 mb-1">۱-۳۰ روز معوق</span>
                    <span className="block text-xs font-bold text-amber-700">{installmentAgingResult.overdue1_30.toLocaleString()}</span>
                  </div>
                  <div className="bg-orange-50 p-3 rounded-2xl border border-orange-100 shadow-sm text-center">
                    <span className="block text-[10px] text-orange-600 mb-1">۳۱-۶۰ روز معوق</span>
                    <span className="block text-xs font-bold text-orange-700">{installmentAgingResult.overdue31_60.toLocaleString()}</span>
                  </div>
                  <div className="bg-rose-50 p-3 rounded-2xl border border-rose-100 shadow-sm text-center">
                    <span className="block text-[10px] text-rose-600 mb-1">۶۱-۹۰ روز معوق</span>
                    <span className="block text-xs font-bold text-rose-700">{installmentAgingResult.overdue61_90.toLocaleString()}</span>
                  </div>
                  <div className="bg-red-50 p-3 rounded-2xl border border-red-100 shadow-sm text-center">
                    <span className="block text-[10px] text-red-600 mb-1">بیش از ۹۰ روز</span>
                    <span className="block text-xs font-bold text-red-700">{installmentAgingResult.overdue90Plus.toLocaleString()}</span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-zinc-150 shadow-sm overflow-hidden">
                  <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-150 flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-800">ریز اقساط معوق</span>
                    <span className="text-[10px] text-zinc-400">جمع کل معوقات: { (installmentAgingResult.total - installmentAgingResult.notDue).toLocaleString() } ریال</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-right border-collapse text-xs">
                      <thead>
                        <tr className="bg-zinc-50/50 text-zinc-500 border-b border-zinc-100">
                          <th className="p-3">مشتری</th>
                          <th className="p-3 text-center">تاریخ سررسید</th>
                          <th className="p-3 text-center">روزهای تاخیر</th>
                          <th className="p-3 text-left">مبلغ قسط</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50 font-mono">
                        {installmentAgingResult.details.map((detail, idx) => (
                          <tr key={idx} className="hover:bg-zinc-50/30 transition-colors">
                            <td className="p-3 font-medium text-zinc-800 font-sans">{detail.personName}</td>
                            <td className="p-3 text-center font-mono text-zinc-500">{detail.dueDate}</td>
                            <td className="p-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-sans ${
                                detail.delayDays > 60 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                              }`}>
                                {detail.delayDays} روز
                              </span>
                            </td>
                            <td className="p-3 text-left font-mono font-bold text-zinc-700">{detail.amount.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {selectedReport === 'unearned_interest' && unearnedInterestResult && (
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-zinc-150 shadow-sm space-y-6">
                  <div className="text-center space-y-2">
                    <h3 className="text-sm font-bold text-zinc-800">تحلیل سود و درآمدهای تحقق‌نیافته</h3>
                    <p className="text-[10px] text-zinc-400 leading-relaxed max-w-xs mx-auto">
                      طبق استانداردهای حسابداری، سود اقساط تا زمان وصول یا گذشت زمان به عنوان درآمد تحقق‌نیافته (Unearned Interest) شناخته می‌شود.
                    </p>
                  </div>

                  <div className="flex items-center justify-center py-4">
                    <div className="relative w-40 h-40">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-zinc-100" />
                        <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-indigo-600" 
                          strokeDasharray={440} strokeDashoffset={440 - (440 * unearnedInterestResult.ratio) / 100} strokeLinecap="round" />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xl font-bold text-zinc-800 font-mono">{unearnedInterestResult.ratio.toFixed(1)}%</span>
                        <span className="text-[9px] text-zinc-400">تحقق یافته</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-zinc-50 border border-zinc-100">
                      <span className="text-[10px] text-zinc-500 font-bold">کل سود پیش‌بینی شده (عقد قرارداد):</span>
                      <span className="text-xs font-mono font-bold text-zinc-800">{unearnedInterestResult.totalInterest.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-emerald-50 border border-emerald-100">
                      <span className="text-[10px] text-emerald-700 font-bold">سود تحقق یافته (درآمد واقعی):</span>
                      <span className="text-xs font-mono font-bold text-emerald-700">{Math.round(unearnedInterestResult.earnedInterest).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-amber-50 border border-amber-100">
                      <span className="text-[10px] text-amber-700 font-bold">سود تحقق‌نیافته (درآمدهای آتی):</span>
                      <span className="text-xs font-mono font-bold text-amber-700">{Math.round(unearnedInterestResult.unearnedInterest).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {selectedReport === 'installment_portfolio' && installmentPortfolioResult && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-indigo-600 p-4 rounded-2xl text-white shadow-lg shadow-indigo-200">
                    <span className="block text-[10px] opacity-80 mb-1">کل اصل سرمایه در جریان</span>
                    <span className="block text-xs font-bold font-mono">{installmentPortfolioResult.totals.totalPrincipal.toLocaleString()}</span>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm">
                    <span className="block text-[10px] text-zinc-400 mb-1">مجموع سود پیش‌بینی شده</span>
                    <span className="block text-xs font-bold font-mono text-zinc-800">{installmentPortfolioResult.totals.totalInterest.toLocaleString()}</span>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm">
                    <span className="block text-[10px] text-zinc-400 mb-1">مانده کل مطالبات</span>
                    <span className="block text-xs font-bold font-mono text-zinc-800">{installmentPortfolioResult.totals.totalOutstanding.toLocaleString()}</span>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm">
                    <span className="block text-[10px] text-zinc-400 mb-1">تعداد دفترچه‌های فعال</span>
                    <span className="block text-xs font-bold text-zinc-800">{installmentPortfolioResult.totals.activeBooks} مورد</span>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-zinc-150 shadow-sm overflow-hidden">
                  <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-150">
                    <span className="text-xs font-bold text-zinc-800">لیست دفترچه‌ها و وضعیت ریسک مطالبات</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-right border-collapse text-xs">
                      <thead>
                        <tr className="bg-zinc-50/50 text-zinc-500 border-b border-zinc-100">
                          <th className="p-3">مشتری</th>
                          <th className="p-3 text-center">مانده بدهی</th>
                          <th className="p-3 text-center">پیشرفت وصول</th>
                          <th className="p-3 text-center">اقساط معوق</th>
                          <th className="p-3 text-center">وضعیت ریسک</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50 font-mono">
                        {installmentPortfolioResult.portfolio.map((item, idx) => (
                          <tr key={idx} className="hover:bg-zinc-50/30 transition-colors">
                            <td className="p-3">
                              <span className="block font-bold text-zinc-800 font-sans">{item.person?.name}</span>
                              <span className="block text-[9px] text-zinc-400 font-sans">{item.book.installmentCount} قسطه</span>
                            </td>
                            <td className="p-3 text-center font-mono text-zinc-700">{item.remainingAmount.toLocaleString()}</td>
                            <td className="p-3 text-center w-32">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${item.progress}%` }} />
                                </div>
                                <span className="text-[9px] font-bold text-zinc-500">{item.progress.toFixed(0)}%</span>
                              </div>
                            </td>
                            <td className="p-3 text-center font-bold text-rose-600">{item.overdueCount} قسط</td>
                            <td className="p-3 text-center">
                              {item.overdueCount > 2 ? (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-lg text-[9px] font-bold font-sans">بحرانی</span>
                              ) : item.overdueCount > 0 ? (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg text-[9px] font-bold font-sans">در خطر</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-lg text-[9px] font-bold font-sans">سالم</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Print Notice (Visible only on print) */}
                <div className="hidden print:block text-right text-[8px] text-zinc-400 font-sans border-t pt-2 mt-4 flex justify-between">
                  <span>سیستم یکپارچه حسابداری هوشمند</span>
                  <span>کد سیستم: {new Date().toLocaleDateString('fa-IR')}</span>
                </div>

              </div>
            )}
          </div>

      {/* Edit Check Modal */}
      {editingCheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-fade-in" dir="rtl">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 text-right font-sans space-y-4 max-h-[95vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
              <button 
                type="button" 
                onClick={() => setEditingCheck(null)} 
                className="text-zinc-400 text-xs font-semibold hover:text-zinc-600"
              >
                انصراف / بستن
              </button>
              <span className="font-sans text-xs font-bold text-zinc-800">
                ویرایش مشخصات چک از داخل ریز حساب
              </span>
            </div>

            <form 
              onSubmit={(e) => {
                e.preventDefault();
                if (onEditCheck && editingCheck) {
                  onEditCheck({
                    ...editingCheck,
                    bankName: editBankName,
                    amount: editAmount,
                    checkNumber: editCheckNumber,
                    sayadiNumber: editSayadiNumber || undefined,
                    nationalId: editNationalId || undefined,
                    dueDate: editDueDate,
                    personId: editPersonId,
                  });
                  setEditingCheck(null);
                }
              }} 
              className="space-y-4"
            >
              <div>
                <label className="block text-[10px] text-zinc-500 text-right mb-0.5">نام بانک صادرکننده</label>
                <input
                  type="text"
                  value={editBankName}
                  onChange={(e) => setEditBankName(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] text-zinc-500 text-right mb-0.5">مبلغ چک (ریال)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editAmount > 0 ? editAmount.toLocaleString() : ''}
                  onChange={(e) => {
                    const cleanVal = e.target.value.replace(/,/g, '');
                    const num = parseInt(cleanVal) || 0;
                    setEditAmount(num);
                  }}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-zinc-500 text-right mb-0.5">شماره سریال چک</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editCheckNumber}
                    onChange={(e) => setEditCheckNumber(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 text-right mb-0.5">شماره صیادی ۱۶ رقمی</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editSayadiNumber}
                    onChange={(e) => setEditSayadiNumber(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-zinc-500 text-right mb-0.5">کد ملی صاحب حساب</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editNationalId}
                    onChange={(e) => setEditNationalId(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 text-right mb-0.5">تاریخ سررسید چک</label>
                  <input
                    type="text"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-sans text-xs font-semibold py-2.5 rounded-xl shadow-md transition flex items-center justify-center space-x-1.5 space-x-reverse"
              >
                <CheckIcon size={14} />
                <span>ثبت و اعمال تغییرات چک</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
