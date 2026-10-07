"""Unit tests for FakeJiraClient test double."""

from __future__ import annotations

import asyncio

import pytest

from jira_dashboard.adapters.jira_client import FakeJiraClient, JiraAPIError
from jira_dashboard.domain import IssueType, Priority, StatusCategory


def test_fake_jira_client_fetches_seed_issues() -> None:
    """Verify FakeJiraClient initial seed issue population."""

    async def _test() -> None:
        client = FakeJiraClient()
        issues = await client.get_board_issues("board-1")
        assert len(issues) == 6
        assert any(i.key == "PROJ-101" for i in issues)
        assert any(i.key == "PROJ-104" for i in issues)
        assert any(i.key == "PROJ-105" for i in issues)

    asyncio.run(_test())


def test_fake_jira_client_transition_issue() -> None:
    """Verify issue transition updates category and status name."""

    async def _test() -> None:
        client = FakeJiraClient()
        updated = await client.transition_issue("PROJ-101", StatusCategory.DONE)
        assert updated.status.category == StatusCategory.DONE
        assert updated.status.name == "Done"

        # Confirm persistence in fake store
        fetched = await client.get_issue("PROJ-101")
        assert fetched is not None
        assert fetched.status.category == StatusCategory.DONE

    asyncio.run(_test())


def test_fake_jira_client_transition_by_status_name() -> None:
    """Verify issue transition supports specific target status name."""

    async def _test() -> None:
        client = FakeJiraClient()
        updated = await client.transition_issue("PROJ-101", target_status="Ready")
        assert updated.status.name == "Ready"
        assert updated.status.category == StatusCategory.TODO

    asyncio.run(_test())


def test_fake_jira_client_update_issue() -> None:
    """Verify FakeJiraClient update_issue modifies fields appropriately."""

    async def _test() -> None:
        client = FakeJiraClient()
        updated = await client.update_issue(
            "PROJ-101",
            summary="New Summary for PROJ-101",
            priority=Priority.HIGHEST,
            story_points=8.0,
            assignee_name="Updated Engineer",
            due_date="2026-12-31",
        )
        assert updated.summary == "New Summary for PROJ-101"
        assert updated.priority == Priority.HIGHEST
        assert updated.story_points == 8.0
        assert updated.assignee is not None
        assert updated.assignee.display_name == "Updated Engineer"
        assert updated.due_date == "2026-12-31"

        # Verify persistence
        fetched = await client.get_issue("PROJ-101")
        assert fetched is not None
        assert fetched.summary == "New Summary for PROJ-101"
        assert fetched.priority == Priority.HIGHEST

    asyncio.run(_test())


def test_fake_jira_client_get_board_columns() -> None:
    """Verify get_board_columns returns default workflow columns."""

    async def _test() -> None:
        client = FakeJiraClient()
        cols = await client.get_board_columns("engineering-1")
        assert len(cols) == 4
        assert [c.name for c in cols] == ["To Do", "In Progress", "In Review", "Done"]

    asyncio.run(_test())


def test_fake_jira_client_transition_nonexistent_raises() -> None:
    """Verify transitioning unknown key raises 404 JiraAPIError."""

    async def _test() -> None:
        client = FakeJiraClient()
        with pytest.raises(JiraAPIError) as exc_info:
            await client.transition_issue("UNKNOWN-999", StatusCategory.DONE)
        assert exc_info.value.status_code == 404

    asyncio.run(_test())


def test_fake_jira_client_simulated_failure() -> None:
    """Verify simulated failure can be enabled and disabled."""

    async def _test() -> None:
        client = FakeJiraClient()
        client.set_simulate_failure(True, status_code=503, message="Jira Unavailable")

        with pytest.raises(JiraAPIError) as exc_info:
            await client.get_board_issues("board-1")
        assert exc_info.value.status_code == 503
        assert "Jira Unavailable" in str(exc_info.value)

        # Disable failure
        client.set_simulate_failure(False)
        issues = await client.get_board_issues("board-1")
        assert len(issues) > 0

    asyncio.run(_test())


