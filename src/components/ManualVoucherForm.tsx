/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Save, AlertTriangle, ArrowLeft, CheckCircle, Scale, ToggleLeft, ToggleRight, FileText, ArrowLeftRight, HelpCircle, Search } from 'lucide-react';
import { AccountSubsidiary, Person, JournalVoucher, VoucherEntry, BusinessPartner } from '../types';
import { getCurrentJalaliDate } from '../utils/jalali';
import { DEFAULT_SUBSIDIARIES, parseNumericValue, toEnglishDigits } from '../utils/accounting';
import PersonSelector from './PersonSelector';
import AccountSubsidiarySelector from './AccountSubsidiarySelector';
import { useCoaReadModel } from '../services/CoaReadService';

interface ManualVoucherFormProps {
  subsidiaries?: AccountSubsidiary[];
  persons: Person[];
  onSubmit: (voucherData: Omit<JournalVoucher, 'id' | 'voucherNumber' | 'gregorianDate' | 'isAutomatic'>) => void;
  onCancel: () => void;
  onNew?: () => void;
  onDelete?: (id: string) => void;
  nextVoucherNumber: number;
  initialVoucher?: JournalVoucher;
  onOpenAdvancedSearch?: () => void;
  businessPartners?: BusinessPartner[];
}

export default function ManualVoucherForm({
  subsidiaries: propSubsidiaries,
  persons,
  onSubmit,
  onCancel,
  onNew,
  onDelete,
  nextVoucherNumber,
  initialVoucher,
  onOpenAdvancedSearch,
  businessPartners = []
}: ManualVoucherFormProps) {
  const { subsidiaries: activeSubsidiaries } = useCoaReadModel(propSubsidiaries);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [date, setDate] = useState(initialVoucher?.date || getCurrentJalaliDate());
  const [mode, setMode] = useState<'simple' | 'advanced'>(initialVoucher ? 'advanced' : 'simple');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- SIMPLE MODE STATES ---
  const [debtorType, setDebtorType] = useState<'person' | 'subsidiary'>('subsidiary');
  const [debtorPersonId, setDebtorPersonId] = useState('');
  const [debtorSubId, setDebtorSubId] = useState('SUB_BANK_MELI');

  const [creditorType, setCreditorType] = useState<'person' | 'subsidiary'>('person');
  const [creditorPersonId, setCreditorPersonId] = useState('');
  const [creditorSubId, setCreditorSubId] = useState('SUB_CASH_MAIN');

  const [simpleAmount, setSimpleAmount] = useState<number>(0);
  const [simpleDescription, setSimpleDescription] = useState('');

  // --- ADVANCED MODE STATES ---
  const [description, setDescription] = useState(initialVoucher?.description || '');
  const [entries, setEntries] = useState<VoucherEntry[]>(
    initialVoucher?.entries || [
      { subsidiaryId: 'SUB_CASH_MAIN', debit: 0, credit: 0 },
      { subsidiaryId: 'SUB_EXP_BILLS', debit: 0, credit: 0 }
    ]
  );

  // Set default selected person IDs once persons are loaded
  useEffect(() => {
    if (persons && persons.length > 0) {
      if (!debtorPersonId) setDebtorPersonId(persons[0].id);
      if (!creditorPersonId) setCreditorPersonId(persons.length > 1 ? persons[1].id : persons[0].id);
    }
  }, [persons]);

  // Handle advanced row additions
  const handleAddRow = () => {
    setEntries([...entries, { subsidiaryId: 'SUB_CASH_MAIN', debit: 0, credit: 0 }]);
  };

  const handleRemoveRow = (index: number) => {
    if (entries.length <= 2) return;
    setEntries(entries.filter((_, i) => i !== index));
  };

  const handleRowChange = (index: number, field: keyof VoucherEntry, value: any) => {
    const updated = [...entries];
    if (field === 'debit') {
      const parsed = parseNumericValue(value);
      updated[index].debit = parsed;
      if (parsed > 0) updated[index].credit = 0; // mutually exclusive
    } else if (field === 'credit') {
      const parsed = parseNumericValue(value);
      updated[index].credit = parsed;
      if (parsed > 0) updated[index].debit = 0; // mutually exclusive
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setEntries(updated);
  };

  const handleFloatingChange = (index: number, personId: string) => {
    const updated = [...entries];
    const person = persons.find(p => p.id === personId);
    if (person) {
      updated[index].floatingDetailed = {
         type: 'person',
         id: person.id,
         name: person.name
      };
    } else {
      updated[index].floatingDetailed = undefined;
    }
    setEntries(updated);
  };

  // Advanced mode validation & math
  const totals = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    entries.forEach(e => {
      totalDebit += e.debit;
      totalCredit += e.credit;
    });
    const difference = Math.abs(totalDebit - totalCredit);
    const isBalanced = totalDebit > 0 && totalDebit === totalCredit;
    return {
      totalDebit,
      totalCredit,
      difference,
      isBalanced
    };
  }, [entries]);

  // Simple Mode dynamic explanation
  const simpleExplanation = useMemo(() => {
    if (simpleAmount <= 0) return '';
    
    let debtorName = '';
    if (debtorType === 'person') {
      debtorName = persons.find(p => p.id === debtorPersonId)?.name || 'شخص بدهکار';
    } else {
      debtorName = activeSubsidiaries.find(s => s.id === debtorSubId)?.name || 'حساب بدهکار';
    }

    let creditorName = '';
    if (creditorType === 'person') {
      creditorName = persons.find(p => p.id === creditorPersonId)?.name || 'شخص بستانکار';
    } else {
      creditorName = activeSubsidiaries.find(s => s.id === creditorSubId)?.name || 'حساب بستانکار';
    }

    const rialsFormatted = simpleAmount.toLocaleString();
    const tomansFormatted = Math.floor(simpleAmount / 10).toLocaleString();

    return `مبلغ ${rialsFormatted} ریال (${tomansFormatted} تومان) از حساب/شخص «${creditorName}» کسر (بستانکار) شده و به حساب/شخص «${debtorName}» اضافه (بدهکار) می‌شود.`;
  }, [simpleAmount, debtorType, debtorPersonId, debtorSubId, creditorType, creditorPersonId, creditorSubId, persons, activeSubsidiaries]);

  // Submit Handler for Simple Mode
  const handleSimpleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!simpleDescription.trim()) {
      alert("لطفاً شرح سند را وارد کنید.");
      return;
    }
    if (simpleAmount <= 0) {
      alert("لطفاً مبلغ سند را معتبر وارد کنید.");
      return;
    }

    // Build standard double entry
    const finalEntries: VoucherEntry[] = [];

    // 1. Debtor (بدهکار - receives value)
    if (debtorType === 'person') {
      const p = persons.find(person => person.id === debtorPersonId);
      if (!p) {
        alert("لطفاً شخص بدهکار را انتخاب کنید.");
        return;
      }
      finalEntries.push({
        subsidiaryId: 'SUB_DEBTORS',
        floatingDetailed: { type: 'person', id: p.id, name: p.name },
        debit: simpleAmount,
        credit: 0,
        description: simpleDescription.trim()
      });
    } else {
      if (!debtorSubId) {
        alert("لطفاً حساب معین بدهکار را انتخاب کنید.");
        return;
      }
      finalEntries.push({
        subsidiaryId: debtorSubId,
        debit: simpleAmount,
        credit: 0,
        description: simpleDescription.trim()
      });
    }

    // 2. Creditor (بستانکار - gives/reduces value)
    if (creditorType === 'person') {
      const p = persons.find(person => person.id === creditorPersonId);
      if (!p) {
        alert("لطفاً شخص بستانکار را انتخاب کنید.");
        return;
      }
      finalEntries.push({
        subsidiaryId: 'SUB_DEBTORS',
        floatingDetailed: { type: 'person', id: p.id, name: p.name },
        debit: 0,
        credit: simpleAmount,
        description: simpleDescription.trim()
      });
    } else {
      if (!creditorSubId) {
        alert("لطفاً حساب معین بستانکار را انتخاب کنید.");
        return;
      }
      finalEntries.push({
        subsidiaryId: creditorSubId,
        debit: 0,
        credit: simpleAmount,
        description: simpleDescription.trim()
      });
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        date,
        description: simpleDescription.trim(),
        entries: finalEntries,
        sourceType: 'manual',
        contractType: 'credit'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Handler for Advanced Mode
  const handleAdvancedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!description.trim()) {
      alert("لطفاً شرح کلی سند را وارد کنید.");
      return;
    }
    if (!totals.isBalanced) {
      alert(`سند موازنه نیست! تفاضل بدهکار و بستانکار: ${totals.difference.toLocaleString()} ریال است.`);
      return;
    }
    
    // Ensure all entries have valid debits/credits
    const invalid = entries.some(e => e.debit === 0 && e.credit === 0);
    if (invalid) {
      alert("تمامی ردیف‌ها باید دارای مبلغ بدهکار یا بستانکار باشند.");
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        date,
        description: description.trim(),
        entries,
        sourceType: 'manual',
        contractType: 'credit'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 pb-20">
      {/* Subheader */}
      <div className="bg-white border-b border-zinc-100 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-800 p-1 w-8">
          <ArrowLeft size={18} />
        </button>
        <div className="text-center">
          <span className="font-sans text-sm font-bold text-zinc-800 block">
            {initialVoucher ? 'اصلاح سند حسابداری دستی' : 'صدور سند حسابداری دستی'}
          </span>
          <div className="font-mono text-xs text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded-lg inline-block mt-1">
            شماره سند: {nextVoucherNumber}
          </div>
        </div>
        <div className="w-8">
          {onOpenAdvancedSearch && (
            <button type="button" onClick={onOpenAdvancedSearch} className="text-zinc-500 hover:text-emerald-600 p-1">
              <Search size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        {/* Date Panel */}
        <div className="bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm">
          <label className="block font-sans text-xs font-semibold text-zinc-700 text-right mb-1">تاریخ ثبت سند</label>
          <input
            type="text"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 font-mono text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-center"
            dir="ltr"
            required
          />
        </div>

        {/* Mode Toggle Switch */}
        {!initialVoucher && (
          <div className="bg-white p-1 rounded-xl border border-zinc-150 shadow-sm flex">
            <button
              type="button"
              onClick={() => setMode('simple')}
              className={`flex-1 py-2 rounded-lg font-sans text-xs font-bold transition-all flex items-center justify-center space-x-1.5 space-x-reverse ${
                mode === 'simple'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <ArrowLeftRight size={14} />
              <span>سند ساده دوطرفه (آسان)</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('advanced')}
              className={`flex-1 py-2 rounded-lg font-sans text-xs font-bold transition-all flex items-center justify-center space-x-1.5 space-x-reverse ${
                mode === 'advanced'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <Scale size={14} />
              <span>سند پیشرفته چند آرتیکلی</span>
            </button>
          </div>
        )}

        {/* =======================================================
            SIMPLE MODE FORM
            ======================================================= */}
        {mode === 'simple' && (
          <form onSubmit={handleSimpleSubmit} className="space-y-4">
            {/* Simple Mode Explanation Guide */}
            <div className="bg-sky-50 border border-sky-100 p-3 rounded-2xl text-right font-sans text-xs text-sky-800 flex items-start space-x-2 space-x-reverse">
              <HelpCircle size={16} className="text-sky-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold mb-1">راهنمای سند ساده:</p>
                <p className="leading-relaxed">
                  در این حالت برای جابجایی حساب، فقط یک حساب/شخص را بستانکار (پرداخت‌کننده) و یک حساب/شخص دیگر را بدهکار (دریافت‌کننده) مشخص می‌کنید. سیستم به صورت خودکار آرتیکل‌های حسابداری آن را تراز صادر می‌کند.
                </p>
              </div>
            </div>

            {/* DEBTOR CARD (بدهکار / دریافت‌کننده وجه) */}
            <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                <span className="bg-red-50 text-red-700 px-2.5 py-0.5 rounded-full font-sans text-[10px] font-bold">بدهکار</span>
                <span className="font-sans text-xs font-bold text-zinc-800">۱. دریافت‌کننده وجه یا افزایش دارایی</span>
              </div>

              {/* Toggle Category */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDebtorType('subsidiary')}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                    debtorType === 'subsidiary'
                      ? 'bg-zinc-800 border-zinc-800 text-white'
                      : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'
                  }`}
                >
                  بانک / صندوق / حساب معین
                </button>
                <button
                  type="button"
                  onClick={() => setDebtorType('person')}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                    debtorType === 'person'
                      ? 'bg-zinc-800 border-zinc-800 text-white'
                      : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'
                  }`}
                >
                  یک شخص (طرف حساب)
                </button>
              </div>

              {/* Select target */}
              {debtorType === 'person' ? (
                <div>
                  <PersonSelector
                    persons={persons}
                    selectedPersonId={debtorPersonId}
                    onSelect={setDebtorPersonId}
                    label="انتخاب شخص بدهکار"
                    placeholder="جستجو و انتخاب شخص بدهکار..."
                    businessPartners={businessPartners}
                  />
                </div>
              ) : (
                <div>
                  <AccountSubsidiarySelector
                    subsidiaries={activeSubsidiaries}
                    selectedSubId={debtorSubId}
                    onSelect={setDebtorSubId}
                    label="انتخاب حساب معین بدهکار"
                    placeholder="جستجو و انتخاب حساب معین بدهکار..."
                  />
                </div>
              )}
            </div>

            {/* CREDITOR CARD (بستانکار / پرداخت‌کننده وجه) */}
            <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                <span className="bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full font-sans text-[10px] font-bold">بستانکار</span>
                <span className="font-sans text-xs font-bold text-zinc-800">۲. پرداخت‌کننده وجه یا کاهش دارایی</span>
              </div>

              {/* Toggle Category */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCreditorType('subsidiary')}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                    creditorType === 'subsidiary'
                      ? 'bg-zinc-800 border-zinc-800 text-white'
                      : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'
                  }`}
                >
                  بانک / صندوق / حساب معین
                </button>
                <button
                  type="button"
                  onClick={() => setCreditorType('person')}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                    creditorType === 'person'
                      ? 'bg-zinc-800 border-zinc-800 text-white'
                      : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'
                  }`}
                >
                  یک شخص (طرف حساب)
                </button>
              </div>

              {/* Select target */}
              {creditorType === 'person' ? (
                <div>
                  <PersonSelector
                    persons={persons}
                    selectedPersonId={creditorPersonId}
                    onSelect={setCreditorPersonId}
                    label="انتخاب شخص بستانکار"
                    placeholder="جستجو و انتخاب شخص بستانکار..."
                    businessPartners={businessPartners}
                  />
                </div>
              ) : (
                <div>
                  <AccountSubsidiarySelector
                    subsidiaries={activeSubsidiaries}
                    selectedSubId={creditorSubId}
                    onSelect={setCreditorSubId}
                    label="انتخاب حساب معین بستانکار"
                    placeholder="جستجو و انتخاب حساب معین بستانکار..."
                  />
                </div>
              )}
            </div>

            {/* AMOUNT AND DESCRIPTION */}
            <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-4">
              <div>
                <label className="block font-sans text-xs font-semibold text-zinc-700 text-right mb-1">مبلغ سند (ریال)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={simpleAmount > 0 ? simpleAmount.toLocaleString() : ''}
                  onChange={(e) => setSimpleAmount(parseNumericValue(e.target.value))}
                  placeholder="مبلغ انتقال به ریال"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 font-mono text-sm text-zinc-800 focus:outline-none focus:border-emerald-500 text-center"
                  required
                />
                
                {simpleAmount > 0 && (
                  <div className="flex flex-col space-y-1 mt-1.5 p-2 bg-emerald-50/50 rounded-lg text-center font-sans">
                    <span className="text-[10px] text-zinc-500">مبلغ به حروف و تفکیک:</span>
                    <strong className="text-emerald-700 text-xs font-mono">{simpleAmount.toLocaleString()} ریال</strong>
                    <strong className="text-zinc-600 text-[10px] font-mono">({Math.floor(simpleAmount / 10).toLocaleString()} تومان)</strong>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-sans text-xs font-semibold text-zinc-700 text-right mb-1">بابت / شرح سند</label>
                <input
                  type="text"
                  value={simpleDescription}
                  onChange={(e) => setSimpleDescription(e.target.value)}
                  placeholder="مثال: واریزی به حساب بابت بدهی خرید فاکتور"
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3.5 py-2.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                  required
                />
              </div>
            </div>

            {/* Dynamic translation explainer card */}
            {simpleAmount > 0 && (
              <div className="bg-emerald-50 border border-emerald-100 p-3.5 rounded-2xl text-right font-sans text-xs text-emerald-800 leading-relaxed shadow-sm">
                <span className="font-bold block mb-1">پیش‌نمایش رویداد مالی سند:</span>
                {simpleExplanation}
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex space-x-2 space-x-reverse w-full">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-400 text-white font-sans text-xs font-bold py-3 rounded-xl shadow-md transition"
                >
                  <div className="flex items-center justify-center space-x-1.5 space-x-reverse">
                    <Save size={15} />
                    <span>{isSubmitting ? 'در حال ثبت در پایگاه داده...' : (initialVoucher ? 'ثبت تغییرات سند' : 'ثبت سند آسان')}</span>
                  </div>
                </button>
                {initialVoucher && onDelete && (
                  <button
                    type="button"
                    onClick={() => setShowConfirmDelete(true)}
                    className="flex-1 bg-red-600 hover:bg-red-500 text-white font-sans text-xs font-bold py-3 rounded-xl shadow-md transition"
                  >
                    حذف سند
                  </button>
                )}
                <button
                  type="button"
                  onClick={onCancel}
                  className={`${initialVoucher ? 'px-4' : 'px-6'} bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-sans text-xs font-semibold py-3 rounded-xl transition`}
                >
                  انصراف
                </button>
              </div>
              {onNew && (
                <button
                  type="button"
                  onClick={onNew}
                  className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-sans text-xs font-bold py-3 rounded-xl border border-zinc-200 transition flex items-center justify-center gap-2"
                >
                  <Plus size={16} />
                  ثبت سند جدید (خالی)
                </button>
              )}
            </div>
          </form>
        )}

        {/* =======================================================
            ADVANCED MODE FORM (MULTI-ROW DOUBLE ENTRY)
            ======================================================= */}
        {mode === 'advanced' && (
          <form onSubmit={handleAdvancedSubmit} className="space-y-4">
            {/* Header description */}
            <div className="bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm">
              <label className="block font-sans text-xs font-semibold text-zinc-700 text-right mb-1">شرح کلی سند (آرتیکل)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="مثال: پرداخت هزینه شارژ ساختمان فروردین‌ماه"
                className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                required
              />
            </div>

            {/* Voucher Rows Title */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleAddRow}
                className="flex items-center space-x-1.5 space-x-reverse text-xs text-emerald-600 font-semibold hover:text-emerald-500 bg-emerald-50 hover:bg-emerald-100/60 px-3 py-1.5 rounded-lg transition"
              >
                <Plus size={14} />
                <span>افزودن آرتیکل (ردیف)</span>
              </button>
              <span className="font-sans text-xs font-bold text-zinc-800 text-right">آرتیکل‌های سند دوبل</span>
            </div>

            {/* Rows */}
            <div className="space-y-3">
              {entries.map((entry, index) => (
                <div key={index} className="bg-white p-3.5 rounded-2xl border border-zinc-150 shadow-sm space-y-3 relative">
                  <div className="flex items-center justify-between">
                    {entries.length > 2 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(index)}
                        className="text-red-500 hover:text-red-600 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <span className="font-sans text-[10px] font-bold text-zinc-400">ردیف {index + 1}</span>
                  </div>

                  {/* Subsidiary Account Selector */}
                  <div>
                    <AccountSubsidiarySelector
                      subsidiaries={activeSubsidiaries}
                      selectedSubId={entry.subsidiaryId}
                      onSelect={(val) => handleRowChange(index, 'subsidiaryId', val)}
                      label="حساب معین"
                      placeholder="جستجو و انتخاب حساب معین..."
                    />
                  </div>

                  {/* Floating Detailed (Optional) */}
                  <div>
                    <PersonSelector
                      persons={persons}
                      selectedPersonId={entry.floatingDetailed?.id || ''}
                      onSelect={(val) => handleFloatingChange(index, val)}
                      label="تفصیلی شناور (شخص)"
                      placeholder="انتخاب تفصیلی شناور..."
                      allowClear={true}
                      businessPartners={businessPartners}
                    />
                  </div>

                  {/* Debit & Credit Inputs */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-zinc-500 text-right mb-0.5">بدهکار (ریال)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={entry.debit > 0 ? entry.debit.toLocaleString() : ''}
                        onChange={(e) => handleRowChange(index, 'debit', e.target.value)}
                        placeholder="بدهکار"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1.5 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-500 text-right mb-0.5">بستانکار (ریال)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={entry.credit > 0 ? entry.credit.toLocaleString() : ''}
                        onChange={(e) => handleRowChange(index, 'credit', e.target.value)}
                        placeholder="بستانکار"
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1.5 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Ledger Balancing Scale indicator */}
            <div className={`p-4 rounded-2xl border flex flex-col space-y-2 text-right font-sans text-xs shadow-sm ${
              totals.isBalanced 
                ? 'bg-emerald-50/75 border-emerald-100 text-emerald-800' 
                : 'bg-rose-50 border-rose-100 text-rose-800'
            }`}>
              <div className="flex items-center justify-between">
                <Scale size={16} className={totals.isBalanced ? 'text-emerald-500 animate-bounce' : 'text-rose-500'} />
                <span className="font-bold">وضعیت تراز دوبل سند</span>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-center pt-1 font-mono text-xs font-semibold">
                <div className="bg-white/40 p-1.5 rounded-lg border border-zinc-200/20">
                  <span className="block text-[8px] text-zinc-500">جمع کل بدهکار:</span>
                  <span className={totals.isBalanced ? 'text-emerald-600' : 'text-rose-600'}>{totals.totalDebit.toLocaleString()} ریال</span>
                </div>
                <div className="bg-white/40 p-1.5 rounded-lg border border-zinc-200/20">
                  <span className="block text-[8px] text-zinc-500">جمع کل بستانکار:</span>
                  <span className={totals.isBalanced ? 'text-emerald-600' : 'text-rose-600'}>{totals.totalCredit.toLocaleString()} ریال</span>
                </div>
              </div>

              {!totals.isBalanced && (
                <div className="text-[10px] font-medium leading-relaxed pt-1 flex items-center space-x-1 space-x-reverse justify-end text-rose-700">
                  <span>تفاضل موازنه: {totals.difference.toLocaleString()} ریال (باید صفر شود)</span>
                  <AlertTriangle size={12} />
                </div>
              )}
              {totals.isBalanced && (
                <div className="text-[10px] font-bold pt-1 text-center text-emerald-700">
                  ✓ سند کاملاً موازنه و آماده ذخیره است.
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex space-x-2 space-x-reverse w-full">
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-400 text-white font-sans text-xs font-bold py-3 rounded-xl shadow-md transition"
                  disabled={!totals.isBalanced || isSubmitting}
                >
                  <div className="flex items-center justify-center space-x-1.5 space-x-reverse">
                    <Save size={15} />
                    <span>{isSubmitting ? 'در حال ثبت در پایگاه داده...' : (initialVoucher ? 'ثبت تغییرات در روزنامه' : 'ثبت سند در دفتر روزنامه')}</span>
                  </div>
                </button>
                {initialVoucher && onDelete && (
                  <button
                    type="button"
                    onClick={() => setShowConfirmDelete(true)}
                    className="flex-1 bg-red-600 hover:bg-red-500 text-white font-sans text-xs font-bold py-3 rounded-xl shadow-md transition"
                  >
                    حذف سند
                  </button>
                )}
                <button
                  type="button"
                  onClick={onCancel}
                  className={`${initialVoucher ? 'px-4' : 'px-6'} bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-sans text-xs font-semibold py-3 rounded-xl transition`}
                >
                  انصراف
                </button>
              </div>
              {onNew && (
                <button
                  type="button"
                  onClick={onNew}
                  className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-sans text-xs font-bold py-3 rounded-xl border border-zinc-200 transition flex items-center justify-center gap-2"
                >
                  <Plus size={16} />
                  ثبت سند جدید (خالی)
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      {/* Confirmation Modal for Delete */}
      {showConfirmDelete && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm text-center space-y-4">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <Trash2 size={32} />
            </div>
            <h3 className="font-sans text-lg font-bold text-zinc-800">حذف سند حسابداری</h3>
            <p className="font-sans text-sm text-zinc-500 leading-relaxed">
              آیا از حذف این سند حسابداری مطمئن هستید؟ این عملیات غیرقابل بازگشت است.
            </p>
            <div className="flex space-x-2 space-x-reverse">
              <button
                onClick={() => {
                  onDelete?.(initialVoucher!.id);
                  setShowConfirmDelete(false);
                }}
                className="flex-1 bg-red-600 text-white font-sans text-sm font-bold py-3 rounded-xl"
              >
                بله، حذف شود
              </button>
              <button
                onClick={() => setShowConfirmDelete(false)}
                className="flex-1 bg-zinc-100 text-zinc-700 font-sans text-sm font-bold py-3 rounded-xl"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
