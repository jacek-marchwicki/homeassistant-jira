"""Unit tests for authentication and authorization providers.

Tests support:
- None / Disabled mode (local development)
- Home Assistant Ingress mode
- GCP OAuth mode with Google ID token verification & email whitelisting
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from jira_dashboard.config import JiraDashboardSettings
from jira_dashboard.presentation.auth import (
    AuthMode,
    AuthProvider,
    GoogleAuthUser,
    create_session_token,
    verify_session_token,
)
from jira_dashboard.presentation.main import app


def test_auth_settings_resolution(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify auth mode resolution based on environment."""
    monkeypatch.delenv("SUPERVISOR_TOKEN", raising=False)
    monkeypatch.delenv("HA_OPTIONS_PATH", raising=False)
    monkeypatch.delenv("AUTH_MODE", raising=False)
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("ALLOWED_EMAILS", raising=False)

    # 1. Default when nothing is set -> NONE (local dev)
    s1 = JiraDashboardSettings.load()
    p1 = AuthProvider(s1)
    assert p1.resolved_mode == AuthMode.NONE

    # 2. When Home Assistant supervisor token is present -> HOMEASSISTANT
    monkeypatch.setenv("SUPERVISOR_TOKEN", "mock-supervisor-token")
    s2 = JiraDashboardSettings.load()
    p2 = AuthProvider(s2)
    assert p2.resolved_mode == AuthMode.HOMEASSISTANT

    # 3. When Google client ID or allowed emails are present -> GCP_OAUTH
    monkeypatch.delenv("SUPERVISOR_TOKEN", raising=False)
    monkeypatch.setenv("ALLOWED_EMAILS", "user1@example.com,user2@example.com")
    s3 = JiraDashboardSettings.load()
    p3 = AuthProvider(s3)
    assert p3.resolved_mode == AuthMode.GCP_OAUTH
    assert p3.allowed_emails == {"user1@example.com", "user2@example.com"}

    # 4. Explicit override takes precedence
    monkeypatch.setenv("AUTH_MODE", "none")
    s4 = JiraDashboardSettings.load()
    p4 = AuthProvider(s4)
    assert p4.resolved_mode == AuthMode.NONE


def test_session_token_roundtrip() -> None:
    """Verify session token generation and verification."""
    secret = "test-secret-key-1234567890"
    user = GoogleAuthUser(
        email="test@example.com",
        name="Test User",
        picture="https://example.com/pic.png",
    )
    token = create_session_token(user, secret=secret, max_age_seconds=3600)
    verified = verify_session_token(token, secret=secret)
    assert verified is not None
    assert verified.email == "test@example.com"
    assert verified.name == "Test User"
    assert verified.picture == "https://example.com/pic.png"

    # Invalid secret fails
    assert verify_session_token(token, secret="wrong-secret") is None

    # Corrupt token fails
    assert verify_session_token("corrupt.token.value", secret=secret) is None


def test_gcp_oauth_flow_endpoints(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify /api/auth/me, /api/auth/google, and /api/auth/logout endpoints."""
    monkeypatch.setenv("AUTH_MODE", "gcp_oauth")
    monkeypatch.setenv("ALLOWED_EMAILS", "allowed@example.com,family@example.com")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "mock-client-id.apps.googleusercontent.com")
    monkeypatch.setenv("WEBHOOK_SECRET", "session-secret-key-123")

    client = TestClient(app)

    # 1. Unauthenticated /api/auth/me returns 401 in GCP OAuth mode
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401

    # 2. Login with unauthorized email is rejected with 403
    with patch("jira_dashboard.presentation.auth.verify_google_id_token") as mock_verify:
        mock_verify.return_value = {
            "email": "intruder@example.com",
            "name": "Intruder",
            "picture": "",
        }
        resp = client.post("/api/auth/google", json={"credential": "mock-jwt-token"})
        assert resp.status_code == 403
        assert "not in allowed users list" in resp.json()["detail"].lower()

    # 3. Login with allowed email succeeds and sets cookie
    with patch("jira_dashboard.presentation.auth.verify_google_id_token") as mock_verify:
        mock_verify.return_value = {
            "email": "allowed@example.com",
            "name": "Allowed Family Member",
            "picture": "https://lh3.googleusercontent.com/photo.jpg",
        }
        resp = client.post("/api/auth/google", json={"credential": "valid-jwt-token"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "allowed@example.com"
        assert data["name"] == "Allowed Family Member"
        assert "ha_jira_session" in resp.cookies

        # 4. Subsequent call to /api/auth/me with session cookie succeeds
        resp_me = client.get("/api/auth/me", cookies=resp.cookies)
        assert resp_me.status_code == 200
        assert resp_me.json()["email"] == "allowed@example.com"

        # 5. Subsequent API call (e.g. /api/board) with session cookie succeeds
        resp_board = client.get("/api/board", cookies=resp.cookies)
        assert resp_board.status_code == 200

        # 6. Logout clears session cookie
        resp_logout = client.post("/api/auth/logout", cookies=resp.cookies)
        assert resp_logout.status_code == 200


def test_bearer_token_authorization(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify Authorization: Bearer <google_token> works for API/MCP requests."""
    monkeypatch.setenv("AUTH_MODE", "gcp_oauth")
    monkeypatch.setenv("ALLOWED_EMAILS", "gemini-user@example.com")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "mock-client-id")

    client = TestClient(app)

    # 1. Without header -> 401
    resp = client.get("/api/board")
    assert resp.status_code == 401

    # 2. With valid Bearer token for allowed email -> 200
    with patch("jira_dashboard.presentation.auth.verify_google_id_token") as mock_verify:
        mock_verify.return_value = {
            "email": "gemini-user@example.com",
            "name": "Gemini User",
        }
        resp = client.get(
            "/api/board",
            headers={"Authorization": "Bearer mock-google-token"},
        )
        assert resp.status_code == 200
