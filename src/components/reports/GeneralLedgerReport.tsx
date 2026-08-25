import React, { useState, useMemo } from 'react';
import { Search, Plus, Edit2, Trash2 } from 'lucide-react';
import { AppState, JournalVoucher } from '../../types';
import { useCoaReadModel } from '../../services/CoaReadService';

interface GeneralLedgerReportProps {
  selectedReport: 'general_subsidiary_ledger' | 'cash_bank_ledger' | 'general_journal';
  state: AppState;
  startDate: string;
  endDate: string;
  isFilterSubmitted: boolean;
  filterSubId: string;
  filterMinAmount: number;
  filterMaxAmount: number;
  onViewVoucher?: (voucherId: string) => void;
  onViewCheck?: (checkId: string) => void;
  onNewVoucher?: (type: 'manual' | 'automatic') => void;
  onEditVoucher?: (voucher: JournalVoucher) => void;
  onDeleteVoucher?: (voucher: JournalVoucher) => void;
  onOpenAdvancedSearch?: () => void;
}

export default function GeneralLedgerReport({
  selectedReport,
  state,
  startDate,
  endDate,
  isFilterSubmitted,
  filterSubId,
  filterMinAmount,
  filterMaxAmount,
  onViewVoucher,
  onViewCheck,
  onNewVoucher,
  onEditVoucher,
  onDeleteVoucher,
  onOpenAdvancedSearch
}: GeneralLedgerReportProps) {
  const { subsidiaries: activeSubsidiaries } = useCoaReadModel(state.subsidiaries);
  const [searchQuery, setSearchQuery] = useState('');

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

    let totalDebit = 0;
    let totalCredit = 0;

    filteredVouchers.forEach(v => {
      v.entries.forEach(e => {
        totalDebit += e.debit || 0;
        totalCredit += e.credit || 0;
      });
    });

    return {
      vouchers: filteredVouchers,
      totalDebit,
      totalCredit
    };
  }, [selectedReport, isFilterSubmitted, state.vouchers, startDate, endDate, filterMinAmount, filterMaxAmount]);

  // GENERAL & SUBSIDIARY LEDGER COMPILER
  const generalSubsidiaryResult = useMemo(() => {
    if (selectedReport !== 'general_subsidiary_ledger' || !isFilterSubmitted) return null;

    const sub = activeSubsidiaries.find(s => s.id === filterSubId);
    if (!sub) return null;

    const entries: {
      date: string;
      description: string;
      debit: number;
      credit: number;
      floatingName?: string;
      voucherId?: string;
      sourceType?: string;
      sourceId?: string;
    }[] = [];

    let totalDebit = 0;
    let totalCredit = 0;

    state.vouchers.forEach(v => {
      if (v.date >= startDate && v.date <= endDate) {
        v.entries.forEach(e => {
          if (e.subsidiaryId === filterSubId) {
            totalDebit += e.debit;
            totalCredit += e.credit;
            entries.push({
              date: v.date,
              description: e.description || v.description,
              debit: e.debit,
              credit: e.credit,
              floatingName: e.floatingDetailed?.name,
              voucherId: v.id,
              sourceType: v.sourceType,
              sourceId: v.sourceId
            });
          }
        });
      }
    });

    const diff = totalDebit - totalCredit;
    const isDebitNature = ['دارایی‌های جاری', 'دارایی‌های غیرجاری', 'هزینه‌ها'].includes(sub.groupType);
    const balance = isDebitNature ? diff : -diff;
    const natureLabel = diff > 0 ? 'بدهکار' : diff < 0 ? 'بستانکار' : 'بی‌حساب';

    return {
      sub,
      totalDebit,
      totalCredit,
      balance,
      natureLabel,
      entries
    };
  }, [selectedReport, isFilterSubmitted, state.vouchers, activeSubsidiaries, filterSubId, startDate, endDate]);

  // CASH & BANK LEDGER COMPILER
  const cashBankResult = useMemo(() => {
    if (selectedReport !== 'cash_bank_ledger' || !isFilterSubmitted) return null;

    const targetSubs = activeSubsidiaries.filter(s => 
      (s.generalType === 'صندوق‌ها' || s.generalType === 'بانک‌ها') &&
      (!filterSubId || s.id === filterSubId)
    );

    const summaries = targetSubs.map(sub => {
      let debitSum = 0;
      let creditSum = 0;
      const txs: any[] = [];

      state.vouchers.forEach(v => {
        if (v.date >= startDate && v.date <= endDate) {
          v.entries.forEach(e => {
            if (e.subsidiaryId === sub.id) {
              debitSum += e.debit;
              creditSum += e.credit;
              txs.push({
                date: v.date,
                description: e.description || v.description,
                debit: e.debit,
                credit: e.credit,
                voucherId: v.id
              });
            }
          });
        }
      });

      return {
        sub,
        debitSum,
        creditSum,
        balance: debitSum - creditSum,
        txs
      };
    }).filter(sum => sum.debitSum > 0 || sum.creditSum > 0);

    return summaries;
  }, [selectedReport, isFilterSubmitted, state.vouchers, state.subsidiaries, filterSubId, startDate, endDate]);

  if (selectedReport === 'general_journal' && generalJournalResult) {
    const displayedVouchers = generalJournalResult.vouchers.filter(v => 
      !searchQuery || 
      v.description.includes(searchQuery) || 
      v.voucherNumber.includes(searchQuery)
    );

    return (
      <div className="space-y-3">
        <div className="bg-white p-4 rounded-2xl border border-zinc-150 text-right space-y-2 flex justify-between items-center">
          <div className="flex gap-2">
            {onOpenAdvancedSearch && (
              <button 
                onClick={onOpenAdvancedSearch}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-bold hover:bg-blue-100 transition shadow-sm border border-blue-100"
                title="جستجوی پیشرفته اسناد"
              >
                <Search size={14} />
                <span>جستجوی هوشمند</span>
              </button>
            )}
            {onNewVoucher && (
              <button 
                onClick={() => onNewVoucher('manual')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-[10px] font-bold hover:bg-emerald-700 transition shadow-sm"
              >
                <Plus size={14} />
                <span>سند جدید</span>
              </button>
            )}
          </div>
          <div>
            <h3 className="font-sans font-bold text-sm text-zinc-800">دفتر روزنامه (اسناد حسابداری)</h3>
            <p className="text-xs text-zinc-500 mt-1">لیست تمامی اسناد ثبت شده در سیستم بر اساس فیلترهای اعمال شده</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-zinc-150 overflow-hidden text-right shadow-sm">
          {/* Summary row */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-zinc-50 border-b border-zinc-150 text-sm">
            <div className="flex flex-col space-y-1 bg-white p-3 rounded-xl border border-zinc-100 shadow-sm">
              <span className="text-zinc-500 text-[10px] font-bold">جمع کل بدهکار</span>
              <span className="font-mono font-bold text-emerald-600 text-sm">{generalJournalResult.totalDebit.toLocaleString()} ریال</span>
            </div>
            <div className="flex flex-col space-y-1 bg-white p-3 rounded-xl border border-zinc-100 shadow-sm">
              <span className="text-zinc-500 text-[10px] font-bold">جمع کل بستانکار</span>
              <span className="font-mono font-bold text-rose-600 text-sm">{generalJournalResult.totalCredit.toLocaleString()} ریال</span>
            </div>
          </div>

          <div className="p-4 bg-zinc-50 border-b border-zinc-150">
            <div className="bg-white p-2 rounded-xl border border-zinc-150 flex items-center space-x-2 space-x-reverse">
              <Search size={16} className="text-zinc-400" />
              <input
                type="text"
                placeholder="جستجو در شرح سند یا شماره سند..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none"
              />
            </div>
          </div>

          {displayedVouchers.length > 0 ? (
            <div className="p-3 flex flex-col space-y-3">
              {displayedVouchers.map((voucher) => (
                <div 
                  key={voucher.id} 
                  onClick={() => onViewVoucher && onViewVoucher(voucher.id)}
                  className="bg-white p-3.5 rounded-xl border border-zinc-100 flex flex-col space-y-2 shadow-sm hover:border-emerald-500/30 transition cursor-pointer"
                >
                  <div className="flex justify-between items-center border-b border-zinc-50 pb-2">
                    <span className="font-mono text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">شماره: {voucher.voucherNumber}</span>
                    <span className="font-mono text-[10px] text-zinc-500 bg-zinc-50 px-2 py-0.5 rounded-md">{voucher.date}</span>
                  </div>
                  <p className="text-zinc-700 font-medium text-xs pr-1">{voucher.description}</p>
                  
                  <div className="mt-2 bg-zinc-50 p-2 rounded-lg">
                    <div className="flex justify-between text-[10px] text-zinc-500 mb-1 border-b border-zinc-200 pb-1">
                      <span className="w-1/2">شرح آرتیکل</span>
                      <span className="w-1/4 text-center">بدهکار</span>
                      <span className="w-1/4 text-center">بستانکار</span>
                    </div>
                    {voucher.entries.map((ent, idx) => (
                      <div key={idx} className="flex justify-between text-[10px] py-1 border-b border-zinc-100 last:border-0 items-center">
                        <span className="w-1/2 text-zinc-700 truncate pr-1" title={ent.description}>{ent.description}</span>
                        <span className={`w-1/4 text-center font-mono ${ent.debit > 0 ? 'text-emerald-600 font-bold' : 'text-zinc-400'}`}>
                          {ent.debit > 0 ? ent.debit.toLocaleString() : '-'}
                        </span>
                        <span className={`w-1/4 text-center font-mono ${ent.credit > 0 ? 'text-rose-600 font-bold' : 'text-zinc-400'}`}>
                          {ent.credit > 0 ? ent.credit.toLocaleString() : '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex justify-end gap-2 pt-2 border-t border-zinc-50 mt-1">
                    {onEditVoucher && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); onEditVoucher(voucher); }}
                        className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition"
                        title="ویرایش سند"
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                    {onDeleteVoucher && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); onDeleteVoucher(voucher); }}
                        className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition"
                        title="حذف سند"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-zinc-400 text-xs font-sans">
              هیچ سندی با فیلترهای انتخابی یافت نشد.
            </div>
          )}
        </div>
      </div>
    );
  }

  if (selectedReport === 'general_subsidiary_ledger' && generalSubsidiaryResult) {
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
            <span className="text-[10px] text-zinc-400 block font-sans">دفتر حساب معین</span>
            <h4 className="font-sans text-sm font-bold text-zinc-800">({generalSubsidiaryResult.sub.code}) - {generalSubsidiaryResult.sub.name}</h4>
            <div className="flex justify-between font-mono text-xs border-t border-zinc-100 pt-2.5 mt-2">
              <span className="font-bold text-zinc-800">
                {generalSubsidiaryResult.balance.toLocaleString()} ریال ({generalSubsidiaryResult.natureLabel})
              </span>
              <span className="text-zinc-500">:مانده تراز دفتر</span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {generalSubsidiaryResult.entries.map((ent, idx) => (
            <div 
              key={idx} 
              onClick={() => {
                if (ent.sourceType === 'check_state_change' && ent.sourceId && onViewCheck) {
                  onViewCheck(ent.sourceId);
                  return;
                }
                if (ent.voucherId && onViewVoucher) {
                  onViewVoucher(ent.voucherId);
                }
              }}
              className={`bg-white p-3 rounded-xl border border-zinc-100 text-right font-sans text-xs flex flex-col space-y-1 relative group ${ent.voucherId ? 'cursor-pointer hover:border-emerald-500/30 transition' : ''}`}
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
                <span className="text-zinc-400">مبلغ: {(ent.debit || ent.credit).toLocaleString()} ریال</span>
              </div>
              <p className="text-zinc-700 font-medium">{ent.description}</p>
              {ent.floatingName && (
                <div className="text-[9px] text-emerald-600 bg-emerald-50/50 px-2 py-0.5 rounded self-start">
                  تفصیلی: {ent.floatingName}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (selectedReport === 'cash_bank_ledger' && cashBankResult) {
    return (
      <div className="space-y-4">
        {cashBankResult.map((sum, idx) => (
          <div key={idx} className="bg-white p-4 rounded-2xl border border-zinc-150 text-right space-y-3 shadow-sm">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
              <span className="font-mono font-bold text-emerald-600">{sum.balance.toLocaleString()} ریال</span>
              <span className="font-sans text-xs font-bold text-zinc-800">{sum.sub.name}</span>
            </div>

            <div className="space-y-2 pt-1 max-h-[160px] overflow-y-auto">
              {sum.txs.map((tx: any, tIdx: number) => (
                <div 
                  key={tIdx} 
                  onClick={() => tx.voucherId && onViewVoucher && onViewVoucher(tx.voucherId)}
                  className={`bg-zinc-50 p-2 rounded-lg text-right font-sans text-[10px] flex justify-between items-center ${tx.voucherId ? 'cursor-pointer hover:bg-emerald-50 transition' : ''}`}
                >
                  <span className={tx.debit > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                    {tx.debit > 0 ? `+${tx.debit.toLocaleString()}` : `-${tx.credit.toLocaleString()}`}
                  </span>
                  <span className="text-zinc-600">{tx.description}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}
