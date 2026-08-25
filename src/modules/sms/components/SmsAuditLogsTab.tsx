/**
 * SMS Audit Logs Tab
 * Inspection and reporting of all operational and system events within the SMS module.
 */

import React, { useState } from 'react';
import {
  FileText,
  Search,
  Download,
  Trash2,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  UserCheck,
} from 'lucide-react';
import { SmsLogEntry } from '../types';

interface SmsAuditLogsTabProps {
  logs: SmsLogEntry[];
  onClearLogs?: () => void;
  userRole: 'SUPER_ADMIN' | 'ACCOUNTANT' | 'SALES_AGENT';
}

export const SmsAuditLogsTab: React.FC<SmsAuditLogsTabProps> = ({
  logs,
  onClearLogs,
  userRole,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('all');

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.action.includes(searchTerm) ||
      log.details.includes(searchTerm) ||
      (log.recipient && log.recipient.includes(searchTerm)) ||
      log.id.includes(searchTerm);

    const matchesLevel = levelFilter === 'all' || log.level === levelFilter;

    return matchesSearch && matchesLevel;
  });

  const getLevelBadge = (level: SmsLogEntry['level']) => {
    switch (level) {
      case 'info':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            اطلاعات (INFO)
          </span>
        );
      case 'warn':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            هشدار (WARN)
          </span>
        );
      case 'error':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
            خطا (ERROR)
          </span>
        );
    }
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `sms_audit_logs_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            گزارش ممیزی و سوابق عملیاتی پیامک (SMS Audit Logs)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            ثبت کامل وقایع، تغییرات تنظیمات، خطاهای ارسال و رهگیری کد پیگیری پیامک‌های سیستمی
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportJSON}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs flex items-center gap-2 transition-all"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            خروجی JSON گزارش‌ها
          </button>

          {userRole === 'SUPER_ADMIN' && onClearLogs && (
            <button
              onClick={onClearLogs}
              className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl text-xs flex items-center gap-2 transition-all border border-rose-200"
            >
              <Trash2 className="w-4 h-4" />
              پاکسازی سوابق
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row items-center gap-3 justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
          <input
            type="text"
            placeholder="جستجو در رویدادها، گیرنده یا جزییات..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-3 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-bold text-slate-500 whitespace-nowrap">سطح گزارش:</span>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">همه سطح‌ها</option>
            <option value="info">اطلاعات (INFO)</option>
            <option value="warn">هشدار (WARN)</option>
            <option value="error">خطا (ERROR)</option>
          </select>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200/80">
              <tr>
                <th className="p-4">زمان ثبت</th>
                <th className="p-4">سطح</th>
                <th className="p-4">عنوان عملیات / اکشن</th>
                <th className="p-4">گیرنده / کاربر</th>
                <th className="p-4">جزییات و کد پیگیری</th>
                <th className="p-4">شناسه سابقه</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    هیچ سابقه ممیزی متناسب با جستجو یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="p-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('fa-IR')}
                    </td>
                    <td className="p-4">{getLevelBadge(log.level)}</td>
                    <td className="p-4 font-bold text-slate-800">{log.action}</td>
                    <td className="p-4 font-mono dir-ltr text-right text-slate-600">
                      {log.recipient || 'سیستم'}
                    </td>
                    <td className="p-4 max-w-md text-slate-700 leading-relaxed">
                      {log.details}
                      {log.trackingCode && (
                        <span className="block text-[10px] font-mono text-emerald-600 font-bold mt-0.5">
                          کد پیگیری: {log.trackingCode}
                        </span>
                      )}
                    </td>
                    <td className="p-4 font-mono text-[10px] text-slate-400">{log.id}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
