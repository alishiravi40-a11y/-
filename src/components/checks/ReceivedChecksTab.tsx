import React from 'react';
import { Calendar, FileText, CheckCircle, Edit2, Trash2 } from 'lucide-react';
import { Check as CheckTypeModel, Person, AccountSubsidiary } from '../../types';

interface ReceivedChecksTabProps {
  checks: CheckTypeModel[];
  filteredChecks: CheckTypeModel[];
  persons: Person[];
  quickFilter: 'all' | 'present_in_cashbox' | 'deposited_to_bank' | 'bounced';
  handleQuickFilterClick: (filter: 'all' | 'present_in_cashbox' | 'deposited_to_bank' | 'bounced') => void;
  selectedBulkChecks: string[];
  setSelectedBulkChecks: React.Dispatch<React.SetStateAction<string[]>>;
  selectedCheckForStateChange: CheckTypeModel | null;
  setSelectedCheckForStateChange: (check: CheckTypeModel | null) => void;
  onOpenDossier: (check: CheckTypeModel) => void;
  currentUserRole?: 'admin' | 'agent';
  onApproveCheck?: (checkId: string) => void;
  onEditCheck?: (check: CheckTypeModel) => void;
  onDeleteCheck?: (checkId: string, reason?: string) => void;
  setConfirmationModal: (modal: { isOpen: boolean; title: string; message: string; onConfirm: () => void } | null) => void;
  getStateLabel: (state: string, subState?: string) => string;
  getStateColor: (state: string) => string;
  onStartEditCheck: (check: CheckTypeModel) => void;
}

