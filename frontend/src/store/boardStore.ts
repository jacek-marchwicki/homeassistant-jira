import { create } from 'zustand';
import {
  BoardColumn,
  IssueCreatePayload,
  IssueUpdatePayload,
  JiraIssue,
  JiraStatusCategory,
  JiraUser,
} from '../types/jira.ts';
import { applyTheme, getInitialTheme, ThemeMode } from '../tokens/themeBridge.ts';
import { getApiUrl } from '../utils/paths.ts';
import {
  AccountType,
  AccountTypes,
  calculateRankBetween,
  sortIssuesByRank,
} from '../utils/boardUtils.ts';
import {
  Route,
  closeOverlayRoute,
  getCurrentRoute,
  pushRoute,
  replaceRoute,
} from '../utils/navigation.ts';

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
export const LOCAL_STORAGE_CURRENT_VIEW_KEY = 'ha_jira_current_view';
export const LOCAL_STORAGE_CURRENT_USER_KEY = 'ha_jira_current_user';
export const LOCAL_STORAGE_ACCOUNT_TYPES_KEY = 'ha_jira_account_types';
export const LOCAL_STORAGE_HIDE_IMAGES_KEY = 'ha_jira_hide_images';

export class ServerRejectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerRejectionError';
    Object.setPrototypeOf(this, ServerRejectionError.prototype);
  }
}

export function isServerRejectionError(err: unknown): err is ServerRejectionError {
  return (
    err instanceof ServerRejectionError ||
    (typeof err === 'object' && err !== null && (err as any).name === 'ServerRejectionError')
  );
}


export interface OfflineOutboxItem {
  id: string;
  action: 'create_issue' | 'update_issue' | 'transition_issue' | 'rank_issue' | 'delete_issue';
  issueKey?: string;
  payload: Record<string, any>;
  createdAt: number;
}

export interface PendingQuickDone {
  issueKey: string;
  originalIssue: JiraIssue;
  timeoutId: ReturnType<typeof setTimeout>;
  targetCategory: JiraStatusCategory;
  targetStatus?: string;
  startTime: number;
  durationMs: number;
}

export interface ConnectionDetails {
  lastError: string | null;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  nextRetryAt: number | null;
  retryAttempt: number;
}

export interface AuthUser {
  email: string;
  name: string;
  picture: string;
}

export interface AuthStatus {
  authMode: 'none' | 'homeassistant' | 'gcp_oauth' | string;
  googleClientId: string | null;
  authenticated: boolean;
  user: AuthUser | null;
}

export interface CachedBoardData {
  boardName: string;
  sprintName: string;
  jiraUrl: string;
  columns: BoardColumn[];
  issues: JiraIssue[];
  availableUsers?: JiraUser[];
  geminiConfigured?: boolean;
}

export function loadCachedView(): DashboardView {
  if (typeof window === 'undefined' || !window.localStorage) return 'people';
  try {
    const saved = window.localStorage.getItem(LOCAL_STORAGE_CURRENT_VIEW_KEY);
    if (saved === 'backlog' || saved === 'people') {
      return saved;
    }
  } catch {
    // Ignore error
  }
  return 'people';
}

export function saveCachedView(view: DashboardView): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_CURRENT_VIEW_KEY, view);
  } catch {
    // Ignore error
  }
}

export function loadCachedUser(): string {
  if (typeof window === 'undefined' || !window.localStorage) return 'Jacek Marchwicki';
  try {
    const saved = window.localStorage.getItem(LOCAL_STORAGE_CURRENT_USER_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // Ignore error
  }
  return 'Jacek Marchwicki';
}

export function loadCachedAccountTypes(): AccountTypes {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_ACCOUNT_TYPES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const result: AccountTypes = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v === 'child') result[k] = 'child';
      }
      return result;
    }
  } catch {
    // Ignore error
  }
  return {};
}

export function saveCachedAccountTypes(types: AccountTypes): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_ACCOUNT_TYPES_KEY, JSON.stringify(types));
  } catch {
    // Ignore error
  }
}

export function saveCachedUser(userName: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_CURRENT_USER_KEY, userName.trim());
  } catch {
    // Ignore error
  }
}

export function loadCachedHideImages(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(LOCAL_STORAGE_HIDE_IMAGES_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveCachedHideImages(hide: boolean): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_HIDE_IMAGES_KEY, String(hide));
  } catch {
    // Ignore error
  }
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
      return {
        ...parsed,
        issues: sortIssuesByRank(parsed.issues),
        availableUsers: Array.isArray(parsed.availableUsers) ? parsed.availableUsers : [],
      };
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

