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

