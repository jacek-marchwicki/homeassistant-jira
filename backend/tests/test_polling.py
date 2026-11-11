"""Unit tests for fallback polling loop."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

from jira_dashboard.domain import StatusCategory
from jira_dashboard.presentation import main
from jira_dashboard.presentation.main import fallback_polling_loop, poll_board_issues


def test_poll_board_issues_detects_delta_and_broadcasts(monkeypatch) -> None:
    """Verify poll_board_issues broadcasts delta updates when issue state changes."""

    async def _test() -> None:
        # Seed initial state in _cached_issue_state
        main._cached_issue_state.clear()
        main._cached_issue_state["PROJ-101"] = "todo:Configure Ingress:2026-10-04T00:00:00Z"

        # Mock broadcast_mutation_event
        mock_broadcast = AsyncMock()
        monkeypatch.setattr(main, "broadcast_mutation_event", mock_broadcast)

        # Transition PROJ-101 in fake client to Done
        await main.jira_client.transition_issue("PROJ-101", StatusCategory.DONE)

        # Execute direct poll
        await poll_board_issues("engineering-1")

        # Verify broadcast was called with updated issue
        assert mock_broadcast.called
        kwargs = mock_broadcast.call_args[1]
        args = mock_broadcast.call_args[0]
        event_type = kwargs.get("event_type") or (args[0] if len(args) > 0 else None)
        message = kwargs.get("message") or (args[1] if len(args) > 1 else None)
        assert event_type == "issue_transitioned"
        assert message["event"] == "issue_transitioned"
        assert message["issue_key"] == "PROJ-101"
        assert message["status_category"] == "done"

    asyncio.run(_test())


def test_fallback_polling_loop_lifecycle() -> None:
    """Verify fallback_polling_loop runs and halts cleanly on stop_event."""

    async def _test() -> None:
        stop_event = asyncio.Event()

        task = asyncio.create_task(
            fallback_polling_loop(poll_interval=10, board_id="engineering-1", stop_event=stop_event)
        )
        await asyncio.sleep(0.01)
        stop_event.set()
        await task
        assert stop_event.is_set()

    asyncio.run(_test())
