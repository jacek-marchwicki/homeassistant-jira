"""Unit tests for asynchronous Jira outbox synchronization worker and conflict resolution."""

from __future__ import annotations

import asyncio
from typing import Any

from jira_dashboard.adapters import FakeJiraClient
from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.adapters.sync_worker import JiraSyncWorker
from jira_dashboard.domain import (
    IssueType,
    JiraIssue,
    JiraStatus,
    Priority,
    StatusCategory,
)


def test_sync_worker_processes_transition_fifo() -> None:
    async def _test() -> None:
        storage = SQLiteStorage(":memory:")
        storage.init_db()
        fake_jira = FakeJiraClient()
        fake_jira.reset()

        broadcast_events: list[dict[str, Any]] = []

        async def mock_broadcast(msg: dict[str, Any]) -> None:
            broadcast_events.append(msg)

        worker = JiraSyncWorker(storage, fake_jira, ws_broadcast_func=mock_broadcast)

        # Seed local storage with initial issue
        remote_issue = await fake_jira.get_issue("PROJ-101")
        assert remote_issue is not None
        storage.upsert_issue(remote_issue)

        # Enqueue a transition
        outbox_id = storage.enqueue_outbox(
            client_mutation_id="mut-t1",
            action_type="transition_issue",
            issue_key="PROJ-101",
            payload={"target_category": "inprogress", "target_status": "In Progress"},
            base_updated_at=remote_issue.updated_at,
        )

        processed = await worker.process_next_pending()
        assert processed is True

        # Outbox status must be completed
        item = storage.get_outbox_item(outbox_id)
        assert item is not None
        assert item["status"] == "completed"

        # Jira remote issue must be In Progress
        jira_issue = await fake_jira.get_issue("PROJ-101")
        assert jira_issue is not None
        assert jira_issue.status.category == StatusCategory.IN_PROGRESS

        # Local SQLite issue must also be updated
        local_issue = storage.get_issue("PROJ-101")
        assert local_issue is not None
        assert local_issue.status.category == StatusCategory.IN_PROGRESS

        # Broadcast event sent
        assert len(broadcast_events) == 1
        assert broadcast_events[0]["event"] == "issue_transitioned"
        assert broadcast_events[0]["issue_key"] == "PROJ-101"

    asyncio.run(_test())


def test_sync_worker_partial_field_update() -> None:
    async def _test() -> None:
        storage = SQLiteStorage(":memory:")
        storage.init_db()
        fake_jira = FakeJiraClient()
        fake_jira.reset()

        worker = JiraSyncWorker(storage, fake_jira)

        remote_issue = await fake_jira.get_issue("PROJ-101")
        assert remote_issue is not None
        storage.upsert_issue(remote_issue)
        orig_summary = remote_issue.summary

        # Enqueue update with ONLY assignee_name
        outbox_id = storage.enqueue_outbox(
            client_mutation_id="mut-u1",
            action_type="update_issue",
            issue_key="PROJ-101",
            payload={"assignee_name": "Bob Builder"},
            base_updated_at=remote_issue.updated_at,
        )

        processed = await worker.process_next_pending()
        assert processed is True

        item = storage.get_outbox_item(outbox_id)
        assert item is not None
        assert item["status"] == "completed"

        # Remote issue should have new assignee, summary left intact
        jira_issue = await fake_jira.get_issue("PROJ-101")
        assert jira_issue is not None
        assert jira_issue.assignee is not None
        assert jira_issue.assignee.display_name == "Bob Builder"
        assert jira_issue.summary == orig_summary

    asyncio.run(_test())


def test_sync_worker_offline_backoff() -> None:
    async def _test() -> None:
        storage = SQLiteStorage(":memory:")
        storage.init_db()
        fake_jira = FakeJiraClient()
        fake_jira.reset()
        fake_jira.simulate_failure = True
        fake_jira.failure_status_code = 503
        fake_jira.failure_message = "Jira API Unreachable"

        worker = JiraSyncWorker(storage, fake_jira)

        outbox_id = storage.enqueue_outbox(
            client_mutation_id="mut-fail",
            action_type="update_issue",
            issue_key="PROJ-101",
            payload={"summary": "New Summary"},
            base_updated_at="2026-10-04T12:00:00Z",
        )

        processed = await worker.process_next_pending()
        assert processed is False

        # Outbox item remains pending, but retry count incremented
        item = storage.get_outbox_item(outbox_id)
        assert item is not None
        assert item["status"] == "pending"
        assert item["retry_count"] >= 1
        assert "Jira API Unreachable" in (item["error_message"] or "")

    asyncio.run(_test())


