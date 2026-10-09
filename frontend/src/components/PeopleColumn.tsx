import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { AlertCircle, CheckCircle2, CircleDot, Home, PlayCircle, Zap } from 'lucide-react';
import { JiraIssue } from '../types/jira.ts';
import { AssigneePerson, splitReadyAndDoneIssues } from '../utils/boardUtils.ts';
import { useBoardStore } from '../store/boardStore.ts';
import { AssigneeAvatar } from './AssigneeAvatar.tsx';
import { IssueCard } from './IssueCard.tsx';

interface PeopleColumnProps {
  person: AssigneePerson;
  issues: JiraIssue[];
  now?: Date;
  isHighlighted?: boolean;
}

export function PeopleColumn({
  person,
  issues,
  now = new Date(),
  isHighlighted = false,
}: PeopleColumnProps) {
  const columns = useBoardStore((s) => s.columns);
  const columnId = person.accountId || person.displayName;

  const { setNodeRef, isOver: isDroppableOver } = useDroppable({
    id: `people-column-${columnId}`,
    data: {
      type: 'PeopleColumn',
      columnId,
      personName: person.displayName,
      accountId: person.accountId,
    },
  });

  const isOver = Boolean(isHighlighted || isDroppableOver);
  const issueSortableIds = issues.map((i) => `${columnId}:${i.key}`);

  const { overdue, expedited, inProgress, homeAsUsual, other, done } = splitReadyAndDoneIssues(
    issues,
    now,
    columns,
    1 // Done within 24h (1 day)
  );

  const hasOverdue = overdue.length > 0;
  const hasExpedited = expedited.length > 0;
  const hasInProgress = inProgress.length > 0;
  const hasHomeAsUsual = homeAsUsual.length > 0;
  const hasDone = done.length > 0;
  const hasSpecialSections =
    hasOverdue || hasExpedited || hasInProgress || hasHomeAsUsual || hasDone;

  return (
    <div
      ref={setNodeRef}
      data-testid={`people-column-${columnId}`}
      data-is-over={isOver ? 'true' : 'false'}
      className={`flex flex-col rounded-xl border p-3 min-h-[400px] flex-1 min-w-[280px] transition-all duration-150 ${
        isOver
          ? 'border-[var(--jira-primary)] bg-[var(--jira-surface-hover)]/30 ring-2 ring-[var(--jira-primary)] shadow-lg shadow-[var(--jira-primary)]/10'
          : 'border-[var(--jira-border)] bg-[var(--jira-surface)]'
      }`}
    >
      {/* Column Header: Person Avatar & Name + Count */}
      <div
        className={`flex items-center justify-between pb-2 mb-3 border-b min-h-[38px] transition-colors ${
          isOver ? 'border-[var(--jira-primary)]/40' : 'border-[var(--jira-border-subtle)]'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <AssigneeAvatar
            assignee={{ displayName: person.displayName, avatarUrl: person.avatarUrl }}
            sizeClassName="w-6 h-6 shrink-0"
          />
          <h2 className="text-sm font-semibold tracking-tight text-[var(--jira-text-primary)] truncate">
            {person.displayName}
          </h2>
          {isOver && (
            <span
              data-testid={`drop-badge-${columnId}`}
              className="text-2xs font-bold text-[var(--jira-primary)] bg-[var(--jira-primary)]/15 border border-[var(--jira-primary)]/30 px-2 py-0.5 rounded-full animate-pulse whitespace-nowrap"
            >
              Assign here
            </span>
          )}
        </div>

        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--jira-canvas)] border border-[var(--jira-border-subtle)] text-[var(--jira-text-secondary)] shrink-0">
          {issues.length}
        </span>
      </div>

      {/* Issues List with Ready-style Sections */}
      <div className="flex flex-col gap-2.5 flex-1">
        <SortableContext items={issueSortableIds} strategy={verticalListSortingStrategy}>
          {hasSpecialSections ? (
            <div className="flex flex-col gap-4 flex-1">
              {/* 1. Overdue Sub-section */}
              {hasOverdue && (
                <div data-testid="people-section-overdue" className="flex flex-col gap-2">
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
                      <IssueCard
                        key={issue.key}
                        issue={issue}
                        sortableId={`${columnId}:${issue.key}`}
                        sourceColumnId={columnId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 2. Expedited Sub-section */}
              {hasExpedited && (
                <div data-testid="people-section-expedited" className="flex flex-col gap-2">
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
                      <IssueCard
                        key={issue.key}
                        issue={issue}
                        sortableId={`${columnId}:${issue.key}`}
                        sourceColumnId={columnId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 3. In Progress Sub-section */}
              {hasInProgress && (
                <div data-testid="people-section-inprogress" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/25">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400">
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>In Progress</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded-full text-2xs font-bold bg-blue-500/20 text-blue-300">
                      {inProgress.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {inProgress.map((issue) => (
                      <IssueCard
                        key={issue.key}
                        issue={issue}
                        sortableId={`${columnId}:${issue.key}`}
                        sourceColumnId={columnId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Home as Usual Sub-section */}
              {hasHomeAsUsual && (
                <div data-testid="people-section-home-as-usual" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                      <Home className="w-3.5 h-3.5" />
                      <span>Home as Usual</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded-full text-2xs font-bold bg-emerald-500/20 text-emerald-300">
                      {homeAsUsual.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {homeAsUsual.map((issue) => (
                      <IssueCard
                        key={issue.key}
                        issue={issue}
                        sortableId={`${columnId}:${issue.key}`}
                        sourceColumnId={columnId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 5. Other Sub-section */}
              {other.length > 0 && (
                <div data-testid="people-section-other" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[var(--jira-surface-elevated)] border border-[var(--jira-border-subtle)]">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--jira-text-secondary)]">
                      <CircleDot className="w-3.5 h-3.5" />
                      <span>To Do</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded-full text-2xs font-bold bg-[var(--jira-canvas)] text-[var(--jira-text-secondary)] border border-[var(--jira-border-subtle)]">
                      {other.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {other.map((issue) => (
                      <IssueCard
                        key={issue.key}
                        issue={issue}
                        sortableId={`${columnId}:${issue.key}`}
                        sourceColumnId={columnId}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 6. Done Sub-section (completed within 24h, crossed out) */}
              {hasDone && (
                <div data-testid="people-section-done" className="flex flex-col gap-2">
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Done (last 24h)</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded-full text-2xs font-bold bg-emerald-500/20 text-emerald-300">
                      {done.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {done.map((issue) => (
                      <IssueCard
                        key={issue.key}
                        issue={issue}
                        sortableId={`${columnId}:${issue.key}`}
                        sourceColumnId={columnId}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {issues.map((issue) => (
                <IssueCard
                  key={issue.key}
                  issue={issue}
                  sortableId={`${columnId}:${issue.key}`}
                  sourceColumnId={columnId}
                />
              ))}
              {issues.length === 0 && (
                <div
                  className={`flex-1 flex items-center justify-center p-4 border border-dashed rounded-lg text-xs transition-colors ${
                    isOver
                      ? 'border-[var(--jira-primary)] bg-[var(--jira-primary)]/10 text-[var(--jira-primary)] font-semibold'
                      : 'border-[var(--jira-border-subtle)] text-[var(--jira-text-secondary)]'
                  }`}
                >
                  {isOver ? 'Release to assign issue here' : 'No issues'}
                </div>
              )}
            </>
          )}
        </SortableContext>
      </div>
    </div>
  );
}
