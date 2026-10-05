import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PrioritySelect } from './PrioritySelect.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('PrioritySelect component', () => {
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

  it('renders selected priority with icon and padded chevron', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(<PrioritySelect value="highest" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]');
    expect(combobox).not.toBeNull();
    expect(combobox?.textContent).toContain('Highest');
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2); // Priority icon + ChevronDown
  });

  it('opens dropdown on click and calls onChange when selecting an option', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(<PrioritySelect value="medium" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]') as HTMLDivElement;
    await act(async () => {
      combobox.click();
    });

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();

    const highOption = Array.from(container.querySelectorAll('[role="option"]')).find(
      (el) => el.textContent?.trim() === 'High'
    ) as HTMLDivElement;
    expect(highOption).not.toBeNull();

    await act(async () => {
      highOption.click();
    });

    expect(handleChange).toHaveBeenCalledWith('high');
  });

  it('supports underlying native select change for test and accessibility compatibility', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(<PrioritySelect id="test-priority" value="medium" onChange={handleChange} />);
    });

    const select = container.querySelector('#test-priority') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('medium');

    await act(async () => {
      select.value = 'highest';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(handleChange).toHaveBeenCalledWith('highest');
  });
});
