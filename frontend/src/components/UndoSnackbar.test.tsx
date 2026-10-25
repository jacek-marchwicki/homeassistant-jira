import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { UndoSnackbar } from './UndoSnackbar.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockIssue: JiraIssue = {
  id: '101',
  key: 'PROJ-101',
  summary: 'Test task for undo',
  priority: 'high',
  status: { id: 'col-todo', name: 'To Do', category: 'todo' },
};

describe('UndoSnackbar component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('renders nothing when pendingQuickDone is null', async () => {
    act(() => {
      useBoardStore.setState({
        pendingQuickDone: null,
      });
    });

    await act(async () => {
      root.render(<UndoSnackbar />);
    });

    expect(container.innerHTML).toBe('');
  });

  it('renders snackbar with issue key, message, and Undo button when pendingQuickDone is active', async () => {
    act(() => {
      useBoardStore.setState({
        pendingQuickDone: {
          issueKey: 'PROJ-101',
          originalIssue: mockIssue,
          timeoutId: 123 as unknown as ReturnType<typeof setTimeout>,
          targetCategory: 'done',
          targetStatus: 'Done',
          startTime: Date.now(),
          durationMs: 5000,
        },
      });
    });

    await act(async () => {
      root.render(<UndoSnackbar />);
    });

    expect(container.textContent).toContain('PROJ-101');
    expect(container.textContent).toContain('Done');
    const undoBtn = container.querySelector('button[aria-label="Undo marking PROJ-101 as Done"]') ||
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Undo'));
    expect(undoBtn).toBeTruthy();
  });

  it('calls undoQuickDone when Undo button is clicked', async () => {
    const undoSpy = vi.fn();
    act(() => {
      useBoardStore.setState({
        pendingQuickDone: {
          issueKey: 'PROJ-101',
          originalIssue: mockIssue,
          timeoutId: 123 as unknown as ReturnType<typeof setTimeout>,
          targetCategory: 'done',
          targetStatus: 'Done',
          startTime: Date.now(),
          durationMs: 5000,
        },
        undoQuickDone: undoSpy,
      });
    });

    await act(async () => {
      root.render(<UndoSnackbar />);
    });

    const undoBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Undo')
    );
    expect(undoBtn).toBeTruthy();

    await act(async () => {
      undoBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(undoSpy).toHaveBeenCalledTimes(1);
  });
});
