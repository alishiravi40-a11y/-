/**
 * SMS Events Configuration Tab
 * Matrix configuration for binding system & financial events to SMS templates, priority levels,
 * and dispatch rules in an isolated, non-intrusive environment.
 */

import React, { useState } from 'react';
import {
  Sliders,
  Shield,
  Save,
  CheckCircle2,
  Bell,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Info,
  Radio,
  Zap,
  Play,
} from 'lucide-react';
import { SmsEventTrigger, SmsPriority, SmsTemplate } from '../types';
import { EventDispatcherStats } from '../eventDispatcher';

export interface SmsEventConfigItem {
  trigger: SmsEventTrigger;
  title: string;
  category: 'فروش' | 'اقساط' | 'چک و بانکی' | 'مشتریان و اعتبارسنجی' | 'سایر';
  enabled: boolean;
  priority: SmsPriority;
  templateId: string;
  bypassQuietHours: boolean;
}

const DEFAULT_EVENT_CONFIGS: SmsEventConfigItem[] = [
  {
    trigger: 'cash_sale',
    title: 'صدور فاکتور فروش نقدی (INVOICE_CREATED)',
    category: 'فروش',
    enabled: true,
    priority: 'normal',
    templateId: 'tpl_cash_sale',
    bypassQuietHours: false,
  },
  {
    trigger: 'installment_sale',
    title: 'صدور فاکتور و دفترچه اقساط (INSTALLMENT_SALE)',
    category: 'اقساط',
    enabled: true,
    priority: 'high',
    templateId: 'tpl_installment_created',
    bypassQuietHours: false,
  },
  {
    trigger: 'installment_due',
    title: 'یادآوری سررسید قسط (INSTALLMENT_DUE_REMINDER)',
    category: 'اقساط',
    enabled: true,
    priority: 'normal',
    templateId: 'tpl_installment_due',
    bypassQuietHours: false,
  },
  {
    trigger: 'installment_overdue',
    title: 'هشدار معوقه شدن قسط (INSTALLMENT_OVERDUE_ALERT)',
    category: 'اقساط',
    enabled: true,
    priority: 'high',
    templateId: 'tpl_installment_overdue',
    bypassQuietHours: false,
  },
  {
    trigger: 'check_due',
    title: 'یادآوری سررسید چک دریافتی (CHECK_DUE_REMINDER)',
    category: 'چک و بانکی',
    enabled: true,
    priority: 'high',
    templateId: 'tpl_check_due',
    bypassQuietHours: false,
  },
  {
    trigger: 'check_bounced',
    title: 'اعلام برگشت خوردن چک (CHECK_BOUNCED)',
    category: 'چک و بانکی',
    enabled: true,
    priority: 'critical',
    templateId: 'tpl_check_bounced',
    bypassQuietHours: true,
  },
  {
    trigger: 'customer_registered',
    title: 'ثبت و خوش‌آمدگویی مشتری جدید (CUSTOMER_REGISTERED)',
    category: 'مشتریان و اعتبارسنجی',
    enabled: true,
    priority: 'low',
    templateId: 'tpl_customer_welcome',
    bypassQuietHours: false,
  },
  {
    trigger: 'credit_approved',
    title: 'تأیید پرونده اعتبار همکار (CREDIT_APPROVED)',
    category: 'مشتریان و اعتبارسنجی',
    enabled: true,
    priority: 'high',
    templateId: 'tpl_credit_approved',
    bypassQuietHours: false,
  },
  {
    trigger: 'credit_rejected',
    title: 'عدم تأیید پرونده اعتبار همکار (CREDIT_REJECTED)',
    category: 'مشتریان و اعتبارسنجی',
    enabled: true,
    priority: 'normal',
    templateId: 'tpl_credit_rejected',
    bypassQuietHours: false,
  },
  {
    trigger: 'nesyeh_order_submitted',
    title: 'ثبت سفارش خرید نسیه (ON_NESYEH_ORDER_SUBMITTED)',
    category: 'فروش',
    enabled: true,
    priority: 'normal',
    templateId: 'tpl_nesyeh_order_submitted',
    bypassQuietHours: false,
  },
  {
    trigger: 'nesyeh_order_status_changed',
    title: 'تغییر وضعیت سفارش نسیه (ON_NESYEH_ORDER_STATUS_CHANGED)',
    category: 'فروش',
    enabled: true,
    priority: 'high',
    templateId: 'tpl_nesyeh_order_status_changed',
    bypassQuietHours: false,
  },
  {
    trigger: 'nesyeh_payment_verified',
    title: 'تایید اعلام پرداخت نسیه (ON_NESYEH_PAYMENT_VERIFIED)',
    category: 'مشتریان و اعتبارسنجی',
    enabled: true,
    priority: 'high',
    templateId: 'tpl_nesyeh_payment_verified',
    bypassQuietHours: false,
  },
  {
    trigger: 'credit_limit_approaching',
    title: 'هشدار نزدیک شدن بدهی به ۸۰٪ سقف اعتبار (ON_CREDIT_LIMIT_APPROACHING)',
    category: 'مشتریان و اعتبارسنجی',
    enabled: true,
    priority: 'critical',
    templateId: 'tpl_credit_limit_approaching',
    bypassQuietHours: true,
  },
  {
    trigger: 'manual_custom',
    title: 'ارسال دستی و احراز هویت (OTP / MANUAL_CUSTOM)',
    category: 'سایر',
    enabled: true,
    priority: 'critical',
    templateId: 'tpl_otp_auth',
    bypassQuietHours: true,
  },
];

