"""Unit tests for Model Context Protocol (MCP) server endpoints.

Tests:
- MCP JSON-RPC 2.0 protocol over Streamable HTTP (/mcp)
- MCP SSE transport (GET /sse and POST /messages)
- Jira tool executions (jira_get_board, jira_list_issues, jira_get_issue,
  jira_create_issue, jira_transition_issue, jira_add_comment)
- Authentication enforcement on MCP endpoints
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from jira_dashboard.presentation.main import app


def test_mcp_create_issue_lands_on_top_with_existing_issues() -> None:
    """Verify that creating an issue via MCP when existing issues exist places it at the top."""
    client = TestClient(app)

    # 1. Initialize MCP session
    client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "2024-11-05"},
        },
    )

    # 2. Create first task
    resp1 = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "jira_create_issue",
                "arguments": {
                    "summary": "First Task Created",
                    "priority": "Medium",
                },
            },
        },
    )
    assert resp1.status_code == 200
    res1 = json.loads(resp1.json()["result"]["content"][0]["text"])
    key1 = res1["key"]

    # 3. Create second task (should land on TOP of first task)
    resp2 = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "jira_create_issue",
                "arguments": {
                    "summary": "Second Task Created Should Land On Top",
                    "priority": "High",
                },
            },
        },
    )
    assert resp2.status_code == 200
    res2 = json.loads(resp2.json()["result"]["content"][0]["text"])
    key2 = res2["key"]

    # Fetch board and verify key2 is at index 0 (top)
    board_res = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {"name": "jira_get_board", "arguments": {}},
        },
    )
    assert board_res.status_code == 200
    board_data = json.loads(board_res.json()["result"]["content"][0]["text"])
    issue_keys = [i["key"] for i in board_data["issues"]]
    assert issue_keys[0] == key2
    assert key1 in issue_keys
    assert res2.get("rank") is not None
    assert res1.get("rank") is not None
    assert res2["rank"] < res1["rank"]


def test_mcp_handler_create_issue_calls_jira_client_with_rank_and_broadcasts() -> None:
    """Verify MCPServerHandler computes top rank, passes rank_before_key, and triggers broadcast."""
    import asyncio
    from unittest.mock import AsyncMock, MagicMock

    from jira_dashboard.domain.models import (
        IssueType,
        JiraIssue,
        JiraStatus,
        Priority,
        StatusCategory,
    )
    from jira_dashboard.presentation.mcp import MCPServerHandler

    async def _test() -> None:
        mock_client = MagicMock()
        existing_issue = JiraIssue(
            id="101",
            key="PROJ-101",
            summary="Existing Top Task",
            priority=Priority.MEDIUM,
            issue_type=IssueType.TASK,
            status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
            rank="0|i00001:",
            updated_at="2026-10-21T00:00:00Z",
        )
        mock_client.get_board_issues = AsyncMock(return_value=[existing_issue])

        created_issue = JiraIssue(
            id="102",
            key="PROJ-102",
            summary="New MCP Task",
            priority=Priority.HIGH,
            issue_type=IssueType.TASK,
            status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
            rank="0|i00000:",
            updated_at="2026-10-21T00:00:00Z",
        )
        mock_client.create_issue = AsyncMock(return_value=created_issue)

        mock_storage = MagicMock()
        mock_storage.get_issues = MagicMock(return_value=[existing_issue])

        broadcast_mock = AsyncMock()

        handler = MCPServerHandler(
            jira_client=mock_client,
            storage=mock_storage,
            broadcast_func=broadcast_mock,
        )

        result = await handler.execute_tool(
            "jira_create_issue",
            {"summary": "New MCP Task", "priority": "High"},
        )
        assert result is not None

        # Verify rank and rank_before_key were passed to jira_client.create_issue
        mock_client.create_issue.assert_awaited_once()
        _, kwargs = mock_client.create_issue.call_args
        assert "rank" in kwargs and kwargs["rank"] is not None
        assert kwargs["rank"] < "0|i00001:"
        assert kwargs.get("rank_before_key") == "PROJ-101"

        # Verify broadcast was called with issue_created event
        broadcast_mock.assert_awaited_once()
        event_data = broadcast_mock.call_args[0][0]
        assert event_data["event"] == "issue_created"
        assert event_data["issue"]["key"] == "PROJ-102"

    asyncio.run(_test())

    """Verify standard MCP lifecycle via Streamable HTTP POST /mcp."""
    client = TestClient(app)

    # 1. initialize
    init_payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "test-client", "version": "1.0"},
        },
    }
    resp = client.post("/mcp", json=init_payload)
    assert resp.status_code == 200
    assert "mcp-session-id" in resp.headers
    assert "mcp-protocol-version" in resp.headers
    assert resp.headers["mcp-protocol-version"] == "2024-11-05"
    session_id = resp.headers["mcp-session-id"]
    data = resp.json()
    assert data["jsonrpc"] == "2.0"
    assert data["id"] == 1
    assert "result" in data
    assert data["result"]["protocolVersion"] == "2024-11-05"
    assert data["result"]["serverInfo"]["name"] == "home-tasks-manager"
    assert "tools" in data["result"]["capabilities"]

    # 1b. notifications/initialized (returns 202 Accepted per Streamable HTTP spec)
    notif_payload = {"jsonrpc": "2.0", "method": "notifications/initialized"}
    resp_notif = client.post("/mcp", json=notif_payload, headers={"Mcp-Session-Id": session_id})
    assert resp_notif.status_code == 202

    # 2. ping
    ping_payload = {"jsonrpc": "2.0", "id": 2, "method": "ping"}
    resp = client.post("/mcp", json=ping_payload)
    assert resp.status_code == 200
    assert resp.json()["result"] == {}

    # 3. tools/list
    tools_payload = {"jsonrpc": "2.0", "id": 3, "method": "tools/list"}
    resp = client.post("/mcp", json=tools_payload)
    assert resp.status_code == 200
    tools = resp.json()["result"]["tools"]
    tool_names = [t["name"] for t in tools]
    assert "home_tasks_get_board" in tool_names
    assert "home_tasks_list_users" in tool_names
    assert "home_tasks_list_tasks" in tool_names
    assert "home_tasks_get_task" in tool_names
    assert "home_tasks_create_task" in tool_names
    assert "home_tasks_edit_task" in tool_names
    assert "home_tasks_assign_task" in tool_names
    assert "home_tasks_transition_task" in tool_names
    assert "home_tasks_add_comment" in tool_names

    # Jira must not be mentioned anywhere in tool names or schemas
    for t in tools:
        assert not t["name"].startswith("jira_")
        serialized = json.dumps(t).lower()
        assert "jira" not in serialized, f"Tool {t['name']} mentions Jira: {serialized}"

    # Verify annotations on all tools
    for t in tools:
        assert "annotations" in t
        ann = t["annotations"]
        assert "readOnlyHint" in ann
        assert "destructiveHint" in ann
        assert "idempotentHint" in ann
        assert ann["openWorldHint"] is False

    # 4. tools/call -> home_tasks_get_board
    call_payload = {
        "jsonrpc": "2.0",
        "id": 4,
        "method": "tools/call",
        "params": {"name": "home_tasks_get_board", "arguments": {}},
    }
    resp = client.post("/mcp", json=call_payload)
    assert resp.status_code == 200
    res = resp.json()["result"]
    assert "content" in res
    assert len(res["content"]) > 0
    text_content = res["content"][0]["text"]
    board_data = json.loads(text_content)
    assert "tasks" in board_data

    # 5. tools/call -> home_tasks_create_task
    create_payload = {
        "jsonrpc": "2.0",
        "id": 5,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_create_task",
            "arguments": {
                "summary": "Clean the kitchen counter",
                "description": "Wipe surfaces and empty dishwasher",
                "task_type": "Task",
                "priority": "Medium",
            },
        },
    }
    resp = client.post("/mcp", json=create_payload)
    assert resp.status_code == 200
    create_res = json.loads(resp.json()["result"]["content"][0]["text"])
    assert "key" in create_res
    created_key = create_res["key"]

    # Verify newly created issue appears by default at the TOP of the board
    board_after = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 50,
            "method": "tools/call",
            "params": {"name": "home_tasks_get_board", "arguments": {}},
        },
    )
    assert board_after.status_code == 200
    board_after_data = json.loads(board_after.json()["result"]["content"][0]["text"])
    assert board_after_data["issues"][0]["key"] == created_key
    assert create_res.get("rank") is not None
    if len(board_after_data["issues"]) > 1:
        second_rank = board_after_data["issues"][1].get("rank")
        if second_rank:
            assert create_res["rank"] < second_rank

    # 5b. tools/call -> home_tasks_edit_task
    edit_payload = {
        "jsonrpc": "2.0",
        "id": 51,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_edit_task",
            "arguments": {
                "task_key": created_key,
                "summary": "Clean and sanitize kitchen counter",
                "priority": "High",
                "due_date": "2026-10-31",
            },
        },
    }
    resp_edit = client.post("/mcp", json=edit_payload)
    assert resp_edit.status_code == 200
    edit_res = json.loads(resp_edit.json()["result"]["content"][0]["text"])
    assert edit_res["key"] == created_key
    assert edit_res["summary"] == "Clean and sanitize kitchen counter"
    assert edit_res["priority"].lower() == "high"
    assert edit_res["due_date"] == "2026-10-31"

    # 6. tools/call -> home_tasks_get_task
    get_payload = {
        "jsonrpc": "2.0",
        "id": 6,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_get_task",
            "arguments": {"task_key": created_key},
        },
    }
    resp = client.post("/mcp", json=get_payload)
    assert resp.status_code == 200
    get_res = json.loads(resp.json()["result"]["content"][0]["text"])
    assert get_res["key"] == created_key
    assert get_res["summary"] == "Clean and sanitize kitchen counter"

    # 7. tools/call -> home_tasks_transition_task
    trans_payload = {
        "jsonrpc": "2.0",
        "id": 7,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_transition_task",
            "arguments": {"task_key": created_key, "target_category": "done"},
        },
    }
    resp = client.post("/mcp", json=trans_payload)
    assert resp.status_code == 200
    trans_res = json.loads(resp.json()["result"]["content"][0]["text"])
    assert trans_res["status"]["category"] == "done"

    # 8. tools/call -> home_tasks_add_comment
    comment_payload = {
        "jsonrpc": "2.0",
        "id": 8,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_add_comment",
            "arguments": {"task_key": created_key, "body": "Finished ahead of schedule!"},
        },
    }
    resp = client.post("/mcp", json=comment_payload)
    assert resp.status_code == 200
    comment_res = json.loads(resp.json()["result"]["content"][0]["text"])
    assert comment_res["body"] == "Finished ahead of schedule!"

    # 9. Verify backwards compatibility aliases: calling legacy jira_* names still works
    legacy_payload = {
        "jsonrpc": "2.0",
        "id": 9,
        "method": "tools/call",
        "params": {
            "name": "jira_get_issue",
            "arguments": {"issue_key": created_key},
        },
    }
    resp_legacy = client.post("/mcp", json=legacy_payload)
    assert resp_legacy.status_code == 200
    legacy_res = json.loads(resp_legacy.json()["result"]["content"][0]["text"])
    assert legacy_res["key"] == created_key


def test_mcp_streamable_http_sse_and_delete() -> None:
    """Verify Streamable HTTP GET /mcp SSE streaming and DELETE /mcp teardown."""
    import asyncio

    from starlette.requests import Request

    from jira_dashboard.presentation.main import mcp_endpoint, mcp_handler

    client = TestClient(app)
    test_session = "test-streamable-session-1"

    # Pre-populate session
    queue = mcp_handler.get_or_create_session(test_session)
    assert test_session in mcp_handler.sessions

    # Verify that streamable event generator yields message without legacy endpoint
    async def _test_gen() -> None:
        await queue.put(json.dumps({"jsonrpc": "2.0", "method": "notifications/test"}))

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/mcp",
            "headers": [
                (b"accept", b"text/event-stream"),
                (b"mcp-session-id", test_session.encode("utf-8")),
                (b"mcp-protocol-version", b"2025-11-25"),
            ],
        }
        req = Request(scope)
        resp = await mcp_endpoint(req)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "text/event-stream"
        assert resp.headers["mcp-session-id"] == test_session
        assert resp.headers["mcp-protocol-version"] == "2025-11-25"

        first_chunk = await resp.body_iterator.__anext__()
        assert first_chunk == ": ping\n\n"
        second_chunk = await resp.body_iterator.__anext__()
        assert "event: endpoint" not in second_chunk
        assert "event: message" in second_chunk
        await resp.body_iterator.aclose()

    asyncio.run(_test_gen())

    # DELETE /mcp
    del_resp = client.delete(
        "/mcp",
        headers={"Mcp-Session-Id": test_session},
    )
    assert del_resp.status_code == 200
    assert test_session not in mcp_handler.sessions


def test_mcp_sse_transport() -> None:
    """Verify legacy/SSE transport endpoints (GET /sse and POST /messages)."""
    client = TestClient(app)

    # 1. Create a session and verify POST /messages
    from jira_dashboard.presentation.main import mcp_handler

    session_id = mcp_handler.create_session()
    messages_endpoint = f"/messages?session_id={session_id}"

    resp = client.post(
        messages_endpoint,
        json={"jsonrpc": "2.0", "id": 10, "method": "ping"},
    )
    assert resp.status_code == 200
    assert resp.json()["result"] == {}

    # Verify message was queued for SSE delivery
    queue = mcp_handler.sessions.get(session_id)
    assert queue is not None
    assert not queue.empty()
    queued_item = json.loads(queue.get_nowait())
    assert queued_item["id"] == 10
    assert queued_item["result"] == {}
    mcp_handler.remove_session(session_id)


def test_mcp_auth_protection(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify MCP endpoints enforce Google OAuth authentication when enabled."""
    monkeypatch.setenv("AUTH_MODE", "gcp_oauth")
    monkeypatch.setenv("ALLOWED_EMAILS", "authorized@example.com")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "mock-client-id")

    client = TestClient(app)

    # 1. HEAD /mcp -> 200 OK (pre-flight reachability probe)
    resp_head = client.head("/mcp")
    assert resp_head.status_code == 200

    # 2. GET /mcp -> 200 OK (server status)
    resp_get = client.get("/mcp")
    assert resp_get.status_code == 200
    assert resp_get.json()["name"] == "home-tasks-manager"

    # 3. Unauthenticated discovery (initialize, ping, tools/list) -> 200
    resp_init = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    assert resp_init.status_code == 200
    assert "protocolVersion" in resp_init.json()["result"]

    resp_tools = client.post("/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert resp_tools.status_code == 200
    assert "tools" in resp_tools.json()["result"]

    # 4. Protected tool execution (tools/call) without auth -> 401 with RFC 9728 challenge
    call_payload = {
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {"name": "jira_get_board", "arguments": {}},
    }
    resp = client.post("/mcp", json=call_payload)
    assert resp.status_code == 401
    assert "www-authenticate" in resp.headers
    www_auth = resp.headers["www-authenticate"]
    assert 'realm="mcp"' in www_auth
    assert "resource_metadata=" in www_auth
    assert ".well-known/oauth-protected-resource" in www_auth

    # 5. Call tools/call with unauthorized token -> 403
    with patch("jira_dashboard.presentation.auth.verify_google_bearer_token") as mock_verify:
        mock_verify.return_value = {"email": "unauthorized@example.com"}
        resp = client.post(
            "/mcp",
            json=call_payload,
            headers={"Authorization": "Bearer mock-token"},
        )
        assert resp.status_code == 403

    # 6. Call tools/call with authorized token -> 200
    with patch("jira_dashboard.presentation.auth.verify_google_bearer_token") as mock_verify:
        mock_verify.return_value = {"email": "authorized@example.com"}
        resp = client.post(
            "/mcp",
            json=call_payload,
            headers={"Authorization": "Bearer mock-token"},
        )
        assert resp.status_code == 200


def test_mcp_oauth_discovery_metadata_endpoints() -> None:
    """Verify RFC 9728 and RFC 8414 metadata discovery endpoints for Gemini & MCP clients."""
    client = TestClient(app)

    # 1. RFC 9728: /.well-known/oauth-protected-resource and subpath
    resp_prm = client.get("/.well-known/oauth-protected-resource")
    assert resp_prm.status_code == 200
    data_prm = resp_prm.json()
    assert "resource" in data_prm
    assert "http://testserver" in data_prm["authorization_servers"]
    assert "jira" in data_prm["scopes_supported"]
    assert "header" in data_prm["bearer_methods_supported"]

    resp_prm_sub = client.get("/.well-known/oauth-protected-resource/mcp")
    assert resp_prm_sub.status_code == 200
    assert resp_prm_sub.json()["resource"] == data_prm["resource"]

    # 2. RFC 8414: /.well-known/oauth-authorization-server
    resp_as = client.get("/.well-known/oauth-authorization-server")
    assert resp_as.status_code == 200
    data_as = resp_as.json()
    assert data_as["authorization_endpoint"] == "http://testserver/oauth/authorize"
    assert data_as["token_endpoint"] == "http://testserver/oauth/token"

    # 3. OpenID Connect fallback: /.well-known/openid-configuration
    resp_oidc = client.get("/.well-known/openid-configuration")
    assert resp_oidc.status_code == 200
    assert resp_oidc.json()["authorization_endpoint"] == "http://testserver/oauth/authorize"


def test_mcp_get_board_people_board_format_and_filters() -> None:
    """Verify jira_get_board matches People board grouping, filters, and fields."""
    from datetime import datetime, timedelta, timezone

    from jira_dashboard.presentation.main import storage

    client = TestClient(app)

    # Set up child account
    storage.set_account_type("Zoja", "child")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")

    # 1. Create a future task (should be hidden by default active_only=True)
    client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 10,
            "method": "tools/call",
            "params": {
                "name": "jira_create_issue",
                "arguments": {
                    "summary": "Future task",
                    "start_date": tomorrow,
                    "assignee": "Jacek",
                },
            },
        },
    )

    # 2. Create an Epic (should be hidden by default hide_epics=True)
    client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 11,
            "method": "tools/call",
            "params": {
                "name": "jira_create_issue",
                "arguments": {
                    "summary": "Big Epic Project",
                    "issue_type": "Epic",
                    "assignee": "Jacek",
                },
            },
        },
    )

    # 3. Create a Child task (should be hidden by default show_child_tasks=False)
    client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 12,
            "method": "tools/call",
            "params": {
                "name": "jira_create_issue",
                "arguments": {
                    "summary": "Do homework",
                    "assignee": "Zoja",
                    "start_date": today,
                    "due_date": today,
                    "recreate_after": "1d",
                },
            },
        },
    )

    # 4. Create an active parent task
    create_res = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 13,
            "method": "tools/call",
            "params": {
                "name": "jira_create_issue",
                "arguments": {
                    "summary": "Review system architecture",
                    "assignee": "Jacek",
                    "start_date": today,
                    "due_date": today,
                    "recreate_after": "1w",
                },
            },
        },
    )
    parent_key = json.loads(create_res.json()["result"]["content"][0]["text"])["key"]

    # Call jira_get_board with defaults (active_only=True, hide_epics=True, show_child_tasks=False)
    board_res = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 14,
            "method": "tools/call",
            "params": {"name": "jira_get_board", "arguments": {}},
        },
    )
    assert board_res.status_code == 200
    data = json.loads(board_res.json()["result"]["content"][0]["text"])

    assert "people" in data
    assert "tasks" in data
    task_keys = [t["key"] for t in data["tasks"]]
    assert parent_key in task_keys
    # Future task, Epic, and Child task should be hidden by default
    summaries = [t["summary"] for t in data["tasks"]]
    assert "Future task" not in summaries
    assert "Big Epic Project" not in summaries
    assert "Do homework" not in summaries

    # Verify task fields (start_date, due_date, end_date, recreate_after, dashboard url)
    parent_task = next(t for t in data["tasks"] if t["key"] == parent_key)
    assert parent_task["start_date"] == today
    assert parent_task["due_date"] == today
    assert parent_task["end_date"] == today
    assert parent_task["recreate_after"] == "1w"
    assert parent_task["url"] == f"http://testserver/task/{parent_key}"

    # Call with show_child_tasks=True -> child task should be visible
    board_child_res = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 15,
            "method": "tools/call",
            "params": {"name": "jira_get_board", "arguments": {"show_child_tasks": True}},
        },
    )
    data_child = json.loads(board_child_res.json()["result"]["content"][0]["text"])
    child_summaries = [t["summary"] for t in data_child["tasks"]]
    assert "Do homework" in child_summaries

    # Call with username filter "Zoja" -> returns Zoja's tasks
    board_user_res = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 16,
            "method": "tools/call",
            "params": {"name": "jira_get_board", "arguments": {"username": "Zoja"}},
        },
    )
    data_user = json.loads(board_user_res.json()["result"]["content"][0]["text"])
    user_summaries = [t["summary"] for t in data_user["tasks"]]
    assert "Do homework" in user_summaries
    assert "Review system architecture" not in user_summaries


