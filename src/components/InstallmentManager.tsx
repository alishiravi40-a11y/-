import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  AppState, InstallmentRequest, InstallmentDocument, InstallmentPlan, 
  Collateral, Person, ApprovalStatus, Installment, ApprovalStep 
} from '../types';
import { 
  Plus, Upload, Trash2, CheckCircle, XCircle, Search, Clock, FileText, 
  Calculator, Shield, History, DollarSign, User, ExternalLink, AlertCircle, ArrowLeft
} from 'lucide-react';
import { 
  saveAppState, calculateInstallments, updateCreditScore, calculateAgentSettlement, 
  toEnglishDigits, parseNumericValue 
} from '../utils/accounting';
import { getCurrentJalaliDate } from '../utils/jalali';
import PersonSelector from './PersonSelector';
import { motion, AnimatePresence } from 'motion/react';

interface InstallmentManagerProps {
  appState: AppState;
  onSave: (newState: AppState) => void;
  currentUserRole: 'admin' | 'agent';
  currentAgentId?: string;
}

export default function InstallmentManager({ appState, onSave, currentUserRole, currentAgentId }: InstallmentManagerProps) {
  const [activeTab, setActiveTab] = useState<'list' | 'add' | 'plans'>('list');
  const [filterStatus, setFilterStatus] = useState<ApprovalStatus | 'all'>('all');

  // Form State
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('beta');
  const [goodsDescription, setGoodsDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [prepaymentAmount, setPrepaymentAmount] = useState<number>(0);
  const [numberOfInstallments, setNumberOfInstallments] = useState<number>(12);
  const [representativeCommission, setRepresentativeCommission] = useState<number>(0);

  const agentIdForComm = currentUserRole === 'agent' ? currentAgentId : selectedPerson?.id;
  const partnerBp = (appState.businessPartners || []).find(bp => bp.personId === agentIdForComm || bp.id === agentIdForComm);
  const maxCommission = Math.max(10, partnerBp?.contract?.commissionRate ?? 10);
  const commissionOptions = Array.from({ length: maxCommission + 1 }, (_, i) => i);

  useEffect(() => {
    if (representativeCommission > maxCommission) {
      setRepresentativeCommission(maxCommission);
    }
  }, [maxCommission]);
  
  // Collaterals State
  const [collaterals, setCollaterals] = useState<Collateral[]>([]);
  const [showCollateralForm, setShowCollateralForm] = useState(false);
  const [newCollateral, setNewCollateral] = useState<Partial<Collateral>>({
    type: 'gold',
    description: '',
    value: 0,
    status: 'held'
  });

  const [documents, setDocuments] = useState<InstallmentDocument[]>([]);
  const [docCategory, setDocCategory] = useState<'national_id' | 'checks' | 'credit_validation' | 'other'>('national_id');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedRequest, setSelectedRequest] = useState<InstallmentRequest | null>(null);
  const [adminComment, setAdminComment] = useState('');

  // Calculations
  const selectedPlan = useMemo(() => 
    appState.installmentPlans.find(p => p.id === selectedPlanId) || appState.installmentPlans[0]
  , [selectedPlanId, appState.installmentPlans]);

  const calcResults = useMemo(() => {
    if (totalAmount <= 0) return { monthlyAmount: 0, totalInterest: 0, totalPayable: 0 };
    const base = calculateInstallments(totalAmount, prepaymentAmount, numberOfInstallments, selectedPlan);
    const finalTotal = Math.round(base.totalPayable * (1 + representativeCommission / 100));
    const totalInterest = finalTotal - (totalAmount - prepaymentAmount);
    return {
      ...base,
      totalInterest: totalInterest,
      totalPayable: finalTotal,
      monthlyAmount: Math.floor((finalTotal - prepaymentAmount) / numberOfInstallments)
    };
  }, [totalAmount, prepaymentAmount, numberOfInstallments, selectedPlan, representativeCommission]);

  const customerScore = useMemo(() => {
    if (!selectedPerson) return 50;
    return updateCreditScore(selectedPerson, appState.installmentRequests);
  }, [selectedPerson, appState.installmentRequests]);

  const requests = currentUserRole === 'agent' && currentAgentId 
    ? appState.installmentRequests.filter(r => r.agentId === currentAgentId)
    : appState.installmentRequests;

  const filteredRequests = requests.filter(r => filterStatus === 'all' || r.status === filterStatus).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setDocuments(prev => [...prev, {
        id: `doc_${Date.now()}`,
        category: docCategory,
        fileName: file.name,
        fileUrl: url
      }]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addCollateral = () => {
    if (!newCollateral.description || !newCollateral.value) return;
    const col: Collateral = {
      id: `col_${Date.now()}`,
      type: newCollateral.type as any,
      description: newCollateral.description || '',
      value: newCollateral.value || 0,
      receivedDate: getCurrentJalaliDate(),
      status: 'held'
    };
    setCollaterals([...collaterals, col]);
    setNewCollateral({ type: 'gold', description: '', value: 0, status: 'held' });
    setShowCollateralForm(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (currentUserRole !== 'agent' || !currentAgentId) {
      alert('فقط نمایندگان می‌توانند درخواست ثبت کنند.');
      return;
    }

    if (!selectedPerson || !goodsDescription || totalAmount <= 0) {
      alert('لطفاً فیلدهای ضروری را پر کنید.');
      return;
    }

    // Generate installments
    const { installments } = calculateInstallments(totalAmount, prepaymentAmount, numberOfInstallments, selectedPlan);
    const monthlyAmount = calcResults.monthlyAmount;

    const newRequest: InstallmentRequest = {
      id: `req_${Date.now()}`,
      agentId: currentAgentId,
      personId: selectedPerson.id,
      planId: selectedPlanId,
      totalAmount,
      prepaymentAmount,
      installmentAmount: monthlyAmount,
      numberOfInstallments,
      installments,
      collaterals,
      documents,
      status: 'agent_submitted',
      approvalHistory: [{
        status: 'agent_submitted',
        userId: currentAgentId,
        userName: appState.persons.find(p => p.id === currentAgentId)?.name || 'نماینده',
        timestamp: new Date().toISOString(),
        comment: 'درخواست ثبت شد'
      }],
      commissionAmount: calcResults.totalInterest,
      createdAt: new Date().toISOString()
    };

    const newState = {
      ...appState,
      installmentRequests: [...appState.installmentRequests, newRequest]
    };

    onSave(newState);
    saveAppState(newState);

    setSelectedPerson(null);
    setGoodsDescription('');
    setTotalAmount(0);
    setPrepaymentAmount(0);
    setCollaterals([]);
    setDocuments([]);
    setActiveTab('list');
  };

  const handleApproval = (requestId: string, nextStatus: ApprovalStatus) => {
    const requestIndex = appState.installmentRequests.findIndex(r => r.id === requestId);
    if (requestIndex === -1) return;

    const updatedRequests = [...appState.installmentRequests];
    const req = updatedRequests[requestIndex];
    
    const step: ApprovalStep = {
      status: nextStatus,
      userId: 'admin', 
      userName: 'مدیریت مرکزی',
      timestamp: new Date().toISOString(),
      comment: adminComment
    };

    updatedRequests[requestIndex] = {
      ...req,
      status: nextStatus,
      approvalHistory: [...req.approvalHistory, step]
    };

    const newState = {
      ...appState,
      installmentRequests: updatedRequests
    };

    onSave(newState);
    saveAppState(newState);
    setSelectedRequest(null);
    setAdminComment('');
  };

  const statusMap: Record<ApprovalStatus, { label: string; color: string }> = {
    'draft': { label: 'پیش‌نویس', color: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
    'agent_submitted': { label: 'ارسال شده', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    'finance_review': { label: 'بررسی مالی', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    'manager_approved': { label: 'تایید نهایی', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    'rejected': { label: 'رد شده', color: 'bg-red-100 text-red-700 border-red-200' },
    'canceled': { label: 'انصراف', color: 'bg-zinc-100 text-zinc-400 border-zinc-200' },
    'pending': { label: 'در انتظار بررسی', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    'approved': { label: 'تایید شده', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' }
  };

  return (
    <div className="h-full flex flex-col font-sans p-4 space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Calculator className="text-zinc-400" />
          <h2 className="text-lg font-bold text-zinc-800">سامانه هوشمند فروش اقساطی</h2>
        </div>
        <div className="flex gap-2">
          {currentUserRole === 'admin' && (
            <button onClick={() => setActiveTab('plans')} className={`px-4 py-2 rounded-xl text-xs font-bold transition ${activeTab === 'plans' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
              طرح‌های فروش
            </button>
          )}
          {currentUserRole === 'agent' && (
            <button
              onClick={() => setActiveTab(activeTab === 'list' ? 'add' : 'list')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${activeTab === 'add' ? 'bg-zinc-200 text-zinc-700' : 'bg-emerald-600 text-white'}`}
            >
              {activeTab === 'add' ? 'بازگشت به لیست' : <><Plus size={16} /> ثبت پرونده جدید</>}
            </button>
          )}
        </div>
      </div>

      {activeTab === 'list' && (
        <div className="flex-1 flex flex-col space-y-4">
          <div className="flex overflow-x-auto pb-2 space-x-2 space-x-reverse no-scrollbar">
            {(['all', ...Object.keys(statusMap)] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status as any)}
                className={`flex-shrink-0 px-4 py-1.5 text-[11px] font-bold rounded-full transition-colors border ${filterStatus === status ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-500 border-zinc-200 hover:bg-zinc-50'}`}
              >
                {status === 'all' ? 'همه موارد' : statusMap[status as ApprovalStatus].label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto space-y-3">
            {filteredRequests.length === 0 ? (
              <div className="text-center text-zinc-400 text-xs py-10 bg-white rounded-2xl border border-zinc-100 border-dashed">
                هیچ پرونده‌ای یافت نشد
              </div>
            ) : (
              filteredRequests.map(req => {
                const isSelected = selectedRequest?.id === req.id;
                const customer = appState.persons.find(p => p.id === req.personId);
                const plan = appState.installmentPlans.find(p => p.id === req.planId);

                return (
                  <div key={req.id} className={`bg-white rounded-2xl border transition-all ${isSelected ? 'border-zinc-800 ring-1 ring-zinc-800 shadow-lg' : 'border-zinc-200 shadow-sm'}`}>
                    <div className="p-4 cursor-pointer flex justify-between items-start" onClick={() => setSelectedRequest(isSelected ? null : req)}>
                      <div className="flex gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isSelected ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                          <User size={20} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-zinc-800 text-sm">{customer?.name || 'مشتری نامشخص'}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${statusMap[req.status].color}`}>
                              {statusMap[req.status].label}
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-500 mt-1">
                            طرح: <span className="text-zinc-800 font-bold">{plan?.name}</span> | 
                            مبلغ: <span className="font-mono font-bold text-zinc-800">{req.totalAmount.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-[10px] text-zinc-400 text-left">
                        {new Date(req.createdAt).toLocaleDateString('fa-IR')}
                      </div>
                    </div>

                    <AnimatePresence>
                      {isSelected && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden border-t border-zinc-100 bg-zinc-50/30"
                        >
                          <div className="p-4 space-y-6">
                            <div className="grid grid-cols-4 gap-2">
                              <div className="bg-white p-2 rounded-xl border border-zinc-100 text-center">
                                <div className="text-[9px] text-zinc-400">اقساط</div>
                                <div className="text-xs font-bold text-zinc-800">{req.numberOfInstallments} ماه</div>
                              </div>
                              <div className="bg-white p-2 rounded-xl border border-zinc-100 text-center">
                                <div className="text-[9px] text-zinc-400">پیش‌پرداخت</div>
                                <div className="text-xs font-bold text-emerald-600">{req.prepaymentAmount.toLocaleString()}</div>
                              </div>
                              <div className="bg-white p-2 rounded-xl border border-zinc-100 text-center">
                                <div className="text-[9px] text-zinc-400">قسط ماهیانه</div>
                                <div className="text-xs font-bold text-blue-600">{req.installmentAmount.toLocaleString()}</div>
                              </div>
                              <div className="bg-white p-2 rounded-xl border border-zinc-100 text-center">
                                <div className="text-[9px] text-zinc-400">کارمزد نماینده</div>
                                <div className="text-xs font-bold text-amber-600">{req.commissionAmount.toLocaleString()}</div>
                              </div>
                            </div>

                            <div>
                              <div className="flex items-center gap-2 mb-3">
                                <History size={14} className="text-zinc-400" />
                                <span className="text-[11px] font-bold text-zinc-700">تاریخچه بررسی و تاییدات</span>
                              </div>
                              <div className="space-y-3 relative before:absolute before:right-2 before:top-2 before:bottom-2 before:w-px before:bg-zinc-200">
                                {req.approvalHistory.map((step, idx) => (
                                  <div key={idx} className="relative pr-6">
                                    <div className="absolute right-0 top-1.5 w-4 h-4 rounded-full bg-white border-2 border-zinc-200 flex items-center justify-center">
                                      <div className={`w-1.5 h-1.5 rounded-full ${step.status === 'manager_approved' ? 'bg-emerald-500' : step.status === 'rejected' ? 'bg-red-500' : 'bg-blue-500'}`} />
                                    </div>
                                    <div className="bg-white p-2 rounded-lg border border-zinc-100 shadow-sm">
                                      <div className="flex justify-between items-center mb-1">
                                        <span className="text-[10px] font-bold text-zinc-800">{statusMap[step.status].label} توسط {step.userName}</span>
                                        <span className="text-[9px] text-zinc-400">{new Date(step.timestamp).toLocaleString('fa-IR')}</span>
                                      </div>
                                      {step.comment && <div className="text-[10px] text-zinc-500 leading-relaxed">{step.comment}</div>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <Shield size={14} className="text-zinc-400" />
                                  <span className="text-[11px] font-bold text-zinc-700">وثایق و ضمانت‌ها</span>
                                </div>
                                <div className="space-y-2">
                                  {req.collaterals.length === 0 ? (
                                    <div className="text-[10px] text-zinc-400 italic">وثیقه‌ای ثبت نشده است</div>
                                  ) : (
                                    req.collaterals.map(col => (
                                      <div key={col.id} className="bg-white p-2 rounded-lg border border-zinc-100 flex justify-between items-center">
                                        <div>
                                          <div className="text-[10px] font-bold text-zinc-800">{col.description}</div>
                                          <div className="text-[9px] text-zinc-400">ارزش: {col.value.toLocaleString()} ریال</div>
                                        </div>
                                        <div className="text-[9px] px-2 py-0.5 rounded bg-zinc-100 text-zinc-500">{col.type === 'gold' ? 'طلا' : 'سند'}</div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <FileText size={14} className="text-zinc-400" />
                                  <span className="text-[11px] font-bold text-zinc-700">مدارک دیجیتال</span>
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                  {req.documents.map(doc => (
                                    <a key={doc.id} href={doc.fileUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between p-2 bg-white border border-zinc-100 rounded-lg hover:border-zinc-400 transition group">
                                      <div className="flex items-center gap-2 overflow-hidden pr-2">
                                        <div className="w-6 h-6 rounded bg-zinc-50 flex items-center justify-center text-zinc-400">
                                          <ExternalLink size={12} />
                                        </div>
                                        <div className="truncate">
                                          <div className="text-[10px] font-bold text-zinc-700 truncate">{doc.fileName}</div>
                                        </div>
                                      </div>
                                    </a>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {currentUserRole === 'admin' && req.status !== 'manager_approved' && req.status !== 'rejected' && (
                              <div className="bg-white border-2 border-zinc-800 rounded-2xl p-4 space-y-3 shadow-xl">
                                <div className="flex items-center gap-2">
                                  <DollarSign size={16} className="text-emerald-500" />
                                  <span className="text-xs font-bold text-zinc-800">بررسی و تغییر وضعیت پرونده</span>
                                </div>
                                <textarea
                                  value={adminComment}
                                  onChange={e => setAdminComment(e.target.value)}
                                  placeholder="توضیحات کارشناسی..."
                                  className="w-full border border-zinc-200 rounded-xl p-3 text-xs outline-none focus:border-zinc-800 resize-none h-24 bg-zinc-50"
                                />
                                <div className="flex gap-2">
                                  <button onClick={() => handleApproval(req.id, 'rejected')} className="flex-1 bg-red-50 text-red-600 hover:bg-red-100 font-bold py-2.5 rounded-xl text-xs transition border border-red-200">
                                    رد درخواست
                                  </button>
                                  {req.status === 'agent_submitted' && (
                                    <button onClick={() => handleApproval(req.id, 'finance_review')} className="flex-1 bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold py-2.5 rounded-xl text-xs transition border border-amber-200">
                                      تایید مالی اولیه
                                    </button>
                                  )}
                                  <button onClick={() => handleApproval(req.id, 'manager_approved')} className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700 font-bold py-2.5 rounded-xl text-xs transition shadow-lg shadow-emerald-200">
                                    تایید نهایی و صدور
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'add' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto space-y-6 pr-1 pl-1 pb-20">
              <div className="bg-white p-5 rounded-3xl border border-zinc-150 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-zinc-800">۱. انتخاب مشتری و اعتبارسنجی</span>
                  {selectedPerson && (
                    <div className="flex items-center gap-2 bg-zinc-50 px-3 py-1 rounded-full border border-zinc-100">
                      <div className="text-[10px] text-zinc-400">رتبه اعتباری:</div>
                      <div className={`text-xs font-black ${customerScore > 70 ? 'text-emerald-500' : customerScore > 40 ? 'text-amber-500' : 'text-red-500'}`}>
                        {customerScore} / ۱۰۰
                      </div>
                    </div>
                  )}
                </div>
                
                <PersonSelector 
                  persons={appState.persons} 
                  selectedPersonId={selectedPerson?.id || ''} 
                  onSelect={p => setSelectedPerson(p)}
                  placeholder="جستجوی نام مشتری یا کد ملی..."
                />

                {selectedPerson && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-100">
                      <div className="text-[9px] text-zinc-400 mb-1">سقف اعتبار باقی‌مانده</div>
                      <div className="text-xs font-bold text-zinc-800">{(selectedPerson.creditLimit || 0).toLocaleString()} ریال</div>
                    </div>
                    <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-100">
                      <div className="text-[9px] text-zinc-400 mb-1">تعداد چک برگشتی</div>
                      <div className="text-xs font-bold text-red-500">۰ مورد</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white p-5 rounded-3xl border border-zinc-150 shadow-sm space-y-4">
                <span className="text-sm font-bold text-zinc-800">۲. انتخاب طرح و ماشین‌حساب هوشمند</span>
                
                <div className="grid grid-cols-3 gap-2">
                  {appState.installmentPlans.map(plan => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`p-3 rounded-2xl border text-center transition-all ${selectedPlanId === plan.id ? 'border-zinc-800 bg-zinc-900 text-white shadow-lg' : 'border-zinc-100 bg-zinc-50 text-zinc-500 hover:border-zinc-300'}`}
                    >
                      <div className="text-[10px] font-bold mb-1">{plan.name}</div>
                      <div className="text-[9px] opacity-70">{plan.interestRate}% کارمزد</div>
                    </button>
                  ))}
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-600 mb-1.5">شرح کالای درخواستی</label>
                    <textarea 
                      value={goodsDescription} 
                      onChange={e => setGoodsDescription(e.target.value)} 
                      className="w-full border border-zinc-200 rounded-2xl px-4 py-3 text-xs outline-none focus:border-zinc-800 resize-none h-20 bg-zinc-50" 
                      placeholder="مثال: آیفون ۱۵ پرو ۲۵۶ گیگ"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-600 mb-1.5">مبلغ کل (ریال)</label>
                      <input 
                        type="text" 
                        inputMode="decimal"
                        value={totalAmount.toLocaleString()} 
                        onChange={e => setTotalAmount(parseNumericValue(toEnglishDigits(e.target.value)))} 
                        className="w-full border border-zinc-200 rounded-2xl px-4 py-3 text-xs outline-none focus:border-zinc-800 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-600 mb-1.5">پیش‌پرداخت</label>
                      <input 
                        type="text" 
                        inputMode="decimal"
                        value={prepaymentAmount.toLocaleString()} 
                        onChange={e => setPrepaymentAmount(parseNumericValue(toEnglishDigits(e.target.value)))} 
                        className="w-full border border-zinc-200 rounded-2xl px-4 py-3 text-xs outline-none focus:border-zinc-800 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-zinc-600 mb-1.5">تعداد اقساط (۱ تا {selectedPlan?.maxTerm})</label>
                      <input 
                        type="number" 
                        inputMode="numeric"
                        value={numberOfInstallments} 
                        onChange={e => setNumberOfInstallments(Math.min(selectedPlan?.maxTerm || 12, parseInt(e.target.value || '1')))} 
                        className="w-full border border-zinc-200 rounded-2xl px-4 py-3 text-xs outline-none focus:border-zinc-800 font-mono"
                      />
                    </div>
                    <div className="bg-zinc-900 rounded-2xl p-3 flex flex-col justify-center">
                      <div className="text-[9px] text-zinc-400">قسط ماهیانه</div>
                      <div className="text-sm font-bold text-white font-mono">{calcResults.monthlyAmount.toLocaleString()}</div>
                    </div>
                  </div>
                  
                  <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-100 space-y-2">
                    <label className="block text-[10px] text-zinc-500 text-right">کمیسیون نماینده (سقف مجاز: {maxCommission}٪)</label>
                    <select
                      value={representativeCommission}
                      onChange={(e) => setRepresentativeCommission(Number(e.target.value))}
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-1 font-sans text-[10px] text-zinc-800 text-center"
                    >
                      {commissionOptions.map(rate => (
                        <option key={rate} value={rate}>{rate}٪</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-zinc-150 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-zinc-800">۳. وثایق و مدارک</span>
                  <button 
                    type="button" 
                    onClick={() => setShowCollateralForm(!showCollateralForm)} 
                    className="text-xs text-blue-600 font-bold flex items-center gap-1"
                  >
                    <Plus size={14} /> افزودن وثیقه
                  </button>
                </div>

                {showCollateralForm && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 border border-blue-100 bg-blue-50/30 rounded-2xl space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <select 
                        value={newCollateral.type} 
                        onChange={e => setNewCollateral({...newCollateral, type: e.target.value as any})}
                        className="bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
                      >
                        <option value="gold">طلا</option>
                        <option value="property_doc">سند ملکی</option>
                        <option value="check">چک صیادی</option>
                        <option value="other">سایر</option>
                      </select>
                      <input 
                        type="text" 
                        placeholder="ارزش تقریبی..." 
                        value={newCollateral.value?.toLocaleString()}
                        onChange={e => setNewCollateral({...newCollateral, value: parseNumericValue(toEnglishDigits(e.target.value))})}
                        className="bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none font-mono"
                      />
                    </div>
                    <input 
                      type="text" 
                      placeholder="شرح وثیقه (مثال: دستبند طلا ۲۴ گرم)" 
                      value={newCollateral.description}
                      onChange={e => setNewCollateral({...newCollateral, description: e.target.value})}
                      className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none"
                    />
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setShowCollateralForm(false)} className="flex-1 bg-white text-zinc-500 py-2 rounded-xl text-xs font-bold border border-zinc-200">انصراف</button>
                      <button type="button" onClick={addCollateral} className="flex-1 bg-zinc-900 text-white py-2 rounded-xl text-xs font-bold shadow-lg">ثبت وثیقه</button>
                    </div>
                  </motion.div>
                )}

                <div className="space-y-2">
                  {collaterals.map(col => (
                    <div key={col.id} className="flex items-center justify-between p-3 bg-zinc-50 rounded-2xl border border-zinc-100">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                          <Shield size={14} />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-zinc-800">{col.description}</div>
                          <div className="text-[9px] text-zinc-400">ارزش: {col.value.toLocaleString()} ریال</div>
                        </div>
                      </div>
                      <button type="button" onClick={() => setCollaterals(collaterals.filter(c => c.id !== col.id))} className="text-red-400 p-1 hover:bg-red-50 rounded-lg transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="pt-2">
                  <div className="flex gap-2">
                    <select value={docCategory} onChange={e => setDocCategory(e.target.value as any)} className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 text-xs outline-none flex-1">
                      <option value="national_id">کارت ملی</option>
                      <option value="checks">تصاویر چک</option>
                      <option value="credit_validation">اعتبارسنجی</option>
                      <option value="other">سایر مدارک</option>
                    </select>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="bg-zinc-100 text-zinc-700 font-bold px-4 py-2 rounded-xl text-xs hover:bg-zinc-200 transition flex items-center gap-2">
                      <Upload size={14} /> بارگذاری
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*,.pdf" />
                  </div>
                  {documents.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      {documents.map(doc => (
                        <div key={doc.id} className="flex items-center justify-between p-2 bg-white border border-zinc-100 rounded-xl">
                          <div className="truncate pr-2">
                            <div className="text-[9px] font-bold text-zinc-700 truncate">{doc.fileName}</div>
                          </div>
                          <button type="button" onClick={() => setDocuments(documents.filter(d => d.id !== doc.id))} className="text-red-400 p-1 hover:bg-red-50 rounded-lg transition"><Trash2 size={12}/></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-4 bg-zinc-50/80 backdrop-blur-md border-t border-zinc-200">
              <div className="flex gap-3 max-w-lg mx-auto">
                <div className="flex-1 bg-white rounded-2xl border border-zinc-200 p-2 px-4 flex flex-col justify-center">
                  <div className="text-[9px] text-zinc-400">کارمزد نماینده</div>
                  <div className="text-xs font-bold text-zinc-800">
                    {calculateAgentSettlement({ totalAmount, prepaymentAmount, numberOfInstallments } as any, selectedPlan).toLocaleString()} ریال
                  </div>
                </div>
                <button type="submit" className="flex-[2] bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-4 rounded-2xl text-sm transition shadow-xl shadow-zinc-200 flex items-center justify-center gap-2">
                  ثبت و ارسال پرونده <ArrowLeft size={18} />
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {activeTab === 'plans' && (
        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
            <AlertCircle className="text-amber-600 flex-shrink-0" />
            <div className="text-xs text-amber-800 leading-relaxed">
              <strong>نکته مدیریت:</strong> تغییر در نرخ‌های کارمزد یا جریمه فقط بر روی پرونده‌های <strong>جدید</strong> اعمال می‌شود. طرح‌های فعال توسط نمایندگان در پنل کاربری قابل مشاهده هستند.
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {appState.installmentPlans.map(plan => (
              <div key={plan.id} className="bg-white p-5 rounded-3xl border border-zinc-150 shadow-sm space-y-4">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-zinc-800">{plan.name}</span>
                  <div className={`w-3 h-3 rounded-full ${plan.isActive ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-[10px] text-zinc-400">نرخ کارمزد</div>
                    <div className="text-sm font-bold text-zinc-800">{plan.interestRate}%</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] text-zinc-400">نرخ جریمه (ماهانه)</div>
                    <div className="text-sm font-bold text-red-500">{plan.penaltyRate}%</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] text-zinc-400">حداکثر بازپرداخت</div>
                    <div className="text-sm font-bold text-zinc-800">{plan.maxTerm} ماه</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] text-zinc-400">پیش‌پرداخت الزامی</div>
                    <div className="text-sm font-bold text-zinc-800">{plan.prepaymentPercent}%</div>
                  </div>
                </div>
                <button className="w-full bg-zinc-50 hover:bg-zinc-100 text-zinc-600 py-2 rounded-xl text-[11px] font-bold border border-zinc-100 transition">
                  ویرایش پارامترهای طرح
                </button>
              </div>
            ))}
            <button className="border-2 border-dashed border-zinc-200 rounded-3xl p-5 flex flex-col items-center justify-center text-zinc-400 hover:border-zinc-400 hover:text-zinc-500 transition-all gap-2">
              <Plus />
              <span className="text-xs font-bold">ایجاد طرح فروش جدید</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
