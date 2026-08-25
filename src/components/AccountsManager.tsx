/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, X, Search, Landmark, HelpCircle, Briefcase, 
  ArrowUpRight, ArrowDownLeft, ShieldAlert, CheckCircle, Scale, Coins, Package, Pencil, Ban
} from 'lucide-react';
import { DEFAULT_SUBSIDIARIES } from '../utils/accounting';
import BankDashboard from './BankDashboard';
import { CoaReadService, useCoaReadModel } from '../services/CoaReadService';
import { getDefaultAuthSessionService } from '../services/authSessionService';
import { 
  AppState, 
  AccountSubsidiary, 
  AccountGeneral, 
  AccountGroup, 
  Person, 
  Product, 
  JournalVoucher, 
  VoucherEntry,
  ReceivedCheckState,
  BouncedReceivedCheckSubState,
  BouncedPaidCheckSubState
} from '../types';
import { getCurrentJalaliDate } from '../utils/jalali';
import { parseNumericValue } from '../utils/accounting';
import SubsidiaryLedgerModal from './SubsidiaryLedgerModal';
import BankTerminalManager from './BankTerminalManager';
import { BankTerminal } from '../types';

interface AccountsManagerProps {
  state: AppState;
  onAddSubsidiary: (newSub: AccountSubsidiary) => void;
  onEditSubsidiary?: (updatedSub: AccountSubsidiary) => void;
  onAddManualVoucher: (voucherData: Omit<JournalVoucher, 'id' | 'voucherNumber' | 'gregorianDate' | 'isAutomatic'>) => void;
  subsidiaryBalances: Record<string, { debit: number; credit: number; balance: number }>;
  personBalances: Record<string, { debit: number; credit: number; net: number; nature: 'بدهکار' | 'بستانکار' | 'بی‌حساب' }>;
  onUpdateCheckState: (checkId: string, newState: ReceivedCheckState, newSubState?: BouncedReceivedCheckSubState | BouncedPaidCheckSubState, note?: string, bankId?: string) => void;
  onNavigate?: (tab: string) => void;
  onViewVoucher?: (voucherId: string) => void;
  onViewCheck?: (checkId: string) => void;
  onEditVoucher: (voucher: JournalVoucher) => void;
  onDeleteVoucher: (voucher: JournalVoucher) => void;
  onNewVoucher: () => void;
  onUpdateBankTerminals?: (terminals: BankTerminal[]) => void;
}

const GENERAL_CATEGORIES_CONFIG: Record<
  AccountGeneral,
  { groupType: AccountGroup; prefix: string; label: string; groupLabel: string }
> = {
  // هزینه‌ها
  'هزینه‌های عمومی و اداری': {
    groupType: 'هزینه‌ها',
    prefix: '702',
    label: 'هزینه‌های عمومی، اداری، حقوق، پذیرایی و کرایه...',
    groupLabel: 'هزینه‌ها'
  },
  'هزینه‌های مالی': {
    groupType: 'هزینه‌ها',
    prefix: '703',
    label: 'هزینه‌های مالی، سود و بهره پرداختی، کارمزد وام...',
    groupLabel: 'هزینه‌ها'
  },
  'بهای تمام شده کالای فروش رفته': {
    groupType: 'هزینه‌ها',
    prefix: '701',
    label: 'بهای تمام شده کالای فروش رفته (COGS)',
    groupLabel: 'هزینه‌ها'
  },

  // دارایی‌های جاری
  'بانک‌ها': {
    groupType: 'دارایی‌های جاری',
    prefix: '101',
    label: 'بانک‌ها (حساب‌های جاری و سپرده بانکی جدید)',
    groupLabel: 'دارایی‌های جاری'
  },
  'صندوق‌ها': {
    groupType: 'دارایی‌های جاری',
    prefix: '102',
    label: 'صندوق‌ها و تنخواه‌گردان‌های فروشگاه',
    groupLabel: 'دارایی‌های جاری'
  },
  'بدهکاران تجاری': {
    groupType: 'دارایی‌های جاری',
    prefix: '103',
    label: 'بدهکاران تجاری (حساب‌ها و معین‌های دریافتنی)',
    groupLabel: 'دارایی‌های جاری'
  },
  'اسناد دریافتنی': {
    groupType: 'دارایی‌های جاری',
    prefix: '104',
    label: 'اسناد دریافتنی (چک‌ها و سفته‌های دریافتی)',
    groupLabel: 'دارایی‌های جاری'
  },
  'اسناد در جریان وصول': {
    groupType: 'دارایی‌های جاری',
    prefix: '104',
    label: 'اسناد و چک‌های در جریان وصول',
    groupLabel: 'دارایی‌های جاری'
  },
  'موجودی کالا': {
    groupType: 'دارایی‌های جاری',
    prefix: '105',
    label: 'موجودی کالا و انبارها',
    groupLabel: 'دارایی‌های جاری'
  },
  'پیش‌پرداخت‌ها': {
    groupType: 'دارایی‌های جاری',
    prefix: '106',
    label: 'پیش‌پرداخت‌ها، ودیعه‌ها و مالیات خرید',
    groupLabel: 'دارایی‌های جاری'
  },

  // بدهی‌های جاری و غیرجاری
  'اسناد پرداختنی': {
    groupType: 'بدهی‌های جاری',
    prefix: '201',
    label: 'اسناد پرداختنی (چک‌های صادرشده)',
    groupLabel: 'بدهی‌های جاری و غیرجاری'
  },
  'بستانکاران تجاری': {
    groupType: 'بدهی‌های جاری',
    prefix: '202',
    label: 'بستانکاران تجاری (حساب‌های پرداختنی)',
    groupLabel: 'بدهی‌های جاری و غیرجاری'
  },
  'پیش‌دریافت‌ها': {
    groupType: 'بدهی‌های جاری',
    prefix: '203',
    label: 'پیش‌دریافت‌ها از مشتریان',
    groupLabel: 'بدهی‌های جاری و غیرجاری'
  },
  'تسهیلات دریافتی': {
    groupType: 'بدهی‌های غیرجاری',
    prefix: '204',
    label: 'تسهیلات، وام‌ها و استقراض‌های دریافتی',
    groupLabel: 'بدهی‌های جاری و غیرجاری'
  },

  // حقوق صاحبان سهام
  'جاری شرکا و سرمایه‌گذاران': {
    groupType: 'حقوق صاحبان سهام',
    prefix: '501',
    label: 'جاری شرکا، سهامداران و سرمایه‌گذاران',
    groupLabel: 'حقوق صاحبان سهام'
  },
  'سرمایه': {
    groupType: 'حقوق صاحبان سهام',
    prefix: '501',
    label: 'سرمایه اولیه و ثبت شده',
    groupLabel: 'حقوق صاحبان سهام'
  },
  'تراز افتتاحیه': {
    groupType: 'حقوق صاحبان سهام',
    prefix: '999',
    label: 'حساب واسط تراز افتتاحیه',
    groupLabel: 'حقوق صاحبان سهام'
  },

  // درآمدها
  'فروش کالا': {
    groupType: 'درآمدها',
    prefix: '601',
    label: 'فروش کالا، خدمات و درآمدهای اصلی',
    groupLabel: 'درآمدها'
  },
  'درآمد کارمزد': {
    groupType: 'درآمدها',
    prefix: '602',
    label: 'درآمد کارمزد، سود اقساط و درآمدهای متفرقه',
    groupLabel: 'درآمدها'
  }
};

