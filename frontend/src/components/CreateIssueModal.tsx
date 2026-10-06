import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, AlertCircle } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraPriority, JiraStatusCategory } from '../types/jira.ts';
import { getAvailableStatuses } from '../utils/boardUtils.ts';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';
import { AssigneeSelect } from './AssigneeSelect.tsx';
import { IssueTypeSelect } from './IssueTypeSelect.tsx';
import { PrioritySelect } from './PrioritySelect.tsx';
import { StatusSelect } from './StatusSelect.tsx';
import { RichTextEditor } from './RichTextEditor.tsx';

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

  const statusOptions = useMemo(() => getAvailableStatuses(columns), [columns]);

  // Initialize form when opened
  useEffect(() => {
    if (isOpen) {
      setSummary('');
      setDescription('');
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
      setRecreateAfter('');
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
      description: description.trim() || undefined,
      issue_type: issueType,
      priority,
      status_name: statusName || chosenStatus?.name || 'To Do',
      status_category: chosenStatus?.category || defaultStatusCategory || 'todo',
      assignee_name: assigneeName.trim() ? assigneeName.trim() : undefined,
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
              className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
              placeholder="What needs to be done?"
              autoFocus
            />
          </div>

          {/* Description Input (Rich Text / Markdown) */}
          <div>
            <label
              htmlFor="create-description"
              className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
            >
              Description
            </label>
            <RichTextEditor
              id="create-description"
              value={description}
              onChange={setDescription}
              placeholder="Add more details, rich text formatting, or markdown..."
              rows={3}
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
              <IssueTypeSelect
                id="create-type"
                value={issueType}
                onChange={setIssueType}
              />
            </div>

            <div>
              <label
                htmlFor="create-priority"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Priority
              </label>
              <PrioritySelect
                id="create-priority"
                value={priority}
                onChange={setPriority}
              />
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
              <StatusSelect
                id="create-status"
                value={statusName}
                onChange={(name) => setStatusName(name)}
                options={statusOptions}
                size="md"
              />
            </div>

            <div>
              <label
                htmlFor="create-assignee"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Assignee
              </label>
              <AssigneeSelect
                id="create-assignee"
                value={assigneeName}
                onChange={setAssigneeName}
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
                className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
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
                className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
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
                className="w-full h-10 px-3 text-sm rounded-lg bg-[var(--jira-canvas)] border border-[var(--jira-border)] text-[var(--jira-text-primary)] focus:outline-none focus:border-[var(--jira-primary)]"
              />
            </div>
          </div>

          {/* Recreate after */}
          <div>
            <label
              htmlFor="create-recreate-after"
              className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
            >
              Recreate after
            </label>
            <input
              id="create-recreate-after"
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
