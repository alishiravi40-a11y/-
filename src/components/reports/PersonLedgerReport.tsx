import React, { useState, useMemo } from 'react';
import { Search, Plus, Edit2, Trash2, Check as CheckIcon } from 'lucide-react';
import { AppState, JournalVoucher, Check } from '../../types';

interface PersonLedgerReportProps {
  state: AppState;
  startDate: string;
  endDate: string;
  isFilterSubmitted: boolean;
  filterPersonId: string;
  currentUserRole?: 'admin' | 'agent';
  onNewVoucher?: (type: 'manual' | 'automatic') => void;
  onEditVoucher?: (voucher: JournalVoucher) => void;
  onDeleteVoucher?: (voucher: JournalVoucher) => void;
  onViewVoucher?: (voucherId: string) => void;
  onViewCheck?: (checkId: string) => void;
  onApproveCheck?: (checkId: string) => void;
  onEditCheck?: (check: Check) => void;
  onDeleteCheck?: (checkId: string) => void;
  setEditingCheck?: (check: Check | null) => void;
  setEditBankName?: (val: string) => void;
  setEditAmount?: (val: number) => void;
  setEditCheckNumber?: (val: string) => void;
  setEditSayadiNumber?: (val: string) => void;
  setEditNationalId?: (val: string) => void;
  setEditDueDate?: (val: string) => void;
  setEditPersonId?: (val: string) => void;
}

