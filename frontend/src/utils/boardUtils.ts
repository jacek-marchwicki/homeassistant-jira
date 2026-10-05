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
 * Checks whether an issue in the Done category was updated within the specified number of days (default: 2 days).
 *
 * Rules:
 * - If the issue is not in the Done category (category !== 'done' and status name !== 'done'), returns true.
 * - If the issue is in the Done category:
 *   - If updated_at (or updatedAt) is missing or cannot be parsed, returns true (so optimistic or untracked issues are shown).
 *   - If updated_at is within the last `days` days (<= days * 24h ago or on/after the calendar start of `days` days ago), returns true.
 *   - Otherwise returns false (hides completed issues older than `days` days).
 */
export function isDoneIssueWithinDays(
  issue: JiraIssue,
  days: number = 2,
  now: Date = new Date()
): boolean {
  const category = issue.status?.category;
  const statusName = (issue.status?.name || '').trim().toLowerCase();
  const isDone = category === 'done' || statusName === 'done';
  if (!isDone) return true;

  const dateStr = issue.updated_at ?? issue.updatedAt;
  if (!dateStr) return true;

  const updatedDate = parseDate(dateStr);
  if (!updatedDate) return true;

  const maxAgeMs = days * 24 * 60 * 60 * 1000;
  const ageMs = now.getTime() - updatedDate.getTime();
  const calendarCutoff = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - days,
    0,
    0,
    0,
    0
  );

  return ageMs <= maxAgeMs || updatedDate >= calendarCutoff;
}

/**
 * Splits issues into Active Board issues and Backlog issues.
 * For the active board, issues in the Done category older than doneMaxDays (default: 2 days)
 * are filtered out so the DONE column displays only recently completed issues.
 */
export function splitIssuesByBacklog(
  issues: JiraIssue[],
  columns?: BoardColumn[],
  doneMaxDays: number = 2,
  now: Date = new Date()
): { boardIssues: JiraIssue[]; backlogIssues: JiraIssue[] } {
  const backlogIssues: JiraIssue[] = [];
  const boardIssues: JiraIssue[] = [];

  for (const issue of issues) {
    if (isBacklogIssue(issue, columns)) {
      backlogIssues.push(issue);
    } else {
      if (isDoneIssueWithinDays(issue, doneMaxDays, now)) {
        boardIssues.push(issue);
      }
    }
  }

  return { boardIssues, backlogIssues };
}

/**
 * Filters an array of issues for a specific column, ensuring that if the column is
 * in the Done category, only issues updated within the specified days (default: 2) are included.
 */
export function filterIssuesForColumn(
  issues: JiraIssue[],
  column: BoardColumn,
  allColumns: BoardColumn[],
  doneMaxDays: number = 2,
  now: Date = new Date()
): JiraIssue[] {
  const isDone = column.category === 'done' || column.name.trim().toLowerCase() === 'done';
  return issues.filter((issue) => {
    const col = getColumnForIssue(issue, allColumns);
    if (col?.id !== column.id) return false;
    if (isDone && !isDoneIssueWithinDays(issue, doneMaxDays, now)) {
      return false;
    }
    return true;
  });
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

/**
 * Parses a date string (YYYY-MM-DD or ISO timestamp) into a Date object in local time.
 */
export function parseDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Handle YYYY-MM-DD format explicitly in local time to avoid UTC shift
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    return new Date(year, month, day);
  }

  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Returns true if an issue is Overdue (has a due date strictly before today).
 */
export function isIssueOverdue(issue: JiraIssue, now: Date = new Date()): boolean {
  const dueDateStr = issue.due_date ?? issue.dueDate;
  if (!dueDateStr) return false;
  const dueDate = parseDate(dueDateStr);
  if (!dueDate) return false;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return dueDate < startOfToday;
}

/**
 * Returns true if an issue is Expedited according to:
 * priority = Highest AND ("Start date" is EMPTY OR "Start date" <= now()) OR duedate <= endOfDay()
 */
