import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LinkedIssuesSection } from './LinkedIssuesSection.tsx';
import { JiraIssue } from '../types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockIssueWithLinks: JiraIssue = {
  id: '101',
  key: 'PROJ-101',
  summary: 'Main issue with links',
  issue_type: 'task',
  priority: 'high',
  status: { id: 'col-todo', name: 'To Do', category: 'todo' },
  updated_at: '2026-10-05T00:00:00Z',
  issue_links: [
    {
      id: 'link-1',
      relationship: 'is cloned by',
      direction: 'inward',
      issue: {
        id: '102',
        key: 'PROJ-102',
        summary: 'Clone of main issue',
        issue_type: 'task',
        priority: 'medium',
        status: { id: 'col-done', name: 'Done', category: 'done' },
        url: 'https://jira.example.com/browse/PROJ-102',
      },
    },
    {
      id: 'link-2',
      relationship: 'blocks',
      direction: 'outward',
      issue: {
        id: '103',
        key: 'PROJ-103',
        summary: 'Blocked dependency issue',
        issue_type: 'bug',
        priority: 'highest',
        status: { id: 'col-inprogress', name: 'In Progress', category: 'inprogress' },
        url: 'https://jira.example.com/browse/PROJ-103',
      },
    },
  ],
};

const mockIssueWithoutLinks: JiraIssue = {
  id: '201',
  key: 'PROJ-201',
  summary: 'Issue without links',
  issue_type: 'task',
  priority: 'low',
  status: { id: 'col-todo', name: 'To Do', category: 'todo' },
  updated_at: '2026-10-05T00:00:00Z',
  issue_links: [],
};

describe('LinkedIssuesSection component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
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

  it('renders nothing when issue has no linked issues', async () => {
    await act(async () => {
      root.render(<LinkedIssuesSection issue={mockIssueWithoutLinks} />);
    });

    const section = container.querySelector('[data-testid="linked-issues-section"]');
    expect(section).toBeNull();
  });

  it('renders linked issues with relationships, summaries, keys, and status', async () => {
    const handleSelectIssue = vi.fn();

    await act(async () => {
      root.render(
        <LinkedIssuesSection
          issue={mockIssueWithLinks}
          onSelectIssue={handleSelectIssue}
        />
      );
    });

    const section = container.querySelector('[data-testid="linked-issues-section"]');
    expect(section).not.toBeNull();

    // Verify relationship labels
    expect(container.textContent).toContain('is cloned by');
    expect(container.textContent).toContain('blocks');

    // Verify linked keys and summaries
    expect(container.textContent).toContain('PROJ-102');
    expect(container.textContent).toContain('Clone of main issue');
    expect(container.textContent).toContain('PROJ-103');
    expect(container.textContent).toContain('Blocked dependency issue');

    // Verify statuses
    expect(container.textContent).toContain('Done');
    expect(container.textContent).toContain('In Progress');
  });

  it('calls onSelectIssue when a linked issue card is clicked', async () => {
    const handleSelectIssue = vi.fn();

    await act(async () => {
      root.render(
        <LinkedIssuesSection
          issue={mockIssueWithLinks}
          onSelectIssue={handleSelectIssue}
        />
      );
    });

    const linkItem = container.querySelector(
      '[data-testid="linked-issue-PROJ-102"]'
    ) as HTMLElement;
    expect(linkItem).not.toBeNull();

    await act(async () => {
      linkItem.click();
    });

    expect(handleSelectIssue).toHaveBeenCalledTimes(1);
    expect(handleSelectIssue).toHaveBeenCalledWith('PROJ-102');
  });

  it('supports opening external Jira URL without triggering onSelectIssue', async () => {
    const handleSelectIssue = vi.fn();

    await act(async () => {
      root.render(
        <LinkedIssuesSection
          issue={mockIssueWithLinks}
          onSelectIssue={handleSelectIssue}
        />
      );
    });

    const externalLink = container.querySelector(
      'a[href="https://jira.example.com/browse/PROJ-102"]'
    ) as HTMLAnchorElement;
    expect(externalLink).not.toBeNull();
    expect(externalLink.getAttribute('target')).toBe('_blank');
    expect(externalLink.getAttribute('rel')).toBe('noopener noreferrer');

    await act(async () => {
      externalLink.click();
    });

    // stopPropagation ensures row click is not triggered
    expect(handleSelectIssue).not.toHaveBeenCalled();
  });
});
