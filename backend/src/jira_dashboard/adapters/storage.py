"""SQLite Persistence Storage and Transactional Outbox Adapter.

Provides crash-resilient local persistence for cached board metadata, issue snapshots,
and an outbox queue for background synchronization with Jira.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from jira_dashboard.domain import (
    BoardColumn,
    IssueType,
    JiraIssue,
    JiraStatus,
    JiraUser,
    Priority,
    StatusCategory,
)

CURRENT_SCHEMA_VERSION = 1


class SQLiteStorage:
    """Thread-safe SQLite storage adapter for Home Assistant Jira Dashboard."""

    def __init__(self, db_path: Path | str = ":memory:") -> None:
        self.db_path = str(db_path)
        if self.db_path != ":memory:":
            Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn: sqlite3.Connection | None = None

    def _get_connection(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            # Enable WAL mode for high concurrency if backed by disk
            if self.db_path != ":memory:":
                self._conn.execute("PRAGMA journal_mode = WAL;")
        return self._conn

    def init_db(self) -> None:
        """Create tables and apply migrations if necessary."""
        with self._lock:
            conn = self._get_connection()
            with conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS schema_meta (
                        key TEXT PRIMARY KEY,
                        value TEXT
                    );
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS cached_board_meta (
                        board_id TEXT PRIMARY KEY,
                        board_name TEXT NOT NULL,
                        sprint_name TEXT,
                        jira_url TEXT,
                        columns_json TEXT NOT NULL,
                        last_synced_at REAL NOT NULL
                    );
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS cached_issues (
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
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS sync_outbox (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        client_mutation_id TEXT UNIQUE NOT NULL,
                        action_type TEXT NOT NULL,
                        issue_key TEXT NOT NULL,
                        payload_json TEXT NOT NULL,
                        base_updated_at TEXT,
                        status TEXT NOT NULL DEFAULT 'pending',
                        retry_count INTEGER NOT NULL DEFAULT 0,
                        error_message TEXT,
                        created_at REAL NOT NULL,
                        updated_at REAL NOT NULL
                    );
                    """
                )
                conn.execute(f"PRAGMA user_version = {CURRENT_SCHEMA_VERSION};")

    def get_schema_version(self) -> int:
        """Retrieve current SQLite schema version."""
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute("PRAGMA user_version;")
            row = cur.fetchone()
            return int(row[0]) if row else 0

    def rebuild_schema_preserving_outbox(self) -> None:
        """Recreate issue cache tables while preserving pending outbox records."""
        with self._lock:
            conn = self._get_connection()
            # 1. Fetch pending outbox records
            cur = conn.execute(
                "SELECT client_mutation_id, action_type, issue_key, payload_json, "
                "base_updated_at, status, retry_count, error_message, created_at, updated_at "
                "FROM sync_outbox WHERE status = 'pending';"
            )
            pending_rows = cur.fetchall()

            # 2. Drop and recreate tables
            with conn:
                conn.execute("DROP TABLE IF EXISTS cached_board_meta;")
                conn.execute("DROP TABLE IF EXISTS cached_issues;")
                conn.execute("DROP TABLE IF EXISTS sync_outbox;")

        # 3. Re-init fresh schema
        self.init_db()

        # 4. Restore pending outbox records
        with self._lock:
            conn = self._get_connection()
            with conn:
                for r in pending_rows:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO sync_outbox (
                            client_mutation_id, action_type, issue_key, payload_json,
                            base_updated_at, status, retry_count, error_message,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                        """,
                        (
                            r["client_mutation_id"],
                            r["action_type"],
                            r["issue_key"],
                            r["payload_json"],
                            r["base_updated_at"],
                            r["status"],
                            r["retry_count"],
                            r["error_message"],
                            r["created_at"],
                            r["updated_at"],
                        ),
                    )

    def save_board_meta(
        self,
        board_id: str,
        board_name: str,
        sprint_name: str | None,
        jira_url: str | None,
        columns: list[BoardColumn],
    ) -> None:
        """Persist board metadata and workflow columns."""
        columns_json = json.dumps([c.model_dump() for c in columns])
        with self._lock:
            conn = self._get_connection()
            with conn:
                conn.execute(
                    """
                    INSERT INTO cached_board_meta (
                        board_id, board_name, sprint_name, jira_url, columns_json, last_synced_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(board_id) DO UPDATE SET
                        board_name = excluded.board_name,
                        sprint_name = excluded.sprint_name,
                        jira_url = excluded.jira_url,
                        columns_json = excluded.columns_json,
                        last_synced_at = excluded.last_synced_at;
                    """,
                    (board_id, board_name, sprint_name, jira_url, columns_json, time.time()),
                )

    def get_board_meta(self, board_id: str) -> dict[str, Any] | None:
        """Retrieve board metadata and workflow columns."""
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute(
                "SELECT board_id, board_name, sprint_name, jira_url, columns_json, last_synced_at "
                "FROM cached_board_meta WHERE board_id = ?;",
                (board_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            columns_data = json.loads(row["columns_json"])
            columns = [BoardColumn(**c) for c in columns_data]
            return {
                "board_id": row["board_id"],
                "board_name": row["board_name"],
                "sprint_name": row["sprint_name"],
                "jira_url": row["jira_url"],
                "columns": columns,
                "last_synced_at": row["last_synced_at"],
            }

    def _row_to_issue(self, row: sqlite3.Row) -> JiraIssue:
        assignee = None
        if row["assignee_account_id"] or row["assignee_display_name"]:
            assignee = JiraUser(
                account_id=row["assignee_account_id"] or "usr-1",
                display_name=row["assignee_display_name"] or "Unknown",
                avatar_url=row["assignee_avatar_url"],
            )

        return JiraIssue(
            id=row["id"] or row["key"],
            key=row["key"],
            summary=row["summary"],
            description=row["description"],
            url=row["url"],
            issue_type=IssueType(row["issue_type"]),
            priority=Priority(row["priority"]),
            status=JiraStatus(
                id=row["status_id"],
                name=row["status_name"],
                category=StatusCategory(row["status_category"]),
            ),
            assignee=assignee,
            story_points=row["story_points"],
            due_date=row["due_date"],
            start_date=row["start_date"],
            recreate_after=row["recreate_after"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def save_issues(self, issues: list[JiraIssue]) -> None:
        """Batch save or replace issues in cache."""
        with self._lock:
            conn = self._get_connection()
            with conn:
                for issue in issues:
                    self._upsert_issue_unlocked(conn, issue)

    def upsert_issue(self, issue: JiraIssue) -> None:
        """Upsert a single issue into the local cache."""
        with self._lock:
            conn = self._get_connection()
            with conn:
                self._upsert_issue_unlocked(conn, issue)

    def _upsert_issue_unlocked(self, conn: sqlite3.Connection, issue: JiraIssue) -> None:
        assignee_id = issue.assignee.account_id if issue.assignee else None
        assignee_name = issue.assignee.display_name if issue.assignee else None
        assignee_avatar = issue.assignee.avatar_url if issue.assignee else None

        conn.execute(
            """
            INSERT INTO cached_issues (
                key, id, summary, description, issue_type, priority,
                status_id, status_name, status_category,
                assignee_account_id, assignee_display_name, assignee_avatar_url,
                story_points, due_date, start_date, recreate_after, url,
                created_at, updated_at, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                id = excluded.id,
                summary = excluded.summary,
                description = excluded.description,
                issue_type = excluded.issue_type,
                priority = excluded.priority,
                status_id = excluded.status_id,
                status_name = excluded.status_name,
                status_category = excluded.status_category,
                assignee_account_id = excluded.assignee_account_id,
                assignee_display_name = excluded.assignee_display_name,
                assignee_avatar_url = excluded.assignee_avatar_url,
                story_points = excluded.story_points,
                due_date = excluded.due_date,
                start_date = excluded.start_date,
                recreate_after = excluded.recreate_after,
                url = excluded.url,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                raw_json = excluded.raw_json;
            """,
            (
                issue.key,
                issue.id,
                issue.summary,
                issue.description,
                issue.issue_type.value,
                issue.priority.value,
                issue.status.id,
                issue.status.name,
                issue.status.category.value,
                assignee_id,
                assignee_name,
                assignee_avatar,
                issue.story_points,
                issue.due_date,
                issue.start_date,
                issue.recreate_after,
                issue.url,
                issue.created_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                issue.updated_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                json.dumps(issue.model_dump()),
            ),
        )

    def get_issues(self) -> list[JiraIssue]:
        """Fetch all cached issues."""
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute("SELECT * FROM cached_issues ORDER BY updated_at DESC;")
            return [self._row_to_issue(r) for r in cur.fetchall()]

    def get_issue(self, key: str) -> JiraIssue | None:
        """Fetch single cached issue by key."""
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute("SELECT * FROM cached_issues WHERE key = ?;", (key,))
            row = cur.fetchone()
            if not row:
                return None
            return self._row_to_issue(row)

    def delete_issue(self, key: str) -> None:
        """Delete an issue from the cache (e.g. when replacing TEMP key)."""
        with self._lock:
            conn = self._get_connection()
            with conn:
                conn.execute("DELETE FROM cached_issues WHERE key = ?;", (key,))

    def enqueue_outbox(
        self,
        client_mutation_id: str,
        action_type: str,
        issue_key: str,
        payload: dict[str, Any],
        base_updated_at: str | None = None,
    ) -> int:
        """Enqueue an asynchronous mutation into the outbox."""
        now = time.time()
        payload_json = json.dumps(payload)
        with self._lock:
            conn = self._get_connection()
            with conn:
                cur = conn.execute(
                    """
                    INSERT INTO sync_outbox (
                        client_mutation_id, action_type, issue_key, payload_json,
                        base_updated_at, status, retry_count, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?);
                    """,
                    (
                        client_mutation_id,
                        action_type,
                        issue_key,
                        payload_json,
                        base_updated_at,
                        now,
                        now,
                    ),
                )
                return int(cur.lastrowid)

    def get_pending_outbox(self) -> list[dict[str, Any]]:
        """Retrieve all pending outbox entries ordered FIFO by id."""
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute(
                "SELECT * FROM sync_outbox WHERE status = 'pending' ORDER BY id ASC;"
            )
            rows = cur.fetchall()
            results = []
            for r in rows:
                results.append(
                    {
                        "id": r["id"],
                        "client_mutation_id": r["client_mutation_id"],
                        "action_type": r["action_type"],
                        "issue_key": r["issue_key"],
                        "payload": json.loads(r["payload_json"]),
                        "base_updated_at": r["base_updated_at"],
                        "status": r["status"],
                        "retry_count": r["retry_count"],
                        "error_message": r["error_message"],
                        "created_at": r["created_at"],
                        "updated_at": r["updated_at"],
                    }
                )
            return results

    def get_outbox_item(self, outbox_id: int) -> dict[str, Any] | None:
        """Retrieve a specific outbox item by id."""
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute("SELECT * FROM sync_outbox WHERE id = ?;", (outbox_id,))
            r = cur.fetchone()
            if not r:
                return None
            return {
                "id": r["id"],
                "client_mutation_id": r["client_mutation_id"],
                "action_type": r["action_type"],
                "issue_key": r["issue_key"],
                "payload": json.loads(r["payload_json"]),
                "base_updated_at": r["base_updated_at"],
                "status": r["status"],
                "retry_count": r["retry_count"],
                "error_message": r["error_message"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }

    def update_outbox_status(
        self,
        outbox_id: int,
        status: str,
        error_message: str | None = None,
        increment_retry: bool = False,
    ) -> None:
        """Update outbox item status and optional error message."""
        now = time.time()
        with self._lock:
            conn = self._get_connection()
            with conn:
                if increment_retry:
                    conn.execute(
                        """
                        UPDATE sync_outbox SET
                            status = ?,
                            error_message = ?,
                            retry_count = retry_count + 1,
                            updated_at = ?
                        WHERE id = ?;
                        """,
                        (status, error_message, now, outbox_id),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE sync_outbox SET
                            status = ?,
                            error_message = ?,
                            updated_at = ?
                        WHERE id = ?;
                        """,
                        (status, error_message, now, outbox_id),
                    )

    def close(self) -> None:
        """Close SQLite database connection."""
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None
