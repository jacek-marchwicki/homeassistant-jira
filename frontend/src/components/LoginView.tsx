import { useMemo } from 'react';
import { AlertCircle, Lock, Sparkles } from 'lucide-react';
import { getApiUrl } from '../utils/paths.ts';

export function LoginView() {
  const authError = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('auth_error');
    } catch {
      return null;
    }
  }, []);

  const handleSignIn = () => {
    const loginUrl = getApiUrl('/api/auth/google/login');
    window.location.href = loginUrl;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--jira-canvas)] text-[var(--jira-text-primary)] p-4 sm:p-6">
      <main
        className="w-full max-w-md p-6 sm:p-8 rounded-2xl bg-[var(--jira-surface)] border border-[var(--jira-border)] shadow-xl flex flex-col items-center text-center animate-fade-in"
        aria-label="Sign in"
      >
        {/* App Icon */}
        <div className="w-14 h-14 rounded-2xl bg-[var(--jira-primary)]/10 text-[var(--jira-primary)] border border-[var(--jira-primary)]/20 flex items-center justify-center mb-4 shadow-inner">
          <Lock className="w-7 h-7" />
        </div>

        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--jira-text-primary)]">
          Jira Dashboard
        </h1>
        <p className="text-xs sm:text-sm text-[var(--jira-text-secondary)] mt-1.5 max-w-xs">
          Sign in with your authorized Google Account to access family tasks and sprint boards.
        </p>

        {/* Auth Error Banner */}
        {authError && (
          <div
            role="alert"
            className="w-full mt-5 p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-400 text-xs flex items-start gap-2.5 text-left"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block">Authentication Failed</span>
              <span className="opacity-90">{authError}</span>
            </div>
          </div>
        )}

        {/* Sign in with Google Button */}
        <div className="w-full mt-6 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleSignIn}
            aria-label="Sign in with Google"
            className="w-full min-h-[48px] px-4 py-2.5 rounded-xl border border-[var(--jira-border)] bg-white text-gray-800 hover:bg-gray-50 active:bg-gray-100 dark:bg-[#1a1f2c] dark:text-gray-100 dark:hover:bg-[#222838] shadow-sm hover:shadow transition-all font-medium text-sm flex items-center justify-center gap-3 cursor-pointer"
          >
            {/* Google "G" Logo */}
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Sign in with Google</span>
          </button>
        </div>

        {/* Family Privacy & Cloud Run security notice */}
        <div className="mt-6 pt-5 border-t border-[var(--jira-border)] w-full text-center">
          <p className="text-[11px] text-[var(--jira-text-secondary)] flex items-center justify-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[var(--jira-primary)]" />
            <span>Secured with Google Cloud OAuth 2.0 and Secret Manager</span>
          </p>
        </div>
      </main>
    </div>
  );
}
