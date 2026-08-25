/**
 * SMS Dashboard Tab
 * Overview metrics: Sent count, queued count, failed count, active provider, mock mode status, and quick operations.
 */

import React from 'react';
import {
  MessageSquare,
  Send,
  Clock,
  AlertTriangle,
  Server,
  Play,
  Pause,
  RefreshCw,
  Activity,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { SmsMetrics, SmsSettings } from '../types';

interface SmsDashboardTabProps {
  metrics: SmsMetrics;
  settings: SmsSettings;
  schedulerStatus: { isRunning: boolean; isPaused: boolean; intervalMs: number; lastTickTime?: string };
  onToggleScheduler: () => void;
  onRunTickNow: () => void;
  onNavigateToTab: (tab: string) => void;
  userRole: 'SUPER_ADMIN' | 'ACCOUNTANT' | 'SALES_AGENT';
}

export const SmsDashboardTab: React.FC<SmsDashboardTabProps> = ({
  metrics,
  settings,
  schedulerStatus,
  onToggleScheduler,
  onRunTickNow,
  onNavigateToTab,
  userRole,
}) => {
  const successRate = metrics.total > 0 ? Math.round((metrics.sent / metrics.total) * 100) : 100;

  return (
    <div className="space-y-6">
      {/* Banner / Service Status Overview */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              settings.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
            }`}
          >
            <MessageSquare className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-800">مرکز مدیریت و پایش سامانه پیامک</h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  settings.enabled
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}
              >
                {settings.enabled ? 'سامانه فعال' : 'سامانه غیرفعال'}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                حالت آزمایشی (Mock Mode)
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              مدیریت ایزوله زیرساخت پیامک، صف ارسال، زمانبندی و ممیزی رویدادهای اطلاع‌رسانی
            </p>
          </div>
        </div>

        {/* Scheduler Quick Controls */}
        <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200/60 self-stretch md:self-auto justify-between">
          <div className="text-right px-2">
            <span className="text-[11px] font-semibold text-slate-500 block">موتور زمانبندی (Scheduler)</span>
            <span className="text-xs font-bold text-slate-700">
              {schedulerStatus.isPaused
                ? 'متوقف شده'
                : schedulerStatus.isRunning
                ? 'در حال اجرا (۱۰ ثانیه)'
                : 'غیرفعال'}
            </span>
          </div>

          {userRole === 'SUPER_ADMIN' && (
            <div className="flex items-center gap-1">
              <button
                onClick={onRunTickNow}
                title="پردازش فوری صف"
                className="p-2 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={onToggleScheduler}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  schedulerStatus.isPaused
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-amber-500 text-white hover:bg-amber-600'
                }`}
              >
                {schedulerStatus.isPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    ادامه
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    توقف
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Sent Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">موفق (ارسال شده)</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Send className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-800">{metrics.sent}</span>
            <span className="text-xs font-semibold text-emerald-600">پیام</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">نرخ موفقیت: {successRate}%</p>
          <div className="absolute bottom-0 right-0 left-0 h-1 bg-emerald-500 rounded-b-2xl" />
        </div>

        {/* Pending / Queued Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">در صف انتظار</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-800">{metrics.pending}</span>
            <span className="text-xs font-semibold text-blue-600">پیام</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">آماده پردازش زمانبندی شده</p>
          <div className="absolute bottom-0 right-0 left-0 h-1 bg-blue-500 rounded-b-2xl" />
        </div>

        {/* Failed Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">ناموفق / خطا</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-800">{metrics.failed}</span>
            <span className="text-xs font-semibold text-rose-600">پیام</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">نیاز به بازتلاش یا بررسی علت خطا</p>
          <div className="absolute bottom-0 right-0 left-0 h-1 bg-rose-500 rounded-b-2xl" />
        </div>

        {/* Active Provider Card */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">درگاه سرویس‌دهنده</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Server className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-sm font-black text-slate-800 truncate block">
              {settings.activeProviderId === 'mock_provider_01'
                ? 'پنل آزمایشی شبیه‌ساز (Mock Provider)'
                : settings.activeProviderId}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">فرستنده: {settings.organizationSenderName}</p>
          <div className="absolute bottom-0 right-0 left-0 h-1 bg-purple-500 rounded-b-2xl" />
        </div>
      </div>

      {/* Quick Action Navigation Buttons & Config Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm md:col-span-2 space-y-4">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-600" />
            خلاصه قوانین و تنظیمات فعال سیستم
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between">
              <span className="text-slate-500">ساعات استراحت (Quiet Hours):</span>
              <span className="font-bold text-slate-700">
                {settings.quietHours.enabled
                  ? `${settings.quietHours.startTime} الی ${settings.quietHours.endTime}`
                  : 'غیرفعال'}
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between">
              <span className="text-slate-500">ارسال اضطراری در ساعات استراحت:</span>
              <span className="font-bold text-slate-700">
                {settings.quietHours.allowCriticalDuringQuietHours ? 'مجاز' : 'غیرمجاز'}
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between">
              <span className="text-slate-500">سقف ارسال روزانه:</span>
              <span className="font-bold text-slate-700">{settings.dailySendLimit} پیام</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 flex items-center justify-between">
              <span className="text-slate-500">حداکثر بازتلاش خودکار:</span>
              <span className="font-bold text-slate-700">{settings.defaultMaxRetries} مرتبه</span>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap gap-2">
            <button
              onClick={() => onNavigateToTab('settings')}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
            >
              ویرایش تنظیمات عمومی
            </button>
            <button
              onClick={() => onNavigateToTab('events')}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
            >
              تنظیم رویدادهای پیامکی
            </button>
            <button
              onClick={() => onNavigateToTab('queue')}
              className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-xl text-xs transition-colors"
            >
              مشاهده کامل صف ارسال
            </button>
          </div>
        </div>

        {/* Isolation Guarantee Box */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 rounded-2xl shadow-sm flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-emerald-400 mb-3">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-slate-100">تضمین معماری ایزوله ماژول پیامک</h4>
            <p className="text-xs text-slate-300 mt-2 leading-relaxed">
              تمامی تنظیمات، قالب‌ها، صف پیامک و ممیزی‌ها در فضای مستقل ماژول پیامک ذخیره شده و هیچ دستکاری یا
              ارتباط مستقیمی با هسته محاسبات مالی و اسناد حسابداری ایجاد نگردیده است.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
            <span>نسخه ماژول: v1.0.0</span>
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              تأیید شده
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
