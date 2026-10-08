"""Domain entities and business models for Jira issues, statuses, and boards."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from enum import Enum

from pydantic import BaseModel


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
    EPIC = "epic"


class JiraUser(BaseModel):
    """Represents a Jira user (assignee/reporter)."""

    account_id: str
    display_name: str
    avatar_url: str | None = None


class JiraComment(BaseModel):
    """Represents a comment on a Jira issue."""

    id: str
    author: JiraUser | None = None
    body: str
    created: str
    updated: str | None = None


class JiraStatus(BaseModel):
    """Represents a workflow status in Jira."""

    id: str
    name: str
    category: StatusCategory
    color: str | None = None


class BoardColumn(BaseModel):
    """Represents a column on the board matching a workflow status or group."""

    id: str
    name: str
    category: StatusCategory
    status_ids: list[str] = []


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
    description: str | None = None
    url: str | None = None
    issue_type: IssueType
    priority: Priority
    status: JiraStatus
    assignee: JiraUser | None = None
    story_points: float | None = None
    due_date: str | None = None
    start_date: str | None = None
    recreate_after: str | None = None
    rank: str | None = None
    created_at: str | None = None
    updated_at: str

    def is_done(self) -> bool:
        """Return True if issue is categorized as DONE."""
        return self.status.category == StatusCategory.DONE

    def is_blocked(self) -> bool:
        """Return True if issue is marked as BLOCKED."""
        return self.status.category == StatusCategory.BLOCKED

    def updated_at_epoch(self) -> float:
        """Return updated_at parsed into UTC epoch timestamp seconds."""
        return parse_iso_timestamp(self.updated_at)


def parse_iso_timestamp(ts: str | None) -> float:
    """Parse an ISO 8601 timestamp string into epoch seconds (float).

    Robustly handles:
    - Jira Cloud numeric timezone offsets (+0200, +02:00, -0500, -05:00)
    - Standard UTC suffixes (Z or z)
    - Fractional seconds (.045)
    - Naive or date-only strings (assumed UTC)
    - Missing, empty, or unparseable values (returns 0.0)
    """
    if not ts or not isinstance(ts, str):
        return 0.0
    s = ts.strip()
    if not s:
        return 0.0
    if s.endswith("Z") or s.endswith("z"):
        s = s[:-1] + "+00:00"
    else:
        # Match trailing +HHMM or -HHMM without colon and format as +HH:MM for Python 3.9
        match = re.search(r"([+-])(\d{2})(\d{2})$", s)
        if match:
            s = s[: match.start()] + match.group(1) + match.group(2) + ":" + match.group(3)
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return 0.0


def issue_sort_key(issue: JiraIssue) -> tuple[int, str, float, str]:
    """Sort key for deterministic issue ordering across board views.

    Ranked issues come first (sorted ascending by LexoRank).
    Unranked issues come after, sorted descending by updated_at, then ascending by key.
    """
    has_rank = 0 if (issue.rank is not None and issue.rank != "") else 1
    rank_str = issue.rank or ""
    # Negative epoch for descending updated_at order
    updated_epoch = -parse_iso_timestamp(issue.updated_at)
    return (has_rank, rank_str, updated_epoch, issue.key or "")
