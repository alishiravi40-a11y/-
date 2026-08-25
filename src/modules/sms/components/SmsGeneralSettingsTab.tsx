/**
 * SMS General Settings Tab
 * Isolated management of system enable state, quiet hours, quotas, retry limits, and provider configurations.
 */

import React, { useState } from 'react';
import {
  Settings,
  Shield,
  Clock,
  RotateCcw,
  Save,
  CheckCircle2,
  Server,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { SmsSettings } from '../types';

interface SmsGeneralSettingsTabProps {
  settings: SmsSettings;
  onUpdateSettings: (newSettings: Partial<SmsSettings>) => void;
  userRole: 'SUPER_ADMIN' | 'ACCOUNTANT' | 'SALES_AGENT';
}

export const SmsGeneralSettingsTab: React.FC<SmsGeneralSettingsTabProps> = ({
  settings,
  onUpdateSettings,
  userRole,
}) => {
  const [formData, setFormData] = useState<SmsSettings>({ ...settings });
  const [isSaved, setIsSaved] = useState<boolean>(false);

  const canEdit = userRole === 'SUPER_ADMIN';

  const handleChange = (field: keyof SmsSettings, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsSaved(false);
  };

  const handleQuietHoursChange = (field: keyof SmsSettings['quietHours'], value: any) => {
    setFormData((prev) => ({
      ...prev,
      quietHours: {
        ...prev.quietHours,
        [field]: value,
      },
    }));
    setIsSaved(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    onUpdateSettings(formData);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-600" />
            تنظیمات عمومی و پارامترهای موتور پیامک
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            پیکربندی سقف ارسال، ساعات استراحت شبانه، محدودیت‌های بازتلاش و ارائه‌دهنده سرویس
          </p>
        </div>

        {canEdit ? (
          <button
            type="submit"
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-2 transition-all shadow-sm"
          >
            {isSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {isSaved ? 'تنظیمات ذخیره شد' : 'ذخیره تغییرات'}
          </button>
        ) : (
          <div className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-xs font-bold flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            حالت مشاهده فقط خواندنی (نیاز به نقش مدیر ارشد)
          </div>
        )}
      </div>

      {/* Main Switch & Basic Config */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* System Toggle & Sender Name */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-5">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2">
            <Server className="w-4 h-4 text-emerald-600" />
            وضعیت کلی و هویت فرستنده
          </h3>

          {/* Master Switch */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200/60">
            <div>
              <span className="text-xs font-bold text-slate-800 block">فعال‌سازی کلی سامانه پیامک</span>
              <span className="text-[11px] text-slate-500">
                در صورت غیرفعال بودن، هیچ پیامکی در صف پردازش نمی‌شود.
              </span>
            </div>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => handleChange('enabled', !formData.enabled)}
              className={`p-1 transition-colors ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {formData.enabled ? (
                <ToggleRight className="w-10 h-10 text-emerald-600" />
              ) : (
                <ToggleLeft className="w-10 h-10 text-slate-400" />
              )}
            </button>
          </div>

          {/* Sender Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">نام یا عنوان فرستنده سازمانی</label>
            <input
              type="text"
              disabled={!canEdit}
              value={formData.organizationSenderName}
              onChange={(e) => handleChange('organizationSenderName', e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
            />
          </div>

          {/* Active Provider ID */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">انتخاب سرویس‌دهنده پیامک (SMS Provider)</label>
            <select
              disabled={!canEdit}
              value={formData.activeProviderId}
              onChange={(e) => handleChange('activeProviderId', e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
            >
              <option value="mock_provider_01">پنل آزمایشی شبیه‌ساز (Mock Provider - پیش‌فرض)</option>
              <option value="kavenegar_api">سامانه کاوه‌نگار (Kavenegar Web Service)</option>
              <option value="farazsms_api">سامانه فراز اس‌ام‌اس / مگفا (FarazSMS API)</option>
            </select>
          </div>

          {/* Event Integration Mode */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">حالت یکپارچه‌سازی رویدادهای مالی (eventIntegrationMode)</label>
            <select
              disabled={!canEdit}
              value={formData.eventIntegrationMode || 'mock'}
              onChange={(e) => handleChange('eventIntegrationMode', e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
            >
              <option value="mock">حالت آزمایشی (Mock Mode - شبیه‌سازی بدون ارسال واقعی)</option>
              <option value="production">حالت عملیاتی (Production Mode - ارسال واقعی به مشتریان)</option>
            </select>
          </div>
        </div>

        {/* Quotas & Retry Limits */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-5">
          <h3 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-3 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-emerald-600" />
            سقف ارسال و قوانین بازتلاش (Retry Limits)
          </h3>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">سقف مجاز ارسال روزانه (تعداد پیامک)</label>
            <input
              type="number"
              disabled={!canEdit}
              min={10}
              max={100000}
              value={formData.dailySendLimit}
              onChange={(e) => handleChange('dailySendLimit', parseInt(e.target.value) || 1000)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
            />
            <span className="text-[11px] text-slate-400">جلوگیری از ارسال بیش از حد در موارد غیرمنتظره</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">حداکثر تعداد تلاش مجدد</label>
              <input
                type="number"
                disabled={!canEdit}
                min={1}
                max={10}
                value={formData.defaultMaxRetries}
                onChange={(e) => handleChange('defaultMaxRetries', parseInt(e.target.value) || 3)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">فاصله بین تلاش‌ها (دقیقه)</label>
              <input
                type="number"
                disabled={!canEdit}
                min={1}
                max={120}
                value={formData.retryIntervalMinutes}
                onChange={(e) => handleChange('retryIntervalMinutes', parseInt(e.target.value) || 5)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500 disabled:opacity-60"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Quiet Hours Settings Section */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600" />
            تنظیمات ساعات عدم مزاحمت و استراحت (Quiet Hours)
          </h3>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">فعال‌سازی محدوده استراحت</span>
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => handleQuietHoursChange('enabled', !formData.quietHours.enabled)}
            >
              {formData.quietHours.enabled ? (
                <ToggleRight className="w-8 h-8 text-emerald-600" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {formData.quietHours.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">زمان شروع ساعات استراحت</label>
              <input
                type="time"
                disabled={!canEdit}
                value={formData.quietHours.startTime}
                onChange={(e) => handleQuietHoursChange('startTime', e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[11px] text-slate-400">مثال: ۲۲:۰۰ (ساعت ۱۰ شب)</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">زمان پایان ساعات استراحت</label>
              <input
                type="time"
                disabled={!canEdit}
                value={formData.quietHours.endTime}
                onChange={(e) => handleQuietHoursChange('endTime', e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[11px] text-slate-400">مثال: ۰۸:۰۰ (ساعت ۸ صبح)</span>
            </div>

            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200/60 self-end">
              <div>
                <span className="text-xs font-bold text-slate-800 block">مجوز ارسال پیامک‌های اضطراری</span>
                <span className="text-[11px] text-slate-500">پیام‌های با اولویت Critical حتی در شب ارسال می‌شوند</span>
              </div>
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={formData.quietHours.allowCriticalDuringQuietHours}
                onChange={(e) => handleQuietHoursChange('allowCriticalDuringQuietHours', e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Warning / Informational Footer */}
      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-800 leading-relaxed">
          <strong>تذکر مدیریتی:</strong> تغییرات ایجاد شده در تنظیمات پیامک مستقیماً بر رفتار موتور صف و زمانبندی
          ارسال تأثیر می‌گذارد و در دفتر ممیزی (Audit Log) ماژول پیامک به عنوان سابقه سیستمی ثبت می‌گردد.
        </div>
      </div>
    </form>
  );
};
