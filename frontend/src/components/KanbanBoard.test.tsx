import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { KanbanBoard } from './KanbanBoard.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';

// Configure React act environment for Happy-DOM
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testIssues: JiraIssue[] = [
  {
    id: '1',
    key: 'TEST-1',
    summary: 'Fix navigation menu',
    priority: 'high',
    status: { id: 'col-todo', name: 'To Do', category: 'todo' },
    assignee: { accountId: 'usr-1', displayName: 'Jacek Marchwicki' },
    start_date: '2026-10-01',
  },
  {
    id: '2',
    key: 'TEST-2',
    summary: 'Database connection issue',
    priority: 'highest',
    status: { id: 'col-inprogress', name: 'In Progress', category: 'inprogress' },
    assignee: { accountId: 'usr-2', displayName: 'Alex Lead' },
    start_date: '2026-10-01',
  },
  {
    id: '3',
    key: 'TEST-3',
    summary: 'Unassigned task',
    priority: 'medium',
    status: { id: 'col-todo', name: 'To Do', category: 'todo' },
    assignee: null,
    start_date: null,
  },
  {
    id: '4',
    key: 'TEST-4',
    summary: 'Future task for me',
    priority: 'low',
    status: { id: 'col-todo', name: 'To Do', category: 'todo' },
    assignee: { accountId: 'usr-1', displayName: 'Jacek Marchwicki' },
    start_date: '2099-01-01',
  },
];

describe('KanbanBoard component', () => {
  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        issues: testIssues,
        searchQuery: '',
        activeFilters: [],
        activeFilter: 'all',
      });
    });
  });

  it('renders all Kanban columns with their respective issues when All Issues is selected', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<KanbanBoard />);
    });

    const columns = useBoardStore.getState().columns;
    for (const col of columns) {
      const colElem = container.querySelector(`[data-testid="column-${col.id}"]`);
      expect(colElem).not.toBeNull();
    }

    expect(container.textContent).toContain('Fix navigation menu');
    expect(container.textContent).toContain('Database connection issue');
    expect(container.textContent).toContain('Unassigned task');
    expect(container.textContent).toContain('Future task for me');

    await act(async () => {
      root.unmount();
    });
  });

  it('filters issues by search query across summaries and keys', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      useBoardStore.setState({ searchQuery: 'Database' });
      root.render(<KanbanBoard />);
    });

    expect(container.textContent).not.toContain('Fix navigation menu');
    expect(container.textContent).toContain('Database connection issue');

    await act(async () => {
      root.unmount();
    });
  });

  it('filters issues when "my" filter is active (includes me and unassigned, excludes others)', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      useBoardStore.setState({ activeFilters: ['my'], activeFilter: 'my' });
      root.render(<KanbanBoard />);
    });

    expect(container.textContent).toContain('Fix navigation menu');
    expect(container.textContent).toContain('Unassigned task');
    expect(container.textContent).not.toContain('Database connection issue');

    await act(async () => {
      root.unmount();
    });
  });

  it('filters issues when "active" filter is active (excludes future start dates)', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      useBoardStore.setState({ activeFilters: ['active'], activeFilter: 'active' });
      root.render(<KanbanBoard />);
    });

    expect(container.textContent).toContain('Fix navigation menu');
    expect(container.textContent).toContain('Database connection issue');
    expect(container.textContent).toContain('Unassigned task');
    expect(container.textContent).not.toContain('Future task for me');

    await act(async () => {
      root.unmount();
    });
  });

  it('filters issues when both "my" and "active" are active by default', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      useBoardStore.setState({ activeFilters: ['my', 'active'], activeFilter: 'my,active' });
      root.render(<KanbanBoard />);
    });

    expect(container.textContent).toContain('Fix navigation menu');
    expect(container.textContent).toContain('Unassigned task');
    expect(container.textContent).not.toContain('Database connection issue');
    expect(container.textContent).not.toContain('Future task for me');

    await act(async () => {
      root.unmount();
    });
  });

  it('displays only Done issues updated no longer than 2 days ago in the DONE column', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();

    const issuesWithDone: JiraIssue[] = [
      {
        id: 'done-recent',
        key: 'DONE-RECENT',
        summary: 'Recent Done Task',
        priority: 'medium',
        status: { id: 'col-done', name: 'Done', category: 'done' },
        updated_at: oneDayAgo,
      },
      {
        id: 'done-old',
        key: 'DONE-OLD',
        summary: 'Old Done Task From Last Week',
        priority: 'low',
        status: { id: 'col-done', name: 'Done', category: 'done' },
        updated_at: fourDaysAgo,
      },
    ];

    await act(async () => {
      useBoardStore.setState({
        issues: issuesWithDone,
        activeFilters: [],
        activeFilter: 'all',
      });
      root.render(<KanbanBoard />);
    });

    expect(container.textContent).toContain('Recent Done Task');
    expect(container.textContent).not.toContain('Old Done Task From Last Week');

    await act(async () => {
      root.unmount();
    });
  });
});

