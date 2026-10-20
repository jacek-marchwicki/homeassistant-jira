"""Tests for embedded OAuth 2.0 Authorization Server and Gemini MCP integration."""

from __future__ import annotations

import base64
import os
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from starlette.testclient import TestClient

from jira_dashboard.config import JiraDashboardSettings
from jira_dashboard.presentation.auth import (
    DEFAULT_SESSION_MAX_AGE,
    SESSION_COOKIE_NAME,
    AuthProvider,
    GoogleAuthUser,
    create_session_token,
)
from jira_dashboard.presentation.main import app, storage


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_oauth_discovery_metadata(client: TestClient) -> None:
    """Verify RFC 9728 and RFC 8414 metadata endpoints point to the app."""
    # 1. RFC 9728 Protected Resource Metadata
    res_prm = client.get("/.well-known/oauth-protected-resource")
    assert res_prm.status_code == 200
    prm_data = res_prm.json()
    assert "resource" in prm_data
    assert prm_data["resource"].endswith("/mcp")
    assert "authorization_servers" in prm_data
    assert len(prm_data["authorization_servers"]) == 1
    # Ensure authorization_servers does NOT point to accounts.google.com
    assert "accounts.google.com" not in prm_data["authorization_servers"][0]
    assert "jira" in prm_data["scopes_supported"]

    # 2. RFC 8414 Authorization Server Metadata
    res_as = client.get("/.well-known/oauth-authorization-server")
    assert res_as.status_code == 200
    as_data = res_as.json()
    assert as_data["authorization_endpoint"].endswith("/oauth/authorize")
    assert as_data["token_endpoint"].endswith("/oauth/token")
    assert "authorization_code" in as_data["grant_types_supported"]
    assert "refresh_token" in as_data["grant_types_supported"]
    assert "S256" in as_data["code_challenge_methods_supported"]
    assert "code" in as_data["response_types_supported"]


def test_oauth_authorize_unauthenticated_redirects_to_login(client: TestClient) -> None:
    """An unauthenticated user calling /oauth/authorize should be redirected to Google login."""
    res = client.get(
        "/oauth/authorize",
        params={
            "client_id": "gemini-mcp-client",
            "redirect_uri": "https://oauth-redirect.googleusercontent.com/r/test-app",
            "response_type": "code",
            "state": "state-12345",
        },
        follow_redirects=False,
    )
    assert res.status_code == 307
    location = res.headers.get("location", "")
    assert "/api/auth/google/login" in location
    assert "return_to=" in location


def test_oauth_authorize_authenticated_allowed_user(client: TestClient) -> None:
    """An authenticated allowed user should receive an authorization code redirect to Gemini."""
    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "allowed@example.com",
            "GOOGLE_CLIENT_ID": "test-google-client-id",
        },
    ):
        settings = JiraDashboardSettings.load()
        provider = AuthProvider(settings)

        # Create session cookie for allowed user
        session_token = create_session_token(
            GoogleAuthUser(email="allowed@example.com", name="Allowed User"),
            secret=provider.get_signing_secret(),
        )

        res = client.get(
            "/oauth/authorize",
            params={
                "client_id": "gemini-mcp-client",
                "redirect_uri": "https://oauth-redirect.googleusercontent.com/r/test-app",
                "response_type": "code",
                "state": "state-xyz",
            },
            cookies={SESSION_COOKIE_NAME: session_token},
            follow_redirects=False,
        )

        assert res.status_code == 302
        location = res.headers.get("location", "")
        assert location.startswith("https://oauth-redirect.googleusercontent.com/r/test-app")
        parsed = urlparse(location)
        query = parse_qs(parsed.query)
        assert "code" in query
        assert query["state"] == ["state-xyz"]

        auth_code = query["code"][0]
        # Verify the issued code can be consumed from storage
        code_data = storage.consume_oauth_code(auth_code)
        assert code_data is not None
        assert code_data["email"] == "allowed@example.com"


def test_oauth_authorize_unauthorized_email_rejected(client: TestClient) -> None:
    """An authenticated user whose email is not in the whitelist must be rejected."""
    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "allowed@example.com",
            "GOOGLE_CLIENT_ID": "test-google-client-id",
        },
    ):
        settings = JiraDashboardSettings.load()
        provider = AuthProvider(settings)

        session_token = create_session_token(
            GoogleAuthUser(email="forbidden@example.com", name="Forbidden User"),
            secret=provider.get_signing_secret(),
        )

        res = client.get(
            "/oauth/authorize",
            params={
                "client_id": "gemini-mcp-client",
                "redirect_uri": "https://oauth-redirect.googleusercontent.com/r/test-app",
                "response_type": "code",
                "state": "state-xyz",
            },
            cookies={SESSION_COOKIE_NAME: session_token},
            follow_redirects=False,
        )

        assert res.status_code == 403
        data = res.json()
        assert data["error"] == "access_denied"


