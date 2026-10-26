import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, X, Plus, AlertCircle } from 'lucide-react';
import { useBoardStore } from '../store/boardStore.ts';
import { JiraIssueType, JiraPriority, JiraStatusCategory } from '../types/jira.ts';
import { getAvailableStatuses } from '../utils/boardUtils.ts';
import { IssueTypeIcon } from './IssueTypeIcon.tsx';
import { AssigneeSelect } from './AssigneeSelect.tsx';
import { IssueTypeSelect } from './IssueTypeSelect.tsx';
import { PrioritySelect } from './PrioritySelect.tsx';
import { StatusSelect } from './StatusSelect.tsx';
import { RichTextEditor } from './RichTextEditor.tsx';
import { DatePicker } from './DatePicker.tsx';
import { useMobileViewport, getMobileModalStyles } from '../utils/useMobileViewport.ts';

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
  const { columns, createIssueOptimistic, createInitialValues } = useBoardStore();

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

  const { outerStyle, dialogStyle } = useMemo(
    () => getMobileModalStyles(isMobile, viewportHeight, viewportOffsetTop),
    [isMobile, viewportHeight, viewportOffsetTop]
  );

  const handleFormFocus = (e: React.FocusEvent) => {
    if (!isMobile) return;
    const target = e.target as HTMLElement;
    setTimeout(() => {
      target.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }, 120);
  };

  const statusOptions = useMemo(() => getAvailableStatuses(columns), [columns]);

  const initialStatus = useMemo(() => {
    return (
      createInitialValues?.status_name ||
      defaultStatusName ||
      statusOptions.find((s) => s.name.toLowerCase() === 'to do')?.name ||
      statusOptions.find((s) => s.name.toLowerCase() !== 'backlog')?.name ||
      (statusOptions.length > 0 ? statusOptions[0].name : 'To Do')
    );
  }, [createInitialValues?.status_name, defaultStatusName, statusOptions]);

  // Initialize form when opened
  useEffect(() => {
    if (isOpen) {
      setSummary(createInitialValues?.summary ?? '');
      setDescription(createInitialValues?.description ?? '');
      setIssueType(createInitialValues?.issue_type ?? 'task');
      setPriority(createInitialValues?.priority ?? 'medium');
      setStatusName(createInitialValues?.status_name ?? initialStatus);
      setAssigneeName(createInitialValues?.assignee_name ?? '');
      setAssigneeAccountId(createInitialValues?.assignee_account_id ?? '');
      setDueDate(createInitialValues?.due_date ?? '');
      setStartDate(createInitialValues?.start_date ?? '');
      setRecreateAfter(createInitialValues?.recreate_after ?? '');
      setValidationError(null);
    }
  }, [isOpen, initialStatus, createInitialValues]);

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

  const isDirty = Boolean(
    summary.trim() !== (createInitialValues?.summary ?? '') ||
    description.trim() !== (createInitialValues?.description ?? '') ||
    issueType !== (createInitialValues?.issue_type ?? 'task') ||
    priority !== (createInitialValues?.priority ?? 'medium') ||
    statusName !== (createInitialValues?.status_name ?? initialStatus) ||
    assigneeName.trim() !== (createInitialValues?.assignee_name ?? '') ||
    assigneeAccountId.trim() !== (createInitialValues?.assignee_account_id ?? '') ||
    dueDate.trim() !== (createInitialValues?.due_date ?? '') ||
    startDate.trim() !== (createInitialValues?.start_date ?? '') ||
    recreateAfter.trim() !== (createInitialValues?.recreate_after ?? '')
  );

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
      status_id: chosenStatus?.id || createInitialValues?.status_id,
      status_name: statusName || chosenStatus?.name || 'To Do',
      status_category: chosenStatus?.category || createInitialValues?.status_category || defaultStatusCategory || 'todo',
      assignee_name: assigneeName.trim() ? assigneeName.trim() : undefined,
      assignee_account_id: assigneeAccountId.trim() ? assigneeAccountId.trim() : undefined,
      due_date: dueDate.trim() || null,
      start_date: startDate.trim() || null,
      recreate_after: recreateAfter.trim() || null,
    });

    onClose();
  };

  return (
    <div
      style={outerStyle}
      className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-issue-title"
    >
      <div
        style={dialogStyle}
        className="w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-lg bg-[var(--jira-surface)] border-0 sm:border border-[var(--jira-border)] rounded-none sm:rounded-xl shadow-none sm:shadow-2xl relative flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          data-testid="create-issue-modal-header"
          className="shrink-0 sticky top-0 z-10 flex items-center justify-between p-4 sm:p-6 pb-4 sm:pb-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] sm:pt-6 border-b border-[var(--jira-border)] bg-[var(--jira-surface)]"
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
                aria-label="Close create dialog"
                title="Close"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <IssueTypeIcon type={issueType} className="w-5 h-5 shrink-0" />
            <h2 id="create-issue-title" className="text-lg font-bold text-[var(--jira-text-primary)] truncate">
              Create Issue
            </h2>
          </div>

          {/* Far-right: Create button */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="submit"
              form="create-issue-form"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--jira-primary)] text-white hover:bg-[var(--jira-primary-hover)] transition-colors shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create</span>
            </button>
          </div>
        </div>

        {/* Modal Scrollable Content */}
        <div
          data-testid="create-issue-modal-content"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom,0px))] sm:pb-6"
        >
          {/* Validation Error Banner */}
          {validationError && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Create Form */}
          <form id="create-issue-form" onSubmit={handleSubmit} onFocusCapture={handleFormFocus} className="space-y-4">
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

          {/* Assignee (directly after Description) */}
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

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="create-start-date"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Start Date
              </label>
              <DatePicker
                id="create-start-date"
                value={startDate}
                onChange={setStartDate}
              />
            </div>

            <div>
              <label
                htmlFor="create-due-date"
                className="block text-xs font-semibold text-[var(--jira-text-secondary)] mb-1"
              >
                Due Date
              </label>
              <DatePicker
                id="create-due-date"
                value={dueDate}
                onChange={setDueDate}
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
        </form>
        </div>
      </div>
    </div>
  );
}
