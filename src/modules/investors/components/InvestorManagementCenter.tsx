/**
 * Investor Management Center & Executive Dashboard Main Container
 * (مرکز مدیریت و داشبورد اجرایی سرمایه‌گذاران - کامپوننت اصلی)
 */

import React, { useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  Clock,
  BarChart3,
  Coins,
  ShieldAlert,
  UserCheck,
  Building,
  Plus,
  Minus,
  MessageSquare,
  Users,
  Bell,
  Building2,
} from 'lucide-react';
import {
  InvestorContract,
  InvestorPaymentObligation,
  InvestorProfile,
  InvestorContractStatus,
  InvestorPaymentFrequency,
  InvestorReferral,
  InvestorReturnRequest,
  InvestorAuditLog,
} from '../types';
import { Person, UserRole, AppState, AccountSubsidiary, Check } from '../../../types';
import { InvestorDashboard } from './InvestorDashboard';
import { InvestorContractList } from './InvestorContractList';
import { InvestorPaymentScheduleView } from './InvestorPaymentScheduleView';
import { InvestorDetailPanel } from './InvestorDetailPanel';
import { InvestorAlertCenter } from './InvestorAlertCenter';
import { InvestorReferralManager } from './InvestorReferralManager';
import { InvestorInstitutionalManager } from './InvestorInstitutionalManager';
import { InvestorContractEngine } from '../investorContractEngine';
import { InvestorCommissionEngine } from '../investorCommissionEngine';
import { InvestorAlertEngine } from '../investorAlertEngine';
import { InvestorVoucherDraftRequest, InvestorAccountingMapper } from '../investorAccountingAdapter';
import { InvestorFinancialEvent } from '../types';
import { getCurrentJalaliDate } from '../../../utils/jalali';
import { InvestorAccountSelector } from './InvestorAccountSelector';

interface InvestorManagementCenterProps {
  appState?: AppState;
  onUpdateAppState?: (updater: (prev: AppState) => AppState) => void;
  currentUserRole?: UserRole | string;
  currentUserId?: string;
  contracts?: InvestorContract[];
  persons?: Person[];
  obligations?: InvestorPaymentObligation[];
  profiles?: InvestorProfile[];
  subsidiaries?: AccountSubsidiary[];
  onUpdateContracts?: (updatedContracts: InvestorContract[]) => void;
  onUpdateObligations?: (updatedObligations: InvestorPaymentObligation[]) => void;
  onRequestVoucherCreation?: (voucherDraft: InvestorVoucherDraftRequest) => void;
  onIssueInvestorCheck?: (
    obligationId: string,
    checkData: Omit<Check, 'id' | 'currentState' | 'history' | 'createdAt'>
  ) => void;
}

export const InvestorManagementCenter: React.FC<
  InvestorManagementCenterProps
