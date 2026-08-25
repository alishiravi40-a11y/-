import React from 'react';
import { AuditLog } from '../types';
import { History, User, Clock, Tag, FileText } from 'lucide-react';

interface AuditLogViewerProps {
  logs: AuditLog[];
}

export function AuditLogViewer({ logs }: AuditLogViewerProps) {
  const sortedLogs = [...logs].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'bg-green-100 text-green-700 border-green-200';
      case 'UPDATE': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'DELETE': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case 'INVOICE': return <FileText size={14} />;
      case 'VOUCHER': return <History size={14} />;
      case 'PRODUCT': return <Tag size={14} />;
      default: return <FileText size={14} />;
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm space-y-6" dir="rtl">
      <div className="flex justify-between items-center border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <History size={20} />
          </div>
          <h2 className="text-xl font-bold text-gray-800">لاگ امنیتی سیستم (Audit Trail)</h2>
        </div>
        <div className="text-xs text-gray-400">تاریخچه تمامی تغییرات دیتابیس</div>
      </div>

      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
        {sortedLogs.map((log) => (
          <div key={log.id} className="p-4 border rounded-xl hover:shadow-md transition-shadow bg-white group">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 rounded-md text-[10px] font-black border uppercase tracking-tighter ${getActionColor(log.action)}`}>
                  {log.action}
                </span>
                <div className="flex items-center gap-2 text-gray-500 bg-gray-50 px-2 py-1 rounded-lg text-xs border border-gray-100">
                  {getEntityIcon(log.entityType)}
                  <span className="font-bold">{log.entityType}</span>
                </div>
                <h4 className="font-bold text-gray-800 text-sm">{log.details}</h4>
              </div>
              
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <div className="flex items-center gap-1">
                  <User size={12} />
                  <span>{log.userName}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock size={12} />
                  <span dir="ltr">{new Date(log.timestamp).toLocaleString('fa-IR')}</span>
                </div>
              </div>
            </div>

            {(log.previousValue || log.newValue) && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-[10px] font-mono p-3 bg-gray-50 rounded-lg border border-gray-100 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="overflow-hidden">
                  <div className="text-gray-400 mb-1 uppercase tracking-widest font-sans">Previous State:</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-red-800">
                    {JSON.stringify(log.previousValue, null, 2)}
                  </pre>
                </div>
                <div className="overflow-hidden">
                  <div className="text-gray-400 mb-1 uppercase tracking-widest font-sans">New State:</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all text-green-800">
                    {JSON.stringify(log.newValue, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ))}

        {logs.length === 0 && (
          <div className="p-12 text-center text-gray-400 italic">
            هنوز هیچ لاگی ثبت نشده است.
          </div>
        )}
      </div>
    </div>
  );
}
