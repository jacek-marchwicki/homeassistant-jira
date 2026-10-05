import { Layers, Moon, Sun, Tv, Wifi, WifiOff } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';

export function Header() {
  const { boardName, sprintName, wsConnected, theme, setTheme } = useBoardStore();

  return (
    <header className="flex flex-wrap items-center justify-between px-4 py-3 border-b border-[var(--jira-border)] bg-[var(--jira-surface)]/80 backdrop-blur sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[var(--jira-primary)]/20 text-[var(--jira-primary)]">
          <Layers className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-[var(--jira-text-primary)]">
            {boardName}
          </h1>
          <p className="text-xs text-[var(--jira-text-secondary)]">{sprintName}</p>
        </div>
      </div>

      {/* Live WebSocket Status & Themes */}
      <div className="flex items-center gap-2 sm:gap-3 mt-2 sm:mt-0">
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            wsConnected
              ? 'text-[var(--jira-live-badge-text)] bg-[var(--jira-live-badge-bg)] border-[var(--jira-live-badge-border)]'
              : 'text-amber-500 bg-amber-500/10 border-amber-500/25'
          }`}
        >
          {wsConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 animate-pulse" />
              <span>Live WebSocket</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5" />
              <span>Reconnecting</span>
            </>
          )}
        </div>

        <div className="flex items-center p-1 rounded-lg border border-[var(--jira-border)] bg-[var(--jira-surface)]">
          <button
            onClick={() => setTheme('dark')}
            className={`p-1.5 rounded-md text-xs transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center cursor-pointer ${
              theme === 'dark'
                ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
                : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
            }`}
            title="Dark Mode"
            aria-label="Dark Mode"
          >
            <Moon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setTheme('light')}
            className={`p-1.5 rounded-md text-xs transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center cursor-pointer ${
              theme === 'light'
                ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
                : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
            }`}
            title="Light Mode"
            aria-label="Light Mode"
          >
            <Sun className="w-4 h-4" />
          </button>
          <button
            onClick={() => setTheme('kiosk')}
            className={`p-1.5 rounded-md text-xs transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center cursor-pointer ${
              theme === 'kiosk'
                ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
                : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
            }`}
            title="Kiosk / Wallboard Mode"
            aria-label="Kiosk Mode"
          >
            <Tv className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
