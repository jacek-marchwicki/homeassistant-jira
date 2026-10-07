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
  { id: 'col-done', name: 'Done', category: 'done', status_ids: ['3'] },
];

export const LOCAL_STORAGE_BOARD_CACHE_KEY = 'ha_jira_board_cache_v1';
export const LOCAL_STORAGE_OUTBOX_KEY = 'ha_jira_offline_outbox_v1';

export class ServerRejectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerRejectionError';
  }
}

export interface OfflineOutboxItem {
  id: string;
  action: 'create_issue' | 'update_issue' | 'transition_issue';
  issueKey?: string;
  payload: Record<string, any>;
  createdAt: number;
}

export interface CachedBoardData {
  boardName: string;
  sprintName: string;
  jiraUrl: string;
  columns: BoardColumn[];
  issues: JiraIssue[];
}

export function loadCachedBoard(): CachedBoardData | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_BOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.issues) && parsed.issues.length > 0) {
      // Discard legacy example/seeded tasks if present from earlier test/development runs
      const hasExampleIssues =
        parsed.issues.some((issue: any) => issue.url?.includes('example.com')) ||
        (parsed.boardName === 'Engineering Sprint Board' &&
          parsed.issues.some((issue: any) => issue.key && issue.key.startsWith('PROJ-')));

      if (hasExampleIssues) {
        window.localStorage.removeItem(LOCAL_STORAGE_BOARD_CACHE_KEY);
        return null;
      }
      return parsed;
    }
  } catch {
    // Ignore corrupt local cache
  }
  return null;
}

export function saveCachedBoard(data: CachedBoardData): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_BOARD_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota issues
  }
}

export function loadCachedOutbox(): OfflineOutboxItem[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Ignore corrupt local cache
  }
  return [];
}

export function saveCachedOutbox(items: OfflineOutboxItem[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_OUTBOX_KEY, JSON.stringify(items));
  } catch {
    // Ignore quota issues
  }
}

export type DashboardView = 'board' | 'backlog';

export interface BoardStoreState {
  theme: ThemeMode;
  isLoading: boolean;
  isSyncing: boolean;
  issues: JiraIssue[];
  columns: BoardColumn[];
  boardName: string;
  sprintName: string;
  jiraUrl: string;
  wsConnected: boolean;
  activeFilters: string[];
  activeFilter: string;
  searchQuery: string;
  currentUser: string;
  errorMessage: string | null;
  rollbackQueue: Record<string, JiraIssue>;
  currentView: DashboardView;
  isBacklogExpandedOnBoard: boolean;
  editingIssue: JiraIssue | null;
  isCreateModalOpen: boolean;
  offlineOutbox: OfflineOutboxItem[];
  syncStatus: 'synced' | 'syncing' | 'offline';
  pendingSyncCount: number;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  setWsConnected: (connected: boolean) => void;
  setActiveFilters: (filters: string[]) => void;
  toggleFilter: (filter: string) => void;
  setActiveFilter: (filter: string) => void;
  setSearchQuery: (query: string) => void;
  setCurrentUser: (userName: string) => void;
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
  flushOfflineQueue: () => Promise<void>;
  handleWsMessage: (data: unknown) => void;
}

const initialCache = loadCachedBoard();
const initialOutbox = loadCachedOutbox();

