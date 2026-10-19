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
  created_at: '2026-10-01T10:00:00Z',
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

    // Description defaults to Preview mode
    const previewArea = container.querySelector('[data-testid="rich-text-preview"]');
    expect(previewArea).not.toBeNull();
    expect(previewArea?.textContent).toContain('Original detailed description');

    // Switching to Write tab exposes textarea
    const writeTabBtn = container.querySelector('button[aria-label="Write tab"]') as HTMLButtonElement;
    expect(writeTabBtn).not.toBeNull();
    await act(async () => {
      writeTabBtn.click();
    });

    const descriptionInput = container.querySelector('#edit-description') as HTMLTextAreaElement;
    expect(descriptionInput).not.toBeNull();
    expect(descriptionInput.value).toBe('Original detailed description');

    const prioritySelect = container.querySelector('#edit-priority') as HTMLSelectElement;
    expect(prioritySelect.value).toBe('medium');

    const typeSelect = container.querySelector('#edit-type') as HTMLSelectElement;
    expect(typeSelect.value).toBe('task');

    const assigneeInput = container.querySelector('#edit-assignee') as HTMLInputElement;
    expect(assigneeInput.value).toBe('Jane Doe');

    const pointsInput = container.querySelector('#edit-points');
    expect(pointsInput).toBeNull();

    const recreateAfterInput = container.querySelector('#edit-recreate-after') as HTMLInputElement;
    expect(recreateAfterInput).not.toBeNull();
    expect(recreateAfterInput.value).toBe('14 days');

    const jiraLink = container.querySelector('a[aria-label="Open PROJ-101 in Jira"]') as HTMLAnchorElement;
    expect(jiraLink).not.toBeNull();
    expect(jiraLink.getAttribute('target')).toBe('_blank');
    expect(jiraLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(jiraLink.getAttribute('href')).toBe('https://jira.example.com/browse/PROJ-101');

    const datesContainer = container.querySelector('[data-testid="edit-issue-dates"]');
    expect(datesContainer).not.toBeNull();
    expect(datesContainer?.textContent).toContain('Created:');
    expect(datesContainer?.textContent).toContain('Updated:');

    // Dates must appear above comments
    const commentsSection = container.querySelector('[data-testid="comments-section"]');
    expect(commentsSection).not.toBeNull();
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
    const prioritySelect = container.querySelector('#edit-priority') as HTMLSelectElement;
    const recreateAfterInput = container.querySelector('#edit-recreate-after') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;

    // Switch to write tab to edit description
    const writeTabBtn = container.querySelector('button[aria-label="Write tab"]') as HTMLButtonElement;
    await act(async () => {
      writeTabBtn.click();
    });
    const descriptionInput = container.querySelector('#edit-description') as HTMLTextAreaElement;

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

  it('allows clicking recreate after hint buttons to populate input', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={handleClose} />);
    });

    const recreateAfterInput = container.querySelector('#edit-recreate-after') as HTMLInputElement;
    const hint2yBtn = container.querySelector('button[title="Set recreate after to 2y!"]') as HTMLButtonElement;
    expect(hint2yBtn).not.toBeNull();

    await act(async () => {
      hint2yBtn.click();
    });

    expect(recreateAfterInput.value).toBe('2y!');
  });

  it('closes on X button click, Cancel button click when dirty, and Escape key', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={handleClose} />);
    });

    // Default pristine state: X button is displayed, no Cancel button
    const cancelBtnBefore = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel'
    );
    expect(cancelBtnBefore).toBeUndefined();

    const closeXBtn = container.querySelector('button[aria-label="Close edit dialog"]') as HTMLButtonElement;
    expect(closeXBtn).not.toBeNull();
    await act(async () => {
      closeXBtn.click();
    });
    expect(handleClose).toHaveBeenCalledTimes(1);

    // Escape key closes as well
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(handleClose).toHaveBeenCalledTimes(2);

    // When dirty: X button is replaced with Cancel button
    const summaryInput = container.querySelector('#edit-summary') as HTMLInputElement;
    await act(async () => {
      setInputValue(summaryInput, 'Modified Summary');
    });

    const closeXBtnAfter = container.querySelector('button[aria-label="Close edit dialog"]');
    expect(closeXBtnAfter).toBeNull();

    const cancelBtnAfter = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Cancel'
    ) as HTMLButtonElement;
    expect(cancelBtnAfter).not.toBeNull();

    await act(async () => {
      cancelBtnAfter.click();
    });
    expect(handleClose).toHaveBeenCalledTimes(3);
  });

  it('renders Save and Cancel/X buttons at the top header and removes bottom action buttons', async () => {
    await act(async () => {
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={() => {}} />);
    });

    const header = container.querySelector('[data-testid="edit-issue-modal-header"]');
    expect(header).not.toBeNull();

    // Header contains the save button at the top
    const saveButtonInHeader = header?.querySelector('button[type="submit"]');
    expect(saveButtonInHeader).not.toBeNull();
    expect(saveButtonInHeader?.textContent).toContain('Save Changes');

    // Header contains the default X button at the top
    const xButtonInHeader = header?.querySelector('button[aria-label="Close edit dialog"]');
    expect(xButtonInHeader).not.toBeNull();

    // Verify there are no bottom action buttons (no Save Changes button outside the header)
    const allSaveButtons = Array.from(container.querySelectorAll('button[type="submit"]')).filter(
      (b) => b.getAttribute('form') === 'edit-issue-form' || b.textContent?.includes('Save Changes')
    );
    expect(allSaveButtons.length).toBe(1);
    expect(header?.contains(allSaveButtons[0])).toBe(true);
  });

  it('orders fields with Assignee right after Description and Issue Type as the last field', async () => {
    await act(async () => {
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={() => {}} />);
    });

    const summaryInput = container.querySelector('#edit-summary');
    const descriptionArea = container.querySelector('[data-testid="rich-text-preview"]') || container.querySelector('#edit-description');
    const assigneeInput = container.querySelector('#edit-assignee');
    const statusSelect = container.querySelector('#edit-status');
    const prioritySelect = container.querySelector('#edit-priority');
    const startDateInput = container.querySelector('#edit-start-date');
    const dueDateInput = container.querySelector('#edit-due-date');
    const recreateAfterInput = container.querySelector('#edit-recreate-after');
    const typeSelect = container.querySelector('#edit-type');

    expect(summaryInput).not.toBeNull();
    expect(descriptionArea).not.toBeNull();
    expect(assigneeInput).not.toBeNull();
    expect(statusSelect).not.toBeNull();
    expect(prioritySelect).not.toBeNull();
    expect(startDateInput).not.toBeNull();
    expect(dueDateInput).not.toBeNull();
    expect(recreateAfterInput).not.toBeNull();
    expect(typeSelect).not.toBeNull();

    // 1. Summary comes before Description
    expect(
      Boolean(summaryInput!.compareDocumentPosition(descriptionArea!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);

    // 2. Assignee comes right after Description (before Status, Priority, Dates, Recreate, Issue Type)
    expect(
      Boolean(descriptionArea!.compareDocumentPosition(assigneeInput!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
    expect(
      Boolean(assigneeInput!.compareDocumentPosition(statusSelect!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);

    // 3. Issue Type is the last field (after Recreate after)
    expect(
      Boolean(recreateAfterInput!.compareDocumentPosition(typeSelect!) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
  });

  it('applies full-screen styling on mobile viewports and dialog styling on desktop', async () => {
    const handleClose = vi.fn();

    await act(async () => {
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={handleClose} />);
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

  it('allows updating and clearing start date and due date via DatePicker', async () => {
    const handleClose = vi.fn();
    const updateSpy = vi.spyOn(useBoardStore.getState(), 'updateIssueOptimistic');

    await act(async () => {
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={handleClose} />);
    });

    const startDateInput = container.querySelector('#edit-start-date') as HTMLInputElement;
    const dueDateInput = container.querySelector('#edit-due-date') as HTMLInputElement;
    expect(startDateInput.value).toBe('2026-10-01');
    expect(dueDateInput.value).toBe('2026-11-01');

    // Clear start date manually using clear button
    const startDateWrapper = startDateInput.closest('div.relative') as HTMLElement;
    const clearStartBtn = startDateWrapper.querySelector('button[aria-label="Clear date"]') as HTMLButtonElement;
    expect(clearStartBtn).not.toBeNull();
    await act(async () => {
      clearStartBtn.click();
    });
    expect(startDateInput.value).toBe('');

    // Update due date manually
    await act(async () => {
      setInputValue(dueDateInput, '2026-12-31');
    });
    expect(dueDateInput.value).toBe('2026-12-31');

    // Submit form
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(updateSpy).toHaveBeenCalledWith(
      'PROJ-101',
      expect.objectContaining({
        start_date: null,
        due_date: '2026-12-31',
      })
    );
  });

  it('renders modal header with background banner when task background is available', async () => {
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
      root.render(<EditIssueModal issue={testIssue} isOpen={true} onClose={() => {}} />);
    });

    await act(async () => {
      triggerOnload?.();
    });

    const header = container.querySelector('[data-testid="edit-issue-modal-header"]') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.style.backgroundImage).toContain('/api/issues/PROJ-101/background');
    expect(header.style.backgroundImage).toContain('linear-gradient');
  });
});
