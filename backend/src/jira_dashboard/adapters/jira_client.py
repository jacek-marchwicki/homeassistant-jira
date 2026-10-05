"""Jira API Client Abstraction & Fake Implementation.

Provides clean architecture boundaries isolating external Jira APIs behind
a protocol interface, with a full-fidelity in-memory fake client for testing
and local simulation.
"""

from __future__ import annotations

from typing import Any, Protocol

from jira_dashboard.domain import (
    IssueType,
    JiraIssue,
    JiraStatus,
    JiraUser,
    Priority,
    StatusCategory,
)

# Canonical status definitions
STATUS_MAP: dict[StatusCategory, JiraStatus] = {
    StatusCategory.TODO: JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
    StatusCategory.IN_PROGRESS: JiraStatus(
        id="2", name="In Progress", category=StatusCategory.IN_PROGRESS
    ),
    StatusCategory.IN_REVIEW: JiraStatus(
        id="3", name="In Review", category=StatusCategory.IN_REVIEW
    ),
    StatusCategory.DONE: JiraStatus(id="4", name="Done", category=StatusCategory.DONE),
    StatusCategory.BLOCKED: JiraStatus(id="5", name="Blocked", category=StatusCategory.BLOCKED),
}

DEFAULT_SEED_ISSUES: list[JiraIssue] = [
    JiraIssue(
        id="101",
        key="PROJ-101",
        summary="Configure Home Assistant Ingress dynamic proxy support",
        issue_type=IssueType.TASK,
        priority=Priority.HIGH,
        status=STATUS_MAP[StatusCategory.TODO],
        assignee=JiraUser(
            account_id="usr-1",
            display_name="Jacek Marchwicki",
            avatar_url=None,
        ),
        story_points=5.0,
        updated_at="2026-10-04T22:30:00Z",
    ),
    JiraIssue(
        id="104",
        key="PROJ-104",
        summary="Setup WebSocket broadcast client for live browser pushes",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=STATUS_MAP[StatusCategory.TODO],
        assignee=None,
        story_points=3.0,
        updated_at="2026-10-04T22:35:00Z",
    ),
    JiraIssue(
        id="98",
        key="PROJ-98",
        summary="Design system tokens with Home Assistant theme bridging",
        issue_type=IssueType.STORY,
        priority=Priority.HIGHEST,
        status=STATUS_MAP[StatusCategory.IN_PROGRESS],
        assignee=JiraUser(
            account_id="usr-2",
            display_name="Alex Lead",
            avatar_url=None,
        ),
        story_points=5.0,
        updated_at="2026-10-04T22:40:00Z",
    ),
    JiraIssue(
        id="85",
        key="PROJ-85",
        summary="Jira webhook ingestion & signature validation engine",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=STATUS_MAP[StatusCategory.IN_REVIEW],
        assignee=None,
        story_points=8.0,
        updated_at="2026-10-04T22:45:00Z",
    ),
    JiraIssue(
        id="72",
        key="PROJ-72",
        summary="Project scaffold & business requirements definition",
        issue_type=IssueType.STORY,
        priority=Priority.LOW,
        status=STATUS_MAP[StatusCategory.DONE],
        assignee=JiraUser(
            account_id="usr-1",
            display_name="Jacek Marchwicki",
            avatar_url=None,
        ),
        story_points=2.0,
        updated_at="2026-10-04T22:50:00Z",
    ),
]


class JiraClientProtocol(Protocol):
    """Protocol defining the operations supported by Jira API clients."""

    async def get_board_issues(self, board_id: str) -> list[JiraIssue]:
        """Fetch all issues for a given board."""
        ...

    async def get_issue(self, issue_key: str) -> JiraIssue | None:
        """Fetch a single issue by key."""
        ...

    async def transition_issue(self, issue_key: str, target_category: StatusCategory) -> JiraIssue:
        """Transition an issue to a new status category."""
        ...

    async def process_webhook(self, payload: dict[str, Any]) -> JiraIssue | None:
        """Parse and apply an incoming Jira webhook payload."""
        ...


