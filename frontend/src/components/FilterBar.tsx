import { Search } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';

export function FilterBar() {
  const { issues, activeFilter, setActiveFilter, searchQuery, setSearchQuery } = useBoardStore();

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--jira-border)] bg-[var(--jira-canvas)]">
      <div className="flex items-center gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
            activeFilter === 'all'
              ? 'bg-[var(--jira-primary)] text-white shadow-sm font-semibold'
              : 'bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
        >
          All Issues ({issues.length})
        </button>
        <button
          onClick={() => setActiveFilter('my')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
            activeFilter === 'my'
              ? 'bg-[var(--jira-primary)] text-white shadow-sm font-semibold'
              : 'bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
        >
          Assigned to Me
        </button>
        <button
          onClick={() => setActiveFilter('blockers')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
            activeFilter === 'blockers'
              ? 'bg-[var(--jira-primary)] text-white shadow-sm font-semibold'
              : 'bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)]'
          }`}
        >
          Blockers & Critical
        </button>
      </div>

      {/* Quick Search Input */}
      <div className="relative flex items-center min-w-[200px] max-w-xs">
        <Search className="w-3.5 h-3.5 absolute left-2.5 text-[var(--jira-text-muted)] pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter issues..."
          className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] placeholder-[var(--jira-text-muted)] focus:outline-none focus:border-[var(--jira-primary)]"
        />
      </div>
    </section>
  );
}
