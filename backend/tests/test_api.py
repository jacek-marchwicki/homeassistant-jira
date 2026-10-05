import os
import unittest

os.environ.setdefault("JIRA_USE_FAKE", "1")

from fastapi.testclient import TestClient

from jira_dashboard.presentation.main import app


class TestPresentationApi(unittest.TestCase):
    """Test suite verifying REST endpoints."""

    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_health_endpoint(self) -> None:
        """Verify GET /health returns 200 OK and expected metadata."""
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["app"], "homeassistant-jira")

    def test_get_board_endpoint(self) -> None:
        """Verify GET /api/board returns active board with issues."""
        response = self.client.get("/api/board")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("board_id", data)
        self.assertIn("issues", data)
        self.assertGreater(len(data["issues"]), 0)

    def test_transition_issue_endpoint(self) -> None:
        """Verify POST /api/issues/{key}/transition transitions an issue."""
        response = self.client.post(
            "/api/issues/PROJ-101/transition",
            json={"target_category": "done"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["key"], "PROJ-101")
        self.assertEqual(data["status"]["category"], "done")

    def test_transition_nonexistent_issue(self) -> None:
        """Verify 404 is returned for an invalid issue key."""
        response = self.client.post(
            "/api/issues/NONEXISTENT-999/transition",
            json={"target_category": "done"},
        )
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
