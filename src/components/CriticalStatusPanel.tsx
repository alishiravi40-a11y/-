import React, { useState, useMemo } from 'react';
import { Person, AppState, CriticalDetails } from '../types';
import { AlertCircle, FileText, CheckCircle2, X, Save, TrendingDown, Wallet, Clock, ShieldCheck } from 'lucide-react';

interface CriticalStatusPanelProps {
  person: Person;
  appState: AppState;
  onClose: () => void;
  onUpdateNotes: (notes: string) => void;
  onUpdateStatus?: (status: Partial<CriticalDetails>) => void;
}

const CriticalStatusPanel: React.FC<CriticalStatusPanelProps> = ({ 
  person, 
  appState, 
  onClose, 
  onUpdateNotes,
  onUpdateStatus 
}) => {
  const [notes, setNotes] = useState(person.criticalDetails?.manualNotes || '');
  const [isEditingNotes, setIsEditingNotes] = useState(false);

  const stats = useMemo(() => {
    // 1. Normal Invoice Debt
    let normalDebt = 0;
    appState.invoices.forEach(inv => {
      if (inv.personId === person.id && !inv.isProInvoice) {
        if (inv.type === 'sell') {
          normalDebt += (inv.totalAmount - (inv.paidAmount || 0));
        } else {
          normalDebt -= (inv.totalAmount - (inv.paidAmount || 0));
        }
      }
    });

    // 2. Installment Debt
    let installmentDebt = 0;
    appState.installmentBooks.forEach(book => {
      if (book.personId === person.id && book.status === 'active') {
        const bookInstallments = appState.installments.filter(inst => inst.bookId === book.id);
        bookInstallments.forEach(inst => {
          if (inst.status !== 'paid') {
            installmentDebt += (inst.amount - inst.paidAmount);
          }
        });
      }
    });

    // 3. Outstanding Received Checks (not yet cleared/passed)
    let outstandingChecks = 0;
    appState.checks.forEach(check => {
      if (check.personId === person.id && check.type === 'received' && !check.isAmani) {
        // Only count if it's still an active obligation (not cleared, not passed to others, not returned to customer if bounced)
        const isActuallyOutstanding = 
          check.currentState === 'present_in_cashbox' || 
          check.currentState === 'deposited_to_bank' || 
          (check.currentState === 'bounced' && check.currentSubState !== 'returned_to_customer');
          
        if (isActuallyOutstanding) {
          outstandingChecks += check.amount;
        }
      }
    });

    return {
      normalDebt,
      installmentDebt,
      outstandingChecks,
      total: normalDebt + installmentDebt + outstandingChecks
    };
  }, [person.id, appState]);

  const getStatusLabel = (type: keyof CriticalDetails, value: string) => {
    if (type === 'phoneBoxStatus') {
      if (value === 'at_store') return { label: 'نزد فروشگاه', color: 'text-amber-600 bg-amber-50' };
      if (value === 'delivered') return { label: 'تحویل مشتری', color: 'text-emerald-600 bg-emerald-50' };
      return { label: 'نامشخص / ندارد', color: 'text-zinc-400 bg-zinc-50' };
    }
    if (type === 'ownershipStatus') {
      if (value === 'at_store') return { label: 'سند نزد فروشگاه', color: 'text-amber-600 bg-amber-50' };
      if (value === 'delivered') return { label: 'انتقال داده شده', color: 'text-emerald-600 bg-emerald-50' };
      return { label: 'نامشخص', color: 'text-zinc-400 bg-zinc-50' };
    }
    if (type === 'guaranteeCheckStatus') {
      if (value === 'at_store') return { label: 'نزد فروشگاه', color: 'text-amber-600 bg-amber-50' };
      if (value === 'delivered') return { label: 'عودت داده شده', color: 'text-emerald-600 bg-emerald-50' };
      return { label: 'ندارد', color: 'text-zinc-400 bg-zinc-50' };
    }
    return { label: 'نامشخص', color: 'text-zinc-400 bg-zinc-50' };
  };

  const handleSaveNotes = () => {
    onUpdateNotes(notes);
    setIsEditingNotes(false);
  };

  return (
    <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] max-w-lg w-full shadow-2xl border border-zinc-100 flex flex-col overflow-hidden animate-in zoom-in-95 duration-300" dir="rtl">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600">
              <ShieldCheck size={24} />
            </div>
            <div className="text-right">
              <h3 className="font-sans text-base font-black text-zinc-900">پنل وضعیت ضروری مشتری</h3>
              <p className="font-sans text-[10px] text-amber-700 font-bold uppercase tracking-wider">{person.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-white/50 text-zinc-400 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
          {/* Consolidated Debt Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Wallet size={16} className="text-zinc-400" />
              <span className="font-sans text-xs font-bold text-zinc-500">تجمیع بدهی و تعهدات مالی</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-50 p-4 rounded-3xl border border-zinc-100">
                <span className="text-[10px] text-zinc-400 block mb-1">بدهی حساب فاکتوری</span>
                <span className="font-mono text-sm font-bold text-zinc-800">{stats.normalDebt.toLocaleString()} <small className="text-[9px]">ریال</small></span>
              </div>
              <div className="bg-zinc-50 p-4 rounded-3xl border border-zinc-100">
                <span className="text-[10px] text-zinc-400 block mb-1">مانده اقساط فعال</span>
                <span className="font-mono text-sm font-bold text-zinc-800">{stats.installmentDebt.toLocaleString()} <small className="text-[9px]">ریال</small></span>
              </div>
              <div className="bg-zinc-50 p-4 rounded-3xl border border-zinc-100">
                <span className="text-[10px] text-zinc-400 block mb-1">چک‌های درجریان وصول</span>
                <span className="font-mono text-sm font-bold text-zinc-800">{stats.outstandingChecks.toLocaleString()} <small className="text-[9px]">ریال</small></span>
              </div>
              <div className="bg-rose-50 p-4 rounded-3xl border border-rose-100">
                <span className="text-[10px] text-rose-400 block mb-1 font-bold">مجموع کل تعهدات</span>
                <span className="font-mono text-sm font-black text-rose-700">{stats.total.toLocaleString()} <small className="text-[9px]">ریال</small></span>
              </div>
            </div>
          </div>

          {/* Critical Items Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={16} className="text-zinc-400" />
              <span className="font-sans text-xs font-bold text-zinc-500">وضعیت اقلام امانی و اسناد</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                <span className="text-xs font-bold text-zinc-600">کارتن و جعبه گوشی</span>
                {onUpdateStatus ? (
                  <select
                    value={person.criticalDetails?.phoneBoxStatus || 'none'}
                    onChange={(e) => onUpdateStatus({ phoneBoxStatus: e.target.value as any })}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-xl bg-white border border-zinc-200 text-zinc-700 focus:outline-none focus:border-amber-500 shadow-sm transition-colors"
                  >
                    <option value="none">نامشخص / ندارد</option>
                    <option value="at_store">نزد فروشگاه (امانت)</option>
                    <option value="delivered">تحویل به مشتری</option>
                  </select>
                ) : (
                  <span className={`text-[10px] font-bold px-3 py-1 rounded-full ${getStatusLabel('phoneBoxStatus', person.criticalDetails?.phoneBoxStatus || 'none').color}`}>
                    {getStatusLabel('phoneBoxStatus', person.criticalDetails?.phoneBoxStatus || 'none').label}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                <span className="text-xs font-bold text-zinc-600">وضعیت مالکیت و انتقال</span>
                {onUpdateStatus ? (
                  <select
                    value={person.criticalDetails?.ownershipStatus || 'none'}
                    onChange={(e) => onUpdateStatus({ ownershipStatus: e.target.value as any })}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-xl bg-white border border-zinc-200 text-zinc-700 focus:outline-none focus:border-amber-500 shadow-sm transition-colors"
                  >
                    <option value="none">نامشخص</option>
                    <option value="at_store">سند نزد فروشگاه</option>
                    <option value="delivered">انتقال داده شده</option>
                  </select>
                ) : (
                  <span className={`text-[10px] font-bold px-3 py-1 rounded-full ${getStatusLabel('ownershipStatus', person.criticalDetails?.ownershipStatus || 'none').color}`}>
                    {getStatusLabel('ownershipStatus', person.criticalDetails?.ownershipStatus || 'none').label}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                <span className="text-xs font-bold text-zinc-600">چک ضمانت تخلیه</span>
                {onUpdateStatus ? (
                  <select
                    value={person.criticalDetails?.guaranteeCheckStatus || 'none'}
                    onChange={(e) => onUpdateStatus({ guaranteeCheckStatus: e.target.value as any })}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-xl bg-white border border-zinc-200 text-zinc-700 focus:outline-none focus:border-amber-500 shadow-sm transition-colors"
                  >
                    <option value="none">ندارد</option>
                    <option value="at_store">نزد فروشگاه</option>
                    <option value="delivered">عودت داده شده</option>
                  </select>
                ) : (
                  <span className={`text-[10px] font-bold px-3 py-1 rounded-full ${getStatusLabel('guaranteeCheckStatus', person.criticalDetails?.guaranteeCheckStatus || 'none').color}`}>
                    {getStatusLabel('guaranteeCheckStatus', person.criticalDetails?.guaranteeCheckStatus || 'none').label}
                  </span>
                )}
              </div>

              {/* Amani Checks List */}
              {appState.checks.filter(c => c.personId === person.id && c.isAmani && c.type === 'received' && c.currentState !== 'cleared').length > 0 && (
                <div className="mt-4 pt-4 border-t border-zinc-100">
                  <span className="text-[10px] font-bold text-zinc-400 block mb-2">لیست چک‌های امانی نزد فروشگاه:</span>
                  <div className="space-y-2">
                    {appState.checks
                      .filter(c => c.personId === person.id && c.isAmani && c.type === 'received' && c.currentState !== 'cleared')
                      .map(check => (
                        <div key={check.id} className="flex items-center justify-between p-3 bg-rose-50/50 rounded-xl border border-rose-100/50">
                          <div className="text-right">
                            <div className="text-[10px] font-bold text-zinc-800">بانک {check.bankName} - سریال {check.checkNumber}</div>
                            <div className="text-[9px] text-zinc-500 font-mono">مبلغ: {check.amount.toLocaleString()} ریال</div>
                          </div>
                          <div className="text-left">
                            <span className="text-[9px] font-mono text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded">سررسید: {check.dueDate}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Manual Notes Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-zinc-400" />
                <span className="font-sans text-xs font-bold text-zinc-500">یادداشت‌های مدیریتی (توضیحات ضروری)</span>
              </div>
              {!isEditingNotes && (
                <button onClick={() => setIsEditingNotes(true)} className="text-[10px] font-bold text-amber-600 hover:text-amber-700">ویرایش</button>
              )}
            </div>
            {isEditingNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl p-4 text-xs font-sans min-h-[100px] focus:outline-none focus:border-amber-500"
                  placeholder="توضیحات مربوط به خوش‌حسابی، محدودیت‌های فروش و ..."
                />
                <div className="flex gap-2">
                  <button onClick={handleSaveNotes} className="flex-1 py-2.5 bg-zinc-900 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2">
                    <Save size={14} /> ذخیره یادداشت
                  </button>
                  <button onClick={() => setIsEditingNotes(false)} className="px-4 py-2.5 bg-zinc-100 text-zinc-500 rounded-xl text-xs font-bold">انصراف</button>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50/30 border border-dashed border-amber-200 rounded-2xl p-4">
                {person.criticalDetails?.manualNotes ? (
                  <p className="text-xs font-sans text-zinc-700 leading-relaxed whitespace-pre-wrap">{person.criticalDetails.manualNotes}</p>
                ) : (
                  <p className="text-xs font-sans text-zinc-400 italic">هیچ یادداشتی ثبت نشده است.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action Lock Notice */}
        <div className="p-5 bg-zinc-900 text-zinc-400 flex items-center gap-3">
          <AlertCircle size={20} className="text-rose-500 shrink-0" />
          <p className="text-[10px] font-medium leading-normal">
            در صورتی که بدهی کل بیش از سقف اعتبار باشد یا اقلام امانی تعیین تکلیف نشده باشند، سیستم از صدور فاکتور جدید یا تسویه نهایی ممانعت خواهد کرد.
          </p>
        </div>
      </div>
    </div>
  );
};

export default CriticalStatusPanel;
