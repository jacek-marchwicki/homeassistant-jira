import React, { useState, useEffect } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssue, JiraPriority } from '../types/jira.ts';
import { getAvailableStatuses } from '../utils/boardUtils.ts';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';

interface EditIssueModalProps {
  issue: JiraIssue | null;
  isOpen: boolean;
  onClose: () => void;
}

export function EditIssueModal({ issue, isOpen, onClose }: EditIssueModalProps) {
  const { columns, updateIssueOptimistic } = useBoardStore();

  const [summary, setSummary] = useState('');
  const [issueType, setIssueType] = useState<'story' | 'bug' | 'task' | 'subtask'>('task');
  const [priority, setPriority] = useState<JiraPriority>('medium');
  const [statusName, setStatusName] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [storyPoints, setStoryPoints] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const statusOptions = getAvailableStatuses(columns);

  useEffect(() => {
    if (issue) {
      setSummary(issue.summary || '');
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
      issue_type: issueType,
      priority,
      status_name: statusName || issue.status.name,
      status_category: chosenStatus?.category || issue.status.category,
      assignee_name: assigneeName,
      story_points: storyPoints !== '' ? parseFloat(storyPoints) : undefined,
      due_date: dueDate.trim() || null,
      start_date: startDate.trim() || null,
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
            <h2 id="edit-issue-title" className="text-lg font-bold text-[var(--jira-text-primary)]">
              Edit Issue <span className="font-mono text-[var(--jira-primary)]">{issue.key}</span>
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
              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
              placeholder="What needs to be done?"
              autoFocus
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
              <select
                id="edit-type"
                value={issueType}
                onChange={(e) =>
                  setIssueType(e.target.value as 'story' | 'bug' | 'task' | 'subtask')
                }
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)] cursor-pointer"
              >
                <option value="story">Story</option>
                <option value="task">Task</option>
                <option value="bug">Bug</option>
                <option value="subtask">Subtask</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="edit-priority"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Priority
              </label>
              <select
                id="edit-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as JiraPriority)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)] cursor-pointer"
              >
                <option value="highest">Highest</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="lowest">Lowest</option>
              </select>
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
              <select
                id="edit-status"
                value={statusName}
                onChange={(e) => setStatusName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)] cursor-pointer"
              >
                {statusOptions.map((opt) => (
                  <option key={opt.id} value={opt.name}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="edit-assignee"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Assignee
              </label>
              <input
                id="edit-assignee"
                type="text"
                value={assigneeName}
                onChange={(e) => setAssigneeName(e.target.value)}
                placeholder="Unassigned (leave empty)"
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
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
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
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
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
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
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
              />
            </div>
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
      </div>
    </div>
  );
}
