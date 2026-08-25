import React from 'react';
import { Landmark, CheckCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { Check as CheckTypeModel, ReceivedCheckState, PaidCheckState, BouncedReceivedCheckSubState, BouncedPaidCheckSubState, AccountSubsidiary } from '../../types';

interface CheckStatusChangeModalProps {
  selectedCheckForStateChange: CheckTypeModel | null;
  onClose: () => void;
  onUpdateCheckState: (
    checkId: string, 
    newState: ReceivedCheckState | PaidCheckState, 
    newSubState?: BouncedReceivedCheckSubState | BouncedPaidCheckSubState,
    note?: string,
    bankId?: string,
    cashId?: string,
    endorsedPersonId?: string
  ) => void;
  banks: AccountSubsidiary[];
  selectedBankId: string;
  setSelectedBankId: (bankId: string) => void;
  stateNote: string;
  setStateNote: (note: string) => void;
  resolvedSinglePaidBankId?: string;
  isSinglePaidCheck: boolean;
}

export default function CheckStatusChangeModal({
  selectedCheckForStateChange,
  onClose,
  onUpdateCheckState,
  banks,
  selectedBankId,
  setSelectedBankId,
  stateNote,
  setStateNote,
  resolvedSinglePaidBankId,
  isSinglePaidCheck
}: CheckStatusChangeModalProps) {
  if (!selectedCheckForStateChange) return null;

  return (
    <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-md space-y-4" dir="rtl">
      <div className="flex items-center justify-between border-b border-zinc-100 pb-2.5">
        <button 
          type="button" 
          onClick={onClose} 
          className="text-zinc-400 text-xs font-semibold hover:text-zinc-600 transition"
        >
          انصراف
        </button>
        <div className="text-right">
          <span className="font-sans text-xs font-bold text-zinc-800 block">بروزرسانی وضعیت چک</span>
          <span className="font-mono text-[9px] text-zinc-400">شماره: {selectedCheckForStateChange.checkNumber}</span>
        </div>
      </div>

      <div className="bg-zinc-50 p-3 rounded-xl flex items-center justify-between font-sans text-xs">
        <div className="text-left font-mono font-semibold text-emerald-600">
          {(selectedCheckForStateChange.amount ?? 0).toLocaleString()} ریال
        </div>
        <div className="text-right">
          <div className="font-bold text-zinc-800">بانک {selectedCheckForStateChange.bankName}</div>
          <div className="text-zinc-400 text-[10px] mt-0.5">سررسید: {selectedCheckForStateChange.dueDate}</div>
        </div>
      </div>

      {/* List of possible next states with automatic voucher notices */}
      <div className="space-y-2">
        <span className="block text-[11px] font-bold text-zinc-500 text-right">انتخاب وضعیت بعدی چک:</span>

        {/* RECEIVED CHECK TRANSITIONS */}
        {selectedCheckForStateChange.type === 'received' && (
          <div className="grid grid-cols-2 gap-2">
            {selectedCheckForStateChange.currentState === 'present_in_cashbox' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'deposited_to_bank', undefined, stateNote);
                    onClose();
                  }}
                  className="bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <Landmark size={15} className="mb-1 text-blue-500" />
                  <strong>واگذاری به بانک</strong>
                  <span className="block text-[9px] text-blue-600/70 mt-0.5">در جریان وصول حساب</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'cleared', undefined, stateNote, selectedBankId);
                    onClose();
                  }}
                  className="bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <CheckCircle size={15} className="mb-1 text-emerald-500" />
                  <strong>وصول نقدی فوری</strong>
                  <span className="block text-[9px] text-emerald-600/70 mt-0.5">واریز مستقیم به بانک</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'passed_to_others', undefined, stateNote);
                    onClose();
                  }}
                  className="bg-purple-50 border border-purple-200 hover:bg-purple-100 text-purple-800 rounded-xl p-2.5 text-right font-sans text-xs transition col-span-2"
                >
                  <RefreshCw size={15} className="mb-1 text-purple-500" />
                  <strong>خرج چک به غیر (بستانکار)</strong>
                  <span className="block text-[9px] text-purple-600/70 mt-0.5">واگذاری سند مشتری جهت تسویه بدهی</span>
                </button>
              </>
            )}

            {selectedCheckForStateChange.currentState === 'passed_to_others' && (
              <button
                type="button"
                onClick={() => {
                  onUpdateCheckState(selectedCheckForStateChange.id, 'present_in_cashbox', undefined, stateNote);
                  onClose();
                }}
                className="bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 text-zinc-800 rounded-xl p-2.5 text-right font-sans text-xs transition col-span-2"
              >
                <RefreshCw size={15} className="mb-1 text-zinc-500" />
                <strong>برگشت به صندوق</strong>
                <span className="block text-[9px] text-zinc-600/70 mt-0.5">بازگرداندن چک خرج‌شده به موجودی صندوق</span>
              </button>
            )}

            {selectedCheckForStateChange.currentState === 'deposited_to_bank' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'cleared', undefined, stateNote, selectedBankId);
                    onClose();
                  }}
                  className="bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <CheckCircle size={15} className="mb-1 text-emerald-500" />
                  <strong>وصول چک</strong>
                  <span className="block text-[9px] text-emerald-600/70 mt-0.5">واریز موفق به حساب بانک</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'bounced', 'returned_to_customer', stateNote);
                    onClose();
                  }}
                  className="bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <RefreshCw size={15} className="mb-1 text-amber-500" />
                  <strong>برگشت - عودت به مشتری</strong>
                  <span className="block text-[9px] text-amber-600/70 mt-0.5">برگشت و تحویل چک به صادرکننده</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'bounced', 'in_legal_process', stateNote);
                    onClose();
                  }}
                  className="bg-red-50 border border-red-200 hover:bg-red-100 text-red-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <AlertTriangle size={15} className="mb-1 text-red-500" />
                  <strong>برگشت - پیگیری حقوقی</strong>
                  <span className="block text-[9px] text-red-600/70 mt-0.5">ارجاع چک به دایره حقوقی و واخواست</span>
                </button>
              </>
            )}

            {selectedCheckForStateChange.currentState === 'bounced' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'bounced', 'returned_to_customer', stateNote);
                    onClose();
                  }}
                  className="bg-orange-50 border border-orange-200 hover:bg-orange-100 text-orange-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <RefreshCw size={15} className="mb-1 text-orange-500" />
                  <strong>عودت به مشتری</strong>
                  <span className="block text-[9px] text-orange-600/70 mt-0.5">تحویل فیزیکی برگ چک به خریدار</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'bounced', 'in_legal_process', stateNote);
                    onClose();
                  }}
                  className="bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <AlertTriangle size={15} className="mb-1 text-rose-500" />
                  <strong>اقدام حقوقی چک</strong>
                  <span className="block text-[9px] text-rose-600/70 mt-0.5">ثبت در جریان امور قانونی</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'bounced', 'cleared_after_bounce', stateNote, selectedBankId);
                    onClose();
                  }}
                  className="bg-teal-50 border border-teal-200 hover:bg-teal-100 text-teal-800 rounded-xl p-2.5 text-right font-sans text-xs transition col-span-2"
                >
                  <CheckCircle size={15} className="mb-1 text-teal-500" />
                  <strong>وصول پس از برگشت</strong>
                  <span className="block text-[9px] text-teal-600/70 mt-0.5">تسویه نقدی و خواباندن در حساب</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* ISSUED CHECK TRANSITIONS */}
        {selectedCheckForStateChange.type === 'paid' && (
          <div className="grid grid-cols-2 gap-2">
            {selectedCheckForStateChange.currentState === 'issued' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'cleared', undefined, stateNote, selectedBankId);
                    onClose();
                  }}
                  className="bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <CheckCircle size={15} className="mb-1 text-emerald-500" />
                  <strong>پاس شدن چک</strong>
                  <span className="block text-[9px] text-emerald-600/70 mt-0.5">کسر مستقیم موجودی بانک ما</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'bounced', undefined, stateNote);
                    onClose();
                  }}
                  className="bg-red-50 border border-red-200 hover:bg-red-100 text-red-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <AlertTriangle size={15} className="mb-1 text-red-500" />
                  <strong>برگشت خوردن چک</strong>
                  <span className="block text-[9px] text-red-600/70 mt-0.5">بستانکاری مجدد همکار</span>
                </button>
              </>
            )}

            {selectedCheckForStateChange.currentState === 'bounced' && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'bounced', 'un_bounced_solved', stateNote);
                    onClose();
                  }}
                  className="bg-teal-50 border border-teal-200 hover:bg-teal-100 text-teal-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <CheckCircle size={15} className="mb-1 text-teal-500" />
                  <strong>رفع سوء اثر</strong>
                  <span className="block text-[9px] text-teal-600/70 mt-0.5">ثبت گواهی رفع برگشتی چک</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onUpdateCheckState(selectedCheckForStateChange.id, 'bounced', 'provisioned_funds', stateNote);
                    onClose();
                  }}
                  className="bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-800 rounded-xl p-2.5 text-right font-sans text-xs transition"
                >
                  <Landmark size={15} className="mb-1 text-blue-500" />
                  <strong>تأمین موجودی</strong>
                  <span className="block text-[9px] text-blue-600/70 mt-0.5">واریز وجه چک به حساب مسدودی</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Parameter selection (e.g. Bank Account for Clearing) */}
      <div className="space-y-3 pt-2 border-t border-zinc-100">
        <div>
          <label className="block text-[10px] text-zinc-500 text-right mb-1">
            {isSinglePaidCheck ? (
              resolvedSinglePaidBankId ? (
                <span className="flex items-center justify-between">
                  <span>بانک صادرکننده چک:</span>
                  <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-bold text-[9px] border border-amber-200/60 inline-flex items-center gap-1">
                    🔒 قفل‌شده - بانک صادرکننده
                  </span>
                </span>
              ) : (
                <span className="flex items-center justify-between">
                  <span>بانک صادرکننده چک:</span>
                  <span className="text-zinc-500 text-[9px]">⚠️ چک قدیمی - انتخاب دستی بانک</span>
                </span>
              )
            ) : (
              'بانک مقصد (برای وصول یا خواباندن به حساب)'
            )}
          </label>
          <select
            value={selectedBankId}
            disabled={isSinglePaidCheck && !!resolvedSinglePaidBankId}
            onChange={(e) => setSelectedBankId(e.target.value)}
            className={`w-full bg-zinc-50 border rounded-xl px-3 py-2 font-sans text-xs text-right focus:outline-none ${
              isSinglePaidCheck && !!resolvedSinglePaidBankId
                ? 'border-amber-200 text-zinc-700 bg-amber-50/30 cursor-not-allowed font-semibold'
                : 'border-zinc-200 text-zinc-800 focus:border-emerald-500'
            }`}
          >
            {banks.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {isSinglePaidCheck && !!resolvedSinglePaidBankId && (
            <p className="text-[9px] text-zinc-400 mt-1 text-right">
              چک‌های پرداختی الزاماً از همان بانک صادرکننده پاس می‌شوند و امکان تغییر بانک وجود ندارد.
            </p>
          )}
        </div>

        <div>
          <label className="block text-[10px] text-zinc-500 text-right mb-1">توضیحات تکمیلی سند</label>
          <input
            type="text"
            value={stateNote}
            onChange={(e) => setStateNote(e.target.value)}
            placeholder="مثال: واگذاری توسط علی علوی"
            className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}
