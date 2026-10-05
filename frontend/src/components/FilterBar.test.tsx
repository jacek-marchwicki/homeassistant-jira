import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { FilterBar } from './FilterBar.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testIssues: JiraIssue[] = [
  {
    id: '1',
    key: 'PROJ-1',
    summary: 'Task 1',
    priority: 'high',
    status: { id: 'col-todo', name: 'To Do', category: 'todo' },
    assignee: { displayName: 'Jacek Marchwicki' },
    start_date: '2026-10-01',
  },
  {
    id: '2',
    key: 'PROJ-2',
    summary: 'Task 2',
    priority: 'medium',
    status: { id: 'col-inprogress', name: 'In Progress', category: 'inprogress' },
    assignee: null,
    start_date: null,
  },
];

describe('FilterBar component', () => {
  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        issues: testIssues,
        searchQuery: '',
        activeFilters: ['my', 'active'],
        activeFilter: 'my,active',
      });
    });
  });

  it('renders All Issues, Assigned to Me, and Active buttons, but not Blockers', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<FilterBar />);
    });

    expect(container.textContent).toContain('All Issues (2)');
    expect(container.textContent).toContain('Assigned to Me');
    expect(container.textContent).toContain('Active');
    expect(container.textContent).not.toContain('Blockers');

    await act(async () => {
      root.unmount();
    });
  });

  it('selects "Assigned to Me" and "Active" by default, while "All Issues" is inactive', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<FilterBar />);
    });

    const buttons = container.querySelectorAll('button');
    const allBtn = Array.from(buttons).find((b) => b.textContent?.includes('All Issues'));
    const myBtn = Array.from(buttons).find((b) => b.textContent?.includes('Assigned to Me'));
    const activeBtn = Array.from(buttons).find((b) => b.textContent?.includes('Active'));

    expect(allBtn?.className).not.toContain('bg-[var(--jira-primary)]');
    expect(myBtn?.className).toContain('bg-[var(--jira-primary)]');
    expect(activeBtn?.className).toContain('bg-[var(--jira-primary)]');

    await act(async () => {
      root.unmount();
    });
  });

  it('toggles "Assigned to Me" and "Active" filters when clicked', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<FilterBar />);
    });

    const buttons = container.querySelectorAll('button');
    const myBtn = Array.from(buttons).find((b) => b.textContent?.includes('Assigned to Me'));
    const activeBtn = Array.from(buttons).find((b) => b.textContent?.includes('Active'));
    const allBtn = Array.from(buttons).find((b) => b.textContent?.includes('All Issues'));

    // Toggle off "Assigned to Me"
    await act(async () => {
      myBtn?.click();
    });
    expect(useBoardStore.getState().activeFilters).toEqual(['active']);

    // Toggle off "Active"
    await act(async () => {
      activeBtn?.click();
    });
    expect(useBoardStore.getState().activeFilters).toEqual([]);
    expect(allBtn?.className).toContain('bg-[var(--jira-primary)]');

    // Click "All Issues" button clears/keeps empty
    await act(async () => {
      allBtn?.click();
    });
    expect(useBoardStore.getState().activeFilters).toEqual([]);

    await act(async () => {
      root.unmount();
    });
  });

  it('updates searchQuery state when user types in search input', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<FilterBar />);
    });

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      const tracker = (input as unknown as { _valueTracker?: { setValue: (val: string) => void } })
        ._valueTracker;
      if (tracker) {
        tracker.setValue('');
      }
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      nativeSetter?.call(input, 'query test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(useBoardStore.getState().searchQuery).toBe('query test');

    await act(async () => {
      root.unmount();
    });
  });
});
