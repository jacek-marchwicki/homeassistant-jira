import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useBoardStore,
  DEFAULT_COLUMNS,
  loadCachedBoard,
  saveCachedBoard,
  loadCachedView,
  saveCachedView,
  LOCAL_STORAGE_BOARD_CACHE_KEY,
  LOCAL_STORAGE_CURRENT_VIEW_KEY,
  LOCAL_STORAGE_CURRENT_USER_KEY,
} from './boardStore.ts';
import { JiraIssue } from '../types/jira.ts';
import { getAvailableStatuses } from '../utils/boardUtils.ts';

const mockIssue: JiraIssue = {
  id: '101',
  key: 'PROJ-101',
  summary: 'Test Issue',
  priority: 'high',
  status: { id: '1', name: 'To Do', category: 'todo' },
  updated_at: '2026-10-05T00:00:00Z',
};

describe('Zustand BoardStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useBoardStore.setState({
      issues: [mockIssue],
      boardName: 'Engineering Sprint Board',
      sprintName: 'Active Sprint 42',
      wsConnected: false,
      activeFilters: ['my', 'active', 'hide_epics'],
      activeFilter: 'my,active,hide_epics',
      searchQuery: '',
      errorMessage: null,
      rollbackQueue: {},
    });
  });

  it('updates state immediately (< 50ms) upon optimistic transition', async () => {
    // Mock successful backend response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockIssue,
        status: { id: '4', name: 'Done', category: 'done' },
      }),
    });

    const startTime = performance.now();
    const promise = useBoardStore.getState().transitionIssueOptimistic('PROJ-101', 'done');

    // UI state must have changed synchronously
    const synchronousIssue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    const elapsed = performance.now() - startTime;

    expect(elapsed).toBeLessThan(50);
    expect(synchronousIssue?.status.category).toBe('done');
    expect(synchronousIssue?._optimisticState).toBe('pending');

    await promise;

    // After async resolve, status remains done and marked synced
    const syncedIssue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    expect(syncedIssue?.status.category).toBe('done');
    expect(syncedIssue?._optimisticState).toBe('synced');
  });

  it('rolls back to previous state and displays error message when backend rejects transition', async () => {
    // Mock failing backend response
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await useBoardStore.getState().transitionIssueOptimistic('PROJ-101', 'done');

    const revertedIssue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    expect(revertedIssue?.status.category).toBe('todo');
    expect(revertedIssue?._optimisticState).toBe('failed');
    expect(useBoardStore.getState().errorMessage).toContain('Failed to transition PROJ-101');
  });

  it('updates state upon receiving real-time WebSocket issue_transitioned event', () => {
    const updatedFromWs: JiraIssue = {
      ...mockIssue,
      summary: 'Updated by teammate via Jira Cloud',
      status: { id: '2', name: 'In Progress', category: 'inprogress' },
    };

    useBoardStore.getState().handleWsMessage({
      event: 'issue_transitioned',
      issue: updatedFromWs,
    });

    const issue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    expect(issue?.summary).toBe('Updated by teammate via Jira Cloud');
    expect(issue?.status.category).toBe('inprogress');
    expect(issue?._optimisticState).toBe('synced');
  });

  it('toggles filters and search query correctly', () => {
    expect(useBoardStore.getState().activeFilters).toEqual(['my', 'active', 'hide_epics']);

    useBoardStore.getState().toggleFilter('my');
    expect(useBoardStore.getState().activeFilters).toEqual(['active', 'hide_epics']);

    useBoardStore.getState().toggleFilter('active');
    expect(useBoardStore.getState().activeFilters).toEqual(['hide_epics']);

    useBoardStore.getState().toggleFilter('hide_epics');
    expect(useBoardStore.getState().activeFilters).toEqual([]);
    expect(useBoardStore.getState().activeFilter).toBe('all');

    useBoardStore.getState().setActiveFilter('my');
    expect(useBoardStore.getState().activeFilters).toEqual(['my']);
    expect(useBoardStore.getState().activeFilter).toBe('my');

    useBoardStore.getState().setSearchQuery('test query');
    expect(useBoardStore.getState().searchQuery).toBe('test query');

    useBoardStore.getState().setCurrentUser('Alex Lead');
    expect(useBoardStore.getState().currentUser).toBe('Alex Lead');
    expect(window.localStorage.getItem('ha_jira_current_user')).toBe('Alex Lead');
  });

  it('loads dynamic board columns from /api/board', async () => {
    const customColumns = [
      { id: 'col-backlog', name: 'Backlog', category: 'todo' as const, status_ids: ['10002'] },
      { id: 'col-ready', name: 'Ready', category: 'todo' as const, status_ids: ['10003'] },
      { id: 'col-inprogress', name: 'In Progress', category: 'inprogress' as const, status_ids: ['3'] },
      { id: 'col-done', name: 'Done', category: 'done' as const, status_ids: ['10001'] },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        board_id: 'HOME',
        board_name: 'HOME Board',
        columns: customColumns,
        issues: [mockIssue],
      }),
    });

    await useBoardStore.getState().loadBoard();

    expect(useBoardStore.getState().columns).toEqual(customColumns);
    expect(useBoardStore.getState().boardName).toBe('HOME Board');
    expect(useBoardStore.getState().isLoading).toBe(false);
  });

  it('supports transitioning with specific targetStatus and sends payload in request body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockIssue,
        status: { id: '10003', name: 'Ready', category: 'todo' },
      }),
    });

    await useBoardStore.getState().transitionIssueOptimistic('PROJ-101', 'todo', 'Ready');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/issues/PROJ-101/transition'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          target_category: 'todo',
          target_status: 'Ready',
        }),
      })
    );

    const issue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    expect(issue?.status.name).toBe('Ready');
    expect(issue?.status.category).toBe('todo');
  });

  it('switches current view between board and backlog', () => {
    expect(useBoardStore.getState().currentView).toBe('board');
    useBoardStore.getState().setCurrentView('backlog');
    expect(useBoardStore.getState().currentView).toBe('backlog');
    useBoardStore.getState().setCurrentView('board');
    expect(useBoardStore.getState().currentView).toBe('board');
  });

  it('toggles isBacklogExpandedOnBoard state', () => {
    expect(useBoardStore.getState().isBacklogExpandedOnBoard).toBe(false);
    useBoardStore.getState().toggleBacklogExpandedOnBoard();
    expect(useBoardStore.getState().isBacklogExpandedOnBoard).toBe(true);
    useBoardStore.getState().toggleBacklogExpandedOnBoard();
    expect(useBoardStore.getState().isBacklogExpandedOnBoard).toBe(false);
  });

  it('moveToBacklog transitions issue to Backlog status optimistically', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockIssue,
        status: { id: '0', name: 'Backlog', category: 'todo' },
      }),
    });

    await useBoardStore.getState().moveToBacklog('PROJ-101');
    const issue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    expect(issue?.status.name).toBe('Backlog');
    expect(issue?.status.category).toBe('todo');
  });

  it('moveToBoard transitions backlog issue to the first active board column', async () => {
    useBoardStore.setState({
      issues: [
        {
          ...mockIssue,
          status: { id: '0', name: 'Backlog', category: 'todo' },
        },
      ],
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockIssue,
        status: { id: '1', name: 'To Do', category: 'todo' },
      }),
    });

    await useBoardStore.getState().moveToBoard('PROJ-101');
    const issue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    expect(issue?.status.name).toBe('To Do');
    expect(issue?.status.category).toBe('todo');
  });

  it('updateIssueOptimistic mutates issue fields immediately and sends PATCH request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...mockIssue,
        summary: 'Updated via Store',
        priority: 'highest',
      }),
    });

    const startTime = performance.now();
    const promise = useBoardStore.getState().updateIssueOptimistic('PROJ-101', {
      summary: 'Updated via Store',
      priority: 'highest',
    });

    // Synchronously mutated within 50ms
    const synchronousIssue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    expect(performance.now() - startTime).toBeLessThan(50);
    expect(synchronousIssue?.summary).toBe('Updated via Store');
    expect(synchronousIssue?.priority).toBe('highest');
    expect(synchronousIssue?._optimisticState).toBe('pending');

    await promise;

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/issues/PROJ-101'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          summary: 'Updated via Store',
          priority: 'highest',
        }),
      })
    );

    const syncedIssue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    expect(syncedIssue?._optimisticState).toBe('synced');
  });

  it('updateIssueOptimistic rolls back on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await useBoardStore.getState().updateIssueOptimistic('PROJ-101', {
      summary: 'Will Fail',
    });

    const revertedIssue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    expect(revertedIssue?.summary).toBe('Test Issue');
    expect(revertedIssue?._optimisticState).toBe('failed');
    expect(useBoardStore.getState().errorMessage).toContain('Failed to update PROJ-101');
  });

  it('handles WebSocket issue_updated event', () => {
    useBoardStore.getState().handleWsMessage({
      event: 'issue_updated',
      issue: {
        ...mockIssue,
        summary: 'Updated over WS',
        priority: 'lowest',
      },
    });

    const issue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
    expect(issue?.summary).toBe('Updated over WS');
    expect(issue?.priority).toBe('lowest');
  });

  it('createIssueOptimistic prepends issue optimistically and syncs with backend', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: '201',
        key: 'PROJ-201',
        summary: 'Brand New Task',
        issue_type: 'task',
        priority: 'high',
        status: { id: 'col-todo', name: 'To Do', category: 'todo' },
        updated_at: '2026-10-05T00:00:00Z',
      }),
    });

    const startTime = performance.now();
    const promise = useBoardStore.getState().createIssueOptimistic({
      summary: 'Brand New Task',
      priority: 'high',
      issue_type: 'task',
    });

    // Synchronously added within 50ms
    expect(performance.now() - startTime).toBeLessThan(50);
    const issues = useBoardStore.getState().issues;
    expect(issues[0].summary).toBe('Brand New Task');
    expect(issues[0]._optimisticState).toBe('pending');

    await promise;

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/issues'),
      expect.objectContaining({
        method: 'POST',
      })
    );

    const synced = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-201');
    expect(synced).toBeDefined();
    expect(synced?._optimisticState).toBe('synced');
  });

  it('createIssueOptimistic rolls back on failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await useBoardStore.getState().createIssueOptimistic({
      summary: 'Will Fail Issue',
    });

    const issues = useBoardStore.getState().issues;
    expect(issues.some((i) => i.summary === 'Will Fail Issue')).toBe(false);
    expect(useBoardStore.getState().errorMessage).toContain('Failed to create issue');
  });

  it('handles WebSocket issue_created event', () => {
    useBoardStore.getState().handleWsMessage({
      event: 'issue_created',
      issue: {
        id: '301',
        key: 'PROJ-301',
        summary: 'Created over WS',
        issue_type: 'bug',
        priority: 'highest',
        status: { id: 'col-todo', name: 'To Do', category: 'todo' },
      },
    });

    const issue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-301');
    expect(issue).toBeDefined();
    expect(issue?.summary).toBe('Created over WS');
  });

  it('keeps created issue at the top after WebSocket reconciliation even if Jira assigned bottom rank', () => {
    const existingTop: JiraIssue = {
      id: '101',
      key: 'PROJ-101',
      summary: 'Existing Top Issue',
      priority: 'medium',
      status: { id: 'col-todo', name: 'To Do', category: 'todo' },
      rank: '0|i00001:',
    };
    const existingBottom: JiraIssue = {
      id: '102',
      key: 'PROJ-102',
      summary: 'Existing Bottom Issue',
      priority: 'medium',
      status: { id: 'col-todo', name: 'To Do', category: 'todo' },
      rank: '0|i00005:',
    };
    const tempIssue: JiraIssue = {
      id: 'TEMP-999',
      key: 'TEMP-999',
      summary: 'Newly Created Task',
      priority: 'high',
      status: { id: 'col-todo', name: 'To Do', category: 'todo' },
      rank: '0|i00000:', // Calculated top rank
      _optimisticState: 'pending',
    };

    useBoardStore.setState({
      issues: [tempIssue, existingTop, existingBottom],
    });

    // Jira responds via WebSocket with real key DEV-2001, but default bottom rank '0|i00099:'
    useBoardStore.getState().handleWsMessage({
      event: 'issue_created',
      temp_key: 'TEMP-999',
      issue: {
        id: '2001',
        key: 'DEV-2001',
        summary: 'Newly Created Task',
        priority: 'high',
        status: { id: 'col-todo', name: 'To Do', category: 'todo' },
        rank: '0|i00099:', // Jira bottom rank
      },
    });

    const issues = useBoardStore.getState().issues;
    expect(issues[0].key).toBe('DEV-2001');
    expect(issues[0].summary).toBe('Newly Created Task');
    expect(issues[0]._optimisticState).toBe('synced');
    expect(issues[0].rank).toBe('0|i00000:'); // Preserves top rank over Jira default bottom rank
  });

  it('loadBoard uses SWR background sync (isSyncing) when existing issues are present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        board_name: 'Engineering Sprint Board',
        sprint_name: 'Active Sprint 42',
        columns: [],
        issues: [
          {
            ...mockIssue,
            summary: 'Synced from Jira Cloud',
          },
        ],
      }),
    });

    useBoardStore.setState({
      issues: [mockIssue],
      isLoading: false,
      isSyncing: false,
    });

    const promise = useBoardStore.getState().loadBoard();

    // Since existing issues are present, isLoading stays false while isSyncing is true
    expect(useBoardStore.getState().isLoading).toBe(false);
    expect(useBoardStore.getState().isSyncing).toBe(true);

    await promise;

    expect(useBoardStore.getState().isLoading).toBe(false);
    expect(useBoardStore.getState().isSyncing).toBe(false);
    expect(useBoardStore.getState().issues[0].summary).toBe('Synced from Jira Cloud');
  });

  it('DEFAULT_COLUMNS does not contain phantom In Review status', () => {
    expect(DEFAULT_COLUMNS.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done']);
    expect(
      DEFAULT_COLUMNS.some((c) => c.category === 'inreview' || c.name.toLowerCase().includes('review'))
    ).toBe(false);
  });

  it('loadBoard sets exact Jira project columns without injecting In Review', async () => {
    const jiraColumns = [
      { id: 'col-10002', name: 'Backlog', category: 'todo' as const, status_ids: ['10002'] },
      { id: 'col-10003', name: 'Ready', category: 'todo' as const, status_ids: ['10003'] },
      { id: 'col-3', name: 'In Progress', category: 'inprogress' as const, status_ids: ['3'] },
      { id: 'col-10001', name: 'Done', category: 'done' as const, status_ids: ['10001'] },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        board_name: 'HOME Project Board',
        sprint_name: '',
        columns: jiraColumns,
        issues: [],
      }),
    });

    useBoardStore.setState({ issues: [], columns: DEFAULT_COLUMNS });
    await useBoardStore.getState().loadBoard();

    const currentColumns = useBoardStore.getState().columns;
    expect(currentColumns.map((c) => c.name)).toEqual(['Backlog', 'Ready', 'In Progress', 'Done']);
    expect(
      currentColumns.some((c) => c.name.toLowerCase().includes('review') || c.category === 'inreview')
    ).toBe(false);

    // Verify available statuses also do not contain In Review
    const statuses = getAvailableStatuses(currentColumns);
    expect(
      statuses.some((s) => s.name.toLowerCase().includes('review') || s.category === 'inreview')
    ).toBe(false);
  });

  describe('Offline Outbox & Reconnection Sync', () => {
    beforeEach(() => {
      localStorage.clear();
      useBoardStore.setState({
        issues: [mockIssue],
        offlineOutbox: [],
        syncStatus: 'synced',
        pendingSyncCount: 0,
      });
    });

    it('offline transition appends to offlineOutbox in localStorage and keeps optimistic state', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error: offline'));

      await useBoardStore.getState().transitionIssueOptimistic('PROJ-101', 'done', 'Done');

      // 1. Issue remains in optimistic state (not reverted!)
      const currentIssue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
      expect(currentIssue?.status.category).toBe('done');
      expect(currentIssue?._optimisticState).toBe('pending');

      // 2. Outbox has queued mutation
      const outbox = useBoardStore.getState().offlineOutbox;
      expect(outbox.length).toBe(1);
      expect(outbox[0].action).toBe('transition_issue');
      expect(outbox[0].issueKey).toBe('PROJ-101');
      expect(outbox[0].payload).toEqual({ target_category: 'done', target_status: 'Done' });

      // 3. Saved to localStorage
      const savedRaw = localStorage.getItem('ha_jira_offline_outbox_v1');
      expect(savedRaw).toBeTruthy();
      expect(JSON.parse(savedRaw!).length).toBe(1);

      // 4. Sync status reflects offline
      expect(useBoardStore.getState().syncStatus).toBe('offline');
      expect(useBoardStore.getState().pendingSyncCount).toBe(1);
    });

    it('updating only assignee extracts single-field delta in outbox payload', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

      await useBoardStore.getState().updateIssueOptimistic('PROJ-101', {
        assignee_name: 'Alex Lead',
      });

      const outbox = useBoardStore.getState().offlineOutbox;
      expect(outbox.length).toBe(1);
      expect(outbox[0].action).toBe('update_issue');
      expect(outbox[0].payload).toEqual({ assignee_name: 'Alex Lead' });
      // Should not contain untouched fields
      expect(outbox[0].payload.summary).toBeUndefined();
      expect(outbox[0].payload.description).toBeUndefined();

      const current = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
      expect(current?.assignee?.displayName).toBe('Alex Lead');
    });

    it('flushOfflineQueue flushes pending items in FIFO order upon reconnection', async () => {
      const outboxItem1 = {
        id: 'outbox-1',
        action: 'transition_issue' as const,
        issueKey: 'PROJ-101',
        payload: { target_category: 'done', target_status: 'Done' },
        createdAt: Date.now(),
      };

      useBoardStore.setState({
        offlineOutbox: [outboxItem1],
        pendingSyncCount: 1,
        syncStatus: 'offline',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...mockIssue,
          status: { id: '4', name: 'Done', category: 'done' },
        }),
      });

      await useBoardStore.getState().flushOfflineQueue();

      expect(useBoardStore.getState().offlineOutbox.length).toBe(0);
      expect(useBoardStore.getState().syncStatus).toBe('synced');
      expect(useBoardStore.getState().pendingSyncCount).toBe(0);

      const issue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
      expect(issue?._optimisticState).toBe('synced');
    });

    it('flushOfflineQueue adopts remote state on conflict (remote-wins)', async () => {
      const outboxItem = {
        id: 'outbox-conflict',
        action: 'update_issue' as const,
        issueKey: 'PROJ-101',
        payload: { summary: 'Conflicting Local Edit' },
        createdAt: Date.now(),
      };

      useBoardStore.setState({
        offlineOutbox: [outboxItem],
        pendingSyncCount: 1,
        syncStatus: 'offline',
      });

      // Server returns remote version that supersedes the local change
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...mockIssue,
          summary: 'Remote Authoritative Version',
        }),
      });

      await useBoardStore.getState().flushOfflineQueue();

      expect(useBoardStore.getState().offlineOutbox.length).toBe(0);
      const issue = useBoardStore.getState().issues.find((i) => i.key === 'PROJ-101');
      expect(issue?.summary).toBe('Remote Authoritative Version');
    });
  });

  describe('loadCachedBoard', () => {
    it('discards legacy example tasks and purges localStorage cache', () => {
      window.localStorage.setItem(
        LOCAL_STORAGE_BOARD_CACHE_KEY,
        JSON.stringify({
          boardName: 'Engineering Sprint Board',
          sprintName: 'Active Sprint 42',
          jiraUrl: 'https://jira.example.com',
          columns: DEFAULT_COLUMNS,
          issues: [
            {
              id: '101',
              key: 'PROJ-101',
              summary: 'Example task',
              url: 'https://jira.example.com/browse/PROJ-101',
              status: { id: '1', name: 'To Do', category: 'todo' },
            },
          ],
        })
      );

      const cached = loadCachedBoard();
      expect(cached).toBeNull();
      expect(window.localStorage.getItem(LOCAL_STORAGE_BOARD_CACHE_KEY)).toBeNull();
    });

    it('loads valid real cached tasks without purging', () => {
      const realData = {
        boardName: 'HOME Board',
        sprintName: 'Active Issues',
        jiraUrl: 'https://company.atlassian.net',
        columns: DEFAULT_COLUMNS,
        issues: [
          {
            id: '1001',
            key: 'HOME-1',
            summary: 'Real task',
            url: 'https://company.atlassian.net/browse/HOME-1',
            status: { id: '1', name: 'To Do', category: 'todo' },
          },
        ],
      };
      window.localStorage.setItem(LOCAL_STORAGE_BOARD_CACHE_KEY, JSON.stringify(realData));

      const cached = loadCachedBoard();
      expect(cached).not.toBeNull();
      expect(cached?.boardName).toBe('HOME Board');
      expect(cached?.issues[0].key).toBe('HOME-1');
    });
  });

  describe('rankIssueOptimistic and offline ranking', () => {
    it('updates issue rank instantly (< 50ms) and re-sorts issues array', async () => {
      const issueA: JiraIssue = {
        id: '1',
        key: 'A',
        summary: 'Issue A',
        priority: 'high',
        status: { id: '1', name: 'To Do', category: 'todo' },
        rank: '0|i00001:',
      };
      const issueB: JiraIssue = {
        id: '2',
        key: 'B',
        summary: 'Issue B',
        priority: 'high',
        status: { id: '1', name: 'To Do', category: 'todo' },
        rank: '0|i00002:',
      };
      useBoardStore.setState({ issues: [issueA, issueB] });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...issueA, rank: '0|i00003:' }),
      });

      const startTime = performance.now();
      const promise = useBoardStore
        .getState()
        .rankIssueOptimistic('A', undefined, 'B', '0|i00003:');

      const elapsed = performance.now() - startTime;
      expect(elapsed).toBeLessThan(50);

      const stateIssues = useBoardStore.getState().issues;
      expect(stateIssues.map((i) => i.key)).toEqual(['B', 'A']);
      expect(stateIssues.find((i) => i.key === 'A')?.rank).toBe('0|i00003:');

      await promise;
    });

    it('queues rank_issue in offlineOutbox and sets syncStatus to offline when network fails', async () => {
      const issueA: JiraIssue = {
        id: '1',
        key: 'A',
        summary: 'Issue A',
        priority: 'high',
        status: { id: '1', name: 'To Do', category: 'todo' },
        rank: '0|i00001:',
      };
      const issueB: JiraIssue = {
        id: '2',
        key: 'B',
        summary: 'Issue B',
        priority: 'high',
        status: { id: '1', name: 'To Do', category: 'todo' },
        rank: '0|i00002:',
      };
      useBoardStore.setState({ issues: [issueA, issueB], offlineOutbox: [] });

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await useBoardStore.getState().rankIssueOptimistic('A', undefined, 'B', '0|i00003:');

      const store = useBoardStore.getState();
      expect(store.syncStatus).toBe('offline');
      expect(store.offlineOutbox.length).toBe(1);
      expect(store.offlineOutbox[0].action).toBe('rank_issue');
      expect(store.offlineOutbox[0].issueKey).toBe('A');
    });

    it('flushes pending rank_issue items on flushOfflineQueue', async () => {
      const issueA: JiraIssue = {
        id: '1',
        key: 'A',
        summary: 'Issue A',
        priority: 'high',
        status: { id: '1', name: 'To Do', category: 'todo' },
        rank: '0|i00003:',
      };
      useBoardStore.setState({
        issues: [issueA],
        offlineOutbox: [
          {
            id: 'outbox-1',
            action: 'rank_issue',
            issueKey: 'A',
            payload: { rank_after_key: 'B', rank: '0|i00003:' },
            createdAt: Date.now(),
          },
        ],
        syncStatus: 'offline',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...issueA, rank: '0|i00003:' }),
      });

      await useBoardStore.getState().flushOfflineQueue();

      const store = useBoardStore.getState();
      expect(store.syncStatus).toBe('synced');
      expect(store.offlineOutbox.length).toBe(0);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/issues/A/rank'),
        expect.objectContaining({ method: 'PUT' })
      );
    });
  });

  describe('Dashboard View and Current User Persistence', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it('persists currentView to localStorage when setCurrentView is called', () => {
      expect(LOCAL_STORAGE_CURRENT_VIEW_KEY).toBe('ha_jira_current_view');
      useBoardStore.getState().setCurrentView('people');
      expect(useBoardStore.getState().currentView).toBe('people');
      expect(window.localStorage.getItem(LOCAL_STORAGE_CURRENT_VIEW_KEY)).toBe('people');

      useBoardStore.getState().setCurrentView('backlog');
      expect(useBoardStore.getState().currentView).toBe('backlog');
      expect(window.localStorage.getItem(LOCAL_STORAGE_CURRENT_VIEW_KEY)).toBe('backlog');

      useBoardStore.getState().setCurrentView('board');
      expect(useBoardStore.getState().currentView).toBe('board');
      expect(window.localStorage.getItem(LOCAL_STORAGE_CURRENT_VIEW_KEY)).toBe('board');
    });

    it('loadCachedView loads saved view from localStorage or defaults to board', () => {
      saveCachedView('people');
      expect(window.localStorage.getItem(LOCAL_STORAGE_CURRENT_VIEW_KEY)).toBe('people');
      expect(loadCachedView()).toBe('people');

      saveCachedView('backlog');
      expect(window.localStorage.getItem(LOCAL_STORAGE_CURRENT_VIEW_KEY)).toBe('backlog');
      expect(loadCachedView()).toBe('backlog');

      saveCachedView('board');
      expect(window.localStorage.getItem(LOCAL_STORAGE_CURRENT_VIEW_KEY)).toBe('board');
      expect(loadCachedView()).toBe('board');

      window.localStorage.setItem(LOCAL_STORAGE_CURRENT_VIEW_KEY, 'invalid_view');
      expect(loadCachedView()).toBe('board');

      window.localStorage.removeItem(LOCAL_STORAGE_CURRENT_VIEW_KEY);
      expect(loadCachedView()).toBe('board');
    });

    it('persists currentUser to localStorage under ha_jira_current_user', () => {
      expect(LOCAL_STORAGE_CURRENT_USER_KEY).toBe('ha_jira_current_user');
      useBoardStore.getState().setCurrentUser('Zoe Architect');
      expect(useBoardStore.getState().currentUser).toBe('Zoe Architect');
      expect(window.localStorage.getItem(LOCAL_STORAGE_CURRENT_USER_KEY)).toBe('Zoe Architect');
    });

    it('persists availableUsers in saveCachedBoard and restores in loadCachedBoard', () => {
      const customUsers = [
        { displayName: 'Zoe Architect', accountId: 'acc-zoe', avatarUrl: 'https://example.com/zoe.png' },
        { displayName: 'Alex Lead', accountId: 'acc-alex', avatarUrl: 'https://example.com/alex.png' },
      ];

      saveCachedBoard({
        boardName: 'Test Board',
        sprintName: 'Sprint 1',
        jiraUrl: 'https://jira.example.com',
        columns: DEFAULT_COLUMNS,
        issues: [
          {
            id: '1',
            key: 'TEST-1',
            summary: 'Test',
            priority: 'low',
            status: { id: 'col-todo', name: 'To Do', category: 'todo' },
          },
        ],
        availableUsers: customUsers,
      });

      const loaded = loadCachedBoard();
      expect(loaded).not.toBeNull();
      expect(loaded?.availableUsers).toEqual(customUsers);
    });
  });
});





