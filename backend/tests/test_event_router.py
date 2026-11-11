"""Tests for AsyncioEventRouter in-memory distribution and outbox dispatching."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock

from jira_dashboard.adapters.storage import SQLiteStorage


def test_event_router_subscribe_and_dispatch() -> None:
    async def _test() -> None:
        from jira_dashboard.presentation.event_router import AsyncioEventRouter

        with tempfile.TemporaryDirectory() as tmp_dir:
            store = SQLiteStorage(Path(tmp_dir) / "test.db")
            store.init_db()
            mock_bus = AsyncMock()
            router = AsyncioEventRouter(storage=store, event_bus=mock_bus)

            # Subscribe to board "eng-1"
            queue = router.subscribe("eng-1")
            assert queue.empty()

            # Append event in storage
            seq = store.append_board_event(
                board_id="eng-1",
                event_type="issue_updated",
                payload={"key": "ENG-101", "summary": "Chore"},
            )
            assert seq == 1

            # Dispatch wake-up
            await router.handle_wake_up("eng-1", seq=1)

            assert not queue.empty()
            event = await queue.get()
            assert event["board_id"] == "eng-1"
            assert event["seq"] == 1
            assert event["type"] == "issue_updated"
            assert event["payload"] == {"key": "ENG-101", "summary": "Chore"}

            # Unsubscribe
            router.unsubscribe("eng-1", queue)
            store.close()

    asyncio.run(_test())


def test_event_router_ignores_duplicate_or_older_seq() -> None:
    async def _test() -> None:
        from jira_dashboard.presentation.event_router import AsyncioEventRouter

        with tempfile.TemporaryDirectory() as tmp_dir:
            store = SQLiteStorage(Path(tmp_dir) / "test.db")
            store.init_db()
            mock_bus = AsyncMock()
            router = AsyncioEventRouter(storage=store, event_bus=mock_bus)

            queue = router.subscribe("eng-1")

            store.append_board_event("eng-1", "ev1", {"num": 1})
            await router.handle_wake_up("eng-1", seq=1)
            assert queue.qsize() == 1
            await queue.get()

            # Call handle_wake_up with same seq=1 -> nothing new should be added
            await router.handle_wake_up("eng-1", seq=1)
            assert queue.empty()

            # Call handle_wake_up with older seq=0 -> nothing new
            await router.handle_wake_up("eng-1", seq=0)
            assert queue.empty()

            router.unsubscribe("eng-1", queue)
            store.close()

    asyncio.run(_test())


def test_record_and_publish_event() -> None:
    async def _test() -> None:
        from jira_dashboard.presentation.event_router import AsyncioEventRouter

        with tempfile.TemporaryDirectory() as tmp_dir:
            store = SQLiteStorage(Path(tmp_dir) / "test.db")
            store.init_db()
            mock_bus = AsyncMock()
            router = AsyncioEventRouter(storage=store, event_bus=mock_bus)

            queue = router.subscribe("eng-1")

            seq = await router.record_and_publish_event(
                board_id="eng-1",
                event_type="issue_created",
                payload={"key": "ENG-202"},
            )
            assert seq == 1

            # Verify mock_bus.publish_wake_up called
            mock_bus.publish_wake_up.assert_called_once_with(board_id="eng-1", seq=1)

            # Verify subscriber received the event
            assert not queue.empty()
            item = await queue.get()
            assert item["seq"] == 1
            assert item["type"] == "issue_created"

            router.unsubscribe("eng-1", queue)
            store.close()

    asyncio.run(_test())
