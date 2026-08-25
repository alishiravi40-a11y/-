import React, { useState, useMemo } from 'react';
import { AppState, InstallmentRequest, InstallmentDocument } from '../types';
import { 
  FileText, Plus, Upload, CheckCircle, X, LogOut, ArrowRight, 
  Coins, Shield, AlertCircle, ShieldAlert, FileCheck2, Scale, MessageSquare
} from 'lucide-react';
import { getCurrentJalaliDate, parseJalali, jalaliToGregorian } from '../utils/jalali';
import { resolvePartnerCreditRules } from '../utils/partnerProcess';

interface AgentDashboardProps {
  state: AppState;
  currentAgentId: string;
  onAddInstallmentRequest: (request: InstallmentRequest) => void;
  onLogout: () => void;
}

export default function AgentDashboard({ state, currentAgentId, onAddInstallmentRequest, onLogout }: AgentDashboardProps) {
  const agent = state.persons.find(p => p.id === currentAgentId);
  const [activeTab, setActiveTab] = useState<'list' | 'new'>('list');

  // Dynamic wallet balance and overdue calculations
  const walletBalance = useMemo(() => {
    let balance = 0;
    state.vouchers.forEach(v => {
      v.entries.forEach(e => {
        if (e.subsidiaryId === 'SUB_PARTNER_WALLET' && e.floatingDetailed?.id === currentAgentId) {
          balance += (e.credit || 0) - (e.debit || 0);
        }
      });
    });
    return balance;
  }, [state.vouchers, currentAgentId]);

  const overdueInvoices = useMemo(() => {
    if (!agent) return [];
    const fallbackRules = resolvePartnerCreditRules(agent, state.businessPartners);
    
    const getDaysDiff = (jalaliDateStr: string): number => {
      const parsed = parseJalali(jalaliDateStr);
      if (!parsed) return 0;
      try {
        const gDate = jalaliToGregorian(parsed.jy, parsed.jm, parsed.jd);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        gDate.setHours(0, 0, 0, 0);
        const diffTime = today.getTime() - gDate.getTime();
        return Math.floor(diffTime / (1000 * 60 * 60 * 24));
      } catch (e) {
        return 0;
      }
    };

    return state.invoices.filter(invoice => {
      if (invoice.type !== 'sell' || invoice.personId !== currentAgentId || invoice.isProInvoice) return false;
      const unpaid = invoice.totalAmount - (invoice.paidAmount || 0);
      if (unpaid <= 0) return false;

      const allowedDays = invoice.creditRulesSnapshot?.defaultInstallmentDays ?? fallbackRules.defaultInstallmentDays;
      const elapsedDays = getDaysDiff(invoice.date);
      return elapsedDays > allowedDays;
    }).map(invoice => {
      const allowedDays = invoice.creditRulesSnapshot?.defaultInstallmentDays ?? fallbackRules.defaultInstallmentDays;
      const elapsedDays = getDaysDiff(invoice.date);
      const overdueDays = elapsedDays - allowedDays;
      
      let alertStage = 'مرحله ۱: پیامک دوستانه';
      let alertColor = 'text-blue-700 bg-blue-50 border-blue-200';
      if (overdueDays > 7 && overdueDays <= 15) {
        alertStage = 'مرحله ۲: پیامک هشدار جدی';
        alertColor = 'text-amber-700 bg-amber-50 border-amber-200';
      } else if (overdueDays > 15) {
        alertStage = 'مرحله ۳: اخطار قانونی رسمی';
        alertColor = 'text-rose-700 bg-rose-50 border-rose-200';
      }

      return {
        ...invoice,
        overdueDays,
        alertStage,
        alertColor
      };
    });
  }, [state.invoices, agent, currentAgentId]);

  // New Request Form State
  const [customerName, setCustomerName] = useState('');
  const [customerNationalId, setCustomerNationalId] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [goodsDescription, setGoodsDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState(0);
  const [prepaymentAmount, setPrepaymentAmount] = useState(0);
  const [installmentAmount, setInstallmentAmount] = useState(0);
  const [numberOfInstallments, setNumberOfInstallments] = useState(0);
  const [documents, setDocuments] = useState<InstallmentDocument[]>([]);

  // File Upload Handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, category: InstallmentDocument['category']) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        const newDoc: InstallmentDocument = {
          id: `DOC_${Date.now()}`,
          category,
          fileName: file.name,
          fileUrl: reader.result as string, // base64
        };
        setDocuments(prev => [...prev, newDoc]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveDocument = (id: string) => {
    setDocuments(prev => prev.filter(d => d.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName || !customerNationalId || !totalAmount) return;

    const newRequest: InstallmentRequest = {
      id: `REQ_${Date.now()}`,
      agentId: currentAgentId,
      customerName,
      customerNationalId,
      customerMobile,
      goodsDescription,
      totalAmount,
      prepaymentAmount,
      installmentAmount,
      numberOfInstallments,
      documents,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    onAddInstallmentRequest(newRequest);
    setActiveTab('list');
    
    // Reset Form
    setCustomerName('');
    setCustomerNationalId('');
    setCustomerMobile('');
    setGoodsDescription('');
    setTotalAmount(0);
    setPrepaymentAmount(0);
    setInstallmentAmount(0);
    setNumberOfInstallments(0);
    setDocuments([]);
  };

  const myRequests = state.installmentRequests.filter(r => r.agentId === currentAgentId);

  return (
    <div className="h-full flex flex-col bg-zinc-50 font-sans text-right">
      <div className="bg-emerald-600 text-white p-4 shadow-md flex justify-between items-center rounded-b-2xl">
        <button onClick={onLogout} className="p-2 bg-emerald-700/50 hover:bg-emerald-700 rounded-full transition text-emerald-100">
          <LogOut size={16} />
        </button>
        <div className="text-right">
          <div className="font-bold text-sm">پنل اختصاصی نماینده</div>
          <div className="text-[10px] text-emerald-100 mt-0.5">{agent?.name} ({agent?.code})</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'list' && (
          <div className="space-y-4">
            {/* Live Partner Information Dashboard Widgets */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {/* Wallet Widget */}
              <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-2 relative overflow-hidden">
                <div className="absolute top-0 left-0 bg-emerald-50 text-emerald-600 px-3 py-1 text-[9px] font-bold rounded-br-xl">
                  کیف پول اعتباری
                </div>
                <div className="flex items-center space-x-2 space-x-reverse text-zinc-400 text-[10px] mt-2">
                  <Coins size={14} className="text-zinc-500" />
                  <span>اعتبار قابل استفاده</span>
                </div>
                <div className="text-lg font-mono font-bold text-zinc-800">
                  {walletBalance.toLocaleString()} ریال
                </div>
                <div className="text-[9px] text-zinc-400 pt-1 border-t">
                  سقف کل اعتبار همکار: {agent?.creditLimit?.toLocaleString() || '۵۰۰,۰۰۰,۰۰۰'} ریال
                </div>
              </div>

              {/* Status and Switches Widget */}
              <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-2">
                <div className="text-[10px] text-zinc-400 flex items-center space-x-1 space-x-reverse">
                  <Shield size={14} className="text-zinc-500" />
                  <span>دسترسی‌ها و تایید مدارک</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 pt-1">
                  <div className="flex items-center justify-between bg-zinc-50 px-2 py-1.5 rounded-lg border">
                    <span className="text-[9px] text-zinc-500">مدارک فیزیکی</span>
                    {agent?.isDocumentsApproved ? (
                      <span className="text-[8px] bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded font-bold">تایید نهایی</span>
                    ) : (
                      <span className="text-[8px] bg-rose-100 text-rose-800 px-1 py-0.5 rounded font-bold">بررسی نشده</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between bg-zinc-50 px-2 py-1.5 rounded-lg border">
                    <span className="text-[9px] text-zinc-500">عمده‌فروشی</span>
                    {agent?.isOfflineWholesaleEnabled !== false ? (
                      <span className="text-[8px] bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded font-bold">فعال</span>
                    ) : (
                      <span className="text-[8px] bg-zinc-200 text-zinc-600 px-1 py-0.5 rounded font-bold">غیرفعال</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between bg-zinc-50 px-2 py-1.5 rounded-lg border col-span-2">
                    <span className="text-[9px] text-zinc-500">فروش اقساطی</span>
                    {agent?.isInstallmentEnabled !== false ? (
                      <span className="text-[8px] bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded font-bold">مجاز</span>
                    ) : (
                      <span className="text-[8px] bg-rose-100 text-rose-800 px-1 py-0.5 rounded font-bold">موقتاً مسدود</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Overdue/Penalties Warning Widget */}
              <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-2">
                <div className="text-[10px] text-zinc-400 flex items-center space-x-1 space-x-reverse">
                  <Scale size={14} className="text-zinc-500" />
                  <span>معوقات و هشدارها</span>
                </div>
                {overdueInvoices.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-rose-600 flex items-center gap-1">
                      <ShieldAlert size={12} />
                      <span>{overdueInvoices.length} فاکتور معوقه!</span>
                    </div>
                    <div className="text-[8px] bg-amber-50 text-amber-800 p-1 rounded border border-amber-200 line-clamp-2">
                      محدودیت پرداخت فاکتور به پایان رسیده. نرخ جریمه روزانه فعال است.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle size={12} className="text-emerald-500" />
                      <span>وضعیت پرداخت کاملاً سفید</span>
                    </div>
                    <p className="text-[9px] text-zinc-400">هیچ فاکتور معوقه‌ای یافت نشد.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center">
              <button onClick={() => setActiveTab('new')} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow flex items-center space-x-1.5 space-x-reverse transition">
                <Plus size={14} className="stroke-[3px]"/>
                <span>درخواست جدید</span>
              </button>
              <div className="text-xs font-bold text-zinc-800">پرونده‌های من</div>
            </div>

            {myRequests.length === 0 ? (
              <div className="text-center text-zinc-400 py-12 text-xs">شما هیچ پرونده‌ای ثبت نکرده‌اید</div>
            ) : (
              <div className="space-y-3">
                {myRequests.map(r => (
                  <div key={r.id} className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm flex flex-col space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="text-left">
                        <div className={`text-[10px] px-2 py-1 rounded-md font-bold ${
                          r.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                          r.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {r.status === 'pending' ? 'در انتظار بررسی' : r.status === 'approved' ? 'تایید شده' : 'رد شده'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-sm text-zinc-800">{r.customerName}</div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">کد ملی: {r.customerNationalId}</div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-right">
                      <div className="bg-zinc-50 p-2 rounded-xl border border-zinc-100">
                        <div className="text-[9px] text-zinc-400">مبلغ کل</div>
                        <div className="text-xs font-bold font-mono text-zinc-700 mt-0.5">{r.totalAmount.toLocaleString()} ریال</div>
                      </div>
                      <div className="bg-zinc-50 p-2 rounded-xl border border-zinc-100">
                        <div className="text-[9px] text-zinc-400">مبلغ اقساط / تعداد</div>
                        <div className="text-xs font-bold font-mono text-zinc-700 mt-0.5">{r.installmentAmount.toLocaleString()} ({r.numberOfInstallments} قسط)</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 space-x-reverse text-[10px] text-zinc-500">
                      <FileText size={12} />
                      <span>{r.documents.length} مدرک آپلود شده</span>
                    </div>

                    {r.adminNotes && (
                      <div className="bg-rose-50 text-rose-700 p-2.5 rounded-xl text-[10px]">
                        <strong>پیام مدیریت:</strong> {r.adminNotes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'new' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center space-x-2 space-x-reverse border-b border-zinc-200 pb-2">
              <button type="button" onClick={() => setActiveTab('list')} className="p-1 text-zinc-400 hover:text-zinc-600 transition">
                <ArrowRight size={16} />
              </button>
              <div className="text-sm font-bold text-zinc-800">تشکیل پرونده جدید مشتری</div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-zinc-150 space-y-3">
              <div className="font-bold text-xs text-emerald-700 border-b border-emerald-100 pb-1 mb-2">اطلاعات هویتی مشتری</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">کد ملی مشتری *</label>
                  <input required type="text" inputMode="numeric" pattern="[0-9]*" value={customerNationalId} onChange={e => setCustomerNationalId(e.target.value)} className="w-full font-mono text-xs p-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:border-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">نام و نام خانوادگی *</label>
                  <input required type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} className="w-full text-xs p-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:border-emerald-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1">شماره موبایل</label>
                <input type="text" inputMode="numeric" pattern="[0-9]*" value={customerMobile} onChange={e => setCustomerMobile(e.target.value)} className="w-full font-mono text-xs p-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:border-emerald-500 outline-none" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-zinc-150 space-y-3">
              <div className="font-bold text-xs text-emerald-700 border-b border-emerald-100 pb-1 mb-2">اطلاعات مالی قرارداد</div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1">شرح کالا/خدمات *</label>
                <input required type="text" value={goodsDescription} onChange={e => setGoodsDescription(e.target.value)} placeholder="مثلا: یک دستگاه یخچال ساید" className="w-full text-xs p-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:border-emerald-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">مبلغ کل فاکتور (ریال) *</label>
                  <input required type="text" inputMode="numeric" pattern="[0-9]*" value={totalAmount || ''} onChange={e => setTotalAmount(parseInt(e.target.value||'0'))} className="w-full font-mono text-xs p-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:border-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">مبلغ پیش‌پرداخت (ریال)</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={prepaymentAmount || ''} onChange={e => setPrepaymentAmount(parseInt(e.target.value||'0'))} className="w-full font-mono text-xs p-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:border-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">مبلغ هر قسط (ریال)</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={installmentAmount || ''} onChange={e => setInstallmentAmount(parseInt(e.target.value||'0'))} className="w-full font-mono text-xs p-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:border-emerald-500 outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">تعداد اقساط (ماه)</label>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" value={numberOfInstallments || ''} onChange={e => setNumberOfInstallments(parseInt(e.target.value||'0'))} className="w-full font-mono text-xs p-2 bg-zinc-50 border border-zinc-200 rounded-xl focus:border-emerald-500 outline-none" />
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-zinc-150 space-y-4">
              <div className="font-bold text-xs text-emerald-700 border-b border-emerald-100 pb-1">آپلود مدارک در پوشه مشتری</div>
              
              <div className="space-y-3">
                {/* Upload Buttons */}
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col items-center justify-center p-3 bg-zinc-50 border border-dashed border-zinc-300 rounded-xl cursor-pointer hover:bg-zinc-100 transition">
                    <Upload size={16} className="text-zinc-400 mb-1" />
                    <span className="text-[9px] font-bold text-zinc-600 text-center">کارت ملی</span>
                    <input type="file" accept="image/*" className="hidden" onChange={e => handleFileUpload(e, 'national_id')} />
                  </label>
                  <label className="flex flex-col items-center justify-center p-3 bg-zinc-50 border border-dashed border-zinc-300 rounded-xl cursor-pointer hover:bg-zinc-100 transition">
                    <Upload size={16} className="text-zinc-400 mb-1" />
                    <span className="text-[9px] font-bold text-zinc-600 text-center">تصویر چک‌ها</span>
                    <input type="file" accept="image/*" className="hidden" onChange={e => handleFileUpload(e, 'checks')} />
                  </label>
                  <label className="flex flex-col items-center justify-center p-3 bg-zinc-50 border border-dashed border-zinc-300 rounded-xl cursor-pointer hover:bg-zinc-100 transition">
                    <Upload size={16} className="text-zinc-400 mb-1" />
                    <span className="text-[9px] font-bold text-zinc-600 text-center">نتیجه اعتبارسنجی</span>
                    <input type="file" accept="image/*" className="hidden" onChange={e => handleFileUpload(e, 'credit_validation')} />
                  </label>
                </div>

                {/* Uploaded Files List */}
                {documents.length > 0 && (
                  <div className="space-y-2 mt-2">
                    <div className="text-[10px] text-zinc-500 font-bold">فایل‌های آپلود شده:</div>
                    {documents.map(doc => (
                      <div key={doc.id} className="flex items-center justify-between bg-zinc-50 p-2 rounded-lg border border-zinc-200">
                        <div className="flex items-center space-x-2 space-x-reverse">
                          {doc.fileUrl.startsWith('data:image') ? (
                            <img src={doc.fileUrl} alt="doc" className="w-8 h-8 object-cover rounded bg-zinc-200" />
                          ) : (
                            <div className="w-8 h-8 bg-zinc-200 rounded flex items-center justify-center"><FileText size={14} className="text-zinc-400" /></div>
                          )}
                          <div>
                            <div className="text-[10px] font-bold text-zinc-700">{doc.category === 'national_id' ? 'کارت ملی' : doc.category === 'checks' ? 'چک' : 'اعتبارسنجی'}</div>
                            <div className="text-[8px] text-zinc-400 max-w-[120px] truncate">{doc.fileName}</div>
                          </div>
                        </div>
                        <button type="button" onClick={() => handleRemoveDocument(doc.id)} className="p-1 text-red-500 hover:bg-red-50 rounded">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-2xl shadow transition text-sm flex items-center justify-center space-x-2 space-x-reverse mt-2">
              <CheckCircle size={18} />
              <span>ارسال پرونده به مدیریت</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