describe('child account store state', () => {
  beforeEach(() => {
    useBoardStore.setState({ accountTypes: {}, showChildren: false, errorMessage: null });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('defaults to no child accounts and showChildren off', () => {
    expect(useBoardStore.getState().showChildren).toBe(false);
  });

  it('sets account type optimistically, PUTs to backend and caches it', async () => {
    const p = useBoardStore.getState().setAccountType('Kid Kim', 'child');
    expect(useBoardStore.getState().accountTypes['kid kim']).toBe('child');
    await p;
    expect(window.localStorage.getItem('ha_jira_account_types')).toContain('kid kim');
    await useBoardStore.getState().setAccountType('Kid Kim', 'parent');
    expect(useBoardStore.getState().accountTypes['kid kim']).toBeUndefined();
  });

  it('sends the exact request contract the backend expects (dotted names included)', async () => {
    await useBoardStore.getState().setAccountType(' luna.marchwicka ', 'child');
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toMatch(/\/api\/account-types$/);
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      display_name: 'luna.marchwicka',
      account_type: 'child',
    });
    expect(useBoardStore.getState().errorMessage).toBeNull();
  });

  it('reports the failure reason and reverts when the backend lacks the endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 405 });
    await useBoardStore.getState().setAccountType('luna.marchwicka', 'child');
    expect(useBoardStore.getState().accountTypes).toEqual({});
    expect(useBoardStore.getState().errorMessage).toContain('HTTP 405');
    expect(useBoardStore.getState().errorMessage).toContain('luna.marchwicka');
  });

  it('loads account types from backend and applies websocket updates', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ account_types: { 'kid kim': 'child' } }),
    });
    await useBoardStore.getState().fetchAccountTypes();
    expect(useBoardStore.getState().accountTypes).toEqual({ 'kid kim': 'child' });
    useBoardStore.getState().handleWsMessage({ event: 'account_types_updated', account_types: {} });
    expect(useBoardStore.getState().accountTypes).toEqual({});
  });

  it('keeps cached account types when backend is unreachable', async () => {
    useBoardStore.setState({ accountTypes: { x: 'child' } });
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    await useBoardStore.getState().fetchAccountTypes();
    expect(useBoardStore.getState().accountTypes).toEqual({ x: 'child' });
  });

  it('toggles showChildren and opens/closes the settings page', () => {
    useBoardStore.getState().toggleShowChildren();
    expect(useBoardStore.getState().showChildren).toBe(true);
    useBoardStore.getState().toggleShowChildren();
    useBoardStore.getState().openSettings();
    expect(useBoardStore.getState().isSettingsOpen).toBe(true);
    expect(window.location.pathname).toMatch(/\/settings$/);
    // browser back (popstate -> applyRoute) leaves settings
    useBoardStore.getState().applyRoute({ kind: 'view', view: 'board' });
    expect(useBoardStore.getState().isSettingsOpen).toBe(false);
    useBoardStore.getState().applyRoute({ kind: 'settings' });
    expect(useBoardStore.getState().isSettingsOpen).toBe(true);
    useBoardStore.getState().closeSettings();
    expect(useBoardStore.getState().isSettingsOpen).toBe(false);
    expect(useBoardStore.getState().isSettingsOpen).toBe(false);
  });
});

