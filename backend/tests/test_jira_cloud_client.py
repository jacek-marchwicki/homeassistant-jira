"""Unit tests for JiraCloudClient adapter using HTTPX MockTransport."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from jira_dashboard.adapters.jira_client import JiraAPIError
from jira_dashboard.adapters.jira_cloud_client import JiraCloudClient
from jira_dashboard.config import JiraDashboardSettings
from jira_dashboard.domain import Priority, StatusCategory


def create_mock_client(handler) -> JiraCloudClient:
    """Helper to instantiate JiraCloudClient with a mock HTTPX transport."""
    settings = JiraDashboardSettings(
        jira_url="https://test-jira.atlassian.net",
        jira_email="dev@example.com",
        jira_api_token="test-token",
    )
    transport = httpx.MockTransport(handler)
    mock_http = httpx.AsyncClient(
        transport=transport,
        base_url="https://test-jira.atlassian.net",
    )
    return JiraCloudClient(settings, http_client=mock_http)


def test_get_board_issues_success() -> None:
    """Verify get_board_issues parses Jira JSON issues correctly."""

    async def _test() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert "/rest/agile/1.0/board/board-123/issue" in str(request.url)
            return httpx.Response(
                200,
                json={
                    "issues": [
                        {
                            "id": "1001",
                            "key": "DEV-1001",
                            "fields": {
                                "summary": "Fix dynamic ingress proxying",
                                "issuetype": {"name": "Bug"},
                                "priority": {"name": "High"},
                                "status": {
                                    "id": "3",
                                    "name": "In Progress",
                                    "statusCategory": {
                                        "id": 2,
                                        "key": "indeterminate",
                                        "name": "In Progress",
                                    },
                                },
                                "assignee": {
                                    "accountId": "acc-1",
                                    "displayName": "Jacek M",
                                    "avatarUrls": {"48x48": "https://avatar.url/48"},
                                },
                                "customfield_10016": 5.0,
                                "duedate": "2026-10-15",
                                "customfield_10015": "2026-10-10",
                                "updated": "2026-10-05T01:00:00Z",
                            },
                        }
                    ]
                },
            )

        client = create_mock_client(handler)
        issues = await client.get_board_issues("board-123")
        assert len(issues) == 1
        issue = issues[0]
        assert issue.key == "DEV-1001"
        assert issue.summary == "Fix dynamic ingress proxying"
        assert issue.priority == Priority.HIGH
        assert issue.status.category == StatusCategory.IN_PROGRESS
        assert issue.assignee is not None
        assert issue.assignee.display_name == "Jacek M"
        assert issue.story_points == 5.0
        assert issue.due_date == "2026-10-15"
        assert issue.start_date == "2026-10-10"
        await client.close()

    asyncio.run(_test())


def test_transition_issue_success() -> None:
    """Verify transition_issue queries transitions, finds target, and executes transition."""

    async def _test() -> None:
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            url_str = str(request.url)
            calls.append((request.method, url_str))

            if request.method == "GET" and "/transitions" in url_str:
                return httpx.Response(
                    200,
                    json={
                        "transitions": [
                            {
                                "id": "31",
                                "name": "Done",
                                "to": {
                                    "id": "4",
                                    "name": "Done",
                                    "statusCategory": {"key": "done", "name": "Done"},
                                },
                            }
                        ]
                    },
                )
            if request.method == "POST" and "/transitions" in url_str:
                return httpx.Response(204)
            if request.method == "GET" and "/rest/api/3/issue/DEV-1001" in url_str:
                return httpx.Response(
                    200,
                    json={
                        "id": "1001",
                        "key": "DEV-1001",
                        "fields": {
                            "summary": "Fix dynamic ingress proxying",
                            "status": {
                                "id": "4",
                                "name": "Done",
                                "statusCategory": {"key": "done"},
                            },
                        },
                    },
                )
            return httpx.Response(404)

        client = create_mock_client(handler)
        updated = await client.transition_issue("DEV-1001", StatusCategory.DONE)
        assert updated.status.category == StatusCategory.DONE
        assert (
            "GET",
            "https://test-jira.atlassian.net/rest/api/3/issue/DEV-1001/transitions",
        ) in calls
        assert (
            "POST",
            "https://test-jira.atlassian.net/rest/api/3/issue/DEV-1001/transitions",
        ) in calls
        await client.close()

    asyncio.run(_test())


def test_transition_no_matching_transition_raises_400() -> None:
    """Verify transition raises 400 when target is not in available transitions."""

    async def _test() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "transitions": [
                        {"id": "11", "name": "In Progress", "to": {"name": "In Progress"}}
                    ]
                },
            )

        client = create_mock_client(handler)
        with pytest.raises(JiraAPIError) as exc_info:
            await client.transition_issue("DEV-1001", StatusCategory.DONE)
        assert exc_info.value.status_code == 400
        assert "No transition available" in str(exc_info.value)
        await client.close()

    asyncio.run(_test())


def test_transition_issue_by_target_status() -> None:
    """Verify transition_issue matches specific destination status name."""

    async def _test() -> None:
        executed_trans_id = None

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal executed_trans_id
            url_str = str(request.url)
            if request.method == "GET" and "/transitions" in url_str:
                return httpx.Response(
                    200,
                    json={
                        "transitions": [
                            {
                                "id": "11",
                                "name": "Backlog",
                                "to": {
                                    "id": "10002",
                                    "name": "Backlog",
                                    "statusCategory": {"key": "new"},
                                },
                            },
                            {
                                "id": "21",
                                "name": "Ready",
                                "to": {
                                    "id": "10003",
                                    "name": "Ready",
                                    "statusCategory": {"key": "new"},
                                },
                            },
                        ]
                    },
                )
            if request.method == "POST" and "/transitions" in url_str:
                import json

                body = json.loads(request.content)
                executed_trans_id = body.get("transition", {}).get("id")
                return httpx.Response(204)
            if request.method == "GET" and "/rest/api/3/issue/DEV-1001" in url_str:
                return httpx.Response(
                    200,
                    json={
                        "id": "1001",
                        "key": "DEV-1001",
                        "fields": {
                            "summary": "Fix dynamic ingress proxying",
                            "status": {
                                "id": "10003",
                                "name": "Ready",
                                "statusCategory": {"key": "new"},
                            },
                        },
                    },
                )
            return httpx.Response(404)

        client = create_mock_client(handler)
        updated = await client.transition_issue("DEV-1001", target_status="Ready")
        assert executed_trans_id == "21"
        assert updated.status.name == "Ready"
        await client.close()

    asyncio.run(_test())


def test_get_board_columns_from_project_statuses() -> None:
    """Verify get_board_columns fetches and orders workflow statuses from Jira project."""

    async def _test() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if "/rest/api/3/project/HOME/statuses" in str(request.url):
                return httpx.Response(
                    200,
                    json=[
                        {
                            "name": "Task",
                            "statuses": [
                                {
                                    "id": "10002",
                                    "name": "Backlog",
                                    "statusCategory": {"key": "new"},
                                },
                                {"id": "10001", "name": "Done", "statusCategory": {"key": "done"}},
                                {
                                    "id": "3",
                                    "name": "In Progress",
                                    "statusCategory": {"key": "indeterminate"},
                                },
                                {"id": "10003", "name": "Ready", "statusCategory": {"key": "new"}},
                            ],
                        }
                    ],
                )
            return httpx.Response(404)

        client = create_mock_client(handler)
        cols = await client.get_board_columns("HOME")
        assert len(cols) == 4
        # Ordered by status category (todo -> inprogress -> done)
        col_names = [c.name for c in cols]
        assert col_names == ["Backlog", "Ready", "In Progress", "Done"]
        await client.close()

    asyncio.run(_test())


def test_jira_error_handling_401_and_429() -> None:
    """Verify 401 and 429 status codes raise appropriately typed JiraAPIErrors."""

    async def _test() -> None:
        # Test 401
        def handler_401(_: httpx.Request) -> httpx.Response:
            return httpx.Response(401, json={"errorMessages": ["Unauthorized login"]})

        client_401 = create_mock_client(handler_401)
        with pytest.raises(JiraAPIError) as exc_info:
            await client_401.get_board_issues("board-1")
        assert exc_info.value.status_code == 401
        assert "Unauthorized" in str(exc_info.value)
        await client_401.close()

        # Test 429 with Retry-After
        def handler_429(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                429,
                headers={"Retry-After": "45"},
                json={"errorMessages": ["Rate limit exceeded"]},
            )

        client_429 = create_mock_client(handler_429)
        with pytest.raises(JiraAPIError) as exc_429:
            await client_429.get_board_issues("board-1")
        assert exc_429.value.status_code == 429
        assert "45s" in str(exc_429.value)
        await client_429.close()

    asyncio.run(_test())
