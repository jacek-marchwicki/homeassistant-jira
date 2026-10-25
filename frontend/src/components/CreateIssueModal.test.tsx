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

    const pointsInput = container.querySelector('#create-points');
    expect(pointsInput).toBeNull();

    const recreateAfterInput = container.querySelector('#create-recreate-after') as HTMLInputElement;
    expect(recreateAfterInput).not.toBeNull();
    expect(recreateAfterInput.value).toBe('');

    const descriptionInput = container.querySelector('#create-description') as HTMLTextAreaElement;
    expect(descriptionInput).not.toBeNull();
    expect(descriptionInput.value).toBe('');
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
    const descriptionInput = container.querySelector('#create-description') as HTMLTextAreaElement;
    const prioritySelect = container.querySelector('#create-priority') as HTMLSelectElement;
    const typeSelect = container.querySelector('#create-type') as HTMLSelectElement;
    const assigneeInput = container.querySelector('#create-assignee') as HTMLInputElement;
    const recreateAfterInput = container.querySelector('#create-recreate-after') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      setInputValue(summaryInput, 'Brand new task');
      setInputValue(descriptionInput, 'Detailed steps to reproduce');
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
        description: 'Detailed steps to reproduce',
        priority: 'high',
        issue_type: 'bug',
        assignee_name: 'Alice Bob',
        recreate_after: '7 days',
      })
    );
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Close (back arrow) button click, Cancel (X) button click when dirty, and Escape key', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    // Default pristine state: Close button (back arrow) on the far left, no Cancel button
    const cancelBtnBefore = container.querySelector('button[aria-label="Cancel changes"]');
    expect(cancelBtnBefore).toBeNull();

    const closeBtn = container.querySelector('button[aria-label="Close create dialog"]') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    // Verify it uses ArrowLeft icon
    expect(closeBtn.querySelector('svg.lucide-arrow-left')).not.toBeNull();

    await act(async () => {
      closeBtn.click();
    });
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Escape key closes as well
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(handleClose).toHaveBeenCalledTimes(2);

    // When dirty: Close button is replaced with Cancel (X icon) button on the far left
    const summaryInput = container.querySelector('#create-summary') as HTMLInputElement;
    await act(async () => {
      setInputValue(summaryInput, 'Brand new task');
    });

    const closeBtnAfter = container.querySelector('button[aria-label="Close create dialog"]');
    expect(closeBtnAfter).toBeNull();

    const cancelBtnAfter = container.querySelector('button[aria-label="Cancel changes"]') as HTMLButtonElement;
    expect(cancelBtnAfter).not.toBeNull();
    // Verify it uses X icon
    expect(cancelBtnAfter.querySelector('svg.lucide-x')).not.toBeNull();

    // Verify UI did not shift: same button container dimensions and classes
    expect(cancelBtnAfter.className).toBe(closeBtn.className);

    await act(async () => {
      cancelBtnAfter.click();
    });
    expect(handleClose).toHaveBeenCalledTimes(3);
  });

  it('renders Close/Cancel on the far left and Create on the far right in header', async () => {
    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={() => {}} />);
    });

    const header = container.querySelector('[data-testid="create-issue-modal-header"]');
    expect(header).not.toBeNull();

    const closeButtonInHeader = header?.querySelector('button[aria-label="Close create dialog"]');
    const title = header?.querySelector('#create-issue-title');
    const createButtonInHeader = header?.querySelector('button[type="submit"]');

    expect(closeButtonInHeader).not.toBeNull();
    expect(title).not.toBeNull();
    expect(createButtonInHeader).not.toBeNull();
    expect(createButtonInHeader?.textContent).toContain('Create');

    // Close button is on the far left (before title)
    expect(
      Boolean(closeButtonInHeader!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);

    // Create button is on the far right (after title)
    expect(
      Boolean(title!.compareDocumentPosition(createButtonInHeader!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);

    // Verify there are no bottom action buttons (no Create button outside the header)
    const allCreateButtons = container.querySelectorAll('button[type="submit"]');
    expect(allCreateButtons.length).toBe(1);
    expect(header?.contains(allCreateButtons[0])).toBe(true);
  });

  it('orders fields with Assignee right after Description and Issue Type as the last field', async () => {
    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={() => {}} />);
    });

    const summaryInput = container.querySelector('#create-summary');
    const descriptionInput = container.querySelector('#create-description');
    const assigneeInput = container.querySelector('#create-assignee');
    const statusSelect = container.querySelector('#create-status');
    const prioritySelect = container.querySelector('#create-priority');
    const startDateInput = container.querySelector('#create-start-date');
    const dueDateInput = container.querySelector('#create-due-date');
    const recreateAfterInput = container.querySelector('#create-recreate-after');
    const typeSelect = container.querySelector('#create-type');

    expect(summaryInput).not.toBeNull();
    expect(descriptionInput).not.toBeNull();
    expect(assigneeInput).not.toBeNull();
    expect(statusSelect).not.toBeNull();
    expect(prioritySelect).not.toBeNull();
    expect(startDateInput).not.toBeNull();
    expect(dueDateInput).not.toBeNull();
    expect(recreateAfterInput).not.toBeNull();
    expect(typeSelect).not.toBeNull();

    // 1. Summary comes before Description
    expect(
      Boolean(summaryInput!.compareDocumentPosition(descriptionInput!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);

    // 2. Assignee comes right after Description (before Status, Priority, Dates, Recreate, Issue Type)
    expect(
      Boolean(descriptionInput!.compareDocumentPosition(assigneeInput!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
    expect(
      Boolean(assigneeInput!.compareDocumentPosition(statusSelect!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);

    // 3. Issue Type is the last field (after Recreate after)
    expect(
      Boolean(recreateAfterInput!.compareDocumentPosition(typeSelect!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
  });

  it('allows clicking recreate after hint buttons to populate input', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    const recreateAfterInput = container.querySelector('#create-recreate-after') as HTMLInputElement;
    const hint1wBtn = container.querySelector('button[title="Set recreate after to 1w"]') as HTMLButtonElement;
    expect(hint1wBtn).not.toBeNull();

    await act(async () => {
      hint1wBtn.click();
    });

    expect(recreateAfterInput.value).toBe('1w');
  });

  it('submits issue with epic issue type', async () => {
    const handleClose = vi.fn();
    const createSpy = vi.spyOn(useBoardStore.getState(), 'createIssueOptimistic');

    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    const summaryInput = container.querySelector('#create-summary') as HTMLInputElement;
    const typeSelect = container.querySelector('#create-type') as HTMLSelectElement;
    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      setInputValue(summaryInput, 'Brand new epic');
      setInputValue(typeSelect, 'epic');
    });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Brand new epic',
        issue_type: 'epic',
      })
    );
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('applies full-screen styling on mobile viewports and dialog styling on desktop', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    const modalDialog = container.querySelector('div[role="dialog"]') as HTMLDivElement;
    expect(modalDialog).not.toBeNull();
    expect(modalDialog.className).toContain('fixed inset-0');
    expect(modalDialog.className).toContain('sm:items-center');
    expect(modalDialog.className).toContain('sm:justify-center');
    expect(modalDialog.className).toContain('sm:p-4');

    const dialogBox = modalDialog.querySelector(':scope > div') as HTMLDivElement;
    expect(dialogBox).not.toBeNull();
    expect(dialogBox.className).toContain('w-full');
    expect(dialogBox.className).toContain('h-full');
    expect(dialogBox.className).toContain('sm:h-auto');
    expect(dialogBox.className).toContain('sm:max-h-[90vh]');
    expect(dialogBox.className).toContain('sm:max-w-lg');
    expect(dialogBox.className).toContain('rounded-none');
    expect(dialogBox.className).toContain('sm:rounded-xl');
    expect(dialogBox.className).toContain('border-0');
    expect(dialogBox.className).toContain('sm:border');
    expect(dialogBox.className).toContain('shadow-none');
    expect(dialogBox.className).toContain('sm:shadow-2xl');
    expect(dialogBox.className).toContain('p-4');
    expect(dialogBox.className).toContain('sm:p-6');
  });

  it('displays Start Date before Due Date matching EditIssueModal order', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    const startDateInput = container.querySelector('#create-start-date');
    const dueDateInput = container.querySelector('#create-due-date');
    expect(startDateInput).not.toBeNull();
    expect(dueDateInput).not.toBeNull();

    // Verify Start Date appears before Due Date in document order
    expect(
      Boolean(startDateInput!.compareDocumentPosition(dueDateInput!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
  });

  it('prefills all form fields when opened with clone data', async () => {
    useBoardStore.setState({
      createInitialValues: {
        summary: 'Cloned Feature Task',
        description: 'Cloned description with details',
        issue_type: 'story',
        priority: 'high',
        status_name: 'In Progress',
        assignee_name: 'Jane Doe',
        assignee_account_id: 'usr-1',
        due_date: '2026-12-31',
        start_date: '2026-11-01',
        recreate_after: '30d',
      },
    });

    const handleClose = vi.fn();
    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    const summaryInput = container.querySelector('#create-summary') as HTMLInputElement;
    const descTextarea = container.querySelector('#create-description') as HTMLTextAreaElement;
    const dueDateInput = container.querySelector('#create-due-date') as HTMLInputElement;
    const startDateInput = container.querySelector('#create-start-date') as HTMLInputElement;
    const recreateInput = container.querySelector('#create-recreate-after') as HTMLInputElement;

    expect(summaryInput.value).toBe('Cloned Feature Task');
    expect(descTextarea.value).toBe('Cloned description with details');
    expect(dueDateInput.value).toBe('2026-12-31');
    expect(startDateInput.value).toBe('2026-11-01');
    expect(recreateInput.value).toBe('30d');
  });

  it('creates no task when prefilled task creation is discarded/cancelled', async () => {
    const createOptimisticSpy = vi.fn();
    useBoardStore.setState({
      createIssueOptimistic: createOptimisticSpy,
      createInitialValues: {
        summary: 'To Be Discarded',
        description: 'Should not be created',
      },
    });

    const handleClose = vi.fn();
    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    // Click close/cancel button in header
    const closeBtn = container.querySelector('button[aria-label="Cancel changes"], button[aria-label="Close create dialog"]') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();

    await act(async () => {
      closeBtn.click();
    });

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(createOptimisticSpy).not.toHaveBeenCalled();
  });

  it('creates task with prefilled cloned fields when submitted', async () => {
    const createOptimisticSpy = vi.fn();
    useBoardStore.setState({
      createIssueOptimistic: createOptimisticSpy,
      createInitialValues: {
        summary: 'Cloned Task To Save',
        description: 'Detailed description',
        issue_type: 'bug',
        priority: 'highest',
        status_name: 'In Progress',
        assignee_name: 'Jane Doe',
        assignee_account_id: 'usr-1',
        due_date: '2026-11-20',
        start_date: '2026-11-10',
        recreate_after: '7d',
      },
    });

    const handleClose = vi.fn();
    await act(async () => {
      root.render(<CreateIssueModal isOpen={true} onClose={handleClose} />);
    });

    const form = container.querySelector('#create-issue-form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    expect(createOptimisticSpy).toHaveBeenCalledTimes(1);
    expect(createOptimisticSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Cloned Task To Save',
        description: 'Detailed description',
        issue_type: 'bug',
        priority: 'highest',
        status_name: 'In Progress',
        assignee_name: 'Jane Doe',
        assignee_account_id: 'usr-1',
        due_date: '2026-11-20',
        start_date: '2026-11-10',
        recreate_after: '7d',
      })
    );
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
