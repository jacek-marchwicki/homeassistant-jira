import { describe, it, expect } from 'vitest';
import { JiraIssue, KanbanColumnData, JiraStatusCategory } from './jira.ts';

describe('Jira Types and Domain Entities', () => {
  it('creates a valid JiraIssue with optimistic tracking fields', () => {
    const issue: JiraIssue = {
      id: '1001',
      key: 'PROJ-101',
      summary: 'Implement optimistic UI rollback',
      issueType: 'task',
      priority: 'high',
      status: {
        id: '1',
        name: 'To Do',
        category: 'todo',
      },
      updatedAt: '2026-10-04T22:00:00Z',
      _optimisticState: 'pending',
      _pendingTargetStatusId: '2',
    };

    expect(issue.key).toBe('PROJ-101');
    expect(issue._optimisticState).toBe('pending');
    expect(issue.status.category).toBe('todo');
  });

  it('structures Kanban columns with status grouping', () => {
    const column: KanbanColumnData = {
      id: 'col-todo',
      title: 'To Do',
      category: 'todo' as JiraStatusCategory,
      statuses: [
        { id: '1', name: 'To Do', category: 'todo' },
        { id: '10', name: 'Backlog', category: 'todo' },
      ],
      issues: [],
      wipLimit: 5,
    };

    expect(column.statuses).toHaveLength(2);
    expect(column.wipLimit).toBe(5);
  });
});
