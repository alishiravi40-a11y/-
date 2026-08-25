import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Phone, AlertCircle, Loader2 } from 'lucide-react';
import { AuthServerCheckResult } from '../../services/authSessionService';

export interface AuthSessionServiceLike {
  signInWithMobile: (mobile: string, password: string) => Promise<{ userId: string }>;
  verifySessionWithServer: () => Promise<AuthServerCheckResult>;
  signOut: () => Promise<void>;
}

export interface ExecuteSecureLoginParams {
  mobile: string;
  password: string;
  authSessionService: AuthSessionServiceLike;
  onAuthenticated: (userId: string) => void;
}

export type ExecuteSecureLoginResult =
  | { success: true; userId: string }
  | { success: false; errorMessage: string };

/**
 * Executes everyday login workflow and verifies session with server endpoint.
 */
export async function executeSecureLogin(
  params: ExecuteSecureLoginParams
): Promise<ExecuteSecureLoginResult> {
  const { mobile, password, authSessionService, onAuthenticated } = params;

  // 1. Client-side input validation
  const trimmedMobile = mobile ? mobile.trim() : '';
  if (!trimmedMobile) {
    return { success: false, errorMessage: 'اطلاعات ورود صحیح نیست.' };
  }

  if (!password || typeof password !== 'string' || password.trim() === '') {
    return { success: false, errorMessage: 'اطلاعات ورود صحیح نیست.' };
  }

  // 2. signInWithMobile
  let loginResult: { userId: string };
  try {
    loginResult = await authSessionService.signInWithMobile(mobile, password);
    if (!loginResult || !loginResult.userId) {
      return { success: false, errorMessage: 'اطلاعات ورود صحیح نیست.' };
    }
  } catch {
    return { success: false, errorMessage: 'اطلاعات ورود صحیح نیست.' };
  }

  // 3. Verify session with server
  let serverCheck: AuthServerCheckResult;
  try {
    serverCheck = await authSessionService.verifySessionWithServer();
  } catch {
    serverCheck = { status: 'service_unavailable' };
  }

  // 4. Validate verification response
  if (serverCheck.status === 'authenticated' && serverCheck.userId === loginResult.userId) {
    onAuthenticated(serverCheck.userId);
    return { success: true, userId: serverCheck.userId };
  }

  // In any non-successful state after session creation, perform safe signOut
  try {
    await authSessionService.signOut();
  } catch {
    // Silently handle sign-out errors to prevent leaking details
  }

  if (serverCheck.status === 'service_unavailable') {
    return { success: false, errorMessage: 'خدمت ورود موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.' };
  }

  return { success: false, errorMessage: 'ورود شما تأیید نشد. دوباره تلاش کنید.' };
}

export interface SecureLoginPanelProps {
  authSessionService: AuthSessionServiceLike;
  onAuthenticated: (userId: string) => void;
}

export const SecureLoginPanel: React.FC<SecureLoginPanelProps> = ({
  authSessionService,
  onAuthenticated,
}) => {
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent concurrent submits
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const result = await executeSecureLogin({
      mobile,
      password,
      authSessionService,
      onAuthenticated,
    });

    setIsLoading(false);

    if (result.success === false) {
      setPassword(''); // Clear password on failure
      setErrorMessage(result.errorMessage);
    }
  };

  return (
    <div
      className="w-full max-w-md mx-auto p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-800 text-right dir-rtl"
      dir="rtl"
    >
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          ورود به حساب کاربری
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          برای ورود روزانه، شماره همراه و رمز عبور خود را وارد کنید.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {errorMessage && (
          <div
            role="alert"
            aria-live="polite"
            className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 flex items-center gap-2 text-red-700 dark:text-red-300 text-sm"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label
            htmlFor="secure-login-mobile"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            شماره همراه
          </label>
          <div className="relative">
            <input
              id="secure-login-mobile"
              name="mobile"
              type="tel"
              inputMode="tel"
              dir="ltr"
              autoComplete="username"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              disabled={isLoading}
              placeholder="09123456789"
              className="w-full min-h-[44px] px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors text-left"
            />
            <Phone
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="secure-login-password"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            رمز عبور
          </label>
          <div className="relative">
            <input
              id="secure-login-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              dir="ltr"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              placeholder="••••••••"
              className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-colors text-left"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              disabled={isLoading}
              aria-label={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
              title={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-colors"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Eye className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full min-h-[44px] py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
              <span>در حال بررسی…</span>
            </>
          ) : (
            <span>ورود</span>
          )}
        </button>
      </form>
    </div>
  );
};
