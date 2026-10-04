"""Unit tests for FakeJiraClient test double."""

from __future__ import annotations

import asyncio

import pytest

from jira_dashboard.adapters.jira_client import FakeJiraClient, JiraAPIError
from jira_dashboard.domain import StatusCategory


def test_fake_jira_client_fetches_seed_issues() -> None:
    """Verify FakeJiraClient initial seed issue population."""

    async def _test() -> None:
        client = FakeJiraClient()
        issues = await client.get_board_issues("board-1")
        assert len(issues) == 5
        assert any(i.key == "PROJ-101" for i in issues)

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
