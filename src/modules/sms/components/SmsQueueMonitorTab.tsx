/**
 * SMS Queue Monitor Tab
 * Real-time monitoring of SMS queue items with filter by status/priority, detail view, retry/cancel actions,
 * and test message enqueueing capabilities.
 */

import React, { useState } from 'react';
import {
  Clock,
  Search,
  RefreshCw,
  Play,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Send,
  Eye,
  Plus,
  RotateCcw,
  Trash2,
  X,
  Filter,
  Shield,
  MessageSquare,
} from 'lucide-react';
import { SmsMessage, SmsPriority, SmsStatus } from '../types';

interface SmsQueueMonitorTabProps {
  queue: SmsMessage[];
  onRetryMessage: (messageId: string) => void;
  onCancelMessage: (messageId: string) => void;
  onEnqueueTestMessage: (recipient: string, content: string, priority: SmsPriority) => void;
  onRunTickNow: () => void;
  onClearQueue?: () => void;
  userRole: 'SUPER_ADMIN' | 'ACCOUNTANT' | 'SALES_AGENT';
}

export const SmsQueueMonitorTab: React.FC<SmsQueueMonitorTabProps> = ({
  queue,
  onRetryMessage,
  onCancelMessage,
  onEnqueueTestMessage,
  onRunTickNow,
  onClearQueue,
  userRole,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  // Detail Modal State
  const [selectedMessage, setSelectedMessage] = useState<SmsMessage | null>(null);

  // New Test Message Modal
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testRecipient, setTestRecipient] = useState('09123456789');
  const [testContent, setTestContent] = useState('پیامک آزمایشی جهت سنجش کارکرد صف و سرویس‌دهنده.');
  const [testPriority, setTestPriority] = useState<SmsPriority>('normal');

  const canEdit = userRole === 'SUPER_ADMIN' || userRole === 'ACCOUNTANT';

  const filteredQueue = queue.filter((msg) => {
    const recipientStr = msg.recipient || msg.recipientPhone || '';
    const matchesSearch =
      recipientStr.includes(searchTerm) ||
      msg.content.includes(searchTerm) ||
      msg.id.includes(searchTerm);

    const matchesStatus = statusFilter === 'all' || msg.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || msg.priority === priorityFilter;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  const getStatusBadge = (status: SmsStatus) => {
    switch (status) {
      case 'sent':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 w-fit">
            <CheckCircle2 className="w-3 h-3" /> ارسال موفق (SENT)
          </span>
        );
      case 'pending':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1 w-fit">
            <Clock className="w-3 h-3" /> در انتظار (PENDING)
          </span>
        );
      case 'queued':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1 w-fit">
            <Clock className="w-3 h-3" /> آماده ارسال (QUEUED)
          </span>
        );
      case 'failed':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1 w-fit">
            <AlertTriangle className="w-3 h-3" /> ناموفق (FAILED)
          </span>
        );
      case 'canceled':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1 w-fit">
            <XCircle className="w-3 h-3" /> لغو شده (CANCELLED)
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1 w-fit">
            <Clock className="w-3 h-3" /> {status}
          </span>
        );
    }
  };

  const getPriorityBadge = (p: SmsPriority) => {
    switch (p) {
      case 'critical':
        return <span className="px-2 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-black rounded-md">اضطراری</span>;
      case 'high':
        return <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-md">بالا</span>;
      case 'normal':
        return <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-medium rounded-md">عادی</span>;
      case 'low':
        return <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-medium rounded-md">کم</span>;
    }
  };

  const handleSendTestMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testRecipient || !testContent) return;

    onEnqueueTestMessage(testRecipient, testContent, testPriority);
    setIsTestModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Clock className="w-5 h-5 text-emerald-600" />
            نمایشگر و مانیتورینگ صف ارسال پیامک (SMS Queue Monitor)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            مشاهده آنلاین پیامک‌های در انتظار، وضعیت‌های ارسال، مدیریت بازتلاش و لغو پیامک‌ها
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {userRole === 'SUPER_ADMIN' && (
            <button
              onClick={onRunTickNow}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs flex items-center gap-2 transition-all shadow-sm"
            >
              <Play className="w-4 h-4 fill-white" />
              اجرای فوری صف (Run Queue Tick)
            </button>
          )}

          {canEdit && (
            <button
              onClick={() => setIsTestModalOpen(true)}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs flex items-center gap-2 transition-all"
            >
              <Plus className="w-4 h-4 text-emerald-600" />
              ثبت پیامک آزمایشی در صف
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
            placeholder="جستجو با گیرنده، متن یا شناسه..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-3 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">همه وضعیت‌ها ({queue.length})</option>
            <option value="PENDING">در انتظار (PENDING)</option>
            <option value="QUEUED">آماده (QUEUED)</option>
            <option value="SENT">موفق (SENT)</option>
            <option value="FAILED">ناموفق (FAILED)</option>
            <option value="CANCELLED">لغو شده (CANCELLED)</option>
          </select>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">همه اولویت‌ها</option>
            <option value="critical">اضطراری (Critical)</option>
            <option value="high">بالا (High)</option>
            <option value="normal">عادی (Normal)</option>
            <option value="low">کم (Low)</option>
          </select>

          {userRole === 'SUPER_ADMIN' && onClearQueue && (
            <button
              onClick={onClearQueue}
              title="پاکسازی صف"
              className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors border border-rose-200"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Queue Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200/80">
              <tr>
                <th className="p-4">شناسه پیام</th>
                <th className="p-4">گیرنده</th>
                <th className="p-4">متن پیامک</th>
                <th className="p-4">اولویت</th>
                <th className="p-4">تعداد تلاش</th>
                <th className="p-4">وضعیت</th>
                <th className="p-4">زمان ثبت / ارسال</th>
                <th className="p-4 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {filteredQueue.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    هیچ پیامکی در صف با مشخصات درخواستی یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredQueue.map((msg) => (
                  <tr key={msg.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="p-4 font-mono text-[11px] text-slate-500">{msg.id}</td>
                    <td className="p-4 font-bold dir-ltr text-right">{msg.recipient || msg.recipientPhone}</td>
                    <td className="p-4 max-w-xs truncate text-slate-700" title={msg.content}>
                      {msg.content}
                    </td>
                    <td className="p-4">{getPriorityBadge(msg.priority)}</td>
                    <td className="p-4 font-mono text-slate-600">
                      {msg.retryCount} / {msg.maxRetries}
                    </td>
                    <td className="p-4">{getStatusBadge(msg.status)}</td>
                    <td className="p-4 text-[11px] text-slate-500 font-mono">
                      {new Date(msg.createdAt).toLocaleTimeString('fa-IR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setSelectedMessage(msg)}
                          title="مشاهده جزئیات کامل"
                          className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        {canEdit && (msg.status === 'FAILED' || msg.status === 'CANCELLED') && (
                          <button
                            onClick={() => onRetryMessage(msg.id)}
                            title="تلاش مجدد برای ارسال"
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}

                        {canEdit && (msg.status === 'PENDING' || msg.status === 'QUEUED') && (
                          <button
                            onClick={() => onCancelMessage(msg.id)}
                            title="لغو ارسال"
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Message Detail Modal */}
      {selectedMessage && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 space-y-5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-emerald-600" />
                شناسنامه و جزییات پیامک صف #{selectedMessage.id}
              </h3>
              <button
                onClick={() => setSelectedMessage(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                  <span className="text-slate-400 block mb-1">گیرنده:</span>
                  <span className="font-bold text-slate-800 font-mono text-sm">
                    {selectedMessage.recipient}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                  <span className="text-slate-400 block mb-1">وضعیت فعلی:</span>
                  <div>{getStatusBadge(selectedMessage.status)}</div>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60 space-y-1">
                <span className="text-slate-400 block">متن کامل پیامک:</span>
                <p className="font-mono text-slate-800 text-xs leading-relaxed dir-rtl text-right">
                  {selectedMessage.content}
                </p>
              </div>

              {selectedMessage.failureReason && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl">
                  <span className="font-bold block mb-1">علت خطا:</span>
                  <span>{selectedMessage.failureReason}</span>
                </div>
              )}

              <div className="p-3 bg-slate-900 text-slate-200 rounded-xl font-mono text-[11px] overflow-x-auto">
                <span className="text-slate-400 block mb-1">متاداده فنی (JSON Metadata):</span>
                <pre>{JSON.stringify(selectedMessage.metadata || {}, null, 2)}</pre>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
              <button
                onClick={() => setSelectedMessage(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enqueue Test Message Modal */}
      {isTestModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSendTestMessage}
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4 animate-in fade-in duration-200"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Send className="w-5 h-5 text-emerald-600" />
                درج پیامک آزمایشی در صف
              </h3>
              <button
                type="button"
                onClick={() => setIsTestModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">شماره گیرنده (موبایل)</label>
                <input
                  type="text"
                  required
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">اولویت پیامک</label>
                <select
                  value={testPriority}
                  onChange={(e) => setTestPriority(e.target.value as SmsPriority)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-emerald-500"
                >
                  <option value="critical">اضطراری (Critical)</option>
                  <option value="high">بالا (High)</option>
                  <option value="normal">عادی (Normal)</option>
                  <option value="low">کم (Low)</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">متن پیامک</label>
                <textarea
                  rows={3}
                  required
                  value={testContent}
                  onChange={(e) => setTestContent(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-mono text-xs focus:outline-none focus:border-emerald-500 dir-rtl text-right"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsTestModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs"
              >
                انصراف
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs"
              >
                ثبت پیامک در صف
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
