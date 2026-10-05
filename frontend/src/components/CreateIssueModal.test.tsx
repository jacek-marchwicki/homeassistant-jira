import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CreateIssueModal } from './CreateIssueModal.tsx';
import { useBoardStore } from '../store/boardStore.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CreateIssueModal component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.restoreAllMocks();
    useBoardStore.setState({
      issues: [],
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

  function setInputValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
    const prototype =
      element instanceof HTMLInputElement
        ? window.HTMLInputElement.prototype
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

  it('renders blank form fields when open', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    const summaryInput = container.querySelector('#create-summary') as HTMLInputElement;
    expect(summaryInput).not.toBeNull();
    expect(summaryInput.value).toBe('');

    const prioritySelect = container.querySelector('#create-priority') as HTMLSelectElement;
    expect(prioritySelect.value).toBe('medium');

    const typeSelect = container.querySelector('#create-type') as HTMLSelectElement;
    expect(typeSelect.value).toBe('task');

    const assigneeInput = container.querySelector('#create-assignee') as HTMLInputElement;
    expect(assigneeInput.value).toBe('');

    const recreateAfterInput = container.querySelector('#create-recreate-after') as HTMLInputElement;
    expect(recreateAfterInput).not.toBeNull();
    expect(recreateAfterInput.value).toBe('');
  });

  it('validates that summary is required', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(container.textContent).toContain('Summary is required.');
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('submits new issue and calls createIssueOptimistic', async () => {
    const handleClose = vi.fn();
    const createSpy = vi.spyOn(useBoardStore.getState(), 'createIssueOptimistic');

    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    const summaryInput = container.querySelector('#create-summary') as HTMLInputElement;
    const prioritySelect = container.querySelector('#create-priority') as HTMLSelectElement;
    const typeSelect = container.querySelector('#create-type') as HTMLSelectElement;
    const assigneeInput = container.querySelector('#create-assignee') as HTMLInputElement;
    const recreateAfterInput = container.querySelector('#create-recreate-after') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      setInputValue(summaryInput, 'Brand new task');
      setInputValue(prioritySelect, 'high');
      setInputValue(typeSelect, 'bug');
      setInputValue(assigneeInput, 'Alice Bob');
      setInputValue(recreateAfterInput, '7 days');
    });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Brand new task',
        priority: 'high',
        issue_type: 'bug',
        assignee_name: 'Alice Bob',
        recreate_after: '7 days',
      })
    );
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Cancel button click and Escape key', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
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
