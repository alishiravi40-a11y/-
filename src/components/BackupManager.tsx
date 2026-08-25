import React, { useRef, useState, useEffect } from 'react';
import { 
  Download, 
  Upload, 
  AlertTriangle, 
  Trash2, 
  RefreshCw, 
  Server, 
  CheckCircle2, 
  ShieldCheck, 
  History, 
  Database, 
  FileText,
  Lock,
  ArrowRight,
  Info
} from 'lucide-react';
import { AppState } from '../types';
import { saveAppState, resetAppState, resetTransactionsOnly, DEFAULT_SUBSIDIARIES, loadAppState } from '../utils/accounting';
import { restoreFromEmergencyBackup } from '../services/centralSyncService';
import { getSupabaseConfig, setSupabaseConfig } from '../lib/supabaseClient';
import { getDefaultAuthSessionService } from '../services/authSessionService';

interface BackupManagerProps {
  appState: AppState;
  onRestore: (state: AppState) => void;
}

export interface BackupMetadata {
  createdAt: string;
  backupVersion: string;
  appVersion: string;
  systemName: string;
  lastModifiedAt: string;
  recordCounts: Record<string, number>;
}

export interface BackupPackage {
  metadata: BackupMetadata;
  data: AppState;
}

const SAFETY_SNAPSHOT_KEY = 'accounting_safety_backup_pre_restore';

function sanitizeObjectForBackup<T>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    return data.map(item => sanitizeObjectForBackup(item)) as unknown as T;
  }
  const sanitized: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('service_role')
    ) {
      continue;
    }
    sanitized[key] = sanitizeObjectForBackup((data as any)[key]);
  }
  return sanitized as T;
}

