import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext } from '@dnd-kit/core';
import { IssueCard } from './IssueCard.tsx';
import { clearBackgroundCache } from '../utils/useTaskBackground.ts';
import { JiraIssue } from '../types/jira.ts';
import { useBoardStore } from '../store/boardStore.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testIssue: JiraIssue = {
  id: '101',
  key: 'CHORE-101',
  summary: 'Clean bedroom and fold clothes',
  priority: 'high',
  status: { id: 'col-todo', name: 'To Do', category: 'todo' },
};

describe('IssueCard component with background support', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let originalImage: typeof Image;

  beforeEach(() => {
    clearBackgroundCache();
    originalImage = window.Image;
    useBoardStore.setState({
      issues: [testIssue],
      columns: [
        { id: 'col-todo', name: 'To Do', category: 'todo', status_ids: ['col-todo'] },
        { id: 'col-done', name: 'Done', category: 'done', status_ids: ['col-done'] },
      ],
      jiraUrl: 'https://jira.example.com',
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
          <IssueCard issue={testIssue} />
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
          <IssueCard issue={testIssue} />
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
