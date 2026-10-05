import { LayoutGrid, Layers, ListTodo, Moon, Sun, Tv, Wifi, WifiOff } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { splitIssuesByBacklog } from '../utils/boardUtils.ts';

export function Header() {
  const {
    boardName,
    sprintName,
    wsConnected,
    theme,
    setTheme,
    currentView,
    setCurrentView,
    issues,
    columns,
  } = useBoardStore();

  const { boardIssues, backlogIssues } = splitIssuesByBacklog(issues, columns);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--jira-border)] bg-[var(--jira-surface)]/80 backdrop-blur sticky top-0 z-20">
      {/* Title & Board Metadata */}
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

      {/* View Switcher: Board vs Backlog (The same as in Jira) */}
      <div className="flex items-center p-1 rounded-lg border border-[var(--jira-border)] bg-[var(--jira-canvas)]">
        <button
          onClick={() => setCurrentView('board')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer min-h-[36px] ${
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
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer min-h-[36px] ${
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

      {/* Live WebSocket Status & Themes */}
      <div className="flex items-center gap-2 sm:gap-3">
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