def test_sync_worker_conflict_resolution_remote_wins() -> None:
    async def _test() -> None:
        storage = SQLiteStorage(":memory:")
        storage.init_db()
        fake_jira = FakeJiraClient()
        fake_jira.reset()

        broadcast_events: list[dict[str, Any]] = []

        async def mock_broadcast(msg: dict[str, Any]) -> None:
            broadcast_events.append(msg)

        worker = JiraSyncWorker(storage, fake_jira, ws_broadcast_func=mock_broadcast)

        remote_issue = await fake_jira.get_issue("PROJ-101")
        assert remote_issue is not None

        # Simulate an external update on Jira happening in the meantime:
        # Remote issue updated_at is newer than base_updated_at
        await fake_jira.update_issue("PROJ-101", summary="Updated by someone else on Jira")
        current_remote = await fake_jira.get_issue("PROJ-101")
        assert current_remote is not None

        # Enqueue a conflicting local mutation based on OLD timestamp
        old_timestamp = "2026-10-01T00:00:00Z"
        outbox_id = storage.enqueue_outbox(
            client_mutation_id="mut-conflict",
            action_type="update_issue",
            issue_key="PROJ-101",
            payload={"summary": "My local offline edit"},
            base_updated_at=old_timestamp,
        )

        processed = await worker.process_next_pending()
        assert processed is True

        # Outbox item should be marked skipped_conflict
        item = storage.get_outbox_item(outbox_id)
        assert item is not None
        assert item["status"] == "skipped_conflict"

        # Local SQLite issue should adopt the remote Jira issue (remote wins)
        local_issue = storage.get_issue("PROJ-101")
        assert local_issue is not None
        assert local_issue.summary == "Updated by someone else on Jira"

        # Broadcast event informs clients of authoritative remote issue
        assert len(broadcast_events) >= 1
        assert broadcast_events[-1]["event"] == "issue_updated"
        assert broadcast_events[-1]["issue"]["summary"] == "Updated by someone else on Jira"

    asyncio.run(_test())


def test_sync_worker_create_issue_remaps_temp_key() -> None:
    async def _test() -> None:
        storage = SQLiteStorage(":memory:")
        storage.init_db()
        fake_jira = FakeJiraClient()
        fake_jira.reset()

        broadcast_events: list[dict[str, Any]] = []

        async def mock_broadcast(msg: dict[str, Any]) -> None:
            broadcast_events.append(msg)

        worker = JiraSyncWorker(storage, fake_jira, ws_broadcast_func=mock_broadcast)

        # Save a temporary local issue in SQLite
        temp_issue = JiraIssue(
            id="TEMP-999",
            key="TEMP-999",
            summary="Offline Created Issue",
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
            created_at="2026-10-07T12:00:00Z",
            updated_at="2026-10-07T12:00:00Z",
        )
        storage.upsert_issue(temp_issue)

        outbox_id = storage.enqueue_outbox(
            client_mutation_id="mut-create",
            action_type="create_issue",
            issue_key="TEMP-999",
            payload={
                "summary": "Offline Created Issue",
                "issue_type": "task",
                "priority": "medium",
                "status_category": "todo",
            },
            base_updated_at=None,
        )

        processed = await worker.process_next_pending()
        assert processed is True

        # Outbox item completed
        item = storage.get_outbox_item(outbox_id)
        assert item is not None
        assert item["status"] == "completed"

        # TEMP-999 should be deleted from SQLite
        assert storage.get_issue("TEMP-999") is None

        # New real issue should exist in SQLite and FakeJiraClient
        assert len(broadcast_events) == 1
        created_key = broadcast_events[0]["issue_key"]
        assert not created_key.startswith("TEMP-")
        assert storage.get_issue(created_key) is not None

    asyncio.run(_test())
