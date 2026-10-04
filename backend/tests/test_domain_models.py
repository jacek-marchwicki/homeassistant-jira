"""Unit tests for domain models."""

import unittest

from jira_dashboard.domain import (
    IssueType,
    JiraIssue,
    JiraStatus,
    JiraTransition,
    JiraUser,
    Priority,
    StatusCategory,
)


class TestDomainModels(unittest.TestCase):
    """Test suite verifying Jira domain model instantiation and logic."""

    def setUp(self) -> None:
        self.user = JiraUser(
            account_id="user-123",
            display_name="Jacek Marchwicki",
            avatar_url="https://example.com/avatar.png",
        )
        self.todo_status = JiraStatus(
            id="1",
            name="To Do",
            category=StatusCategory.TODO,
        )
        self.done_status = JiraStatus(
            id="3",
            name="Done",
            category=StatusCategory.DONE,
        )
        self.blocked_status = JiraStatus(
            id="4",
            name="Blocked",
            category=StatusCategory.BLOCKED,
        )

    def test_issue_creation_and_properties(self) -> None:
        """Verify JiraIssue instantiation and done/blocked helper methods."""
        issue = JiraIssue(
            id="10001",
            key="PROJ-101",
            summary="Setup test pipeline",
            issue_type=IssueType.TASK,
            priority=Priority.HIGH,
            status=self.todo_status,
            assignee=self.user,
            story_points=3.0,
            updated_at="2026-10-04T22:00:00Z",
        )
        self.assertEqual(issue.key, "PROJ-101")
        self.assertFalse(issue.is_done())
        self.assertFalse(issue.is_blocked())

    def test_issue_done_state(self) -> None:
        """Verify is_done returns True for DONE category."""
        issue = JiraIssue(
            id="10002",
            key="PROJ-102",
            summary="Completed feature",
            issue_type=IssueType.STORY,
            priority=Priority.MEDIUM,
            status=self.done_status,
            updated_at="2026-10-04T22:00:00Z",
        )
        self.assertTrue(issue.is_done())
        self.assertFalse(issue.is_blocked())

    def test_issue_blocked_state(self) -> None:
        """Verify is_blocked returns True for BLOCKED category."""
        issue = JiraIssue(
            id="10003",
            key="PROJ-103",
            summary="Blocked dependency",
            issue_type=IssueType.BUG,
            priority=Priority.HIGHEST,
            status=self.blocked_status,
            updated_at="2026-10-04T22:00:00Z",
        )
        self.assertFalse(issue.is_done())
        self.assertTrue(issue.is_blocked())

    def test_transition_creation(self) -> None:
        """Verify JiraTransition creation and properties."""
        transition = JiraTransition(
            id="31",
            name="Done",
            to_status=self.done_status,
        )
        self.assertEqual(transition.name, "Done")
        self.assertEqual(transition.to_status.category, StatusCategory.DONE)


if __name__ == "__main__":
    unittest.main()
