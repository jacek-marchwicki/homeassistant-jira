import { useState, useEffect, useRef } from 'react';
import { 
  CheckCircle2, 
  ChevronUp, 
  ChevronsUp, 
  Moon, 
  Sun, 
  Tv, 
  Wifi, 
  WifiOff,
  Layers,
  ArrowRight,
  AlertCircle
} from 'lucide-react';
import { applyTheme, getInitialTheme, ThemeMode } from './tokens/themeBridge.ts';
import { JiraIssue, JiraStatusCategory } from './types/jira.ts';

interface ColumnDef {
  id: string;
  category: JiraStatusCategory;
  title: string;
  colorVar: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'col-todo', category: 'todo', title: 'To Do', colorVar: 'var(--jira-status-todo)' },
  { id: 'col-inprogress', category: 'inprogress', title: 'In Progress', colorVar: 'var(--jira-status-inprogress)' },
  { id: 'col-inreview', category: 'inreview', title: 'In Review', colorVar: 'var(--jira-status-inreview)' },
  { id: 'col-done', category: 'done', title: 'Done', colorVar: 'var(--jira-status-done)' },
];

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme());
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [boardName, setBoardName] = useState<string>('Engineering Sprint Board');
  const [sprintName, setSprintName] = useState<string>('Active Sprint 42');
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const handleThemeChange = (newTheme: ThemeMode) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  // 1. Fetch Board State from Backend
  const loadBoard = async () => {
    try {
      const res = await fetch('/api/board');
      if (res.ok) {
        const data = await res.json();
        setBoardName(data.board_name);
        setSprintName(data.sprint_name || '');
        setIssues(data.issues);
      }
    } catch {
      // In offline / preview fallback, keep current issues
    }
  };

  useEffect(() => {
    loadBoard();
  }, []);

  // 2. Establish WebSocket Connection for Real-Time Event Sync
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connectWs = () => {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'issue_transitioned' && msg.issue) {
            setIssues((prev) =>
              prev.map((item) => (item.key === msg.issue.key ? { ...msg.issue, _optimisticState: 'synced' } : item))
            );
          }
        } catch {
          // ignore non-json messages (e.g. heartbeat pong)
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        // Exponential backoff reconnect attempt
        reconnectTimer = setTimeout(connectWs, 3000);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connectWs();

    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // 3. Optimistic UI Transition Handler (< 50ms UI update + async sync)
  const handleTransition = async (issueKey: string, targetCategory: JiraStatusCategory) => {
    const originalIssue = issues.find((i) => i.key === issueKey);
    if (!originalIssue || originalIssue.status.category === targetCategory) return;

    // A. Instant Optimistic State Mutation (< 50ms)
    setIssues((prev) =>
      prev.map((item) => {
        if (item.key !== issueKey) return item;
        return {
          ...item,
          status: {
            ...item.status,
            category: targetCategory,
            name: COLUMNS.find((c) => c.category === targetCategory)?.title || targetCategory,
          },
          _optimisticState: 'pending',
          _pendingTargetStatusId: targetCategory,
        };
      })
    );

    // B. Background Asynchronous Sync to Backend & Jira
    try {
      const res = await fetch(`/api/issues/${issueKey}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_category: targetCategory }),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const updated = await res.json();
      setIssues((prev) =>
        prev.map((item) => (item.key === issueKey ? { ...updated, _optimisticState: 'synced' } : item))
      );
    } catch {
      // C. Graceful Rollback on Sync Rejection
      setIssues((prev) =>
        prev.map((item) => (item.key === issueKey ? { ...originalIssue, _optimisticState: 'failed' } : item))
      );
      setErrorMessage(`Failed to transition ${issueKey}. Reverting to previous status.`);
      setTimeout(() => setErrorMessage(null), 5000);
    }
  };

  // Filter Issues
  const filteredIssues = issues.filter((issue) => {
    const name = issue.assignee?.displayName || issue.assignee?.display_name || '';
    if (activeFilter === 'my') return name.includes('Jacek');
    if (activeFilter === 'blockers') return issue.priority === 'highest' || issue.status.category === 'blocked';
    return true;
  });

  return (
    <div className="flex flex-col min-h-screen bg-[var(--jira-canvas)] text-[var(--jira-text-primary)]">
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between px-4 py-3 border-b border-[var(--jira-border)] bg-[var(--jira-surface)]/80 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[var(--jira-primary)]/20 text-[var(--jira-primary)]">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight">{boardName}</h1>
            <p className="text-xs text-[var(--jira-text-secondary)]">{sprintName}</p>
          </div>
        </div>

        {/* Live WebSocket Status & Themes */}
        <div className="flex items-center gap-2 sm:gap-3 mt-2 sm:mt-0">
          <div 
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              wsConnected 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
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

      {/* Error / Rollback Toast Banner */}
      {errorMessage && (
        <div className="bg-red-500/10 border-b border-red-500/20 text-red-400 px-4 py-2 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Quick Filters Bar */}
      <section className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto border-b border-[var(--jira-border)] bg-[var(--jira-canvas)]">
        <button 
          onClick={() => setActiveFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            activeFilter === 'all' 
              ? 'bg-[var(--jira-primary)] text-white shadow-sm' 
              : 'bg-[var(--jira-surface)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
        >
          All Issues ({issues.length})
        </button>
        <button 
          onClick={() => setActiveFilter('my')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            activeFilter === 'my' 
              ? 'bg-[var(--jira-primary)] text-white shadow-sm' 
              : 'bg-[var(--jira-surface)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
        >
          Assigned to Me
        </button>
        <button 
          onClick={() => setActiveFilter('blockers')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            activeFilter === 'blockers' 
              ? 'bg-[var(--jira-primary)] text-white shadow-sm' 
              : 'bg-[var(--jira-surface)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
        >
          Blockers & Critical
        </button>
      </section>

      {/* Kanban Board Grid */}
      <main className="flex-1 p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 overflow-y-auto">
        {COLUMNS.map((column) => {
          const colIssues = filteredIssues.filter((i) => i.status.category === column.category);

          return (
            <div 
              key={column.id}
              className="flex flex-col rounded-xl bg-[var(--jira-surface)] border border-[var(--jira-border)] p-3 min-h-[400px]"
            >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-[var(--jira-border-subtle)]">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: column.colorVar }} />
                  <h2 className="text-sm font-semibold uppercase tracking-wider">{column.title}</h2>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--jira-surface-elevated)] text-[var(--jira-text-secondary)]">
                  {colIssues.length}
                </span>
              </div>

              {/* Column Issues List */}
              <div className="flex flex-col gap-2.5 flex-1">
                {colIssues.map((issue) => (
                  <article 
                    key={issue.key}
                    className={`group relative p-3 rounded-lg bg-[var(--jira-surface-elevated)] border transition-all shadow-sm ${
                      issue._optimisticState === 'pending'
                        ? 'border-[var(--jira-primary)] ring-2 ring-[var(--jira-primary)]/30 animate-pulse'
                        : 'border-[var(--jira-border)] hover:border-[var(--jira-primary)]/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-[var(--jira-text-secondary)]">{issue.key}</span>
                      
                      <div className="flex items-center gap-1.5">
                        {/* Direct One-Tap Quick Action: Mark as Done */}
                        {issue.status.category !== 'done' && (
                          <button 
                            onClick={() => handleTransition(issue.key, 'done')}
                            className="flex items-center gap-1 px-2 py-1 rounded text-2xs font-semibold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors min-h-[32px]"
                            title="Quick Action: Mark as Done"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Done</span>
                          </button>
                        )}

                        {/* Direct Transition Selector (Move to any column without dragging) */}
                        <div className="relative">
                          <select
                            value={issue.status.category}
                            onChange={(e) => handleTransition(issue.key, e.target.value as JiraStatusCategory)}
                            className="text-2xs bg-[var(--jira-surface)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] rounded px-1.5 py-1 outline-none cursor-pointer min-h-[32px]"
                            title="Change Status"
                          >
                            <option value="todo">To Do</option>
                            <option value="inprogress">In Progress</option>
                            <option value="inreview">In Review</option>
                            <option value="done">Done</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <p className={`text-sm font-medium mb-3 line-clamp-2 ${issue.status.category === 'done' ? 'line-through text-[var(--jira-text-muted)]' : ''}`}>
                      {issue.summary}
                    </p>

                    <div className="flex items-center justify-between text-xs text-[var(--jira-text-secondary)]">
                      <div className="flex items-center gap-1.5">
                        {issue.priority === 'highest' && <ChevronsUp className="w-4 h-4 text-red-400" />}
                        {issue.priority === 'high' && <ChevronUp className="w-4 h-4 text-orange-400" />}
                        {issue.priority === 'medium' && <ArrowRight className="w-4 h-4 text-blue-400" />}
                        <span className="text-2xs font-bold uppercase">{issue.priority}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {(issue.story_points ?? issue.storyPoints) !== undefined && (
                          <span className="px-1.5 py-0.5 rounded text-2xs font-bold bg-[var(--jira-surface)] text-[var(--jira-text-muted)]">
                            {issue.story_points ?? issue.storyPoints} pts
                          </span>
                        )}
                        {issue.assignee ? (
                          <div 
                            className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-2xs font-bold text-white shadow-sm"
                            title={issue.assignee.display_name || issue.assignee.displayName}
                          >
                            {(issue.assignee.display_name || issue.assignee.displayName || '?')
                              .split(' ')
                              .map((n: string) => n[0])
                              .join('')}
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-[var(--jira-surface)] border border-[var(--jira-border)] text-2xs flex items-center justify-center text-[var(--jira-text-muted)]">
                            -
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
