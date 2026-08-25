import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Landmark, Shield, CreditCard, FileText, Scale, Coins, 
  CheckCircle, AlertTriangle, ArrowUpLeft, ArrowDownRight, Printer, Search, Calendar, Filter,
  Eye, Edit3, Plus, Trash2, Check
} from 'lucide-react';
import { AppState, Person, JournalVoucher, Check as CheckType, Invoice, CreditFile, PartnerCreditRequest } from '../types';
import { 
  getPartnerContractAccountSummary, 
  getPartnerContractVouchers, 
  ContractAccountSummary,
  resolvePartnerCreditRules
} from '../utils/partnerProcess';
import { saveAppState, DEFAULT_SUBSIDIARIES, checkVoucherDeletionPolicy } from '../utils/accounting';
import { getCurrentJalaliDate } from '../utils/jalali';
import VoucherDetailModal from './VoucherDetailModal';
import ManualVoucherForm from './ManualVoucherForm';

interface PartnerFinancialDossierModalProps {
  agent: Person;
  appState: AppState;
  onClose: () => void;
  onUpdateAppState?: (newState: AppState) => void;
}

export default function PartnerFinancialDossierModal({ 
  agent, 
  appState, 
  onClose,
  onUpdateAppState 
}: PartnerFinancialDossierModalProps) {
  const [selectedContractTab, setSelectedContractTab] = useState<'credit' | 'deferred_sales' | 'future'>('credit');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreditSubAccountsModal, setShowCreditSubAccountsModal] = useState(false);

  // Voucher management states
  const [vouchersList, setVouchersList] = useState<JournalVoucher[]>(appState.vouchers || []);
  const [selectedVoucherForDetail, setSelectedVoucherForDetail] = useState<JournalVoucher | null>(null);
  const [editingVoucher, setEditingVoucher] = useState<JournalVoucher | null>(null);
  const [showNewVoucherForm, setShowNewVoucherForm] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Find associated BusinessPartner record
  const bp = useMemo(() => {
    return (appState.businessPartners || []).find(p => p.personId === agent.id || p.id === agent.id);
  }, [appState.businessPartners, agent.id]);

  // Calculate non-netting summaries for each contract
  const creditSummary: ContractAccountSummary = useMemo(() => {
    return getPartnerContractAccountSummary(vouchersList, agent.id, 'credit');
  }, [vouchersList, agent.id]);

  const deferredSalesSummary: ContractAccountSummary = useMemo(() => {
    return getPartnerContractAccountSummary(vouchersList, agent.id, 'deferred_sales');
  }, [vouchersList, agent.id]);

  // Vouchers for selected contract
  const currentContractVouchers = useMemo(() => {
    const raw = getPartnerContractVouchers(vouchersList, agent.id, selectedContractTab);
    if (!searchQuery.trim()) return raw;
    const q = searchQuery.trim().toLowerCase();
    return raw.filter(v => 
      v.voucherNumber.toString().includes(q) ||
      v.description?.toLowerCase().includes(q) ||
      v.entries?.some(e => e.description?.toLowerCase().includes(q))
    );
  }, [vouchersList, agent.id, selectedContractTab, searchQuery]);

  // Calculate cumulative running balance for current contract vouchers
  const vouchersWithRunningBalance = useMemo(() => {
    let runningBalance = 0;
    return currentContractVouchers.map(v => {
      // Find entries for this person in this voucher
      let vDebit = 0;
      let vCredit = 0;
      v.entries?.forEach(e => {
        if (e.floatingDetailed && e.floatingDetailed.type === 'person' && e.floatingDetailed.id === agent.id) {
          vDebit += e.debit || 0;
          vCredit += e.credit || 0;
        }
      });
      
      const diff = vDebit - vCredit;
      runningBalance += diff;

      return {
        ...v,
        vDebit,
        vCredit,
        runningBalance: Math.abs(runningBalance),
        runningNature: runningBalance > 0 ? 'بدهکار' : runningBalance < 0 ? 'بستانکار' : 'بی‌حساب'
      };
    });
  }, [currentContractVouchers, agent.id]);

  // Save / Update Voucher Handler
  const handleSaveVoucher = (voucherData: Omit<JournalVoucher, 'id' | 'voucherNumber' | 'gregorianDate' | 'isAutomatic'>) => {
    let updatedVouchers: JournalVoucher[] = [];

    if (editingVoucher) {
      // Update existing voucher
      const updatedVoucher: JournalVoucher = {
        ...editingVoucher,
        date: voucherData.date,
        description: voucherData.description,
        entries: voucherData.entries,
        contractType: voucherData.contractType || editingVoucher.contractType || selectedContractTab,
        sourceType: editingVoucher.sourceType || 'manual'
      };
      updatedVouchers = vouchersList.map(v => v.id === editingVoucher.id ? updatedVoucher : v);
      setNotification(`سند شماره #${editingVoucher.voucherNumber} با موفقیت به‌روزرسانی و اصلاح شد.`);
    } else {
      // Create new manual voucher
      const maxNo = vouchersList.length > 0 ? Math.max(...vouchersList.map(v => v.voucherNumber || 0)) : 0;
      const nextNo = maxNo + 1;
      const newVoucher: JournalVoucher = {
        id: 'JV_' + Date.now(),
        voucherNumber: nextNo,
        date: voucherData.date,
        gregorianDate: new Date().toISOString(),
        description: voucherData.description,
        entries: voucherData.entries,
        isAutomatic: false,
        sourceType: 'manual',
        contractType: selectedContractTab === 'deferred_sales' ? 'deferred_sales' : 'credit'
      };
      updatedVouchers = [newVoucher, ...vouchersList];
      setNotification(`سند حسابداری جدید به شماره #${nextNo} با موفقیت صادر و ثبت شد.`);
    }

    setVouchersList(updatedVouchers);
    appState.vouchers = updatedVouchers;
    const updatedState = { ...appState, vouchers: updatedVouchers };
    saveAppState(updatedState);
    if (onUpdateAppState) {
      onUpdateAppState(updatedState);
    }

    setEditingVoucher(null);
    setSelectedVoucherForDetail(null);
    setShowNewVoucherForm(false);

    setTimeout(() => setNotification(null), 4000);
  };

  // Delete Voucher Handler
  const handleDeleteVoucher = (voucherId: string) => {
    const target = vouchersList.find(v => v.id === voucherId);
    if (target) {
      const policy = checkVoucherDeletionPolicy(target);
      if (!policy.allowed) {
        alert(policy.reason || 'این سند حسابداری توسط سیستم ایجاد شده و حذف مستقیم آن امکان‌پذیر نیست. برای اصلاح یا بی‌اثر کردن سند، از فرآیند ابطال یا سند معکوس استفاده کنید.');
        return;
      }
    }

    const updatedVouchers = vouchersList.filter(v => v.id !== voucherId);
    setVouchersList(updatedVouchers);
    appState.vouchers = updatedVouchers;
    const updatedState = { ...appState, vouchers: updatedVouchers };
    saveAppState(updatedState);
    if (onUpdateAppState) {
      onUpdateAppState(updatedState);
    }

    setSelectedVoucherForDetail(null);
    setEditingVoucher(null);
    setNotification(`سند شماره #${target?.voucherNumber || ''} با موفقیت حذف گردید.`);
    setTimeout(() => setNotification(null), 4000);
  };

  // Associated credit files / requests
  const agentCreditFiles = useMemo(() => {
    return (appState.creditFiles || []).filter(f => f.representativeId === agent.id || f.representativeId === bp?.id);
  }, [appState.creditFiles, agent.id, bp?.id]);

  const agentCreditRequests = useMemo(() => {
    return (appState.partnerCreditRequests || []).filter(r => r.businessPartnerId === agent.id || r.businessPartnerId === bp?.id);
  }, [appState.partnerCreditRequests, agent.id, bp?.id]);

  // Associated checks for credit contract
  const agentChecks = useMemo(() => {
    return (appState.checks || []).filter(c => c.representativeId === agent.id || c.submittedByAgentId === agent.id || c.personId === agent.id);
  }, [appState.checks, agent.id]);

  // Associated invoices for deferred sales contract
  const agentInvoices = useMemo(() => {
    return (appState.invoices || []).filter(inv => inv.personId === agent.id && inv.type === 'sell' && !inv.isProInvoice);
  }, [appState.invoices, agent.id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 font-sans text-right" dir="rtl">
      <motion.div 
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-white w-full max-w-6xl max-h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-zinc-200"
      >
        {/* Header Bar */}
        <div className="bg-zinc-900 text-white p-4 sm:p-5 flex justify-between items-center border-b border-zinc-800">
          <div className="flex items-center space-x-3 space-x-reverse">
            <div className="bg-emerald-500/20 text-emerald-400 p-2.5 rounded-xl border border-emerald-500/30">
              <Landmark size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold">پرونده مالی نماینده: {agent.name}</h2>
                <span className="bg-zinc-800 text-zinc-300 text-xs font-mono px-2 py-0.5 rounded border border-zinc-700">
                  کد: {agent.code}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                مدیریت حساب‌های عملیاتی قراردادهای اعتباری و فروش نسیه | امکان باز کردن، اصلاح و ثبت اسناد
              </p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Top Summary Cards (Non-Netting Demonstration) */}
        <div className="p-4 sm:p-5 bg-zinc-50 border-b border-zinc-200 grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Credit Contract Summary */}
          <div 
            onClick={() => setSelectedContractTab('credit')}
            className={`p-4 rounded-xl border cursor-pointer transition-all ${
              selectedContractTab === 'credit'
                ? 'bg-white border-emerald-500 ring-2 ring-emerald-500/20 shadow-md'
                : 'bg-white border-zinc-200 hover:border-zinc-300'
            }`}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-zinc-700 flex items-center gap-1.5">
                <Shield size={14} className="text-emerald-600" />
                حساب قرارداد اعتباری
              </span>
              <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                مستقل (بدون تهاتر)
              </span>
            </div>
            
            <div className="space-y-1">
              <div className="flex justify-between items-baseline">
                <span className="text-[11px] text-zinc-500">مانده فعلی حساب:</span>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-base font-bold text-emerald-900">
                    {creditSummary.net.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-zinc-500">ریال</span>
                </div>
              </div>

              <div className="flex justify-between items-center text-[11px] pt-1 border-t border-zinc-100">
                <span className="text-zinc-500">ماهیت مانده:</span>
                <span className={`font-bold px-2 py-0.5 rounded ${
                  creditSummary.nature === 'بستانکار' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}>
                  {creditSummary.nature} (طلبداری اعتباری)
                </span>
              </div>
            </div>

            <div className="mt-3 text-[10px] text-zinc-500 bg-zinc-50 p-2 rounded border border-zinc-150 flex justify-between">
              <span>جمع بستانکار: {creditSummary.credit.toLocaleString()}</span>
              <span>جمع بدهکار: {creditSummary.debit.toLocaleString()}</span>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowCreditSubAccountsModal(true);
              }}
              className="mt-2.5 w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold py-1.5 rounded-lg transition border border-emerald-200 flex items-center justify-center gap-1"
            >
              <Eye size={13} />
              <span>ریز حساب‌ها و اجزای تشکیل‌دهنده</span>
            </button>
          </div>

          {/* Deferred Sales Contract Summary */}
          <div 
            onClick={() => setSelectedContractTab('deferred_sales')}
            className={`p-4 rounded-xl border cursor-pointer transition-all ${
              selectedContractTab === 'deferred_sales'
                ? 'bg-white border-blue-500 ring-2 ring-blue-500/20 shadow-md'
                : 'bg-white border-zinc-200 hover:border-zinc-300'
            }`}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-zinc-700 flex items-center gap-1.5">
                <CreditCard size={14} className="text-blue-600" />
                حساب قرارداد فروش نسیه
              </span>
              <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                مستقل (بدون تهاتر)
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-baseline">
                <span className="text-[11px] text-zinc-500">مانده فعلی بدهی نسیه:</span>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-base font-bold text-blue-900">
                    {deferredSalesSummary.net.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-zinc-500">ریال</span>
                </div>
              </div>

              <div className="flex justify-between items-center text-[11px] pt-1 border-t border-zinc-100">
                <span className="text-zinc-500">ماهیت مانده:</span>
                <span className={`font-bold px-2 py-0.5 rounded ${
                  deferredSalesSummary.nature === 'بدهکار' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {deferredSalesSummary.nature} (بدهی خرید کالا)
                </span>
              </div>
            </div>

            <div className="mt-3 text-[10px] text-zinc-500 bg-zinc-50 p-2 rounded border border-zinc-150 flex justify-between">
              <span>جمع بدهکار: {deferredSalesSummary.debit.toLocaleString()}</span>
              <span>جمع بستانکار: {deferredSalesSummary.credit.toLocaleString()}</span>
            </div>
          </div>

          {/* Representative Credit Policy info */}
          <div className="p-4 rounded-xl border border-zinc-200 bg-white flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-bold text-zinc-700 flex items-center gap-1.5">
                  <Scale size={14} className="text-purple-600" />
                  اطلاعات پروانه اعتباری نماینده
                </span>
                <span className="text-[10px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-200 font-bold">
                  سیاست مالی
                </span>
              </div>

              <div className="space-y-1.5 mt-2">
                {(() => {
                  const rules = resolvePartnerCreditRules(agent, appState.businessPartners);
                  return (
                    <>
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-500">سقف اعتبار کلی:</span>
                        <span className="font-mono font-bold text-zinc-800">{rules.maxCreditLimit.toLocaleString()} ریال</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-500">مهلت نسیه مجاز:</span>
                        <span className="font-mono text-zinc-800">{rules.defaultInstallmentDays} روز</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="text-[10px] text-zinc-400 pt-1.5 border-t border-zinc-100 flex items-center justify-between mt-2">
              <span>نرخ جریمه دیرکرد: {resolvePartnerCreditRules(agent, appState.businessPartners).penaltyRatePerMonth}% روزانه</span>
              <span>شناسه تفصیلی: <span className="font-mono text-zinc-700">{agent.id}</span></span>
            </div>
          </div>
        </div>

        {/* Contract Account Workspace Tabs */}
        <div className="bg-zinc-100 px-4 sm:px-5 pt-3 border-b border-zinc-200 flex justify-between items-center flex-wrap gap-2">
          <div className="flex space-x-1 space-x-reverse">
            <button
              onClick={() => setSelectedContractTab('credit')}
              className={`py-2.5 px-4 text-xs font-bold rounded-t-xl transition flex items-center gap-2 ${
                selectedContractTab === 'credit'
                  ? 'bg-white text-emerald-700 border-t-2 border-emerald-600 shadow-sm'
                  : 'text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              <Shield size={14} />
              <span>حساب قرارداد اعتباری</span>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                {creditSummary.vouchersCount}
              </span>
            </button>

            <button
              onClick={() => setSelectedContractTab('deferred_sales')}
              className={`py-2.5 px-4 text-xs font-bold rounded-t-xl transition flex items-center gap-2 ${
                selectedContractTab === 'deferred_sales'
                  ? 'bg-white text-blue-700 border-t-2 border-blue-600 shadow-sm'
                  : 'text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              <CreditCard size={14} />
              <span>حساب قرارداد فروش نسیه</span>
              <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                {deferredSalesSummary.vouchersCount}
              </span>
            </button>

            <button
              onClick={() => setSelectedContractTab('future')}
              className={`py-2.5 px-4 text-xs font-bold rounded-t-xl transition flex items-center gap-2 ${
                selectedContractTab === 'future'
                  ? 'bg-white text-purple-700 border-t-2 border-purple-600 shadow-sm'
                  : 'text-zinc-500 hover:bg-zinc-200'
              }`}
            >
              <FileText size={14} />
              <span>سایر قراردادها (قابل توسعه)</span>
            </button>
          </div>

          <div className="flex items-center gap-2 pb-2">
            <div className="relative">
              <Search size={14} className="absolute right-2.5 top-2.5 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="جستجو در اسناد این قرارداد..."
                className="bg-white border border-zinc-300 rounded-lg pr-8 pl-3 py-1.5 text-xs outline-none focus:border-zinc-500 w-48 sm:w-64"
              />
            </div>
            <button 
              onClick={() => window.print()}
              className="p-1.5 bg-white border border-zinc-300 text-zinc-700 rounded-lg hover:bg-zinc-50 text-xs flex items-center gap-1 font-bold"
              title="چاپ صورتحساب این قرارداد"
            >
              <Printer size={14} />
              <span className="hidden sm:inline">چاپ دفتر معین</span>
            </button>
          </div>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {selectedContractTab === 'future' ? (
            <div className="text-center py-12 bg-zinc-50 rounded-2xl border border-dashed border-zinc-300">
              <FileText size={40} className="mx-auto text-zinc-300 mb-3" />
              <h3 className="text-sm font-bold text-zinc-700">ساختار آماده جهت ثبت انواع قرارداد جدید</h3>
              <p className="text-xs text-zinc-500 max-w-md mx-auto mt-1">
                این پرونده با معماری کاملاً ماژولار طراحی شده است. هر نوع قرارداد جدیدی در آینده اضافه شود، بدون نیاز به تغییر در کل و معین حسابداری، دارای حساب و ریز گردش مستقل خواهد بود.
              </p>
            </div>
          ) : (
            <>
              {/* Sub-Ledger Statement Table */}
              <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
                <div className="bg-zinc-50 px-4 py-3 border-b border-zinc-200 flex justify-between items-center flex-wrap gap-2">
                  <span className="text-xs font-bold text-zinc-800 flex items-center gap-2">
                    <FileText size={15} className="text-zinc-600" />
                    دفتر معین و ریز اسناد مالی حساب {selectedContractTab === 'credit' ? 'قرارداد اعتباری' : 'قرارداد فروش نسیه'}
                  </span>

                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-zinc-500 font-mono">
                      تعداد اسناد: {vouchersWithRunningBalance.length}
                    </span>

                    <button
                      onClick={() => {
                        setEditingVoucher(null);
                        setShowNewVoucherForm(true);
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 shadow-xs"
                    >
                      <Plus size={14} />
                      <span>ثبت سند مالی جدید برای این نماینده</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-zinc-100 text-zinc-600 font-bold border-b border-zinc-200">
                      <tr>
                        <th className="py-2.5 px-3">شماره سند</th>
                        <th className="py-2.5 px-3">تاریخ</th>
                        <th className="py-2.5 px-3">شرح سند</th>
                        <th className="py-2.5 px-3 text-left">بدهکار (ریال)</th>
                        <th className="py-2.5 px-3 text-left">بستانکار (ریال)</th>
                        <th className="py-2.5 px-3 text-left">مانده (ریال)</th>
                        <th className="py-2.5 px-3 text-center">ماهیت</th>
                        <th className="py-2.5 px-3 text-center">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {vouchersWithRunningBalance.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-zinc-400 text-xs">
                            هیچ سند مالی برای این قرارداد ثبت نشده است.
                          </td>
                        </tr>
                      ) : (
                        vouchersWithRunningBalance.map(v => (
                          <tr 
                            key={v.id} 
                            onClick={() => setSelectedVoucherForDetail(v)}
                            className="hover:bg-emerald-50/60 transition-colors cursor-pointer group"
                          >
                            <td className="py-2.5 px-3 font-mono font-bold text-zinc-800">
                              <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/60 group-hover:bg-emerald-100">
                                #{v.voucherNumber}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-zinc-600">
                              {v.date}
                            </td>
                            <td className="py-2.5 px-3 text-zinc-800 max-w-md truncate">
                              {v.description}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-left text-zinc-800">
                              {v.vDebit > 0 ? v.vDebit.toLocaleString() : '-'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-left text-emerald-700 font-bold">
                              {v.vCredit > 0 ? v.vCredit.toLocaleString() : '-'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-left font-bold text-zinc-900">
                              {v.runningBalance.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                v.runningNature === 'بستانکار' 
                                  ? 'bg-emerald-100 text-emerald-800' 
                                  : v.runningNature === 'بدهکار'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-zinc-100 text-zinc-600'
                              }`}>
                                {v.runningNature}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => setSelectedVoucherForDetail(v)}
                                  className="p-1.5 bg-zinc-100 hover:bg-emerald-100 text-zinc-700 hover:text-emerald-800 rounded-lg transition text-[11px] flex items-center gap-1 font-bold"
                                  title="مشاهده جزئیات کامل سند"
                                >
                                  <Eye size={13} />
                                  <span>مشاهده</span>
                                </button>
                                <button
                                  onClick={() => setEditingVoucher(v)}
                                  className="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition text-[11px] flex items-center gap-1 font-bold"
                                  title="اصلاح و ویرایش سند"
                                >
                                  <Edit3 size={13} />
                                  <span>اصلاح</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Connected Modules Section */}
              {selectedContractTab === 'credit' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Credit Files */}
                  <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-zinc-100">
                      <h4 className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                        <Shield size={14} className="text-emerald-600" />
                        پرونده‌های اعتباری فعال این قرارداد ({agentCreditFiles.length})
                      </h4>
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {agentCreditFiles.length === 0 ? (
                        <div className="text-[11px] text-zinc-400 text-center py-4">پرونده اعتباری ثبت نشده است.</div>
                      ) : (
                        agentCreditFiles.map(f => (
                          <div key={f.id} className="p-2.5 bg-zinc-50 rounded-lg border border-zinc-200 text-xs flex justify-between items-center">
                            <div>
                              <div className="font-bold text-zinc-800">پرونده #{f.id}</div>
                              <div className="text-[10px] text-zinc-500">مبلغ درخواست: {f.requestedAmount.toLocaleString()} ریال</div>
                            </div>
                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                              {f.status || 'فعال'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Registered Checks */}
                  <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-zinc-100">
                      <h4 className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                        <CheckCircle size={14} className="text-blue-600" />
                        چک‌های دریافتی مرتبط در زیرسیستم استاندارد چک ({agentChecks.length})
                      </h4>
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {agentChecks.length === 0 ? (
                        <div className="text-[11px] text-zinc-400 text-center py-4">چکی ثبت نشده است.</div>
                      ) : (
                        agentChecks.map(c => (
                          <div key={c.id} className="p-2.5 bg-zinc-50 rounded-lg border border-zinc-200 text-xs flex justify-between items-center">
                            <div>
                              <div className="font-mono font-bold text-zinc-800">چک {c.checkNumber} - {c.bankName}</div>
                              <div className="text-[10px] text-zinc-500 font-mono">مبلغ: {c.amount.toLocaleString()} ریال | سررسید: {c.dueDate}</div>
                            </div>
                            <span className="text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                              {c.currentState === 'present_in_cashbox' ? 'موجود در صندوق' : c.currentState}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                /* Deferred Sales Invoices */
                <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-zinc-100">
                    <h4 className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                      <CreditCard size={14} className="text-blue-600" />
                      فاکتورهای فروش نسیه همکار ({agentInvoices.length})
                    </h4>
                  </div>

                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {agentInvoices.length === 0 ? (
                      <div className="text-[11px] text-zinc-400 text-center py-4">فاکتور فروش نسیه‌ای ثبت نشده است.</div>
                    ) : (
                      agentInvoices.map(inv => {
                        const unpaid = inv.totalAmount - (inv.paidAmount || 0);
                        return (
                          <div key={inv.id} className="p-2.5 bg-zinc-50 rounded-lg border border-zinc-200 text-xs flex justify-between items-center">
                            <div>
                              <div className="font-bold text-zinc-800">فاکتور #{inv.invoiceNumber} (تاریخ: {inv.date})</div>
                              <div className="text-[10px] text-zinc-500 font-mono">
                                کل: {inv.totalAmount.toLocaleString()} ریال | مانده بدهی: {unpaid.toLocaleString()} ریال
                              </div>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              unpaid <= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {unpaid <= 0 ? 'تسویه شده' : 'دارای مانده بدهی'}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer info */}
        <div className="bg-zinc-50 p-3 sm:px-5 border-t border-zinc-200 flex justify-between items-center text-[11px] text-zinc-500">
          <span>تضمین عدم تهاتر: مبالغ بستانکاری اعتباری و بدهکاری نسیه با یکدیگر ترکیب یا صفر نمی‌شوند.</span>
          <button
            onClick={onClose}
            className="bg-zinc-900 text-white font-bold px-4 py-1.5 rounded-lg hover:bg-zinc-800 transition"
          >
            بستن پرونده
          </button>
        </div>
      </motion.div>

      {/* Notification Toast */}
      {notification && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] bg-zinc-900 text-white text-xs font-bold px-5 py-3 rounded-2xl shadow-2xl border border-zinc-700 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle size={18} className="text-emerald-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* Voucher Detail Modal */}
      {selectedVoucherForDetail && (
        <VoucherDetailModal
          voucher={selectedVoucherForDetail}
          onClose={() => setSelectedVoucherForDetail(null)}
          onEdit={(v) => {
            setSelectedVoucherForDetail(null);
            setEditingVoucher(v);
          }}
          onDelete={(id) => handleDeleteVoucher(id)}
          onNew={() => {
            setSelectedVoucherForDetail(null);
            setEditingVoucher(null);
            setShowNewVoucherForm(true);
          }}
        />
      )}

      {/* Edit / New Manual Voucher Form Modal */}
      {(editingVoucher || showNewVoucherForm) && (
        <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 font-sans text-right" dir="rtl">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="bg-white w-full max-w-4xl max-h-[95vh] rounded-2xl shadow-2xl overflow-y-auto border border-zinc-200 p-2 sm:p-4"
          >
            <ManualVoucherForm
              subsidiaries={appState.subsidiaries || DEFAULT_SUBSIDIARIES}
              persons={appState.persons || []}
              businessPartners={appState.businessPartners || []}
              nextVoucherNumber={vouchersList.length > 0 ? Math.max(...vouchersList.map(v => v.voucherNumber || 0)) + 1 : 1}
              initialVoucher={editingVoucher || (showNewVoucherForm ? {
                id: '',
                voucherNumber: vouchersList.length > 0 ? Math.max(...vouchersList.map(v => v.voucherNumber || 0)) + 1 : 1,
                date: getCurrentJalaliDate(),
                gregorianDate: new Date().toISOString(),
                description: `پرداخت / تسویه حساب نماینده ${agent.name}`,
                isAutomatic: false,
                sourceType: 'manual',
                contractType: selectedContractTab === 'deferred_sales' ? 'deferred_sales' : 'credit',
                entries: [
                  {
                    subsidiaryId: 'SUB_BANK_MELI',
                    debit: 0,
                    credit: 0,
                    description: `پرداخت به ${agent.name}`
                  },
                  {
                    subsidiaryId: 'SUB_CASH_MAIN',
                    debit: 0,
                    credit: 0,
                    floatingDetailed: { id: agent.id, name: agent.name, type: 'person' },
                    description: `حساب نماینده ${agent.name}`
                  }
                ]
              } : undefined)}
              onSubmit={handleSaveVoucher}
              onCancel={() => {
                setEditingVoucher(null);
                setShowNewVoucherForm(false);
              }}
              onDelete={editingVoucher ? () => handleDeleteVoucher(editingVoucher.id) : undefined}
            />
          </motion.div>
        </div>
      )}

      {/* Credit Contract Sub-Accounts Breakdown Modal */}
      <AnimatePresence>
        {showCreditSubAccountsModal && (
          <div className="fixed inset-0 z-60 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 font-sans text-right" dir="rtl">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-zinc-200"
            >
              {/* Modal Header */}
              <div className="bg-emerald-900 text-white p-4 flex justify-between items-center border-b border-emerald-800">
                <div className="flex items-center space-x-3 space-x-reverse">
                  <div className="bg-emerald-500/20 text-emerald-300 p-2 rounded-xl border border-emerald-500/30">
                    <Shield size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold">ریز حساب‌های داخلی - قرارداد اعتباری: {agent.name}</h3>
                    <p className="text-xs text-emerald-200/80 mt-0.5">مشاهده تفکیکی اسناد و اقلام تشکیل‌دهنده حساب قرارداد اعتباری</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCreditSubAccountsModal(false)}
                  className="p-1.5 text-emerald-200 hover:text-white hover:bg-emerald-800 rounded-lg transition"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
                    <span className="text-[11px] text-zinc-500 block mb-1">جمع کل بدهکار اعتباری</span>
                    <span className="font-mono text-base font-bold text-zinc-800">{creditSummary.debit.toLocaleString()}</span>
                    <span className="text-xs text-zinc-500 mr-1">ریال</span>
                  </div>
                  <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-200">
                    <span className="text-[11px] text-emerald-700 block mb-1">جمع کل بستانکار اعتباری</span>
                    <span className="font-mono text-base font-bold text-emerald-900">{creditSummary.credit.toLocaleString()}</span>
                    <span className="text-xs text-emerald-700 mr-1">ریال</span>
                  </div>
                  <div className="bg-zinc-900 text-white p-3.5 rounded-xl">
                    <span className="text-[11px] text-zinc-400 block mb-1">وضعیت مانده نهایی</span>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-base font-bold">{creditSummary.net.toLocaleString()}</span>
                      <span className="text-xs text-emerald-400 font-bold px-1.5 py-0.5 rounded bg-emerald-500/20">{creditSummary.nature}</span>
                    </div>
                  </div>
                </div>

                {/* Itemized Vouchers Table */}
                <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                  <div className="bg-zinc-100 px-4 py-2.5 border-b border-zinc-200 text-xs font-bold text-zinc-800 flex justify-between items-center">
                    <span>ریز اسناد مالی حساب قرارداد اعتباری</span>
                    <span className="font-mono text-zinc-500">تعداد: {vouchersWithRunningBalance.length} سند</span>
                  </div>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-right text-xs">
                      <thead className="bg-zinc-50 text-zinc-600 font-bold border-b border-zinc-200 sticky top-0">
                        <tr>
                          <th className="py-2.5 px-3">شماره سند</th>
                          <th className="py-2.5 px-3">تاریخ</th>
                          <th className="py-2.5 px-3">شرح سند</th>
                          <th className="py-2.5 px-3 text-left">بدهکار (ریال)</th>
                          <th className="py-2.5 px-3 text-left">بستانکار (ریال)</th>
                          <th className="py-2.5 px-3 text-left">مانده (ریال)</th>
                          <th className="py-2.5 px-3 text-center">ماهیت</th>
                          <th className="py-2.5 px-3 text-center">عملیات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {vouchersWithRunningBalance.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-6 text-center text-zinc-400 text-xs">
                              هیچ سند اعتباری ثبت نشده است.
                            </td>
                          </tr>
                        ) : (
                          vouchersWithRunningBalance.map(v => (
                            <tr key={v.id} className="hover:bg-zinc-50 cursor-pointer" onClick={() => setSelectedVoucherForDetail(v)}>
                              <td className="py-2 px-3 font-mono font-bold text-zinc-800">#{v.voucherNumber}</td>
                              <td className="py-2 px-3 font-mono text-zinc-600">{v.date}</td>
                              <td className="py-2 px-3 text-zinc-800">{v.description}</td>
                              <td className="py-2 px-3 font-mono text-left text-zinc-800">{v.vDebit > 0 ? v.vDebit.toLocaleString() : '-'}</td>
                              <td className="py-2 px-3 font-mono text-left text-emerald-700 font-bold">{v.vCredit > 0 ? v.vCredit.toLocaleString() : '-'}</td>
                              <td className="py-2 px-3 font-mono text-left font-bold text-zinc-900">{v.runningBalance.toLocaleString()}</td>
                              <td className="py-2 px-3 text-center">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  v.runningNature === 'بستانکار' ? 'bg-emerald-100 text-emerald-800' : v.runningNature === 'بدهکار' ? 'bg-rose-100 text-rose-800' : 'bg-zinc-100 text-zinc-600'
                                }`}>
                                  {v.runningNature}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-center" onClick={e => e.stopPropagation()}>
                                <button
                                  onClick={() => setSelectedVoucherForDetail(v)}
                                  className="p-1 bg-zinc-100 hover:bg-emerald-100 text-zinc-700 hover:text-emerald-800 rounded transition text-[10px] font-bold inline-flex items-center gap-1"
                                >
                                  <Eye size={12} />
                                  <span>مشاهده / اصلاح</span>
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Associated Credit Files & Checks Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
                    <h4 className="text-xs font-bold text-zinc-800 mb-2 flex items-center gap-1.5">
                      <Shield size={14} className="text-emerald-600" />
                      پرونده‌های اعتباری ({agentCreditFiles.length})
                    </h4>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {agentCreditFiles.length === 0 ? (
                        <div className="text-[11px] text-zinc-400">پرونده‌ای ثبت نشده است.</div>
                      ) : (
                        agentCreditFiles.map(f => (
                          <div key={f.id} className="text-xs bg-white p-2 rounded border border-zinc-200 flex justify-between">
                            <span>پرونده #{f.id}</span>
                            <span className="font-mono">{f.requestedAmount.toLocaleString()} ریال</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
                    <h4 className="text-xs font-bold text-zinc-800 mb-2 flex items-center gap-1.5">
                      <CheckCircle size={14} className="text-blue-600" />
                      چک‌های دریافتی ({agentChecks.length})
                    </h4>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {agentChecks.length === 0 ? (
                        <div className="text-[11px] text-zinc-400">چکی ثبت نشده است.</div>
                      ) : (
                        agentChecks.map(c => (
                          <div key={c.id} className="text-xs bg-white p-2 rounded border border-zinc-200 flex justify-between">
                            <span>چک {c.checkNumber} ({c.bankName})</span>
                            <span className="font-mono">{c.amount.toLocaleString()} ریال</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="bg-zinc-50 p-3 sm:px-5 border-t border-zinc-200 flex justify-end">
                <button
                  onClick={() => setShowCreditSubAccountsModal(false)}
                  className="bg-emerald-700 text-white font-bold px-5 py-1.5 rounded-lg hover:bg-emerald-800 transition text-xs"
                >
                  بستن ریز حساب‌ها
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
