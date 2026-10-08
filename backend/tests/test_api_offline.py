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

    def test_create_issue_offline_with_status_and_assignee_ranks_highest(self) -> None:
        """When offline, creating an issue with custom status and assignee preserves all fields
        and ranks highest."""
        self.client.post(
            "/api/test/simulate-error",
            json={
                "enable": True,
                "status_code": 503,
                "message": "Jira Unreachable (Offline)",
                "target": "all",
            },
        )

        board_before = self.client.get("/api/board").json()
        ranked_before = [i["rank"] for i in board_before["issues"] if i.get("rank")]
        min_rank_before = min(ranked_before) if ranked_before else None

        response = self.client.post(
            "/api/issues",
            json={
                "summary": "Urgent Offline Task",
                "issue_type": "task",
                "priority": "high",
                "status_category": "todo",
                "status_name": "Ready",
                "status_id": "col-todo",
                "assignee_name": "Jacek Marchwicki",
                "assignee_account_id": "usr-1",
            },
        )
        self.assertEqual(response.status_code, 201)
        created = response.json()
        self.assertEqual(created["summary"], "Urgent Offline Task")
        self.assertEqual(created["status"]["name"], "Ready")
        self.assertEqual(created["status"]["id"], "col-todo")
        self.assertIsNotNone(created["assignee"])
        self.assertEqual(created["assignee"]["display_name"], "Jacek Marchwicki")
        self.assertEqual(created["assignee"]["account_id"], "usr-1")

        if min_rank_before:
            self.assertIsNotNone(created.get("rank"))
            self.assertLess(created["rank"], min_rank_before)

        # Verify board contains newly created issue at index 0 (top rank)
        board_after = self.client.get("/api/board").json()
        self.assertEqual(board_after["issues"][0]["key"], created["key"])

        # Storage outbox must contain all fields in payload
        pending = storage.get_pending_outbox()
        outbox_entry = next(
            p
            for p in pending
            if p["action_type"] == "create_issue" and p["issue_key"] == created["key"]
        )
        self.assertEqual(outbox_entry["payload"]["status_name"], "Ready")
        self.assertEqual(outbox_entry["payload"]["status_id"], "col-todo")
        self.assertEqual(outbox_entry["payload"]["assignee_name"], "Jacek Marchwicki")
        self.assertEqual(outbox_entry["payload"]["assignee_account_id"], "usr-1")
        self.assertIsNotNone(outbox_entry["payload"].get("rank"))

    def test_update_assignee_unassign_offline(self) -> None:
        """When offline, setting assignee_name to empty string unassigns the ticket."""
        self.client.post(
            "/api/test/simulate-error",
            json={
                "enable": True,
                "status_code": 503,
                "message": "Jira Unreachable (Offline)",
                "target": "all",
            },
        )

        response = self.client.patch(
            "/api/issues/PROJ-101",
            json={"assignee_name": ""},
        )
        self.assertEqual(response.status_code, 200)
        updated = response.json()
        self.assertIsNone(updated["assignee"])

        # Check board response
        board = self.client.get("/api/board").json()
        target = next(i for i in board["issues"] if i["key"] == "PROJ-101")
        self.assertIsNone(target["assignee"])

    def test_rank_issue_offline_and_enqueues_outbox(self) -> None:
        """When Jira is offline (503), ranking must succeed immediately and queue outbox."""
        self.client.post(
            "/api/test/simulate-error",
            json={
                "enable": True,
                "status_code": 503,
                "message": "Jira Offline",
                "target": "all",
            },
        )
        response = self.client.put(
            "/api/issues/PROJ-101/rank",
            json={"rank_after_key": "PROJ-98", "rank": "0|i00003:"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["key"], "PROJ-101")
        self.assertEqual(data["rank"], "0|i00003:")

        # Outbox must contain rank_issue
        pending = storage.get_pending_outbox()
        self.assertTrue(
            any(p["action_type"] == "rank_issue" and p["issue_key"] == "PROJ-101" for p in pending)
        )


if __name__ == "__main__":
    unittest.main()
