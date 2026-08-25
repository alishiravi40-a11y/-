import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, CheckCircle2, XCircle, ArrowRight, Clock, 
  AlertCircle, Users, FileText, Paperclip, MapPin, 
  Store, Calendar, TrendingUp, Coins, UserCheck, 
  UserX, ChevronRight, Shield, Key, MessageSquare, Send, Check
} from 'lucide-react';
import { AppState, Person, BusinessPartner, PartnerTicket, PartnerTicketMessage, CreditFile } from '../types';
import { getSupabase } from '../lib/supabaseClient';
import { CreditPartnerService } from '../services/creditPartnerService';
import { finalizeCreditFile, resolvePartnerCreditRules, recordPartnerCreditRulesChange } from '../utils/partnerProcess';
import { getCurrentJalaliDate } from '../utils/jalali';
import { DataIntegrityEngine } from '../utils/integrityEngine';
import CreditFileDocuments from './CreditFileDocuments';

interface AgentDossierManagerProps {
  state: AppState;
  onUpdateState: (newState: AppState) => void;
  currentUserId: string;
}

export default function AgentDossierManager({ state, onUpdateState, currentUserId }: AgentDossierManagerProps) {
  // Views: 'list' | 'detail'
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved'>('all');
  const [activeDocsFile, setActiveDocsFile] = useState<CreditFile | null>(null);

  // Top Mode Switcher: 'dossiers' | 'tickets'
  const [adminSection, setAdminSection] = useState<'dossiers' | 'tickets'>('dossiers');
  const [selectedAdminTicketId, setSelectedAdminTicketId] = useState<string | null>(null);
  const [adminReplyText, setAdminReplyText] = useState('');

  // Interactive Parameter states for the selected agent in detail view
  const [editWholesale, setEditWholesale] = useState(true);
  const [editInstallment, setEditInstallment] = useState(true);
  const [editCreditLimit, setEditCreditLimit] = useState(500000000);
  const [editDelayDays, setEditDelayDays] = useState(30);
  const [editPenaltyRate, setEditPenaltyRate] = useState(0.1);

  // Full agents list derived from persons with `isAgent === true`
  const agents = useMemo(() => {
    const bpPersonIds = (state.businessPartners || []).map(bp => bp.personId);
    return state.persons.filter(p => p.isAgent || bpPersonIds.includes(p.id)).map(p => {
      if (p.name === 'نماینده تجاری') {
        return { ...p, name: 'نماینده فروش' };
      }
      return p;
    });
  }, [state.persons, state.businessPartners]);

  // Compute pending count
  const pendingAgentsCount = useMemo(() => {
    return agents.filter(a => !a.isDocumentsApproved).length;
  }, [agents]);

  // Filtered list
  const filteredAgents = useMemo(() => {
    return agents.filter(agent => {
      if (filterStatus === 'pending') return !agent.isDocumentsApproved;
      if (filterStatus === 'approved') return !!agent.isDocumentsApproved;
      return true;
    });
  }, [agents, filterStatus]);

  const handleUpdateCreditFileStatus = (fileId: string, newStatus: any, note?: string) => {
    let updatedState = { ...state };
    
    const updatedFiles = (state.creditFiles || []).map(f =>
      f.id === fileId ? { ...f, status: newStatus, revisionNote: note || f.revisionNote } : f
    );
    updatedState.creditFiles = updatedFiles;

    const oldFile = (state.creditFiles || []).find(f => f.id === fileId);
    if (newStatus === 'approved' && oldFile?.status !== 'approved') {
      try {
        const financialImpact = finalizeCreditFile(fileId, { ...state, creditFiles: updatedFiles });
        updatedState = {
          ...updatedState,
          ...financialImpact
        };
      } catch (err: any) {
        alert('خطا در صدور اتوماتیک سند حسابداری پرونده: ' + err.message);
        return;
      }
    }

    onUpdateState(updatedState);

    CreditPartnerService.updateCreditFile(fileId, {
      status: newStatus,
      revisionNote: note || null
    }).catch(err => console.error('Error updating status via service:', err));
  };

  // Find active selected agent
  const selectedAgent = useMemo(() => {
    if (!selectedAgentId) return null;
    const found = agents.find(a => a.id === selectedAgentId) || null;
    if (found && found.name === 'نماینده تجاری') {
      return { ...found, name: 'نماینده فروش' };
    }
    return found;
  }, [agents, selectedAgentId]);

  // When clicking on an agent, populate form edit states
  const handleSelectAgent = (agent: Person) => {
    setSelectedAgentId(agent.id);
    setEditWholesale(agent.isOfflineWholesaleEnabled !== false);
    setEditInstallment(agent.isInstallmentEnabled !== false);
    const rules = resolvePartnerCreditRules(agent, state.businessPartners);
    setEditCreditLimit(rules.maxCreditLimit);
    setEditDelayDays(rules.defaultInstallmentDays);
    setEditPenaltyRate(rules.penaltyRatePerMonth);
    setView('detail');
  };

  // Approve Handler
  const handleApprove = () => {
    if (!selectedAgent) return;

    const partnerId = selectedAgent.id;

    // 1. Update Person via DataIntegrityEngine (identity details only)
    const engine = DataIntegrityEngine.getInstance();
    const personUpdates = {
      isOfflineWholesaleEnabled: editWholesale,
      isInstallmentEnabled: editInstallment,
      isDocumentsApproved: true
    };

    const personResult = engine.updatePerson(partnerId, personUpdates, state as any);
    if (!personResult.success) {
      alert(`خطا در ویرایش اطلاعات شخص:\n${personResult.errors?.join('\n')}`);
      return;
    }

    let finalState = personResult.updatedState;
    const partnerIndex = state.businessPartners.findIndex(bp => bp.personId === partnerId);

    if (partnerIndex !== -1) {
      const partner = state.businessPartners[partnerIndex];
      const user = state.users.find(u => u.name === selectedAgent.name || u.personId === partnerId);
      let updatedUsers = [...(partner.users || [])];
      if (user && !updatedUsers.includes(user.id)) {
        updatedUsers.push(user.id);
      }
      const partnerUpdates = {
        status: 'active' as const,
        users: updatedUsers,
        profile: {
          ...partner.profile,
          creditLimit: editCreditLimit,
          contractStatus: 'فعال'
        },
        creditExtension: recordPartnerCreditRulesChange(
          partner,
          {
            ...(partner.creditExtension?.creditRules || {}),
            maxCreditLimit: editCreditLimit,
            defaultInstallmentDays: editDelayDays,
            penaltyRatePerMonth: editPenaltyRate
          },
          { changeReason: 'ویرایش قوانین اعتباری در پرونده نماینده' }
        ),
        contract: partner.contract ? {
          ...partner.contract,
          creditLimit: editCreditLimit,
          status: 'active' as const
        } : {
          id: `CON_${Date.now()}`,
          partnerId: partner.id,
          type: 'CREDIT_AGENT' as any,
          startDate: new Date().toLocaleDateString('fa-IR'),
          status: 'active' as const,
          creditLimit: editCreditLimit,
          hasRepresentativeGuarantee: true,
          commissionRate: 2,
          createdAt: new Date().toISOString()
        }
      };

      const partnerResult = engine.updateBusinessPartner(partner.id, partnerUpdates as any, finalState);
      if (!partnerResult.success) {
        alert(`خطا در ویرایش اطلاعات همکار تجاری:\n${partnerResult.errors?.join('\n')}`);
        return;
      }
      finalState = partnerResult.updatedState;
    } else {
      const user = state.users.find(u => u.name === selectedAgent.name || u.personId === partnerId);
      const newBpId = `BP_${Date.now()}`;
      const newPartner = {
        id: newBpId,
        personId: partnerId,
        status: 'active' as const,
        agencyType: 'CREDIT_ONLY' as any,
        roles: ['CREDIT_SALES_AGENT' as any],
        profile: {
          partnerId: newBpId,
          contractStatus: 'فعال',
          riskLevel: 'medium' as any,
          creditLimit: editCreditLimit,
        },
        allowedCalculatorIds: ['CALC_1', 'CALC_2', 'CALC_3'],
        branches: [
          {
            id: `BR_${Date.now()}`,
            partnerId: newBpId,
            name: 'شعبه مرکزی',
            address: selectedAgent.agentDetails?.storeAddress || '',
            phone: selectedAgent.mobile || '',
            managerName: selectedAgent.name || '',
            isActive: true,
            createdAt: new Date().toISOString()
          }
        ],
        contract: {
          id: `CON_${Date.now()}`,
          partnerId: newBpId,
          type: 'CREDIT_AGENT' as any,
          startDate: new Date().toLocaleDateString('fa-IR'),
          status: 'active' as const,
          creditLimit: editCreditLimit,
          hasRepresentativeGuarantee: true,
          commissionRate: 2,
          createdAt: new Date().toISOString()
        },
        users: user ? [user.id] : [],
        createdAt: new Date().toISOString(),
        createdBy: currentUserId || 'system'
      };

      const partnerResult = engine.createBusinessPartner(newPartner, finalState);
      if (!partnerResult.success) {
        alert(`خطا در ایجاد همکار تجاری:\n${partnerResult.errors?.join('\n')}`);
        return;
      }
      finalState = partnerResult.updatedState;
    }

    // 3. Prepare Audit Log
    const log = {
      id: `LOG_${Date.now()}`,
      action: 'UPDATE' as const,
      entityType: 'PERSON' as const,
      entityId: partnerId,
      details: `پرونده نماینده "${selectedAgent.name}" با موفقیت تایید و دسترسی‌های وی فعال گردید.`,
      userId: currentUserId,
      userName: currentUserId === 'admin' ? 'مدیر سیستم' : 'کاربر',
      timestamp: new Date().toISOString()
    };

    onUpdateState({
      ...finalState,
      auditLogs: [...((state as any).auditLogs || []), log]
    } as any);

    alert(`پرونده همکاری همکار "${selectedAgent.name}" با موفقیت تایید و دسترسی‌های وی فعال گردید.`);
    setView('list');
    setSelectedAgentId(null);
  };

  // Reject / Suspend Handler
  const handleReject = () => {
    if (!selectedAgent) return;

    if (!confirm('آیا از رد کردن یا تعلیق پرونده این نماینده اطمینان دارید؟')) return;

    const partnerId = selectedAgent.id;

    // 1. Update Person via DataIntegrityEngine
    const engine = DataIntegrityEngine.getInstance();
    const personUpdates = {
      isOfflineWholesaleEnabled: false,
      isInstallmentEnabled: false,
      isDocumentsApproved: false
    };

    const personResult = engine.updatePerson(partnerId, personUpdates, state as any);
    if (!personResult.success) {
      alert(`خطا در ویرایش اطلاعات شخص:\n${personResult.errors?.join('\n')}`);
      return;
    }

    let finalState = personResult.updatedState;
    const partnerIndex = state.businessPartners.findIndex(bp => bp.personId === partnerId);

    if (partnerIndex !== -1) {
      const partner = state.businessPartners[partnerIndex];
      const partnerUpdates = {
        status: 'pending' as const,
        profile: {
          ...partner.profile,
          contractStatus: 'تعلیق شده'
        },
        contract: partner.contract ? {
          ...partner.contract,
          status: 'suspended' as const
        } : undefined
      };

      const partnerResult = engine.updateBusinessPartner(partner.id, partnerUpdates as any, finalState);
      if (!partnerResult.success) {
        alert(`خطا در تعلیق همکار تجاری:\n${partnerResult.errors?.join('\n')}`);
        return;
      }
      finalState = partnerResult.updatedState;
    }

    // 3. Audit Log
    const log = {
      id: `LOG_${Date.now()}`,
      action: 'UPDATE' as const,
      entityType: 'PERSON' as const,
      entityId: partnerId,
      details: `پرونده همکار "${selectedAgent.name}" رد یا تعلیق گردید.`,
      userId: currentUserId,
      userName: currentUserId === 'admin' ? 'مدیر سیستم' : 'کاربر',
      timestamp: new Date().toISOString()
    };

    onUpdateState({
      ...finalState,
      auditLogs: [...((state as any).auditLogs || []), log]
    } as any);

    alert(`پرونده همکار "${selectedAgent.name}" به حالت معلق/رد شده انتقال یافت.`);
    setView('list');
    setSelectedAgentId(null);
  };

  const allTickets = state.partnerTickets || [];
  const openTicketsCount = allTickets.filter(t => t.status === 'new' || t.status === 'in_progress').length;
  const activeAdminTicket = allTickets.find(t => t.id === selectedAdminTicketId) || allTickets[0] || null;

  const handleAdminSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAdminTicket || !adminReplyText.trim()) return;

    const replyMsg: PartnerTicketMessage = {
      id: 'MSG_' + Date.now(),
      senderId: currentUserId || 'admin',
      senderName: 'مدیریت مرکز',
      senderRole: 'admin',
      message: adminReplyText.trim(),
      createdAt: getCurrentJalaliDate() + ' ' + new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
    };

    const updatedTicket: PartnerTicket = {
      ...activeAdminTicket,
      status: 'answered',
      messages: [...activeAdminTicket.messages, replyMsg],
      updatedAt: getCurrentJalaliDate()
    };

    const updatedTickets = allTickets.map(t => t.id === activeAdminTicket.id ? updatedTicket : t);
    onUpdateState({ ...state, partnerTickets: updatedTickets });
    setAdminReplyText('');
  };

  const handleUpdateTicketStatus = (ticketId: string, status: PartnerTicket['status']) => {
    const updatedTickets = allTickets.map(t => t.id === ticketId ? { ...t, status, updatedAt: getCurrentJalaliDate() } : t);
    onUpdateState({ ...state, partnerTickets: updatedTickets });
  };

  return (
    <div className="bg-zinc-50 min-h-full font-sans text-right space-y-5" dir="rtl">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-rose-600 to-rose-700 text-white p-6 rounded-3xl shadow-lg shadow-rose-600/10 flex justify-between items-center flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-black flex items-center gap-2">
            <ShieldCheck size={24} />
            بررسی پرونده و پشتیبانی نمایندگان
          </h2>
          <p className="text-xs text-rose-100 mt-1">
            بررسی مدارک، ضمانت‌نامه‌ها، تضامین و پاسخگویی به پیام‌ها و درخواست‌های نمایندگان فروش
          </p>
        </div>

        {/* Section Switcher Tabs */}
        <div className="flex bg-black/20 p-1 rounded-2xl gap-1 text-xs font-bold border border-white/10">
          <button
            onClick={() => setAdminSection('dossiers')}
            className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 ${
              adminSection === 'dossiers' ? 'bg-white text-rose-700 shadow-md' : 'text-white hover:bg-white/10'
            }`}
          >
            <Shield size={16} />
            <span>پرونده نمایندگان</span>
            {pendingAgentsCount > 0 && (
              <span className="bg-rose-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-black">
                {pendingAgentsCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setAdminSection('tickets')}
            className={`px-4 py-2 rounded-xl transition flex items-center gap-1.5 ${
              adminSection === 'tickets' ? 'bg-white text-rose-700 shadow-md' : 'text-white hover:bg-white/10'
            }`}
          >
            <MessageSquare size={16} />
            <span>پیام‌ها و تیکت‌ها</span>
            {openTicketsCount > 0 && (
              <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-black">
                {openTicketsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {adminSection === 'tickets' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[480px]">
          {/* Ticket List for Admin */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-zinc-200 shadow-xs flex flex-col overflow-hidden">
            <div className="p-3 bg-zinc-100 border-b border-zinc-200 font-bold text-xs text-zinc-700 flex justify-between items-center">
              <span>لیست تیکت‌های دریافتی ({allTickets.length})</span>
              <span className="text-amber-700 text-[10px] font-mono">پاسخ‌نداده: {openTicketsCount}</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 max-h-[500px]">
              {allTickets.length === 0 ? (
                <div className="p-8 text-center text-zinc-400 text-xs">
                  تیکت یا پیامی از سمت نمایندگان ثبت نشده است.
                </div>
              ) : (
                allTickets.map(t => {
                  const isSelected = activeAdminTicket?.id === t.id;
                  const lastMsg = t.messages[t.messages.length - 1];

                  return (
                    <div
                      key={t.id}
                      onClick={() => setSelectedAdminTicketId(t.id)}
                      className={`p-3.5 cursor-pointer transition space-y-1.5 ${
                        isSelected ? 'bg-rose-50/70 border-r-4 border-rose-600' : 'hover:bg-zinc-50'
                      }`}
                    >
                      <div className="flex justify-between items-center text-xs font-bold">
                        <span className="text-zinc-800 truncate">{t.subject}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          t.status === 'answered'
                            ? 'bg-emerald-100 text-emerald-800'
                            : t.status === 'new'
                            ? 'bg-amber-100 text-amber-800 font-black'
                            : 'bg-zinc-100 text-zinc-600'
                        }`}>
                          {t.status === 'answered' ? 'پاسخ داده شد' : t.status === 'new' ? 'جدید' : t.status === 'in_progress' ? 'در حال بررسی' : 'بسته‌شده'}
                        </span>
                      </div>

                      <div className="text-[11px] text-zinc-500 flex justify-between items-center">
                        <span>نماینده: <strong className="text-zinc-700">{t.agentName}</strong></span>
                        <span className="font-mono text-[10px] text-zinc-400">{t.updatedAt}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Ticket Reply Interface */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-zinc-200 shadow-xs flex flex-col overflow-hidden">
            {activeAdminTicket ? (
              <>
                <div className="p-4 bg-zinc-900 text-white flex justify-between items-center">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold">{activeAdminTicket.subject}</h3>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      ارسال‌کننده: {activeAdminTicket.agentName} | کد تیکت: {activeAdminTicket.ticketNumber}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {activeAdminTicket.status !== 'closed' ? (
                      <button
                        onClick={() => handleUpdateTicketStatus(activeAdminTicket.id, 'closed')}
                        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-[10px] font-bold"
                      >
                        بستن تیکت
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUpdateTicketStatus(activeAdminTicket.id, 'in_progress')}
                        className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-bold"
                      >
                        بازگشایی مجدد
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-zinc-50 max-h-[380px]">
                  {activeAdminTicket.messages.map(msg => {
                    const isAdmin = msg.senderRole === 'admin';

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col max-w-[85%] ${isAdmin ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                      >
                        <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-bold mb-0.5">
                          <span>{isAdmin ? '🛡️ مدیریت' : `👤 ${msg.senderName}`}</span>
                          <span>•</span>
                          <span className="font-mono">{msg.createdAt}</span>
                        </div>

                        <div className={`p-3 rounded-2xl text-xs ${
                          isAdmin ? 'bg-rose-600 text-white rounded-tl-none' : 'bg-white border border-zinc-200 text-zinc-800 rounded-tr-none'
                        }`}>
                          <p className="whitespace-pre-wrap">{msg.message}</p>
                          {msg.attachments && (
                            <div className="mt-2 pt-1 border-t border-white/20 space-y-1">
                              {msg.attachments.map(att => (
                                <a key={att.id} href={att.url} target="_blank" rel="noreferrer" className="text-[10px] underline block">
                                  📎 {att.name}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={handleAdminSendReply} className="p-3 bg-white border-t border-zinc-200 flex gap-2">
                  <input
                    type="text"
                    value={adminReplyText}
                    onChange={e => setAdminReplyText(e.target.value)}
                    placeholder="پاسخ مدیریت برای نماینده..."
                    className="flex-1 bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-xs outline-none focus:border-rose-500"
                  />
                  <button
                    type="submit"
                    className="bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1"
                  >
                    <Send size={14} />
                    <span>ارسال پاسخ</span>
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-zinc-400 text-xs">
                تیکتی جهت نمایش وجود ندارد.
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
      {view === 'list' ? (
        <div className="space-y-4">
          {/* Status Tabs Filters */}
          <div className="flex border border-zinc-200 bg-white p-1 rounded-2xl gap-1">
            <button
              onClick={() => setFilterStatus('all')}
              className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition ${filterStatus === 'all' ? 'bg-zinc-900 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50'}`}
            >
              همه متقاضیان ({agents.length})
            </button>
            <button
              onClick={() => setFilterStatus('pending')}
              className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${filterStatus === 'pending' ? 'bg-rose-600 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50'}`}
            >
              در انتظار تایید ({pendingAgentsCount})
              {pendingAgentsCount > 0 && (
                <span className="bg-white text-rose-600 text-[10px] px-1.5 py-0.5 rounded-full font-black animate-pulse">
                  {pendingAgentsCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setFilterStatus('approved')}
              className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition ${filterStatus === 'approved' ? 'bg-emerald-600 text-white shadow-sm' : 'text-zinc-500 hover:bg-zinc-50'}`}
            >
              تایید شده و فعال ({agents.filter(a => a.isDocumentsApproved).length})
            </button>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredAgents.map(agent => {
              const numGuarantors = agent.agentDetails?.guarantors?.length || 0;
              const numChecks = agent.agentDetails?.guaranteeChecks?.length || 0;
              const numDocs = agent.attachments?.length || 0;

              const partner = state.businessPartners?.find(bp => bp.personId === agent.id);
              const isNesyeh = partner ? (
                partner.agencyType === 'INSTALLMENT_ONLY' || 
                (partner.roles as any || []).includes('DEFERRED_AGENT')
              ) : false;

              const isCredit = partner ? (
                partner.agencyType === 'CREDIT_ONLY' || 
                partner.agencyType === 'BOTH' || 
                (partner.roles as any || []).includes('CREDIT_SALES_AGENT')
              ) : false;

              return (
                <div 
                  key={agent.id} 
                  className={`bg-white rounded-3xl border p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between ${
                    !agent.isDocumentsApproved ? 'border-rose-100 ring-2 ring-rose-500/5' : 'border-zinc-150'
                  }`}
                >
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-extrabold text-zinc-800 text-sm">{agent.name}</h3>
                          {isNesyeh && (
                            <span className="bg-teal-50 text-teal-700 text-[8px] font-bold px-1.5 py-0.5 rounded border border-teal-200 shrink-0">
                              نماینده فروش
                            </span>
                          )}
                          {isCredit && (
                            <span className="bg-purple-50 text-purple-700 text-[8px] font-bold px-1.5 py-0.5 rounded border border-purple-200 shrink-0">
                              نماینده اعتباری
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-400 font-mono mt-0.5 block">کد ملی: {agent.nationalId || 'ثبت نشده'}</span>
                      </div>
                      <div>
                        {agent.isDocumentsApproved ? (
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px] px-2.5 py-1 rounded-xl font-bold flex items-center gap-1">
                            <CheckCircle2 size={12} /> تایید شده
                          </span>
                        ) : (
                          <span className="bg-amber-50 text-amber-700 border border-amber-100 text-[10px] px-2.5 py-1 rounded-xl font-bold flex items-center gap-1 animate-pulse">
                            <Clock size={12} className="text-amber-600" /> در انتظار بررسی
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 text-xs text-zinc-600 border-t border-zinc-100 pt-3">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">فروشگاه:</span>
                        <strong className="text-zinc-700">{agent.agentDetails?.storeName || 'ثبت نشده'}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">تلفن همراه:</span>
                        <span className="font-mono text-zinc-700">{agent.mobile || 'بدون شماره'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-400">سقف اعتبار پیش‌فرض:</span>
                        <span className="font-mono text-zinc-700 font-bold">{resolvePartnerCreditRules(agent, state.businessPartners).maxCreditLimit.toLocaleString()} ریال</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-4 bg-zinc-50 p-2.5 rounded-2xl text-center border border-zinc-100 text-[10px]">
                      <div>
                        <span className="block text-zinc-400">تعداد ضامنین</span>
                        <strong className="block text-zinc-700 text-xs font-mono font-black mt-0.5">{numGuarantors}</strong>
                      </div>
                      <div>
                        <span className="block text-zinc-400">چک‌های ضمانت</span>
                        <strong className="block text-zinc-700 text-xs font-mono font-black mt-0.5">{numChecks}</strong>
                      </div>
                      <div>
                        <span className="block text-zinc-400">مدارک آپلود شده</span>
                        <strong className="block text-zinc-700 text-xs font-mono font-black mt-0.5">{numDocs}</strong>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleSelectAgent(agent)}
                    className="w-full mt-4 py-2.5 bg-zinc-100 hover:bg-zinc-900 hover:text-white text-zinc-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1"
                  >
                    <span>بررسی پرونده و تاییدیه</span>
                    <ChevronRight size={14} className="rotate-180" />
                  </button>
                </div>
              );
            })}

            {filteredAgents.length === 0 && (
              <div className="col-span-full py-16 text-center bg-white border border-dashed rounded-3xl text-zinc-400 text-xs flex flex-col items-center justify-center gap-3">
                <Users size={32} className="text-zinc-300" />
                <span>هیچ پرونده نمایندگی متناسب با فیلتر فعلی یافت نشد.</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        selectedAgent && (
          <div className="bg-white rounded-3xl border border-zinc-150 p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Detail View Header */}
            <div className="flex justify-between items-center border-b border-zinc-100 pb-4">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setView('list')}
                  className="p-2 bg-zinc-100 hover:bg-zinc-200 rounded-full transition text-zinc-500"
                  title="بازگشت به لیست"
                >
                  <ArrowRight size={16} />
                </button>
                <div>
                  <h3 className="font-extrabold text-zinc-900 text-base">بررسی پرونده اعتباری: {selectedAgent.name}</h3>
                  <span className="text-xs text-zinc-400 mt-1 block">پوشه مدارک و پرونده تضمین با کد حساب {selectedAgent.id}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReject}
                  className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition border border-rose-150"
                >
                  <UserX size={14} /> رد یا تعلیق متقاضی
                </button>
                <button
                  onClick={handleApprove}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-600/10 transition"
                >
                  <UserCheck size={14} /> تایید و فعال‌سازی دسترسی
                </button>
              </div>
            </div>

            {/* Main Details Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Col 1 & 2: Dossier Information & Documents */}
              <div className="lg:col-span-2 space-y-6">
                
                {/* 1. Identity & Store Data */}
                <div className="bg-zinc-50/50 p-5 rounded-3xl border border-zinc-100 space-y-4">
                  <h4 className="font-bold text-zinc-800 text-xs flex items-center gap-2 border-b border-zinc-100 pb-2">
                    <Store size={14} className="text-zinc-500" />
                    مشخصات هویتی و کسب‌و‌کار
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-zinc-400 block mb-0.5">نام کامل نماینده:</span>
                      <strong className="text-zinc-700">{selectedAgent.name}</strong>
                    </div>
                    <div>
                      <span className="text-zinc-400 block mb-0.5">کد ملی:</span>
                      <strong className="text-zinc-700 font-mono">{selectedAgent.nationalId || 'ثبت نشده'}</strong>
                    </div>
                    <div>
                      <span className="text-zinc-400 block mb-0.5">شماره همراه:</span>
                      <strong className="text-zinc-700 font-mono">{selectedAgent.mobile || 'ثبت نشده'}</strong>
                    </div>
                    <div>
                      <span className="text-zinc-400 block mb-0.5">نام فروشگاه:</span>
                      <strong className="text-zinc-700">{selectedAgent.agentDetails?.storeName || 'ثبت نشده'}</strong>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-zinc-400 block mb-0.5">آدرس فروشگاه:</span>
                      <strong className="text-zinc-700 flex items-center gap-1 mt-0.5">
                        <MapPin size={12} className="text-zinc-400 shrink-0" />
                        {selectedAgent.agentDetails?.storeAddress || 'ثبت نشده'}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* 2. Uploaded Documents */}
                <div className="bg-zinc-50/50 p-5 rounded-3xl border border-zinc-100 space-y-4">
                  <h4 className="font-bold text-zinc-800 text-xs flex items-center gap-2 border-b border-zinc-100 pb-2">
                    <Paperclip size={14} className="text-zinc-500" />
                    مدارک و اسناد ضمانت بارگذاری شده
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedAgent.attachments?.map(att => (
                      <div key={att.id} className="bg-white p-3.5 rounded-2xl border border-zinc-150 flex items-center justify-between gap-3 shadow-xs">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-zinc-100 overflow-hidden flex items-center justify-center border border-zinc-200">
                            {att.type.startsWith('image/') ? (
                              <img src={att.url} alt={att.name} className="w-full h-full object-cover" />
                            ) : (
                              <FileText size={20} className="text-zinc-400" />
                            )}
                          </div>
                          <div>
                            <span className="text-xs font-bold text-zinc-800 block line-clamp-1" dir="ltr">{att.name}</span>
                            <span className="text-[9px] text-zinc-400 block mt-1">بارگذاری شده در {new Date(att.uploadDate).toLocaleDateString('fa-IR')}</span>
                          </div>
                        </div>
                        <a 
                          href={att.url} 
                          download={att.name}
                          target="_blank" 
                          rel="noreferrer"
                          className="text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition"
                        >
                          مشاهده بزرگنمایی
                        </a>
                      </div>
                    ))}

                    {(!selectedAgent.attachments || selectedAgent.attachments.length === 0) && (
                      <div className="col-span-full py-8 text-center text-zinc-400 text-xs bg-white border border-dashed rounded-2xl flex flex-col items-center justify-center gap-2">
                        <Paperclip size={24} className="text-zinc-300" />
                        هیچ مدرک فیزیکی یا اسکن هویتی توسط متقاضی بارگذاری نشده است.
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Guarantors List */}
                <div className="bg-zinc-50/50 p-5 rounded-3xl border border-zinc-100 space-y-4">
                  <h4 className="font-bold text-zinc-800 text-xs flex items-center gap-2 border-b border-zinc-100 pb-2">
                    <Users size={14} className="text-zinc-500" />
                    اطلاعات ضامنین ثبت شده
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {selectedAgent.agentDetails?.guarantors?.map((g: any, idx: number) => (
                      <div key={idx} className="bg-white p-4 rounded-2xl border border-zinc-150 space-y-2">
                        <div className="flex justify-between items-center border-b pb-1.5">
                          <strong className="text-xs text-zinc-800">{g.name}</strong>
                          <span className="text-[9px] bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded font-bold">رابطه: {g.relation || 'نامشخص'}</span>
                        </div>
                        <div className="text-[10px] text-zinc-500 space-y-1">
                          <div className="flex justify-between">
                            <span>کد ملی ضامن:</span>
                            <span className="font-mono text-zinc-700 font-bold">{g.nationalId}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>تلفن همراه:</span>
                            <span className="font-mono text-zinc-700 font-bold">{g.mobile || 'ثبت نشده'}</span>
                          </div>
                        </div>
                      </div>
                    ))}

                    {(!selectedAgent.agentDetails?.guarantors || selectedAgent.agentDetails.guarantors.length === 0) && (
                      <div className="col-span-full py-8 text-center text-zinc-400 text-xs bg-white border border-dashed rounded-2xl flex flex-col items-center justify-center gap-2">
                        <Users size={24} className="text-zinc-300" />
                        هیچ ضامنی در پرونده این نماینده درج نشده است.
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Guarantee Checks */}
                <div className="bg-zinc-50/50 p-5 rounded-3xl border border-zinc-100 space-y-4">
                  <h4 className="font-bold text-zinc-800 text-xs flex items-center gap-2 border-b border-zinc-100 pb-2">
                    <Coins size={14} className="text-zinc-500" />
                    چک‌های ضمانت متقاضی
                  </h4>
                  <div className="space-y-3">
                    {selectedAgent.agentDetails?.guaranteeChecks?.map((gc: any, idx: number) => (
                      <div key={idx} className="bg-white p-4 rounded-2xl border border-zinc-150 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <span className="text-zinc-400 block mb-0.5 text-[9px]">بانک صادرکننده:</span>
                          <strong className="text-zinc-800">بانک {gc.bankName}</strong>
                        </div>
                        <div>
                          <span className="text-zinc-400 block mb-0.5 text-[9px]">مبلغ چک ضمانت:</span>
                          <strong className="text-emerald-600 font-mono font-bold">{(gc.amount || 0).toLocaleString()} ریال</strong>
                        </div>
                        <div>
                          <span className="text-zinc-400 block mb-0.5 text-[9px]">شماره صیاد:</span>
                          <span className="font-mono text-zinc-700 font-bold">{gc.sayadId || gc.checkNumber}</span>
                        </div>
                        <div>
                          <span className="text-zinc-400 block mb-0.5 text-[9px]">تاریخ سررسید:</span>
                          <span className="font-mono text-zinc-700 font-bold">{gc.dueDate || 'بدون تاریخ'}</span>
                        </div>
                      </div>
                    ))}

                    {(!selectedAgent.agentDetails?.guaranteeChecks || selectedAgent.agentDetails.guaranteeChecks.length === 0) && (
                      <div className="py-8 text-center text-zinc-400 text-xs bg-white border border-dashed rounded-2xl flex flex-col items-center justify-center gap-2">
                        <Coins size={24} className="text-zinc-300" />
                        هیچ چک ضمانتی در پرونده متقاضی ثبت نشده است.
                      </div>
                    )}
                  </div>
                </div>

                {/* 5. Customer Credit Files Submitted by this Agent */}
                <div className="bg-zinc-50/50 p-5 rounded-3xl border border-zinc-100 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-150">
                  <h4 className="font-bold text-zinc-800 text-xs flex items-center gap-2 border-b border-zinc-100 pb-2">
                    <ShieldCheck size={14} className="text-rose-500" />
                    پرونده‌های اعتباری مشتریان (ثبت‌شده توسط این نماینده)
                  </h4>
                  <div className="space-y-4">
                    {(() => {
                      const agentFiles = (state.creditFiles || []).filter(f => f.representativeId === selectedAgent.id);
                      if (agentFiles.length === 0) {
                        return (
                          <div className="py-8 text-center text-zinc-400 text-xs bg-white border border-dashed rounded-2xl flex flex-col items-center justify-center gap-2">
                            <FileText size={24} className="text-zinc-300" />
                            هیچ پرونده اعتباری مشتری توسط این نماینده ثبت نشده است.
                          </div>
                        );
                      }
                      return agentFiles.map(file => {
                        const customer = state.persons.find(p => p.id === file.personId);
                        return (
                          <div key={file.id} className="bg-white p-4 rounded-2xl border border-zinc-150 space-y-3 shadow-xs text-right" dir="rtl">
                            <div className="flex justify-between items-center">
                              <div>
                                <span className="font-bold text-zinc-800 text-xs">{customer?.name || 'مشتری نامشخص'}</span>
                                {file.settlementType === 'checks' || (file.receivedChecks && file.receivedChecks.length > 0) ? (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[8px] font-black mr-2">
                                    چک (اسناد دریافتنی)
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[8px] font-black mr-2">
                                    دفترچه اقساط
                                  </span>
                                )}
                                <span className="text-[9px] text-zinc-400 mr-2">مبلغ: {Number(file.requestedAmount || 0).toLocaleString()} ریال</span>
                              </div>
                              <span className={`px-2 py-0.5 text-[9px] font-black rounded ${
                                file.status === 'pending' ? 'bg-amber-50 text-amber-600' :
                                file.status === 'approved' ? 'bg-emerald-50 text-emerald-600' :
                                file.status === 'needs_revision' ? 'bg-rose-50 text-rose-600' :
                                'bg-zinc-100 text-zinc-500'
                              }`}>
                                {file.status === 'pending' ? 'در انتظار بررسی' :
                                 file.status === 'approved' ? 'تایید شده' :
                                 file.status === 'needs_revision' ? 'نیاز به اصلاح' : 'پیش‌نویس'}
                              </span>
                            </div>

                            {file.calculationResults && (
                              <div className="grid grid-cols-3 gap-2 bg-zinc-50 p-2 rounded-xl text-[9px] text-zinc-500 font-sans">
                                <div>
                                  <span className="block text-zinc-400 text-[8px]">طرح انتخابی:</span>
                                  <strong className="text-zinc-700">{file.calculatorName || 'نامشخص'}</strong>
                                </div>
                                <div>
                                  <span className="block text-zinc-400 text-[8px]">تعداد اقساط:</span>
                                  <strong className="text-zinc-700">{file.calculationResults.installmentCount} ماهه</strong>
                                </div>
                                <div>
                                  <span className="block text-zinc-400 text-[8px]">مبلغ هر قسط:</span>
                                  <strong className="text-zinc-700 font-mono">{Number(file.calculationResults.installmentAmount || 0).toLocaleString()} ریال</strong>
                                </div>
                              </div>
                            )}

                            {file.revisionNote && (
                              <div className="text-[10px] bg-rose-50 text-rose-700 p-2.5 rounded-xl border border-rose-100">
                                <strong>توضیح اصلاحیه:</strong> {file.revisionNote}
                              </div>
                            )}

                            {/* View Documents & Manager Review Action */}
                            <div className="pt-2 border-t border-zinc-100 flex flex-wrap gap-2 justify-between items-center mt-2">
                              <button
                                onClick={() => setActiveDocsFile(file)}
                                className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-bold transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                              >
                                <ShieldCheck size={15} />
                                <span>بررسی مدارک و ارزیابی پرونده</span>
                                <span className="bg-white/20 px-1.5 py-0.2 rounded-full font-mono text-[10px]">
                                  {(file.paymentDocuments?.length || 0) + (file.receivedChecks?.length || 0)}
                                </span>
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

              </div>

              {/* Col 3: Parameters Setup & Interactive Validation */}
              <div className="space-y-6">
                
                {/* A. Security & Parameter Configuration */}
                <div className="bg-zinc-900 text-white p-5 rounded-3xl space-y-4 shadow-xl">
                  <h4 className="font-bold text-xs flex items-center gap-2 border-b border-white/10 pb-2">
                    <Shield size={14} className="text-rose-400" />
                    تنظیم قوانین و سقف اعتباری
                  </h4>
                  
                  <div className="space-y-4 text-xs font-sans">
                    {/* Credit Limit */}
                    <div>
                      <label className="block text-[10px] text-zinc-400 font-bold mb-1">سقف اعتبار تجاری (ریال)</label>
                      <input 
                        type="number"
                        inputMode="decimal"
                        value={editCreditLimit}
                        onChange={e => setEditCreditLimit(parseInt(e.target.value || '0'))}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-white font-mono text-xs outline-none focus:border-rose-500"
                      />
                    </div>

                    {/* Delay Days */}
                    <div>
                      <label className="block text-[10px] text-zinc-400 font-bold mb-1">مهلت بازپرداخت فاکتورها (روز)</label>
                      <input 
                        type="number"
                        inputMode="numeric"
                        value={editDelayDays}
                        onChange={e => setEditDelayDays(parseInt(e.target.value || '0'))}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-white font-mono text-xs outline-none focus:border-rose-500"
                      />
                    </div>

                    {/* Penalty Rate */}
                    <div>
                      <label className="block text-[10px] text-zinc-400 font-bold mb-1">نرخ جریمه دیرکرد روزانه (درصد)</label>
                      <input 
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={editPenaltyRate}
                        onChange={e => setEditPenaltyRate(parseFloat(e.target.value || '0'))}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3.5 py-2 text-white font-mono text-xs outline-none focus:border-rose-500"
                      />
                    </div>

                    <div className="h-px bg-white/10 my-2" />

                    {/* Access Toggles */}
                    <div className="space-y-3 pt-1">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input 
                          type="checkbox"
                          checked={editWholesale}
                          onChange={e => setEditWholesale(e.target.checked)}
                          className="rounded text-rose-600 focus:ring-rose-500 w-4 h-4"
                        />
                        <span>اجازه خرید عمده‌فروشی آفلاین</span>
                      </label>

                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input 
                          type="checkbox"
                          checked={editInstallment}
                          onChange={e => setEditInstallment(e.target.checked)}
                          className="rounded text-rose-600 focus:ring-rose-500 w-4 h-4"
                        />
                        <span>مجوز ثبت فروش اقساطی مشتریان</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* B. Validation Checklist summary */}
                <div className="bg-zinc-50 p-5 rounded-3xl border border-zinc-150 space-y-3">
                  <h4 className="font-bold text-zinc-800 text-xs border-b pb-2">چک‌لیست نظارت فنی</h4>
                  <ul className="space-y-2 text-[10px] text-zinc-600 font-sans">
                    <li className="flex items-center gap-2 text-emerald-600 font-bold">
                      <CheckCircle2 size={12} /> هویت متقاضی استعلام شد
                    </li>
                    <li className="flex items-center gap-2 text-emerald-600 font-bold">
                      <CheckCircle2 size={12} /> اطلاعات حساب صیادی تایید شد
                    </li>
                    <li className="flex items-center gap-2 text-zinc-500">
                      <Clock size={12} className="text-zinc-400 shrink-0" /> تضامین فیزیکی در گاوصندوق شرکت
                    </li>
                  </ul>
                </div>

              </div>

            </div>
          </div>
        )
      )}
      </>
      )}
      {/* Credit File Documents Modal (Admin Side) */}
      {activeDocsFile && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="max-w-7xl mx-auto my-8 relative">
            <CreditFileDocuments
              creditFile={activeDocsFile}
              state={state}
              onUpdateFile={(updatedFile) => {
                const updatedFiles = (state.creditFiles || []).map(f => 
                  f.id === updatedFile.id ? updatedFile : f
                );
                onUpdateState({ ...state, creditFiles: updatedFiles });
                setActiveDocsFile(updatedFile);
              }}
              onClose={() => setActiveDocsFile(null)}
              readOnly={true}
            />
          </div>
        </div>
      )}
    </div>
  );
}
