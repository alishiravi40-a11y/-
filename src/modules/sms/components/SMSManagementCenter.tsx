/**
 * SMS Management Center Component
 * Isolated administrative UI dashboard for managing SMS configurations, message templates,
 * event matrix triggers, queue monitoring, and audit logging without modifying core financial logic.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  MessageSquare,
  Settings,
  FileText,
  Sliders,
  Clock,
  Shield,
  UserCheck,
  Activity,
  AlertCircle,
  Database,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

import {
  SmsLogEntry,
  SmsMessage,
  SmsMetrics,
  SmsPriority,
  SmsSettings,
  SmsTemplate,
} from '../types';
import { SmsSettingsManager } from '../smsSettings';
import { SmsTemplateEngine, DEFAULT_SMS_TEMPLATES } from '../templateEngine';
import { SmsQueueEngine } from '../queueEngine';
import { MockSmsProvider } from '../providers/mockProvider';
import { SmsSchedulerEngine } from '../schedulerEngine';
import { SmsLogger } from '../smsLogger';
import { SmsRecoveryService } from '../recoveryService';
import { SmsEventDispatcherClass, EventDispatcherStats } from '../eventDispatcher';
import { SmsMockEventSource } from '../mockEventSource';
import { SmsEventBus } from '../eventBus';

import { SmsDashboardTab } from './SmsDashboardTab';
import { SmsGeneralSettingsTab } from './SmsGeneralSettingsTab';
import { SmsTemplatesTab } from './SmsTemplatesTab';
import { SmsEventsConfigTab } from './SmsEventsConfigTab';
import { SmsQueueMonitorTab } from './SmsQueueMonitorTab';
import { SmsAuditLogsTab } from './SmsAuditLogsTab';

export type SmsCenterTab = 'dashboard' | 'settings' | 'templates' | 'events' | 'queue' | 'audit_logs';

export type UserRole = 'SUPER_ADMIN' | 'ACCOUNTANT' | 'SALES_AGENT';

export const SMSManagementCenter: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SmsCenterTab>('dashboard');
  const [userRole, setUserRole] = useState<UserRole>('SUPER_ADMIN');

  // Engine Instances Initialization
  const mockProviderRef = useRef(new MockSmsProvider());
  const settingsManagerRef = useRef(new SmsSettingsManager());
  const templateEngineRef = useRef(new SmsTemplateEngine());
  const queueEngineRef = useRef(new SmsQueueEngine(mockProviderRef.current, settingsManagerRef.current));
  const schedulerRef = useRef(new SmsSchedulerEngine(queueEngineRef.current, 10000));
  const loggerRef = useRef(new SmsLogger());
  
  // Event Dispatcher and Mock Event Source Instances
  const eventDispatcherRef = useRef(
    new SmsEventDispatcherClass(
      SmsEventBus,
      queueEngineRef.current,
      templateEngineRef.current,
      settingsManagerRef.current
    )
  );
  const mockEventSourceRef = useRef(new SmsMockEventSource(SmsEventBus));

  // React State for UI Renders
  const [settings, setSettings] = useState<SmsSettings>(() => settingsManagerRef.current.getSettings());
  const [templates, setTemplates] = useState<SmsTemplate[]>(() => {
    try {
      const saved = localStorage.getItem('smsTemplates');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((t: any) => ({
          ...t,
          title: t.title || t.name || 'قالب پیامک',
          content: t.content || t.bodyTemplate || '',
        }));
      }
    } catch {}
    return DEFAULT_SMS_TEMPLATES.map((t) => ({
      ...t,
      title: t.name || 'قالب پیامک',
      content: t.bodyTemplate || '',
    }));
  });

  const [queue, setQueue] = useState<SmsMessage[]>(() => {
    try {
      const messages = SmsRecoveryService.loadSnapshot();
      return Array.isArray(messages) ? messages : [];
    } catch {
      return [];
    }
  });

  const [logs, setLogs] = useState<SmsLogEntry[]>(() => loggerRef.current.getLogs());

  const [schedulerStatus, setSchedulerStatus] = useState(() => schedulerRef.current.getStatus());

  const [dispatcherStats, setDispatcherStats] = useState<EventDispatcherStats>(() =>
    eventDispatcherRef.current.getStats()
  );

  // Initialize and Bind Engines
  useEffect(() => {
    // Bind engines to Event Dispatcher and register subscribers
    eventDispatcherRef.current.setQueueEngine(queueEngineRef.current);
    eventDispatcherRef.current.setTemplateEngine(templateEngineRef.current);
    eventDispatcherRef.current.setSettingsManager(settingsManagerRef.current);
    eventDispatcherRef.current.registerListeners();

    // Restore queue in queue engine
    if (queue.length > 0) {
      queue.forEach((msg) => queueEngineRef.current.enqueueRawMessage(msg));
    } else {
      // Seed mock demo messages if empty
      const demoMessages: SmsMessage[] = [
        {
          id: 'sms_demo_101',
          recipientPhone: '09121111111',
          recipient: '09121111111',
          content: 'مشتری گرامی علی رضایی، فاکتور خرید نقدی INV-1001 به مبلغ ۵۰,۰۰۰,۰۰۰ ریال ثبت شد.',
          trigger: 'cash_sale',
          priority: 'normal',
          status: 'sent',
          retryCount: 0,
          maxRetries: 3,
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          updatedAt: new Date(Date.now() - 3600000).toISOString(),
          sentAt: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: 'sms_demo_102',
          recipientPhone: '09122222222',
          recipient: '09122222222',
          content: 'یادآوری: قسط شماره ۲ فاکتور INV-1002 در تاریخ ۱۴۰۵/۰۲/۱۵ سررسید می‌شود.',
          trigger: 'installment_due',
          priority: 'high',
          status: 'pending',
          retryCount: 0,
          maxRetries: 3,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      demoMessages.forEach((msg) => queueEngineRef.current.enqueueRawMessage(msg));
      setQueue(demoMessages);
    }

    // Start Scheduler worker
    schedulerRef.current.start();
    setSchedulerStatus(schedulerRef.current.getStatus());

    // Setup periodic state refresh interval
    const refreshInterval = setInterval(() => {
      const currentQueue = queueEngineRef.current.getAllMessages();
      setQueue([...currentQueue]);
      setLogs(loggerRef.current.getLogs());
      setSchedulerStatus(schedulerRef.current.getStatus());
      setDispatcherStats(eventDispatcherRef.current.getStats());

      // Save snapshot
      SmsRecoveryService.saveSnapshot(currentQueue);
    }, 1000);

    return () => {
      clearInterval(refreshInterval);
      schedulerRef.current.stop();
      eventDispatcherRef.current.unregisterListeners();
    };
  }, []);

  // Handle Event Simulation for UI Testing
  const handleSimulateEvent = (
    eventType: 'invoice' | 'installment' | 'check' | 'customer' | 'otp'
  ) => {
    switch (eventType) {
      case 'invoice':
        mockEventSourceRef.current.simulateInvoiceCreated();
        break;
      case 'installment':
        mockEventSourceRef.current.simulateInstallmentDueReminder();
        break;
      case 'check':
        mockEventSourceRef.current.simulateCheckBounced();
        break;
      case 'customer':
        mockEventSourceRef.current.simulateCustomerRegistered();
        break;
      case 'otp':
        mockEventSourceRef.current.simulateOtpRequested();
        break;
    }

    setQueue(queueEngineRef.current.getAllMessages());
    setLogs(loggerRef.current.getLogs());
    setDispatcherStats(eventDispatcherRef.current.getStats());
  };

  // Update Settings Handler
  const handleUpdateSettings = (newSettings: Partial<SmsSettings>) => {
    const updated = settingsManagerRef.current.updateSettings(newSettings);
    setSettings({ ...updated });
    loggerRef.current.info('SETTINGS_UPDATE', `تنظیمات عمومی پیامک توسط کاربر (${userRole}) بروزرسانی گردید.`);
  };

  // Save / Edit Template Handler
  const handleSaveTemplate = (template: SmsTemplate) => {
    const existingIndex = templates.findIndex((t) => t.id === template.id);
    let updatedList: SmsTemplate[] = [];

    if (existingIndex >= 0) {
      updatedList = [...templates];
      updatedList[existingIndex] = template;
    } else {
      updatedList = [template, ...templates];
    }

    setTemplates(updatedList);
    try {
      localStorage.setItem('smsTemplates', JSON.stringify(updatedList));
    } catch {}

    loggerRef.current.info(
      'TEMPLATE_SAVE',
      `قالب پیامک با عنوان "${template.title || template.name}" (${template.id}) ذخیره شد.`
    );
  };

  // Delete Template Handler
  const handleDeleteTemplate = (templateId: string) => {
    const updatedList = templates.filter((t) => t.id !== templateId);
    setTemplates(updatedList);
    try {
      localStorage.setItem('smsTemplates', JSON.stringify(updatedList));
    } catch {}

    loggerRef.current.info('TEMPLATE_DELETE', `قالب پیامک با شناسه ${templateId} حذف شد.`);
  };

  // Manual Enqueue Test Message
  const handleEnqueueTestMessage = (
    recipient: string,
    content: string,
    priority: SmsPriority
  ) => {
    const newMsg: SmsMessage = {
      id: `sms_manual_${Date.now()}`,
      recipientPhone: recipient,
      recipient,
      content,
      trigger: 'manual_custom',
      priority,
      status: 'pending',
      retryCount: 0,
      maxRetries: settings.defaultMaxRetries,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    queueEngineRef.current.enqueueRawMessage(newMsg);
    setQueue(queueEngineRef.current.getAllMessages());
    loggerRef.current.info('QUEUE_ENQUEUE', `پیامک دستی جهت ${recipient} به صف ارسال افزوده شد.`);
  };

  // Manual Retry Message
  const handleRetryMessage = (messageId: string) => {
    queueEngineRef.current.retryMessage(messageId);
    setQueue(queueEngineRef.current.getAllMessages());
    loggerRef.current.info('QUEUE_RETRY', `درخواست تلاش مجدد برای پیامک ${messageId} ثبت شد.`);
  };

  // Cancel Message
  const handleCancelMessage = (messageId: string) => {
    queueEngineRef.current.cancelMessage(messageId);
    setQueue(queueEngineRef.current.getAllMessages());
    loggerRef.current.info('QUEUE_CANCEL', `پیامک شناسه ${messageId} لغو گردید.`);
  };

  // Manual Run Queue Tick Now
  const handleRunTickNow = async () => {
    await queueEngineRef.current.processQueue();
    setQueue(queueEngineRef.current.getAllMessages());
    setLogs(loggerRef.current.getLogs());
    loggerRef.current.info('QUEUE_TICK_MANUAL', 'پردازش دستی صف ارسال اجرا گردید.');
  };

  // Clear Queue
  const handleClearQueue = () => {
    queueEngineRef.current.clearQueue();
    setQueue([]);
    SmsRecoveryService.clearSnapshot();
    loggerRef.current.info('QUEUE_CLEAR', 'صف پیامک به صورت کامل پاکسازی گردید.');
  };

  // Clear Logs
  const handleClearLogs = () => {
    loggerRef.current.clearLogs();
    setLogs([]);
  };

  // Toggle Scheduler Pause/Resume
  const handleToggleScheduler = () => {
    if (schedulerStatus.isPaused) {
      schedulerRef.current.resume();
    } else {
      schedulerRef.current.pause();
    }
    setSchedulerStatus(schedulerRef.current.getStatus());
  };

  // Calculate Dashboard Metrics
  const metrics: SmsMetrics = useMemo(() => {
    const total = queue.length;
    const sent = queue.filter((m) => m.status === 'SENT').length;
    const pending = queue.filter((m) => m.status === 'PENDING' || m.status === 'QUEUED').length;
    const failed = queue.filter((m) => m.status === 'FAILED').length;
    const cancelled = queue.filter((m) => m.status === 'CANCELLED').length;

    return {
      total,
      sent,
      pending,
      failed,
      cancelled,
      activeProvider: settings.activeProviderId,
      mockMode: settings.mockMode,
    };
  }, [queue, settings]);

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 sm:p-6 lg:p-8 font-sans text-slate-800 dir-rtl">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Management Header & RBAC Role Switcher Bar */}
        <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white flex items-center justify-center shadow-md shadow-emerald-500/20">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900 tracking-tight">
                  مرکز مدیریت پیامک (SMS Management Center)
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  ماژول ایزوله v1.0
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                مدیریت تنظیمات ارسال، قالب‌های پویا، ماتریس رویدادها، صف زمانبندی و ممیزی پیامک‌های سازمانی
              </p>
            </div>
          </div>

          {/* RBAC Role Switcher Controls */}
          <div className="flex items-center gap-2 bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/60 self-stretch md:self-auto justify-between">
            <span className="text-xs font-bold text-slate-600 px-2 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-emerald-600" />
              شبیه‌ساز نقش دسترسی (RBAC):
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setUserRole('SUPER_ADMIN')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  userRole === 'SUPER_ADMIN'
                    ? 'bg-white text-emerald-700 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                مدیر ارشد (Super Admin)
              </button>

              <button
                onClick={() => setUserRole('ACCOUNTANT')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  userRole === 'ACCOUNTANT'
                    ? 'bg-white text-blue-700 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                حسابدار (Accountant)
              </button>

              <button
                onClick={() => setUserRole('SALES_AGENT')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  userRole === 'SALES_AGENT'
                    ? 'bg-white text-amber-700 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                نماینده فروش (Sales Agent)
              </button>
            </div>
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="bg-white p-2 rounded-2xl border border-slate-200/80 shadow-sm flex flex-wrap items-center gap-1">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'dashboard'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Activity className="w-4 h-4" />
            داشبورد پیامک
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'settings'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Settings className="w-4 h-4" />
            تنظیمات عمومی پیامک
          </button>

          <button
            onClick={() => setActiveTab('templates')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'templates'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <FileText className="w-4 h-4" />
            مدیریت قالب‌ها ({templates.length})
          </button>

          <button
            onClick={() => setActiveTab('events')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'events'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Sliders className="w-4 h-4" />
            پیکربندی رویدادها
          </button>

          <button
            onClick={() => setActiveTab('queue')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'queue'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Clock className="w-4 h-4" />
            مشاهده صف ارسال ({queue.length})
          </button>

          <button
            onClick={() => setActiveTab('audit_logs')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
              activeTab === 'audit_logs'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Database className="w-4 h-4" />
            گزارش ممیزی ({logs.length})
          </button>
        </div>

        {/* Tab Content Display */}
        {activeTab === 'dashboard' && (
          <SmsDashboardTab
            metrics={metrics}
            settings={settings}
            schedulerStatus={schedulerStatus}
            onToggleScheduler={handleToggleScheduler}
            onRunTickNow={handleRunTickNow}
            onNavigateToTab={(tab) => setActiveTab(tab as SmsCenterTab)}
            userRole={userRole}
          />
        )}

        {activeTab === 'settings' && (
          <SmsGeneralSettingsTab
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            userRole={userRole}
          />
        )}

        {activeTab === 'templates' && (
          <SmsTemplatesTab
            templates={templates}
            onSaveTemplate={handleSaveTemplate}
            onDeleteTemplate={handleDeleteTemplate}
            userRole={userRole}
          />
        )}

        {activeTab === 'events' && (
          <SmsEventsConfigTab
            templates={templates}
            userRole={userRole}
            dispatcherStats={dispatcherStats}
            onSimulateEvent={handleSimulateEvent}
          />
        )}

        {activeTab === 'queue' && (
          <SmsQueueMonitorTab
            queue={queue}
            onRetryMessage={handleRetryMessage}
            onCancelMessage={handleCancelMessage}
            onEnqueueTestMessage={handleEnqueueTestMessage}
            onRunTickNow={handleRunTickNow}
            onClearQueue={handleClearQueue}
            userRole={userRole}
          />
        )}

        {activeTab === 'audit_logs' && (
          <SmsAuditLogsTab
            logs={logs}
            onClearLogs={handleClearLogs}
            userRole={userRole}
          />
        )}
      </div>
    </div>
  );
};

export default SMSManagementCenter;
