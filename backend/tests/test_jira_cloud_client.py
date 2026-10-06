"""Unit tests for JiraCloudClient adapter using HTTPX MockTransport."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from jira_dashboard.adapters.jira_client import JiraAPIError
from jira_dashboard.adapters.jira_cloud_client import JiraCloudClient, map_issue_type
from jira_dashboard.config import JiraDashboardSettings
from jira_dashboard.domain import IssueType, Priority, StatusCategory


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
        assert issue.url == "https://test-jira.atlassian.net/browse/DEV-1001"
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


def test_update_issue_success() -> None:
    """Verify JiraCloudClient update_issue sends PUT to issue endpoint."""

    async def _test() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.method == "PUT" and "/rest/api/3/issue/DEV-1001" in str(request.url):
                return httpx.Response(204)
            if request.method == "GET" and "/rest/api/3/issue/DEV-1001" in str(request.url):
                return httpx.Response(
                    200,
                    json={
                        "id": "1001",
                        "key": "DEV-1001",
                        "fields": {
                            "summary": "Updated Jira Summary",
                            "priority": {"name": "Highest"},
                            "issuetype": {"name": "Bug"},
                            "status": {
                                "id": "3",
                                "name": "In Progress",
                                "statusCategory": {
                                    "id": 2,
                                    "key": "indeterminate",
                                    "name": "In Progress",
                                },
                            },
                        },
                    },
                )
            return httpx.Response(404)

        client = create_mock_client(handler)
        updated = await client.update_issue(
            "DEV-1001",
            summary="Updated Jira Summary",
            priority=Priority.HIGHEST,
        )
        assert updated.key == "DEV-1001"
        assert updated.summary == "Updated Jira Summary"
        assert updated.priority == Priority.HIGHEST
        await client.close()

    asyncio.run(_test())


def test_create_issue_success() -> None:
    """Verify JiraCloudClient create_issue posts to /rest/api/3/issue."""

    async def _test() -> None:
        created_payload = None

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal created_payload
            if request.method == "POST" and "/rest/api/3/issue" in str(request.url):
                import json

                created_payload = json.loads(request.content)
                return httpx.Response(201, json={"id": "2001", "key": "DEV-2001"})
            if request.method == "GET" and "/rest/api/3/issue/DEV-2001" in str(request.url):
                return httpx.Response(
                    200,
                    json={
                        "id": "2001",
                        "key": "DEV-2001",
                        "fields": {
                            "summary": "Brand new issue created via Cloud API",
                            "priority": {"name": "High"},
                            "issuetype": {"name": "Task"},
                            "status": {
                                "id": "1",
                                "name": "To Do",
                                "statusCategory": {
                                    "id": 1,
                                    "key": "new",
                                    "name": "To Do",
                                },
                            },
                        },
                    },
                )
            return httpx.Response(404)

        client = create_mock_client(handler)
        created = await client.create_issue(
            summary="Brand new issue created via Cloud API",
            issue_type=IssueType.TASK,
            priority=Priority.HIGH,
            board_id="DEV",
        )
        assert created.key == "DEV-2001"
        assert created.summary == "Brand new issue created via Cloud API"
        assert created_payload is not None
        assert created_payload["fields"]["project"]["key"] == "DEV"
        assert created_payload["fields"]["summary"] == "Brand new issue created via Cloud API"
        await client.close()

    asyncio.run(_test())


def test_jira_browse_url_preserves_custom_domain_even_after_gateway_switch() -> None:
    """Verify issue url uses browse URL even when base_url is api.atlassian.com."""

    async def _test() -> None:
        settings = JiraDashboardSettings(
            jira_url="https://marchwicki.atlassian.net",
            jira_email="dev@example.com",
            jira_api_token="ATATT-12345",
        )
        transport = httpx.MockTransport(lambda req: httpx.Response(200, json={}))
        mock_http = httpx.AsyncClient(
            transport=transport,
            base_url="https://marchwicki.atlassian.net",
        )
        client = JiraCloudClient(settings, http_client=mock_http)
        # Simulate gateway switch
        client.base_url = "https://api.atlassian.com/ex/jira/abc-123"

        issue = client._parse_issue(
            {
                "id": "15103",
                "key": "HOME-15103",
                "fields": {
                    "summary": "Fix Jira Issue Link Format",
                    "issuetype": {"name": "Bug"},
                    "priority": {"name": "High"},
                    "status": {"name": "In Progress", "statusCategory": {"key": "indeterminate"}},
                    "updated": "2026-10-06T00:00:00Z",
                },
            }
        )

        assert issue.url == "https://marchwicki.atlassian.net/browse/HOME-15103"
        await client.close()

    asyncio.run(_test())


def test_get_board_issues_pagination_agile_api() -> None:
    """Verify get_board_issues paginates through multiple pages beyond 100 issues."""

    async def _test() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            url_str = str(request.url)
            assert "/rest/agile/1.0/board/board-pagination/issue" in url_str

            if "startAt=100" in url_str:
                page2_issues = [
                    {
                        "id": str(2000 + i),
                        "key": f"DEV-{2000 + i}",
                        "fields": {
                            "summary": f"Page 2 Issue #{i}",
                            "issuetype": {"name": "Task"},
                            "priority": {"name": "Medium"},
                            "status": {
                                "id": "1",
                                "name": "To Do",
                                "statusCategory": {"key": "new"},
                            },
                            "updated": "2026-10-06T00:00:00Z",
                        },
                    }
                    for i in range(25)
                ]
                return httpx.Response(
                    200,
                    json={
                        "startAt": 100,
                        "maxResults": 100,
                        "total": 125,
                        "isLast": True,
                        "issues": page2_issues,
                    },
                )
            else:
                page1_issues = [
                    {
                        "id": str(1000 + i),
                        "key": f"DEV-{1000 + i}",
                        "fields": {
                            "summary": f"Page 1 Issue #{i}",
                            "issuetype": {"name": "Task"},
                            "priority": {"name": "Medium"},
                            "status": {
                                "id": "1",
                                "name": "To Do",
                                "statusCategory": {"key": "new"},
                            },
                            "updated": "2026-10-06T00:00:00Z",
                        },
                    }
                    for i in range(100)
                ]
                return httpx.Response(
                    200,
                    json={
                        "startAt": 0,
                        "maxResults": 100,
                        "total": 125,
                        "isLast": False,
                        "issues": page1_issues,
                    },
                )

        client = create_mock_client(handler)
        issues = await client.get_board_issues("board-pagination")
        assert len(issues) == 125
        assert issues[0].key == "DEV-1000"
        assert issues[99].key == "DEV-1099"
        assert issues[100].key == "DEV-2000"
        assert issues[124].key == "DEV-2024"
        await client.close()

    asyncio.run(_test())


def test_get_board_issues_pagination_jql_fallback() -> None:
    """Verify JQL fallback paginates beyond 100 issues."""

    async def _test() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            url_str = str(request.url)
            if "/rest/agile/1.0/board" in url_str:
                return httpx.Response(404, json={"errorMessages": ["Board not found"]})

            assert "/rest/api/3/search/jql" in url_str
            if "startAt=100" in url_str:
                page2 = [
                    {
                        "id": str(3000 + i),
                        "key": f"JQL-{3000 + i}",
                        "fields": {
                            "summary": f"JQL Page 2 #{i}",
                            "issuetype": {"name": "Task"},
                            "priority": {"name": "Medium"},
                            "status": {
                                "id": "1",
                                "name": "To Do",
                                "statusCategory": {"key": "new"},
                            },
                            "updated": "2026-10-06T00:00:00Z",
                        },
                    }
                    for i in range(15)
                ]
                return httpx.Response(
                    200,
                    json={
                        "startAt": 100,
                        "maxResults": 100,
                        "total": 115,
                        "isLast": True,
                        "issues": page2,
                    },
                )
            else:
                page1 = [
                    {
                        "id": str(3000 - i),
                        "key": f"JQL-{3000 - i}",
                        "fields": {
                            "summary": f"JQL Page 1 #{i}",
                            "issuetype": {"name": "Task"},
                            "priority": {"name": "Medium"},
                            "status": {
                                "id": "1",
                                "name": "To Do",
                                "statusCategory": {"key": "new"},
                            },
                            "updated": "2026-10-06T00:00:00Z",
                        },
                    }
                    for i in range(100)
                ]
                return httpx.Response(
                    200,
                    json={
                        "startAt": 0,
                        "maxResults": 100,
                        "total": 115,
                        "isLast": False,
                        "issues": page1,
                    },
                )

        client = create_mock_client(handler)
        issues = await client.get_board_issues("DEV")
        assert len(issues) == 115
        assert issues[0].key == "JQL-3000"
        assert issues[100].key == "JQL-3000"
        assert issues[114].key == "JQL-3014"
        await client.close()

    asyncio.run(_test())


def test_get_comments_pagination() -> None:
    """Verify get_comments paginates through multiple pages beyond 100 comments."""

    async def _test() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            url_str = str(request.url)
            assert "/rest/api/3/issue/DEV-1001/comment" in url_str

            if "startAt=100" in url_str:
                return httpx.Response(
                    200,
                    json={
                        "startAt": 100,
                        "maxResults": 100,
                        "total": 110,
                        "comments": [
                            {
                                "id": str(200 + i),
                                "body": f"Page 2 Comment {i}",
                                "created": "2026-10-06T00:00:00Z",
                            }
                            for i in range(10)
                        ],
                    },
                )
            else:
                return httpx.Response(
                    200,
                    json={
                        "startAt": 0,
                        "maxResults": 100,
                        "total": 110,
                        "comments": [
                            {
                                "id": str(100 + i),
                                "body": f"Page 1 Comment {i}",
                                "created": "2026-10-06T00:00:00Z",
                            }
                            for i in range(100)
                        ],
                    },
                )

        client = create_mock_client(handler)
        comments = await client.get_comments("DEV-1001")
        assert len(comments) == 110
        assert comments[0].id == "100"
        assert comments[109].id == "209"
        await client.close()

    asyncio.run(_test())


def test_map_issue_type() -> None:
    """Verify map_issue_type correctly classifies all issue types including epic."""
    assert map_issue_type("Epic") == IssueType.EPIC
    assert map_issue_type("epic") == IssueType.EPIC
    assert map_issue_type("EPIC") == IssueType.EPIC
    assert map_issue_type("Story") == IssueType.STORY
    assert map_issue_type("Bug") == IssueType.BUG
    assert map_issue_type("Sub-task") == IssueType.SUBTASK
    assert map_issue_type("Subtask") == IssueType.SUBTASK
    assert map_issue_type("Task") == IssueType.TASK
    assert map_issue_type("Unknown Custom Type") == IssueType.TASK
    assert map_issue_type("") == IssueType.TASK


def test_parse_issue_epic_and_recreate_after() -> None:
    """Verify JiraCloudClient correctly parses Epic issue types and recreate_after."""

    async def _test() -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            assert "/rest/api/3/issue/HOME-2200" in str(request.url)
            return httpx.Response(
                200,
                json={
                    "id": "12203",
                    "key": "HOME-2200",
                    "fields": {
                        "summary": "Faith and Scripture Study",
                        "issuetype": {
                            "id": "10000",
                            "name": "Epic",
                            "subtask": False,
                        },
                        "priority": {"name": "Medium"},
                        "status": {
                            "id": "10003",
                            "name": "Ready",
                            "statusCategory": {"id": 2, "key": "new", "name": "To Do"},
                        },
                        "customfield_10027": "!1y",
                        "created": "2020-06-07T18:48:16.931+0200",
                        "updated": "2022-10-08T20:39:00.710+0200",
                    },
                },
            )

        client = create_mock_client(handler)
        issue = await client.get_issue("HOME-2200")
        assert issue is not None
        assert issue.key == "HOME-2200"
        assert issue.issue_type == IssueType.EPIC
        assert issue.recreate_after == "!1y"
        await client.close()

    asyncio.run(_test())
