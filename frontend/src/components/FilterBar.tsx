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
  const pickerRef = useRef<HTMLDivElement>(null);

  const isAll = activeFilters.length === 0;
  const isMy = activeFilters.includes('my');
  const isActive = activeFilters.includes('active');

  // Aggregate available assignees from board issues
  const assignees = useMemo(() => {
    const map = new Map<string, { displayName: string; avatarUrl?: string }>();
    map.set('jacek marchwicki', { displayName: 'Jacek Marchwicki' });
    map.set('alex lead', { displayName: 'Alex Lead' });

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
  }, [issues]);

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
    <section className="relative z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--jira-border)] bg-[var(--jira-canvas)]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
            isAll
              ? 'bg-[var(--jira-primary)] text-white shadow-sm font-semibold'
              : 'bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
        >
          All Issues ({issues.length})
        </button>

        {/* Assigned to Me Filter with "Who is Me" Picker */}
        <div className="relative inline-flex items-center rounded-full" ref={pickerRef}>
          <button
            type="button"
            onClick={() => toggleFilter('my')}
            className={`flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-l-full text-xs font-medium transition-colors cursor-pointer ${
              isMy
                ? 'bg-[var(--jira-primary)] text-white shadow-sm font-semibold'
                : 'bg-[var(--jira-surface-elevated)] border-y border-l border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
            }`}
            title={`Toggle filter for Assigned to Me (${currentUser})`}
          >
            <span>Assigned to Me</span>
            <span
              className={`text-2xs px-1.5 py-0.5 rounded-full font-bold truncate max-w-[100px] ${
                isMy ? 'bg-white/20 text-white' : 'bg-[var(--jira-canvas)] text-[var(--jira-text-secondary)]'
              }`}
            >
              {currentUser.split(' ')[0]}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIsPickerOpen((prev) => !prev)}
            className={`flex items-center px-2 py-1.5 rounded-r-full text-xs font-medium transition-colors cursor-pointer border-l ${
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
              className="absolute left-0 top-full mt-1.5 z-50 min-w-[220px] bg-[var(--jira-surface)] border border-[var(--jira-border)] rounded-xl shadow-2xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
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
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
            isActive
              ? 'bg-[var(--jira-primary)] text-white shadow-sm font-semibold'
              : 'bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
        >
          Active
        </button>
      </div>

      {/* Quick Search Input */}
      <div className="relative flex items-center min-w-[200px] max-w-xs">
        <Search className="w-3.5 h-3.5 absolute left-2.5 text-[var(--jira-text-muted)] pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search key, summary, description..."
          aria-label="Search issues by key, summary, or description"
          className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] placeholder-[var(--jira-text-muted)] focus:outline-none focus:border-[var(--jira-primary)]"
        />
      </div>
    </section>
  );
}
