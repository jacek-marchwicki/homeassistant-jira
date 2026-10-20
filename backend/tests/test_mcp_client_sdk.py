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
                assert init_res.server_info.name == "jira-dashboard-mcp"
                assert init_res.server_info.version == "0.5.0"
                assert init_res.capabilities.tools is not None

                # 2. list_tools
                tools_res = await session.list_tools()
                tool_names = [t.name for t in tools_res.tools]
                assert "jira_get_board" in tool_names
                assert "jira_list_issues" in tool_names
                assert "jira_get_issue" in tool_names
                assert "jira_create_issue" in tool_names
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
                        assert init_res.server_info.name == "jira-dashboard-mcp"

                        tools_res = await session.list_tools()
                        assert len(tools_res.tools) == 6

                        # Call tool requiring authentication
                        call_res = await session.call_tool("jira_list_issues", {})
                        assert not call_res.is_error
                        assert len(call_res.content) > 0

        asyncio.run(_test())
