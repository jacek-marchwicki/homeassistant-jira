import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBoardStore } from './boardStore.ts';
import { JiraIssue } from '../types/jira.ts';

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
      activeFilters: ['my', 'active'],
      activeFilter: 'my,active',
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
    expect(useBoardStore.getState().activeFilters).toEqual(['my', 'active']);

    useBoardStore.getState().toggleFilter('my');
    expect(useBoardStore.getState().activeFilters).toEqual(['active']);

    useBoardStore.getState().toggleFilter('active');
    expect(useBoardStore.getState().activeFilters).toEqual([]);
    expect(useBoardStore.getState().activeFilter).toBe('all');

    useBoardStore.getState().setActiveFilter('my');
    expect(useBoardStore.getState().activeFilters).toEqual(['my']);
    expect(useBoardStore.getState().activeFilter).toBe('my');

    useBoardStore.getState().setSearchQuery('test query');
    expect(useBoardStore.getState().searchQuery).toBe('test query');
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
});