def test_mcp_list_users() -> None:
    """Verify jira_list_users returns all board users with parent/child account types."""
    from jira_dashboard.presentation.main import storage

    storage.set_account_type("Zoja", "child")

    client = TestClient(app)
    resp = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 20,
            "method": "tools/call",
            "params": {"name": "jira_list_users", "arguments": {}},
        },
    )
    assert resp.status_code == 200
    res = json.loads(resp.json()["result"]["content"][0]["text"])
    assert "users" in res
    users = res["users"]
    user_names = [u["display_name"] for u in users]
    assert any("Jacek" in name for name in user_names)

    zoja = next((u for u in users if "Zoja" in u["display_name"]), None)
    if zoja:
        assert zoja["account_type"] == "child"


def test_mcp_create_and_assign_issue() -> None:
    """Verify jira_create_issue with all GUI fields and jira_assign_issue."""
    client = TestClient(app)

    # 1. Create with full GUI parameters
    create_payload = {
        "jsonrpc": "2.0",
        "id": 30,
        "method": "tools/call",
        "params": {
            "name": "jira_create_issue",
            "arguments": {
                "summary": "Water the plants",
                "description": "Balcony and living room",
                "issue_type": "Task",
                "priority": "High",
                "assignee": "Jacek",
                "start_date": "2026-10-25",
                "end_date": "2026-10-26",
                "recreate_after": "3d",
            },
        },
    }
    resp = client.post("/mcp", json=create_payload)
    assert resp.status_code == 200
    created = json.loads(resp.json()["result"]["content"][0]["text"])
    assert created["summary"] == "Water the plants"
    assert created["priority"].lower() == "high"
    assert created["start_date"] == "2026-10-25"
    assert created["end_date"] == "2026-10-26"
    assert created["recreate_after"] == "3d"
    assert created["url"] == f"http://testserver/task/{created['key']}"

    issue_key = created["key"]

    # 2. Reassign using jira_assign_issue
    assign_payload = {
        "jsonrpc": "2.0",
        "id": 31,
        "method": "tools/call",
        "params": {
            "name": "jira_assign_issue",
            "arguments": {
                "issue_key": issue_key,
                "assignee": "Ania",
            },
        },
    }
    resp_assign = client.post("/mcp", json=assign_payload)
    assert resp_assign.status_code == 200
    reassigned = json.loads(resp_assign.json()["result"]["content"][0]["text"])
    assert "Ania" in reassigned["assignee"]
    assert reassigned["url"] == f"http://testserver/task/{issue_key}"

    # 3. Unassign using jira_assign_issue
    unassign_payload = {
        "jsonrpc": "2.0",
        "id": 32,
        "method": "tools/call",
        "params": {
            "name": "jira_assign_issue",
            "arguments": {
                "issue_key": issue_key,
                "assignee": "unassigned",
            },
        },
    }
    resp_unassign = client.post("/mcp", json=unassign_payload)
    assert resp_unassign.status_code == 200
    unassigned = json.loads(resp_unassign.json()["result"]["content"][0]["text"])
    assert unassigned["assignee"] == "Unassigned"


