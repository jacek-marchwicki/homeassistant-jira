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
