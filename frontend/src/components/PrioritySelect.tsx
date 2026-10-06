import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { JiraPriority } from '../types/jira.ts';
import { PriorityIcon } from './PriorityIcon.tsx';

export interface PrioritySelectProps {
  id?: string;
  value: JiraPriority;
  onChange: (value: JiraPriority) => void;
  disabled?: boolean;
  className?: string;
}

const PRIORITY_OPTIONS: { value: JiraPriority; label: string }[] = [
  { value: 'highest', label: 'Highest' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'lowest', label: 'Lowest' },
];

export function PrioritySelect({
  id = 'priority-select',
  value,
  onChange,
  disabled = false,
  className = '',
}: PrioritySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption =
    PRIORITY_OPTIONS.find((opt) => opt.value === value) || PRIORITY_OPTIONS[2];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      setIsOpen(false);
    } else if ((e.key === 'Enter' || e.key === ' ') && !isOpen) {
      e.preventDefault();
      setIsOpen(true);
    } else if (isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const currentIndex = PRIORITY_OPTIONS.findIndex((opt) => opt.value === value);
      const nextIndex =
        e.key === 'ArrowDown'
          ? (currentIndex + 1) % PRIORITY_OPTIONS.length
          : (currentIndex - 1 + PRIORITY_OPTIONS.length) % PRIORITY_OPTIONS.length;
      onChange(PRIORITY_OPTIONS[nextIndex].value);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${className}`}
      onKeyDown={handleKeyDown}
    >
      {/* Underlying select for native accessibility and automated test compatibility */}
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as JiraPriority)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
      >
        {PRIORITY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Styled Interactive Trigger */}
      <div
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Priority"
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        className={`w-full h-10 flex items-center justify-between gap-3 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] hover:border-[var(--jira-primary)]/50 focus:outline-none focus:border-[var(--jira-primary)] transition-all cursor-pointer select-none ${
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      >
        <div className="flex items-center gap-2.5 truncate">
          <PriorityIcon priority={selectedOption.value} className="w-4 h-4 shrink-0" />
          <span className="font-medium truncate">{selectedOption.label}</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-[var(--jira-text-muted)] shrink-0 ml-auto transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-[var(--jira-primary)]' : ''
          }`}
        />
      </div>

      {/* Dropdown Options Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label="Priority Options"
          className="absolute z-50 left-0 right-0 mt-1.5 bg-[var(--jira-surface)] border border-[var(--jira-border)] rounded-lg shadow-2xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          {PRIORITY_OPTIONS.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-sm cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[var(--jira-primary)]/15 text-[var(--jira-primary)] font-semibold'
                    : 'text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)]'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <PriorityIcon priority={opt.value} className="w-4 h-4 shrink-0" />
                  <span className="truncate">{opt.label}</span>
                </div>
                {isSelected && <Check className="w-4 h-4 text-[var(--jira-primary)] shrink-0" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
