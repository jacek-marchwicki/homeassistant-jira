import { create } from 'zustand';
import {
  BoardColumn,
  IssueCreatePayload,
  IssueUpdatePayload,
  JiraIssue,
  JiraStatusCategory,
} from '../types/jira.ts';
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

export type DashboardView = 'board' | 'backlog';

export interface BoardStoreState {
  theme: ThemeMode;
  isLoading: boolean;
  issues: JiraIssue[];
  columns: BoardColumn[];
  boardName: string;
  sprintName: string;
  wsConnected: boolean;
  activeFilters: string[];
  activeFilter: string;
  searchQuery: string;
  errorMessage: string | null;
  rollbackQueue: Record<string, JiraIssue>;
  currentView: DashboardView;
  isBacklogExpandedOnBoard: boolean;
  editingIssue: JiraIssue | null;
  isCreateModalOpen: boolean;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  setWsConnected: (connected: boolean) => void;
  setActiveFilters: (filters: string[]) => void;
  toggleFilter: (filter: string) => void;
  setActiveFilter: (filter: string) => void;
  setSearchQuery: (query: string) => void;
  setErrorMessage: (msg: string | null) => void;
  setCurrentView: (view: DashboardView) => void;
  toggleBacklogExpandedOnBoard: () => void;
  setEditingIssue: (issue: JiraIssue | null) => void;
  setCreateModalOpen: (open: boolean) => void;
  moveToBacklog: (issueKey: string) => Promise<void>;
  moveToBoard: (issueKey: string) => Promise<void>;
  loadBoard: () => Promise<void>;
  transitionIssueOptimistic: (
    issueKey: string,
    targetCategory: JiraStatusCategory,
    targetStatus?: string
  ) => Promise<void>;
  updateIssueOptimistic: (issueKey: string, updates: IssueUpdatePayload) => Promise<void>;
  createIssueOptimistic: (payload: IssueCreatePayload) => Promise<JiraIssue | null>;
  handleWsMessage: (data: unknown) => void;
}

