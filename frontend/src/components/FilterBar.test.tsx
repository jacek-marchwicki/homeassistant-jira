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
    assignee: { displayName: 'Sarah Connor' },
    start_date: null,
  },
];

describe('FilterBar component', () => {
  beforeEach(() => {
    act(() => {
      useBoardStore.setState({
        issues: testIssues,
        searchQuery: '',
        activeFilters: ['my', 'active', 'hide_epics'],
        activeFilter: 'my,active,hide_epics',
      });
    });
  });

  it('renders All Issues, Assigned to Me, Active, and Hide Epics buttons, but not Blockers', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<FilterBar />);
    });

    expect(container.textContent).toContain('All Issues (2)');
    expect(container.textContent).toContain('Assigned to Me');
    expect(container.textContent).toContain('Active');
    expect(container.textContent).toContain('Hide Epics');
    expect(container.textContent).not.toContain('Blockers');

    await act(async () => {
      root.unmount();
    });
  });

  it('selects "Assigned to Me", "Active", and "Hide Epics" by default, while "All Issues" is inactive', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<FilterBar />);
    });

    const buttons = container.querySelectorAll('button');
    const allBtn = Array.from(buttons).find((b) => b.textContent?.includes('All Issues'));
    const myBtn = Array.from(buttons).find((b) => b.textContent?.includes('Assigned to Me'));
    const activeBtn = Array.from(buttons).find((b) => b.textContent?.includes('Active'));
    const hideEpicsBtn = Array.from(buttons).find((b) => b.textContent?.includes('Hide Epics'));

    expect(allBtn?.className).not.toContain('bg-[var(--jira-primary)]');
    expect(myBtn?.className).toContain('bg-[var(--jira-primary)]');
    expect(activeBtn?.className).toContain('bg-[var(--jira-primary)]');
    expect(hideEpicsBtn?.className).toContain('bg-[var(--jira-primary)]');

    await act(async () => {
      root.unmount();
    });
  });

  it('toggles "Assigned to Me", "Active", and "Hide Epics" filters when clicked', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<FilterBar />);
    });

    const buttons = container.querySelectorAll('button');
    const myBtn = Array.from(buttons).find((b) => b.textContent?.includes('Assigned to Me'));
    const activeBtn = Array.from(buttons).find((b) => b.textContent?.includes('Active'));
    const hideEpicsBtn = Array.from(buttons).find((b) => b.textContent?.includes('Hide Epics'));
    const allBtn = Array.from(buttons).find((b) => b.textContent?.includes('All Issues'));

    // Toggle off "Assigned to Me"
    await act(async () => {
      myBtn?.click();
    });
    expect(useBoardStore.getState().activeFilters).toEqual(['active', 'hide_epics']);

    // Toggle off "Active"
    await act(async () => {
      activeBtn?.click();
    });
    expect(useBoardStore.getState().activeFilters).toEqual(['hide_epics']);

    // Toggle off "Hide Epics"
    await act(async () => {
      hideEpicsBtn?.click();
    });
    expect(useBoardStore.getState().activeFilters).toEqual([]);
    expect(allBtn?.className).toContain('bg-[var(--jira-primary)]');

    // Toggle "Hide Epics" back on
    await act(async () => {
      hideEpicsBtn?.click();
    });
    expect(useBoardStore.getState().activeFilters).toEqual(['hide_epics']);

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

  it('renders current user badge and opens "Who is Me" dropdown to select user', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      useBoardStore.setState({ currentUser: 'Jacek Marchwicki' });
      root.render(<FilterBar />);
    });

    // Badge showing first name
    expect(container.textContent).toContain('Jacek');

    // Find the dropdown chevron button
    const chevronBtn = container.querySelector(
      'button[aria-label="Change who is Me"]'
    ) as HTMLButtonElement;
    expect(chevronBtn).not.toBeNull();
    expect(chevronBtn.getAttribute('aria-expanded')).toBe('false');

    // Click to open dropdown
    await act(async () => {
      chevronBtn.click();
    });

    expect(chevronBtn.getAttribute('aria-expanded')).toBe('true');
    const dropdown = container.querySelector('[role="listbox"]');
    expect(dropdown).not.toBeNull();
    expect(dropdown?.textContent).toContain('Choose who is "Me"');
    expect(dropdown?.textContent).toContain('Sarah Connor');
    expect(dropdown?.textContent).not.toContain('Alex Lead');

    // Select Sarah Connor
    const options = container.querySelectorAll('[role="option"]');
    const sarahOption = Array.from(options).find((opt) =>
      opt.textContent?.includes('Sarah Connor')
    ) as HTMLElement;
    expect(sarahOption).toBeDefined();

    await act(async () => {
      sarahOption.click();
    });

    expect(useBoardStore.getState().currentUser).toBe('Sarah Connor');
    expect(useBoardStore.getState().activeFilters).toContain('my');
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it('renders single-line filter bar with flex-nowrap, z-10 stacking, and no flex-wrap', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<FilterBar />);
    });

    const section = container.querySelector('section');
    expect(section).not.toBeNull();
    expect(section?.className).toContain('flex-nowrap');
    expect(section?.className).not.toContain('flex-wrap');
    expect(section?.className).toContain('z-10');

    // Filter pills container is horizontally scrollable with no-scrollbar
    const pillsContainer = section?.firstElementChild as HTMLElement;
    expect(pillsContainer).not.toBeNull();
    expect(pillsContainer.className).toContain('overflow-x-auto');
    expect(pillsContainer.className).toContain('no-scrollbar');

    // Search input is directly beside the pills container
    const searchContainer = section?.lastElementChild as HTMLElement;
    expect(searchContainer).not.toBeNull();
    expect(searchContainer.className).toContain('shrink-0');
    expect(searchContainer.querySelector('input')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});

