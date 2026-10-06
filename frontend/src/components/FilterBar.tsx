import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';

export function FilterBar() {
  const {
    issues,
    activeFilters,
    toggleFilter,
    setActiveFilter,
    searchQuery,
    setSearchQuery,
    currentUser,
    setCurrentUser,
  } = useBoardStore();

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const isAll = activeFilters.length === 0;
  const isMy = activeFilters.includes('my');
  const isActive = activeFilters.includes('active');
  const isHideEpics = activeFilters.includes('hide_epics');

  // Aggregate available assignees from board issues
  const assignees = useMemo(() => {
    const map = new Map<string, { displayName: string; avatarUrl?: string }>();
    if (currentUser && currentUser.trim()) {
      map.set(currentUser.trim().toLowerCase(), { displayName: currentUser.trim() });
    }

    for (const issue of issues) {
      if (issue.assignee) {
        const name = issue.assignee.displayName || issue.assignee.display_name;
        if (name && name.trim()) {
          const key = name.trim().toLowerCase();
          if (!map.has(key)) {
            map.set(key, {
              displayName: name.trim(),
              avatarUrl: issue.assignee.avatarUrl || issue.assignee.avatar_url,
            });
          }
        }
      }
    }
    return Array.from(map.values());
  }, [issues, currentUser]);

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
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar min-w-0 py-0.5">
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

        {/* Assigned to Me Filter with "Who is Me" Picker */}
        <div className="relative inline-flex items-center rounded-full h-7 sm:h-8 shadow-xs shrink-0" ref={pickerRef}>
          <button
            type="button"
            onClick={() => toggleFilter('my')}
            className={`h-7 sm:h-8 inline-flex items-center gap-1 sm:gap-1.5 pl-2.5 sm:pl-3 pr-1.5 sm:pr-2 rounded-l-full text-xs font-medium transition-colors cursor-pointer ${
              isMy
                ? 'bg-[var(--jira-primary)] text-white font-semibold'
                : 'bg-[var(--jira-surface-elevated)] border-y border-l border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)]'
            }`}
            title={`Toggle filter for Assigned to Me (${currentUser})`}
          >
            <span>Assigned to Me</span>
            <span
              className={`text-2xs px-1.5 py-0.5 rounded-full font-bold truncate max-w-[80px] sm:max-w-[100px] leading-none inline-flex items-center ${
                isMy ? 'bg-white/20 text-white' : 'bg-[var(--jira-canvas)] text-[var(--jira-text-secondary)]'
              }`}
            >
              {currentUser.split(' ')[0]}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIsPickerOpen((prev) => !prev)}
            className={`h-7 sm:h-8 w-6 sm:w-7 inline-flex items-center justify-center rounded-r-full text-xs font-medium transition-colors cursor-pointer border-l ${
              isMy
                ? 'bg-[var(--jira-primary)] text-white border-white/25 hover:bg-[var(--jira-primary-hover)]'
                : 'bg-[var(--jira-surface-elevated)] border-y border-r border-l border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)]'
            }`}
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

      {/* Quick Search Input */}
      <div className="relative flex items-center shrink-0 w-28 xs:w-36 sm:w-48 md:w-64 h-7 sm:h-8">
        <Search className="w-3.5 h-3.5 absolute left-2 sm:left-2.5 text-[var(--jira-text-muted)] pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search key, summary, description..."
          aria-label="Search issues by key, summary, or description"
          className="w-full h-7 sm:h-8 text-xs pl-7 sm:pl-8 pr-2.5 sm:pr-3 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] placeholder-[var(--jira-text-muted)] focus:outline-none focus:border-[var(--jira-primary)]"
        />
      </div>
    </section>
  );
}