export type DashboardView = 'people' | 'backlog';

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
  accountTypes: AccountTypes;
  showChildren: boolean;
  hideImages: boolean;
  geminiConfigured: boolean;
  isSettingsOpen: boolean;
  errorMessage: string | null;
  rollbackQueue: Record<string, JiraIssue>;
  currentView: DashboardView;
  isBacklogExpandedOnBoard: boolean;
  editingIssue: JiraIssue | null;
  isCreateModalOpen: boolean;
  createInitialValues: Partial<IssueCreatePayload> | null;
  isConnectionModalOpen: boolean;
  pendingQuickDone: PendingQuickDone | null;
  /** Task key requested by the URL (/task/KEY) that is not yet resolved to an issue. */
  routeTaskKey: string | null;
  offlineOutbox: OfflineOutboxItem[];
  syncStatus: 'synced' | 'syncing' | 'offline';
  pendingSyncCount: number;
  syncError: string | null;
  connectionDetails: ConnectionDetails;
  setConnectionDetails: (details: Partial<ConnectionDetails>) => void;
  availableUsers: JiraUser[];
  authStatus: AuthStatus | null;
  isAuthRequired: boolean;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  setWsConnected: (connected: boolean) => void;
  checkAuthStatus: () => Promise<AuthStatus | null>;
  logout: () => Promise<void>;
  setActiveFilters: (filters: string[]) => void;
  toggleFilter: (filter: string) => void;
  setActiveFilter: (filter: string) => void;
  setSearchQuery: (query: string) => void;
  setCurrentUser: (userName: string) => void;
  setAccountType: (userName: string, type: AccountType) => Promise<void>;
  fetchAccountTypes: () => Promise<void>;
  openSettings: () => void;
  closeSettings: () => void;
  toggleShowChildren: () => void;
  toggleHideImages: () => void;
  setHideImages: (hide: boolean) => void;
  setErrorMessage: (msg: string | null) => void;
  setCurrentView: (view: DashboardView) => void;
  toggleBacklogExpandedOnBoard: () => void;
  setEditingIssue: (issue: JiraIssue | null) => void;
  openIssueByKey: (key: string) => Promise<void>;
  setCreateModalOpen: (open: boolean) => void;
  openCreateModal: (initialValues?: Partial<IssueCreatePayload>) => void;
  setConnectionModalOpen: (open: boolean) => void;
  /** Applies a URL route to UI state without touching browser history. */
  applyRoute: (route: Route) => void;
  /** Resolves a pending /task/KEY route once issues are available. */
  resolveRouteTask: () => void;
  moveToBacklog: (issueKey: string) => Promise<void>;
  moveToBoard: (issueKey: string) => Promise<void>;
  loadBoard: () => Promise<void>;
  fetchUsers: () => Promise<void>;
  transitionIssueOptimistic: (
    issueKey: string,
    targetCategory: JiraStatusCategory,
    targetStatus?: string
  ) => Promise<void>;
  markIssueDoneWithUndo: (
    issueKey: string,
    targetCategory?: JiraStatusCategory,
    targetStatus?: string,
    delayMs?: number
  ) => void;
  undoQuickDone: () => void;
  flushPendingQuickDone: () => Promise<void>;
  updateIssueOptimistic: (issueKey: string, updates: IssueUpdatePayload) => Promise<void>;
  createIssueOptimistic: (payload: IssueCreatePayload) => Promise<JiraIssue | null>;
  deleteIssueOptimistic: (issueKey: string) => Promise<void>;
  rankIssueOptimistic: (
    issueKey: string,
    rankBeforeKey?: string,
    rankAfterKey?: string,
    targetRank?: string
  ) => Promise<void>;
  flushOfflineQueue: () => Promise<void>;
  removePendingTransaction: (id: string) => void;
  clearLocalDataAndRefetch: () => Promise<void>;
  handleWsMessage: (data: unknown) => void;
}

const initialCache = loadCachedBoard();
const initialOutbox = loadCachedOutbox();
const initialRoute = getCurrentRoute();

