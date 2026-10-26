"""Unit tests for SQLite persistent storage and outbox queue."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.domain import (
    BoardColumn,
    IssueType,
    JiraIssue,
    JiraIssueLink,
    JiraLinkedIssue,
    JiraStatus,
    JiraUser,
    Priority,
    StatusCategory,
)


@pytest.fixture
def temp_db_path() -> Path:
    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as f:
        path = Path(f.name)
    yield path
    if path.exists():
        path.unlink()


@pytest.fixture
def sample_issue() -> JiraIssue:
    return JiraIssue(
        id="101",
        key="TEST-101",
        summary="Test offline persistence issue",
        description="Detailed description for testing",
        url="https://jira.example.com/browse/TEST-101",
        issue_type=IssueType.TASK,
        priority=Priority.HIGH,
        status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        assignee=JiraUser(account_id="usr-1", display_name="Jacek Marchwicki"),
        story_points=3.0,
        due_date="2026-10-15",
        start_date="2026-10-01",
        recreate_after="1w",
        created_at="2026-10-01T09:00:00Z",
        updated_at="2026-10-04T12:00:00Z",
    )


def test_sqlite_storage_init_creates_schema(temp_db_path: Path) -> None:
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    # Schema version should be set
    version = storage.get_schema_version()
    assert version >= 1

    # Tables should exist
    assert storage.get_issues() == []
    assert storage.get_pending_outbox() == []


def test_board_meta_roundtrip(temp_db_path: Path) -> None:
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    columns = [
        BoardColumn(id="col-1", name="To Do", category=StatusCategory.TODO, status_ids=["1"]),
        BoardColumn(id="col-2", name="Done", category=StatusCategory.DONE, status_ids=["2"]),
    ]

    storage.save_board_meta(
        board_id="b-1",
        board_name="Engineering Board",
        sprint_name="Sprint 42",
        jira_url="https://jira.example.com",
        columns=columns,
    )

    meta = storage.get_board_meta("b-1")
    assert meta is not None
    assert meta["board_id"] == "b-1"
    assert meta["board_name"] == "Engineering Board"
    assert meta["sprint_name"] == "Sprint 42"
    assert len(meta["columns"]) == 2
    assert meta["columns"][0].name == "To Do"


def test_issue_save_get_and_upsert(temp_db_path: Path, sample_issue: JiraIssue) -> None:
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    storage.save_issues([sample_issue])
    retrieved = storage.get_issue(sample_issue.key)
    assert retrieved is not None
    assert retrieved.key == sample_issue.key
    assert retrieved.summary == sample_issue.summary
    assert retrieved.status.category == StatusCategory.TODO
    assert retrieved.assignee is not None
    assert retrieved.assignee.display_name == "Jacek Marchwicki"

    # Upsert with single field update (transition to In Progress)
    updated_issue = sample_issue.model_copy(
        update={
            "status": JiraStatus(id="2", name="In Progress", category=StatusCategory.IN_PROGRESS),
            "updated_at": "2026-10-07T14:00:00Z",
        }
    )
    storage.upsert_issue(updated_issue)

    retrieved_updated = storage.get_issue(sample_issue.key)
    assert retrieved_updated is not None
    assert retrieved_updated.status.category == StatusCategory.IN_PROGRESS
    assert retrieved_updated.status.name == "In Progress"
    assert retrieved_updated.updated_at == "2026-10-07T14:00:00Z"


def test_sync_outbox_enqueue_and_fifo_order(temp_db_path: Path) -> None:
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    # Enqueue first mutation
    id1 = storage.enqueue_outbox(
        client_mutation_id="mut-1",
        action_type="transition_issue",
        issue_key="TEST-101",
        payload={"target_category": "inprogress", "target_status": "In Progress"},
        base_updated_at="2026-10-04T12:00:00Z",
    )

    # Enqueue second mutation (single field edit)
    id2 = storage.enqueue_outbox(
        client_mutation_id="mut-2",
        action_type="update_issue",
        issue_key="TEST-101",
        payload={"assignee_name": "Alex Lead"},
        base_updated_at="2026-10-04T12:05:00Z",
    )

    pending = storage.get_pending_outbox()
    assert len(pending) == 2
    assert pending[0]["id"] == id1
    assert pending[0]["client_mutation_id"] == "mut-1"
    assert pending[0]["action_type"] == "transition_issue"
    assert pending[0]["payload"]["target_category"] == "inprogress"

    assert pending[1]["id"] == id2
    assert pending[1]["client_mutation_id"] == "mut-2"
    assert pending[1]["action_type"] == "update_issue"
    assert pending[1]["payload"] == {"assignee_name": "Alex Lead"}


def test_outbox_status_transitions(temp_db_path: Path) -> None:
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    outbox_id = storage.enqueue_outbox(
        client_mutation_id="mut-test",
        action_type="update_issue",
        issue_key="TEST-101",
        payload={"summary": "New summary"},
        base_updated_at="2026-10-04T12:00:00Z",
    )

    # Update to in_progress
    storage.update_outbox_status(outbox_id, "in_progress")
    in_prog = storage.get_outbox_item(outbox_id)
    assert in_prog is not None
    assert in_prog["status"] == "in_progress"

    # Mark completed
    storage.update_outbox_status(outbox_id, "completed")
    completed = storage.get_outbox_item(outbox_id)
    assert completed is not None
    assert completed["status"] == "completed"

    # Should no longer appear in pending
    assert storage.get_pending_outbox() == []


def test_outbox_skipped_conflict_status(temp_db_path: Path) -> None:
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    outbox_id = storage.enqueue_outbox(
        client_mutation_id="mut-conflict",
        action_type="update_issue",
        issue_key="TEST-101",
        payload={"summary": "Conflicting local edit"},
        base_updated_at="2026-10-04T10:00:00Z",
    )

    storage.update_outbox_status(
        outbox_id, "skipped_conflict", error_message="Remote updated_at is newer"
    )

    item = storage.get_outbox_item(outbox_id)
    assert item is not None
    assert item["status"] == "skipped_conflict"
    assert "Remote updated_at is newer" in (item["error_message"] or "")
    assert storage.get_pending_outbox() == []


def test_schema_migration_preserves_pending_outbox(temp_db_path: Path) -> None:
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    _ = storage.enqueue_outbox(
        client_mutation_id="mut-preserve",
        action_type="create_issue",
        issue_key="TEMP-12345",
        payload={"summary": "Preserve me during schema rebuild"},
        base_updated_at=None,
    )

    # Simulate destructive schema rebuild while preserving outbox
    storage.rebuild_schema_preserving_outbox()

    pending = storage.get_pending_outbox()
    assert len(pending) == 1
    assert pending[0]["client_mutation_id"] == "mut-preserve"
    assert pending[0]["payload"]["summary"] == "Preserve me during schema rebuild"


def test_replace_all_issues_replaces_old_and_preserves_creations(
    temp_db_path: Path,
) -> None:
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    # 1. Save old issues
    old_issue = JiraIssue(
        id="old-1",
        key="PROJ-OLD",
        summary="Old example issue",
        url="https://example.com/browse/PROJ-OLD",
        status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        updated_at="2026-10-07T12:00:00Z",
    )
    storage.save_issues([old_issue])
    assert len(storage.get_issues()) == 1

    # 2. Enqueue a pending local creation
    storage.enqueue_outbox(
        client_mutation_id="mut-local",
        action_type="create_issue",
        issue_key="LOCAL-999",
        payload={"summary": "Pending local issue"},
    )
    local_issue = JiraIssue(
        id="local-999",
        key="LOCAL-999",
        summary="Pending local issue",
        url="https://example.com/browse/LOCAL-999",
        status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        updated_at="2026-10-07T12:00:00Z",
    )
    storage.upsert_issue(local_issue)
    assert len(storage.get_issues()) == 2

    # 3. Replace all with new issues from Jira
    new_issue = JiraIssue(
        id="new-1",
        key="REAL-1",
        summary="Real Jira issue",
        url="https://jira.com/browse/REAL-1",
        status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        issue_type=IssueType.TASK,
        priority=Priority.HIGH,
        updated_at="2026-10-07T12:00:00Z",
    )
    storage.replace_all_issues([new_issue])

    keys = {i.key for i in storage.get_issues()}
    # PROJ-OLD must be evicted
    assert "PROJ-OLD" not in keys
    # REAL-1 must be present
    assert "REAL-1" in keys
    # LOCAL-999 must be preserved because it has pending create_issue outbox entry
    assert "LOCAL-999" in keys


def test_storage_rank_persistence_and_sorting(temp_db_path: Path) -> None:
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    issue_b = JiraIssue(
        id="2",
        key="PROJ-2",
        summary="Second",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        rank="0|i00002:",
        updated_at="2026-10-01T00:00:00Z",
    )
    issue_a = JiraIssue(
        id="1",
        key="PROJ-1",
        summary="First",
        issue_type=IssueType.TASK,
        priority=Priority.HIGH,
        status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        rank="0|i00001:",
        updated_at="2026-10-01T00:00:00Z",
    )
    storage.save_issues([issue_b, issue_a])
    issues = storage.get_issues()
    assert [i.key for i in issues] == ["PROJ-1", "PROJ-2"]
    assert issues[0].rank == "0|i00001:"
    assert issues[1].rank == "0|i00002:"


def test_storage_migration_adds_rank_column(temp_db_path: Path) -> None:
    import sqlite3

    conn = sqlite3.connect(str(temp_db_path))
    # Create legacy table without rank column
    conn.execute(
        """
        CREATE TABLE cached_issues (
            key TEXT PRIMARY KEY,
            id TEXT,
            summary TEXT NOT NULL,
            description TEXT,
            issue_type TEXT NOT NULL,
            priority TEXT NOT NULL,
            status_id TEXT NOT NULL,
            status_name TEXT NOT NULL,
            status_category TEXT NOT NULL,
            assignee_account_id TEXT,
            assignee_display_name TEXT,
            assignee_avatar_url TEXT,
            story_points REAL,
            due_date TEXT,
            start_date TEXT,
            recreate_after TEXT,
            url TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            raw_json TEXT
        );
        """
    )
    conn.close()

    storage = SQLiteStorage(temp_db_path)
    storage.init_db()  # Should auto-migrate and add rank column

    issue = JiraIssue(
        id="1",
        key="PROJ-1",
        summary="Migrated issue",
        issue_type=IssueType.TASK,
        priority=Priority.HIGH,
        status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        rank="0|i00001:",
        updated_at="2026-10-01T00:00:00Z",
    )
    storage.upsert_issue(issue)
    fetched = storage.get_issue("PROJ-1")
    assert fetched is not None
    assert fetched.rank == "0|i00001:"


def test_account_types_persist_across_connections(temp_db_path: Path) -> None:
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()
    assert storage.get_account_types() == {}
    assert storage.set_account_type(" Kid Kim ", "child") == {"kid kim": "child"}
    storage.close()

    reopened = SQLiteStorage(temp_db_path)
    reopened.init_db()
    assert reopened.get_account_types() == {"kid kim": "child"}
    assert reopened.set_account_type("KID KIM", "parent") == {}
    with pytest.raises(ValueError):
        reopened.set_account_type("x", "robot")
    with pytest.raises(ValueError):
        reopened.set_account_type("  ", "child")
    reopened.set_account_type("a", "child")
    reopened.clear_account_types()
    assert reopened.get_account_types() == {}
    reopened.close()


def test_oauth_codes_storage_lifecycle(temp_db_path: Path) -> None:
    """Verify storing, retrieving, single-use consumption, and expiration of OAuth codes."""
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    # 1. Save and consume valid code
    storage.save_oauth_code(
        code="test-code-123",
        email="jacek@example.com",
        client_id="gemini-client",
        redirect_uri="https://oauth-redirect.googleusercontent.com/r/test",
        ttl_seconds=300,
    )

    data = storage.consume_oauth_code("test-code-123")
    assert data is not None
    assert data["code"] == "test-code-123"
    assert data["email"] == "jacek@example.com"
    assert data["client_id"] == "gemini-client"
    assert data["redirect_uri"] == "https://oauth-redirect.googleusercontent.com/r/test"

    # Single-use: consuming again must return None
    assert storage.consume_oauth_code("test-code-123") is None

    # 2. Expired code must return None
    storage.save_oauth_code(
        code="expired-code",
        email="test@example.com",
        ttl_seconds=-10,  # Already expired
    )
    assert storage.consume_oauth_code("expired-code") is None

    # 3. Nonexistent code
    assert storage.consume_oauth_code("nonexistent") is None
    storage.close()


def test_storage_issue_links_roundtrip(temp_db_path: Path) -> None:
    """Verify that issues with issue_links are correctly stored and retrieved from SQLite."""
    storage = SQLiteStorage(temp_db_path)
    storage.init_db()

    linked = JiraLinkedIssue(
        id="202",
        key="TEST-202",
        summary="Target cloned issue",
        status=JiraStatus(id="3", name="Done", category=StatusCategory.DONE),
        priority=Priority.HIGH,
        issue_type=IssueType.BUG,
        url="https://jira.example.com/browse/TEST-202",
    )
    link = JiraIssueLink(
        id="link-99",
        relationship="is cloned by",
        direction="inward",
        issue=linked,
    )

    issue = JiraIssue(
        id="201",
        key="TEST-201",
        summary="Parent task with links",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        updated_at="2026-10-04T12:00:00Z",
        issue_links=[link],
    )

    storage.upsert_issue(issue)

    retrieved = storage.get_issue("TEST-201")
    assert retrieved is not None
    assert len(retrieved.issue_links) == 1
    assert retrieved.issue_links[0].relationship == "is cloned by"
    assert retrieved.issue_links[0].issue.key == "TEST-202"
    assert retrieved.issue_links[0].issue.status.name == "Done"

    all_issues = storage.get_issues()
    found = next((i for i in all_issues if i.key == "TEST-201"), None)
    assert found is not None
    assert len(found.issue_links) == 1
    assert found.issue_links[0].issue.key == "TEST-202"

    storage.close()
