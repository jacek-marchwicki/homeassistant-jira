"""Jira API Client Abstraction & Fake Implementation.

Provides clean architecture boundaries isolating external Jira APIs behind
a protocol interface, with a full-fidelity in-memory fake client for testing
and local simulation.
"""

from __future__ import annotations

from typing import Any, Protocol

from jira_dashboard.domain import (
    BoardColumn,
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

STATUS_BACKLOG = JiraStatus(id="0", name="Backlog", category=StatusCategory.TODO)

DEFAULT_COLUMNS: list[BoardColumn] = [
    BoardColumn(id="col-todo", name="To Do", category=StatusCategory.TODO, status_ids=["1"]),
    BoardColumn(
        id="col-inprogress",
        name="In Progress",
        category=StatusCategory.IN_PROGRESS,
        status_ids=["2"],
    ),
    BoardColumn(
        id="col-inreview",
        name="In Review",
        category=StatusCategory.IN_REVIEW,
        status_ids=["3"],
    ),
    BoardColumn(id="col-done", name="Done", category=StatusCategory.DONE, status_ids=["4"]),
]

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
    JiraIssue(
        id="104",
        key="PROJ-104",
        summary="Setup WebSocket broadcast client for live browser pushes",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=STATUS_BACKLOG,
        assignee=None,
        story_points=3.0,
        updated_at="2026-10-04T22:35:00Z",
    ),
    JiraIssue(
        id="105",
        key="PROJ-105",
        summary="Support custom JQL query filters in Home Assistant sidebar",
        issue_type=IssueType.STORY,
        priority=Priority.LOW,
        status=STATUS_BACKLOG,
        assignee=JiraUser(
            account_id="usr-1",
            display_name="Jacek Marchwicki",
            avatar_url=None,
        ),
        story_points=3.0,
        updated_at="2026-10-04T22:55:00Z",
    ),
]


