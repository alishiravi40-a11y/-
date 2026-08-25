import React, { useMemo } from 'react';
import { AppState } from '../../types';
import { calculateDetailedProfitAndLoss } from '../../utils/accounting';

interface ProfitAndLossReportProps {
  state: AppState;
  startDate: string;
  endDate: string;
  isFilterSubmitted: boolean;
  pnlMethod: 'fifo' | 'average' | 'serial';
}

export default function ProfitAndLossReport({
  state,
  startDate,
  endDate,
  isFilterSubmitted,
  pnlMethod,
}: ProfitAndLossReportProps) {
  const pnlResult = useMemo(() => {
    if (!isFilterSubmitted) return null;
    return calculateDetailedProfitAndLoss(state, startDate, endDate, pnlMethod);
  }, [isFilterSubmitted, state, startDate, endDate, pnlMethod]);

  if (!pnlResult) return null;

  return (
    <div className="space-y-4">
      {/* Method tag */}
      <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 px-3.5 py-2.5 rounded-xl text-center font-sans text-xs font-bold leading-relaxed">
        سود خالص فاکتورها محاسبه شده با: 
        <strong className="block text-sm text-emerald-950 mt-1">
          {pnlMethod === 'average' && '۱. روش علمی میانگین موزون متحرک'}
          {pnlMethod === 'fifo' && '۲. روش زنجیره‌ای اولین صادره از اولین وارده (FIFO)'}
          {pnlMethod === 'serial' && '۳. روش رهگیری دقیق شماره سریال (IMEI) ویژه موبایل'}
        </strong>
      </div>

      {/* Key Cards */}
      <div className="grid grid-cols-2 gap-2 font-sans">
        <div className="bg-white border border-zinc-150 p-3 rounded-2xl text-center shadow-sm">
          <span className="text-[9px] text-zinc-400 block mb-1">کل فروش کالا:</span>
          <strong className="text-xs text-zinc-800 font-mono">{pnlResult.revenue.toLocaleString()} ریال</strong>
        </div>
        <div className="bg-white border border-zinc-150 p-3 rounded-2xl text-center shadow-sm">
          <span className="text-[9px] text-zinc-400 block mb-1">بهای تمام‌شده کالا (COGS):</span>
          <strong className="text-xs text-rose-600 font-mono">{pnlResult.cogs.toLocaleString()} ریال</strong>
        </div>
        <div className="bg-white border border-zinc-150 p-3 rounded-2xl text-center shadow-sm col-span-2 bg-zinc-50/50">
          <span className="text-[9px] text-zinc-500 block mb-1">سود ناویژه فروش کالا (Gross Profit):</span>
          <strong className="text-xs text-emerald-700 font-mono">{(pnlResult.revenue - pnlResult.cogs).toLocaleString()} ریال</strong>
        </div>
        <div className="bg-white border border-zinc-150 p-3 rounded-2xl text-center shadow-sm">
          <span className="text-[9px] text-zinc-400 block mb-1">سایر درآمدها (کارمزد نسیه/چک):</span>
          <strong className="text-xs text-teal-600 font-mono">{pnlResult.otherRevenue.toLocaleString()} ریال</strong>
        </div>
        <div className="bg-white border border-zinc-150 p-3 rounded-2xl text-center shadow-sm">
          <span className="text-[9px] text-zinc-400 block mb-1">کل هزینه‌های عمومی و مالی:</span>
          <strong className="text-xs text-amber-700 font-mono">{pnlResult.expenses.toLocaleString()} ریال</strong>
        </div>
        {pnlResult.operatingExpenseAmount !== undefined && pnlResult.operatingExpenseAmount > 0 && (
          <div className="bg-amber-50/40 border border-amber-100 p-3 rounded-2xl text-center shadow-sm col-span-2">
            <span className="text-[9px] text-amber-800 block mb-1">هزینه عملیاتی پنهان کسر شده ({pnlResult.operatingExpenseRate || 0}٪):</span>
            <strong className="text-xs text-amber-950 font-mono">{pnlResult.operatingExpenseAmount.toLocaleString()} ریال</strong>
          </div>
        )}
        <div className={`border p-4 rounded-2xl text-center shadow-sm col-span-2 ${
          pnlResult.netProfit >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-red-50 border-red-200 text-red-950'
        }`}>
          <span className="text-[10px] text-zinc-500 block mb-1 font-bold">سود ویژه خالص نهایی (Net Profit):</span>
          <strong className="text-sm font-mono font-bold block mt-0.5">
            {pnlResult.netProfit.toLocaleString()} ریال
          </strong>
        </div>
      </div>

      {/* Product Detail table/cards */}
      <div className="space-y-2">
        <span className="block text-right font-sans text-xs font-bold text-zinc-600">تفکیک سود بر اساس کالا:</span>
        {pnlResult.details.map((det, idx) => (
          <div key={idx} className="bg-white p-3.5 rounded-xl border border-zinc-150 text-right space-y-2 font-sans text-xs shadow-sm">
            <strong className="block text-zinc-800 font-bold">{det.productName}</strong>
            <div className="grid grid-cols-3 gap-1 text-center font-mono text-[9px] text-zinc-500 pt-1.5 border-t border-zinc-50">
              <div>
                <span>فروش: {det.salesRevenue.toLocaleString()}</span>
              </div>
              <div>
                <span>خرید: {det.cogsCost.toLocaleString()}</span>
              </div>
              <div className={det.profit >= 0 ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>
                <span>سود: {det.profit.toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
