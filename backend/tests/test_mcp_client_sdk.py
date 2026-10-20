"""Integration tests using the official Python MCP Client SDK (mcp).

Tests the full Streamable HTTP lifecycle against the live running FastAPI server:
- Connection and stream establishment (POST + GET SSE stream)
- session.initialize() handshake and capability negotiation
- session.list_tools() tool discovery
- session.call_tool() tool execution
- Clean session teardown
"""

from __future__ import annotations

import socket
import threading
import time
from collections.abc import Generator

import pytest
import uvicorn

from jira_dashboard.presentation.main import app


def get_free_port() -> int:
    """Find an available port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def local_mcp_server() -> Generator[str, None, None]:
    """Start local uvicorn server in a background thread for testing."""
    port = get_free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    # Wait for server to bind
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                break
        except OSError:
            time.sleep(0.05)

    base_url = f"http://127.0.0.1:{port}"
    yield base_url

    server.should_exit = True
    thread.join(timeout=2)


def test_official_mcp_client_sdk_lifecycle(local_mcp_server: str) -> None:
    """Verify end-to-end communication using official MCP Python Client SDK."""
    pytest.importorskip("mcp", reason="official mcp package not installed")
    import asyncio

    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    async def _test() -> None:
        mcp_url = f"{local_mcp_server}/mcp"

        async with streamable_http_client(mcp_url) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                # 1. initialize
                init_res = await session.initialize()
                assert init_res.server_info.name == "home-tasks-manager"
                assert init_res.server_info.version == "0.5.0"
                assert init_res.capabilities.tools is not None

                # 2. list_tools
                tools_res = await session.list_tools()
                tool_names = [t.name for t in tools_res.tools]
                assert "jira_get_board" in tool_names
                assert "jira_list_users" in tool_names
                assert "jira_list_issues" in tool_names
                assert "jira_get_issue" in tool_names
                assert "jira_create_issue" in tool_names
                assert "jira_assign_issue" in tool_names
                assert "jira_transition_issue" in tool_names
                assert "jira_add_comment" in tool_names

                # 3. call_tool -> jira_list_issues
                list_res = await session.call_tool("jira_list_issues", {})
                assert not list_res.is_error
                assert len(list_res.content) > 0

                # 4. call_tool -> jira_create_issue
                create_res = await session.call_tool(
                    "jira_create_issue",
                    {"summary": "Created by official MCP client SDK"},
                )
                assert not create_res.is_error
                assert len(create_res.content) > 0
                assert "Created by official MCP client SDK" in create_res.content[0].text

    asyncio.run(_test())


def test_official_mcp_client_sdk_with_oauth_bearer_token(local_mcp_server: str) -> None:
    """Verify official MCP client SDK connecting with an OAuth Bearer token under GCP OAuth mode."""
    pytest.importorskip("mcp", reason="official mcp package not installed")
    import asyncio
    import os
    from unittest.mock import patch

    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    from jira_dashboard.presentation.main import storage

    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "official-client@example.com",
            "GOOGLE_CLIENT_ID": "test-client-id",
        },
    ):
        # 1. Generate an OAuth authorization code and exchange for Bearer token
        storage.save_oauth_code(
            code="sdk-test-code",
            email="official-client@example.com",
            client_id="gemini-mcp-client",
        )

        async def _test() -> None:
            token_url = f"{local_mcp_server}/oauth/token"
            mcp_url = f"{local_mcp_server}/mcp"

            async with httpx.AsyncClient() as http:
                tok_res = await http.post(
                    token_url,
                    data={"grant_type": "authorization_code", "code": "sdk-test-code"},
                )
                assert tok_res.status_code == 200
                access_token = tok_res.json()["access_token"]

            # Connect using official MCP SDK with the authenticated Bearer token
            auth_headers = {"Authorization": f"Bearer {access_token}"}
            async with httpx.AsyncClient(headers=auth_headers) as authed_http:
                async with streamable_http_client(mcp_url, http_client=authed_http) as (
                    read_stream,
                    write_stream,
                ):
                    async with ClientSession(read_stream, write_stream) as session:
                        init_res = await session.initialize()
                        assert init_res.server_info.name == "home-tasks-manager"

                        tools_res = await session.list_tools()
                        assert len(tools_res.tools) == 8

                        # Call tool requiring authentication
                        call_res = await session.call_tool("jira_list_issues", {})
                        assert not call_res.is_error
                        assert len(call_res.content) > 0

        asyncio.run(_test())


def test_official_mcp_client_sdk_with_pkce_and_refresh_flow(local_mcp_server: str) -> None:
    """Verify official MCP client SDK connecting via PKCE exchange and subsequent token refresh."""
    pytest.importorskip("mcp", reason="official mcp package not installed")
    import asyncio
    import base64
    import hashlib
    import os
    from unittest.mock import patch

    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    from jira_dashboard.presentation.main import storage

    with patch.dict(
        os.environ,
        {
            "AUTH_MODE": "gcp_oauth",
            "ALLOWED_EMAILS": "pkce-client@example.com",
            "GOOGLE_CLIENT_ID": "test-client-id",
        },
    ):
        # 1. Generate PKCE verifier and challenge
        verifier = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-wi"
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")

        storage.save_oauth_code(
            code="pkce-sdk-code",
            email="pkce-client@example.com",
            client_id="gemini-mcp-client",
            redirect_uri="https://oauth-redirect.googleusercontent.com/r/gemini-app",
            code_challenge=challenge,
            code_challenge_method="S256",
        )

        async def _test() -> None:
            token_url = f"{local_mcp_server}/oauth/token"
            mcp_url = f"{local_mcp_server}/mcp"

            # 2. Exchange code with code_verifier via form-urlencoded POST
            async with httpx.AsyncClient() as http:
                tok_res = await http.post(
                    token_url,
                    data={
                        "grant_type": "authorization_code",
                        "code": "pkce-sdk-code",
                        "redirect_uri": "https://oauth-redirect.googleusercontent.com/r/gemini-app",
                        "client_id": "gemini-mcp-client",
                        "code_verifier": verifier,
                    },
                )
                assert tok_res.status_code == 200
                data = tok_res.json()
                access_token = data["access_token"]
                refresh_token = data["refresh_token"]

            # 3. Call MCP with initial access token
            async with httpx.AsyncClient(
                headers={"Authorization": f"Bearer {access_token}"}
            ) as authed_http:
                async with streamable_http_client(mcp_url, http_client=authed_http) as (
                    read_stream,
                    write_stream,
                ):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()
                        res = await session.call_tool("jira_list_issues", {})
                        assert not res.is_error

            # 4. Refresh token to obtain new access token
            async with httpx.AsyncClient() as http:
                ref_res = await http.post(
                    token_url,
                    data={"grant_type": "refresh_token", "refresh_token": refresh_token},
                )
                assert ref_res.status_code == 200
                new_access_token = ref_res.json()["access_token"]

            # 5. Connect and call MCP with refreshed access token
            async with httpx.AsyncClient(
                headers={"Authorization": f"Bearer {new_access_token}"}
            ) as authed_http2:
                async with streamable_http_client(mcp_url, http_client=authed_http2) as (
                    read_stream2,
                    write_stream2,
                ):
                    async with ClientSession(read_stream2, write_stream2) as session2:
                        await session2.initialize()
                        res2 = await session2.call_tool("jira_get_board", {})
                        assert not res2.is_error

        asyncio.run(_test())
