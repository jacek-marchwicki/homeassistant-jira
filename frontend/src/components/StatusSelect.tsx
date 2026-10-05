import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { JiraStatusCategory } from '../types/jira.ts';
import { StatusIcon } from './StatusIcon.tsx';

export interface StatusOption {
  id?: string;
  name: string;
  category?: JiraStatusCategory;
}

export interface StatusSelectProps {
  id?: string;
  value: string;
  onChange: (statusName: string, category?: JiraStatusCategory) => void;
  options: StatusOption[];
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
}

export function StatusSelect({
  id = 'status-select',
  value,
  onChange,
  options,
  size = 'md',
  disabled = false,
  className = '',
  ariaLabel = 'Status',
  title = 'Change Status',
}: StatusSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption =
    options.find((opt) => opt.name.toLowerCase() === value.toLowerCase()) || {
      name: value || 'To Do',
      category: 'todo' as JiraStatusCategory,
    };

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
      const currentIndex = options.findIndex(
        (opt) => opt.name.toLowerCase() === value.toLowerCase()
      );
      const nextIndex =
        e.key === 'ArrowDown'
          ? (currentIndex + 1) % options.length
          : (currentIndex - 1 + options.length) % options.length;
      if (options[nextIndex]) {
        onChange(options[nextIndex].name, options[nextIndex].category);
      }
    }
  };

  const isSmall = size === 'sm';

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${isSmall ? '' : 'w-full'} ${className}`}
      onKeyDown={handleKeyDown}
      title={title}
    >
      {/* Underlying select for native accessibility and automated test compatibility */}
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const chosen = options.find((opt) => opt.name === e.target.value);
          onChange(e.target.value, chosen?.category);
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        aria-label={ariaLabel}
        disabled={disabled}
      >
        {options.map((opt) => (
          <option key={opt.id || opt.name} value={opt.name}>
            {opt.name}
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
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        className={`flex items-center justify-between text-[var(--jira-text-primary)] bg-[var(--jira-canvas)] border border-[var(--jira-border)] hover:border-[var(--jira-primary)]/50 focus:outline-none focus:border-[var(--jira-primary)] transition-all cursor-pointer select-none ${
          isSmall
            ? 'gap-1.5 px-2.5 py-1 text-xs rounded-md min-h-[32px]'
            : 'w-full gap-3 px-3.5 py-2.5 text-sm rounded-lg min-h-[42px]'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <div className="flex items-center gap-2 truncate">
          <StatusIcon
            category={selectedOption.category}
            statusName={selectedOption.name}
            className={isSmall ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'}
          />
          <span className="font-medium truncate">{selectedOption.name}</span>
        </div>
        <ChevronDown
          className={`${isSmall ? 'w-3.5 h-3.5 ml-1.5' : 'w-4 h-4 ml-auto'} text-[var(--jira-text-muted)] shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-[var(--jira-primary)]' : ''
          }`}
        />
      </div>

      {/* Dropdown Options Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          className={`absolute z-50 ${isSmall ? 'right-0 min-w-[160px]' : 'left-0 right-0 w-full'} mt-1.5 bg-[var(--jira-surface)] border border-[var(--jira-border)] rounded-lg shadow-2xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100 max-h-60 overflow-y-auto`}
        >
          {options.map((opt) => {
            const isSelected = opt.name.toLowerCase() === value.toLowerCase();
            return (
              <div
                key={opt.id || opt.name}
                role="option"
                aria-selected={isSelected}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(opt.name, opt.category);
                  setIsOpen(false);
                }}
                className={`flex items-center justify-between gap-2.5 ${
                  isSmall ? 'px-3 py-2 text-xs' : 'px-3.5 py-2.5 text-sm'
                } cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-[var(--jira-primary)]/15 text-[var(--jira-primary)] font-semibold'
                    : 'text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)]'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <StatusIcon
                    category={opt.category}
                    statusName={opt.name}
                    className={isSmall ? 'w-3.5 h-3.5 shrink-0' : 'w-4 h-4 shrink-0'}
                  />
                  <span className="truncate">{opt.name}</span>
                </div>
                {isSelected && (
                  <Check
                    className={`${isSmall ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-[var(--jira-primary)] shrink-0 ml-2`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
