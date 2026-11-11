"""Shared webhook processor for incoming Jira webhooks across Home Assistant and GCP modes."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any, Protocol

from jira_dashboard.adapters.jira_client import FakeJiraClient, JiraClientProtocol
from jira_dashboard.adapters.storage_protocol import StorageProtocol
from jira_dashboard.domain import JiraIssue

logger = logging.getLogger(__name__)


class EventBroadcaster(Protocol):
    """Protocol for broadcasting real-time event dictionaries to connected clients."""

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Broadcast payload to all connected clients."""
        ...


class JiraWebhookProcessor:
    """Unified engine to process Jira webhooks, persist updates, and broadcast real-time deltas."""

    def __init__(
        self,
        jira_client: JiraClientProtocol,
        storage: StorageProtocol,
        broadcast_func: Callable[..., Any] | None = None,
        board_cache_updater: Callable[[JiraIssue | None, str | None], None] = lambda *_: None,
        ws_hub: Any = None,
    ) -> None:
        self.jira_client = jira_client
        self.storage = storage
        self.broadcast_func = broadcast_func
        self.ws_hub = ws_hub
        self.board_cache_updater = board_cache_updater

    async def _emit_event(self, event_type: str, message: dict[str, Any]) -> None:
        if self.broadcast_func:
            await self.broadcast_func(event_type=event_type, message=message)
        elif self.ws_hub:
            if hasattr(self.ws_hub, "broadcast"):
                await self.ws_hub.broadcast(message)
            elif callable(self.ws_hub):
                await self.ws_hub(event_type, message)

    async def process_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Parse incoming Jira Cloud webhook payload, update storage, and notify clients."""
        webhook_event = payload.get("webhookEvent")

        # 1. Handle issue deletion
        if webhook_event == "jira:issue_deleted":
            issue_data = payload.get("issue") or {}
            del_key = issue_data.get("key")
            if not del_key:
                return {"status": "ignored", "message": "Missing issue key for deleted event"}

            logger.info("Processing Jira issue deletion webhook for %s", del_key)
            self.storage.delete_issue(del_key)

            if isinstance(self.jira_client, FakeJiraClient):
                self.jira_client._issues.pop(del_key, None)

            self.board_cache_updater(None, del_key)

            await self._emit_event(
                "issue_deleted",
                {
                    "event": "issue_deleted",
                    "issue_key": del_key,
                },
            )
            return {"status": "deleted", "issue_key": del_key}

        # 2. Handle issue creation and update
        issue = await self.jira_client.process_webhook(payload)
        if not issue:
            return {"status": "ignored", "message": "No actionable issue delta found in payload"}

        logger.info(
            "Processing Jira issue webhook for %s (status: %s, event: %s)",
            issue.key,
            issue.status.name,
            webhook_event,
        )

        # Persist issue to storage
        self.storage.save_issues([issue])

        # Update in-memory presentation cache
        self.board_cache_updater(issue, None)

        # Broadcast real-time delta via WebSockets to all connected clients
        event_type = (
            "issue_created" if webhook_event == "jira:issue_created" else "issue_transitioned"
        )
        await self._emit_event(
            event_type,
            {
                "event": event_type,
                "issue_key": issue.key,
                "status_category": issue.status.category.value,
                "status_name": issue.status.name,
                "issue": issue.model_dump(),
            },
        )

        return {
            "status": "processed",
            "issue_key": issue.key,
            "status_category": issue.status.category.value,
        }
