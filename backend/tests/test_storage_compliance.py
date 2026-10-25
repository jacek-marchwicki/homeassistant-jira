"""Compliance test suite ensuring all StorageProtocol implementations behave identically."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.adapters.storage_protocol import StorageProtocol
from jira_dashboard.domain.models import (
    BoardColumn,
    IssueType,
    JiraIssue,
    JiraStatus,
    JiraUser,
    Priority,
)


class BaseStorageComplianceTest:
    """Contract tests that must pass for any StorageProtocol implementation."""

    def create_storage(self) -> StorageProtocol:
        raise NotImplementedError

    def _sample_issue(self, key: str = "PROJ-101", summary: str = "Test Task") -> JiraIssue:
        return JiraIssue(
            id=key.replace("PROJ-", ""),
            key=key,
            summary=summary,
            status=JiraStatus(id="1", name="To Do", category="todo"),
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            assignee=JiraUser(account_id="u1", display_name="Alice", avatar_url=""),
            description="Sample description",
            rank="0|i00001:",
            updated_at="2026-10-25T12:00:00.000Z",
        )

    def test_board_meta_roundtrip(self) -> None:
        storage = self.create_storage()
        columns = [
            BoardColumn(id="col-1", name="To Do", category="todo", status_ids=["1"]),
            BoardColumn(id="col-2", name="Done", category="done", status_ids=["3"]),
        ]
        storage.save_board_meta(
            board_id="board-42",
            board_name="Sprint Board",
            sprint_name="Sprint 1",
            jira_url="https://jira.example.com",
            columns=columns,
        )

        meta = storage.get_board_meta("board-42")
        assert meta is not None
        assert meta["board_id"] == "board-42"
        assert meta["board_name"] == "Sprint Board"
        assert meta["sprint_name"] == "Sprint 1"
        assert meta["jira_url"] == "https://jira.example.com"
        assert len(meta["columns"]) == 2
        assert meta["columns"][0].name == "To Do"
        assert meta["columns"][1].name == "Done"

    def test_issues_crud_and_filtering(self) -> None:
        storage = self.create_storage()
        issue1 = self._sample_issue("PROJ-1", "First")
        issue2 = JiraIssue(
            id="2",
            key="PROJ-2",
            summary="Second",
            status=JiraStatus(id="3", name="Done", category="done"),
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            assignee=JiraUser(account_id="u2", display_name="Bob", avatar_url=""),
            description="",
            rank="0|i00002:",
            updated_at="2026-10-25T12:05:00.000Z",
        )

        storage.save_issues([issue1, issue2])

        # Get all
        all_issues = storage.get_issues()
        assert len(all_issues) == 2
        keys = {i.key for i in all_issues}
        assert keys == {"PROJ-1", "PROJ-2"}

        # Single get
        retrieved = storage.get_issue("PROJ-1")
        assert retrieved is not None
        assert retrieved.summary == "First"
        assert storage.get_issue("NONEXISTENT") is None

        # Upsert: update existing
        updated_issue1 = issue1.model_copy(update={"summary": "Updated First"})
        storage.upsert_issue(updated_issue1)
        assert storage.get_issue("PROJ-1").summary == "Updated First"

        # Delete issue
        storage.delete_issue("PROJ-1")
        assert storage.get_issue("PROJ-1") is None
        assert len(storage.get_issues()) == 1

        # Replace all issues
        storage.replace_all_issues([issue1])
        refreshed = storage.get_issues()
        assert len(refreshed) == 1
        assert refreshed[0].key == "PROJ-1"

    def test_outbox_fifo_and_status(self) -> None:
        storage = self.create_storage()
        id1 = storage.enqueue_outbox("mut-1", "transition_issue", "PROJ-1", {"status_id": "3"})
        id2 = storage.enqueue_outbox("mut-2", "update_issue", "PROJ-2", {"summary": "New Title"})

        pending = storage.get_pending_outbox()
        assert len(pending) == 2
        assert pending[0]["id"] == id1
        assert pending[0]["issue_key"] == "PROJ-1"
        assert pending[1]["id"] == id2
        assert pending[1]["issue_key"] == "PROJ-2"

        # Update status
        storage.update_outbox_status(id1, "sent")
        pending_after = storage.get_pending_outbox()
        assert len(pending_after) == 1
        assert pending_after[0]["id"] == id2

        storage.update_outbox_status(
            id2, "failed", error_message="Network error", increment_retry=True
        )
        item2 = storage.get_outbox_item(id2)
        assert item2 is not None
        assert item2["status"] == "failed"
        assert item2["error_message"] == "Network error"
        assert item2["retry_count"] >= 1

        # Clear outbox
        storage.clear_outbox()
        assert len(storage.get_pending_outbox()) == 0
        assert storage.get_outbox_item(id2) is None

    def test_daily_generation_quota(self) -> None:
        storage = self.create_storage()
        today = "2026-10-25"
        tomorrow = "2026-10-26"

        assert storage.get_daily_generation_count(today) == 0
        new_cnt1 = storage.increment_daily_generation_count(today)
        assert new_cnt1 == 1
        new_cnt2 = storage.increment_daily_generation_count(today)
        assert new_cnt2 == 2
        assert storage.get_daily_generation_count(today) == 2

        # Tomorrow is a fresh 0 count
        assert storage.get_daily_generation_count(tomorrow) == 0

    def test_background_image_metadata_and_pruning(self) -> None:
        storage = self.create_storage()
        h1 = "hash-1"
        h2 = "hash-2"

        storage.save_background_image(h1, "/data/cache/h1.webp", 1024, issue_key="PROJ-1")
        storage.save_background_image(h2, "/data/cache/h2.webp", 2048, issue_key="PROJ-2")

        rec1 = storage.get_background_image(h1)
        assert rec1 is not None
        assert rec1["content_hash"] == h1
        assert rec1["byte_size"] == 1024
        assert rec1["file_path"] == "/data/cache/h1.webp"

        # Check last background hash for issue
        assert storage.get_issue_last_background_hash("PROJ-1") == h1
        assert storage.get_issue_last_background_hash("PROJ-999") is None

        # Touch last accessed
        storage.touch_background_image(h1)

        # Prune with retention_seconds: with retention=0 or high value
        deleted = storage.prune_expired_background_images(retention_seconds=86400)
        assert isinstance(deleted, list)

    def test_oauth_codes_and_tokens(self) -> None:
        storage = self.create_storage()

        # OAuth code lifecycle (single-use constraint)
        code = "secret-auth-code-123"
        storage.save_oauth_code(
            code=code,
            email="user@example.com",
            client_id="gemini-client",
            redirect_uri="https://oauth.google.com/callback",
            code_challenge="challenge-abc",
            code_challenge_method="S256",
            ttl_seconds=300,
        )

        consumed = storage.consume_oauth_code(code)
        assert consumed is not None
        assert consumed["client_id"] == "gemini-client"
        assert consumed["email"] == "user@example.com"
        assert consumed["code_challenge"] == "challenge-abc"

        # Must be single use: second consumption returns None
        assert storage.consume_oauth_code(code) is None

        # Refresh token lifecycle
        r_token = "refresh-tok-xyz"
        storage.save_refresh_token(
            token=r_token,
            email="user@example.com",
            client_id="gemini-client",
            ttl_seconds=2592000,
        )

        got_token = storage.get_refresh_token(r_token)
        assert got_token is not None
        assert got_token["email"] == "user@example.com"

        storage.revoke_refresh_token(r_token)
        assert storage.get_refresh_token(r_token) is None

    def test_account_types(self) -> None:
        storage = self.create_storage()
        assert storage.get_account_types() == {}

        storage.set_account_type("Alice", "child")
        types = storage.get_account_types()
        assert types == {"alice": "child"}

        # Setting to 'parent' removes child classification
        storage.set_account_type("Alice", "parent")
        assert storage.get_account_types() == {}

        storage.set_account_type("Bob", "child")
        assert storage.get_account_types() == {"bob": "child"}
        storage.clear_account_types()
        assert storage.get_account_types() == {}


class TestSQLiteStorage(BaseStorageComplianceTest, unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.sqlite3"
        self.storage = SQLiteStorage(self.db_path)
        self.storage.init_db()

    def tearDown(self) -> None:
        self.storage.close()
        self.temp_dir.cleanup()

    def create_storage(self) -> StorageProtocol:
        return self.storage


class TestFirestoreStorage(BaseStorageComplianceTest, unittest.TestCase):
    def setUp(self) -> None:
        import sys

        tests_dir = Path(__file__).resolve().parent
        if str(tests_dir) not in sys.path:
            sys.path.insert(0, str(tests_dir))

        from mocks.fake_firestore import FakeFirestoreClient

        from jira_dashboard.adapters.firestore_storage import FirestoreStorage

        self.client = FakeFirestoreClient()
        self.storage = FirestoreStorage(client=self.client)
        self.storage.init_db()

    def tearDown(self) -> None:
        self.storage.close()

    def create_storage(self) -> StorageProtocol:
        return self.storage
