"""Domain entities and business models for Jira issues, statuses, and boards."""

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class StatusCategory(str, Enum):
    """Standardized Jira status categories."""

    TODO = "todo"
    IN_PROGRESS = "inprogress"
    IN_REVIEW = "inreview"
    DONE = "done"
    BLOCKED = "blocked"


class Priority(str, Enum):
    """Jira issue priority levels."""

    HIGHEST = "highest"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    LOWEST = "lowest"


class IssueType(str, Enum):
    """Standard Jira issue types."""

    STORY = "story"
    BUG = "bug"
    TASK = "task"
    SUBTASK = "subtask"


class JiraUser(BaseModel):
    """Represents a Jira user (assignee/reporter)."""

    account_id: str
    display_name: str
    avatar_url: Optional[str] = None


class JiraStatus(BaseModel):
    """Represents a workflow status in Jira."""

    id: str
    name: str
    category: StatusCategory
    color: Optional[str] = None


class JiraTransition(BaseModel):
    """Represents an allowed status transition for an issue."""

    id: str
    name: str
    to_status: JiraStatus


class JiraIssue(BaseModel):
    """Represents a Jira issue entity with metadata."""

    id: str
    key: str
    summary: str
    issue_type: IssueType
    priority: Priority
    status: JiraStatus
    assignee: Optional[JiraUser] = None
    story_points: Optional[float] = None
    updated_at: str

    def is_done(self) -> bool:
        """Return True if issue is categorized as DONE."""
        return self.status.category == StatusCategory.DONE

    def is_blocked(self) -> bool:
        """Return True if issue is marked as BLOCKED."""
        return self.status.category == StatusCategory.BLOCKED
