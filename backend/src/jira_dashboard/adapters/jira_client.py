"""Jira API Client Abstraction & Fake Implementation.

Provides clean architecture boundaries isolating external Jira APIs behind
a protocol interface, with a full-fidelity in-memory fake client for testing
and local simulation.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Protocol

from jira_dashboard.domain import (
    BoardColumn,
    IssueType,
    JiraComment,
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
        url="https://jira.example.com/browse/PROJ-101",
        issue_type=IssueType.TASK,
        priority=Priority.HIGH,
        status=STATUS_MAP[StatusCategory.TODO],
        assignee=JiraUser(
            account_id="usr-1",
            display_name="Jacek Marchwicki",
            avatar_url=None,
        ),
        story_points=5.0,
        recreate_after="1w",
        rank="0|i00001:",
        created_at="2026-10-01T09:00:00Z",
        updated_at="2026-10-04T22:30:00Z",
    ),
    JiraIssue(
        id="98",
        key="PROJ-98",
        summary="Design system tokens with Home Assistant theme bridging",
        url="https://jira.example.com/browse/PROJ-98",
        issue_type=IssueType.STORY,
        priority=Priority.HIGHEST,
        status=STATUS_MAP[StatusCategory.IN_PROGRESS],
        assignee=JiraUser(
            account_id="usr-2",
            display_name="Alex Lead",
            avatar_url=None,
        ),
        story_points=5.0,
        rank="0|i00002:",
        created_at="2026-10-01T09:30:00Z",
        updated_at="2026-10-04T22:40:00Z",
    ),
    JiraIssue(
        id="85",
        key="PROJ-85",
        summary="Jira webhook ingestion & signature validation engine",
        url="https://jira.example.com/browse/PROJ-85",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=STATUS_MAP[StatusCategory.IN_REVIEW],
        assignee=None,
        story_points=8.0,
        rank="0|i00003:",
        created_at="2026-10-01T10:00:00Z",
        updated_at="2026-10-04T22:45:00Z",
    ),
    JiraIssue(
        id="72",
        key="PROJ-72",
        summary="Project scaffold & business requirements definition",
        url="https://jira.example.com/browse/PROJ-72",
        issue_type=IssueType.STORY,
        priority=Priority.LOW,
        status=STATUS_MAP[StatusCategory.DONE],
        assignee=JiraUser(
            account_id="usr-1",
            display_name="Jacek Marchwicki",
            avatar_url=None,
        ),
        story_points=2.0,
        rank="0|i00004:",
        created_at="2026-10-01T08:00:00Z",
        updated_at="2026-10-04T22:50:00Z",
    ),
    JiraIssue(
        id="104",
        key="PROJ-104",
        summary="Setup WebSocket broadcast client for live browser pushes",
        url="https://jira.example.com/browse/PROJ-104",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=STATUS_BACKLOG,
        assignee=None,
        story_points=3.0,
        rank="0|i00005:",
        created_at="2026-10-02T11:00:00Z",
        updated_at="2026-10-04T22:35:00Z",
    ),
    JiraIssue(
        id="105",
        key="PROJ-105",
        summary="Support custom JQL query filters in Home Assistant sidebar",
        url="https://jira.example.com/browse/PROJ-105",
        issue_type=IssueType.EPIC,
        priority=Priority.LOW,
        status=STATUS_BACKLOG,
        assignee=JiraUser(
            account_id="usr-1",
            display_name="Jacek Marchwicki",
            avatar_url=None,
        ),
        story_points=3.0,
        recreate_after="2y!",
        rank="0|i00006:",
        created_at="2026-10-02T11:30:00Z",
        updated_at="2026-10-04T22:55:00Z",
    ),
]

DEFAULT_SEED_COMMENTS: dict[str, list[JiraComment]] = {
    "PROJ-101": [
        JiraComment(
            id="c-1",
            author=JiraUser(
                account_id="usr-1",
                display_name="Jacek Marchwicki",
                avatar_url=None,
            ),
            body="Verified Ingress headers and root_path behavior on Home Assistant 2026.10.",
            created="2026-10-04T22:35:00Z",
            updated=None,
        ),
        JiraComment(
            id="c-2",
            author=JiraUser(
                account_id="usr-2",
                display_name="Alex Lead",
                avatar_url=None,
            ),
            body="Ensure reverse proxy query parameters and WebSockets upgrade cleanly.",
            created="2026-10-04T22:45:00Z",
            updated=None,
        ),
    ]
}


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
        description: str | None = None,
        issue_type: IssueType | None = None,
        priority: Priority | None = None,
        status_category: StatusCategory | None = None,
        status_name: str | None = None,
        assignee_name: str | None = None,
        assignee_account_id: str | None = None,
        story_points: float | None = None,
        due_date: str | None = None,
        start_date: str | None = None,
        recreate_after: str | None = None,
    ) -> JiraIssue:
        """Update fields on an existing issue."""
        ...

    async def create_issue(
        self,
        summary: str,
        description: str | None = None,
        issue_type: IssueType = IssueType.TASK,
        priority: Priority = Priority.MEDIUM,
        status_category: StatusCategory = StatusCategory.TODO,
        status_name: str | None = None,
        status_id: str | None = None,
        assignee_name: str | None = None,
        assignee_account_id: str | None = None,
        story_points: float | None = None,
        due_date: str | None = None,
        start_date: str | None = None,
        recreate_after: str | None = None,
        board_id: str | None = None,
        project_key: str | None = None,
        rank: str | None = None,
        rank_before_key: str | None = None,
    ) -> JiraIssue:
        """Create a new Jira issue."""
        ...

    async def get_comments(self, issue_key: str) -> list[JiraComment]:
        """Fetch comments for a given issue."""
        ...

    async def add_comment(
        self, issue_key: str, body: str, author_name: str | None = None
    ) -> JiraComment:
        """Add a comment to an issue."""
        ...

    async def update_comment(self, issue_key: str, comment_id: str, body: str) -> JiraComment:
        """Update a comment on an issue."""
        ...

    async def delete_comment(self, issue_key: str, comment_id: str) -> bool:
        """Delete a comment on an issue."""
        ...

    async def rank_issue(
        self,
        issue_key: str,
        rank_before_key: str | None = None,
        rank_after_key: str | None = None,
        target_rank: str | None = None,
    ) -> JiraIssue:
        """Rank an issue relative to other issues or set its rank value."""
        ...

    async def process_webhook(self, payload: dict[str, Any]) -> JiraIssue | None:
        """Parse and apply an incoming Jira webhook payload."""
        ...

    async def get_assignable_users(
        self, board_id: str | None = None, project_key: str | None = None
    ) -> list[JiraUser]:
        """Fetch assignable Jira users for a project or board."""
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
        import os

        if initial_issues is not None:
            seed = initial_issues
        elif os.environ.get("JIRA_USE_FAKE") == "1":
            seed = DEFAULT_SEED_ISSUES
        else:
            seed = []

        self._issues = {issue.key: issue.model_copy(deep=True) for issue in seed}
        if "PROJ-72" in self._issues:
            self._issues["PROJ-72"] = self._issues["PROJ-72"].model_copy(
                update={"updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
            )
        self._comments: dict[str, list[JiraComment]] = (
            {k: [c.model_copy(deep=True) for c in v] for k, v in DEFAULT_SEED_COMMENTS.items()}
            if os.environ.get("JIRA_USE_FAKE") == "1"
            else {}
        )
        self.simulate_failure: bool = False
        self.simulate_transition_failure: bool = False
        self.simulate_board_failure: bool = False
        self.failure_status_code: int = 500
        self.failure_message: str = "Simulated Jira API failure"

    def reset(self) -> None:
        """Reset in-memory issues and simulated failure flags to initial seed state."""
        import os

        seed = DEFAULT_SEED_ISSUES if os.environ.get("JIRA_USE_FAKE") == "1" else []
        self._issues = {issue.key: issue.model_copy(deep=True) for issue in seed}
        if "PROJ-72" in self._issues:
            self._issues["PROJ-72"] = self._issues["PROJ-72"].model_copy(
                update={"updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
            )
        self._comments = (
            {k: [c.model_copy(deep=True) for c in v] for k, v in DEFAULT_SEED_COMMENTS.items()}
            if os.environ.get("JIRA_USE_FAKE") == "1"
            else {}
        )
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
        if self.simulate_board_failure or self.simulate_failure:
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
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        updated_issue = issue.model_copy(update={"status": new_status, "updated_at": now_iso})
        self._issues[issue_key] = updated_issue
        return updated_issue

    async def rank_issue(
        self,
        issue_key: str,
        rank_before_key: str | None = None,
        rank_after_key: str | None = None,
        target_rank: str | None = None,
    ) -> JiraIssue:
        """Rank an issue relative to other issues in in-memory store."""
        if self.simulate_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)

        issue = self._issues.get(issue_key)
        if not issue:
            raise JiraAPIError(f"Issue {issue_key} not found", status_code=404)

        # Build list without active issue
        issue_list = [i for i in self._issues.values() if i.key != issue_key]

        if rank_before_key:
            idx = next((i for i, it in enumerate(issue_list) if it.key == rank_before_key), -1)
            if idx != -1:
                issue_list.insert(idx, issue)
            else:
                issue_list.append(issue)
        elif rank_after_key:
            idx = next((i for i, it in enumerate(issue_list) if it.key == rank_after_key), -1)
            if idx != -1:
                issue_list.insert(idx + 1, issue)
            else:
                issue_list.append(issue)
        else:
            issue_list.append(issue)

        pos = issue_list.index(issue)
        new_rank = target_rank or f"0|i{pos + 1:05d}:"
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        updated_issue = issue.model_copy(
            update={
                "rank": new_rank,
                "updated_at": now_iso,
            }
        )
        issue_list[pos] = updated_issue

        reordered_issues = {}
        for idx, item in enumerate(issue_list):
            item_rank = (
                item.rank if (item.key == issue_key and target_rank) else f"0|i{idx + 1:05d}:"
            )
            reordered_issues[item.key] = item.model_copy(update={"rank": item_rank})

        self._issues = reordered_issues
        return self._issues[issue_key]

    async def update_issue(
        self,
        issue_key: str,
        summary: str | None = None,
        description: str | None = None,
        issue_type: IssueType | None = None,
        priority: Priority | None = None,
        status_category: StatusCategory | None = None,
        status_name: str | None = None,
        assignee_name: str | None = None,
        assignee_account_id: str | None = None,
        story_points: float | None = None,
        due_date: str | None = None,
        start_date: str | None = None,
        recreate_after: str | None = None,
    ) -> JiraIssue:
        """Update issue fields in memory."""
        if self.simulate_transition_failure or self.simulate_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)

        issue = self._issues.get(issue_key)
        if not issue:
            raise JiraAPIError(f"Issue {issue_key} not found", status_code=404)

        new_summary = summary if summary is not None else issue.summary
        new_description = description if description is not None else issue.description
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
        elif assignee_account_id is not None and issue.assignee:
            new_assignee = JiraUser(
                account_id=assignee_account_id,
                display_name=issue.assignee.display_name,
                avatar_url=issue.assignee.avatar_url,
            )

        new_story_points = story_points if story_points is not None else issue.story_points
        new_due_date = due_date if due_date is not None else issue.due_date
        new_start_date = start_date if start_date is not None else issue.start_date
        new_recreate_after = recreate_after if recreate_after is not None else issue.recreate_after

        updated_issue = JiraIssue(
            id=issue.id,
            key=issue.key,
            summary=new_summary,
            description=new_description,
            issue_type=new_type,
            priority=new_priority,
            status=new_status,
            assignee=new_assignee,
            story_points=new_story_points,
            due_date=new_due_date,
            start_date=new_start_date,
            recreate_after=new_recreate_after,
            updated_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
        self._issues[issue_key] = updated_issue
        return updated_issue

    async def create_issue(
        self,
        summary: str,
        description: str | None = None,
        issue_type: IssueType = IssueType.TASK,
        priority: Priority = Priority.MEDIUM,
        status_category: StatusCategory = StatusCategory.TODO,
        status_name: str | None = None,
        status_id: str | None = None,
        assignee_name: str | None = None,
        assignee_account_id: str | None = None,
        story_points: float | None = None,
        due_date: str | None = None,
        start_date: str | None = None,
        recreate_after: str | None = None,
        board_id: str | None = None,
        project_key: str | None = None,
        rank: str | None = None,
        rank_before_key: str | None = None,
    ) -> JiraIssue:
        """Create a new issue in memory."""
        if self.simulate_transition_failure or self.simulate_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)

        # Determine project prefix
        proj_prefix = project_key
        if not proj_prefix and board_id and not board_id.isdigit():
            proj_prefix = board_id.split("-")[0].upper()
        if not proj_prefix:
            proj_prefix = "PROJ"
            for k in self._issues:
                parts = k.split("-")
                if len(parts) == 2:
                    proj_prefix = parts[0]
                    break

        # Generate next key
        max_id = 100
        for k in self._issues:
            parts = k.split("-")
            if len(parts) == 2 and parts[1].isdigit():
                max_id = max(max_id, int(parts[1]))
        next_num = max_id + 1
        new_key = f"{proj_prefix}-{next_num}"

        matched_cat = status_category
        matched_name = status_name or "To Do"
        if status_name and not status_category:
            clean = status_name.strip().lower()
            for c, s in STATUS_MAP.items():
                if s.name.lower() == clean:
                    matched_cat = c
                    break

        status_id_val = status_id or f"col-{matched_cat.value}"
        status = JiraStatus(id=status_id_val, name=matched_name, category=matched_cat)

        assignee = None
        if assignee_name and assignee_name.strip():
            assignee = JiraUser(
                account_id=assignee_account_id or "usr-1",
                display_name=assignee_name.strip(),
            )

        # Highest rank calculation
        rank_val = rank
        if not rank_val and rank_before_key and rank_before_key in self._issues:
            target_issue = self._issues[rank_before_key]
            if target_issue.rank:
                base_r = target_issue.rank
                match = re.match(r"^(.*?)(\d+)(:*)$", base_r)
                if match:
                    num = int(match.group(2))
                    rank_val = (
                        f"{match.group(1)}{num - 1:05d}{match.group(3)}"
                        if num > 0
                        else f"{base_r[:-1]}0:"
                    )
                else:
                    rank_val = "0|00000:"
        if not rank_val:
            ranked = [i.rank for i in self._issues.values() if i.rank]
            if ranked:
                ranked.sort()
                base_r = ranked[0]
                match = re.match(r"^(.*?)(\d+)(:*)$", base_r)
                if match:
                    num = int(match.group(2))
                    rank_val = (
                        f"{match.group(1)}{num - 1:05d}{match.group(3)}"
                        if num > 0
                        else f"{base_r[:-1]}0:"
                    )
                else:
                    rank_val = "0|00000:"
            else:
                rank_val = "0|i00001:"

        new_issue = JiraIssue(
            id=str(next_num),
            key=new_key,
            summary=summary,
            description=description,
            url=f"https://jira.example.com/browse/{new_key}",
            issue_type=issue_type,
            priority=priority,
            status=status,
            assignee=assignee,
            story_points=story_points,
            due_date=due_date,
            start_date=start_date,
            recreate_after=recreate_after,
            rank=rank_val,
            created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            updated_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
        self._issues[new_key] = new_issue
        return new_issue

    async def get_assignable_users(
        self, board_id: str | None = None, project_key: str | None = None
    ) -> list[JiraUser]:
        """Fetch assignable users from known issues and defaults."""
        users_map: dict[str, JiraUser] = {}
        for issue in self._issues.values():
            if issue.assignee:
                users_map[issue.assignee.account_id] = issue.assignee
        if not users_map:
            users_map["usr-1"] = JiraUser(account_id="usr-1", display_name="Jacek Marchwicki")
            users_map["usr-2"] = JiraUser(account_id="usr-2", display_name="Alex Lead")
        return list(users_map.values())

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

        # Extract due date, start date & updated at
        raw_due_date = fields.get("duedate") or fields.get("due_date")
        raw_start_date = (
            fields.get("customfield_10015") or fields.get("startDate") or fields.get("start_date")
        )
        raw_recreate_after = (
            fields.get("customfield_10027")
            or fields.get("recreate_after")
            or fields.get("recreateAfter")
        )
        raw_created_at = fields.get("created") or fields.get("created_at")
        raw_updated_at = fields.get("updated") or fields.get("updated_at")
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        created_at = str(raw_created_at) if raw_created_at is not None else now_iso
        updated_at = str(raw_updated_at) if raw_updated_at is not None else now_iso

        # If issue already exists, update its status & summary
        existing = self._issues.get(issue_key)
        if existing:
            summary = fields.get("summary", existing.summary)
            due_date = str(raw_due_date) if raw_due_date is not None else existing.due_date
            start_date = str(raw_start_date) if raw_start_date is not None else existing.start_date
            recreate_after = (
                str(raw_recreate_after)
                if raw_recreate_after is not None
                else existing.recreate_after
            )
            updated = existing.model_copy(
                update={
                    "summary": summary,
                    "status": status,
                    "due_date": due_date,
                    "start_date": start_date,
                    "recreate_after": recreate_after,
                    "updated_at": updated_at,
                }
            )
            self._issues[issue_key] = updated
            return updated

        # Otherwise create new issue representation
        due_date = str(raw_due_date) if raw_due_date is not None else None
        start_date = str(raw_start_date) if raw_start_date is not None else None
        recreate_after = str(raw_recreate_after) if raw_recreate_after is not None else None
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
            recreate_after=recreate_after,
            created_at=created_at,
            updated_at=updated_at,
        )
        self._issues[issue_key] = new_issue
        return new_issue

    async def get_comments(self, issue_key: str) -> list[JiraComment]:
        """Fetch comments for a given issue."""
        if self.simulate_board_failure or self.simulate_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)
        if issue_key not in self._issues:
            raise JiraAPIError(f"Issue {issue_key} not found", status_code=404)
        return [c.model_copy(deep=True) for c in self._comments.get(issue_key, [])]

    async def add_comment(
        self, issue_key: str, body: str, author_name: str | None = None
    ) -> JiraComment:
        """Add a comment to an issue in memory."""
        if self.simulate_transition_failure or self.simulate_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)
        if issue_key not in self._issues:
            raise JiraAPIError(f"Issue {issue_key} not found", status_code=404)

        if not body.strip():
            raise JiraAPIError("Comment body cannot be empty", status_code=400)

        existing = self._comments.setdefault(issue_key, [])
        new_id = f"c-{len(existing) + 1}-{int(len(existing) * 17) + 1}"
        display = author_name.strip() if author_name and author_name.strip() else "Jacek Marchwicki"
        new_comment = JiraComment(
            id=new_id,
            author=JiraUser(
                account_id="usr-1",
                display_name=display,
                avatar_url=None,
            ),
            body=body.strip(),
            created="2026-10-05T00:00:00Z",
            updated=None,
        )
        existing.append(new_comment)
        return new_comment

    async def update_comment(self, issue_key: str, comment_id: str, body: str) -> JiraComment:
        """Update an existing comment."""
        if self.simulate_transition_failure or self.simulate_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)
        if issue_key not in self._issues:
            raise JiraAPIError(f"Issue {issue_key} not found", status_code=404)

        if not body.strip():
            raise JiraAPIError("Comment body cannot be empty", status_code=400)

        comments = self._comments.get(issue_key, [])
        for idx, c in enumerate(comments):
            if c.id == comment_id:
                updated = c.model_copy(
                    update={"body": body.strip(), "updated": "2026-10-05T00:01:00Z"}
                )
                comments[idx] = updated
                return updated

        raise JiraAPIError(f"Comment {comment_id} not found on issue {issue_key}", status_code=404)

    async def delete_comment(self, issue_key: str, comment_id: str) -> bool:
        """Delete an existing comment."""
        if self.simulate_transition_failure or self.simulate_failure:
            raise JiraAPIError(self.failure_message, status_code=self.failure_status_code)
        if issue_key not in self._issues:
            raise JiraAPIError(f"Issue {issue_key} not found", status_code=404)

        comments = self._comments.get(issue_key, [])
        for idx, c in enumerate(comments):
            if c.id == comment_id:
                comments.pop(idx)
                return True

        raise JiraAPIError(f"Comment {comment_id} not found on issue {issue_key}", status_code=404)