interface SmsEventsConfigTabProps {
  templates: SmsTemplate[];
  userRole: 'SUPER_ADMIN' | 'ACCOUNTANT' | 'SALES_AGENT';
  dispatcherStats?: EventDispatcherStats;
  onSimulateEvent?: (eventType: 'invoice' | 'installment' | 'check' | 'customer' | 'otp') => void;
}

export const SmsEventsConfigTab: React.FC<SmsEventsConfigTabProps> = ({
  templates,
  userRole,
  dispatcherStats,
  onSimulateEvent,
}) => {
  const [configs, setConfigs] = useState<SmsEventConfigItem[]>(() => {
    try {
      const saved = localStorage.getItem('smsEventsConfig');
      return saved ? JSON.parse(saved) : DEFAULT_EVENT_CONFIGS;
    } catch {
      return DEFAULT_EVENT_CONFIGS;
    }
  });

  const [isSaved, setIsSaved] = useState<boolean>(false);
  const canEdit = userRole === 'SUPER_ADMIN';

  const handleToggleEvent = (trigger: SmsEventTrigger) => {
    if (!canEdit) return;
    setConfigs((prev) =>
      prev.map((item) => (item.trigger === trigger ? { ...item, enabled: !item.enabled } : item))
    );
    setIsSaved(false);
  };

  const handleUpdateItem = (
    trigger: SmsEventTrigger,
    field: keyof SmsEventConfigItem,
    value: any
  ) => {
    if (!canEdit) return;
    setConfigs((prev) =>
      prev.map((item) => (item.trigger === trigger ? { ...item, [field]: value } : item))
    );
    setIsSaved(false);
  };

  const handleSaveAll = () => {
    try {
      localStorage.setItem('smsEventsConfig', JSON.stringify(configs));
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save event configs', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-emerald-600" />
            تنظیمات رویدادهای پیامکی سیستم (Event Trigger Matrix)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            تعیین اولویت، قالب متصل و قوانین ارسال اختصاصی برای هر رویداد عملیاتی و سیستمی
          </p>
        </div>

        {canEdit ? (
          <button
            onClick={handleSaveAll}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-2 transition-all shadow-sm"
          >
            {isSaved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {isSaved ? 'پیکربندی ذخیره شد' : 'ذخیره تنظیمات رویدادها'}
          </button>
        ) : (
          <div className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl text-xs font-semibold flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            مشاهده فقط خواندنی
          </div>
        )}
      </div>

      {/* Event Bridge Status Monitor Card */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white rounded-2xl p-5 border border-slate-700 shadow-md">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 border-b border-slate-700/80 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-400 flex items-center justify-center">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                پل دریافت رویدادها (SMS Event Bridge Status)
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  فعال و شنونده
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                لایه دریافت رویدادهای مالی و سیستمی به صورت کاملاً ایزوله بدون دستکاری هسته حسابداری
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="bg-slate-800/80 px-3.5 py-2 rounded-xl border border-slate-700 text-slate-300">
              <span className="text-slate-400 font-sans text-[11px] block">رویدادهای پردازش‌شده:</span>
              <strong className="text-emerald-400 text-sm font-black">{dispatcherStats?.eventsProcessedCount ?? 0}</strong>
            </div>
            <div className="bg-slate-800/80 px-3.5 py-2 rounded-xl border border-slate-700 text-slate-300">
              <span className="text-slate-400 font-sans text-[11px] block">پیامک‌های ایجادشده در صف:</span>
              <strong className="text-amber-400 text-sm font-black">{dispatcherStats?.queueItemsCreatedCount ?? 0}</strong>
            </div>
          </div>
        </div>

        {/* Last Event Info & Mock Event Simulator Buttons */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          {/* Last Received Event */}
          <div className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700/80 space-y-2">
            <span className="text-slate-400 font-bold block text-[11px]">آخرین رویداد دریافت‌شده:</span>
            {dispatcherStats?.lastReceivedEventName ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-emerald-400 font-bold">{dispatcherStats.lastReceivedEventName}</span>
                  <span className="text-[10px] text-slate-400 dir-ltr">{dispatcherStats.lastReceivedTimestamp?.split('T')[1]?.slice(0, 8)}</span>
                </div>
                <div className="bg-slate-900/80 p-2 rounded text-[11px] font-mono text-slate-300 truncate">
                  {JSON.stringify(dispatcherStats.lastReceivedEventPayload)}
                </div>
              </div>
            ) : (
              <span className="text-slate-500 italic block py-2">هنوز هیچ رویدادی دریافت نشده است. جهت تست، دکمه‌های شبیه‌سازی را بفشارید.</span>
            )}
          </div>

          {/* Mock Event Simulator Controls */}
          <div className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700/80 space-y-2">
            <span className="text-slate-300 font-bold flex items-center gap-1.5 text-[11px]">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              تست و شبیه‌سازی ارسال رویداد (بدون دسترسی به دیتابیس مالی):
            </span>
            <div className="flex flex-wrap gap-2 pt-1">
              {onSimulateEvent && (
                <>
                  <button
                    onClick={() => onSimulateEvent('invoice')}
                    className="px-2.5 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1"
                  >
                    <Play className="w-3 h-3 fill-emerald-300" /> فاکتور
                  </button>
                  <button
                    onClick={() => onSimulateEvent('installment')}
                    className="px-2.5 py-1.5 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/40 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1"
                  >
                    <Play className="w-3 h-3 fill-blue-300" /> سررسید قسط
                  </button>
                  <button
                    onClick={() => onSimulateEvent('check')}
                    className="px-2.5 py-1.5 bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1"
                  >
                    <Play className="w-3 h-3 fill-rose-300" /> برگشت چک
                  </button>
                  <button
                    onClick={() => onSimulateEvent('customer')}
                    className="px-2.5 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/40 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1"
                  >
                    <Play className="w-3 h-3 fill-indigo-300" /> ثبت مشتری
                  </button>
                  <button
                    onClick={() => onSimulateEvent('otp')}
                    className="px-2.5 py-1.5 bg-amber-600/30 hover:bg-amber-600/50 text-amber-300 border border-amber-500/40 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1"
                  >
                    <Play className="w-3 h-3 fill-amber-300" /> کد OTP
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Info Notice Box */}
      <div className="p-4 bg-blue-50/80 border border-blue-200 rounded-2xl flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-800 leading-relaxed">
          <strong>ساختار مستقل رویدادها:</strong> این ماتریس پیکربندی به عنوان مرجع تنظیمات پیامکی عمل می‌کند.
          غیرفعال کردن هر رویداد در این بخش، بدون دستکاری منطق مالی حسابداری، جلوی تولید پیامک برای آن رویداد را
          می‌گیرد.
        </div>
      </div>

      {/* Event Matrix Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200/80">
              <tr>
                <th className="p-4">وضعیت</th>
                <th className="p-4">عنوان رویداد سیستمی</th>
                <th className="p-4">دسته اصلی</th>
                <th className="p-4">اولویت صف ارسال</th>
                <th className="p-4">قالب پیامک متصل</th>
                <th className="p-4">عبور از ساعات استراحت</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {configs.map((cfg) => (
                <tr key={cfg.trigger} className="hover:bg-slate-50/60 transition-colors">
                  {/* Enable Switch */}
                  <td className="p-4">
                    <button
                      disabled={!canEdit}
                      onClick={() => handleToggleEvent(cfg.trigger)}
                      className="transition-colors"
                    >
                      {cfg.enabled ? (
                        <ToggleRight className="w-7 h-7 text-emerald-600" />
                      ) : (
                        <ToggleLeft className="w-7 h-7 text-slate-300" />
                      )}
                    </button>
                  </td>

                  {/* Title & Trigger */}
                  <td className="p-4">
                    <span className="font-bold text-slate-800 block">{cfg.title}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{cfg.trigger}</span>
                  </td>

                  {/* Category */}
                  <td className="p-4">
                    <span className="px-2.5 py-1 bg-slate-100 text-slate-600 font-bold rounded-lg text-[11px]">
                      {cfg.category}
                    </span>
                  </td>

                  {/* Priority Selector */}
                  <td className="p-4">
                    <select
                      disabled={!canEdit || !cfg.enabled}
                      value={cfg.priority}
                      onChange={(e) =>
                        handleUpdateItem(cfg.trigger, 'priority', e.target.value as SmsPriority)
                      }
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                    >
                      <option value="critical">اضطراری (Critical)</option>
                      <option value="high">بالا (High)</option>
                      <option value="normal">عادی (Normal)</option>
                      <option value="low">کم (Low)</option>
                    </select>
                  </td>

                  {/* Template Selector */}
                  <td className="p-4">
                    <select
                      disabled={!canEdit || !cfg.enabled}
                      value={cfg.templateId}
                      onChange={(e) =>
                        handleUpdateItem(cfg.trigger, 'templateId', e.target.value)
                      }
                      className="w-full max-w-xs px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500 disabled:opacity-50 truncate"
                    >
                      {templates.map((tpl) => (
                        <option key={tpl.id} value={tpl.id}>
                          {tpl.title} ({tpl.id})
                        </option>
                      ))}
                    </select>
                  </td>

                  {/* Bypass Quiet Hours Checkbox */}
                  <td className="p-4">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!canEdit || !cfg.enabled}
                        checked={cfg.bypassQuietHours}
                        onChange={(e) =>
                          handleUpdateItem(cfg.trigger, 'bypassQuietHours', e.target.checked)
                        }
                        className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 disabled:opacity-50"
                      />
                      <span className="text-slate-600 text-[11px]">ارسال فوری در شب</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
