import React, { useState, useMemo } from 'react';
import { 
  BarChart2, Users, Wallet, ShieldAlert, CheckCircle2, AlertCircle, Ban, 
  Search, Filter, Eye, FileText, Calendar, ArrowUpRight, TrendingUp, RefreshCw, X, Check,
  ShoppingBag, ShoppingCart
} from 'lucide-react';
import { AppState, BusinessPartner, Person } from '../types';
import { canCreateNesyehOrder } from './NesyehPartnerDashboard';
import { NesyehInventoryAndOrdersManager } from './NesyehInventoryAndOrdersManager';
import { VisitorNetworkManager } from './VisitorNetworkManager';

interface NesyehControlCenterViewProps {
  state: AppState;
  onUpdateState: (newState: AppState) => void;
}

export function NesyehControlCenterView({ state, onUpdateState }: NesyehControlCenterViewProps) {
  const [activeViewTab, setActiveViewTab] = useState<'control_center' | 'orders_manager' | 'visitor_network'>('control_center');
  const [controlFilter, setControlFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPartnerDetail, setSelectedPartnerDetail] = useState<any | null>(null);

  // 1. Get Nesyeh partners
  const nesyehPartners = useMemo(() => {
    const allBPs = state.businessPartners || [];
    return allBPs.filter(partner => {
      const agencyType = partner.agencyType as any;
      const roles = partner.roles as any[] || [];
      const contractType = partner.contract?.type as any;
      const profileRole = (partner.profile as any)?.partnerRole;

      return (
        agencyType === 'INSTALLMENT_ONLY' || 
        agencyType === 'DEFERRED_AGENT' ||
        roles.includes('DEFERRED_AGENT' as any) ||
        roles.includes('DEFERRED_AGENT') ||
        contractType === 'DEFERRED_AGENT' ||
        profileRole === 'DEFERRED_AGENT' ||
        profileRole === 'INSTALLMENT_ONLY'
      );
    });
  }, [state.businessPartners]);

  const mappedPartners = useMemo(() => {
    return nesyehPartners.map(partner => {
      const agentPerson = (state.persons || []).find(p => p.id === partner.personId);
      const checkResult = canCreateNesyehOrder(partner, agentPerson, state);

      const partnerName = partner.profile?.partnerName || agentPerson?.name || 'نماینده فروش';
      const storeName = partner.profile?.storeName || agentPerson?.agentDetails?.storeName || 'فروشگاه طرف قرارداد';
      const code = agentPerson?.code || partner.id;

      const partnerOrders = (state.nesyehPurchaseOrders || []).filter(o => o.partnerId === partner.id);
      const activeOrdersCount = partnerOrders.filter(o => o.status === 'SUBMITTED' || o.status === 'UNDER_REVIEW' || o.status === 'MODIFIED_BY_COMPANY').length;
      
      const partnerDeclarations = (state.nesyehPaymentDeclarations || []).filter(d => d.partnerId === partner.id);
      const pendingPaymentsCount = partnerDeclarations.filter(d => d.status === 'PENDING').length;
      const verifiedPaymentsSum = partnerDeclarations.filter(d => d.status === 'VERIFIED' || d.status === 'RECONCILED_WITH_DISCREPANCY').reduce((s, d) => s + (d.amount || 0), 0);

      const openOrders = partnerOrders.filter(o => o.status !== 'CANCELLED' && o.status !== 'REJECTED');
      const oldestDate = openOrders.length > 0 ? openOrders[openOrders.length - 1].orderDate : '-';

      return {
        partner,
        agentPerson,
        checkResult,
        partnerName,
        storeName,
        code,
        partnerOrders,
        partnerDeclarations,
        activeOrdersCount,
        pendingPaymentsCount,
        verifiedPaymentsSum,
        oldestDate
      };
    });
  }, [nesyehPartners, state]);

  // Summary Metrics
  const totalActivePartners = mappedPartners.length;
  const totalCreditLimit = mappedPartners.reduce((s, p) => s + p.checkResult.creditLimit, 0);
  const totalNetDebt = mappedPartners.reduce((s, p) => s + p.checkResult.netDebt, 0);
  const totalPendingPayments = (state.nesyehPaymentDeclarations || []).filter(d => d.status === 'PENDING').reduce((s, d) => s + (d.amount || 0), 0);
  const totalOpenOrdersSum = (state.nesyehPurchaseOrders || []).filter(o => o.status === 'SUBMITTED' || o.status === 'UNDER_REVIEW' || o.status === 'MODIFIED_BY_COMPANY').reduce((s, o) => s + (o.totalAmount || 0), 0);
  const overduePartnersCount = mappedPartners.filter(p => p.checkResult.status === 'OVERDUE').length;

  // Management Alerts
  const alerts = useMemo(() => {
    const list: { type: 'warning' | 'danger' | 'info'; text: string }[] = [];
    mappedPartners.forEach(p => {
      const usageRatio = p.checkResult.creditLimit > 0 ? (p.checkResult.usedCredit / p.checkResult.creditLimit) : 0;
      if (usageRatio >= 0.9 && usageRatio < 1.0) {
        list.push({ type: 'warning', text: `نماینده ${p.partnerName} (${p.storeName}) به ۹۰ درصد سقف خرید خود رسیده است.` });
      }
      if (p.checkResult.status === 'OVERDUE') {
        list.push({ type: 'danger', text: `نماینده ${p.partnerName} دارای بدهی یا چک سررسید گذشته معوق است.` });
      }
      if (p.pendingPaymentsCount > 0) {
        list.push({ type: 'info', text: `نماینده ${p.partnerName} دارای ${p.pendingPaymentsCount} فقره اعلام پرداخت در انتظار تایید مدیریت است.` });
      }
    });
    return list;
  }, [mappedPartners]);

  // Filtered partners
  const filteredPartners = useMemo(() => {
    return mappedPartners.filter(item => {
      const { partnerName, storeName, code, checkResult, activeOrdersCount, pendingPaymentsCount } = item;
      const matchesSearch = 
        partnerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        storeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        code.toLowerCase().includes(searchQuery.toLowerCase());

      let matchesControl = true;
      if (controlFilter === 'active') {
        matchesControl = checkResult.isPurchaseAllowed;
      } else if (controlFilter === 'debtors') {
        matchesControl = checkResult.netDebt > 0;
      } else if (controlFilter === 'near_limit') {
        matchesControl = checkResult.status === 'NEAR_LIMIT';
      } else if (controlFilter === 'pending_payments') {
        matchesControl = pendingPaymentsCount > 0;
      } else if (controlFilter === 'open_orders') {
        matchesControl = activeOrdersCount > 0;
      }

      return matchesSearch && matchesControl;
    });
  }, [mappedPartners, searchQuery, controlFilter]);

  // Aging breakdown (Read-Only estimation)
  const agingSummary = useMemo(() => {
    let current = 0;
    let d1_30 = 0;
    let d31_60 = 0;
    let d_over60 = 0;

    mappedPartners.forEach(p => {
      const debt = p.checkResult.netDebt;
      if (p.checkResult.status === 'OVERDUE') {
        d31_60 += debt * 0.4;
        d_over60 += debt * 0.6;
      } else if (p.checkResult.status === 'NEAR_LIMIT') {
        d1_30 += debt * 0.5;
        current += debt * 0.5;
      } else {
        current += debt;
      }
    });

    return { current, d1_30, d31_60, d_over60 };
  }, [mappedPartners]);

  return (
    <div className="space-y-6 font-sans" dir="rtl">
      
      {/* Sub-tab Navigation */}
      <div className="bg-white border border-zinc-200 p-1.5 rounded-2xl shadow-sm flex flex-col sm:flex-row gap-2">
        <button
          onClick={() => setActiveViewTab('control_center')}
          className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeViewTab === 'control_center'
              ? 'bg-teal-700 text-white shadow-md'
              : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          <BarChart2 className="w-4 h-4" />
          <span>مرکز کنترل و اعتبارسنجی عاملیت نسیه</span>
        </button>

        <button
          onClick={() => setActiveViewTab('orders_manager')}
          className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeViewTab === 'orders_manager'
              ? 'bg-indigo-700 text-white shadow-md'
              : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>کارتابل مدیریت سفارشات نسیه و ویترین کالا</span>
        </button>

        <button
          onClick={() => setActiveViewTab('visitor_network')}
          className={`flex-1 py-3 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            activeViewTab === 'visitor_network'
              ? 'bg-slate-900 text-white shadow-md'
              : 'bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>شبکه ویزیتورها و جذب‌کنندگان</span>
        </button>
      </div>

      {activeViewTab === 'orders_manager' ? (
        <NesyehInventoryAndOrdersManager state={state} onUpdateState={onUpdateState} />
      ) : activeViewTab === 'visitor_network' ? (
        <VisitorNetworkManager state={state} onUpdateState={onUpdateState} />
      ) : (
        <>
          {/* Top Banner */}
      <div className="bg-gradient-to-r from-teal-950 via-slate-900 to-indigo-950 p-6 rounded-2xl border border-teal-500/30 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-teal-500/20 text-teal-400 border border-teal-500/40 flex items-center justify-center shrink-0 shadow-lg">
            <BarChart2 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black">مرکز کنترل و گزارش‌های مدیریتی نسیه</h2>
              <span className="bg-teal-500/20 text-teal-300 border border-teal-500/40 text-xs px-2.5 py-0.5 rounded-full font-bold">
                فاز ۶ (صرفاً خواندنی)
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              نظارت لحظه‌ای بر عملکرد، سقف‌های اعتباری، بدهی‌های قطعی، گردش سفارش‌ها و تحلیل سنی بدهی نمایندگان فروش
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        
        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div className="text-zinc-500 text-xs font-semibold mb-2">نمایندگان فعال نسیه</div>
          <div className="text-xl font-black font-mono text-zinc-800">{totalActivePartners} <span className="text-xs text-zinc-400 font-sans font-normal">نماینده</span></div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div className="text-zinc-500 text-xs font-semibold mb-2">مجموع سقف خرید</div>
          <div className="text-sm font-black font-mono text-teal-700 truncate">{totalCreditLimit.toLocaleString('fa-IR')} <span className="text-[10px] text-zinc-400 font-sans font-normal">ریال</span></div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div className="text-zinc-500 text-xs font-semibold mb-2">مجموع بدهی قطعی</div>
          <div className="text-sm font-black font-mono text-amber-600 truncate">{totalNetDebt.toLocaleString('fa-IR')} <span className="text-[10px] text-zinc-400 font-sans font-normal">ریال</span></div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div className="text-zinc-500 text-xs font-semibold mb-2">پرداخت‌های در انتظار تایید</div>
          <div className="text-sm font-black font-mono text-indigo-600 truncate">{totalPendingPayments.toLocaleString('fa-IR')} <span className="text-[10px] text-zinc-400 font-sans font-normal">ریال</span></div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div className="text-zinc-500 text-xs font-semibold mb-2">مجموع سفارش‌های باز</div>
          <div className="text-sm font-black font-mono text-teal-600 truncate">{totalOpenOrdersSum.toLocaleString('fa-IR')} <span className="text-[10px] text-zinc-400 font-sans font-normal">ریال</span></div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col justify-between">
          <div className="text-zinc-500 text-xs font-semibold mb-2">نمایندگان دارای تاخیر</div>
          <div className="text-xl font-black font-mono text-rose-600">{overduePartnersCount} <span className="text-xs text-zinc-400 font-sans font-normal">نماینده</span></div>
        </div>

      </div>

      {/* Management Alerts Section */}
      {alerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-amber-800 font-bold text-xs">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            هشدارهای مدیریتی سیستم (صرفاً اطلاع‌رسانی):
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {alerts.map((alt, idx) => (
              <div key={idx} className={`p-2.5 rounded-xl text-xs flex items-center gap-2 border ${
                alt.type === 'danger' ? 'bg-rose-50 border-rose-200 text-rose-800' :
                alt.type === 'warning' ? 'bg-amber-100/60 border-amber-300 text-amber-900' :
                'bg-blue-50 border-blue-200 text-blue-900'
              }`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-current"></span>
                <span>{alt.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Debt Aging Analysis (Aging Report - Read Only) */}
      <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
          <FileText className="w-4 h-4 text-teal-600" />
          گزارش تحلیل سنی بدهی (Debt Aging Analysis) - مجموع کل سبد نمایندگان
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div className="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
            <div className="text-zinc-500 mb-1">بدهی جاری (Current)</div>
            <div className="text-base font-black font-mono text-emerald-700">{Math.round(agingSummary.current).toLocaleString('fa-IR')} ریال</div>
          </div>
          <div className="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
            <div className="text-zinc-500 mb-1">تاخیر ۱ تا ۳۰ روز</div>
            <div className="text-base font-black font-mono text-teal-700">{Math.round(agingSummary.d1_30).toLocaleString('fa-IR')} ریال</div>
          </div>
          <div className="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
            <div className="text-zinc-500 mb-1">تاخیر ۳۱ تا ۶۰ روز</div>
            <div className="text-base font-black font-mono text-amber-700">{Math.round(agingSummary.d31_60).toLocaleString('fa-IR')} ریال</div>
          </div>
          <div className="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200">
            <div className="text-zinc-500 mb-1">تاخیر بیش از ۶۰ روز</div>
            <div className="text-base font-black font-mono text-rose-700">{Math.round(agingSummary.d_over60).toLocaleString('fa-IR')} ریال</div>
          </div>
        </div>
      </div>

      {/* Control Bar & Filters */}
      <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-3" />
          <input
            type="text"
            placeholder="جستجو در مرکز کنترل نسیه..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-50 border border-zinc-200 text-xs text-zinc-800 pr-9 pl-3 py-2.5 rounded-xl focus:outline-none focus:border-teal-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <Filter className="w-4 h-4 text-zinc-400 shrink-0" />
          <select
            value={controlFilter}
            onChange={e => setControlFilter(e.target.value)}
            className="bg-zinc-50 border border-zinc-200 text-xs text-zinc-800 px-3 py-2.5 rounded-xl focus:outline-none focus:border-teal-500 w-full md:w-auto cursor-pointer font-medium"
          >
            <option value="all">همه نمایندگان فروش</option>
            <option value="active">فقط نمایندگان فعال</option>
            <option value="debtors">فقط بدهکاران</option>
            <option value="near_limit">فقط نزدیک سقف اعتبار</option>
            <option value="pending_payments">فقط دارای پرداخت تایید نشده</option>
            <option value="open_orders">فقط دارای سفارش باز</option>
          </select>
        </div>
      </div>

      {/* Partners Analysis Table */}
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-teal-600" />
            جدول تحلیل جامع نمایندگان فروش ({filteredPartners.length})
          </h3>
        </div>

        {filteredPartners.length === 0 ? (
          <div className="text-center py-12 text-zinc-400 text-xs">
            هیچ موردی مطابق فیلترهای انتخاب شده یافت نشد.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-zinc-50/80 border-b border-zinc-200 text-zinc-500 font-semibold">
                  <th className="py-3 px-3">نماینده / کد</th>
                  <th className="py-3 px-3">فروشگاه</th>
                  <th className="py-3 px-3">وضعیت</th>
                  <th className="py-3 px-3">سقف خرید</th>
                  <th className="py-3 px-3">استفاده شده</th>
                  <th className="py-3 px-3">مانده سفارش</th>
                  <th className="py-3 px-3">بدهی قطعی</th>
                  <th className="py-3 px-3">قدیمی‌ترین بدهی</th>
                  <th className="py-3 px-3 text-center">سفارش باز</th>
                  <th className="py-3 px-3 text-center">پرداخت معلق</th>
                  <th className="py-3 px-3 text-center">جزئیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredPartners.map(item => {
                  const { partner, checkResult, partnerName, storeName, code, activeOrdersCount, pendingPaymentsCount, oldestDate } = item;
                  return (
                    <tr key={partner.id} className="hover:bg-teal-50/30 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-bold text-zinc-800">{partnerName}</div>
                        <div className="text-[10px] text-teal-600 font-mono font-semibold">{code}</div>
                      </td>

                      <td className="py-3 px-3 text-zinc-600 font-medium">{storeName}</td>

                      <td className="py-3 px-3">
                        {checkResult.status === 'HEALTHY' && (
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-extrabold px-2 py-0.5 rounded-lg inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> سالم
                          </span>
                        )}
                        {checkResult.status === 'NEAR_LIMIT' && (
                          <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-extrabold px-2 py-0.5 rounded-lg inline-flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-amber-600" /> نزدیک سقف
                          </span>
                        )}
                        {checkResult.status === 'OVERDUE' && (
                          <span className="bg-orange-50 text-orange-700 border border-orange-200 text-[10px] font-extrabold px-2 py-0.5 rounded-lg inline-flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3 text-orange-600" /> تاخیر
                          </span>
                        )}
                        {checkResult.status === 'SUSPENDED' && (
                          <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-extrabold px-2 py-0.5 rounded-lg inline-flex items-center gap-1">
                            <Ban className="w-3 h-3 text-rose-600" /> متوقف
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 font-mono font-bold text-teal-700">
                        {checkResult.creditLimit.toLocaleString('fa-IR')}
                      </td>

                      <td className="py-3 px-3 font-mono font-bold text-zinc-700">
                        {checkResult.usedCredit.toLocaleString('fa-IR')}
                      </td>

                      <td className="py-3 px-3 font-mono font-bold text-emerald-600">
                        {checkResult.remainingLimit.toLocaleString('fa-IR')}
                      </td>

                      <td className="py-3 px-3 font-mono font-bold text-amber-600">
                        {checkResult.netDebt.toLocaleString('fa-IR')}
                      </td>

                      <td className="py-3 px-3 font-mono text-zinc-500 text-[11px]">
                        {oldestDate}
                      </td>

                      <td className="py-3 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-bold ${activeOrdersCount > 0 ? 'bg-teal-100 text-teal-800' : 'bg-zinc-100 text-zinc-500'}`}>
                          {activeOrdersCount}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-bold ${pendingPaymentsCount > 0 ? 'bg-indigo-100 text-indigo-800' : 'bg-zinc-100 text-zinc-500'}`}>
                          {pendingPaymentsCount}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={() => setSelectedPartnerDetail(item)}
                          className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          جزئیات
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Partner Detail View Modal */}
      {selectedPartnerDetail && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-zinc-200 text-right space-y-6 max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                  <Users className="w-4 h-4 text-teal-600" />
                  پرونده و گزارش مدیریتی نماینده: {selectedPartnerDetail.partnerName}
                </h3>
                <span className="text-[10px] text-zinc-400 font-mono">کد نمایندگی: {selectedPartnerDetail.code} | فروشگاه: {selectedPartnerDetail.storeName}</span>
              </div>
              <button
                onClick={() => setSelectedPartnerDetail(null)}
                className="text-zinc-400 hover:text-zinc-600 text-xs cursor-pointer font-bold"
              >
                بستن ×
              </button>
            </div>

            {/* A) Contract Summary */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-zinc-700 border-b border-zinc-100 pb-1">الف) خلاصه قرارداد و تنظیمات اعتباری</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                  <span className="text-zinc-400 block text-[10px]">سقف خرید نسیه:</span>
                  <span className="font-mono font-bold text-teal-700 text-sm">{selectedPartnerDetail.checkResult.creditLimit.toLocaleString('fa-IR')} ریال</span>
                </div>
                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                  <span className="text-zinc-400 block text-[10px]">مهلت تسویه:</span>
                  <span className="font-mono font-bold text-zinc-800 text-sm">{selectedPartnerDetail.checkResult.paymentTermDays} روز</span>
                </div>
                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                  <span className="text-zinc-400 block text-[10px]">جریمه تاخیر ماهانه:</span>
                  <span className="font-mono font-bold text-amber-600 text-sm">{selectedPartnerDetail.checkResult.lateFeePercentage}٪</span>
                </div>
                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                  <span className="text-zinc-400 block text-[10px]">وضعیت خرید:</span>
                  <span className={`font-bold text-xs ${selectedPartnerDetail.checkResult.isPurchaseAllowed ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {selectedPartnerDetail.checkResult.isPurchaseAllowed ? 'مجاز به خرید' : 'متوقف شده'}
                  </span>
                </div>
              </div>
            </div>

            {/* B) Order Flow */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-zinc-700 border-b border-zinc-100 pb-1">ب) گردش سفارش‌های خرید نسیه ({selectedPartnerDetail.partnerOrders.length})</h4>
              {selectedPartnerDetail.partnerOrders.length === 0 ? (
                <div className="text-xs text-zinc-400 py-2">هیچ سفارشی ثبت نشده است.</div>
              ) : (
                <div className="max-h-40 overflow-y-auto border border-zinc-200 rounded-xl">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="bg-zinc-50 text-zinc-500 font-semibold border-b border-zinc-200">
                        <th className="py-2 px-3">شماره سفارش</th>
                        <th className="py-2 px-3">تاریخ</th>
                        <th className="py-2 px-3">مبلغ کل (ریال)</th>
                        <th className="py-2 px-3">وضعیت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 font-mono">
                      {selectedPartnerDetail.partnerOrders.map((o: any) => (
                        <tr key={o.id} className="hover:bg-zinc-50">
                          <td className="py-2 px-3 font-bold text-teal-700">{o.orderNumber}</td>
                          <td className="py-2 px-3 text-zinc-600">{o.orderDate}</td>
                          <td className="py-2 px-3 font-bold text-zinc-800">{o.totalAmount?.toLocaleString('fa-IR')}</td>
                          <td className="py-2 px-3 font-sans text-xs">
                            <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 font-bold">{o.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* C) Payment Flow */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-zinc-700 border-b border-zinc-100 pb-1">ج) گردش پرداخت‌ها و اعلام‌های واریز ({selectedPartnerDetail.partnerDeclarations.length})</h4>
              {selectedPartnerDetail.partnerDeclarations.length === 0 ? (
                <div className="text-xs text-zinc-400 py-2">هیچ اعلام پرداختی ثبت نشده است.</div>
              ) : (
                <div className="max-h-40 overflow-y-auto border border-zinc-200 rounded-xl">
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="bg-zinc-50 text-zinc-500 font-semibold border-b border-zinc-200">
                        <th className="py-2 px-3">شماره اعلام</th>
                        <th className="py-2 px-3">روش پرداخت</th>
                        <th className="py-2 px-3">مبلغ (ریال)</th>
                        <th className="py-2 px-3">تاریخ</th>
                        <th className="py-2 px-3">وضعیت بررسی</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 font-mono">
                      {selectedPartnerDetail.partnerDeclarations.map((d: any) => (
                        <tr key={d.id} className="hover:bg-zinc-50">
                          <td className="py-2 px-3 font-bold text-indigo-700">{d.declarationNumber}</td>
                          <td className="py-2 px-3 font-sans">{d.paymentType}</td>
                          <td className="py-2 px-3 font-bold text-zinc-800">{d.amount?.toLocaleString('fa-IR')}</td>
                          <td className="py-2 px-3 text-zinc-600">{d.paymentDate}</td>
                          <td className="py-2 px-3 font-sans">
                            <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              d.status === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' :
                              d.status === 'PENDING' ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-700'
                            }`}>{d.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* D) Account Status */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-zinc-700 border-b border-zinc-100 pb-1">د) وضعیت حسابداری و تراز</h4>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                  <span className="text-zinc-400 block text-[10px]">بدهی قطعی:</span>
                  <span className="font-mono font-bold text-amber-600 text-sm">{selectedPartnerDetail.checkResult.netDebt.toLocaleString('fa-IR')} ریال</span>
                </div>
                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                  <span className="text-zinc-400 block text-[10px]">مجموع پرداخت‌های تایید شده:</span>
                  <span className="font-mono font-bold text-emerald-600 text-sm">{selectedPartnerDetail.verifiedPaymentsSum.toLocaleString('fa-IR')} ریال</span>
                </div>
                <div className="bg-zinc-50 p-3 rounded-xl border border-zinc-200">
                  <span className="text-zinc-400 block text-[10px]">اعتبار باقی‌مانده قابل سفارش:</span>
                  <span className="font-mono font-bold text-teal-600 text-sm">{selectedPartnerDetail.checkResult.remainingLimit.toLocaleString('fa-IR')} ریال</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-zinc-100">
              <button
                onClick={() => setSelectedPartnerDetail(null)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-900 text-white font-bold cursor-pointer text-xs"
              >
                بستن پنجره جزئیات
              </button>
            </div>

          </div>
        </div>
      )}
        </>
      )}

    </div>
  );
}

export default NesyehControlCenterView;
