/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, UserPlus, X, Check, Phone, User, MapPin, Award, Wallet } from 'lucide-react';
import { Person, JournalVoucher, InstallmentBook, BusinessPartner, AgencyType, PartnerRole } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { calculatePersonBalances } from '../utils/accounting';
import { isValidNationalId, isUniqueNationalId } from '../utils/validation';

interface PersonSelectorProps {
  disabled?: boolean;
  persons: Person[];
  selectedPersonId: string;
  onSelect: (personId: string) => void;
  onCreatePerson?: (name: string, nationalId?: string, mobile?: string, phone?: string, address?: string, role?: 'debtor' | 'creditor' | 'both') => string;
  label?: string;
  placeholder?: string;
  invoiceType?: 'buy' | 'sell';
  vouchers?: JournalVoucher[];
  showInstallmentOnly?: boolean;
  installmentBooks?: InstallmentBook[];
  allowClear?: boolean;
  businessPartners?: BusinessPartner[];
}

export default function PersonSelector({
  disabled = false,
  persons,
  selectedPersonId,
  onSelect,
  onCreatePerson,
  label,
  placeholder = "انتخاب شخص...",
  invoiceType,
  vouchers = [],
  showInstallmentOnly = false,
  installmentBooks = [],
  allowClear = false,
  businessPartners = []
}: PersonSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Quick Create Form States (None of them are starred or mandatory!)
  const [newName, setNewName] = useState('');
  const [newNationalId, setNewNationalId] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');

  // Active Tab for list filtering
  const [activeTab, setActiveTab] = useState<'debtor' | 'creditor' | 'all' | 'installment' | 'sales_agent' | 'credit_agent'>(
    showInstallmentOnly ? 'installment' : (invoiceType === 'sell' ? 'debtor' : (invoiceType === 'buy' ? 'creditor' : 'all'))
  );

  // Sync active tab when invoiceType or showInstallmentOnly changes
  useEffect(() => {
    if (showInstallmentOnly) {
      setActiveTab('installment');
    } else if (invoiceType === 'sell') {
      setActiveTab('debtor');
    } else if (invoiceType === 'buy') {
      setActiveTab('creditor');
    }
  }, [invoiceType, showInstallmentOnly]);

  const personBalances = useMemo(() => {
    if (!vouchers || !vouchers.length) return {};
    return calculatePersonBalances(vouchers, undefined, ['SUB_DEBTORS', 'SUB_DEBTORS_INSTALLMENT', 'SUB_CREDITORS', 'SUB_DEBTORS_AGENTS']);
  }, [vouchers]);

  const installmentBalances = useMemo(() => {
    if (!vouchers || !vouchers.length) return {};
    return calculatePersonBalances(vouchers, undefined, 'SUB_DEBTORS_INSTALLMENT');
  }, [vouchers]);

  const unassignedBalances = useMemo(() => {
    const unassigned: Record<string, number> = {};
    (persons || []).forEach(p => {
      if (!p || !p.id) return;
      const ledgerBalObj = installmentBalances ? installmentBalances[p.id] : undefined;
      const ledgerBal = (ledgerBalObj && ledgerBalObj.nature === 'بدهکار') ? ledgerBalObj.net : 0;
      
      // Sum totalPrincipal of active installment books for this person
      const activeBooksPrincipal = (installmentBooks || [])
        .filter(b => b && b.personId === p.id && b.status === 'active')
        .reduce((sum, b) => sum + (b.totalPrincipal || 0), 0);
      
      unassigned[p.id] = Math.max(0, ledgerBal - activeBooksPrincipal);
    });
    return unassigned;
  }, [persons, installmentBalances, installmentBooks]);

  const selectedPerson = useMemo(() => {
    return (persons || []).find(p => p && p.id === selectedPersonId);
  }, [persons, selectedPersonId]);

  const filteredPersons = useMemo(() => {
    let list = (persons || []).filter(p => !!p && !!p.id);

    // 1. Unified Logic for "Agents" and "Debtors/Creditors"
    // We treat 'isAgent' as SalesAgent, and role === 'debtor' || role === 'creditor' as CreditPartner

    // If it's a sales invoice, we generally want debtors, but also potentially agents for special cases
    if (invoiceType === 'sell') {
      list = list.filter(p => {
        if (!p) return false;
        const hasInstallmentBook = installmentBooks && installmentBooks.some(b => b && b.personId === p.id);
        const instBal = installmentBalances ? installmentBalances[p.id] : undefined;
        const unassignedVal = unassignedBalances ? (unassignedBalances[p.id] || 0) : 0;
        const hasInstallmentBal = (instBal && instBal.net > 0 && instBal.nature === 'بدهکار') || (unassignedVal > 0);
        const isInstallmentDeb = hasInstallmentBook || hasInstallmentBal;
        
        // Sales Invoice: Show Customers (debtor/both) and Sales Agents (isAgent)
        return p.isAgent || p.role === 'debtor' || p.role === 'both' || !isInstallmentDeb;
      });
    }

    // Filter based on selected tab nature/role
    if (activeTab === 'debtor') {
      // Show only pure customers (not Sales Agents)
      list = list.filter(p => p && (p.role === 'debtor' || p.role === 'both') && !p.isAgent);
    } else if (activeTab === 'creditor') {
      // Show creditors
      list = list.filter(p => p && (p.role === 'creditor' || p.role === 'both'));
    } else if (activeTab === 'sales_agent') {
      // Show only sales agents
      list = list.filter(p => {
        if (!p) return false;
        const bp = (businessPartners || []).find(b => b.personId === p.id);
        const isSales = Boolean(
          (bp && 
          bp.agencyType !== AgencyType.CREDIT_ONLY &&
          (bp.agencyType as string) !== 'CREDIT_ONLY' &&
          (
            bp.salesExtension?.nesyehSettings ||
            bp.nesyehSettings ||
            bp.nesyehOnboarding ||
            bp.agencyType === AgencyType.INSTALLMENT_ONLY ||
            (bp.agencyType as string) === 'INSTALLMENT_ONLY' ||
            bp.agencyType === AgencyType.BOTH ||
            (bp.agencyType as string) === 'BOTH' ||
            bp.agencyType === ('DEFERRED_PAYMENT' as any) ||
            bp.contract?.type === ('DEFERRED_AGENT' as any) ||
            (bp.roles || []).includes('DEFERRED_AGENT' as any)
          )) || (!bp && p.isAgent)
        );
        return isSales;
      });
    } else if (activeTab === 'credit_agent') {
      // Show only credit agents
      list = list.filter(p => {
        if (!p) return false;
        const bp = (businessPartners || []).find(b => b.personId === p.id);
        const isCredit = Boolean(
          bp &&
          bp.agencyType !== AgencyType.INSTALLMENT_ONLY &&
          (bp.agencyType as string) !== 'INSTALLMENT_ONLY' &&
          (
            bp.agencyType === AgencyType.CREDIT_ONLY ||
            (bp.agencyType as string) === 'CREDIT_ONLY' ||
            bp.agencyType === AgencyType.BOTH ||
            (bp.agencyType as string) === 'BOTH' ||
            Boolean(bp.creditExtension) ||
            bp.contract?.type === ('CREDIT_AGENT' as any) ||
            (bp.roles || []).includes('CREDIT_AGENT' as any) ||
            (bp.roles || []).includes(PartnerRole.CREDIT_SALES_AGENT) ||
            (bp.roles || []).includes('CREDIT_SALES_AGENT' as any)
          )
        );
        return isCredit;
      });
    } else if (activeTab === 'installment') {
      // Show only those who have an active balance in 10302 (Installment Debtors)
      if (showInstallmentOnly) {
        list = list.filter(p => p && unassignedBalances && unassignedBalances[p.id] > 0);
      } else {
        list = list.filter(p => p && installmentBalances && installmentBalances[p.id]?.net > 0 && installmentBalances[p.id]?.nature === 'بدهکار');
      }
    }

    if (!searchQuery) return list;
    const query = searchQuery.trim().toLowerCase();
    return list.filter(p => 
      p && (
        (p.name && p.name.toLowerCase().includes(query)) || 
        (p.code && p.code.toLowerCase().includes(query)) ||
        (p.mobile && p.mobile.includes(query))
      )
    );
  }, [persons, activeTab, searchQuery, unassignedBalances, installmentBalances, showInstallmentOnly, invoiceType, installmentBooks, businessPartners]);

  // Helper to render badges
  const renderBadges = (p: Person) => {
    const bp = (businessPartners || []).find(b => b.personId === p.id);

    // Sales Agent Badge
    const isSalesAgent = Boolean(
      (bp && (
        bp.agencyType === AgencyType.INSTALLMENT_ONLY ||
        bp.agencyType === AgencyType.BOTH ||
        (bp.agencyType as string) === 'INSTALLMENT_ONLY' ||
        (bp.agencyType as string) === 'BOTH' ||
        (bp.roles || []).includes('DEFERRED_AGENT' as any)
      )) ||
      (!bp && p.isAgent && (p.role === 'debtor' || p.role === 'both'))
    );

    // Credit Agent Badge
    const isCreditAgent = Boolean(
      (bp && (
        bp.agencyType === AgencyType.CREDIT_ONLY ||
        bp.agencyType === AgencyType.BOTH ||
        (bp.agencyType as string) === 'CREDIT_ONLY' ||
        (bp.agencyType as string) === 'BOTH' ||
        (bp.roles || []).includes('CREDIT_AGENT' as any) ||
        (bp.roles || []).includes(PartnerRole.CREDIT_SALES_AGENT) ||
        (bp.roles || []).includes('CREDIT_SALES_AGENT' as any)
      )) ||
      (!bp && p.isAgent && (p.role === 'creditor' || p.role === 'both'))
    );

    if (isSalesAgent && isCreditAgent) {
      return (
        <span className="bg-emerald-100 text-emerald-800 text-[9px] font-bold px-1.5 py-0.5 rounded border border-emerald-200">
          فروش | اعتباری
        </span>
      );
    } else if (isSalesAgent) {
      return (
        <span className="bg-purple-100 text-purple-800 text-[9px] font-bold px-1.5 py-0.5 rounded border border-purple-200">
          فروش
        </span>
      );
    } else if (isCreditAgent) {
      return (
        <span className="bg-amber-100 text-amber-800 text-[9px] font-bold px-1.5 py-0.5 rounded border border-amber-200">
          اعتباری
        </span>
      );
    }

    return null;
  };

  const handleCreate = (e?: React.FormEvent | React.KeyboardEvent) => {
    if (e) e.preventDefault();
    if (!newName.trim() || !onCreatePerson) return;
    
    // Validation
    const cleanId = newNationalId.trim();
    if (!isValidNationalId(cleanId)) {
      alert('کد ملی وارد شده معتبر نیست. کد ملی باید دقیقاً ۱۰ رقم عددی باشد.');
      return;
    }

    if (!isUniqueNationalId(cleanId, persons)) {
      alert('این کد ملی قبلاً در سیستم ثبت شده است.');
      return;
    }

    // Assign role based on current tab selection or invoice type
    let roleToAssign: 'debtor' | 'creditor' = 'debtor';
    if (activeTab === 'debtor') roleToAssign = 'debtor';
    else if (activeTab === 'creditor') roleToAssign = 'creditor';
    else if (invoiceType === 'buy') roleToAssign = 'creditor';
    else roleToAssign = 'debtor';

    const newId = onCreatePerson(
      newName.trim(),
      newNationalId.trim() || undefined,
      newMobile.trim() || undefined,
      newPhone.trim() || undefined,
      newAddress.trim() || undefined,
      roleToAssign
    );

    // Reset states
    setNewName('');
    setNewNationalId('');
    setNewMobile('');
    setNewPhone('');
    setNewAddress('');
    
    setShowQuickCreate(false);
    setSearchQuery('');
    onSelect(newId);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative flex flex-col space-y-1.5 w-full">
      {label && <label className="font-sans text-xs font-semibold text-zinc-700 text-right">{label}</label>}
      
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between bg-white border border-zinc-200 hover:border-zinc-300 rounded-xl px-3.5 py-2.5 text-right font-sans text-xs transition shadow-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/20 ${
          disabled ? 'opacity-60 cursor-not-allowed bg-zinc-100' : ''
        }`}
      >
        {selectedPerson ? (
          <div className="flex items-center space-x-2 space-x-reverse text-zinc-800 truncate">
            <User size={15} className="text-emerald-500 shrink-0" />
            <span className="font-semibold truncate">{selectedPerson.name}</span>
            <span className="font-mono text-[10px] text-zinc-400 shrink-0">({selectedPerson.code})</span>
          </div>
        ) : (
          <span className="text-zinc-400">{placeholder}</span>
        )}
        <Search size={15} className="text-zinc-400 shrink-0" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 shadow-xl rounded-2xl overflow-hidden flex flex-col"
          >
            {/* Search Input */}
            <div className="flex items-center bg-zinc-50 border-b border-zinc-100 p-2.5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجوی نام، موبایل یا کد شخص..."
                className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 border-none outline-none focus:ring-0 text-right"
                dir="rtl"
                autoFocus
              />
              <Search size={14} className="text-zinc-400 ml-1.5" />
            </div>

            {/* Segments Toggle Tabs */}
            <div className={`grid ${
              showInstallmentOnly 
                ? 'grid-cols-1' 
                : 'grid-cols-6'
            } gap-0.5 p-1 bg-zinc-50/80 border-b border-zinc-150`}>
              {!showInstallmentOnly ? (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveTab('all')}
                    className={`py-1.5 rounded-lg text-center font-sans text-[9px] font-bold transition-all ${
                      activeTab === 'all' 
                        ? 'bg-zinc-800 text-white shadow-xs' 
                        : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
                    }`}
                  >
                    همه
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sales_agent')}
                    className={`py-1.5 rounded-lg text-center font-sans text-[9px] font-bold transition-all ${
                      activeTab === 'sales_agent' 
                        ? 'bg-purple-600 text-white shadow-xs' 
                        : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
                    }`}
                  >
                    فروش
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('credit_agent')}
                    className={`py-1.5 rounded-lg text-center font-sans text-[9px] font-bold transition-all ${
                      activeTab === 'credit_agent' 
                        ? 'bg-amber-600 text-white shadow-xs' 
                        : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
                    }`}
                  >
                    اعتباری
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('debtor')}
                    className={`py-1.5 rounded-lg text-center font-sans text-[9px] font-bold transition-all ${
                      activeTab === 'debtor' 
                        ? 'bg-red-600 text-white shadow-xs' 
                        : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
                    }`}
                  >
                    مشتریان
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('creditor')}
                    className={`py-1.5 rounded-lg text-center font-sans text-[9px] font-bold transition-all ${
                      activeTab === 'creditor' 
                        ? 'bg-emerald-600 text-white shadow-xs' 
                        : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
                    }`}
                  >
                    بستانکاران
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('installment')}
                    className={`py-1.5 rounded-lg text-center font-sans text-[9px] font-bold transition-all ${
                      activeTab === 'installment' 
                        ? 'bg-indigo-600 text-white shadow-xs' 
                        : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
                    }`}
                  >
                    اقساطی
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab('installment')}
                  className="py-1.5 rounded-lg text-center font-sans text-[9px] font-bold bg-indigo-600 text-white shadow-xs"
                >
                  بدهکاران اقساطی (10302)
                </button>
              )}
            </div>

            {/* List and Quick Create form */}
            {!showQuickCreate ? (
              <div className="flex flex-col max-h-[220px] overflow-y-auto">
                {allowClear && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelect('');
                      setIsOpen(false);
                      setSearchQuery('');
                    }}
                    className="px-3.5 py-2 hover:bg-amber-50 text-amber-700 text-right text-xs font-semibold border-b border-zinc-100 flex items-center gap-2"
                  >
                    <X size={13} />
                    <span>بدون تفصیلی شناور / انصراف از انتخاب شخص</span>
                  </button>
                )}
                {filteredPersons.length > 0 ? (
                  filteredPersons.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onSelect(p.id);
                        setIsOpen(false);
                        setSearchQuery('');
                      }}
                      className={`flex items-center justify-between px-3.5 py-2.5 hover:bg-zinc-50 text-right transition border-b border-zinc-50 last:border-none ${
                        selectedPersonId === p.id ? 'bg-emerald-50 text-emerald-900' : 'text-zinc-700'
                      }`}
                    >
                      <div className="flex items-center space-x-2 space-x-reverse font-sans text-xs">
                        <User size={13} className="text-zinc-400" />
                        <div className="flex flex-col text-right">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{p.name}</span>
                            <span className="font-mono text-[9px] text-zinc-400">({p.code})</span>
                            {renderBadges(p)}
                          </div>
                          {installmentBalances && installmentBalances[p.id] && installmentBalances[p.id].net > 0 && (
                            <div className="text-[8px] font-medium mt-0.5 space-y-0.5">
                              <div className="text-zinc-500">کل بدهی معین اقساطی: {installmentBalances[p.id]?.net?.toLocaleString() || '0'} ریال</div>
                              {unassignedBalances[p.id] > 0 ? (
                                <div className="text-indigo-600 font-bold">بدهی اقساطی بلاتکلیف: {unassignedBalances[p.id].toLocaleString()} ریال</div>
                              ) : (
                                <div className="text-emerald-600 font-bold">✓ کل بدهی قسط‌بندی شده است</div>
                              )}
                            </div>
                          )}
                          {activeTab !== 'installment' && personBalances && personBalances[p.id] && personBalances[p.id].net > 0 && (
                            <div className={`text-[8px] font-bold mt-0.5 ${personBalances[p.id]?.nature === 'بدهکار' ? 'text-red-500' : 'text-emerald-500'}`}>
                              مانده {personBalances[p.id]?.nature || 'بی‌حساب'}: {personBalances[p.id]?.net?.toLocaleString() || '0'}
                            </div>
                          )}
                        </div>
                      </div>
                      {selectedPersonId === p.id && <Check size={13} className="text-emerald-600" />}
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-center font-sans text-xs text-zinc-400">
                    شخصی با این مشخصات یافت نشد
                  </div>
                )}
                
                {/* Quick Create Action */}
                {onCreatePerson && !showInstallmentOnly && (
                  <button
                    type="button"
                    onClick={() => setShowQuickCreate(true)}
                    className="w-full flex items-center justify-center space-x-2 space-x-reverse bg-emerald-50 hover:bg-emerald-100 text-emerald-700 py-3 text-xs font-semibold font-sans border-t border-zinc-100 transition"
                  >
                    <UserPlus size={14} />
                    <span>تعریف سریع شخص جدید</span>
                  </button>
                )}
              </div>
            ) : (
              /* QUICK CREATE INLINE FORM */
              <div
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreate(e);
                  }
                }}
                className="p-4 space-y-3 bg-zinc-50/80 border-t border-zinc-100"
              >
                <div className="flex items-center justify-between border-b border-zinc-200/60 pb-2">
                  <span className="font-sans text-xs font-bold text-zinc-800">ایجاد سریع شخص جدید</span>
                  <button
                    type="button"
                    onClick={() => setShowQuickCreate(false)}
                    className="p-1 text-zinc-400 hover:text-zinc-600"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="نام و نام خانوادگی"
                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                      dir="rtl"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={newMobile}
                      onChange={(e) => setNewMobile(e.target.value)}
                      placeholder="شماره موبایل"
                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                      dir="rtl"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={newNationalId}
                      onChange={(e) => setNewNationalId(e.target.value)}
                      placeholder="کد ملی *"
                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                      dir="rtl"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="تلفن ثابت"
                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                      dir="rtl"
                    />
                    <input
                      type="text"
                      value={newAddress}
                      onChange={(e) => setNewAddress(e.target.value)}
                      placeholder="آدرس"
                      className="w-full bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-emerald-500 text-right"
                      dir="rtl"
                    />
                  </div>
                </div>

                <div className="flex space-x-2 space-x-reverse pt-1">
                  <button
                    type="button"
                    onClick={() => handleCreate()}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-sans text-xs font-semibold py-1.5 rounded-lg transition-all"
                  >
                    ثبت و انتخاب
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQuickCreate(false)}
                    className="px-3 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-sans text-xs font-medium py-1.5 rounded-lg transition-all"
                  >
                    انصراف
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
