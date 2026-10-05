"""Unit tests for FakeJiraClient test double."""

from __future__ import annotations

import asyncio

import pytest

from jira_dashboard.adapters.jira_client import FakeJiraClient, JiraAPIError
from jira_dashboard.domain import Priority, StatusCategory


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
