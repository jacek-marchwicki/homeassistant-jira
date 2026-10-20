"""Model Context Protocol (MCP) Server for Home Assistant Jira Dashboard.

Exposes standard JSON-RPC 2.0 endpoints for Gemini, Claude, and other MCP clients:
- Streamable HTTP: POST /mcp
- SSE Transport: GET /sse and POST /messages?session_id=...
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any

from jira_dashboard.adapters import JiraClientProtocol, SQLiteStorage
from jira_dashboard.domain import IssueType, Priority, StatusCategory

logger = logging.getLogger(__name__)

MCP_PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "jira-dashboard-mcp"
SERVER_VERSION = "0.5.0"

AVAILABLE_TOOLS: list[dict[str, Any]] = [
    {
        "name": "jira_get_board",
        "description": "Retrieve the active sprint Jira board columns, backlog, and issues.",
        "inputSchema": {
            "type": "object",
            "properties": {},
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
    },
    {
        "name": "jira_create_issue",
        "description": "Create a new Jira issue/task on the board.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Summary or title of the issue",
                },
                "description": {
                    "type": "string",
                    "description": "Detailed description of the issue or task",
                },
                "issue_type": {
                    "type": "string",
                    "enum": ["Task", "Story", "Bug", "Epic", "Subtask"],
                    "description": "Issue type name (defaults to Task)",
                },
                "priority": {
                    "type": "string",
                    "enum": ["Lowest", "Low", "Medium", "High", "Highest"],
                    "description": "Priority level (defaults to Medium)",
                },
            },
            "required": ["summary"],
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
    },
]


class MCPServerHandler:
    """Handles JSON-RPC 2.0 processing for the Model Context Protocol."""

    def __init__(self, jira_client: JiraClientProtocol, storage: SQLiteStorage) -> None:
        self.jira_client = jira_client
        self.storage = storage
        self.sessions: dict[str, asyncio.Queue[str]] = {}

    def create_session(self) -> str:
        """Create a new SSE session ID and message queue."""
        session_id = str(uuid.uuid4())
        try:
            self.sessions[session_id] = asyncio.Queue()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self.sessions[session_id] = asyncio.Queue()
        return session_id

    def remove_session(self, session_id: str) -> None:
        """Clean up an SSE session."""
        self.sessions.pop(session_id, None)

    async def execute_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Execute a registered Jira MCP tool and return result."""
        if name == "jira_get_board":
            issues = self.storage.get_issues() or await self.jira_client.get_board_issues(
                "engineering-1"
            )
            meta = self.storage.get_board_meta("engineering-1")
            columns = meta["columns"] if meta and "columns" in meta else []
            return {
                "board_meta": {
                    "board_id": meta.get("board_id", "engineering-1") if meta else "engineering-1",
                    "board_name": meta.get("board_name", "Engineering Sprint Board")
                    if meta
                    else "Engineering Sprint Board",
                    "sprint_name": meta.get("sprint_name", "Active Sprint 42")
                    if meta
                    else "Active Sprint 42",
                },
                "columns": [c.model_dump() for c in columns],
                "issues": [i.model_dump(mode="json") for i in issues],
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
            return {"issues": [i.model_dump(mode="json") for i in filtered]}

        if name == "jira_get_issue":
            issue_key = arguments.get("issue_key", "")
            issue = self.storage.get_issue(issue_key) or await self.jira_client.get_issue(issue_key)
            if not issue:
                raise ValueError(f"Issue {issue_key} not found")
            return issue.model_dump(mode="json")

        if name == "jira_create_issue":
            summary = arguments.get("summary", "")
            description = arguments.get("description", "")
            issue_type_str = str(arguments.get("issue_type", "task")).lower().strip()
            priority_str = str(arguments.get("priority", "medium")).lower().strip()
            created = await self.jira_client.create_issue(
                summary=summary,
                description=description,
                issue_type=IssueType(issue_type_str),
                priority=Priority(priority_str),
            )
            self.storage.upsert_issue(created)
            return created.model_dump(mode="json")

        if name == "jira_transition_issue":
            issue_key = arguments.get("issue_key", "")
            target_category = arguments.get("target_category", "done")
            cat_enum = StatusCategory(target_category)
            transitioned = await self.jira_client.transition_issue(issue_key, cat_enum)
            self.storage.upsert_issue(transitioned)
            return transitioned.model_dump(mode="json")

        if name == "jira_add_comment":
            issue_key = arguments.get("issue_key", "")
            body = arguments.get("body", "")
            comment = await self.jira_client.add_comment(issue_key, body)
            # Reload issue to update comments cache
            issue = await self.jira_client.get_issue(issue_key)
            if issue:
                self.storage.upsert_issue(issue)
            return comment.model_dump(mode="json")

        raise ValueError(f"Unknown tool: {name}")

    async def handle_jsonrpc(self, request_data: dict[str, Any]) -> dict[str, Any] | None:
        """Process an incoming JSON-RPC 2.0 payload according to MCP specification."""
        msg_id = request_data.get("id")
        method = request_data.get("method")
        params = request_data.get("params") or {}

        # Notification handling (no response required)
        if method == "notifications/initialized":
            return None

        # Standard methods
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {
                        "name": SERVER_NAME,
                        "version": SERVER_VERSION,
                    },
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
                tool_output = await self.execute_tool(tool_name, tool_args)
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
