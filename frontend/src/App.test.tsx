import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { useBoardStore } from './store/boardStore.ts';
import { JiraIssue } from './types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testIssue: JiraIssue = {
  id: '101',
  key: 'PROJ-101',
  summary: 'Setup CI/CD pipeline',
  priority: 'high',
  status: { id: 'col-todo', name: 'To Do', category: 'todo' },
  updated_at: '2026-10-05T00:00:00Z',
};

describe('App component loading indicator & board rendering', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.restoreAllMocks();
    act(() => {
      useBoardStore.setState({
        isLoading: true,
        boardName: '',
        sprintName: '',
        issues: [],
        errorMessage: null,
      });
    });
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})); // pending promise
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders loading progress indicator while board data is loading', async () => {
    // Return pending promise so it stays loading
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    act(() => {
      useBoardStore.setState({
        isLoading: true,
        boardName: '',
        sprintName: '',
        issues: [],
      });
    });

    await act(async () => {
      root.render(<App />);
    });

    // Verify progress indicator is rendered
    const loader = container.querySelector('[data-testid="loading-indicator"]');
    expect(loader).not.toBeNull();
    expect(container.textContent).toContain('Loading board data...');
    expect(container.textContent).toContain('Connecting to Jira and fetching active sprint issues...');

    // Verify hardcoded sample titles/data are NOT visible during loading
    expect(container.textContent).not.toContain('Engineering Sprint Board');
    expect(container.textContent).not.toContain('Active Sprint 42');
  });

  it('renders board header, filters, and columns once loading completes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        board_name: 'Engineering Sprint Board',
        sprint_name: 'Active Sprint 42',
        columns: [],
        issues: [testIssue],
      }),
    });

    await act(async () => {
      root.render(<App />);
    });

    expect(container.querySelector('[data-testid="loading-indicator"]')).toBeNull();
    expect(container.textContent).toContain('Engineering Sprint Board');
    expect(container.textContent).toContain('Active Sprint 42');
    expect(container.textContent).toContain('Setup CI/CD pipeline');
  });

  it('renders error state with retry button when initial board loading fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Unable to connect to Jira backend server.' }),
    });

    await act(async () => {
      root.render(<App />);
    });

    expect(container.textContent).toContain('Failed to load board');
    expect(container.textContent).toContain('Unable to connect to Jira backend server.');
    const retryBtn = container.querySelector('button');
    expect(retryBtn).not.toBeNull();
    expect(retryBtn?.textContent).toContain('Retry');
  });

  it('renders board immediately without loading screen when issues are already cached', async () => {
    // Pending fetch to simulate background revalidation
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    act(() => {
      useBoardStore.setState({
        isLoading: false,
        isSyncing: true,
        boardName: 'Engineering Sprint Board',
        sprintName: 'Active Sprint 42',
        issues: [testIssue],
      });
    });

    await act(async () => {
      root.render(<App />);
    });

    // Verify loading indicator is NOT shown
    expect(container.querySelector('[data-testid="loading-indicator"]')).toBeNull();
    // Verify board is immediately rendered
    expect(container.textContent).toContain('Engineering Sprint Board');
    expect(container.textContent).toContain('Setup CI/CD pipeline');
  });

  it('renders board immediately without loading screen when boardName is cached even if issues are empty', async () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    act(() => {
      useBoardStore.setState({
        isLoading: false,
        isSyncing: true,
        boardName: 'Engineering Sprint Board',
        sprintName: 'Active Sprint 42',
        issues: [],
      });
    });

    await act(async () => {
      root.render(<App />);
    });

    expect(container.querySelector('[data-testid="loading-indicator"]')).toBeNull();
    expect(container.textContent).toContain('Engineering Sprint Board');
  });

  it('keeps cached board rendered without error banner when background sync encounters network failure', async () => {
    // Network fetch fails (offline)
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    act(() => {
      useBoardStore.setState({
        isLoading: false,
        isSyncing: false,
        boardName: 'Engineering Sprint Board',
        sprintName: 'Active Sprint 42',
        issues: [testIssue],
        syncStatus: 'synced',
        errorMessage: null,
      });
    });

    await act(async () => {
      root.render(<App />);
    });

    // Verify loading indicator is NOT shown and cached data is visible
    expect(container.querySelector('[data-testid="loading-indicator"]')).toBeNull();
    expect(container.textContent).toContain('Engineering Sprint Board');
    expect(container.textContent).toContain('Setup CI/CD pipeline');

    // Verify syncStatus became offline and no disruptive error banner is shown
    expect(useBoardStore.getState().syncStatus).toBe('offline');
    expect(useBoardStore.getState().errorMessage).toBeNull();
    expect(container.textContent).not.toContain('Unable to connect to Jira backend server.');
  });

  it('renders UndoSnackbar when pendingQuickDone is present', async () => {
    act(() => {
      useBoardStore.setState({
        isLoading: false,
        boardName: 'Engineering Sprint Board',
        issues: [testIssue],
        pendingQuickDone: {
          issueKey: 'PROJ-101',
          originalIssue: testIssue,
          timeoutId: 100 as unknown as ReturnType<typeof setTimeout>,
          targetCategory: 'done',
          targetStatus: 'Done',
          startTime: Date.now(),
          durationMs: 5000,
        },
      });
    });

    await act(async () => {
      root.render(<App />);
    });

    const snackbar = container.querySelector('[data-testid="undo-snackbar"]');
    expect(snackbar).not.toBeNull();
    expect(snackbar?.textContent).toContain('PROJ-101');
    expect(snackbar?.textContent).toContain('Undo');
  });

  it('renders loading state within task details modal on direct task URL, then displays task upon sync', async () => {
    window.history.replaceState(null, '', '/task/PROJ-101');

    let resolveFetchBoard!: (val: unknown) => void;
    global.fetch = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveFetchBoard = resolve;
    }));

    act(() => {
      useBoardStore.setState({
        routeTaskKey: 'PROJ-101',
        routeTaskStatus: 'loading',
        editingIssue: null,
        isLoading: true,
        initialSyncCompleted: false,
      });
    });

    await act(async () => {
      root.render(<App />);
    });

    // Verify task details modal is open with loading screen
    const loadingScreen = container.querySelector('[data-testid="task-sync-loading"]');
    expect(loadingScreen).not.toBeNull();
    expect(container.textContent).toContain('PROJ-101');

    // Simulate board sync finishing with PROJ-101
    await act(async () => {
      resolveFetchBoard({
        ok: true,
        json: async () => ({
          board_name: 'Engineering Sprint Board',
          sprint_name: 'Active Sprint 42',
          columns: [],
          issues: [testIssue],
        }),
      });
    });

    // Flush store update
    await act(async () => {
      useBoardStore.getState().resolveRouteTask();
    });

    expect(container.querySelector('[data-testid="task-sync-loading"]')).toBeNull();
    const summaryInput = container.querySelector('#edit-summary') as HTMLInputElement;
    expect(summaryInput?.value).toBe('Setup CI/CD pipeline');
  });

  it('triggers flushOfflineQueue on websocket open when pending offline items exist', async () => {
    let wsInstance: any = null;
    class MockWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: any) => void) | null = null;
      onclose: ((event: any) => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor() {
        wsInstance = this;
      }
    }
    const originalWebSocket = global.WebSocket;
    global.WebSocket = MockWebSocket as any;

    try {
      const flushSpy = vi.fn().mockResolvedValue(undefined);
      (useBoardStore.getState() as any).flushOfflineQueue = flushSpy;

      act(() => {
        useBoardStore.setState({
          isLoading: false,
          boardName: 'Engineering Sprint Board',
          issues: [testIssue],
          offlineOutbox: [
            {
              id: 'tx-offline-1',
              action: 'update_issue',
              issueKey: 'PROJ-101',
              payload: { summary: 'New summary' },
              createdAt: Date.now(),
            },
          ],
          syncStatus: 'offline',
          pendingSyncCount: 1,
        });
      });

      await act(async () => {
        root.render(<App />);
      });

      expect(wsInstance).not.toBeNull();

      // Trigger socket onopen
      await act(async () => {
        wsInstance.onopen?.();
      });

      expect(flushSpy).toHaveBeenCalled();
    } finally {
      global.WebSocket = originalWebSocket;
    }
  });
});
