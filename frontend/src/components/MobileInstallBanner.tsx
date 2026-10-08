import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface MobileInstallBannerProps {
  canInstall: boolean;
  onInstall: () => void;
}

const STORAGE_KEY = 'jira_pwa_banner_dismissed';

export function MobileInstallBanner({
  canInstall,
  onInstall,
}: MobileInstallBannerProps) {
  const [isDismissed, setIsDismissed] = useState<boolean>(true);

  useEffect(() => {
    try {
      const dismissed =
        localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
      if (!dismissed) {
        setIsDismissed(false);
      }
    } catch {
      setIsDismissed(false);
    }
  }, []);

  if (!canInstall || isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, '1');
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // ignore storage error
    }
  };

  return (
    <div
      role="banner"
      aria-label="Install Jira Dashboard"
      className="md:hidden flex items-center justify-between gap-3 px-4 py-2.5 bg-gradient-to-r from-blue-900/40 via-[var(--jira-surface)] to-[var(--jira-surface)] border-b border-blue-500/30 text-[var(--jira-text-primary)]"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="p-2 rounded-lg bg-[var(--jira-primary)]/20 text-[var(--jira-primary)] shrink-0">
          <Download className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate">Install Jira Dashboard</p>
          <p className="text-2xs text-[var(--jira-text-secondary)] truncate">
            Add to home screen for full-screen touch control
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onInstall}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--jira-primary)] hover:bg-[var(--jira-primary-hover)] text-white text-xs font-semibold cursor-pointer min-h-[44px] transition-colors shadow-xs"
          aria-label="Install App"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install</span>
        </button>

        <button
          onClick={handleDismiss}
          className="p-2 rounded-lg text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-canvas)] min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
          aria-label="Dismiss install banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
