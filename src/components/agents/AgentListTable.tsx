import React from 'react';
import { Users, User, Sliders, Landmark, Trash2 } from 'lucide-react';
import { AppState, Person, AgencyType, PartnerRole } from '../../types';

interface AgentListTableProps {
  agents: Person[];
  appState: AppState;
  activeUnit: 'credit_agents' | 'sales_agents' | 'investors' | 'visitors' | 'contract_partners' | null;
  agentSearchQuery: string;
  showAddForm: boolean;
  getPartnerWalletBalance: (partnerId: string) => number;
  onSelectAgent: (agentId: string, tab: 'dossier' | 'command_center' | 'financial') => void;
  onDeleteAgent: (agentId: string) => void;
}

export const AgentListTable: React.FC<AgentListTableProps> = ({
  agents,
  appState,
  activeUnit,
  agentSearchQuery,
  showAddForm,
  getPartnerWalletBalance,
  onSelectAgent,
  onDeleteAgent,
}) => {
  const filteredAgents = agents.filter(agent => {
    if (!agentSearchQuery.trim()) return true;
    const q = agentSearchQuery.trim().toLowerCase();
    return (
      agent.name.toLowerCase().includes(q) ||
      agent.code.toLowerCase().includes(q) ||
      (agent.mobile && agent.mobile.includes(q)) ||
      (agent.nationalId && agent.nationalId.includes(q))
    );
  });

  return (
    <div className="space-y-3">
      {filteredAgents.map(agent => {
        const dynamicWalletBal = getPartnerWalletBalance(agent.id);
        const partner = appState.businessPartners?.find(bp => bp.personId === agent.id);

        const isCredit = Boolean(
          (agent.isAgent && (agent.agencyRole === 'credit' || agent.agencyRole === 'both')) ||
          (partner &&
            partner.agencyType !== AgencyType.INSTALLMENT_ONLY &&
            (partner.agencyType as string) !== 'INSTALLMENT_ONLY' &&
            (
              partner.agencyType === AgencyType.CREDIT_ONLY ||
              (partner.agencyType as string) === 'CREDIT_ONLY' ||
              partner.agencyType === AgencyType.BOTH ||
              (partner.agencyType as string) === 'BOTH' ||
              Boolean(partner.creditExtension) ||
              partner.contract?.type === ('CREDIT_AGENT' as any) ||
              (partner.roles || []).includes('CREDIT_AGENT' as any) ||
              (partner.roles || []).includes(PartnerRole.CREDIT_SALES_AGENT) ||
              (partner.roles || []).includes('CREDIT_SALES_AGENT' as any)
            )) ||
          (!partner && agent.isAgent && (agent.role === 'creditor' || agent.role === 'both' || !agent.agencyRole))
        );

        const isSales = Boolean(
          (agent.isAgent && (agent.agencyRole === 'sales' || agent.agencyRole === 'both')) ||
          (partner &&
            partner.agencyType !== AgencyType.CREDIT_ONLY &&
            (partner.agencyType as string) !== 'CREDIT_ONLY' &&
            (
              partner.salesExtension?.nesyehSettings ||
              partner.nesyehSettings ||
              partner.nesyehOnboarding ||
              partner.agencyType === AgencyType.INSTALLMENT_ONLY ||
              (partner.agencyType as string) === 'INSTALLMENT_ONLY' ||
              partner.agencyType === AgencyType.BOTH ||
              (partner.agencyType as string) === 'BOTH' ||
              partner.agencyType === ('DEFERRED_PAYMENT' as any) ||
              partner.contract?.type === ('DEFERRED_AGENT' as any) ||
              (partner.roles || []).includes('DEFERRED_AGENT' as any)
            )) ||
          (!partner && agent.isAgent && (agent.role === 'debtor' || agent.role === 'both'))
        );

        return (
          <div
            key={agent.id}
            className="bg-white rounded-2xl border border-zinc-200 hover:border-zinc-300 transition-all duration-200 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="bg-indigo-50 text-indigo-700 p-3 rounded-xl border border-indigo-100 shrink-0">
                <Users size={20} />
              </div>
              <div>
                <div className="font-sans font-bold text-sm text-zinc-900 flex items-center gap-2 flex-wrap">
                  <span>{agent.name}</span>
                  <span className="text-[10px] font-mono bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-600 font-normal">
                    کد: {agent.code}
                  </span>
                  {isCredit && isSales && (
                    <span className="bg-teal-50 text-teal-700 text-[9px] font-bold px-2 py-0.5 rounded border border-teal-200">
                      اعتباری و فروش
                    </span>
                  )}
                  {isCredit && !isSales && (
                    <span className="bg-purple-50 text-purple-700 text-[9px] font-bold px-2 py-0.5 rounded border border-purple-200">
                      نماینده اعتباری
                    </span>
                  )}
                  {isSales && !isCredit && (
                    <span className="bg-blue-50 text-blue-700 text-[9px] font-bold px-2 py-0.5 rounded border border-blue-200">
                      نماینده فروش
                    </span>
                  )}
                  {agent.isDocumentsApproved ? (
                    <span className="bg-emerald-50 text-emerald-700 text-[9px] font-bold px-2 py-0.5 rounded border border-emerald-200">
                      مدارک تایید شده
                    </span>
                  ) : (
                    <span className="bg-rose-50 text-rose-700 text-[9px] font-bold px-2 py-0.5 rounded border border-rose-200">
                      مدارک معلق
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  تلفن: <span className="font-mono">{agent.mobile || 'بدون شماره'}</span> | فروشگاه: {agent.agentDetails?.storeName || partner?.profile?.storeName || 'دفتر نماینده اعتباری'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-zinc-100">
              <div className="text-left hidden md:block px-2">
                <div className="text-[10px] text-zinc-400 font-bold">کیف پول اعتباری</div>
                <div className="text-xs font-mono font-bold text-zinc-800">
                  {dynamicWalletBal.toLocaleString()} ریال
                </div>
              </div>

              {/* Button 1: مشخصات فردی (Blue) */}
              <button
                onClick={() => onSelectAgent(agent.id, 'dossier')}
                className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                title="بانک اطلاعات هویتی، شخصی، مدارک ثبتی و ضامنین"
              >
                <User size={14} />
                <span>مشخصات فردی</span>
              </button>

              {/* Button 2: اتاق فرمان و تنظیمات (Indigo) */}
              <button
                onClick={() => onSelectAgent(agent.id, 'command_center')}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                title="مغز متفکر مدیریت، صادرکننده دستورالعمل‌ها، مهلت تنفس، جریمه و ابزارها"
              >
                <Sliders size={14} />
                <span>اتاق فرمان و تنظیمات</span>
              </button>

              {/* Button 3: ریز حساب مالی (Emerald) */}
              <button
                onClick={() => onSelectAgent(agent.id, 'financial')}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                title="ریز حساب و کتاب شخصی، مانده‌ها، اسناد و صورت‌حساب دفترچه مالی"
              >
                <Landmark size={14} />
                <span>ریز حساب مالی</span>
              </button>

              <button
                onClick={() => onDeleteAgent(agent.id)}
                className="text-red-500 hover:text-red-700 p-2 rounded-lg hover:bg-rose-50 transition"
                title={activeUnit === 'sales_agents' ? "لغو نقش نماینده فروش" : "لغو نقش نماینده اعتباری"}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        );
      })}

      {agents.length === 0 && !showAddForm && (
        <div className="text-center text-zinc-500 text-[13px] py-12 bg-white border border-zinc-200 rounded-2xl space-y-2">
          <p className="font-bold">
            {activeUnit === 'sales_agents'
              ? 'هیچ همکار یا نماینده‌ای در واحد نمایندگان فروش ثبت نشده است.'
              : 'هیچ همکار یا نماینده‌ای در واحد نمایندگان اعتباری ثبت نشده است.'}
          </p>
          <p className="text-xs text-zinc-400">
            برای تعریف نماینده جدید، روی دکمه «ایجاد نماینده» در بالای همین صفحه کلیک نمایید.
          </p>
        </div>
      )}
    </div>
  );
};

export default AgentListTable;
