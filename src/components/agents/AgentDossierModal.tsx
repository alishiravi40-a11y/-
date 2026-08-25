import React, { useState, useEffect } from 'react';
import { ShieldAlert, User, FileText, Upload, Award, Landmark, Store } from 'lucide-react';
import { AppState, Person, BusinessPartner } from '../../types';
import { PersonService, PersonAgentDetailsRecord } from '../../services/personService';

interface AgentDossierModalProps {
  agent: Person;
  appState: AppState;
  partner?: BusinessPartner;
  onOpenCustomerFolder: (agentId: string) => void;
  onOpenFinancialDossier: (agent: Person) => void;
}

export const AgentDossierModal: React.FC<AgentDossierModalProps> = ({
  agent,
  appState,
  partner,
  onOpenCustomerFolder,
  onOpenFinancialDossier,
}) => {
  const [liveDetails, setLiveDetails] = useState<PersonAgentDetailsRecord | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!agent?.id) return;
    PersonService.getAgentDetails(agent.id)
      .then(res => {
        if (isMounted && res) {
          setLiveDetails(res);
        }
      })
      .catch(err => console.error('AgentDossierModal: error fetching agent details:', err));
    return () => {
      isMounted = false;
    };
  }, [agent?.id]);

  const displayedStoreName = liveDetails?.store_name || liveDetails?.storeName || agent.agentDetails?.storeName || partner?.profile?.storeName || 'ثبت نشده';
  const displayedStoreAddress = liveDetails?.store_address || liveDetails?.storeAddress || (partner?.profile as any)?.address || agent.agentDetails?.storeAddress || agent.address || 'آدرس ثبت نشده است.';

  return (
    <div className="space-y-4">
      <div className="bg-amber-500/10 border border-amber-500/20 p-3.5 rounded-2xl flex items-center justify-between text-xs text-amber-900">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-amber-600 shrink-0" />
          <span>
            <strong>پرونده ثبتی و هویتی:</strong> این بخش صرفاً جهت مشاهده اسناد هویتی، مدارک ثبتی، ضامنین و وضعیت پرونده است و فاقد ابزارهای فرماندهی اعتباری می‌باشد.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Card 1: Personal and Legal Identity */}
        <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-zinc-800 border-b border-zinc-100 pb-2 flex items-center gap-2">
            <User size={15} className="text-indigo-600" />
            <span>مشخصات فردی و هویت ثبتی</span>
          </h3>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">نام و نام خانوادگی:</span>
              <strong className="text-zinc-800">{agent.name}</strong>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">نام فروشگاه / شعبه:</span>
              <span className="text-zinc-800 font-bold">{displayedStoreName}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">کد ملی / شناسه ملی:</span>
              <span className="font-mono text-zinc-800 font-bold">{agent.nationalId || 'ثبت نشده'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">شماره همراه:</span>
              <span className="font-mono text-zinc-800 font-bold">{agent.mobile || 'ثبت نشده'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">تلفن ثابت:</span>
              <span className="font-mono text-zinc-800">
                {(partner?.profile as any)?.landlinePhone || (agent.agentDetails as any)?.phone || 'ثبت نشده'}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">کد یکتای همکار:</span>
              <span className="font-mono text-indigo-700 font-bold">{agent.code}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">استان / شهر:</span>
              <span className="text-zinc-800">
                {(partner?.profile as any)?.province || 'ثبت نشده'} / {(partner?.profile as any)?.city || 'ثبت نشده'}
              </span>
            </div>
            <div className="pt-1">
              <span className="text-zinc-500 block mb-1">آدرس فروشگاه / محل فعالیت:</span>
              <p className="text-zinc-700 bg-zinc-50 p-2 rounded-lg border border-zinc-150 leading-relaxed">
                {displayedStoreAddress}
              </p>
            </div>
          </div>
        </div>

        {/* Card 2: Registered Documents and Guarantors */}
        <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-zinc-800 border-b border-zinc-100 pb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-emerald-600" />
              <span>مدارک، تضامین و ضامنین</span>
            </div>
            <button
              onClick={() => onOpenCustomerFolder(agent.id)}
              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 cursor-pointer"
            >
              مدیریت مدارک
            </button>
          </h3>

          <div className="space-y-3 text-xs">
            <div>
              <span className="text-zinc-500 text-[11px] font-bold block mb-1">چک‌های ضمانت ثبت شده:</span>
              {agent.agentDetails?.guaranteeChecks && agent.agentDetails.guaranteeChecks.length > 0 ? (
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {agent.agentDetails.guaranteeChecks.map((gc: any, idx: number) => (
                    <div key={idx} className="bg-zinc-50 p-2 rounded border border-zinc-150 text-[11px] flex justify-between items-center">
                      <span>بانک {gc.bankName} (ش: {gc.checkNumber})</span>
                      <span className="font-mono font-bold text-emerald-700">{gc.amount.toLocaleString()} ریال</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-zinc-400 bg-zinc-50 p-2 rounded border border-dashed border-zinc-200">
                  هیچ چک ضمانتی در پرونده اولیه درج نشده است.
                </div>
              )}
            </div>

            <div>
              <span className="text-zinc-500 text-[11px] font-bold block mb-1">مشخصات ضامنین پرونده:</span>
              {agent.agentDetails?.guarantors && agent.agentDetails.guarantors.length > 0 ? (
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {agent.agentDetails.guarantors.map((g: any, idx: number) => (
                    <div key={idx} className="bg-zinc-50 p-2 rounded border border-zinc-150 text-[11px]">
                      <div className="font-bold text-zinc-800">{g.name} (نسبت: {g.relation || 'نامشخص'})</div>
                      <div className="text-[10px] text-zinc-500 font-mono mt-0.5">کد ملی: {g.nationalId} | موبایل: {g.mobile || 'ثبت نشده'}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-zinc-400 bg-zinc-50 p-2 rounded border border-dashed border-zinc-200">
                  هیچ ضامنی برای این پرونده ثبت نشده است.
                </div>
              )}
            </div>

            <button
              onClick={() => onOpenCustomerFolder(agent.id)}
              className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-800 font-bold py-2 rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Upload size={13} />
              <span>📁 مشاهده اسناد پرونده فیزیکی و تصویر مدارک</span>
            </button>
          </div>
        </div>

        {/* Card 3: Contract Status and Records */}
        <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-3">
          <h3 className="text-xs font-bold text-zinc-800 border-b border-zinc-100 pb-2 flex items-center gap-2">
            <Award size={15} className="text-purple-600" />
            <span>سوابق و وضعیت قرارداد نمایندگی</span>
          </h3>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">نوع نمایندگی:</span>
              <span className="font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100">
                نماینده اعتباری و مالی
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">وضعیت پرونده ثبتی:</span>
              <span className={`font-bold px-2 py-0.5 rounded ${agent.isDocumentsApproved ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {agent.isDocumentsApproved ? 'تایید نهایی شده' : 'در انتظار تایید مدارک'}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">تاریخ ثبت اولیه:</span>
              <span className="font-mono text-zinc-700">{agent.createdAt || 'ثبت اولیه در سیستم'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-50">
              <span className="text-zinc-500">وضعیت فعالیت:</span>
              <span className="font-bold text-emerald-600">فعال در چرخه عملیات</span>
            </div>

            <div className="pt-2 space-y-2">
              <button
                onClick={() => onOpenFinancialDossier(agent)}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Landmark size={14} />
                <span>🏛️ مشاهده پرونده مالی نماینده</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentDossierModal;
