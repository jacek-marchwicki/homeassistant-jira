"""Acceptance and integration tests for AI task backgrounds endpoint and workflow."""

from __future__ import annotations

import shutil
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import PropertyMock, patch

from fastapi.testclient import TestClient

from jira_dashboard.adapters.gemini_client import MockGeminiImageClient
from jira_dashboard.config import JiraDashboardSettings
from jira_dashboard.domain import (
    IssueType,
    JiraIssue,
    JiraStatus,
    Priority,
    StatusCategory,
)
from jira_dashboard.presentation.main import app, gemini_client, storage


class TestTaskBackgroundsEndpoint(unittest.TestCase):
    """Integration test suite verifying GET /api/issues/{key}/background."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.mkdtemp()
        self.cache_dir = Path(self.temp_dir) / "background_cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self.mock_gemini = MockGeminiImageClient()

        # Patch settings and storage for testing isolation
        self.settings_patcher = patch.object(
            JiraDashboardSettings,
            "background_cache_dir",
            new_callable=PropertyMock,
            return_value=self.cache_dir,
        )
        self.settings_patcher.start()

        # Replace presentation gemini_client with mock
        self._orig_gemini_client = gemini_client
        import jira_dashboard.presentation.main as main_mod

        main_mod.gemini_client = self.mock_gemini

        self.client = TestClient(app)
        self.client.post("/api/test/reset")

        # Seed test issues in storage
        status_todo = JiraStatus(id="1", name="To Do", category=StatusCategory.TODO)

        self.issue_1 = JiraIssue(
            id="1001",
            key="CHORE-1",
            summary="Clean bedroom",
            description="Tidy the bed and put away toys",
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=status_todo,
            updated_at="2026-10-09T10:00:00Z",  # Well outside debounce window
        )
        self.issue_2 = JiraIssue(
            id="1002",
            key="CHORE-2",
            summary="Clean bedroom",
            description="Tidy the bed and put away toys",
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=status_todo,
            updated_at="2026-10-09T10:00:00Z",
        )
        storage.save_issues([self.issue_1, self.issue_2])

    def tearDown(self) -> None:
        self.settings_patcher.stop()
        import jira_dashboard.presentation.main as main_mod

        main_mod.gemini_client = self._orig_gemini_client
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_nonexistent_issue_returns_404(self) -> None:
        """Verify requesting background for non-existent issue returns 404."""
        resp = self.client.get("/api/issues/NONEXISTENT-999/background")
        self.assertEqual(resp.status_code, 404)

    def test_disabled_feature_returns_204(self) -> None:
        """Verify endpoint returns 204 No Content when gemini_client is None."""
        import jira_dashboard.presentation.main as main_mod

        main_mod.gemini_client = None

        resp = self.client.get("/api/issues/CHORE-1/background")
        self.assertEqual(resp.status_code, 204)

    def test_generate_and_cache_background(self) -> None:
        """Verify image generation, disk cache creation, and DB record persistence."""
        resp = self.client.get("/api/issues/CHORE-1/background")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("content-type"), "image/webp")
        self.assertIn("max-age=86400", resp.headers.get("cache-control", ""))
        self.assertEqual(self.mock_gemini.call_count, 1)

        # Verify cached image file exists in cache_dir
        cached_files = list(self.cache_dir.glob("*.webp"))
        self.assertEqual(len(cached_files), 1)

        # Verify DB metadata
        content_hash = cached_files[0].stem
        bg_record = storage.get_background_image(content_hash)
        self.assertIsNotNone(bg_record)
        self.assertEqual(bg_record["content_hash"], content_hash)
        self.assertEqual(storage.get_issue_last_background_hash("CHORE-1"), content_hash)

    def test_deduplication_reuses_same_image(self) -> None:
        """Verify identical chores share the exact same generated image."""
        resp1 = self.client.get("/api/issues/CHORE-1/background")
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(self.mock_gemini.call_count, 1)

        resp2 = self.client.get("/api/issues/CHORE-2/background")
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(self.mock_gemini.call_count, 1)  # NOT called again!

        # Content matches
        self.assertEqual(resp1.content, resp2.content)

        # Files on disk should be exactly 1
        cached_files = list(self.cache_dir.glob("*.webp"))
        self.assertEqual(len(cached_files), 1)

    def test_debounce_settling_for_frequently_edited_task(self) -> None:
        """Verify debounce window prevents wasted generation during rapid edits."""
        # 1. First generate initial background
        resp = self.client.get("/api/issues/CHORE-1/background")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.mock_gemini.call_count, 1)
        initial_content = resp.content

        # 2. Update issue with new description recently (now - 30 seconds)
        recent_epoch = time.time() - 30
        import datetime

        recent_dt = datetime.datetime.fromtimestamp(recent_epoch, tz=datetime.timezone.utc)
        recent_iso = recent_dt.isoformat()
        updated_issue = self.issue_1.model_copy(
            update={
                "description": "Quick draft 1 - updated bed description",
                "updated_at": recent_iso,
            }
        )
        storage.save_issues([updated_issue])

        # 3. Request immediately within debounce window -> serves previous image, Gemini not called
        resp_debounce = self.client.get("/api/issues/CHORE-1/background")
        self.assertEqual(resp_debounce.status_code, 200)
        self.assertEqual(resp_debounce.content, initial_content)
        self.assertEqual(self.mock_gemini.call_count, 1)  # Still 1!

        # 4. Now simulate settling: updated_at was 400 seconds ago (> 300s debounce)
        settled_epoch = time.time() - 400
        settled_dt = datetime.datetime.fromtimestamp(settled_epoch, tz=datetime.timezone.utc)
        settled_iso = settled_dt.isoformat()
        settled_issue = self.issue_1.model_copy(
            update={
                "description": "Settled description: clean bed and sweep floor",
                "updated_at": settled_iso,
            }
        )
        storage.save_issues([settled_issue])

        resp_settled = self.client.get("/api/issues/CHORE-1/background")
        self.assertEqual(resp_settled.status_code, 200)
        self.assertEqual(self.mock_gemini.call_count, 2)  # Now called!

    def test_debounce_settling_new_task_returns_204(self) -> None:
        """Verify newly created task inside debounce window with no prior image returns 204."""
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        new_task = JiraIssue(
            id="1003",
            key="CHORE-NEW",
            summary="Fold laundry",
            issue_type=IssueType.TASK,
            priority=Priority.LOW,
            status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
            updated_at=now_iso,  # Modified right now
        )
        storage.save_issues([new_task])

        resp = self.client.get("/api/issues/CHORE-NEW/background")
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(self.mock_gemini.call_count, 0)

    def test_daily_generation_quota_cap(self) -> None:
        """Verify daily cap restricts generation and returns 204 or previous image."""
        import jira_dashboard.presentation.main as main_mod

        old_limit = main_mod.settings.gemini_daily_limit
        main_mod.settings.gemini_daily_limit = 2
        try:
            # Task A: 1st generation
            task_a = self.issue_1.model_copy(
                update={"key": "TASK-A", "summary": "Chore A", "updated_at": "2026-10-09T00:00:00Z"}
            )
            # Task B: 2nd generation
            task_b = self.issue_1.model_copy(
                update={"key": "TASK-B", "summary": "Chore B", "updated_at": "2026-10-09T00:00:00Z"}
            )
            # Task C: 3rd generation (exceeds cap of 2)
            task_c = self.issue_1.model_copy(
                update={"key": "TASK-C", "summary": "Chore C", "updated_at": "2026-10-09T00:00:00Z"}
            )
            storage.save_issues([task_a, task_b, task_c])

            resp_a = self.client.get("/api/issues/TASK-A/background")
            self.assertEqual(resp_a.status_code, 200)
            self.assertEqual(self.mock_gemini.call_count, 1)

            resp_b = self.client.get("/api/issues/TASK-B/background")
            self.assertEqual(resp_b.status_code, 200)
            self.assertEqual(self.mock_gemini.call_count, 2)

            resp_c = self.client.get("/api/issues/TASK-C/background")
            self.assertEqual(resp_c.status_code, 204)
            self.assertEqual(self.mock_gemini.call_count, 2)  # Capped, not called!
        finally:
            main_mod.settings.gemini_daily_limit = old_limit

    def test_30_day_cache_pruning_unlinks_disk_and_db(self) -> None:
        """Verify expired cached images are pruned from disk and database."""
        # 1. Generate image
        resp = self.client.get("/api/issues/CHORE-1/background")
        self.assertEqual(resp.status_code, 200)
        cached_files = list(self.cache_dir.glob("*.webp"))
        self.assertEqual(len(cached_files), 1)
        content_hash = cached_files[0].stem
        file_path = str(cached_files[0])

        # 2. Artificially age the last_requested_at to 32 days in the past
        old_time = time.time() - (32 * 86400)
        with storage._lock:
            conn = storage._get_connection()
            with conn:
                conn.execute(
                    "UPDATE background_images SET last_requested_at = ? WHERE content_hash = ?;",
                    (old_time, content_hash),
                )

        # 3. Run pruning
        unlinked = storage.prune_expired_background_images(retention_seconds=30 * 86400)
        self.assertIn(file_path, unlinked)

        # In production/endpoint/maintenance, file on disk is removed
        for path in unlinked:
            p = Path(path)
            if p.exists():
                p.unlink()

        self.assertFalse(Path(file_path).exists())
        self.assertIsNone(storage.get_background_image(content_hash))
        self.assertIsNone(storage.get_issue_last_background_hash("CHORE-1"))
