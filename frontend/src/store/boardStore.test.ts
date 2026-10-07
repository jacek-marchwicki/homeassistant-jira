import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBoardStore, DEFAULT_COLUMNS } from './boardStore.ts';
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
});



