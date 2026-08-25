/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  CheckCircle2, XCircle, AlertCircle, FileText, CheckSquare, Search, Trash2, Edit2, Undo2
} from 'lucide-react';
import { AppState, JournalVoucher, VoucherEntry } from '../types';
import { CreditControlDraft } from '../modules/creditControl/creditControl.types';

interface CreditControlApprovalProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}

export default function CreditControlApproval({ state, setState }: CreditControlApprovalProps) {
  const [filterStatus, setFilterStatus] = useState<'pending' | 'all'>('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [rejectionReasonInputs, setRejectionReasonInputs] = useState<Record<string, string>>({});
  const [activeRejectionId, setActiveRejectionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Filter and search drafts
  const filteredDrafts = useMemo(() => {
    const drafts = state.creditControlDrafts || [];
    return drafts.filter(draft => {
      // Status filter
      if (filterStatus === 'pending' && draft.status !== 'pending') {
        return false;
      }

      // Search term filter
      if (searchTerm) {
        const agent = state.persons?.find(p => p.id === draft.agentId);
        const agentName = agent ? agent.name : '';
        const agentCode = agent ? agent.code : '';
        const matchesSearch = 
          draft.invoiceNumber.toString().includes(searchTerm) ||
          draft.calculationDate.includes(searchTerm) ||
          agentName.includes(searchTerm) ||
          agentCode.includes(searchTerm);
        
        return matchesSearch;
      }

      return true;
    });
  }, [state.creditControlDrafts, state.persons, filterStatus, searchTerm]);

  // Handle Approve Draft
  const handleApprove = (draft: CreditControlDraft) => {
    setFeedback(null);

    // 7. Prevent approval of already approved/rejected drafts
    if (draft.status !== 'pending') {
      setFeedback({ type: 'error', message: 'این پیش‌نویس قبلاً تعیین تکلیف شده است.' });
      return;
    }

    // 9. Uniqueness check (جلوگیری از ایجاد سند تکراری)
    const voucherId = `v_auto_penalty_${draft.id}`;
    const voucherExists = (state.vouchers || []).some(v => v.id === voucherId || v.sourceId === draft.id);
    if (voucherExists) {
      setFeedback({ type: 'error', message: 'خطا: سند حسابداری جریمه برای این پیش‌نویس قبلاً در سیستم ثبت شده است!' });
      return;
    }

    const agent = state.persons?.find(p => p.id === draft.agentId);
    const agentName = agent ? agent.name : 'نماینده ناشناس';
    const accountantNote = noteInputs[draft.id] || '';

    // Calculate next voucher number
    const nextVoucherNo = Math.max(0, ...(state.vouchers || []).map(v => v.voucherNumber)) + 1;

    // Create the standard double-entry voucher
    const entries: VoucherEntry[] = [
      {
        subsidiaryId: 'SUB_DEBTORS', // Debit: Commercial debtors (Agent current account)
        floatingDetailed: { type: 'person', id: draft.agentId, name: agentName },
        debit: draft.penaltyAmount,
        credit: 0,
        description: `بدهکار: جریمه دیرکرد روزانه فاکتور ${draft.invoiceNumber} مورخ ${draft.calculationDate}`
      },
      {
        subsidiaryId: 'SUB_OTHER_REVENUE', // Credit: Late fee penalty revenue
        debit: 0,
        credit: draft.penaltyAmount,
        description: `بستانکار: درآمد کارمزد جریمه دیرکرد نماینده ${agentName}`
      }
    ];

    const newVoucher: JournalVoucher = {
      id: voucherId,
      voucherNumber: nextVoucherNo,
      date: draft.calculationDate,
      gregorianDate: new Date().toISOString(),
      description: `ثبت جریمه دیرکرد فاکتور شماره ${draft.invoiceNumber} نماینده ${agentName} ${accountantNote ? `| یادداشت: ${accountantNote}` : ''}`,
      entries,
      isAutomatic: true,
      sourceType: 'manual',
      sourceId: draft.id,
      status: 'active'
    };

    // Update state atomically
    setState(prev => {
      const updatedDrafts = (prev.creditControlDrafts || []).map(d => {
        if (d.id === draft.id) {
          return {
            ...d,
            status: 'approved' as const,
            voucherId: newVoucher.id,
            note: accountantNote || undefined
          };
        }
        return d;
      });

      return {
        ...prev,
        vouchers: [...(prev.vouchers || []), newVoucher],
        creditControlDrafts: updatedDrafts
      };
    });

    setFeedback({ 
      type: 'success', 
      message: `پیش‌نویس جریمه فاکتور ${draft.invoiceNumber} با موفقیت تأیید شد و سند حسابداری شماره ${nextVoucherNo} صادر گردید.` 
    });
  };

  // Handle Reject Draft
  const handleReject = (draftId: string) => {
    setFeedback(null);
    const reason = rejectionReasonInputs[draftId] || '';
    if (!reason.trim()) {
      setFeedback({ type: 'error', message: 'وارد کردن علت رد الزامی است.' });
      return;
    }

    const draft = (state.creditControlDrafts || []).find(d => d.id === draftId);
    if (!draft || draft.status !== 'pending') {
      setFeedback({ type: 'error', message: 'پیش‌نویس مورد نظر یافت نشد یا وضعیت آن نامعتبر است.' });
      return;
    }

    // Update state atomically
    setState(prev => {
      const updatedDrafts = (prev.creditControlDrafts || []).map(d => {
        if (d.id === draftId) {
          return {
            ...d,
            status: 'rejected' as const,
            rejectionReason: reason,
            note: noteInputs[draftId] || undefined
          };
        }
        return d;
      });

      return {
        ...prev,
        creditControlDrafts: updatedDrafts
      };
    });

    setActiveRejectionId(null);
    setFeedback({ 
      type: 'info', 
      message: `پیش‌نویس جریمه با موفقیت رد شد و هیچ سند حسابداری صادر نگردید.` 
    });
  };

  return (
    <div className="space-y-6" id="credit-control-approval-container">
      {/* Title & Description Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-zinc-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight font-display mb-1">
            تأیید پیش‌نویس جریمه دیرکرد
          </h1>
          <p className="text-sm text-zinc-500">
            بررسی، تعیین تکلیف و صدور سند حسابداری خودکار برای پیش‌نویس‌های جریمه دیرکرد نمایندگان فروش
          </p>
        </div>
      </div>

      {/* Global Feedback Alert */}
      {feedback && (
        <div 
          id="approval-feedback-alert"
          className={`p-4 rounded-xl flex items-start gap-3 border text-sm animate-fade-in ${
            feedback.type === 'success' 
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-800' 
              : feedback.type === 'error'
              ? 'bg-rose-50/80 border-rose-200 text-rose-800'
              : 'bg-blue-50/80 border-blue-200 text-blue-800'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : feedback.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          ) : (
            <FileText className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Controls: Filter & Search */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
          {/* Status Tabs */}
          <div className="flex bg-zinc-100 p-1 rounded-xl w-full sm:w-auto" id="filter-tabs">
            <button
              onClick={() => setFilterStatus('pending')}
              className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                filterStatus === 'pending'
                  ? 'bg-white text-zinc-950 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              در انتظار تأیید ({ (state.creditControlDrafts || []).filter(d => d.status === 'pending').length })
            </button>
            <button
              onClick={() => setFilterStatus('all')}
              className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                filterStatus === 'all'
                  ? 'bg-white text-zinc-950 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              همه موارد ({ (state.creditControlDrafts || []).length })
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-72" id="search-box">
            <Search className="absolute right-3.5 top-3 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="جستجو بر اساس فاکتور، تاریخ یا نماینده..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-4 pr-10 py-2.5 text-xs rounded-xl border border-zinc-200 bg-zinc-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:border-transparent transition-all"
            />
          </div>
        </div>
      </div>

      {/* Drafts List / Table */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden" id="drafts-table-container">
        {filteredDrafts.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center space-y-3">
            <FileText className="w-12 h-12 text-zinc-300 stroke-[1.5]" />
            <p className="text-sm font-semibold text-zinc-600">هیچ پیش‌نویس جریمه‌ای یافت نشد</p>
            <p className="text-xs text-zinc-400">پیش‌نویس‌های جریمه دیرکرد پس از اجرای موتور روزانه در کنترل حساب در اینجا لیست می‌شوند.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-semibold select-none">
                  <th className="p-4">نماینده</th>
                  <th className="p-4">شماره فاکتور</th>
                  <th className="p-4">تاریخ محاسبه</th>
                  <th className="p-4">مانده مبنای محاسبه</th>
                  <th className="p-4">نرخ روزانه جریمه</th>
                  <th className="p-4">مبلغ جریمه</th>
                  <th className="p-4">توضیحات / یادداشت</th>
                  <th className="p-4">وضعیت</th>
                  <th className="p-4 text-left">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-zinc-700">
                {filteredDrafts.map(draft => {
                  const agent = state.persons?.find(p => p.id === draft.agentId);
                  const agentName = agent ? agent.name : 'ناشناس';
                  const agentCode = agent ? agent.code : '';
                  const isPending = draft.status === 'pending';

                  return (
                    <tr 
                      key={draft.id} 
                      className="hover:bg-zinc-50/50 transition-colors"
                      id={`draft-row-${draft.id}`}
                    >
                      {/* 1. Agent Info */}
                      <td className="p-4">
                        <div className="font-semibold text-zinc-900">{agentName}</div>
                        <div className="text-[10px] text-zinc-400 mt-0.5">{agentCode}</div>
                      </td>

                      {/* 2. Invoice Number */}
                      <td className="p-4 font-mono font-medium">{draft.invoiceNumber}</td>

                      {/* 3. Calculation Date */}
                      <td className="p-4 font-mono">{draft.calculationDate}</td>

                      {/* 4. Calculation Base Balance */}
                      <td className="p-4 font-mono font-semibold">{draft.baseRemainingAmount.toLocaleString()} ریال</td>

                      {/* 5. Penalty Percentage */}
                      <td className="p-4 font-mono text-zinc-600">{draft.penaltyPercentage}%</td>

                      {/* 6. Penalty Amount */}
                      <td className="p-4 font-mono font-bold text-zinc-900">{draft.penaltyAmount.toLocaleString()} ریال</td>

                      {/* 7. Note Input / Display */}
                      <td className="p-4 max-w-xs">
                        {isPending ? (
                          <input
                            type="text"
                            placeholder="افزودن یادداشت حسابدار..."
                            value={noteInputs[draft.id] || ''}
                            onChange={e => setNoteInputs(prev => ({ ...prev, [draft.id]: e.target.value }))}
                            className="w-full px-2.5 py-1.5 text-[11px] border border-zinc-200 rounded-lg bg-zinc-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-950 transition-all"
                          />
                        ) : (
                          <div className="space-y-1 text-xs">
                            {draft.note && (
                              <div className="text-zinc-600 italic">
                                <span className="font-semibold text-[10px] text-zinc-400 block">یادداشت:</span>
                                {draft.note}
                              </div>
                            )}
                            {draft.status === 'rejected' && draft.rejectionReason && (
                              <div className="text-rose-600 font-medium">
                                <span className="font-semibold text-[10px] text-rose-400 block">علت رد:</span>
                                {draft.rejectionReason}
                              </div>
                            )}
                            {draft.status === 'approved' && draft.voucherId && (
                              <div className="text-emerald-700 font-mono text-[10px] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 inline-block">
                                سند: {draft.voucherId}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 8. Status Badge */}
                      <td className="p-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-semibold tracking-wide border ${
                          draft.status === 'approved'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : draft.status === 'rejected'
                            ? 'bg-rose-50 border-rose-200 text-rose-800'
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                        }`}>
                          {draft.status === 'approved' ? 'تأیید شده' : draft.status === 'rejected' ? 'رد شده' : 'در انتظار تأیید'}
                        </span>
                      </td>

                      {/* 9. Action Buttons */}
                      <td className="p-4 text-left">
                        {isPending ? (
                          <div className="flex items-center justify-end gap-2">
                            {activeRejectionId === draft.id ? (
                              <div className="flex flex-col gap-2 p-2 bg-rose-50 border border-rose-100 rounded-xl max-w-xs text-right animate-fade-in">
                                <span className="font-semibold text-rose-800 text-[10px]">علت رد پیش‌نویس:</span>
                                <input
                                  type="text"
                                  placeholder="علت رد را بنویسید..."
                                  value={rejectionReasonInputs[draft.id] || ''}
                                  onChange={e => setRejectionReasonInputs(prev => ({ ...prev, [draft.id]: e.target.value }))}
                                  className="px-2.5 py-1.5 text-[11px] border border-rose-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-rose-500 transition-all text-right"
                                  autoFocus
                                />
                                <div className="flex gap-1 justify-end">
                                  <button
                                    onClick={() => handleReject(draft.id)}
                                    className="px-2.5 py-1 bg-rose-600 text-white rounded text-[10px] font-semibold hover:bg-rose-700 transition-colors"
                                  >
                                    ثبت رد
                                  </button>
                                  <button
                                    onClick={() => setActiveRejectionId(null)}
                                    className="px-2.5 py-1 bg-zinc-200 text-zinc-700 rounded text-[10px] font-semibold hover:bg-zinc-300 transition-colors"
                                  >
                                    انصراف
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleApprove(draft)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-zinc-950 text-white rounded-xl text-xs font-semibold hover:bg-zinc-800 transition-all shadow-sm"
                                  id={`approve-btn-${draft.id}`}
                                >
                                  <CheckSquare className="w-3.5 h-3.5" />
                                  تأیید و صدور سند
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveRejectionId(draft.id);
                                    setFeedback(null);
                                  }}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 border border-zinc-200 hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 transition-all"
                                  id={`reject-btn-${draft.id}`}
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  رد
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-400 text-[11px]">تعیین تکلیف شده</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
