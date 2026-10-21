"""Model Context Protocol (MCP) Server for Home Assistant Jira Dashboard.

Exposes standard JSON-RPC 2.0 endpoints for Gemini, Claude, and other MCP clients:
- Streamable HTTP: POST /mcp
- SSE Transport: GET /sse and POST /messages?session_id=...
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from jira_dashboard import __version__
from jira_dashboard.adapters import JiraClientProtocol, SQLiteStorage
from jira_dashboard.domain import (
    IssueType,
    JiraIssue,
    JiraUser,
    Priority,
    StatusCategory,
    compute_top_rank_and_before_key,
    issue_sort_key,
)

logger = logging.getLogger(__name__)

MCP_PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "home-tasks-manager"
SERVER_VERSION = __version__

AVAILABLE_TOOLS: list[dict[str, Any]] = [
    {
        "name": "jira_get_board",
        "description": (
            "Retrieve tasks from the board formatted as on the People board, grouped by "
            "person/assignee. Defaults to showing active tasks (start_date <= today) and "
            "hiding epics and child account tasks. Returns start_date, due_date, end_date, "
            "recreate_after, and dashboard task URLs."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "username": {
                    "type": "string",
                    "description": (
                        "Filter tasks for a specific user (by name, account ID, or 'unassigned')"
                    ),
                },
                "active_only": {
                    "type": "boolean",
                    "default": True,
                    "description": (
                        "Hide future tasks where start_date is after today (default: true)"
                    ),
                },
                "hide_epics": {
                    "type": "boolean",
                    "default": True,
                    "description": "Hide Epic issue types (default: true)",
                },
                "show_child_tasks": {
                    "type": "boolean",
                    "default": False,
                    "description": "Show tasks assigned to child accounts (default: false)",
                },
                "search": {
                    "type": "string",
                    "description": "Optional substring to filter tasks by summary or key",
                },
                "include_all_done": {
                    "type": "boolean",
                    "default": False,
                    "description": (
                        "Include Done tasks completed more than 24 hours ago (default: false)"
                    ),
                },
            },
        },
        "annotations": {
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    },
    {
        "name": "jira_list_users",
        "description": (
            "List all known and assignable users on the task board, with their display names, "
            "account IDs, and account types (parent/child)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "search": {
                    "type": "string",
                    "description": "Optional substring to filter users by display name",
                },
            },
        },
        "annotations": {
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    },
    {
        "name": "jira_create_issue",
        "description": (
            "Create a new task/issue on the board with full GUI options and defaults. "
            "Defaults: issue_type='Task', priority='Medium', status='To Do'."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Summary or title of the issue (required)",
                },
                "description": {
                    "type": "string",
                    "description": "Detailed description or markdown content",
                },
                "issue_type": {
                    "type": "string",
                    "enum": ["Task", "Story", "Bug", "Epic", "Subtask"],
                    "default": "Task",
                    "description": "Issue type (defaults to Task)",
                },
                "priority": {
                    "type": "string",
                    "enum": ["Lowest", "Low", "Medium", "High", "Highest"],
                    "default": "Medium",
                    "description": "Priority level (defaults to Medium)",
                },
                "assignee": {
                    "type": "string",
                    "description": "Assignee username, display name, or account ID",
                },
                "status": {
                    "type": "string",
                    "default": "To Do",
                    "description": "Initial status name (defaults to 'To Do')",
                },
                "start_date": {
                    "type": "string",
                    "description": "Start date in YYYY-MM-DD format",
                },
                "due_date": {
                    "type": "string",
                    "description": "Due / end date in YYYY-MM-DD format",
                },
                "end_date": {
                    "type": "string",
                    "description": "Alias for due_date (YYYY-MM-DD)",
                },
                "recreate_after": {
                    "type": "string",
                    "description": (
                        "Recurring schedule interval (e.g. '1d', '1w', '2w', '1m', '1y')"
                    ),
                },
            },
            "required": ["summary"],
        },
        "annotations": {
            "readOnlyHint": False,
            "destructiveHint": False,
            "idempotentHint": False,
            "openWorldHint": False,
        },
    },
    {
        "name": "jira_assign_issue",
        "description": (
            "Assign or reassign an issue to a user by username/display name or account ID, "
            "or unassign it by passing an empty string or 'unassigned'."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "issue_key": {
                    "type": "string",
                    "description": "Jira issue key (e.g. HOME-11635)",
                },
                "assignee": {
                    "type": "string",
                    "description": (
                        "Username, display name, or account ID of the new assignee. "
                        "Pass empty string or 'unassigned' to unassign."
                    ),
                },
            },
            "required": ["issue_key", "assignee"],
        },
        "annotations": {
            "readOnlyHint": False,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    },
    {
        "name": "jira_list_issues",
        "description": "List all issues on the Jira board with optional category filtering.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["todo", "in_progress", "done"],
                    "description": "Filter issues by status category",
                },
                "search": {
                    "type": "string",
                    "description": "Optional substring to filter issue summaries",
                },
            },
        },
        "annotations": {
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    },
    {
        "name": "jira_get_issue",
        "description": "Retrieve full details and comments for an issue by key (e.g. PROJ-101).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "issue_key": {
                    "type": "string",
                    "description": "Jira issue key (e.g. PROJ-101)",
                },
            },
            "required": ["issue_key"],
        },
        "annotations": {
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    },
    {
        "name": "jira_transition_issue",
        "description": "Transition an issue to a target category (todo, in_progress, done).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "issue_key": {
                    "type": "string",
                    "description": "Jira issue key (e.g. PROJ-101)",
                },
                "target_category": {
                    "type": "string",
                    "enum": ["todo", "in_progress", "done"],
                    "description": "Target status category",
                },
            },
            "required": ["issue_key", "target_category"],
        },
        "annotations": {
            "readOnlyHint": False,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
    },
    {
        "name": "jira_add_comment",
        "description": "Add a text comment to an existing Jira issue.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "issue_key": {
                    "type": "string",
                    "description": "Jira issue key (e.g. PROJ-101)",
                },
                "body": {
                    "type": "string",
                    "description": "Text body of the comment",
                },
            },
            "required": ["issue_key", "body"],
        },
        "annotations": {
            "readOnlyHint": False,
            "destructiveHint": False,
            "idempotentHint": False,
            "openWorldHint": False,
        },
    },
]


class MCPServerHandler:
    """Handles JSON-RPC 2.0 processing for the Model Context Protocol."""

    def __init__(
        self,
        jira_client: JiraClientProtocol,
        storage: SQLiteStorage,
        base_url: str = "",
        broadcast_func: Any = None,
        on_issue_created: Any = None,
    ) -> None:
        self.jira_client = jira_client
        self.storage = storage
        self.base_url = base_url
        self.broadcast_func = broadcast_func
        self.on_issue_created = on_issue_created
        self.sessions: dict[str, asyncio.Queue[str]] = {}

    def _create_queue(self) -> asyncio.Queue[str]:
        try:
            return asyncio.Queue()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            return asyncio.Queue()

    def create_session(self) -> str:
        """Create a new SSE session ID and message queue."""
        session_id = str(uuid.uuid4())
        self.sessions[session_id] = self._create_queue()
        return session_id

    def get_or_create_session(self, session_id: str) -> asyncio.Queue[str]:
        """Retrieve existing session queue or create a new one."""
        if session_id not in self.sessions:
            self.sessions[session_id] = self._create_queue()
        return self.sessions[session_id]

    def remove_session(self, session_id: str) -> None:
        """Clean up an SSE session."""
        self.sessions.pop(session_id, None)

    def format_issue(self, issue: JiraIssue, base_url: str = "") -> dict[str, Any]:
        """Format a JiraIssue into standard MCP dictionary with Dashboard task URL."""
        host = (base_url or self.base_url or "http://localhost:8000").rstrip("/")
        dashboard_url = f"{host}/task/{issue.key}"
        return {
            "key": issue.key,
            "summary": issue.summary,
            "description": issue.description or "",
            "url": dashboard_url,
            "status": {
                "name": issue.status.name,
                "category": issue.status.category.value,
            },
            "status_name": issue.status.name,
            "status_category": issue.status.category.value,
            "priority": (
                issue.priority.value
                if hasattr(issue.priority, "value")
                else str(issue.priority).lower()
            ),
            "issue_type": (
                issue.issue_type.value
                if hasattr(issue.issue_type, "value")
                else str(issue.issue_type).lower()
            ),
            "assignee": issue.assignee.display_name if issue.assignee else "Unassigned",
            "assignee_account_id": issue.assignee.account_id if issue.assignee else None,
            "start_date": issue.start_date,
            "due_date": issue.due_date,
            "end_date": issue.due_date,
            "recreate_after": issue.recreate_after,
            "rank": issue.rank,
        }

    async def get_known_users(self) -> list[dict[str, Any]]:
        """Retrieve all known and assignable users with account types (parent/child)."""
        users_map: dict[str, JiraUser] = {}
        for issue in self.storage.get_issues():
            if issue.assignee and issue.assignee.account_id:
                users_map[issue.assignee.account_id] = issue.assignee

        try:
            client_users = await self.jira_client.get_assignable_users()
            for u in client_users:
                if u.account_id:
                    users_map[u.account_id] = u
        except Exception as exc:
            logger.debug("Failed fetching client users: %s", exc)

        account_types = self.storage.get_account_types()
        result: list[dict[str, Any]] = []
        for u in users_map.values():
            key = u.display_name.strip().lower()
            acc_type = account_types.get(key, "parent")
            result.append(
                {
                    "display_name": u.display_name,
                    "account_id": u.account_id,
                    "account_type": acc_type,
                }
            )
        # Sort alphabetically by display name
        result.sort(key=lambda x: x["display_name"].lower())
        return result

    async def execute_tool(
        self, name: str, arguments: dict[str, Any], base_url: str = ""
    ) -> dict[str, Any]:
        """Execute a registered Jira MCP tool and return result."""
        effective_base = base_url or self.base_url

        if name == "jira_list_users":
            users = await self.get_known_users()
            search = str(arguments.get("search", "")).strip().lower()
            if search:
                users = [u for u in users if search in u["display_name"].lower()]
            return {"users": users}

        if name == "jira_get_board":
            issues = self.storage.get_issues() or await self.jira_client.get_board_issues(
                "engineering-1"
            )
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            now_ts = time.time()
            account_types = self.storage.get_account_types()

            # Filter options
            active_only = arguments.get("active_only", True)
            hide_epics = arguments.get("hide_epics", True)
            show_child_tasks = arguments.get("show_child_tasks", False)
            include_all_done = arguments.get("include_all_done", False)
            user_filter = str(arguments.get("username") or arguments.get("user") or "").strip()
            search = str(arguments.get("search", "")).strip().lower()

            filtered: list[JiraIssue] = []
            for issue in issues:
                # 1. Epics filter
                if hide_epics:
                    itype = (
                        issue.issue_type.value
                        if hasattr(issue.issue_type, "value")
                        else str(issue.issue_type)
                    ).lower()
                    if itype == "epic":
                        continue

                # 2. Active filter (start_date <= today)
                if active_only and issue.start_date:
                    if str(issue.start_date).strip() > today:
                        continue

                # 3. Child account filter
                if not show_child_tasks and issue.assignee:
                    child_key = issue.assignee.display_name.strip().lower()
                    is_child = account_types.get(child_key) == "child"
                    if is_child and (not user_filter or user_filter.lower() not in child_key):
                        continue

                # 4. Done within 24h filter (unless include_all_done=True)
                if not include_all_done and issue.is_done():
                    if (now_ts - issue.updated_at_epoch()) > 86400:
                        continue

                # 5. User filter
                if user_filter:
                    u_clean = user_filter.lower()
                    if u_clean in ("unassigned", "none"):
                        if issue.assignee is not None:
                            continue
                    else:
                        if not issue.assignee:
                            continue
                        name_match = u_clean in issue.assignee.display_name.lower()
                        id_match = u_clean == issue.assignee.account_id.lower()
                        if not (name_match or id_match):
                            continue

                # 6. Text search filter
                if search:
                    matches_summary = search in (issue.summary or "").lower()
                    matches_key = search in (issue.key or "").lower()
                    matches_desc = search in (issue.description or "").lower()
                    if not (matches_summary or matches_key or matches_desc):
                        continue

                filtered.append(issue)

            # Sort filtered issues by board rank & updated order
            filtered.sort(key=issue_sort_key)

            # Group issues by person matching the People board columns
            known_users = await self.get_known_users()
            people_groups: dict[str, dict[str, Any]] = {}
            for u in known_users:
                people_groups[u["account_id"]] = {
                    "display_name": u["display_name"],
                    "account_id": u["account_id"],
                    "account_type": u["account_type"],
                    "task_count": 0,
                    "tasks": [],
                }
            unassigned_group: dict[str, Any] = {
                "display_name": "Unassigned",
                "account_id": None,
                "account_type": "parent",
                "task_count": 0,
                "tasks": [],
            }

            for issue in filtered:
                formatted = self.format_issue(issue, effective_base)
                if issue.assignee and issue.assignee.account_id in people_groups:
                    people_groups[issue.assignee.account_id]["tasks"].append(formatted)
                    people_groups[issue.assignee.account_id]["task_count"] += 1
                elif issue.assignee:
                    # Dynamically add person if not in known users
                    acc_type = account_types.get(
                        issue.assignee.display_name.strip().lower(), "parent"
                    )
                    people_groups[issue.assignee.account_id] = {
                        "display_name": issue.assignee.display_name,
                        "account_id": issue.assignee.account_id,
                        "account_type": acc_type,
                        "task_count": 1,
                        "tasks": [formatted],
                    }
                else:
                    unassigned_group["tasks"].append(formatted)
                    unassigned_group["task_count"] += 1

            # Include only people who have tasks, or who match the specific user filter
            visible_people = [
                p
                for p in people_groups.values()
                if p["task_count"] > 0
                or (user_filter and user_filter.lower() in p["display_name"].lower())
            ]
            if unassigned_group["task_count"] > 0 or (
                user_filter and user_filter.lower() in ("unassigned", "none")
            ):
                visible_people.append(unassigned_group)

            formatted_tasks = [self.format_issue(i, effective_base) for i in filtered]
            return {
                "board_name": "Home Tasks Manager",
                "filters_applied": {
                    "active_only": active_only,
                    "hide_epics": hide_epics,
                    "show_child_tasks": show_child_tasks,
                    "user_filter": user_filter or None,
                    "search": search or None,
                },
                "total_tasks": len(formatted_tasks),
                "people": visible_people,
                "tasks": formatted_tasks,
                "issues": formatted_tasks,
            }

        if name == "jira_list_issues":
            issues = self.storage.get_issues() or await self.jira_client.get_board_issues(
                "engineering-1"
            )
            category = arguments.get("category")
            search = arguments.get("search", "").lower().strip()
            filtered = issues
            if category:
                filtered = [i for i in filtered if i.status.category.value == category]
            if search:
                filtered = [i for i in filtered if search in i.summary.lower()]
            return {"issues": [self.format_issue(i, effective_base) for i in filtered]}

        if name == "jira_get_issue":
            issue_key = arguments.get("issue_key", "")
            issue = self.storage.get_issue(issue_key) or await self.jira_client.get_issue(issue_key)
            if not issue:
                raise ValueError(f"Issue {issue_key} not found")
            return self.format_issue(issue, effective_base)

        if name == "jira_create_issue":
            summary = arguments.get("summary", "")
            description = arguments.get("description", "")
            issue_type_str = str(arguments.get("issue_type", "task")).lower().strip()
            priority_str = str(arguments.get("priority", "medium")).lower().strip()
            status_name = str(arguments.get("status", "To Do")).strip()
            start_date = arguments.get("start_date")
            due_date = arguments.get("due_date") or arguments.get("end_date")
            recreate_after = arguments.get("recreate_after")
            assignee_arg = arguments.get("assignee")

            assignee_name: str | None = None
            assignee_account_id: str | None = None
            if assignee_arg:
                known = await self.get_known_users()
                clean = str(assignee_arg).strip().lower()
                matched_user = next(
                    (
                        u
                        for u in known
                        if u["account_id"].lower() == clean
                        or u["display_name"].lower() == clean
                        or clean in u["display_name"].lower()
                    ),
                    None,
                )
                if matched_user:
                    assignee_name = matched_user["display_name"]
                    assignee_account_id = matched_user["account_id"]
                else:
                    assignee_name = str(assignee_arg).strip()

            existing_issues = self.storage.get_issues()
            if not existing_issues:
                try:
                    existing_issues = await self.jira_client.get_board_issues("1")
                except Exception:
                    existing_issues = []

            top_rank, rank_before_key = compute_top_rank_and_before_key(existing_issues)

            created = await self.jira_client.create_issue(
                summary=summary,
                description=description,
                issue_type=IssueType(issue_type_str),
                priority=Priority(priority_str),
                status_name=status_name,
                assignee_name=assignee_name,
                assignee_account_id=assignee_account_id,
                start_date=start_date,
                due_date=due_date,
                recreate_after=recreate_after,
                rank=top_rank,
                rank_before_key=rank_before_key,
            )
            self.storage.upsert_issue(created)

            if self.on_issue_created:
                res = self.on_issue_created(created)
                if asyncio.iscoroutine(res):
                    await res

            if self.broadcast_func:
                await self.broadcast_func(
                    {
                        "event": "issue_created",
                        "issue": created.model_dump(),
                    }
                )

            return self.format_issue(created, effective_base)

        if name == "jira_assign_issue":
            issue_key = arguments.get("issue_key", "")
            assignee_arg = str(arguments.get("assignee", "")).strip()

            issue = self.storage.get_issue(issue_key) or await self.jira_client.get_issue(issue_key)
            if not issue:
                raise ValueError(f"Issue {issue_key} not found")

            if assignee_arg.lower() in ("", "unassigned", "none"):
                assignee_name = ""
                assignee_account_id = None
            else:
                known = await self.get_known_users()
                clean = assignee_arg.lower()
                matched_user = next(
                    (
                        u
                        for u in known
                        if u["account_id"].lower() == clean
                        or u["display_name"].lower() == clean
                        or clean in u["display_name"].lower()
                    ),
                    None,
                )
                if matched_user:
                    assignee_name = matched_user["display_name"]
                    assignee_account_id = matched_user["account_id"]
                else:
                    assignee_name = assignee_arg
                    assignee_account_id = None

            updated = await self.jira_client.update_issue(
                issue_key=issue_key,
                assignee_name=assignee_name,
                assignee_account_id=assignee_account_id,
            )
            self.storage.upsert_issue(updated)
            return self.format_issue(updated, effective_base)

        if name == "jira_transition_issue":
            issue_key = arguments.get("issue_key", "")
            target_category = arguments.get("target_category", "done")
            cat_enum = StatusCategory(target_category)
            transitioned = await self.jira_client.transition_issue(issue_key, cat_enum)
            self.storage.upsert_issue(transitioned)
            return self.format_issue(transitioned, effective_base)

        if name == "jira_add_comment":
            issue_key = arguments.get("issue_key", "")
            body = arguments.get("body", "")
            comment = await self.jira_client.add_comment(issue_key, body)
            issue = await self.jira_client.get_issue(issue_key)
            if issue:
                self.storage.upsert_issue(issue)
            result = comment.model_dump(mode="json")
            host = (effective_base or "http://localhost:8000").rstrip("/")
            result["issue_url"] = f"{host}/task/{issue_key}"
            return result

        raise ValueError(f"Unknown tool: {name}")

    async def handle_jsonrpc(
        self, request_data: dict[str, Any], base_url: str = ""
    ) -> dict[str, Any] | None:
        """Process an incoming JSON-RPC 2.0 payload according to MCP specification."""
        effective_base = base_url or self.base_url
        msg_id = request_data.get("id")
        method = request_data.get("method")
        params = request_data.get("params") or {}

        # Notification handling (no response required)
        if method == "notifications/initialized":
            return None

        # Standard methods
        if method == "initialize":
            client_version = params.get("protocolVersion") or MCP_PROTOCOL_VERSION
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": client_version,
                    "capabilities": {
                        "tools": {"listChanged": False},
                    },
                    "serverInfo": {
                        "name": SERVER_NAME,
                        "version": SERVER_VERSION,
                    },
                    "instructions": (
                        "Home Tasks Manager MCP server for Home Assistant and Google Cloud."
                    ),
                },
            }

        if method == "ping":
            return {"jsonrpc": "2.0", "id": msg_id, "result": {}}

        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {"tools": AVAILABLE_TOOLS},
            }

        if method == "tools/call":
            tool_name = params.get("name", "")
            tool_args = params.get("arguments") or {}
            try:
                tool_output = await self.execute_tool(tool_name, tool_args, base_url=effective_base)
                return {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps(tool_output, indent=2),
                            }
                        ],
                        "isError": False,
                    },
                }
            except Exception as exc:
                logger.error("Error executing MCP tool %s: %s", tool_name, exc, exc_info=True)
                return {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": f"Error: {exc}",
                            }
                        ],
                        "isError": True,
                    },
                }

        # Unknown method error
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "error": {
                "code": -32601,
                "message": f"Method not found: {method}",
            },
        }
