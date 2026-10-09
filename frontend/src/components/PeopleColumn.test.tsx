import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DndContext } from '@dnd-kit/core';
import { PeopleColumn } from './PeopleColumn.tsx';
import { JiraIssue, BoardColumn } from '../types/jira.ts';
import { useBoardStore } from '../store/boardStore.ts';

const testColumns: BoardColumn[] = [
  { id: 'col-ready', name: 'Ready', category: 'todo', status_ids: ['10'] },
  { id: 'col-inprogress', name: 'In Progress', category: 'inprogress', status_ids: ['20'] },
  { id: 'col-done', name: 'Done', category: 'done', status_ids: ['30'] },
];

const mockNow = new Date('2026-10-05T12:00:00Z');

describe('PeopleColumn Component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useBoardStore.setState({
      columns: testColumns,
      currentUser: 'Jacek Marchwicki',
      issues: [],
    });
  });

  it('renders person header with displayName, initials avatar, and issue count', async () => {
    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'PROJ-1',
        summary: 'Task assigned to Alice',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        assignee: { displayName: 'Alice Engineer', accountId: 'usr-alice' },
      },
    ];

    await act(async () => {
      root.render(
        <DndContext>
          <PeopleColumn
            person={{ displayName: 'Alice Engineer', accountId: 'usr-alice' }}
            issues={issues}
          />
        </DndContext>
      );
    });

    expect(container.textContent).toContain('Alice Engineer');
    expect(container.textContent).toContain('AE'); // Initials in avatar
    expect(container.textContent).toContain('1'); // Count
    expect(container.textContent).toContain('Task assigned to Alice');
  });

  it('renders unassigned tasks and assigned tasks within the column', async () => {
    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'PROJ-1',
        summary: 'Directly assigned to Bob',
        priority: 'high',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        assignee: { displayName: 'Bob Backend', accountId: 'usr-bob' },
      },
      {
        id: '2',
        key: 'PROJ-2',
        summary: 'Unassigned task visible for Bob',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        assignee: null,
      },
    ];

    await act(async () => {
      root.render(
        <DndContext>
          <PeopleColumn
            person={{ displayName: 'Bob Backend', accountId: 'usr-bob' }}
            issues={issues}
          />
        </DndContext>
      );
    });

    expect(container.textContent).toContain('Directly assigned to Bob');
    expect(container.textContent).toContain('Unassigned task visible for Bob');
  });

  it('renders Done tasks updated within 24h as crossed out (line-through)', async () => {
    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'PROJ-1',
        summary: 'Recently completed task',
        priority: 'medium',
        status: { id: 'col-done', name: 'Done', category: 'done' },
        assignee: { displayName: 'Alice Engineer', accountId: 'usr-alice' },
        updated_at: new Date(mockNow.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      },
    ];

    await act(async () => {
      root.render(
        <DndContext>
          <PeopleColumn
            person={{ displayName: 'Alice Engineer', accountId: 'usr-alice' }}
            issues={issues}
            now={mockNow}
          />
        </DndContext>
      );
    });

    expect(container.textContent).toContain('Recently completed task');
    const summaryEl = container.querySelector('[title="Click to edit PROJ-1"]');
    expect(summaryEl?.className).toContain('line-through');
  });

  it('filters out Done tasks older than 24 hours', async () => {
    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'PROJ-1',
        summary: 'Recent completed task',
        priority: 'medium',
        status: { id: 'col-done', name: 'Done', category: 'done' },
        assignee: { displayName: 'Alice Engineer', accountId: 'usr-alice' },
        updated_at: new Date(mockNow.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        id: '2',
        key: 'PROJ-2',
        summary: 'Old completed task from 3 days ago',
        priority: 'low',
        status: { id: 'col-done', name: 'Done', category: 'done' },
        assignee: { displayName: 'Alice Engineer', accountId: 'usr-alice' },
        updated_at: new Date(mockNow.getTime() - 72 * 60 * 60 * 1000).toISOString(),
      },
    ];

    await act(async () => {
      root.render(
        <DndContext>
          <PeopleColumn
            person={{ displayName: 'Alice Engineer', accountId: 'usr-alice' }}
            issues={issues}
            now={mockNow}
          />
        </DndContext>
      );
    });

    expect(container.textContent).toContain('Recent completed task');
    expect(container.textContent).not.toContain('Old completed task from 3 days ago');
  });
});
