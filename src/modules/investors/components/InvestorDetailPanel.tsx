/**
 * Investor Full Profile & Detailed Contract Panel
 * (پنل جزئیات کامل سرمایه‌گذار، سوابق تغییرات و مدیریت قرارداد)
 */

import React, { useState } from 'react';
import {
  User,
  FileText,
  History,
  TrendingUp,
  Coins,
  Calendar,
  CreditCard,
  Building,
  CheckCircle,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Minus,
  Edit2,
  Lock,
  ArrowLeft,
  DollarSign,
} from 'lucide-react';
import {
  InvestorContract,
  InvestorPaymentObligation,
  InvestorContractStatus,
  InvestorFinancialEvent,
  InvestorFinancialEventType,
} from '../types';
import { Person, AccountSubsidiary } from '../../../types';
import { InvestorContractEngine } from '../investorContractEngine';
import { InvestorSettlementEngine } from '../investorSettlementEngine';
import { InvestorVoucherDraftRequest, InvestorAccountingMapper } from '../investorAccountingAdapter';
import { getCurrentJalaliDate } from '../../../utils/jalali';
import { InvestorAccountSelector } from './InvestorAccountSelector';

interface InvestorDetailPanelProps {
  contract: InvestorContract;
  person: Person | undefined;
  obligations: InvestorPaymentObligation[];
  subsidiaries?: AccountSubsidiary[];
  persons?: Person[];
  onBack: () => void;
  onUpdateContract: (
    updatedContract: InvestorContract,
    updatedObligations?: InvestorPaymentObligation[]
  ) => void;
  onRequestVoucherCreation?: (voucherDraft: InvestorVoucherDraftRequest) => void;
}

