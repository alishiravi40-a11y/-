import React, { useMemo } from 'react';
import { AppState, AccountSubsidiary, JournalVoucher } from '../types';
import { X, FileText, Edit, Trash2, Eye, Plus } from 'lucide-react';

interface SubsidiaryLedgerModalProps {
  subsidiary: AccountSubsidiary;
  state: AppState;
  onClose: () => void;
  onEditVoucher: (voucher: JournalVoucher) => void;
  onDeleteVoucher: (voucher: JournalVoucher) => void;
  onNewVoucher: () => void;
  onViewVoucher?: (voucherId: string) => void;
  onViewCheck?: (checkId: string) => void;
}

export default function SubsidiaryLedgerModal({ subsidiary, state, onClose, onEditVoucher, onDeleteVoucher, onNewVoucher, onViewVoucher, onViewCheck }: SubsidiaryLedgerModalProps) {
  const ledgerEntries = useMemo(() => {
    const entries: {
      voucher: JournalVoucher;
      debit: number;
      credit: number;
      runningBalance: number;
      nature: 'بدهکار' | 'بستانکار' | 'بی‌حساب';
    }[] = [];

    let balance = 0;

    const sortedVouchers = [...state.vouchers].sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return a.voucherNumber - b.voucherNumber;
    });

    sortedVouchers.forEach(v => {
      v.entries.forEach(e => {
        if (e.subsidiaryId === subsidiary.id) {
          balance += (e.debit - e.credit);
          entries.push({
            voucher: v,
            debit: e.debit,
            credit: e.credit,
            runningBalance: Math.abs(balance),
            nature: balance > 0 ? 'بدهکار' : balance < 0 ? 'بستانکار' : 'بی‌حساب'
          });
        }
      });
    });

    return entries;
  }, [subsidiary, state.vouchers]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col font-sans">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-2 bg-zinc-100 text-zinc-500 hover:text-zinc-800 rounded-full transition">
              <X size={20} />
            </button>
            <button 
              onClick={onNewVoucher}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition shadow-sm"
            >
              <Plus size={14} />
              ثبت سند جدید
            </button>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-zinc-800">ریز تراکنش‌های حساب معین (دفتر معین)</div>
            <div className="text-[10px] text-zinc-500">{subsidiary.name} (کد: {subsidiary.code})</div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-right">
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 p-3 rounded-xl text-xs leading-relaxed text-right">
            <strong>یادآوری اصول حسابداری:</strong> امکان مشاهده گردش حساب‌ها در قالب «دفتر معین» و «دفتر کل»، یک استاندارد الزامی و کاملاً منطبق بر اصول حسابداری است و به پیگیری دقیق تراز کمک می‌کند.
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200">
            <table className="w-full text-right text-xs">
              <thead className="bg-zinc-100 text-zinc-700">
                <tr>
                  <th className="p-2 border-b font-bold whitespace-nowrap">تاریخ و سند</th>
                  <th className="p-2 border-b font-bold w-1/2">شرح تفصیلی</th>
                  <th className="p-2 border-b font-bold">بدهکار</th>
                  <th className="p-2 border-b font-bold">بستانکار</th>
                  <th className="p-2 border-b font-bold">مانده (ماهیت)</th>
                  <th className="p-2 border-b font-bold text-center">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-zinc-400">هیچ گردش حسابی ثبت نشده است.</td>
                  </tr>
                ) : (
                  ledgerEntries.map((e, idx) => (
                    <tr key={idx} className="border-b border-zinc-50 hover:bg-zinc-50 transition">
                      <td className="p-2 whitespace-nowrap">
                        <div className="font-mono text-zinc-600">{e.voucher.date}</div>
                        <div className="text-[9px] text-zinc-400">سند {e.voucher.voucherNumber}</div>
                      </td>
                      <td className="p-2">
                        <div className="text-zinc-800 font-medium">{e.voucher.description}</div>
                        {e.voucher.entries.find(ent => ent.subsidiaryId === subsidiary.id)?.floatingDetailed?.name && (
                          <div className="text-[9px] text-zinc-500 mt-1 bg-zinc-100 px-1.5 py-0.5 rounded inline-block">
                            تفصیلی شناور: {e.voucher.entries.find(ent => ent.subsidiaryId === subsidiary.id)?.floatingDetailed?.name}
                          </div>
                        )}
                      </td>
                      <td className="p-2 font-mono text-red-600">{e.debit > 0 ? e.debit.toLocaleString() : '-'}</td>
                      <td className="p-2 font-mono text-emerald-600">{e.credit > 0 ? e.credit.toLocaleString() : '-'}</td>
                      <td className="p-2">
                        <div className="font-mono font-bold text-zinc-800">{e.runningBalance.toLocaleString()}</div>
                        <div className="text-[9px] text-zinc-500">{e.nature}</div>
                      </td>
                      <td className="p-2">
                        <div className="flex items-center justify-center gap-1">
                          {onViewVoucher && (
                            <button 
                              onClick={(event) => {
                                event.stopPropagation();
                                const linkedChk = state.checks.find(c => 
                                  c.id === e.voucher.sourceId || 
                                  (e.voucher.sourceType === 'check_state_change' && e.voucher.sourceId === c.id) ||
                                  c.history?.some(h => h.voucherId === e.voucher.id) ||
                                  (e.voucher.id && e.voucher.id.includes(c.id)) ||
                                  (e.voucher.description && e.voucher.description.includes(c.checkNumber))
                                );
                                if (linkedChk && onViewCheck) {
                                  onViewCheck(linkedChk.id);
                                } else if (onViewVoucher) {
                                  onViewVoucher(e.voucher.id);
                                }
                              }}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                              title="مشاهده منبع / جزئیات"
                            >
                              <Eye size={14} />
                            </button>
                          )}
                          <button 
                            onClick={() => onEditVoucher(e.voucher)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title="اصلاح سند"
                          >
                            <Edit size={14} />
                          </button>
                          <button 
                            onClick={() => onDeleteVoucher(e.voucher)}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="ابطال سند"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pt-2">
            <button 
              onClick={onNewVoucher}
              className="w-full flex items-center justify-center gap-2 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl text-xs font-bold transition border border-zinc-200"
            >
              <Plus size={16} className="stroke-[3px]" />
              ثبت سند حسابداری جدید برای این معین
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
