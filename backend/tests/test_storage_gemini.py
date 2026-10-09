"""Unit tests for SQLiteStorage background images, links, daily counts, and pruning."""

from __future__ import annotations

import time
from pathlib import Path

from jira_dashboard.adapters.storage import SQLiteStorage


def test_storage_background_image_crud_and_touch(tmp_path: Path) -> None:
    """Verify storing, retrieving, and touching background images."""
    db_file = tmp_path / "test.db"
    storage = SQLiteStorage(db_file)
    storage.init_db()

    hash_val = "abc123sha256hash"
    file_path = str(tmp_path / "cache" / f"{hash_val}.webp")

    # Initial get returns None
    assert storage.get_background_image(hash_val) is None

    # Save image
    storage.save_background_image(
        content_hash=hash_val,
        file_path=file_path,
        byte_size=1024,
        issue_key="PROJ-101",
    )

    record = storage.get_background_image(hash_val)
    assert record is not None
    assert record["content_hash"] == hash_val
    assert record["file_path"] == file_path
    assert record["byte_size"] == 1024
    assert "created_at" in record
    assert "last_requested_at" in record

    # Verify link was saved for issue
    assert storage.get_issue_last_background_hash("PROJ-101") == hash_val
    assert storage.get_issue_last_background_hash("PROJ-999") is None

    # Touch image and verify last_requested_at updates
    first_requested = record["last_requested_at"]
    time.sleep(0.01)
    storage.touch_background_image(hash_val)

    updated_record = storage.get_background_image(hash_val)
    assert updated_record is not None
    assert updated_record["last_requested_at"] > first_requested


def test_storage_daily_generation_count(tmp_path: Path) -> None:
    """Verify daily usage counter tracking and incrementing."""
    db_file = tmp_path / "test.db"
    storage = SQLiteStorage(db_file)
    storage.init_db()

    today = "2026-10-10"
    assert storage.get_daily_generation_count(today) == 0

    c1 = storage.increment_daily_generation_count(today)
    assert c1 == 1
    assert storage.get_daily_generation_count(today) == 1

    c2 = storage.increment_daily_generation_count(today)
    assert c2 == 2
    assert storage.get_daily_generation_count(today) == 2

    # Different date
    assert storage.get_daily_generation_count("2026-10-11") == 0


def test_storage_pruning_expired_images(tmp_path: Path) -> None:
    """Verify pruning background images older than retention window."""
    db_file = tmp_path / "test.db"
    storage = SQLiteStorage(db_file)
    storage.init_db()

    fresh_hash = "fresh123"
    expired_hash = "expired456"

    fresh_path = str(tmp_path / "fresh.webp")
    expired_path = str(tmp_path / "expired.webp")

    storage.save_background_image(fresh_hash, fresh_path, 2048, issue_key="PROJ-1")
    storage.save_background_image(expired_hash, expired_path, 4096, issue_key="PROJ-2")

    # Manually backdate the expired record to 35 days ago
    conn = storage._get_connection()
    old_timestamp = time.time() - (35 * 86400)
    with storage._lock, conn:
        conn.execute(
            "UPDATE background_images SET last_requested_at = ? WHERE content_hash = ?",
            (old_timestamp, expired_hash),
        )

    # Prune with 30 days retention (30 * 86400 = 2592000s)
    pruned_files = storage.prune_expired_background_images(retention_seconds=30 * 86400)
    assert expired_path in pruned_files
    assert fresh_path not in pruned_files

    # Fresh record remains, expired record deleted
    assert storage.get_background_image(fresh_hash) is not None
    assert storage.get_background_image(expired_hash) is None
    # Link for expired task is cleared
    assert storage.get_issue_last_background_hash("PROJ-2") is None
    assert storage.get_issue_last_background_hash("PROJ-1") == fresh_hash
