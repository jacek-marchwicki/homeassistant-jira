import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StatusSelect, StatusOption } from './StatusSelect.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockOptions: StatusOption[] = [
  { id: '1', name: 'To Do', category: 'todo' },
  { id: '2', name: 'In Progress', category: 'inprogress' },
  { id: '3', name: 'Done', category: 'done' },
];

describe('StatusSelect component', () => {
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

  it('renders selected status with icon and padded chevron', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(
        <StatusSelect
          value="In Progress"
          onChange={handleChange}
          options={mockOptions}
          size="md"
        />
      );
    });

    const combobox = container.querySelector('[role="combobox"]');
    expect(combobox).not.toBeNull();
    expect(combobox?.textContent).toContain('In Progress');
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2); // Status icon + ChevronDown
  });

  it('renders compact sm variant for cards and backlog rows', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(
        <StatusSelect
          value="Done"
          onChange={handleChange}
          options={mockOptions}
          size="sm"
        />
      );
    });

    const combobox = container.querySelector('[role="combobox"]');
    expect(combobox?.className).toContain('text-xs');
    expect(combobox?.className).toContain('min-h-[32px]');
  });

  it('opens dropdown and allows selecting another status', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(
        <StatusSelect
          value="To Do"
          onChange={handleChange}
          options={mockOptions}
          size="md"
        />
      );
    });

    const combobox = container.querySelector('[role="combobox"]') as HTMLDivElement;
    await act(async () => {
      combobox.click();
    });

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();

    const doneOption = Array.from(container.querySelectorAll('[role="option"]')).find(
      (el) => el.textContent?.includes('Done')
    ) as HTMLDivElement;
    expect(doneOption).not.toBeNull();

    await act(async () => {
      doneOption.click();
    });

    expect(handleChange).toHaveBeenCalledWith('Done', 'done');
  });

  it('supports underlying native select change for test and accessibility compatibility', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(
        <StatusSelect
          id="test-status"
          value="To Do"
          onChange={handleChange}
          options={mockOptions}
        />
      );
    });

    const select = container.querySelector('#test-status') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('To Do');

    await act(async () => {
      select.value = 'Done';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(handleChange).toHaveBeenCalledWith('Done', 'done');
  });

  it('generates unique id attribute when id is omitted across multiple instances', async () => {
    await act(async () => {
      root.render(
        <div>
          <StatusSelect value="To Do" onChange={vi.fn()} options={mockOptions} />
          <StatusSelect value="In Progress" onChange={vi.fn()} options={mockOptions} />
        </div>
      );
    });

    const selects = container.querySelectorAll('select');
    expect(selects.length).toBe(2);
    const id1 = selects[0].getAttribute('id');
    const id2 = selects[1].getAttribute('id');
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });
});
