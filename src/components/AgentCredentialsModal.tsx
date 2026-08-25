import React, { useState } from 'react';
import { KeyRound, Copy, Check, ShieldAlert, User, X, Phone, Lock } from 'lucide-react';

export interface AgentCredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentName: string;
  loginIdentifier: string;
  generatedPassword?: string;
}

export const AgentCredentialsModal: React.FC<AgentCredentialsModalProps> = ({
  isOpen,
  onClose,
  agentName,
  loginIdentifier,
  generatedPassword,
}) => {
  const [copiedField, setCopiedField] = useState<'all' | 'password' | 'username' | null>(null);

  if (!isOpen || !generatedPassword) return null;

  const handleCopyText = (text: string, field: 'all' | 'password' | 'username') => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const fullCredentialSummary = `اطلاعات حساب کاربری نماینده:
نام: ${agentName}
نام کاربری (شماره موبایل): ${loginIdentifier}
رمز عبور اولیه: ${generatedPassword}

* این رمز فقط یک بار تولید شده است. لطفاً آن را در محلی امن نگهداری فرمایید.`;

  return (
    <div
      id="agent-credentials-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      dir="rtl"
    >
      <div
        id="agent-credentials-modal-content"
        className="bg-white rounded-2xl shadow-2xl border border-zinc-200 max-w-md w-full overflow-hidden text-right transform transition-all animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-snug">اطلاعات دسترسی نماینده</h3>
              <p className="text-xs text-emerald-100 mt-0.5">حساب کاربری جدید با موفقیت ایجاد شد</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            title="بستن"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Important Security Callout */}
          <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-3.5 flex items-start gap-3 text-amber-900">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed space-y-1">
              <span className="font-bold block">توجه بسیار مهم امنیتی:</span>
              <span>
                این رمز عبور موقت <strong>فقط همین یک‌بار</strong> نمایش داده می‌شود و به دلایل امنیتی در سرور ذخیره نشده است. لطفاً آن را فوراً کپی کرده و در اختیار نماینده قرار دهید.
              </span>
            </div>
          </div>

          {/* Details Card */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl divide-y divide-zinc-200/80 overflow-hidden">
            {/* Agent Name */}
            <div className="p-3.5 flex items-center justify-between text-xs">
              <span className="text-zinc-500 flex items-center gap-2">
                <User className="w-4 h-4 text-zinc-400" />
                نام نماینده:
              </span>
              <span className="font-bold text-zinc-800">{agentName || 'نماینده'}</span>
            </div>

            {/* Login Identifier (Mobile) */}
            <div className="p-3.5 flex items-center justify-between text-xs">
              <span className="text-zinc-500 flex items-center gap-2">
                <Phone className="w-4 h-4 text-zinc-400" />
                نام کاربری (موبایل):
              </span>
              <div className="flex items-center gap-2">
                <code className="font-mono text-[13px] font-bold text-zinc-800 tracking-wider bg-white px-2 py-0.5 rounded border border-zinc-200">
                  {loginIdentifier}
                </code>
                <button
                  onClick={() => handleCopyText(loginIdentifier, 'username')}
                  className="p-1 text-zinc-500 hover:text-zinc-800 transition-colors rounded hover:bg-zinc-200"
                  title="کپی شماره موبایل"
                >
                  {copiedField === 'username' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Generated Password */}
            <div className="p-3.5 flex items-center justify-between text-xs bg-emerald-50/50">
              <span className="text-zinc-600 flex items-center gap-2 font-medium">
                <Lock className="w-4 h-4 text-emerald-600" />
                رمز عبور اولیه:
              </span>
              <div className="flex items-center gap-2">
                <code className="font-mono text-sm font-bold text-emerald-700 bg-white px-2.5 py-1 rounded-lg border border-emerald-300 shadow-sm tracking-wider select-all">
                  {generatedPassword}
                </code>
                <button
                  onClick={() => handleCopyText(generatedPassword, 'password')}
                  className="p-1.5 text-emerald-700 hover:text-emerald-900 bg-emerald-100 hover:bg-emerald-200 transition-colors rounded-lg flex items-center gap-1 font-sans text-xs font-bold"
                  title="کپی رمز عبور"
                >
                  {copiedField === 'password' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      <span>کپی شد</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>کپی رمز</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2.5 pt-2">
            <button
              id="copy-all-agent-credentials-btn"
              onClick={() => handleCopyText(fullCredentialSummary, 'all')}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all"
            >
              {copiedField === 'all' ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>کل اطلاعات کپی شد</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>کپی یکجای اطلاعات ورود</span>
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 py-2.5 px-5 rounded-xl text-xs font-bold transition-colors"
            >
              متوجه شدم
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
