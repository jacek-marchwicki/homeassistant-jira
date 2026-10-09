import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react';

export interface DatePickerProps {
  id?: string;
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEK_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function formatDateToIso(year: number, monthIndex: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(monthIndex + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDate(val: string): Date | null {
  if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
  const [yearStr, monthStr, dayStr] = val.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);
  const d = new Date(year, month, day);
  if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
    return d;
  }
  return null;
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = 'YYYY-MM-DD',
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const [inputValue, setInputValue] = useState(value || '');
  const [isOpen, setIsOpen] = useState(false);
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Sync internal input value with external value
  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  // Derive initial view month/year from current value or today
  const [viewDate, setViewDate] = useState<Date>(() => {
    return parseIsoDate(value || '') || new Date();
  });

  const todayStr = (() => {
    const now = new Date();
    return formatDateToIso(now.getFullYear(), now.getMonth(), now.getDate());
  })();

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const popoverWidth = 288; // w-72
    const popoverHeight = 340;
    const margin = 8;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    let top = rect.bottom + 4;

    // Flip above if tight below and more space above
    if (spaceBelow < popoverHeight + margin && spaceAbove > spaceBelow) {
      top = Math.max(margin, rect.top - popoverHeight - 4);
    } else {
      // Ensure not truncated by screen bottom
      if (top + popoverHeight > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - popoverHeight - margin);
      }
    }

