"""Unit tests for JiraWebhookProcessor shared event processor."""

from __future__ import annotations

import unittest
from typing import Any

from jira_dashboard.adapters.jira_client import FakeJiraClient
from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.adapters.webhook_processor import JiraWebhookProcessor
from jira_dashboard.domain import IssueType, JiraIssue, JiraStatus, Priority, StatusCategory


class MockBroadcaster:
    """In-memory broadcaster tracking sent WebSocket messages."""

    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    async def broadcast(self, message: dict[str, Any]) -> None:
        self.messages.append(message)


class TestWebhookProcessor(unittest.IsolatedAsyncioTestCase):
    """Test suite verifying unified Jira webhook payload processing."""

    def setUp(self) -> None:
        self.storage = SQLiteStorage(":memory:")
        self.storage.init_db()

        self.initial_issue = JiraIssue(
            id="101",
            key="PROJ-101",
            summary="Initial task",
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
            updated_at="2026-11-01T10:00:00Z",
        )
        self.jira_client = FakeJiraClient(initial_issues=[self.initial_issue])
        self.storage.save_issues([self.initial_issue])

        self.broadcaster = MockBroadcaster()
        self.board_cache: list[JiraIssue] = [self.initial_issue]

        def update_board_cache(issue: JiraIssue | None, deleted_key: str | None) -> None:
            if deleted_key:
                self.board_cache = [x for x in self.board_cache if x.key != deleted_key]
            elif issue:
                idx = next((i for i, x in enumerate(self.board_cache) if x.key == issue.key), None)
                if idx is not None:
                    self.board_cache[idx] = issue
                else:
                    self.board_cache.insert(0, issue)

        self.processor = JiraWebhookProcessor(
            jira_client=self.jira_client,
            storage=self.storage,
            ws_hub=self.broadcaster,
            board_cache_updater=update_board_cache,
        )

    async def test_process_issue_updated(self) -> None:
        """Verify issue_updated saves to storage, updates cache, and broadcasts transition."""
        payload = {
            "webhookEvent": "jira:issue_updated",
            "issue": {
                "id": "101",
                "key": "PROJ-101",
                "fields": {
                    "summary": "Updated summary",
                    "status": {
                        "name": "Done",
                        "statusCategory": {"id": 3, "key": "done", "name": "Done"},
                    },
                },
            },
        }

        res = await self.processor.process_payload(payload)
        self.assertEqual(res["status"], "processed")
        self.assertEqual(res["issue_key"], "PROJ-101")
        self.assertEqual(res["status_category"], "done")

        # Verify storage updated
        stored = self.storage.get_issue("PROJ-101")
        self.assertIsNotNone(stored)
        assert stored is not None
        self.assertEqual(stored.summary, "Updated summary")
        self.assertEqual(stored.status.category, StatusCategory.DONE)

        # Verify board cache updated
        self.assertEqual(self.board_cache[0].summary, "Updated summary")

        # Verify broadcast
        self.assertEqual(len(self.broadcaster.messages), 1)
        msg = self.broadcaster.messages[0]
        self.assertEqual(msg["event"], "issue_transitioned")
        self.assertEqual(msg["issue_key"], "PROJ-101")
        self.assertEqual(msg["status_category"], "done")

    async def test_process_issue_created(self) -> None:
        """Verify issue_created saves to storage, updates cache, and broadcasts issue_created."""
        payload = {
            "webhookEvent": "jira:issue_created",
            "issue": {
                "id": "102",
                "key": "PROJ-102",
                "fields": {
                    "summary": "Brand new task",
                    "status": {
                        "name": "In Progress",
                        "statusCategory": {
                            "id": 2,
                            "key": "indeterminate",
                            "name": "In Progress",
                        },
                    },
                },
            },
        }

        res = await self.processor.process_payload(payload)
        self.assertEqual(res["status"], "processed")
        self.assertEqual(res["issue_key"], "PROJ-102")

        # Verify storage
        stored = self.storage.get_issue("PROJ-102")
        self.assertIsNotNone(stored)
        assert stored is not None
        self.assertEqual(stored.summary, "Brand new task")
        self.assertEqual(stored.status.category, StatusCategory.IN_PROGRESS)

        # Verify broadcast
        self.assertEqual(len(self.broadcaster.messages), 1)
        msg = self.broadcaster.messages[0]
        self.assertEqual(msg["event"], "issue_created")
        self.assertEqual(msg["issue_key"], "PROJ-102")

    async def test_process_issue_deleted(self) -> None:
        """Verify issue_deleted removes from storage and client, and broadcasts issue_deleted."""
        payload = {
            "webhookEvent": "jira:issue_deleted",
            "issue": {
                "id": "101",
                "key": "PROJ-101",
            },
        }

        res = await self.processor.process_payload(payload)
        self.assertEqual(res["status"], "deleted")
        self.assertEqual(res["issue_key"], "PROJ-101")

        # Verify removed from storage
        self.assertIsNone(self.storage.get_issue("PROJ-101"))

        # Verify removed from board cache
        self.assertEqual(len(self.board_cache), 0)

        # Verify removed from FakeJiraClient
        self.assertNotIn("PROJ-101", self.jira_client._issues)

        # Verify broadcast
        self.assertEqual(len(self.broadcaster.messages), 1)
        msg = self.broadcaster.messages[0]
        self.assertEqual(msg["event"], "issue_deleted")
        self.assertEqual(msg["issue_key"], "PROJ-101")

    async def test_unsupported_or_empty_event_ignored(self) -> None:
        """Verify unrecognized payloads return status ignored."""
        res = await self.processor.process_payload({"webhookEvent": "jira:version_created"})
        self.assertEqual(res["status"], "ignored")
        self.assertEqual(len(self.broadcaster.messages), 0)
