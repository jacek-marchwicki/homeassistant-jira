"""Tests for board outbox event streams and monotonic sequence control."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from jira_dashboard.adapters.storage import SQLiteStorage


@pytest.fixture
def storage() -> SQLiteStorage:
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_path = Path(tmp_dir) / "test.db"
        store = SQLiteStorage(db_path)
        store.init_db()
        yield store
        store.close()


def test_append_board_event_monotonic_sequence(storage: SQLiteStorage) -> None:
    board_id = "engineering-1"
    seq1 = storage.append_board_event(
        board_id=board_id,
        event_type="issue_created",
        payload={"key": "ENG-101", "summary": "First chore"},
    )
    seq2 = storage.append_board_event(
        board_id=board_id,
        event_type="issue_updated",
        payload={"key": "ENG-101", "summary": "Updated chore"},
    )
    seq3 = storage.append_board_event(
        board_id=board_id,
        event_type="issue_transitioned",
        payload={"key": "ENG-101", "status": "Done"},
    )

    assert seq1 == 1
    assert seq2 == 2
    assert seq3 == 3
    assert storage.get_latest_board_seq(board_id) == 3


def test_distinct_boards_isolated_sequences(storage: SQLiteStorage) -> None:
    seq_a1 = storage.append_board_event("board-a", "event", {"val": "a1"})
    seq_b1 = storage.append_board_event("board-b", "event", {"val": "b1"})
    seq_a2 = storage.append_board_event("board-a", "event", {"val": "a2"})

    assert seq_a1 == 1
    assert seq_b1 == 1
    assert seq_a2 == 2

    assert storage.get_latest_board_seq("board-a") == 2
    assert storage.get_latest_board_seq("board-b") == 1
    assert storage.get_latest_board_seq("non-existent") == 0


def test_get_board_events_since_ordering_and_filtering(storage: SQLiteStorage) -> None:
    board_id = "board-test"
    for i in range(1, 6):
        storage.append_board_event(
            board_id=board_id,
            event_type=f"event_{i}",
            payload={"index": i},
        )

    # Get events since seq 2
    events = storage.get_board_events_since(board_id=board_id, since_seq=2, limit=10)
    assert len(events) == 3
    assert [e["seq"] for e in events] == [3, 4, 5]
    assert [e["event_type"] for e in events] == ["event_3", "event_4", "event_5"]
    assert events[0]["payload"] == {"index": 3}
    assert "created_at" in events[0]

    # Limit check
    limited = storage.get_board_events_since(board_id=board_id, since_seq=0, limit=2)
    assert len(limited) == 2
    assert [e["seq"] for e in limited] == [1, 2]
