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

