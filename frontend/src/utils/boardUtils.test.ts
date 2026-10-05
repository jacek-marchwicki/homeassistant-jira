import { describe, it, expect } from 'vitest';
import {
  getColumnForIssue,
  getCategoryColorVar,
  getColumnFromOver,
  isBacklogIssue,
  getActiveBoardColumns,
  splitIssuesByBacklog,
  getAvailableStatuses,
  parseDate,
  isIssueOverdue,
  isIssueExpedited,
  splitReadyIssues,
  isAssignedToMeOrUnassigned,
  isIssueActive,
  filterIssues,
} from './boardUtils.ts';
import { BoardColumn, JiraIssue } from '../types/jira.ts';

const homeColumns: BoardColumn[] = [
  { id: 'col-backlog', name: 'Backlog', category: 'todo', status_ids: ['10002'] },
  { id: 'col-ready', name: 'Ready', category: 'todo', status_ids: ['10003'] },
  { id: 'col-in-progress', name: 'In Progress', category: 'inprogress', status_ids: ['3'] },
  { id: 'col-done', name: 'Done', category: 'done', status_ids: ['10001'] },
];

const mockBaseIssue: JiraIssue = {
  id: '1',
  key: 'HOME-1',
  summary: 'Test task',
  priority: 'medium',
  status: { id: '10002', name: 'Backlog', category: 'todo' },
};

// Fixed reference time for deterministic testing: 2026-10-05 12:00:00 local time
const fixedNow = new Date(2026, 9, 5, 12, 0, 0); // October 5, 2026

