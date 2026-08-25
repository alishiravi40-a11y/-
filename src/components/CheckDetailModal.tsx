import React, { useState } from 'react';
import { X, Calendar, Landmark, User, FileText, CheckCircle, AlertTriangle, Building2, Edit3, Save, RotateCcw, Check } from 'lucide-react';
import Barcode from 'react-barcode';
import { Check as CheckTypeModel, Person, AppState } from '../types';

interface CheckDetailModalProps {
  check: CheckTypeModel;
  appState: AppState;
  onClose: () => void;
  onEditCheck?: (updatedCheck: CheckTypeModel) => void;
  onViewVoucher?: (voucherId: string) => void;
}

export default function CheckDetailModal({ check, appState, onClose, onEditCheck, onViewVoucher }: CheckDetailModalProps) {
  const [currentCheck, setCurrentCheck] = useState<CheckTypeModel>(check);
  const [isEditing, setIsEditing] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // Form states for editing
  const [checkNumber, setCheckNumber] = useState(currentCheck.checkNumber || '');
  const [sayadiNumber, setSayadiNumber] = useState(currentCheck.sayadiNumber || '');
  const [bankName, setBankName] = useState(currentCheck.bankName || '');
  const [dueDate, setDueDate] = useState(currentCheck.dueDate || '');
  const [amount, setAmount] = useState<number | string>(currentCheck.amount || 0);
  const [personId, setPersonId] = useState(currentCheck.personId || '');
  const [nationalId, setNationalId] = useState(currentCheck.nationalId || '');
  const [isAmani, setIsAmani] = useState(currentCheck.isAmani || false);

  const person = appState.persons.find(p => p.id === currentCheck.personId);
  const agent = currentCheck.submittedByAgentId ? appState.persons.find(p => p.id === currentCheck.submittedByAgentId) : null;

  const handleSave = () => {
    const numericAmount = typeof amount === 'number' ? amount : (parseFloat(amount.replace(/,/g, '')) || 0);
    const updated: CheckTypeModel = {
      ...currentCheck,
      checkNumber,
      sayadiNumber,
      bankName,
      dueDate,
      amount: numericAmount,
      personId,
      nationalId,
      isAmani
    };

    setCurrentCheck(updated);
    if (onEditCheck) {
      onEditCheck(updated);
    }
    setIsEditing(false);
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3000);
  };

  const commonBanks = ['ملت', 'ملی', 'صادرات', 'تجارت', 'سپه', 'مسکن', 'سامان', 'پارسیان', 'پاسارگاد', 'کشاورزی', 'رفاه', 'کارآفرین', 'شهر'];

  return (
    <div className="fixed inset-0 bg-zinc-950/60 backdrop-blur-sm z-[100] flex justify-center items-center p-4 text-right">
      <div 
        className="w-full max-w-[440px] bg-white rounded-3xl shadow-2xl border border-zinc-100 overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-200"
        dir="rtl"
      >
        {/* Modal Header */}
        <div className="bg-zinc-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button 
              onClick={onClose}
              className="text-zinc-400 hover:text-white bg-white/10 hover:bg-white/20 p-1.5 rounded-xl transition"
              title="بستن"
            >
              <X size={16} />
            </button>
            {onEditCheck && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 text-[11px] font-bold px-2.5 py-1 rounded-xl transition flex items-center gap-1 border border-amber-500/30"
              >
                <Edit3 size={13} /> ویرایش مستقیم چک
              </button>
            )}
          </div>
          <div className="text-right">
            <h3 className="font-sans text-xs font-bold text-zinc-100">
              {isEditing ? 'اصلاح و ویرایش اطلاعات چک' : 'جزئیات چک'}
            </h3>
            <span className="font-mono text-xs font-bold text-indigo-300 block mt-0.5">
              شماره چک: <span className="text-white text-sm bg-indigo-500/30 px-1.5 py-0.5 rounded ml-1">{currentCheck.checkNumber}</span>
              <span className="text-[10px] text-zinc-400 font-sans mr-2">
                {currentCheck.type === 'received' ? 'دریافتی' : 'پرداختی'}
              </span>
            </span>
          </div>
        </div>

        {/* Notification Toast */}
        {showSuccessToast && (
          <div className="bg-emerald-600 text-white px-4 py-2 text-xs font-bold flex items-center justify-between animate-in fade-in slide-in-from-top duration-200">
            <span className="flex items-center gap-1.5">
              <Check size={15} /> تغییرات چک و تمامی اسناد دوبل مرتبط با موفقیت بروزرسانی شد.
            </span>
          </div>
        )}

        <div className="p-4 space-y-4 overflow-y-auto flex-1 font-sans">
          {isEditing ? (
            /* EDIT FORM MODE */
            <div className="space-y-3 text-xs">
              <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-xl text-amber-800 text-[11px] leading-relaxed">
                💡 <strong>توجه:</strong> با ویرایش این چک، تمامی مبالغ، شرح‌ها و طرف‌حساب‌های موجود در اسناد حسابداری مرتبط با این چک به صورت خودکار با اطلاعات جدید همگام‌سازی می‌شوند.
              </div>

              <div>
                <label className="block text-zinc-600 font-bold mb-1">نام بانک:</label>
                <input 
                  type="text" 
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 text-zinc-800 outline-none transition"
                  placeholder="مثال: تجارت، ملت..."
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {commonBanks.map(b => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBankName(b)}
                      className={`text-[10px] px-2 py-0.5 rounded-lg border transition ${bankName === b ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200'}`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-zinc-600 font-bold mb-1">شماره چک (سریال):</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    value={checkNumber}
                    onChange={(e) => setCheckNumber(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 font-mono text-zinc-800 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 font-bold mb-1">تاریخ سررسید (شمسی):</label>
                  <input 
                    type="text" 
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    placeholder="1403/01/01"
                    className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 font-mono text-zinc-800 outline-none transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-600 font-bold mb-1">مبلغ چک (ریال):</label>
                <input 
                  type="text" 
                  inputMode="decimal"
                  value={typeof amount === 'number' ? amount.toLocaleString() : amount}
                  onChange={(e) => {
                    const rawVal = e.target.value.replace(/,/g, '');
                    if (!isNaN(Number(rawVal)) || rawVal === '') {
                      setAmount(rawVal === '' ? 0 : Number(rawVal));
                    }
                  }}
                  className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 font-mono font-bold text-emerald-700 outline-none transition text-left"
                  dir="ltr"
                />
                {typeof amount === 'number' && amount > 0 && (
                  <span className="text-[10px] text-zinc-500 block text-right mt-0.5">
                    مبلغ: {amount.toLocaleString()} ریال
                  </span>
                )}
              </div>

              <div>
                <label className="block text-zinc-600 font-bold mb-1">
                  {currentCheck.type === 'received' ? 'صادرکننده / طرف حساب:' : 'دریافت‌کننده / طرف حساب:'}
                </label>
                <select
                  value={personId}
                  onChange={(e) => setPersonId(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 text-zinc-800 outline-none transition"
                >
                  <option value="">انتخاب کنید...</option>
                  {appState.persons.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.role === 'debtor' ? 'بدهکار' : p.role === 'creditor' ? 'بستانکار' : 'طرف حساب'})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-zinc-600 font-bold mb-1">شماره صیادی (16 رقمی):</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    value={sayadiNumber}
                    onChange={(e) => setSayadiNumber(e.target.value)}
                    maxLength={16}
                    className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 font-mono text-zinc-800 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-zinc-600 font-bold mb-1">کد ملی صادرکننده:</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 focus:border-indigo-500 rounded-xl px-3 py-2 font-mono text-zinc-800 outline-none transition"
                  />
                </div>
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-zinc-700 font-medium">
                  <input 
                    type="checkbox"
                    checked={isAmani}
                    onChange={(e) => setIsAmani(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                  <span>چک امانی / ضمانتی (بدون اثر مالی در دفاتر)</span>
                </label>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-3 rounded-xl transition flex items-center justify-center gap-1.5 shadow"
                >
                  <Save size={15} /> ثبت تغییرات چک و اسناد
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-1"
                >
                  <RotateCcw size={14} /> انصراف
                </button>
              </div>
            </div>
          ) : (
            /* READ-ONLY VIEW MODE */
            <>
              <div className="bg-zinc-50 p-3.5 rounded-2xl border border-zinc-150 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-zinc-500 flex items-center gap-1"><Landmark size={13} className="text-zinc-400" /> بانک:</span>
                  <strong className="text-zinc-800">{currentCheck.bankName}</strong>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-zinc-500 flex items-center gap-1"><Calendar size={13} className="text-zinc-400" /> تاریخ سررسید:</span>
                  <strong className="font-mono text-zinc-800">{currentCheck.dueDate}</strong>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-zinc-500 flex items-center gap-1"><User size={13} className="text-zinc-400" /> {currentCheck.type === 'received' ? 'صادرکننده:' : 'دریافت‌کننده:'}</span>
                  <strong className="text-zinc-800">{person?.name || 'ناشناس'}</strong>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-zinc-500 flex items-center gap-1"><CheckCircle size={13} className="text-zinc-400" /> مبلغ:</span>
                  <strong className="font-mono text-emerald-600 font-bold">{currentCheck.amount.toLocaleString()} ریال</strong>
                </div>
                {currentCheck.sayadiNumber && (
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-500 flex items-center gap-1"><FileText size={13} className="text-zinc-400" /> صیادی:</span>
                      <strong className="font-mono text-zinc-800">{currentCheck.sayadiNumber}</strong>
                    </div>
                    {currentCheck.sayadiNumber.trim().length > 0 && (
                      <div className="pt-1 flex flex-col items-center justify-center bg-white p-2 border border-zinc-200 rounded-xl">
                        <Barcode 
                          value={currentCheck.sayadiNumber.trim()} 
                          format="CODE128" 
                          width={1.3} 
                          height={40} 
                          displayValue={false} 
                          margin={0} 
                          background="#ffffff" 
                          lineColor="#000000" 
                        />
                      </div>
                    )}
                  </div>
                )}
                {currentCheck.nationalId && (
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-500 flex items-center gap-1"><FileText size={13} className="text-zinc-400" /> کد ملی:</span>
                    <strong className="font-mono text-zinc-800">{currentCheck.nationalId}</strong>
                  </div>
                )}
                {agent && (
                  <div className="flex justify-between items-center text-xs pt-2 border-t border-zinc-200">
                    <span className="text-zinc-500 flex items-center gap-1"><Building2 size={13} className="text-indigo-400" /> ثبت شده توسط نماینده:</span>
                    <strong className="text-indigo-700">{agent.name}</strong>
                  </div>
                )}
                {currentCheck.isAmani && (
                  <div className="bg-amber-100/70 border border-amber-200 text-amber-800 px-2.5 py-1 rounded-lg text-[10px] font-bold">
                    ⚠️ چک امانی / ضمانتی (فاقد گردش مالی مستقیم)
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="font-sans text-xs font-bold text-zinc-800 flex items-center gap-1">
                  <Calendar size={14} className="text-zinc-500" /> سوابق وضعیت چک
                </h4>
                <div className="space-y-2">
                  {currentCheck.history.map((h, idx) => (
                    <div key={idx} className="bg-white border border-zinc-150 p-3 rounded-xl text-xs space-y-2 shadow-xs">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-zinc-800">{h.state === 'present_in_cashbox' ? 'موجود در صندوق' : h.state === 'bounced' ? 'برگشتی' : h.state === 'cleared' ? 'وصول شده' : h.state === 'deposited_to_bank' ? 'واگذار شده به بانک' : h.state === 'passed_to_others' ? 'خرج شده' : h.state}</span>
                        <span className="font-mono text-[10px] text-zinc-400">{h.date}</span>
                      </div>
                      {h.note && <p className="text-[10px] text-zinc-500 bg-zinc-50 p-1.5 rounded">{h.note}</p>}
                      {(() => {
                        const linkedVoucherId = h.voucherId || appState.vouchers.find(v => v.sourceId === currentCheck.id || v.id.includes(currentCheck.id))?.id;
                        if (!linkedVoucherId || !onViewVoucher) return null;
                        return (
                          <button 
                            onClick={() => {
                              onClose();
                              onViewVoucher(linkedVoucherId);
                            }}
                            className="text-[10px] text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1 font-medium pt-1 border-t border-zinc-100"
                          >
                            <FileText size={10} /> مشاهده سند حسابداری مرتبط (دوبل)
                          </button>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="pt-2 flex gap-2">
                {onEditCheck && (
                  <button 
                    onClick={() => setIsEditing(true)}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2.5 px-3 rounded-xl transition flex items-center justify-center gap-1.5 shadow"
                  >
                    <Edit3 size={15} /> ویرایش چک
                  </button>
                )}
                <button 
                  onClick={onClose}
                  className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 px-4 rounded-xl transition"
                >
                  بستن
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