def test_oauth_token_exchange_success(client: TestClient) -> None:
    """Verify exchanging a valid authorization code for a Bearer access token."""
    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "user@example.com",
            "GOOGLE_CLIENT_ID": "test-google-client-id",
            "MCP_CLIENT_SECRET": "secret-123",
        },
    ):
        storage.save_oauth_code(
            code="test-auth-code-valid",
            email="user@example.com",
            client_id="gemini-mcp-client",
            redirect_uri="https://oauth-redirect.googleusercontent.com/r/test-app",
        )

        res = client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": "test-auth-code-valid",
                "client_id": "gemini-mcp-client",
                "client_secret": "secret-123",
            },
        )

        assert res.status_code == 200
        token_data = res.json()
        assert "access_token" in token_data
        assert "refresh_token" in token_data
        assert token_data["token_type"] == "Bearer"
        assert token_data["expires_in"] == DEFAULT_SESSION_MAX_AGE
        assert "jira" in token_data["scope"]

        # Code is single use; attempting to exchange again must fail
        res_repeat = client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": "test-auth-code-valid",
                "client_id": "gemini-mcp-client",
                "client_secret": "secret-123",
            },
        )
        assert res_repeat.status_code == 400
        assert res_repeat.json()["error"] == "invalid_grant"


def test_oauth_token_basic_auth_client_secret(client: TestClient) -> None:
    """Verify HTTP Basic Auth for client_id and client_secret on /oauth/token."""
    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "user@example.com",
            "MCP_CLIENT_SECRET": "my-secret",
        },
    ):
        storage.save_oauth_code(
            code="code-basic-auth",
            email="user@example.com",
        )

        basic_header = base64.b64encode(b"gemini-mcp-client:my-secret").decode("utf-8")
        res = client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": "code-basic-auth",
            },
            headers={"Authorization": f"Basic {basic_header}"},
        )

        assert res.status_code == 200
        assert "access_token" in res.json()


def test_oauth_bearer_token_executes_mcp_tools(client: TestClient) -> None:
    """Verify that a token issued by the OAuth server successfully authorizes MCP tool calls."""
    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "engineer@example.com",
            "GOOGLE_CLIENT_ID": "test-id",
        },
    ):
        # 1. Issue an OAuth token for engineer@example.com
        storage.save_oauth_code(code="exec-code", email="engineer@example.com")
        token_res = client.post(
            "/oauth/token",
            data={"grant_type": "authorization_code", "code": "exec-code"},
        )
        assert token_res.status_code == 200
        access_token = token_res.json()["access_token"]

        # 2. Call protected tool WITHOUT token -> 401 Unauthorized
        res_no_auth = client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "jira_list_issues", "arguments": {}},
            },
        )
        assert res_no_auth.status_code == 401
        assert "WWW-Authenticate" in res_no_auth.headers

        # 3. Call protected tool WITH OAuth Bearer token -> 200 OK
        res_auth = client.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "jira_list_issues", "arguments": {}},
            },
            headers={"Authorization": f"Bearer {access_token}"},
        )
        assert res_auth.status_code == 200
        result = res_auth.json().get("result", {})
        assert not result.get("isError")
        assert len(result.get("content", [])) > 0