export function isIssueExpedited(issue: JiraIssue, now: Date = new Date()): boolean {
  if (isIssueOverdue(issue, now)) return false;

  const priorityLower = (issue.priority || '').trim().toLowerCase();
  const startDateStr = issue.start_date ?? issue.startDate;
  const startDate = parseDate(startDateStr);
  const hasNoStartDate = !startDateStr || !startDate;
  const isStarted = hasNoStartDate || startDate <= now;
  const matchesHighestPriority = priorityLower === 'highest' && isStarted;

  const dueDateStr = issue.due_date ?? issue.dueDate;
  const dueDate = parseDate(dueDateStr);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const matchesDueTodayOrEarlier = dueDate !== null && dueDate <= endOfToday;

  return matchesHighestPriority || matchesDueTodayOrEarlier;
}

export interface ReadySections {
  overdue: JiraIssue[];
  expedited: JiraIssue[];
  other: JiraIssue[];
}

/**
 * Splits an array of issues into Overdue, Expedited, and Other groups.
 */
export function splitReadyIssues(
  issues: JiraIssue[],
  now: Date = new Date()
): ReadySections {
  const overdue: JiraIssue[] = [];
  const expedited: JiraIssue[] = [];
  const other: JiraIssue[] = [];

  for (const issue of issues) {
    if (isIssueOverdue(issue, now)) {
      overdue.push(issue);
    } else if (isIssueExpedited(issue, now)) {
      expedited.push(issue);
    } else {
      other.push(issue);
    }
  }

  return { overdue, expedited, other };
}

/**
 * Returns true if an issue is assigned to the specified user ('me') or not assigned to anyone.
 */
export function isAssignedToMeOrUnassigned(
  issue: JiraIssue,
  currentUser: string = 'Jacek'
): boolean {
  if (!issue.assignee) return true;
  const name = issue.assignee.displayName || issue.assignee.display_name || '';
  if (!name.trim()) return true;
  return name.toLowerCase().includes(currentUser.toLowerCase());
}

/**
 * Returns true if an issue is Active.
 * An issue is active if it has no Start date OR its Start date is not in the future (Start date <= Now date).
 */
export function isIssueActive(issue: JiraIssue, now: Date = new Date()): boolean {
  const startDateStr = issue.start_date ?? issue.startDate;
  if (!startDateStr) return true;
  const startDate = parseDate(startDateStr);
  if (!startDate) return true;

  const startOfStartDate = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
    0,
    0,
    0,
    0
  );
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0
  );
  return startOfStartDate <= startOfToday;
}

export interface FilterIssuesOptions {
  activeFilters?: string[];
  activeFilter?: string;
  searchQuery?: string;
  now?: Date;
  currentUser?: string;
}

/**
 * Filters an array of issues by search query and quick filters (e.g. 'my', 'active').
 */
export function filterIssues(
  issues: JiraIssue[],
  options: FilterIssuesOptions = {}
): JiraIssue[] {
  const { searchQuery = '', now = new Date(), currentUser = 'Jacek' } = options;

  let filters: Set<string>;
  if (options.activeFilter === 'all') {
    filters = new Set();
  } else if (options.activeFilters !== undefined) {
    filters = new Set(options.activeFilters);
  } else if (options.activeFilter) {
    filters = new Set(
      options.activeFilter
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  } else {
    filters = new Set(['my', 'active']);
  }

  return issues.filter((issue) => {
    // 1. Text Search Filter (matches Issue Key, Summary, or Description)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchesKey = (issue.key || '').toLowerCase().includes(q);
      const matchesSummary = (issue.summary || '').toLowerCase().includes(q);
      const matchesDescription = (issue.description || '').toLowerCase().includes(q);
      if (!matchesKey && !matchesSummary && !matchesDescription) return false;
    }

    // 2. Assigned to Me / Unassigned Filter
    if (filters.has('my')) {
      if (!isAssignedToMeOrUnassigned(issue, currentUser)) {
        return false;
      }
    }

    // 3. Active Filter (Start date not in future: empty or <= now)
    if (filters.has('active')) {
      if (!isIssueActive(issue, now)) {
        return false;
      }
    }

    return true;
  });
}


