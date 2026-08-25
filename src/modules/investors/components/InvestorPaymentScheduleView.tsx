/**
 * Investor Payment Control Center
 * (مرکز کنترل پرداخت‌ها، تسویه‌ها و سررسیدهای سرمایه‌گذاران)
 */

import React, { useState, useMemo } from 'react';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  CreditCard,
  Building,
  Search,
  Filter,
  ArrowUpRight,
  ShieldAlert,
  FileCheck2,
  Send,
  Plus,
} from 'lucide-react';
import {
  InvestorContract,
  InvestorPaymentObligation,
  InvestorObligationStatus,
  InvestorPaymentMethod,
} from '../types';
import { Person, AccountSubsidiary, Check } from '../../../types';
import {
  InvestorSettlementEngine,
  BankSettlementData,
  IssuedCheckInfo,
} from '../investorSettlementEngine';
import {
  InvestorAccountingMapper,
  InvestorVoucherDraftRequest,
} from '../investorAccountingAdapter';
import { getCurrentJalaliDate } from '../../../utils/jalali';
import { InvestorAccountSelector } from './InvestorAccountSelector';

interface InvestorPaymentScheduleViewProps {
  obligations: InvestorPaymentObligation[];
  contracts: InvestorContract[];
  persons: Person[];
  checks?: Check[];
  subsidiaries?: AccountSubsidiary[];
  onUpdateObligation: (
    updatedObligation: InvestorPaymentObligation,
    voucherDraft?: InvestorVoucherDraftRequest
  ) => void;
  onUpdateChecks?: (updatedChecks: Check[]) => void;
  onIssueInvestorCheck?: (
    obligationId: string,
    checkData: Omit<Check, 'id' | 'currentState' | 'history' | 'createdAt'>
  ) => void;
}

export const InvestorPaymentScheduleView: React.FC<
  InvestorPaymentScheduleViewProps
