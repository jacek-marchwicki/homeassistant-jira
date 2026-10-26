import React, { useState, useEffect } from 'react';
import { ArrowLeft, X, Save, AlertCircle, ExternalLink, Calendar, Clock, Copy } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue, JiraIssueType, JiraPriority } from '../types/jira.ts';
import { getAvailableStatuses, getJiraIssueUrl } from '../utils/boardUtils.ts';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';
import { AssigneeSelect } from './AssigneeSelect.tsx';
import { IssueTypeSelect } from './IssueTypeSelect.tsx';
import { PrioritySelect } from './PrioritySelect.tsx';
import { StatusSelect } from './StatusSelect.tsx';
import { CommentsSection } from './CommentsSection.tsx';
import { RichTextEditor } from './RichTextEditor.tsx';
import { DatePicker } from './DatePicker.tsx';
import { LinkedIssuesSection } from './LinkedIssuesSection.tsx';
import { useTaskBackground, getCardBackgroundStyle } from '../utils/useTaskBackground.ts';
import { useMobileViewport } from '../utils/useMobileViewport.ts';

function formatDateTime(isoString?: string | null): string | null {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

interface EditIssueModalProps {
  issue: JiraIssue | null;
  isOpen: boolean;
  onClose: () => void;
}

export function EditIssueModal({ issue, isOpen, onClose }: EditIssueModalProps) {
  const {
    issues,
    columns,
    jiraUrl,
    updateIssueOptimistic,
    openCreateModal,
    setEditingIssue,
    openIssueByKey,
  } = useBoardStore();

  const { backgroundUrl, hasBackground } = useTaskBackground(issue?.key);
  const modalBannerStyle = getCardBackgroundStyle(backgroundUrl);

  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [issueType, setIssueType] = useState<JiraIssueType>('task');
  const [priority, setPriority] = useState<JiraPriority>('medium');
  const [statusName, setStatusName] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [assigneeAccountId, setAssigneeAccountId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [recreateAfter, setRecreateAfter] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const { isMobile, viewportHeight, viewportOffsetTop } = useMobileViewport(isOpen);

  const dialogStyle = React.useMemo(() => {
    if (!isMobile || !viewportHeight) return undefined;
    return {
      height: `${viewportHeight}px`,
      maxHeight: `${viewportHeight}px`,
      top: viewportOffsetTop !== undefined && viewportOffsetTop > 0 ? `${viewportOffsetTop}px` : undefined,
    };
  }, [isMobile, viewportHeight, viewportOffsetTop]);

  const handleFormFocus = (e: React.FocusEvent) => {
    if (!isMobile) return;
    const target = e.target as HTMLElement;
    setTimeout(() => {
      target.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }, 120);
  };

  const statusOptions = getAvailableStatuses(columns);
  const issueUrl = issue ? getJiraIssueUrl(issue, jiraUrl) : '#';

  const createdDate = issue?.created_at ?? issue?.createdAt;
  const updatedDate = issue?.updated_at ?? issue?.updatedAt;
  const createdFormatted = formatDateTime(createdDate);
  const updatedFormatted = formatDateTime(updatedDate);

  useEffect(() => {
    if (issue) {
      setSummary(issue.summary || '');
      setDescription(issue.description || '');
      setIssueType(issue.issue_type || issue.issueType || 'task');
      setPriority(issue.priority || 'medium');
      setStatusName(issue.status?.name || '');
      setAssigneeName(
        issue.assignee?.displayName || issue.assignee?.display_name || ''
      );
      setAssigneeAccountId(issue.assignee?.accountId || '');
      setDueDate(issue.due_date ?? issue.dueDate ?? '');
      setStartDate(issue.start_date ?? issue.startDate ?? '');
      setRecreateAfter(issue.recreate_after ?? issue.recreateAfter ?? '');
      setValidationError(null);
    }
  }, [issue]);

  // Handle ESC key to dismiss modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !issue) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) {
      setValidationError('Summary is required.');
      return;
    }

    const chosenStatus = statusOptions.find(
      (s) => s.name.toLowerCase() === statusName.toLowerCase()
    );

    updateIssueOptimistic(issue.key, {
      summary: summary.trim(),
      description: description.trim() || null,
      issue_type: issueType,
      priority,
      status_id: chosenStatus?.id,
      status_name: statusName || issue.status.name,
      status_category: chosenStatus?.category || issue.status.category,
      assignee_name: assigneeName,
      assignee_account_id: assigneeAccountId.trim() ? assigneeAccountId.trim() : undefined,
      story_points: issue.story_points ?? issue.storyPoints,
      due_date: dueDate.trim() || null,
      start_date: startDate.trim() || null,
      recreate_after: recreateAfter.trim() || null,
    });

    onClose();
  };

  const handleClone = () => {
    openCreateModal({
      summary: summary.trim(),
      description: description.trim() || undefined,
      issue_type: issueType,
      priority,
      status_name: statusName || issue.status?.name || 'To Do',
      status_id: issue.status?.id,
      status_category: issue.status?.category,
      assignee_name: assigneeName.trim() ? assigneeName.trim() : undefined,
      assignee_account_id: assigneeAccountId.trim() ? assigneeAccountId.trim() : undefined,
      due_date: dueDate.trim() || null,
      start_date: startDate.trim() || null,
      recreate_after: recreateAfter.trim() || null,
    });
  };

  const handleSelectLinkedIssue = (linkedKey: string) => {
    const found = issues.find((i) => i.key === linkedKey);
    if (found) {
      setEditingIssue(found);
    } else {
      openIssueByKey(linkedKey);
    }
  };

  const isDirty = Boolean(
    issue && (
      summary !== (issue.summary || '') ||
      description !== (issue.description || '') ||
      issueType !== (issue.issue_type || issue.issueType || 'task') ||
      priority !== (issue.priority || 'medium') ||
      statusName !== (issue.status?.name || '') ||
      assigneeName !== (issue.assignee?.displayName || issue.assignee?.display_name || '') ||
      assigneeAccountId !== (issue.assignee?.accountId || '') ||
      dueDate !== (issue.due_date ?? issue.dueDate ?? '') ||
      startDate !== (issue.start_date ?? issue.startDate ?? '') ||
      recreateAfter !== (issue.recreate_after ?? issue.recreateAfter ?? '')
    )
  );

  return (
    <div
      className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit Issue ${issue.key}`}
    >
      <div
        style={dialogStyle}
        className="w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-lg bg-[var(--jira-surface)] border-0 sm:border border-[var(--jira-border)] rounded-none sm:rounded-xl shadow-none sm:shadow-2xl relative flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header / Banner */}
        <div
          data-testid="edit-issue-modal-header"
          style={modalBannerStyle}
          className={`shrink-0 sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 pb-4 sm:pb-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] sm:pt-6 border-b border-[var(--jira-border)] bg-[var(--jira-surface)] transition-all ${
            hasBackground ? 'shadow-inner' : ''
          }`}
        >
          {/* Far-left: Close (back arrow) / Cancel (X) button + Title */}
          <div className="flex items-center gap-2 min-w-0">
            {isDirty ? (
              <button
                key="cancel-changes-button"
                type="button"
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-500/30 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer shrink-0"
                aria-label="Cancel changes"
                title="Cancel changes"
              >
                <X className="w-5 h-5" />
              </button>
            ) : (
              <button
                key="close-dialog-button"
                type="button"
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer shrink-0"
                aria-label="Close edit dialog"
                title="Close"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <IssueTypeIcon type={issueType} className="w-5 h-5 shrink-0" />
            <h2 id="edit-issue-title" className={`text-lg font-bold text-[var(--jira-text-primary)] flex items-center gap-2 min-w-0 ${
              hasBackground ? 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]' : ''
            }`}>
              <span className="truncate">Edit Issue</span>
              <a
                href={issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`font-mono text-[var(--jira-primary)] hover:underline inline-flex items-center gap-1 cursor-pointer shrink-0 ${
                  hasBackground ? 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]' : ''
                }`}
                title={`Open ${issue.key} in Jira`}
                aria-label={`Open ${issue.key} in Jira`}
              >
                <span>{issue.key}</span>
                <ExternalLink className="w-4 h-4 shrink-0" />
              </a>
            </h2>
          </div>

          {/* Far-right: Save button */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="submit"
              form="edit-issue-form"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--jira-primary)] hover:bg-[var(--jira-primary-hover)] text-white shadow-xs transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>
          </div>
        </div>

        {/* Modal Scrollable Content */}
        <div
          data-testid="edit-issue-modal-content"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] sm:pb-6"
        >
          {/* Validation Error Banner */}
          {validationError && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Edit Form */}
          <form id="edit-issue-form" onSubmit={handleSubmit} onFocusCapture={handleFormFocus} className="space-y-4">
          {/* Summary Input */}
          <div>
            <label
              htmlFor="edit-summary"
              className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
            >
              Summary <span className="text-red-400">*</span>
            </label>
            <input
              id="edit-summary"
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
              placeholder="What needs to be done?"
              autoFocus
            />
          </div>

          {/* Description Input */}
          <div>
            <label
              htmlFor="edit-description"
              className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
            >
              Description
            </label>
            <RichTextEditor
              key={issue.key}
              id="edit-description"
              value={description}
              onChange={setDescription}
              placeholder="Add more details about this issue, rich text formatting, or markdown..."
              rows={3}
              defaultTab="preview"
            />
          </div>

          {/* Assignee (directly after Description) */}
          <div>
            <label
              htmlFor="edit-assignee"
              className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
            >
              Assignee
            </label>
            <AssigneeSelect
              id="edit-assignee"
              value={assigneeName}
              onChange={setAssigneeName}
              onSelectOption={(opt) => {
                setAssigneeName(opt?.displayName || '');
                setAssigneeAccountId(opt?.accountId || '');
              }}
            />
          </div>

          {/* Status & Priority Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="edit-status"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Status
              </label>
              <StatusSelect
                id="edit-status"
                value={statusName}
                onChange={(name) => setStatusName(name)}
                options={statusOptions}
                size="md"
              />
            </div>

            <div>
              <label
                htmlFor="edit-priority"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Priority
              </label>
              <PrioritySelect
                id="edit-priority"
                value={priority}
                onChange={setPriority}
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="edit-start-date"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Start Date
              </label>
              <DatePicker
                id="edit-start-date"
                value={startDate}
                onChange={setStartDate}
              />
            </div>

            <div>
              <label
                htmlFor="edit-due-date"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Due Date
              </label>
              <DatePicker
                id="edit-due-date"
                value={dueDate}
                onChange={setDueDate}
              />
            </div>
          </div>

          {/* Recreate after */}
          <div>
            <label
              htmlFor="edit-recreate-after"
              className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
            >
              Recreate after
            </label>
            <input
              id="edit-recreate-after"
              type="text"
              value={recreateAfter}
              onChange={(e) => setRecreateAfter(e.target.value)}
              placeholder="e.g. 1d, 1w, 1y, 2y!"
              className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
            />
            <div className="mt-1 flex items-center flex-wrap gap-1.5 text-2xs text-[var(--jira-text-muted)]">
              <span>Hint: e.g.</span>
              {(['1d', '1w', '1y', '2y!'] as const).map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setRecreateAfter(val)}
                  className="px-1.5 py-0.5 rounded bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-primary)] hover:border-[var(--jira-primary)]/50 transition-colors font-mono cursor-pointer"
                  title={`Set recreate after to ${val}`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          {/* Issue Type (last field) */}
          <div>
            <label
              htmlFor="edit-type"
              className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
            >
              Issue Type
            </label>
            <IssueTypeSelect
              id="edit-type"
              value={issueType}
              onChange={setIssueType}
            />
          </div>

          {/* Secondary Actions: Clone task */}
          <div className="pt-2 flex items-center justify-start">
            <button
              type="button"
              onClick={handleClone}
              data-testid="clone-issue-button"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-[var(--jira-canvas)] hover:bg-[var(--jira-surface-hover)] text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] border border-[var(--jira-border)] transition-colors cursor-pointer min-h-[44px]"
              title="Clone this task"
              aria-label="Clone this task"
            >
              <Copy className="w-4 h-4 text-[var(--jira-text-muted)]" />
              <span>Clone task</span>
            </button>
          </div>
        </form>

        {/* Divider below Save and Cancel with vertical spacing */}
        <div className="mt-6 pt-5 border-t border-[var(--jira-border)] space-y-4">
          {/* Linked Tasks Section (Cloned, Blocked, etc.) */}
          <LinkedIssuesSection
            issue={issue}
            onSelectIssue={handleSelectLinkedIssue}
          />

          {/* Issue Metadata Dates (Created & Updated) */}
          {(createdFormatted || updatedFormatted) && (
            <div
              className="flex flex-wrap items-center gap-4 py-2 px-3 rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-2xs text-[var(--jira-text-muted)]"
              data-testid="edit-issue-dates"
            >
              {createdFormatted && (
                <div className="flex items-center gap-1.5" title={`Created: ${createdDate}`}>
                  <Calendar className="w-3.5 h-3.5 text-[var(--jira-text-muted)] shrink-0" />
                  <span>
                    Created: <strong className="text-[var(--jira-text-secondary)] font-medium">{createdFormatted}</strong>
                  </span>
                </div>
              )}
              {updatedFormatted && (
                <div className="flex items-center gap-1.5" title={`Updated: ${updatedDate}`}>
                  <Clock className="w-3.5 h-3.5 text-[var(--jira-text-muted)] shrink-0" />
                  <span>
                    Updated: <strong className="text-[var(--jira-text-secondary)] font-medium">{updatedFormatted}</strong>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Discussion / Comments Section */}
          <CommentsSection issueKey={issue.key} hideBorderTop={true} />
        </div>
        </div>
      </div>
    </div>
  );
}
