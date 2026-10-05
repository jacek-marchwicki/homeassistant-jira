import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BacklogView } from './BacklogView.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testIssues: JiraIssue[] = [
  {
    id: '1',
    key: 'PROJ-1',
    summary: 'Active sprint task',
    priority: 'high',
    status: { id: 'col-todo', name: 'To Do', category: 'todo' },
    story_points: 5,
    assignee: { displayName: 'Jacek Marchwicki' },
  },
  {
    id: '2',
    key: 'PROJ-2',
    summary: 'Backlog feature item',
    priority: 'medium',
    status: { id: '0', name: 'Backlog', category: 'todo' },
    story_points: 3,
    assignee: { displayName: 'Alex Lead' },
  },
];

describe('BacklogView component', () => {
  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        issues: testIssues,
        sprintName: 'Sprint 42',
        searchQuery: '',
        activeFilter: 'all',
        columns: [
          { id: 'col-todo', name: 'To Do', category: 'todo' },
          { id: 'col-done', name: 'Done', category: 'done' },
        ],
      });
    });
  });

  it('renders both the Active Sprint and Backlog sections with their respective issues', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<BacklogView />);
    });

    expect(container.textContent).toContain('Sprint 42');
    expect(container.textContent).toContain('Active sprint task');
    expect(container.textContent).toContain('Backlog');
    expect(container.textContent).toContain('Backlog feature item');

    await act(async () => {
      root.unmount();
    });
  });

  it('filters issues by search query across both sections', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      useBoardStore.setState({ searchQuery: 'Backlog feature' });
      root.render(<BacklogView />);
    });

    expect(container.textContent).not.toContain('Active sprint task');
    expect(container.textContent).toContain('Backlog feature item');

    await act(async () => {
      root.unmount();
    });
  });

  it('filters issues when "my" filter is active', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      useBoardStore.setState({ activeFilter: 'my' });
      root.render(<BacklogView />);
    });

    expect(container.textContent).toContain('Active sprint task');
    expect(container.textContent).not.toContain('Backlog feature item');

    await act(async () => {
      root.unmount();
    });
  });
});
