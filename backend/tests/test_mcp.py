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


def test_mcp_streamable_http_lifecycle() -> None:
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
    data = resp.json()
    assert data["jsonrpc"] == "2.0"
    assert data["id"] == 1
    assert "result" in data
    assert data["result"]["protocolVersion"] == "2024-11-05"
    assert data["result"]["serverInfo"]["name"] == "jira-dashboard-mcp"
    assert "tools" in data["result"]["capabilities"]

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
    assert "jira_get_board" in tool_names
    assert "jira_list_issues" in tool_names
    assert "jira_get_issue" in tool_names
    assert "jira_create_issue" in tool_names
    assert "jira_transition_issue" in tool_names
    assert "jira_add_comment" in tool_names

    # 4. tools/call -> jira_get_board
    call_payload = {
        "jsonrpc": "2.0",
        "id": 4,
        "method": "tools/call",
        "params": {"name": "jira_get_board", "arguments": {}},
    }
    resp = client.post("/mcp", json=call_payload)
    assert resp.status_code == 200
    res = resp.json()["result"]
    assert "content" in res
    assert len(res["content"]) > 0
    text_content = res["content"][0]["text"]
    board_data = json.loads(text_content)
    assert "issues" in board_data

    # 5. tools/call -> jira_create_issue
    create_payload = {
        "jsonrpc": "2.0",
        "id": 5,
        "method": "tools/call",
        "params": {
            "name": "jira_create_issue",
            "arguments": {
                "summary": "Clean the kitchen counter",
                "description": "Wipe surfaces and empty dishwasher",
                "issue_type": "Task",
                "priority": "Medium",
            },
        },
    }
    resp = client.post("/mcp", json=create_payload)
    assert resp.status_code == 200
    create_res = json.loads(resp.json()["result"]["content"][0]["text"])
    assert "key" in create_res
    created_key = create_res["key"]

    # 6. tools/call -> jira_get_issue
    get_payload = {
        "jsonrpc": "2.0",
        "id": 6,
        "method": "tools/call",
        "params": {
            "name": "jira_get_issue",
            "arguments": {"issue_key": created_key},
        },
    }
    resp = client.post("/mcp", json=get_payload)
    assert resp.status_code == 200
    get_res = json.loads(resp.json()["result"]["content"][0]["text"])
    assert get_res["key"] == created_key
    assert get_res["summary"] == "Clean the kitchen counter"

    # 7. tools/call -> jira_transition_issue
    trans_payload = {
        "jsonrpc": "2.0",
        "id": 7,
        "method": "tools/call",
        "params": {
            "name": "jira_transition_issue",
            "arguments": {"issue_key": created_key, "target_category": "done"},
        },
    }
    resp = client.post("/mcp", json=trans_payload)
    assert resp.status_code == 200
    trans_res = json.loads(resp.json()["result"]["content"][0]["text"])
    assert trans_res["status"]["category"] == "done"

    # 8. tools/call -> jira_add_comment
    comment_payload = {
        "jsonrpc": "2.0",
        "id": 8,
        "method": "tools/call",
        "params": {
            "name": "jira_add_comment",
            "arguments": {"issue_key": created_key, "body": "Finished ahead of schedule!"},
        },
    }
    resp = client.post("/mcp", json=comment_payload)
    assert resp.status_code == 200
    comment_res = json.loads(resp.json()["result"]["content"][0]["text"])
    assert comment_res["body"] == "Finished ahead of schedule!"


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

    # 1. Call without auth -> 401
    resp = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert resp.status_code == 401

    # 2. Call with unauthorized token -> 403
    with patch("jira_dashboard.presentation.auth.verify_google_id_token") as mock_verify:
        mock_verify.return_value = {"email": "unauthorized@example.com"}
        resp = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
            headers={"Authorization": "Bearer mock-token"},
        )
        assert resp.status_code == 403

    # 3. Call with authorized token -> 200
    with patch("jira_dashboard.presentation.auth.verify_google_id_token") as mock_verify:
        mock_verify.return_value = {"email": "authorized@example.com"}
        resp = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
            headers={"Authorization": "Bearer mock-token"},
        )
        assert resp.status_code == 200
