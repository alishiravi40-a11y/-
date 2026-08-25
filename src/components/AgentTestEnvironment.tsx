import React, { useState } from 'react';
import { AppState, Person, PartnerContractType } from '../types';
import PartnerDashboard from './PartnerDashboard';
import NesyehPartnerDashboard from './NesyehPartnerDashboard';
import { ShieldCheck, Play, ArrowRight, Lock } from 'lucide-react';
import { generateUniquePersonCode } from '../utils/codeGenerator';

interface AgentTestEnvironmentProps {
  realState: AppState;
}

export default function AgentTestEnvironment({ realState }: AgentTestEnvironmentProps) {
  const [testActive, setTestActive] = useState(false);
  const [testState, setTestState] = useState<AppState | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');

  const agents = realState.businessPartners?.filter(bp => bp.agencyType || (bp.roles as any[])?.includes('DEFERRED_AGENT')) || [];

  const handleStartTest = () => {
    if (!selectedAgentId) {
      alert('لطفا یک نماینده را انتخاب کنید');
      return;
    }
    const clonedState: AppState = JSON.parse(JSON.stringify(realState));
    
    // Ensure selected agent is active in test environment sandbox
    if (clonedState.businessPartners) {
      const bpIndex = clonedState.businessPartners.findIndex(p => 
        p.personId === selectedAgentId || 
        p.id === selectedAgentId || 
        p.profile?.partnerId === selectedAgentId
      );
      if (bpIndex !== -1) {
        clonedState.businessPartners[bpIndex].status = 'active';
        if (!clonedState.businessPartners[bpIndex].profile) {
          clonedState.businessPartners[bpIndex].profile = {} as any;
        }
        clonedState.businessPartners[bpIndex].profile.contractStatus = 'فعال';
        if (!clonedState.businessPartners[bpIndex].contract) {
          clonedState.businessPartners[bpIndex].contract = {
            id: `cnt_${Date.now()}`,
            partnerId: selectedAgentId,
            type: PartnerContractType.CREDIT_AGENT,
            status: 'active',
            startDate: new Date().toISOString(),
            creditLimit: 1000000000,
            hasRepresentativeGuarantee: true,
            commissionRate: 10,
            createdAt: new Date().toISOString()
          };
        } else {
          clonedState.businessPartners[bpIndex].contract.status = 'active';
        }
      }
    }
    if (clonedState.persons) {
      const pIndex = clonedState.persons.findIndex(p => p.id === selectedAgentId);
      if (pIndex !== -1) {
        clonedState.persons[pIndex].isDocumentsApproved = true;
      }
    }

    const targetBp = clonedState.businessPartners?.find(p => p.id === selectedAgentId || p.personId === selectedAgentId);
    console.log('[DEBUG SIMULATOR OPENED]', {
      selectedAgentId,
      partner: targetBp,
      calculatorOverrides: targetBp?.calculatorOverrides,
    });

    setTestState(clonedState);
    setTestActive(true);
  };

  const handleStopTest = () => {
    setTestActive(false);
    setTestState(null);
  };

  const handleUpdateTestState = (newStateOrUpdater: AppState | ((prev: AppState) => AppState)) => {
    setTestState(prev => {
      if (!prev) return prev;
      return typeof newStateOrUpdater === 'function' ? newStateOrUpdater(prev) : newStateOrUpdater;
    });
  };

  if (testActive && testState) {
    const agent = agents.find(a => a.id === selectedAgentId);
    const isNesyeh = (agent?.roles as any[])?.includes('DEFERRED_AGENT');
    
    // Simulate Nesyeh blocking logic
    const nesyehOnboarding = agent?.nesyehOnboarding;
    const isNesyehBlocked = isNesyeh && nesyehOnboarding && (
      nesyehOnboarding.isLinkActive === false ||
      nesyehOnboarding.onboardingStatus === 'SUSPENDED' ||
      nesyehOnboarding.onboardingStatus === 'TERMINATED'
    );

    if (isNesyehBlocked) {
      return (
        <div className="flex flex-col h-full absolute inset-0 z-[100] bg-slate-950 text-right" dir="rtl">
          <div className="bg-red-600 text-white text-center py-2 font-bold flex justify-between px-6 items-center shrink-0">
            <div className="flex items-center gap-2">
              <ShieldCheck size={20} />
              <span>محیط آزمایشی - مسدود شده</span>
            </div>
            <button onClick={handleStopTest} className="flex items-center gap-1 bg-red-700 hover:bg-red-800 px-3 py-1 rounded-lg text-sm transition-colors">
              <ArrowRight size={16} /> خروج از حالت تست
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-md w-full p-8 text-center space-y-6 shadow-2xl border border-rose-500/30">
              <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
                <Lock className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-black text-zinc-900">دسترسی به سامانه نسیه مسدود است</h2>
                <p className="text-xs text-zinc-600 leading-relaxed">این نماینده مسدود شده است.</p>
              </div>
              <button onClick={handleStopTest} className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-3 rounded-xl text-xs transition-colors cursor-pointer">
                بازگشت به تنظیمات تست
              </button>
            </div>
          </div>
        </div>
      );
    }
    
    return (
      <div className="flex flex-col h-full absolute inset-0 z-[100] bg-zinc-50" dir="rtl">
        <div className="bg-red-600 text-white text-center py-2.5 font-bold flex justify-between px-6 items-center shrink-0 shadow-md">
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="animate-pulse" />
            <span className="text-sm">محیط آزمایشی نماینده - هیچ داده واقعی ثبت نمی‌شود</span>
          </div>
          <button 
            onClick={handleStopTest}
            className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg text-sm transition-colors backdrop-blur-sm"
          >
            <ArrowRight size={16} />
            پایان تست و بازگشت
          </button>
        </div>
        
        <div className="flex-1 overflow-hidden relative">
          {isNesyeh ? (
            <NesyehPartnerDashboard 
              state={testState}
              currentUserId="admin"
              currentAgentId={selectedAgentId}
              onLogout={handleStopTest}
              onUpdateState={handleUpdateTestState}
            />
          ) : (
            <PartnerDashboard 
              state={testState}
              currentUserId="admin"
              currentAgentId={selectedAgentId}
              onLogout={handleStopTest}
              onAddCustomer={(personData) => {
                const nextCode = generateUniquePersonCode(testState.persons);
                const newPerson: Person = {
                  id: crypto.randomUUID(),
                  code: nextCode,
                  name: personData.name || '',
                  mobile: personData.mobile,
                  phone: personData.phone,
                  nationalId: personData.nationalId,
                  address: personData.address,
                  role: 'debtor',
                  createdAt: new Date().toISOString(),
                  createdBy: 'admin',
                  representativeId: selectedAgentId
                };
                handleUpdateTestState(prev => ({ ...prev, persons: [...prev.persons, newPerson] }));
              }}
              onUpdateState={handleUpdateTestState}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-zinc-200">
        <div className="flex items-center gap-3 mb-6 border-b pb-4">
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h2 className="text-xl font-black text-zinc-800">محیط تست نماینده اعتباری</h2>
            <p className="text-sm text-zinc-500 mt-1">
              در این محیط می‌توانید پنل نمایندگان را بدون هیچ‌گونه تاثیری بر روی اطلاعات واقعی یا سیستم حسابداری اصلی سیستم، تست کنید.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-zinc-700 mb-2">انتخاب نماینده برای تست</label>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-4 py-3 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-all outline-none"
            >
              <option value="">-- انتخاب کنید --</option>
              {agents.map(a => {
                const person = realState.persons.find(p => p.id === a.personId);
                return (
                  <option key={a.id} value={a.id}>
                    {a.profile?.storeName || person?.name || a.id} {(a.roles as any[])?.includes('DEFERRED_AGENT') ? '(نسیه)' : '(اعتباری)'}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl text-blue-800 text-xs leading-relaxed space-y-2">
            <p className="font-bold">نکات قابل توجه در محیط تست:</p>
            <ul className="list-disc list-inside space-y-1 pr-2 opacity-80">
              <li>یک کپی کامل از داده‌های سیستم گرفته می‌شود.</li>
              <li>کلیه عملیات اعم از ایجاد پرونده، محاسبه چک‌ها و بارگذاری مدارک بصورت مجازی انجام می‌شود.</li>
              <li>هیچ اطلاعاتی در دیتابیس اصلی، حساب‌های معین و گردش‌های مالی ثبت نخواهد شد.</li>
              <li>با خروج از محیط تست، کلیه داده‌های تستی از بین می‌روند.</li>
            </ul>
          </div>

          <button
            onClick={handleStartTest}
            disabled={!selectedAgentId}
            className="w-full flex items-center justify-center gap-2 bg-red-600 text-white rounded-xl py-3.5 font-bold disabled:opacity-50 hover:bg-red-700 transition-colors shadow-sm shadow-red-600/20"
          >
            <Play size={18} />
            ورود به محیط شبیه‌ساز نماینده
          </button>
        </div>
      </div>
    </div>
  );
}
