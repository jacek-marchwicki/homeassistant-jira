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

    // Issue key Jira link
    const link = container.querySelector('a[aria-label="Open TEST-1 in Jira"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('href')).toBe('https://jira.example.com/browse/TEST-1');

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

  it('splits Ready column into Overdue, Expedited, and Other sub-sections', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'TEST-OVERDUE',
        summary: 'Fix overdue leak',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        due_date: '2020-01-01', // Overdue
      },
      {
        id: '2',
        key: 'TEST-EXPEDITED',
        summary: 'Immediate urgent fix',
        priority: 'highest',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        start_date: null, // Expedited (highest with empty start date)
      },
      {
        id: '3',
        key: 'TEST-OTHER',
        summary: 'Regular task for next month',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        due_date: '2099-12-31', // Future (Other)
      },
    ];

    await act(async () => {
      root.render(
        <DndContext>
          <KanbanColumn
            id="col-ready"
            category="todo"
            title="Ready"
            colorVar="var(--jira-status-todo)"
            issues={issues}
            isHighlighted={false}
          />
        </DndContext>
      );
    });

    // Check that all 3 sub-sections are rendered
    const overdueSection = container.querySelector('[data-testid="ready-section-overdue"]');
    const expeditedSection = container.querySelector('[data-testid="ready-section-expedited"]');
    const otherSection = container.querySelector('[data-testid="ready-section-other"]');

    expect(overdueSection).not.toBeNull();
    expect(expeditedSection).not.toBeNull();
    expect(otherSection).not.toBeNull();

    // Check headings & counts
    expect(overdueSection?.textContent).toContain('Overdue');
    expect(overdueSection?.textContent).toContain('1');
    expect(overdueSection?.textContent).toContain('TEST-OVERDUE');

    expect(expeditedSection?.textContent).toContain('Expedited');
    expect(expeditedSection?.textContent).toContain('1');
    expect(expeditedSection?.textContent).toContain('TEST-EXPEDITED');

    expect(otherSection?.textContent).toContain('Other');
    expect(otherSection?.textContent).toContain('1');
    expect(otherSection?.textContent).toContain('TEST-OTHER');

    await act(async () => {
      root.unmount();
    });
  });

  it('splits Ready column into Overdue, Expedited, In Progress, and Other sub-sections in correct order', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'TEST-OVERDUE',
        summary: 'Fix overdue leak',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        due_date: '2020-01-01',
      },
      {
        id: '2',
        key: 'TEST-EXPEDITED',
        summary: 'Immediate urgent fix',
        priority: 'highest',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        start_date: null,
      },
      {
        id: '3',
        key: 'TEST-INPROGRESS',
        summary: 'Currently working on this',
        priority: 'medium',
        status: { id: 'col-inprogress', name: 'In Progress', category: 'inprogress' },
      },
      {
        id: '4',
        key: 'TEST-OTHER',
        summary: 'Regular task for next month',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        due_date: '2099-12-31',
      },
    ];

    await act(async () => {
      root.render(
        <DndContext>
          <KanbanColumn
            id="col-ready"
            category="todo"
            title="Ready"
            colorVar="var(--jira-status-todo)"
            issues={issues}
            isHighlighted={false}
          />
        </DndContext>
      );
    });

    const overdueSection = container.querySelector('[data-testid="ready-section-overdue"]');
    const expeditedSection = container.querySelector('[data-testid="ready-section-expedited"]');
    const inProgressSection = container.querySelector('[data-testid="ready-section-inprogress"]');
    const otherSection = container.querySelector('[data-testid="ready-section-other"]');

    expect(overdueSection).not.toBeNull();
    expect(expeditedSection).not.toBeNull();
    expect(inProgressSection).not.toBeNull();
    expect(otherSection).not.toBeNull();

    expect(inProgressSection?.textContent).toContain('In Progress');
    expect(inProgressSection?.textContent).toContain('1');
    expect(inProgressSection?.textContent).toContain('TEST-INPROGRESS');

    await act(async () => {
      root.unmount();
    });
  });

  it('hides Expedited section when empty, keeping Overdue and Other with header', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'TEST-OVERDUE',
        summary: 'Fix overdue leak',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        due_date: '2020-01-01', // Overdue
      },
      {
        id: '2',
        key: 'TEST-OTHER',
        summary: 'Regular task',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
        due_date: '2099-12-31',
      },
    ];

    await act(async () => {
      root.render(
        <DndContext>
          <KanbanColumn
            id="col-ready"
            category="todo"
            title="Ready"
            colorVar="var(--jira-status-todo)"
            issues={issues}
            isHighlighted={false}
          />
        </DndContext>
      );
    });

    const overdueSection = container.querySelector('[data-testid="ready-section-overdue"]');
    const expeditedSection = container.querySelector('[data-testid="ready-section-expedited"]');
    const otherSection = container.querySelector('[data-testid="ready-section-other"]');

    expect(overdueSection).not.toBeNull();
    expect(expeditedSection).toBeNull(); // Hidden when empty!
    expect(otherSection).not.toBeNull(); // Displayed with header because Overdue exists

    await act(async () => {
      root.unmount();
    });
  });

  it('hides Overdue and Expedited sections when empty, and omits Other section header when only Other exists', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const issues: JiraIssue[] = [
      {
        id: '1',
        key: 'TEST-OTHER-1',
        summary: 'Regular task 1',
        priority: 'medium',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
      },
      {
        id: '2',
        key: 'TEST-OTHER-2',
        summary: 'Regular task 2',
        priority: 'low',
        status: { id: 'col-ready', name: 'Ready', category: 'todo' },
      },
    ];

    await act(async () => {
      root.render(
        <DndContext>
          <KanbanColumn
            id="col-ready"
            category="todo"
            title="Ready"
            colorVar="var(--jira-status-todo)"
            issues={issues}
            isHighlighted={false}
          />
        </DndContext>
      );
    });

    const overdueSection = container.querySelector('[data-testid="ready-section-overdue"]');
    const expeditedSection = container.querySelector('[data-testid="ready-section-expedited"]');
    const otherSection = container.querySelector('[data-testid="ready-section-other"]');

    // Neither Overdue nor Expedited should exist
    expect(overdueSection).toBeNull();
    expect(expeditedSection).toBeNull();
    // Other section header must NOT be displayed
    expect(otherSection).toBeNull();

    // The cards themselves should be rendered directly in the column
    expect(container.textContent).toContain('TEST-OTHER-1');
    expect(container.textContent).toContain('TEST-OTHER-2');

    await act(async () => {
      root.unmount();
    });
  });

  it('shows standard "No issues" empty state when Ready column has 0 issues', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <KanbanColumn
            id="col-ready"
            category="todo"
            title="Ready"
            colorVar="var(--jira-status-todo)"
            issues={[]}
            isHighlighted={false}
          />
        </DndContext>
      );
    });

    // Sub-sections are not rendered, standard empty state is shown
    expect(container.querySelector('[data-testid="ready-section-overdue"]')).toBeNull();
    expect(container.querySelector('[data-testid="ready-section-expedited"]')).toBeNull();
    expect(container.querySelector('[data-testid="ready-section-other"]')).toBeNull();
    expect(container.textContent).toContain('No issues');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders In Progress drop target at the top of Ready list when isDragging or showDropTarget is true', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <KanbanColumn
            id="col-ready"
            category="todo"
            title="Ready"
            colorVar="var(--jira-status-todo)"
            issues={[mockIssue]}
            isHighlighted={false}
            showDropTarget={true}
          />
        </DndContext>
      );
    });

    const dropTarget = container.querySelector('[data-testid="ready-drop-target-inprogress"]');
    expect(dropTarget).not.toBeNull();
    expect(dropTarget?.className).not.toContain('hidden');
    expect(dropTarget?.textContent).toContain('In Progress');
    expect(dropTarget?.textContent).toContain('Drop target');

    await act(async () => {
      root.unmount();
    });
  });

  it('hides In Progress drop target on Ready column when neither isDragging nor showDropTarget is set', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <KanbanColumn
            id="col-ready"
            category="todo"
            title="Ready"
            colorVar="var(--jira-status-todo)"
            issues={[mockIssue]}
            isHighlighted={false}
          />
        </DndContext>
      );
    });

    const dropTarget = container.querySelector('[data-testid="ready-drop-target-inprogress"]');
    expect(dropTarget).not.toBeNull();
    expect(dropTarget?.className).toContain('hidden');

    await act(async () => {
      root.unmount();
    });
  });

  it('never renders In Progress drop target on non-Ready columns even if isDragging is true', async () => {
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
            isHighlighted={false}
            isDragging={true}
          />
        </DndContext>
      );
    });

    const dropTarget = container.querySelector('[data-testid="ready-drop-target-inprogress"]');
    expect(dropTarget).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
