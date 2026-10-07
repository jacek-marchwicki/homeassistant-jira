import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
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

  // InProgress drop target at top of Ready list
  if (
    over.id === 'ready-drop-target-inprogress' ||
    overData?.type === 'InProgressDropTarget' ||
    overData?.targetType === 'inprogress'
  ) {
    const inProgressCol = columns.find((c) => isInProgressColumn(c));
    if (inProgressCol) return inProgressCol;
  }

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

  // Done issues or in-progress issues never belong to the Backlog
  const category = issue.status?.category?.trim().toLowerCase();
  if (category === 'done' || category === 'inprogress' || category === 'inreview') {
    return false;
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
 * Checks whether a board column is the Ready/To Do column.
 */
export function isReadyColumn(column: BoardColumn): boolean {
  if (!column) return false;
  const name = column.name.trim().toLowerCase();
  const id = column.id.trim().toLowerCase();
  return (
    name === 'ready' ||
    id === 'col-ready' ||
    name === 'to do' ||
    id === 'col-todo' ||
    column.category === 'todo'
  );
}

/**
 * Checks whether a board column is the Done column.
 */
export function isDoneColumn(column: BoardColumn): boolean {
  if (!column) return false;
  const name = column.name.trim().toLowerCase();
  const id = column.id.trim().toLowerCase();
  return column.category === 'done' || name === 'done' || id === 'col-done';
}

/**
 * Checks whether a board column is an intermediate/workflow column
 * (i.e. neither Ready/To Do nor Done, such as In Progress, In Review, Testing).
 */
export function isIntermediateColumn(column: BoardColumn): boolean {
  if (!column) return false;
  return !isReadyColumn(column) && !isDoneColumn(column);
}

/**
 * Checks whether a board column is the In Progress or intermediate column.
 */
export function isInProgressColumn(column: BoardColumn): boolean {
  if (!column) return false;
  const name = column.name.trim().toLowerCase();
  const id = column.id.trim().toLowerCase();
  return (
    column.category === 'inprogress' ||
    name === 'in progress' ||
    name === 'in-progress' ||
    name === 'inprogress' ||
    id === 'col-inprogress' ||
    id === 'col-in-progress' ||
    isIntermediateColumn(column)
  );
}

/**
 * Filters an array of issues for a specific column.
 * - Ready column receives all unfinished board issues (both Ready and merged In Progress / intermediate).
 * - Intermediate columns act as drop targets during drag (returns empty list so issues aren't duplicated).
 * - Done column displays issues updated within the specified days (default: 2).
 */
export function filterIssuesForColumn(
  issues: JiraIssue[],
  column: BoardColumn,
  allColumns: BoardColumn[],
  doneMaxDays: number = 2,
  now: Date = new Date()
): JiraIssue[] {
  const isDone = isDoneColumn(column);
  const isReady = isReadyColumn(column);
  const isIntermediate = isIntermediateColumn(column);

  if (isDone) {
    return issues.filter((issue) => {
      const col = getColumnForIssue(issue, allColumns);
      if (col?.id !== column.id && !(col && isDoneColumn(col))) return false;
      return isDoneIssueWithinDays(issue, doneMaxDays, now);
    });
  }

  if (isReady) {
    return issues.filter((issue) => {
      const col = getColumnForIssue(issue, allColumns);
      const isIssueDone = (col && isDoneColumn(col)) || issue.status?.category === 'done';
      return !isIssueDone;
    });
  }

  if (isIntermediate) {
    return [];
  }

  return issues.filter((issue) => {
    const col = getColumnForIssue(issue, allColumns);
    return col?.id === column.id;
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

/**
 * Returns true if an issue has in-progress status category, name, or belongs to an intermediate column.
 */
export function isIssueInProgress(issue: JiraIssue, columns?: BoardColumn[]): boolean {
  if (!issue) return false;
  const category = (issue.status?.category || '').trim().toLowerCase();
  if (
    category === 'inprogress' ||
    category === 'in_progress' ||
    category === 'inreview' ||
    category === 'in_review' ||
    category === 'indeterminate'
  ) {
    return true;
  }
  const name = (issue.status?.name || '').trim().toLowerCase();
  if (
    name === 'in progress' ||
    name === 'in-progress' ||
    name === 'inprogress' ||
    name === 'in review' ||
    name === 'in-review' ||
    name === 'under review' ||
    name === 'code review'
  ) {
    return true;
  }
  if (columns && columns.length > 0) {
    const col = getColumnForIssue(issue, columns);
    if (col && isIntermediateColumn(col)) return true;
    if (issue.status?.id) {
      const match = columns.find(
        (c) => isIntermediateColumn(c) && c.status_ids?.includes(String(issue.status.id))
      );
      if (match) return true;
    }
  }
  return false;
}

/**
 * Returns true if an issue type is Epic.
 */
export function isEpicIssue(issue: JiraIssue): boolean {
  if (!issue) return false;
  const type = (issue.issue_type || issue.issueType || '').trim().toLowerCase();
  return type === 'epic';
}

export interface ReadySections {
  overdue: JiraIssue[];
  expedited: JiraIssue[];
  inProgress: JiraIssue[];
  other: JiraIssue[];
}

/**
 * Splits an array of issues into Overdue, Expedited, In Progress, and Other groups.
 * Precedence:
 * 1. Overdue (due date strictly before today - takes highest priority)
 * 2. Expedited (highest priority or due today)
 * 3. In Progress (status is inprogress, not overdue/expedited)
 * 4. Other (standard Ready / To Do issues)
 */
export function splitReadyIssues(
  issues: JiraIssue[],
  now: Date = new Date(),
  columns?: BoardColumn[]
): ReadySections {
  const overdue: JiraIssue[] = [];
  const expedited: JiraIssue[] = [];
  const inProgress: JiraIssue[] = [];
  const other: JiraIssue[] = [];

  for (const issue of issues) {
    if (isIssueOverdue(issue, now)) {
      overdue.push(issue);
    } else if (isIssueExpedited(issue, now)) {
      expedited.push(issue);
    } else if (isIssueInProgress(issue, columns)) {
      inProgress.push(issue);
    } else {
      other.push(issue);
    }
  }

  return { overdue, expedited, inProgress, other };
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
    filters = new Set(['my', 'active', 'hide_epics']);
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

    // 4. Hide Epics Filter (excludes issues where issue_type === 'epic')
    if (filters.has('hide_epics')) {
      if (isEpicIssue(issue)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Constructs the canonical Jira issue URL to open in Jira.
 * Guarantees a browser-friendly URL in the format https://<domain>/browse/<KEY>
 * (e.g. https://marchwicki.atlassian.net/browse/HOME-15103).
 * Sanitizes against Atlassian API Gateway base URLs (api.atlassian.com) or duplicate /browse paths.
 */
export function getJiraIssueUrl(issue: JiraIssue, jiraBaseUrl?: string): string {
  const isBrowseUrl = (url?: string | null): boolean => {
    if (!url || !url.trim()) return false;
    const trimmed = url.trim();
    if (trimmed.includes('api.atlassian.com')) return false;
    if (trimmed.includes('/rest/api/')) return false;
    return trimmed.startsWith('http://') || trimmed.startsWith('https://');
  };

  const cleanBase = (jiraBaseUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/browse\/?$/, '');

  // If a valid custom Jira base URL is configured, prioritize canonical /browse/<KEY>
  if (
    cleanBase &&
    !cleanBase.includes('api.atlassian.com') &&
    cleanBase !== 'https://jira.example.com'
  ) {
    return `${cleanBase}/browse/${issue.key}`;
  }

  // Fallback to issue.url if it is an existing valid browse link
  if (isBrowseUrl(issue.url)) {
    return issue.url!.trim();
  }

  const fallback = cleanBase || 'https://jira.example.com';
  return `${fallback}/browse/${issue.key}`;
}

/**
 * Sorts issues ascending by rank (LexoRank).
 * Issues with defined rank are sorted lexicographically by rank first.
 * Issues without rank are placed after ranked issues, sorted descending by updated_at,
 * or ascending by key.
 */
export function sortIssuesByRank(issues: JiraIssue[]): JiraIssue[] {
  return [...issues].sort((a, b) => {
    if (a.rank && b.rank) {
      if (a.rank < b.rank) return -1;
      if (a.rank > b.rank) return 1;
      return a.key.localeCompare(b.key);
    }
    if (a.rank && !b.rank) return -1;
    if (!a.rank && b.rank) return 1;

    // Both unranked: sort by updated_at descending, then key ascending
    const aDate = a.updated_at || a.updatedAt || '';
    const bDate = b.updated_at || b.updatedAt || '';
    if (aDate && bDate && aDate !== bDate) {
      return bDate.localeCompare(aDate);
    }
    return a.key.localeCompare(b.key);
  });
}

/**
 * Calculates a lexicographically intermediate rank between prevRank and nextRank.
 * If prevRank is missing, generates a rank strictly smaller than nextRank.
 * If nextRank is missing, generates a rank strictly greater than prevRank.
 * If both are missing, defaults to '0|i00001:'.
 */
export function calculateRankBetween(
  prevRank?: string | null,
  nextRank?: string | null
): string {
  if (!prevRank && !nextRank) {
    return '0|i00001:';
  }

  if (!prevRank && nextRank) {
    const match = nextRank.match(/^(.*?)(\d+)(:*)$/);
    if (match) {
      const num = parseInt(match[2], 10);
      if (num > 0) {
        return match[1] + String(num - 1).padStart(match[2].length, '0') + match[3];
      }
    }
    for (let i = nextRank.length - 1; i >= 0; i--) {
      const code = nextRank.charCodeAt(i);
      if (code > 33) {
        return nextRank.slice(0, i) + String.fromCharCode(code - 1) + nextRank.slice(i + 1);
      }
    }
    return '0|00000:';
  }

  if (prevRank && !nextRank) {
    const match = prevRank.match(/^(.*?)(\d+)(:*)$/);
    if (match) {
      const num = parseInt(match[2], 10);
      return match[1] + String(num + 1).padStart(match[2].length, '0') + match[3];
    }
    return prevRank + 'z';
  }

  // Both exist: check if they have matching digit pattern
  const matchA = prevRank!.match(/^(.*?)(\d+)(:*)$/);
  const matchB = nextRank!.match(/^(.*?)(\d+)(:*)$/);
  if (matchA && matchB && matchA[1] === matchB[1] && matchA[3] === matchB[3]) {
    const numA = parseInt(matchA[2], 10);
    const numB = parseInt(matchB[2], 10);
    if (numB - numA > 1) {
      const midNum = Math.floor((numA + numB) / 2);
      return matchA[1] + String(midNum).padStart(matchA[2].length, '0') + matchA[3];
    }
  }

  return prevRank! + 'i';
}

export interface KanbanDragEndParams {
  issues: JiraIssue[];
  columns: BoardColumn[];
  displayedColumns: BoardColumn[];
  activeColumns: BoardColumn[];
  boardIssues: JiraIssue[];
  backlogIssues: JiraIssue[];
  transitionIssueOptimistic: (
    issueKey: string,
    category: JiraStatusCategory,
    targetStatus?: string
  ) => Promise<void> | void;
  rankIssueOptimistic: (
    issueKey: string,
    rankBeforeKey?: string,
    rankAfterKey?: string,
    targetRank?: string
  ) => Promise<void> | void;
  moveToBacklog: (issueKey: string) => Promise<void> | void;
}

export function handleKanbanDragEnd(
  event: DragEndEvent,
  params: KanbanDragEndParams
): void {
  const { active, over } = event;
  if (!over) return;

  const activeKey = String(active.id);
  const activeItem = params.issues.find((i) => i.key === activeKey);
  if (!activeItem) return;

  const overKey = String(over.id);
  const overData = over.data?.current;

  // 1. Dropped onto Backlog slide-out / panel
  if (
    overKey === 'panel-backlog-list' ||
    overData?.targetType === 'backlog' ||
    params.backlogIssues.some((i) => i.key === overKey)
  ) {
    params.moveToBacklog(activeKey);
    const overItem = params.backlogIssues.find((i) => i.key === overKey);
    if (overItem) {
      const targetIndex = params.backlogIssues.findIndex((i) => i.key === overKey);
      const prevItem = targetIndex > 0 ? params.backlogIssues[targetIndex - 1] : null;
      const nextItem = params.backlogIssues[targetIndex];
      const targetRank = calculateRankBetween(prevItem?.rank, nextItem?.rank);
      params.rankIssueOptimistic(activeKey, nextItem?.key, prevItem?.key, targetRank);
    }
    return;
  }

  // 2. Dropped onto In Progress drop target
  if (
    overKey === 'ready-drop-target-inprogress' ||
    overData?.type === 'InProgressDropTarget' ||
    overData?.targetType === 'inprogress'
  ) {
    const inProgressCol = params.columns.find((c) => isInProgressColumn(c));
    const category = inProgressCol?.category ?? 'inprogress';
    const statusName = inProgressCol?.name ?? 'In Progress';
    if (activeItem.status?.category !== category) {
      params.transitionIssueOptimistic(activeKey, category, statusName);
    }
    return;
  }

  // 3. Dropped onto a column or an issue within a column
  const currentColumn = getColumnForIssue(activeItem, params.activeColumns);
  const targetCol = getColumnFromOver(over, params.displayedColumns, params.issues);
  if (!targetCol) return;

  const isChangingColumn =
    currentColumn?.id !== targetCol.id || isBacklogIssue(activeItem, params.columns);
  if (isChangingColumn) {
    params.transitionIssueOptimistic(activeKey, targetCol.category, targetCol.name);
  }

  const colIssues = filterIssuesForColumn(params.boardIssues, targetCol, params.activeColumns);
  const overItem = params.issues.find((i) => i.key === overKey);

  if (overItem && overKey !== activeKey) {
    // Dropped over an issue card in targetCol
    if (!isChangingColumn) {
      // Intra-column reorder
      const oldIndex = colIssues.findIndex((i) => i.key === activeKey);
      const newIndex = colIssues.findIndex((i) => i.key === overKey);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(colIssues, oldIndex, newIndex);
        const prevItem = newIndex > 0 ? reordered[newIndex - 1] : null;
        const nextItem = newIndex < reordered.length - 1 ? reordered[newIndex + 1] : null;
        const targetRank = calculateRankBetween(prevItem?.rank, nextItem?.rank);
        params.rankIssueOptimistic(activeKey, nextItem?.key, prevItem?.key, targetRank);
      }
    } else {
      // Inter-column drop over a specific card
      const targetIndex = colIssues.findIndex((i) => i.key === overKey);
      if (targetIndex !== -1) {
        const prevItem = targetIndex > 0 ? colIssues[targetIndex - 1] : null;
        const nextItem = colIssues[targetIndex];
        const targetRank = calculateRankBetween(prevItem?.rank, nextItem?.rank);
        params.rankIssueOptimistic(activeKey, nextItem?.key, prevItem?.key, targetRank);
      }
    }
  } else if (!overItem && isChangingColumn) {
    // Dropped onto column container itself (e.g. empty column or bottom of column)
    const lastItem = colIssues[colIssues.length - 1];
    if (lastItem && lastItem.key !== activeKey) {
      const targetRank = calculateRankBetween(lastItem.rank, null);
      params.rankIssueOptimistic(activeKey, undefined, lastItem.key, targetRank);
    }
  }
}

export interface BacklogDragEndParams {
  issues: JiraIssue[];
  boardIssues: JiraIssue[];
  backlogIssues: JiraIssue[];
  moveToBoard: (issueKey: string) => Promise<void> | void;
  moveToBacklog: (issueKey: string) => Promise<void> | void;
  rankIssueOptimistic: (
    issueKey: string,
    rankBeforeKey?: string,
    rankAfterKey?: string,
    targetRank?: string
  ) => Promise<void> | void;
}

export function handleBacklogDragEnd(
  event: DragEndEvent,
  params: BacklogDragEndParams
): void {
  const { active, over } = event;
  if (!over) return;

  const activeKey = String(active.id);
  const activeItem = params.issues.find((i) => i.key === activeKey);
  if (!activeItem) return;

  const overKey = String(over.id);
  const overItem = params.issues.find((i) => i.key === overKey);

  // Resolve target section
  let targetType: 'board' | 'backlog' | null = null;
  const overData = over.data?.current;
  if (overData?.targetType) {
    targetType = overData.targetType as 'board' | 'backlog';
  } else if (overKey === 'backlog-view-sprint-list') {
    targetType = 'board';
  } else if (overKey === 'backlog-view-backlog-list') {
    targetType = 'backlog';
  } else if (overItem) {
    if (params.boardIssues.some((i) => i.key === overKey)) {
      targetType = 'board';
    } else if (params.backlogIssues.some((i) => i.key === overKey)) {
      targetType = 'backlog';
    }
  }

  if (!targetType) return;

  const isCurrentlyBacklog = params.backlogIssues.some((i) => i.key === activeKey);

  // Moving across sections
  if (targetType === 'board' && isCurrentlyBacklog) {
    params.moveToBoard(activeKey);
    if (overItem && params.boardIssues.some((i) => i.key === overKey)) {
      const targetIndex = params.boardIssues.findIndex((i) => i.key === overKey);
      const prevItem = targetIndex > 0 ? params.boardIssues[targetIndex - 1] : null;
      const nextItem = params.boardIssues[targetIndex];
      const targetRank = calculateRankBetween(prevItem?.rank, nextItem?.rank);
      params.rankIssueOptimistic(activeKey, nextItem?.key, prevItem?.key, targetRank);
    }
  } else if (targetType === 'backlog' && !isCurrentlyBacklog) {
    params.moveToBacklog(activeKey);
    if (overItem && params.backlogIssues.some((i) => i.key === overKey)) {
      const targetIndex = params.backlogIssues.findIndex((i) => i.key === overKey);
      const prevItem = targetIndex > 0 ? params.backlogIssues[targetIndex - 1] : null;
      const nextItem = params.backlogIssues[targetIndex];
      const targetRank = calculateRankBetween(prevItem?.rank, nextItem?.rank);
      params.rankIssueOptimistic(activeKey, nextItem?.key, prevItem?.key, targetRank);
    }
  } else {
    // Intra-list reordering (same section)
    const currentList = isCurrentlyBacklog ? params.backlogIssues : params.boardIssues;
    if (overItem && overKey !== activeKey) {
      const oldIndex = currentList.findIndex((i) => i.key === activeKey);
      const newIndex = currentList.findIndex((i) => i.key === overKey);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(currentList, oldIndex, newIndex);
        const prevItem = newIndex > 0 ? reordered[newIndex - 1] : null;
        const nextItem = newIndex < reordered.length - 1 ? reordered[newIndex + 1] : null;
        const targetRank = calculateRankBetween(prevItem?.rank, nextItem?.rank);
        params.rankIssueOptimistic(activeKey, nextItem?.key, prevItem?.key, targetRank);
      }
    }
  }
}




