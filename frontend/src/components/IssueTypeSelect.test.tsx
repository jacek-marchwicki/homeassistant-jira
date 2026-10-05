import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IssueTypeSelect } from './IssueTypeSelect.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('IssueTypeSelect component', () => {
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

  it('renders selected issue type with icon and padded chevron', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(<IssueTypeSelect value="bug" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]');
    expect(combobox).not.toBeNull();
    expect(combobox?.textContent).toContain('Bug');
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2); // Type icon + ChevronDown
  });

  it('opens dropdown on click and calls onChange when selecting an option', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(<IssueTypeSelect value="task" onChange={handleChange} />);
    });

    const combobox = container.querySelector('[role="combobox"]') as HTMLDivElement;
    await act(async () => {
      combobox.click();
    });

    const listbox = container.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();

    const storyOption = Array.from(container.querySelectorAll('[role="option"]')).find(
      (el) => el.textContent?.includes('Story')
    ) as HTMLDivElement;
    expect(storyOption).not.toBeNull();

    await act(async () => {
      storyOption.click();
    });

    expect(handleChange).toHaveBeenCalledWith('story');
  });

  it('supports underlying native select change for test and accessibility compatibility', async () => {
    const handleChange = vi.fn();
    await act(async () => {
      root.render(<IssueTypeSelect id="test-type" value="task" onChange={handleChange} />);
    });

    const select = container.querySelector('#test-type') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('task');

    await act(async () => {
      select.value = 'story';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(handleChange).toHaveBeenCalledWith('story');
  });
});
