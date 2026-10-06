import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CommentsSection } from './CommentsSection.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraComment } from '../types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockComments: JiraComment[] = [
  {
    id: 'c-1',
    author: { accountId: 'usr-1', displayName: 'Jacek Marchwicki' },
    body: 'Initial test comment',
    created: '2026-10-04T12:00:00Z',
    updated: null,
  },
  {
    id: 'c-2',
    author: { accountId: 'usr-2', displayName: 'Bob Architect' },
    body: 'Second feedback note',
    created: '2026-10-04T14:00:00Z',
    updated: null,
  },
];

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('CommentsSection component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.restoreAllMocks();
    useBoardStore.setState({
      currentUser: 'Test User',
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

  it('fetches and renders comments list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockComments,
    } as Response);

    await act(async () => {
      root.render(<CommentsSection issueKey="PROJ-101" />);
    });

    expect(container.textContent).toContain('Comments (2)');
    expect(container.textContent).toContain('Initial test comment');
    expect(container.textContent).toContain('Second feedback note');
    expect(container.textContent).toContain('Jacek Marchwicki');
    expect(container.textContent).toContain('Bob Architect');
  });

  it('renders empty state when issue has no comments', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    await act(async () => {
      root.render(<CommentsSection issueKey="PROJ-102" />);
    });

    expect(container.textContent).toContain('Comments (0)');
    expect(container.textContent).toContain('No comments yet. Be the first to add one!');
  });

  it('adds a new comment', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockComments,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'c-3',
          author: { accountId: 'usr-1', displayName: 'Test User' },
          body: 'Newly posted comment',
          created: '2026-10-05T00:00:00Z',
          updated: null,
        }),
      } as Response);

    await act(async () => {
      root.render(<CommentsSection issueKey="PROJ-101" />);
    });

    const textarea = container.querySelector('textarea[aria-label="Add a comment"]') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    await act(async () => {
      setInputValue(textarea, 'Newly posted comment');
    });

    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    await act(async () => {
      submitBtn.click();
    });

    expect(container.textContent).toContain('Newly posted comment');
    expect(container.textContent).toContain('Comments (3)');
  });

  it('edits an existing comment', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockComments,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockComments[0],
          body: 'Updated comment text',
          updated: '2026-10-05T01:00:00Z',
        }),
      } as Response);

    await act(async () => {
      root.render(<CommentsSection issueKey="PROJ-101" />);
    });

    const editBtn = container.querySelector('button[aria-label="Edit comment c-1"]') as HTMLButtonElement;
    expect(editBtn).not.toBeNull();

    await act(async () => {
      editBtn.click();
    });

    const editTextarea = container.querySelector('textarea[placeholder="Edit comment..."]') as HTMLTextAreaElement;
    expect(editTextarea).not.toBeNull();
    expect(editTextarea.value).toBe('Initial test comment');

    await act(async () => {
      setInputValue(editTextarea, 'Updated comment text');
    });

    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Save'));
    expect(saveBtn).not.toBeNull();

    await act(async () => {
      saveBtn?.click();
    });

    expect(container.textContent).toContain('Updated comment text');
  });

  it('deletes a comment after confirmation', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockComments,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'deleted', comment_id: 'c-1' }),
      } as Response);

    await act(async () => {
      root.render(<CommentsSection issueKey="PROJ-101" />);
    });

    const deleteBtn = container.querySelector('button[aria-label="Delete comment c-1"]') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();

    await act(async () => {
      deleteBtn.click();
    });

    expect(container.textContent).toContain('Delete?');

    const confirmBtn = container.querySelector('button[aria-label="Confirm delete comment c-1"]') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      confirmBtn.click();
    });

    expect(container.textContent).not.toContain('Initial test comment');
    expect(container.textContent).toContain('Comments (1)');
  });
});
