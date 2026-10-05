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
  },
  {
    id: '2',
    key: 'TEST-2',
    summary: 'Database connection issue',
    priority: 'highest',
    status: { id: 'col-inprogress', name: 'In Progress', category: 'inprogress' },
    assignee: { accountId: 'usr-2', displayName: 'Alex Lead' },
  },
];

describe('KanbanBoard component', () => {
  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        issues: testIssues,
        searchQuery: '',
        activeFilter: 'all',
      });
    });
  });

  it('renders all Kanban columns with their respective issues', async () => {
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

  it('filters issues when "my" filter is active', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      useBoardStore.setState({ activeFilter: 'my' });
      root.render(<KanbanBoard />);
    });

    expect(container.textContent).toContain('Fix navigation menu');
    expect(container.textContent).not.toContain('Database connection issue');

    await act(async () => {
      root.unmount();
    });
  });
});
