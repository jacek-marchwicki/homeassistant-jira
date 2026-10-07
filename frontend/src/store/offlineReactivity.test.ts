import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBoardStore } from './boardStore.ts';
import { JiraIssue, BoardColumn } from '../types/jira.ts';
import {
  splitIssuesByBacklog,
  filterIssues,
  filterIssuesForColumn,
  getActiveBoardColumns,
} from '../utils/boardUtils.ts';

const testColumns: BoardColumn[] = [
  { id: 'col-backlog', name: 'Backlog', category: 'todo', status_ids: ['10'] },
  { id: 'col-todo', name: 'To Do', category: 'todo', status_ids: ['11'] },
  { id: 'col-inprogress', name: 'In Progress', category: 'inprogress', status_ids: ['12'] },
  { id: 'col-done', name: 'Done', category: 'done', status_ids: ['13'] },
];

const backlogIssue: JiraIssue = {
  id: '201',
  key: 'PROJ-201',
  summary: 'Offline Reactivity Issue',
  status: { id: '10', name: 'Backlog', category: 'todo' },
  assignee: { accountId: 'usr-jacek', displayName: 'Jacek Marchwicki' },
  priority: 'high',
  issue_type: 'task',
  start_date: '2026-10-01',
  updated_at: '2026-10-07T12:00:00Z',
};

describe('Cross-View & Filter Offline Reactivity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useBoardStore.setState({
      issues: [backlogIssue],
      columns: testColumns,
      currentView: 'backlog',
      currentUser: 'Jacek Marchwicki',
      activeFilters: ['my', 'active', 'hide_epics'],
      activeFilter: 'my,active,hide_epics',
      offlineOutbox: [],
      syncStatus: 'synced',
      pendingSyncCount: 0,
      errorMessage: null,
    });
  });

  it('marking a ticket as Done in Backlog is immediately visible on the Board while offline', async () => {
    // 1. Initial State: Ticket is in Backlog, not on the active Board
    const initialIssues = useBoardStore.getState().issues;
    const initialSplit = splitIssuesByBacklog(initialIssues, testColumns);
    expect(initialSplit.backlogIssues.length).toBe(1);
    expect(initialSplit.backlogIssues[0].key).toBe('PROJ-201');
    expect(initialSplit.boardIssues.length).toBe(0);

    // 2. Simulate complete offline network failure
    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline (airplane mode)'));

    // 3. Mark the issue as "Done" while in Backlog view
    await useBoardStore.getState().transitionIssueOptimistic('PROJ-201', 'done', 'Done');

    // 4. Verify optimistic update occurred immediately (< 50ms, offline)
    const updatedStoreIssues = useBoardStore.getState().issues;
    const updatedIssue = updatedStoreIssues.find((i) => i.key === 'PROJ-201');
    expect(updatedIssue?.status.category).toBe('done');
    expect(updatedIssue?.status.name).toBe('Done');
    expect(updatedIssue?._optimisticState).toBe('pending');

    // 5. Verify the issue has moved from Backlog to the Active Board
    const updatedSplit = splitIssuesByBacklog(updatedStoreIssues, testColumns);
    expect(updatedSplit.backlogIssues.length).toBe(0);
    expect(updatedSplit.boardIssues.length).toBe(1);
    expect(updatedSplit.boardIssues[0].key).toBe('PROJ-201');

    // 6. Verify the issue satisfies all active filters: 'my', 'active', 'hide_epics'
    const filteredIssues = filterIssues(updatedSplit.boardIssues, {
      activeFilters: useBoardStore.getState().activeFilters,
      currentUser: useBoardStore.getState().currentUser,
      now: new Date('2026-10-07T12:00:00Z'),
    });
    expect(filteredIssues.length).toBe(1);
    expect(filteredIssues[0].key).toBe('PROJ-201');

    // 7. Verify the issue is placed in the "Done" column on the Board
    const activeCols = getActiveBoardColumns(testColumns);
    const doneColumn = activeCols.find((c) => c.category === 'done');
    expect(doneColumn).toBeDefined();

    const doneColumnIssues = filterIssuesForColumn(
      filteredIssues,
      doneColumn!,
      testColumns,
      2,
      new Date('2026-10-07T12:00:00Z')
    );
    expect(doneColumnIssues.length).toBe(1);
    expect(doneColumnIssues[0].key).toBe('PROJ-201');

    // 8. Switching current view to 'board'
    useBoardStore.getState().setCurrentView('board');
    expect(useBoardStore.getState().currentView).toBe('board');

    // 9. Verify offline mutation is queued in localStorage outbox
    const outbox = useBoardStore.getState().offlineOutbox;
    expect(outbox.length).toBe(1);
    expect(outbox[0].action).toBe('transition_issue');
    expect(outbox[0].issueKey).toBe('PROJ-201');
    expect(outbox[0].payload).toEqual({ target_category: 'done', target_status: 'Done' });
    expect(useBoardStore.getState().syncStatus).toBe('offline');
    expect(useBoardStore.getState().pendingSyncCount).toBe(1);
  });
});
