import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Calendar,
  CheckCircle2,
  RotateCw,
} from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue } from '../types/jira.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';
import { PriorityIcon } from './PriorityIcon.tsx';
import {
  getColumnForIssue,
  isAssignedToChild,
  isIssueExpedited,
  isIssueOverdue,
} from '../utils/boardUtils.ts';
import { triggerDoneCelebration } from '../utils/celebrationEffects.ts';
import { useTaskBackground, getCardBackgroundStyle } from '../utils/useTaskBackground.ts';

interface IssueCardProps {
  issue: JiraIssue;
  isDragOverlay?: boolean;
  sortableId?: string;
  sourceColumnId?: string;
}

export function IssueCard({
  issue,
  isDragOverlay = false,
  sortableId,
  sourceColumnId,
}: IssueCardProps) {
  const { columns, markIssueDoneWithUndo, setEditingIssue, accountTypes } = useBoardStore();
  const currentColumn = getColumnForIssue(issue, columns);
  const isDone = (currentColumn?.category || issue.status.category) === 'done';
  const dueDateStr = issue.due_date ?? issue.dueDate;
  const isOverdue = isIssueOverdue(issue);
  const isExpedited = isIssueExpedited(issue);
  const itemId = sortableId || issue.key;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: itemId,
    disabled: isDragOverlay,
    data: {
      type: 'Issue',
      issue,
      sortableId: itemId,
      sourceColumnId,
    },
  });

  const { backgroundUrl, hasBackground } = useTaskBackground(issue.key);
  const cardBackgroundStyle = getCardBackgroundStyle(backgroundUrl);

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    ...cardBackgroundStyle,
  };

  const handleCardClick = () => {
    if (isDragging) return;
    setEditingIssue(issue);
  };

  const handleQuickDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isAssignedToChild(issue, accountTypes)) {
      triggerDoneCelebration();
    }
    const doneCol = columns.find((c) => c.category === 'done');
    markIssueDoneWithUndo(issue.key, 'done', doneCol?.name);
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleCardClick}
      data-testid={`issue-card-${issue.key}`}
      data-sortable-id={itemId}
      className={`group relative p-3 rounded-lg bg-[var(--jira-surface-elevated)] border transition-all shadow-sm cursor-pointer select-none touch-manipulation ${
        issue._optimisticState === 'pending'
          ? 'border-[var(--jira-primary)] ring-2 ring-[var(--jira-primary)]/30 animate-pulse'
          : 'border-[var(--jira-border)] hover:border-[var(--jira-primary)]/50'
      } ${isDragOverlay ? 'shadow-xl ring-2 ring-[var(--jira-primary)] cursor-grabbing' : ''}`}
    >
      <div className="flex items-center justify-between mb-1.5 pointer-events-auto">
        <div className="flex items-center gap-1.5 shrink-0">
          <IssueTypeIcon type={issue.issue_type || issue.issueType} className="w-3.5 h-3.5 shrink-0" />
          <span
            className={`text-xs font-bold whitespace-nowrap text-[var(--jira-text-secondary)] ${
              hasBackground ? 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]' : ''
            }`}
          >
            {issue.key}
          </span>
        </div>

        <div className="flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
          {/* Direct One-Tap Quick Action: Mark as Done */}
          {!isDone && (
            <button
              onClick={handleQuickDone}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-[var(--jira-action-done-text)] bg-[var(--jira-action-done-bg)] hover:bg-[var(--jira-action-done-hover)] border border-[var(--jira-action-done-border)] shadow-xs transition-all min-h-[38px] cursor-pointer touch-manipulation active:scale-95"
              title="Quick Action: Mark as Done"
              aria-label={`Mark ${issue.key} as Done`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Done</span>
            </button>
          )}
        </div>
      </div>

      <p
        title={`Click to edit ${issue.key}`}
        className={`text-sm font-medium mb-3 line-clamp-2 ${
          hasBackground ? 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]' : ''
        } ${
          isDone
            ? 'line-through text-[var(--jira-text-secondary)] opacity-75'
            : 'text-[var(--jira-text-primary)]'
        }`}
      >
        {issue.summary}
      </p>

      <div className="flex items-center justify-between text-xs text-[var(--jira-text-secondary)]">
        <div className="flex items-center gap-1.5">
          <PriorityIcon priority={issue.priority} />
          <span className="text-2xs font-bold uppercase text-[var(--jira-text-secondary)]">
            {issue.priority}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {dueDateStr && (
            <span
              className={`flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded border ${
                isOverdue
                  ? 'bg-rose-500/15 text-rose-400 border-rose-500/30 font-bold'
                  : isExpedited
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 font-bold'
                  : 'bg-[var(--jira-canvas)] text-[var(--jira-text-secondary)] border-[var(--jira-border-subtle)]'
              }`}
              title={`Due date: ${dueDateStr}${isOverdue ? ' (Overdue)' : isExpedited ? ' (Expedited)' : ''}`}
            >
              <Calendar className="w-3 h-3 shrink-0" />
              <span>{dueDateStr}</span>
            </span>
          )}

          {(issue.recreate_after ?? issue.recreateAfter) && (
            <span
              className="flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded border bg-[var(--jira-canvas)] text-[var(--jira-text-secondary)] border-[var(--jira-border-subtle)]"
              title={`Recreate after: ${issue.recreate_after ?? issue.recreateAfter}`}
            >
              <RotateCw className="w-3 h-3 shrink-0" />
              <span>{issue.recreate_after ?? issue.recreateAfter}</span>
            </span>
          )}

          {isDone && (issue.updated_at || issue.updatedAt) && (() => {
            const dateStr = issue.updated_at ?? issue.updatedAt;
            try {
              const d = new Date(dateStr!);
              const timeStr = !isNaN(d.getTime())
                ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : dateStr;
              return (
                <span
                  className="flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                  title={`Done: Updated at ${dateStr}`}
                >
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  <span>{timeStr}</span>
                </span>
              );
            } catch {
              return null;
            }
          })()}
          <AssigneeAvatar assignee={issue.assignee} />
        </div>
      </div>
    </article>
  );
}