def test_oauth_pkce_end_to_end_flow(client: TestClient) -> None:
    """Verify full PKCE RFC 7636 flow: challenge, authorization, and verified token exchange."""
    import hashlib

    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "pkce-user@example.com",
            "GOOGLE_CLIENT_ID": "test-google-client-id",
        },
    ):
        settings = JiraDashboardSettings.load()
        provider = AuthProvider(settings)

        # Authenticate session
        session_token = create_session_token(
            GoogleAuthUser(email="pkce-user@example.com", name="PKCE User"),
            secret=provider.get_signing_secret(),
        )

        # Generate PKCE verifier and challenge
        verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")

        # Step 1: /oauth/authorize with PKCE challenge
        auth_res = client.get(
            "/oauth/authorize",
            params={
                "client_id": "gemini-mcp-client",
                "redirect_uri": "https://oauth-redirect.googleusercontent.com/r/gemini-app",
                "response_type": "code",
                "state": "state-pkce-123",
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
            cookies={SESSION_COOKIE_NAME: session_token},
            follow_redirects=False,
        )
        assert auth_res.status_code == 302
        target_url = auth_res.headers.get("location", "")
        parsed = urlparse(target_url)
        query = parse_qs(parsed.query)
        auth_code = query["code"][0]

        # Step 2a: Attempt token exchange missing code_verifier -> Rejected (400)
        # Store a duplicate code to test missing verifier rejection
        storage.save_oauth_code(
            code="test-code-pkce-missing",
            email="pkce-user@example.com",
            client_id="gemini-mcp-client",
            code_challenge=challenge,
            code_challenge_method="S256",
        )
        res_missing = client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": "test-code-pkce-missing",
            },
        )
        assert res_missing.status_code == 400
        assert "Missing PKCE code_verifier" in res_missing.json()["error_description"]

        # Step 2b: Attempt token exchange with wrong code_verifier -> Rejected (400)
        storage.save_oauth_code(
            code="test-code-pkce-wrong",
            email="pkce-user@example.com",
            client_id="gemini-mcp-client",
            code_challenge=challenge,
            code_challenge_method="S256",
        )
        res_wrong = client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": "test-code-pkce-wrong",
                "code_verifier": "completely-wrong-verifier-1234567890",
            },
        )
        assert res_wrong.status_code == 400
        assert "PKCE code_verifier verification failed" in res_wrong.json()["error_description"]

        # Step 2c: Exchange real issued code with matching code_verifier -> 200 OK
        res_valid = client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": auth_code,
                "redirect_uri": "https://oauth-redirect.googleusercontent.com/r/gemini-app",
                "client_id": "gemini-mcp-client",
                "code_verifier": verifier,
            },
        )
        assert res_valid.status_code == 200
        tok_data = res_valid.json()
        assert "access_token" in tok_data
        assert "refresh_token" in tok_data
        assert tok_data["token_type"] == "Bearer"


def test_oauth_token_raw_urlencoded_payload(client: TestClient) -> None:
    """Verify parsing raw application/x-www-form-urlencoded body without multipart parser."""
    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "raw-form@example.com",
            "GOOGLE_CLIENT_ID": "test-client-id",
        },
    ):
        storage.save_oauth_code(code="raw-auth-code", email="raw-form@example.com")

        raw_payload = b"grant_type=authorization_code&code=raw-auth-code&client_id=gemini"
        res = client.post(
            "/oauth/token",
            content=raw_payload,
            headers={"Content-Type": "application/x-www-form-urlencoded; charset=utf-8"},
        )
        assert res.status_code == 200
        assert "access_token" in res.json()


def test_oauth_refresh_token_lifecycle(client: TestClient) -> None:
    """Verify refreshing an access token using grant_type=refresh_token."""
    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "refresher@example.com",
            "GOOGLE_CLIENT_ID": "test-client-id",
        },
    ):
        # 1. Issue an authorization code and exchange for access & refresh tokens
        storage.save_oauth_code(code="refresh-auth-code", email="refresher@example.com")
        tok_res = client.post(
            "/oauth/token",
            data={"grant_type": "authorization_code", "code": "refresh-auth-code"},
        )
        assert tok_res.status_code == 200
        tok_data = tok_res.json()
        assert "access_token" in tok_data
        refresh_token = tok_data["refresh_token"]

        # 2. Use refresh_token to obtain a new access token
        refresh_res = client.post(
            "/oauth/token",
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        )
        assert refresh_res.status_code == 200
        refreshed_data = refresh_res.json()
        assert "access_token" in refreshed_data
        assert refreshed_data["token_type"] == "Bearer"
        assert refreshed_data["refresh_token"] == refresh_token

        # 3. Invalid refresh token should be rejected (400)
        invalid_res = client.post(
            "/oauth/token",
            data={"grant_type": "refresh_token", "refresh_token": "non-existent-token"},
        )
        assert invalid_res.status_code == 400
        assert invalid_res.json()["error"] == "invalid_grant"


def test_oauth_token_redirect_uri_mismatch(client: TestClient) -> None:
    """Verify that a mismatch in redirect_uri between authorize and token endpoints is rejected."""
    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "redirect@example.com",
            "GOOGLE_CLIENT_ID": "test-client-id",
        },
    ):
        storage.save_oauth_code(
            code="redirect-check-code",
            email="redirect@example.com",
            redirect_uri="https://oauth-redirect.googleusercontent.com/r/expected-uri",
        )

        res = client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": "redirect-check-code",
                "redirect_uri": "https://oauth-redirect.googleusercontent.com/r/different-uri",
            },
        )
        assert res.status_code == 400
        assert res.json()["error"] == "invalid_grant"
        assert "redirect_uri mismatch" in res.json()["error_description"]
