import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBoardStore } from './boardStore.ts';
import { JiraIssue, BoardColumn } from '../types/jira.ts';
import {
  splitIssuesByBacklog,
  filterIssues,
  filterIssuesForColumn,
  getActiveBoardColumns,
  splitReadyIssues,
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

  it('creating an issue while offline preserves all fields, ranks highest, and syncs upon reconnection', async () => {
    // 1. Initial issues on board with existing ranks
    const existingIssue1: JiraIssue = {
      id: '101',
      key: 'PROJ-101',
      summary: 'Existing Card 1',
      status: { id: '11', name: 'To Do', category: 'todo' },
      rank: '0|i00005:',
      issue_type: 'task',
      priority: 'medium',
    };
    const existingIssue2: JiraIssue = {
      id: '102',
      key: 'PROJ-102',
      summary: 'Existing Card 2',
      status: { id: '11', name: 'To Do', category: 'todo' },
      rank: '0|i00008:',
      issue_type: 'task',
      priority: 'low',
    };
    useBoardStore.setState({
      issues: [existingIssue1, existingIssue2],
      columns: testColumns,
      offlineOutbox: [],
      syncStatus: 'synced',
      pendingSyncCount: 0,
    });

    // 2. Offline network
    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    // 3. Create issue with specific status "To Do", assignee, and story points
    const created = await useBoardStore.getState().createIssueOptimistic({
      summary: 'Urgent Offline Created Task',
      issue_type: 'task',
      priority: 'highest',
      status_category: 'todo',
      status_name: 'To Do',
      status_id: 'col-todo',
      assignee_name: 'Alex Lead',
      assignee_account_id: 'usr-alex',
      story_points: 5,
    });

    expect(created).not.toBeNull();
    const storeIssues = useBoardStore.getState().issues;
    expect(storeIssues.length).toBe(3);

    // Newly created issue must be at top (index 0) with rank < '0|i00005:'
    expect(storeIssues[0].key).toBe(created!.key);
    expect(storeIssues[0].summary).toBe('Urgent Offline Created Task');
    expect(storeIssues[0].status.id).toBe('col-todo');
    expect(storeIssues[0].status.name).toBe('To Do');
    expect(storeIssues[0].status.category).toBe('todo');
    expect(storeIssues[0].assignee?.displayName).toBe('Alex Lead');
    expect(storeIssues[0].assignee?.accountId).toBe('usr-alex');
    expect(storeIssues[0].rank! < '0|i00005:').toBe(true);

    // Verify it is not classified as backlog
    const split = splitIssuesByBacklog(storeIssues, testColumns);
    expect(split.boardIssues.some((i) => i.key === created!.key)).toBe(true);
    expect(split.backlogIssues.some((i) => i.key === created!.key)).toBe(false);

    // Verify outbox contains create_issue action with complete payload
    const outbox = useBoardStore.getState().offlineOutbox;
    expect(outbox.length).toBe(1);
    expect(outbox[0].action).toBe('create_issue');
    expect(outbox[0].issueKey).toBe(created!.key);
    expect(outbox[0].payload).toMatchObject({
      summary: 'Urgent Offline Created Task',
      status_id: 'col-todo',
      status_name: 'To Do',
      status_category: 'todo',
      assignee_name: 'Alex Lead',
      assignee_account_id: 'usr-alex',
    });
    expect(outbox[0].payload.rank).toBe(storeIssues[0].rank);

    // 4. Simulate reconnection & flush outbox
    const syncedRemoteIssue: JiraIssue = {
      id: '205',
      key: 'PROJ-205',
      summary: 'Urgent Offline Created Task',
      status: { id: 'col-todo', name: 'To Do', category: 'todo' },
      assignee: { accountId: 'usr-alex', displayName: 'Alex Lead' },
      priority: 'highest',
      issue_type: 'task',
      rank: storeIssues[0].rank,
      story_points: 5,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => syncedRemoteIssue,
    } as Response);

    await useBoardStore.getState().flushOfflineQueue();

    // Outbox should be drained
    expect(useBoardStore.getState().offlineOutbox.length).toBe(0);
    expect(useBoardStore.getState().syncStatus).toBe('synced');

    // Temp issue key remapped to real PROJ-205
    const finalIssues = useBoardStore.getState().issues;
    expect(finalIssues.some((i) => i.key === created!.key)).toBe(false);
    expect(finalIssues.some((i) => i.key === 'PROJ-205')).toBe(true);
    expect(finalIssues[0].key).toBe('PROJ-205');
  });

  it('updating and unassigning assignee while offline is queued in outbox and synced', async () => {
    // 1. Setup issue on board
    const initialIssue: JiraIssue = {
      id: '101',
      key: 'PROJ-101',
      summary: 'Task to edit assignee',
      status: { id: '11', name: 'To Do', category: 'todo' },
      assignee: { accountId: 'usr-jacek', displayName: 'Jacek Marchwicki' },
      rank: '0|i00001:',
      issue_type: 'task',
      priority: 'medium',
    };
    useBoardStore.setState({
      issues: [initialIssue],
      columns: testColumns,
      offlineOutbox: [],
      syncStatus: 'synced',
    });

    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    // 2. Change assignee to Alex Lead while offline
    await useBoardStore.getState().updateIssueOptimistic('PROJ-101', {
      assignee_name: 'Alex Lead',
      assignee_account_id: 'usr-alex',
    });

    let currentIssues = useBoardStore.getState().issues;
    expect(currentIssues[0].assignee?.displayName).toBe('Alex Lead');
    expect(currentIssues[0].assignee?.accountId).toBe('usr-alex');

    let outbox = useBoardStore.getState().offlineOutbox;
    expect(outbox.length).toBe(1);
    expect(outbox[0].action).toBe('update_issue');
    expect(outbox[0].payload).toEqual({
      assignee_name: 'Alex Lead',
      assignee_account_id: 'usr-alex',
    });

    // 3. Unassign assignee while offline
    await useBoardStore.getState().updateIssueOptimistic('PROJ-101', {
      assignee_name: '',
      assignee_account_id: null,
    });

    currentIssues = useBoardStore.getState().issues;
    expect(currentIssues[0].assignee).toBeNull();

    outbox = useBoardStore.getState().offlineOutbox;
    expect(outbox.length).toBe(2);
    expect(outbox[1].action).toBe('update_issue');
    expect(outbox[1].payload).toEqual({
      assignee_name: '',
      assignee_account_id: null,
    });
  });

  it('updating start_date and due_date or clearing them while offline is queued in outbox and immediately visible', async () => {
    const issueWithDates: JiraIssue = {
      id: '301',
      key: 'PROJ-301',
      summary: 'Task with Dates',
      status: { id: '11', name: 'To Do', category: 'todo' },
      assignee: null,
      priority: 'medium',
      issue_type: 'task',
      start_date: '2026-10-01',
      due_date: '2026-10-15',
    };

    useBoardStore.setState({
      issues: [issueWithDates],
      offlineOutbox: [],
      syncStatus: 'synced',
    });

    // 1. Go offline
    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    // 2. Update both start_date and due_date
    await useBoardStore.getState().updateIssueOptimistic('PROJ-301', {
      start_date: '2026-10-10',
      due_date: '2026-10-25',
    });

    let storeIssues = useBoardStore.getState().issues;
    expect(storeIssues[0].start_date).toBe('2026-10-10');
    expect(storeIssues[0].due_date).toBe('2026-10-25');
    expect(useBoardStore.getState().syncStatus).toBe('offline');

    let outbox = useBoardStore.getState().offlineOutbox;
    expect(outbox.length).toBe(1);
    expect(outbox[0].action).toBe('update_issue');
    expect(outbox[0].payload).toEqual({
      start_date: '2026-10-10',
      due_date: '2026-10-25',
    });

    // 3. Clear dates while offline
    await useBoardStore.getState().updateIssueOptimistic('PROJ-301', {
      start_date: null,
      due_date: null,
    });

    storeIssues = useBoardStore.getState().issues;
    expect(storeIssues[0].start_date).toBeNull();
    expect(storeIssues[0].due_date).toBeNull();

    outbox = useBoardStore.getState().offlineOutbox;
    expect(outbox.length).toBe(2);
    expect(outbox[1].action).toBe('update_issue');
    expect(outbox[1].payload).toEqual({
      start_date: null,
      due_date: null,
    });

    // 4. Reconnect to network and drain queue
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...issueWithDates,
        start_date: null,
        due_date: null,
      }),
    });

    await useBoardStore.getState().flushOfflineQueue();
    expect(useBoardStore.getState().offlineOutbox.length).toBe(0);
    expect(useBoardStore.getState().syncStatus).toBe('synced');
  });

  it('issue with recreate_after == "1d" and Active is immediately classified into Home as Usual section while offline', async () => {
    const readyIssue: JiraIssue = {
      id: '302',
      key: 'PROJ-302',
      summary: 'Task becoming daily routine',
      status: { id: '11', name: 'To Do', category: 'todo' },
      assignee: null,
      priority: 'medium',
      issue_type: 'task',
      start_date: '2026-10-01',
      due_date: '2026-10-20',
      recreate_after: '1w',
    };

    useBoardStore.setState({
      issues: [readyIssue],
      columns: testColumns,
      offlineOutbox: [],
    });

    // Verify initially in "other"
    let sections = splitReadyIssues(
      useBoardStore.getState().issues,
      new Date('2026-10-07'),
      testColumns
    );
    expect(sections.homeAsUsual.length).toBe(0);
    expect(sections.other.length).toBe(1);

    // Simulate offline
    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    // Update recreate_after to '1d' while offline
    await useBoardStore.getState().updateIssueOptimistic('PROJ-302', {
      recreate_after: '1d',
    });

    // Immediately classified into Home as Usual
    sections = splitReadyIssues(
      useBoardStore.getState().issues,
      new Date('2026-10-07'),
      testColumns
    );
    expect(sections.homeAsUsual.length).toBe(1);
    expect(sections.homeAsUsual[0].key).toBe('PROJ-302');
    expect(sections.other.length).toBe(0);
  });
});
