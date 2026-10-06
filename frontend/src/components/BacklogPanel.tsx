import { ChevronDown, ChevronUp, ExternalLink, ListTodo } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';
import { BacklogList } from './BacklogList.tsx';

interface BacklogPanelProps {
  issues: JiraIssue[];
  isHighlighted?: boolean;
}

export function BacklogPanel({ issues, isHighlighted = false }: BacklogPanelProps) {
  const { isBacklogExpandedOnBoard, toggleBacklogExpandedOnBoard, setCurrentView } =
    useBoardStore();

  return (
    <section
      data-testid="backlog-panel"
      className="mt-6 rounded-xl border border-[var(--jira-border)] bg-[var(--jira-surface)]/80 backdrop-blur shadow-sm overflow-hidden"
    >
      {/* Panel Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--jira-border-subtle)] bg-[var(--jira-surface-elevated)]/50">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[var(--jira-primary)]/15 text-[var(--jira-primary)]">
            <ListTodo className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-[var(--jira-text-primary)]">Backlog</h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--jira-canvas)] border border-[var(--jira-border-subtle)] text-[var(--jira-text-secondary)]">
                {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
              </span>
            </div>
            <p className="text-2xs text-[var(--jira-text-muted)]">
              Issues awaiting sprint planning or prioritization
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Switch to Dedicated Backlog View */}
          <button
            onClick={() => setCurrentView('backlog')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] border border-[var(--jira-border)] transition-colors min-h-[36px] cursor-pointer"
            title="Open Dedicated Full Backlog View"
            aria-label="Open Full Backlog View"
          >
            <span>Open Backlog View</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          {/* Toggle Expand / Collapse */}
          <button
            onClick={toggleBacklogExpandedOnBoard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--jira-primary)]/10 text-[var(--jira-primary)] hover:bg-[var(--jira-primary)]/20 border border-[var(--jira-primary)]/25 transition-colors min-h-[36px] cursor-pointer"
            aria-expanded={isBacklogExpandedOnBoard}
            aria-label={isBacklogExpandedOnBoard ? 'Collapse Backlog list' : 'Expand Backlog list'}
          >
            {isBacklogExpandedOnBoard ? (
              <>
                <span>Hide List</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <span>Show List ({issues.length})</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Expanded Backlog Issue List */}
      {isBacklogExpandedOnBoard && (
        <div className="p-3">
          <BacklogList
            id="panel-backlog-list"
            type="backlog"
            issues={issues}
            emptyMessage="No issues in the backlog. Use 'To Backlog' on any card to move it here."
            isHighlighted={isHighlighted}
          />
        </div>
      )}
    </section>
  );
}
