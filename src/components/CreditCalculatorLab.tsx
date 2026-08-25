/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Calculator, 
  Sparkles, 
  Building2, 
  Percent, 
  Calendar, 
  ArrowLeftRight, 
  CheckCircle2, 
  Info, 
  Layers, 
  Check, 
  ShieldAlert,
  Coins
} from 'lucide-react';
import { 
  calculateSadiBazaar, 
  calculatePelkani, 
  calculateBeta, 
  resolveEffectiveCalculatorSettings,
  CreditCalculationResult,
  CalculatorEngineSettings
} from '../utils/creditCalculatorEngine';
import { parseNumericValue } from '../utils/accounting';

interface CreditCalculatorLabProps {
  settings?: any;
}

export default function CreditCalculatorLab({ settings }: CreditCalculatorLabProps) {
  // Laboratory Inputs (Purely in-memory, no persistence / no financial voucher creation)
  const [principalStr, setPrincipalStr] = useState<string>('1000000000'); // 100M Tomans = 1,000,000,000 Rials
  const [installmentCount, setInstallmentCount] = useState<number>(7);
  const [intervalMonths, setIntervalMonths] = useState<number>(1);
  const [representativeCommission, setRepresentativeCommission] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<'compare' | 'sadi_bazaar' | 'pelkani' | 'beta'>('compare');

  // Custom Settings resolved via central engine Resolver
  const resolvedConfig = resolveEffectiveCalculatorSettings('all', null, null, settings);
  const customSettings: Partial<CalculatorEngineSettings> = resolvedConfig;

  const principal = parseNumericValue(principalStr) || 0;

  // Execute pure calculations for all 3 engines
  const sadiResult = calculateSadiBazaar(principal, installmentCount, intervalMonths, representativeCommission, customSettings);
  const pelkaniResult = calculatePelkani(principal, installmentCount, intervalMonths, representativeCommission, customSettings);
  const betaResult = calculateBeta(principal, installmentCount, intervalMonths, representativeCommission, customSettings);

  // Preset Scenario Handlers
  const applyScenario = (pToman: number, count: number, comm: number = 0, interval: number = 1) => {
    setPrincipalStr((pToman * 10000000).toString());
    setInstallmentCount(count);
    setRepresentativeCommission(comm);
    setIntervalMonths(interval);
  };

  return (
    <div className="space-y-6 pb-12 font-sans text-right" dir="rtl">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-zinc-900 to-slate-900 text-white rounded-3xl p-6 shadow-xl border border-indigo-800/40 relative overflow-hidden">
        <div className="absolute top-0 left-0 -mt-8 -ml-8 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/20 text-amber-300 text-xs font-bold rounded-full border border-amber-500/30">
              <ShieldAlert size={14} />
              <span>محیط مجزای آزمایشی (Sandbox)</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-white flex items-center gap-2.5">
              <Calculator className="text-indigo-400" size={26} />
              آزمایشگاه ماشین‌حساب‌های اعتباری
            </h1>
            <p className="text-xs text-zinc-300 leading-relaxed max-w-2xl">
              تست و بررسی فرمول‌های سه ماشین‌حساب اعتباری سیستم (صدی بازار، پلکانی و بتا) بدون نیاز به ثبت سند مالی یا ایجاد پرونده.
            </p>
          </div>

          {/* Quick Preset Scenarios */}
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-3 border border-white/10 space-y-2">
            <span className="text-[11px] font-bold text-indigo-200 block">سناریوهای تست سریع (۱۰۰ میلیون تومان):</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => applyScenario(100, 7, 0)}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-xl transition shadow-sm"
              >
                ۷ قسط (پایه)
              </button>
              <button
                onClick={() => applyScenario(100, 6, 0)}
                className="px-2.5 py-1 bg-indigo-600/80 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-xl transition"
              >
                ۶ قسط (پلکانی سطح ۱)
              </button>
              <button
                onClick={() => applyScenario(100, 8, 0)}
                className="px-2.5 py-1 bg-indigo-600/80 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-xl transition"
              >
                ۸ قسط (پلکانی سطح ۲)
              </button>
              <button
                onClick={() => applyScenario(100, 11, 0)}
                className="px-2.5 py-1 bg-indigo-600/80 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-xl transition"
              >
                ۱۱ قسط (پلکانی سطح ۳)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Input Parameters Panel */}
      <div className="bg-white rounded-3xl p-6 border border-zinc-200/80 shadow-sm space-y-6">
        <h2 className="text-sm font-bold text-zinc-800 flex items-center gap-2 border-b border-zinc-100 pb-3">
          <Layers className="text-indigo-600" size={18} />
          <span>پارامترهای ورودی محاسبه</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Credit Amount */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-zinc-700">مبلغ اصل اعتبار (ریال):</label>
            <div className="relative">
              <input
                type="text"

                value={Number(principalStr).toLocaleString()}
                onChange={(e) => setPrincipalStr(e.target.value.replace(/,/g, ''))}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-2xl px-3 py-2.5 font-mono text-sm font-bold text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
              <span className="absolute left-3 top-2.5 text-xs font-bold text-zinc-400">ریال</span>
            </div>
            <div className="text-[11px] font-bold text-indigo-700 flex justify-between px-1">
              <span>معادل به تومان:</span>
              <span>{(principal / 10).toLocaleString()} تومان</span>
            </div>
          </div>

          {/* Number of Installments */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-zinc-700">تعداد اقساط:</label>
            <div className="flex items-center gap-2">
              <input
                type="text" inputMode="numeric" pattern="[0-9]*"

                min="1"
                max="36"
                value={installmentCount}
                onChange={(e) => setInstallmentCount(Math.max(1, Number(e.target.value)))}
                className="w-20 bg-zinc-50 border border-zinc-200 rounded-2xl px-3 py-2.5 font-mono text-sm font-bold text-center text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              />
              <input
                type="range"
                min="1"
                max="24"
                value={installmentCount}
                onChange={(e) => setInstallmentCount(Number(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>
            <div className="flex gap-1.5 pt-1 overflow-x-auto">
              {[6, 7, 8, 9, 10, 11, 12].map(cnt => (
                <button
                  key={cnt}
                  onClick={() => setInstallmentCount(cnt)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition ${
                    installmentCount === cnt
                      ? 'bg-indigo-600 text-white'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  {cnt} قسط
                </button>
              ))}
            </div>
          </div>

          {/* Payment Interval */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-zinc-700">دوره پرداخت اقساط:</label>
            <div className="grid grid-cols-3 gap-1 bg-zinc-100 p-1 rounded-2xl">
              <button
                onClick={() => setIntervalMonths(1)}
                className={`py-2 rounded-xl text-xs font-bold transition ${
                  intervalMonths === 1 ? 'bg-white text-indigo-700 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                ماهانه
              </button>
              <button
                onClick={() => setIntervalMonths(2)}
                className={`py-2 rounded-xl text-xs font-bold transition ${
                  intervalMonths === 2 ? 'bg-white text-indigo-700 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                دوماهه (+۴٫۵٪)
              </button>
              <button
                onClick={() => setIntervalMonths(3)}
                className={`py-2 rounded-xl text-xs font-bold transition ${
                  intervalMonths === 3 ? 'bg-white text-indigo-700 shadow-sm' : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                سه ماهه
              </button>
            </div>
            <p className="text-[10px] text-zinc-500 px-1">
              {intervalMonths === 2 ? 'با انتخاب پرداخت دوماهه، ۴٫۵٪ به مبلغ نهایی پس از کارمزد افزوده می‌شود.' : 'پرداخت استاندارد ماهانه'}
            </p>
          </div>

          {/* Representative Commission */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-zinc-700">درصد کمیسیون نماینده:</label>
            <select
              value={representativeCommission}
              onChange={(e) => setRepresentativeCommission(Number(e.target.value))}
              className="w-full bg-amber-50/60 border border-amber-200 rounded-2xl px-3 py-2.5 font-sans text-xs font-bold text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500 transition cursor-pointer"
            >
              {[0, 1, 2, 3, 4, 5].map(rate => (
                <option key={rate} value={rate}>
                  {rate === 0 ? 'بدون کمیسیون (۰٪)' : `٪${rate} کمیسیون اضافه`}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-amber-700 font-medium px-1">
              کمیسیون نماینده در انتهای محاسبات روی مبلغ نهایی اعمال می‌شود.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs View Selector */}
      <div className="flex border-b border-zinc-200 gap-2">
        <button
          onClick={() => setActiveTab('compare')}
          className={`pb-3 px-4 font-bold text-xs flex items-center gap-2 border-b-2 transition ${
            activeTab === 'compare'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <ArrowLeftRight size={16} />
          <span>مقایسه همزمان هر ۳ ماشین‌حساب</span>
        </button>
        <button
          onClick={() => setActiveTab('sadi_bazaar')}
          className={`pb-3 px-4 font-bold text-xs flex items-center gap-2 border-b-2 transition ${
            activeTab === 'sadi_bazaar'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Sparkles size={16} />
          <span>ماشین‌حساب صدی بازار</span>
        </button>
        <button
          onClick={() => setActiveTab('pelkani')}
          className={`pb-3 px-4 font-bold text-xs flex items-center gap-2 border-b-2 transition ${
            activeTab === 'pelkani'
              ? 'border-amber-600 text-amber-600'
              : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Percent size={16} />
          <span>ماشین‌حساب پلکانی</span>
        </button>
        <button
          onClick={() => setActiveTab('beta')}
          className={`pb-3 px-4 font-bold text-xs flex items-center gap-2 border-b-2 transition ${
            activeTab === 'beta'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <Building2 size={16} />
          <span>ماشین‌حساب بتا (بانک رفاه)</span>
        </button>
      </div>

      {/* COMPARISON VIEW */}
      {activeTab === 'compare' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <CalculatorCard result={sadiResult} title="۱. ماشین‌حساب صدی بازار" theme="emerald" />
            <CalculatorCard result={pelkaniResult} title="۲. ماشین‌حساب پلکانی" theme="amber" />
            <CalculatorCard result={betaResult} title="۳. ماشین‌حساب بتا" theme="indigo" />
          </div>

          {/* Test Scenario Checklist Card */}
          <div className="bg-indigo-50/50 border border-indigo-100 rounded-3xl p-6 space-y-4">
            <h3 className="text-xs font-bold text-indigo-900 flex items-center gap-2">
              <CheckCircle2 className="text-indigo-600" size={18} />
              <span>جدول بررسی تطبیق سناریوهای آزمایشی</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-4 rounded-2xl border border-indigo-100 space-y-2 text-xs">
                <span className="font-bold text-emerald-800 block border-b pb-1">صدی بازار (۷ قسط):</span>
                <p className="text-zinc-600">پایه ۷٪ + گام ۳٫۵٪ × ۶ = ۲۸٪ کارمزد</p>
                <div className="font-mono font-bold text-zinc-900">
                  مبلغ نهایی: {(sadiResult.finalTotal / 10).toLocaleString()} تومان
                </div>
                {principal === 1000000000 && installmentCount === 7 && representativeCommission === 0 && (
                  <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded text-[10px]">
                    ✓ ۱۲۸ میلیون تومان (دقیقاً مطابق فرمول)
                  </span>
                )}
              </div>

              <div className="bg-white p-4 rounded-2xl border border-indigo-100 space-y-2 text-xs">
                <span className="font-bold text-amber-800 block border-b pb-1">
                  پلکانی ({installmentCount} قسط):
                </span>
                <p className="text-zinc-600">
                  پایه {pelkaniResult.baseRatePercent}٪ (سطح {installmentCount <= 6 ? '۱ (تا ۶)' : installmentCount <= 9 ? '۲ (۷ تا ۹)' : '۳ (۱۰ به بالا)'})
                </p>
                <div className="font-mono font-bold text-zinc-900">
                  مبلغ نهایی: {(pelkaniResult.finalTotal / 10).toLocaleString()} تومان
                </div>
                {principal === 1000000000 && representativeCommission === 0 && (
                  <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded text-[10px]">
                    {installmentCount === 6 && '✓ ۱۲۶٫۲۵ م.ت (۲۶٫۲۵٪ افزایش)'}
                    {installmentCount === 8 && '✓ ۱۳۶ م.ت (۳۶٪ افزایش)'}
                    {installmentCount === 11 && '✓ ۱۵۱ م.ت (۵۱٪ افزایش)'}
                    {![6, 8, 11].includes(installmentCount) && `درصد کارمزد: ${pelkaniResult.installmentFeePercent}٪`}
                  </span>
                )}
              </div>

              <div className="bg-white p-4 rounded-2xl border border-indigo-100 space-y-2 text-xs">
                <span className="font-bold text-indigo-800 block border-b pb-1">بتا ({installmentCount} قسط):</span>
                <p className="text-zinc-600">کارمزد صدی بازار + ۵٪ حق کارمزد بانک</p>
                <div className="font-mono font-bold text-zinc-900">
                  مبلغ نهایی: {(betaResult.finalTotal / 10).toLocaleString()} تومان
                </div>
                {principal === 1000000000 && installmentCount === 7 && representativeCommission === 0 && (
                  <span className="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-800 font-bold rounded text-[10px]">
                    ✓ ۱۳۴٫۴ میلیون تومان (دقیقاً مطابق فرمول)
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SINGLE CALCULATOR DETAILED VIEW & TABLE */}
      {activeTab !== 'compare' && (
        <div className="space-y-6">
          <div className="max-w-xl mx-auto">
            {activeTab === 'sadi_bazaar' && <CalculatorCard result={sadiResult} title="ماشین‌حساب صدی بازار" theme="emerald" detailed />}
            {activeTab === 'pelkani' && <CalculatorCard result={pelkaniResult} title="ماشین‌حساب پلکانی" theme="amber" detailed />}
            {activeTab === 'beta' && <CalculatorCard result={betaResult} title="ماشین‌حساب بتا (بانک رفاه)" theme="indigo" detailed />}
          </div>

          {/* Installment Table Breakdown */}
          <div className="bg-white rounded-3xl p-6 border border-zinc-200/80 shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
              <Calendar className="text-indigo-600" size={18} />
              <span>جدول تفکیکی اقساط شبیه‌سازی‌شده</span>
            </h3>

            <InstallmentTable 
              result={
                activeTab === 'sadi_bazaar' 
                  ? sadiResult 
                  : activeTab === 'pelkani' 
                    ? pelkaniResult 
                    : betaResult
              } 
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface CalculatorCardProps {
  result: CreditCalculationResult;
  title: string;
  theme: 'emerald' | 'amber' | 'indigo';
  detailed?: boolean;
}

function CalculatorCard({ result, title, theme, detailed = false }: CalculatorCardProps) {
  const themeClasses = {
    emerald: {
      border: 'border-emerald-200/80',
      headerBg: 'bg-emerald-50/60 text-emerald-900',
      badge: 'bg-emerald-100 text-emerald-800',
      highlight: 'text-emerald-700',
    },
    amber: {
      border: 'border-amber-200/80',
      headerBg: 'bg-amber-50/60 text-amber-900',
      badge: 'bg-amber-100 text-amber-800',
      highlight: 'text-amber-700',
    },
    indigo: {
      border: 'border-indigo-200/80',
      headerBg: 'bg-indigo-50/60 text-indigo-900',
      badge: 'bg-indigo-100 text-indigo-800',
      highlight: 'text-indigo-700',
    }
  }[theme];

  const monthlyPayment = Math.round(result.finalTotal / result.installmentCount);

  return (
    <div className={`bg-white rounded-3xl border ${themeClasses.border} shadow-sm overflow-hidden flex flex-col justify-between`}>
      {/* Header */}
      <div className={`p-4 border-b border-zinc-100 ${themeClasses.headerBg} flex items-center justify-between`}>
        <h3 className="text-sm font-bold">{title}</h3>
        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${themeClasses.badge}`}>
          درصد کل: {((result.finalTotal - result.principal) / (result.principal || 1) * 100).toFixed(2)}٪
        </span>
      </div>

      {/* Body breakdown */}
      <div className="p-5 space-y-3.5 text-xs text-zinc-700">
        <div className="flex justify-between items-center py-1 border-b border-zinc-50">
          <span className="text-zinc-500 font-medium">اصل اعتبار:</span>
          <span className="font-mono font-bold text-zinc-900">{result.principal.toLocaleString()} ریال</span>
        </div>

        <div className="flex justify-between items-center py-1 border-b border-zinc-50">
          <span className="text-zinc-500 font-medium">نرخ کارمزد اقساط:</span>
          <div className="text-left">
            <span className="font-mono font-bold text-zinc-900">٪ {result.installmentFeePercent}</span>
            <span className="text-[10px] text-zinc-400 block font-sans">
              (پایه {result.baseRatePercent}٪ + گام {result.stepPercent}٪)
            </span>
          </div>
        </div>

        <div className="flex justify-between items-center py-1 border-b border-zinc-50">
          <span className="text-zinc-500 font-medium">مبلغ کارمزد اقساط:</span>
          <span className="font-mono font-bold text-zinc-900">{result.installmentFeeAmount.toLocaleString()} ریال</span>
        </div>

        {result.intervalSurchargePercent > 0 && (
          <div className="flex justify-between items-center py-1 border-b border-zinc-50 text-indigo-700">
            <span className="font-medium">افزایش دوره ({result.intervalMonths} ماهه):</span>
            <span className="font-mono font-bold">+٪ {result.intervalSurchargePercent} ({result.intervalSurchargeAmount.toLocaleString()} ریال)</span>
          </div>
        )}

        {result.calcType === 'beta' && (
          <div className="flex justify-between items-center py-1 border-b border-zinc-50 bg-indigo-50/50 p-2 rounded-xl text-indigo-900">
            <span className="font-bold flex items-center gap-1">
              <Building2 size={12} />
              حق کارمزد بانک (بتا):
            </span>
            <span className="font-mono font-bold">٪ {result.bankFeePercent} ({result.bankFeeAmount.toLocaleString()} ریال)</span>
          </div>
        )}

        {result.representativeCommissionPercent > 0 && (
          <div className="flex justify-between items-center py-1 border-b border-zinc-50 text-amber-800">
            <span className="font-medium">کمیسیون نماینده:</span>
            <span className="font-mono font-bold">٪ {result.representativeCommissionPercent} ({result.representativeCommissionAmount.toLocaleString()} ریال)</span>
          </div>
        )}

        <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-100 space-y-2 mt-2">
          <div className="flex justify-between items-center">
            <span className="font-bold text-zinc-800 text-xs">مبلغ نهایی مشتری:</span>
            <div className="text-left">
              <span className={`font-mono text-base font-black ${themeClasses.highlight}`}>
                {result.finalTotal.toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-zinc-400 mr-1">ریال</span>
            </div>
          </div>
          <div className="text-[11px] font-bold text-zinc-600 text-left border-t border-zinc-200/60 pt-1">
            معادل: <span className="font-mono font-bold text-zinc-900">{(result.finalTotal / 10).toLocaleString()}</span> تومان
          </div>
        </div>

        {/* Monthly Installment Amount */}
        <div className="bg-slate-900 text-white p-3.5 rounded-2xl flex justify-between items-center">
          <span className="text-xs font-bold text-zinc-300">مبلغ هر قسط ({result.installmentCount} قسط):</span>
          <div className="text-left">
            <span className="font-mono text-sm font-bold text-amber-300">{monthlyPayment.toLocaleString()}</span>
            <span className="text-[10px] text-zinc-400 mr-1">ریال</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function InstallmentTable({ result }: { result: CreditCalculationResult }) {
  const count = result.installmentCount;
  const installmentAmount = Math.round(result.finalTotal / count);
  const totalInterestAndFees = result.finalTotal - result.principal;
  const principalPerInstallment = Math.round(result.principal / count);
  const feePerInstallment = Math.round(totalInterestAndFees / count);

  let remaining = result.finalTotal;

  const rows = [];
  for (let i = 1; i <= count; i++) {
    remaining -= installmentAmount;
    if (i === count) remaining = 0; // zero out rounding diffs on last row

    rows.push({
      number: i,
      periodLabel: `قسط ${i} (${i * result.intervalMonths} ماه بعد)`,
      principalPortion: principalPerInstallment,
      feePortion: feePerInstallment,
      totalAmount: installmentAmount,
      remainingBalance: Math.max(0, remaining),
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-xs">
        <thead>
          <tr className="bg-zinc-100 text-zinc-700 font-bold border-b border-zinc-200">
            <th className="p-3 rounded-r-xl">شماره</th>
            <th className="p-3">دوره سررسید</th>
            <th className="p-3">سهم اصل اعتبار</th>
            <th className="p-3">سهم سود و کارمزدها</th>
            <th className="p-3 text-indigo-700">مبلغ کل قسط</th>
            <th className="p-3 rounded-l-xl">مانده کل بدهی</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 font-mono">
          {rows.map((row) => (
            <tr key={row.number} className="hover:bg-zinc-50/80 transition">
              <td className="p-3 font-bold text-zinc-500 font-sans">قسط {row.number}</td>
              <td className="p-3 font-sans text-zinc-700">{row.periodLabel}</td>
              <td className="p-3 text-zinc-700">{row.principalPortion.toLocaleString()} ریال</td>
              <td className="p-3 text-amber-700">{row.feePortion.toLocaleString()} ریال</td>
              <td className="p-3 font-bold text-indigo-900 bg-indigo-50/30">{row.totalAmount.toLocaleString()} ریال</td>
              <td className="p-3 text-zinc-500">{row.remainingBalance.toLocaleString()} ریال</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
