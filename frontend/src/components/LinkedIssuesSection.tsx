import { ExternalLink, Link2 } from 'lucide-react';
import { clsx } from 'clsx';
import { JiraIssue, JiraIssueLink } from '../types/jira.ts';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';
import { PriorityIcon } from './PriorityIcon.tsx';
import { StatusIcon } from './StatusIcon.tsx';
import { useBoardStore } from '../store/boardStore.ts';
import { getJiraIssueUrl } from '../utils/boardUtils.ts';

interface LinkedIssuesSectionProps {
  issue: JiraIssue;
  onSelectIssue?: (issueKey: string) => void;
}

export function LinkedIssuesSection({ issue, onSelectIssue }: LinkedIssuesSectionProps) {
  const { jiraUrl } = useBoardStore();

  const links: JiraIssueLink[] =
    issue.issue_links || issue.issueLinks || [];

  if (!links || links.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2" data-testid="linked-issues-section">
      <div className="flex items-center justify-between text-xs font-semibold text-[var(--jira-text-secondary)]">
        <div className="flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-[var(--jira-primary)]" />
          <span>Linked tasks</span>
        </div>
        <span className="px-1.5 py-0.5 text-2xs font-medium rounded-full bg-[var(--jira-surface)] border border-[var(--jira-border)] text-[var(--jira-text-muted)]">
          {links.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {links.map((link) => {
          const linked = link.issue;
          const targetKey = linked.key;
          const targetSummary = linked.summary || 'Untitled issue';
          const targetStatus = linked.status;
          const targetCategory = targetStatus?.category || 'todo';
          const targetPriority = linked.priority;
          const targetType = linked.issue_type || linked.issueType || 'task';

          const externalUrl =
            linked.url ||
            (jiraUrl ? getJiraIssueUrl({ key: targetKey, url: linked.url } as JiraIssue, jiraUrl) : undefined);

          return (
            <div
              key={link.id || `${link.relationship}-${targetKey}`}
              role="button"
              tabIndex={0}
              data-testid={`linked-issue-${targetKey}`}
              onClick={() => onSelectIssue?.(targetKey)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectIssue?.(targetKey);
                }
              }}
              className="group flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 px-3 py-2 rounded-lg bg-[var(--jira-canvas)] hover:bg-[var(--jira-surface-hover)] border border-[var(--jira-border)] transition-colors cursor-pointer min-h-[44px] text-xs"
              aria-label={`Open linked task ${targetKey}: ${targetSummary}`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Relationship pill */}
                <span className="shrink-0 px-2 py-0.5 rounded text-2xs font-semibold tracking-wide uppercase bg-[var(--jira-surface)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)]">
                  {link.relationship}
                </span>

                {/* Issue Type */}
                <IssueTypeIcon type={targetType} className="w-3.5 h-3.5 shrink-0" />

                {/* Issue Key */}
                <span className="font-mono text-xs font-semibold text-[var(--jira-primary)] shrink-0 group-hover:underline">
                  {targetKey}
                </span>

                {/* Issue Summary */}
                <span className="text-xs text-[var(--jira-text-primary)] truncate" title={targetSummary}>
                  {targetSummary}
                </span>
              </div>

              {/* Status, Priority & External Link */}
              <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
                {targetPriority && (
                  <PriorityIcon priority={targetPriority} className="w-3.5 h-3.5" />
                )}

                {targetStatus && (
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium border shrink-0',
                      targetCategory === 'done'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : targetCategory === 'inprogress'
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        : targetCategory === 'inreview'
                        ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                        : targetCategory === 'blocked'
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        : 'bg-[var(--jira-surface)] text-[var(--jira-text-secondary)] border-[var(--jira-border)]'
                    )}
                  >
                    <StatusIcon
                      category={targetCategory}
                      statusName={targetStatus.name}
                      className="w-3 h-3 shrink-0"
                    />
                    <span>{targetStatus.name}</span>
                  </span>
                )}

                {externalUrl && (
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 rounded hover:bg-[var(--jira-surface)] text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] transition-colors min-w-[28px] min-h-[28px] inline-flex items-center justify-center"
                    title={`Open ${targetKey} in Jira`}
                    aria-label={`Open ${targetKey} in Jira`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
