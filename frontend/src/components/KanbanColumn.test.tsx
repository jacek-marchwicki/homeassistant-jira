import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext } from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn.tsx';
import { JiraIssue } from '../types/jira.ts';

// Configure React act environment for Happy-DOM
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockIssue: JiraIssue = {
  id: '1',
  key: 'TEST-1',
  summary: 'Write tests',
  priority: 'high',
  status: { id: '1', name: 'In Progress', category: 'inprogress' },
};

describe('KanbanColumn component', () => {
  it('renders column title, issue count, and default non-highlighted styling', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <KanbanColumn
            id="col-inprogress"
            category="inprogress"
            title="In Progress"
            colorVar="var(--jira-status-inprogress)"
            issues={[mockIssue]}
            isHighlighted={false}
          />
        </DndContext>
      );
    });

    const columnElem = container.querySelector('[data-testid="column-col-inprogress"]');
    expect(columnElem).not.toBeNull();
    expect(columnElem?.getAttribute('data-is-over')).toBe('false');
    expect(columnElem?.className).toContain('border-[var(--jira-border)]');
    expect(columnElem?.className).not.toContain('ring-2');

    // Title & count
    expect(container.textContent).toContain('In Progress');
    expect(container.textContent).toContain('1');

    // Should NOT show drop target badge
    const dropBadge = container.querySelector('[data-testid="drop-badge-col-inprogress"]');
    expect(dropBadge).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('renders highlighted drop target styling and badge when isHighlighted is true', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <KanbanColumn
            id="col-done"
            category="done"
            title="Done"
            colorVar="var(--jira-status-done)"
            issues={[]}
            isHighlighted={true}
          />
        </DndContext>
      );
    });

    const columnElem = container.querySelector('[data-testid="column-col-done"]');
    expect(columnElem).not.toBeNull();
    expect(columnElem?.getAttribute('data-is-over')).toBe('true');
    expect(columnElem?.className).toContain('border-[var(--jira-primary)]');
    expect(columnElem?.className).toContain('ring-2');
    expect(columnElem?.className).toContain('ring-[var(--jira-primary)]');

    // Drop target badge must be visible in header
    const dropBadge = container.querySelector('[data-testid="drop-badge-col-done"]');
    expect(dropBadge).not.toBeNull();
    expect(dropBadge?.textContent).toBe('Drop target');

    // Empty state message should indicate dropping is active
    expect(container.textContent).toContain('Release to drop issue here');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows standard "No issues" text when column is empty and not highlighted', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <KanbanColumn
            id="col-todo"
            category="todo"
            title="To Do"
            colorVar="var(--jira-status-todo)"
            issues={[]}
            isHighlighted={false}
          />
        </DndContext>
      );
    });

    expect(container.textContent).toContain('No issues');
    expect(container.textContent).not.toContain('Release to drop issue here');

    await act(async () => {
      root.unmount();
    });
  });
});