export const useBoardStore = create<BoardStoreState>((set, get) => ({
  theme: getInitialTheme(),
  isLoading: true,
  issues: [],
  columns: DEFAULT_COLUMNS,
  boardName: '',
  sprintName: '',
  wsConnected: false,
  activeFilters: ['my', 'active'],
  activeFilter: 'my,active',
  searchQuery: '',
  errorMessage: null,
  rollbackQueue: {},
  currentView: 'board',
  isBacklogExpandedOnBoard: false,
  editingIssue: null,
  isCreateModalOpen: false,

  setEditingIssue: (issue: JiraIssue | null) => {
    set({ editingIssue: issue });
  },

  setCreateModalOpen: (open: boolean) => {
    set({ isCreateModalOpen: open });
  },

  setCurrentView: (view: DashboardView) => {
    set({ currentView: view });
  },

  toggleBacklogExpandedOnBoard: () => {
    set((state) => ({ isBacklogExpandedOnBoard: !state.isBacklogExpandedOnBoard }));
  },

  moveToBacklog: async (issueKey: string) => {
    await get().transitionIssueOptimistic(issueKey, 'todo', 'Backlog');
  },

  moveToBoard: async (issueKey: string) => {
    const { columns } = get();
    const activeCols = columns.filter((c) => c.name.trim().toLowerCase() !== 'backlog');
    const firstActiveCol = activeCols[0] || { category: 'todo' as const, name: 'To Do' };
    await get().transitionIssueOptimistic(
      issueKey,
      firstActiveCol.category,
      firstActiveCol.name
    );
  },

  setTheme: (newTheme: ThemeMode) => {
    set({ theme: newTheme });
    applyTheme(newTheme);
  },

  setWsConnected: (connected: boolean) => {
    set({ wsConnected: connected });
  },

  setActiveFilters: (filters: string[]) => {
    set({
      activeFilters: filters,
      activeFilter: filters.length === 0 ? 'all' : filters.join(','),
    });
  },

  toggleFilter: (filter: string) => {
    set((state) => {
      if (filter === 'all') {
        return { activeFilters: [], activeFilter: 'all' };
      }
      const exists = state.activeFilters.includes(filter);
      const updated = exists
        ? state.activeFilters.filter((f) => f !== filter)
        : [...state.activeFilters, filter];
      return {
        activeFilters: updated,
        activeFilter: updated.length === 0 ? 'all' : updated.join(','),
      };
    });
  },

  setActiveFilter: (filter: string) => {
    if (filter === 'all') {
      set({ activeFilters: [], activeFilter: 'all' });
    } else {
      set({ activeFilters: [filter], activeFilter: filter });
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  setErrorMessage: (msg: string | null) => {
    set({ errorMessage: msg });
  },

  loadBoard: async () => {
    set({ isLoading: true });
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
          isLoading: false,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        set({
          errorMessage: err.detail || `Failed to load board (HTTP ${res.status})`,
          isLoading: false,
        });
      }
    } catch {
      set({
        errorMessage: 'Unable to connect to Jira backend server.',
        isLoading: false,
      });
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
        updated_at: new Date().toISOString(),
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

  updateIssueOptimistic: async (issueKey: string, updates: IssueUpdatePayload) => {
    const { issues, rollbackQueue } = get();
    const originalIssue = issues.find((i) => i.key === issueKey);
    if (!originalIssue) return;

    // 1. Instant Optimistic State Mutation (< 50ms)
    let newStatus = originalIssue.status;
    if (updates.status_name || updates.status_category) {
      const targetCategory = updates.status_category || originalIssue.status.category;
      const targetName = updates.status_name || originalIssue.status.name;
      newStatus = {
        ...originalIssue.status,
        category: targetCategory,
        name: targetName,
      };
    }

    let newAssignee = originalIssue.assignee;
    if (updates.assignee_name !== undefined) {
      if (updates.assignee_name.trim() === '') {
        newAssignee = null;
      } else {
        newAssignee = {
          accountId: originalIssue.assignee?.accountId || 'usr-1',
          displayName: updates.assignee_name.trim(),
        };
      }
    }

    const updatedIssues = issues.map((item) => {
      if (item.key !== issueKey) return item;
      return {
        ...item,
        summary: updates.summary !== undefined ? updates.summary : item.summary,
        issue_type:
          updates.issue_type !== undefined
            ? updates.issue_type
            : item.issue_type || item.issueType,
        priority: updates.priority !== undefined ? updates.priority : item.priority,
        status: newStatus,
        assignee: newAssignee,
        story_points:
          updates.story_points !== undefined
            ? updates.story_points
            : item.story_points ?? item.storyPoints,
        due_date:
          updates.due_date !== undefined ? updates.due_date : item.due_date ?? item.dueDate,
        start_date:
          updates.start_date !== undefined ? updates.start_date : item.start_date ?? item.startDate,
        updated_at: new Date().toISOString(),
        _optimisticState: 'pending' as const,
      };
    });

    set({
      issues: updatedIssues,
      rollbackQueue: { ...rollbackQueue, [issueKey]: originalIssue },
      editingIssue: null,
    });

    // 2. Background Asynchronous Sync to Backend
    try {
      const res = await fetch(getApiUrl(`/api/issues/${issueKey}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
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
          errorMessage: `Failed to update ${issueKey}. Reverting changes.`,
        };
      });

      setTimeout(() => {
        if (get().errorMessage?.includes(issueKey)) {
          set({ errorMessage: null });
        }
      }, 5000);
    }
  },

  createIssueOptimistic: async (payload: IssueCreatePayload) => {
    // 1. Instant Optimistic State Mutation (< 50ms)
    const tempKey = `TEMP-${Date.now()}`;
    const targetCategory = payload.status_category || 'todo';
    const targetStatusName = payload.status_name || CATEGORY_TITLES[targetCategory] || 'To Do';
    const tempIssue: JiraIssue = {
      id: tempKey,
      key: tempKey,
      summary: payload.summary,
      issue_type: payload.issue_type || 'task',
      priority: payload.priority || 'medium',
      status: {
        id: `col-${targetCategory}`,
        name: targetStatusName,
        category: targetCategory,
      },
      assignee: payload.assignee_name?.trim()
        ? { accountId: 'usr-1', displayName: payload.assignee_name.trim() }
        : null,
      story_points: payload.story_points,
      due_date: payload.due_date,
      start_date: payload.start_date,
      _optimisticState: 'pending',
    };

    set((state) => ({
      issues: [tempIssue, ...state.issues],
      isCreateModalOpen: false,
    }));

    // 2. Background Asynchronous Sync to Backend
    try {
      const res = await fetch(getApiUrl('/api/issues'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const created: JiraIssue = await res.json();
      set((state) => {
        const withoutTemp = state.issues.filter((item) => item.key !== tempKey);
        const alreadyHasCreated = withoutTemp.some((item) => item.key === created.key);
        if (alreadyHasCreated) {
          return {
            issues: withoutTemp.map((item) =>
              item.key === created.key ? { ...created, _optimisticState: 'synced' } : item
            ),
          };
        }
        return {
          issues: state.issues.map((item) =>
            item.key === tempKey ? { ...created, _optimisticState: 'synced' } : item
          ),
        };
      });
      return created;
    } catch {
      // 3. Graceful Rollback on Sync Rejection
      set((state) => ({
        issues: state.issues.filter((item) => item.key !== tempKey),
        errorMessage: 'Failed to create issue. Please check connection.',
      }));

      setTimeout(() => {
        if (get().errorMessage?.includes('Failed to create issue')) {
          set({ errorMessage: null });
        }
      }, 5000);
      return null;
    }
  },

  handleWsMessage: (data: unknown) => {
    if (!data || typeof data !== 'object') return;
    const msg = data as Record<string, unknown>;

    if (msg.event === 'issue_created' && msg.issue) {
      const incomingIssue = msg.issue as JiraIssue;
      set((state) => {
        const exists = state.issues.some((i) => i.key === incomingIssue.key);
        if (exists) {
          return {
            issues: state.issues.map((item) =>
              item.key === incomingIssue.key ? { ...incomingIssue, _optimisticState: 'synced' } : item
            ),
          };
        }
        // If an optimistic temp issue with matching summary exists, replace it
        const tempIndex = state.issues.findIndex(
          (i) => i.key.startsWith('TEMP-') && i.summary === incomingIssue.summary
        );
        if (tempIndex !== -1) {
          const updatedList = [...state.issues];
          updatedList[tempIndex] = { ...incomingIssue, _optimisticState: 'synced' };
          return { issues: updatedList };
        }
        return { issues: [incomingIssue, ...state.issues] };
      });
    } else if ((msg.event === 'issue_transitioned' || msg.event === 'issue_updated') && msg.issue) {
      const incomingIssue = msg.issue as JiraIssue;
      set((state) => {
        const exists = state.issues.some((item) => item.key === incomingIssue.key);
        if (!exists) {
          return { issues: [incomingIssue, ...state.issues] };
        }
        return {
          issues: state.issues.map((item) =>
            item.key === incomingIssue.key ? { ...incomingIssue, _optimisticState: 'synced' } : item
          ),
        };
      });
    } else if (msg.event === 'board_synced' && Array.isArray(msg.issues)) {
      set({ issues: msg.issues as JiraIssue[] });
    }
  },
}));
