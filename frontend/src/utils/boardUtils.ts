import { BoardColumn, JiraIssue, JiraStatusCategory } from '../types/jira.ts';

const CATEGORY_COLORS: Record<JiraStatusCategory, string> = {
  todo: 'var(--jira-status-todo)',
  inprogress: 'var(--jira-status-inprogress)',
  inreview: 'var(--jira-status-inreview)',
  done: 'var(--jira-status-done)',
  blocked: 'var(--jira-status-blocked)',
};

/**
 * Returns the CSS variable corresponding to a status category.
 */
export function getCategoryColorVar(category: JiraStatusCategory): string {
  return CATEGORY_COLORS[category] || 'var(--jira-status-todo)';
}

/**
 * Maps an issue to its appropriate BoardColumn.
 *
 * Priority order:
 * 1. Match by status ID (col.status_ids contains issue.status.id).
 * 2. Match by status name (col.name matches issue.status.name case-insensitively).
 * 3. Match by category (col.category matches issue.status.category).
 * 4. Fallback to the first column.
 */
export function getColumnForIssue(
  issue: JiraIssue,
  columns: BoardColumn[]
): BoardColumn | undefined {
  if (!columns || columns.length === 0) return undefined;

  // 1. Match by status ID
  if (issue.status?.id) {
    const matchById = columns.find(
      (c) => c.status_ids && c.status_ids.includes(String(issue.status.id))
    );
    if (matchById) return matchById;
  }

  // 2. Match by status name
  if (issue.status?.name) {
    const statusNameLower = issue.status.name.trim().toLowerCase();
    const matchByName = columns.find(
      (c) => c.name.trim().toLowerCase() === statusNameLower
    );
    if (matchByName) return matchByName;
  }

  // 3. Fallback: match by status category
  if (issue.status?.category) {
    const matchByCategory = columns.find((c) => c.category === issue.status.category);
    if (matchByCategory) return matchByCategory;
  }

  // 4. Default to first column if no other match
  return columns[0];
}

/**
 * Resolves the target BoardColumn from a dnd-kit `over` target.
 * Supports droppable Column containers, Sortable Issue items, and ID fallbacks.
 */
export function getColumnFromOver(
  over: { id: string | number; data?: { current?: Record<string, unknown> } } | null | undefined,
  columns: BoardColumn[],
  issues: JiraIssue[]
): BoardColumn | undefined {
  if (!over || !columns || columns.length === 0) return undefined;
  const overData = over.data?.current;

  // 1. Direct Column droppable
  if (overData?.type === 'Column' && typeof overData.columnId === 'string') {
    const found = columns.find((c) => c.id === overData.columnId);
    if (found) return found;
  }

  // 2. Issue sortable item
  if (overData?.type === 'Issue' && overData.issue) {
    const found = getColumnForIssue(overData.issue as JiraIssue, columns);
    if (found) return found;
  }

  // 3. Fallback: match by column ID
  const colById = columns.find((c) => c.id === String(over.id));
  if (colById) return colById;

  // 4. Fallback: match by issue key
  const issueById = issues.find((i) => i.key === String(over.id));
  if (issueById) {
    return getColumnForIssue(issueById, columns);
  }

  return undefined;
}

/**
 * Checks whether an issue belongs to the Backlog.
 */
export function isBacklogIssue(issue: JiraIssue, columns?: BoardColumn[]): boolean {
  if (!issue) return false;

  const raw = issue as unknown as Record<string, unknown>;
  if (raw.in_backlog === true || raw.inBacklog === true) {
    return true;
  }

  const statusName = issue.status?.name?.trim().toLowerCase();
  if (statusName === 'backlog') {
    return true;
  }

  const statusId = String(issue.status?.id || '').trim().toLowerCase();
  if (statusId === 'backlog' || statusId === 'col-backlog') {
    return true;
  }

  if (columns && columns.length > 0) {
    const backlogCol = columns.find((c) => c.name.trim().toLowerCase() === 'backlog');
    if (backlogCol) {
      if (
        backlogCol.status_ids &&
        issue.status?.id &&
        backlogCol.status_ids.includes(String(issue.status.id))
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns board columns excluding any Backlog column,
 * ensuring Backlog is never rendered as a column on the active board.
 */
export function getActiveBoardColumns(columns: BoardColumn[]): BoardColumn[] {
  if (!columns) return [];
  return columns.filter((col) => col.name.trim().toLowerCase() !== 'backlog');
}

/**
 * Splits issues into Active Board issues and Backlog issues.
 */
export function splitIssuesByBacklog(
  issues: JiraIssue[],
  columns?: BoardColumn[]
): { boardIssues: JiraIssue[]; backlogIssues: JiraIssue[] } {
  const backlogIssues: JiraIssue[] = [];
  const boardIssues: JiraIssue[] = [];

  for (const issue of issues) {
    if (isBacklogIssue(issue, columns)) {
      backlogIssues.push(issue);
    } else {
      boardIssues.push(issue);
    }
  }

  return { boardIssues, backlogIssues };
}

export interface StatusOption {
  id: string;
  name: string;
  category: JiraStatusCategory;
}

/**
 * Returns all available statuses for issue status selectors,
 * ensuring Backlog is always an available option.
 */
export function getAvailableStatuses(columns: BoardColumn[]): StatusOption[] {
  const options: StatusOption[] = (columns || []).map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
  }));

  const hasBacklog = options.some((o) => o.name.trim().toLowerCase() === 'backlog');
  if (!hasBacklog) {
    options.unshift({
      id: 'col-backlog',
      name: 'Backlog',
      category: 'todo',
    });
  }

  return options;
}


