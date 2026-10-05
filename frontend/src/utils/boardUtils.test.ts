import { describe, it, expect } from 'vitest';
import { getColumnForIssue, getCategoryColorVar } from './boardUtils.ts';
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
});
