"""Cloud Firestore storage adapter for Jira Dashboard.

Implements StorageProtocol using Google Cloud Firestore Native Mode, providing
multi-instance concurrency and scale-to-zero persistence on GCP Cloud Run.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from jira_dashboard.domain.models import BoardColumn, JiraIssue

logger = logging.getLogger(__name__)


class FirestoreStorage:
    """Stores Jira Dashboard state in Google Cloud Firestore."""

    def __init__(
        self,
        project_id: str | None = None,
        database_id: str = "(default)",
        client: Any = None,
    ) -> None:
        self.project_id = project_id
        self.database_id = database_id
        self._client = client
        self._lock = threading.Lock()

    @property
    def client(self) -> Any:
        if self._client is None:
            from google.cloud import firestore

            self._client = firestore.Client(
                project=self.project_id,
                database=self.database_id,
            )
        return self._client

    def init_db(self) -> None:
        """Initialize Firestore connections (collections are lazily provisioned)."""
        pass

    def close(self) -> None:
        """Close Firestore client resources."""
        if self._client is not None and hasattr(self._client, "close"):
            try:
                self._client.close()
            except Exception as exc:
                logger.debug("Error closing Firestore client: %s", exc)

    def get_schema_version(self) -> int:
        """Schema version identifier (aligned with current SQLite schema)."""
        return 7

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
        doc_ref = self.client.collection("board_meta").document(board_id)
        doc_ref.set(
            {
                "board_id": board_id,
                "board_name": board_name,
                "sprint_name": sprint_name,
                "jira_url": jira_url,
                "columns": [c.model_dump() for c in columns],
                "updated_at": time.time(),
            }
        )

    def get_board_meta(self, board_id: str) -> dict[str, Any] | None:
        doc = self.client.collection("board_meta").document(board_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        raw_cols = data.get("columns", [])
        columns = [
            BoardColumn.model_validate(c) if isinstance(c, dict) else c
            for c in raw_cols
        ]
        return {
            "board_id": data.get("board_id", board_id),
            "board_name": data.get("board_name", ""),
            "sprint_name": data.get("sprint_name"),
            "jira_url": data.get("jira_url"),
            "columns": columns,
        }

    # -------------------------------------------------------------------------
    # Issues
    # -------------------------------------------------------------------------

    def save_issues(self, issues: list[JiraIssue]) -> None:
        col = self.client.collection("issues")
        for issue in issues:
            col.document(issue.key).set(issue.model_dump())

    def get_issues(self) -> list[JiraIssue]:
        col = self.client.collection("issues")
        issues: list[JiraIssue] = []
        for doc in col.stream():
            data = doc.to_dict()
            if data:
                issues.append(JiraIssue.model_validate(data))
        return issues

    def get_issue(self, key: str) -> JiraIssue | None:
        doc = self.client.collection("issues").document(key).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        return JiraIssue.model_validate(data) if data else None

    def upsert_issue(self, issue: JiraIssue) -> None:
        self.client.collection("issues").document(issue.key).set(issue.model_dump())

    def delete_issue(self, key: str) -> None:
        self.client.collection("issues").document(key).delete()

    def replace_all_issues(self, issues: list[JiraIssue]) -> None:
        with self._lock:
            col = self.client.collection("issues")
            for doc in col.stream():
                col.document(doc.id).delete()
            for issue in issues:
                col.document(issue.key).set(issue.model_dump())

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
        with self._lock:
            meta_ref = self.client.collection("outbox_meta").document("counter")
            meta_doc = meta_ref.get()
            last_id = (meta_doc.to_dict() or {}).get("last_id", 0) if meta_doc.exists else 0
            new_id = last_id + 1
            meta_ref.set({"last_id": new_id})

            item = {
                "id": new_id,
                "client_mutation_id": client_mutation_id,
                "action_type": action_type,
                "issue_key": issue_key,
                "payload": payload,
                "base_updated_at": base_updated_at,
                "status": "pending",
                "error_message": None,
                "retry_count": 0,
                "created_at": time.time(),
            }
            self.client.collection("outbox").document(str(new_id)).set(item)
            return new_id

    def get_pending_outbox(self) -> list[dict[str, Any]]:
        col = self.client.collection("outbox")
        pending: list[dict[str, Any]] = []
        for doc in col.where("status", "==", "pending").order_by("id").stream():
            data = doc.to_dict()
            if data:
                data["id"] = int(data.get("id", doc.id))
                pending.append(data)
        return pending

    def update_outbox_status(
        self,
        outbox_id: int,
        status: str,
        error_message: str | None = None,
        increment_retry: bool = False,
    ) -> None:
        doc_ref = self.client.collection("outbox").document(str(outbox_id))
        doc = doc_ref.get()
        if not doc.exists:
            return
        data = doc.to_dict() or {}
        updates: dict[str, Any] = {
            "status": status,
            "error_message": error_message,
        }
        if increment_retry:
            updates["retry_count"] = (data.get("retry_count") or 0) + 1
        doc_ref.set(updates, merge=True)

    def get_outbox_item(self, outbox_id: int) -> dict[str, Any] | None:
        doc = self.client.collection("outbox").document(str(outbox_id)).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        if data:
            data["id"] = int(data.get("id", outbox_id))
        return data

    def clear_outbox(self) -> None:
        with self._lock:
            col = self.client.collection("outbox")
            for doc in col.stream():
                col.document(doc.id).delete()

    # -------------------------------------------------------------------------
    # Daily Gemini Image Quotas
    # -------------------------------------------------------------------------

    def get_daily_generation_count(self, date_str: str) -> int:
        doc = self.client.collection("daily_usage").document(date_str).get()
        if not doc.exists:
            return 0
        return int((doc.to_dict() or {}).get("count", 0))

    def increment_daily_generation_count(self, date_str: str) -> int:
        with self._lock:
            doc_ref = self.client.collection("daily_usage").document(date_str)
            doc = doc_ref.get()
            current = int((doc.to_dict() or {}).get("count", 0)) if doc.exists else 0
            new_count = current + 1
            doc_ref.set({"count": new_count})
            return new_count

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
        now = time.time()
        record = {
            "content_hash": content_hash,
            "file_path": file_path,
            "byte_size": byte_size,
            "issue_key": issue_key,
            "created_at": now,
            "last_accessed_at": now,
        }
        self.client.collection("background_images").document(content_hash).set(record)

    def get_background_image(self, content_hash: str) -> dict[str, Any] | None:
        doc = self.client.collection("background_images").document(content_hash).get()
        return doc.to_dict() if doc.exists else None

    def touch_background_image(self, content_hash: str) -> None:
        doc_ref = self.client.collection("background_images").document(content_hash)
        if doc_ref.get().exists:
            doc_ref.set({"last_accessed_at": time.time()}, merge=True)

    def prune_expired_background_images(self, retention_seconds: int) -> list[str]:
        threshold = time.time() - retention_seconds
        col = self.client.collection("background_images")
        deleted_paths: list[str] = []
        for doc in col.stream():
            data = doc.to_dict() or {}
            last_accessed = data.get("last_accessed_at", 0)
            if last_accessed < threshold:
                file_path = data.get("file_path")
                if file_path:
                    deleted_paths.append(str(file_path))
                col.document(doc.id).delete()
        return deleted_paths

    def get_issue_last_background_hash(self, issue_key: str) -> str | None:
        col = self.client.collection("background_images")
        records: list[dict[str, Any]] = []
        for doc in col.where("issue_key", "==", issue_key).stream():
            data = doc.to_dict()
            if data:
                records.append(data)
        if not records:
            return None
        records.sort(key=lambda r: r.get("created_at", 0), reverse=True)
        return str(records[0]["content_hash"])

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
        doc_ref = self.client.collection("oauth_codes").document(code)
        doc_ref.set(
            {
                "code": code,
                "email": email,
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "code_challenge": code_challenge,
                "code_challenge_method": code_challenge_method,
                "expires_at": time.time() + ttl_seconds,
            }
        )

    def consume_oauth_code(self, code: str) -> dict[str, Any] | None:
        with self._lock:
            doc_ref = self.client.collection("oauth_codes").document(code)
            doc = doc_ref.get()
            if not doc.exists:
                return None
            data = doc.to_dict() or {}
            now = time.time()
            if float(data.get("expires_at", 0)) < now:
                doc_ref.delete()
                return None
            doc_ref.delete()
            return data

    def save_refresh_token(
        self,
        token: str,
        email: str,
        client_id: str = "",
        ttl_seconds: int = 2592000,
    ) -> None:
        now = time.time()
        self.client.collection("oauth_refresh_tokens").document(token).set(
            {
                "token": token,
                "email": email,
                "client_id": client_id,
                "created_at": now,
                "expires_at": now + ttl_seconds,
            }
        )

    def get_refresh_token(self, token: str) -> dict[str, Any] | None:
        doc_ref = self.client.collection("oauth_refresh_tokens").document(token)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        now = time.time()
        if float(data.get("expires_at", 0)) < now:
            doc_ref.delete()
            return None
        return data

    def revoke_refresh_token(self, token: str) -> None:
        self.client.collection("oauth_refresh_tokens").document(token).delete()

    # -------------------------------------------------------------------------
    # User Account Classifications
    # -------------------------------------------------------------------------

    def _account_key(self, display_name: str) -> str:
        return display_name.strip().lower()

    def get_account_types(self) -> dict[str, str]:
        col = self.client.collection("account_types")
        res: dict[str, str] = {}
        for doc in col.stream():
            data = doc.to_dict() or {}
            acc_type = data.get("account_type")
            if acc_type:
                res[doc.id] = str(acc_type)
        return res

    def set_account_type(self, display_name: str, account_type: str) -> dict[str, str]:
        if account_type not in ("child", "parent"):
            raise ValueError(f"Invalid account type: {account_type!r}")
        key = self._account_key(display_name)
        col = self.client.collection("account_types")
        if account_type == "parent":
            col.document(key).delete()
        else:
            col.document(key).set({"account_type": "child"})
        return self.get_account_types()

    def clear_account_types(self) -> None:
        col = self.client.collection("account_types")
        for doc in col.stream():
            col.document(doc.id).delete()
