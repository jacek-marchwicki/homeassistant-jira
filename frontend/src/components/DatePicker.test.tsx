import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DatePicker } from './DatePicker.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('DatePicker component', () => {
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

  it('renders input with initial value and placeholder', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <DatePicker
          id="test-date"
          value="2026-10-15"
          onChange={handleChange}
          placeholder="Select date"
        />
      );
    });

    const input = container.querySelector('#test-date') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('2026-10-15');
    expect(input.placeholder).toBe('Select date');
  });

  it('allows manual text entry and calls onChange', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <DatePicker
          id="test-date"
          value=""
          onChange={handleChange}
        />
      );
    });

    const input = container.querySelector('#test-date') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, '2026-12-25');
    });

    expect(handleChange).toHaveBeenCalledWith('2026-12-25');
  });

  it('allows manually clearing by typing an empty string', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <DatePicker
          id="test-date"
          value="2026-10-15"
          onChange={handleChange}
        />
      );
    });

    const input = container.querySelector('#test-date') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, '');
    });

    expect(handleChange).toHaveBeenCalledWith('');
  });

  it('provides a manual clear button on the input when a date is present', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <DatePicker
          id="test-date"
          value="2026-10-15"
          onChange={handleChange}
        />
      );
    });

    const clearBtn = container.querySelector('button[aria-label="Clear date"]') as HTMLButtonElement;
    expect(clearBtn).not.toBeNull();

    await act(async () => {
      clearBtn.click();
    });

    expect(handleChange).toHaveBeenCalledWith('');
  });

  it('opens calendar popover when clicking calendar button', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <DatePicker
          id="test-date"
          value="2026-10-15"
          onChange={handleChange}
        />
      );
    });

    const calendarBtn = container.querySelector('button[aria-label="Open calendar"]') as HTMLButtonElement;
    expect(calendarBtn).not.toBeNull();

    await act(async () => {
      calendarBtn.click();
    });

    const popover = container.querySelector('[data-testid="date-picker-popover"]');
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain('October 2026');
  });

  it('selects date from calendar popover and calls onChange', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <DatePicker
          id="test-date"
          value="2026-10-15"
          onChange={handleChange}
        />
      );
    });

    const calendarBtn = container.querySelector('button[aria-label="Open calendar"]') as HTMLButtonElement;
    await act(async () => {
      calendarBtn.click();
    });

    const dayBtn = container.querySelector('button[data-date="2026-10-20"]') as HTMLButtonElement;
    expect(dayBtn).not.toBeNull();

    await act(async () => {
      dayBtn.click();
    });

    expect(handleChange).toHaveBeenCalledWith('2026-10-20');
    // Popover should close after selecting a date
    expect(container.querySelector('[data-testid="date-picker-popover"]')).toBeNull();
  });

  it('selects today from calendar popover', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <DatePicker
          id="test-date"
          value=""
          onChange={handleChange}
        />
      );
    });

    const calendarBtn = container.querySelector('button[aria-label="Open calendar"]') as HTMLButtonElement;
    await act(async () => {
      calendarBtn.click();
    });

    const todayBtn = container.querySelector('button[data-testid="date-picker-today"]') as HTMLButtonElement;
    expect(todayBtn).not.toBeNull();

    await act(async () => {
      todayBtn.click();
    });

    const now = new Date();
    const expectedYear = now.getFullYear();
    const expectedMonth = String(now.getMonth() + 1).padStart(2, '0');
    const expectedDay = String(now.getDate()).padStart(2, '0');
    const expectedTodayStr = `${expectedYear}-${expectedMonth}-${expectedDay}`;

    expect(handleChange).toHaveBeenCalledWith(expectedTodayStr);
    expect(container.querySelector('[data-testid="date-picker-popover"]')).toBeNull();
  });

  it('clears date via calendar popover clear button', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <DatePicker
          id="test-date"
          value="2026-10-15"
          onChange={handleChange}
        />
      );
    });

    const calendarBtn = container.querySelector('button[aria-label="Open calendar"]') as HTMLButtonElement;
    await act(async () => {
      calendarBtn.click();
    });

    const clearPickerBtn = container.querySelector('button[data-testid="date-picker-clear"]') as HTMLButtonElement;
    expect(clearPickerBtn).not.toBeNull();

    await act(async () => {
      clearPickerBtn.click();
    });

    expect(handleChange).toHaveBeenCalledWith('');
    expect(container.querySelector('[data-testid="date-picker-popover"]')).toBeNull();
  });

  it('closes calendar popover on Escape key', async () => {
    const handleChange = vi.fn();

    await act(async () => {
      root.render(
        <DatePicker
          id="test-date"
          value="2026-10-15"
          onChange={handleChange}
        />
      );
    });

    const calendarBtn = container.querySelector('button[aria-label="Open calendar"]') as HTMLButtonElement;
    await act(async () => {
      calendarBtn.click();
    });

    expect(container.querySelector('[data-testid="date-picker-popover"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(container.querySelector('[data-testid="date-picker-popover"]')).toBeNull();
  });
});
