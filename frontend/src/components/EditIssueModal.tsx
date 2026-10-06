import React, { useState, useEffect } from 'react';
import { X, Save, AlertCircle, ExternalLink, Calendar, Clock } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue, JiraPriority } from '../types/jira.ts';
import { getAvailableStatuses, getJiraIssueUrl } from '../utils/boardUtils.ts';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';
import { AssigneeSelect } from './AssigneeSelect.tsx';
import { IssueTypeSelect } from './IssueTypeSelect.tsx';
import { PrioritySelect } from './PrioritySelect.tsx';
import { StatusSelect } from './StatusSelect.tsx';
import { CommentsSection } from './CommentsSection.tsx';
import { RichTextEditor } from './RichTextEditor.tsx';

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
  const { columns, jiraUrl, updateIssueOptimistic } = useBoardStore();

  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [issueType, setIssueType] = useState<'story' | 'bug' | 'task' | 'subtask'>('task');
  const [priority, setPriority] = useState<JiraPriority>('medium');
  const [statusName, setStatusName] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [storyPoints, setStoryPoints] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [recreateAfter, setRecreateAfter] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

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
      const points = issue.story_points ?? issue.storyPoints;
      setStoryPoints(points !== undefined && points !== null ? String(points) : '');
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
      status_name: statusName || issue.status.name,
      status_category: chosenStatus?.category || issue.status.category,
      assignee_name: assigneeName,
      story_points: storyPoints !== '' ? parseFloat(storyPoints) : undefined,
      due_date: dueDate.trim() || null,
      start_date: startDate.trim() || null,
      recreate_after: recreateAfter.trim() || null,
    });

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-issue-title"
    >
      <div
        className="w-full max-w-lg bg-[var(--jira-surface)] border border-[var(--jira-border)] rounded-xl shadow-2xl p-6 relative max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--jira-border)]">
          <div className="flex items-center gap-2">
            <IssueTypeIcon type={issueType} className="w-5 h-5" />
            <h2 id="edit-issue-title" className="text-lg font-bold text-[var(--jira-text-primary)] flex items-center gap-2">
              <span>Edit Issue</span>
              <a
                href={issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[var(--jira-primary)] hover:underline inline-flex items-center gap-1 cursor-pointer"
                title={`Open ${issue.key} in Jira`}
                aria-label={`Open ${issue.key} in Jira`}
              >
                <span>{issue.key}</span>
                <ExternalLink className="w-4 h-4 shrink-0" />
              </a>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
            aria-label="Close edit dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Issue Metadata Dates (Created & Updated) */}
        {(createdFormatted || updatedFormatted) && (
          <div
            className="flex flex-wrap items-center gap-4 py-2 px-3 mt-3 rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-2xs text-[var(--jira-text-muted)]"
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

        {/* Validation Error Banner */}
        {validationError && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{validationError}</span>
          </div>
        )}

        {/* Edit Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
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
              id="edit-description"
              value={description}
              onChange={setDescription}
              placeholder="Add more details about this issue, rich text formatting, or markdown..."
              rows={3}
            />
          </div>

          {/* Type & Priority Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          {/* Status & Assignee Row */}
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
                htmlFor="edit-assignee"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Assignee
              </label>
              <AssigneeSelect
                id="edit-assignee"
                value={assigneeName}
                onChange={setAssigneeName}
              />
            </div>
          </div>

          {/* Story Points & Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="edit-points"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Story Points
              </label>
              <input
                id="edit-points"
                type="number"
                step="any"
                value={storyPoints}
                onChange={(e) => setStoryPoints(e.target.value)}
                placeholder="e.g. 3"
                className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
              />
            </div>

            <div>
              <label
                htmlFor="edit-start-date"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Start Date
              </label>
              <input
                id="edit-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
              />
            </div>

            <div>
              <label
                htmlFor="edit-due-date"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Due Date
              </label>
              <input
                id="edit-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
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
              placeholder="e.g. 7d, 2 weeks, 1 month"
              className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--jira-border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-[var(--jira-border)] hover:bg-[var(--jira-surface-hover)] text-[var(--jira-text-secondary)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--jira-primary)] hover:bg-[var(--jira-primary-hover)] text-white shadow-xs transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Changes</span>
            </button>
          </div>
        </form>

        {/* Discussion / Comments Section */}
        <CommentsSection issueKey={issue.key} />
      </div>
    </div>
  );
}
