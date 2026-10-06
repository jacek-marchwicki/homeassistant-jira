import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Calendar,
  CheckCircle2,
  Pencil,
  RotateCw,
} from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue, JiraStatusCategory } from '../types/jira.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';
import { PriorityIcon } from './PriorityIcon.tsx';
import { StatusSelect } from './StatusSelect.tsx';
import {
  getAvailableStatuses,
  getColumnForIssue,
  getJiraIssueUrl,
  isIssueExpedited,
  isIssueOverdue,
} from '../utils/boardUtils.ts';

interface IssueCardProps {
  issue: JiraIssue;
  isDragOverlay?: boolean;
}

export function IssueCard({ issue, isDragOverlay = false }: IssueCardProps) {
  const { columns, jiraUrl, transitionIssueOptimistic, setEditingIssue } = useBoardStore();
  const currentColumn = getColumnForIssue(issue, columns);
  const isDone = (currentColumn?.category || issue.status.category) === 'done';
  const dueDateStr = issue.due_date ?? issue.dueDate;
  const isOverdue = isIssueOverdue(issue);
  const isExpedited = isIssueExpedited(issue);
  const issueUrl = getJiraIssueUrl(issue, jiraUrl);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.key,
    disabled: isDragOverlay,
    data: {
      type: 'Issue',
      issue,
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const statusOptions = getAvailableStatuses(columns);

  const handleQuickDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    const doneCol = columns.find((c) => c.category === 'done');
    transitionIssueOptimistic(issue.key, 'done', doneCol?.name);
  };

  const handleStatusSelect = (statusName: string, category?: JiraStatusCategory) => {
    const chosenStatus = statusOptions.find(
      (c) => c.name.toLowerCase() === statusName.toLowerCase()
    );
    const cat = category || chosenStatus?.category || 'todo';
    transitionIssueOptimistic(issue.key, cat, statusName);
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative p-3 rounded-lg bg-[var(--jira-surface-elevated)] border transition-all shadow-sm cursor-grab active:cursor-grabbing ${
        issue._optimisticState === 'pending'
          ? 'border-[var(--jira-primary)] ring-2 ring-[var(--jira-primary)]/30 animate-pulse'
          : 'border-[var(--jira-border)] hover:border-[var(--jira-primary)]/50'
      } ${isDragOverlay ? 'shadow-xl ring-2 ring-[var(--jira-primary)] cursor-grabbing' : ''}`}
    >
      <div className="flex items-center justify-between mb-1.5 pointer-events-auto">
        <div className="flex items-center gap-1.5 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          <IssueTypeIcon type={issue.issue_type || issue.issueType} className="w-3.5 h-3.5 shrink-0" />
          <a
            href={issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-bold whitespace-nowrap text-[var(--jira-text-secondary)] hover:text-[var(--jira-primary)] hover:underline cursor-pointer"
            title={`Open ${issue.key} in Jira`}
            aria-label={`Open ${issue.key} in Jira`}
          >
            {issue.key}
          </a>
        </div>

        <div className="flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
          {/* Edit Issue Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditingIssue(issue);
            }}
            className="p-1 rounded text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center cursor-pointer"
            title={`Edit ${issue.key}`}
            aria-label={`Edit ${issue.key}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>

          {/* Direct One-Tap Quick Action: Mark as Done */}
          {!isDone && (
            <button
              onClick={handleQuickDone}
              className="flex items-center gap-1 px-2 py-1 rounded text-2xs font-semibold text-[var(--jira-action-done-text)] bg-[var(--jira-action-done-bg)] hover:bg-[var(--jira-action-done-hover)] transition-colors min-h-[32px] cursor-pointer"
              title="Quick Action: Mark as Done"
              aria-label={`Mark ${issue.key} as Done`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Done</span>
            </button>
          )}

          {/* Direct Transition Selector (Move to any column or Backlog without dragging) */}
          <StatusSelect
            value={currentColumn?.name || issue.status.name}
            onChange={handleStatusSelect}
            options={statusOptions}
            size="sm"
            ariaLabel={`Change status for ${issue.key}`}
            title="Change Status"
          />
        </div>
      </div>

      <p
        onClick={(e) => {
          e.stopPropagation();
          setEditingIssue(issue);
        }}
        title={`Click to edit ${issue.key}`}
        className={`text-sm font-medium mb-3 line-clamp-2 cursor-pointer hover:underline ${
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
          <AssigneeAvatar assignee={issue.assignee} />
        </div>
      </div>
    </article>
  );
}
