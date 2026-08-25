/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, Users, Search, RefreshCw, Eye, ArrowLeft, Calendar, 
  Coins, FileText, AlertCircle, TrendingUp, HelpCircle, ChevronRight, Scale, Clock, Play, CheckCircle, Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppState, Person, BusinessPartner, Invoice } from '../types';
import { SalesAgentCreditControlEngine } from '../modules/creditControl/creditControlEngine';
import { resolvePartnerCreditRules } from '../utils/partnerProcess';
import { 
  CreditControlEngineInput, 
  CreditControlEngineOutput, 
  InvoiceBalance, 
  CreditControlDraft 
} from '../modules/creditControl/creditControl.types';
import { getCurrentJalaliDate } from '../utils/jalali';

interface SalesAgentCreditControlProps {
  state: AppState;
  setState: (newStateOrUpdater: AppState | ((prev: AppState) => AppState)) => void;
}

export default function SalesAgentCreditControl({ state, setState }: SalesAgentCreditControlProps) {
  const [activeSubTab, setActiveSubTab] = useState<'monitoring' | 'daily_cycle'>('monitoring');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Daily cycle specific states
  const [targetDate, setTargetDate] = useState(getCurrentJalaliDate());
  const [feedback, setFeedback] = useState<{ type: 'success' | 'warning' | 'info'; message: string } | null>(null);
  const [draftSearchQuery, setDraftSearchQuery] = useState('');
  const [selectedDraftAgentFilter, setSelectedDraftAgentFilter] = useState<string>('all');

  // 1. Identify all eligible sales agents
  const agents = useMemo(() => {
    const agentPersons = (state.persons || []).filter(p => p.isAgent);
    const partnerPersons = (state.businessPartners || [])
      .map(bp => (state.persons || []).find(p => p.id === bp.personId))
      .filter((p): p is Person => !!p);

    const uniqueAgentsMap = new Map<string, Person>();
    [...agentPersons, ...partnerPersons].forEach(p => {
      uniqueAgentsMap.set(p.id, p);
    });

    return Array.from(uniqueAgentsMap.values());
  }, [state.persons, state.businessPartners]);

  // 2. Process engine results for all agents (Real-time monitoring calculations)
  const processedData = useMemo(() => {
    const resultsMap = new Map<string, {
      agent: Person;
      partner: BusinessPartner;
      output: CreditControlEngineOutput;
    }>();

    agents.forEach(agent => {
      const rules = resolvePartnerCreditRules(agent, state.businessPartners);
      const partner = (state.businessPartners || []).find(bp => bp.personId === agent.id || bp.id === agent.id) || ({
        id: `BP_${agent.id}`,
        personId: agent.id,
        status: 'active' as const,
        agencyType: 'INSTALLMENT_ONLY' as any,
        roles: [],
        profile: {
          partnerId: `BP_${agent.id}`,
          contractStatus: 'active',
          creditLimit: rules.maxCreditLimit
        },
        creditExtension: {
          creditRules: {
            maxCreditLimit: rules.maxCreditLimit,
            defaultInstallmentDays: rules.defaultInstallmentDays,
            penaltyRatePerMonth: rules.penaltyRatePerMonth
          }
        },
        branches: [],
        createdAt: new Date().toISOString(),
        createdBy: 'system'
      } as BusinessPartner);

      const policy = SalesAgentCreditControlEngine.createDefaultPolicy(agent.id, rules.maxCreditLimit);
      policy.paymentTermDays = rules.defaultInstallmentDays;
      policy.lateFeeDailyPercentage = rules.penaltyRatePerMonth;

      const input: CreditControlEngineInput = {
        agent,
        partner,
        policy,
        invoices: state.invoices || [],
        vouchers: state.vouchers || [],
        checks: state.checks || [],
        currentDate: getCurrentJalaliDate()
      };

      const output = SalesAgentCreditControlEngine.process(input);
      resultsMap.set(agent.id, {
        agent,
        partner,
        output
      });
    });

    return resultsMap;
  }, [agents, state.invoices, state.vouchers, state.checks, refreshTrigger]);

  // 3. Filtered list for primary display
  const filteredAgentsList = useMemo(() => {
    return agents.filter(agent => {
      const matchesSearch = 
        agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (agent.code || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (agent.agentDetails?.storeName || '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    });
  }, [agents, searchQuery]);

  // Selected agent drill-down calculations
  const selectedAgentData = useMemo(() => {
    if (!selectedAgentId) return null;
    return processedData.get(selectedAgentId) || null;
  }, [selectedAgentId, processedData]);

  // Drafts selectors & statistics
  const existingDrafts = useMemo(() => {
    return state.creditControlDrafts || [];
  }, [state.creditControlDrafts]);

  const filteredDrafts = useMemo(() => {
    return existingDrafts.filter(draft => {
      const agent = agents.find(a => a.id === draft.agentId);
      const agentName = agent ? agent.name : '';
      const matchesSearch = 
        draft.id.toLowerCase().includes(draftSearchQuery.toLowerCase()) ||
        draft.calculationDate.includes(draftSearchQuery) ||
        draft.invoiceNumber.toString().includes(draftSearchQuery) ||
        agentName.toLowerCase().includes(draftSearchQuery.toLowerCase());
      
      const matchesAgent = selectedDraftAgentFilter === 'all' || draft.agentId === selectedDraftAgentFilter;

      return matchesSearch && matchesAgent;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [existingDrafts, draftSearchQuery, selectedDraftAgentFilter, agents]);

  const draftSummaryStats = useMemo(() => {
    const totalAmount = existingDrafts.reduce((sum, d) => sum + d.penaltyAmount, 0);
    const uniqueDates = new Set(existingDrafts.map(d => d.calculationDate)).size;
    return {
      count: existingDrafts.length,
      totalAmount,
      uniqueDates
    };
  }, [existingDrafts]);

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Run the daily cycle engine
  const handleRunDailyCycle = () => {
    setFeedback(null);
    if (!targetDate || targetDate.length < 10) {
      setFeedback({ type: 'warning', message: 'لطفاً تاریخ کاری معتبر با فرمت YYYY/MM/DD وارد نمایید.' });
      return;
    }

    // Run the daily cycle
    const currentDrafts = state.creditControlDrafts || [];
    const newDrafts = SalesAgentCreditControlEngine.runDailyCycle(state, targetDate, currentDrafts);

    if (newDrafts.length === 0) {
      setFeedback({ 
        type: 'info', 
        message: `اجرای چرخه روزانه برای تاریخ ${targetDate} به پایان رسید. به دلیل طراحی همان‌توان (Idempotent)، هیچ پیش‌نویس جریمه جدیدی تولید نشد (تمامی موارد قبلاً ایجاد شده بودند، یا فاکتورها فاقد مانده بدهی/خارج از بازه تنفس هستند).` 
      });
    } else {
      setState(prev => {
        const mergedDrafts = [...(prev.creditControlDrafts || []), ...newDrafts];
        return {
          ...prev,
          creditControlDrafts: mergedDrafts
        };
      });

      setFeedback({ 
        type: 'success', 
        message: `چرخه روزانه برای تاریخ ${targetDate} با موفقیت اجرا شد و تعداد ${newDrafts.length} پیش‌نویس جریمه جدید ایجاد گردید.` 
      });
    }
  };

  // Clear all memory drafts (Utility for testing)
  const handleClearDrafts = () => {
    if (window.confirm('آیا مایل به حذف تمامی پیش‌نویس‌های جریمه دیرکرد موقت هستید؟ (این عمل فقط در حافظه برنامه انجام می‌شود)')) {
      setState(prev => ({
        ...prev,
        creditControlDrafts: []
      }));
      setFeedback({ type: 'info', message: 'تمامی پیش‌نویس‌های جریمه با موفقیت از حافظه پاک شدند.' });
    }
  };

  return (
    <div className="space-y-6 font-sans text-right" dir="rtl" id="credit_control_container">
      
      {/* Header section */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-6 rounded-2xl border border-indigo-500/30 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 flex items-center justify-center shrink-0 shadow-lg">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black">کنترل حساب نمایندگان فروش</h2>
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs px-2.5 py-0.5 rounded-full font-bold">
                موتور کنترل حساب هوشمند
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              پایش بلادرنگ معوقات با مدل FIFO و مدیریت خودکار پیش‌نویس‌های جریمه دیرکرد روزانه به صورت کاملاً همان‌توان
            </p>
          </div>
        </div>

        {activeSubTab === 'monitoring' && (
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-200 text-xs font-bold rounded-xl transition shadow-sm mr-auto md:mr-0 self-start md:self-center"
            id="btn_refresh_engine"
          >
            <RefreshCw className="w-4 h-4" />
            <span>بروزرسانی محاسبات</span>
          </button>
        )}
      </div>

      {/* Sub tabs navigation */}
      <div className="flex border-b border-slate-200 gap-6">
        <button
          onClick={() => { setActiveSubTab('monitoring'); setSelectedAgentId(null); }}
          className={`pb-3 text-sm font-bold transition-all relative ${activeSubTab === 'monitoring' ? 'text-indigo-600 font-black' : 'text-slate-500 hover:text-slate-800'}`}
          id="tab_monitoring"
        >
          {activeSubTab === 'monitoring' && (
            <motion.div layoutId="subtab_underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
          <span className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            پایش و نظارت معوقات نمایندگان
          </span>
        </button>

        <button
          onClick={() => { setActiveSubTab('daily_cycle'); setSelectedAgentId(null); }}
          className={`pb-3 text-sm font-bold transition-all relative ${activeSubTab === 'daily_cycle' ? 'text-indigo-600 font-black' : 'text-slate-500 hover:text-slate-800'}`}
          id="tab_daily_cycle"
        >
          {activeSubTab === 'daily_cycle' && (
            <motion.div layoutId="subtab_underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
          <span className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            چرخه اجرای روزانه و پیش‌نویس جریمه‌ها
          </span>
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeSubTab === 'monitoring' ? (
          /* Monitoring Sub-Tab */
          <div key="monitoring_pane">
            {!selectedAgentId ? (
              /* Agent list tab view */
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="space-y-4"
              >
                {/* Search and Filters */}
                <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="relative w-full sm:max-w-md">
                    <Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="جستجو بر اساس نام نماینده، کد یا فروشگاه..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-3 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-slate-700 transition"
                      id="input_agent_search"
                    />
                  </div>

                  <div className="text-[11px] text-slate-500 font-medium">
                    مجموعاً <span className="text-indigo-600 font-bold">{agents.length}</span> نماینده فروش در سیستم پایش می‌شوند.
                  </div>
                </div>

                {/* List Table or Cards */}
                <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-right border-collapse">
                      <thead>
                        <tr className="bg-slate-50/70 border-b border-slate-200/60 text-slate-500 font-bold text-xs">
                          <th className="p-4">نماینده و فروشگاه</th>
                          <th className="p-4 text-center">سقف اعتبار</th>
                          <th className="p-4 text-center">اعتبار مصرف‌شده</th>
                          <th className="p-4 text-center">اعتبار آزاد</th>
                          <th className="p-4 text-center">فاکتورهای باز / معوق</th>
                          <th className="p-4 text-center">کل بدهی واقعی</th>
                          <th className="p-4 text-center">جریمه پیشنهادی</th>
                          <th className="p-4 text-center">اسناد جریمه</th>
                          <th className="p-4 text-left">عملیات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                        {filteredAgentsList.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="p-8 text-center text-slate-400 font-medium">
                              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                              نماینده‌ای با شرایط مورد نظر یافت نشد.
                            </td>
                          </tr>
                        ) : (
                          filteredAgentsList.map(agent => {
                            const data = processedData.get(agent.id);
                            if (!data) return null;

                            const { creditSummary, invoiceBalances, pendingLateFees, draftVouchers } = data.output;
                            
                            const openInvoicesCount = invoiceBalances.filter(b => b.status !== 'settled').length;
                            const overdueInvoicesCount = invoiceBalances.filter(b => b.status !== 'settled' && b.delayDays > 0).length;
                            const totalPenalty = pendingLateFees.reduce((sum, f) => sum + f.calculatedPenaltyAmount, 0);

                            return (
                              <tr key={agent.id} className="hover:bg-slate-50/50 transition">
                                <td className="p-4">
                                  <div className="font-bold text-slate-900">{agent.name}</div>
                                  <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                                    <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono font-bold">{agent.code}</span>
                                    {agent.agentDetails?.storeName && (
                                      <>
                                        <span>•</span>
                                        <span>{agent.agentDetails.storeName}</span>
                                      </>
                                    )}
                                  </div>
                                </td>
                                <td className="p-4 text-center font-bold font-mono text-slate-800">
                                  {creditSummary.totalCreditLimit.toLocaleString()} <span className="text-[10px] text-slate-400 font-sans font-normal">ریال</span>
                                </td>
                                <td className="p-4 text-center font-bold font-mono text-amber-600">
                                  {creditSummary.usedCredit.toLocaleString()} <span className="text-[10px] text-slate-400 font-sans font-normal">ریال</span>
                                </td>
                                <td className="p-4 text-center font-bold font-mono text-emerald-600">
                                  {creditSummary.freeCredit.toLocaleString()} <span className="text-[10px] text-slate-400 font-sans font-normal">ریال</span>
                                </td>
                                <td className="p-4 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold font-mono text-[11px]">{openInvoicesCount}</span>
                                    <span>/</span>
                                    <span className={`${overdueInvoicesCount > 0 ? 'bg-rose-50 text-rose-700 font-black' : 'bg-slate-50 text-slate-500 font-bold'} px-2 py-0.5 rounded-full font-mono text-[11px]`}>
                                      {overdueInvoicesCount}
                                    </span>
                                  </div>
                                </td>
                                <td className="p-4 text-center font-bold font-mono text-indigo-600">
                                  {creditSummary.usedCredit.toLocaleString()} <span className="text-[10px] text-slate-400 font-sans font-normal">ریال</span>
                                </td>
                                <td className="p-4 text-center font-bold font-mono text-rose-600">
                                  {totalPenalty.toLocaleString()} <span className="text-[10px] text-slate-400 font-sans font-normal">ریال</span>
                                </td>
                                <td className="p-4 text-center font-bold font-mono text-indigo-700">
                                  <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                                    {draftVouchers.length} پیش‌نویس
                                  </span>
                                </td>
                                <td className="p-4 text-left">
                                  <button
                                    onClick={() => setSelectedAgentId(agent.id)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-bold rounded-lg transition"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                    <span>بررسی جزئیات</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            ) : (
              /* Agent Drill-down Detail view */
              <motion.div
                initial={{ opacity: 0, x: -15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 15 }}
                className="space-y-6"
              >
                {/* Back to list button */}
                <button
                  onClick={() => setSelectedAgentId(null)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold rounded-xl text-xs transition shadow-sm"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>بازگشت به لیست نمایندگان</span>
                </button>

                {selectedAgentData && (
                  <>
                    {/* Agent Card Stats */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-6">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                        <div>
                          <h3 className="text-lg font-black text-slate-900">{selectedAgentData.agent.name}</h3>
                          <p className="text-xs text-slate-400 mt-1">
                            کد نماینده: <span className="font-mono font-bold text-slate-600">{selectedAgentData.agent.code}</span>
                            {selectedAgentData.agent.agentDetails?.storeName && (
                              <>
                                <span className="mx-2">•</span>
                                فروشگاه: <span className="font-bold text-slate-600">{selectedAgentData.agent.agentDetails.storeName}</span>
                              </>
                            )}
                            {selectedAgentData.agent.nationalId && (
                              <>
                                <span className="mx-2">•</span>
                                کد ملی: <span className="font-mono text-slate-600">{selectedAgentData.agent.nationalId}</span>
                              </>
                            )}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] px-2.5 py-1 rounded-full font-bold">
                            طرح نسیه اعتباری فعال
                          </span>
                        </div>
                      </div>

                      {/* Summary metric blocks */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/40">
                          <span className="text-[10px] text-slate-400 block font-bold">سقف اعتبار نماینده</span>
                          <span className="text-base font-black font-mono text-slate-800 mt-1 block">
                            {selectedAgentData.output.creditSummary.totalCreditLimit.toLocaleString()}{' '}
                            <span className="text-[10px] text-slate-400 font-sans font-normal">ریال</span>
                          </span>
                        </div>

                        <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/40">
                          <span className="text-[10px] text-slate-400 block font-bold">اعتبار آزاد باقی‌مانده</span>
                          <span className="text-base font-black font-mono text-emerald-600 mt-1 block">
                            {selectedAgentData.output.creditSummary.freeCredit.toLocaleString()}{' '}
                            <span className="text-[10px] text-slate-400 font-sans font-normal">ریال</span>
                          </span>
                        </div>

                        <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/40">
                          <span className="text-[10px] text-slate-400 block font-bold">بدهی معوق فاکتورها</span>
                          <span className="text-base font-black font-mono text-amber-600 mt-1 block">
                            {selectedAgentData.output.creditSummary.usedCredit.toLocaleString()}{' '}
                            <span className="text-[10px] text-slate-400 font-sans font-normal">ریال</span>
                          </span>
                        </div>

                        <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/40">
                          <span className="text-[10px] text-slate-400 block font-bold">کل جریمه پیشنهادی دیرکرد</span>
                          <span className="text-base font-black font-mono text-rose-600 mt-1 block">
                            {selectedAgentData.output.pendingLateFees.reduce((sum, f) => sum + f.calculatedPenaltyAmount, 0).toLocaleString()}{' '}
                            <span className="text-[10px] text-slate-400 font-sans font-normal">ریال</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Invoices detail table */}
                    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
                      <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                        <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                          <FileText className="w-4 h-4 text-indigo-500" />
                          <span>جزئیات و مانده واقعی فاکتورهای نماینده (FIFO واقعی)</span>
                        </h4>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-right border-collapse">
                          <thead>
                            <tr className="bg-slate-50/30 border-b border-slate-200/50 text-slate-500 font-bold text-xs">
                              <th className="p-4">شماره فاکتور</th>
                              <th className="p-4">تاریخ فاکتور</th>
                              <th className="p-4 text-center">سررسید</th>
                              <th className="p-4 text-center">مبلغ اولیه</th>
                              <th className="p-4 text-center">پرداخت‌های تخصیص‌یافته</th>
                              <th className="p-4 text-center">برگشت از فروش</th>
                              <th className="p-4 text-center">مانده واقعی فاکتور</th>
                              <th className="p-4 text-center">تأخیر (روز)</th>
                              <th className="p-4 text-center">جریمه دیرکرد فاکتور</th>
                              <th className="p-4 text-center">وضعیت</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                            {selectedAgentData.output.invoiceBalances.length === 0 ? (
                              <tr>
                                <td colSpan={10} className="p-8 text-center text-slate-400 font-medium">
                                  هیچ فاکتور فروش قطعی برای این نماینده یافت نشد.
                                </td>
                              </tr>
                            ) : (
                              selectedAgentData.output.invoiceBalances.map(balance => {
                                const originalInv = state.invoices.find(inv => inv.id === balance.invoiceId);
                                const invoiceDate = originalInv?.date || '-';

                                const invoicePenalties = selectedAgentData.output.pendingLateFees
                                  .filter(fee => fee.invoiceId === balance.invoiceId)
                                  .reduce((sum, fee) => sum + fee.calculatedPenaltyAmount, 0);

                                return (
                                  <tr key={balance.invoiceId} className="hover:bg-slate-50/40 transition">
                                    <td className="p-4 font-bold font-mono text-slate-900">
                                      {balance.invoiceNumber}
                                    </td>
                                    <td className="p-4 font-medium">{invoiceDate}</td>
                                    <td className="p-4 text-center font-mono text-slate-600">{balance.dueDate}</td>
                                    <td className="p-4 text-center font-bold font-mono text-slate-800">
                                      {balance.originalAmount.toLocaleString()}
                                    </td>
                                    <td className="p-4 text-center font-bold font-mono text-emerald-600">
                                      {balance.paidAmount > 0 ? `+${balance.paidAmount.toLocaleString()}` : '۰'}
                                    </td>
                                    <td className="p-4 text-center font-bold font-mono text-rose-500">
                                      {balance.returnedAmount > 0 ? `-${balance.returnedAmount.toLocaleString()}` : '۰'}
                                    </td>
                                    <td className="p-4 text-center font-bold font-mono text-indigo-600">
                                      {balance.remainingAmount.toLocaleString()}
                                    </td>
                                    <td className="p-4 text-center font-bold font-mono">
                                      {balance.delayDays > 0 ? (
                                        <span className="text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                                          {balance.delayDays} روز
                                        </span>
                                      ) : (
                                        <span className="text-slate-400">۰</span>
                                      )}
                                    </td>
                                    <td className="p-4 text-center font-bold font-mono text-rose-600">
                                      {invoicePenalties > 0 ? invoicePenalties.toLocaleString() : '۰'}
                                    </td>
                                    <td className="p-4 text-center">
                                      {balance.status === 'settled' && (
                                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-bold">
                                          تسویه شده
                                        </span>
                                      )}
                                      {balance.status === 'partially_paid' && (
                                        <span className="bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 rounded-full font-bold">
                                          نیمه تسویه
                                        </span>
                                      )}
                                      {balance.status === 'open' && (
                                        <span className={`${balance.delayDays > 0 ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-slate-50 text-slate-600 border-slate-100'} border px-2 py-0.5 rounded-full font-bold`}>
                                          {balance.delayDays > 0 ? 'معوق باز' : 'جاری باز'}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </div>
        ) : (
          /* Daily Cycle and Penalty Drafts Sub-Tab (Phase 4) */
          <motion.div
            key="daily_cycle_pane"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-6"
            id="daily_cycle_section"
          >
            {/* Run Daily Cycle controls card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-6">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                  <Play className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">شبیه‌سازی و اجرای چرخه روزانه جریمه‌ها</h3>
                  <p className="text-[11px] text-slate-400">تاریخ کاری مد نظر را انتخاب کرده و موتور را به صورت کاملاً همان‌توان برای تولید پیش‌نویس جریمه‌های امروز اجرا کنید.</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-end gap-4 max-w-2xl">
                <div className="space-y-1.5 w-full sm:w-64">
                  <label className="text-[11px] font-bold text-slate-500 block">تاریخ کاری محاسبات (جلالی)</label>
                  <div className="relative">
                    <Calendar className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={targetDate}
                      onChange={(e) => setTargetDate(e.target.value)}
                      placeholder="مثال: 1405/01/15"
                      className="w-full pl-3 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                      id="input_target_date"
                    />
                  </div>
                </div>

                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={handleRunDailyCycle}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold rounded-xl transition shadow-sm"
                    id="btn_run_daily_cycle"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>اجرای چرخه روزانه</span>
                  </button>

                  <button
                    onClick={handleClearDrafts}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl transition"
                    id="btn_clear_drafts"
                    title="پاک کردن پیش‌نویس‌ها از حافظه موقت"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>پاکسازی حافظه</span>
                  </button>
                </div>
              </div>

              {/* Feedback messages */}
              {feedback && (
                <div 
                  className={`p-4 rounded-xl border flex items-start gap-3 text-xs leading-relaxed ${
                    feedback.type === 'success' 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                      : feedback.type === 'warning'
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-blue-50 border-blue-200 text-blue-800'
                  }`}
                  id="cycle_feedback_alert"
                >
                  <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{feedback.message}</p>
                </div>
              )}
            </div>

            {/* Statistics Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
                <span className="text-[10px] font-bold text-slate-400 block">کل پیش‌نویس‌های جریمه</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-xl font-black font-mono text-slate-800">{draftSummaryStats.count}</span>
                  <span className="text-[10px] text-slate-400">فقره رکورد</span>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
                <span className="text-[10px] font-bold text-slate-400 block">مجموع جریمه‌های محاسبه شده</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-xl font-black font-mono text-rose-600">{draftSummaryStats.totalAmount.toLocaleString()}</span>
                  <span className="text-[10px] text-slate-400">ریال</span>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
                <span className="text-[10px] font-bold text-slate-400 block">تعداد تاریخ‌های پردازش شده</span>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-xl font-black font-mono text-indigo-600">{draftSummaryStats.uniqueDates}</span>
                  <span className="text-[10px] text-slate-400">روز کاری مجزا</span>
                </div>
              </div>
            </div>

            {/* Draft list card */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
              <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <Scale className="w-4 h-4 text-indigo-500" />
                  <span>لیست رکوردهای پیش‌نویس جریمه دیرکرد روزانه (Drafts)</span>
                </h4>

                <div className="flex flex-col sm:flex-row gap-2">
                  {/* Filter by Agent */}
                  <select
                    value={selectedDraftAgentFilter}
                    onChange={(e) => setSelectedDraftAgentFilter(e.target.value)}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    id="filter_draft_agent"
                  >
                    <option value="all">همه نمایندگان</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>

                  {/* Search drafts */}
                  <div className="relative">
                    <Search className="absolute right-2 top-2 w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="جستجوی پیش‌نویس..."
                      value={draftSearchQuery}
                      onChange={(e) => setDraftSearchQuery(e.target.value)}
                      className="pl-2 pr-8 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-medium text-slate-700 w-full sm:w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      id="input_draft_search"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-slate-50/30 border-b border-slate-200/50 text-slate-500 font-bold text-xs">
                      <th className="p-4">شناسه پیش‌نویس</th>
                      <th className="p-4">نماینده</th>
                      <th className="p-4 text-center">فاکتور مرجع</th>
                      <th className="p-4 text-center">تاریخ محاسبه (روز کاری)</th>
                      <th className="p-4 text-center">مبلغ مانده بدهی واقعی روز</th>
                      <th className="p-4 text-center">درصد جریمه روزانه</th>
                      <th className="p-4 text-center">مبلغ جریمه دیرکرد روزانه</th>
                      <th className="p-4 text-center">وضعیت</th>
                      <th className="p-4 text-center">زمان ایجاد محاسباتی</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                    {filteredDrafts.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-12 text-center text-slate-400 font-medium">
                          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                          هیچ پیش‌نویس جریمه‌ای در حافظه برنامه وجود ندارد. تاریخ مورد نظر خود را وارد نموده و دکمه اجرای چرخه روزانه را بزنید.
                        </td>
                      </tr>
                    ) : (
                      filteredDrafts.map(draft => {
                        const agent = agents.find(a => a.id === draft.agentId);
                        return (
                          <tr key={draft.id} className="hover:bg-slate-50/40 transition">
                            <td className="p-4 font-mono text-slate-400 text-[11px]">{draft.id}</td>
                            <td className="p-4 font-bold text-slate-900">{agent ? agent.name : draft.agentId}</td>
                            <td className="p-4 text-center font-mono font-bold text-slate-700">فاکتور {draft.invoiceNumber}</td>
                            <td className="p-4 text-center font-mono font-bold text-indigo-700">{draft.calculationDate}</td>
                            <td className="p-4 text-center font-mono text-slate-800">{draft.baseRemainingAmount.toLocaleString()} ریال</td>
                            <td className="p-4 text-center font-mono text-amber-600">{draft.penaltyPercentage}%</td>
                            <td className="p-4 text-center font-mono font-black text-rose-600">{draft.penaltyAmount.toLocaleString()} ریال</td>
                            <td className="p-4 text-center">
                              <span className="bg-slate-50 text-slate-500 border border-slate-200 px-2 py-0.5 rounded-full font-bold text-[10px]">
                                {draft.status === 'pending' ? 'پیش‌نویس روزانه' : draft.status}
                              </span>
                            </td>
                            <td className="p-4 text-center text-slate-400 text-[10px]" title={draft.createdAt}>
                              {new Date(draft.createdAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })} • {draft.createdAt.substring(0, 10)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
