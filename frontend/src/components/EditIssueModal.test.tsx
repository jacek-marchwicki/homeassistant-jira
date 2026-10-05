import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EditIssueModal } from './EditIssueModal.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testIssue: JiraIssue = {
  id: '101',
  key: 'PROJ-101',
  summary: 'Original Summary',
  description: 'Original detailed description',
  issue_type: 'task',
  priority: 'medium',
  status: { id: 'col-todo', name: 'To Do', category: 'todo' },
  assignee: { accountId: 'usr-1', displayName: 'Jane Doe' },
  story_points: 3,
  due_date: '2026-11-01',
  start_date: '2026-10-01',
  recreate_after: '14 days',
  updated_at: '2026-10-05T00:00:00Z',
};

describe('EditIssueModal component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.restoreAllMocks();
    useBoardStore.setState({
      issues: [testIssue],
      columns: [
        { id: 'col-todo', name: 'To Do', category: 'todo', status_ids: ['1'] },
        { id: 'col-inprogress', name: 'In Progress', category: 'inprogress', status_ids: ['2'] },
      ],
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
  });

  it('renders prefilled form fields when open', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={handleClose} />);
    });

    const summaryInput = container.querySelector('#edit-summary') as HTMLInputElement;
    expect(summaryInput).not.toBeNull();
    expect(summaryInput.value).toBe('Original Summary');

    const descriptionInput = container.querySelector('#edit-description') as HTMLTextAreaElement;
    expect(descriptionInput).not.toBeNull();
    expect(descriptionInput.value).toBe('Original detailed description');

    const prioritySelect = container.querySelector('#edit-priority') as HTMLSelectElement;
    expect(prioritySelect.value).toBe('medium');

    const typeSelect = container.querySelector('#edit-type') as HTMLSelectElement;
    expect(typeSelect.value).toBe('task');

    const assigneeInput = container.querySelector('#edit-assignee') as HTMLInputElement;
    expect(assigneeInput.value).toBe('Jane Doe');

    const pointsInput = container.querySelector('#edit-points') as HTMLInputElement;
    expect(pointsInput.value).toBe('3');

    const recreateAfterInput = container.querySelector('#edit-recreate-after') as HTMLInputElement;
    expect(recreateAfterInput).not.toBeNull();
    expect(recreateAfterInput.value).toBe('14 days');
  });

function setInputValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLInputElement
      ? window.HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

  it('validates that summary is required', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={handleClose} />);
    });

    const summaryInput = container.querySelector('#edit-summary') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      setInputValue(summaryInput, '');
    });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain('Summary is required.');
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('submits updated values and calls updateIssueOptimistic', async () => {
    const handleClose = vi.fn();
    const updateSpy = vi.spyOn(useBoardStore.getState(), 'updateIssueOptimistic');

    await act(async () => {
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={handleClose} />);
    });

    const summaryInput = container.querySelector('#edit-summary') as HTMLInputElement;
    const descriptionInput = container.querySelector('#edit-description') as HTMLTextAreaElement;
    const prioritySelect = container.querySelector('#edit-priority') as HTMLSelectElement;
    const recreateAfterInput = container.querySelector('#edit-recreate-after') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      setInputValue(summaryInput, 'Updated Summary via Modal');
      setInputValue(descriptionInput, 'Updated description text');
      setInputValue(prioritySelect, 'highest');
      setInputValue(recreateAfterInput, '30 days');
    });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(updateSpy).toHaveBeenCalledWith(
      'PROJ-101',
      expect.objectContaining({
        summary: 'Updated Summary via Modal',
        description: 'Updated description text',
        priority: 'highest',
        recreate_after: '30 days',
      })
    );
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Cancel button click and Escape key', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={handleClose} />);
    });

    const cancelBtn = container.querySelector('button[type="button"]') as HTMLButtonElement;
    await act(async () => {
      cancelBtn.click();
    });
    expect(handleClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});