def test_fake_jira_client_processes_webhook_update() -> None:
    """Verify parsing and applying standard Jira Cloud webhook payloads."""

    async def _test() -> None:
        client = FakeJiraClient()
        webhook_payload = {
            "webhookEvent": "jira:issue_updated",
            "issue": {
                "id": "101",
                "key": "PROJ-101",
                "fields": {
                    "summary": "Updated summary from webhook",
                    "status": {
                        "name": "Done",
                        "statusCategory": {"id": 3, "key": "done", "name": "Done"},
                    },
                },
            },
        }

        updated = await client.process_webhook(webhook_payload)
        assert updated is not None
        assert updated.key == "PROJ-101"
        assert updated.summary == "Updated summary from webhook"
        assert updated.status.category == StatusCategory.DONE

    asyncio.run(_test())


def test_fake_jira_client_processes_new_issue_webhook() -> None:
    """Verify webhook with a new issue adds it to the board."""

    async def _test() -> None:
        client = FakeJiraClient()
        new_issue_payload = {
            "webhookEvent": "jira:issue_created",
            "issue": {
                "id": "205",
                "key": "PROJ-205",
                "fields": {
                    "summary": "Brand new issue created via Jira",
                    "status": {
                        "name": "To Do",
                        "statusCategory": {"id": 2, "key": "new", "name": "To Do"},
                    },
                },
            },
        }

        created = await client.process_webhook(new_issue_payload)
        assert created is not None
        assert created.key == "PROJ-205"
        assert created.summary == "Brand new issue created via Jira"

        # Confirm issue now exists in board issues
        issues = await client.get_board_issues("board-1")
        assert any(i.key == "PROJ-205" for i in issues)

    asyncio.run(_test())


def test_fake_jira_client_create_issue() -> None:
    """Verify create_issue creates a new issue and stores it."""

    async def _test() -> None:
        client = FakeJiraClient()
        new_issue = await client.create_issue(
            summary="New custom issue",
            issue_type=IssueType.BUG,
            priority=Priority.HIGHEST,
            assignee_name="Alice Smith",
            story_points=5.0,
            due_date="2026-11-01",
        )
        assert new_issue.key.startswith("PROJ-")
        assert new_issue.summary == "New custom issue"
        assert new_issue.issue_type == IssueType.BUG
        assert new_issue.priority == Priority.HIGHEST
        assert new_issue.assignee is not None
        assert new_issue.assignee.display_name == "Alice Smith"
        assert new_issue.story_points == 5.0
        assert new_issue.due_date == "2026-11-01"

        # Verify it can be retrieved
        fetched = await client.get_issue(new_issue.key)
        assert fetched is not None
        assert fetched.summary == "New custom issue"

    asyncio.run(_test())


def test_fake_jira_client_empty_when_env_not_fake(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify FakeJiraClient does not seed example issues when JIRA_USE_FAKE is not '1'."""
    monkeypatch.delenv("JIRA_USE_FAKE", raising=False)
    client = FakeJiraClient()
    assert client._issues == {}
    assert client._comments == {}


def test_fake_jira_client_rank_issue(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify FakeJiraClient rank_issue adjusts relative order and rank values."""
    monkeypatch.setenv("JIRA_USE_FAKE", "1")

    async def _test() -> None:
        client = FakeJiraClient()
        # Move PROJ-101 after PROJ-98
        updated = await client.rank_issue("PROJ-101", rank_after_key="PROJ-98")
        assert updated.key == "PROJ-101"
        assert updated.rank is not None

        issues = await client.get_board_issues("board-1")
        keys = [i.key for i in issues]
        assert keys.index("PROJ-98") < keys.index("PROJ-101")

        # Move PROJ-72 before PROJ-101
        updated_72 = await client.rank_issue("PROJ-72", rank_before_key="PROJ-101")
        assert updated_72.key == "PROJ-72"
        issues2 = await client.get_board_issues("board-1")
        keys2 = [i.key for i in issues2]
        assert keys2.index("PROJ-72") < keys2.index("PROJ-101")

    asyncio.run(_test())
