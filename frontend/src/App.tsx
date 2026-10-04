import React, { useState } from 'react';
import { 
  CheckCircle2, 
  ChevronUp, 
  ChevronsUp, 
  Moon, 
  Sun, 
  Tv, 
  Wifi, 
  Layers
} from 'lucide-react';
import { applyTheme, getInitialTheme, ThemeMode } from './tokens/themeBridge.ts';

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme());

  const handleThemeChange = (newTheme: ThemeMode) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--jira-canvas)] text-[var(--jira-text-primary)]">
      {/* Top Navigation & Status Bar */}
      <header className="flex flex-wrap items-center justify-between px-4 py-3 border-b border-[var(--jira-border)] bg-[var(--jira-surface)]/80 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[var(--jira-primary)]/20 text-[var(--jira-primary)]">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight">Home Assistant Jira Dashboard</h1>
            <p className="text-xs text-[var(--jira-text-secondary)]">Active Sprint 42 • Board: Engineering</p>
          </div>
        </div>

        {/* Action Controls & Sync Status */}
        <div className="flex items-center gap-2 sm:gap-3 mt-2 sm:mt-0">
          {/* Real-Time WebSocket Connection Indicator */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Wifi className="w-3.5 h-3.5 animate-pulse" />
            <span>Live</span>
          </div>

          {/* Theme Toggles */}
          <div className="flex items-center p-1 rounded-lg border border-[var(--jira-border)] bg-[var(--jira-surface)]">
            <button
              onClick={() => handleThemeChange('dark')}
              className={`p-1.5 rounded-md text-xs transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center ${
                theme === 'dark' ? 'bg-[var(--jira-surface-elevated)] text-[var(--jira-text-primary)]' : 'text-[var(--jira-text-secondary)]'
              }`}
              title="Dark Mode"
              aria-label="Dark Mode"
            >
              <Moon className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleThemeChange('light')}
              className={`p-1.5 rounded-md text-xs transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center ${
                theme === 'light' ? 'bg-[var(--jira-surface-elevated)] text-[var(--jira-text-primary)]' : 'text-[var(--jira-text-secondary)]'
              }`}
              title="Light Mode"
              aria-label="Light Mode"
            >
              <Sun className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleThemeChange('kiosk')}
              className={`p-1.5 rounded-md text-xs transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center ${
                theme === 'kiosk' ? 'bg-[var(--jira-surface-elevated)] text-[var(--jira-text-primary)]' : 'text-[var(--jira-text-secondary)]'
              }`}
              title="Kiosk / Wallboard Mode"
              aria-label="Kiosk Mode"
            >
              <Tv className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Quick Filters Bar */}
      <section className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto border-b border-[var(--jira-border)] bg-[var(--jira-canvas)]">
        <button className="px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--jira-primary)] text-white shadow-sm hover:opacity-90">
          All Issues (14)
        </button>
        <button className="px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--jira-surface)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]">
          Assigned to Me
        </button>
        <button className="px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--jira-surface)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]">
          Blockers Only (1)
        </button>
        <button className="px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--jira-surface)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]">
          Recently Updated
        </button>
      </section>

      {/* Kanban Board Grid */}
      <main className="flex-1 p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 overflow-y-auto">
        {/* Column: To Do */}
        <div className="flex flex-col rounded-xl bg-[var(--jira-surface)] border border-[var(--jira-border)] p-3 min-h-[400px]">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-[var(--jira-border-subtle)]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--jira-status-todo)]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">To Do</h2>
            </div>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--jira-surface-elevated)] text-[var(--jira-text-secondary)]">
              2
            </span>
          </div>

          <div className="flex flex-col gap-2.5 flex-1">
            {/* Sample Card with Direct Quick Action */}
            <article className="group relative p-3 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] shadow-sm hover:border-[var(--jira-primary)]/50 transition-all cursor-grab">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-[var(--jira-text-secondary)]">PROJ-101</span>
                {/* Non-drag direct action: One-tap Mark Done */}
                <button 
                  className="flex items-center gap-1 px-2 py-1 rounded text-2xs font-semibold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors min-h-[32px]"
                  title="Mark as Done"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Done</span>
                </button>
              </div>
              <p className="text-sm font-medium mb-3 line-clamp-2">
                Configure Home Assistant Ingress dynamic proxy support
              </p>
              <div className="flex items-center justify-between text-xs text-[var(--jira-text-secondary)]">
                <div className="flex items-center gap-1.5 text-orange-400">
                  <ChevronUp className="w-4 h-4" />
                  <span className="text-2xs font-bold uppercase">High</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded text-2xs font-bold bg-[var(--jira-surface)] text-[var(--jira-text-muted)]">5 pts</span>
                  <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-2xs font-bold text-white">
                    JM
                  </div>
                </div>
              </div>
            </article>

            {/* Sample Card 2 */}
            <article className="p-3 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] shadow-sm hover:border-[var(--jira-primary)]/50 transition-all cursor-grab">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-[var(--jira-text-secondary)]">PROJ-104</span>
                <button 
                  className="flex items-center gap-1 px-2 py-1 rounded text-2xs font-semibold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors min-h-[32px]"
                  title="Mark as Done"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Done</span>
                </button>
              </div>
              <p className="text-sm font-medium mb-3 line-clamp-2">
                Setup WebSocket broadcast client for live browser pushes
              </p>
              <div className="flex items-center justify-between text-xs text-[var(--jira-text-secondary)]">
                <div className="flex items-center gap-1.5 text-blue-400">
                  <span className="text-2xs font-bold uppercase">Medium</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-2xs font-bold bg-[var(--jira-surface)] text-[var(--jira-text-muted)]">3 pts</span>
              </div>
            </article>
          </div>
        </div>

        {/* Column: In Progress */}
        <div className="flex flex-col rounded-xl bg-[var(--jira-surface)] border border-[var(--jira-border)] p-3 min-h-[400px]">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-[var(--jira-border-subtle)]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--jira-status-inprogress)]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">In Progress</h2>
            </div>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--jira-surface-elevated)] text-[var(--jira-text-secondary)]">
              1
            </span>
          </div>

          <div className="flex flex-col gap-2.5 flex-1">
            <article className="p-3 rounded-lg bg-[var(--jira-surface-elevated)] border-2 border-[var(--jira-primary)] shadow-md cursor-grab">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-[var(--jira-text-secondary)]">PROJ-98</span>
                <span className="text-2xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold">Active</span>
              </div>
              <p className="text-sm font-medium mb-3 line-clamp-2">
                Design system tokens with Home Assistant theme bridging
              </p>
              <div className="flex items-center justify-between text-xs text-[var(--jira-text-secondary)]">
                <div className="flex items-center gap-1.5 text-red-400">
                  <ChevronsUp className="w-4 h-4" />
                  <span className="text-2xs font-bold uppercase">Highest</span>
                </div>
                <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-2xs font-bold text-white">
                  AL
                </div>
              </div>
            </article>
          </div>
        </div>

        {/* Column: In Review */}
        <div className="flex flex-col rounded-xl bg-[var(--jira-surface)] border border-[var(--jira-border)] p-3 min-h-[400px]">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-[var(--jira-border-subtle)]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--jira-status-inreview)]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">In Review</h2>
            </div>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--jira-surface-elevated)] text-[var(--jira-text-secondary)]">
              1
            </span>
          </div>

          <div className="flex flex-col gap-2.5 flex-1">
            <article className="p-3 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] shadow-sm cursor-grab">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-[var(--jira-text-secondary)]">PROJ-85</span>
                <button 
                  className="flex items-center gap-1 px-2 py-1 rounded text-2xs font-semibold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors min-h-[32px]"
                  title="Mark as Done"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Done</span>
                </button>
              </div>
              <p className="text-sm font-medium mb-3 line-clamp-2">
                Jira webhook ingestion & signature validation engine
              </p>
              <div className="flex items-center justify-between text-xs text-[var(--jira-text-secondary)]">
                <div className="flex items-center gap-1.5 text-blue-400">
                  <span className="text-2xs font-bold uppercase">Medium</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-2xs font-bold bg-[var(--jira-surface)] text-[var(--jira-text-muted)]">8 pts</span>
              </div>
            </article>
          </div>
        </div>

        {/* Column: Done */}
        <div className="flex flex-col rounded-xl bg-[var(--jira-surface)] border border-[var(--jira-border)] p-3 min-h-[400px]">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-[var(--jira-border-subtle)]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--jira-status-done)]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Done</h2>
            </div>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--jira-surface-elevated)] text-[var(--jira-text-secondary)]">
              3
            </span>
          </div>

          <div className="flex flex-col gap-2.5 flex-1 opacity-75 hover:opacity-100 transition-opacity">
            <article className="p-3 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-[var(--jira-text-muted)] line-through">PROJ-72</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-[var(--jira-text-secondary)] mb-2 line-clamp-2">
                Project scaffold & business requirements definition
              </p>
            </article>
          </div>
        </div>
      </main>
    </div>
  );
}
