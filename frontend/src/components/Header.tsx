import { useState, useRef, useEffect } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  LayoutGrid,
  Layers,
  ListTodo,
  Loader2,
  Moon,
  Plus,
  Sun,
  Tv,
  Wifi,
  WifiOff,
} from 'lucide-react';
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

  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [themeMenuPos, setThemeMenuPos] = useState<{ top: number; left: number } | null>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);

  const toggleThemeMenu = () => {
    if (!isThemeMenuOpen && themeMenuRef.current) {
      const rect = themeMenuRef.current.getBoundingClientRect();
      setThemeMenuPos({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 180)),
      });
    }
    setIsThemeMenuOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!isThemeMenuOpen) return;
    const updatePos = () => {
      if (themeMenuRef.current) {
        const rect = themeMenuRef.current.getBoundingClientRect();
        setThemeMenuPos({
          top: rect.bottom + 6,
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 180)),
        });
      }
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isThemeMenuOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setIsThemeMenuOpen(false);
      }
    };
    if (isThemeMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isThemeMenuOpen]);

  const { boardIssues, backlogIssues } = splitIssuesByBacklog(issues, columns);

  return (
    <header className="flex flex-nowrap items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 border-b border-[var(--jira-border)] bg-[var(--jira-surface)] sticky top-0 z-30">
      {/* Left scrollable navigation, status & metadata */}
      <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto no-scrollbar min-w-0 py-0.5">
        {/* Title & Board Metadata - Board name hidden on mobile in favor of sprint */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <div className="p-1.5 sm:p-2 rounded-lg bg-[var(--jira-primary)]/20 text-[var(--jira-primary)] shrink-0">
            <Layers className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="hidden sm:block text-sm sm:text-base md:text-lg font-bold tracking-tight text-[var(--jira-text-primary)] truncate max-w-[140px] xs:max-w-[180px] sm:max-w-none">
              {boardName}
            </h1>
            <p className="text-xs font-semibold sm:font-normal text-[var(--jira-text-primary)] sm:text-[var(--jira-text-secondary)] truncate max-w-[140px] xs:max-w-[180px] sm:max-w-none">
              {sprintName}
            </p>
          </div>
        </div>

        {/* View Switcher: Board vs Backlog - Text hidden on mobile in favor of icons */}
        <div className="flex items-center p-0.5 sm:p-1 rounded-lg border border-[var(--jira-border)] bg-[var(--jira-canvas)] shrink-0">
          <button
            onClick={() => setCurrentView('board')}
            className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs transition-colors cursor-pointer min-h-[32px] sm:min-h-[36px] ${
              currentView === 'board'
                ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
                : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
            }`}
            title="Kanban Board View"
            aria-label="Kanban Board View"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Board</span>
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
            className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-xs transition-colors cursor-pointer min-h-[32px] sm:min-h-[36px] ${
              currentView === 'backlog'
                ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
                : 'text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
            }`}
            title="Backlog View (List of Issues)"
            aria-label="Backlog View"
          >
            <ListTodo className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Backlog</span>
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

        {/* Live WebSocket Status - Text skipped on mobile when live */}
        <div className="flex items-center shrink-0">
          {isSyncing && (
            <div
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium text-[var(--jira-text-secondary)] bg-[var(--jira-canvas)] border border-[var(--jira-border)] shrink-0 mr-1.5"
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
            title={wsConnected ? 'Live WebSocket connection active' : 'Reconnecting to WebSocket...'}
            aria-label={wsConnected ? 'Live WebSocket' : 'Reconnecting'}
          >
            {wsConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5 animate-pulse shrink-0" />
                <span className="hidden sm:inline whitespace-nowrap">Live WebSocket</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">Reconnecting</span>
              </>
            )}
          </div>
        </div>

        {/* Dark/Light/Kiosk Theme Switcher: Dropdown on Mobile */}
        <div className="sm:hidden relative shrink-0" ref={themeMenuRef}>
          <button
            type="button"
            onClick={toggleThemeMenu}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--jira-border)] bg-[var(--jira-surface)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] min-h-[32px] cursor-pointer"
            title="Theme Selection"
            aria-label="Theme Selection"
            aria-expanded={isThemeMenuOpen}
          >
            {theme === 'dark' && <Moon className="w-3.5 h-3.5" />}
            {theme === 'light' && <Sun className="w-3.5 h-3.5" />}
            {theme === 'kiosk' && <Tv className="w-3.5 h-3.5" />}
            <ChevronDown className={`w-3 h-3 transition-transform ${isThemeMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {isThemeMenuOpen && (
            <div
              role="listbox"
              aria-label="Select Theme"
              style={
                themeMenuPos && themeMenuPos.top > 0
                  ? { top: `${themeMenuPos.top}px`, left: `${themeMenuPos.left}px` }
                  : undefined
              }
              className={`z-50 min-w-[170px] bg-[var(--jira-surface)] border border-[var(--jira-border)] rounded-xl shadow-2xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${
                themeMenuPos && themeMenuPos.top > 0 ? 'fixed' : 'absolute left-0 top-full mt-1.5'
              }`}
            >
              <button
                role="option"
                aria-selected={theme === 'dark'}
                onClick={() => {
                  setTheme('dark');
                  setIsThemeMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-[var(--jira-primary)]/15 text-[var(--jira-primary)] font-semibold'
                    : 'text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Moon className="w-3.5 h-3.5" />
                  <span>Dark Mode</span>
                </div>
                {theme === 'dark' && <Check className="w-3.5 h-3.5 text-[var(--jira-primary)]" />}
              </button>
              <button
                role="option"
                aria-selected={theme === 'light'}
                onClick={() => {
                  setTheme('light');
                  setIsThemeMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors cursor-pointer ${
                  theme === 'light'
                    ? 'bg-[var(--jira-primary)]/15 text-[var(--jira-primary)] font-semibold'
                    : 'text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sun className="w-3.5 h-3.5" />
                  <span>Light Mode</span>
                </div>
                {theme === 'light' && <Check className="w-3.5 h-3.5 text-[var(--jira-primary)]" />}
              </button>
              <button
                role="option"
                aria-selected={theme === 'kiosk'}
                onClick={() => {
                  setTheme('kiosk');
                  setIsThemeMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors cursor-pointer ${
                  theme === 'kiosk'
                    ? 'bg-[var(--jira-primary)]/15 text-[var(--jira-primary)] font-semibold'
                    : 'text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Tv className="w-3.5 h-3.5" />
                  <span>Kiosk Mode</span>
                </div>
                {theme === 'kiosk' && <Check className="w-3.5 h-3.5 text-[var(--jira-primary)]" />}
              </button>
            </div>
          )}
        </div>

        {/* Desktop Theme Control */}
        <div className="hidden sm:flex items-center p-0.5 sm:p-1 rounded-lg border border-[var(--jira-border)] bg-[var(--jira-surface)] shrink-0">
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

      {/* Right side stuck to top right corner (like search) */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
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

        {/* Create Issue Button - stuck to top right corner */}
        <button
          onClick={() => setCreateModalOpen(true)}
          className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-[var(--jira-primary)] text-white hover:bg-[var(--jira-primary-hover)] transition-colors text-xs font-semibold shadow-xs cursor-pointer min-h-[32px] sm:min-h-[36px] shrink-0"
          title="Create Issue"
          aria-label="Create Issue"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create</span>
        </button>
      </div>
    </header>
  );
}
