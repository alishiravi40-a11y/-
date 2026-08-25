/**
 * Investor Contract & Profile Searchable Directory
 * (لیست و جستجوی جامع سرمایه‌گذاران و قراردادها)
 */

import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  FileText,
  User,
  Calendar,
  Coins,
  TrendingUp,
  Filter,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import {
  InvestorContract,
  InvestorContractStatus,
  InvestorPaymentFrequency,
} from '../types';
import { Person } from '../../../types';

interface InvestorContractListProps {
  contracts: InvestorContract[];
  persons: Person[];
  onSelectContract: (contract: InvestorContract) => void;
  onCreateNewContract?: () => void;
}

export const InvestorContractList: React.FC<InvestorContractListProps> = ({
  contracts,
  persons,
  onSelectContract,
  onCreateNewContract,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvestorContractStatus | 'ALL'>('ALL');
  const [frequencyFilter, setFrequencyFilter] = useState<InvestorPaymentFrequency | 'ALL'>('ALL');

  const filteredContracts = useMemo(() => {
    return contracts.filter((contract) => {
      const person = persons.find((p) => p.id === contract.investorPersonId);
      const name = person?.name?.toLowerCase() || '';
      const mobile = person?.mobile || '';
      const nationalId = person?.nationalId || '';
      const contractNum = contract.contractNumber.toLowerCase();
      const term = searchTerm.toLowerCase();

      const matchesSearch =
        name.includes(term) ||
        mobile.includes(term) ||
        nationalId.includes(term) ||
        contractNum.includes(term);

      const matchesStatus = statusFilter === 'ALL' || contract.status === statusFilter;
      const matchesFrequency = frequencyFilter === 'ALL' || contract.paymentFrequency === frequencyFilter;

      return matchesSearch && matchesStatus && matchesFrequency;
    });
  }, [contracts, persons, searchTerm, statusFilter, frequencyFilter]);

  const getStatusBadge = (status: InvestorContractStatus) => {
    switch (status) {
      case 'active':
        return (
          <span className="px-2.5 py-1 bg-emerald-900/50 text-emerald-300 border border-emerald-700/50 rounded-lg text-xs font-semibold flex items-center gap-1 w-fit">
            <CheckCircle className="w-3.5 h-3.5" />
            فعال
          </span>
        );
      case 'completed':
        return (
          <span className="px-2.5 py-1 bg-blue-900/50 text-blue-300 border border-blue-700/50 rounded-lg text-xs font-semibold flex items-center gap-1 w-fit">
            <CheckCircle className="w-3.5 h-3.5" />
            تکمیل شده
          </span>
        );
      case 'terminated':
        return (
          <span className="px-2.5 py-1 bg-rose-900/50 text-rose-300 border border-rose-700/50 rounded-lg text-xs font-semibold flex items-center gap-1 w-fit">
            <XCircle className="w-3.5 h-3.5" />
            خاتمه یافته
          </span>
        );
      case 'paused':
        return (
          <span className="px-2.5 py-1 bg-amber-900/50 text-amber-300 border border-amber-700/50 rounded-lg text-xs font-semibold flex items-center gap-1 w-fit">
            <Clock className="w-3.5 h-3.5" />
            معلق
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 bg-slate-800 text-slate-300 border border-slate-700 rounded-lg text-xs font-semibold w-fit">
            {status}
          </span>
        );
    }
  };

  const getFrequencyText = (freq: InvestorPaymentFrequency) => {
    switch (freq) {
      case 'monthly':
        return 'ماهانه';
      case 'bimonthly':
        return 'دو ماهه';
      case 'quarterly':
        return 'سه ماهه (فصلی)';
      case 'semi_annual':
        return 'شش ماهه';
      case 'annual':
        return 'سالانه';
      default:
        return freq;
    }
  };

  return (
    <div className="space-y-5">
      {/* Search & Filter Header */}
      <div className="bg-slate-800/90 border border-slate-700 p-4 rounded-2xl space-y-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="جستجو با نام سرمایه‌گذار، شماره موبایل، کد ملی یا شماره قرارداد..."
              className="w-full bg-slate-900/80 border border-slate-700 rounded-xl pr-11 pl-4 py-2.5 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-emerald-500 transition-all"
            />
          </div>

          <div className="flex items-center gap-3">
            {onCreateNewContract && (
              <button
                onClick={onCreateNewContract}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl text-sm transition-all flex items-center gap-2 shadow-md whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                ثبت قرارداد سرمایه‌گذاری جدید
              </button>
            )}
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-700/60 text-xs">
          <span className="text-slate-400 font-medium flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-emerald-400" />
            فیلتر وضعیت:
          </span>
          {(['ALL', 'active', 'completed', 'terminated', 'paused'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg border transition-all ${
                statusFilter === st
                  ? 'bg-emerald-600 text-white border-emerald-500 font-bold'
                  : 'bg-slate-900/60 text-slate-300 border-slate-700 hover:border-slate-600'
              }`}
            >
              {st === 'ALL'
                ? 'همه وضعیت‌ها'
                : st === 'active'
                ? 'فعال'
                : st === 'completed'
                ? 'تکمیل شده'
                : st === 'terminated'
                ? 'خاتمه یافته'
                : 'معلق'}
            </button>
          ))}

          <span className="text-slate-400 font-medium mr-4 flex items-center gap-1">
            دوره پرداخت:
          </span>
          {(['ALL', 'monthly', 'quarterly', 'semi_annual', 'annual'] as const).map((fr) => (
            <button
              key={fr}
              onClick={() => setFrequencyFilter(fr)}
              className={`px-3 py-1.5 rounded-lg border transition-all ${
                frequencyFilter === fr
                  ? 'bg-teal-600 text-white border-teal-500 font-bold'
                  : 'bg-slate-900/60 text-slate-300 border-slate-700 hover:border-slate-600'
              }`}
            >
              {fr === 'ALL' ? 'همه دوره‌ها' : getFrequencyText(fr)}
            </button>
          ))}
        </div>
      </div>

      {/* Contracts Table / List */}
      <div className="bg-slate-800/90 border border-slate-700 rounded-2xl overflow-hidden shadow-sm">
        {filteredContracts.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm space-y-2">
            <FileText className="w-10 h-10 text-slate-600 mx-auto" />
            <div>هیچ قرارداد سرمایه‌گذاری مطابق با معیارهای جستجو یافت نشد.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm text-slate-300">
              <thead className="bg-slate-900/80 text-xs font-semibold text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="p-3.5">نام سرمایه‌گذار / کد شخص</th>
                  <th className="p-3.5">شماره قرارداد</th>
                  <th className="p-3.5">سرمایه فعلی (ریال)</th>
                  <th className="p-3.5">نرخ کارمزد ماهانه</th>
                  <th className="p-3.5">دوره پرداخت</th>
                  <th className="p-3.5">تاریخ شروع / پایان</th>
                  <th className="p-3.5">وضعیت</th>
                  <th className="p-3.5 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {filteredContracts.map((contract) => {
                  const person = persons.find((p) => p.id === contract.investorPersonId);
                  return (
                    <tr
                      key={contract.id}
                      className="hover:bg-slate-700/40 transition-colors group cursor-pointer"
                      onClick={() => onSelectContract(contract)}
                    >
                      <td className="p-3.5">
                        <div className="font-bold text-slate-100 flex items-center gap-2">
                          <User className="w-4 h-4 text-emerald-400" />
                          {person?.name || 'سرمایه‌گذار ناشناس'}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          کد: {person?.code || '---'} {person?.mobile ? `| ${person.mobile}` : ''}
                        </div>
                      </td>

                      <td className="p-3.5 font-mono text-emerald-300 font-semibold">
                        {contract.contractNumber}
                      </td>

                      <td className="p-3.5 font-extrabold text-white">
                        {contract.currentCapital.toLocaleString()}{' '}
                        {contract.currentCapital !== contract.initialCapital && (
                          <span className="text-[10px] text-amber-400 block font-normal">
                            (اولیه: {contract.initialCapital.toLocaleString()})
                          </span>
                        )}
                      </td>

                      <td className="p-3.5 text-teal-300 font-bold">
                        {contract.monthlyFeeRate}٪
                      </td>

                      <td className="p-3.5 text-slate-300 text-xs">
                        {getFrequencyText(contract.paymentFrequency)}
                      </td>

                      <td className="p-3.5 text-xs text-slate-300">
                        <div>شروع: {contract.startDate}</div>
                        <div className="text-slate-400 mt-0.5">
                          پایان: {contract.endDate || 'نامشخص'}
                        </div>
                      </td>

                      <td className="p-3.5">{getStatusBadge(contract.status)}</td>

                      <td className="p-3.5 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectContract(contract);
                          }}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-emerald-600 text-slate-200 hover:text-white rounded-lg text-xs transition-all flex items-center gap-1 mx-auto"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          مشاهده جزئیات
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
