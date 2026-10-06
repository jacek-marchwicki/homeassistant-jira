import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AssigneeSelect } from './AssigneeSelect.tsx';
import { useBoardStore } from '../store/boardStore.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AssigneeSelect component', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.restoreAllMocks();
    useBoardStore.setState({
      issues: [
        {
          id: '1',
          key: 'TEST-1',
          summary: 'Test issue',
          issue_type: 'task',
          priority: 'medium',
          status: { id: '1', name: 'To Do', category: 'todo' },
          assignee: { accountId: 'usr-10', displayName: 'Samantha Miller' },
          updated_at: '2026-10-05T00:00:00Z',
        },
      ],
      columns: [],
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

  function setInputValue(element: HTMLInputElement, value: string) {
    const prototype = window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('renders unassigned placeholder when value is empty', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(<AssigneeSelect value="" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]') as HTMLDivElement;
    expect(combobox).not.toBeNull();
    expect(combobox.textContent).toContain('Unassigned');
  });

  it('renders current assignee name when value is provided', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(<AssigneeSelect value="Jacek Marchwicki" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]') as HTMLDivElement;
    expect(combobox.textContent).toContain('Jacek Marchwicki');
  });

  it('opens dropdown and displays suggestions including board assignees', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(<AssigneeSelect value="" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]') as HTMLDivElement;
    await act(async () => {
      combobox.click();
    });

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.textContent).toContain('Unassigned');
    expect(listbox?.textContent).toContain('Jacek Marchwicki');
    expect(listbox?.textContent).not.toContain('Alex Lead');
    expect(listbox?.textContent).toContain('Samantha Miller');
  });

  it('filters suggestions when typing in search input', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(<AssigneeSelect value="" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]') as HTMLDivElement;
    await act(async () => {
      combobox.click();
    });

    const searchInput = container.querySelector('input[placeholder="Search assignees..."]') as HTMLInputElement;
    expect(searchInput).not.toBeNull();

    await act(async () => {
      setInputValue(searchInput, 'Samantha');
    });

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox?.textContent).toContain('Samantha Miller');
    expect(listbox?.textContent).not.toContain('Jacek Marchwicki');
  });

  it('allows picking a suggestion and triggers onChange', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(<AssigneeSelect value="" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]') as HTMLDivElement;
    await act(async () => {
      combobox.click();
    });

    const samanthaBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Samantha Miller')
    );
    expect(samanthaBtn).toBeDefined();

    await act(async () => {
      samanthaBtn?.click();
    });

    expect(handleChange).toHaveBeenCalledWith('Samantha Miller');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it('allows setting custom assignee name when search does not match', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(<AssigneeSelect value="" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]') as HTMLDivElement;
    await act(async () => {
      combobox.click();
    });

    const searchInput = container.querySelector('input[placeholder="Search assignees..."]') as HTMLInputElement;

    await act(async () => {
      setInputValue(searchInput, 'New Developer');
    });

    const customBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Assign to "New Developer"')
    );
    expect(customBtn).toBeDefined();

    await act(async () => {
      customBtn?.click();
    });

    expect(handleChange).toHaveBeenCalledWith('New Developer');
  });

  it('closes dropdown on Escape key', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(<AssigneeSelect value="" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]') as HTMLDivElement;
    await act(async () => {
      combobox.click();
    });
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    await act(async () => {
      container.querySelector('[role="listbox"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });

    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});
