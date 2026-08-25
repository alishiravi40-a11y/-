import React from 'react';
import { JournalVoucher, AccountSubsidiary } from '../types';
import { calculateProfitAndLoss } from '../utils/accounting';
import { useCoaReadModel } from '../services/CoaReadService';

interface ProfitLossReportProps {
  vouchers: JournalVoucher[];
  subsidiaries?: AccountSubsidiary[];
}

export function ProfitLossReport({ vouchers, subsidiaries: propSubsidiaries }: ProfitLossReportProps) {
  const { subsidiaries: activeSubsidiaries } = useCoaReadModel(propSubsidiaries);
  const pl = calculateProfitAndLoss(vouchers, activeSubsidiaries);

  const formatAmount = (amount: number) => 
    new Intl.NumberFormat('fa-IR').format(Math.abs(amount)) + ' ریال';

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm space-y-8" dir="rtl">
      <div className="flex justify-between items-center border-b pb-4">
        <h2 className="text-xl font-bold text-gray-800">گزارش سود و زیان (P&L)</h2>
        <div className="text-sm text-gray-500 font-mono">دوره جاری</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Revenue Section */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-green-700 flex items-center gap-2">
            <span className="w-2 h-6 bg-green-500 rounded-full"></span>
            درآمدها
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
              <span className="text-gray-700">فروش ناخالص</span>
              <span className="font-bold text-green-800">{formatAmount(pl.revenue)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
              <span className="text-gray-700">سایر درآمدها (کارمزد و غیره)</span>
              <span className="font-bold text-green-800">{formatAmount(pl.otherIncome)}</span>
            </div>
            <div className="flex justify-between items-center p-3 border-t-2 border-green-200 pt-3">
              <span className="font-bold text-gray-800">جمع کل درآمدها</span>
              <span className="font-bold text-xl text-green-900">{formatAmount(pl.revenue + pl.otherIncome)}</span>
            </div>
          </div>
        </div>

        {/* Expenses Section */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-red-700 flex items-center gap-2">
            <span className="w-2 h-6 bg-red-500 rounded-full"></span>
            هزینه‌ها
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
              <span className="text-gray-700">بهای تمام شده کالای فروش رفته (COGS)</span>
              <span className="font-bold text-red-800">{formatAmount(pl.cogs)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
              <span className="text-gray-700">هزینه‌های عمومی، اداری و فروش</span>
              <span className="font-bold text-red-800">{formatAmount(pl.expenses)}</span>
            </div>
            <div className="flex justify-between items-center p-3 border-t-2 border-red-200 pt-3">
              <span className="font-bold text-gray-800">جمع کل هزینه‌ها</span>
              <span className="font-bold text-xl text-red-900">{formatAmount(pl.cogs + pl.expenses)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Footer */}
      <div className={`mt-8 p-6 rounded-2xl border-2 flex flex-col md:flex-row justify-between items-center gap-4 ${
        pl.netProfit >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200'
      }`}>
        <div className="text-center md:text-right">
          <div className="text-gray-600 text-sm mb-1">نتیجه نهایی عملیات</div>
          <div className={`text-2xl font-black ${pl.netProfit >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>
            {pl.netProfit >= 0 ? 'سود ویژه (خالص)' : 'زیان ویژه'}
          </div>
        </div>
        <div className={`text-4xl font-black ${pl.netProfit >= 0 ? 'text-blue-900' : 'text-orange-900'}`}>
          {formatAmount(pl.netProfit)}
        </div>
      </div>
    </div>
  );
}