export default function BackupManager({ appState, onRestore }: BackupManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isFullResetting, setIsFullResetting] = useState(false);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showFullResetConfirm, setShowFullResetConfirm] = useState(false);

  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Restore validation state
  const [pendingRestoreData, setPendingRestoreData] = useState<{
    state: AppState;
    metadata?: BackupMetadata;
    filename: string;
  } | null>(null);

  const [safetySnapshotInfo, setSafetySnapshotInfo] = useState<{
    timestamp: string;
    recordCount: number;
  } | null>(null);

  // Supabase Configuration State
  const initialSupabaseConf = getSupabaseConfig();
  const [supabaseUrlInput, setSupabaseUrlInput] = useState(initialSupabaseConf.url);
  const [supabaseKeyInput, setSupabaseKeyInput] = useState(initialSupabaseConf.key);
  const [supabaseSavedMessage, setSupabaseSavedMessage] = useState('');

  useEffect(() => {
    checkSafetySnapshot();
  }, []);

  const checkSafetySnapshot = () => {
    try {
      const raw = localStorage.getItem(SAFETY_SNAPSHOT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.data) {
          const state: AppState = parsed.data;
          const totalRecords = 
            (state.persons?.length || 0) + 
            (state.products?.length || 0) + 
            (state.invoices?.length || 0) + 
            (state.vouchers?.length || 0) + 
            (state.checks?.length || 0);
          setSafetySnapshotInfo({
            timestamp: parsed.timestamp || parsed.createdAt || 'نامشخص',
            recordCount: totalRecords
          });
        }
      } else {
        setSafetySnapshotInfo(null);
      }
    } catch (e) {
      console.error("Error reading safety snapshot", e);
    }
  };

  const calculateRecordCounts = (state: AppState) => {
    return {
      persons: state.persons?.length || 0,
      products: state.products?.length || 0,
      invoices: state.invoices?.length || 0,
      vouchers: state.vouchers?.length || 0,
      checks: state.checks?.length || 0,
      installments: state.installments?.length || 0,
      installmentBooks: state.installmentBooks?.length || 0,
      creditFiles: state.creditFiles?.length || 0,
      businessPartners: state.businessPartners?.length || 0,
      users: state.users?.length || 0,
      warehouses: state.warehouses?.length || 0,
      openingBalances: state.openingBalances?.length || 0,
      settings: state.settings ? 1 : 0
    };
  };

  const handleResetTestEnvironment = async () => {
    setIsResetting(true);
    setPasswordError('');
    try {
      const token = (await getDefaultAuthSessionService().getAccessToken()) || '';
      const response = await fetch('/api/backup/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ adminPassword: adminPasswordInput })
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'خطا در مجوز دسترسی سرور');
      }

      createAutoSafetySnapshot('BEFORE_TRANSACTION_RESET');
      const newState = resetTransactionsOnly(appState);
      saveAppState(newState);
      
      setIsResetting(false);
      setShowResetConfirm(false);
      checkSafetySnapshot();
      alert('✅ بازنشانی با موفقیت از طریق سرور انجام شد.');
      onRestore(newState);
    } catch (err: any) {
      setIsResetting(false);
      setPasswordError(`❌ ${err.message || 'خطای احراز هویت یا دسترسی غیرمجاز'}`);
    }
  };

  const handleReset = async () => {
    setIsFullResetting(true);
    setPasswordError('');
    try {
      const token = (await getDefaultAuthSessionService().getAccessToken()) || '';
      const response = await fetch('/api/backup/replace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          adminPassword: adminPasswordInput,
          state: {
            users: [],
            persons: [],
            products: [],
            productCategories: [],
            subsidiaries: DEFAULT_SUBSIDIARIES,
            vouchers: [],
            checks: [],
            invoices: [],
            bankTerminals: [],
            openingBalances: [],
            installmentBooks: [],
            installments: [],
            installmentRequests: [],
            installmentPlans: [],
            warehouses: [],
            warehouseTransfers: [],
            costCenters: [],
            auditLogs: [],
            creditFiles: [],
            creditPolicies: [],
            calculators: [],
            settings: {
              inventoryValuationMethod: 'WEIGHTED_AVERAGE',
              defaultWarehouseId: 'DEFAULT',
              companyName: 'سیستم حسابداری هوشمند'
            }
          }
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'خطا در مجوز دسترسی سرور');
      }

      createAutoSafetySnapshot('BEFORE_FULL_RESET');
      resetAppState();
      const cleanState: AppState = {
        users: [],
        persons: [],
        products: [],
        productCategories: [],
        subsidiaries: DEFAULT_SUBSIDIARIES,
        vouchers: [],
        checks: [],
        invoices: [],
        bankTerminals: [],
        openingBalances: [],
        installmentBooks: [],
        installments: [],
        installmentRequests: [],
        installmentPlans: [],
        warehouses: [],
        warehouseTransfers: [],
        costCenters: [],
        auditLogs: [],
        creditFiles: [],
        creditPolicies: [],
        calculators: [],
        settings: {
          inventoryValuationMethod: 'WEIGHTED_AVERAGE',
          defaultWarehouseId: 'DEFAULT',
          companyName: 'سیستم حسابداری هوشمند'
        }
      };
      
      setIsFullResetting(false);
      setShowFullResetConfirm(false);
      checkSafetySnapshot();
      alert('✅ پاکسازی کامل سیستم با تأیید سرور انجام شد.');
      onRestore(cleanState);
    } catch (err: any) {
      setIsFullResetting(false);
      setPasswordError(`❌ ${err.message || 'خطای دسترسی سرور'}`);
    }
  };

  const handleExportBackup = () => {
    try {
      const now = new Date().toISOString();
      const counts = calculateRecordCounts(appState);
      
      const metadata: BackupMetadata = {
        createdAt: now,
        backupVersion: "1.0.0",
        appVersion: "1.0.0",
        systemName: "سیستم حسابداری و مدیریت اعتبارات",
        lastModifiedAt: now,
        recordCounts: counts
      };

      const backupPkg: BackupPackage = {
        metadata,
        data: sanitizeObjectForBackup(appState)
      };

      const dataStr = JSON.stringify(backupPkg, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
      
      const exportFileDefaultName = `accounting_backup_${now.slice(0, 10)}_${now.slice(11, 16).replace(':', '-')}.json`;
      
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
    } catch (e) {
      alert("خطا در ایجاد فایل پشتیبان.");
    }
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        
        let stateToRestore: AppState | null = null;
        let metadata: BackupMetadata | undefined = undefined;

        // Check format: Envelope with metadata or raw AppState
        if (parsed && parsed.data && typeof parsed.data === 'object') {
          stateToRestore = parsed.data as AppState;
          if (parsed.metadata) {
            metadata = parsed.metadata as BackupMetadata;
          }
        } else if (parsed && typeof parsed === 'object') {
          stateToRestore = parsed as AppState;
        }

        // Validate structure
        if (stateToRestore && (Array.isArray(stateToRestore.persons) || Array.isArray(stateToRestore.products) || Array.isArray(stateToRestore.vouchers))) {
          // Normalize defaults
          if (!stateToRestore.openingBalances) stateToRestore.openingBalances = [];
          if (!stateToRestore.warehouses) stateToRestore.warehouses = [];
          if (!stateToRestore.warehouseTransfers) stateToRestore.warehouseTransfers = [];
          if (!stateToRestore.costCenters) stateToRestore.costCenters = [];
          if (!stateToRestore.auditLogs) stateToRestore.auditLogs = [];
          if (!stateToRestore.persons) stateToRestore.persons = [];
          if (!stateToRestore.products) stateToRestore.products = [];
          if (!stateToRestore.invoices) stateToRestore.invoices = [];
          if (!stateToRestore.vouchers) stateToRestore.vouchers = [];
          if (!stateToRestore.checks) stateToRestore.checks = [];
          if (!stateToRestore.creditFiles) stateToRestore.creditFiles = [];
          if (!stateToRestore.businessPartners) stateToRestore.businessPartners = [];
          if (!stateToRestore.users) stateToRestore.users = [];
          if (!stateToRestore.settings) {
            stateToRestore.settings = {
              inventoryValuationMethod: 'WEIGHTED_AVERAGE',
              defaultWarehouseId: 'DEFAULT',
              companyName: 'سیستم حسابداری هوشمند'
            };
          }

          setPendingRestoreData({
            state: stateToRestore,
            metadata,
            filename: file.name
          });
        } else {
          throw new Error('ساختار فایل پشتیبان نامعتبر است.');
        }
      } catch (err: any) {
        alert(`خطا در اعتبارسنجی فایل پشتیبان: ${err.message || 'فایل نامعتبر است'}`);
        console.error(err);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const createAutoSafetySnapshot = (reason: string) => {
    try {
      const snapshot = {
        timestamp: new Date().toISOString(),
        reason,
        data: appState
      };
      localStorage.setItem(SAFETY_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch (e) {
      console.error("Could not save safety snapshot", e);
    }
  };

  const executeRestore = () => {
    if (!pendingRestoreData) return;

    try {
      // 1. Create auto safety snapshot of current appState before overwriting
      createAutoSafetySnapshot('BEFORE_RESTORE_IMPORT');

      // 2. Save and restore new state
      saveAppState(pendingRestoreData.state);
      onRestore(pendingRestoreData.state);
      
      setPendingRestoreData(null);
      checkSafetySnapshot();
      
      alert('✅ بازگردانی اطلاعات با موفقیت انجام شد.\nنسخه پشتیبان خودکار (Safety Snapshot) از اطلاعات قبلی ذخیره گردید.');
    } catch (e) {
      alert('خطا در اجرای بازگردانی اطلاعات.');
      console.error(e);
    }
  };

  const handleRestoreSafetySnapshot = () => {
    try {
      const raw = localStorage.getItem(SAFETY_SNAPSHOT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data) {
        if (window.confirm(`آیا می‌خواهید نقطه بازیابی اضطراری مربوط به تاریخ ${new Date(parsed.timestamp).toLocaleString('fa-IR')} را بازگردانی کنید؟`)) {
          saveAppState(parsed.data);
          onRestore(parsed.data);
          alert('✅ اطلاعات از نقطه بازیابی اضطراری با موفقیت بازگردانی شد.');
        }
      }
    } catch (e) {
      alert('خطا در بازگردانی نسخه ایمنی.');
    }
  };

  const currentCounts = calculateRecordCounts(appState);

  return (
    <div className="p-4 space-y-6">
      {/* Confirmation Modal for Pending Restore */}
      {pendingRestoreData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl text-right animate-in fade-in zoom-in duration-200">
            <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <ShieldCheck size={36} />
            </div>
            <h3 className="text-xl font-bold text-zinc-800 mb-2 text-center">تایید اعتبارسنجی و بازگردانی پشتیبان</h3>
            <p className="text-zinc-500 text-xs text-center mb-6">
              فایل <span className="font-mono text-indigo-600 font-bold">{pendingRestoreData.filename}</span> بررسی و تایید شد.
            </p>

            <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 mb-6 space-y-3">
              <div className="flex justify-between items-center text-xs text-zinc-600 border-b border-zinc-200 pb-2">
                <span className="font-semibold text-zinc-800">تاریخ ساخت فایل:</span>
                <span>
                  {pendingRestoreData.metadata?.createdAt 
                    ? new Date(pendingRestoreData.metadata.createdAt).toLocaleString('fa-IR') 
                    : 'فرمت استاندارد قبلی'}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs text-zinc-600 border-b border-zinc-200 pb-2">
                <span className="font-semibold text-zinc-800">نسخه بکاپ / برنامه:</span>
                <span>{pendingRestoreData.metadata?.backupVersion || '1.0.0'}</span>
              </div>

              <div className="pt-1">
                <p className="text-xs font-bold text-zinc-700 mb-2">خلاصه آماری داده‌های داخل فایل:</p>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-600">
                  <div className="bg-white p-2 rounded-lg border border-zinc-150">👤 اشخاص: <b>{pendingRestoreData.state.persons?.length || 0}</b></div>
                  <div className="bg-white p-2 rounded-lg border border-zinc-150">📦 کالاها: <b>{pendingRestoreData.state.products?.length || 0}</b></div>
                  <div className="bg-white p-2 rounded-lg border border-zinc-150">📄 فاکتورها: <b>{pendingRestoreData.state.invoices?.length || 0}</b></div>
                  <div className="bg-white p-2 rounded-lg border border-zinc-150">📑 اسناد مالی: <b>{pendingRestoreData.state.vouchers?.length || 0}</b></div>
                  <div className="bg-white p-2 rounded-lg border border-zinc-150">💳 چک‌ها: <b>{pendingRestoreData.state.checks?.length || 0}</b></div>
                  <div className="bg-white p-2 rounded-lg border border-zinc-150">📂 پرونده‌های اعتباری: <b>{pendingRestoreData.state.creditFiles?.length || 0}</b></div>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl mb-6 flex items-start space-x-2 space-x-reverse">
              <ShieldCheck size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-800 leading-relaxed font-semibold">
                محافظت ایمنی پیشگیرانه: قبل از اعمال این بازیابی، یک نقطه بازیابی اضطراری (Safety Snapshot) از اطلاعات فعلی به صورت خودکار در مرورگر شما ذخیره خواهد شد.
              </p>
            </div>

            <div className="flex flex-row-reverse gap-3">
              <button
                onClick={executeRestore}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl font-bold transition text-sm flex items-center justify-center space-x-2 space-x-reverse"
              >
                <CheckCircle2 size={18} />
                <span>تایید و بازگردانی اطلاعات</span>
              </button>
              <button
                onClick={() => setPendingRestoreData(null)}
                className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 py-3 rounded-2xl font-bold transition text-sm"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modals for Reset */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-right animate-in fade-in zoom-in duration-200">
            <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <RefreshCw size={32} />
            </div>
            <h3 className="text-xl font-bold text-zinc-800 mb-2">بازنشانی محیط آزمایش</h3>
            <p className="text-zinc-500 text-sm leading-relaxed mb-6">
              آیا از حذف تمام اسناد، فاکتورها و چک‌های آزمایشی اطمینان دارید؟ 
              <br />
              <span className="font-bold text-amber-600">لیست اشخاص و کالاها حذف نخواهد شد اما موجودی آن‌ها صفر می‌شود.</span>
            </p>

            {/* Password input */}
            <div className="mb-6">
              <label className="block text-xs font-bold text-zinc-700 mb-2">جهت تأیید، رمز عبور مدیریت را وارد کنید:</label>
              <div className="relative">
                <input
                  type="password"
                  id="reset-password-input"
                  value={adminPasswordInput}
                  onChange={(e) => {
                    setAdminPasswordInput(e.target.value);
                    setPasswordError('');
                  }}
                  placeholder="رمز عبور مدیریت"
                  className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm text-right outline-none focus:border-amber-500 transition font-mono"
                />
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
              </div>
              {passwordError && (
                <p className="text-xs text-rose-600 font-bold mt-2 bg-rose-50 border border-rose-100 p-2 rounded-xl text-center">
                  {passwordError}
                </p>
              )}
            </div>

            <div className="flex flex-row-reverse gap-3">
              <button
                onClick={handleResetTestEnvironment}
                disabled={isResetting || !adminPasswordInput}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-2xl font-bold transition disabled:opacity-50"
              >
                {isResetting ? 'در حال بازنشانی...' : 'بله، بازنشانی شود'}
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 py-3 rounded-2xl font-bold transition"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {showFullResetConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl text-right animate-in fade-in zoom-in duration-200">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-xl font-bold text-red-900 mb-2">پاکسازی کل سیستم</h3>
            <p className="text-red-700 text-sm leading-relaxed mb-6">
              هشدار بسیار مهم: آیا مطمئن هستید که می‌خواهید <span className="font-bold underline">تمام اطلاعات سیستم</span> را حذف کنید؟ این عملیات غیرقابل بازگشت است و برنامه به حالت خام برمی‌گردد.
            </p>

            {/* Password input */}
            <div className="mb-6">
              <label className="block text-xs font-bold text-zinc-700 mb-2">جهت تأیید نهایی، رمز عبور مدیریت را وارد کنید:</label>
              <div className="relative">
                <input
                  type="password"
                  id="full-reset-password-input"
                  value={adminPasswordInput}
                  onChange={(e) => {
                    setAdminPasswordInput(e.target.value);
                    setPasswordError('');
                  }}
                  placeholder="رمز عبور مدیریت"
                  className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm text-right outline-none focus:border-red-500 transition font-mono"
                />
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
              </div>
              {passwordError && (
                <p className="text-xs text-rose-600 font-bold mt-2 bg-rose-50 border border-rose-100 p-2 rounded-xl text-center">
                  {passwordError}
                </p>
              )}
            </div>

            <div className="flex flex-row-reverse gap-3">
              <button
                onClick={handleReset}
                disabled={isFullResetting || !adminPasswordInput}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-3 rounded-2xl font-bold transition disabled:opacity-50"
              >
                {isFullResetting ? 'در حال پاکسازی...' : 'تایید و پاکسازی کامل'}
              </button>
              <button
                onClick={() => setShowFullResetConfirm(false)}
                className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 py-3 rounded-2xl font-bold transition"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="bg-white p-6 rounded-2xl border border-zinc-150 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3 space-x-reverse">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
              <Server size={20} />
            </div>
            <div>
              <h2 className="font-sans text-lg font-bold text-zinc-800">مدیریت نسخه‌های پشتیبان و ایمنی داده‌ها (Disaster Recovery v1)</h2>
              <p className="text-zinc-500 text-xs mt-1">تهیه فایل پشتیبان جامع شناسنامه‌دار، اعتبارسنجی خودکار و بازیابی ایمن</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 space-x-reverse bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-xl text-xs font-semibold">
            <ShieldCheck size={16} />
            <span>سیستم محافظت فعال</span>
          </div>
        </div>

        {/* System Summary Stats */}
        <div className="mb-6 bg-zinc-50 border border-zinc-200 rounded-2xl p-4">
          <div className="flex items-center space-x-2 space-x-reverse mb-3">
            <Database size={16} className="text-indigo-600" />
            <h3 className="text-xs font-bold text-zinc-800 font-sans">شناسنامه آماری موجودیت‌های ثبت‌شده فعلی</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            <div className="bg-white p-2.5 rounded-xl border border-zinc-150 text-center">
              <span className="block text-zinc-400 text-[10px]">اشخاص / مشتریان</span>
              <span className="text-sm font-bold text-zinc-800">{currentCounts.persons}</span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-zinc-150 text-center">
              <span className="block text-zinc-400 text-[10px]">کالاها / انبار</span>
              <span className="text-sm font-bold text-zinc-800">{currentCounts.products}</span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-zinc-150 text-center">
              <span className="block text-zinc-400 text-[10px]">فاکتورها</span>
              <span className="text-sm font-bold text-zinc-800">{currentCounts.invoices}</span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-zinc-150 text-center">
              <span className="block text-zinc-400 text-[10px]">اسناد حسابداری</span>
              <span className="text-sm font-bold text-zinc-800">{currentCounts.vouchers}</span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-zinc-150 text-center">
              <span className="block text-zinc-400 text-[10px]">چک‌ها</span>
              <span className="text-sm font-bold text-zinc-800">{currentCounts.checks}</span>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-zinc-150 text-center">
              <span className="block text-zinc-400 text-[10px]">پرونده‌های اعتباری</span>
              <span className="text-sm font-bold text-zinc-800">{currentCounts.creditFiles}</span>
            </div>
          </div>
        </div>

        {/* Supabase Emergency Local Backup Restore Card */}
        <div className="mb-6 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl p-4 text-right flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3 space-x-reverse">
            <div className="w-9 h-9 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3 className="text-xs font-bold text-emerald-900 font-sans">پشتیبان اضطراری محلی پیش از مهاجرت (Pre-Migration Emergency Snapshot)</h3>
              <p className="text-[11px] text-emerald-700 mt-0.5 leading-relaxed">
                پیش از اتصال به Supabase مرکزی، یک نسخه کامل از حافظه محلی در مرورگر شما ذخیره شده است. در صورت نیاز به بازگشت اضطراری به وضعیت قبلی می‌توانید از این دکمه استفاده کنید.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (window.confirm('آیا مطمئن هستید که می‌خواهید اطلاعات پشتیبان محلی قبل از مهاجرت را بازیابی کنید؟')) {
                const success = restoreFromEmergencyBackup();
                if (success) {
                  alert('بازیابی نسخه پشتیبان محلی با موفقیت انجام شد.');
                  onRestore(loadAppState());
                } else {
                  alert('نسخه پشتیبان اضطراری محلی یافت نشد.');
                }
              }
            }}
            className="shrink-0 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-xs font-bold transition shadow-sm"
          >
            بازیابی اضطراری پشتیبان محلی
          </button>
        </div>

        {/* Supabase Dynamic Connection Settings Card */}
        <div className="mb-6 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-right text-zinc-100 shadow-sm">
          <div className="flex items-center space-x-3 space-x-reverse mb-3">
            <div className="w-9 h-9 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-xl flex items-center justify-center shrink-0">
              <Database size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold font-sans text-emerald-400">اتصال آنلاین پایگاه داده Supabase مرکزی</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                سیستم به‌صورت خودکار با **سرور مرکزی آنلاین** همگام‌سازی می‌شود. جهت اتصال مستقیم به پروژه Supabase اختصاصی، مشخصات زیر را وارد کنید:
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 my-4">
            <div>
              <label className="block text-[11px] font-bold text-zinc-300 mb-1">آدرس پروژه (Supabase URL):</label>
              <input
                type="text"
                placeholder="https://your-project.supabase.co"
                value={supabaseUrlInput}
                onChange={(e) => setSupabaseUrlInput(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-emerald-500 dir-ltr text-left"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-zinc-300 mb-1">کلید عمومی (Anon Key):</label>
              <input
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                value={supabaseKeyInput}
                onChange={(e) => setSupabaseKeyInput(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-100 font-mono focus:outline-none focus:border-emerald-500 dir-ltr text-left"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div>
              {supabaseSavedMessage && (
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 size={16} /> {supabaseSavedMessage}
                </span>
              )}
            </div>
            <button
              onClick={async () => {
                setSupabaseConfig(supabaseUrlInput.trim(), supabaseKeyInput.trim());
                try {
                  await fetch('/api/supabase-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: supabaseUrlInput.trim(), key: supabaseKeyInput.trim() })
                  });
                } catch (e) {}
                setSupabaseSavedMessage('تنظیمات Supabase با موفقیت بروزرسانی شد.');
                setTimeout(() => setSupabaseSavedMessage(''), 4000);
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-xl text-xs font-bold transition shadow-sm"
            >
              ذخیره و فعال‌سازی Supabase
            </button>
          </div>
        </div>

        {/* Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-zinc-50 border border-zinc-150 rounded-2xl p-5 text-right flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 space-x-reverse mb-3">
                <Download size={18} className="text-indigo-600" />
                <h3 className="font-bold text-zinc-800 font-sans">دریافت نسخه پشتیبان کامل (با متاداده)</h3>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed mb-6">
                یک فایل ساختاریافته (JSON) شامل تمامی موجودیت‌ها (اشخاص، کالاها، فاکتورها، اسناد مالی، چک‌ها، اقساط، نمایندگان و تنظیمات) به همراه تاریخ، شماره نسخه و خلاصه آماری دانلود می‌شود.
              </p>
            </div>
            
            <button
              onClick={handleExportBackup}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl flex items-center justify-center space-x-2 space-x-reverse font-sans text-sm font-semibold transition shadow-md shadow-indigo-100"
            >
              <Download size={16} />
              <span>دانلود فایل پشتیبان شناسنامه‌دار</span>
            </button>
          </div>

          <div className="bg-orange-50 border border-orange-100 rounded-2xl p-5 text-right flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 space-x-reverse mb-3">
                <Upload size={18} className="text-orange-600" />
                <h3 className="font-bold text-orange-800 font-sans">بازگردانی با اعتبارسنجی ایمن</h3>
              </div>
              <div className="bg-orange-100/50 p-3 rounded-xl mb-4">
                <div className="flex items-start space-x-2 space-x-reverse">
                  <AlertTriangle size={16} className="text-orange-600 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-orange-800 font-bold leading-relaxed">
                    پیش از بازگردانی، فایل بررسی شده و پیش‌نمایش متاداده نمایش داده می‌شود. همچنین یک نسخه ایمنی اضطراری (Safety Snapshot) از داده‌های فعال فعلی به صورت خودکار ذخیره می‌شود.
                  </p>
                </div>
              </div>
            </div>
            
            <div>
              <input
                type="file"
                accept=".json"
                ref={fileInputRef}
                onChange={handleImportBackup}
                className="hidden"
                id="backup-upload"
              />
              <label
                htmlFor="backup-upload"
                className="w-full bg-orange-600 hover:bg-orange-700 cursor-pointer text-white py-2.5 rounded-xl flex items-center justify-center space-x-2 space-x-reverse font-sans text-sm font-semibold transition shadow-md shadow-orange-100"
              >
                <Upload size={16} />
                <span>انتخاب فایل و اعتبارسنجی</span>
              </label>
            </div>
          </div>
        </div>

        {/* Safety Snapshot Status Card */}
        {safetySnapshotInfo && (
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="w-9 h-9 bg-blue-100 text-blue-700 rounded-xl flex items-center justify-center shrink-0">
                <History size={18} />
              </div>
              <div className="text-right">
                <h4 className="text-xs font-bold text-blue-900 font-sans">نقطه بازیابی اضطراری موجود (Safety Snapshot)</h4>
                <p className="text-[11px] text-blue-700 mt-0.5">
                  آخرین عکس‌برداری خودکار: {new Date(safetySnapshotInfo.timestamp).toLocaleString('fa-IR')} | تعداد رکوردها: {safetySnapshotInfo.recordCount}
                </p>
              </div>
            </div>
            <button
              onClick={handleRestoreSafetySnapshot}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition flex items-center space-x-1.5 space-x-reverse whitespace-nowrap"
            >
              <RefreshCw size={14} />
              <span>بازگردانی این نقطه ایمنی</span>
            </button>
          </div>
        )}

        {/* Resets Section */}
        <div className="mt-8 pt-6 border-t border-zinc-150">
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex flex-col md:flex-row items-center justify-between gap-4 mb-4">
            <div className="flex items-start space-x-3 space-x-reverse">
              <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
                <RefreshCw size={20} />
              </div>
              <div className="text-right">
                <h3 className="font-bold text-amber-900 font-sans text-sm">بازنشانی محیط آزمایش</h3>
                <p className="text-[11px] text-amber-700 leading-relaxed mt-1">
                  حذف تمامی فاکتورها و اسناد مالی. لیست کالاها و اشخاص حفظ می‌شود اما موجودی آن‌ها صفر خواهد شد. (همراه با عکس‌برداری ایمنی خودکار)
                </p>
              </div>
            </div>
            
            <button
              onClick={() => {
                setAdminPasswordInput('');
                setPasswordError('');
                setShowResetConfirm(true);
              }}
              disabled={isResetting}
              className={`whitespace-nowrap ${isResetting ? 'bg-amber-400' : 'bg-amber-600 hover:bg-amber-700'} text-white px-6 py-2.5 rounded-xl flex items-center justify-center space-x-2 space-x-reverse font-sans text-sm font-bold transition shadow-lg shadow-amber-200`}
            >
              <RefreshCw size={16} className={isResetting ? 'animate-spin' : ''} />
              <span>{isResetting ? 'در حال بازنشانی...' : 'بازنشانی تراکنش‌ها'}</span>
            </button>
          </div>

          <div className="bg-red-50 border border-red-100 rounded-2xl p-5 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-start space-x-3 space-x-reverse">
              <div className="w-10 h-10 bg-red-100 text-red-600 rounded-xl flex items-center justify-center shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div className="text-right">
                <h3 className="font-bold text-red-900 font-sans text-sm">پاکسازی کل سیستم (بازگشت به حالت خام)</h3>
                <p className="text-[11px] text-red-700 leading-relaxed mt-1">
                  این گزینه تمامی اطلاعات ثبت شده شامل فاکتورها، اسناد حسابداری، موجودی کالاها و لیست اشخاص را حذف می‌کند. (همراه با عکس‌برداری ایمنی خودکار)
                </p>
              </div>
            </div>
            
            <button
              onClick={() => {
                setAdminPasswordInput('');
                setPasswordError('');
                setShowFullResetConfirm(true);
              }}
              disabled={isFullResetting}
              className={`whitespace-nowrap ${isFullResetting ? 'bg-red-400' : 'bg-red-600 hover:bg-red-700'} text-white px-6 py-2.5 rounded-xl flex items-center justify-center space-x-2 space-x-reverse font-sans text-sm font-bold transition shadow-lg shadow-red-200`}
            >
              <Trash2 size={16} className={isFullResetting ? 'animate-pulse' : ''} />
              <span>{isFullResetting ? 'در حال پاکسازی...' : 'بازنشانی کل اطلاعات'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