describe('URL navigation', () => {
  const issue = {
    id: '1',
    key: 'HOME-123',
    summary: 'Nav',
    status: 'To Do',
    category: 'todo',
  } as unknown as JiraIssue;

  beforeEach(() => {
    window.history.replaceState(null, '', '/board');
    useBoardStore.setState({
      issues: [issue],
      isLoading: false,
      editingIssue: null,
      routeTaskKey: null,
      isCreateModalOpen: false,
      currentView: 'board',
    });
  });

  it('opening a task pushes /task/KEY and closing goes back', async () => {
    useBoardStore.getState().setEditingIssue(issue);
    expect(window.location.pathname).toBe('/task/HOME-123');
    expect(useBoardStore.getState().editingIssue?.key).toBe('HOME-123');
    useBoardStore.getState().setEditingIssue(null);
    expect(useBoardStore.getState().editingIssue).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(window.location.pathname).toBe('/board');
  });

  it('switching views updates the URL', () => {
    useBoardStore.getState().setCurrentView('people');
    expect(window.location.pathname).toBe('/people');
    expect(useBoardStore.getState().currentView).toBe('people');
  });

  it('create modal uses /create', () => {
    useBoardStore.getState().setCreateModalOpen(true);
    expect(window.location.pathname).toBe('/create');
    expect(useBoardStore.getState().isCreateModalOpen).toBe(true);
  });

  it('connection modal uses /status and closes back to view', () => {
    useBoardStore.getState().setConnectionModalOpen(true);
    expect(window.location.pathname).toBe('/status');
    expect(useBoardStore.getState().isConnectionModalOpen).toBe(true);

    useBoardStore.getState().setConnectionModalOpen(false);
    expect(useBoardStore.getState().isConnectionModalOpen).toBe(false);
    expect(window.location.pathname).toBe('/board');
  });

  it('applyRoute for status opens connection modal', () => {
    useBoardStore.getState().applyRoute({ kind: 'status' });
    expect(useBoardStore.getState().isConnectionModalOpen).toBe(true);
    expect(useBoardStore.getState().isCreateModalOpen).toBe(false);
    expect(useBoardStore.getState().editingIssue).toBeNull();
  });

  it('applyRoute for task resolves editing issue, and defers until issues load', () => {
    useBoardStore.getState().applyRoute({ kind: 'task', key: 'HOME-123' });
    expect(useBoardStore.getState().editingIssue?.key).toBe('HOME-123');

    useBoardStore.setState({ issues: [], editingIssue: null, isLoading: true });
    useBoardStore.getState().applyRoute({ kind: 'task', key: 'HOME-123' });
    expect(useBoardStore.getState().editingIssue).toBeNull();
    useBoardStore.setState({ issues: [issue], isLoading: false });
    useBoardStore.getState().resolveRouteTask();
    expect(useBoardStore.getState().editingIssue?.key).toBe('HOME-123');
  });

  it('unknown task falls back to the view URL', () => {
    window.history.replaceState(null, '', '/task/NOPE-1');
    useBoardStore.getState().applyRoute({ kind: 'task', key: 'NOPE-1' });
    expect(window.location.pathname).toBe('/board');
    expect(useBoardStore.getState().editingIssue).toBeNull();
  });

  it('applyRoute for a view closes overlays (back navigation)', () => {
    useBoardStore.getState().applyRoute({ kind: 'task', key: 'HOME-123' });
    useBoardStore.getState().applyRoute({ kind: 'view', view: 'backlog' });
    expect(useBoardStore.getState().editingIssue).toBeNull();
    expect(useBoardStore.getState().currentView).toBe('backlog');
  });
});