> = ({
  appState,
  onUpdateAppState,
  currentUserRole = 'ADMIN',
  currentUserId = 'ADMIN',
  contracts: propsContracts,
  persons: propsPersons,
  obligations: propsObligations,
  profiles: propsProfiles,
  subsidiaries: propsSubsidiaries,
  onUpdateContracts: propsOnUpdateContracts,
  onUpdateObligations: propsOnUpdateObligations,
  onRequestVoucherCreation,
  onIssueInvestorCheck,
}) => {
  const currentDate = getCurrentJalaliDate();
  const [activeTab, setActiveTab] = useState<
    'dashboard' | 'contracts' | 'payments' | 'alerts' | 'referrals' | 'institutional' | 'reports' | 'detail'
  >('dashboard');

  const contracts = appState?.investorContracts || propsContracts || [];
  const checks = appState?.checks || [];
  const handleUpdateChecks = (updated: Check[]) => {
    if (onUpdateAppState) {
      onUpdateAppState((prev) => {
        const updatedVouchers = prev.vouchers.map(voucher => {
          const matchedCheck = updated.find(c => c.voucherId === voucher.id || voucher.id.startsWith(`v_auto_check_${c.id}_issued_`));
          
          if (matchedCheck && matchedCheck.isInvestorCommission) {
            const hasDeferredFee = voucher.entries.some(e => e.subsidiaryId === 'SUB_DEFERRED_FEE');
            if (!hasDeferredFee) {
              const newEntries = [
                {
                  subsidiaryId: 'SUB_DEFERRED_FEE',
                  debit: matchedCheck.amount,
                  credit: 0,
                  description: `ثبت کارمزد در انتظار تحقق بابت صدور چک کارمزد سرمایه‌گذار ${matchedCheck.checkNumber}`
                },
                {
                  subsidiaryId: 'SUB_CHECKS_PAY',
                  debit: 0,
                  credit: matchedCheck.amount,
                  description: `ثبت اسناد پرداختنی چک کارمزد سرمایه‌گذار ${matchedCheck.checkNumber}`
                }
              ];
              
              return {
                ...voucher,
                description: `سند مکانیزه چک شماره ${matchedCheck.checkNumber} - وضعیت: issued (کارمزد سرمایه‌گذار)`,
                entries: newEntries
              };
            }
          }
          return voucher;
        });

        return {
          ...prev,
          checks: updated,
          vouchers: updatedVouchers
        };
      });
    }
  };
  const persons = appState?.persons || propsPersons || [];
  const obligations = appState?.investorPaymentObligations || propsObligations || [];
  const profiles = appState?.investorProfiles || propsProfiles || [];
  const subsidiaries = appState?.subsidiaries || propsSubsidiaries || [];
  const referrals = appState?.investorReferrals || [];
  const returnRequests = appState?.investorReturnRequests || [];

  const handleUpdateContracts = (updated: InvestorContract[]) => {
    if (onUpdateAppState) {
      onUpdateAppState((prev) => ({ ...prev, investorContracts: updated }));
    } else if (propsOnUpdateContracts) {
      propsOnUpdateContracts(updated);
    }
  };

  const handleUpdateObligations = (updated: InvestorPaymentObligation[]) => {
    if (onUpdateAppState) {
      onUpdateAppState((prev) => ({ ...prev, investorPaymentObligations: updated }));
    } else if (propsOnUpdateObligations) {
      propsOnUpdateObligations(updated);
    }
  };

  const handleAddReferral = (newRef: InvestorReferral) => {
    if (onUpdateAppState) {
      onUpdateAppState((prev) => ({
        ...prev,
        investorReferrals: [newRef, ...(prev.investorReferrals || [])],
      }));
    }
  };

  const handleUpdateReferral = (updatedRef: InvestorReferral) => {
    if (onUpdateAppState) {
      onUpdateAppState((prev) => ({
        ...prev,
        investorReferrals: (prev.investorReferrals || []).map((r) =>
          r.id === updatedRef.id ? updatedRef : r
        ),
      }));
    }
  };

  const handleUpdateProfile = (updatedProf: InvestorProfile) => {
    if (onUpdateAppState) {
      onUpdateAppState((prev) => ({
        ...prev,
        investorProfiles: (prev.investorProfiles || []).map((p) =>
          p.id === updatedProf.id ? updatedProf : p
        ),
      }));
    }
  };

  const handleAddInstitutionalInvestor = (person: Person, profile: InvestorProfile) => {
    if (onUpdateAppState) {
      onUpdateAppState((prev) => ({
        ...prev,
        persons: [...prev.persons, person],
        investorProfiles: [...(prev.investorProfiles || []), profile],
      }));
    }
  };

  const smartAlerts = InvestorAlertEngine.generateAlerts(
    contracts,
    obligations,
    returnRequests,
    profiles,
    currentDate
  );

  const [selectedContract, setSelectedContract] =
    useState<InvestorContract | null>(null);

  // Modal State for New Contract Creation
  const [showNewContractModal, setShowNewContractModal] =
    useState<boolean>(false);
  const [newInvestorPersonId, setNewInvestorPersonId] = useState<string>('');
  const [newContractNumber, setNewContractNumber] = useState<string>('');
  const [newInitialCapital, setNewInitialCapital] =
    useState<number>(10000000000);
  const [newMonthlyFeeRate, setNewMonthlyFeeRate] = useState<number>(3.0);
  const [newFrequency, setNewFrequency] =
    useState<InvestorPaymentFrequency>('monthly');
  const [newContractDurationMonths, setNewContractDurationMonths] =
    useState<number>(12);
  const [newCashOrBankSubAccountId, setNewCashOrBankSubAccountId] =
    useState<string>('');
  const [newContractError, setNewContractError] = useState<string | null>(null);

  // Auto-scroll input into view on focus so mobile virtual keyboards don't obscure inputs
  const handleInputFocus = (e: React.FocusEvent<HTMLElement>) => {
    const target = e.currentTarget;
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  };

  // Helper for human readable duration display
  const formatDurationHuman = (months: number): string => {
    if (!months || months <= 0) return 'نامشخص';
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;

    if (years > 0 && remainingMonths > 0) {
      return `${years} سال و ${remainingMonths} ماه`;
    } else if (years > 0) {
      return `${years} سال کامل`;
    } else {
      return `${months} ماه`;
    }
  };

  // RBAC Access Control Check
  const isAdmin = currentUserRole === 'ADMIN';
  const isAccountant = currentUserRole === 'ACCOUNTANT';
  const isSalesAgent = currentUserRole === 'SALES_AGENT';

  if (isSalesAgent) {
    return (
      <div className="p-8 bg-slate-900 border border-slate-800 rounded-3xl text-center space-y-4 max-w-lg mx-auto my-12 shadow-2xl">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto animate-bounce" />
        <h3 className="text-xl font-bold text-white">
          عدم دسترسی به مرکز سرمایه‌گذاران
        </h3>
        <p className="text-sm text-slate-400">
          سطح دسترسی شما ({currentUserRole}) مجاز به مشاهده داده‌های محرمانه
          سرمایه‌گذاران و حسابداری مشارکت‌ها نمی‌باشد.
        </p>
      </div>
    );
  }

  const handleSelectContractForDetail = (contract: InvestorContract) => {
    setSelectedContract(contract);
    setActiveTab('detail');
  };

  const handleCreateNewContract = (e: React.FormEvent) => {
    e.preventDefault();
    setNewContractError(null);

    if (!newInvestorPersonId) {
      setNewContractError('لطفاً سرمایه‌گذار (شخص) را انتخاب نمایید.');
      return;
    }

    try {
      const generatedContractNumber =
        newContractNumber ||
        `INV-${currentDate.replace(/\//g, '')}-${Math.floor(
          100 + Math.random() * 900
        )}`;

      const { contract } = InvestorContractEngine.createInvestorContract({
        contractNumber: generatedContractNumber,
        investorPersonId: newInvestorPersonId,
        startDate: currentDate,
        initialCapital: newInitialCapital,
        monthlyFeeRate: newMonthlyFeeRate,
        paymentFrequency: newFrequency,
      });

      const generatedSchedule = InvestorCommissionEngine.generatePaymentSchedule(contract, newContractDurationMonths);

      const newObligations: InvestorPaymentObligation[] = generatedSchedule.map(
        (sch) => ({
          id: `OBLIG_${sch.id}`,
          investorPersonId: sch.investorPersonId,
          contractId: sch.contractId,
          obligationType: 'FEE',
          amount: sch.expectedAmount,
          createdAt: sch.createdAt,
          dueDate: sch.dueDate,
          status: 'PLANNED',
          paymentMethod: 'UNSPECIFIED',
          updatedAt: sch.updatedAt,
        })
      );

      handleUpdateContracts([contract, ...contracts]);
      handleUpdateObligations([...newObligations, ...obligations]);

      // ایجاد پیش‌نویس سند حسابداری برای دریافت سرمایه اولیه
      const investorPerson = persons.find((p) => p.id === newInvestorPersonId);
      if (investorPerson && newInitialCapital > 0) {
        const financialEvent: InvestorFinancialEvent = {
          id: `EVT_REC_${contract.id}_${Date.now()}`,
          contractId: contract.id,
          investorPersonId: newInvestorPersonId,
          eventType: 'INVESTMENT_RECEIVED',
          amount: newInitialCapital,
          eventDate: currentDate,
          description: `دریافت سرمایه طی قرارداد شماره ${contract.contractNumber} از ${investorPerson.name}`,
          cashOrBankSubAccountId: newCashOrBankSubAccountId || undefined,
        };

        const voucherDraft = InvestorAccountingMapper.createVoucherDraftRequest(
          financialEvent,
          investorPerson,
          contract
        );

        if (voucherDraft && onRequestVoucherCreation) {
          onRequestVoucherCreation(voucherDraft);
        }
      }

      setShowNewContractModal(false);
      setSelectedContract(contract);
      setActiveTab('detail');
    } catch (err: any) {
      setNewContractError(err.message || 'خطا در صدور قرارداد جدید.');
    }
  };

  const handleUpdateObligationItem = (
    updatedObligation: InvestorPaymentObligation,
    voucherDraft?: InvestorVoucherDraftRequest
  ) => {
    const updated = obligations.map((o) =>
      o.id === updatedObligation.id ? updatedObligation : o
    );
    handleUpdateObligations(updated);

    if (voucherDraft && onRequestVoucherCreation) {
      onRequestVoucherCreation(voucherDraft);
    }
  };

  const handleUpdateContractFromDetail = (
    updatedContract: InvestorContract,
    updatedObligations?: InvestorPaymentObligation[]
  ) => {
    const updatedContractList = contracts.map((c) =>
      c.id === updatedContract.id ? updatedContract : c
    );
    handleUpdateContracts(updatedContractList);

    if (updatedObligations) {
      const otherObligations = obligations.filter(
        (o) => o.contractId !== updatedContract.id
      );
      handleUpdateObligations([...otherObligations, ...updatedObligations]);
    }

    setSelectedContract(updatedContract);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Tab Navigation */}
      <div className="bg-slate-800/90 border border-slate-700 p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-600/20 border border-emerald-500/30 rounded-xl text-emerald-400">
            <Coins className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">
              مرکز مدیریت و داشبورد سرمایه‌گذاران
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              مدیریت هوشمند قراردادهای مشارکت، سررسیدها، تسویه‌های بانکی و گزارشات مالی
            </p>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="flex items-center gap-1 bg-slate-900/80 p-1.5 rounded-xl border border-slate-700/80 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'dashboard'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            داشبورد اجرایی
          </button>

          <button
            onClick={() => setActiveTab('contracts')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'contracts'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            قراردادها ({contracts.length})
          </button>

          <button
            onClick={() => setActiveTab('payments')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'payments'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-4 h-4" />
            کنترل پرداخت‌ها
          </button>

          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'alerts'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bell className="w-4 h-4" />
            هشدارهای هوشمند ({smartAlerts.length})
          </button>

          <button
            onClick={() => setActiveTab('referrals')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'referrals'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            معرفین ({referrals.length})
          </button>

          <button
            onClick={() => setActiveTab('institutional')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'institutional'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 className="w-4 h-4" />
            سرمایه‌گذاران سازمانی
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`px-3.5 py-2 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'reports'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            گزارشات تحلیلی
          </button>
        </div>
      </div>

      {/* Main Tab Content Routing */}
      {activeTab === 'dashboard' && (
        <InvestorDashboard
          contracts={contracts}
          persons={persons}
          obligations={obligations}
          onSelectTab={(tab) => setActiveTab(tab as any)}
          onSelectContract={(id) => {
            const found = contracts.find((c) => c.id === id);
            if (found) handleSelectContractForDetail(found);
          }}
        />
      )}

      {activeTab === 'alerts' && (
        <InvestorAlertCenter
          alerts={smartAlerts}
          onSelectAlertContract={(id) => {
            const found = contracts.find((c) => c.id === id);
            if (found) handleSelectContractForDetail(found);
          }}
        />
      )}

      {activeTab === 'referrals' && (
        <InvestorReferralManager
          referrals={referrals}
          persons={persons}
          currentUserId={currentUserId}
          onAddReferral={handleAddReferral}
          onUpdateReferral={handleUpdateReferral}
        />
      )}

      {activeTab === 'institutional' && (
        <InvestorInstitutionalManager
          profiles={profiles}
          persons={persons}
          onUpdateProfile={handleUpdateProfile}
          onAddInstitutionalInvestor={handleAddInstitutionalInvestor}
        />
      )}

      {activeTab === 'contracts' && (
        <InvestorContractList
          contracts={contracts}
          persons={persons}
          onSelectContract={handleSelectContractForDetail}
          onCreateNewContract={() => setShowNewContractModal(true)}
        />
      )}

      {activeTab === 'payments' && (
        <InvestorPaymentScheduleView
          obligations={obligations}
          contracts={contracts}
          persons={persons}
          checks={checks}
          subsidiaries={subsidiaries}
          onUpdateObligation={handleUpdateObligationItem}
          onUpdateChecks={handleUpdateChecks}
          onIssueInvestorCheck={onIssueInvestorCheck}
        />
      )}

      {activeTab === 'detail' && selectedContract && (
        <InvestorDetailPanel
          contract={selectedContract}
          person={persons.find((p) => p.id === selectedContract.investorPersonId)}
          obligations={obligations}
          subsidiaries={subsidiaries}
          persons={persons}
          onBack={() => setActiveTab('contracts')}
          onUpdateContract={handleUpdateContractFromDetail}
          onRequestVoucherCreation={onRequestVoucherCreation}
        />
      )}

      {activeTab === 'reports' && (
        <div className="bg-slate-800/90 border border-slate-700 p-6 rounded-2xl space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-700 pb-3">
            <BarChart3 className="w-5 h-5 text-emerald-400" />
            گزارش‌های مدیریتی و تحلیلی سرمایه‌گذاران
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {/* Report 1: Capital Absorption */}
            <div className="p-4 bg-slate-900/60 border border-slate-700/60 rounded-xl space-y-2">
              <h3 className="font-bold text-slate-200">۱. گزارش سرمایه جذب‌شده</h3>
              <p className="text-slate-400">
                مجموع سرمایه جذب‌شده از ابتداء:{' '}
                <span className="font-extrabold text-emerald-400">
                  {contracts.reduce((s, c) => s + c.initialCapital, 0).toLocaleString()} ریال
                </span>
              </p>
            </div>

            {/* Report 2: Future Obligations */}
            <div className="p-4 bg-slate-900/60 border border-slate-700/60 rounded-xl space-y-2">
              <h3 className="font-bold text-slate-200">۲. گزارش تعهدات آینده کارمزد</h3>
              <p className="text-slate-400">
                مجموع تعهدات کارمزد برنامه‌ریزی‌شده:{' '}
                <span className="font-extrabold text-amber-300">
                  {obligations
                    .filter((o) => o.status === 'PLANNED' || o.status === 'DUE')
                    .reduce((s, o) => s + o.amount, 0)
                    .toLocaleString()}{' '}
                  ریال
                </span>
              </p>
            </div>

            {/* Report 3: Commission Expense */}
            <div className="p-4 bg-slate-900/60 border border-slate-700/60 rounded-xl space-y-2">
              <h3 className="font-bold text-slate-200">۳. گزارش هزینه کارمزد سرمایه‌گذاران</h3>
              <p className="text-slate-400">
                کل کارمزد پرداخت‌شده واقعی:{' '}
                <span className="font-extrabold text-teal-300">
                  {obligations
                    .filter((o) => o.status === 'PAID')
                    .reduce((s, o) => s + o.amount, 0)
                    .toLocaleString()}{' '}
                  ریال
                </span>
              </p>
            </div>

            {/* Report 4 & 5: Profitability Analysis */}
            <div className="p-4 bg-slate-900/60 border border-slate-700/60 rounded-xl space-y-2">
              <h3 className="font-bold text-slate-200">۴. گزارش سودآوری سرمایه استفاده‌شده</h3>
              <p className="text-slate-400">
                ⚠️ این گزارش صرفاً تحلیلی بوده و هیچ دخل و تصرفی در اسناد حسابداری ایجاد نمی‌کند.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Contract Creation */}
      {showNewContractModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-start sm:items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto">
          <div className="my-auto max-h-[92vh] overflow-y-auto bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg p-4 sm:p-6 space-y-4 shadow-2xl pb-12 sm:pb-6">
            <div className="flex items-center justify-between border-b border-slate-700/80 pb-3">
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-400" />
                صدور قرارداد سرمایه‌گذاری جدید
              </h3>
              <button
                type="button"
                onClick={() => setShowNewContractModal(false)}
                className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded-lg hover:bg-slate-700 transition-colors"
              >
                ✕
              </button>
            </div>

            {newContractError && (
              <div className="p-3 bg-rose-950/50 border border-rose-600/50 rounded-xl text-rose-300 text-xs">
                {newContractError}
              </div>
            )}

            <form onSubmit={handleCreateNewContract} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">انتخاب سرمایه‌گذار (شخص):</label>
                <select
                  value={newInvestorPersonId}
                  onFocus={handleInputFocus}
                  onChange={(e) => setNewInvestorPersonId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-emerald-500 focus:outline-none"
                  required
                >
                  <option value="">-- یک شخص را انتخاب کنید --</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.mobile || p.nationalId || p.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">شماره قرارداد (اختیاری):</label>
                <input
                  type="text"
                  value={newContractNumber}
                  onFocus={handleInputFocus}
                  onChange={(e) => setNewContractNumber(e.target.value)}
                  placeholder="خودکار تولید می‌شود در صورت خالی بودن"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-300 font-medium">مبلغ سرمایه اولیه (ریال):</label>
                  {newInitialCapital > 0 && (
                    <span className="text-[11px] text-amber-400">
                      ({Math.floor(newInitialCapital / 10).toLocaleString('fa-IR')} تومان)
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  value={newInitialCapital}
                  onFocus={handleInputFocus}
                  onChange={(e) => setNewInitialCapital(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-bold focus:border-emerald-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <InvestorAccountSelector
                  label="حساب واریزکننده / دریافت‌کننده (بانک / صندوق / اشخاص):"
                  subsidiaries={subsidiaries}
                  persons={persons}
                  value={newCashOrBankSubAccountId}
                  onChange={(selectedId) => setNewCashOrBankSubAccountId(selectedId)}
                  defaultBankLabel="-- بانک اصلی پیش‌فرض (SUB_BANK_MAIN) --"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-medium">نرخ کارمزد ماهانه (٪):</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newMonthlyFeeRate}
                    onFocus={handleInputFocus}
                    onChange={(e) => setNewMonthlyFeeRate(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 font-bold focus:border-emerald-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-medium">دوره پرداخت:</label>
                  <select
                    value={newFrequency}
                    onFocus={handleInputFocus}
                    onChange={(e) =>
                      setNewFrequency(e.target.value as InvestorPaymentFrequency)
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="monthly">ماهانه</option>
                    <option value="bimonthly">دو ماهه</option>
                    <option value="quarterly">سه ماهه (فصلی)</option>
                    <option value="semi_annual">شش ماهه</option>
                    <option value="annual">سالانه</option>
                  </select>
                </div>
              </div>

              {/* Optimized Contract Duration Field with Presets, Steppers, & Auto-scroll */}
              <div className="space-y-2 bg-slate-900/80 p-3 rounded-xl border border-slate-700/80">
                <div className="flex items-center justify-between">
                  <label className="text-slate-200 font-bold flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-emerald-400" />
                    مدت قرارداد (ماه):
                  </label>
                  <span className="text-[11px] text-emerald-400 font-semibold bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-800/60">
                    معادل: {formatDurationHuman(newContractDurationMonths)}
                  </span>
                </div>

                {/* Quick Selection Preset Buttons */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    { label: '۳ ماه', value: 3 },
                    { label: '۶ ماه', value: 6 },
                    { label: '۱۲ ماه (۱ سال)', value: 12 },
                    { label: '۲۴ ماه (۲ سال)', value: 24 },
                    { label: '۳۶ ماه (۳ سال)', value: 36 },
                  ].map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setNewContractDurationMonths(preset.value)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        newContractDurationMonths === preset.value
                          ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/50 border border-emerald-400 scale-[1.02]'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Steppers & Numeric Input */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setNewContractDurationMonths((prev) => Math.max(1, (prev || 1) - 1))}
                    className="w-10 h-10 flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 font-bold text-lg rounded-xl border border-slate-700 shrink-0 select-none transition-colors"
                    title="کاهش یک ماه"
                  >
                    <Minus className="w-4 h-4" />
                  </button>

                  <div className="relative flex-1">
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={newContractDurationMonths || ''}
                      onFocus={handleInputFocus}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString());
                        const val = parseInt(raw, 10);
                        setNewContractDurationMonths(isNaN(val) ? 0 : val);
                      }}
                      className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl p-2.5 text-center text-slate-100 font-bold text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      placeholder="تعداد ماه..."
                      required
                    />
                    <span className="absolute left-3 top-2.5 text-xs text-slate-400 pointer-events-none">
                      ماه
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setNewContractDurationMonths((prev) => (prev || 0) + 1)}
                    className="w-10 h-10 flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 font-bold text-lg rounded-xl border border-slate-700 shrink-0 select-none transition-colors"
                    title="افزایش یک ماه"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-700/80">
                <button
                  type="button"
                  onClick={() => setShowNewContractModal(false)}
                  className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium rounded-xl transition-colors"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  onFocus={handleInputFocus}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-900/30 transition-all flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  صدور قرارداد و تولید برنامه‌زمانی
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
