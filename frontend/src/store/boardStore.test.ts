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
      activeFilter: 'all',
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
    useBoardStore.getState().setActiveFilter('blockers');
    expect(useBoardStore.getState().activeFilter).toBe('blockers');

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
});
