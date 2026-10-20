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


def test_auth_config_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify /api/auth/config public endpoint returns mode, client_id, and session status."""
    monkeypatch.setenv("AUTH_MODE", "gcp_oauth")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "mock-client-id-123.apps.googleusercontent.com")
    monkeypatch.setenv("ALLOWED_EMAILS", "member@example.com")
    monkeypatch.setenv("SESSION_SECRET_KEY", "secret-test-key")

    client = TestClient(app)

    # 1. Unauthenticated call
    resp = client.get("/api/auth/config")
    assert resp.status_code == 200
    data = resp.json()
    assert data["auth_mode"] == "gcp_oauth"
    assert data["google_client_id"] == "mock-client-id-123.apps.googleusercontent.com"
    assert data["authenticated"] is False
    assert data["user"] is None

    # 2. Authenticated with session cookie
    user = GoogleAuthUser(email="member@example.com", name="Member", picture="https://pic.url")
    token = create_session_token(user, secret="secret-test-key")
    resp_auth = client.get("/api/auth/config", cookies={"ha_jira_session": token})
    assert resp_auth.status_code == 200
    data_auth = resp_auth.json()
    assert data_auth["authenticated"] is True
    assert data_auth["user"]["email"] == "member@example.com"


def test_google_oauth_redirect_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify /api/auth/google/login and /api/auth/google/callback OAuth 2.0 flow."""
    monkeypatch.setenv("AUTH_MODE", "gcp_oauth")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "client-secret-xyz")
    monkeypatch.setenv("ALLOWED_EMAILS", "family@example.com")
    monkeypatch.setenv("WEBHOOK_SECRET", "secret-test-key")

    client = TestClient(app)

    # 1. /api/auth/google/login redirects to Google OAuth
    resp_login = client.get("/api/auth/google/login", follow_redirects=False)
    assert resp_login.status_code in (302, 307)
    location = resp_login.headers["location"]
    assert "accounts.google.com/o/oauth2/v2/auth" in location
    assert "client_id=client-id.apps.googleusercontent.com" in location
    assert "response_type=code" in location
    assert "scope=openid+email+profile" in location or "scope=openid%20email%20profile" in location
    assert "redirect_uri=" in location

    # 2. /api/auth/google/callback with error param redirects with auth_error
    resp_err = client.get("/api/auth/google/callback?error=access_denied", follow_redirects=False)
    assert resp_err.status_code == 302
    assert "auth_error=" in resp_err.headers["location"]

    # 3. /api/auth/google/callback with valid code exchanges token and sets cookie
    mock_token_response = {
        "id_token": "mock-id-token",
        "access_token": "mock-access-token",
    }
    with (
        patch("httpx.AsyncClient.post") as mock_post,
        patch("jira_dashboard.presentation.auth.verify_google_id_token") as mock_verify,
    ):

        class MockHttpResponse:
            status_code = 200

            def json(self):
                return mock_token_response

        mock_post.return_value = MockHttpResponse()
        mock_verify.return_value = {
            "email": "family@example.com",
            "name": "Family Member",
            "picture": "https://lh3.example.com/pic.jpg",
        }

        resp_cb = client.get("/api/auth/google/callback?code=mock-code-123", follow_redirects=False)
        assert resp_cb.status_code == 302
        assert resp_cb.headers["location"].endswith("/")
        assert "ha_jira_session" in resp_cb.cookies


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