export default function AccountsManager({ 
  state, 
  onAddSubsidiary, 
  onViewVoucher,
  onViewCheck,

  onEditSubsidiary,
  onAddManualVoucher,
  subsidiaryBalances,
  personBalances,
  onUpdateCheckState,
  onNavigate,
  onEditVoucher,
  onDeleteVoucher,
  onNewVoucher,
  onUpdateBankTerminals
}: AccountsManagerProps) {
  
  // Custom Accounts States
  const [activeSubTab, setActiveSubTab] = useState<'subsidiaries' | 'opening_balances' | 'bank_checks' | 'bank_terminals'>('subsidiaries');
  const [isAddingSub, setIsAddingSub] = useState(false);
  const [subSearchQuery, setSubSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'code' | 'name'>('code');
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
  const [selectedLedgerSub, setSelectedLedgerSub] = useState<AccountSubsidiary | null>(null);
  
  const [newSubName, setNewSubName] = useState('');
  const [newSubGeneralType, setNewSubGeneralType] = useState<AccountGeneral>('هزینه‌های عمومی و اداری');

  // Opening Balance States
  const [openingType, setOpeningType] = useState<'bank_cash' | 'person' | 'product'>('bank_cash');
  
  // A. Bank/Cash opening balance
  const [opSubId, setOpSubId] = useState('');
  const [opAmount, setOpAmount] = useState<number>(0);
  
  // B. Person opening balance
  const [opPersonId, setOpPersonId] = useState('');
  const [opPersonAmount, setOpPersonAmount] = useState<number>(0);
  const [opPersonNature, setOpPersonNature] = useState<'debit' | 'credit'>('debit'); // debit = customer owes us, credit = we owe vendor
  
  // C. Product opening balance
  const [opProductId, setOpProductId] = useState('');
  const [opProductQty, setOpProductQty] = useState<number>(0);
  const [opProductCost, setOpProductCost] = useState<number>(0);

  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // PostgreSQL Chart of Accounts Read Path State
  const { subsidiaries: coaSubsidiaries, isLoading: isLoadingPgCoa, error: pgCoaError } = useCoaReadModel();
  const pgCoa = pgCoaError ? null : (coaSubsidiaries.length > 0 ? coaSubsidiaries : null);

  const [editingSub, setEditingSub] = useState<AccountSubsidiary | null>(null);
  const [editSubName, setEditSubName] = useState('');
  const [editSubCode, setEditSubCode] = useState('');
  const [editSubWarning, setEditSubWarning] = useState(false);

  const handleEditClick = (e: React.MouseEvent, sub: AccountSubsidiary) => {
    e.stopPropagation();
    setEditingSub(sub);
    setEditSubName(sub.name);
    setEditSubCode(sub.code);
    const isSystem = DEFAULT_SUBSIDIARIES.some(ds => ds.id === sub.id);
    setEditSubWarning(isSystem);
  };

  // Auto-generate code for custom subsidiary based on selected parent category
  const generatedCode = useMemo(() => {
    const config = GENERAL_CATEGORIES_CONFIG[newSubGeneralType] || { prefix: '702' };
    const prefix = config.prefix;

    // Find the max code with the prefix
    const matches = (state.subsidiaries || [])
      .filter(s => s && s.code && s.code.startsWith(prefix))
      .map(s => parseInt(s.code, 10))
      .filter(num => !isNaN(num));

    const nextNum = matches.length > 0 ? Math.max(...matches) + 1 : parseInt(prefix + '01', 10);
    return nextNum.toString();
  }, [newSubGeneralType, state.subsidiaries]);

  // Handle Subsidiary Creation
  const handleCreateSubsidiary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim()) return;

    try {
      const token = (await getDefaultAuthSessionService().getAccessToken()) || '';
      const response = await fetch('/api/chart-of-accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          code: generatedCode,
          name: newSubName.trim(),
          generalType: newSubGeneralType
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || data.error || 'خطا در ثبت حساب معین در پایگاه داده');
      }

      const createdName = newSubName.trim();
      const createdCode = generatedCode;
      const createdGeneral = newSubGeneralType;

      setNewSubName('');
      setIsAddingSub(false);

      setNotification({
        message: `حساب معین «${createdName}» با کد حسابداری ${createdCode} در طبقه «${createdGeneral}» با موفقیت در PostgreSQL ثبت شد.`,
        type: 'success'
      });
      setTimeout(() => setNotification(null), 4000);

      // Refresh CoaReadService from PostgreSQL (Zero Dual Write)
      await CoaReadService.fetchChartOfAccounts(token);

    } catch (err: any) {
      setNotification({
        message: `❌ خطا در ایجاد حساب معین: ${err.message || 'خطای شبکه یا سرور'}`,
        type: 'error'
      });
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Handle Opening Balance Double-Entry Creation
  const handleCreateOpeningBalance = (e: React.FormEvent) => {
    e.preventDefault();

    let entries: VoucherEntry[] = [];
    let desc = '';

    if (openingType === 'bank_cash') {
      if (!opSubId || opAmount <= 0) {
        setNotification({ message: 'لطفاً حساب و مبلغ را مشخص کنید.', type: 'error' });
        return;
      }
      const targetSub = state.subsidiaries.find(s => s.id === opSubId);
      if (!targetSub) return;

      // Debit Bank/Cash, Credit Opening Balance (SUB_OPENING_BAL)
      entries.push({
        subsidiaryId: targetSub.id,
        debit: opAmount,
        credit: 0,
        description: `ثبت تراز افتتاحیه اول دوره برای ${targetSub.name}`
      });
      entries.push({
        subsidiaryId: 'SUB_OPENING_BAL',
        debit: 0,
        credit: opAmount,
        description: `تراز معادل تراز افتتاحیه اول دوره`
      });
      desc = `سند تراز افتتاحیه اول دوره حساب ${targetSub.name}`;

    } else if (openingType === 'person') {
      if (!opPersonId || opPersonAmount <= 0) {
        setNotification({ message: 'لطفاً شخص و مبلغ را مشخص کنید.', type: 'error' });
        return;
      }
      const person = state.persons.find(p => p.id === opPersonId);
      if (!person) return;

      if (opPersonNature === 'debit') {
        // Person owes us: Debit Debtors (SUB_DEBTORS) with floating detailed, Credit Opening Balance (SUB_OPENING_BAL)
        entries.push({
          subsidiaryId: 'SUB_DEBTORS',
          floatingDetailed: { type: 'person', id: person.id, name: person.name },
          debit: opPersonAmount,
          credit: 0,
          description: `ثبت بدهکاری افتتاحیه اول دوره ${person.name}`
        });
        entries.push({
          subsidiaryId: 'SUB_OPENING_BAL',
          debit: 0,
          credit: opPersonAmount,
          description: `تراز معادل بدهکاری افتتاحیه مشتری`
        });
      } else {
        // We owe person: Debit Opening Balance (SUB_OPENING_BAL), Credit Creditors (SUB_CREDITORS) with floating detailed
        entries.push({
          subsidiaryId: 'SUB_OPENING_BAL',
          debit: opPersonAmount,
          credit: 0,
          description: `تراز معادل بستانکاری افتتاحیه همکار`
        });
        entries.push({
          subsidiaryId: 'SUB_CREDITORS',
          floatingDetailed: { type: 'person', id: person.id, name: person.name },
          debit: 0,
          credit: opPersonAmount,
          description: `ثبت بستانکاری افتتاحیه اول دوره ${person.name}`
        });
      }
      desc = `سند تراز افتتاحیه بدهی/طلب اول دوره مربوط به ${person.name}`;

    } else if (openingType === 'product') {
      if (!opProductId || opProductQty <= 0 || opProductCost <= 0) {
        setNotification({ message: 'لطفاً کالا، تعداد و قیمت خرید اولیه را مشخص کنید.', type: 'error' });
        return;
      }
      const product = state.products.find(p => p.id === opProductId);
      if (!product) return;

      const totalVal = opProductQty * opProductCost;

      // Debit Merchandise Inventory (SUB_INVENTORY) with floating, Credit Opening Balance (SUB_OPENING_BAL)
      entries.push({
        subsidiaryId: 'SUB_INVENTORY',
        floatingDetailed: { type: 'product', id: product.id, name: product.name },
        debit: totalVal,
        credit: 0,
        description: `موجودی اولیه کالا: ${opProductQty.toLocaleString()} عدد ${product.name} با فی ${opProductCost.toLocaleString()} ریال`
      });
      entries.push({
        subsidiaryId: 'SUB_OPENING_BAL',
        debit: 0,
        credit: totalVal,
        description: `تراز معادل ارزش موجودی کالای اولیه انبار`
      });
      desc = `سند تراز افتتاحیه ارزش اولیه موجودی کالای ${product.name}`;
    }

    // Submit Double-Entry Voucher
    onAddManualVoucher({
      date: getCurrentJalaliDate(),
      description: desc,
      entries
    });

    // Reset Form fields
    setOpAmount(0);
    setOpPersonAmount(0);
    setOpProductQty(0);
    setOpProductCost(0);

    setNotification({
      message: `سند معین افتتاحیه اول دوره علمی همتراز با موفقیت صادر و در دفاتر روزنامه ثبت شد.`,
      type: 'success'
    });
    setTimeout(() => setNotification(null), 4000);
  };

  // Filter subsidiaries list
  const filteredSubs = useMemo(() => {
    // FAIL-CLOSED POLICY:
    // If PostgreSQL COA fetch failed with an error, DO NOT FALLBACK secretly to DEFAULT_SUBSIDIARIES or state.subsidiaries!
    if (pgCoaError) {
      return [];
    }

    const sourceList = pgCoa || state.subsidiaries || [];

    let list = sourceList.map(s => {
      if (s.id === 'SUB_DEFERRED_FEE' || s.code === '10603') {
        return {
          ...s,
          id: 'SUB_DEFERRED_FEE',
          code: '10603',
          name: 'کارمزد در انتظار تحقق',
          groupType: 'دارایی‌های جاری' as const,
          generalType: 'پیش‌پرداخت‌ها' as const
        };
      }
      return s;
    });
    
    // Safety check: ensure SUB_DEFERRED_FEE is always present in list
    const hasDeferredFee = list.some(s => s.id === 'SUB_DEFERRED_FEE' || s.code === '10603');
    if (!hasDeferredFee) {
      list = [
        ...list,
        {
          id: 'SUB_DEFERRED_FEE',
          code: '10603',
          name: 'کارمزد در انتظار تحقق',
          groupType: 'دارایی‌های جاری',
          generalType: 'پیش‌پرداخت‌ها'
        }
      ];
    }

    return list.filter(s => {
      if (!subSearchQuery.trim()) return true;
      const q = subSearchQuery.toLowerCase().trim();
      return (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.generalType.toLowerCase().includes(q) ||
        s.groupType.toLowerCase().includes(q)
      );
    });
  }, [pgCoa, pgCoaError, state.subsidiaries, subSearchQuery]);

  return (
    <div className="h-full flex flex-col space-y-4 p-4 text-right">
      
      {/* Fail-Closed PostgreSQL COA Error Banner */}
      {pgCoaError && (
        <div className="bg-rose-50 border-2 border-rose-300 p-4 rounded-2xl text-right font-sans text-xs text-rose-900 mb-2 flex items-start space-x-3 space-x-reverse shadow-md">
          <ShieldAlert size={22} className="text-rose-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-sm text-rose-900 mb-1">خطا در دریافت کدینگ حساب‌ها از پایگاه داده (پایگاه داده PostgreSQL)</h4>
            <p className="leading-relaxed font-semibold text-rose-800">{pgCoaError}</p>
            <p className="mt-2 text-[11px] text-rose-700 bg-rose-100/80 p-2 rounded-xl">
              مطابق با سیاست قطع امن (Fail-Closed)، هیچ جاگزینی خودکاری با داده‌های پیش‌فرض صورت نمی‌گیرد. تا زمان برطرف شدن مشکل پایگاه داده، عملیات وابسته به انتخاب و مدیریت کدینگ حساب‌ها متوقف گردیده است.
            </p>
          </div>
        </div>
      )}
      
      {/* Title Header */}
      <div className="flex items-center justify-between border-b border-zinc-150 pb-2">
        <div className="flex items-center space-x-2 space-x-reverse">
          <Landmark size={18} className="text-amber-600" />
          <span className="font-sans text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-full">سرفصل‌های معین و تراز افتتاحیه</span>
        </div>
        <span className="font-sans text-[10px] text-zinc-400">مدیریت حسابداری پیشرفته، هزینه‌ها و سرمایه‌گذاران</span>
      </div>

      {/* Segment Tab Controls */}
      <div className="bg-zinc-100 p-1 rounded-xl grid grid-cols-4 gap-1">
        <button
          onClick={() => setActiveSubTab('subsidiaries')}
          className={`py-2 rounded-lg font-sans text-xs font-bold transition ${
            activeSubTab === 'subsidiaries' ? 'bg-white text-zinc-800 shadow' : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          مدیریت معین و هزینه‌ها
        </button>
        <button
          onClick={() => setActiveSubTab('bank_checks')}
          className={`py-2 rounded-lg font-sans text-xs font-bold transition ${
            activeSubTab === 'bank_checks' ? 'bg-white text-zinc-800 shadow' : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          چک‌های در جریان وصول
        </button>
        <button
          onClick={() => setActiveSubTab('opening_balances')}
          className={`py-2 rounded-lg font-sans text-xs font-bold transition ${
            activeSubTab === 'opening_balances' ? 'bg-white text-zinc-800 shadow' : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          موجودی اولیه و افتتاحیه
        </button>
        <button
          onClick={() => setActiveSubTab('bank_terminals')}
          className={`py-2 rounded-lg font-sans text-xs font-bold transition ${
            activeSubTab === 'bank_terminals' ? 'bg-white text-zinc-800 shadow' : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          پایانه‌های کارتخوان
        </button>
      </div>

      {/* Notifications */}
      {notification && (
        <div className={`p-3.5 rounded-2xl border text-right font-sans text-xs flex items-start space-x-2 space-x-reverse animate-pulse ${
          notification.type === 'success' 
            ? 'bg-emerald-50 border-emerald-100 text-emerald-800' 
            : 'bg-rose-50 border-rose-100 text-rose-800'
        }`}>
          {notification.type === 'success' ? <CheckCircle size={16} className="shrink-0 mt-0.5" /> : <ShieldAlert size={16} className="shrink-0 mt-0.5" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* TAB 1: SUBSIDIARIES MANAGER */}
      {activeSubTab === 'subsidiaries' && (
        <div className="flex-1 flex flex-col space-y-4 overflow-hidden">
          
          {/* Top form toggle button */}
          {!isAddingSub ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsAddingSub(true)}
                className="flex items-center space-x-1.5 space-x-reverse bg-amber-600 hover:bg-amber-700 text-white font-sans text-xs font-bold px-4 py-2.5 rounded-xl shadow transition"
              >
                <Plus size={16} className="stroke-[3px]" />
                <span>تعریف معین یا هزینه جدید</span>
              </button>
            </div>
          ) : (
            <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-3">
              <div className="flex justify-between items-center border-b border-zinc-100 pb-2">
                <span className="block font-sans text-xs font-bold text-zinc-800">تعریف حساب معین اختصاصی</span>
                <button type="button" onClick={() => setIsAddingSub(false)} className="text-zinc-400 hover:text-zinc-600 transition">
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateSubsidiary} className="space-y-3 text-right">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-0.5">سرشاخه و طبقه حساب معین</label>
                    <select
                      value={newSubGeneralType}
                      onChange={(e) => setNewSubGeneralType(e.target.value as AccountGeneral)}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right font-medium"
                    >
                      <optgroup label="ــ هزینه‌ها ــ">
                        <option value="هزینه‌های عمومی و اداری">هزینه‌های عمومی و اداری (حقوق، پذیرایی، کرایه...)</option>
                        <option value="هزینه‌های مالی">هزینه‌های مالی (سود و کارمزد پرداختی، بهره وام...)</option>
                        <option value="بهای تمام شده کالای فروش رفته">بهای تمام شده کالای فروش رفته (COGS)</option>
                      </optgroup>
                      <optgroup label="ــ دارایی‌های جاری ــ">
                        <option value="بانک‌ها">بانک‌ها (حساب‌های جاری و سپرده بانکی جدید)</option>
                        <option value="صندوق‌ها">صندوق‌ها و تنخواه‌گردان‌های فروشگاه</option>
                        <option value="بدهکاران تجاری">بدهکاران تجاری (حساب‌ها و معین‌های دریافتنی)</option>
                        <option value="اسناد دریافتنی">اسناد دریافتنی (چک‌ها و سفته‌های دریافتی)</option>
                        <option value="اسناد در جریان وصول">اسناد و چک‌های در جریان وصول</option>
                        <option value="موجودی کالا">موجودی کالا و انبارها</option>
                        <option value="پیش‌پرداخت‌ها">پیش‌پرداخت‌ها، ودیعه‌ها و مالیات خرید</option>
                      </optgroup>
                      <optgroup label="ــ بدهی‌های جاری و غیرجاری ــ">
                        <option value="اسناد پرداختنی">اسناد پرداختنی (چک‌های صادرشده)</option>
                        <option value="بستانکاران تجاری">بستانکاران تجاری (حساب‌های پرداختنی)</option>
                        <option value="پیش‌دریافت‌ها">پیش‌دریافت‌ها از مشتریان</option>
                        <option value="تسهیلات دریافتی">تسهیلات، وام‌ها و استقراض‌های دریافتی</option>
                      </optgroup>
                      <optgroup label="ــ درآمدها ــ">
                        <option value="فروش کالا">فروش کالا، خدمات و درآمدهای اصلی</option>
                        <option value="درآمد کارمزد">درآمد کارمزد، سود اقساط و درآمدهای متفرقه</option>
                      </optgroup>
                      <optgroup label="ــ حقوق صاحبان سهام ــ">
                        <option value="جاری شرکا و سرمایه‌گذاران">جاری شرکا، سهامداران و سرمایه‌گذاران</option>
                        <option value="سرمایه">سرمایه اولیه و ثبت شده</option>
                        <option value="تراز افتتاحیه">حساب واسط تراز افتتاحیه</option>
                      </optgroup>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-0.5">نام حساب معین (مثال: هزینه چای خوردن)</label>
                    <input
                      type="text"
                      placeholder="عنوان معین جدید..."
                      value={newSubName}
                      onChange={(e) => setNewSubName(e.target.value)}
                      className="w-full bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>
                </div>

                <div className="bg-amber-50/50 p-2.5 rounded-xl text-amber-900 text-right font-sans text-[10px] flex justify-between items-center">
                  <span>کد اتوماتیک حسابداری معین: <strong className="font-mono text-xs">{generatedCode}</strong></span>
                  <span className="text-zinc-400">سیستم طبقه‌بندی دوبل علمی</span>
                </div>

                <button type="submit" className="w-full bg-amber-600 hover:bg-amber-500 text-white py-2 rounded-xl flex items-center justify-center space-x-1.5 space-x-reverse font-sans text-xs font-semibold shadow transition">
                  <Plus size={14} className="stroke-[3px]" />
                  <span>ثبت حساب معین جدید</span>
                </button>
              </form>
            </div>
          )}

          {/* Subsidiary Search bar */}
          <div className="bg-white p-2.5 rounded-2xl border border-zinc-150 shadow-sm space-y-2.5">
            <div className="flex items-center space-x-2 space-x-reverse">
              <Search size={16} className="text-zinc-400 shrink-0" />
              <input
                type="text"
                placeholder="جستجو در سرفصل‌های حسابداری معین..."
                value={subSearchQuery}
                onChange={(e) => setSubSearchQuery(e.target.value)}
                className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none text-right"
              />
              {subSearchQuery && (
                <button type="button" onClick={() => setSubSearchQuery('')} className="text-zinc-400 hover:text-zinc-600">
                  <X size={14} />
                </button>
              )}
            </div>
            
            <div className="flex items-center justify-between border-t border-zinc-100 pt-2.5">
              <div className="flex items-center space-x-2 space-x-reverse">
                <span className="text-[10px] text-zinc-500 font-bold">مرتب‌سازی:</span>
                <select 
                  value={sortBy} 
                  onChange={e => setSortBy(e.target.value as 'code' | 'name')}
                  className="bg-zinc-50 border border-zinc-200 text-zinc-700 text-[10px] rounded-lg px-2 py-1 outline-none focus:border-amber-500"
                >
                  <option value="code">بر اساس کد حساب</option>
                  <option value="name">بر اساس نام حساب</option>
                </select>
              </div>
              <div className="flex items-center space-x-2 space-x-reverse">
                <span className="text-[10px] text-zinc-500 font-bold">نمایش:</span>
                <select 
                  value={viewMode} 
                  onChange={e => setViewMode(e.target.value as 'tree' | 'list')}
                  className="bg-zinc-50 border border-zinc-200 text-zinc-700 text-[10px] rounded-lg px-2 py-1 outline-none focus:border-amber-500"
                >
                  <option value="tree">درخت حساب‌ها (گروه‌بندی شده)</option>
                  <option value="list">لیست ساده</option>
                </select>
              </div>
            </div>
          </div>

          {/* Subsidiaries List */}
          <div className="flex-1 overflow-y-auto space-y-4">
            {(() => {
              // 1. Sort the filtered array
              const sortedSubs = [...filteredSubs].sort((a, b) => {
                if (sortBy === 'code') return a.code.localeCompare(b.code);
                return a.name.localeCompare(b.name);
              });

              // 2. Render based on viewMode
              if (viewMode === 'list') {
                return (
                  <div className="grid grid-cols-1 gap-2.5">
                    {sortedSubs.map(s => {
                      const bal = subsidiaryBalances[s.id]?.balance || 0;
                      let groupBadgeColor = 'bg-rose-50 text-rose-600 border-rose-100';
                      if (s.groupType === 'دارایی‌های جاری') groupBadgeColor = 'bg-emerald-50 text-emerald-600 border-emerald-100';
                      else if (s.groupType === 'درآمدها') groupBadgeColor = 'bg-teal-50 text-teal-600 border-teal-100';
                      else if (s.groupType === 'حقوق صاحبان سهام') groupBadgeColor = 'bg-blue-50 text-blue-600 border-blue-100';

                      return (
                        <div 
                          key={s.id} 
                          onClick={() => setSelectedLedgerSub(s)}
                          className="bg-white p-3.5 rounded-2xl border border-zinc-150 flex items-center justify-between text-right font-sans text-xs shadow-sm hover:border-amber-500/40 hover:bg-amber-50/50 cursor-pointer transition"
                        >
                          <div className="flex items-center space-x-2 space-x-reverse">
                            <span className="font-mono font-bold text-zinc-700 bg-zinc-100 px-2 py-0.5 rounded-xl">
                              {bal.toLocaleString()} ریال
                            </span>
                            <button 
                              onClick={(e) => handleEditClick(e, s)}
                              className="p-1.5 text-zinc-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
                              title="ویرایش حساب"
                            >
                              <Pencil size={14} />
                            </button>
                            {!s.is_system && (
                              <button 
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!window.confirm(`آیا از غیرفعال‌سازی حساب «${s.name}» اطمینان دارید؟`)) return;
                                  try {
                                    const token = (await getDefaultAuthSessionService().getAccessToken()) || '';
                                    const response = await fetch(`/api/chart-of-accounts/${s.id}/deactivate`, {
                                      method: 'POST',
                                      headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${token}`
                                      }
                                    });
                                    const data = await response.json();
                                    if (!response.ok || !data.success) {
                                      throw new Error(data.message || data.error || 'خطا در غیرفعال‌سازی حساب');
                                    }
                                    setNotification({
                                      message: `حساب «${s.name}» با موفقیت غیرفعال شد.`,
                                      type: 'success'
                                    });
                                    setTimeout(() => setNotification(null), 4000);
                                    await CoaReadService.fetchChartOfAccounts(token);
                                  } catch (err: any) {
                                    setNotification({
                                      message: `❌ خطا در غیرفعال‌سازی: ${err.message || 'خطای شبکه'}`,
                                      type: 'error'
                                    });
                                    setTimeout(() => setNotification(null), 5000);
                                  }
                                }}
                                className="p-1.5 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                title="غیرفعال‌سازی حساب"
                              >
                                <Ban size={14} />
                              </button>
                            )}
                          </div>
                          
                          <div className="flex flex-col text-right">
                            <div className="flex items-center justify-end space-x-1.5 space-x-reverse">
                              <strong className="text-zinc-800">{s.name}</strong>
                              <span className={`text-[8px] px-1.5 py-0.5 rounded border ${groupBadgeColor}`}>
                                {s.groupType}
                              </span>
                            </div>
                            <span className="text-[9px] text-zinc-400 mt-0.5">
                              کد معین: {s.code} • دفتر کل: {s.generalType}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              // Tree view
              // Group by Group Type -> General Type
              const grouped: Record<string, Record<string, AccountSubsidiary[]>> = {};
              sortedSubs.forEach(s => {
                if (!grouped[s.groupType]) grouped[s.groupType] = {};
                if (!grouped[s.groupType][s.generalType]) grouped[s.groupType][s.generalType] = [];
                grouped[s.groupType][s.generalType].push(s);
              });

              return (
                <div className="space-y-6">
                  {Object.keys(grouped).map(groupType => {
                    const generalGroups = grouped[groupType];
                    
                    let groupBadgeColor = 'bg-rose-50 text-rose-600 border-rose-200';
                    if (groupType === 'دارایی‌های جاری') groupBadgeColor = 'bg-emerald-50 text-emerald-600 border-emerald-200';
                    else if (groupType === 'درآمدها') groupBadgeColor = 'bg-teal-50 text-teal-600 border-teal-200';
                    else if (groupType === 'حقوق صاحبان سهام') groupBadgeColor = 'bg-blue-50 text-blue-600 border-blue-200';

                    // Calculate group total balance
                    let groupBalance = 0;
                    Object.values(generalGroups).forEach(subs => {
                      subs.forEach(s => groupBalance += subsidiaryBalances[s.id]?.balance || 0);
                    });

                    return (
                      <div key={groupType} className="space-y-3">
                        <div className={`px-3 py-2 border-b-2 font-bold text-sm flex justify-between items-center ${groupBadgeColor.replace('bg-', 'border-').split(' ')[2]} ${groupBadgeColor.split(' ')[1]}`}>
                          <span>{groupType}</span>
                          <span className="font-mono text-xs">{groupBalance.toLocaleString()} ریال</span>
                        </div>
                        
                        <div className="space-y-3 pr-2 border-r-2 border-zinc-100">
                          {Object.keys(generalGroups).map(generalType => {
                            const subs = generalGroups[generalType];
                            const generalBalance = subs.reduce((sum, s) => sum + (subsidiaryBalances[s.id]?.balance || 0), 0);

                            return (
                              <div key={generalType} className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                                {/* General Ledger Header */}
                                <div className="bg-zinc-50 border-b border-zinc-200 p-3 flex justify-between items-center">
                                  <span className="font-mono font-bold text-zinc-800 bg-white border border-zinc-200 px-2 py-1 rounded-lg text-xs shadow-sm">
                                    {generalBalance.toLocaleString()} ریال
                                  </span>
                                  <div className="flex flex-col text-right">
                                    <strong className="text-zinc-800 text-sm">{generalType}</strong>
                                    <span className="text-[10px] text-zinc-500 mt-0.5">دفتر کل</span>
                                  </div>
                                </div>
                                
                                {/* Subsidiaries inside */}
                                <div className="divide-y divide-zinc-100">
                                  {subs.map(s => {
                                    const bal = subsidiaryBalances[s.id]?.balance || 0;
                                    return (
                                      <div 
                                        key={s.id} 
                                        onClick={() => setSelectedLedgerSub(s)}
                                        className="p-3 bg-white flex items-center justify-between text-right font-sans text-xs hover:bg-amber-50/50 cursor-pointer transition pr-6"
                                      >
                                        <div className="flex items-center space-x-2 space-x-reverse">
                                          <span className="font-mono font-bold text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded-xl">
                                            {bal.toLocaleString()} ریال
                                          </span>
                                          <button 
                                            onClick={(e) => handleEditClick(e, s)}
                                            className="p-1.5 text-zinc-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition"
                                            title="ویرایش حساب"
                                          >
                                            <Pencil size={14} />
                                          </button>
                                        </div>
                                        
                                        <div className="flex flex-col text-right">
                                          <strong className="text-zinc-700">{s.name}</strong>
                                          <span className="text-[9px] text-zinc-400 mt-0.5">
                                            کد معین: {s.code}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* TAB 3: BANK CHECKS DASHBOARD */}
      {activeSubTab === 'bank_checks' && (
        <BankDashboard state={state} onUpdateCheckState={onUpdateCheckState} />
      )}

      {/* TAB 4: BANK TERMINALS DASHBOARD */}
      {activeSubTab === 'bank_terminals' && onUpdateBankTerminals && (
        <BankTerminalManager 
          state={state} 
          onUpdateTerminals={onUpdateBankTerminals} 
          onAddSubsidiary={onAddSubsidiary}
          onAddManualVoucher={onAddManualVoucher}
        />
      )}

      {/* TAB 2: OPENING BALANCES REGISTER */}
      {activeSubTab === 'opening_balances' && (
        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="bg-zinc-50 border border-zinc-200 p-4 rounded-2xl text-right font-sans text-xs space-y-2 leading-relaxed">
            <div className="flex items-center space-x-1.5 space-x-reverse text-zinc-800 font-bold mb-1">
              <Scale size={16} className="text-amber-600" />
              <span>مفهوم تراز افتتاحیه در حسابداری دوبل علمی</span>
            </div>
            <p className="text-zinc-600">
              هر فروشگاه در بدو ورود به برنامه، مقداری نقدینگی در بانک یا صندوق، کالا در انبار یا مطالبات از قبل دارد. 
              براساس استانداردهای علمی، وارد کردن این مقادیر باید از طریق بدهکار کردن حساب مقصد (مانند بانک) و بستانکار کردن حساب 
              <strong> «تراز افتتاحیه» </strong> انجام شود تا دفاتر روزنامه همواره تراز باشند. 
              این فرم به طور خودکار این اسناد دوبل را برای شما صادر می‌کند.
            </p>
          </div>

          {/* Form Wizard */}
          <div className="bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm space-y-4">
            <div className="flex items-center space-x-2 space-x-reverse border-b border-zinc-100 pb-2.5">
              <Coins size={16} className="text-amber-600" />
              <span className="font-sans text-xs font-bold text-zinc-800">نوع دارایی برای ثبت موجودی اولیه:</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setOpeningType('bank_cash')}
                className={`py-2 rounded-xl font-sans text-[11px] font-bold transition border ${
                  openingType === 'bank_cash' 
                    ? 'bg-amber-600 border-amber-600 text-white' 
                    : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                موجودی اولیه بانک/صندوق
              </button>
              <button
                type="button"
                onClick={() => setOpeningType('person')}
                className={`py-2 rounded-xl font-sans text-[11px] font-bold transition border ${
                  openingType === 'person' 
                    ? 'bg-amber-600 border-amber-600 text-white' 
                    : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                بدهکاری/بستانکاری اولیه اشخاص
              </button>
              <button
                type="button"
                onClick={() => setOpeningType('product')}
                className={`py-2 rounded-xl font-sans text-[11px] font-bold transition border ${
                  openingType === 'product' 
                    ? 'bg-amber-600 border-amber-600 text-white' 
                    : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                موجودی اولیه کالاهای انبار
              </button>
            </div>

            <form onSubmit={handleCreateOpeningBalance} className="space-y-4 text-right">
              
              {/* Type 1: Bank or Cashbox */}
              {openingType === 'bank_cash' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-0.5">انتخاب صندوق یا بانک معین</label>
                    <select
                      value={opSubId}
                      onChange={(e) => setOpSubId(e.target.value)}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right"
                      required
                    >
                      <option value="">انتخاب کنید...</option>
                      {state.subsidiaries
                        .filter(s => s.generalType === 'بانک‌ها' || s.generalType === 'صندوق‌ها')
                        .map(s => (
                          <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                        ))
                      }
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-0.5">مبلغ موجودی نقدی اولیه (ریال)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="مبلغ را وارد کنید..."
                      value={opAmount > 0 ? opAmount.toLocaleString() : ''}
                      onChange={(e) => setOpAmount(parseNumericValue(e.target.value))}
                      className="w-full bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Type 2: Persons (Debtors/Creditors) */}
              {openingType === 'person' && (
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-0.5">انتخاب شخص (مشتری یا همکار)</label>
                      <select
                        value={opPersonId}
                        onChange={(e) => setOpPersonId(e.target.value)}
                        className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 text-right"
                        required
                      >
                        <option value="">انتخاب کنید...</option>
                        {state.persons.map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-zinc-400 mb-0.5">ماهیت مانده اول دوره</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setOpPersonNature('debit')}
                          className={`py-2 rounded-xl font-sans text-[10px] font-bold transition border ${
                            opPersonNature === 'debit'
                              ? 'bg-red-50 border-red-200 text-red-700 font-bold'
                              : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:bg-zinc-100'
                          }`}
                        >
                          بدهکار (او به ما بدهکار است / مشتری)
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpPersonNature('credit')}
                          className={`py-2 rounded-xl font-sans text-[10px] font-bold transition border ${
                            opPersonNature === 'credit'
                              ? 'bg-teal-50 border-teal-200 text-teal-700 font-bold'
                              : 'bg-zinc-50 border-zinc-200 text-zinc-500 hover:bg-zinc-100'
                          }`}
                        >
                          بستانکار (ما به او بدهکاریم / طلبکار)
                        </button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-400 mb-0.5">مبلغ بدهی یا طلب اولیه (ریال)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="مبلغ بدهی یا طلب را وارد کنید..."
                      value={opPersonAmount > 0 ? opPersonAmount.toLocaleString() : ''}
                      onChange={(e) => setOpPersonAmount(parseNumericValue(e.target.value))}
                      className="w-full bg-zinc-50 border border-zinc-150 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 text-center focus:outline-none focus:border-amber-500"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Type 3: Products */}
              {openingType === 'product' && (
                <div className="space-y-4 pt-4 text-center">
                  <div className="bg-amber-50 text-amber-800 p-4 rounded-xl font-sans text-sm text-right leading-relaxed border border-amber-200">
                    <p>
                      <strong>توجه:</strong> برای ثبت موجودی اولیه کالاهای انبار به همراه جزئیات کامل (شامل دسته‌بندی، شماره سریال، تعداد و مبلغ واحد)، لطفاً از <strong>فرم اختصاصی موجودی افتتاحیه کالا</strong> استفاده کنید.
                    </p>
                  </div>
                  
                  <button 
                    type="button" 
                    onClick={() => {
                      if (onNavigate) {
                        onNavigate('opening_balances');
                      }
                    }}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl flex items-center justify-center space-x-2 space-x-reverse font-sans text-sm font-bold shadow transition"
                  >
                    <Package size={18} />
                    <span>رفتن به فرم اختصاصی موجودی افتتاحیه کالا</span>
                  </button>
                </div>
              )}

              {openingType !== 'product' && (
                <button type="submit" className="w-full bg-amber-600 hover:bg-amber-500 text-white py-2.5 rounded-xl flex items-center justify-center space-x-1.5 space-x-reverse font-sans text-xs font-bold shadow transition">
                  <Scale size={14} />
                  <span>ثبت و صدور سند همتراز افتتاحیه</span>
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {selectedLedgerSub && (
        <SubsidiaryLedgerModal
          onViewVoucher={onViewVoucher}
          onViewCheck={onViewCheck}
          subsidiary={selectedLedgerSub}
          state={state}
          onClose={() => setSelectedLedgerSub(null)}
          onEditVoucher={(v) => {
            setSelectedLedgerSub(null);
            onEditVoucher(v);
          }}
          onDeleteVoucher={(v) => {
            onDeleteVoucher(v);
          }}
          onNewVoucher={() => {
            setSelectedLedgerSub(null);
            onNewVoucher();
          }}
        />
      )}

      {editingSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col font-sans">
            <div className="p-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50">
              <button onClick={() => setEditingSub(null)} className="text-zinc-400 hover:text-zinc-700">
                <X size={20} />
              </button>
              <h3 className="font-bold text-zinc-800 text-sm">ویرایش حساب معین</h3>
            </div>
            <div className="p-4 space-y-4 text-right">
              {editSubWarning && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl text-xs space-y-1">
                  <div className="flex items-center space-x-1 space-x-reverse font-bold">
                    <ShieldAlert size={14} />
                    <span>توجه: حساب سیستمی</span>
                  </div>
                  <p>این حساب از حساب‌های پایه سیستم است. تغییر نام آن باید با احتیاط انجام شود. کد این حساب قابل تغییر نیست.</p>
                </div>
              )}
              
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1">کد حساب</label>
                <input
                  type="text"
                  value={editSubCode}
                  onChange={(e) => setEditSubCode(e.target.value)}
                  disabled={editSubWarning}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-800 focus:outline-none focus:border-amber-500 disabled:opacity-50"
                  dir="ltr"
                />
              </div>
              
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1">نام حساب</label>
                <input
                  type="text"
                  value={editSubName}
                  onChange={(e) => setEditSubName(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 text-xs text-zinc-800 focus:outline-none focus:border-amber-500 text-right"
                />
              </div>
              
            </div>
            <div className="p-4 border-t border-zinc-100 flex space-x-2 space-x-reverse bg-zinc-50">
              <button 
                onClick={async () => {
                  if (!editSubName.trim()) return;
                  
                  try {
                    const token = (await getDefaultAuthSessionService().getAccessToken()) || '';
                    const response = await fetch(`/api/chart-of-accounts/${editingSub.id}`, {
                      method: 'PUT',
                      headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                      },
                      body: JSON.stringify({
                        name: editSubName.trim(),
                        requires_person: editingSub.requires_person,
                        requires_cost_center: editingSub.requires_cost_center
                      })
                    });

                    const data = await response.json();
                    if (!response.ok || !data.success) {
                      throw new Error(data.message || data.error || 'خطا در ویرایش حساب معین در پایگاه داده');
                    }

                    setNotification({
                      message: `حساب «${editSubName.trim()}» با موفقیت در PostgreSQL بروزرسانی شد.`,
                      type: 'success'
                    });
                    setTimeout(() => setNotification(null), 4000);

                    // Refresh CoaReadService from PostgreSQL (Zero Dual Write)
                    await CoaReadService.fetchChartOfAccounts(token);

                  } catch (err: any) {
                    setNotification({
                      message: `❌ خطا در ویرایش حساب معین: ${err.message || 'خطای شبکه یا سرور'}`,
                      type: 'error'
                    });
                    setTimeout(() => setNotification(null), 5000);
                  }

                  setEditingSub(null);
                }}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-2 rounded-xl text-xs font-bold transition"
              >
                ذخیره تغییرات
              </button>
              <button 
                onClick={() => setEditingSub(null)}
                className="px-4 bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 py-2 rounded-xl text-xs font-bold transition"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
