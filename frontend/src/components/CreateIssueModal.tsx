import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, AlertCircle } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraPriority, JiraStatusCategory } from '../types/jira.ts';
import { getAvailableStatuses } from '../utils/boardUtils.ts';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';

interface CreateIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultStatusName?: string;
  defaultStatusCategory?: JiraStatusCategory;
}

export function CreateIssueModal({
  isOpen,
  onClose,
  defaultStatusName,
  defaultStatusCategory,
}: CreateIssueModalProps) {
  const { columns, createIssueOptimistic } = useBoardStore();

  const [summary, setSummary] = useState('');
  const [issueType, setIssueType] = useState<'story' | 'bug' | 'task' | 'subtask'>('task');
  const [priority, setPriority] = useState<JiraPriority>('medium');
  const [statusName, setStatusName] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [storyPoints, setStoryPoints] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const statusOptions = useMemo(() => getAvailableStatuses(columns), [columns]);

  // Initialize form when opened
  useEffect(() => {
    if (isOpen) {
      setSummary('');
      setIssueType('task');
      setPriority('medium');
      const initialStatus =
        defaultStatusName ||
        statusOptions.find((s) => s.name.toLowerCase() === 'to do')?.name ||
        statusOptions.find((s) => s.name.toLowerCase() !== 'backlog')?.name ||
        (statusOptions.length > 0 ? statusOptions[0].name : 'To Do');
      setStatusName(initialStatus);
      setAssigneeName('');
      setStoryPoints('');
      setDueDate('');
      setStartDate('');
      setValidationError(null);
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) {
      setValidationError('Summary is required.');
      return;
    }

    const chosenStatus = statusOptions.find(
      (s) => s.name.toLowerCase() === statusName.toLowerCase()
    );

    createIssueOptimistic({
      summary: summary.trim(),
      issue_type: issueType,
      priority,
      status_name: statusName || chosenStatus?.name || 'To Do',
      status_category: chosenStatus?.category || defaultStatusCategory || 'todo',
      assignee_name: assigneeName.trim() ? assigneeName.trim() : undefined,
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
      aria-labelledby="create-issue-title"
    >
      <div
        className="w-full max-w-lg bg-[var(--jira-surface)] border border-[var(--jira-border)] rounded-xl shadow-2xl p-6 relative max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--jira-border)]">
          <div className="flex items-center gap-2">
            <IssueTypeIcon type={issueType} className="w-5 h-5" />
            <h2 id="create-issue-title" className="text-lg font-bold text-[var(--jira-text-primary)]">
              Create Issue
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--jira-text-muted)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
            aria-label="Close create dialog"
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

        {/* Create Form */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Summary Input */}
          <div>
            <label
              htmlFor="create-summary"
              className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
            >
              Summary <span className="text-red-400">*</span>
            </label>
            <input
              id="create-summary"
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
                htmlFor="create-type"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Issue Type
              </label>
              <select
                id="create-type"
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
                htmlFor="create-priority"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Priority
              </label>
              <select
                id="create-priority"
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
                htmlFor="create-status"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Status
              </label>
              <select
                id="create-status"
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
                htmlFor="create-assignee"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Assignee
              </label>
              <input
                id="create-assignee"
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
                htmlFor="create-points"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Story Points
              </label>
              <input
                id="create-points"
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
                htmlFor="create-due-date"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Due Date
              </label>
              <input
                id="create-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
              />
            </div>

            <div>
              <label
                htmlFor="create-start-date"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Start Date
              </label>
              <input
                id="create-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--jira-border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg text-[var(--jira-text-secondary)] hover:text-[var(--jira-text-primary)] hover:bg-[var(--jira-surface-hover)] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--jira-primary)] text-white hover:bg-[var(--jira-primary-hover)] transition-colors shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
