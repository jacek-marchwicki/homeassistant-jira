import { Circle, Clock, Eye, CheckCircle2, AlertCircle, Inbox } from 'lucide-react';
import { JiraStatusCategory } from '../types/jira.ts';

export interface StatusIconProps {
  category?: JiraStatusCategory | string;
  statusName?: string;
  className?: string;
}

export function StatusIcon({ category, statusName, className }: StatusIconProps) {
  const normCat = (category || '').toLowerCase();
  const normName = (statusName || '').toLowerCase();

  if (normCat === 'done' || normName.includes('done') || normName.includes('complete') || normName.includes('closed')) {
    return (
      <span title="Status: Done" className="inline-flex items-center shrink-0">
        <CheckCircle2
          className={className || 'w-3.5 h-3.5 text-[var(--jira-status-done)] shrink-0'}
          aria-label="Status: Done"
        />
      </span>
    );
  }

  if (
    normCat === 'in_review' ||
    normCat === 'inreview' ||
    normName.includes('review') ||
    normName.includes('qa')
  ) {
    return (
      <span title="Status: In Review" className="inline-flex items-center shrink-0">
        <Eye
          className={className || 'w-3.5 h-3.5 text-[var(--jira-status-inreview)] shrink-0'}
          aria-label="Status: In Review"
        />
      </span>
    );
  }

  if (
    normCat === 'inprogress' ||
    normName.includes('progress') ||
    normName.includes('working') ||
    normName.includes('doing')
  ) {
    return (
      <span title="Status: In Progress" className="inline-flex items-center shrink-0">
        <Clock
          className={className || 'w-3.5 h-3.5 text-[var(--jira-status-inprogress)] shrink-0'}
          aria-label="Status: In Progress"
        />
      </span>
    );
  }

  if (normCat === 'blocked' || normName.includes('blocked') || normName.includes('halted')) {
    return (
      <span title="Status: Blocked" className="inline-flex items-center shrink-0">
        <AlertCircle
          className={className || 'w-3.5 h-3.5 text-[var(--jira-status-blocked)] shrink-0'}
          aria-label="Status: Blocked"
        />
      </span>
    );
  }

  if (normName.includes('backlog')) {
    return (
      <span title="Status: Backlog" className="inline-flex items-center shrink-0">
        <Inbox
          className={className || 'w-3.5 h-3.5 text-[var(--jira-status-todo)] shrink-0'}
          aria-label="Status: Backlog"
        />
      </span>
    );
  }

  return (
    <span title="Status: To Do" className="inline-flex items-center shrink-0">
      <Circle
        className={className || 'w-3.5 h-3.5 text-[var(--jira-status-todo)] shrink-0'}
        aria-label="Status: To Do"
      />
    </span>
  );
}
