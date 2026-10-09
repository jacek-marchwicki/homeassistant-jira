import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { PeopleBoard } from './PeopleBoard.tsx';
import { JiraIssue, BoardColumn } from '../types/jira.ts';
import { useBoardStore } from '../store/boardStore.ts';

const testColumns: BoardColumn[] = [
  { id: 'col-ready', name: 'Ready', category: 'todo', status_ids: ['10'] },
  { id: 'col-inprogress', name: 'In Progress', category: 'inprogress', status_ids: ['20'] },
  { id: 'col-done', name: 'Done', category: 'done', status_ids: ['30'] },
];

const mockNow = new Date('2026-10-05T12:00:00Z');

describe('PeopleBoard Component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    useBoardStore.setState({
      columns: testColumns,
      currentUser: 'Jacek Marchwicki',
      activeFilters: ['my', 'active', 'hide_epics'],
      activeFilter: 'my,active,hide_epics',
      searchQuery: '',
      issues: [],
      availableUsers: [
        { displayName: 'Jacek Marchwicki', accountId: 'usr-jacek' },
        { displayName: 'Alex Lead', accountId: 'usr-alex' },
      ],
    });
  });

  it('renders columns for each person (e.g. Column 1 - Person 1, Column 2 - Person 2)', async () => {
    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'PROJ-1',
        summary: 'Jacek feature work',
        priority: 'high',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        assignee: { displayName: 'Jacek Marchwicki', accountId: 'usr-jacek' },
      },
      {
        id: '2',
        key: 'PROJ-2',
        summary: 'Alex design review',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        assignee: { displayName: 'Alex Lead', accountId: 'usr-alex' },
      },
    ];

    await act(async () => {
      useBoardStore.setState({ issues });
      root.render(<PeopleBoard now={mockNow} />);
    });

    const columns = container.querySelectorAll('[data-testid^="people-column-"]');
    expect(columns.length).toBe(2);
    expect(columns[0].textContent).toContain('Jacek Marchwicki');
    expect(columns[1].textContent).toContain('Alex Lead');
  });

  it('renders unassigned tasks in EVERY person column ("In every person column, we should see the unassigned tasks exactly the same as currently Assigned to Me")', async () => {
    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'PROJ-1',
        summary: 'Task assigned only to Jacek',
        priority: 'high',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        assignee: { displayName: 'Jacek Marchwicki', accountId: 'usr-jacek' },
      },
      {
        id: '2',
        key: 'PROJ-2',
        summary: 'Task assigned only to Alex',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        assignee: { displayName: 'Alex Lead', accountId: 'usr-alex' },
      },
      {
        id: '3',
        key: 'PROJ-3',
        summary: 'Shared unassigned backlog item',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        assignee: null,
      },
    ];

    await act(async () => {
      useBoardStore.setState({ issues });
      root.render(<PeopleBoard now={mockNow} />);
    });

    const jacekCol = container.querySelector('[data-testid="people-column-usr-jacek"]');
    const alexCol = container.querySelector('[data-testid="people-column-usr-alex"]');

    expect(jacekCol).not.toBeNull();
    expect(alexCol).not.toBeNull();

    // Jacek column has Jacek's task + unassigned task, but NOT Alex's task
    expect(jacekCol?.textContent).toContain('Task assigned only to Jacek');
    expect(jacekCol?.textContent).toContain('Shared unassigned backlog item');
    expect(jacekCol?.textContent).not.toContain('Task assigned only to Alex');

    // Alex column has Alex's task + unassigned task, but NOT Jacek's task
    expect(alexCol?.textContent).toContain('Task assigned only to Alex');
    expect(alexCol?.textContent).toContain('Shared unassigned backlog item');
    expect(alexCol?.textContent).not.toContain('Task assigned only to Jacek');
  });

  it('renders all statuses including Done for 24h as crossed out', async () => {
    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'PROJ-1',
        summary: 'Recent completed task for Jacek',
        priority: 'medium',
        status: { id: 'col-done', name: 'Done', category: 'done' },
        assignee: { displayName: 'Jacek Marchwicki', accountId: 'usr-jacek' },
        updated_at: new Date(mockNow.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      },
      {
        id: '2',
        key: 'PROJ-2',
        summary: 'Old completed task for Jacek',
        priority: 'low',
        status: { id: 'col-done', name: 'Done', category: 'done' },
        assignee: { displayName: 'Jacek Marchwicki', accountId: 'usr-jacek' },
        updated_at: new Date(mockNow.getTime() - 48 * 60 * 60 * 1000).toISOString(), // 48 hours ago
      },
    ];

    await act(async () => {
      useBoardStore.setState({ issues });
      root.render(<PeopleBoard now={mockNow} />);
    });

    const jacekCol = container.querySelector('[data-testid="people-column-usr-jacek"]');
    expect(jacekCol?.textContent).toContain('Recent completed task for Jacek');
    expect(jacekCol?.textContent).not.toContain('Old completed task for Jacek');

    const doneTaskSummary = jacekCol?.querySelector('[title="Click to edit PROJ-1"]');
    expect(doneTaskSummary?.className).toContain('line-through');
  });

  it('assigns unique sortable IDs scoped by column so dragging an unassigned task starts from the specific column', async () => {
    const unassignedIssue: JiraIssue = {
      id: '3',
      key: 'SHARED-100',
      summary: 'Shared unassigned task across columns',
      priority: 'medium',
      status: { id: 'col-ready', name: 'Ready', category: 'todo' },
      assignee: null,
    };

    await act(async () => {
      useBoardStore.setState({ issues: [unassignedIssue] });
      root.render(<PeopleBoard now={mockNow} />);
    });

    const jacekCol = container.querySelector('[data-testid="people-column-usr-jacek"]');
    const alexCol = container.querySelector('[data-testid="people-column-usr-alex"]');

    const jacekCard = jacekCol?.querySelector('[data-testid="issue-card-SHARED-100"]');
    const alexCard = alexCol?.querySelector('[data-testid="issue-card-SHARED-100"]');

    expect(jacekCard).not.toBeNull();
    expect(alexCard).not.toBeNull();

    // Verify sortable IDs are column-scoped and strictly distinct
    const jacekSortableId = jacekCard?.getAttribute('data-sortable-id');
    const alexSortableId = alexCard?.getAttribute('data-sortable-id');

    expect(jacekSortableId).toBe('usr-jacek:SHARED-100');
    expect(alexSortableId).toBe('usr-alex:SHARED-100');
    expect(jacekSortableId).not.toBe(alexSortableId);
  });
});
