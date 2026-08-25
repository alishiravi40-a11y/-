/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Calendar, FileText, Scale, Tag, User, Plus } from 'lucide-react';
import { JournalVoucher } from '../types';
import { DEFAULT_SUBSIDIARIES } from '../utils/accounting';

interface VoucherDetailModalProps {
  voucher: JournalVoucher;
  onClose: () => void;
  onDelete?: (voucherId: string) => void;
  onEdit?: (voucher: JournalVoucher) => void;
  onEditInvoice?: (invoiceId: string) => void;
  onEditOpeningBalance?: (openingBalanceId: string) => void;
  onNew?: (type: string) => void;
}

export default function VoucherDetailModal({ 
  voucher, 
  onClose,
  onDelete,
  onEdit,
  onEditInvoice,
  onEditOpeningBalance,
  onNew
}: VoucherDetailModalProps) {
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  // Calculate totals
  const totalDebit = voucher.entries.reduce((sum, e) => sum + e.debit, 0);
  const totalCredit = voucher.entries.reduce((sum, e) => sum + e.credit, 0);

  return (
    <div className="fixed inset-0 bg-zinc-950/60 backdrop-blur-sm z-[100] flex justify-center items-center p-4 text-right">
      <div 
        className="w-full max-w-[400px] bg-white rounded-3xl shadow-2xl border border-zinc-100 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200"
        dir="rtl"
      >
        {/* Header */}
        <div className="bg-zinc-900 text-white px-5 py-4 flex items-center justify-between">
          <button 
            onClick={onClose}
            className="text-zinc-400 hover:text-white bg-white/10 hover:bg-white/20 p-1.5 rounded-xl transition"
          >
            <X size={16} />
          </button>
          <div className="text-right">
            <h3 className="font-sans text-xs font-bold text-zinc-100">جزئیات سند حسابداری</h3>
            <span className="font-mono text-xs font-bold text-indigo-300 block mt-1">
              شماره سند: <span className="text-white text-sm bg-indigo-500/30 px-1.5 py-0.5 rounded ml-1">{voucher.voucherNumber}</span>
              <span className="text-[10px] text-zinc-400 font-sans mr-2">
                {voucher.isAutomatic ? 'سیستمی (خودکار)' : 'ثبت دستی'}
              </span>
            </span>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Metadata Card */}
          <div className="bg-zinc-50 p-3.5 rounded-2xl border border-zinc-150 space-y-2">
            <div className="flex justify-between items-center text-xs font-sans">
              <span className="text-zinc-500 flex items-center gap-1">
                <Calendar size={13} className="text-zinc-400" />
                تاریخ سند:
              </span>
              <strong className="font-mono text-zinc-800">{voucher.date}</strong>
            </div>
            <div className="h-px bg-zinc-200/50 my-1" />
            <div className="text-xs font-sans">
              <span className="text-zinc-500 block mb-1 flex items-center gap-1">
                <FileText size={13} className="text-zinc-400" />
                شرح کلی سند:
              </span>
              <p className="text-zinc-800 leading-relaxed bg-white p-2 rounded-lg border border-zinc-100 text-[11px]">
                {voucher.description || 'بدون شرح'}
              </p>
            </div>
          </div>

          {/* Entries list */}
          <div className="space-y-2.5">
            <h4 className="font-sans text-xs font-bold text-zinc-800">آرتیکل‌های حسابداری (دوبل)</h4>
            
            <div className="space-y-2">
              {voucher.entries.map((entry, index) => (
                <div 
                  key={index} 
                  className={`p-3 rounded-xl border text-[11px] font-sans space-y-2 relative overflow-hidden ${
                    entry.debit > 0 
                      ? 'bg-rose-50/40 border-rose-100/60' 
                      : 'bg-emerald-50/40 border-emerald-100/60'
                  }`}
                >
                  {/* Side indicator badge */}
                  <div className="flex justify-between items-center">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                      entry.debit > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {entry.debit > 0 ? 'بدهکار' : 'بستانکار'}
                    </span>
                    <strong className="text-zinc-700">ردیف {index + 1}</strong>
                  </div>

                  {/* Subsidiary account */}
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400">حساب معین:</span>
                    <strong className="text-zinc-800">
                      {(() => {
                        const subAcc = DEFAULT_SUBSIDIARIES.find(s => s.id === entry.subsidiaryId);
                        return subAcc ? `${subAcc.name} (${subAcc.code})` : entry.subsidiaryId;
                      })()}
                    </strong>
                  </div>

                  {/* Floating detail if any */}
                  {entry.floatingDetailed && (
                    <div className="flex justify-between items-center bg-white/60 px-2 py-1 rounded border border-zinc-100">
                      <span className="text-zinc-500 flex items-center gap-1 text-[10px]">
                        <User size={11} className="text-zinc-400" />
                        تفصیلی شناور:
                      </span>
                      <strong className="text-zinc-800 text-[10px]">
                        {entry.floatingDetailed.name} ({entry.floatingDetailed.id.startsWith('p_') ? 'شخص' : 'حساب'})
                      </strong>
                    </div>
                  )}

                  {/* Amount */}
                  <div className="flex justify-between items-center border-t border-zinc-200/40 pt-1.5 mt-1 font-mono text-xs font-bold">
                    <span className="text-zinc-500 font-sans text-[10px]">مبلغ:</span>
                    <span className={entry.debit > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                      {(entry.debit > 0 ? entry.debit : entry.credit).toLocaleString()} ریال
                    </span>
                  </div>

                  {entry.description && (
                    <div className="text-[10px] text-zinc-500 leading-normal border-t border-zinc-100 pt-1">
                      شرح ردیف: {entry.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer with Balanced Summary */}
        <div className="bg-zinc-50 p-4 border-t border-zinc-150 font-mono text-xs font-bold space-y-2 text-center">
          <div className="flex justify-between items-center text-zinc-500 font-sans text-[10px] mb-1">
            <span>مجموع بدهکار</span>
            <span>مجموع بستانکار</span>
          </div>
          <div className="flex justify-between items-center text-zinc-800">
            <span className="text-rose-600 bg-rose-50 px-2 py-1 rounded-md">{totalDebit.toLocaleString()} ریال</span>
            <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">{totalCredit.toLocaleString()} ریال</span>
          </div>
          <div className="pt-1 text-center text-zinc-400 font-sans text-[9px] flex items-center justify-center gap-1">
            <Scale size={11} className="text-emerald-600" />
            <span>سند موازنه و ثبت شده در سیستم</span>
          </div>

          {/* Action buttons based on automatic or manual voucher */}
          <div className="pt-2 border-t border-zinc-200/60 font-sans text-xs flex flex-col space-y-2">
            
            {/* Row 1: Source Specific Actions (Edit/View Source) */}
            <div className="flex gap-2">
              {voucher.sourceType === 'sell_invoice' || voucher.sourceType === 'buy_invoice' ? (
                voucher.sourceId && onEditInvoice && (
                  <button
                    onClick={() => {
                      onEditInvoice(voucher.sourceId!);
                      onClose();
                    }}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-3 rounded-xl shadow-xs transition"
                  >
                    اصلاح فاکتور مبدأ
                  </button>
                )
              ) : voucher.sourceType === 'opening_balance' ? (
                voucher.sourceId && onEditOpeningBalance && (
                  <button
                    onClick={() => {
                      onEditOpeningBalance(voucher.sourceId!);
                      onClose();
                    }}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-3 rounded-xl shadow-xs transition"
                  >
                    اصلاح سند افتتاحیه
                  </button>
                )
              ) : !voucher.isAutomatic && onEdit && (
                <button
                  onClick={() => {
                    onEdit(voucher);
                    onClose();
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-3 rounded-xl shadow-xs transition"
                >
                  اصلاح سند دستی
                </button>
              )}

              {/* Row 1: Delete Action (Source Specific or General) */}
              {showConfirmDelete ? (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                  <div className="bg-white rounded-2xl p-5 shadow-2xl max-w-xs w-full text-center space-y-4 border border-red-100">
                    <p className="text-xs font-bold text-red-800 leading-relaxed">
                      ⚠️ آیا از حذف این سند و مدارک مرتبط با آن اطمینان دارید؟
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (onDelete) onDelete(voucher.id);
                          onClose();
                        }}
                        className="flex-1 bg-red-600 text-white py-2 rounded-xl text-[11px] font-bold shadow-sm"
                      >
                        بله، حذف شود
                      </button>
                      <button
                        onClick={() => setShowConfirmDelete(false)}
                        className="flex-1 bg-zinc-100 text-zinc-600 py-2 rounded-xl text-[11px] font-bold"
                      >
                        انصراف
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                onDelete && (
                  <button
                    onClick={() => setShowConfirmDelete(true)}
                    className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold py-2 px-3 rounded-xl border border-rose-200 transition"
                  >
                    حذف / ابطال
                  </button>
                )
              )}
            </div>

            {/* Row 2: Create New Action */}
            {onNew && (
              <button
                onClick={() => {
                  const type = voucher.sourceType || (voucher.isAutomatic ? 'auto' : 'manual');
                  onNew(type);
                  onClose();
                }}
                className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 px-3 rounded-xl border border-zinc-200 transition flex items-center justify-center gap-2"
              >
                <Plus size={16} />
                ثبت {voucher.sourceType === 'sell_invoice' ? 'فاکتور فروش' : voucher.sourceType === 'buy_invoice' ? 'فاکتور خرید' : 'سند حسابداری'} جدید
              </button>
            )}

            {voucher.isAutomatic && !voucher.sourceType && (
              <p className="text-[10px] text-zinc-400 leading-normal text-center mt-1">
                این سند به صورت خودکار صادر شده است.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
