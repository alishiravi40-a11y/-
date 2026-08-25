/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { AccountSubsidiary } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { useCoaReadModel } from '../services/CoaReadService';

interface AccountSubsidiarySelectorProps {
  subsidiaries?: AccountSubsidiary[];
  selectedSubId: string;
  onSelect: (subId: string) => void;
  label?: string;
  placeholder?: string;
}

type AccountCategoryTab = 'all' | 'assets' | 'liabilities' | 'income' | 'expenses' | 'equity';

export default function AccountSubsidiarySelector({
  subsidiaries: propSubs,
  selectedSubId,
  onSelect,
  label,
  placeholder = "انتخاب حساب معین..."
}: AccountSubsidiarySelectorProps) {
  const { subsidiaries: activeSubsidiaries, error: coaError } = useCoaReadModel(propSubs);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<AccountCategoryTab>('all');
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

  const selectedSub = useMemo(() => {
    return activeSubsidiaries.find(s => s.id === selectedSubId);
  }, [activeSubsidiaries, selectedSubId]);

  // Filter accounts by active category tab and search query
  const filteredSubsidiaries = useMemo(() => {
    let list = activeSubsidiaries;

    if (activeTab === 'assets') {
      list = list.filter(s => 
        (s.groupType && s.groupType.includes('دارایی')) || 
        (s.generalType && (s.generalType.includes('بانک') || s.generalType.includes('صندوق') || s.generalType.includes('بدهکار') || s.generalType.includes('کالا') || s.generalType.includes('موجودی') || s.generalType.includes('پیش‌پرداخت')))
      );
    } else if (activeTab === 'liabilities') {
      list = list.filter(s => 
        (s.groupType && s.groupType.includes('بدهی')) || 
        (s.generalType && (s.generalType.includes('بستانکار') || s.generalType.includes('تسهیلات') || s.generalType.includes('پیش‌دریافت')))
      );
    } else if (activeTab === 'income') {
      list = list.filter(s => 
        (s.groupType && s.groupType.includes('درآمد')) || 
        (s.generalType && (s.generalType.includes('فروش') || s.generalType.includes('کارمزد') || s.generalType.includes('درآمد')))
      );
    } else if (activeTab === 'expenses') {
      list = list.filter(s => 
        (s.groupType && s.groupType.includes('هزینه')) || 
        (s.generalType && s.generalType.includes('هزینه'))
      );
    } else if (activeTab === 'equity') {
      list = list.filter(s => 
        (s.groupType && (s.groupType.includes('حقوق') || s.groupType.includes('سهام'))) || 
        (s.generalType && (s.generalType.includes('سرمایه') || s.generalType.includes('شرکا') || s.generalType.includes('افتتاحیه')))
      );
    }

    if (!searchQuery.trim()) return list;

    const query = searchQuery.trim().toLowerCase();
    return list.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.code.toLowerCase().includes(query) ||
      (s.generalType && s.generalType.toLowerCase().includes(query)) ||
      (s.groupType && s.groupType.toLowerCase().includes(query))
    );
  }, [activeSubsidiaries, activeTab, searchQuery]);

  // Group filtered accounts by groupType/generalType for structured rendering
  const groupedSubsidiaries = useMemo(() => {
    const map: Record<string, AccountSubsidiary[]> = {};
    filteredSubsidiaries.forEach(sub => {
      const groupName = sub.groupType || sub.generalType || 'حساب‌های معین';
      if (!map[groupName]) {
        map[groupName] = [];
      }
      map[groupName].push(sub);
    });
    return map;
  }, [filteredSubsidiaries]);

  // Get badge color styling for groupTypes
  const getGroupBadgeColor = (groupType?: string) => {
    if (!groupType) return 'bg-zinc-100 text-zinc-700 border-zinc-200';
    if (groupType.includes('دارایی')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (groupType.includes('بدهی')) return 'bg-rose-50 text-rose-700 border-rose-200';
    if (groupType.includes('درآمد')) return 'bg-sky-50 text-sky-700 border-sky-200';
    if (groupType.includes('هزینه')) return 'bg-amber-50 text-amber-700 border-amber-200';
    if (groupType.includes('حقوق') || groupType.includes('سهام')) return 'bg-purple-50 text-purple-700 border-purple-200';
    return 'bg-zinc-100 text-zinc-700 border-zinc-200';
  };

  return (
    <div ref={containerRef} className="relative flex flex-col space-y-1 w-full">
      {label && <label className="font-sans text-xs font-semibold text-zinc-700 text-right">{label}</label>}

      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-white border border-zinc-200 hover:border-zinc-300 rounded-xl px-3 py-2 text-right font-sans text-xs transition shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
      >
        {selectedSub ? (
          <div className="flex items-center space-x-2 space-x-reverse text-zinc-800 min-w-0">
            <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 border border-zinc-200 shrink-0">
              {selectedSub.code}
            </span>
            <span className="font-semibold truncate">{selectedSub.name}</span>
            <span className="font-sans text-[10px] text-zinc-400 shrink-0 hidden sm:inline">({selectedSub.groupType || selectedSub.generalType})</span>
          </div>
        ) : (
          <span className="text-zinc-400">{placeholder}</span>
        )}
        <ChevronDown size={15} className={`text-zinc-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[320px]"
          >
            {/* Search Input Bar */}
            <div className="p-2 bg-zinc-50 border-b border-zinc-150 flex items-center">
              <Search size={14} className="text-zinc-400 ml-2 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجوی کد یا نام حساب (مثلاً 10101، بانک، درآمد...)"
                className="w-full bg-transparent font-sans text-xs text-zinc-800 placeholder-zinc-400 border-none outline-none focus:ring-0 text-right"
                dir="rtl"
                autoFocus
              />
            </div>

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1 p-1 bg-zinc-100/90 border-b border-zinc-200 overflow-x-auto scrollbar-none">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-2 py-1 rounded-lg text-center font-sans text-[10px] font-bold shrink-0 transition-all ${
                  activeTab === 'all'
                    ? 'bg-zinc-800 text-white shadow-xs'
                    : 'text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                همه
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('assets')}
                className={`px-2 py-1 rounded-lg text-center font-sans text-[10px] font-bold shrink-0 transition-all ${
                  activeTab === 'assets'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-zinc-600 hover:bg-emerald-50 hover:text-emerald-800'
                }`}
              >
                دارایی‌ها
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('liabilities')}
                className={`px-2 py-1 rounded-lg text-center font-sans text-[10px] font-bold shrink-0 transition-all ${
                  activeTab === 'liabilities'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-zinc-600 hover:bg-rose-50 hover:text-rose-800'
                }`}
              >
                بدهی‌ها
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('income')}
                className={`px-2 py-1 rounded-lg text-center font-sans text-[10px] font-bold shrink-0 transition-all ${
                  activeTab === 'income'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-zinc-600 hover:bg-sky-50 hover:text-sky-800'
                }`}
              >
                درآمدها
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('expenses')}
                className={`px-2 py-1 rounded-lg text-center font-sans text-[10px] font-bold shrink-0 transition-all ${
                  activeTab === 'expenses'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-zinc-600 hover:bg-amber-50 hover:text-amber-800'
                }`}
              >
                هزینه‌ها
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('equity')}
                className={`px-2 py-1 rounded-lg text-center font-sans text-[10px] font-bold shrink-0 transition-all ${
                  activeTab === 'equity'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-zinc-600 hover:bg-purple-50 hover:text-purple-800'
                }`}
              >
                حقوق سهام
              </button>
            </div>

            {/* List Grouped by Group/Head */}
            <div className="flex-1 overflow-y-auto p-1 space-y-2">
              {Object.keys(groupedSubsidiaries).length > 0 ? (
                (Object.entries(groupedSubsidiaries) as [string, AccountSubsidiary[]][]).map(([groupTitle, subs]) => (
                  <div key={groupTitle} className="space-y-0.5">
                    {/* Section Header */}
                    <div className="px-2.5 py-1 bg-zinc-50 border-y border-zinc-100 flex items-center justify-between text-[10px] font-bold text-zinc-500">
                      <span>{groupTitle}</span>
                      <span className="font-mono text-[9px] text-zinc-400">{subs.length} حساب</span>
                    </div>

                    {subs.map(sub => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => {
                          onSelect(sub.id);
                          setIsOpen(false);
                          setSearchQuery('');
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-right transition font-sans text-xs ${
                          selectedSubId === sub.id
                            ? 'bg-emerald-50 text-emerald-900 font-bold border border-emerald-200'
                            : 'hover:bg-zinc-50 text-zinc-800'
                        }`}
                      >
                        <div className="flex items-center space-x-2 space-x-reverse min-w-0">
                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 border border-zinc-200 shrink-0">
                            {sub.code}
                          </span>
                          <span className="truncate">{sub.name}</span>
                          <span className={`text-[9px] font-medium px-1.5 py-0.2 rounded border shrink-0 ${getGroupBadgeColor(sub.groupType)}`}>
                            {sub.generalType}
                          </span>
                        </div>
                        {selectedSubId === sub.id && <Check size={14} className="text-emerald-600 shrink-0 ml-1" />}
                      </button>
                    ))}
                  </div>
                ))
              ) : (
                <div className="p-6 text-center font-sans text-xs text-zinc-400">
                  حسابی با این اطلاعات یافت نشد
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