class JiraAPIError(Exception):
    """Exception raised when Jira operations fail."""

    def __init__(self, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.status_code = status_code


class FakeJiraClient:
    """High-fidelity test double simulating Jira Cloud REST APIs and webhooks.

    Maintains in-memory issues, validates state transitions, parses webhooks,
    and supports simulated failures to verify optimistic UI rollbacks.
    """

    def __init__(self, initial_issues: list[JiraIssue] | None = None) -> None:
        seed = initial_issues if initial_issues is not None else DEFAULT_SEED_ISSUES
        self._issues: dict[str, JiraIssue] = {
            issue.key: issue.model_copy(deep=True) for issue in seed
        }
        self.simulate_failure: bool = False
        self.simulate_transition_failure: bool = False
        self.simulate_board_failure: bool = False
        self.failure_status_code: int = 500
        self.failure_message: str = "Simulated Jira API failure"

    def set_simulate_failure(
        self,
        enable: bool,
        status_code: int = 500,
        message: str = "Simulated Jira API failure",
        target: str = "all",
    ) -> None:
        """Configure whether subsequent Jira operations should simulate failures."""
        self.simulate_failure = enable
        self.simulate_transition_failure = enable if target in {"all", "transition"} else False
        self.simulate_board_failure = enable if target in {"all", "board"} else False
        self.failure_status_code = status_code
        self.failure_message = message

    async def get_board_issues(self, board_id: str) -> list[JiraIssue]:
        """Return all in-memory issues."""
        if self.simulate_board_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)
        return list(self._issues.values())

    async def get_issue(self, issue_key: str) -> JiraIssue | None:
        """Return issue by key or None."""
        if self.simulate_board_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)
        return self._issues.get(issue_key)

    async def transition_issue(self, issue_key: str, target_category: StatusCategory) -> JiraIssue:
        """Transition issue to target category or raise error."""
        if self.simulate_transition_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)

        issue = self._issues.get(issue_key)
        if not issue:
            raise JiraAPIError(f"Issue {issue_key} not found", status_code=404)

        new_status = STATUS_MAP.get(target_category)
        if not new_status:
            raise JiraAPIError(f"Invalid target category: {target_category}", status_code=400)

        # Update in-memory issue
        updated_issue = issue.model_copy(
            update={"status": new_status, "updated_at": "2026-10-05T00:00:00Z"}
        )
        self._issues[issue_key] = updated_issue
        return updated_issue

    async def process_webhook(self, payload: dict[str, Any]) -> JiraIssue | None:
        """Parse incoming Jira Cloud webhook and update internal state.

        Supported webhook events:
        - `jira:issue_updated`
        - `jira:issue_created`
        """
        webhook_event = payload.get("webhookEvent")
        if webhook_event not in {"jira:issue_updated", "jira:issue_created", None}:
            return None

        issue_data = payload.get("issue")
        if not issue_data or not isinstance(issue_data, dict):
            return None

        issue_key = issue_data.get("key")
        if not issue_key:
            return None

        fields = issue_data.get("fields", {})

        # Extract or default status category
        status_info = fields.get("status", {})
        status_cat_info = status_info.get("statusCategory", {})
        cat_key = status_cat_info.get("key", "new")

        # Map Jira Cloud statusCategory keys to domain StatusCategory
        category_mapping: dict[str, StatusCategory] = {
            "new": StatusCategory.TODO,
            "indeterminate": StatusCategory.IN_PROGRESS,
            "done": StatusCategory.DONE,
            "blocked": StatusCategory.BLOCKED,
        }
        category = category_mapping.get(cat_key, StatusCategory.TODO)
        status = STATUS_MAP.get(category, STATUS_MAP[StatusCategory.TODO])

        # If issue already exists, update its status & summary
        existing = self._issues.get(issue_key)
        if existing:
            summary = fields.get("summary", existing.summary)
            updated = existing.model_copy(
                update={"summary": summary, "status": status, "updated_at": "2026-10-05T00:00:00Z"}
            )
            self._issues[issue_key] = updated
            return updated

        # Otherwise create new issue representation
        new_issue = JiraIssue(
            id=str(issue_data.get("id", "999")),
            key=issue_key,
            summary=fields.get("summary", "Webhook Issue"),
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=status,
            assignee=None,
            story_points=None,
            updated_at="2026-10-05T00:00:00Z",
        )
        self._issues[issue_key] = new_issue
        return new_issue
