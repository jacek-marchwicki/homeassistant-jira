import { describe, it, expect } from 'vitest';
import {
  getColumnForIssue,
  getCategoryColorVar,
  getColumnFromOver,
  isBacklogIssue,
  getActiveBoardColumns,
  splitIssuesByBacklog,
  getAvailableStatuses,
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
});
