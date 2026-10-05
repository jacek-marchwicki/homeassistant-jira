import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AlertCircle, CircleDot, Zap } from 'lucide-react';
import { JiraIssue, JiraStatusCategory } from '../types/jira.ts';
import { splitReadyIssues } from '../utils/boardUtils.ts';
import { IssueCard } from './IssueCard.tsx';

interface KanbanColumnProps {
  id: string;
  category: JiraStatusCategory;
  title: string;
  colorVar: string;
  issues: JiraIssue[];
  isHighlighted?: boolean;
}

export function KanbanColumn({
  id,
  category,
  title,
  colorVar,
  issues,
  isHighlighted = false,
}: KanbanColumnProps) {
  const { setNodeRef, isOver: isDroppableOver } = useDroppable({
    id,
    data: {
      type: 'Column',
      columnId: id,
      category,
      statusName: title,
    },
  });

  const isOver = Boolean(isHighlighted || isDroppableOver);
  const issueIds = issues.map((i) => i.key);
  const isReadyColumn = title.trim().toLowerCase() === 'ready' || id === 'col-ready';

  const { overdue, expedited, other } = isReadyColumn
    ? splitReadyIssues(issues)
    : { overdue: [], expedited: [], other: [] };

  const hasOverdue = overdue.length > 0;
  const hasExpedited = expedited.length > 0;
  const hasSpecialSections = isReadyColumn && (hasOverdue || hasExpedited);

  return (
    <div
      ref={setNodeRef}
      data-testid={`column-${id}`}
      data-is-over={isOver ? 'true' : 'false'}
      className={`flex flex-col rounded-xl border p-3 min-h-[400px] flex-1 min-w-[280px] transition-all duration-150 ${
        isOver
          ? 'border-[var(--jira-primary)] bg-[var(--jira-surface-hover)]/30 ring-2 ring-[var(--jira-primary)] shadow-lg shadow-[var(--jira-primary)]/10'
          : 'border-[var(--jira-border)] bg-[var(--jira-surface)]'
      }`}
    >
      {/* Column Header */}
      <div
        className={`flex items-center justify-between pb-2 mb-3 border-b transition-colors ${
          isOver ? 'border-[var(--jira-primary)]/40' : 'border-[var(--jira-border-subtle)]'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorVar }} />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--jira-text-primary)]">
            {title}
          </h2>
          {isOver && (
            <span
              data-testid={`drop-badge-${id}`}
              className="text-2xs font-bold text-[var(--jira-primary)] bg-[var(--jira-primary)]/15 border border-[var(--jira-primary)]/30 px-2 py-0.5 rounded-full animate-pulse"
            >
              Drop target
            </span>
          )}
        </div>
        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--jira-canvas)] border border-[var(--jira-border-subtle)] text-[var(--jira-text-secondary)]">
          {issues.length}
        </span>
      </div>

      {/* Column Issues List */}
      <div className="flex flex-col gap-2.5 flex-1">
        <SortableContext items={issueIds} strategy={verticalListSortingStrategy}>
          {hasSpecialSections ? (
            <div className="flex flex-col gap-4 flex-1">
              {/* 1. Overdue Sub-section (only if not empty) */}
              {hasOverdue && (
                <div data-testid="ready-section-overdue" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/25">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-400">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Overdue</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded-full text-2xs font-bold bg-rose-500/20 text-rose-300">
                      {overdue.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {overdue.map((issue) => (
                      <IssueCard key={issue.key} issue={issue} />
                    ))}
                  </div>
                </div>
              )}

              {/* 2. Expedited Sub-section (only if not empty) */}
              {hasExpedited && (
                <div data-testid="ready-section-expedited" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                      <Zap className="w-3.5 h-3.5" />
                      <span>Expedited</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded-full text-2xs font-bold bg-amber-500/20 text-amber-300">
                      {expedited.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {expedited.map((issue) => (
                      <IssueCard key={issue.key} issue={issue} />
                    ))}
                  </div>
                </div>
              )}

              {/* 3. Other Sub-section (displayed with header when special sections exist) */}
              {other.length > 0 && (
                <div data-testid="ready-section-other" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border-subtle)]">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--jira-text-secondary)]">
                      <CircleDot className="w-3.5 h-3.5" />
                      <span>Other</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded-full text-2xs font-bold bg-[var(--jira-canvas)] text-[var(--jira-text-secondary)] border border-[var(--jira-border-subtle)]">
                      {other.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {other.map((issue) => (
                      <IssueCard key={issue.key} issue={issue} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {issues.map((issue) => (
                <IssueCard key={issue.key} issue={issue} />
              ))}
              {issues.length === 0 && (
                <div
                  className={`flex-1 flex items-center justify-center p-4 border border-dashed rounded-lg text-xs transition-colors ${
                    isOver
                      ? 'border-[var(--jira-primary)] bg-[var(--jira-primary)]/10 text-[var(--jira-primary)] font-semibold'
                      : 'border-[var(--jira-border-subtle)] text-[var(--jira-text-secondary)]'
                  }`}
                >
                  {isOver ? 'Release to drop issue here' : 'No issues'}
                </div>
              )}
            </>
          )}
        </SortableContext>
      </div>
    </div>
  );
}