> = ({ obligations, contracts, persons, checks = [], subsidiaries = [], onUpdateObligation, onUpdateChecks, onIssueInvestorCheck }) => {
  const currentDate = getCurrentJalaliDate();
  const [activeSubTab, setActiveSubTab] = useState<
    'TODAY' | 'UPCOMING' | 'OVERDUE' | 'ALL'
  >('TODAY');

  const [searchTerm, setSearchTerm] = useState('');
  const [methodFilter, setMethodFilter] = useState<
    InvestorPaymentMethod | 'ALL'
  >('ALL');

  // Modal State for Bank Settlement
  const [settlingObligation, setSettlingObligation] =
    useState<InvestorPaymentObligation | null>(null);
  const [paymentDate, setPaymentDate] = useState(currentDate);
  const [bankName, setBankName] = useState('بانک ملی');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [destinationAccount, setDestinationAccount] = useState('');
  const [settlementSubAccountId, setSettlementSubAccountId] = useState<string>('');
  const [settlementError, setSettlementError] = useState<string | null>(null);

  // Modal State for Linking Issued Check
  const [checkLinkingObligation, setCheckLinkingObligation] =
    useState<InvestorPaymentObligation | null>(null);
  const [selectedCheckId, setSelectedCheckId] = useState('');
  const [checkError, setCheckError] = useState<string | null>(null);

  const [checkModalTab, setCheckModalTab] = useState<'link' | 'issue'>('link');
  const [newCheckNumber, setNewCheckNumber] = useState('');
  const [newBankName, setNewBankName] = useState('بانک ملی');
  const [newCheckAmount, setNewCheckAmount] = useState('');
  const [newCheckDueDate, setNewCheckDueDate] = useState('');

  const handleIssueNewCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkLinkingObligation) return;
    setCheckError(null);

    try {
      if (!newCheckNumber || !newBankName || !newCheckAmount) {
        throw new Error('لطفاً شماره چک، نام بانک و مبلغ را وارد کنید.');
      }

      const amt = Number(newCheckAmount.replace(/,/g, ''));
      if (isNaN(amt) || amt <= 0) {
        throw new Error('مبلغ چک نامعتبر است.');
      }

      if (onIssueInvestorCheck) {
        onIssueInvestorCheck(checkLinkingObligation.id, {
          type: 'paid',
          checkNumber: newCheckNumber,
          bankName: newBankName,
          amount: amt,
          dueDate: newCheckDueDate || checkLinkingObligation.dueDate,
          personId: checkLinkingObligation.investorPersonId,
          isInvestorCommission: true,
          investorObligationId: checkLinkingObligation.id,
          investorContractId: checkLinkingObligation.contractId,
          isApproved: true,
        });
        setCheckLinkingObligation(null);
      } else {
        throw new Error('قابلیت صدور چک سرمایه‌گذار در سیستم فعال نیست.');
      }
    } catch (err: any) {
      setCheckError(err.message || 'خطا در صدور چک.');
    }
  };

  const dailyTask = useMemo(
    () =>
      InvestorSettlementEngine.generateDailySettlementTaskList(
        obligations,
        currentDate
      ),
    [obligations, currentDate]
  );

  const displayedObligations = useMemo(() => {
    let list: InvestorPaymentObligation[] = [];

    switch (activeSubTab) {
      case 'TODAY':
        list = dailyTask.dueTodayItems;
        break;
      case 'UPCOMING':
        list = dailyTask.upcomingItems;
        break;
      case 'OVERDUE':
        list = dailyTask.overdueItems;
        break;
      case 'ALL':
      default:
        list = obligations;
        break;
    }

    return list.filter((item) => {
      const contract = contracts.find((c) => c.id === item.contractId);
      const person = persons.find((p) => p.id === item.investorPersonId);
      const term = searchTerm.toLowerCase();

      const matchesSearch =
        (person?.name || '').toLowerCase().includes(term) ||
        (contract?.contractNumber || '').toLowerCase().includes(term) ||
        item.dueDate.includes(term) ||
        (item.checkNumber || '').includes(term);

      const matchesMethod =
        methodFilter === 'ALL' || item.paymentMethod === methodFilter;

      return matchesSearch && matchesMethod;
    });
  }, [
    activeSubTab,
    dailyTask,
    obligations,
    contracts,
    persons,
    searchTerm,
    methodFilter,
  ]);

  const handleExecuteBankSettlement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlingObligation) return;
    setSettlementError(null);

    try {
      const settlementData: BankSettlementData = {
        paymentDate,
        bankName,
        trackingNumber,
        destinationAccount,
      };

      const { updatedObligation, notificationPayload } =
        InvestorSettlementEngine.registerBankSettlement(
          settlingObligation,
          settlementData
        );

      const person = persons.find(
        (p) => p.id === settlingObligation.investorPersonId
      );
      const contract = contracts.find(
        (c) => c.id === settlingObligation.contractId
      );

      let voucherDraft: InvestorVoucherDraftRequest | undefined;

      if (person && contract) {
        voucherDraft = InvestorAccountingMapper.createVoucherDraftRequest(
          {
            id: `EVT_PAID_${Date.now()}`,
            contractId: contract.id,
            investorPersonId: person.id,
            eventType: 'COMMISSION_PAID',
            amount: updatedObligation.amount,
            eventDate: paymentDate,
            description: `پرداخت کارمزد سرمایه‌گذاری طی قرارداد ${contract.contractNumber} - شماره پیگیری ${trackingNumber}`,
            cashOrBankSubAccountId: settlementSubAccountId || undefined,
          },
          person,
          contract
        );
      }

      onUpdateObligation(updatedObligation, voucherDraft);
      setSettlingObligation(null);
    } catch (err: any) {
      setSettlementError(err.message || 'خطا در ثبت تسویه بانکی.');
    }
  };

  const handleExecuteCheckLinking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkLinkingObligation) return;
    setCheckError(null);

    try {
      if (!selectedCheckId) {
        throw new Error('لطفاً یک چک پرداختنی واقعی از سیستم انتخاب کنید.');
      }

      const targetCheck = checks.find((c) => c.id === selectedCheckId);
      if (!targetCheck) {
        throw new Error('چک انتخاب شده در سیستم یافت نشد.');
      }

      const checkInfo: IssuedCheckInfo = {
        checkId: targetCheck.id,
        checkNumber: targetCheck.checkNumber,
        checkDueDate: targetCheck.dueDate,
        bankName: targetCheck.bankName,
      };

      const updatedObligation =
        InvestorSettlementEngine.linkIssuedCheckToObligation(
          checkLinkingObligation,
          checkInfo
        );

      onUpdateObligation(updatedObligation);

      if (onUpdateChecks) {
        const updatedChecks = checks.map((c) => {
          if (c.id === targetCheck.id) {
            return {
              ...c,
              isInvestorCommission: true,
              investorObligationId: checkLinkingObligation.id,
              investorContractId: checkLinkingObligation.contractId,
            };
          }
          return c;
        });
        onUpdateChecks(updatedChecks);
      }

      setCheckLinkingObligation(null);
      setSelectedCheckId('');
    } catch (err: any) {
      setCheckError(err.message || 'خطا در اتصال چک.');
    }
  };

  return (
    <div className="space-y-6">
      {/* SubTab Navigation Headers */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-800/90 p-2 rounded-2xl border border-slate-700">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('TODAY')}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 ${
              activeSubTab === 'TODAY'
                ? 'bg-amber-600 text-white shadow-md'
                : 'text-slate-300 hover:bg-slate-700/60'
            }`}
          >
            <Clock className="w-4 h-4" />
            سررسیدهای امروز ({dailyTask.dueTodayItems.length})
          </button>

          <button
            onClick={() => setActiveSubTab('OVERDUE')}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 ${
              activeSubTab === 'OVERDUE'
                ? 'bg-rose-600 text-white shadow-md'
                : 'text-slate-300 hover:bg-slate-700/60'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            عقب‌افتاده‌ها ({dailyTask.overdueItems.length})
          </button>

          <button
            onClick={() => setActiveSubTab('UPCOMING')}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 ${
              activeSubTab === 'UPCOMING'
                ? 'bg-teal-600 text-white shadow-md'
                : 'text-slate-300 hover:bg-slate-700/60'
            }`}
          >
            <Calendar className="w-4 h-4" />۷ روز آینده (
            {dailyTask.upcomingItems.length})
          </button>

          <button
            onClick={() => setActiveSubTab('ALL')}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 ${
              activeSubTab === 'ALL'
                ? 'bg-slate-700 text-white border border-slate-600 shadow-md'
                : 'text-slate-400 hover:bg-slate-700/60'
            }`}
          >
            کل برنامه‌ زمان‌بندی ({obligations.length})
          </button>
        </div>

        {/* Filter inputs */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="جستجوی نام یا قرارداد..."
              className="bg-slate-900/80 border border-slate-700 rounded-xl pr-9 pl-3 py-1.5 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* Obligations List */}
      <div className="bg-slate-800/90 border border-slate-700 rounded-2xl overflow-hidden shadow-sm">
        {displayedObligations.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <div>هیچ موردی در این بخش برای نمایش وجود ندارد.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm text-slate-300">
              <thead className="bg-slate-900/80 text-xs font-semibold text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="p-3.5">سرمایه‌گذار / قرارداد</th>
                  <th className="p-3.5">نوع تعهد</th>
                  <th className="p-3.5">مبلغ تعهد (ریال)</th>
                  <th className="p-3.5">تاریخ سررسید</th>
                  <th className="p-3.5">روش پرداخت</th>
                  <th className="p-3.5">وضعیت</th>
                  <th className="p-3.5 text-center">اقدام تسویه / اتصال</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {displayedObligations.map((item) => {
                  const person = persons.find(
                    (p) => p.id === item.investorPersonId
                  );
                  const contract = contracts.find(
                    (c) => c.id === item.contractId
                  );

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-700/40 transition-colors"
                    >
                      <td className="p-3.5">
                        <div className="font-bold text-slate-100">
                          {person?.name || 'نامشخص'}
                        </div>
                        <div className="text-xs text-emerald-400 mt-0.5">
                          قرارداد: {contract?.contractNumber || item.contractId}
                        </div>
                      </td>

                      <td className="p-3.5">
                        <span className="px-2 py-0.5 bg-slate-700 text-slate-200 rounded text-xs">
                          {item.obligationType === 'FEE'
                            ? 'کارمزد دوره‌ای'
                            : item.obligationType === 'CAPITAL_PRINCIPAL'
                            ? 'استرداد اصل سرمایه'
                            : 'اصلاحیه قرارداد'}
                        </span>
                      </td>

                      <td className="p-3.5 font-extrabold text-white">
                        {item.amount.toLocaleString()}
                      </td>

                      <td className="p-3.5 font-mono text-xs text-amber-300">
                        {item.dueDate}
                      </td>

                      <td className="p-3.5 text-xs">
                        {item.paymentMethod === 'CHECK' ? (
                          <span className="text-cyan-300 flex items-center gap-1">
                            <CreditCard className="w-3.5 h-3.5" />
                            چک: {item.checkNumber || '---'}
                          </span>
                        ) : item.paymentMethod === 'BANK_TRANSFER' ? (
                          <span className="text-teal-300 flex items-center gap-1">
                            <Building className="w-3.5 h-3.5" />
                            حواله بانکی
                          </span>
                        ) : (
                          <span className="text-slate-400">تعیین نشده</span>
                        )}
                      </td>

                      <td className="p-3.5">
                        {item.status === 'PAID' ? (
                          <span className="px-2.5 py-1 bg-emerald-900/50 text-emerald-300 border border-emerald-700/50 rounded-lg text-xs font-semibold">
                            تسویه شده ({item.paymentDate})
                          </span>
                        ) : item.status === 'CANCELLED' ? (
                          <span className="px-2.5 py-1 bg-slate-900/50 text-slate-400 border border-slate-700 rounded-lg text-xs font-semibold">
                            لغو شده
                          </span>
                        ) : item.dueDate < currentDate ? (
                          <span className="px-2.5 py-1 bg-rose-900/50 text-rose-300 border border-rose-700/50 rounded-lg text-xs font-semibold animate-pulse">
                            عقب‌افتاده
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 bg-amber-900/50 text-amber-300 border border-amber-700/50 rounded-lg text-xs font-semibold">
                            در انتظار تسویه
                          </span>
                        )}
                      </td>

                      <td className="p-3.5 text-center">
                        {item.status !== 'PAID' &&
                        item.status !== 'CANCELLED' ? (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => {
                                setSettlingObligation(item);
                                setPaymentDate(currentDate);
                                setTrackingNumber('');
                              }}
                              className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-medium transition-all shadow"
                            >
                              پرداخت بانکی
                            </button>
                            <button
                              onClick={() => {
                                setCheckLinkingObligation(item);
                                setSelectedCheckId('');
                                setCheckModalTab('link');
                                setNewCheckNumber('');
                                setNewBankName('بانک ملی');
                                setNewCheckAmount(item.amount.toString());
                                setNewCheckDueDate(item.dueDate);
                              }}
                              className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-all"
                            >
                              اتصال / صدور چک
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">---</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Bank Settlement Registration */}
      {settlingObligation && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Building className="w-5 h-5 text-emerald-400" />
              ثبت پرداخت بانکی کارمزد / سرمایه
            </h3>

            <div className="p-3 bg-slate-900/60 rounded-xl text-xs space-y-1 text-slate-300">
              <div>
                مبلغ تعهد:{' '}
                <span className="font-bold text-emerald-400">
                  {settlingObligation.amount.toLocaleString()} ریال
                </span>
              </div>
              <div>تاریخ سررسید: {settlingObligation.dueDate}</div>
            </div>

            {settlementError && (
              <div className="p-3 bg-rose-950/50 border border-rose-600/50 rounded-xl text-rose-300 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {settlementError}
              </div>
            )}

            <form
              onSubmit={handleExecuteBankSettlement}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block text-slate-300 mb-1">
                  تاریخ واقعی پرداخت:
                </label>
                <input
                  type="text"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">نام بانک:</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">
                  شماره پیگیری / ارجاع:
                </label>
                <input
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="مثلاً TRK-990123"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                  required
                />
              </div>

              <div>
                <InvestorAccountSelector
                  label="حساب پرداخت‌کننده (بانک / صندوق / اشخاص):"
                  subsidiaries={subsidiaries}
                  persons={persons}
                  value={settlementSubAccountId}
                  onChange={(selectedId) => setSettlementSubAccountId(selectedId)}
                  defaultBankLabel="-- بانک اصلی پیش‌فرض (SUB_BANK_MAIN) --"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">
                  حساب مقصد سرمایه‌گذار:
                </label>
                <input
                  type="text"
                  value={destinationAccount}
                  onChange={(e) => setDestinationAccount(e.target.value)}
                  placeholder="شماره شبا یا حساب"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setSettlingObligation(null)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-md"
                >
                  تأیید و ثبت تسویه بانکی
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Check Linking / Issuing */}
      {checkLinkingObligation && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-cyan-400" />
              مدیریت چک تعهد سرمایه‌گذار
            </h3>

            {checkError && (
              <div className="p-3 bg-rose-950/50 border border-rose-600/50 rounded-xl text-rose-300 text-xs">
                {checkError}
              </div>
            )}

            <div className="flex bg-slate-900 p-1 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => setCheckModalTab('link')}
                className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${checkModalTab === 'link' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
              >
                انتخاب چک موجود
              </button>
              <button
                type="button"
                onClick={() => setCheckModalTab('issue')}
                className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${checkModalTab === 'issue' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
              >
                صدور چک جدید (کارمزد)
              </button>
            </div>

            {checkModalTab === 'link' ? (
              <form
                onSubmit={handleExecuteCheckLinking}
                className="space-y-3 text-xs"
              >
                <div>
                  <label className="block text-slate-300 mb-1">انتخاب چک پرداختنی ثبت‌شده:</label>
                  <select
                    value={selectedCheckId}
                    onChange={(e) => setSelectedCheckId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                    required
                  >
                    <option value="">-- انتخاب چک پرداختنی از فهرست سیستم --</option>
                    {checks
                      .filter((c) => c.type === 'paid')
                      .map((chk) => (
                        <option key={chk.id} value={chk.id}>
                          چک شماره: {chk.checkNumber} | مبلغ: {chk.amount.toLocaleString()} ریال | سررسید: {chk.dueDate} | بانک: {chk.bankName}
                        </option>
                      ))}
                  </select>
                  {checks.filter((c) => c.type === 'paid').length === 0 && (
                    <p className="text-[11px] text-amber-400 mt-1">
                      هیچ چک پرداختنی در سیستم ثبت نشده است. ابتدا از بخش مدیریت چک‌ها، چک پرداختنی ثبت کنید.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setCheckLinkingObligation(null)}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl shadow-md"
                  >
                    تأیید و اتصال چک
                  </button>
                </div>
              </form>
            ) : (
              <form
                onSubmit={handleIssueNewCheck}
                className="space-y-3 text-xs"
              >
                <div>
                  <label className="block text-slate-300 mb-1">شماره چک:</label>
                  <input
                    type="text"
                    value={newCheckNumber}
                    onChange={(e) => setNewCheckNumber(e.target.value)}
                    placeholder="مثلاً 778811"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">نام بانک:</label>
                  <input
                    type="text"
                    value={newBankName}
                    onChange={(e) => setNewBankName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">مبلغ (ریال):</label>
                  <input
                    type="text"
                    value={newCheckAmount}
                    onChange={(e) => setNewCheckAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">تاریخ سررسید (YYYY/MM/DD):</label>
                  <input
                    type="text"
                    value={newCheckDueDate}
                    onChange={(e) => setNewCheckDueDate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-slate-100"
                    required
                  />
                </div>
                <div className="p-2.5 bg-cyan-950/40 border border-cyan-800/50 rounded-xl text-cyan-200 text-[11px]">
                  نکته: با صدور چک جدید کارمزد، سند اولیه به‌طور خودکار ثبت می‌شود: بدهکار «کارمزد در انتظار تحقق» و بستانکار «اسناد پرداختنی» (بدون اثر بر حساب شخص).
                </div>
                <div className="flex items-center justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setCheckLinkingObligation(null)}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-md"
                  >
                    صدور و ثبت چک کارمزد
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
