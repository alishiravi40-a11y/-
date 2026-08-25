import React, { useState, useMemo } from 'react';
import { Search, X, Calendar, DollarSign, Filter, CheckCircle, FileText, ShoppingCart, User, Landmark, Hash, CreditCard, ArrowLeft, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { AppState, Check, Invoice, JournalVoucher, Person } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { toEnglishDigits } from '../utils/accounting';

interface AdvancedSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'checks' | 'vouchers' | 'invoices';
  state: AppState;
  onSelectResult: (type: 'check' | 'voucher' | 'invoice', id: string) => void;
}

export default function AdvancedSearchModal({ isOpen, onClose, type, state, onSelectResult }: AdvancedSearchModalProps) {
  const [showResults, setShowResults] = useState(false);

  // Common fields
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState<number | ''>('');
  const [maxAmount, setMaxAmount] = useState<number | ''>('');

  // Checks specific
  const [checkNumber, setCheckNumber] = useState('');
  const [personName, setPersonName] = useState('');
  const [bankName, setBankName] = useState('');
  const [checkStatus, setCheckStatus] = useState('');

  // Vouchers specific
  const [voucherNumber, setVoucherNumber] = useState('');
  const [voucherDesc, setVoucherDesc] = useState('');
  const [accountCodeOrName, setAccountCodeOrName] = useState('');
  const [voucherStatus, setVoucherStatus] = useState('');
  const [voucherEntryAmount, setVoucherEntryAmount] = useState<number | ''>('');

  // Invoices specific
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [productCodeOrName, setProductCodeOrName] = useState('');
  const [invoiceType, setInvoiceType] = useState('');
  const [settlementType, setSettlementType] = useState('');

  const handleReset = () => {
    setStartDate(''); setEndDate(''); setMinAmount(''); setMaxAmount('');
    setCheckNumber(''); setPersonName(''); setBankName(''); setCheckStatus('');
    setVoucherNumber(''); setVoucherDesc(''); setAccountCodeOrName(''); setVoucherStatus(''); setVoucherEntryAmount('');
    setInvoiceNumber(''); setProductCodeOrName(''); setInvoiceType(''); setSettlementType('');
    setShowResults(false);
  };

  const handleSearch = () => {
    setShowResults(true);
  };

  // 1. CHECKS SEARCH
  const filteredChecks = useMemo(() => {
    if (type !== 'checks' || !showResults) return [];
    let result = [...state.checks];
    if (checkNumber) result = result.filter(c => c.checkNumber.includes(checkNumber) || c.sayadiNumber?.includes(checkNumber));
    if (startDate) result = result.filter(c => c.dueDate >= startDate);
    if (endDate) result = result.filter(c => c.dueDate <= endDate);
    if (minAmount) result = result.filter(c => c.amount >= minAmount);
    if (maxAmount) result = result.filter(c => c.amount <= maxAmount);
    if (bankName) result = result.filter(c => c.bankName.includes(bankName));
    if (checkStatus) result = result.filter(c => c.currentState === checkStatus);
    if (personName) {
      result = result.filter(c => {
        const p = state.persons.find(p => p.id === c.personId);
        return p && p.name.includes(personName);
      });
    }
    return result;
  }, [type, showResults, state.checks, state.persons, checkNumber, startDate, endDate, minAmount, maxAmount, bankName, checkStatus, personName]);

  // 2. VOUCHERS SEARCH
  const filteredVouchers = useMemo(() => {
    if (type !== 'vouchers' || !showResults) return [];
    let result = [...state.vouchers];
    if (voucherNumber) result = result.filter(v => v.voucherNumber.toString().includes(voucherNumber));
    if (startDate) result = result.filter(v => v.date >= startDate);
    if (endDate) result = result.filter(v => v.date <= endDate);
    if (minAmount) {
      result = result.filter(v => v.entries.reduce((sum, e) => sum + e.debit, 0) >= minAmount);
    }
    if (maxAmount) {
      result = result.filter(v => v.entries.reduce((sum, e) => sum + e.debit, 0) <= maxAmount);
    }
    if (voucherDesc) {
      result = result.filter(v => v.description.includes(voucherDesc) || v.entries.some(e => e.description && e.description.includes(voucherDesc)));
    }
    if (accountCodeOrName) {
      result = result.filter(v => v.entries.some(e => {
        const sub = state.subsidiaries.find(s => s.id === e.subsidiaryId);
        const matchSub = sub && (sub.name.includes(accountCodeOrName) || sub.code.includes(accountCodeOrName));
        const matchDetailed = e.floatingDetailed && e.floatingDetailed.name.includes(accountCodeOrName);
        return matchSub || matchDetailed;
      }));
    }
    if (voucherStatus) {
      if (voucherStatus === 'automatic') result = result.filter(v => v.isAutomatic);
      if (voucherStatus === 'manual') result = result.filter(v => !v.isAutomatic);
    }
    if (voucherEntryAmount) {
      result = result.filter(v => v.entries.some(e => e.debit === voucherEntryAmount || e.credit === voucherEntryAmount));
    }
    return result;
  }, [type, showResults, state.vouchers, state.subsidiaries, voucherNumber, startDate, endDate, minAmount, maxAmount, voucherDesc, accountCodeOrName, voucherStatus, voucherEntryAmount]);

  // 3. INVOICES SEARCH
  const filteredInvoices = useMemo(() => {
    if (type !== 'invoices' || !showResults) return [];
    let result = [...state.invoices].filter(i => !i.isProInvoice);
    if (invoiceNumber) result = result.filter(i => i.invoiceNumber.toString().includes(invoiceNumber));
    if (startDate) result = result.filter(i => i.date >= startDate);
    if (endDate) result = result.filter(i => i.date <= endDate);
    if (minAmount) result = result.filter(i => i.totalAmount >= minAmount);
    if (maxAmount) result = result.filter(i => i.totalAmount <= maxAmount);
    if (invoiceType) result = result.filter(i => i.type === invoiceType);
    if (personName) {
      result = result.filter(i => {
        const p = state.persons.find(p => p.id === i.personId);
        return p && p.name.includes(personName);
      });
    }
    if (productCodeOrName) {
      result = result.filter(i => i.items.some(it => {
        const prod = state.products.find(p => p.id === it.productId);
        return prod && (prod.name.includes(productCodeOrName) || prod.code.includes(productCodeOrName));
      }));
    }
    if (settlementType) {
      result = result.filter(i => {
        if (settlementType === 'cash') return (i.cashPaidAmount || 0) > 0;
        if (settlementType === 'pos') return (i.posPaidAmount || 0) > 0;
        if (settlementType === 'installment') return i.isInstallmentDeferred;
        return false; // we can refine this later
      });
    }
    return result;
  }, [type, showResults, state.invoices, state.persons, state.products, invoiceNumber, startDate, endDate, minAmount, maxAmount, invoiceType, personName, productCodeOrName, settlementType]);

  const getTitle = () => {
    if (type === 'checks') return 'جستجوی هوشمند چک‌ها';
    if (type === 'vouchers') return 'جستجوی هوشمند اسناد حسابداری';
    if (type === 'invoices') return 'جستجوی هوشمند فاکتورها';
    return '';
  };

  const getIcon = () => {
    if (type === 'checks') return <CreditCard className="text-purple-600" size={20} />;
    if (type === 'vouchers') return <FileText className="text-blue-600" size={20} />;
    if (type === 'invoices') return <ShoppingCart className="text-amber-600" size={20} />;
    return null;
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white rounded-xl shadow-sm border border-zinc-100">
                {getIcon()}
              </div>
              <div>
                <h2 className="font-sans font-bold text-zinc-800 text-lg">{getTitle()}</h2>
                <p className="font-sans text-xs text-zinc-500 mt-0.5">پیدا کردن سریع در تمام اطلاعات ثبت شده</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 text-zinc-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition">
              <X size={20} />
            </button>
          </div>

          <div className="p-5 overflow-y-auto flex-1">
            {!showResults ? (
              <div className="space-y-6">
                {/* Checks Form */}
                {type === 'checks' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">شماره چک / صیاد</label>
                      <div className="relative">
                        <Hash className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="text" value={checkNumber} onChange={(e) => setCheckNumber(toEnglishDigits(e.target.value))} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-mono text-sm text-zinc-800 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" placeholder="مثلاً 123456" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">نام مشتری (طرف حساب)</label>
                      <div className="relative">
                        <User className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="text" value={personName} onChange={(e) => setPersonName(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-sans text-sm text-zinc-800 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" placeholder="بخشی از نام..." />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">وضعیت چک</label>
                      <div className="relative">
                        <Filter className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <select value={checkStatus} onChange={(e) => setCheckStatus(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-sans text-sm text-zinc-800 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition appearance-none">
                          <option value="">همه وضعیت‌ها</option>
                          <option value="در صندوق">در صندوق</option>
                          <option value="در جریان وصول">در جریان وصول</option>
                          <option value="پاس شده">پاس شده</option>
                          <option value="برگشتی">برگشتی</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">بانک صادرکننده</label>
                      <div className="relative">
                        <Landmark className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="text" value={bankName} onChange={(e) => setBankName(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-sans text-sm text-zinc-800 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition" placeholder="مثلاً ملت، ملی..." />
                      </div>
                    </div>
                  </div>
                )}

                {/* Vouchers Form */}
                {type === 'vouchers' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">شماره سند</label>
                      <div className="relative">
                        <Hash className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="text" value={voucherNumber} onChange={(e) => setVoucherNumber(toEnglishDigits(e.target.value))} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-mono text-sm text-zinc-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition" placeholder="شماره دقیق سند" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">شرح سند (کلمات کلیدی)</label>
                      <div className="relative">
                        <FileText className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="text" value={voucherDesc} onChange={(e) => setVoucherDesc(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-sans text-sm text-zinc-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition" placeholder="متن شرح..." />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">نام یا کد حساب</label>
                      <div className="relative">
                        <Landmark className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="text" value={accountCodeOrName} onChange={(e) => setAccountCodeOrName(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-sans text-sm text-zinc-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition" placeholder="نام معین یا تفصیلی..." />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">نوع سند</label>
                      <div className="relative">
                        <Filter className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <select value={voucherStatus} onChange={(e) => setVoucherStatus(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-sans text-sm text-zinc-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition appearance-none">
                          <option value="">همه اسناد</option>
                          <option value="automatic">سیستمی (خودکار)</option>
                          <option value="manual">دستی</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">جستجوی مبلغ دقیق</label>
                      <div className="relative">
                        <DollarSign className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="number" inputMode="decimal" value={isNaN(voucherEntryAmount as any) ? '' : voucherEntryAmount} onChange={(e) => setVoucherEntryAmount(e.target.value ? Number(e.target.value) : '')} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-mono text-sm text-zinc-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition" placeholder="مبلغ ریالی..." />
                      </div>
                    </div>
                  </div>
                )}

                {/* Invoices Form */}
                {type === 'invoices' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">شماره فاکتور</label>
                      <div className="relative">
                        <Hash className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="text" inputMode="numeric" value={invoiceNumber} onChange={(e) => setInvoiceNumber(toEnglishDigits(e.target.value))} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-mono text-sm text-zinc-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition" placeholder="شماره فاکتور" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">نام طرف حساب</label>
                      <div className="relative">
                        <User className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="text" value={personName} onChange={(e) => setPersonName(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-sans text-sm text-zinc-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition" placeholder="مشتری یا تامین‌کننده..." />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-1.5">کد یا نام کالا</label>
                      <div className="relative">
                        <ShoppingCart className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input type="text" value={productCodeOrName} onChange={(e) => setProductCodeOrName(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-3 pr-9 py-2.5 font-sans text-sm text-zinc-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition" placeholder="مثلاً لپ‌تاپ..." />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-bold text-zinc-700 mb-1.5">نوع فاکتور</label>
                        <select value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 font-sans text-sm text-zinc-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition">
                          <option value="">همه</option>
                          <option value="sell">فروش</option>
                          <option value="buy">خرید</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-zinc-700 mb-1.5">تسویه</label>
                        <select value={settlementType} onChange={(e) => setSettlementType(e.target.value)} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 font-sans text-sm text-zinc-800 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition">
                          <option value="">همه</option>
                          <option value="cash">نقدی</option>
                          <option value="pos">کارتخوان</option>
                          <option value="installment">اقساطی</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Common Fields */}
                <div className="bg-zinc-100 h-px w-full my-6"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-zinc-500 mb-1.5">از تاریخ</label>
                      <div className="relative">
                        <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                        <input type="text" value={startDate} onChange={(e) => setStartDate(toEnglishDigits(e.target.value))} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-2 pr-8 py-2 font-mono text-xs text-zinc-800 text-center" placeholder="140X/XX/XX" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-zinc-500 mb-1.5">تا تاریخ</label>
                      <div className="relative">
                        <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                        <input type="text" value={endDate} onChange={(e) => setEndDate(toEnglishDigits(e.target.value))} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-2 pr-8 py-2 font-mono text-xs text-zinc-800 text-center" placeholder="140X/XX/XX" />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-zinc-500 mb-1.5">از مبلغ</label>
                      <div className="relative">
                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                        <input type="number" inputMode="decimal" value={isNaN(minAmount as any) ? '' : minAmount} onChange={(e) => setMinAmount(e.target.value ? Number(e.target.value) : '')} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-2 py-2 font-mono text-xs text-zinc-800 text-left" placeholder="0" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-zinc-500 mb-1.5">تا مبلغ</label>
                      <div className="relative">
                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                        <input type="number" inputMode="decimal" value={isNaN(maxAmount as any) ? '' : maxAmount} onChange={(e) => setMaxAmount(e.target.value ? Number(e.target.value) : '')} className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-2 py-2 font-mono text-xs text-zinc-800 text-left" placeholder="0" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-sans text-sm font-bold text-zinc-800">
                    نتایج جستجو (
                    {type === 'checks' ? filteredChecks.length : ''}
                    {type === 'vouchers' ? filteredVouchers.length : ''}
                    {type === 'invoices' ? filteredInvoices.length : ''}
                    ) مورد
                  </span>
                  <button onClick={() => setShowResults(false)} className="text-xs text-blue-600 font-bold flex items-center gap-1 hover:text-blue-700">
                    <span>تغییر فیلترها</span>
                    <ArrowLeft size={14} />
                  </button>
                </div>

                {type === 'checks' && filteredChecks.map(check => (
                  <div key={check.id} onClick={() => { onSelectResult('check', check.id); onClose(); }} className="bg-white p-3 rounded-xl border border-zinc-150 flex justify-between items-center cursor-pointer hover:border-purple-500/50 hover:shadow-md transition">
                    <div className="flex flex-col space-y-1">
                      <span className="font-bold text-sm text-zinc-800">چک شماره {check.checkNumber}</span>
                      <span className="text-[10px] text-zinc-500">{state.persons.find(p => p.id === check.personId)?.name} • {check.bankName}</span>
                    </div>
                    <div className="flex flex-col items-end space-y-1">
                      <span className="font-mono text-sm font-bold text-zinc-800">{check.amount.toLocaleString()} ریال</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${check.currentState === 'پاس شده' ? 'bg-emerald-100 text-emerald-700' : check.currentState === 'برگشتی' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                        {check.currentState}
                      </span>
                    </div>
                  </div>
                ))}

                {type === 'vouchers' && filteredVouchers.map(voucher => (
                  <div key={voucher.id} onClick={() => { onSelectResult('voucher', voucher.id); onClose(); }} className="bg-white p-3 rounded-xl border border-zinc-150 flex justify-between items-center cursor-pointer hover:border-blue-500/50 hover:shadow-md transition">
                    <div className="flex flex-col space-y-1">
                      <span className="font-bold text-sm text-zinc-800">سند شماره {voucher.voucherNumber}</span>
                      <span className="text-[10px] text-zinc-500 truncate max-w-[200px]">{voucher.description}</span>
                    </div>
                    <div className="flex flex-col items-end space-y-1">
                      <span className="font-mono text-sm font-bold text-blue-600">
                        {voucher.entries.reduce((s, e) => s + e.debit, 0).toLocaleString()} ریال
                      </span>
                      <span className="text-[10px] text-zinc-400">{voucher.date}</span>
                    </div>
                  </div>
                ))}

                {type === 'invoices' && filteredInvoices.map(invoice => (
                  <div key={invoice.id} onClick={() => { onSelectResult('invoice', invoice.id); onClose(); }} className="bg-white p-3 rounded-xl border border-zinc-150 flex justify-between items-center cursor-pointer hover:border-amber-500/50 hover:shadow-md transition">
                    <div className="flex flex-col space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-zinc-800">فاکتور {invoice.invoiceNumber}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${invoice.type === 'buy' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {invoice.type === 'buy' ? 'خرید' : 'فروش'}
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-500">{state.persons.find(p => p.id === invoice.personId)?.name}</span>
                    </div>
                    <div className="flex flex-col items-end space-y-1">
                      <span className="font-mono text-sm font-bold text-zinc-800">{invoice.totalAmount.toLocaleString()} ریال</span>
                      <span className="text-[10px] text-zinc-400">{invoice.date}</span>
                    </div>
                  </div>
                ))}

                {((type === 'checks' && filteredChecks.length === 0) || 
                  (type === 'vouchers' && filteredVouchers.length === 0) || 
                  (type === 'invoices' && filteredInvoices.length === 0)) && (
                  <div className="py-10 text-center text-zinc-500 text-sm flex flex-col items-center">
                    <Search className="text-zinc-300 mb-2" size={32} />
                    <span>موردی یافت نشد.</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex gap-3">
            {!showResults ? (
              <>
                <button onClick={handleSearch} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-xl shadow transition flex items-center justify-center gap-2">
                  <Search size={16} />
                  <span>اعمال فیلتر و جستجو</span>
                </button>
                <button onClick={handleReset} className="px-6 bg-white hover:bg-zinc-100 text-zinc-600 border border-zinc-200 font-bold py-3 rounded-xl transition">
                  پاک کردن
                </button>
              </>
            ) : (
              <button onClick={onClose} className="flex-1 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-bold py-3 rounded-xl transition">
                بستن صفحه
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