class JiraClientProtocol(Protocol):
    """Protocol defining the operations supported by Jira API clients."""

    async def get_board_issues(self, board_id: str) -> list[JiraIssue]:
        """Fetch all issues for a given board."""
        ...

    async def get_board_columns(self, board_id: str) -> list[BoardColumn]:
        """Fetch workflow columns for a given board or project."""
        ...

    async def get_issue(self, issue_key: str) -> JiraIssue | None:
        """Fetch a single issue by key."""
        ...

    async def transition_issue(
        self,
        issue_key: str,
        target_category: StatusCategory | None = None,
        target_status: str | None = None,
    ) -> JiraIssue:
        """Transition an issue to a new status category or status name/ID."""
        ...

    async def update_issue(
        self,
        issue_key: str,
        summary: str | None = None,
        issue_type: IssueType | None = None,
        priority: Priority | None = None,
        status_category: StatusCategory | None = None,
        status_name: str | None = None,
        assignee_name: str | None = None,
        assignee_account_id: str | None = None,
        story_points: float | None = None,
        due_date: str | None = None,
        start_date: str | None = None,
    ) -> JiraIssue:
        """Update fields on an existing issue."""
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

    def reset(self) -> None:
        """Reset in-memory issues and simulated failure flags to initial seed state."""
        self._issues = {issue.key: issue.model_copy(deep=True) for issue in DEFAULT_SEED_ISSUES}
        self.simulate_failure = False
        self.simulate_transition_failure = False
        self.simulate_board_failure = False
        self.failure_status_code = 500
        self.failure_message = "Simulated Jira API failure"

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

    async def get_board_columns(self, board_id: str) -> list[BoardColumn]:
        """Return default workflow columns."""
        if self.simulate_board_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)
        return list(DEFAULT_COLUMNS)

    async def get_issue(self, issue_key: str) -> JiraIssue | None:
        """Return issue by key or None."""
        if self.simulate_board_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)
        return self._issues.get(issue_key)

    async def transition_issue(
        self,
        issue_key: str,
        target_category: StatusCategory | None = None,
        target_status: str | None = None,
    ) -> JiraIssue:
        """Transition issue to target category or status name."""
        if self.simulate_transition_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)

        issue = self._issues.get(issue_key)
        if not issue:
            raise JiraAPIError(f"Issue {issue_key} not found", status_code=404)

        if target_status:
            matched_cat = target_category
            if not matched_cat:
                lowered = target_status.lower()
                if "done" in lowered:
                    matched_cat = StatusCategory.DONE
                elif "review" in lowered:
                    matched_cat = StatusCategory.IN_REVIEW
                elif "progress" in lowered:
                    matched_cat = StatusCategory.IN_PROGRESS
                else:
                    matched_cat = StatusCategory.TODO

            new_status = JiraStatus(
                id=target_status,
                name=target_status,
                category=matched_cat,
            )
        elif target_category:
            new_status = STATUS_MAP.get(target_category)
            if not new_status:
                raise JiraAPIError(f"Invalid target category: {target_category}", status_code=400)
        else:
            raise JiraAPIError(
                "Either target_category or target_status must be provided", status_code=400
            )

        # Update in-memory issue
        updated_issue = issue.model_copy(
            update={"status": new_status, "updated_at": "2026-10-05T00:00:00Z"}
        )
        self._issues[issue_key] = updated_issue
        return updated_issue

    async def update_issue(
        self,
        issue_key: str,
        summary: str | None = None,
        issue_type: IssueType | None = None,
        priority: Priority | None = None,
        status_category: StatusCategory | None = None,
        status_name: str | None = None,
        assignee_name: str | None = None,
        assignee_account_id: str | None = None,
        story_points: float | None = None,
        due_date: str | None = None,
        start_date: str | None = None,
    ) -> JiraIssue:
        """Update issue fields in memory."""
        if self.simulate_transition_failure or self.simulate_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)

        issue = self._issues.get(issue_key)
        if not issue:
            raise JiraAPIError(f"Issue {issue_key} not found", status_code=404)

        new_summary = summary if summary is not None else issue.summary
        new_type = issue_type if issue_type is not None else issue.issue_type
        new_priority = priority if priority is not None else issue.priority

        new_status = issue.status
        if status_name or status_category:
            matched_cat = status_category or issue.status.category
            matched_name = status_name or issue.status.name
            if status_name and not status_category:
                clean = status_name.strip().lower()
                for c, s in STATUS_MAP.items():
                    if s.name.lower() == clean:
                        matched_cat = c
                        break
            new_status = JiraStatus(id=issue.status.id, name=matched_name, category=matched_cat)

        new_assignee = issue.assignee
        if assignee_name is not None:
            if assignee_name.strip() == "":
                new_assignee = None
            else:
                new_assignee = JiraUser(
                    account_id=assignee_account_id
                    or (issue.assignee.account_id if issue.assignee else "usr-1"),
                    display_name=assignee_name.strip(),
                )

        new_story_points = story_points if story_points is not None else issue.story_points
        new_due_date = due_date if due_date is not None else issue.due_date
        new_start_date = start_date if start_date is not None else issue.start_date

        updated_issue = JiraIssue(
            id=issue.id,
            key=issue.key,
            summary=new_summary,
            issue_type=new_type,
            priority=new_priority,
            status=new_status,
            assignee=new_assignee,
            story_points=new_story_points,
            due_date=new_due_date,
            start_date=new_start_date,
            updated_at="2026-10-05T00:00:00Z",
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

        # Extract due date & start date
        raw_due_date = fields.get("duedate") or fields.get("due_date")
        raw_start_date = (
            fields.get("customfield_10015") or fields.get("startDate") or fields.get("start_date")
        )

        # If issue already exists, update its status & summary
        existing = self._issues.get(issue_key)
        if existing:
            summary = fields.get("summary", existing.summary)
            due_date = str(raw_due_date) if raw_due_date is not None else existing.due_date
            start_date = str(raw_start_date) if raw_start_date is not None else existing.start_date
            updated = existing.model_copy(
                update={
                    "summary": summary,
                    "status": status,
                    "due_date": due_date,
                    "start_date": start_date,
                    "updated_at": "2026-10-05T00:00:00Z",
                }
            )
            self._issues[issue_key] = updated
            return updated

        # Otherwise create new issue representation
        due_date = str(raw_due_date) if raw_due_date is not None else None
        start_date = str(raw_start_date) if raw_start_date is not None else None
        new_issue = JiraIssue(
            id=str(issue_data.get("id", "999")),
            key=issue_key,
            summary=fields.get("summary", "Webhook Issue"),
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=status,
            assignee=None,
            story_points=None,
            due_date=due_date,
            start_date=start_date,
            updated_at="2026-10-05T00:00:00Z",
        )
        self._issues[issue_key] = new_issue
        return new_issue
