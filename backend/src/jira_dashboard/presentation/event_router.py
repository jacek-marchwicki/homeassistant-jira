"""Asyncio in-memory event router for distributing board outbox events to active subscribers."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from jira_dashboard.adapters.event_bus import EventBusProtocol
    from jira_dashboard.adapters.storage_protocol import StorageProtocol

logger = logging.getLogger(__name__)


class AsyncioEventRouter:
    """Manages in-memory subscriber queues per board and coordinates outbox event fan-out."""

    def __init__(self, storage: StorageProtocol, event_bus: EventBusProtocol) -> None:
        self.storage = storage
        self.event_bus = event_bus
        self._subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._last_dispatched_seq: dict[str, int] = {}
        self._lock = asyncio.Lock()

    def subscribe(self, board_id: str) -> asyncio.Queue[dict[str, Any]]:
        """Register a new asyncio.Queue for a given board_id."""
        if board_id not in self._subscribers:
            self._subscribers[board_id] = set()
            self._last_dispatched_seq[board_id] = self.storage.get_latest_board_seq(board_id)

        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subscribers[board_id].add(queue)
        logger.debug(
            "Subscribed queue to board %s (total: %d)",
            board_id,
            len(self._subscribers[board_id]),
        )
        return queue

    def unsubscribe(self, board_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        """Remove a subscriber queue from a board."""
        if board_id in self._subscribers:
            self._subscribers[board_id].discard(queue)
            if not self._subscribers[board_id]:
                self._subscribers.pop(board_id, None)
        logger.debug("Unsubscribed queue from board %s", board_id)

    async def handle_wake_up(self, board_id: str, seq: int) -> None:
        """Process a WAKE_UP signal by querying missing events from storage and dispatching them."""
        async with self._lock:
            last_seq = self._last_dispatched_seq.get(board_id, 0)
            if seq <= last_seq:
                logger.debug(
                    "Ignoring WAKE_UP for board %s (seq %d <= last_dispatched %d)",
                    board_id,
                    seq,
                    last_seq,
                )
                return

            # Fetch all events between last_seq and current state
            events = self.storage.get_board_events_since(
                board_id=board_id, since_seq=last_seq, limit=1000
            )
            if not events:
                self._last_dispatched_seq[board_id] = max(last_seq, seq)
                return

            subscribers = list(self._subscribers.get(board_id, set()))
            for ev in events:
                ev_seq = ev["seq"]
                message = {
                    "board_id": board_id,
                    "seq": ev_seq,
                    "type": ev["event_type"],
                    "payload": ev["payload"],
                    "created_at": ev.get("created_at"),
                }
                for queue in subscribers:
                    try:
                        queue.put_nowait(message)
                    except asyncio.QueueFull:
                        logger.warning(
                            "Subscriber queue full for board %s, dropping event %d",
                            board_id,
                            ev_seq,
                        )

                if ev_seq > self._last_dispatched_seq.get(board_id, 0):
                    self._last_dispatched_seq[board_id] = ev_seq

    async def record_and_publish_event(
        self,
        board_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> int:
        """Atomically record an outbox event, broadcast WAKE_UP via EventBus, and dispatch."""
        new_seq = self.storage.append_board_event(
            board_id=board_id, event_type=event_type, payload=payload
        )
        await self.event_bus.publish_wake_up(board_id=board_id, seq=new_seq)
        await self.handle_wake_up(board_id=board_id, seq=new_seq)
        return new_seq
