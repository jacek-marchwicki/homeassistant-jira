import os
import unittest

os.environ.setdefault("JIRA_USE_FAKE", "1")

from fastapi.testclient import TestClient

from jira_dashboard.presentation.main import app


class TestPresentationApi(unittest.TestCase):
    """Test suite verifying REST endpoints."""

    def setUp(self) -> None:
        self.client = TestClient(app)
        self.client.post("/api/test/reset")

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
        self.assertIn("jira_url", data)
        self.assertTrue(data["jira_url"].startswith("http"))
        self.assertIn("issues", data)
        self.assertGreater(len(data["issues"]), 0)
        self.assertTrue(data["issues"][0]["url"].endswith("/browse/PROJ-101"))

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

    def test_update_issue_endpoint(self) -> None:
        """Verify PATCH and PUT /api/issues/{key} updates issue fields."""
        response = self.client.patch(
            "/api/issues/PROJ-101",
            json={
                "summary": "Updated summary from API test",
                "description": "Updated issue description details",
                "priority": "highest",
                "story_points": 5.0,
                "recreate_after": "7 days",
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["key"], "PROJ-101")
        self.assertEqual(data["summary"], "Updated summary from API test")
        self.assertEqual(data["description"], "Updated issue description details")
        self.assertEqual(data["priority"], "highest")
        self.assertEqual(data["story_points"], 5.0)
        self.assertEqual(data["recreate_after"], "7 days")

    def test_update_nonexistent_issue(self) -> None:
        """Verify 404 is returned when updating an invalid issue key."""
        response = self.client.patch(
            "/api/issues/NONEXISTENT-999",
            json={"summary": "New summary"},
        )
        self.assertEqual(response.status_code, 404)

    def test_create_issue_endpoint(self) -> None:
        """Verify POST /api/issues creates a new issue and returns 201."""
        response = self.client.post(
            "/api/issues",
            json={
                "summary": "Created issue via REST",
                "description": "New issue description body",
                "issue_type": "bug",
                "priority": "high",
                "assignee_name": "Bob Jones",
                "story_points": 3.0,
                "recreate_after": "1 month",
            },
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertTrue(data["key"].startswith("PROJ-"))
        self.assertEqual(data["summary"], "Created issue via REST")
        self.assertEqual(data["description"], "New issue description body")
        self.assertEqual(data["issue_type"], "bug")
        self.assertEqual(data["priority"], "high")
        self.assertEqual(data["assignee"]["display_name"], "Bob Jones")
        self.assertEqual(data["story_points"], 3.0)
        self.assertEqual(data["recreate_after"], "1 month")

    def test_create_issue_when_board_has_jira_cloud_timezone_offset_timestamp(self) -> None:
        """Verify POST /api/issues does not crash when board contains Jira Cloud timestamps
        with numeric timezone offsets (e.g. 2026-10-08T16:25:43.045+0200)."""
        from jira_dashboard.domain import IssueType, JiraIssue, JiraStatus, Priority, StatusCategory
        from jira_dashboard.presentation import main as main_module

        # Ensure board is loaded into cache
        self.client.get("/api/board")
        self.assertIsNotNone(main_module._cached_board_response)

        jira_cloud_issue = JiraIssue(
            id="105",
            key="PROJ-105",
            summary="Issue with Jira Cloud ISO timestamp",
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
            updated_at="2026-10-08T16:25:43.045+0200",
        )
        main_module._cached_board_response.issues.append(jira_cloud_issue)

        response = self.client.post(
            "/api/issues",
            json={
                "summary": "Ticket created after Jira Cloud sync",
                "issue_type": "task",
                "priority": "medium",
            },
        )
        self.assertEqual(response.status_code, 201)

    def test_get_users_endpoint(self) -> None:
        """Verify GET /api/users returns list of assignable and known users."""
        response = self.client.get("/api/users")
        self.assertEqual(response.status_code, 200)
        users = response.json()
        self.assertIsInstance(users, list)
        self.assertGreater(len(users), 0)
        self.assertTrue(any(u["display_name"] == "Jacek Marchwicki" for u in users))

    def test_comments_crud_lifecycle(self) -> None:
        """Verify viewing, adding, updating, and deleting comments on an issue."""
        # 1. View comments
        get_res = self.client.get("/api/issues/PROJ-101/comments")
        self.assertEqual(get_res.status_code, 200)
        comments = get_res.json()
        self.assertIsInstance(comments, list)
        self.assertGreaterEqual(len(comments), 1)
        initial_count = len(comments)

        # 2. Add comment
        post_res = self.client.post(
            "/api/issues/PROJ-101/comments",
            json={
                "body": "New test comment added by automation.",
                "author_name": "Test Runner",
            },
        )
        self.assertEqual(post_res.status_code, 201)
        new_comment = post_res.json()
        comment_id = new_comment["id"]
        self.assertEqual(new_comment["body"], "New test comment added by automation.")
        self.assertEqual(new_comment["author"]["display_name"], "Test Runner")

        # Verify comment list increased
        get_res2 = self.client.get("/api/issues/PROJ-101/comments")
        self.assertEqual(len(get_res2.json()), initial_count + 1)

        # 3. Update comment
        put_res = self.client.put(
            f"/api/issues/PROJ-101/comments/{comment_id}",
            json={"body": "Edited test comment body."},
        )
        self.assertEqual(put_res.status_code, 200)
        updated_comment = put_res.json()
        self.assertEqual(updated_comment["id"], comment_id)
        self.assertEqual(updated_comment["body"], "Edited test comment body.")
        self.assertIsNotNone(updated_comment["updated"])

        # 4. Delete comment
        del_res = self.client.delete(f"/api/issues/PROJ-101/comments/{comment_id}")
        self.assertEqual(del_res.status_code, 200)
        self.assertEqual(del_res.json()["status"], "deleted")

        # Verify comment list returned to initial count
        get_res3 = self.client.get("/api/issues/PROJ-101/comments")
        self.assertEqual(len(get_res3.json()), initial_count)

    def test_comments_empty_body_rejected(self) -> None:
        """Verify empty comment body is rejected with 400 Bad Request."""
        res = self.client.post(
            "/api/issues/PROJ-101/comments",
            json={"body": "   "},
        )
        self.assertEqual(res.status_code, 400)

    def test_board_caching_and_refresh(self) -> None:
        """Verify GET /api/board serves cached state and refresh=true refreshes."""
        res1 = self.client.get("/api/board")
        self.assertEqual(res1.status_code, 200)

        # Force refresh via query param
        res2 = self.client.get("/api/board?refresh=true")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res1.json()["board_id"], res2.json()["board_id"])

    def test_board_cache_updated_on_mutation(self) -> None:
        """Verify mutations update the cached board issues immediately."""
        self.client.post("/api/test/reset")
        board_before = self.client.get("/api/board").json()
        target_issue = next(i for i in board_before["issues"] if i["key"] == "PROJ-101")
        self.assertNotEqual(target_issue["status"]["category"], "done")

        # Mutate issue
        trans_res = self.client.post(
            "/api/issues/PROJ-101/transition",
            json={"target_category": "done"},
        )
        self.assertEqual(trans_res.status_code, 200)

        # Board served from cache should reflect mutation
        board_after = self.client.get("/api/board").json()
        updated_issue = next(i for i in board_after["issues"] if i["key"] == "PROJ-101")
        self.assertEqual(updated_issue["status"]["category"], "done")

    def test_rank_issue_endpoint(self) -> None:
        """Verify PUT /api/issues/{key}/rank updates issue rank and orders board."""
        res = self.client.put(
            "/api/issues/PROJ-101/rank",
            json={"rank_after_key": "PROJ-98"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["key"], "PROJ-101")
        self.assertIsNotNone(data["rank"])


if __name__ == "__main__":
    unittest.main()
