import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { IssueCard } from './IssueCard.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockIssueTodo: JiraIssue = {
  id: '101',
  key: 'PROJ-101',
  summary: 'Implement dynamic proxy root path support',
  priority: 'high',
  status: { id: 'col-todo', name: 'To Do', category: 'todo' },
  assignee: { displayName: 'Jacek Marchwicki' },
  due_date: '2026-10-15',
};

const mockIssueDone: JiraIssue = {
  id: '102',
  key: 'PROJ-102',
  summary: 'Zero perceptual latency optimistic state store',
  priority: 'highest',
  status: { id: 'col-done', name: 'Done', category: 'done' },
  assignee: { displayName: 'Jacek Marchwicki' },
};

describe('IssueCard component', () => {
  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        issues: [mockIssueTodo, mockIssueDone],
        columns: [
          { id: 'col-todo', name: 'To Do', category: 'todo' },
          { id: 'col-inprogress', name: 'In Progress', category: 'inprogress' },
          { id: 'col-done', name: 'Done', category: 'done' },
        ],
        jiraUrl: 'https://jira.example.com',
      });
    });
  });

  it('renders key, summary, priority, edit button, and quick Done button for todo issue', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <SortableContext items={[mockIssueTodo.key]}>
            <IssueCard issue={mockIssueTodo} />
          </SortableContext>
        </DndContext>
      );
    });

    expect(container.textContent).toContain('PROJ-101');
    expect(container.textContent).toContain('Implement dynamic proxy root path support');
    expect(container.textContent).toContain('Done');

    // Issue key Jira link
    const link = container.querySelector('a[aria-label="Open PROJ-101 in Jira"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('href')).toBe('https://jira.example.com/browse/PROJ-101');

    // Edit button
    const editBtn = container.querySelector('button[aria-label="Edit PROJ-101"]');
    expect(editBtn).not.toBeNull();

    // Quick Done button
    const doneBtn = container.querySelector('button[aria-label="Mark PROJ-101 as Done"]');
    expect(doneBtn).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('does NOT render status picker dropdown in IssueCard', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <SortableContext items={[mockIssueTodo.key]}>
            <IssueCard issue={mockIssueTodo} />
          </SortableContext>
        </DndContext>
      );
    });

    // Verify status picker select or combobox is NOT rendered
    const statusSelect = container.querySelector('select[id^="status-select"]');
    expect(statusSelect).toBeNull();

    const statusCombobox = container.querySelector('[role="combobox"][aria-label^="Change status"]');
    expect(statusCombobox).toBeNull();

    const changeStatusElem = container.querySelector('[title="Change Status"]');
    expect(changeStatusElem).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('does not render quick Done button for Done issue, and does not render status picker', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DndContext>
          <SortableContext items={[mockIssueDone.key]}>
            <IssueCard issue={mockIssueDone} />
          </SortableContext>
        </DndContext>
      );
    });

    // Mark as Done button should not exist on already Done issues
    const doneBtn = container.querySelector('button[aria-label="Mark PROJ-102 as Done"]');
    expect(doneBtn).toBeNull();

    // Status picker must not exist
    const statusSelect = container.querySelector('select[id^="status-select"]');
    expect(statusSelect).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('calls transitionIssueOptimistic when quick Done button is clicked', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const transitionSpy = vi.fn();
    act(() => {
      useBoardStore.setState({
        transitionIssueOptimistic: transitionSpy,
      });
    });

    await act(async () => {
      root.render(
        <DndContext>
          <SortableContext items={[mockIssueTodo.key]}>
            <IssueCard issue={mockIssueTodo} />
          </SortableContext>
        </DndContext>
      );
    });

    const doneBtn = container.querySelector('button[aria-label="Mark PROJ-101 as Done"]');
    expect(doneBtn).not.toBeNull();

    await act(async () => {
      doneBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(transitionSpy).toHaveBeenCalledWith('PROJ-101', 'done', 'Done');

    await act(async () => {
      root.unmount();
    });
  });

  it('calls setEditingIssue when Edit button or summary is clicked', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    const setEditingIssueSpy = vi.fn();
    act(() => {
      useBoardStore.setState({
        setEditingIssue: setEditingIssueSpy,
      });
    });

    await act(async () => {
      root.render(
        <DndContext>
          <SortableContext items={[mockIssueTodo.key]}>
            <IssueCard issue={mockIssueTodo} />
          </SortableContext>
        </DndContext>
      );
    });

    const editBtn = container.querySelector('button[aria-label="Edit PROJ-101"]');
    expect(editBtn).not.toBeNull();

    await act(async () => {
      editBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(setEditingIssueSpy).toHaveBeenCalledWith(mockIssueTodo);

    await act(async () => {
      root.unmount();
    });
  });
});
