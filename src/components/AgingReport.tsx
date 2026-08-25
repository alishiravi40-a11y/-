import React from 'react';
import { Invoice, Person } from '../types';
import { calculateAgingReport } from '../utils/accounting';

interface AgingReportProps {
  invoices: Invoice[];
  persons: Person[];
}

export function AgingReport({ invoices, persons }: AgingReportProps) {
  const report = calculateAgingReport(invoices, persons);

  const formatAmount = (amount: number) => 
    new Intl.NumberFormat('fa-IR').format(amount);

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm space-y-6" dir="rtl">
      <div className="flex justify-between items-center border-b pb-4">
        <h2 className="text-xl font-bold text-gray-800">گزارش سن بدهکاران (Aging Report)</h2>
        <div className="text-sm text-gray-500">تحلیل مهلت تسویه فاکتورهای فروش</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead className="bg-gray-50 text-gray-600 font-bold uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 rounded-tr-lg">نام مشتری</th>
              <th className="px-4 py-3 text-center">۰ تا ۳۰ روز</th>
              <th className="px-4 py-3 text-center">۳۱ تا ۶۰ روز</th>
              <th className="px-4 py-3 text-center">۶۱ تا ۹۰ روز</th>
              <th className="px-4 py-3 text-center">بیش از ۹۰ روز</th>
              <th className="px-4 py-3 text-left rounded-tl-lg">جمع کل بدهی</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {report.map((row, i) => (
              <tr key={i} className="hover:bg-blue-50/50 transition-colors">
                <td className="px-4 py-4 font-bold text-gray-900">{row.personName}</td>
                <td className="px-4 py-4 text-center text-gray-600">{formatAmount(row.zeroToThirty)}</td>
                <td className="px-4 py-4 text-center text-gray-600">{formatAmount(row.thirtyToSixty)}</td>
                <td className="px-4 py-4 text-center text-gray-600">{formatAmount(row.sixtyToNinety)}</td>
                <td className="px-4 py-4 text-center text-red-600 font-medium">{formatAmount(row.overNinety)}</td>
                <td className="px-4 py-4 text-left font-black text-gray-900 bg-gray-50/30">{formatAmount(row.totalDebt)}</td>
              </tr>
            ))}
            {report.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400 italic bg-gray-50/20">
                  هیچ فاکتور فروش تسویه نشده‌ای یافت نشد.
                </td>
              </tr>
            )}
          </tbody>
          {report.length > 0 && (
            <tfoot className="bg-gray-100 font-black">
              <tr>
                <td className="px-4 py-4 text-gray-800">مجموع کل:</td>
                <td className="px-4 py-4 text-center">{formatAmount(report.reduce((s, r) => s + r.zeroToThirty, 0))}</td>
                <td className="px-4 py-4 text-center">{formatAmount(report.reduce((s, r) => s + r.thirtyToSixty, 0))}</td>
                <td className="px-4 py-4 text-center">{formatAmount(report.reduce((s, r) => s + r.sixtyToNinety, 0))}</td>
                <td className="px-4 py-4 text-center text-red-700">{formatAmount(report.reduce((s, r) => s + r.overNinety, 0))}</td>
                <td className="px-4 py-4 text-left text-blue-900">{formatAmount(report.reduce((s, r) => s + r.totalDebt, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800 leading-relaxed">
        <strong>راهنما:</strong> مبالغ نمایش داده شده در این جدول، مبالغ باقیمانده (تسویه نشده) فاکتورهای فروش مشتریان است که بر اساس فاصله زمانی تاریخ صدور فاکتور تا امروز دسته‌بندی شده‌اند. این گزارش به شما کمک می‌کند تا مشتریانی که پرداخت‌های طولانی‌مدت و معوق دارند را شناسایی و اولویت‌بندی کنید.
      </div>
    </div>
  );
}
