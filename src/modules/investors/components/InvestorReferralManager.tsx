import React, { useState } from 'react';
import { InvestorReferral } from '../types';
import { Person } from '../../../types';
import { InvestorReferralEngine } from '../investorReferralEngine';
import { Users, UserPlus, CheckCircle, AlertTriangle, Calculator, ShieldCheck, DollarSign } from 'lucide-react';

interface InvestorReferralManagerProps {
  referrals: InvestorReferral[];
  persons: Person[];
  currentUserId?: string;
  onAddReferral: (referral: InvestorReferral) => void;
  onUpdateReferral: (referral: InvestorReferral) => void;
}

export const InvestorReferralManager: React.FC<InvestorReferralManagerProps> = ({
  referrals,
  persons,
  currentUserId = 'ADMIN',
  onAddReferral,
  onUpdateReferral,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [referrerPersonId, setReferrerPersonId] = useState('');
  const [referredInvestorPersonId, setReferredInvestorPersonId] = useState('');
  const [capitalAmount, setCapitalAmount] = useState<number>(1000000000); // 1B Rials
  const [durationMonths, setDurationMonths] = useState<number>(12); // Default 12 months
  const [commissionRate, setCommissionRate] = useState<number>(2.0); // 2%
  const [referralDate, setReferralDate] = useState('1403/01/01');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Calculated Preview
  const previewCommission = InvestorReferralEngine.calculateReferralCommission(
    capitalAmount,
    durationMonths,
    commissionRate
  );

  const handleCreateReferral = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    try {
      const referrerPerson = persons.find((p) => p.id === referrerPersonId);
      const referredPerson = persons.find((p) => p.id === referredInvestorPersonId);

      const newRef = InvestorReferralEngine.registerReferral({
        referrerPersonId,
        referrerName: referrerPerson ? referrerPerson.name : 'معرف نامشخص',
        referredInvestorPersonId,
        referredInvestorName: referredPerson ? referredPerson.name : 'سرمایه‌گذار نامشخص',
        referralDate,
        capitalAmount,
        contractDurationMonths: durationMonths,
        commissionRate,
      });

      onAddReferral(newRef);
      setShowAddModal(false);
      // Reset
      setReferrerPersonId('');
      setReferredInvestorPersonId('');
    } catch (err: any) {
      setErrorMsg(err.message || 'خطا در ثبت معرف.');
    }
  };

  const handleApproveCommission = (ref: InvestorReferral) => {
    const approved = InvestorReferralEngine.approveCommission(ref, currentUserId);
    onUpdateReferral(approved);
  };

  const handleMarkAsPaid = (ref: InvestorReferral) => {
    const paid = InvestorReferralEngine.markAsPaid(ref);
    onUpdateReferral(paid);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/20">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">مدیریت معرفین و کمیسیون‌های جذب</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              محاسبه هوشمند کمیسیون معرف بر اساس سرمایه و مدت ماندگاری بدون کسر خودکار مالی
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-4 py-2 rounded-lg flex items-center gap-2 transition"
        >
          <UserPlus className="w-4 h-4" />
          ثبت معرف جدید
        </button>
      </div>

      {/* Referral Table */}
      {referrals.length === 0 ? (
        <div className="p-8 text-center bg-slate-950/40 border border-dashed border-slate-800 rounded-xl">
          <Users className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-300">هیچ معرفی ثبت نشده است</p>
          <p className="text-xs text-slate-500 mt-1">جهت ثبت کمیسیون جذب سرمایه‌گذار جدید از دکمه فوق استفاده کنید.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right text-slate-300">
            <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
              <tr>
                <th className="p-3">نام معرف</th>
                <th className="p-3">سرمایه‌گذار جذب‌شده</th>
                <th className="p-3">مبلغ سرمایه</th>
                <th className="p-3">مدت (ماه)</th>
                <th className="p-3">نرخ %</th>
                <th className="p-3">کمیسیون محاسبه‌شده</th>
                <th className="p-3">وضعیت</th>
                <th className="p-3 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {referrals.map((ref) => (
                <tr key={ref.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3 font-semibold text-slate-100">{ref.referrerName || ref.referrerPersonId}</td>
                  <td className="p-3 text-slate-300">{ref.referredInvestorName || ref.referredInvestorPersonId}</td>
                  <td className="p-3 font-mono text-emerald-400">{ref.capitalAmount.toLocaleString('fa-IR')} ریال</td>
                  <td className="p-3">{ref.contractDurationMonths} ماه</td>
                  <td className="p-3">{ref.commissionRate}%</td>
                  <td className="p-3 font-mono font-bold text-slate-100">
                    {ref.calculatedCommissionAmount.toLocaleString('fa-IR')} ریال
                    {ref.suggestedRecalculatedCommission !== undefined && (
                      <span className="block text-[10px] text-amber-400">
                        پیشنهاد جدید: {ref.suggestedRecalculatedCommission.toLocaleString('fa-IR')}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {ref.commissionStatus === 'APPROVED' && (
                      <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[11px] font-semibold">تایید شده</span>
                    )}
                    {ref.commissionStatus === 'PAID' && (
                      <span className="bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded text-[11px] font-semibold">پرداخت شده</span>
                    )}
                    {ref.commissionStatus === 'PENDING' && (
                      <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded text-[11px] font-semibold">در انتظار تایید</span>
                    )}
                    {ref.commissionStatus === 'RECALCULATED' && (
                      <span className="bg-rose-500/10 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> نیازمند بررسی مدیر
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-center space-x-1 space-x-reverse">
                    {ref.commissionStatus === 'PENDING' || ref.commissionStatus === 'RECALCULATED' ? (
                      <button
                        onClick={() => handleApproveCommission(ref)}
                        className="bg-emerald-600/80 hover:bg-emerald-600 text-white text-[11px] px-2.5 py-1 rounded border border-emerald-500/40"
                      >
                        تایید کمیسیون
                      </button>
                    ) : null}
                    {ref.commissionStatus === 'APPROVED' ? (
                      <button
                        onClick={() => handleMarkAsPaid(ref)}
                        className="bg-blue-600/80 hover:bg-blue-600 text-white text-[11px] px-2.5 py-1 rounded border border-blue-500/40"
                      >
                        ثبت پرداخت
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Register Referral Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="font-bold text-slate-100 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-400" />
                ثبت معرف و کمیسیون جذب
              </h4>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {errorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-lg">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateReferral} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">انتخاب شخص معرف</label>
                <select
                  value={referrerPersonId}
                  onChange={(e) => setReferrerPersonId(e.target.value)}
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="">انتخاب کنید...</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.mobile})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">سرمایه‌گذار معرفی‌شده</label>
                <select
                  value={referredInvestorPersonId}
                  onChange={(e) => setReferredInvestorPersonId(e.target.value)}
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="">انتخاب کنید...</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.mobile})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">مبلغ سرمایه (ریال)</label>
                  <input
                    type="number"
                    value={capitalAmount}
                    onChange={(e) => setCapitalAmount(Number(e.target.value))}
                    required
                    step={10000000}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">مدت ماندگاری (ماه)</label>
                  <select
                    value={durationMonths}
                    onChange={(e) => setDurationMonths(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  >
                    <option value={3}>۳ ماهه (ضریب ۰.۲۵)</option>
                    <option value={6}>۶ ماهه (ضریب ۰.۵۰)</option>
                    <option value={12}>۱۲ ماهه (ضریب ۱.۰۰)</option>
                    <option value={24}>۲۴ ماهه (ضریب ۲.۰۰)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">نرخ کمیسیون معرف (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={commissionRate}
                    onChange={(e) => setCommissionRate(Number(e.target.value))}
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">تاریخ معرفی</label>
                  <input
                    type="text"
                    value={referralDate}
                    onChange={(e) => setReferralDate(e.target.value)}
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Formula & Live Preview Card */}
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Calculator className="w-4 h-4" /> پیش‌نمایش کمیسیون هوشمند:
                  </span>
                  <span className="font-mono text-emerald-400 text-sm">
                    {previewCommission.toLocaleString('fa-IR')} ریال
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  * کمیسیون متناسب با سرمایه ({capitalAmount.toLocaleString('fa-IR')} ریال) و مدت ماندگاری ({durationMonths} ماه) محاسبه شد.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-4 py-2 rounded-lg"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-4 py-2 rounded-lg"
                >
                  ثبت معرف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
