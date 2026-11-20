import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
  User
} from 'lucide-react';
import { adminLogin } from '../services/adminApi';
import type { AdminAuthStatusPayload } from '../server/admin/adminTypes';
import { HachihiLogo } from '../components/HachihiLogo';

interface AdminLoginPageProps {
  authStatus: AdminAuthStatusPayload | null;
  onLoginSuccess: (username: string) => void;
  onBackToApp: () => void;
}

export const AdminLoginPage: React.FC<AdminLoginPageProps> = ({
  authStatus,
  onLoginSuccess,
  onBackToApp
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConfigured = authStatus?.configured !== false;
  const missingVars = authStatus?.missingVars || [];

  useEffect(() => {
    console.log('[AdminLoginPage] state', {
      authStatusNull: authStatus === null,
      isConfigured,
      authenticated: authStatus?.authenticated ?? false,
      missingVars,
      storageMode: authStatus?.storageMode ?? null,
      route:
        typeof window !== 'undefined'
          ? { pathname: window.location.pathname, hash: window.location.hash }
          : null
    });
  }, [authStatus, isConfigured, missingVars]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUser = username.trim();
    console.log('[AdminLoginPage] handleSubmit:triggered', {
      submitting,
      isConfigured,
      missingVars,
      payload: {
        username: cleanUser,
        hasPassword: Boolean(password),
        passwordLength: password.length
      }
    });

    if (submitting) {
      console.log('[AdminLoginPage] handleSubmit:ignored (already submitting)');
      return;
    }
    if (!isConfigured) {
      console.log('[AdminLoginPage] handleSubmit:blocked (MISSING_ENV_VARS)', {
        missingVars
      });
      return;
    }
    if (!cleanUser || !password) {
      console.log('[AdminLoginPage] handleSubmit:validation_failed (empty username or password)');
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await adminLogin(cleanUser, password);
      console.log('[AdminLoginPage] handleSubmit:login_success', {
        user: res.user
      });
      onLoginSuccess(res.user.username);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Đăng nhập không thành công.';
      console.log('[AdminLoginPage] handleSubmit:login_error', {
        error: msg
      });
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="h-14 px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-8 shrink-0">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <HachihiLogo size={22} />
          <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
            HACHIHI Admin
          </span>
        </div>

        <nav aria-label="Điều hướng nhanh" className="hidden sm:flex items-center gap-6 text-xs font-medium text-slate-600 dark:text-slate-300">
          <span className="text-slate-900 dark:text-white whitespace-nowrap shrink-0">Đăng nhập quản trị</span>
        </nav>

        <button
          type="button"
          onClick={onBackToApp}
          data-testid="admin-login-back-btn"
          className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          <span>Quay lại trình thiết kế</span>
        </button>
      </header>

      {/* Main Centered Login Card */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-medium text-[#155EEF] dark:text-blue-400">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Cổng quản trị thư viện mẫu</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Đăng nhập tài khoản Admin
            </h1>
    
          </div>

          {!isConfigured && (
            <div
              role="alert"
              data-testid="admin-unconfigured-alert"
              className="p-4 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs space-y-2"
            >

              <div className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Chưa thiết lập tài khoản Admin</span>
              </div>





            </div>





          )}

          {error && (
            <div
              role="alert"
              data-testid="admin-login-error"
              className="p-3 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="admin-username"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Tên đăng nhập
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-username"
                  data-testid="admin-username-input"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  disabled={!isConfigured || submitting}
                  placeholder="Nhập ADMIN_USERNAME"
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white outline-none focus:border-[#155EEF] focus:bg-white dark:focus:bg-slate-900 transition-colors disabled:opacity-60"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="admin-password"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Mật khẩu
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-password"
                  data-testid="admin-password-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={!isConfigured || submitting}
                  placeholder="Nhập ADMIN_PASSWORD"
                  className="w-full h-10 pl-9 pr-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white outline-none focus:border-[#155EEF] focus:bg-white dark:focus:bg-slate-900 transition-colors disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              data-testid="admin-login-submit-btn"
              disabled={!isConfigured || submitting}
              className="w-full h-10 px-4 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition-colors cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>Đang xác thực...</span>
                </>
              ) : (
                <span>Đăng nhập quản trị</span>
              )}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Phiên đăng nhập được xác thực phía máy chủ và lưu bằng cookie bảo mật <span className="font-mono">HttpOnly</span>, không lưu mật khẩu trên trình duyệt.
          </div>
        </div>
      </main>
    </div>
  );
};
