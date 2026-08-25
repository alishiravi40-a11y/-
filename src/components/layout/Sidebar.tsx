import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, ShoppingCart, Users, CreditCard, FileSpreadsheet, FileText, 
  PackagePlus, Landmark, Plus, Package, Warehouse as WarehouseIcon, Target, History, 
  ChevronDown, Lock, ShieldCheck, Server, BookOpen, Calculator, Shield, CheckSquare, 
  Sliders, MessageSquare, Coins, List, FileCheck
} from 'lucide-react';
import { Person } from '../../types';

export type TabType = 'dashboard' | 'invoices' | 'people' | 'debtors' | 'creditors' | 'products' | 'checks' | 'reports' | 'accounts' | 'backup' | 'agents' | 'agent_checks' | 'installments' | 'opening_balances' | 'warehouses' | 'cost_centers' | 'audit_logs' | 'users' | 'roles' | 'knowledge_center' | 'partner_credit' | 'agent_dossiers' | 'calc_lab' | 'calc_management' | 'credit_control_agents' | 'agent_center' | 'credit_control_approval' | 'credit_policies' | 'agent_test_mode' | 'sms_management_center' | 'investor_center';

interface SidebarProps {
  currentUserRole: 'admin' | 'accountant' | 'cashier' | 'seller' | 'agent' | null;
  activeTab: string;
  setActiveTab: (tab: TabType) => void;
  peopleSubTab: 'central' | 'debtors' | 'debtors_installment' | 'creditors' | 'agents';
  setPeopleSubTab: (subTab: 'central' | 'debtors' | 'debtors_installment' | 'creditors' | 'agents') => void;
  pendingAgentsCount: number;
  onOpenManualVoucher: () => void;
  setSelectedPersonForLedger: (p: Person | undefined) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentUserRole,
  activeTab,
  setActiveTab,
  peopleSubTab,
  setPeopleSubTab,
  pendingAgentsCount,
  onOpenManualVoucher,
  setSelectedPersonForLedger,
}) => {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [isPeopleSubmenuOpen, setIsPeopleSubmenuOpen] = useState(false);

  const getSidebarItems = (role: string | null) => {
    if (role === 'agent') {
      return [
        { id: 'checks', label: 'ثبت و پیگیری چک‌ها', icon: CreditCard, color: 'text-purple-400' },
        { id: 'installments', label: 'ثبت فروش اقساطی', icon: FileText, color: 'text-emerald-400' },
        { id: 'knowledge_center', label: 'مرکز دانش هوشمند', icon: BookOpen, color: 'text-sky-400' },
      ];
    }

    const allTabs = [
      { id: 'dashboard', label: 'پیشخوان سیستم', icon: LayoutDashboard, color: 'text-emerald-400' },
      { id: 'agent_center', label: '🏛 مرکز مدیریت نمایندگان', icon: Landmark, color: 'text-indigo-400' },
      { id: 'invoices', label: 'فاکتورها', icon: ShoppingCart, color: 'text-amber-400' },
      { id: 'people', label: 'اشخاص و همکاران', icon: Users, color: 'text-teal-400' },
      { id: 'installments', label: 'مدیریت اقساط', icon: List, color: 'text-emerald-300' },
      { id: 'partner_credit', label: 'مدیریت پرونده اعتبار', icon: FileCheck, color: 'text-blue-500' },
      { id: 'agent_dossiers', label: 'پرونده نمایندگان', icon: ShieldCheck, color: 'text-rose-400' },
      { id: 'credit_control_agents', label: 'کنترل حساب نمایندگان', icon: ShieldCheck, color: 'text-indigo-400' },
      { id: 'credit_control_approval', label: 'تأیید جریمه دیرکرد', icon: CheckSquare, color: 'text-rose-400' },
      { id: 'credit_policies', label: 'سیاست‌های اعتباری و ضمانت', icon: ShieldCheck, color: 'text-emerald-500' },
      { id: 'opening_balances', label: 'موجودی افتتاحیه', icon: Package, color: 'text-emerald-500' },
      { id: 'products', label: 'کالاهای انبار', icon: PackagePlus, color: 'text-blue-400' },
      { id: 'warehouses', label: 'مدیریت انبارها', icon: WarehouseIcon, color: 'text-blue-300' },
      { id: 'checks', label: 'مدیریت چک‌ها', icon: CreditCard, color: 'text-purple-400' },
      { id: 'reports', label: 'گزارش‌های معین', icon: FileSpreadsheet, color: 'text-pink-400' },
      { id: 'accounts', label: 'حساب‌های معین و هزینه‌ها', icon: Landmark, color: 'text-amber-400' },
      { id: 'cost_centers', label: 'مراکز هزینه', icon: Target, color: 'text-purple-500' },
      { id: 'audit_logs', label: 'لاگ تغییرات', icon: History, color: 'text-zinc-400' },
      { id: 'backup', label: 'پشتیبان‌گیری', icon: Server, color: 'text-indigo-400' },
      { id: 'users', label: 'مدیریت کاربران', icon: Lock, color: 'text-purple-600' },
      { id: 'roles', label: 'نقش‌ها و دسترسی‌ها', icon: Shield, color: 'text-indigo-400' },
      { id: 'knowledge_center', label: 'مرکز دانش هوشمند', icon: BookOpen, color: 'text-sky-400' },
      { id: 'calc_lab', label: 'آزمایشگاه ماشین‌حساب‌ها', icon: Calculator, color: 'text-indigo-400' },
      { id: 'calc_management', label: 'مرکز مدیریت ماشین‌حساب‌ها', icon: Sliders, color: 'text-teal-400' },
      { id: 'agent_test_mode', label: 'حالت تست نماینده اعتباری', icon: ShieldCheck, color: 'text-rose-500' },
      { id: 'sms_management_center', label: '📱 مرکز مدیریت پیامک', icon: MessageSquare, color: 'text-amber-500' },
      { id: 'investor_center', label: '💰 مرکز مدیریت سرمایه‌گذاران', icon: Coins, color: 'text-emerald-400' },
    ];

    if (role === 'admin') return allTabs;

    if (role === 'accountant') {
      return allTabs.filter(t => !['products', 'warehouses', 'opening_balances', 'backup', 'audit_logs'].includes(t.id));
    }

    if (role === 'cashier') {
      return allTabs.filter(t => ['dashboard', 'people', 'checks', 'installments', 'reports'].includes(t.id));
    }

    if (role === 'seller') {
      return allTabs.filter(t => ['dashboard', 'invoices', 'products', 'warehouses'].includes(t.id));
    }

    return [];
  };

  return (
    <>
      <motion.div
        className="absolute top-0 bottom-0 right-0 z-40 bg-zinc-900 border-l border-zinc-800 text-zinc-300 flex flex-col justify-between select-none"
        initial={false}
        animate={{ width: isSidebarExpanded ? 220 : 48 }}
        transition={{ type: 'spring', damping: 20, stiffness: 150 }}
        onMouseEnter={() => setIsSidebarExpanded(true)}
        onMouseLeave={() => setIsSidebarExpanded(false)}
      >
        {/* Top items */}
        <div className="flex flex-col pt-4 overflow-y-auto overflow-x-hidden">
          {getSidebarItems(currentUserRole).map((item) => {
            const IconComp = item.icon;
            const isActive = activeTab === item.id;

            if (item.id === 'people') {
              return (
                <div key={item.id} className="flex flex-col w-full">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('people');
                      setIsPeopleSubmenuOpen(!isPeopleSubmenuOpen);
                      setSelectedPersonForLedger(undefined);
                    }}
                    className={`flex items-center justify-between px-3.5 py-3 w-full text-right transition-all group relative ${
                      isActive 
                        ? 'bg-zinc-800 text-white font-bold border-r-4 border-emerald-500' 
                        : 'hover:bg-zinc-800/50 hover:text-white text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center space-x-3 space-x-reverse">
                      <IconComp size={18} className={`${item.color} shrink-0`} />
                      <AnimatePresence>
                        {isSidebarExpanded && (
                          <motion.span
                            initial={{ opacity: 0, x: 10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="font-sans text-[11px] whitespace-nowrap overflow-hidden pr-1"
                          >
                            {item.label}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    {isSidebarExpanded && (
                      <ChevronDown size={14} className={`text-zinc-500 transition-transform duration-200 ${isPeopleSubmenuOpen || isActive ? 'rotate-180' : ''}`} />
                    )}

                    {!isSidebarExpanded && (
                      <div className="hidden md:group-hover:block absolute right-12 top-2 bg-zinc-950 text-white text-[10px] font-sans px-2.5 py-1 rounded shadow-lg whitespace-nowrap z-50">
                        {item.label}
                      </div>
                    )}
                  </button>

                  <AnimatePresence>
                    {(isPeopleSubmenuOpen || isActive) && isSidebarExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="bg-zinc-950/40 flex flex-col text-right pr-9 py-1 border-r border-zinc-800"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('people');
                            setPeopleSubTab('central');
                          }}
                          className={`py-1.5 text-[10px] font-sans text-right transition-colors ${
                            isActive && peopleSubTab === 'central'
                              ? 'text-teal-400 font-bold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          بانک مرکزی اشخاص (همه)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('people');
                            setPeopleSubTab('debtors');
                          }}
                          className={`py-1.5 text-[10px] font-sans text-right transition-colors ${
                            isActive && peopleSubTab === 'debtors'
                              ? 'text-emerald-400 font-bold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          بدهکاران عادی
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('people');
                            setPeopleSubTab('debtors_installment');
                          }}
                          className={`py-1.5 text-[10px] font-sans text-right transition-colors ${
                            isActive && peopleSubTab === 'debtors_installment'
                              ? 'text-emerald-400 font-bold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          بدهکاران اقساطی
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('people');
                            setPeopleSubTab('creditors');
                          }}
                          className={`py-1.5 text-[10px] font-sans text-right transition-colors ${
                            isActive && peopleSubTab === 'creditors'
                              ? 'text-emerald-400 font-bold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          بستانکاران (همکاران)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('people');
                            setPeopleSubTab('agents');
                          }}
                          className={`py-1.5 text-[10px] font-sans text-right transition-colors ${
                            isActive && peopleSubTab === 'agents'
                              ? 'text-emerald-400 font-bold'
                              : 'text-zinc-400 hover:text-white'
                          }`}
                        >
                          نمایندگان فروش
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            }

            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id as TabType);
                  setIsSidebarExpanded(false);
                  setSelectedPersonForLedger(undefined);
                }}
                className={`flex items-center space-x-3 space-x-reverse px-3.5 py-3 w-full text-right transition-all group relative ${
                  isActive 
                    ? 'bg-zinc-800 text-white font-bold border-r-4 border-emerald-500' 
                    : 'hover:bg-zinc-800/50 hover:text-white text-zinc-400'
                }`}
              >
                <IconComp size={18} className={`${item.color} shrink-0`} />
                <AnimatePresence>
                  {isSidebarExpanded && (
                    <motion.span
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className="font-sans text-[11px] whitespace-nowrap overflow-hidden pr-1"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>

                {item.id === 'agent_dossiers' && pendingAgentsCount > 0 && (
                  <span className="absolute left-2.5 bg-rose-600 text-white text-[9px] w-4.5 h-4.5 rounded-full flex items-center justify-center font-bold">
                    {pendingAgentsCount}
                  </span>
                )}
                
                {!isSidebarExpanded && (
                  <div className="hidden md:group-hover:block absolute right-12 top-2 bg-zinc-950 text-white text-[10px] font-sans px-2.5 py-1 rounded shadow-lg whitespace-nowrap z-50">
                    {item.label}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Bottom Quick manual voucher action */}
        <div className="pb-4 flex flex-col items-center">
          <button
            onClick={() => {
              onOpenManualVoucher();
              setIsSidebarExpanded(false);
            }}
            className={`flex items-center justify-center p-2.5 rounded-xl transition bg-emerald-600 hover:bg-emerald-500 text-white shadow ${
              isSidebarExpanded ? 'w-[calc(100%-24px)] mx-3 gap-1.5' : 'w-9 h-9'
            }`}
            title="ثبت سند دستی جدید"
          >
            <Plus size={16} />
            {isSidebarExpanded && (
              <span className="font-sans text-[10px] font-bold whitespace-nowrap">سند دستی جدید</span>
            )}
          </button>
        </div>
      </motion.div>

      {/* Sidebar Backdrop Overlay on Expand (Mobile friendly) */}
      {isSidebarExpanded && (
        <div 
          onClick={() => setIsSidebarExpanded(false)}
          className="absolute inset-0 bg-black/45 backdrop-blur-xs z-30 transition-all duration-200"
        />
      )}
    </>
  );
};

export default Sidebar;
