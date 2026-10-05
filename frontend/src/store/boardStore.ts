import { create } from 'zustand';
import { BoardColumn, JiraIssue, JiraStatusCategory } from '../types/jira.ts';
import { applyTheme, getInitialTheme, ThemeMode } from '../tokens/themeBridge.ts';
import { getApiUrl } from '../utils/paths.ts';

const CATEGORY_TITLES: Record<JiraStatusCategory, string> = {
  todo: 'To Do',
  inprogress: 'In Progress',
  inreview: 'In Review',
  done: 'Done',
  blocked: 'Blocked',
};

export const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: 'col-todo', name: 'To Do', category: 'todo', status_ids: ['1'] },
  { id: 'col-inprogress', name: 'In Progress', category: 'inprogress', status_ids: ['2'] },
  { id: 'col-inreview', name: 'In Review', category: 'inreview', status_ids: ['3'] },
  { id: 'col-done', name: 'Done', category: 'done', status_ids: ['4'] },
];

export interface BoardStoreState {
  theme: ThemeMode;
  issues: JiraIssue[];
  columns: BoardColumn[];
  boardName: string;
  sprintName: string;
  wsConnected: boolean;
  activeFilter: string;
  searchQuery: string;
  errorMessage: string | null;
  rollbackQueue: Record<string, JiraIssue>;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  setWsConnected: (connected: boolean) => void;
  setActiveFilter: (filter: string) => void;
  setSearchQuery: (query: string) => void;
  setErrorMessage: (msg: string | null) => void;
  loadBoard: () => Promise<void>;
  transitionIssueOptimistic: (
    issueKey: string,
    targetCategory: JiraStatusCategory,
    targetStatus?: string
  ) => Promise<void>;
  handleWsMessage: (data: unknown) => void;
}

export const useBoardStore = create<BoardStoreState>((set, get) => ({
  theme: getInitialTheme(),
  issues: [],
  columns: DEFAULT_COLUMNS,
  boardName: 'Engineering Sprint Board',
  sprintName: 'Active Sprint 42',
  wsConnected: false,
  activeFilter: 'all',
  searchQuery: '',
  errorMessage: null,
  rollbackQueue: {},

  setTheme: (newTheme: ThemeMode) => {
    set({ theme: newTheme });
    applyTheme(newTheme);
  },

  setWsConnected: (connected: boolean) => {
    set({ wsConnected: connected });
  },

  setActiveFilter: (filter: string) => {
    set({ activeFilter: filter });
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  setErrorMessage: (msg: string | null) => {
    set({ errorMessage: msg });
  },

  loadBoard: async () => {
    try {
      const res = await fetch(getApiUrl('/api/board'));
      if (res.ok) {
        const data = await res.json();
        set({
          boardName: data.board_name || 'Engineering Sprint Board',
          sprintName: data.sprint_name || '',
          columns: data.columns && data.columns.length > 0 ? data.columns : DEFAULT_COLUMNS,
          issues: data.issues || [],
          errorMessage: null,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        set({
          errorMessage: err.detail || `Failed to load board (HTTP ${res.status})`,
        });
      }
    } catch {
      set({ errorMessage: 'Unable to connect to Jira backend server.' });
    }
  },

  transitionIssueOptimistic: async (
    issueKey: string,
    targetCategory: JiraStatusCategory,
    targetStatus?: string
  ) => {
    const { issues, rollbackQueue } = get();
    const originalIssue = issues.find((i) => i.key === issueKey);
    if (!originalIssue) return;
    if (
      originalIssue.status.category === targetCategory &&
      (!targetStatus || originalIssue.status.name === targetStatus)
    ) {
      return;
    }

    // 1. Instant Optimistic State Mutation (< 50ms)
    const targetTitle = targetStatus || CATEGORY_TITLES[targetCategory] || targetCategory;
    const updatedIssues = issues.map((item) => {
      if (item.key !== issueKey) return item;
      return {
        ...item,
        status: {
          ...item.status,
          category: targetCategory,
          name: targetTitle,
        },
        _optimisticState: 'pending' as const,
        _pendingTargetStatusId: targetCategory,
      };
    });

    set({
      issues: updatedIssues,
      rollbackQueue: { ...rollbackQueue, [issueKey]: originalIssue },
    });

    // 2. Background Asynchronous Sync to Backend & Jira
    try {
      const res = await fetch(getApiUrl(`/api/issues/${issueKey}/transition`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_category: targetCategory,
          target_status: targetStatus,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const updated = await res.json();
      set((state) => ({
        issues: state.issues.map((item) =>
          item.key === issueKey ? { ...updated, _optimisticState: 'synced' } : item
        ),
      }));
    } catch {
      // 3. Graceful Rollback on Sync Rejection
      set((state) => {
        const rollbackIssue = state.rollbackQueue[issueKey] || originalIssue;
        return {
          issues: state.issues.map((item) =>
            item.key === issueKey ? { ...rollbackIssue, _optimisticState: 'failed' } : item
          ),
          errorMessage: `Failed to transition ${issueKey}. Reverting to previous status.`,
        };
      });

      // Clear error message after 5 seconds
      setTimeout(() => {
        if (get().errorMessage?.includes(issueKey)) {
          set({ errorMessage: null });
        }
      }, 5000);
    }
  },

  handleWsMessage: (data: unknown) => {
    if (!data || typeof data !== 'object') return;
    const msg = data as Record<string, unknown>;

    if (msg.event === 'issue_transitioned' && msg.issue) {
      const incomingIssue = msg.issue as JiraIssue;
      set((state) => ({
        issues: state.issues.map((item) =>
          item.key === incomingIssue.key ? { ...incomingIssue, _optimisticState: 'synced' } : item
        ),
      }));
    } else if (msg.event === 'board_synced' && Array.isArray(msg.issues)) {
      set({ issues: msg.issues as JiraIssue[] });
    }
  },
}));
