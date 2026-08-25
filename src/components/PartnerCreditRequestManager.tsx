import React, { useState, useMemo } from 'react';
import { 
  FileText, Plus, Search, AlertCircle, CheckCircle2, XCircle, 
  Clock, ShieldAlert, UserPlus, ArrowRight, FileCheck, CreditCard, Wallet, Banknote,
  ShoppingCart, Users, X
} from 'lucide-react';
import { 
  AppState, BusinessPartner, PartnerCreditRequest, 
  PartnerCreditRequestStatus, Person, PartnerRole, 
  PartnerCheckSubmission, PartnerOrder, PartnerOrderStatus,
  PartnerSettlement
} from '../types';
import { 
  checkCustomerCreditEligibility, calculatePartnerRemainingLimit, 
  calculatePartnerCreditDetails, finalizePartnerCreditRequest,
  calculatePartnerFinancialStatement, calculatePartnerRiskProfile,
  isCheckDuplicate, reversePartnerCreditRequest, executePartnerSettlement,
  getPartnerStatement, resolvePartnerCreditRules
} from '../utils/partnerProcess';
import { toEnglishDigits } from '../utils/accounting';

interface PartnerCreditRequestManagerProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  currentUserId: string;
}

export function PartnerCreditRequestManager({ state, setState, currentUserId }: PartnerCreditRequestManagerProps) {
  const [view, setView] = useState<'list' | 'create' | 'details' | 'center_review' | 'center_orders' | 'center_partners'>('list');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [viewStatementPartnerId, setViewStatementPartnerId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Settlement state
  const [settlementPartnerId, setSettlementPartnerId] = useState<string | null>(null);
  const [settlementAmount, setSettlementAmount] = useState(0);
  const [settlementMethod, setSettlementMethod] = useState('واریز به حساب');
  const [sourceSubsidiaryId, setSourceSubsidiaryId] = useState('');
  
  // شبیه‌سازی نقش کاربر (در فازهای بعدی از سیستم Auth واقعی می‌آید)
  const isCenterAdmin = currentUserId === 'admin';

  const currentPartner = useMemo(() => {
    return (state.businessPartners || []).find(p => (p.users || []).includes(currentUserId));
  }, [state.businessPartners, currentUserId]);

  const partnerRequests = useMemo(() => {
    let list = [];
    if (isCenterAdmin && view === 'center_review') {
      list = (state.partnerCreditRequests || []).filter(r => 
        [PartnerCreditRequestStatus.SUBMITTED_BY_PARTNER, PartnerCreditRequestStatus.UNDER_REVIEW].includes(r.status)
      );
    } else if (isCenterAdmin) {
      list = state.partnerCreditRequests || [];
    } else if (!currentPartner) {
      list = [];
    } else {
      list = (state.partnerCreditRequests || []).filter(r => r.businessPartnerId === currentPartner.id);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(r => {
        const customer = state.persons.find(p => p.id === r.customerPersonId);
        const nameMatch = customer?.name?.toLowerCase().includes(q);
        const nationalIdMatch = customer?.nationalId?.toLowerCase().includes(q);
        const idMatch = r.id?.toLowerCase().includes(q);
        return nameMatch || nationalIdMatch || idMatch;
      });
    }
    return list;
  }, [state.partnerCreditRequests, currentPartner, isCenterAdmin, view, searchQuery, state.persons]);

  const partnerOrders = useMemo(() => {
    if (isCenterAdmin && view === 'center_orders') {
      return (state.partnerOrders || []).filter(o => o.status === PartnerOrderStatus.SUBMITTED);
    }
    if (isCenterAdmin) return state.partnerOrders || [];
    if (!currentPartner) return [];
    return (state.partnerOrders || []).filter(o => o.businessPartnerId === currentPartner.id);
  }, [state.partnerOrders, currentPartner, isCenterAdmin, view]);

  const selectedRequest = useMemo(() => {
    return (state.partnerCreditRequests || []).find(r => r.id === selectedRequestId);
  }, [state.partnerCreditRequests, selectedRequestId]);

  // ثبت چک توسط نماینده
  const [newCheck, setNewCheck] = useState({
    checkNumber: '',
    bankName: '',
    dueDate: '',
    amount: 0,
    drawerName: '',
    drawerNationalId: '',
  });

  const handleAddCheck = () => {
    if (!selectedRequestId || !newCheck.checkNumber) return;

    // بررسی تکراری بودن چک قبل از ثبت
    const duplicateStatus = isCheckDuplicate({
      checkNumber: newCheck.checkNumber,
      bankName: newCheck.bankName,
      amount: newCheck.amount || (selectedRequest?.calculationResults?.installmentAmount || 0),
      dueDate: newCheck.dueDate
    }, state, selectedRequestId);

    if (duplicateStatus.isDuplicate) {
      alert(`خطا: ${duplicateStatus.reason}`);
      return;
    }

    const checkEntry: PartnerCheckSubmission = {
      id: `CS_${Date.now()}`,
      ...newCheck,
      status: 'pending',
      amount: newCheck.amount || (selectedRequest?.calculationResults?.installmentAmount || 0),
    };

    setState(prev => ({
      ...prev,
      partnerCreditRequests: (prev.partnerCreditRequests || []).map(r => 
        r.id === selectedRequestId 
          ? { ...r, submittedChecks: [...(r.submittedChecks || []), checkEntry] }
          : r
      )
    }));

    setNewCheck({ checkNumber: '', bankName: '', dueDate: '', amount: 0, drawerName: '', drawerNationalId: '' });
  };

  const handleFinalApproval = (requestId: string) => {
    if (!isCenterAdmin) return;

    const updatedRequests = (state.partnerCreditRequests || []).map(r => 
      r.id === requestId 
        ? { 
            ...r, 
            status: PartnerCreditRequestStatus.FINAL_APPROVED,
            approvedAt: new Date().toISOString(),
            finalApprovedBy: currentUserId 
          }
        : r
    );

    // اعمال تغییرات مالی واقعی
    try {
      const financialImpact = finalizePartnerCreditRequest(requestId, { ...state, partnerCreditRequests: updatedRequests });
      
      setState(prev => ({
        ...prev,
        ...financialImpact,
        partnerCreditRequests: updatedRequests
      }));

      alert('پرونده با موفقیت تایید نهایی شد و اسناد مالی صادر گردید.');
      setView('list');
    } catch (error: any) {
      alert(`خطا در نهایی‌سازی پرونده: ${error.message}`);
    }
  };

  const handleCancelApprovedRequest = (requestId: string) => {
    if (!isCenterAdmin) {
      alert('شما مجاز به ابطال پرونده نیستید.');
      return;
    }

    if (!window.confirm('آیا از ابطال این پرونده اطمینان دارید؟ با تایید شما تمامی اسناد مالی معکوس و اقساط لغو خواهند شد.')) {
      return;
    }

    try {
      const financialImpact = reversePartnerCreditRequest(requestId, state, currentUserId);
      
      setState(prev => ({
        ...prev,
        ...financialImpact
      }));

      alert('پرونده با موفقیت ابطال و اسناد مالی معکوس صادر گردید.');
      setView('list');
    } catch (error: any) {
      alert(`خطا در ابطال پرونده: ${error.message}`);
    }
  };

  const handleExecuteSettlement = () => {
    if (!settlementPartnerId || settlementAmount <= 0 || !sourceSubsidiaryId) {
      alert('لطفاً تمامی موارد را تکمیل کنید.');
      return;
    }

    try {
      const financialImpact = executePartnerSettlement(
        settlementPartnerId,
        settlementAmount,
        settlementMethod,
        sourceSubsidiaryId,
        state,
        currentUserId
      );

      setState(prev => ({
        ...prev,
        ...financialImpact
      }));

      alert('تسویه حساب با موفقیت ثبت و سند مالی صادر گردید.');
      setSettlementPartnerId(null);
      setSettlementAmount(0);
      setSourceSubsidiaryId('');
    } catch (error: any) {
      alert(`خطا در ثبت تسویه: ${error.message}`);
    }
  };

  const remainingLimit = useMemo(() => {
    if (!currentPartner) return 0;
    return calculatePartnerRemainingLimit(currentPartner.id, state);
  }, [currentPartner, state]);

  // فرم ایجاد پرونده
  const [newRequest, setNewRequest] = useState({
    nationalId: '',
    amount: 0,
    planId: '',
    terms: 0,
    period: 30,
    branchId: '',
  });

  const [validationResult, setValidationResult] = useState<{ isEligible: boolean; reasons: string[] } | null>(null);

  const activePlans = useMemo(() => {
    return (state.partnerSalesPlans || []).filter(p => p.isActive);
  }, [state.partnerSalesPlans]);

  const selectedPlan = useMemo(() => {
    return activePlans.find(p => p.id === newRequest.planId);
  }, [activePlans, newRequest.planId]);

  const calculationResults = useMemo(() => {
    if (!selectedPlan || newRequest.amount <= 0 || newRequest.terms <= 0) return null;
    return calculatePartnerCreditDetails(
      newRequest.amount,
      selectedPlan,
      newRequest.terms,
      newRequest.period
    );
  }, [newRequest, selectedPlan]);

  const handleCheckEligibility = () => {
    if (newRequest.nationalId.length !== 10) return;
    const result = checkCustomerCreditEligibility(newRequest.nationalId, state);
    setValidationResult(result);
  };

  const handleCreateRequest = () => {
    if (!currentPartner || !validationResult?.isEligible || !selectedPlan || !calculationResults) return;

    // ۱. بررسی سقف مجاز هر پرونده
    const rules = resolvePartnerCreditRules(currentPartner.personId || currentPartner.id, state.businessPartners);
    if (rules.maxPerDossierLimit && newRequest.amount > rules.maxPerDossierLimit) {
      alert(`خطا: مبلغ درخواست (${newRequest.amount.toLocaleString()} ریال) از سقف مجاز هر پرونده (${rules.maxPerDossierLimit.toLocaleString()} ریال) بیشتر است.`);
      return;
    }

    // ۲. بررسی ظرفیت اعتباری باقی‌مانده نماینده
    if (newRequest.amount > remainingLimit) {
      alert(`خطا: مبلغ درخواست (${newRequest.amount.toLocaleString()} ریال) از ظرفیت اعتباری باقی‌مانده نماینده (${remainingLimit.toLocaleString()} ریال) بیشتر است.`);
      return;
    }

    // پیدا کردن یا ایجاد شخص
    let person = state.persons.find(p => p.nationalId === newRequest.nationalId);
    if (!person) {
      alert('ابتدا شخص باید در سیستم تعریف شود.');
      return;
    }

    const request: PartnerCreditRequest = {
      id: `PCR_${Date.now()}`,
      businessPartnerId: currentPartner.id,
      branchId: newRequest.branchId,
      customerPersonId: person.id,
      status: PartnerCreditRequestStatus.SUBMITTED_BY_PARTNER,
      requestedAmount: newRequest.amount,
      salePlanId: newRequest.planId,
      termCount: newRequest.terms,
      paymentPeriod: newRequest.period,
      documents: [],
      approvalHistory: [],
      calculationResults: {
        ...calculationResults,
        calculatedAt: new Date().toISOString(),
        calculatedBy: currentUserId,
      },
      createdAt: new Date().toISOString(),
      createdBy: currentUserId,
    };

    setState(prev => ({
      ...prev,
      partnerCreditRequests: [...(prev.partnerCreditRequests || []), request]
    }));

    setView('list');
    setNewRequest({ nationalId: '', amount: 0, planId: '', terms: 0, period: 30, branchId: '' });
    setValidationResult(null);
  };

  if (!currentPartner && !isCenterAdmin) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl shadow-sm border border-zinc-100">
        <ShieldAlert className="mx-auto text-zinc-300 mb-4" size={48} />
        <h2 className="text-xl font-bold text-zinc-800 mb-2">دسترسی محدود</h2>
        <p className="text-zinc-500">شما به عنوان "نماینده فروش اعتباری" در سیستم تعریف نشده‌اید.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* هدر پنل نماینده */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-emerald-100 shadow-sm overflow-hidden relative">
        <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-full -mr-12 -mt-12 opacity-50" />
        <div className="relative">
          <h1 className="text-2xl font-black text-emerald-900 mb-1">پنل مدیریت اعتبار نمایندگان</h1>
          <p className="text-emerald-600 text-sm font-medium">نماینده: {currentPartner ? state.persons.find(p => p.id === currentPartner.personId)?.name : 'مدیریت مرکزی'}</p>
        </div>
        
        <div className="flex items-center gap-6 relative">
          {isCenterAdmin && (
            <>
              <button 
                onClick={() => setView(view === 'center_review' ? 'list' : 'center_review')}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-all border ${
                  view === 'center_review' 
                    ? 'bg-zinc-900 text-white border-zinc-900' 
                    : 'bg-white text-zinc-900 border-zinc-200 hover:border-zinc-900'
                }`}
              >
                <ShieldAlert size={20} />
                {view === 'center_review' ? 'پنل نماینده' : 'بررسی مرکز'}
              </button>
              <button 
                onClick={() => setView(view === 'center_orders' ? 'list' : 'center_orders')}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-all border ${
                  view === 'center_orders' 
                    ? 'bg-zinc-900 text-white border-zinc-900' 
                    : 'bg-white text-zinc-900 border-zinc-200 hover:border-zinc-900'
                }`}
              >
                <ShoppingCart size={20} />
                {view === 'center_orders' ? 'پنل نماینده' : 'بررسی سفارشات'}
              </button>
              <button 
                onClick={() => setView(view === 'center_partners' ? 'list' : 'center_partners')}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-all border ${
                  view === 'center_partners' 
                    ? 'bg-zinc-900 text-white border-zinc-900' 
                    : 'bg-white text-zinc-900 border-zinc-200 hover:border-zinc-900'
                }`}
              >
                <Users size={20} />
                {view === 'center_partners' ? 'پنل نماینده' : 'مدیریت نمایندگان'}
              </button>
            </>
          )}
          <div className="text-left md:text-right">
            <p className="text-zinc-400 text-xs mb-1">ظرفیت اعتبار باقی‌مانده</p>
            <p className="text-xl font-black text-emerald-600">
              {remainingLimit.toLocaleString()} <span className="text-xs font-normal">ریال</span>
            </p>
          </div>
          <button 
            onClick={() => setView('create')}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-xl font-bold transition-all shadow-lg shadow-emerald-200"
          >
            <Plus size={20} />
            پرونده جدید
          </button>
        </div>
      </div>

      {view === 'list' ? (
        <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-zinc-50 bg-zinc-50/30 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full max-w-lg">
              <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input 
                type="text"
                placeholder="جستجو بر اساس نام مشتری، کد ملی یا شماره پرونده..."
                className="w-full pr-11 pl-4 py-3 bg-white border border-zinc-200 rounded-2xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none shadow-xs"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="text-xs text-zinc-500 font-medium">
              تعداد پرونده‌ها: <span className="font-bold text-zinc-900">{partnerRequests.length}</span>
            </div>
          </div>

          <div className="divide-y divide-zinc-100">
            {partnerRequests.length === 0 ? (
              <div className="px-6 py-16 text-center text-zinc-400">
                <FileText size={48} className="mx-auto mb-4 opacity-20" />
                پرونده‌ای یافت نشد.
              </div>
            ) : (
              partnerRequests.map(req => {
                const customer = state.persons.find(p => p.id === req.customerPersonId);
                return (
                  <div 
                    key={req.id} 
                    className="p-5 sm:p-6 hover:bg-zinc-50/80 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    onClick={() => {
                      setSelectedRequestId(req.id);
                      setView('details');
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold shrink-0 border border-emerald-100 shadow-xs">
                        <FileText size={22} />
                      </div>
                      <div>
                        <div className="font-bold text-zinc-900 text-base">{customer?.name || 'مشتری ناشناس'}</div>
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-zinc-500 font-mono">
                          <span>شماره پرونده: <strong className="text-zinc-800">{req.id}</strong></span>
                          <span>•</span>
                          <span>کد ملی: <strong className="text-zinc-800">{customer?.nationalId || 'ثبت نشده'}</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                      <span className={`px-4 py-1.5 rounded-full text-xs font-bold shadow-xs ${
                        req.status === PartnerCreditRequestStatus.SUBMITTED_BY_PARTNER ? 'bg-blue-50 text-blue-700 border border-blue-100' :
                        req.status === PartnerCreditRequestStatus.APPROVED ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                        req.status === PartnerCreditRequestStatus.FINAL_APPROVED ? 'bg-zinc-900 text-white' :
                        req.status === PartnerCreditRequestStatus.REJECTED ? 'bg-red-50 text-red-700 border border-red-100' :
                        'bg-zinc-100 text-zinc-700'
                      }`}>
                        {req.status}
                      </span>
                      <div className="w-10 h-10 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-colors">
                        <ArrowRight size={18} />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : view === 'create' ? (
        <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-zinc-100 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4">
          <div className="p-8 border-b border-zinc-50 flex items-center justify-between">
            <h2 className="text-xl font-black text-zinc-900">تشکیل پرونده اعتبار جدید</h2>
            <button onClick={() => setView('list')} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
              <XCircle size={24} className="text-zinc-400" />
            </button>
          </div>
          
          <div className="p-8 space-y-6">
            {/* استعلام کد ملی */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-zinc-700">کد ملی مشتری</label>
              <div className="flex gap-2">
                <input 
                  type="tel"

                  pattern="[0-9]*"
                  maxLength={10}
                  className="flex-1 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
                  placeholder="مثال: ۰۰۱۲۳۴۵۶۷۸"
                  value={newRequest.nationalId}
                  onChange={e => {
                    const val = toEnglishDigits(e.target.value).replace(/\D/g, '');
                    setNewRequest({...newRequest, nationalId: val});
                    setValidationResult(null);
                  }}
                />
                <button 
                  onClick={handleCheckEligibility}
                  disabled={newRequest.nationalId.length !== 10}
                  className="px-6 py-3 bg-zinc-900 text-white rounded-xl font-bold hover:bg-zinc-800 disabled:opacity-50 transition-all"
                >
                  استعلام اعتبار
                </button>
              </div>
            </div>

            {validationResult && (
              <div className={`p-4 rounded-2xl border ${validationResult.isEligible ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                <div className="flex items-start gap-3">
                  {validationResult.isEligible ? (
                    <CheckCircle2 className="text-emerald-600 mt-1" size={20} />
                  ) : (
                    <AlertCircle className="text-red-600 mt-1" size={20} />
                  )}
                  <div>
                    <p className={`font-bold ${validationResult.isEligible ? 'text-emerald-900' : 'text-red-900'}`}>
                      {validationResult.isEligible ? 'شخص واجد شرایط می‌باشد' : 'شخص واجد شرایط نمی‌باشد'}
                    </p>
                    {validationResult.reasons.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {validationResult.reasons.map((r, i) => (
                          <li key={i} className="text-xs text-red-700 list-disc list-inside">{r}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {validationResult?.isEligible && (
              <div className="space-y-6 pt-4 animate-in fade-in zoom-in-95 duration-300">
                {/* انتخاب شعبه */}
                {currentPartner?.branches && currentPartner.branches.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-zinc-700">انتخاب شعبه ثبت کننده</label>
                    <select 
                      className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={newRequest.branchId}
                      onChange={e => setNewRequest({...newRequest, branchId: e.target.value})}
                    >
                      <option value="">انتخاب کنید...</option>
                      {currentPartner.branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* انتخاب طرح فروش */}
                <div className="space-y-3">
                  <label className="text-sm font-bold text-zinc-700 block">انتخاب طرح فروش</label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activePlans.map(plan => (
                      <button
                        key={plan.id}
                        onClick={() => {
                          setNewRequest({
                            ...newRequest, 
                            planId: plan.id, 
                            terms: plan.allowedTerms[0],
                            period: plan.paymentPeriods[0]
                          });
                        }}
                        className={`p-4 rounded-2xl border text-right transition-all ${
                          newRequest.planId === plan.id 
                            ? 'bg-emerald-50 border-emerald-500 shadow-md shadow-emerald-100' 
                            : 'bg-white border-zinc-100 hover:border-emerald-200'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`font-bold ${newRequest.planId === plan.id ? 'text-emerald-900' : 'text-zinc-900'}`}>{plan.name}</span>
                          {newRequest.planId === plan.id && <CheckCircle2 size={16} className="text-emerald-600" />}
                        </div>
                        <p className="text-[10px] text-zinc-500 line-clamp-1">{plan.description}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="bg-zinc-100 text-zinc-600 text-[10px] px-2 py-0.5 rounded-full">سود: {plan.interestRate}٪</span>
                          <span className="bg-zinc-100 text-zinc-600 text-[10px] px-2 py-0.5 rounded-full">کارمزد: {plan.commissionRate}٪</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {selectedPlan && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-zinc-50/50 p-6 rounded-3xl border border-zinc-100">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-zinc-700">مبلغ خرید (ریال)</label>
                      <input 
                        type="text" inputMode="numeric" pattern="[0-9]*"

                        className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                        value={newRequest.amount}
                        onChange={e => setNewRequest({...newRequest, amount: parseInt(e.target.value) || 0})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-zinc-700">مدت بازپرداخت</label>
                      <select 
                        className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                        value={newRequest.terms}
                        onChange={e => setNewRequest({...newRequest, terms: parseInt(e.target.value)})}
                      >
                        {selectedPlan.allowedTerms.map(t => (
                          <option key={t} value={t}>{t} ماهه</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-zinc-700">دوره پرداخت</label>
                      <select 
                        className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                        value={newRequest.period}
                        onChange={e => setNewRequest({...newRequest, period: parseInt(e.target.value)})}
                      >
                        {selectedPlan.paymentPeriods.map(p => (
                          <option key={p} value={p}>{p} روزه ({Math.round(p/30)} ماهه)</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {calculationResults && (
                  <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm">
                        <p className="text-[10px] text-zinc-400 mb-1">مبلغ کل پرداختی</p>
                        <p className="font-bold text-zinc-900">{calculationResults.totalPayment.toLocaleString()}</p>
                      </div>
                      <div className="bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm">
                        <p className="text-[10px] text-zinc-400 mb-1">سود کل مشتری</p>
                        <p className="font-bold text-amber-600">{calculationResults.totalInterest.toLocaleString()}</p>
                      </div>
                      <div className="bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm">
                        <p className="text-[10px] text-zinc-400 mb-1">سهم کارمزد نماینده</p>
                        <p className="font-bold text-emerald-600">{calculationResults.partnerCommission.toLocaleString()}</p>
                      </div>
                      <div className="bg-white p-4 rounded-2xl border border-zinc-100 shadow-sm">
                        <p className="text-[10px] text-zinc-400 mb-1">مبلغ هر قسط (چک)</p>
                        <p className="font-bold text-blue-600">{calculationResults.installmentAmount.toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="bg-zinc-900 text-white p-6 rounded-3xl overflow-hidden relative">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16" />
                      <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                        <Clock size={16} className="text-emerald-400" />
                        برنامه پیشنهادی پرداخت ({calculationResults.suggestedInstallments.length} قسط)
                      </h3>
                      <div className="max-h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                        {calculationResults.suggestedInstallments.map((inst, idx) => (
                          <div key={idx} className="flex items-center justify-between py-2 border-b border-white/10 last:border-0 text-xs">
                            <span className="text-white/60">قسط {idx + 1}</span>
                            <span className="font-mono">{new Date(inst.dueDate).toLocaleDateString('fa-IR')}</span>
                            <span className="font-bold text-emerald-400">{inst.amount.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <button 
                  onClick={handleCreateRequest}
                  disabled={!calculationResults || !selectedPlan || (currentPartner?.branches && currentPartner.branches.length > 0 && !newRequest.branchId)}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-lg hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:grayscale"
                >
                  ثبت پرونده و ارسال جهت بررسی
                  <ArrowRight size={20} />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : view === 'details' ? (
        <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in zoom-in-95 duration-300">
          <div className="flex items-center justify-between">
            <button 
              onClick={() => { setView('list'); setSelectedRequestId(null); }}
              className="text-zinc-500 hover:text-zinc-800 flex items-center gap-2 text-sm font-bold"
            >
              <ArrowRight size={18} />
              بازگشت به لیست
            </button>
            <div className="flex items-center gap-3">
              <span className={`px-4 py-2 rounded-xl text-xs font-black shadow-sm ${
                selectedRequest?.status === PartnerCreditRequestStatus.FINAL_APPROVED ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-900 border border-zinc-100'
              }`}>
                وضعیت: {selectedRequest?.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              {/* اطلاعات مشتری و طرح */}
              <div className="bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm">
                <h3 className="font-bold text-zinc-900 mb-6 flex items-center gap-2">
                  <FileText size={18} className="text-blue-500" />
                  جزئیات پرونده
                </h3>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-[10px] text-zinc-400 mb-1">مشتری</p>
                    <p className="font-bold text-zinc-800">{state.persons.find(p => p.id === selectedRequest?.customerPersonId)?.name}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-400 mb-1">مبلغ اعتبار</p>
                    <p className="font-bold text-emerald-600">{selectedRequest?.requestedAmount.toLocaleString()} ریال</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-400 mb-1">طرح انتخابی</p>
                    <p className="font-bold text-zinc-800">{selectedRequest?.salePlanId}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-400 mb-1">شعبه</p>
                    <p className="font-bold text-zinc-800">
                      {currentPartner?.branches?.find(b => b.id === selectedRequest?.branchId)?.name || 'نامشخص'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-400 mb-1">مدت بازپرداخت</p>
                    <p className="font-bold text-zinc-800">{selectedRequest?.termCount} ماهه</p>
                  </div>
                </div>
              </div>

              {/* ثبت چک‌ها (فقط توسط نماینده و اگر پرونده نهایی نشده باشد) */}
              {!isCenterAdmin && selectedRequest?.status !== PartnerCreditRequestStatus.FINAL_APPROVED && (
                <div className="bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm">
                  <h3 className="font-bold text-zinc-900 mb-6 flex items-center gap-2">
                    <FileCheck size={18} className="text-emerald-500" />
                    ثبت چک‌های دریافتی مشتری
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                    <input 
                      type="text"

                      placeholder="شماره چک"
                      className="px-4 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-xs"
                      value={newCheck.checkNumber}
                      onChange={e => setNewCheck({...newCheck, checkNumber: e.target.value})}
                    />
                    <input 
                      placeholder="نام بانک"
                      className="px-4 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-xs"
                      value={newCheck.bankName}
                      onChange={e => setNewCheck({...newCheck, bankName: e.target.value})}
                    />
                    <input 
                      type="text"
                      dir="ltr"
                      placeholder="۱۴۰۵/۰۱/۰۱ (سررسید)"
                      className="px-4 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-xs text-left font-mono"
                      value={newCheck.dueDate}
                      onChange={e => setNewCheck({...newCheck, dueDate: e.target.value})}
                    />
                    <input 
                      placeholder="نام صاحب چک"
                      className="px-4 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-xs"
                      value={newCheck.drawerName}
                      onChange={e => setNewCheck({...newCheck, drawerName: e.target.value})}
                    />
                    <input 
                      type="text"

                      placeholder="کد ملی صاحب چک"
                      className="px-4 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-xs font-mono"
                      value={newCheck.drawerNationalId}
                      onChange={e => setNewCheck({...newCheck, drawerNationalId: e.target.value})}
                    />
                    <button 
                      onClick={handleAddCheck}
                      className="bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors"
                    >
                      افزودن چک
                    </button>
                  </div>

                  <div className="space-y-2">
                    {selectedRequest?.submittedChecks?.map((c, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-100 text-xs">
                        <span className="font-bold text-zinc-700">چک {c.checkNumber} - {c.bankName}</span>
                        <span className="font-mono text-zinc-500">{new Date(c.dueDate).toLocaleDateString('fa-IR')}</span>
                        <span className="font-black text-emerald-600">{c.amount.toLocaleString()} ریال</span>
                      </div>
                    ))}
                    {(!selectedRequest?.submittedChecks || selectedRequest.submittedChecks.length === 0) && (
                      <p className="text-center py-4 text-zinc-400 text-[10px]">هیچ چکی ثبت نشده است.</p>
                    )}
                  </div>
                </div>
              )}

              {/* لیست چک‌ها برای ادمین */}
              {isCenterAdmin && (
                <div className="bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm">
                  <h3 className="font-bold text-zinc-900 mb-6">لیست چک‌های ثبت شده</h3>
                  <div className="space-y-2">
                    {selectedRequest?.submittedChecks?.map((c, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-100 text-xs">
                        <div className="flex items-center gap-3">
                          <CheckCircle2 size={16} className="text-emerald-500" />
                          <span className="font-bold text-zinc-700">{c.checkNumber} - {c.bankName}</span>
                        </div>
                        <span className="font-mono text-zinc-500">{new Date(c.dueDate).toLocaleDateString('fa-IR')}</span>
                        <span className="font-black text-zinc-900">{c.amount.toLocaleString()} ریال</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              {/* نتایج محاسبات */}
              <div className="bg-zinc-900 text-white p-6 rounded-3xl shadow-xl shadow-zinc-200">
                <h3 className="font-bold text-sm mb-6 flex items-center gap-2">
                  <Clock size={18} className="text-emerald-400" />
                  برنامه بازپرداخت
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-400">مبلغ کل بازپرداخت</span>
                    <span className="font-bold text-emerald-400">{selectedRequest?.calculationResults?.totalPayment.toLocaleString()} ریال</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-400">تعداد اقساط</span>
                    <span className="font-bold">{selectedRequest?.termCount} قسط</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-400">مبلغ هر قسط</span>
                    <span className="font-bold">{selectedRequest?.calculationResults?.installmentAmount.toLocaleString()} ریال</span>
                  </div>
                  <div className="pt-4 border-t border-white/10 mt-4">
                    <div className="max-h-40 overflow-y-auto space-y-2 custom-scrollbar">
                      {selectedRequest?.calculationResults?.suggestedInstallments.map((inst, idx) => (
                        <div key={idx} className="flex justify-between text-[10px] text-white/50">
                          <span>قسط {idx+1}</span>
                          <span>{new Date(inst.dueDate).toLocaleDateString('fa-IR')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* دکمه‌های تایید مرکز */}
              {isCenterAdmin && selectedRequest?.status !== PartnerCreditRequestStatus.FINAL_APPROVED && (
                <div className="bg-white p-6 rounded-3xl border border-zinc-100 shadow-sm space-y-3">
                  <p className="text-xs font-bold text-zinc-700 mb-3">عملیات بررسی مرکز</p>
                  <button 
                    onClick={() => handleFinalApproval(selectedRequest!.id)}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
                  >
                    تایید نهایی و صدور اسناد
                    <CheckCircle2 size={20} />
                  </button>
                  <button 
                    className="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 transition-all"
                    onClick={() => {
                      setState(prev => ({
                        ...prev,
                        partnerCreditRequests: (prev.partnerCreditRequests || []).map(r => 
                          r.id === selectedRequest!.id ? { ...r, status: PartnerCreditRequestStatus.REJECTED } : r
                        )
                      }));
                      setView('list');
                    }}
                  >
                    رد درخواست
                  </button>
                </div>
              )}

              {selectedRequest?.status === PartnerCreditRequestStatus.FINAL_APPROVED && (
                <div className="space-y-4">
                  <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 text-center">
                    <CheckCircle2 className="mx-auto text-emerald-500 mb-3" size={32} />
                    <p className="text-sm font-black text-emerald-900">پرونده تایید و اسناد مالی صادر شده است</p>
                    <p className="text-[10px] text-emerald-600 mt-2">توسط: {selectedRequest.finalApprovedBy} در {new Date(selectedRequest.approvedAt!).toLocaleDateString('fa-IR')}</p>
                  </div>
                  
                  {isCenterAdmin && (
                    <button 
                      onClick={() => handleCancelApprovedRequest(selectedRequest.id)}
                      className="w-full py-4 bg-zinc-100 text-zinc-600 rounded-2xl font-bold hover:bg-rose-50 hover:text-rose-600 transition-all flex items-center justify-center gap-2 border border-zinc-200 border-dashed"
                    >
                      <XCircle size={20} />
                      درخواست ابطال پرونده (امنیت ادمین)
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : view === 'center_orders' ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white rounded-3xl border border-zinc-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-zinc-50">
              <h3 className="font-black text-zinc-900">سفارشات منتظر بررسی</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-zinc-50/50 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
                    <th className="px-6 py-4">نماینده / شعبه</th>
                    <th className="px-6 py-4">تاریخ</th>
                    <th className="px-6 py-4">مبلغ کل</th>
                    <th className="px-6 py-4">تعداد اقلام</th>
                    <th className="px-6 py-4">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {partnerOrders.map(order => {
                    const partner = state.businessPartners.find(p => p.id === order.businessPartnerId);
                    const partnerPerson = state.persons.find(p => p.id === partner?.personId);
                    const branch = partner?.branches.find(b => b.id === order.branchId);
                    return (
                      <tr key={order.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-zinc-800 text-xs">{partnerPerson?.name}</div>
                          <div className="text-[10px] text-zinc-400">{branch?.name || 'مرکزی'}</div>
                        </td>
                        <td className="px-6 py-4 text-xs text-zinc-500">{new Date(order.orderDate).toLocaleDateString('fa-IR')}</td>
                        <td className="px-6 py-4 font-mono font-bold text-zinc-900 text-xs">{order.totalAmount.toLocaleString()}</td>
                        <td className="px-6 py-4 text-xs text-zinc-600">{order.items.length} قلم</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => {
                                setState(prev => ({
                                  ...prev,
                                  partnerOrders: (prev.partnerOrders || []).map(o => 
                                    o.id === order.id ? { ...o, status: PartnerOrderStatus.APPROVED } : o
                                  )
                                }));
                              }}
                              className="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-600 hover:text-white transition-all"
                              title="تایید سفارش"
                            >
                              <CheckCircle2 size={16} />
                            </button>
                            <button 
                              onClick={() => {
                                setState(prev => ({
                                  ...prev,
                                  partnerOrders: (prev.partnerOrders || []).map(o => 
                                    o.id === order.id ? { ...o, status: PartnerOrderStatus.REJECTED } : o
                                  )
                                }));
                              }}
                              className="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-600 hover:text-white transition-all"
                              title="رد سفارش"
                            >
                              <AlertCircle size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {partnerOrders.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-zinc-400 text-xs italic">
                        هیچ سفارشی جهت بررسی وجود ندارد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : view === 'center_partners' ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {(state.businessPartners || []).map(partner => {
              const person = state.persons.find(p => p.id === partner.personId);
              const fin = calculatePartnerFinancialStatement(partner.id, state);
              const risk = calculatePartnerRiskProfile(partner.id, state);
              
              return (
                <div key={partner.id} className="bg-white rounded-3xl border border-zinc-100 shadow-sm p-6 hover:shadow-md transition-all">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center text-zinc-500">
                      <Users size={24} />
                    </div>
                    <div>
                      <h4 className="font-black text-zinc-900">{person?.name}</h4>
                      <p className="text-[10px] text-zinc-400">کد نماینده: {partner.id}</p>
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">سقف اعتبار:</span>
                      <span className="font-bold text-zinc-700">{(resolvePartnerCreditRules(partner.personId || partner.id, state.businessPartners).maxCreditLimit || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">مانده حساب:</span>
                      <span className={`font-black ${fin?.balanceNature === 'بستانکار' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {fin?.currentBalance.toLocaleString()} {fin?.balanceNature}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">مشتریان فعال:</span>
                      <span className="font-bold text-zinc-700">{risk?.activeCustomerCount} نفر</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-zinc-50 p-3 rounded-xl">
                      <p className="text-[8px] text-zinc-400 font-bold mb-1">چک‌های برگشتی</p>
                      <p className="text-sm font-black text-rose-600">{risk?.bouncedChecksCount}</p>
                    </div>
                    <div className="bg-zinc-50 p-3 rounded-xl">
                      <p className="text-[8px] text-zinc-400 font-bold mb-1">نرخ پذیرش</p>
                      <p className="text-sm font-black text-emerald-600">{100 - (risk?.rejectionRate || 0)}%</p>
                    </div>
                  </div>

                  <button 
                    onClick={() => {
                      setViewStatementPartnerId(partner.id);
                    }}
                    className="w-full mt-6 py-3 bg-zinc-50 text-zinc-600 rounded-xl text-xs font-bold hover:bg-zinc-900 hover:text-white transition-all flex items-center justify-center gap-2"
                  >
                    مشاهده ریز تراکنش‌ها
                    <ArrowRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Modal for Partner Statement */}
          {viewStatementPartnerId && (
            <div className="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
              <div className="bg-white rounded-[40px] w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
                <div className="p-8 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
                  <div>
                    <h3 className="text-xl font-black text-zinc-900">صورت‌حساب جاری نماینده</h3>
                    <p className="text-xs text-zinc-400 mt-1">
                      {state.persons.find(p => p.id === state.businessPartners?.find(bp => bp.id === viewStatementPartnerId)?.personId)?.name}
                    </p>
                  </div>
                  <button 
                    onClick={() => setViewStatementPartnerId(null)}
                    className="w-10 h-10 bg-white border border-zinc-200 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-900 transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>
                
                <div className="p-8 overflow-y-auto flex-grow">
                  <div className="bg-white rounded-3xl border border-zinc-100 overflow-hidden">
                    <table className="w-full text-right border-collapse">
                      <thead>
                        <tr className="bg-zinc-50">
                          <th className="p-4 text-[10px] font-bold text-zinc-400 border-b border-zinc-100 uppercase">تاریخ</th>
                          <th className="p-4 text-[10px] font-bold text-zinc-400 border-b border-zinc-100 uppercase">شرح</th>
                          <th className="p-4 text-[10px] font-bold text-zinc-400 border-b border-zinc-100 uppercase text-rose-600">بدهکار (واریزی ما)</th>
                          <th className="p-4 text-[10px] font-bold text-zinc-400 border-b border-zinc-100 uppercase text-emerald-600">بستانکار (طلب نماینده)</th>
                          <th className="p-4 text-[10px] font-bold text-zinc-400 border-b border-zinc-100 uppercase">مانده نهایی</th>
                        </tr>
                      </thead>
                      <tbody>
                        {getPartnerStatement(viewStatementPartnerId, state).length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-12 text-center text-zinc-400 text-xs italic">
                              تراکنشی یافت نشد.
                            </td>
                          </tr>
                        ) : (
                          getPartnerStatement(viewStatementPartnerId, state).map((item, idx) => (
                            <tr key={idx} className="hover:bg-zinc-50/30 transition-colors border-b border-zinc-50 last:border-0">
                              <td className="p-4 text-xs text-zinc-500 font-mono">{item.date}</td>
                              <td className="p-4 text-xs text-zinc-900 font-medium">{item.description}</td>
                              <td className="p-4 text-xs text-rose-600 font-bold">{item.debit > 0 ? item.debit.toLocaleString() : '-'}</td>
                              <td className="p-4 text-xs text-emerald-600 font-bold">{item.credit > 0 ? item.credit.toLocaleString() : '-'}</td>
                              <td className="p-4 text-xs font-black text-zinc-900">
                                {Math.abs(item.balance).toLocaleString()} 
                                <span className="text-[9px] mr-1 font-normal text-zinc-400 uppercase">
                                  {item.balance > 0 ? 'بستانکار' : item.balance < 0 ? 'بدهکار' : ''}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-8 bg-zinc-900 p-6 rounded-3xl text-white flex justify-between items-center">
                    <div>
                      <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mb-1">خالص مانده حساب جاری</p>
                      <h4 className="text-2xl font-black">
                        {calculatePartnerFinancialStatement(viewStatementPartnerId, state)?.currentBalance.toLocaleString()}
                        <span className="text-xs font-normal text-zinc-400 mr-2">
                          {calculatePartnerFinancialStatement(viewStatementPartnerId, state)?.balanceNature}
                        </span>
                      </h4>
                    </div>
                    <div className="flex gap-2">
                      <button className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all border border-white/10">
                        خروجی PDF
                      </button>
                      <button 
                        onClick={() => {
                          setSettlementPartnerId(viewStatementPartnerId);
                          setViewStatementPartnerId(null);
                        }}
                        className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-500/20"
                      >
                        ثبت دستور پرداخت جدید
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Settlement Modal */}
          {settlementPartnerId && (
            <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-md flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-[40px] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                <div className="p-8 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
                  <h3 className="text-xl font-black text-zinc-900">ثبت تسویه حساب جدید</h3>
                  <button onClick={() => setSettlementPartnerId(null)} className="text-zinc-400 hover:text-zinc-900 transition-all">
                    <X size={24} />
                  </button>
                </div>
                
                <div className="p-8 space-y-6">
                  <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                    <div className="flex justify-between items-center text-[10px] text-emerald-600 font-bold mb-1 uppercase tracking-wider">
                      <span>مانده قابل تسویه</span>
                      <span>Credit Balance</span>
                    </div>
                    <div className="text-2xl font-black text-emerald-900">
                      {calculatePartnerFinancialStatement(settlementPartnerId, state)?.currentBalance.toLocaleString() || '0'}
                      <span className="text-xs font-normal mr-2">ریال</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">مبلغ پرداختی</label>
                    <div className="relative">
                      <input 
                        type="text" inputMode="numeric" pattern="[0-9]*"

                        className="w-full px-5 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none font-black text-lg"
                        placeholder="0"
                        value={settlementAmount}
                        onChange={e => setSettlementAmount(parseInt(e.target.value) || 0)}
                      />
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 text-xs font-bold">ریال</div>
                    </div>
                    {settlementAmount > (calculatePartnerFinancialStatement(settlementPartnerId, state)?.currentBalance || 0) && (
                      <p className="text-[10px] text-rose-600 font-bold flex items-center gap-1">
                        <AlertCircle size={12} />
                        مبلغ نمی‌تواند بیشتر از مانده بستانکاری باشد
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">منبع پرداخت (بانک / صندوق)</label>
                    <select 
                      className="w-full px-5 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl focus:ring-2 focus:ring-zinc-900 outline-none text-sm font-medium"
                      value={sourceSubsidiaryId}
                      onChange={e => setSourceSubsidiaryId(e.target.value)}
                    >
                      <option value="">انتخاب منبع پرداخت...</option>
                      {state.subsidiaries
                        .filter(s => s.generalType === 'بانک‌ها' || s.generalType === 'صندوق‌ها')
                        .map(s => (
                          <option key={s.id} value={s.id}>{s.name} ({s.generalType})</option>
                        ))
                      }
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest">روش پرداخت</label>
                    <div className="grid grid-cols-2 gap-2">
                      {['واریز به حساب', 'نقدی', 'کارتخوان', 'چک بانکی'].map(method => (
                        <button
                          key={method}
                          onClick={() => setSettlementMethod(method)}
                          className={`py-3 px-4 rounded-xl text-[10px] font-bold transition-all border ${
                            settlementMethod === method 
                              ? 'bg-zinc-900 text-white border-zinc-900' 
                              : 'bg-white text-zinc-500 border-zinc-100 hover:border-zinc-300'
                          }`}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button 
                    onClick={handleExecuteSettlement}
                    disabled={
                      settlementAmount <= 0 || 
                      settlementAmount > calculatePartnerFinancialStatement(settlementPartnerId, state).currentBalance ||
                      !sourceSubsidiaryId
                    }
                    className="w-full py-5 bg-emerald-500 text-white rounded-[24px] font-black shadow-xl shadow-emerald-100 hover:bg-emerald-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:grayscale"
                  >
                    تایید و ثبت سند پرداخت
                    <Banknote size={20} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-8 text-center bg-white rounded-2xl shadow-sm border border-zinc-100">
          <ShieldAlert className="mx-auto text-zinc-300 mb-4" size={48} />
          <h2 className="text-xl font-bold text-zinc-800 mb-2">دسترسی محدود</h2>
          <p className="text-zinc-500">شما به عنوان "مرکز" در سیستم تعریف نشده‌اید.</p>
        </div>
      )}
    </div>
  );
}
