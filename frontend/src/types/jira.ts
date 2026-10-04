/**
 * Domain entity types for Jira issues, statuses, and boards.
 */

export type JiraStatusCategory = 'todo' | 'inprogress' | 'inreview' | 'done' | 'blocked';

export type JiraPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

export interface JiraUser {
  accountId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface JiraStatus {
  id: string;
  name: string;
  category: JiraStatusCategory;
  color?: string;
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
  issueType: 'story' | 'bug' | 'task' | 'subtask';
  priority: JiraPriority;
  status: JiraStatus;
  assignee?: JiraUser;
  storyPoints?: number;
  updatedAt: string;
  // Optimistic tracking state
  _optimisticState?: 'synced' | 'pending' | 'failed';
  _pendingTargetStatusId?: string;
  _lastError?: string;
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
