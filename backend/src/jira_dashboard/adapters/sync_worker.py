"""Asynchronous Jira Outbox Synchronization Worker.

Continuously processes pending mutations from the local SQLite outbox queue,
pushes them to Jira in FIFO order, handles connectivity outages gracefully,
and resolves remote-first conflicts when remote timestamps are newer.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from jira_dashboard.adapters.jira_client import JiraAPIError, JiraClientProtocol
from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.domain import (
    IssueType,
    Priority,
    StatusCategory,
)

logger = logging.getLogger(__name__)


class JiraSyncWorker:
    """Background worker draining SQLite sync_outbox against Jira API."""

    def __init__(
        self,
        storage: SQLiteStorage,
        jira_client: JiraClientProtocol,
        ws_broadcast_func: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> None:
        self.storage = storage
        self.jira_client = jira_client
        self.ws_broadcast = ws_broadcast_func

    async def _broadcast(self, message: dict[str, Any]) -> None:
        if self.ws_broadcast:
            try:
                await self.ws_broadcast(message)
            except Exception as exc:
                logger.warning("Failed to broadcast WebSocket event from sync worker: %s", exc)

    async def drain_once(self) -> int:
        """Process all currently pending outbox items until empty or error.

        Returns the total number of items processed.
        """
        count = 0
        while await self.process_next_pending():
            count += 1
        return count

    async def process_next_pending(self) -> bool:
        """Process the oldest pending item from the outbox.

        Returns True if an item was processed (either completed or skipped_conflict),
        or False if queue was empty or execution failed (e.g. offline/error).
        """
        pending = self.storage.get_pending_outbox()
        if not pending:
            return False

        item = pending[0]
        outbox_id = item["id"]
        action_type = item["action_type"]
        issue_key = item["issue_key"]
        payload = item["payload"]
        base_updated_at = item.get("base_updated_at")

        self.storage.update_outbox_status(outbox_id, "in_progress")

        try:
            if action_type == "create_issue":
                await self._process_create(outbox_id, issue_key, payload)
                return True

            if action_type == "transition_issue":
                await self._process_transition(outbox_id, issue_key, payload, base_updated_at)
                return True

            if action_type == "update_issue":
                await self._process_update(outbox_id, issue_key, payload, base_updated_at)
                return True

            if action_type == "rank_issue":
                await self._process_rank(outbox_id, issue_key, payload, base_updated_at)
                return True

            # Unknown action type - mark failed
            self.storage.update_outbox_status(
                outbox_id, "failed", error_message=f"Unknown action type: {action_type}"
            )
            return True

        except (JiraAPIError, Exception) as exc:
            logger.warning(
                "Error syncing outbox item %d (%s on %s): %s",
                outbox_id,
                action_type,
                issue_key,
                exc,
            )
            is_unrecoverable = False
            if isinstance(exc, JiraAPIError):
                if exc.status_code in (401, 403) and "scope does not match" in str(exc).lower():
                    is_unrecoverable = True

            if is_unrecoverable:
                self.storage.update_outbox_status(
                    outbox_id,
                    "failed",
                    error_message=f"Missing Jira OAuth scope ('write:issue:jira-software'): {exc}",
                )
            else:
                self.storage.update_outbox_status(
                    outbox_id,
                    "pending",
                    error_message=str(exc),
                    increment_retry=True,
                )
            return False

    async def _process_create(self, outbox_id: int, temp_key: str, payload: dict[str, Any]) -> None:
        issue_type = IssueType(payload["issue_type"]) if "issue_type" in payload else IssueType.TASK
        priority = Priority(payload["priority"]) if "priority" in payload else Priority.MEDIUM
        status_category = (
            StatusCategory(payload["status_category"])
            if "status_category" in payload
            else StatusCategory.TODO
        )

        real_issue = await self.jira_client.create_issue(
            summary=payload.get("summary", "New Issue"),
            description=payload.get("description"),
            issue_type=issue_type,
            priority=priority,
            status_category=status_category,
            status_name=payload.get("status_name"),
            assignee_name=payload.get("assignee_name"),
            assignee_account_id=payload.get("assignee_account_id"),
            story_points=payload.get("story_points"),
            due_date=payload.get("due_date"),
            start_date=payload.get("start_date"),
            recreate_after=payload.get("recreate_after"),
            board_id=payload.get("board_id"),
            project_key=payload.get("project_key"),
        )

        # Remove temporary issue from SQLite if key changed
        if temp_key.startswith("TEMP-") and temp_key != real_issue.key:
            self.storage.delete_issue(temp_key)

        self.storage.upsert_issue(real_issue)
        self.storage.update_outbox_status(outbox_id, "completed")

        await self._broadcast(
            {
                "event": "issue_created",
                "issue_key": real_issue.key,
                "temp_key": temp_key,
                "status_category": real_issue.status.category.value,
                "status_name": real_issue.status.name,
                "issue": real_issue.model_dump(),
            }
        )

    async def _process_transition(
        self,
        outbox_id: int,
        issue_key: str,
        payload: dict[str, Any],
        base_updated_at: str | None,
    ) -> None:
        remote = await self.jira_client.get_issue(issue_key)
        if remote is None:
            self.storage.update_outbox_status(
                outbox_id, "failed", error_message=f"Issue {issue_key} not found on Jira"
            )
            return

        # Conflict check: remote updated_at is newer than base_updated_at
        if base_updated_at and remote.updated_at and remote.updated_at > base_updated_at:
            logger.info(
                "Conflict detected on %s: remote (%s) > base (%s). Remote wins.",
                issue_key,
                remote.updated_at,
                base_updated_at,
            )
            self.storage.update_outbox_status(
                outbox_id,
                "skipped_conflict",
                error_message=f"Conflict: remote updated_at ({remote.updated_at}) is newer",
            )
            self.storage.upsert_issue(remote)
            await self._broadcast(
                {
                    "event": "issue_updated",
                    "issue_key": remote.key,
                    "status_category": remote.status.category.value,
                    "status_name": remote.status.name,
                    "issue": remote.model_dump(),
                }
            )
            return

        target_category = (
            StatusCategory(payload["target_category"]) if payload.get("target_category") else None
        )
        target_status = payload.get("target_status")

        updated = await self.jira_client.transition_issue(
            issue_key,
            target_category=target_category,
            target_status=target_status,
        )

        self.storage.upsert_issue(updated)
        self.storage.update_outbox_status(outbox_id, "completed")

        await self._broadcast(
            {
                "event": "issue_transitioned",
                "issue_key": updated.key,
                "status_category": updated.status.category.value,
                "status_name": updated.status.name,
                "issue": updated.model_dump(),
            }
        )

    async def _process_update(
        self,
        outbox_id: int,
        issue_key: str,
        payload: dict[str, Any],
        base_updated_at: str | None,
    ) -> None:
        remote = await self.jira_client.get_issue(issue_key)
        if remote is None:
            self.storage.update_outbox_status(
                outbox_id, "failed", error_message=f"Issue {issue_key} not found on Jira"
            )
            return

        # Conflict check: remote updated_at is newer than base_updated_at
        if base_updated_at and remote.updated_at and remote.updated_at > base_updated_at:
            logger.info(
                "Conflict detected on %s: remote (%s) > base (%s). Remote wins.",
                issue_key,
                remote.updated_at,
                base_updated_at,
            )
            self.storage.update_outbox_status(
                outbox_id,
                "skipped_conflict",
                error_message=f"Conflict: remote updated_at ({remote.updated_at}) is newer",
            )
            self.storage.upsert_issue(remote)
            await self._broadcast(
                {
                    "event": "issue_updated",
                    "issue_key": remote.key,
                    "status_category": remote.status.category.value,
                    "status_name": remote.status.name,
                    "issue": remote.model_dump(),
                }
            )
            return

        issue_type = IssueType(payload["issue_type"]) if "issue_type" in payload else None
        priority = Priority(payload["priority"]) if "priority" in payload else None
        status_category = (
            StatusCategory(payload["status_category"]) if "status_category" in payload else None
        )

        # Call Jira with ONLY specified dirty fields
        updated = await self.jira_client.update_issue(
            issue_key,
            summary=payload.get("summary"),
            description=payload.get("description"),
            issue_type=issue_type,
            priority=priority,
            status_category=status_category,
            status_name=payload.get("status_name"),
            assignee_name=payload.get("assignee_name"),
            assignee_account_id=payload.get("assignee_account_id"),
            story_points=payload.get("story_points"),
            due_date=payload.get("due_date"),
            start_date=payload.get("start_date"),
            recreate_after=payload.get("recreate_after"),
        )

        self.storage.upsert_issue(updated)
        self.storage.update_outbox_status(outbox_id, "completed")

        await self._broadcast(
            {
                "event": "issue_updated",
                "issue_key": updated.key,
                "status_category": updated.status.category.value,
                "status_name": updated.status.name,
                "issue": updated.model_dump(),
            }
        )

    async def _process_rank(
        self,
        outbox_id: int,
        issue_key: str,
        payload: dict[str, Any],
        base_updated_at: str | None = None,
    ) -> None:
        ranked = await self.jira_client.rank_issue(
            issue_key=issue_key,
            rank_before_key=payload.get("rank_before_key"),
            rank_after_key=payload.get("rank_after_key"),
            target_rank=payload.get("rank") or payload.get("target_rank"),
        )
        self.storage.upsert_issue(ranked)
        self.storage.update_outbox_status(outbox_id, "completed")

        await self._broadcast(
            {
                "event": "issue_ranked",
                "issue_key": ranked.key,
                "rank": ranked.rank,
                "issue": ranked.model_dump(),
            }
        )

    async def run_sync_loop(self, stop_event: asyncio.Event) -> None:
        """Continuously drain the outbox queue in the background."""
        logger.info("Starting JiraSyncWorker background loop...")
        backoff = 1.0
        while not stop_event.is_set():
            try:
                processed = await self.process_next_pending()
                if processed:
                    backoff = 1.0
                    # Yield control briefly to allow event loop cooperative scheduling
                    await asyncio.sleep(0.02)
                else:
                    # No pending items or last item failed
                    await asyncio.wait_for(stop_event.wait(), timeout=backoff)
                    backoff = min(backoff * 1.5, 30.0)
            except asyncio.TimeoutError:
                pass
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Unexpected error in JiraSyncWorker loop: %s", exc)
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=backoff)
                except (asyncio.TimeoutError, asyncio.CancelledError):
                    break
