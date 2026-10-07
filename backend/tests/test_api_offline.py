"""Tests verifying immediate offline API responses and outbox queuing when Jira is offline."""

import os
import unittest

os.environ.setdefault("JIRA_USE_FAKE", "1")

from fastapi.testclient import TestClient

from jira_dashboard.presentation.main import app, storage


class TestOfflinePresentationApi(unittest.TestCase):
    """Test suite verifying immediate API responses while Jira is offline."""

    def setUp(self) -> None:
        self.client = TestClient(app)
        self.client.post("/api/test/reset")

    def test_transition_succeeds_offline_and_enqueues_outbox(self) -> None:
        """When Jira is offline (503), transitioning an issue must succeed immediately (200)."""
        # Disconnect Jira / simulate Jira failure
        self.client.post(
            "/api/test/simulate-error",
            json={
                "enable": True,
                "status_code": 503,
                "message": "Jira Unreachable (Offline)",
                "target": "all",
            },
        )

        response = self.client.post(
            "/api/issues/PROJ-101/transition",
            json={"target_category": "done", "target_status": "Done"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["key"], "PROJ-101")
        self.assertEqual(data["status"]["category"], "done")

        # Board endpoint must immediately return the updated status
        board_res = self.client.get("/api/board")
        self.assertEqual(board_res.status_code, 200)
        issues = board_res.json()["issues"]
        target = next(i for i in issues if i["key"] == "PROJ-101")
        self.assertEqual(target["status"]["category"], "done")

        # Storage outbox must contain pending outbox action
        pending = storage.get_pending_outbox()
        self.assertTrue(
            any(
                p["action_type"] == "transition_issue" and p["issue_key"] == "PROJ-101"
                for p in pending
            )
        )

    def test_update_single_field_offline(self) -> None:
        """When Jira is offline, single field update must succeed immediately with 200."""
        self.client.post(
            "/api/test/simulate-error",
            json={
                "enable": True,
                "status_code": 503,
                "message": "Jira Unreachable (Offline)",
                "target": "all",
            },
        )

        orig_issue = self.client.get("/api/board").json()["issues"][0]
        orig_summary = orig_issue["summary"]

        response = self.client.patch(
            f"/api/issues/{orig_issue['key']}",
            json={"assignee_name": "Offline Worker"},
        )
        self.assertEqual(response.status_code, 200)
        updated = response.json()
        self.assertEqual(updated["assignee"]["display_name"], "Offline Worker")
        # Summary must remain untouched
        self.assertEqual(updated["summary"], orig_summary)

        # Pending outbox entry must contain ONLY assignee_name
        pending = storage.get_pending_outbox()
        outbox_entry = next(
            p
            for p in pending
            if p["action_type"] == "update_issue" and p["issue_key"] == orig_issue["key"]
        )
        self.assertIn("assignee_name", outbox_entry["payload"])
        self.assertNotIn("summary", outbox_entry["payload"])

    def test_create_issue_offline(self) -> None:
        """When Jira is offline, creating an issue must succeed immediately with 201."""
        self.client.post(
            "/api/test/simulate-error",
            json={
                "enable": True,
                "status_code": 503,
                "message": "Jira Unreachable (Offline)",
                "target": "all",
            },
        )

        response = self.client.post(
            "/api/issues",
            json={
                "summary": "Offline Created Task",
                "issue_type": "task",
                "priority": "high",
                "status_category": "todo",
            },
        )
        self.assertEqual(response.status_code, 201)
        created = response.json()
        self.assertEqual(created["summary"], "Offline Created Task")
        self.assertTrue(created["key"].startswith("TEMP-") or created["key"].startswith("PROJ-"))

        # Verify board contains newly created issue
        board = self.client.get("/api/board").json()
        self.assertTrue(any(i["key"] == created["key"] for i in board["issues"]))


if __name__ == "__main__":
    unittest.main()