    // Prevent horizontal truncation
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - popoverWidth - margin);
    }
    if (left < margin) {
      left = margin;
    }

    setPopoverCoords({ top, left });
  }, []);

  // Close calendar popover on outside click or Escape, and track scrolling/resize
  useEffect(() => {
    if (!isOpen) return;

    updatePosition();

    function handlePointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }

    function handleScrollOrResize() {
      updatePosition();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, updatePosition]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setInputValue(raw);
    if (!raw.trim()) {
      onChange('');
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      const parsed = parseIsoDate(raw.trim());
      if (parsed) {
        onChange(raw.trim());
        setViewDate(parsed);
      }
    }
  };

  const handleInputBlur = () => {
    if (!inputValue.trim()) {
      onChange('');
    } else {
      const parsed = parseIsoDate(inputValue.trim());
      if (parsed) {
        const formatted = formatDateToIso(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
        setInputValue(formatted);
        onChange(formatted);
      }
    }
  };

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setInputValue('');
      onChange('');
    },
    [onChange]
  );

  const toggleCalendar = () => {
    if (disabled) return;
    if (!isOpen) {
      const parsed = parseIsoDate(inputValue) || new Date();
      setViewDate(parsed);
      updatePosition();
    }
    setIsOpen((prev) => !prev);
  };

  const handlePrevYear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewDate((prev) => new Date(prev.getFullYear() - 1, prev.getMonth(), 1));
  };

  const handleNextYear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewDate((prev) => new Date(prev.getFullYear() + 1, prev.getMonth(), 1));
  };

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleSelectDate = (dateStr: string) => {
    setInputValue(dateStr);
    onChange(dateStr);
    setIsOpen(false);
  };

  const handleSelectToday = () => {
    setInputValue(todayStr);
    onChange(todayStr);
    setIsOpen(false);
  };

  const handleClearPicker = () => {
    setInputValue('');
    onChange('');
    setIsOpen(false);
  };

  // Build calendar days for the current viewDate month
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Day of week for 1st of month: 0 (Sun) .. 6 (Sat)
  // Convert to Monday = 0 .. Sunday = 6
  const firstDayOfWeek = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;

  const days: { dateStr: string; dayNum: number; isCurrentMonth: boolean }[] = [];

  // Previous month trailing days
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const dateStr = formatDateToIso(
      viewMonth === 0 ? viewYear - 1 : viewYear,
      viewMonth === 0 ? 11 : viewMonth - 1,
      d
    );
    days.push({ dateStr, dayNum: d, isCurrentMonth: false });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = formatDateToIso(viewYear, viewMonth, d);
    days.push({ dateStr, dayNum: d, isCurrentMonth: true });
  }

  // Trailing days to fill last week row
  const remaining = (7 - (days.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const dateStr = formatDateToIso(
      viewMonth === 11 ? viewYear + 1 : viewYear,
      viewMonth === 11 ? 0 : viewMonth + 1,
      d
    );
    days.push({ dateStr, dayNum: d, isCurrentMonth: false });
  }

  // Generate Year options around current and view years
  const currentYear = new Date().getFullYear();
  const minYear = Math.min(currentYear - 10, viewYear - 10);
  const maxYear = Math.max(currentYear + 20, viewYear + 15);
  const yearOptions: number[] = [];
  for (let y = minYear; y <= maxYear; y++) {
    yearOptions.push(y);
  }

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Input row */}
      <div className="relative flex items-center w-full">
        <input
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          className="w-full h-10 pl-3 pr-16 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] placeholder-[var(--jira-text-muted)] focus:outline-none focus:border-[var(--jira-primary)]"
        />

        <div className="absolute right-1 flex items-center gap-0.5">
          {inputValue && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear date"
              className="p-1 rounded text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
              title="Clear date"
            >
              <X className="w-4 h-4 shrink-0" />
            </button>
          )}

          <button
            type="button"
            onClick={toggleCalendar}
            disabled={disabled}
            aria-label="Open calendar"
            className="p-1.5 rounded text-[var(--jira-text-muted)] hover:text-[var(--jira-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
            title="Open date picker"
          >
            <Calendar className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </div>

      {/* Calendar Popover rendered in portal outside modal bounds */}
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            data-testid="date-picker-popover"
            role="dialog"
            aria-label="Calendar date picker"
            style={{
              position: 'fixed',
              top: `${popoverCoords.top}px`,
              left: `${popoverCoords.left}px`,
              zIndex: 9999,
            }}
            className="w-72 p-3 rounded-xl bg-[var(--jira-surface)] border border-[var(--jira-border)] shadow-2xl text-[var(--jira-text-primary)] animate-in fade-in zoom-in-95 duration-100"
          >
            {/* Month/Year Header with quick jump buttons and dropdowns */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--jira-border-subtle)] gap-1">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={handlePrevYear}
                  aria-label="Previous year"
                  title="Previous year"
                  className="p-1 rounded text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
                >
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  aria-label="Previous month"
                  title="Previous month"
                  className="p-1 rounded text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1">
                <select
                  aria-label="Select month"
                  value={viewMonth}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    setViewDate(new Date(viewYear, m, 1));
                  }}
                  className="text-xs font-bold text-[var(--jira-text-primary)] bg-transparent hover:bg-[var(--jira-surface-hover)] border border-transparent hover:border-[var(--jira-border)] rounded px-1 py-0.5 cursor-pointer focus:outline-none"
                >
                  {MONTH_NAMES.map((name, i) => (
                    <option
                      key={name}
                      value={i}
                      className="bg-[var(--jira-surface)] text-[var(--jira-text-primary)]"
                    >
                      {name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Select year"
                  data-testid="date-picker-year-select"
                  value={viewYear}
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    setViewDate(new Date(y, viewMonth, 1));
                  }}
                  className="text-xs font-bold text-[var(--jira-text-primary)] bg-transparent hover:bg-[var(--jira-surface-hover)] border border-transparent hover:border-[var(--jira-border)] rounded px-1 py-0.5 cursor-pointer focus:outline-none"
                >
                  {yearOptions.map((y) => (
                    <option
                      key={y}
                      value={y}
                      className="bg-[var(--jira-surface)] text-[var(--jira-text-primary)]"
                    >
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={handleNextMonth}
                  aria-label="Next month"
                  title="Next month"
                  className="p-1 rounded text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextYear}
                  aria-label="Next year"
                  title="Next year"
                  className="p-1 rounded text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
                >
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Weekday Labels */}
            <div className="grid grid-cols-7 gap-1 text-center mb-1">
              {WEEK_DAYS.map((wd) => (
                <span key={wd} className="text-2xs font-bold text-[var(--jira-text-muted)]">
                  {wd}
                </span>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-1">
              {days.map(({ dateStr, dayNum, isCurrentMonth }) => {
                const isSelected = dateStr === inputValue;
                const isToday = dateStr === todayStr;

                return (
                  <button
                    key={dateStr}
                    type="button"
                    data-date={dateStr}
                    onClick={() => handleSelectDate(dateStr)}
                    aria-label={`Select ${dateStr}`}
                    className={`h-7 w-7 mx-auto rounded-md text-xs font-medium flex items-center justify-center transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--jira-primary)] text-white font-bold'
                        : isToday
                          ? 'border border-[var(--jira-primary)] text-[var(--jira-primary)] hover:bg-[var(--jira-surface-hover)]'
                          : isCurrentMonth
                            ? 'text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)]'
                            : 'text-[var(--jira-text-muted)] opacity-40 hover:bg-[var(--jira-surface-hover)]'
                    }`}
                  >
                    {dayNum}
                  </button>
                );
              })}
            </div>

            {/* Popover Actions */}
            <div className="mt-3 pt-2 border-t border-[var(--jira-border-subtle)] flex items-center justify-between text-xs">
              <button
                type="button"
                data-testid="date-picker-today"
                onClick={handleSelectToday}
                aria-label="Select today"
                className="px-2 py-1 rounded text-[var(--jira-primary)] hover:bg-[var(--jira-primary)]/10 font-semibold transition-colors cursor-pointer"
              >
                Today
              </button>

              <button
                type="button"
                data-testid="date-picker-clear"
                onClick={handleClearPicker}
                aria-label="Clear date from picker"
                className="px-2 py-1 rounded text-[var(--jira-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
