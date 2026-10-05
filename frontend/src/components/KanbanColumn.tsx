import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { JiraIssue, JiraStatusCategory } from '../types/jira.ts';
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
          {issues.map((issue) => (
            <IssueCard key={issue.key} issue={issue} />
          ))}
        </SortableContext>
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
      </div>
    </div>
  );
}
