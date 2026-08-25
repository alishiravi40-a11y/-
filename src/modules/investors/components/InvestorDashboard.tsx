/**
 * Investor Executive Dashboard
 * (داشبورد مدیریتی و شاخص‌های کلیدی سرمایه‌گذاران)
 */

import React from 'react';
import {
  Users,
  Coins,
  TrendingUp,
  Clock,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  PieChart,
  FileText,
  DollarSign,
} from 'lucide-react';
import {
  InvestorContract,
  InvestorPaymentObligation,
} from '../types';
import { Person } from '../../../types';
import { InvestorSettlementEngine } from '../investorSettlementEngine';
import { getCurrentJalaliDate } from '../../../utils/jalali';

interface InvestorDashboardProps {
  contracts: InvestorContract[];
  persons: Person[];
  obligations: InvestorPaymentObligation[];
  onSelectTab: (tab: 'contracts' | 'payments' | 'reports') => void;
  onSelectContract?: (contractId: string) => void;
}

export const InvestorDashboard: React.FC<InvestorDashboardProps> = ({
  contracts,
  persons,
  obligations,
  onSelectTab,
  onSelectContract,
}) => {
  const currentDate = getCurrentJalaliDate();

  // Active contracts and investors
  const activeContracts = contracts.filter((c) => c.status === 'active');
  const uniqueActiveInvestorIds = new Set(activeContracts.map((c) => c.investorPersonId));

  const totalAbsorbedCapital = contracts.reduce((sum, c) => sum + c.initialCapital, 0);
  const totalCurrentCapital = activeContracts.reduce((sum, c) => sum + c.currentCapital, 0);

  // Obligation metrics
  const dailyTask = InvestorSettlementEngine.generateDailySettlementTaskList(obligations, currentDate);

  const totalFutureFeeObligations = obligations
    .filter((o) => (o.status === 'PLANNED' || o.status === 'DUE') && o.obligationType === 'FEE')
    .reduce((sum, o) => sum + o.amount, 0);

  const paidFeeObligations = obligations
    .filter((o) => o.status === 'PAID' && o.obligationType === 'FEE')
    .reduce((sum, o) => sum + o.amount, 0);

  // Contracts ending soon (within 30 days)
  const endingSoonContracts = activeContracts.filter((c) => {
    if (!c.endDate) return false;
    return c.endDate >= currentDate && c.endDate <= '1405/12/29'; // example logic
  });

  return (
    <div className="space-y-6">
      {/* Top Banner & Title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-emerald-900/40 via-teal-900/30 to-slate-900/60 p-6 rounded-2xl border border-emerald-500/20 shadow-lg">
        <div>
          <h2 className="text-2xl font-bold text-emerald-300 flex items-center gap-3">
            <Coins className="w-8 h-8 text-emerald-400" />
            داشبورد مدیریتی سرمایه‌گذاران و مشارکت‌ها
          </h2>
          <p className="text-slate-300 text-sm mt-1">
            خلاصه وضعیت سرمایه‌های جذب‌شده، تعهدات پرداختی، سررسیدها و تحلیل عملکرد
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectTab('payments')}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-all shadow-md flex items-center gap-2 text-sm"
          >
            <Clock className="w-4 h-4" />
            مرکز تسویه سررسیدها ({dailyTask.dueTodayItems.length + dailyTask.overdueItems.length})
          </button>
          <button
            onClick={() => onSelectTab('contracts')}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl border border-slate-600 transition-all text-sm flex items-center gap-2"
          >
            <FileText className="w-4 h-4" />
            لیست قراردادها
          </button>
        </div>
      </div>

      {/* Primary Executive KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Investors & Capital */}
        <div className="bg-slate-800/80 border border-slate-700 p-5 rounded-2xl shadow-sm hover:border-emerald-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">سرمایه‌گذاران فعال</span>
            <Users className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-2xl font-extrabold text-white">
            {uniqueActiveInvestorIds.size}{' '}
            <span className="text-sm font-normal text-slate-400">شخص</span>
          </div>
          <div className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
            <span>تعداد کل قراردادهای فعال: {activeContracts.length}</span>
          </div>
        </div>

        {/* Total Absorbed vs Current Capital */}
        <div className="bg-slate-800/80 border border-slate-700 p-5 rounded-2xl shadow-sm hover:border-emerald-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">سرمایه فعلی موجود</span>
            <Coins className="w-5 h-5 text-teal-400" />
          </div>
          <div className="text-2xl font-extrabold text-white">
            {totalCurrentCapital.toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-400">ریال</span>
          </div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1">
            <span>سرمایه اولیه اولیه: {totalAbsorbedCapital.toLocaleString()} ریال</span>
          </div>
        </div>

        {/* Future Fee Obligations */}
        <div className="bg-slate-800/80 border border-slate-700 p-5 rounded-2xl shadow-sm hover:border-emerald-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">تعهدات آتی کارمزد</span>
            <TrendingUp className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="text-2xl font-extrabold text-white">
            {totalFutureFeeObligations.toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-400">ریال</span>
          </div>
          <div className="text-xs text-slate-400 mt-2 flex items-center gap-1">
            <span>کارمزدهای پرداخت‌شده: {paidFeeObligations.toLocaleString()} ریال</span>
          </div>
        </div>

        {/* Due Today & Overdue */}
        <div className="bg-slate-800/80 border border-slate-700 p-5 rounded-2xl shadow-sm hover:border-amber-500/40 transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">پرداخت‌های سررسید و معوق</span>
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-2xl font-extrabold text-amber-300">
            {(dailyTask.totalDueTodayAmount + dailyTask.totalOverdueAmount).toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-400">ریال</span>
          </div>
          <div className="text-xs text-amber-400/90 mt-2 flex items-center gap-2">
            <span>سررسید امروز: {dailyTask.dueTodayItems.length} مورد</span>
            <span>•</span>
            <span className="text-rose-400">عقب‌افتاده: {dailyTask.overdueItems.length} مورد</span>
          </div>
        </div>
      </div>

      {/* Secondary Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Today & Overdue Task Board */}
        <div className="lg:col-span-2 bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-700 pb-3">
            <h3 className="font-bold text-slate-200 flex items-center gap-2 text-base">
              <Clock className="w-5 h-5 text-amber-400" />
              هشدار سررسیدها و اقدامات فوری تسویه
            </h3>
            <button
              onClick={() => onSelectTab('payments')}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
            >
              مشاهده مرکز تسویه کامل ←
            </button>
          </div>

          {dailyTask.overdueItems.length === 0 && dailyTask.dueTodayItems.length === 0 ? (
            <div className="py-8 text-center bg-slate-900/40 rounded-xl border border-dashed border-slate-700 text-slate-400 text-sm flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              هیچ پرداخت عقب‌افتاده یا سررسید امروزی وجود ندارد. تمام تعهدات به‌روز هستند.
            </div>
          ) : (
            <div className="space-y-3">
              {dailyTask.overdueItems.map((item) => {
                const investorPerson = persons.find((p) => p.id === item.investorPersonId);
                const contract = contracts.find((c) => c.id === item.contractId);
                return (
                  <div
                    key={item.id}
                    className="p-3.5 bg-rose-950/20 border border-rose-500/30 rounded-xl flex items-center justify-between text-sm hover:border-rose-500/60 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                      <div>
                        <div className="font-bold text-slate-100">
                          {investorPerson?.name || 'سرمایه‌گذار'} (قرارداد {contract?.contractNumber || item.contractId})
                        </div>
                        <div className="text-xs text-rose-300/80 mt-0.5">
                          تاریخ سررسید: {item.dueDate} (عقب‌افتاده)
                        </div>
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="font-extrabold text-rose-300">
                        {item.amount.toLocaleString()} ریال
                      </div>
                      <span className="text-[11px] px-2 py-0.5 bg-rose-900/50 text-rose-300 rounded-md border border-rose-700/50">
                        عقب‌افتاده
                      </span>
                    </div>
                  </div>
                );
              })}

              {dailyTask.dueTodayItems.map((item) => {
                const investorPerson = persons.find((p) => p.id === item.investorPersonId);
                const contract = contracts.find((c) => c.id === item.contractId);
                return (
                  <div
                    key={item.id}
                    className="p-3.5 bg-amber-950/20 border border-amber-500/30 rounded-xl flex items-center justify-between text-sm hover:border-amber-500/60 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                      <div>
                        <div className="font-bold text-slate-100">
                          {investorPerson?.name || 'سرمایه‌گذار'} (قرارداد {contract?.contractNumber || item.contractId})
                        </div>
                        <div className="text-xs text-amber-300/80 mt-0.5">
                          سررسید امروز: {item.dueDate}
                        </div>
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="font-extrabold text-amber-300">
                        {item.amount.toLocaleString()} ریال
                      </div>
                      <span className="text-[11px] px-2 py-0.5 bg-amber-900/50 text-amber-300 rounded-md border border-amber-700/50">
                        سررسید امروز
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Analytical Summary Panel */}
        <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-5 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-200 border-b border-slate-700 pb-3 flex items-center gap-2 text-base">
            <PieChart className="w-5 h-5 text-emerald-400" />
            تحلیل توزیع دوره پرداختی
          </h3>

          <div className="space-y-3">
            {[
              { label: 'ماهانه (Monthly)', freq: 'monthly' },
              { label: 'دو ماهه (Bi-Monthly)', freq: 'bimonthly' },
              { label: 'سه ماهه (Quarterly)', freq: 'quarterly' },
              { label: 'شش ماهه (Semi-Annual)', freq: 'semi_annual' },
              { label: 'سالانه (Annual)', freq: 'annual' },
            ].map((f) => {
              const count = activeContracts.filter((c) => c.paymentFrequency === f.freq).length;
              const percent = activeContracts.length > 0 ? Math.round((count / activeContracts.length) * 100) : 0;
              return (
                <div key={f.freq} className="space-y-1">
                  <div className="flex justify-between text-xs text-slate-300 font-medium">
                    <span>{f.label}</span>
                    <span className="text-emerald-400">{count} قرارداد ({percent}٪)</span>
                  </div>
                  <div className="w-full bg-slate-700/60 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-700/60 text-xs text-slate-400 space-y-2">
            <div className="flex justify-between">
              <span>قراردادهای نزدیک پایان (۳۰ روز):</span>
              <span className="text-amber-400 font-bold">{endingSoonContracts.length} مورد</span>
            </div>
            <div className="flex justify-between">
              <span>نرخ کارمزد متوسط ماهانه:</span>
              <span className="text-teal-300 font-bold">
                {activeContracts.length > 0
                  ? (activeContracts.reduce((s, c) => s + c.monthlyFeeRate, 0) / activeContracts.length).toFixed(2)
                  : 0}
                ٪
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