export default function PersonLedgerReport({
  state,
  startDate,
  endDate,
  isFilterSubmitted,
  filterPersonId,
  currentUserRole,
  onNewVoucher,
  onEditVoucher,
  onDeleteVoucher,
  onViewVoucher,
  onViewCheck,
  onApproveCheck,
  onEditCheck,
  onDeleteCheck,
  setEditingCheck,
  setEditBankName,
  setEditAmount,
  setEditCheckNumber,
  setEditSayadiNumber,
  setEditNationalId,
  setEditDueDate,
  setEditPersonId
}: PersonLedgerReportProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const personLedgerResult = useMemo(() => {
    if (!isFilterSubmitted) return null;

    const person = state.persons.find(p => p.id === filterPersonId);
    if (!person) return null;

    const ledgerEntries: {
      date: string;
      description: string;
      debit: number;
      credit: number;
      runningBalance: number;
      nature: 'بدهکار' | 'بستانکار' | 'بی‌حساب';
      sourceType?: string;
      sourceId?: string;
      voucherId?: string;
    }[] = [];

    let totalDebit = 0;
    let totalCredit = 0;
    let balance = 0;

    const sortedVouchers = [...state.vouchers].sort((a, b) => a.date.localeCompare(b.date));

    sortedVouchers.forEach(v => {
      if (v.date >= startDate && v.date <= endDate) {
        v.entries.forEach(e => {
          if (e.floatingDetailed && e.floatingDetailed.type === 'person' && e.floatingDetailed.id === filterPersonId) {
            totalDebit += (e.debit || 0);
            totalCredit += (e.credit || 0);
            balance += ((e.debit || 0) - (e.credit || 0));

            ledgerEntries.push({
              date: v.date,
              description: e.description || v.description,
              debit: e.debit || 0,
              credit: e.credit || 0,
              runningBalance: Math.abs(balance),
              nature: balance > 0 ? 'بدهکار' : balance < 0 ? 'بستانکار' : 'بی‌حساب',
              sourceType: v.sourceType,
              sourceId: v.sourceId,
              voucherId: v.id
            });
          }
        });
      }
    });

    return {
      person,
      totalDebit,
      totalCredit,
      finalBalance: Math.abs(balance),
      finalNature: balance > 0 ? 'بدهکار' : balance < 0 ? 'بستانکار' : 'بی‌حساب',
      entries: ledgerEntries
    };
  }, [isFilterSubmitted, state.vouchers, state.persons, filterPersonId, startDate, endDate]);

  if (!personLedgerResult) return null;

  const filteredEntries = personLedgerResult.entries.filter(ent => 
    !searchQuery || ent.description.includes(searchQuery)
  );

  return (
    <div className="space-y-3">
      <div className="bg-white p-4 rounded-2xl border border-zinc-150 text-right space-y-2 flex justify-between items-center">
        <div className="flex gap-2">
          {onNewVoucher && (
            <button 
              onClick={() => onNewVoucher('manual')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-[10px] font-bold hover:bg-emerald-700 transition shadow-sm"
            >
              <Plus size={14} />
              ثبت سند جدید
            </button>
          )}
        </div>
        <div className="text-right">
          <span className="text-[10px] text-zinc-400 block font-sans">طرف حساب تجاری</span>
          <h4 className="font-sans text-sm font-bold text-zinc-800">{personLedgerResult.person.name}</h4>
          <div className="flex justify-between font-mono text-xs border-t border-zinc-100 pt-2.5 mt-2">
            <span className={`font-bold ${personLedgerResult.finalNature === 'بدهکار' ? 'text-red-600' : 'text-emerald-600'}`}>
              {personLedgerResult.finalBalance.toLocaleString()} ریال ({personLedgerResult.finalNature})
            </span>
            <span className="text-zinc-500">:مانده نهایی حساب</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="bg-white p-2 rounded-xl border border-zinc-150 flex items-center space-x-2 space-x-reverse">
          <Search size={16} className="text-zinc-400" />
          <input
            type="text"
            placeholder="جستجو در تراکنش‌ها..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none"
          />
        </div>

        {filteredEntries.length > 0 ? (
          filteredEntries.map((ent, idx) => (
            <div 
              key={idx} 
              onClick={() => {
                const linkedChk = state.checks.find(c => 
                  c.id === ent.sourceId ||
                  (ent.sourceType === 'check_state_change' && ent.sourceId === c.id) ||
                  c.history?.some(h => h.voucherId === ent.voucherId) ||
                  (ent.voucherId && ent.voucherId.includes(c.id)) ||
                  (ent.description && ent.description.includes(c.checkNumber))
                );
                if (linkedChk && onViewCheck) {
                  onViewCheck(linkedChk.id);
                  return;
                }
                if (ent.voucherId && onViewVoucher) {
                  onViewVoucher(ent.voucherId);
                }
              }}
              className={`bg-white p-3 rounded-xl border border-zinc-100 text-right font-sans text-xs flex flex-col space-y-1.5 shadow-sm hover:border-emerald-500/30 transition ${ent.voucherId ? 'cursor-pointer' : ''}`}
            >
              <div className="flex justify-between items-center text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400 font-mono">{ent.date}</span>
                  {ent.voucherId && (
                    <div className="flex items-center gap-1">
                      {onEditVoucher && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const v = state.vouchers.find(voc => voc.id === ent.voucherId);
                            if (v) onEditVoucher(v);
                          }}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="ویرایش سند"
                        >
                          <Edit2 size={12} />
                        </button>
                      )}
                      {onDeleteVoucher && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const v = state.vouchers.find(voc => voc.id === ent.voucherId);
                            if (v) onDeleteVoucher(v);
                          }}
                          className="p-1 text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="حذف سند"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <span className={ent.debit > 0 ? 'text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded' : 'text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded'}>
                  {ent.debit > 0 ? 'بدهکار' : 'بستانکار'}
                </span>
              </div>
              <p className="text-zinc-700 font-medium text-xs pr-1">{ent.description}</p>
              
              {(() => {
                const linkedCheck = state.checks.find(c => 
                  c.id === ent.sourceId ||
                  (ent.sourceType === 'check_state_change' && ent.sourceId === c.id) ||
                  c.history?.some(h => h.voucherId === ent.voucherId) ||
                  (ent.voucherId && ent.voucherId.includes(c.id)) ||
                  (ent.description && ent.description.includes(c.checkNumber))
                );
                if (!linkedCheck) return null;
                return (
                  <div className="bg-zinc-50 border border-zinc-150 p-2.5 rounded-xl mt-2 space-y-2 text-right">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-mono text-zinc-600 font-bold bg-zinc-100 px-1.5 py-0.5 rounded">
                        صیادی: {linkedCheck.checkNumber}
                      </span>
                      <span className="text-zinc-500 font-semibold">
                        ℹ️ سند مربوط به چک ({linkedCheck.type === 'received' ? 'دریافتی' : 'پرداختی'})
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] text-zinc-500">
                      <span>سررسید: {linkedCheck.dueDate}</span>
                      <span>بانک: {linkedCheck.bankName}</span>
                    </div>
                    
                    <div className="flex gap-2 justify-end pt-1.5 border-t border-zinc-100/50">
                      {linkedCheck.isApproved === false && currentUserRole === 'admin' && onApproveCheck && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onApproveCheck(linkedCheck.id);
                          }}
                          className="flex items-center space-x-1 space-x-reverse text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-1.5 py-1 rounded-lg transition text-[9px] font-bold border border-emerald-100"
                        >
                          <CheckIcon size={10} />
                          <span>تایید نهایی چک</span>
                        </button>
                      )}
                      {(onEditCheck || setEditingCheck) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (setEditingCheck) setEditingCheck(linkedCheck);
                            if (setEditBankName) setEditBankName(linkedCheck.bankName);
                            if (setEditAmount) setEditAmount(linkedCheck.amount);
                            if (setEditCheckNumber) setEditCheckNumber(linkedCheck.checkNumber);
                            if (setEditSayadiNumber) setEditSayadiNumber(linkedCheck.sayadiNumber || '');
                            if (setEditNationalId) setEditNationalId(linkedCheck.nationalId || '');
                            if (setEditDueDate) setEditDueDate(linkedCheck.dueDate);
                            if (setEditPersonId) setEditPersonId(linkedCheck.personId);
                            if (onEditCheck) onEditCheck(linkedCheck);
                          }}
                          className="flex items-center space-x-1 space-x-reverse text-blue-600 bg-blue-50 hover:bg-blue-100 px-1.5 py-1 rounded-lg transition text-[9px] font-bold border border-blue-100"
                        >
                          <Edit2 size={10} />
                          <span>ویرایش مشخصات چک</span>
                        </button>
                      )}
                      {onDeleteCheck && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const confirmMsg = linkedCheck.isApproved 
                              ? '⚠️ هشدار مهم: این چک تایید نهایی شده و دارای سند حسابداری فعال است. با حذف آن، تمامی اسناد حسابداری مرتبط نیز به صورت خودکار حذف و دفتر روزنامه بازنویسی خواهد شد.\n\nآیا از حذف و ابطال کامل این چک اطمینان دارید؟'
                              : 'آیا از حذف این چک اطمینان دارید؟';
                            if (window.confirm(confirmMsg)) {
                              onDeleteCheck(linkedCheck.id);
                            }
                          }}
                          className="flex items-center space-x-1 space-x-reverse text-red-600 bg-red-50 hover:bg-red-100 px-1.5 py-1 rounded-lg transition text-[9px] font-bold border border-red-100"
                        >
                          <Trash2 size={10} />
                          <span>حذف و ابطال چک</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-between items-center text-[10px] text-zinc-500 border-t border-zinc-50 pt-1.5 mt-1 font-mono">
                <span>مانده: {(ent.runningBalance ?? 0).toLocaleString()} ریال</span>
                <span>مبلغ: {((ent.debit || 0) + (ent.credit || 0)).toLocaleString()} ریال</span>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-white p-8 rounded-2xl border border-zinc-100 text-center font-sans text-xs text-zinc-400">
            هیچ گردشی برای این شخص در بازه زمانی تعیین‌شده یافت نشد.
          </div>
        )}
      </div>
    </div>
  );
}
