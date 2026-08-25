import React, { useState } from 'react';
import { InvestorAlert } from '../types';
import { Bell, AlertTriangle, AlertCircle, Info, CheckCircle2, Search, Calendar, UserCheck } from 'lucide-react';

interface InvestorAlertCenterProps {
  alerts: InvestorAlert[];
  onSelectAlertContract?: (contractId: string) => void;
}

export const InvestorAlertCenter: React.FC<InvestorAlertCenterProps> = ({
  alerts,
  onSelectAlertContract,
}) => {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const filteredAlerts = alerts.filter((alert) => {
    const matchesType = filterType === 'ALL' || alert.type === filterType;
    const matchesSeverity = filterSeverity === 'ALL' || alert.severity === filterSeverity;
    const matchesSearch =
      alert.title.includes(searchTerm) || alert.description.includes(searchTerm);

    return matchesType && matchesSeverity && matchesSearch;
  });

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <span className="bg-rose-500/10 text-rose-400 border border-rose-500/30 px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> بحرانی</span>;
      case 'warning':
        return <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> هشدار</span>;
      case 'info':
      default:
        return <span className="bg-blue-500/10 text-blue-400 border border-blue-500/30 px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1"><Info className="w-3.5 h-3.5" /> اطلاع</span>;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'UPCOMING_PAYMENT':
        return 'پرداخت نزدیک';
      case 'EXPIRING_CONTRACT':
        return 'پایان قرارداد';
      case 'RECENT_CHANGE':
        return 'تغییرات اخیر';
      case 'RETURN_REQUEST':
        return 'درخواست استرداد';
      case 'DATA_WARNING':
        return 'اطلاعات ناقص';
      default:
        return type;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-lg border border-amber-500/20">
            <Bell className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">مرکز هشدارهای هوشمند مدیر</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              پایش آنلاین سررسیدها، پایان قراردادها، درخواست‌های استرداد و خطاهای داده‌ای
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-800/80 p-1.5 rounded-lg border border-slate-700/50 text-xs">
          <span className="text-slate-400 px-2">مجموع هشدارها:</span>
          <span className="font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
            {alerts.length}
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
          <input
            type="text"
            placeholder="جستجو در هشدارها..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pr-9 pl-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
          >
            <option value="ALL">همه دسته‌بندی‌ها</option>
            <option value="UPCOMING_PAYMENT">پرداخت‌های نزدیک</option>
            <option value="EXPIRING_CONTRACT">قراردادهای در حال اتمام</option>
            <option value="RECENT_CHANGE">تغییرات اخیر قراردادها</option>
            <option value="RETURN_REQUEST">درخواست‌های بازگشت سرمایه</option>
            <option value="DATA_WARNING">هشدار اطلاعات ناقص</option>
          </select>
        </div>

        <div>
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
          >
            <option value="ALL">همه سطوح اهمیت</option>
            <option value="critical">بحرانی (Critical)</option>
            <option value="warning">هشدار (Warning)</option>
            <option value="info">اطلاعاتی (Info)</option>
          </select>
        </div>
      </div>

      {/* Alert Cards Grid */}
      {filteredAlerts.length === 0 ? (
        <div className="p-8 text-center bg-slate-950/40 border border-dashed border-slate-800 rounded-xl">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
          <p className="text-sm font-semibold text-slate-300">هیچ هشداری با فیلتر انتخابی یافت نشد</p>
          <p className="text-xs text-slate-500 mt-1">تمام سررسیدها و شرایط هوشمند در وضعیت مطلوب قرار دارند.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
          {filteredAlerts.map((alert) => (
            <div
              key={alert.id}
              className="bg-slate-950/60 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition duration-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getSeverityBadge(alert.severity)}</div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-100">{alert.title}</span>
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full border border-slate-700">
                      {getTypeLabel(alert.type)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{alert.description}</p>
                  {alert.dueDate && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-400/90 pt-1">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>تاریخ سررسید / پایان: {alert.dueDate}</span>
                    </div>
                  )}
                </div>
              </div>

              {alert.contractId && onSelectAlertContract && (
                <button
                  onClick={() => onSelectAlertContract(alert.contractId!)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1 self-end sm:self-auto transition"
                >
                  مشاهده قرارداد
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
