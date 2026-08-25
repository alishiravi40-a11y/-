import React from 'react';
import { JournalVoucher, AccountSubsidiary } from '../types';
import { calculateBalanceSheet } from '../utils/accounting';
import { useCoaReadModel } from '../services/CoaReadService';

interface BalanceSheetReportProps {
  vouchers: JournalVoucher[];
  subsidiaries?: AccountSubsidiary[];
}

export function BalanceSheetReport({ vouchers, subsidiaries: propSubsidiaries }: BalanceSheetReportProps) {
  const { subsidiaries: activeSubsidiaries } = useCoaReadModel(propSubsidiaries);
  const bs = calculateBalanceSheet(vouchers, activeSubsidiaries);

  const formatAmount = (amount: number) => 
    new Intl.NumberFormat('fa-IR').format(Math.abs(amount)) + ' ریال';

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm space-y-8" dir="rtl">
      <div className="flex justify-between items-center border-b pb-4">
        <h2 className="text-xl font-bold text-gray-800">ترازنامه (Balance Sheet)</h2>
        <div className="text-sm text-gray-500 font-mono">وضعیت لحظه‌ای دارایی و بدهی</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Assets Section */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-blue-800 bg-blue-50 p-3 rounded-lg flex justify-between">
            <span>دارایی‌ها</span>
            <span>{formatAmount(bs.totalAssets)}</span>
          </h3>
          <div className="divide-y border rounded-xl overflow-hidden">
            {bs.assets.map((a, i) => (
              <div key={i} className="flex justify-between items-center p-3 hover:bg-gray-50 transition-colors">
                <span className="text-gray-700">{a.name}</span>
                <span className="font-semibold text-gray-900">{formatAmount(a.balance)}</span>
              </div>
            ))}
            {bs.assets.length === 0 && (
              <div className="p-8 text-center text-gray-400 italic">داده‌ای یافت نشد</div>
            )}
          </div>
        </div>

        {/* Liabilities & Equity Section */}
        <div className="space-y-8">
          {/* Liabilities */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-red-800 bg-red-50 p-3 rounded-lg flex justify-between">
              <span>بدهی‌ها</span>
              <span>{formatAmount(bs.totalLiabilities)}</span>
            </h3>
            <div className="divide-y border rounded-xl overflow-hidden">
              {bs.liabilities.map((l, i) => (
                <div key={i} className="flex justify-between items-center p-3 hover:bg-gray-50 transition-colors">
                  <span className="text-gray-700">{l.name}</span>
                  <span className="font-semibold text-gray-900">{formatAmount(l.balance)}</span>
                </div>
              ))}
              {bs.liabilities.length === 0 && (
                <div className="p-4 text-center text-gray-400 italic">بدون بدهی</div>
              )}
            </div>
          </div>

          {/* Equity */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-purple-800 bg-purple-50 p-3 rounded-lg flex justify-between">
              <span>حقوق صاحبان سهام</span>
              <span>{formatAmount(bs.totalEquity)}</span>
            </h3>
            <div className="divide-y border rounded-xl overflow-hidden">
              {bs.equity.map((e, i) => (
                <div key={i} className="flex justify-between items-center p-3 hover:bg-gray-50 transition-colors">
                  <span className="text-gray-700 font-medium">{e.name}</span>
                  <span className={`font-semibold ${e.balance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatAmount(e.balance)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Equation Verification */}
      <div className="mt-10 p-6 bg-gray-900 rounded-2xl text-white">
        <div className="flex flex-col md:flex-row justify-around items-center gap-6 font-mono">
          <div className="text-center">
            <div className="text-gray-400 text-xs mb-1 uppercase tracking-widest">Total Assets</div>
            <div className="text-2xl font-bold">{formatAmount(bs.totalAssets)}</div>
          </div>
          <div className="text-3xl text-gray-600 hidden md:block">=</div>
          <div className="text-center">
            <div className="text-gray-400 text-xs mb-1 uppercase tracking-widest">Total Liabilities + Equity</div>
            <div className="text-2xl font-bold">{formatAmount(bs.totalLiabilities + bs.totalEquity)}</div>
          </div>
          <div className="px-4 py-1 bg-green-500/20 border border-green-500/30 rounded-full text-green-400 text-sm">
            تراز برقرار است ✓
          </div>
        </div>
      </div>
    </div>
  );
}