async function syncTransitionToBackend(
  issueKey: string,
  originalIssue: JiraIssue,
  targetCategory: JiraStatusCategory,
  targetStatus: string | undefined,
  get: () => BoardStoreState,
  set: (fn: ((state: BoardStoreState) => Partial<BoardStoreState>) | Partial<BoardStoreState>) => void
) {
  try {
    const payload: { target_category: string; target_status?: string } = {
      target_category: targetCategory,
    };
    if (targetStatus) {
      payload.target_status = targetStatus;
    }

    const res = await fetch(getApiUrl(`/api/issues/${issueKey}/transition`), {
      method: 'POST',
      credentials: 'include',
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
    if (isServerRejectionError(err)) {
      set((state) => {
        const rollbackIssue = state.rollbackQueue[issueKey] || originalIssue;
        return {
          issues: state.issues.map((item) =>
            item.key === issueKey ? { ...rollbackIssue, _optimisticState: 'failed' } : item
          ),
          errorMessage: `Failed to transition ${issueKey}. Reverting to previous status.`,
        };
      });

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
}

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
  currentUser: loadCachedUser(),
  accountTypes: loadCachedAccountTypes(),
  showChildren: false,
  hideImages: loadCachedHideImages(),
  geminiConfigured: initialCache?.geminiConfigured ?? false,
  isSettingsOpen: initialRoute.kind === 'settings',
  errorMessage: null,
  rollbackQueue: {},
  currentView: initialRoute.kind === 'view' ? initialRoute.view : loadCachedView(),
  isBacklogExpandedOnBoard: false,
  editingIssue: null,
  isCreateModalOpen: initialRoute.kind === 'create',
  createInitialValues: null,
  isConnectionModalOpen: initialRoute.kind === 'status',
  pendingQuickDone: null,
  routeTaskKey: initialRoute.kind === 'task' ? initialRoute.key : null,
  offlineOutbox: initialOutbox,
  syncStatus: initialOutbox.length > 0 ? 'offline' : 'synced',
  pendingSyncCount: initialOutbox.length,
  syncError: null,
  connectionDetails: {
    lastError: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    nextRetryAt: null,
    retryAttempt: 0,
  },
  availableUsers: initialCache?.availableUsers || [],
  authStatus: null,
  isAuthRequired: false,

  checkAuthStatus: async () => {
    try {
      const res = await fetch(getApiUrl('/api/auth/config'), { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as AuthStatus;
        const isAuthRequired = data.authMode === 'gcp_oauth' && !data.authenticated;
        set({ authStatus: data, isAuthRequired });
        return data;
      }
    } catch {
      // offline or network error
    }
    return null;
  },

  logout: async () => {
    try {
      await fetch(getApiUrl('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore
    }
    set({
      authStatus: {
        authMode: 'gcp_oauth',
        googleClientId: get().authStatus?.googleClientId || null,
        authenticated: false,
        user: null,
      },
      isAuthRequired: true,
      issues: [],
    });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  },

  setCurrentUser: (userName: string) => {
    const trimmed = userName.trim();
    saveCachedUser(trimmed);
    set({ currentUser: trimmed });
  },

  setAccountType: async (userName: string, type: AccountType) => {
    const key = userName.trim().toLowerCase();
    if (!key) return;
    const previous = get().accountTypes;
    const next = { ...previous };
    if (type === 'child') next[key] = 'child';
    else delete next[key];
    // Optimistic update; the backend (shared SQL storage) is the source of truth.
    saveCachedAccountTypes(next);
    set({ accountTypes: next });
    try {
      const res = await fetch(getApiUrl('/api/account-types'), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: userName.trim(), account_type: type }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'network error';
      saveCachedAccountTypes(previous);
      set({
        accountTypes: previous,
        errorMessage: `Could not save account type for ${userName.trim()} (${reason}). Change reverted.`,
      });
    }
  },

  fetchAccountTypes: async () => {
    try {
      const res = await fetch(getApiUrl('/api/account-types'), { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { account_types?: Record<string, string> };
        if (data && data.account_types && typeof data.account_types === 'object') {
          const types: AccountTypes = {};
          for (const [k, v] of Object.entries(data.account_types)) {
            if (v === 'child') types[k] = 'child';
          }
          saveCachedAccountTypes(types);
          set({ accountTypes: types });
        }
      }
    } catch {
      // offline: keep locally cached account types
    }
  },

  openSettings: () => {
    pushRoute({ kind: 'settings' });
    set({ isSettingsOpen: true, editingIssue: null, routeTaskKey: null, isCreateModalOpen: false });
  },

  closeSettings: () => {
    const wasOpen = get().isSettingsOpen;
    set({ isSettingsOpen: false });
    if (wasOpen) closeOverlayRoute({ kind: 'view', view: get().currentView });
  },

  toggleShowChildren: () => {
    set((state) => ({ showChildren: !state.showChildren }));
  },

  toggleHideImages: () => {
    set((state) => {
      const next = !state.hideImages;
      saveCachedHideImages(next);
      return { hideImages: next };
    });
  },

  setHideImages: (hide: boolean) => {
    saveCachedHideImages(hide);
    set({ hideImages: hide });
  },

  setEditingIssue: (issue: JiraIssue | null) => {
    if (issue) {
      pushRoute({ kind: 'task', key: issue.key });
      set({
        editingIssue: issue,
        routeTaskKey: issue.key,
        isCreateModalOpen: false,
        isConnectionModalOpen: false,
      });
    } else {
      const wasOpen = Boolean(get().editingIssue) || get().routeTaskKey !== null;
      set({ editingIssue: null, routeTaskKey: null });
      if (wasOpen) closeOverlayRoute({ kind: 'view', view: get().currentView });
    }
  },

  openIssueByKey: async (key: string) => {
    const { issues } = get();
    const existing = issues.find((i) => i.key === key);
    if (existing) {
      get().setEditingIssue(existing);
      return;
    }
    pushRoute({ kind: 'task', key });
    set({ routeTaskKey: key });
    try {
      const res = await fetch(getApiUrl(`/api/issues/${encodeURIComponent(key)}`), {
        credentials: 'include',
      });
      if (res.ok) {
        const fetched: JiraIssue = await res.json();
        get().setEditingIssue(fetched);
      } else {
        get().resolveRouteTask();
      }
    } catch {
      get().resolveRouteTask();
    }
  },

  openCreateModal: (initialValues?: Partial<IssueCreatePayload>) => {
    pushRoute({ kind: 'create' });
    set({
      isCreateModalOpen: true,
      createInitialValues: initialValues || null,
      editingIssue: null,
      routeTaskKey: null,
      isConnectionModalOpen: false,
    });
  },

  setCreateModalOpen: (open: boolean) => {
    if (open) {
      pushRoute({ kind: 'create' });
      set({
        isCreateModalOpen: true,
        createInitialValues: null,
        editingIssue: null,
        routeTaskKey: null,
        isConnectionModalOpen: false,
      });
    } else {
      const wasOpen = get().isCreateModalOpen;
      set({ isCreateModalOpen: false, createInitialValues: null });
      if (wasOpen) closeOverlayRoute({ kind: 'view', view: get().currentView });
    }
  },

  setConnectionModalOpen: (open: boolean) => {
    if (open) {
      pushRoute({ kind: 'status' });
      set({
        isConnectionModalOpen: true,
        editingIssue: null,
        routeTaskKey: null,
        isCreateModalOpen: false,
      });
    } else {
      const wasOpen = get().isConnectionModalOpen;
      set({ isConnectionModalOpen: false });
      if (wasOpen) closeOverlayRoute({ kind: 'view', view: get().currentView });
    }
  },

  setCurrentView: (view: DashboardView) => {
    saveCachedView(view);
    pushRoute({ kind: 'view', view });
    set({
      currentView: view,
      editingIssue: null,
      routeTaskKey: null,
      isCreateModalOpen: false,
      isConnectionModalOpen: false,
      isSettingsOpen: false,
    });
  },

  applyRoute: (route: Route) => {
    if (route.kind === 'settings') {
      set({
        isSettingsOpen: true,
        isConnectionModalOpen: false,
        editingIssue: null,
        routeTaskKey: null,
        isCreateModalOpen: false,
      });
    } else if (route.kind === 'status') {
      set({
        isConnectionModalOpen: true,
        isSettingsOpen: false,
        isCreateModalOpen: false,
        editingIssue: null,
        routeTaskKey: null,
      });
    } else if (route.kind === 'task') {
      set({
        routeTaskKey: route.key,
        isCreateModalOpen: false,
        isConnectionModalOpen: false,
        isSettingsOpen: false,
        editingIssue: null,
      });
      get().resolveRouteTask();
    } else if (route.kind === 'create') {
      set({
        isCreateModalOpen: true,
        isConnectionModalOpen: false,
        isSettingsOpen: false,
        editingIssue: null,
        routeTaskKey: null,
      });
    } else if (route.kind === 'view') {
      saveCachedView(route.view);
      set({
        currentView: route.view,
        editingIssue: null,
        routeTaskKey: null,
        isCreateModalOpen: false,
        isConnectionModalOpen: false,
        isSettingsOpen: false,
      });
    } else {
      // Root: show the last used view, with no overlays.
      const view = loadCachedView();
      replaceRoute({ kind: 'view', view });
      set({
        currentView: view,
        editingIssue: null,
        routeTaskKey: null,
        isCreateModalOpen: false,
        isConnectionModalOpen: false,
        isSettingsOpen: false,
      });
    }
  },

  resolveRouteTask: () => {
    const { routeTaskKey, editingIssue, issues, isLoading, currentView } = get();
    if (!routeTaskKey || editingIssue?.key === routeTaskKey) return;
    const found = issues.find((i) => i.key === routeTaskKey);
    if (found) {
      set({ editingIssue: found });
    } else if (!isLoading && issues.length > 0) {
      // Unknown task: fall back to the current view instead of leaving a dead URL.
      set({ routeTaskKey: null });
      replaceRoute({ kind: 'view', view: currentView });
    }
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

  setConnectionDetails: (details: Partial<ConnectionDetails>) => {
    set((state) => ({ connectionDetails: { ...state.connectionDetails, ...details } }));
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
    // Fetch users in parallel
    get().fetchUsers().catch(() => {});
    get().fetchAccountTypes().catch(() => {});
    try {
      const res = await fetch(getApiUrl('/api/board'), { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const nextState: CachedBoardData = {
          boardName: data.board_name || 'Engineering Sprint Board',
          sprintName: data.sprint_name || '',
          jiraUrl: data.jira_url || 'https://jira.example.com',
          columns: data.columns && data.columns.length > 0 ? data.columns : DEFAULT_COLUMNS,
          issues: sortIssuesByRank(data.issues || []),
          availableUsers: get().availableUsers,
          geminiConfigured: Boolean(data.gemini_configured),
        };
        saveCachedBoard(nextState);
        set({
          ...nextState,
          geminiConfigured: Boolean(data.gemini_configured),
          errorMessage: null,
          isLoading: false,
          isSyncing: false,
          isAuthRequired: false,
        });
      } else {
        const err = await res.json().catch(() => ({}));
        if (res.status === 401) {
          set({
            isAuthRequired: true,
            errorMessage: null,
            isLoading: false,
            isSyncing: false,
          });
          return;
        }
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

  fetchUsers: async () => {
    try {
      const res = await fetch(getApiUrl('/api/users'), { credentials: 'include' });
      if (res.ok) {
        const users: JiraUser[] = await res.json();
        if (Array.isArray(users)) {
          set({ availableUsers: users });
          const cached = loadCachedBoard();
          if (cached) {
            saveCachedBoard({ ...cached, availableUsers: users });
          }
        }
      }
    } catch {
      // offline / quiet ignore
    }
  },

  transitionIssueOptimistic: async (
    issueKey: string,
    targetCategory: JiraStatusCategory,
    targetStatus?: string
  ) => {
    // If this issue has a pending quick done, clear it since we are transitioning now
    const pending = get().pendingQuickDone;
    if (pending && pending.issueKey === issueKey) {
      clearTimeout(pending.timeoutId);
      set({ pendingQuickDone: null });
    }

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
    await syncTransitionToBackend(
      issueKey,
      originalIssue,
      targetCategory,
      targetStatus,
      get,
      set
    );
  },

  markIssueDoneWithUndo: (
    issueKey: string,
    targetCategory: JiraStatusCategory = 'done',
    targetStatus?: string,
    delayMs = 5000
  ) => {
    // 0. If previous pending exists, flush it immediately to backend
    const existing = get().pendingQuickDone;
    if (existing) {
      clearTimeout(existing.timeoutId);
      void syncTransitionToBackend(
        existing.issueKey,
        existing.originalIssue,
        existing.targetCategory,
        existing.targetStatus,
        get,
        set
      );
    }

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

    // 2. Schedule delayed backend sync
    const timeoutId = setTimeout(async () => {
      const current = get().pendingQuickDone;
      if (current && current.issueKey === issueKey) {
        set({ pendingQuickDone: null });
        await syncTransitionToBackend(
          issueKey,
          originalIssue,
          targetCategory,
          targetStatus,
          get,
          set
        );
      }
    }, delayMs);

    set({
      issues: updatedIssues,
      rollbackQueue: { ...rollbackQueue, [issueKey]: originalIssue },
      pendingQuickDone: {
        issueKey,
        originalIssue,
        timeoutId,
        targetCategory,
        targetStatus,
        startTime: Date.now(),
        durationMs: delayMs,
      },
    });
    persistCurrentBoardState(get);
  },

  undoQuickDone: () => {
    const pending = get().pendingQuickDone;
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    const { issueKey, originalIssue } = pending;
    set((state) => ({
      issues: state.issues.map((item) => (item.key === issueKey ? originalIssue : item)),
      pendingQuickDone: null,
    }));
    persistCurrentBoardState(get);
  },

  flushPendingQuickDone: async () => {
    const pending = get().pendingQuickDone;
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    set({ pendingQuickDone: null });
    await syncTransitionToBackend(
      pending.issueKey,
      pending.originalIssue,
      pending.targetCategory,
      pending.targetStatus,
      get,
      set
    );
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
      if (!updates.assignee_name || updates.assignee_name.trim() === '') {
        newAssignee = null;
      } else {
        const matchingUser = get().availableUsers?.find(
          (u) =>
            (u.displayName || u.display_name)?.toLowerCase() ===
            updates.assignee_name?.trim().toLowerCase()
        );
        newAssignee = {
          accountId:
            updates.assignee_account_id ??
            matchingUser?.accountId ??
            matchingUser?.account_id ??
            originalIssue.assignee?.accountId,
          displayName: updates.assignee_name.trim(),
          avatarUrl:
            matchingUser?.avatarUrl ||
            matchingUser?.avatar_url ||
            originalIssue.assignee?.avatarUrl,
        };
      }
    } else if (updates.assignee_account_id !== undefined && originalIssue.assignee) {
      newAssignee = {
        ...originalIssue.assignee,
        accountId: updates.assignee_account_id ?? undefined,
      };
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

    const wasEditing = Boolean(get().editingIssue) || get().routeTaskKey !== null;
    set({
      issues: updatedIssues,
      rollbackQueue: { ...rollbackQueue, [issueKey]: originalIssue },
      editingIssue: null,
      routeTaskKey: null,
    });
    if (wasEditing) closeOverlayRoute({ kind: 'view', view: get().currentView });
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
        credentials: 'include',
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
      if (isServerRejectionError(err)) {
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
    const { columns, issues } = get();

    // 1. Instant Optimistic State Mutation (< 50ms)
    const tempKey = `TEMP-${Date.now()}`;
    const targetCategory = payload.status_category || 'todo';
    const targetStatusName = payload.status_name || CATEGORY_TITLES[targetCategory] || 'To Do';

    const targetCol = columns.find(
      (c) =>
        (payload.status_name && c.name.trim().toLowerCase() === payload.status_name.trim().toLowerCase()) ||
        c.category === targetCategory
    );
    const targetStatusId =
      payload.status_id || targetCol?.status_ids?.[0] || targetCol?.id || `col-${targetCategory}`;

    // Calculate highest rank so new task appears at the top of the list
    const realIssues = issues.filter(
      (i) => !i.key.startsWith('TEMP-') && !i.key.includes('-TEMP-')
    );
    const topReal = realIssues.length > 0 ? realIssues[0] : null;
    let topIssueKey: string | null = topReal?.key || null;

    const rankedIssues = issues.filter((i) => Boolean(i.rank));
    let topRank: string = '0|i00001:';
    if (rankedIssues.length > 0) {
      const sortedRanks = [...rankedIssues].sort((a, b) => (a.rank! < b.rank! ? -1 : 1));
      topRank = calculateRankBetween(null, sortedRanks[0].rank);
      const topRankedReal = sortedRanks.find(
        (i) => !i.key.startsWith('TEMP-') && !i.key.includes('-TEMP-')
      );
      if (topRankedReal) {
        topIssueKey = topRankedReal.key;
      }
    }

    const matchingUser = get().availableUsers?.find(
      (u) =>
        (u.displayName || u.display_name)?.toLowerCase() ===
        payload.assignee_name?.trim().toLowerCase()
    );
    const resolvedAccountId =
      payload.assignee_account_id ||
      matchingUser?.accountId ||
      matchingUser?.account_id ||
      undefined;

    const newAssignee = payload.assignee_name?.trim()
      ? {
          accountId: resolvedAccountId || 'usr-1',
          displayName: payload.assignee_name.trim(),
          avatarUrl: matchingUser?.avatarUrl || matchingUser?.avatar_url,
        }
      : null;

    const tempIssue: JiraIssue = {
      id: tempKey,
      key: tempKey,
      summary: payload.summary,
      description: payload.description || null,
      issue_type: payload.issue_type || 'task',
      priority: payload.priority || 'medium',
      status: {
        id: targetStatusId,
        name: targetStatusName,
        category: targetCategory,
      },
      assignee: newAssignee,
      story_points: payload.story_points,
      due_date: payload.due_date,
      start_date: payload.start_date,
      recreate_after: payload.recreate_after,
      rank: topRank,
      _optimisticState: 'pending',
    };

    const finalPayload: IssueCreatePayload = {
      ...payload,
      assignee_account_id: resolvedAccountId || payload.assignee_account_id || undefined,
      status_id: targetStatusId,
      rank: topRank,
      target_rank: topRank,
      rank_before_key: payload.rank_before_key || topIssueKey,
    };

    const wasCreating = get().isCreateModalOpen;
    set((state) => ({
      issues: sortIssuesByRank([tempIssue, ...state.issues]),
      isCreateModalOpen: false,
      createInitialValues: null,
    }));
    if (wasCreating) closeOverlayRoute({ kind: 'view', view: get().currentView });
    persistCurrentBoardState(get);

    // 2. Background Asynchronous Sync to Backend
    try {
      const res = await fetch(getApiUrl('/api/issues'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalPayload),
      });

      if (!res.ok) {
        throw new ServerRejectionError(`Server returned ${res.status}`);
      }

      const created: JiraIssue = await res.json();
      let createdRank = created.rank;
      if (!createdRank || (topRank && createdRank > topRank)) {
        createdRank = topRank;
      }
      const finalCreated: JiraIssue = {
        ...created,
        rank: createdRank,
        _optimisticState: 'synced',
      };

      set((state) => {
        const withoutTemp = state.issues.filter((item) => item.key !== tempKey);
        const alreadyHasCreated = withoutTemp.some((item) => item.key === finalCreated.key);
        if (alreadyHasCreated) {
          return {
            issues: sortIssuesByRank(
              withoutTemp.map((item) =>
                item.key === finalCreated.key ? finalCreated : item
              )
            ),
          };
        }
        return {
          issues: sortIssuesByRank(
            state.issues.map((item) =>
              item.key === tempKey ? finalCreated : item
            )
          ),
        };
      });
      persistCurrentBoardState(get);
      return finalCreated;
    } catch (err) {
      if (isServerRejectionError(err)) {
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
          payload: { ...finalPayload },
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

  deleteIssueOptimistic: async (issueKey: string) => {
    const { issues, rollbackQueue } = get();
    const originalIssue = issues.find((i) => i.key === issueKey);
    if (!originalIssue) return;

    // 1. Instant optimistic state removal (< 50ms)
    const nextIssues = issues.filter((i) => i.key !== issueKey);
    const nextEditing = get().editingIssue?.key === issueKey ? null : get().editingIssue;
    const nextRoute = get().routeTaskKey === issueKey ? null : get().routeTaskKey;

    set({
      issues: nextIssues,
      editingIssue: nextEditing,
      routeTaskKey: nextRoute,
      rollbackQueue: { ...rollbackQueue, [issueKey]: originalIssue },
    });
    persistCurrentBoardState(get);

    // 2. Perform async delete request
    try {
      const res = await fetch(getApiUrl(`/api/issues/${issueKey}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      // Success: clear rollback entry
      const currentRollback = { ...get().rollbackQueue };
      delete currentRollback[issueKey];
      set({ rollbackQueue: currentRollback });
    } catch (err: any) {
      // Check if network offline
      const isNetworkError =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        err.message === 'Failed to fetch' ||
        err.name === 'TypeError' ||
        err.message?.includes('offline') ||
        err.message?.includes('Network');

      if (isNetworkError) {
        const outboxItem: OfflineOutboxItem = {
          id: `del-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          action: 'delete_issue',
          issueKey,
          payload: {},
          createdAt: Date.now(),
        };
        const updatedOutbox = [...get().offlineOutbox, outboxItem];
        saveCachedOutbox(updatedOutbox);
        set({
          offlineOutbox: updatedOutbox,
          pendingSyncCount: updatedOutbox.length,
          syncStatus: 'offline',
        });
        return;
      }

      // Real failure -> rollback
      const currentRollback = { ...get().rollbackQueue };
      const issueToRestore = currentRollback[issueKey];
      delete currentRollback[issueKey];
      if (issueToRestore) {
        set({
          issues: sortIssuesByRank([...get().issues, issueToRestore]),
          rollbackQueue: currentRollback,
          errorMessage: `Failed to delete issue ${issueKey}: ${err.message || 'Server error'}`,
        });
        persistCurrentBoardState(get);
      }
    }
  },

  rankIssueOptimistic: async (
    issueKey: string,
    rankBeforeKey?: string,
    rankAfterKey?: string,
    targetRank?: string
  ) => {
    const { issues, rollbackQueue } = get();
    const originalIssue = issues.find((i) => i.key === issueKey);
    if (!originalIssue) return;

    // 1. Instant Optimistic State Mutation (< 50ms)
    const newRank = targetRank || originalIssue.rank || '0|i00001:';

    const updatedIssues = sortIssuesByRank(
      issues.map((item) =>
        item.key === issueKey
          ? {
              ...item,
              rank: newRank,
              _optimisticState: 'pending' as const,
            }
          : item
      )
    );

    set({
      issues: updatedIssues,
      rollbackQueue: { ...rollbackQueue, [issueKey]: originalIssue },
    });
    persistCurrentBoardState(get);

    // 2. Background Asynchronous Sync to Backend & Jira
    try {
      const payload: Record<string, any> = {};
      if (rankBeforeKey !== undefined) payload.rank_before_key = rankBeforeKey;
      if (rankAfterKey !== undefined) payload.rank_after_key = rankAfterKey;
      if (targetRank !== undefined) {
        payload.target_rank = targetRank;
        payload.rank = targetRank;
      }

      const res = await fetch(getApiUrl(`/api/issues/${issueKey}/rank`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new ServerRejectionError(`Server returned ${res.status}`);
      }

      const updated = await res.json();
      set((state) => ({
        issues: sortIssuesByRank(
          state.issues.map((item) =>
            item.key === issueKey
              ? {
                  ...item,
                  ...updated,
                  rank: updated.rank || newRank,
                  _optimisticState: 'synced',
                }
              : item
          )
        ),
        rollbackQueue: Object.fromEntries(
          Object.entries(state.rollbackQueue).filter(([k]) => k !== issueKey)
        ),
      }));
      persistCurrentBoardState(get);
    } catch (err) {
      if (isServerRejectionError(err)) {
        // 3. Graceful Rollback on Server Rejection
        set((state) => ({
          issues: sortIssuesByRank(
            state.issues.map((item) => (item.key === issueKey ? originalIssue : item))
          ),
          errorMessage: `Failed to rank issue ${issueKey}. Reverting to previous position.`,
          rollbackQueue: Object.fromEntries(
            Object.entries(state.rollbackQueue).filter(([k]) => k !== issueKey)
          ),
        }));

        setTimeout(() => {
          if (get().errorMessage?.includes(issueKey)) {
            set({ errorMessage: null });
          }
        }, 5000);
      } else {
        // Network failure / offline: keep optimistic state and queue rank action
        const outboxItem: OfflineOutboxItem = {
          id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          action: 'rank_issue',
          issueKey,
          payload: {
            rank_before_key: rankBeforeKey,
            rank_after_key: rankAfterKey,
            target_rank: targetRank,
            rank: targetRank,
          },
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

  flushOfflineQueue: async () => {
    const currentQueue = [...get().offlineOutbox];
    if (currentQueue.length === 0) {
      set({ syncStatus: 'synced', pendingSyncCount: 0 });
      return;
    }

    set({ syncStatus: 'syncing', syncError: null });
    const remainingOutbox = [...currentQueue];

    for (const item of currentQueue) {
      try {
        let res: Response;
        if (item.action === 'transition_issue' && item.issueKey) {
          res = await fetch(getApiUrl(`/api/issues/${item.issueKey}/transition`), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
        } else if (item.action === 'update_issue' && item.issueKey) {
          res = await fetch(getApiUrl(`/api/issues/${item.issueKey}`), {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
        } else if (item.action === 'rank_issue' && item.issueKey) {
          res = await fetch(getApiUrl(`/api/issues/${item.issueKey}/rank`), {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
        } else if (item.action === 'create_issue') {
          res = await fetch(getApiUrl('/api/issues'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
        } else if (item.action === 'delete_issue' && item.issueKey) {
          res = await fetch(getApiUrl(`/api/issues/${item.issueKey}`), {
            method: 'DELETE',
            credentials: 'include',
          });
        } else {
          const idx = remainingOutbox.findIndex((it) => it.id === item.id);
          if (idx !== -1) remainingOutbox.splice(idx, 1);
          continue;
        }

        if (res.ok) {
          if (item.action === 'delete_issue') {
            set((state) => ({
              issues: state.issues.filter((i) => i.key !== item.issueKey),
              editingIssue: state.editingIssue?.key === item.issueKey ? null : state.editingIssue,
            }));
          } else {
            const remoteIssue: JiraIssue = await res.json();
            set((state) => {
              if (item.action === 'create_issue' && item.issueKey) {
                const withoutTemp = state.issues.filter((i) => i.key !== item.issueKey);
                const exists = withoutTemp.some((i) => i.key === remoteIssue.key);
                if (exists) {
                  return {
                    issues: sortIssuesByRank(
                      withoutTemp.map((i) =>
                        i.key === remoteIssue.key ? { ...remoteIssue, _optimisticState: 'synced' } : i
                      )
                    ),
                  };
                }
                return {
                  issues: sortIssuesByRank(
                    state.issues.map((i) =>
                      i.key === item.issueKey ? { ...remoteIssue, _optimisticState: 'synced' } : i
                    )
                  ),
                };
              } else {
                return {
                  issues: sortIssuesByRank(
                    state.issues.map((i) =>
                      i.key === (item.issueKey || remoteIssue.key)
                        ? { ...remoteIssue, _optimisticState: 'synced' }
                        : i
                    )
                  ),
                };
              }
            });
          }
        } else {
          // Server rejected or conflict: adopt remote state if returned
          try {
            const body = await res.json();
            if (body && body.key && body.status) {
              set((state) => ({
                issues: sortIssuesByRank(
                  state.issues.map((i) =>
                    i.key === body.key ? { ...body, _optimisticState: 'synced' } : i
                  )
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
      } catch (err) {
        // Network fetch error: still offline! Stop draining queue.
        saveCachedOutbox(remainingOutbox);
        set({
          syncError: err instanceof Error ? err.message : 'Network request failed',
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

  removePendingTransaction: (id: string) => {
    const currentOutbox = get().offlineOutbox;
    const targetItem = currentOutbox.find((it) => it.id === id);
    if (!targetItem) return;

    const remainingOutbox = currentOutbox.filter((it) => it.id !== id);
    saveCachedOutbox(remainingOutbox);

    const issueKey = targetItem.issueKey;
    const hasOtherPendingForIssue = issueKey
      ? remainingOutbox.some((it) => it.issueKey === issueKey)
      : false;

    set((state) => {
      let nextIssues = state.issues;
      const nextRollbackQueue = { ...state.rollbackQueue };

      if (targetItem.action === 'create_issue' && issueKey) {
        nextIssues = state.issues.filter((i) => i.key !== issueKey);
        delete nextRollbackQueue[issueKey];
      } else if (issueKey && !hasOtherPendingForIssue) {
        if (state.rollbackQueue[issueKey]) {
          const original = state.rollbackQueue[issueKey];
          nextIssues = state.issues.map((i) =>
            i.key === issueKey
              ? { ...original, _optimisticState: 'synced' as const, _pendingTargetStatusId: undefined }
              : i
          );
          delete nextRollbackQueue[issueKey];
        } else {
          nextIssues = state.issues.map((i) =>
            i.key === issueKey
              ? { ...i, _optimisticState: 'synced' as const, _pendingTargetStatusId: undefined }
              : i
          );
        }
      }

      const nextSyncStatus =
        remainingOutbox.length === 0
          ? state.wsConnected
            ? 'synced'
            : 'offline'
          : state.syncStatus;

      return {
        issues: sortIssuesByRank(nextIssues),
        rollbackQueue: nextRollbackQueue,
        offlineOutbox: remainingOutbox,
        pendingSyncCount: remainingOutbox.length,
        syncStatus: nextSyncStatus,
      };
    });

    persistCurrentBoardState(get);
  },

  clearLocalDataAndRefetch: async () => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LOCAL_STORAGE_OUTBOX_KEY);
      window.localStorage.removeItem(LOCAL_STORAGE_BOARD_CACHE_KEY);
    }
    set({
      offlineOutbox: [],
      pendingSyncCount: 0,
      rollbackQueue: {},
      syncError: null,
      syncStatus: get().wsConnected ? 'synced' : 'offline',
    });
    await get().loadBoard();
  },

  handleWsMessage: (data: unknown) => {
    if (!data || typeof data !== 'object') return;
    const msg = data as Record<string, unknown>;

    if (msg.event === 'account_types_updated' && msg.account_types) {
      const types: AccountTypes = {};
      for (const [k, v] of Object.entries(msg.account_types as Record<string, unknown>)) {
        if (v === 'child') types[k] = 'child';
      }
      saveCachedAccountTypes(types);
      set({ accountTypes: types });
      return;
    }

    if (msg.event === 'issue_created' && msg.issue) {
      const incomingIssue = msg.issue as JiraIssue;
      const tempKey = typeof msg.temp_key === 'string' ? msg.temp_key : null;
      set((state) => {
        let tempIndex = -1;
        if (tempKey) {
          tempIndex = state.issues.findIndex((i) => i.key === tempKey);
        }
        if (tempIndex === -1) {
          tempIndex = state.issues.findIndex(
            (i) =>
              (i.key.startsWith('TEMP-') || i.key.includes('-TEMP-')) &&
              i.summary === incomingIssue.summary
          );
        }

        // Add assignee to availableUsers if not present
        let nextUsers = state.availableUsers;
        if (incomingIssue.assignee) {
          const accId = incomingIssue.assignee.accountId || incomingIssue.assignee.account_id;
          const dispName = incomingIssue.assignee.displayName || incomingIssue.assignee.display_name;
          const userExists = state.availableUsers.some((u) => {
            const uId = u.accountId || u.account_id;
            const uName = u.displayName || u.display_name;
            return (accId && uId === accId) || (dispName && uName === dispName);
          });
          if (!userExists && (accId || dispName)) {
            nextUsers = [...state.availableUsers, incomingIssue.assignee];
          }
        }

        let newEditingIssue = state.editingIssue;
        if (state.routeTaskKey && state.routeTaskKey === incomingIssue.key) {
          newEditingIssue = incomingIssue;
        }

        if (tempIndex !== -1) {
          const tempIssue = state.issues[tempIndex];
          let finalRank = incomingIssue.rank;
          if (!finalRank || (tempIssue.rank && finalRank > tempIssue.rank)) {
            finalRank = tempIssue.rank;
          }
          const updatedList = [...state.issues];
          updatedList[tempIndex] = {
            ...incomingIssue,
            rank: finalRank,
            _optimisticState: 'synced',
          };
          const deduped = updatedList.filter(
            (item, idx) => idx === tempIndex || item.key !== incomingIssue.key
          );
          return {
            issues: sortIssuesByRank(deduped),
            availableUsers: nextUsers,
            editingIssue: newEditingIssue,
          };
        }

        const exists = state.issues.some((i) => i.key === incomingIssue.key);
        if (exists) {
          return {
            issues: sortIssuesByRank(
              state.issues.map((item) =>
                item.key === incomingIssue.key ? { ...incomingIssue, _optimisticState: 'synced' } : item
              )
            ),
            availableUsers: nextUsers,
            editingIssue: newEditingIssue,
          };
        }
        return {
          issues: sortIssuesByRank([incomingIssue, ...state.issues]),
          availableUsers: nextUsers,
          editingIssue: newEditingIssue,
        };
      });
      persistCurrentBoardState(get);
    } else if (
      (msg.event === 'issue_transitioned' ||
        msg.event === 'issue_updated' ||
        msg.event === 'issue_ranked') &&
      msg.issue
    ) {
      const incomingIssue = msg.issue as JiraIssue;
      set((state) => {
        const exists = state.issues.some((item) => item.key === incomingIssue.key);
        if (!exists) {
          return { issues: sortIssuesByRank([incomingIssue, ...state.issues]) };
        }
        return {
          issues: sortIssuesByRank(
            state.issues.map((item) =>
              item.key === incomingIssue.key ? { ...incomingIssue, _optimisticState: 'synced' } : item
            )
          ),
        };
      });
      persistCurrentBoardState(get);
    } else if (msg.event === 'issue_deleted' && msg.issue_key) {
      set((state) => ({
        issues: state.issues.filter((item) => item.key !== msg.issue_key),
        editingIssue: state.editingIssue?.key === msg.issue_key ? null : state.editingIssue,
        routeTaskKey: state.routeTaskKey === msg.issue_key ? null : state.routeTaskKey,
      }));
      persistCurrentBoardState(get);
    } else if (msg.event === 'board_synced' && Array.isArray(msg.issues)) {
      set({ issues: sortIssuesByRank(msg.issues as JiraIssue[]) });
      persistCurrentBoardState(get);
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
