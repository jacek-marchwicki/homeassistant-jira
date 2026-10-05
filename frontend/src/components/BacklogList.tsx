import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { JiraIssue } from '../types/jira.ts';
import { BacklogIssueRow } from './BacklogIssueRow.tsx';

interface BacklogListProps {
  id: string;
  type: 'backlog' | 'board';
  issues: JiraIssue[];
  emptyMessage?: string;
  isHighlighted?: boolean;
}

export function BacklogList({
  id,
  type,
  issues,
  emptyMessage = 'No issues in this section',
  isHighlighted = false,
}: BacklogListProps) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      type: 'List',
      listId: id,
      targetType: type,
    },
  });

  const shouldHighlight = Boolean(isHighlighted || isOver);
  const issueKeys = issues.map((i) => i.key);

  return (
    <div
      ref={setNodeRef}
      data-testid={`backlog-list-${id}`}
      className={`flex flex-col gap-1.5 p-2 rounded-xl border transition-all duration-150 min-h-[80px] ${
        shouldHighlight
          ? 'border-[var(--jira-primary)] bg-[var(--jira-surface-hover)]/40 ring-2 ring-[var(--jira-primary)]/50'
          : 'border-[var(--jira-border-subtle)] bg-[var(--jira-canvas)]/50'
      }`}
    >
      <SortableContext items={issueKeys} strategy={verticalListSortingStrategy}>
        {issues.map((issue) => (
          <BacklogIssueRow key={issue.key} issue={issue} />
        ))}
      </SortableContext>

      {issues.length === 0 && (
        <div
          className={`flex items-center justify-center p-6 border border-dashed rounded-lg text-xs transition-colors ${
            shouldHighlight
              ? 'border-[var(--jira-primary)] bg-[var(--jira-primary)]/10 text-[var(--jira-primary)] font-semibold'
              : 'border-[var(--jira-border-subtle)] text-[var(--jira-text-muted)]'
          }`}
        >
          {shouldHighlight ? 'Release to drop issue here' : emptyMessage}
        </div>
      )}
    </div>
  );
}
