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

from jira_dashboard.config import ensure_local_data_dir
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
            target_path = Path(self.db_path)
            # If path targets relative data/ directory, ensure worktree symlink is established
            if not target_path.is_absolute() and (
                target_path.parts[:1] == ("data",) or target_path.parts[:2] == (".", "data")
            ):
                dev_data = ensure_local_data_dir()
                self.db_path = str((dev_data / target_path.name).resolve())
                Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
            else:
                try:
                    Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
                except OSError:
                    dev_data = ensure_local_data_dir()
                    self.db_path = str((dev_data / "jira_dashboard.sqlite3").resolve())
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
                        rank TEXT,
                        url TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        raw_json TEXT
                    );
                    """
                )
                # Check for and apply schema migrations
                cur = conn.execute("PRAGMA table_info(cached_issues);")
                existing_cols = {
                    row["name"] if isinstance(row, sqlite3.Row) else row[1]
                    for row in cur.fetchall()
                }
                if "rank" not in existing_cols:
                    conn.execute("ALTER TABLE cached_issues ADD COLUMN rank TEXT;")

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
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS background_images (
                        content_hash TEXT PRIMARY KEY,
                        file_path TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        last_requested_at REAL NOT NULL,
                        byte_size INTEGER NOT NULL
                    );
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS issue_background_links (
                        issue_key TEXT PRIMARY KEY,
                        last_content_hash TEXT NOT NULL,
                        updated_at REAL NOT NULL,
                        FOREIGN KEY(last_content_hash)
                            REFERENCES background_images(content_hash) ON DELETE CASCADE
                    );
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS gemini_daily_usage (
                        usage_date TEXT PRIMARY KEY,
                        generation_count INTEGER NOT NULL DEFAULT 0
                    );
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS account_types (
                        name_key TEXT PRIMARY KEY,
                        account_type TEXT NOT NULL CHECK (account_type IN ('child'))
                    );
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS oauth_codes (
                        code TEXT PRIMARY KEY,
                        email TEXT NOT NULL,
                        client_id TEXT,
                        redirect_uri TEXT,
                        code_challenge TEXT,
                        code_challenge_method TEXT,
                        expires_at REAL NOT NULL
                    );
                    """
                )
                cur_oauth = conn.execute("PRAGMA table_info(oauth_codes);")
                oauth_cols = {
                    row["name"] if isinstance(row, sqlite3.Row) else row[1]
                    for row in cur_oauth.fetchall()
                }
                if "code_challenge" not in oauth_cols:
                    conn.execute("ALTER TABLE oauth_codes ADD COLUMN code_challenge TEXT;")
                if "code_challenge_method" not in oauth_cols:
                    conn.execute("ALTER TABLE oauth_codes ADD COLUMN code_challenge_method TEXT;")

                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
                        token TEXT PRIMARY KEY,
                        email TEXT NOT NULL,
                        client_id TEXT,
                        created_at REAL NOT NULL,
                        expires_at REAL NOT NULL
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
                conn.execute("DROP TABLE IF EXISTS issue_background_links;")
                conn.execute("DROP TABLE IF EXISTS background_images;")
                conn.execute("DROP TABLE IF EXISTS gemini_daily_usage;")

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
            rank=row["rank"] if "rank" in row.keys() else None,
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

    def replace_all_issues(self, issues: list[JiraIssue]) -> None:
        """Atomically replace all cached issues with a fresh issue list."""
        with self._lock:
            conn = self._get_connection()
            with conn:
                pending_keys = {
                    row["issue_key"]
                    for row in conn.execute(
                        "SELECT issue_key FROM sync_outbox "
                        "WHERE status = 'pending' AND action_type = 'create_issue';"
                    ).fetchall()
                    if row["issue_key"]
                }
                if pending_keys:
                    placeholders = ",".join("?" for _ in pending_keys)
                    conn.execute(
                        f"DELETE FROM cached_issues WHERE key NOT IN ({placeholders});",
                        list(pending_keys),
                    )
                else:
                    conn.execute("DELETE FROM cached_issues;")
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
                story_points, due_date, start_date, recreate_after, rank, url,
                created_at, updated_at, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                rank = excluded.rank,
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
                issue.rank,
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
            cur = conn.execute(
                """
                SELECT * FROM cached_issues
                ORDER BY CASE WHEN rank IS NOT NULL AND rank != '' THEN 0 ELSE 1 END,
                         rank ASC,
                         updated_at DESC;
                """
            )
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

    def clear_outbox(self) -> None:
        """Clear all entries from sync_outbox (primarily for testing resets)."""
        with self._lock:
            conn = self._get_connection()
            with conn:
                conn.execute("DELETE FROM sync_outbox;")

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

    def get_background_image(self, content_hash: str) -> dict[str, Any] | None:
        """Retrieve background image metadata by content hash."""
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute(
                """
                SELECT content_hash, file_path, created_at, last_requested_at, byte_size
                FROM background_images
                WHERE content_hash = ?;
                """,
                (content_hash,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "content_hash": row["content_hash"],
                "file_path": row["file_path"],
                "created_at": row["created_at"],
                "last_requested_at": row["last_requested_at"],
                "byte_size": row["byte_size"],
            }

    def save_background_image(
        self,
        content_hash: str,
        file_path: str,
        byte_size: int,
        issue_key: str | None = None,
    ) -> None:
        """Store or update background image metadata, optionally linking to an issue key."""
        now = time.time()
        with self._lock:
            conn = self._get_connection()
            with conn:
                conn.execute(
                    """
                    INSERT INTO background_images (
                        content_hash, file_path, created_at, last_requested_at, byte_size
                    )
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(content_hash) DO UPDATE SET
                        file_path = excluded.file_path,
                        last_requested_at = excluded.last_requested_at,
                        byte_size = excluded.byte_size;
                    """,
                    (content_hash, file_path, now, now, byte_size),
                )
                if issue_key:
                    conn.execute(
                        """
                        INSERT INTO issue_background_links (
                            issue_key, last_content_hash, updated_at
                        )
                        VALUES (?, ?, ?)
                        ON CONFLICT(issue_key) DO UPDATE SET
                            last_content_hash = excluded.last_content_hash,
                            updated_at = excluded.updated_at;
                        """,
                        (issue_key, content_hash, now),
                    )

    def touch_background_image(self, content_hash: str) -> None:
        """Update last_requested_at timestamp for a background image."""
        now = time.time()
        with self._lock:
            conn = self._get_connection()
            with conn:
                conn.execute(
                    """
                    UPDATE background_images
                    SET last_requested_at = ?
                    WHERE content_hash = ?;
                    """,
                    (now, content_hash),
                )

    def get_issue_last_background_hash(self, issue_key: str) -> str | None:
        """Get the most recent background image content hash associated with an issue."""
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute(
                """
                SELECT last_content_hash
                FROM issue_background_links
                WHERE issue_key = ?;
                """,
                (issue_key,),
            )
            row = cur.fetchone()
            return row["last_content_hash"] if row else None

    def get_daily_generation_count(self, date_str: str) -> int:
        """Get the number of images generated for a given calendar date ('YYYY-MM-DD')."""
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute(
                """
                SELECT generation_count
                FROM gemini_daily_usage
                WHERE usage_date = ?;
                """,
                (date_str,),
            )
            row = cur.fetchone()
            return int(row["generation_count"]) if row else 0

    def increment_daily_generation_count(self, date_str: str) -> int:
        """Increment and return the generation count for a given calendar date."""
        with self._lock:
            conn = self._get_connection()
            with conn:
                conn.execute(
                    """
                    INSERT INTO gemini_daily_usage (usage_date, generation_count)
                    VALUES (?, 1)
                    ON CONFLICT(usage_date) DO UPDATE SET
                        generation_count = generation_count + 1;
                    """,
                    (date_str,),
                )
                cur = conn.execute(
                    "SELECT generation_count FROM gemini_daily_usage WHERE usage_date = ?;",
                    (date_str,),
                )
                row = cur.fetchone()
                return int(row["generation_count"]) if row else 1

    @staticmethod
    def _account_name_key(display_name: str) -> str:
        return display_name.strip().lower()

    def get_account_types(self) -> dict[str, str]:
        """Return shared account types keyed by lower-cased display name.

        Only non-default ('child') accounts are stored; everyone else is a parent.
        """
        with self._lock:
            conn = self._get_connection()
            cur = conn.execute("SELECT name_key, account_type FROM account_types;")
            return {row["name_key"]: row["account_type"] for row in cur.fetchall()}

    def set_account_type(self, display_name: str, account_type: str) -> dict[str, str]:
        """Set an account to 'child' or 'parent' (parent removes the stored row).

        Returns the full updated mapping.
        """
        if account_type not in ("child", "parent"):
            raise ValueError(f"Invalid account type: {account_type!r}")
        key = self._account_name_key(display_name)
        if not key:
            raise ValueError("display_name must not be empty")
        with self._lock:
            conn = self._get_connection()
            with conn:
                if account_type == "child":
                    conn.execute(
                        "INSERT OR REPLACE INTO account_types (name_key, account_type) "
                        "VALUES (?, 'child');",
                        (key,),
                    )
                else:
                    conn.execute("DELETE FROM account_types WHERE name_key = ?;", (key,))
        return self.get_account_types()

    def clear_account_types(self) -> None:
        """Remove all stored account types (used by test resets)."""
        with self._lock:
            conn = self._get_connection()
            with conn:
                conn.execute("DELETE FROM account_types;")

    def prune_expired_background_images(self, retention_seconds: int) -> list[str]:
        """Prune background images unrequested for longer than retention_seconds.

        Returns list of unlinked file paths to be removed from disk.
        """
        threshold = time.time() - retention_seconds
        with self._lock:
            conn = self._get_connection()
            with conn:
                cur = conn.execute(
                    """
                    SELECT content_hash, file_path
                    FROM background_images
                    WHERE last_requested_at < ?;
                    """,
                    (threshold,),
                )
                expired = cur.fetchall()
                if not expired:
                    return []

                expired_hashes = [row["content_hash"] for row in expired]
                file_paths = [row["file_path"] for row in expired]

                placeholders = ",".join("?" for _ in expired_hashes)
                conn.execute(
                    f"DELETE FROM issue_background_links "
                    f"WHERE last_content_hash IN ({placeholders});",
                    expired_hashes,
                )
                conn.execute(
                    f"DELETE FROM background_images WHERE content_hash IN ({placeholders});",
                    expired_hashes,
                )
                return file_paths

    def save_oauth_code(
        self,
        code: str,
        email: str,
        client_id: str = "",
        redirect_uri: str = "",
        code_challenge: str = "",
        code_challenge_method: str = "",
        ttl_seconds: int = 300,
    ) -> None:
        """Store an ephemeral OAuth 2.0 authorization code (with optional PKCE challenge)."""
        with self._lock:
            conn = self._get_connection()
            expires_at = time.time() + ttl_seconds
            with conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO oauth_codes (
                        code, email, client_id, redirect_uri,
                        code_challenge, code_challenge_method, expires_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        code,
                        email,
                        client_id,
                        redirect_uri,
                        code_challenge,
                        code_challenge_method,
                        expires_at,
                    ),
                )

    def consume_oauth_code(self, code: str) -> dict[str, Any] | None:
        """Consume and delete an OAuth 2.0 authorization code if valid and not expired."""
        with self._lock:
            conn = self._get_connection()
            now = time.time()
            with conn:
                # Purge expired codes
                conn.execute("DELETE FROM oauth_codes WHERE expires_at < ?;", (now,))
                cur = conn.execute(
                    """
                    SELECT code, email, client_id, redirect_uri,
                           code_challenge, code_challenge_method, expires_at
                    FROM oauth_codes
                    WHERE code = ? AND expires_at >= ?;
                    """,
                    (code, now),
                )
                row = cur.fetchone()
                if not row:
                    return None
                result = {
                    "code": str(row["code"]),
                    "email": str(row["email"]),
                    "client_id": str(row["client_id"] or ""),
                    "redirect_uri": str(row["redirect_uri"] or ""),
                    "code_challenge": str(row["code_challenge"] or ""),
                    "code_challenge_method": str(row["code_challenge_method"] or ""),
                    "expires_at": float(row["expires_at"]),
                }
                conn.execute("DELETE FROM oauth_codes WHERE code = ?;", (code,))
                return result

    def save_refresh_token(
        self,
        token: str,
        email: str,
        client_id: str = "",
        ttl_seconds: int = 86400 * 30,
    ) -> None:
        """Store an OAuth 2.0 refresh token."""
        with self._lock:
            conn = self._get_connection()
            now = time.time()
            expires_at = now + ttl_seconds
            with conn:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO oauth_refresh_tokens (
                        token, email, client_id, created_at, expires_at
                    ) VALUES (?, ?, ?, ?, ?);
                    """,
                    (token, email, client_id, now, expires_at),
                )

    def get_refresh_token(self, token: str) -> dict[str, Any] | None:
        """Retrieve an OAuth 2.0 refresh token if valid and not expired."""
        with self._lock:
            conn = self._get_connection()
            now = time.time()
            with conn:
                conn.execute("DELETE FROM oauth_refresh_tokens WHERE expires_at < ?;", (now,))
                cur = conn.execute(
                    """
                    SELECT token, email, client_id, created_at, expires_at
                    FROM oauth_refresh_tokens
                    WHERE token = ? AND expires_at >= ?;
                    """,
                    (token, now),
                )
                row = cur.fetchone()
                if not row:
                    return None
                return {
                    "token": str(row["token"]),
                    "email": str(row["email"]),
                    "client_id": str(row["client_id"] or ""),
                    "created_at": float(row["created_at"]),
                    "expires_at": float(row["expires_at"]),
                }

    def revoke_refresh_token(self, token: str) -> None:
        """Revoke and delete an OAuth 2.0 refresh token."""
        with self._lock:
            conn = self._get_connection()
            with conn:
                conn.execute("DELETE FROM oauth_refresh_tokens WHERE token = ?;", (token,))

    def close(self) -> None:
        """Close SQLite database connection."""
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None
