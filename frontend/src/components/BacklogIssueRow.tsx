import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpRight,
  Calendar,
  GripVertical,
  Inbox,
  Pencil,
} from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue, JiraStatusCategory } from '../types/jira.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';
import { PriorityIcon } from './PriorityIcon.tsx';
import { StatusSelect } from './StatusSelect.tsx';
import {
  getAvailableStatuses,
  getCategoryColorVar,
  getJiraIssueUrl,
  isBacklogIssue,
  isIssueExpedited,
  isIssueOverdue,
} from '../utils/boardUtils.ts';

interface BacklogIssueRowProps {
  issue: JiraIssue;
  isDragOverlay?: boolean;
}

export function BacklogIssueRow({ issue, isDragOverlay = false }: BacklogIssueRowProps) {
  const { columns, jiraUrl, transitionIssueOptimistic, moveToBoard, moveToBacklog, setEditingIssue } =
    useBoardStore();
  const isBacklog = isBacklogIssue(issue, columns);
  const statusColorVar = getCategoryColorVar(issue.status.category);
  const statusOptions = getAvailableStatuses(columns);
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

  const handleQuickMove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBacklog) {
      moveToBoard(issue.key);
    } else {
      moveToBacklog(issue.key);
    }
  };

  const handleStatusSelect = (statusName: string, category?: JiraStatusCategory) => {
    const chosenStatus = statusOptions.find(
      (s) => s.name.toLowerCase() === statusName.toLowerCase()
    );
    const cat = category || chosenStatus?.category || 'todo';
    transitionIssueOptimistic(issue.key, cat, statusName);
  };

  const isDone = issue.status.category === 'done';

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      data-testid={`backlog-row-${issue.key}`}
      className={`group relative flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-all text-xs ${
        issue._optimisticState === 'pending'
          ? 'border-[var(--jira-primary)] ring-2 ring-[var(--jira-primary)]/30 animate-pulse bg-[var(--jira-surface-hover)]/40'
          : 'border-[var(--jira-border)] bg-[var(--jira-surface)] hover:bg-[var(--jira-surface-hover)]/50 hover:border-[var(--jira-primary)]/40'
      } ${isDragOverlay ? 'shadow-xl ring-2 ring-[var(--jira-primary)] bg-[var(--jira-surface-elevated)] cursor-grabbing' : ''}`}
    >
      {/* Left side: Drag handle, Type icon, Key, Summary */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {/* Drag Handle */}
        <div
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 -ml-1 text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] transition-colors touch-none"
          title="Drag to reorder or move between Backlog and Board"
          aria-label={`Drag handle for ${issue.key}`}
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Issue Type Icon */}
        <IssueTypeIcon type={issue.issue_type || issue.issueType} className="w-4 h-4 shrink-0" />

        {/* Issue Key */}
        <a
          href={issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono font-bold text-xs text-[var(--jira-text-secondary)] hover:text-[var(--jira-primary)] hover:underline shrink-0 cursor-pointer"
          title={`Open ${issue.key} in Jira`}
          aria-label={`Open ${issue.key} in Jira`}
        >
          {issue.key}
        </a>

        {/* Issue Summary */}
        <span
          onClick={(e) => {
            e.stopPropagation();
            setEditingIssue(issue);
          }}
          title={`Click to edit ${issue.key}`}
          className={`truncate font-medium text-xs cursor-pointer hover:underline ${
            isDone
              ? 'line-through text-[var(--jira-text-secondary)] opacity-75'
              : 'text-[var(--jira-text-primary)]'
          }`}
        >
          {issue.summary}
        </span>
      </div>

      {/* Right side: Priority, Story Points, Status Pill, Assignee, Actions */}
      <div
        className="flex items-center gap-2.5 shrink-0 self-end sm:self-center ml-auto"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Priority Icon */}
        <div className="flex items-center" title={`Priority: ${issue.priority}`}>
          <PriorityIcon priority={issue.priority} />
        </div>

        {/* Due Date */}
        {(issue.due_date || issue.dueDate) && (() => {
          const dueDateStr = issue.due_date ?? issue.dueDate;
          const isOverdue = isIssueOverdue(issue);
          const isExpedited = isIssueExpedited(issue);
          return (
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
          );
        })()}



        {/* Jira-style Status Lozenge */}
        <span
          className="px-2 py-0.5 rounded text-2xs font-bold uppercase tracking-wider border shrink-0"
          style={{
            borderColor: `color-mix(in srgb, ${statusColorVar} 40%, transparent)`,
            backgroundColor: `color-mix(in srgb, ${statusColorVar} 15%, transparent)`,
            color: statusColorVar,
          }}
        >
          {issue.status.name}
        </span>

        {/* Assignee Avatar */}
        <AssigneeAvatar assignee={issue.assignee} />

        {/* Edit Issue Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setEditingIssue(issue);
          }}
          className="p-1 rounded text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
          title={`Edit ${issue.key}`}
          aria-label={`Edit ${issue.key}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>

        {/* Quick Move Action: One-Click Move to Board / Move to Backlog */}
        <button
          onClick={handleQuickMove}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-2xs font-semibold transition-colors min-h-[36px] cursor-pointer ${
            isBacklog
              ? 'text-[var(--jira-primary)] bg-[var(--jira-primary)]/10 hover:bg-[var(--jira-primary)]/20 border border-[var(--jira-primary)]/25'
              : 'text-[var(--jira-text-secondary)] bg-[var(--jira-canvas)] hover:bg-[var(--jira-surface-hover)] border border-[var(--jira-border)]'
          }`}
          title={isBacklog ? 'Move to Board (To Do)' : 'Move to Backlog'}
          aria-label={isBacklog ? `Move ${issue.key} to Board` : `Move ${issue.key} to Backlog`}
        >
          {isBacklog ? (
            <>
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>To Board</span>
            </>
          ) : (
            <>
              <Inbox className="w-3.5 h-3.5" />
              <span>To Backlog</span>
            </>
          )}
        </button>

        {/* Status Dropdown Selector */}
        <StatusSelect
          id={`backlog-status-select-${issue.key}${isDragOverlay ? '-overlay' : ''}`}
          value={issue.status.name}
          onChange={handleStatusSelect}
          options={statusOptions}
          size="sm"
          ariaLabel={`Change status for ${issue.key}`}
          title="Change Status"
        />
      </div>
    </article>
  );
}
