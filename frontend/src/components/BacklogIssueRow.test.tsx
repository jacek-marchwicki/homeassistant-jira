import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { BacklogIssueRow } from './BacklogIssueRow.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockBacklogIssue: JiraIssue = {
  id: '10',
  key: 'PROJ-104',
  summary: 'Setup WebSocket broadcast client',
  priority: 'high',
  status: { id: '0', name: 'Backlog', category: 'todo' },
  story_points: 3,
  assignee: { displayName: 'Jacek Marchwicki' },
};

describe('BacklogIssueRow component', () => {
  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        issues: [mockBacklogIssue],
        columns: [
          { id: 'col-todo', name: 'To Do', category: 'todo' },
          { id: 'col-done', name: 'Done', category: 'done' },
        ],
      });
    });
  });

  it('renders key, summary, priority, and "To Board" button for backlog issue', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <SortableContext items={[mockBacklogIssue.key]}>
            <BacklogIssueRow issue={mockBacklogIssue} />
          </SortableContext>
        </DndContext>
      );
    });

    expect(container.textContent).toContain('PROJ-104');
    expect(container.textContent).toContain('Setup WebSocket broadcast client');
    expect(container.textContent).toContain('Backlog');
    expect(container.textContent).toContain('To Board');

    // Issue key Jira link
    const link = container.querySelector('a[aria-label="Open PROJ-104 in Jira"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('href')).toBe('https://jira.example.com/browse/PROJ-104');

    await act(async () => {
      root.unmount();
    });
  });

  it('calls moveToBoard when "To Board" button is clicked', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const moveToBoardSpy = vi.fn();
    act(() => {
      useBoardStore.setState({
        moveToBoard: moveToBoardSpy,
      });
    });

    await act(async () => {
      root.render(
        <DndContext>
          <SortableContext items={[mockBacklogIssue.key]}>
            <BacklogIssueRow issue={mockBacklogIssue} />
          </SortableContext>
        </DndContext>
      );
    });

    const button = container.querySelector('button[aria-label="Move PROJ-104 to Board"]');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(moveToBoardSpy).toHaveBeenCalledWith('PROJ-104');

    await act(async () => {
      root.unmount();
    });
  });
});
