import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  ChevronUp,
  ChevronsUp,
} from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue, JiraStatusCategory } from '../types/jira.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';

interface IssueCardProps {
  issue: JiraIssue;
  isDragOverlay?: boolean;
}

export function IssueCard({ issue, isDragOverlay = false }: IssueCardProps) {
  const { transitionIssueOptimistic } = useBoardStore();

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

  const handleQuickDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    transitionIssueOptimistic(issue.key, 'done');
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    transitionIssueOptimistic(issue.key, e.target.value as JiraStatusCategory);
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
        <span className="text-xs font-bold text-[var(--jira-text-secondary)]">{issue.key}</span>

        <div className="flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
          {/* Direct One-Tap Quick Action: Mark as Done */}
          {issue.status.category !== 'done' && (
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

          {/* Direct Transition Selector (Move to any column without dragging) */}
          <div className="relative">
            <select
              value={issue.status.category}
              onChange={handleStatusChange}
              className="text-2xs bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] rounded px-1.5 py-1 outline-none cursor-pointer min-h-[32px]"
              title="Change Status"
              aria-label={`Change status for ${issue.key}`}
            >
              <option value="todo">To Do</option>
              <option value="inprogress">In Progress</option>
              <option value="inreview">In Review</option>
              <option value="done">Done</option>
            </select>
          </div>
        </div>
      </div>

      <p
        className={`text-sm font-medium mb-3 line-clamp-2 ${
          issue.status.category === 'done'
            ? 'line-through text-[var(--jira-text-secondary)] opacity-75'
            : 'text-[var(--jira-text-primary)]'
        }`}
      >
        {issue.summary}
      </p>

      <div className="flex items-center justify-between text-xs text-[var(--jira-text-secondary)]">
        <div className="flex items-center gap-1.5">
          {issue.priority === 'highest' && (
            <ChevronsUp className="w-4 h-4 text-[var(--jira-priority-highest)]" />
          )}
          {issue.priority === 'high' && (
            <ChevronUp className="w-4 h-4 text-[var(--jira-priority-high)]" />
          )}
          {issue.priority === 'medium' && (
            <ArrowRight className="w-4 h-4 text-[var(--jira-priority-medium)]" />
          )}
          {(issue.priority === 'low' || issue.priority === 'lowest') && (
            <ArrowDown className="w-4 h-4 text-[var(--jira-priority-low)]" />
          )}
          <span className="text-2xs font-bold uppercase text-[var(--jira-text-secondary)]">
            {issue.priority}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {(issue.story_points ?? issue.storyPoints) !== undefined && (
            <span className="px-1.5 py-0.5 rounded text-2xs font-semibold bg-[var(--jira-canvas)] border border-[var(--jira-border-subtle)] text-[var(--jira-text-secondary)]">
              {issue.story_points ?? issue.storyPoints} pts
            </span>
          )}
          <AssigneeAvatar assignee={issue.assignee} />
        </div>
      </div>
    </article>
  );
}
