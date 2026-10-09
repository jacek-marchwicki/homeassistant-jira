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
    document.querySelectorAll('[data-testid="date-picker-popover"]').forEach((el) => el.remove());
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

    const popover = document.body.querySelector('[data-testid="date-picker-popover"]');
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain('October');
  });

  it('renders popover in a portal attached to document.body, outside container', async () => {
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

    // Popover is in document.body
    const popoverInBody = document.body.querySelector('[data-testid="date-picker-popover"]');
    expect(popoverInBody).not.toBeNull();

    // Popover is NOT a descendant of the component container (proves portal)
    expect(container.querySelector('[data-testid="date-picker-popover"]')).toBeNull();
  });

  it('allows quickly changing year via previous and next year buttons', async () => {
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

    const popover = document.body.querySelector('[data-testid="date-picker-popover"]') as HTMLDivElement;
    expect(popover).not.toBeNull();

    const yearSelect = popover.querySelector('[data-testid="date-picker-year-select"]') as HTMLSelectElement;
    expect(yearSelect.value).toBe('2026');

    // Click Next Year (>>)
    const nextYearBtn = popover.querySelector('button[aria-label="Next year"]') as HTMLButtonElement;
    expect(nextYearBtn).not.toBeNull();
    await act(async () => {
      nextYearBtn.click();
    });
    expect(yearSelect.value).toBe('2027');

    // Click Prev Year (<<)
    const prevYearBtn = popover.querySelector('button[aria-label="Previous year"]') as HTMLButtonElement;
    expect(prevYearBtn).not.toBeNull();
    await act(async () => {
      prevYearBtn.click();
      prevYearBtn.click();
    });
    expect(yearSelect.value).toBe('2025');
  });

  it('allows quickly selecting a year via the year select dropdown', async () => {
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

    const popover = document.body.querySelector('[data-testid="date-picker-popover"]') as HTMLDivElement;
    const yearSelect = popover.querySelector('[data-testid="date-picker-year-select"]') as HTMLSelectElement;
    expect(yearSelect).not.toBeNull();

    await act(async () => {
      yearSelect.value = '2030';
      yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(yearSelect.value).toBe('2030');

    // Pick a date in 2030
    const dayBtn = popover.querySelector('button[data-date="2030-10-15"]') as HTMLButtonElement;
    expect(dayBtn).not.toBeNull();
    await act(async () => {
      dayBtn.click();
    });

    expect(handleChange).toHaveBeenCalledWith('2030-10-15');
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

    const popover = document.body.querySelector('[data-testid="date-picker-popover"]') as HTMLDivElement;
    const dayBtn = popover.querySelector('button[data-date="2026-10-20"]') as HTMLButtonElement;
    expect(dayBtn).not.toBeNull();

    await act(async () => {
      dayBtn.click();
    });

    expect(handleChange).toHaveBeenCalledWith('2026-10-20');
    // Popover should close after selecting a date
    expect(document.body.querySelector('[data-testid="date-picker-popover"]')).toBeNull();
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

    const popover = document.body.querySelector('[data-testid="date-picker-popover"]') as HTMLDivElement;
    const todayBtn = popover.querySelector('button[data-testid="date-picker-today"]') as HTMLButtonElement;
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
    expect(document.body.querySelector('[data-testid="date-picker-popover"]')).toBeNull();
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

    const popover = document.body.querySelector('[data-testid="date-picker-popover"]') as HTMLDivElement;
    const clearPickerBtn = popover.querySelector('button[data-testid="date-picker-clear"]') as HTMLButtonElement;
    expect(clearPickerBtn).not.toBeNull();

    await act(async () => {
      clearPickerBtn.click();
    });

    expect(handleChange).toHaveBeenCalledWith('');
    expect(document.body.querySelector('[data-testid="date-picker-popover"]')).toBeNull();
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

    expect(document.body.querySelector('[data-testid="date-picker-popover"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(document.body.querySelector('[data-testid="date-picker-popover"]')).toBeNull();
  });
});