export const InvestorDetailPanel: React.FC<InvestorDetailPanelProps> = ({
  contract,
  person,
  obligations,
  subsidiaries = [],
  persons = [],
  onBack,
  onUpdateContract,
  onRequestVoucherCreation,
}) => {
  const currentDate = getCurrentJalaliDate();
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'HISTORY' | 'SCHEDULE'>('OVERVIEW');

  // Modal State for Capital Adjustment
  const [showCapitalModal, setShowCapitalModal] = useState<boolean>(false);
  const [capitalActionType, setCapitalActionType] = useState<'INCREASE' | 'DECREASE'>('INCREASE');
  const [capitalChangeAmount, setCapitalChangeAmount] = useState<number>(1000000000);
  const [capitalReason, setCapitalReason] = useState<string>('');
  const [capitalSubAccountId, setCapitalSubAccountId] = useState<string>('');
  const [capitalError, setCapitalError] = useState<string | null>(null);

  // Modal State for Rate Adjustment
  const [showRateModal, setShowRateModal] = useState<boolean>(false);
  const [newFeeRate, setNewFeeRate] = useState<number>(contract.monthlyFeeRate);
  const [rateReason, setRateReason] = useState<string>('');
  const [rateError, setRateError] = useState<string | null>(null);

  const contractObligations = obligations.filter((o) => o.contractId === contract.id);

  const handleExecuteCapitalAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    setCapitalError(null);

    try {
      let result;
      if (capitalActionType === 'INCREASE') {
        result = InvestorContractEngine.increaseInvestorCapital(contract, {
          amount: capitalChangeAmount,
          effectiveDate: currentDate,
          description: capitalReason || 'افزایش سرمایه',
        });
      } else {
        result = InvestorContractEngine.decreaseInvestorCapital(contract, {
          amount: capitalChangeAmount,
          effectiveDate: currentDate,
          description: capitalReason || 'کاهش سرمایه',
        });
      }

      const adjustedObligations = InvestorSettlementEngine.adjustObligationsOnCapitalChange(
        contractObligations,
        result.contract,
        currentDate
      );

      onUpdateContract(result.contract, adjustedObligations);

      if (person && onRequestVoucherCreation) {
        const eventType: InvestorFinancialEventType =
          capitalActionType === 'INCREASE' ? 'INVESTMENT_RECEIVED' : 'INVESTMENT_RETURNED';
        const financialEvent: InvestorFinancialEvent = {
          id: `EVT_${capitalActionType}_${contract.id}_${Date.now()}`,
          contractId: contract.id,
          investorPersonId: person.id,
          eventType,
          amount: capitalChangeAmount,
          eventDate: currentDate,
          description:
            capitalReason ||
            (capitalActionType === 'INCREASE'
              ? `افزایش سرمایه طی قرارداد ${contract.contractNumber}`
              : `استرداد/کاهش سرمایه طی قرارداد ${contract.contractNumber}`),
          cashOrBankSubAccountId: capitalSubAccountId || undefined,
        };

        const voucherDraft = InvestorAccountingMapper.createVoucherDraftRequest(
          financialEvent,
          person,
          result.contract
        );

        onRequestVoucherCreation(voucherDraft);
      }

      setShowCapitalModal(false);
    } catch (err: any) {
      setCapitalError(err.message || 'خطا در تغییر سرمایه.');
    }
  };

  const handleExecuteRateAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    setRateError(null);

    try {
      const result = InvestorContractEngine.changeInvestorRate(contract, {
        newRate: newFeeRate,
        effectiveDate: currentDate,
        reason: rateReason || 'تغییر نرخ کارمزد ماهانه',
      });

      const adjustedObligations = InvestorSettlementEngine.adjustObligationsOnCapitalChange(
        contractObligations,
        result.contract,
        currentDate
      );

      onUpdateContract(result.contract, adjustedObligations);
      setShowRateModal(false);
    } catch (err: any) {
      setRateError(err.message || 'خطا در تغییر نرخ کارمزد.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Navigation */}
      <div className="flex items-center justify-between bg-slate-800/90 border border-slate-700 p-4 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl transition-all"
            title="بازگشت به لیست"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <User className="w-5 h-5 text-emerald-400" />
              {person?.name || 'سرمایه‌گذار'}
              <span className="text-xs px-2.5 py-0.5 bg-emerald-900/60 text-emerald-300 rounded-full border border-emerald-700/50">
                قرارداد {contract.contractNumber}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              تاریخ شروع: {contract.startDate} | کد ملی: {person?.nationalId || '---'} | موبایل: {person?.mobile || '---'}
            </p>
          </div>
        </div>

        {/* Quick Contract Actions */}
        <div className="flex items-center gap-2">
          {contract.status === 'active' && (
            <>
              <button
                onClick={() => {
                  setCapitalActionType('INCREASE');
                  setShowCapitalModal(true);
                }}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 shadow-md transition-all"
              >
                <Plus className="w-4 h-4" />
                افزایش سرمایه
              </button>
              <button
                onClick={() => {
                  setCapitalActionType('DECREASE');
                  setShowCapitalModal(true);
                }}
                className="px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 shadow-md transition-all"
              >
                <Minus className="w-4 h-4" />
                برداشت سرمایه
              </button>
              <button
                onClick={() => {
                  setNewFeeRate(contract.monthlyFeeRate);
                  setShowRateModal(true);
                }}
                className="px-3 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1 shadow-md transition-all"
              >
                <Edit2 className="w-4 h-4" />
                تغییر نرخ
              </button>
            </>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-800/80 border border-slate-700 p-4 rounded-2xl">
          <div className="text-xs text-slate-400">سرمایه اولیه</div>
          <div className="text-lg font-bold text-white mt-1">
            {contract.initialCapital.toLocaleString()} <span className="text-xs font-normal">ریال</span>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700 p-4 rounded-2xl">
          <div className="text-xs text-slate-400">سرمایه فعلی موجود</div>
          <div className="text-lg font-bold text-emerald-400 mt-1">
            {contract.currentCapital.toLocaleString()} <span className="text-xs font-normal">ریال</span>
          </div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700 p-4 rounded-2xl">
          <div className="text-xs text-slate-400">نرخ کارمزد ماهانه</div>
          <div className="text-lg font-bold text-teal-300 mt-1">{contract.monthlyFeeRate}٪</div>
        </div>

        <div className="bg-slate-800/80 border border-slate-700 p-4 rounded-2xl">
          <div className="text-xs text-slate-400">تعداد تعهدات سررسید</div>
          <div className="text-lg font-bold text-amber-300 mt-1">{contractObligations.length} قسط</div>
        </div>
      </div>

      {/* Tab Controls */}
      <div className="flex border-b border-slate-700 text-sm font-semibold gap-6">
        <button
          onClick={() => setActiveTab('OVERVIEW')}
          className={`pb-3 transition-all ${
            activeTab === 'OVERVIEW'
              ? 'text-emerald-400 border-b-2 border-emerald-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          خلاصه و تغییرات سرمایه
        </button>
        <button
          onClick={() => setActiveTab('SCHEDULE')}
          className={`pb-3 transition-all ${
            activeTab === 'SCHEDULE'
              ? 'text-emerald-400 border-b-2 border-emerald-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          جدول زمان‌بندی پرداخت‌ها
        </button>
        <button
          onClick={() => setActiveTab('HISTORY')}
          className={`pb-3 transition-all ${
            activeTab === 'HISTORY'
              ? 'text-emerald-400 border-b-2 border-emerald-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          سوابق نرخ و لاگ رویدادها
        </button>
      </div>

      {/* Tab Content: Overview */}
      {activeTab === 'OVERVIEW' && (
        <div className="space-y-4">
          <div className="bg-slate-800/90 border border-slate-700 p-5 rounded-2xl space-y-3">
            <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-400" />
              تاریخچه تغییرات سرمایه
            </h3>

            {!contract.changeLogs || contract.changeLogs.length === 0 ? (
              <div className="text-xs text-slate-400 py-4 text-center">
                هیچ تغییر سرمایه یا شرطی تا کنون ثبت نشده است.
              </div>
            ) : (
              <div className="space-y-2">
                {contract.changeLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 bg-slate-900/60 border border-slate-700/60 rounded-xl text-xs flex items-center justify-between"
                  >
                    <div>
                      <span className="font-bold text-slate-200">{log.description}</span>
                      <span className="text-slate-400 block mt-0.5">تاریخ: {log.changeDate}</span>
                    </div>
                    {log.newCapital && (
                      <div className="font-bold text-emerald-400">
                        سرمایه جدید: {log.newCapital.toLocaleString()} ریال
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Content: Schedule */}
      {activeTab === 'SCHEDULE' && (
        <div className="bg-slate-800/90 border border-slate-700 rounded-2xl overflow-hidden">
          <table className="w-full text-right text-xs text-slate-300">
            <thead className="bg-slate-900/80 font-semibold text-slate-400 border-b border-slate-700">
              <tr>
                <th className="p-3">تاریخ سررسید</th>
                <th className="p-3">نوع تعهد</th>
                <th className="p-3">مبلغ (ریال)</th>
                <th className="p-3">وضعیت</th>
                <th className="p-3">تاریخ پرداخت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {contractObligations.map((o) => (
                <tr key={o.id}>
                  <td className="p-3 font-mono text-amber-300">{o.dueDate}</td>
                  <td className="p-3">
                    {o.obligationType === 'FEE' ? 'کارمزد ماهانه' : 'استرداد اصل'}
                  </td>
                  <td className="p-3 font-bold text-white">{o.amount.toLocaleString()}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded ${
                        o.status === 'PAID'
                          ? 'bg-emerald-900/50 text-emerald-300'
                          : o.status === 'ADJUSTED'
                          ? 'bg-teal-900/50 text-teal-300'
                          : 'bg-amber-900/50 text-amber-300'
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="p-3 text-slate-400">{o.paymentDate || '---'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Capital Adjustment */}
      {showCapitalModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Coins className="w-5 h-5 text-emerald-400" />
              {capitalActionType === 'INCREASE' ? 'افزایش سرمایه' : 'برداشت سرمایه'}
            </h3>

            {capitalError && (
              <div className="p-3 bg-rose-950/50 border border-rose-600/50 rounded-xl text-rose-300 text-xs">
                {capitalError}
              </div>
            )}

            <form onSubmit={handleExecuteCapitalAdjustment} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">
                  مبلغ {capitalActionType === 'INCREASE' ? 'افزایش' : 'برداشت'} (ریال):
                </label>
                <input
                  type="number"
                  value={capitalChangeAmount}
                  onChange={(e) => setCapitalChangeAmount(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100 font-bold"
                  required
                />
              </div>

              <div>
                <InvestorAccountSelector
                  label="حساب دریافت / پرداخت وجه (بانک / صندوق / اشخاص):"
                  subsidiaries={subsidiaries}
                  persons={persons}
                  value={capitalSubAccountId}
                  onChange={(selectedId) => setCapitalSubAccountId(selectedId)}
                  defaultBankLabel="-- بانک اصلی پیش‌فرض (SUB_BANK_MAIN) --"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">توضیحات / علت تغییر:</label>
                <input
                  type="text"
                  value={capitalReason}
                  onChange={(e) => setCapitalReason(e.target.value)}
                  placeholder="مثلاً واریز وجه جدید به بانک"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCapitalModal(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-md"
                >
                  تأیید و بازمحاسبه تعهدات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Rate Adjustment */}
      {showRateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-teal-400" />
              تغییر نرخ کارمزد ماهانه
            </h3>

            {rateError && (
              <div className="p-3 bg-rose-950/50 border border-rose-600/50 rounded-xl text-rose-300 text-xs">
                {rateError}
              </div>
            )}

            <form onSubmit={handleExecuteRateAdjustment} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">نرخ کارمزد جدید (درصد ماهانه):</label>
                <input
                  type="number"
                  step="0.1"
                  value={newFeeRate}
                  onChange={(e) => setNewFeeRate(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100 font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">علت تغییر نرخ:</label>
                <input
                  type="text"
                  value={rateReason}
                  onChange={(e) => setRateReason(e.target.value)}
                  placeholder="مثلاً توافق متمم جدید قرارداد"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowRateModal(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl shadow-md"
                >
                  تأیید و بازمحاسبه اقساط آتی
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
