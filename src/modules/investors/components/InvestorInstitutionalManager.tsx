import React, { useState } from 'react';
import { InvestorProfile } from '../types';
import { Person } from '../../../types';
import { InvestorInstitutionalEngine } from '../investorInstitutionalEngine';
import { Building2, LandPlot, Calendar, CheckCircle2, DollarSign, ShieldAlert } from 'lucide-react';

interface InvestorInstitutionalManagerProps {
  profiles: InvestorProfile[];
  persons: Person[];
  onUpdateProfile: (profile: InvestorProfile) => void;
  onAddInstitutionalInvestor: (person: Person, profile: InvestorProfile) => void;
}

export const InvestorInstitutionalManager: React.FC<InvestorInstitutionalManagerProps> = ({
  profiles,
  persons,
  onUpdateProfile,
  onAddInstitutionalInvestor,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [nationalCode, setNationalCode] = useState('');
  const [category, setCategory] = useState<'BANK' | 'FINANCIAL_INSTITUTION' | 'COMPANY'>('BANK');
  const [receivedAmount, setReceivedAmount] = useState<number>(50000000000); // 50B Rials
  const [totalRepaymentAmount, setTotalRepaymentAmount] = useState<number>(60000000000); // 60B Rials
  const [repaymentMonths, setRepaymentMonths] = useState<number>(12);
  const [startDate, setStartDate] = useState('1403/01/01');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const institutionalProfiles = profiles.filter(
    (p) => p.category === 'BANK' || p.category === 'FINANCIAL_INSTITUTION' || p.category === 'COMPANY'
  );

  const handleCreateInstitutional = (e: React.FormEvent) => {
    e.preventDefault();

    const newPersonId = `P_INST_${Date.now()}`;
    const newPerson: Person = {
      id: newPersonId,
      code: `INST_${Date.now()}`,
      name: orgName,
      nationalId: nationalCode || '10100000000',
      mobile: '02188888888',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const instDetails = InvestorInstitutionalEngine.createInstitutionalDetails({
      category,
      receivedAmount,
      totalRepaymentAmount,
      contractInterestOrFee: totalRepaymentAmount - receivedAmount,
      repaymentMonths,
      startDate,
    });

    const newProfile: InvestorProfile = {
      id: `PROF_INST_${Date.now()}`,
      personId: newPersonId,
      category,
      institutionalDetails: instDetails,
      totalInvestedAmount: receivedAmount,
      activeContractsCount: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onAddInstitutionalInvestor(newPerson, newProfile);
    setShowAddModal(false);
    setOrgName('');
  };

  const handleSettleRepayment = (profile: InvestorProfile, itemId: string) => {
    if (!profile.institutionalDetails) return;

    const updatedDetails = InvestorInstitutionalEngine.recordRepaymentSettlement(
      profile.institutionalDetails,
      itemId,
      new Date().toLocaleDateString('fa-IR')
    );

    const updatedProfile: InvestorProfile = {
      ...profile,
      institutionalDetails: updatedDetails,
      updatedAt: new Date().toISOString(),
    };

    onUpdateProfile(updatedProfile);
  };

  const activeSelectedProfile = profiles.find((p) => p.id === selectedProfileId);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-lg border border-blue-500/20">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">مدیریت سرمایه‌گذاران سازمانی و بانک‌ها</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              مدیریت و ثبت تعهدات، اصل بدهی و سود تسهیلات بانکی و موسسات مالی بدون دستکاری هسته حسابداری
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-4 py-2 rounded-lg flex items-center gap-2 transition"
        >
          <LandPlot className="w-4 h-4" />
          ثبت بانک / موسسه جدید
        </button>
      </div>

      {/* Institutional Profiles Grid */}
      {institutionalProfiles.length === 0 ? (
        <div className="p-8 text-center bg-slate-950/40 border border-dashed border-slate-800 rounded-xl">
          <Building2 className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-300">هیچ سرمایه‌گذار سازمانی یا بانکی ثبت نشده است</p>
          <p className="text-xs text-slate-500 mt-1">جهت تعریف حساب بانک یا موسسه مالی از گزینه ثبت فوق استفاده کنید.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {institutionalProfiles.map((prof) => {
            const person = persons.find((p) => p.id === prof.personId);
            const details = prof.institutionalDetails;

            return (
              <div
                key={prof.id}
                className="bg-slate-950/70 border border-slate-800 hover:border-slate-700 rounded-xl p-4 space-y-3 transition"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <div>
                    <h4 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-blue-400" />
                      {person ? person.name : 'سازمان نامشخص'}
                    </h4>
                    <span className="text-[10px] text-blue-400 font-semibold bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 mt-1 inline-block">
                      {prof.category === 'BANK' ? 'بانک' : prof.category === 'FINANCIAL_INSTITUTION' ? 'موسسه مالی' : 'شرکت حقوقی'}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedProfileId(prof.id)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700"
                  >
                    جدول بازپرداخت
                  </button>
                </div>

                {details && (
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">مبلغ دریافت شده:</span>
                      <span className="text-slate-100 font-bold">{details.receivedAmount.toLocaleString('fa-IR')} ریال</span>
                    </div>
                    <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">کل بازپرداخت:</span>
                      <span className="text-amber-400 font-bold">{details.totalRepaymentAmount.toLocaleString('fa-IR')} ریال</span>
                    </div>
                    <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">کارمزد/سود:</span>
                      <span className="text-rose-400 font-bold">{details.contractInterestOrFee.toLocaleString('fa-IR')} ریال</span>
                    </div>
                    <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">وضعیت تسویه:</span>
                      <span className="text-emerald-400 font-bold font-sans">
                        {details.settlementStatus === 'SETTLED' ? 'تسویه شده' : 'فعال'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Institutional Schedule Modal */}
      {activeSelectedProfile && activeSelectedProfile.institutionalDetails && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="font-bold text-slate-100 flex items-center gap-2 text-sm">
                <Building2 className="w-5 h-5 text-blue-400" />
                جدول بازپرداخت تسهیلات / تعهدات سازمانی
              </h4>
              <button
                onClick={() => setSelectedProfileId(null)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="overflow-x-auto max-h-[400px]">
              <table className="w-full text-xs text-right text-slate-300">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">سررسید</th>
                    <th className="p-3">قسط اصل بدهی</th>
                    <th className="p-3">قسط کارمزد/سود</th>
                    <th className="p-3">مبلغ کل قسط</th>
                    <th className="p-3">وضعیت</th>
                    <th className="p-3 text-center">عملیات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {activeSelectedProfile.institutionalDetails.repaymentSchedule.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-bold text-slate-400">{idx + 1}</td>
                      <td className="p-3 font-mono">{item.dueDate}</td>
                      <td className="p-3 font-mono text-slate-200">{item.principalPortion.toLocaleString('fa-IR')} ریال</td>
                      <td className="p-3 font-mono text-rose-400">{item.feePortion.toLocaleString('fa-IR')} ریال</td>
                      <td className="p-3 font-mono font-bold text-amber-400">{item.totalAmount.toLocaleString('fa-IR')} ریال</td>
                      <td className="p-3">
                        {item.status === 'PAID' ? (
                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-semibold">پرداخت شده</span>
                        ) : (
                          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded text-[10px] font-semibold">برنامه‌ریزی شده</span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        {item.status !== 'PAID' && (
                          <button
                            onClick={() => handleSettleRepayment(activeSelectedProfile, item.id)}
                            className="bg-emerald-600/80 hover:bg-emerald-600 text-white text-[11px] px-2.5 py-1 rounded border border-emerald-500/40"
                          >
                            ثبت تسویه
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="font-bold text-slate-100 flex items-center gap-2">
                <LandPlot className="w-5 h-5 text-blue-400" />
                تعریف بانک یا موسسه سرمایه‌گذار
              </h4>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateInstitutional} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">نام بانک / موسسه / شرکت</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="مثال: بانک ملی - شعبه مرکزی"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">نوع سرمایه‌گذار سازمانی</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="BANK">بانک</option>
                    <option value="FINANCIAL_INSTITUTION">موسسه مالی و اعتباری</option>
                    <option value="COMPANY">شرکت / شخص حقوقی</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">شناسه ملی حقوقی</label>
                  <input
                    type="text"
                    value={nationalCode}
                    onChange={(e) => setNationalCode(e.target.value)}
                    placeholder="10100000000"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">مبلغ دریافت شده (اصل)</label>
                  <input
                    type="number"
                    value={receivedAmount}
                    onChange={(e) => setReceivedAmount(Number(e.target.value))}
                    required
                    step={100000000}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">مبلغ کل بازپرداخت</label>
                  <input
                    type="number"
                    value={totalRepaymentAmount}
                    onChange={(e) => setTotalRepaymentAmount(Number(e.target.value))}
                    required
                    step={100000000}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">تعداد اقساط بازپرداخت</label>
                  <input
                    type="number"
                    value={repaymentMonths}
                    onChange={(e) => setRepaymentMonths(Number(e.target.value))}
                    required
                    min={1}
                    max={60}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">تاریخ شروع قرارداد</label>
                  <input
                    type="text"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
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
                  className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-4 py-2 rounded-lg"
                >
                  ثبت موسسه
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
