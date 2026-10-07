/**
 * Domain entity types for Jira issues, statuses, and boards.
 */

export type JiraStatusCategory = 'todo' | 'inprogress' | 'inreview' | 'done' | 'blocked';

export type JiraPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

export type JiraIssueType = 'story' | 'bug' | 'task' | 'subtask' | 'epic';

export interface JiraUser {
  accountId?: string;
  account_id?: string;
  displayName?: string;
  display_name?: string;
  avatarUrl?: string;
  avatar_url?: string;
}

export interface JiraStatus {
  id: string;
  name: string;
  category: JiraStatusCategory;
  color?: string;
}

export interface JiraComment {
  id: string;
  author?: JiraUser | null;
  body: string;
  created: string;
  updated?: string | null;
}


export interface JiraTransition {
  id: string;
  name: string;
  toStatus: JiraStatus;
}

export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  description?: string | null;
  url?: string | null;
  issueType?: JiraIssueType;
  issue_type?: JiraIssueType;
  priority: JiraPriority;
  status: JiraStatus;
  assignee?: JiraUser | null;
  storyPoints?: number;
  story_points?: number;
  dueDate?: string | null;
  due_date?: string | null;
  startDate?: string | null;
  start_date?: string | null;
  recreateAfter?: string | null;
  recreate_after?: string | null;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  rank?: string | null;
  // Optimistic tracking state
  _optimisticState?: 'synced' | 'pending' | 'failed';
  _pendingTargetStatusId?: string;
  _lastError?: string;
}

export interface BoardColumn {
  id: string;
  name: string;
  category: JiraStatusCategory;
  status_ids?: string[];
}

export interface KanbanColumnData {
  id: string;
  title: string;
  category: JiraStatusCategory;
  statuses: JiraStatus[];
  issues: JiraIssue[];
  wipLimit?: number;
}

export interface BoardState {
  boardId: string;
  boardName: string;
  sprintName?: string;
  columns: KanbanColumnData[];
  lastSyncedAt: string;
}

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface IssueUpdatePayload {
  summary?: string;
  description?: string | null;
  issue_type?: JiraIssueType;
  priority?: JiraPriority;
  status_category?: JiraStatusCategory;
  status_name?: string;
  assignee_name?: string;
  story_points?: number;
  due_date?: string | null;
  start_date?: string | null;
  recreate_after?: string | null;
}

export interface IssueCreatePayload {
  summary: string;
  description?: string | null;
  issue_type?: JiraIssueType;
  priority?: JiraPriority;
  status_category?: JiraStatusCategory;
  status_name?: string;
  assignee_name?: string;
  story_points?: number;
  due_date?: string | null;
  start_date?: string | null;
  recreate_after?: string | null;
  project_key?: string;
}


