import React, { useState } from 'react';
import { 
  X, User, CreditCard, FileText, Calendar, 
  CheckCircle2, Clock, AlertCircle, ShoppingBag, 
  Wallet, Shield, Phone, Tag
} from 'lucide-react';
import { Person, AppState, CreditFile, Check } from '../types';

interface CustomerDossierModalProps {
  customer: Person;
  appState: AppState;
  currentAgentId?: string;
  onClose: () => void;
}

export default function CustomerDossierModal({
  customer,
  appState,
  currentAgentId,
  onClose
}: CustomerDossierModalProps) {
  const [activeTab, setActiveTab] = useState<'timeline' | 'credit_files' | 'checks' | 'orders'>('timeline');

  // Customer's Credit Files
  const customerCreditFiles = (appState.creditFiles || []).filter(
    f => f.personId === customer.id
  );

  // Customer's Credit Requests
  const customerRequests = (appState.partnerCreditRequests || []).filter(
    r => r.customerPersonId === customer.id
  );

  // Customer's Checks
  const customerChecks = (appState.checks || []).filter(
    c => c.personId === customer.id
  );

  // Customer's Orders
  const customerOrders = (appState.partnerOrders || []).filter(
    o => o.createdBy === customer.id || o.items?.some(i => i.productId) // fallback or partner orders
  );

  // Summary Metrics
  const totalApprovedAmount = customerCreditFiles
    .filter(f => f.status === 'approved')
    .reduce((sum, f) => sum + (f.requestedAmount || 0), 0);

  const pendingRequestsCount = customerCreditFiles.filter(
    f => f.status === 'pending' || f.status === 'ready_to_send'
  ).length;

  const totalChecksAmount = customerChecks.reduce((sum, c) => sum + c.amount, 0);

  // Build unified timeline of all activities up to now
  const timelineEvents = [
    ...customerCreditFiles.map(f => ({
      id: f.id,
      type: 'credit_file',
      title: `پرونده اعتباری (${f.status === 'approved' ? 'تایید شده' : f.status === 'pending' ? 'در انتظار تایید' : 'پیش‌نویس'})`,
      date: f.createdAt,
      amount: f.requestedAmount,
      calculatorName: f.calculatorName || 'ماشین‌حساب',
      status: f.status,
      details: f.revisionNote ? `یادداشت: ${f.revisionNote}` : ''
    })),
    ...customerRequests.map(r => ({
      id: r.id,
      type: 'credit_request',
      title: `درخواست اعتبار (${r.status})`,
      date: r.createdAt,
      amount: r.requestedAmount,
      calculatorName: '-',
      status: r.status,
      details: ''
    })),
    ...customerChecks.map(c => ({
      id: c.id,
      type: 'check',
      title: `چک سری ${c.checkNumber || '-'} (${c.bankName || 'بانک'})`,
      date: c.createdAt || c.dueDate,
      amount: c.amount,
      calculatorName: `سررسید: ${c.dueDate}`,
      status: c.currentState,
      details: `صیادی: ${c.sayadiNumber || 'ثبت نشده'}`
    }))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-zinc-950/50 backdrop-blur-sm animate-in fade-in duration-200" dir="rtl">
      <div className="bg-white rounded-[32px] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-zinc-200">
        
        {/* Header */}
        <div className="p-6 bg-zinc-900 text-white flex items-center justify-between relative overflow-hidden">
          <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -ml-20 -mt-20" />
          
          <div className="flex items-center gap-4 relative z-10">
            <div className="w-14 h-14 bg-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-900/40">
              <User size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black">{customer.name}</h2>
                <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                  {customer.code || 'مشتری'}
                </span>
              </div>
              <div className="flex items-center gap-4 text-zinc-400 text-xs mt-1 font-mono">
                <span>کد ملی: {customer.nationalId || 'ثبت نشده'}</span>
                {customer.mobile && <span>| تلفن: {customer.mobile}</span>}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2.5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-2xl transition-all relative z-10"
          >
            <X size={22} />
          </button>
        </div>

        {/* Quick Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-zinc-50 border-b border-zinc-100">
          <div className="bg-white p-3.5 rounded-2xl border border-zinc-100 shadow-sm flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <FileText size={18} />
            </div>
            <div>
              <p className="text-[10px] text-zinc-400 font-bold">کل پرونده‌ها</p>
              <p className="text-sm font-black text-zinc-800">{customerCreditFiles.length} پرونده</p>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-zinc-100 shadow-sm flex items-center gap-3">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <p className="text-[10px] text-zinc-400 font-bold">اعتبار تایید شده</p>
              <p className="text-sm font-black text-emerald-600">{totalApprovedAmount.toLocaleString()} <span className="text-[9px] font-normal">ریال</span></p>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-zinc-100 shadow-sm flex items-center gap-3">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <Clock size={18} />
            </div>
            <div>
              <p className="text-[10px] text-zinc-400 font-bold">در انتظار تایید</p>
              <p className="text-sm font-black text-amber-600">{pendingRequestsCount} مورد</p>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-zinc-100 shadow-sm flex items-center gap-3">
            <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
              <CreditCard size={18} />
            </div>
            <div>
              <p className="text-[10px] text-zinc-400 font-bold">مجموع چک‌ها</p>
              <p className="text-sm font-black text-purple-600">{customerChecks.length} فقره ({totalChecksAmount.toLocaleString()} ریال)</p>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-zinc-100 px-6 gap-2 bg-white">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'timeline'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-zinc-400 hover:text-zinc-700'
            }`}
          >
            تاریخچه کامل اقدامات تا این ساعت
          </button>
          <button
            onClick={() => setActiveTab('credit_files')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'credit_files'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-zinc-400 hover:text-zinc-700'
            }`}
          >
            پرونده‌های اعتباری ({customerCreditFiles.length})
          </button>
          <button
            onClick={() => setActiveTab('checks')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'checks'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-zinc-400 hover:text-zinc-700'
            }`}
          >
            چک‌ها و اسناد ({customerChecks.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider mb-4">
                خلاصه فعالیت‌ها و پرونده‌های ثبت شده تا این زمان
              </h3>

              {timelineEvents.length === 0 ? (
                <div className="text-center py-12 text-zinc-400 text-xs italic">
                  هنوز هیچ پرونده یا اقدامی برای این مشتری ثبت نشده است.
                </div>
              ) : (
                <div className="relative border-r-2 border-zinc-100 pr-6 space-y-6">
                  {timelineEvents.map((evt, idx) => (
                    <div key={`${evt.id}_${idx}`} className="relative">
                      {/* Timeline Dot */}
                      <div className="absolute -right-[31px] top-1 w-4 h-4 rounded-full bg-emerald-500 border-4 border-white shadow-sm" />
                      
                      <div className="bg-zinc-50 rounded-2xl p-4 border border-zinc-100 hover:border-emerald-200 transition-all">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-xs text-zinc-800">{evt.title}</span>
                          <span className="text-[10px] text-zinc-400 font-mono">
                            {new Date(evt.date).toLocaleDateString('fa-IR')}
                          </span>
                        </div>

                        {evt.amount && (
                          <p className="text-xs font-black text-emerald-600 mt-1">
                            مبلغ: {evt.amount.toLocaleString()} ریال
                          </p>
                        )}

                        {evt.calculatorName && (
                          <p className="text-[10px] text-zinc-500 mt-0.5">
                            {evt.calculatorName}
                          </p>
                        )}

                        {evt.details && (
                          <p className="text-[10px] text-zinc-400 mt-1 italic">
                            {evt.details}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'credit_files' && (
            <div className="space-y-3">
              {customerCreditFiles.length === 0 ? (
                <div className="text-center py-12 text-zinc-400 text-xs italic">
                  پرونده اعتباری وجود ندارد.
                </div>
              ) : (
                customerCreditFiles.map(file => (
                  <div key={file.id} className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-zinc-900">{file.id}</span>
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                          {file.calculatorName || 'ماشین‌حساب'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 font-mono mt-1">
                        مبلغ درخواستی: <strong className="text-zinc-900">{file.requestedAmount.toLocaleString()}</strong> ریال
                      </p>
                    </div>

                    <span className={`px-2.5 py-1 rounded-xl text-[10px] font-bold ${
                      file.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                      file.status === 'pending' ? 'bg-blue-100 text-blue-700' : 'bg-zinc-200 text-zinc-600'
                    }`}>
                      {file.status === 'approved' ? 'تایید شده' : file.status === 'pending' ? 'در انتظار بررسی' : 'پیش‌نویس'}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'checks' && (
            <div className="space-y-3">
              {customerChecks.length === 0 ? (
                <div className="text-center py-12 text-zinc-400 text-xs italic">
                  چکی ثبت نشده است.
                </div>
              ) : (
                customerChecks.map(chk => (
                  <div key={chk.id} className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-zinc-900">چک شماره {chk.checkNumber}</span>
                        <span className="text-[10px] text-zinc-500">({chk.bankName})</span>
                      </div>
                      <p className="text-xs text-zinc-500 font-mono mt-1">
                        مبلغ: <strong className="text-emerald-600">{chk.amount.toLocaleString()}</strong> ریال | سررسید: {chk.dueDate}
                      </p>
                    </div>
                    <span className="text-[10px] font-bold bg-zinc-200 text-zinc-700 px-2.5 py-1 rounded-xl">
                      {chk.currentState}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-zinc-50 border-t border-zinc-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-zinc-900 text-white rounded-2xl text-xs font-bold hover:bg-zinc-800 transition-all"
          >
            بستن پرونده
          </button>
        </div>
      </div>
    </div>
  );
}
