import React, { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isNetworkError: boolean;
}

export class SafeErrorBoundary extends React.Component<Props, State> {
  declare props: Props;
  state: State = {
    hasError: false,
    error: null,
    isNetworkError: false,
  };

  static getDerivedStateFromError(error: Error): State {
    const message = (error?.message || '').toLowerCase();
    const isNetwork =
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('supabase') ||
      message.includes('connection') ||
      message.includes('failed to fetch');

    return {
      hasError: true,
      error,
      isNetworkError: isNetwork,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn("SafeErrorBoundary intercepted error gracefully:", error, errorInfo);
  }

  handleRetry = () => {
    (this as any).setState({ hasError: false, error: null, isNetworkError: false });
  };

  render() {
    if (this.state.hasError) {
      const isNetwork = this.state.isNetworkError;

      return (
        <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-6 text-right font-sans" dir="rtl">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-zinc-200 text-center space-y-4">
            <div className={`w-16 h-16 ${isNetwork ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'} rounded-2xl flex items-center justify-center mx-auto text-2xl font-bold`}>
              {isNetwork ? '🌐' : '⚠️'}
            </div>
            <h2 className="text-lg font-black text-zinc-900">
              {isNetwork ? 'اختلال موقت در اتصال شبکه / پایگاه داده' : 'خطای غیرمنتظره در نمایش'}
            </h2>
            <p className="text-xs text-zinc-600 leading-relaxed">
              {isNetwork
                ? 'ارتباط با سرور یا پایگاه‌داده با کندی یا قطعی مواجه شد. جهت حفاظت از داده‌ها، سامانه در حالت امن قرار دارد. می‌توانید تلاش مجدد کنید یا به کار ادامه دهید.'
                : 'جهت جلوگیری از لغو عملیات، اطلاعات سامانه حفاظت گردید. با دکمه زیر می‌توانید بازیابی را انجام دهید.'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
              >
                تلاش مجدد
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex-1 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                بارگذاری مجدد
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (this.props as any).children;
  }
}

// Global safety catchers for network / unhandled promise rejections
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason?.message || String(event?.reason || '');
    if (
      reason.toLowerCase().includes('failed to fetch') ||
      reason.toLowerCase().includes('networkerror') ||
      reason.toLowerCase().includes('timeout') ||
      reason.toLowerCase().includes('supabase')
    ) {
      console.warn('Safe Network Guard prevented unhandled rejection crash:', reason);
      event.preventDefault(); // Prevent default crash behavior
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SafeErrorBoundary>
      <App />
    </SafeErrorBoundary>
  </React.StrictMode>,
);