def test_mcp_edit_task_comprehensive() -> None:
    """Verify home_tasks_edit_task allows editing all task fields, status, and assignees."""
    from jira_dashboard.presentation.main import storage

    client = TestClient(app)

    # 1. Create a baseline task
    create_payload = {
        "jsonrpc": "2.0",
        "id": 40,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_create_task",
            "arguments": {
                "summary": "Original Task Title",
                "description": "Original description",
                "priority": "Low",
                "task_type": "Task",
                "status": "To Do",
                "assignee": "Jacek",
            },
        },
    }
    resp_create = client.post("/mcp", json=create_payload)
    assert resp_create.status_code == 200
    created = json.loads(resp_create.json()["result"]["content"][0]["text"])
    task_key = created["key"]

    # 2. Edit fields: summary, description, priority, task_type, dates, recreate_after, story_points
    edit_payload = {
        "jsonrpc": "2.0",
        "id": 41,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_edit_task",
            "arguments": {
                "task_key": task_key,
                "summary": "Updated Task Title",
                "description": "Updated rich markdown description",
                "priority": "Highest",
                "task_type": "Story",
                "start_date": "2026-11-01",
                "due_date": "2026-11-05",
                "recreate_after": "2w",
                "story_points": 8.0,
            },
        },
    }
    resp_edit = client.post("/mcp", json=edit_payload)
    assert resp_edit.status_code == 200
    edited = json.loads(resp_edit.json()["result"]["content"][0]["text"])
    assert edited["key"] == task_key
    assert edited["summary"] == "Updated Task Title"
    assert edited["description"] == "Updated rich markdown description"
    assert edited["priority"].lower() == "highest"
    assert edited["issue_type"].lower() == "story"
    assert edited["start_date"] == "2026-11-01"
    assert edited["due_date"] == "2026-11-05"
    assert edited["end_date"] == "2026-11-05"
    assert edited["recreate_after"] == "2w"

    # Verify updated values persisted in SQLite storage
    stored = storage.get_issue(task_key)
    assert stored is not None
    assert stored.summary == "Updated Task Title"
    assert stored.description == "Updated rich markdown description"
    assert stored.priority.value.lower() == "highest"

    # 3. Reassign to another user (e.g. Alex) via home_tasks_edit_task
    reassign_payload = {
        "jsonrpc": "2.0",
        "id": 42,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_edit_task",
            "arguments": {
                "task_key": task_key,
                "assignee": "Alex",
            },
        },
    }
    resp_reassign = client.post("/mcp", json=reassign_payload)
    assert resp_reassign.status_code == 200
    reassigned = json.loads(resp_reassign.json()["result"]["content"][0]["text"])
    assert "Alex" in reassigned["assignee"]

    # 4. Unassign via home_tasks_edit_task
    unassign_payload = {
        "jsonrpc": "2.0",
        "id": 43,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_edit_task",
            "arguments": {
                "task_key": task_key,
                "assignee": "unassigned",
            },
        },
    }
    resp_unassign = client.post("/mcp", json=unassign_payload)
    assert resp_unassign.status_code == 200
    unassigned = json.loads(resp_unassign.json()["result"]["content"][0]["text"])
    assert unassigned["assignee"] == "Unassigned"

    # 5. Transition status via home_tasks_edit_task
    transition_payload = {
        "jsonrpc": "2.0",
        "id": 44,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_edit_task",
            "arguments": {
                "task_key": task_key,
                "status": "In Progress",
            },
        },
    }
    resp_trans = client.post("/mcp", json=transition_payload)
    assert resp_trans.status_code == 200
    transitioned = json.loads(resp_trans.json()["result"]["content"][0]["text"])
    assert (
        transitioned["status_name"] == "In Progress"
        or transitioned["status"]["category"] == "in_progress"
    )

    # 6. Verify compatibility alias: issue_key instead of task_key
    alias_payload = {
        "jsonrpc": "2.0",
        "id": 45,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_edit_task",
            "arguments": {
                "issue_key": task_key,
                "summary": "Aliased Parameter Update",
            },
        },
    }
    resp_alias = client.post("/mcp", json=alias_payload)
    assert resp_alias.status_code == 200
    aliased = json.loads(resp_alias.json()["result"]["content"][0]["text"])
    assert aliased["summary"] == "Aliased Parameter Update"

    # 7. Non-existent task error handling
    invalid_payload = {
        "jsonrpc": "2.0",
        "id": 46,
        "method": "tools/call",
        "params": {
            "name": "home_tasks_edit_task",
            "arguments": {
                "task_key": "NONEXISTENT-99999",
                "summary": "Should Fail",
            },
        },
    }
    resp_invalid = client.post("/mcp", json=invalid_payload)
    assert resp_invalid.status_code == 200
    invalid_res = resp_invalid.json()["result"]
    assert invalid_res["isError"] is True
    assert "not found" in invalid_res["content"][0]["text"].lower()
