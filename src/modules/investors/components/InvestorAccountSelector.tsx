import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Landmark, User, Search, Check, ChevronDown, X } from 'lucide-react';
import { AccountSubsidiary, Person } from '../../../types';

interface InvestorAccountSelectorProps {
  subsidiaries: AccountSubsidiary[];
  persons: Person[];
  value: string;
  onChange: (selectedId: string) => void;
  label?: string;
  placeholder?: string;
  defaultBankLabel?: string;
}

export const InvestorAccountSelector: React.FC<InvestorAccountSelectorProps> = ({
  subsidiaries = [],
  persons = [],
  value,
  onChange,
  label,
  placeholder = 'انتخاب محل ورود / خروج وجه (بانک، صندوق یا شخص)...',
  defaultBankLabel = '-- بانک اصلی پیش‌فرض (SUB_BANK_MAIN) --',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'banks' | 'persons'>('banks');
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter Banks & Funds ONLY (No Persons included)
  const bankAndFundSubsidiaries = useMemo(() => {
    return subsidiaries.filter((sub) => {
      const gType = (sub.generalType || '').toLowerCase();
      const groupType = (sub.groupType || '').toLowerCase();
      const name = (sub.name || '').toLowerCase();
      const id = (sub.id || '').toLowerCase();

      const isBankOrFund =
        gType.includes('بانک') ||
        gType.includes('صندوق') ||
        groupType.includes('دارایی‌های جاری') ||
        name.includes('بانک') ||
        name.includes('صندوق') ||
        id.includes('bank') ||
        id.includes('sandogh') ||
        id.includes('cash');

      return isBankOrFund;
    });
  }, [subsidiaries]);

  // Find currently selected entity
  const selectedSub = useMemo(() => {
    return bankAndFundSubsidiaries.find((s) => s.id === value) || subsidiaries.find((s) => s.id === value);
  }, [bankAndFundSubsidiaries, subsidiaries, value]);

  const selectedPerson = useMemo(() => {
    return persons.find((p) => p.id === value);
  }, [persons, value]);

  // Instant live search filter for Banks
  const filteredBanks = useMemo(() => {
    if (!searchQuery.trim()) return bankAndFundSubsidiaries;
    const q = searchQuery.trim().toLowerCase();
    return bankAndFundSubsidiaries.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.generalType && s.generalType.toLowerCase().includes(q))
    );
  }, [bankAndFundSubsidiaries, searchQuery]);

  // Instant live search filter for Persons
  const filteredPersons = useMemo(() => {
    if (!searchQuery.trim()) return persons;
    const q = searchQuery.trim().toLowerCase();
    return persons.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code && p.code.toLowerCase().includes(q)) ||
        (p.mobile && p.mobile.includes(q)) ||
        (p.nationalId && p.nationalId.includes(q))
    );
  }, [persons, searchQuery]);

  return (
    <div ref={containerRef} className="relative flex flex-col space-y-1 w-full text-right">
      {label && <label className="block text-xs font-semibold text-slate-300 mb-1">{label}</label>}

      {/* Main Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-xl px-3 py-2 text-right text-xs transition-all focus:outline-none focus:border-emerald-500 shadow-sm"
      >
        <div className="flex items-center gap-2 truncate">
          {selectedSub ? (
            <>
              <Landmark className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-bold text-white truncate">{selectedSub.name}</span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300 border border-emerald-500/30 shrink-0">
                {selectedSub.code}
              </span>
              <span className="text-[10px] text-slate-400 shrink-0">
                ({selectedSub.generalType || 'بانک/صندوق'})
              </span>
            </>
          ) : selectedPerson ? (
            <>
              <User className="w-4 h-4 text-cyan-400 shrink-0" />
              <span className="font-bold text-white truncate">{selectedPerson.name}</span>
              {selectedPerson.code && (
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-cyan-500/30 shrink-0">
                  {selectedPerson.code}
                </span>
              )}
              <span className="text-[10px] text-slate-400 shrink-0">(شخص)</span>
            </>
          ) : value === '' ? (
            <span className="text-slate-300 font-medium">{defaultBankLabel}</span>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[340px] text-xs">
          {/* Section Tabs */}
          <div className="grid grid-cols-2 p-1.5 bg-slate-950 border-b border-slate-800 gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveSection('banks');
                setSearchQuery('');
              }}
              className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                activeSection === 'banks'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Landmark className="w-3.5 h-3.5" />
              <span>بانک‌ها و صندوق‌ها</span>
              <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-900/60 text-slate-200">
                {bankAndFundSubsidiaries.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('persons');
                setSearchQuery('');
              }}
              className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                activeSection === 'persons'
                  ? 'bg-cyan-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>اشخاص</span>
              <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-900/60 text-slate-200">
                {persons.length}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="p-2 bg-slate-900/90 border-b border-slate-800 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeSection === 'banks'
                  ? 'جستجوی نام یا کد بانک / صندوق (مثلاً ملت، ملی، 10101)...'
                  : 'جستجوی نام، کد یا موبایل شخص (مثلاً علی، رضایی)...'
              }
              className="w-full bg-transparent text-slate-100 placeholder-slate-400 focus:outline-none text-xs"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* List Area */}
          <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
            {/* Default fallback option if applicable */}
            {activeSection === 'banks' && defaultBankLabel && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                }}
                className={`w-full text-right p-2.5 rounded-xl transition flex items-center justify-between ${
                  value === ''
                    ? 'bg-emerald-950/60 text-emerald-300 font-bold border border-emerald-700/50'
                    : 'hover:bg-slate-800 text-slate-300'
                }`}
              >
                <span className="font-semibold">{defaultBankLabel}</span>
                {value === '' && <Check className="w-4 h-4 text-emerald-400" />}
              </button>
            )}

            {/* Section 1: Banks & Cash Funds */}
            {activeSection === 'banks' && (
              <>
                {filteredBanks.length > 0 ? (
                  filteredBanks.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => {
                        onChange(sub.id);
                        setIsOpen(false);
                      }}
                      className={`w-full text-right p-2.5 rounded-xl transition flex items-center justify-between ${
                        value === sub.id
                          ? 'bg-emerald-950/60 text-emerald-300 font-bold border border-emerald-700/50'
                          : 'hover:bg-slate-800/80 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-950 text-emerald-400 border border-slate-700 shrink-0">
                          {sub.code}
                        </span>
                        <span className="truncate">{sub.name}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          ({sub.generalType})
                        </span>
                      </div>
                      {value === sub.id && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-center text-slate-400 text-xs">
                    هیچ بانک یا صندوقی با این مشخصات پیدا نشد.
                  </div>
                )}
              </>
            )}

            {/* Section 2: Persons */}
            {activeSection === 'persons' && (
              <>
                {filteredPersons.length > 0 ? (
                  filteredPersons.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => {
                        onChange(person.id);
                        setIsOpen(false);
                      }}
                      className={`w-full text-right p-2.5 rounded-xl transition flex items-center justify-between ${
                        value === person.id
                          ? 'bg-cyan-950/60 text-cyan-300 font-bold border border-cyan-700/50'
                          : 'hover:bg-slate-800/80 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <User className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span className="truncate">{person.name}</span>
                        {person.code && (
                          <span className="font-mono text-[10px] text-slate-400 shrink-0">
                            ({person.code})
                          </span>
                        )}
                        {person.mobile && (
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {person.mobile}
                          </span>
                        )}
                      </div>
                      {value === person.id && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-center text-slate-400 text-xs">
                    هیچ شخصی با این مشخصات پیدا نشد.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