export default function ReceivedChecksTab({
  checks,
  filteredChecks,
  persons,
  quickFilter,
  handleQuickFilterClick,
  selectedBulkChecks,
  setSelectedBulkChecks,
  selectedCheckForStateChange,
  setSelectedCheckForStateChange,
  onOpenDossier,
  currentUserRole = 'admin',
  onApproveCheck,
  onEditCheck,
  onDeleteCheck,
  setConfirmationModal,
  getStateLabel,
  getStateColor,
  onStartEditCheck
}: ReceivedChecksTabProps) {
  const receivedChecks = checks.filter(c => c.type === 'received');

  return (
    <div className="space-y-3" dir="rtl">
      {/* Quick Filters Header */}
      <div className="space-y-2.5 mb-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-sans">
          {/* 1. نزد صندوق */}
          <button
            type="button"
            id="btn-quick-filter-cashbox"
            onClick={() => handleQuickFilterClick('present_in_cashbox')}
            className={`flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all duration-200 cursor-pointer ${
              quickFilter === 'present_in_cashbox'
                ? 'bg-emerald-600 text-white border-emerald-700 shadow-md scale-[1.02]'
                : 'bg-white text-emerald-700 border-zinc-150 hover:bg-emerald-50 hover:border-emerald-200'
            }`}
          >
            <div className="flex items-center space-x-1.5 space-x-reverse">
              <span className={`w-2 h-2 rounded-full ${quickFilter === 'present_in_cashbox' ? 'bg-white' : 'bg-emerald-500'}`} />
              <span>نزد صندوق</span>
            </div>
            <span className={`px-1.5 py-0.5 rounded-lg text-[10px] ${quickFilter === 'present_in_cashbox' ? 'bg-emerald-500/35 text-white' : 'bg-emerald-50 text-emerald-800'}`}>
              {receivedChecks.filter(c => c.currentState === 'present_in_cashbox').length}
            </span>
          </button>

          {/* 2. نزد بانک */}
          <button
            type="button"
            id="btn-quick-filter-bank"
            onClick={() => handleQuickFilterClick('deposited_to_bank')}
            className={`flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all duration-200 cursor-pointer ${
              quickFilter === 'deposited_to_bank'
                ? 'bg-blue-600 text-white border-blue-700 shadow-md scale-[1.02]'
                : 'bg-white text-blue-700 border-zinc-150 hover:bg-blue-50 hover:border-blue-200'
            }`}
          >
            <div className="flex items-center space-x-1.5 space-x-reverse">
              <span className={`w-2 h-2 rounded-full ${quickFilter === 'deposited_to_bank' ? 'bg-white' : 'bg-blue-500'}`} />
              <span>نزد بانک</span>
            </div>
            <span className={`px-1.5 py-0.5 rounded-lg text-[10px] ${quickFilter === 'deposited_to_bank' ? 'bg-blue-500/35 text-white' : 'bg-blue-50 text-blue-800'}`}>
              {receivedChecks.filter(c => c.currentState === 'deposited_to_bank').length}
            </span>
          </button>

          {/* 3. برگشتی */}
          <button
            type="button"
            id="btn-quick-filter-bounced"
            onClick={() => handleQuickFilterClick('bounced')}
            className={`flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all duration-200 cursor-pointer ${
              quickFilter === 'bounced'
                ? 'bg-rose-600 text-white border-rose-700 shadow-md scale-[1.02]'
                : 'bg-white text-rose-700 border-zinc-150 hover:bg-rose-50 hover:border-rose-200'
            }`}
          >
            <div className="flex items-center space-x-1.5 space-x-reverse">
              <span className={`w-2 h-2 rounded-full ${quickFilter === 'bounced' ? 'bg-white' : 'bg-rose-500'}`} />
              <span>برگشتی</span>
            </div>
            <span className={`px-1.5 py-0.5 rounded-lg text-[10px] ${quickFilter === 'bounced' ? 'bg-rose-500/35 text-white' : 'bg-rose-50 text-rose-800'}`}>
              {receivedChecks.filter(c => c.currentState === 'bounced').length}
            </span>
          </button>

          {/* 4. همه چک‌ها */}
          <button
            type="button"
            id="btn-quick-filter-all"
            onClick={() => handleQuickFilterClick('all')}
            className={`flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all duration-200 cursor-pointer ${
              quickFilter === 'all'
                ? 'bg-zinc-700 text-white border-zinc-800 shadow-md scale-[1.02]'
                : 'bg-white text-zinc-700 border-zinc-150 hover:bg-zinc-50 hover:border-zinc-200'
            }`}
          >
            <div className="flex items-center space-x-1.5 space-x-reverse">
              <span className={`w-2 h-2 rounded-full ${quickFilter === 'all' ? 'bg-white' : 'bg-zinc-400'}`} />
              <span>همه چک‌ها</span>
            </div>
            <span className={`px-1.5 py-0.5 rounded-lg text-[10px] ${quickFilter === 'all' ? 'bg-zinc-600/40 text-white' : 'bg-zinc-100 text-zinc-600'}`}>
              {receivedChecks.length}
            </span>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="block font-sans text-xs font-bold text-zinc-700 text-right">لیست چک‌های ثبت شده</span>
        {quickFilter !== 'all' && (
          <span className="font-sans text-[10px] text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded-lg">
            فیلتر شده ({filteredChecks.length} از {receivedChecks.length})
          </span>
        )}
      </div>

      {filteredChecks.length > 0 ? (
        filteredChecks.map(check => {
          const person = persons.find(p => p.id === check.personId);
          return (
            <div
              key={check.id}
              onClick={() => {
                if (check.currentState !== 'cleared') {
                  setSelectedCheckForStateChange(check);
                }
              }}
              className={`bg-white p-3.5 rounded-2xl border flex flex-col space-y-2.5 shadow-sm hover:border-emerald-500/40 transition cursor-pointer ${
                selectedCheckForStateChange?.id === check.id ? 'ring-2 ring-emerald-500/20 border-emerald-500' : 'border-zinc-150'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <input 
                    type="checkbox"
                    checked={selectedBulkChecks.includes(check.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      if (e.target.checked) {
                        setSelectedBulkChecks(prev => [...prev, check.id]);
                      } else {
                        setSelectedBulkChecks(prev => prev.filter(id => id !== check.id));
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 text-emerald-600 rounded border-zinc-300 focus:ring-emerald-500"
                  />
                  <span className="font-mono text-[11px] font-bold text-emerald-600">
                    {(check.amount ?? 0).toLocaleString()} ریال
                  </span>
                  {check.isAmani && (
                    <span className="bg-rose-100 text-rose-700 text-[8px] font-black px-1.5 py-0.5 rounded border border-rose-200">امانی</span>
                  )}
                </div>
                <span className={`font-sans text-[9px] font-bold px-2.5 py-0.5 rounded-full border ${getStateColor(check.currentState)}`}>
                  {getStateLabel(check.currentState, check.currentSubState)}
                </span>
              </div>

              <div className="flex items-center justify-between text-right">
                <div className="text-left font-mono text-[10px] text-zinc-400 flex items-center space-x-1.5 space-x-reverse">
                  <Calendar size={12} />
                  <span>سررسید: {check.dueDate}</span>
                </div>
                <div className="font-sans text-xs">
                  <div className="font-bold text-zinc-800">بانک {check.bankName}</div>
                  <div className="text-zinc-500 text-[10px] mt-0.5">
                    دریافت شده از: <strong className="text-zinc-700">{person?.name || 'ناشناس'}</strong>
                  </div>
                  <div className="text-zinc-400 text-[9px] mt-1 flex items-center justify-end space-x-2 space-x-reverse">
                    <span>سریال: <strong className="text-zinc-600 font-mono">{check.checkNumber}</strong></span>
                    {check.sayadiNumber && (
                      <>
                        <span>•</span>
                        <span>صیادی: <strong className="text-zinc-600 font-mono">{check.sayadiNumber}</strong></span>
                      </>
                    )}
                    {check.nationalId && (
                      <>
                        <span>•</span>
                        <span>کد ملی: <strong className="text-zinc-600 font-mono">{check.nationalId}</strong></span>
                      </>
                    )}
                    {check.isApproved === false && (
                      <span className="text-amber-500 font-bold px-1 bg-amber-50 rounded">در انتظار تایید</span>
                    )}
                  </div>
                </div>
              </div>

              {/* History Trace Indicator */}
              {check.history.length > 1 && (
                <div className="bg-zinc-50/75 p-1.5 rounded-lg text-right font-sans text-[8px] text-zinc-400 border-t border-zinc-100 mt-1 flex items-center justify-between">
                  <span className="font-mono">مراحل پیموده شده: {check.history.length} وضعیت</span>
                  <span>چرخه زنجیروار حساب این چک فعال است</span>
                </div>
              )}

              {/* Actions Bar */}
              <div className="flex border-t border-zinc-100 pt-2 mt-2 justify-start gap-2 flex-wrap">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDossier(check);
                  }}
                  className="flex items-center space-x-1 space-x-reverse text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-xl transition text-xs font-bold border border-indigo-200"
                  title="بایگانی مدارک، پرونده حقوقی و ردپای ممیزی"
                >
                  <FileText size={14} />
                  <span>بایگانی و پرونده حقوقی</span>
                </button>

                {currentUserRole === 'admin' && check.isApproved === false && onApproveCheck && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmationModal({
                        isOpen: true,
                        title: 'تایید نهایی چک',
                        message: 'آیا از تایید نهایی و ثبت سند مالی این چک اطمینان دارید؟',
                        onConfirm: () => {
                          onApproveCheck(check.id);
                        }
                      });
                    }}
                    className="flex items-center space-x-1 space-x-reverse text-emerald-600 bg-emerald-50/50 hover:bg-emerald-50 px-2 py-1 rounded-xl transition text-xs font-bold border border-emerald-150"
                    title="تایید و ثبت سند"
                  >
                    <CheckCircle size={14} className="text-emerald-500" />
                    <span>تایید و ثبت سند مالی</span>
                  </button>
                )}

                {(check.isApproved === false || currentUserRole === 'admin') && onEditCheck && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartEditCheck(check);
                    }}
                    className="flex items-center space-x-1 space-x-reverse text-blue-600 bg-blue-50/50 hover:bg-blue-50 px-2 py-1 rounded-xl transition text-xs font-bold border border-blue-150"
                    title="ویرایش چک"
                  >
                    <Edit2 size={14} />
                    <span>ویرایش مشخصات</span>
                  </button>
                )}

                {(check.isApproved === false || currentUserRole === 'admin') && onDeleteCheck && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      const confirmMsg = '⚠️ طبق قوانین استاندارد مالی، حذف فیزیکی چک دارای سابقه ممنوع است.\n\nبا اجرای این اقدام، چک ابطال گردیده، سابقه آن کاملاً حفظ خواهد شد و در صورت وجود سند حسابداری، سند معکوس صادر می‌گردد.\n\nآیا از ابطال این چک اطمینان دارید؟';
                      setConfirmationModal({
                        isOpen: true,
                        title: 'ابطال رسمی چک',
                        message: confirmMsg,
                        onConfirm: () => {
                          onDeleteCheck(check.id, 'ابطال رسمی درخواست‌شده توسط کاربر');
                        }
                      });
                    }}
                    className="flex items-center space-x-1 space-x-reverse text-rose-600 bg-rose-50/50 hover:bg-rose-50 px-2 py-1 rounded-xl transition text-xs font-bold border border-rose-150"
                    title="ابطال چک"
                  >
                    <Trash2 size={14} />
                    <span>ابطال چک</span>
                  </button>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <div className="bg-white p-8 rounded-2xl border border-zinc-100 text-center font-sans text-xs text-zinc-400">
          هیچ چکی در این دسته یافت نشد
        </div>
      )}
    </div>
  );
}
