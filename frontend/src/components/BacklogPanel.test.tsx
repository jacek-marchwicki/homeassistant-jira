import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext } from '@dnd-kit/core';
import { BacklogPanel } from './BacklogPanel.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testBacklogIssues: JiraIssue[] = [
  {
    id: '1',
    key: 'BACK-1',
    summary: 'First backlog item',
    priority: 'low',
    status: { id: '0', name: 'Backlog', category: 'todo' },
    story_points: 5,
  },
  {
    id: '2',
    key: 'BACK-2',
    summary: 'Second backlog item',
    priority: 'medium',
    status: { id: '0', name: 'Backlog', category: 'todo' },
    story_points: 3,
  },
];

describe('BacklogPanel component', () => {
  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        issues: testBacklogIssues,
        isBacklogExpandedOnBoard: false,
      });
    });
  });

  it('renders panel header with issue count, points, and expand toggle button', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <BacklogPanel issues={testBacklogIssues} />
        </DndContext>
      );
    });

    expect(container.textContent).toContain('Backlog');
    expect(container.textContent).toContain('2 issues');
    expect(container.textContent).toContain('8 pts');
    expect(container.textContent).toContain('Show List (2)');
    expect(container.textContent).not.toContain('First backlog item');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders issue rows when isBacklogExpandedOnBoard is true', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      useBoardStore.setState({ isBacklogExpandedOnBoard: true });
    });

    await act(async () => {
      root.render(
        <DndContext>
          <BacklogPanel issues={testBacklogIssues} />
        </DndContext>
      );
    });

    expect(container.textContent).toContain('Hide List');
    expect(container.textContent).toContain('First backlog item');
    expect(container.textContent).toContain('Second backlog item');

    await act(async () => {
      root.unmount();
    });
  });

  it('calls setCurrentView("backlog") when "Open Backlog View" is clicked', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const setCurrentViewSpy = vi.fn();
    act(() => {
      useBoardStore.setState({ setCurrentView: setCurrentViewSpy });
    });

    await act(async () => {
      root.render(
        <DndContext>
          <BacklogPanel issues={testBacklogIssues} />
        </DndContext>
      );
    });

    const openViewBtn = container.querySelector('button[aria-label="Open Full Backlog View"]');
    expect(openViewBtn).not.toBeNull();

    await act(async () => {
      openViewBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(setCurrentViewSpy).toHaveBeenCalledWith('backlog');

    await act(async () => {
      root.unmount();
    });
  });
});
