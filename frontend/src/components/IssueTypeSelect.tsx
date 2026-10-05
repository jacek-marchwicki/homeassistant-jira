import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';

export type IssueTypeValue = 'story' | 'bug' | 'task' | 'subtask';

export interface IssueTypeSelectProps {
  id?: string;
  value: IssueTypeValue;
  onChange: (value: IssueTypeValue) => void;
  disabled?: boolean;
  className?: string;
}

const ISSUE_TYPE_OPTIONS: { value: IssueTypeValue; label: string }[] = [
  { value: 'story', label: 'Story' },
  { value: 'task', label: 'Task' },
  { value: 'bug', label: 'Bug' },
  { value: 'subtask', label: 'Subtask' },
];

export function IssueTypeSelect({
  id = 'issue-type-select',
  value,
  onChange,
  disabled = false,
  className = '',
}: IssueTypeSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption =
    ISSUE_TYPE_OPTIONS.find((opt) => opt.value === value) || ISSUE_TYPE_OPTIONS[1];

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
      const currentIndex = ISSUE_TYPE_OPTIONS.findIndex((opt) => opt.value === value);
      const nextIndex =
        e.key === 'ArrowDown'
          ? (currentIndex + 1) % ISSUE_TYPE_OPTIONS.length
          : (currentIndex - 1 + ISSUE_TYPE_OPTIONS.length) % ISSUE_TYPE_OPTIONS.length;
      onChange(ISSUE_TYPE_OPTIONS[nextIndex].value);
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
        onChange={(e) => onChange(e.target.value as IssueTypeValue)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
      >
        {ISSUE_TYPE_OPTIONS.map((opt) => (
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
        aria-label="Issue Type"
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] hover:border-[var(--jira-primary)]/50 focus:outline-none focus:border-[var(--jira-primary)] transition-all cursor-pointer min-h-[42px] select-none ${
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      >
        <div className="flex items-center gap-2.5 truncate">
          <IssueTypeIcon type={selectedOption.value} className="w-4 h-4 shrink-0" />
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
          aria-label="Issue Type Options"
          className="absolute z-50 left-0 right-0 mt-1.5 bg-[var(--jira-surface)] border border-[var(--jira-border)] rounded-lg shadow-2xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
        >
          {ISSUE_TYPE_OPTIONS.map((opt) => {
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
                  <IssueTypeIcon type={opt.value} className="w-4 h-4 shrink-0" />
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
