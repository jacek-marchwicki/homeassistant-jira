"""Tests for WebSocket outbox catch-up and live streaming."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from jira_dashboard.presentation.main import app, event_router, jira_client, settings, storage


@pytest.fixture(autouse=True)
def clean_state() -> None:
    storage.init_db()
    with storage._lock:
        conn = storage._get_connection()
        with conn:
            conn.execute("DELETE FROM outbox_events;")
            conn.execute("DELETE FROM board_streams;")
    if hasattr(jira_client, "reset"):
        jira_client.reset()


def test_websocket_initial_catchup() -> None:
    board_id = settings.jira_board_id

    # Pre-populate outbox events in storage
    seq1 = storage.append_board_event(
        board_id=board_id,
        event_type="issue_created",
        payload={"key": "TEST-1", "summary": "Chore 1"},
    )
    seq2 = storage.append_board_event(
        board_id=board_id,
        event_type="issue_updated",
        payload={"key": "TEST-1", "summary": "Chore 1 Updated"},
    )

    client = TestClient(app)
    with client.websocket_connect(f"/ws?board_id={board_id}&last_seq=0") as ws:
        # Initial connect message
        init_msg = ws.receive_json()
        assert init_msg["event"] == "connected"

        # Catch-up delta 1
        delta1 = ws.receive_json()
        assert delta1["event"] == "outbox_delta"
        assert delta1["seq"] == seq1
        assert delta1["type"] == "issue_created"
        assert delta1["payload"]["key"] == "TEST-1"

        # Catch-up delta 2
        delta2 = ws.receive_json()
        assert delta2["event"] == "outbox_delta"
        assert delta2["seq"] == seq2
        assert delta2["type"] == "issue_updated"

        # Catch-up complete
        complete = ws.receive_json()
        assert complete["event"] == "catchup_complete"
        assert complete["board_id"] == board_id
        assert complete["synced_seq"] == seq2


def test_websocket_live_stream_after_catchup() -> None:
    target_key = "PROJ-101"
    client = TestClient(app)
    board_id = settings.jira_board_id

    with client.websocket_connect(f"/ws?board_id={board_id}&last_seq=0") as ws:
        init_msg = ws.receive_json()
        assert init_msg["event"] == "connected"

        # Drain any catch-up events until catchup_complete
        msg = ws.receive_json()
        while msg.get("event") != "catchup_complete":
            msg = ws.receive_json()
        assert msg["event"] == "catchup_complete"

        # Now execute mutation via REST API
        resp = client.post(
            f"/api/issues/{target_key}/transition",
            json={"target_category": "done"},
        )
        assert resp.status_code == 200

        # Verify live event arrived over WebSocket
        live_msg = ws.receive_json()
        assert live_msg["event"] == "outbox_delta"
        assert live_msg["type"] == "issue_transitioned"
        assert live_msg["payload"]["issue_key"] == target_key
        assert live_msg["payload"]["status_category"] == "done"


def test_websocket_disconnect_cleans_up_queue() -> None:
    board_id = settings.jira_board_id
    client = TestClient(app)

    assert (
        board_id not in event_router._subscribers or len(event_router._subscribers[board_id]) == 0
    )

    with client.websocket_connect(f"/ws?board_id={board_id}&last_seq=0"):
        assert len(event_router._subscribers.get(board_id, set())) == 1

    # After exit, queue is removed
    assert len(event_router._subscribers.get(board_id, set())) == 0


def test_websocket_rejects_missing_last_seq() -> None:
    from starlette.websockets import WebSocketDisconnect

    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/ws"):
            pass
    assert exc_info.value.code == 1008


def test_websocket_rejects_invalid_last_seq() -> None:
    from starlette.websockets import WebSocketDisconnect

    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/ws?last_seq=invalid"):
            pass
    assert exc_info.value.code == 1008

    with pytest.raises(WebSocketDisconnect) as exc_info_neg:
        with client.websocket_connect("/ws?last_seq=-5"):
            pass
    assert exc_info_neg.value.code == 1008


def test_websocket_receives_sequenced_deletions_comments_and_account_types() -> None:
    board_id = settings.jira_board_id
    client = TestClient(app)

    # Seed a custom issue to delete
    from jira_dashboard.domain import IssueType, JiraIssue, JiraStatus, Priority, StatusCategory

    temp_issue = JiraIssue(
        id="999",
        key="TEST-DEL-1",
        summary="Delete me",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        updated_at="2026-11-01T10:00:00Z",
    )
    storage.save_issues([temp_issue])
    if hasattr(jira_client, "_issues"):
        jira_client._issues["TEST-DEL-1"] = temp_issue

    with client.websocket_connect(f"/ws?board_id={board_id}&last_seq=0") as ws:
        init_msg = ws.receive_json()
        assert init_msg["event"] == "connected"
        complete_msg = ws.receive_json()
        assert complete_msg["event"] == "catchup_complete"

        # 1. DELETE /api/issues/TEST-DEL-1
        del_resp = client.delete("/api/issues/TEST-DEL-1")
        assert del_resp.status_code == 200
        del_ws = ws.receive_json()
        assert del_ws["event"] == "outbox_delta"
        assert del_ws["type"] == "issue_deleted"
        assert del_ws["payload"]["issue_key"] == "TEST-DEL-1"
        assert del_ws["seq"] > 0

        # 2. Add comment
        comment_resp = client.post(
            "/api/issues/PROJ-104/comments",
            json={"body": "Sequenced comment test", "author_name": "Alice"},
        )
        assert comment_resp.status_code == 201
        comment_ws = ws.receive_json()
        assert comment_ws["event"] == "outbox_delta"
        assert comment_ws["type"] == "comment_created"
        assert comment_ws["payload"]["issue_key"] == "PROJ-104"
        assert comment_ws["seq"] > del_ws["seq"]

        # 3. Account types
        acc_resp = client.put(
            "/api/account-types",
            json={"display_name": "Bob", "account_type": "child"},
        )
        assert acc_resp.status_code == 200
        acc_ws = ws.receive_json()
        assert acc_ws["event"] == "outbox_delta"
        assert acc_ws["type"] == "account_types_updated"
        assert acc_ws["seq"] > comment_ws["seq"]


def test_websocket_receives_issue_created_and_sync_worker_resolution_with_board_id() -> None:
    """Verify that WebSocket clients on custom board_id receive prompt issue_created events

    both upon optimistic creation and upon sync_worker resolution of temp_key (HOME-15503).
    """
    import asyncio

    from jira_dashboard.presentation.main import sync_worker

    client = TestClient(app)
    client.post("/api/test/reset")
    board_id = "HOME"

    with client.websocket_connect(f"/ws?board_id={board_id}&last_seq=0") as ws:
        init_msg = ws.receive_json()
        assert init_msg["event"] == "connected"

        # Drain catch-up events
        msg = ws.receive_json()
        while msg.get("event") != "catchup_complete":
            msg = ws.receive_json()
        assert msg["event"] == "catchup_complete"

        # 1. Post new issue to /api/issues specifying board_id="HOME"
        create_resp = client.post(
            "/api/issues",
            json={
                "summary": "Real-time task on HOME board",
                "issue_type": "task",
                "priority": "high",
                "board_id": board_id,
            },
        )
        assert create_resp.status_code == 201
        created_data = create_resp.json()
        temp_key = created_data["key"]
        assert temp_key.startswith("HOME-TEMP-")

        # 2. Verify optimistic issue_created broadcast arrived on WebSocket for board="HOME"
        live_create_msg = ws.receive_json()
        assert live_create_msg["event"] == "outbox_delta"
        assert live_create_msg["board_id"] == "HOME"
        assert live_create_msg["type"] == "issue_created"
        assert live_create_msg["payload"]["issue_key"] == temp_key
        assert live_create_msg["payload"]["board_id"] == "HOME"

        # 3. Allow sync_worker to process outbox item and broadcast real issue
        asyncio.run(sync_worker.drain_once())

        # 4. Verify resolved issue_created arrives on WebSocket with temp_key and real key
        resolved_msg = ws.receive_json()
        assert resolved_msg["event"] == "outbox_delta"
        assert resolved_msg["board_id"] == "HOME"
        assert resolved_msg["type"] == "issue_created"
        assert resolved_msg["payload"]["temp_key"] == temp_key
        assert not resolved_msg["payload"]["issue_key"].startswith("HOME-TEMP-")
        assert resolved_msg["payload"]["issue"]["key"] == resolved_msg["payload"]["issue_key"]
