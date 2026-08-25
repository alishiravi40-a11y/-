import React, { useState, useMemo } from 'react';
import { AppState, CreditFile } from '../types';
import { CreditPartnerService } from '../services/creditPartnerService';
import { finalizeCreditFile, cancelCreditFileAtomic } from '../utils/partnerProcess';
import { ShieldCheck, CheckCircle2, AlertCircle, FileText, Search, User, Clock, Eye, Trash2 } from 'lucide-react';
import CreditFileDocuments from './CreditFileDocuments';

interface CentralCreditFileManagerProps {
  state: AppState;
  onUpdateState: (newState: AppState) => void;
}

export default function CentralCreditFileManager({ state, onUpdateState }: CentralCreditFileManagerProps) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'needs_revision'>('pending');
  const [search, setSearch] = useState('');
  const [selectedReviewFile, setSelectedReviewFile] = useState<CreditFile | null>(null);

  const resolveAgentPerson = (repId: string | undefined, customerRepId: string | undefined) => {
    const targetId = repId || customerRepId;
    if (!targetId) return undefined;
    const directPerson = state.persons?.find(p => p.id === targetId);
    if (directPerson) return directPerson;
    const bp = state.businessPartners?.find(p => p.id === targetId || p.personId === targetId);
    if (bp) {
      const bpPerson = state.persons?.find(p => p.id === bp.personId);
      if (bpPerson) return bpPerson;
    }
    const u = state.users?.find(u => u.id === targetId || u.personId === targetId);
    if (u) {
      const uPerson = u.personId ? state.persons?.find(p => p.id === u.personId) : undefined;
      if (uPerson) return uPerson;
    }
    const codePerson = state.persons?.find(p => p.code === targetId);
    if (codePerson) return codePerson;
    return undefined;
  };

  const files = useMemo(() => {
    return (state.creditFiles || [])
      .filter(f => {
        if (filter === 'all') return true;
        if (filter === 'pending') {
          return f.status === 'pending' || f.status === 'ready_to_send' || f.status === 'draft' || (f.status as string) === 'unreviewed';
        }
        return f.status === filter;
      })
      .filter(f => {
        if (!search) return true;
        const customer = state.persons.find(p => p.id === f.personId);
        const agentPerson = resolveAgentPerson(f.representativeId, customer?.representativeId);
        return (
          customer?.name.includes(search) || 
          f.id.includes(search) ||
          (agentPerson && agentPerson.name.includes(search))
        );
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [state.creditFiles, state.persons, state.businessPartners, state.users, filter, search]);

  const handleUpdateCreditFileFromReview = (updatedFile: CreditFile) => {
    let updatedState = { ...state };
    const updatedFiles = (state.creditFiles || []).map(f =>
      f.id === updatedFile.id ? updatedFile : f
    );
    updatedState.creditFiles = updatedFiles;

    const oldFile = (state.creditFiles || []).find(f => f.id === updatedFile.id);
    if (updatedFile.status === 'approved' && oldFile?.status !== 'approved') {
      try {
        const financialImpact = finalizeCreditFile(updatedFile.id, { ...state, creditFiles: updatedFiles });
        updatedState = {
          ...updatedState,
          ...financialImpact
        };
      } catch (err: any) {
        alert('خطا در صدور اتوماتیک سند حسابداری پرونده: ' + err.message);
        return;
      }
    }

    onUpdateState(updatedState);
    setSelectedReviewFile(updatedFile);

    CreditPartnerService.updateCreditFile(updatedFile.id, {
      status: updatedFile.status,
      paymentDocuments: updatedFile.paymentDocuments,
      receivedChecks: updatedFile.receivedChecks,
      revisionNote: updatedFile.revisionNote
    }).catch(err => console.error('Error updating status via service:', err));
  };

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-white p-6 rounded-3xl border border-zinc-150 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-zinc-900 flex items-center gap-2">
            <ShieldCheck className="text-rose-500" />
            بررسی پرونده‌های اعتباری نمایندگان
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            مدیریت، تایید و ارزیابی تک‌تک مدارک و چک‌های پرونده‌های اعتباری
          </p>
        </div>
        <div className="flex bg-zinc-100 p-1 rounded-xl">
          {(['pending', 'approved', 'needs_revision', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                filter === f ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {f === 'pending' ? 'در انتظار بررسی' :
               f === 'approved' ? 'تایید شده' :
               f === 'needs_revision' ? 'نیاز به اصلاح' : 'همه'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {files.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-150 p-10 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 bg-zinc-50 rounded-2xl flex items-center justify-center mb-4">
              <FileText className="text-zinc-300" size={32} />
            </div>
            <h3 className="text-zinc-500 font-bold">هیچ پرونده‌ای یافت نشد</h3>
          </div>
        ) : (
          files.map(file => {
            const customer = state.persons.find(p => p.id === file.personId);
            const agent = resolveAgentPerson(file.representativeId, customer?.representativeId);
            return (
              <div key={file.id} className="bg-white p-5 rounded-3xl border border-zinc-150 shadow-sm flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center text-rose-600">
                        <User size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-zinc-900">{customer?.name || 'مشتری نامشخص'}</h4>
                          {file.settlementType === 'checks' || (file.receivedChecks && file.receivedChecks.length > 0) ? (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[8px] font-black">
                              تسویه با چک (اسناد دریافتنی)
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[8px] font-black">
                              تسویه با دفترچه اقساط
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-500 flex items-center gap-1 mt-0.5">
                          <Clock size={10} />
                          ثبت: {new Date(file.createdAt).toLocaleDateString('fa-IR')}
                        </div>
                      </div>
                    </div>
                    <span className={`px-3 py-1 text-[10px] font-black rounded-lg ${
                      file.status === 'pending' ? 'bg-amber-50 text-amber-600' :
                      file.status === 'approved' ? 'bg-emerald-50 text-emerald-600' :
                      file.status === 'needs_revision' ? 'bg-rose-50 text-rose-600' :
                      'bg-zinc-100 text-zinc-600'
                    }`}>
                      {file.status === 'pending' ? 'در انتظار بررسی' :
                       file.status === 'approved' ? 'تایید شده' :
                       file.status === 'needs_revision' ? 'نیاز به اصلاح' : 'پیش‌نویس'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-zinc-50 rounded-2xl">
                    <div>
                      <div className="text-[10px] text-zinc-500 mb-1">مبلغ درخواستی</div>
                      <div className="font-bold text-zinc-900">{file.requestedAmount.toLocaleString()} ریال</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-500 mb-1">نماینده ثبت‌کننده</div>
                      <div className="font-bold text-zinc-900">{agent?.name || 'نامشخص'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-500 mb-1">تعداد اقساط</div>
                      <div className="font-bold text-zinc-900">{file.calculationResults?.installmentCount || 0} ماهه</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-500 mb-1">مبلغ هر قسط</div>
                      <div className="font-bold text-zinc-900">{(file.calculationResults?.installmentAmount || 0).toLocaleString()} ریال</div>
                    </div>
                  </div>
                </div>

                <div className="flex md:flex-col items-center justify-center gap-2 border-t md:border-t-0 md:border-r border-zinc-100 pt-4 md:pt-0 md:pr-6">
                  <button
                    onClick={() => setSelectedReviewFile(file)}
                    className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition shadow-sm"
                  >
                    <ShieldCheck size={16} />
                    بررسی مدارک و ارزیابی پرونده
                  </button>
                  {file.status === 'approved' && (
                    <button
                      onClick={() => {
                        if (confirm(`آیا از ابطال اتمیک پرونده اعتباری ${file.id} اطمینان دارید؟ این عمل غیرقابل بازگشت است و سند معکوس صادر خواهد کرد.`)) {
                          const res = cancelCreditFileAtomic(file.id, state, 'ابطال پرونده از پنل مدیریت مرکزی');
                          if (res.success && res.newState) {
                            onUpdateState(res.newState);
                            alert(res.message);
                          } else {
                            alert(res.message);
                          }
                        }
                      }}
                      className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 transition shadow-sm"
                    >
                      <Trash2 size={16} />
                      ابطال پرونده
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {selectedReviewFile && (
        <CreditFileDocuments 
          creditFile={selectedReviewFile}
          state={state}
          readOnly={true}
          isManager={true}
          onUpdateFile={handleUpdateCreditFileFromReview}
          onClose={() => setSelectedReviewFile(null)}
        />
      )}
    </div>
  );
}
