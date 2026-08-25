import React from 'react';
import { RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';

interface TopSyncBannerProps {
  syncStatus: {
    connected: boolean;
    syncing: boolean;
    lastSyncTime: string | null;
  };
  financialSyncStatus?: 'idle' | 'loading' | 'ready' | 'error';
  financialSyncError?: string;
  onRetryFinancialSync?: () => void;
}

export const TopSyncBanner: React.FC<TopSyncBannerProps> = ({ 
  syncStatus, 
  financialSyncStatus = 'ready',
  financialSyncError,
  onRetryFinancialSync
}) => {
  return (
    <div className="flex flex-col shrink-0">
      <div className="bg-zinc-900 text-zinc-100 text-[11px] font-sans px-4 py-1.5 flex items-center justify-between border-b border-zinc-800 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-bold text-emerald-400">دیتابیس مرکزی آنلاین (PostgreSQL / Supabase)</span>
          <span className="text-zinc-400 hidden sm:inline">| همگام‌سازی بلادرنگ حسابداری</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-400">
          {syncStatus.lastSyncTime && (
            <span>آخرین همگام‌سازی: <strong className="text-zinc-200 font-mono">{syncStatus.lastSyncTime}</strong></span>
          )}
          {financialSyncStatus === 'loading' ? (
            <span className="bg-amber-950/80 text-amber-300 border border-amber-700/60 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin" />
              در حال دریافت دفاتر مالی...
            </span>
          ) : financialSyncStatus === 'error' ? (
            <span className="bg-rose-950/80 text-rose-300 border border-rose-700/60 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
              <AlertTriangle size={10} />
              خطای دریافت اطلاعات مالی
            </span>
          ) : (
            <span className="bg-emerald-950 text-emerald-300 border border-emerald-800/60 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
              <ShieldCheck size={10} />
              دفاتر مالی فعال و امن
            </span>
          )}
        </div>
      </div>

      {financialSyncStatus === 'error' && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 flex items-center justify-between text-rose-800 text-xs font-sans">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-rose-600 shrink-0" />
            <span>{financialSyncError || 'اطلاعات مالی از سرور دریافت نشد. برای حفظ امنیت، داده‌های ذخیره شده محلی نمایش داده نمی‌شوند.'}</span>
          </div>
          {onRetryFinancialSync && (
            <button
              onClick={onRetryFinancialSync}
              className="bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold px-3 py-1 rounded-xl transition cursor-pointer flex items-center gap-1 shrink-0"
            >
              <RefreshCw size={12} />
              تلاش مجدد
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default TopSyncBanner;

