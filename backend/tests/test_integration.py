"""Full-stack Contract and WebSocket integration tests for Jira Dashboard API.

Validates that the FastAPI backend endpoints and real-time WebSocket broadcasting
strictly conform to the data contracts and event structures expected by the React frontend.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from jira_dashboard.presentation.main import app


@pytest.fixture
def client() -> TestClient:
    """Provide a TestClient instance for the FastAPI application."""
    return TestClient(app)


def test_board_endpoint_contract(client: TestClient) -> None:
    """Verify GET /api/board returns data matching the frontend BoardResponse schema."""
    response = client.get("/api/board")
    assert response.status_code == 200

    data = response.json()
    assert "board_id" in data
    assert "board_name" in data
    assert "sprint_name" in data
    assert "columns" in data
    assert isinstance(data["columns"], list)
    assert len(data["columns"]) > 0
    first_col = data["columns"][0]
    assert "id" in first_col
    assert "name" in first_col
    assert "category" in first_col

    assert "issues" in data
    assert isinstance(data["issues"], list)
    assert len(data["issues"]) > 0

    # Validate structure of first issue against JiraIssue model requirements
    first_issue = data["issues"][0]
    required_keys = {"id", "key", "summary", "issue_type", "priority", "status", "updated_at"}
    assert required_keys.issubset(first_issue.keys())

    # Validate nested status contract
    status = first_issue["status"]
    assert "id" in status
    assert "name" in status
    assert "category" in status
    assert status["category"] in {"todo", "inprogress", "inreview", "done", "blocked"}


def test_websocket_handshake_and_ping(client: TestClient) -> None:
    """Verify WebSocket /ws connection handshake, initial connection event, and ping/pong."""
    with client.websocket_connect("/ws") as websocket:
        # 1. Connection acknowledgment event
        initial_data = websocket.receive_json()
        assert initial_data.get("event") == "connected"
        assert "message" in initial_data
        assert initial_data.get("active_clients", 0) >= 1

        # 2. Ping-pong heartbeat
        websocket.send_text("ping")
        pong_response = websocket.receive_text()
        assert pong_response == "pong"


def test_transition_endpoint_and_websocket_broadcast(client: TestClient) -> None:
    """Verify REST transition immediately broadcasts state delta over WebSocket.

    This ensures that when any client (or background Jira sync) moves a card,
    all connected browser windows receive the updated JiraIssue instantly.
    """
    target_issue_key = "PROJ-101"

    with client.websocket_connect("/ws") as websocket:
        # Consume initial connection event
        connect_ack = websocket.receive_json()
        assert connect_ack["event"] == "connected"

        # Execute REST transition to "done"
        transition_payload = {"target_category": "done"}
        response = client.post(
            f"/api/issues/{target_issue_key}/transition",
            json=transition_payload,
        )
        assert response.status_code == 200
        rest_issue = response.json()
        assert rest_issue["key"] == target_issue_key
        assert rest_issue["status"]["category"] == "done"

        # Assert that the WebSocket client immediately received the broadcasted delta
        ws_event = websocket.receive_json()
        assert ws_event.get("event") == "issue_transitioned"
        assert ws_event.get("issue_key") == target_issue_key
        assert ws_event.get("status_category") == "done"
        assert "issue" in ws_event
        assert ws_event["issue"]["key"] == target_issue_key
        assert ws_event["issue"]["status"]["category"] == "done"


def test_transition_with_target_status_and_websocket_broadcast(client: TestClient) -> None:
    """Verify transition with target_status updates issue and broadcasts status_name."""
    target_issue_key = "PROJ-101"

    with client.websocket_connect("/ws") as websocket:
        connect_ack = websocket.receive_json()
        assert connect_ack["event"] == "connected"

        transition_payload = {"target_status": "In Progress"}
        response = client.post(
            f"/api/issues/{target_issue_key}/transition",
            json=transition_payload,
        )
        assert response.status_code == 200
        rest_issue = response.json()
        assert rest_issue["key"] == target_issue_key
        assert rest_issue["status"]["name"] == "In Progress"

        ws_event = websocket.receive_json()
        assert ws_event.get("event") == "issue_transitioned"
        assert ws_event.get("issue_key") == target_issue_key
        assert ws_event.get("status_name") == "In Progress"
        assert ws_event["issue"]["status"]["name"] == "In Progress"


def test_transition_nonexistent_issue_returns_404(client: TestClient) -> None:
    """Verify that transitioning a non-existent issue returns 404 Not Found."""
    response = client.post(
        "/api/issues/NONEXISTENT-999/transition",
        json={"target_category": "done"},
    )
    assert response.status_code == 404
    assert "not found" in response.json().get("detail", "").lower()


def test_transition_invalid_category_returns_422(client: TestClient) -> None:
    """Verify that invalid target category triggers validation error (422)."""
    response = client.post(
        "/api/issues/PROJ-101/transition",
        json={"target_category": "invalid_status_xyz"},
    )
    assert response.status_code == 422


def test_jira_webhook_ingestion_and_broadcast(client: TestClient) -> None:
    """Verify that incoming Jira webhook updates state and broadcasts to WebSockets."""
    webhook_payload = {
        "webhookEvent": "jira:issue_updated",
        "issue": {
            "id": "104",
            "key": "PROJ-104",
            "fields": {
                "summary": "Setup WebSocket broadcast client (updated via webhook)",
                "status": {
                    "name": "Done",
                    "statusCategory": {"id": 3, "key": "done", "name": "Done"},
                },
            },
        },
    }

    with client.websocket_connect("/ws") as websocket:
        # Consume initial connection event
        connect_ack = websocket.receive_json()
        assert connect_ack["event"] == "connected"

        # Ingest webhook
        response = client.post("/api/webhooks/jira", json=webhook_payload)
        assert response.status_code == 200
        assert response.json()["status"] == "processed"
        assert response.json()["issue_key"] == "PROJ-104"

        # Assert WebSocket client received real-time broadcast
        ws_event = websocket.receive_json()
        assert ws_event.get("event") == "issue_transitioned"
        assert ws_event.get("issue_key") == "PROJ-104"
        assert ws_event.get("status_category") == "done"
        assert (
            ws_event["issue"]["summary"] == "Setup WebSocket broadcast client (updated via webhook)"
        )


def test_simulate_error_and_recovery(client: TestClient) -> None:
    """Verify simulate-error endpoint allows testing optimistic UI rollback scenarios."""
    # Enable error simulation
    sim_res = client.post(
        "/api/test/simulate-error",
        json={"enable": True, "status_code": 503, "message": "Jira Service Outage"},
    )
    assert sim_res.status_code == 200
    assert sim_res.json()["simulate_failure"] is True

    # Transition should now fail with 503
    fail_res = client.post(
        "/api/issues/PROJ-101/transition",
        json={"target_category": "done"},
    )
    assert fail_res.status_code == 503
    assert "Jira Service Outage" in fail_res.json().get("detail", "")

    # Disable error simulation
    reset_res = client.post(
        "/api/test/simulate-error",
        json={"enable": False},
    )
    assert reset_res.status_code == 200
    assert reset_res.json()["simulate_failure"] is False

    # Transition succeeds again
    ok_res = client.post(
        "/api/issues/PROJ-101/transition",
        json={"target_category": "inprogress"},
    )
    assert ok_res.status_code == 200