export const useBoardStore = create<BoardStoreState>((set, get) => ({
  theme: getInitialTheme(),
  isLoading: !initialCache,
  isSyncing: false,
  issues: initialCache?.issues || [],
  columns:
    initialCache?.columns && initialCache.columns.length > 0
      ? initialCache.columns
      : DEFAULT_COLUMNS,
  boardName: initialCache?.boardName || '',
  sprintName: initialCache?.sprintName || '',
  jiraUrl: initialCache?.jiraUrl || 'https://jira.example.com',
  wsConnected: false,
  activeFilters: ['my', 'active', 'hide_epics'],
  activeFilter: 'my,active,hide_epics',
  searchQuery: '',
  currentUser: (() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem('ha_jira_current_user');
      if (saved && saved.trim()) return saved.trim();
    }
    return 'Jacek Marchwicki';
  })(),
  errorMessage: null,
  rollbackQueue: {},
  currentView: 'board',
  isBacklogExpandedOnBoard: false,
  editingIssue: null,
  isCreateModalOpen: false,
  offlineOutbox: initialOutbox,
  syncStatus: initialOutbox.length > 0 ? 'offline' : 'synced',
  pendingSyncCount: initialOutbox.length,

  setCurrentUser: (userName: string) => {
    const trimmed = userName.trim();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('ha_jira_current_user', trimmed);
    }
    set({ currentUser: trimmed });
  },

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
    const hasExistingData = get().issues.length > 0;
    if (!hasExistingData) {
      set({ isLoading: true });
    } else {
      set({ isSyncing: true });
    }
    try {
      const res = await fetch(getApiUrl('/api/board'));
      if (res.ok) {
        const data = await res.json();
        const nextState: CachedBoardData = {
          boardName: data.board_name || 'Engineering Sprint Board',
          sprintName: data.sprint_name || '',
          jiraUrl: data.jira_url || 'https://jira.example.com',
          columns: data.columns && data.columns.length > 0 ? data.columns : DEFAULT_COLUMNS,
          issues: data.issues || [],
        };
        saveCachedBoard(nextState);
        set({
          ...nextState,
          errorMessage: null,
          isLoading: false,
          isSyncing: false,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        set({
          errorMessage: err.detail || `Failed to load board (HTTP ${res.status})`,
          isLoading: false,
          isSyncing: false,
        });
      }
    } catch {
      set({
        errorMessage: 'Unable to connect to Jira backend server.',
        isLoading: false,
        isSyncing: false,
      });
    }
  },

  transitionIssueOptimistic: async (
    issueKey: string,
    targetCategory: JiraStatusCategory,
    targetStatus?: string
  ) => {
    const { issues, columns, rollbackQueue } = get();
    const originalIssue = issues.find((i) => i.key === issueKey);
    if (!originalIssue) return;
    if (
      originalIssue.status.category === targetCategory &&
      (!targetStatus || originalIssue.status.name === targetStatus)
    ) {
      return;
    }

    // 1. Instant Optimistic State Mutation (< 50ms)
    const targetCol = columns.find(
      (c) =>
        (targetStatus && c.name.trim().toLowerCase() === targetStatus.trim().toLowerCase()) ||
        c.category === targetCategory
    );
    const targetStatusId = targetCol?.status_ids?.[0] || targetCol?.id || `col-${targetCategory}`;
    const targetTitle = targetStatus || targetCol?.name || CATEGORY_TITLES[targetCategory] || targetCategory;
    const updatedIssues = issues.map((item) => {
      if (item.key !== issueKey) return item;
      return {
        ...item,
        status: {
          id: targetStatusId,
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
    persistCurrentBoardState(get);

    // 2. Background Asynchronous Sync to Backend & Jira
    try {
      const payload: { target_category: string; target_status?: string } = {
        target_category: targetCategory,
      };
      if (targetStatus) {
        payload.target_status = targetStatus;
      }

      const res = await fetch(getApiUrl(`/api/issues/${issueKey}/transition`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new ServerRejectionError(`Server returned ${res.status}`);
      }

      const updated = await res.json();
      set((state) => ({
        issues: state.issues.map((item) =>
          item.key === issueKey ? { ...updated, _optimisticState: 'synced' } : item
        ),
      }));
      persistCurrentBoardState(get);
    } catch (err) {
      if (err instanceof ServerRejectionError) {
        // 3. Graceful Rollback on Server Rejection
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
      } else {
        // Network failure / offline: keep optimistic state and queue mutation
        const outboxItem: OfflineOutboxItem = {
          id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          action: 'transition_issue',
          issueKey,
          payload: targetStatus
            ? { target_category: targetCategory, target_status: targetStatus }
            : { target_category: targetCategory },
          createdAt: Date.now(),
        };
        const updatedOutbox = [...get().offlineOutbox, outboxItem];
        saveCachedOutbox(updatedOutbox);
        set({
          offlineOutbox: updatedOutbox,
          pendingSyncCount: updatedOutbox.length,
          syncStatus: 'offline',
        });
        persistCurrentBoardState(get);
      }
    }
  },

  updateIssueOptimistic: async (issueKey: string, updates: IssueUpdatePayload) => {
    const { issues, columns, rollbackQueue } = get();
    const originalIssue = issues.find((i) => i.key === issueKey);
    if (!originalIssue) return;

    // 1. Instant Optimistic State Mutation (< 50ms)
    let newStatus = originalIssue.status;
    if (updates.status_name || updates.status_category) {
      const targetCategory = updates.status_category || originalIssue.status.category;
      const targetName = updates.status_name || originalIssue.status.name;
      const targetCol = columns.find(
        (c) =>
          (updates.status_name && c.name.trim().toLowerCase() === updates.status_name.trim().toLowerCase()) ||
          c.category === targetCategory
      );
      const targetStatusId = targetCol?.status_ids?.[0] || targetCol?.id || originalIssue.status.id;
      newStatus = {
        id: targetStatusId,
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
        description:
          updates.description !== undefined ? updates.description : item.description,
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
        recreate_after:
          updates.recreate_after !== undefined
            ? updates.recreate_after
            : item.recreate_after ?? item.recreateAfter,
        updated_at: new Date().toISOString(),
        _optimisticState: 'pending' as const,
      };
    });

    set({
      issues: updatedIssues,
      rollbackQueue: { ...rollbackQueue, [issueKey]: originalIssue },
      editingIssue: null,
    });
    persistCurrentBoardState(get);

    // Calculate dirty single-field delta
    const delta: Record<string, any> = {};
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        delta[key] = val;
      }
    }

    // 2. Background Asynchronous Sync to Backend
    try {
      const res = await fetch(getApiUrl(`/api/issues/${issueKey}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        throw new ServerRejectionError(`Server returned ${res.status}`);
      }

      const updated = await res.json();
      set((state) => ({
        issues: state.issues.map((item) =>
          item.key === issueKey ? { ...updated, _optimisticState: 'synced' } : item
        ),
      }));
      persistCurrentBoardState(get);
    } catch (err) {
      if (err instanceof ServerRejectionError) {
        // 3. Graceful Rollback on Server Rejection
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
      } else {
        // Network failure / offline: keep optimistic state and queue delta
        const outboxItem: OfflineOutboxItem = {
          id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          action: 'update_issue',
          issueKey,
          payload: delta,
          createdAt: Date.now(),
        };
        const updatedOutbox = [...get().offlineOutbox, outboxItem];
        saveCachedOutbox(updatedOutbox);
        set({
          offlineOutbox: updatedOutbox,
          pendingSyncCount: updatedOutbox.length,
          syncStatus: 'offline',
        });
        persistCurrentBoardState(get);
      }
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
      description: payload.description || null,
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
      recreate_after: payload.recreate_after,
      _optimisticState: 'pending',
    };

    set((state) => ({
      issues: [tempIssue, ...state.issues],
      isCreateModalOpen: false,
    }));
    persistCurrentBoardState(get);

    // 2. Background Asynchronous Sync to Backend
    try {
      const res = await fetch(getApiUrl('/api/issues'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new ServerRejectionError(`Server returned ${res.status}`);
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
      persistCurrentBoardState(get);
      return created;
    } catch (err) {
      if (err instanceof ServerRejectionError) {
        // 3. Graceful Rollback on Server Rejection
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
      } else {
        // Network failure / offline: keep temp issue in state and queue creation
        const outboxItem: OfflineOutboxItem = {
          id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          action: 'create_issue',
          issueKey: tempKey,
          payload: { ...payload },
          createdAt: Date.now(),
        };
        const updatedOutbox = [...get().offlineOutbox, outboxItem];
        saveCachedOutbox(updatedOutbox);
        set({
          offlineOutbox: updatedOutbox,
          pendingSyncCount: updatedOutbox.length,
          syncStatus: 'offline',
        });
        persistCurrentBoardState(get);
        return tempIssue;
      }
    }
  },

  flushOfflineQueue: async () => {
    const currentQueue = [...get().offlineOutbox];
    if (currentQueue.length === 0) {
      set({ syncStatus: 'synced', pendingSyncCount: 0 });
      return;
    }

    set({ syncStatus: 'syncing' });
    const remainingOutbox = [...currentQueue];

    for (const item of currentQueue) {
      try {
        let res: Response;
        if (item.action === 'transition_issue' && item.issueKey) {
          res = await fetch(getApiUrl(`/api/issues/${item.issueKey}/transition`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
        } else if (item.action === 'update_issue' && item.issueKey) {
          res = await fetch(getApiUrl(`/api/issues/${item.issueKey}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
        } else if (item.action === 'create_issue') {
          res = await fetch(getApiUrl('/api/issues'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
        } else {
          const idx = remainingOutbox.findIndex((it) => it.id === item.id);
          if (idx !== -1) remainingOutbox.splice(idx, 1);
          continue;
        }

        if (res.ok) {
          const remoteIssue: JiraIssue = await res.json();
          set((state) => {
            if (item.action === 'create_issue' && item.issueKey) {
              const withoutTemp = state.issues.filter((i) => i.key !== item.issueKey);
              const exists = withoutTemp.some((i) => i.key === remoteIssue.key);
              if (exists) {
                return {
                  issues: withoutTemp.map((i) =>
                    i.key === remoteIssue.key ? { ...remoteIssue, _optimisticState: 'synced' } : i
                  ),
                };
              }
              return {
                issues: state.issues.map((i) =>
                  i.key === item.issueKey ? { ...remoteIssue, _optimisticState: 'synced' } : i
                ),
              };
            } else {
              return {
                issues: state.issues.map((i) =>
                  i.key === (item.issueKey || remoteIssue.key)
                    ? { ...remoteIssue, _optimisticState: 'synced' }
                    : i
                ),
              };
            }
          });
        } else {
          // Server rejected or conflict: adopt remote state if returned
          try {
            const body = await res.json();
            if (body && body.key && body.status) {
              set((state) => ({
                issues: state.issues.map((i) =>
                  i.key === body.key ? { ...body, _optimisticState: 'synced' } : i
                ),
              }));
            }
          } catch {
            // Response not JSON
          }
        }

        // Successfully drained or skipped conflict: remove from outbox
        const itemIdx = remainingOutbox.findIndex((it) => it.id === item.id);
        if (itemIdx !== -1) {
          remainingOutbox.splice(itemIdx, 1);
        }
        saveCachedOutbox(remainingOutbox);
        set({
          offlineOutbox: [...remainingOutbox],
          pendingSyncCount: remainingOutbox.length,
        });
        persistCurrentBoardState(get);
      } catch {
        // Network fetch error: still offline! Stop draining queue.
        saveCachedOutbox(remainingOutbox);
        set({
          offlineOutbox: [...remainingOutbox],
          pendingSyncCount: remainingOutbox.length,
          syncStatus: 'offline',
        });
        return;
      }
    }

    saveCachedOutbox(remainingOutbox);
    set({
      offlineOutbox: [...remainingOutbox],
      pendingSyncCount: remainingOutbox.length,
      syncStatus: remainingOutbox.length === 0 ? 'synced' : 'offline',
    });
    persistCurrentBoardState(get);
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

function persistCurrentBoardState(get: () => BoardStoreState): void {
  const state = get();
  saveCachedBoard({
    boardName: state.boardName,
    sprintName: state.sprintName,
    jiraUrl: state.jiraUrl,
    columns: state.columns,
    issues: state.issues,
  });
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => {
    void useBoardStore.getState().flushOfflineQueue();
  });
}
