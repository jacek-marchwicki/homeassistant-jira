import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { IssueCard } from './IssueCard.tsx';
import { clearBackgroundCache } from '../utils/useTaskBackground.ts';
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

const choreIssue: JiraIssue = {
  id: '103',
  key: 'CHORE-101',
  summary: 'Clean bedroom and fold clothes',
  priority: 'high',
  status: { id: 'col-todo', name: 'To Do', category: 'todo' },
};

describe('IssueCard component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let originalImage: typeof Image;

  beforeEach(() => {
    clearBackgroundCache();
    originalImage = window.Image;
    act(() => {
      useBoardStore.setState({
        issues: [mockIssueTodo, mockIssueDone, choreIssue],
        columns: [
          { id: 'col-todo', name: 'To Do', category: 'todo', status_ids: ['col-todo'] },
          { id: 'col-inprogress', name: 'In Progress', category: 'inprogress', status_ids: ['col-inprogress'] },
          { id: 'col-done', name: 'Done', category: 'done', status_ids: ['col-done'] },
        ],
        jiraUrl: 'https://jira.example.com',
      });
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    window.Image = originalImage;
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
  });

  it('renders key, summary, priority, edit button, and quick Done button for todo issue', async () => {
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
  });

  it('does NOT render status picker dropdown in IssueCard', async () => {
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
  });

  it('does not render quick Done button for Done issue, and does not render status picker', async () => {
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
  });

  it('calls transitionIssueOptimistic when quick Done button is clicked', async () => {
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
  });

  it('calls setEditingIssue when Edit button or summary is clicked', async () => {
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
  });

  it('renders default surface background styling when no background image is available', async () => {
    let triggerOnerror: (() => void) | null = null;
    const MockImg = class {
      set onload(_cb: () => void) {}
      set onerror(cb: () => void) {
        triggerOnerror = cb;
      }
      set src(_val: string) {}
    } as unknown as typeof Image;
    window.Image = MockImg;
    globalThis.Image = MockImg;

    await act(async () => {
      root.render(
        <DndContext>
          <IssueCard issue={choreIssue} />
        </DndContext>
      );
    });

    await act(async () => {
      triggerOnerror?.();
    });

    const card = container.querySelector('[data-testid="issue-card-CHORE-101"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.style.backgroundImage).toBe('');
    expect(card.className).toContain('bg-[var(--jira-surface-elevated)]');
  });

  it('applies gradient overlay and background image when image loads successfully', async () => {
    let triggerOnload: (() => void) | null = null;
    const MockImg = class {
      set onload(cb: () => void) {
        triggerOnload = cb;
      }
      set onerror(_cb: () => void) {}
      set src(_val: string) {}
    } as unknown as typeof Image;
    window.Image = MockImg;
    globalThis.Image = MockImg;

    await act(async () => {
      root.render(
        <DndContext>
          <IssueCard issue={choreIssue} />
        </DndContext>
      );
    });

    await act(async () => {
      triggerOnload?.();
    });

    const card = container.querySelector('[data-testid="issue-card-CHORE-101"]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.style.backgroundImage).toContain('/api/issues/CHORE-101/background');
    expect(card.style.backgroundImage).toContain('linear-gradient');
    expect(card.style.backgroundSize).toBe('cover');
  });
});
