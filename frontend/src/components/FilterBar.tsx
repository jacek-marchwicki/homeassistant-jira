import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';
import { getAssigneesFromBoard } from '../utils/boardUtils.ts';

export function FilterBar() {
  const {
    issues,
    availableUsers,
    activeFilters,
    toggleFilter,
    setActiveFilter,
    searchQuery,
    setSearchQuery,
    currentUser,
    setCurrentUser,
  } = useBoardStore();

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  const isAll = activeFilters.length === 0;
  const isMy = activeFilters.includes('my');
  const isActive = activeFilters.includes('active');
  const isHideEpics = activeFilters.includes('hide_epics');

  // Aggregate available assignees from board issues, available users, and current user
  const assignees = useMemo(
    () => getAssigneesFromBoard(issues, availableUsers, currentUser),
    [issues, availableUsers, currentUser]
  );

  useEffect(() => {
    if (isMobileSearchOpen && mobileSearchInputRef.current) {
      mobileSearchInputRef.current.focus();
    }
  }, [isMobileSearchOpen]);

  useEffect(() => {
    if (!isPickerOpen) return;
    const updatePosition = () => {
      if (pickerRef.current) {
        const rect = pickerRef.current.getBoundingClientRect();
        setPickerPosition({
          top: rect.bottom + 6,
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 230)),
        });
      }
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isPickerOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsPickerOpen(false);
      }
    };
    if (isPickerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPickerOpen]);

  return (
    <section className="relative z-10 flex flex-nowrap items-center justify-between gap-2 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-[var(--jira-border)] bg-[var(--jira-canvas)]">
      {/* Expanded Mobile Search Overlay */}
      {isMobileSearchOpen && (
        <div className="sm:hidden absolute inset-0 z-20 flex items-center gap-2 px-3 bg-[var(--jira-canvas)]">
          <div className="relative flex-1 flex items-center h-8">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-[var(--jira-text-muted)] pointer-events-none" />
            <input
              ref={mobileSearchInputRef}
              data-mobile-search="true"
              id="filter-search-input-mobile"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsMobileSearchOpen(false);
                }
              }}
              placeholder="Search key, summary, description..."
              aria-label="Search issues by key, summary, or description"
              className="w-full h-8 text-xs pl-8 pr-7 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] placeholder-[var(--jira-text-muted)] focus:outline-none focus:border-[var(--jira-primary)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] p-0.5 cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsMobileSearchOpen(false)}
            className="h-8 px-2.5 rounded-lg text-xs font-medium bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] inline-flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Close search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Filter items row */}
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar min-w-0 py-0.5">
        {/* 1. Assigned to Me / Assignee Avatars (First Item on the list) */}
        <div
          data-testid="assignee-avatars-group"
          ref={pickerRef}
          className="relative inline-flex items-center gap-1 shrink-0 p-0.5 bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] rounded-full h-7 sm:h-8"
        >
          {assignees.map((user) => {
            const isUserSelected =
              isMy && user.displayName.toLowerCase() === currentUser.toLowerCase();

            return (
              <button
                type="button"
                key={user.displayName}
                onClick={() => {
                  if (isUserSelected) {
                    toggleFilter('my');
                  } else {
                    setCurrentUser(user.displayName);
                    if (!isMy) {
                      toggleFilter('my');
                    }
                  }
                }}
                className={`relative rounded-full transition-transform cursor-pointer p-0.5 shrink-0 ${
                  isUserSelected
                    ? 'ring-2 ring-[var(--jira-primary)] ring-offset-1 ring-offset-[var(--jira-surface-elevated)] scale-105 z-10'
                    : 'opacity-80 hover:opacity-100 hover:scale-105'
                }`}
                title={`Filter by ${user.displayName}`}
                aria-label={`Filter by ${user.displayName}`}
                aria-pressed={isUserSelected}
              >
                <AssigneeAvatar
                  assignee={{ displayName: user.displayName, avatarUrl: user.avatarUrl }}
                  sizeClassName="w-5 h-5 sm:w-6 sm:h-6"
                />
              </button>
            );
          })}

          {/* Quick chevron to open user picker menu */}
          <button
            type="button"
            onClick={() => setIsPickerOpen((prev) => !prev)}
            className="h-5 sm:h-6 w-5 sm:w-6 inline-flex items-center justify-center rounded-full text-xs text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer mr-0.5"
            title="Change who is Me"
            aria-label="Change who is Me"
            aria-expanded={isPickerOpen}
            aria-haspopup="listbox"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-150 ${
                isPickerOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Who is Me Dropdown Menu */}
          {isPickerOpen && (
            <div
              role="listbox"
              aria-label="Choose who is Me"
              style={
                pickerPosition && pickerPosition.top > 0
                  ? { top: `${pickerPosition.top}px`, left: `${pickerPosition.left}px` }
                  : undefined
              }
              className={`z-50 min-w-[220px] bg-[var(--jira-surface)] border border-[var(--jira-border)] rounded-xl shadow-2xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${
                pickerPosition && pickerPosition.top > 0 ? 'fixed' : 'absolute left-0 top-full mt-1.5'
              }`}
            >
              <div className="px-3 py-1.5 text-2xs font-bold uppercase tracking-wider text-[var(--jira-text-muted)] border-b border-[var(--jira-border)]">
                Choose who is &quot;Me&quot;
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {assignees.map((user) => {
                  const isSelected =
                    user.displayName.toLowerCase() === currentUser.toLowerCase();
                  return (
                    <div
                      key={user.displayName}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setCurrentUser(user.displayName);
                        if (!isMy) toggleFilter('my');
                        setIsPickerOpen(false);
                      }}
                      className={`flex items-center justify-between gap-2.5 px-3 py-2 text-xs cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[var(--jira-primary)]/15 text-[var(--jira-primary)] font-semibold'
                          : 'text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)]'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <AssigneeAvatar
                          assignee={{ displayName: user.displayName, avatarUrl: user.avatarUrl }}
                          sizeClassName="w-5 h-5 shrink-0"
                        />
                        <span className="truncate">{user.displayName}</span>
                      </div>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-[var(--jira-primary)] shrink-0 ml-auto" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 2. All Issues */}
        <button
          type="button"
          onClick={() => setActiveFilter('all')}
          className={`h-7 sm:h-8 px-2.5 sm:px-3 rounded-full text-xs font-medium inline-flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
            isAll
              ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
              : 'bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
        >
          All Issues ({issues.length})
        </button>

        {/* 3. Active */}
        <button
          type="button"
          onClick={() => toggleFilter('active')}
          className={`h-7 sm:h-8 px-2.5 sm:px-3 rounded-full text-xs font-medium inline-flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
            isActive
              ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
              : 'bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
        >
          Active
        </button>

        {/* 4. Hide Epics */}
        <button
          type="button"
          onClick={() => toggleFilter('hide_epics')}
          className={`h-7 sm:h-8 px-2.5 sm:px-3 rounded-full text-xs font-medium inline-flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
            isHideEpics
              ? 'bg-[var(--jira-primary)] text-white shadow-xs font-semibold'
              : 'bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
          title="Toggle filter to hide Epics"
        >
          Hide Epics
        </button>
      </div>

      {/* Desktop Quick Search Input */}
      <div className="hidden sm:flex relative items-center shrink-0 sm:w-48 md:w-64 h-7 sm:h-8">
        <Search className="w-3.5 h-3.5 absolute left-2.5 text-[var(--jira-text-muted)] pointer-events-none" />
        <input
          id="filter-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search key, summary, description..."
          aria-label="Search issues by key, summary, or description"
          className="w-full h-7 sm:h-8 text-xs pl-8 pr-2.5 sm:pr-3 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] placeholder-[var(--jira-text-muted)] focus:outline-none focus:border-[var(--jira-primary)]"
        />
      </div>

      {/* Mobile Search Button Trigger */}
      <button
        type="button"
        onClick={() => setIsMobileSearchOpen(true)}
        className={`sm:hidden h-7 w-7 rounded-full inline-flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
          searchQuery.trim()
            ? 'bg-[var(--jira-primary)]/15 border border-[var(--jira-primary)] text-[var(--jira-primary)]'
            : 'bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
        }`}
        aria-label="Open search"
        title="Search issues"
      >
        <Search className="w-3.5 h-3.5" />
      </button>
    </section>
  );
}
