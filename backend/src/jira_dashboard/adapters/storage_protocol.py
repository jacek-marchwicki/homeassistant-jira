"""Protocol defining the storage abstraction for Jira Dashboard.

Both SQLiteStorage (for Home Assistant / local) and FirestoreStorage (for GCP)
must satisfy this runtime-checkable protocol with 100% behavioral parity.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from jira_dashboard.domain.models import BoardColumn, JiraIssue


@runtime_checkable
class StorageProtocol(Protocol):
    """Abstract interface for Jira Dashboard persistence."""

    def init_db(self) -> None:
        """Initialize database schema, tables, or collections."""
        ...

    def close(self) -> None:
        """Release underlying database connection or client resources."""
        ...

    def get_schema_version(self) -> int:
        """Return the current schema migration version."""
        ...

    # -------------------------------------------------------------------------
    # Board Metadata
    # -------------------------------------------------------------------------

    def save_board_meta(
        self,
        board_id: str,
        board_name: str,
        sprint_name: str | None,
        jira_url: str | None,
        columns: list[BoardColumn],
    ) -> None:
        """Persist board metadata and its configured columns."""
        ...

    def get_board_meta(self, board_id: str) -> dict[str, Any] | None:
        """Retrieve board metadata and its columns by board_id."""
        ...

    # -------------------------------------------------------------------------
    # Issue Operations
    # -------------------------------------------------------------------------

    def save_issues(self, issues: list[JiraIssue]) -> None:
        """Batch save or upsert Jira issues into storage."""
        ...

    def get_issues(self) -> list[JiraIssue]:
        """Query all cached issues."""
        ...

    def get_issue(self, key: str) -> JiraIssue | None:
        """Retrieve a single Jira issue by issue key."""
        ...

    def upsert_issue(self, issue: JiraIssue) -> None:
        """Insert or update a single Jira issue."""
        ...

    def delete_issue(self, key: str) -> None:
        """Delete an issue by issue key."""
        ...

    def replace_all_issues(self, issues: list[JiraIssue]) -> None:
        """Atomically replace all cached issues with a new set."""
        ...

    # -------------------------------------------------------------------------
    # Offline Outbox
    # -------------------------------------------------------------------------

    def enqueue_outbox(
        self,
        client_mutation_id: str,
        action_type: str,
        issue_key: str,
        payload: dict[str, Any],
        base_updated_at: str | None = None,
    ) -> int:
        """Enqueue an offline mutation transaction and return its integer ID."""
        ...

    def get_pending_outbox(self) -> list[dict[str, Any]]:
        """Retrieve pending outbox transactions in FIFO sequence."""
        ...

    def update_outbox_status(
        self,
        outbox_id: int,
        status: str,
        error_message: str | None = None,
        increment_retry: bool = False,
    ) -> None:
        """Update transaction status (e.g. 'sent', 'failed') and optionally increment retry_count."""
        ...

    def get_outbox_item(self, outbox_id: int) -> dict[str, Any] | None:
        """Retrieve an outbox transaction by integer outbox_id."""
        ...

    def clear_outbox(self) -> None:
        """Purge all outbox transactions."""
        ...

    # -------------------------------------------------------------------------
    # Daily Gemini Image Quotas
    # -------------------------------------------------------------------------

    def get_daily_generation_count(self, date_str: str) -> int:
        """Retrieve count of generated images for date_str ('YYYY-MM-DD')."""
        ...

    def increment_daily_generation_count(self, date_str: str) -> int:
        """Atomically increment the generation count for date_str and return new count."""
        ...

    # -------------------------------------------------------------------------
    # Background Image Metadata
    # -------------------------------------------------------------------------

    def save_background_image(
        self,
        content_hash: str,
        file_path: str,
        byte_size: int,
        issue_key: str | None = None,
    ) -> None:
        """Save background image asset metadata and link it to issue_key."""
        ...

    def get_background_image(self, content_hash: str) -> dict[str, Any] | None:
        """Retrieve background image record by content_hash."""
        ...

    def touch_background_image(self, content_hash: str) -> None:
        """Update last_accessed_at timestamp for content_hash."""
        ...

    def prune_expired_background_images(self, retention_seconds: int) -> list[str]:
        """Delete image metadata records unaccessed longer than retention_seconds."""
        ...

    def get_issue_last_background_hash(self, issue_key: str) -> str | None:
        """Retrieve the most recent background image content hash for an issue."""
        ...

    # -------------------------------------------------------------------------
    # OAuth 2.0 Authorization Server
    # -------------------------------------------------------------------------

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
        """Save short-lived OAuth authorization code with PKCE challenge."""
        ...

    def consume_oauth_code(self, code: str) -> dict[str, Any] | None:
        """Atomically consume and delete authorization code (single-use constraint)."""
        ...

    def save_refresh_token(
        self,
        token: str,
        email: str,
        client_id: str = "",
        ttl_seconds: int = 2592000,
    ) -> None:
        """Save issued OAuth refresh token."""
        ...

    def get_refresh_token(self, token: str) -> dict[str, Any] | None:
        """Retrieve refresh token record."""
        ...

    def revoke_refresh_token(self, token: str) -> None:
        """Mark refresh token as revoked."""
        ...

    # -------------------------------------------------------------------------
    # User Account Classifications
    # -------------------------------------------------------------------------

    def get_account_types(self) -> dict[str, str]:
        """Retrieve mapping of display_name to account_type ('child')."""
        ...

    def set_account_type(self, display_name: str, account_type: str) -> dict[str, str]:
        """Set account classification ('child' or 'parent')."""
        ...

    def clear_account_types(self) -> None:
        """Clear all account type classifications."""
        ...
