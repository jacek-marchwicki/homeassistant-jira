import { Download, LayoutGrid, Layers, ListTodo, Loader2, Moon, Plus, Sun, Tv, Wifi, WifiOff } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { splitIssuesByBacklog } from '../utils/boardUtils.ts';

export interface HeaderProps {
  canInstall?: boolean;
  onInstall?: () => void;
}

export function Header({ canInstall = false, onInstall }: HeaderProps) {
  const {
    boardName,
    sprintName,
    wsConnected,
    isSyncing,
    theme,
    setTheme,
    currentView,
    setCurrentView,
    issues,
    columns,
    setCreateModalOpen,
  } = useBoardStore();

  const { boardIssues, backlogIssues } = splitIssuesByBacklog(issues, columns);

  return (
    <header className="flex flex-nowrap items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 border-b border-[var(--jira-border)] bg-[var(--jira-surface)] sticky top-0 z-30 overflow-x-auto no-scrollbar">
      {/* Title & Board Metadata */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="p-1.5 sm:p-2 rounded-lg bg-[var(--jira-primary)]/20 text-[var(--jira-primary)] shrink-0">
          <Layers className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm sm:text-base md:text-lg font-bold tracking-tight text-[var(--jira-text-primary)] truncate max-w-[140px] xs:max-w-[180px] sm:max-w-none">
            {boardName}
          </h1>
          <p className="text-2xs sm:text-xs text-[var(--jira-text-secondary)] truncate max-w-[140px] xs:max-w-[180px] sm:max-w-none">{sprintName}</p>
        </div>
      </div>

      {/* View Switcher: Board vs Backlog (The same as in Jira) */}
      <div className="flex items-center p-0.5 sm:p-1 rounded-lg border border-[var(--jira-border)] bg-[var(--jira-canvas)] shrink-0">
        <button
          onClick={() => setCurrentView('board')}
          className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs transition-colors cursor-pointer min-h-[32px] sm:min-h-[36px] ${
            currentView === 'board'
              ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
              : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
          title="Kanban Board View"
          aria-label="Kanban Board View"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>Board</span>
          <span
            className={`ml-0.5 px-1.5 py-0.5 rounded-full text-2xs font-bold ${
              currentView === 'board'
                ? 'bg-black/20 text-white'
                : 'bg-[var(--jira-surface)] text-[var(--jira-text-secondary)]'
            }`}
          >
            {boardIssues.length}
          </span>
        </button>

        <button
          onClick={() => setCurrentView('backlog')}
          className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs transition-colors cursor-pointer min-h-[32px] sm:min-h-[36px] ${
            currentView === 'backlog'
              ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
              : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
          title="Backlog View (List of Issues)"
          aria-label="Backlog View"
        >
          <ListTodo className="w-3.5 h-3.5" />
          <span>Backlog</span>
          <span
            className={`ml-0.5 px-1.5 py-0.5 rounded-full text-2xs font-bold ${
              currentView === 'backlog'
                ? 'bg-black/20 text-white'
                : 'bg-[var(--jira-surface)] text-[var(--jira-text-secondary)]'
            }`}
          >
            {backlogIssues.length}
          </span>
        </button>
      </div>

      {/* Create Issue Button */}
      <button
        onClick={() => setCreateModalOpen(true)}
        className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-[var(--jira-primary)] text-white hover:bg-[var(--jira-primary-hover)] transition-colors text-xs font-semibold shadow-xs cursor-pointer min-h-[32px] sm:min-h-[36px] shrink-0"
        title="Create Issue"
        aria-label="Create Issue"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>Create</span>
      </button>

      {/* Live WebSocket Status & Themes */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {isSyncing && (
          <div
            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium text-[var(--jira-text-secondary)] bg-[var(--jira-canvas)] border border-[var(--jira-border)] shrink-0"
            title="Synchronizing latest issues from Jira..."
            aria-label="Syncing with Jira"
            data-testid="syncing-badge"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--jira-primary)]" />
            <span className="hidden md:inline text-2xs">Syncing</span>
          </div>
        )}

        <div
          className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium border shrink-0 ${
            wsConnected
              ? 'text-[var(--jira-live-badge-text)] bg-[var(--jira-live-badge-bg)] border-[var(--jira-live-badge-border)]'
              : 'text-amber-500 bg-amber-500/10 border-amber-500/25'
          }`}
        >
          {wsConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 animate-pulse shrink-0" />
              <span className="whitespace-nowrap">Live WebSocket</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span className="whitespace-nowrap">Reconnecting</span>
            </>
          )}
        </div>

        {/* PWA Install Button */}
        {canInstall && onInstall && (
          <button
            onClick={onInstall}
            className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border border-[var(--jira-primary)]/40 bg-[var(--jira-primary)]/10 text-[var(--jira-primary)] hover:bg-[var(--jira-primary)] hover:text-white transition-colors text-xs font-semibold cursor-pointer min-h-[32px] sm:min-h-[36px] shrink-0"
            title="Install Jira Dashboard"
            aria-label="Install App"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Install</span>
          </button>
        )}

        <div className="flex items-center p-0.5 sm:p-1 rounded-lg border border-[var(--jira-border)] bg-[var(--jira-surface)] shrink-0">
          <button
            onClick={() => setTheme('dark')}
            className={`p-1 sm:p-1.5 rounded-md text-xs transition-colors min-w-[28px] sm:min-w-[32px] min-h-[28px] sm:min-h-[32px] flex items-center justify-center cursor-pointer ${
              theme === 'dark'
                ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
                : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
            }`}
            title="Dark Mode"
            aria-label="Dark Mode"
          >
            <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          <button
            onClick={() => setTheme('light')}
            className={`p-1 sm:p-1.5 rounded-md text-xs transition-colors min-w-[28px] sm:min-w-[32px] min-h-[28px] sm:min-h-[32px] flex items-center justify-center cursor-pointer ${
              theme === 'light'
                ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
                : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
            }`}
            title="Light Mode"
            aria-label="Light Mode"
          >
            <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
          <button
            onClick={() => setTheme('kiosk')}
            className={`p-1 sm:p-1.5 rounded-md text-xs transition-colors min-w-[28px] sm:min-w-[32px] min-h-[28px] sm:min-h-[32px] flex items-center justify-center cursor-pointer ${
              theme === 'kiosk'
                ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
                : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
            }`}
            title="Kiosk / Wallboard Mode"
            aria-label="Kiosk Mode"
          >
            <Tv className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