describe('boardUtils', () => {
  it('correctly maps issue by status ID when columns share the same category', () => {
    const backlogIssue: JiraIssue = {
      ...mockBaseIssue,
      status: { id: '10002', name: 'Backlog', category: 'todo' },
    };
    const readyIssue: JiraIssue = {
      ...mockBaseIssue,
      status: { id: '10003', name: 'Ready', category: 'todo' },
    };

    expect(getColumnForIssue(backlogIssue, homeColumns)?.id).toBe('col-backlog');
    expect(getColumnForIssue(readyIssue, homeColumns)?.id).toBe('col-ready');
  });

  it('correctly maps issue by status name when status ID is missing or unknown', () => {
    const issueByName: JiraIssue = {
      ...mockBaseIssue,
      status: { id: '99999', name: 'Ready', category: 'todo' },
    };

    expect(getColumnForIssue(issueByName, homeColumns)?.id).toBe('col-ready');
  });

  it('falls back to category match when neither ID nor name match', () => {
    const unknownStatusIssue: JiraIssue = {
      ...mockBaseIssue,
      status: { id: '8888', name: 'Custom Progress Step', category: 'inprogress' },
    };

    expect(getColumnForIssue(unknownStatusIssue, homeColumns)?.id).toBe('col-in-progress');
  });

  it('returns default column if columns is empty or no match', () => {
    expect(getColumnForIssue(mockBaseIssue, [])).toBeUndefined();
  });

  it('resolves CSS variables for status categories', () => {
    expect(getCategoryColorVar('todo')).toBe('var(--jira-status-todo)');
    expect(getCategoryColorVar('inprogress')).toBe('var(--jira-status-inprogress)');
    expect(getCategoryColorVar('inreview')).toBe('var(--jira-status-inreview)');
    expect(getCategoryColorVar('done')).toBe('var(--jira-status-done)');
    expect(getCategoryColorVar('blocked')).toBe('var(--jira-status-blocked)');
  });

  describe('getColumnFromOver', () => {
    it('returns undefined when over is null or undefined', () => {
      expect(getColumnFromOver(null, homeColumns, [mockBaseIssue])).toBeUndefined();
      expect(getColumnFromOver(undefined, homeColumns, [mockBaseIssue])).toBeUndefined();
    });

    it('returns undefined when columns array is empty', () => {
      expect(
        getColumnFromOver({ id: 'col-ready' }, [], [mockBaseIssue])
      ).toBeUndefined();
    });

    it('resolves target column from a Column droppable', () => {
      const over = {
        id: 'col-in-progress',
        data: {
          current: {
            type: 'Column',
            columnId: 'col-in-progress',
          },
        },
      };
      expect(getColumnFromOver(over, homeColumns, [mockBaseIssue])?.id).toBe(
        'col-in-progress'
      );
    });

    it('resolves target column from an Issue sortable item', () => {
      const over = {
        id: 'HOME-1',
        data: {
          current: {
            type: 'Issue',
            issue: mockBaseIssue, // Backlog (col-backlog)
          },
        },
      };
      expect(getColumnFromOver(over, homeColumns, [mockBaseIssue])?.id).toBe(
        'col-backlog'
      );
    });

    it('resolves target column by column ID fallback', () => {
      const over = {
        id: 'col-done',
      };
      expect(getColumnFromOver(over, homeColumns, [mockBaseIssue])?.id).toBe(
        'col-done'
      );
    });

    it('resolves target column by issue key fallback', () => {
      const over = {
        id: 'HOME-1',
      };
      expect(getColumnFromOver(over, homeColumns, [mockBaseIssue])?.id).toBe(
        'col-backlog'
      );
    });

    it('returns undefined when over does not match any column or issue', () => {
      const over = {
        id: 'non-existent-id',
      };
      expect(getColumnFromOver(over, homeColumns, [mockBaseIssue])).toBeUndefined();
    });
  });

  describe('Backlog utilities', () => {
    it('identifies issues by status name "Backlog"', () => {
      const issue: JiraIssue = {
        ...mockBaseIssue,
        status: { id: '99', name: 'Backlog', category: 'todo' },
      };
      expect(isBacklogIssue(issue)).toBe(true);
    });

    it('identifies issues with in_backlog flag', () => {
      const issue = {
        ...mockBaseIssue,
        status: { id: '1', name: 'To Do', category: 'todo' as const },
        in_backlog: true,
      };
      expect(isBacklogIssue(issue as JiraIssue)).toBe(true);
    });

    it('identifies issues mapped to Backlog column', () => {
      const issue: JiraIssue = {
        ...mockBaseIssue,
        status: { id: '10002', name: 'Raw Ingest', category: 'todo' },
      };
      expect(isBacklogIssue(issue, homeColumns)).toBe(true);
    });

    it('returns false for active sprint issues', () => {
      const issue: JiraIssue = {
        ...mockBaseIssue,
        status: { id: '3', name: 'In Progress', category: 'inprogress' },
      };
      expect(isBacklogIssue(issue, homeColumns)).toBe(false);
    });

    it('filters out Backlog column in getActiveBoardColumns', () => {
      const active = getActiveBoardColumns(homeColumns);
      expect(active.some((c) => c.name.toLowerCase() === 'backlog')).toBe(false);
      expect(active.map((c) => c.name)).toEqual(['Ready', 'In Progress', 'Done']);
    });

    it('splits issues cleanly into boardIssues and backlogIssues', () => {
      const issues: JiraIssue[] = [
        { ...mockBaseIssue, key: 'ISSUE-1', status: { id: '10002', name: 'Backlog', category: 'todo' } },
        { ...mockBaseIssue, key: 'ISSUE-2', status: { id: '3', name: 'In Progress', category: 'inprogress' } },
        { ...mockBaseIssue, key: 'ISSUE-3', status: { id: '10001', name: 'Done', category: 'done' } },
      ];

      const { boardIssues, backlogIssues } = splitIssuesByBacklog(issues, homeColumns);
      expect(backlogIssues.map((i) => i.key)).toEqual(['ISSUE-1']);
      expect(boardIssues.map((i) => i.key)).toEqual(['ISSUE-2', 'ISSUE-3']);
    });

    it('provides available statuses including Backlog', () => {
      const colsWithoutBacklog: BoardColumn[] = [
        { id: 'c1', name: 'To Do', category: 'todo' },
        { id: 'c2', name: 'Done', category: 'done' },
      ];
      const options = getAvailableStatuses(colsWithoutBacklog);
      expect(options.some((o) => o.name === 'Backlog')).toBe(true);
      expect(options.some((o) => o.name === 'To Do')).toBe(true);
      expect(options.some((o) => o.name === 'Done')).toBe(true);
    });
  });

  describe('Ready section splitting (Overdue, Expedited, Other)', () => {
    it('correctly parses dates in YYYY-MM-DD format in local time', () => {
      const parsed = parseDate('2026-10-05');
      expect(parsed).not.toBeNull();
      expect(parsed?.getFullYear()).toBe(2026);
      expect(parsed?.getMonth()).toBe(9); // 0-indexed October
      expect(parsed?.getDate()).toBe(5);

      expect(parseDate(null)).toBeNull();
      expect(parseDate(undefined)).toBeNull();
      expect(parseDate('')).toBeNull();
      expect(parseDate('invalid-date')).toBeNull();
    });

    it('identifies an issue as Overdue when due date is strictly before today', () => {
      const overdueIssue: JiraIssue = {
        ...mockBaseIssue,
        due_date: '2026-10-04', // Yesterday
      };
      const todayIssue: JiraIssue = {
        ...mockBaseIssue,
        due_date: '2026-10-05', // Today
      };
      const futureIssue: JiraIssue = {
        ...mockBaseIssue,
        due_date: '2026-10-06', // Tomorrow
      };
      const noDueDateIssue: JiraIssue = {
        ...mockBaseIssue,
        due_date: null,
      };

      expect(isIssueOverdue(overdueIssue, fixedNow)).toBe(true);
      expect(isIssueOverdue(todayIssue, fixedNow)).toBe(false);
      expect(isIssueOverdue(futureIssue, fixedNow)).toBe(false);
      expect(isIssueOverdue(noDueDateIssue, fixedNow)).toBe(false);
    });

    it('identifies an issue as Expedited when priority = Highest and Start date is EMPTY or <= now', () => {
      const highestNoStartDate: JiraIssue = {
        ...mockBaseIssue,
        priority: 'highest',
        start_date: null,
      };
      const highestStartedPast: JiraIssue = {
        ...mockBaseIssue,
        priority: 'highest',
        start_date: '2026-10-01', // Before now
      };
      const highestStartInFuture: JiraIssue = {
        ...mockBaseIssue,
        priority: 'highest',
        start_date: '2026-10-15', // After now
      };
      const highPriorityIssue: JiraIssue = {
        ...mockBaseIssue,
        priority: 'high',
        start_date: null,
      };

      expect(isIssueExpedited(highestNoStartDate, fixedNow)).toBe(true);
      expect(isIssueExpedited(highestStartedPast, fixedNow)).toBe(true);
      expect(isIssueExpedited(highestStartInFuture, fixedNow)).toBe(false);
      expect(isIssueExpedited(highPriorityIssue, fixedNow)).toBe(false);
    });

    it('identifies an issue as Expedited when due date is <= endOfDay', () => {
      const dueToday: JiraIssue = {
        ...mockBaseIssue,
        priority: 'medium',
        due_date: '2026-10-05', // Today
      };
      const dueTomorrow: JiraIssue = {
        ...mockBaseIssue,
        priority: 'medium',
        due_date: '2026-10-06',
      };

      expect(isIssueExpedited(dueToday, fixedNow)).toBe(true);
      expect(isIssueExpedited(dueTomorrow, fixedNow)).toBe(false);
    });

    it('excludes overdue issues from Expedited (overdue takes precedence)', () => {
      const overdueHighest: JiraIssue = {
        ...mockBaseIssue,
        priority: 'highest',
        due_date: '2026-10-01',
      };

      expect(isIssueOverdue(overdueHighest, fixedNow)).toBe(true);
      expect(isIssueExpedited(overdueHighest, fixedNow)).toBe(false);
    });

    it('splits a collection of Ready issues into Overdue, Expedited, and Other cleanly', () => {
      const issues: JiraIssue[] = [
        // 1. Overdue issue (due date in past)
        {
          ...mockBaseIssue,
          key: 'TASK-OVERDUE',
          summary: 'Overdue task',
          due_date: '2026-09-30',
          priority: 'medium',
        },
        // 2. Expedited: Highest priority with empty start date
        {
          ...mockBaseIssue,
          key: 'TASK-EXP-HIGHEST',
          summary: 'Highest priority active task',
          priority: 'highest',
          start_date: null,
          due_date: '2026-10-20',
        },
        // 3. Expedited: Medium priority but due today
        {
          ...mockBaseIssue,
          key: 'TASK-EXP-TODAY',
          summary: 'Due today task',
          priority: 'medium',
          due_date: '2026-10-05',
        },
        // 4. Other: Highest priority but start date is in the future
        {
          ...mockBaseIssue,
          key: 'TASK-OTHER-FUTURE-START',
          summary: 'Highest priority future task',
          priority: 'highest',
          start_date: '2026-10-25',
          due_date: '2026-10-30',
        },
        // 5. Other: Normal medium priority task due in future
        {
          ...mockBaseIssue,
          key: 'TASK-OTHER-NORMAL',
          summary: 'Normal scheduled task',
          priority: 'medium',
          due_date: '2026-10-15',
        },
        // 6. Other: Task with no due date and no start date
        {
          ...mockBaseIssue,
          key: 'TASK-OTHER-NO-DATES',
          summary: 'Unscheduled task',
          priority: 'low',
        },
      ];

      const { overdue, expedited, other } = splitReadyIssues(issues, fixedNow);

      expect(overdue.map((i) => i.key)).toEqual(['TASK-OVERDUE']);
      expect(expedited.map((i) => i.key)).toEqual(['TASK-EXP-HIGHEST', 'TASK-EXP-TODAY']);
      expect(other.map((i) => i.key)).toEqual([
        'TASK-OTHER-FUTURE-START',
        'TASK-OTHER-NORMAL',
        'TASK-OTHER-NO-DATES',
      ]);
    });
  });

  describe('isAssignedToMeOrUnassigned', () => {
    it('returns true when issue has no assignee', () => {
      const issueWithoutAssignee: JiraIssue = {
        ...mockBaseIssue,
        assignee: null,
      };
      expect(isAssignedToMeOrUnassigned(issueWithoutAssignee)).toBe(true);

      const issueUndefinedAssignee: JiraIssue = {
        ...mockBaseIssue,
        assignee: undefined,
      };
      expect(isAssignedToMeOrUnassigned(issueUndefinedAssignee)).toBe(true);
    });

    it('returns true when assignee name is empty or whitespace', () => {
      const issueWithEmptyName: JiraIssue = {
        ...mockBaseIssue,
        assignee: { displayName: '' },
      };
      expect(isAssignedToMeOrUnassigned(issueWithEmptyName)).toBe(true);

      const issueWithWhitespace: JiraIssue = {
        ...mockBaseIssue,
        assignee: { displayName: '   ' },
      };
      expect(isAssignedToMeOrUnassigned(issueWithWhitespace)).toBe(true);
    });

    it('returns true when issue is assigned to Jacek (default me)', () => {
      const issueMe: JiraIssue = {
        ...mockBaseIssue,
        assignee: { displayName: 'Jacek Marchwicki' },
      };
      expect(isAssignedToMeOrUnassigned(issueMe)).toBe(true);

      const issueSnakeCase: JiraIssue = {
        ...mockBaseIssue,
        assignee: { display_name: 'jacek' },
      };
      expect(isAssignedToMeOrUnassigned(issueSnakeCase)).toBe(true);
    });

    it('returns false when issue is assigned to someone else', () => {
      const issueOther: JiraIssue = {
        ...mockBaseIssue,
        assignee: { displayName: 'Alex Lead' },
      };
      expect(isAssignedToMeOrUnassigned(issueOther)).toBe(false);
    });

    it('supports custom currentUser name', () => {
      const issueAlex: JiraIssue = {
        ...mockBaseIssue,
        assignee: { displayName: 'Alex Lead' },
      };
      expect(isAssignedToMeOrUnassigned(issueAlex, 'Alex')).toBe(true);
      expect(isAssignedToMeOrUnassigned(issueAlex, 'Jacek')).toBe(false);
    });
  });

  describe('isIssueActive', () => {
    it('returns true when issue has no start date', () => {
      const noStartDate: JiraIssue = {
        ...mockBaseIssue,
        start_date: null,
      };
      expect(isIssueActive(noStartDate, fixedNow)).toBe(true);

      const undefinedStartDate: JiraIssue = {
        ...mockBaseIssue,
        start_date: undefined,
      };
      expect(isIssueActive(undefinedStartDate, fixedNow)).toBe(true);
    });

    it('returns true when start date is in the past', () => {
      const pastStart: JiraIssue = {
        ...mockBaseIssue,
        start_date: '2026-10-01',
      };
      expect(isIssueActive(pastStart, fixedNow)).toBe(true);
    });

    it('returns true when start date is today', () => {
      const todayStart: JiraIssue = {
        ...mockBaseIssue,
        start_date: '2026-10-05',
      };
      expect(isIssueActive(todayStart, fixedNow)).toBe(true);
    });

    it('returns false when start date is in the future', () => {
      const tomorrowStart: JiraIssue = {
        ...mockBaseIssue,
        start_date: '2026-10-06',
      };
      expect(isIssueActive(tomorrowStart, fixedNow)).toBe(false);

      const futureStart: JiraIssue = {
        ...mockBaseIssue,
        start_date: '2026-10-25',
      };
      expect(isIssueActive(futureStart, fixedNow)).toBe(false);
    });
  });

  describe('filterIssues', () => {
    const issuesList: JiraIssue[] = [
      {
        ...mockBaseIssue,
        key: 'ISSUE-1',
        summary: 'Me with past start date',
        assignee: { displayName: 'Jacek Marchwicki' },
        start_date: '2026-10-01',
      },
      {
        ...mockBaseIssue,
        key: 'ISSUE-2',
        summary: 'Unassigned with no start date',
        assignee: null,
        start_date: null,
      },
      {
        ...mockBaseIssue,
        key: 'ISSUE-3',
        summary: 'Alex with past start date',
        assignee: { displayName: 'Alex Lead' },
        start_date: '2026-10-01',
      },
      {
        ...mockBaseIssue,
        key: 'ISSUE-4',
        summary: 'Me with future start date',
        assignee: { displayName: 'Jacek Marchwicki' },
        start_date: '2026-10-15',
      },
      {
        ...mockBaseIssue,
        key: 'ISSUE-5',
        summary: 'Unassigned with future start date',
        assignee: null,
        start_date: '2026-10-20',
      },
    ];

    it('applies default quick filters (my + active) when no options provided', () => {
      const result = filterIssues(issuesList, { now: fixedNow });
      // Expect: ISSUE-1 (me, past start) and ISSUE-2 (unassigned, no start)
      expect(result.map((i) => i.key)).toEqual(['ISSUE-1', 'ISSUE-2']);
    });

    it('filters by only "my" when activeFilters is ["my"]', () => {
      const result = filterIssues(issuesList, { activeFilters: ['my'], now: fixedNow });
      // Expect all issues assigned to me or unassigned, even if future start date:
      // ISSUE-1 (me), ISSUE-2 (unassigned), ISSUE-4 (me), ISSUE-5 (unassigned)
      expect(result.map((i) => i.key)).toEqual(['ISSUE-1', 'ISSUE-2', 'ISSUE-4', 'ISSUE-5']);
    });

    it('filters by only "active" when activeFilters is ["active"]', () => {
      const result = filterIssues(issuesList, { activeFilters: ['active'], now: fixedNow });
      // Expect all issues with start date <= today or empty, regardless of assignee:
      // ISSUE-1 (me, past), ISSUE-2 (unassigned, empty), ISSUE-3 (Alex, past)
      expect(result.map((i) => i.key)).toEqual(['ISSUE-1', 'ISSUE-2', 'ISSUE-3']);
    });

    it('returns all issues when activeFilters is empty (All Issues)', () => {
      const result = filterIssues(issuesList, { activeFilters: [], now: fixedNow });
      expect(result.map((i) => i.key)).toEqual([
        'ISSUE-1',
        'ISSUE-2',
        'ISSUE-3',
        'ISSUE-4',
        'ISSUE-5',
      ]);
    });

    it('respects legacy activeFilter="all"', () => {
      const result = filterIssues(issuesList, { activeFilter: 'all', now: fixedNow });
      expect(result.map((i) => i.key)).toEqual([
        'ISSUE-1',
        'ISSUE-2',
        'ISSUE-3',
        'ISSUE-4',
        'ISSUE-5',
      ]);
    });

    it('combines text search with quick filters', () => {
      const result = filterIssues(issuesList, {
        activeFilters: ['my', 'active'],
        searchQuery: 'ISSUE-2',
        now: fixedNow,
      });
      expect(result.map((i) => i.key)).toEqual(['ISSUE-2']);
    });
  });
});
