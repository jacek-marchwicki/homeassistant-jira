"""Unit tests for domain models."""

import unittest

from jira_dashboard.domain import (
    IssueType,
    JiraIssue,
    JiraIssueLink,
    JiraLinkedIssue,
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
            recreate_after="7d",
            url="https://jira.example.com/browse/PROJ-101",
            updated_at="2026-10-04T22:00:00Z",
        )
        self.assertEqual(issue.key, "PROJ-101")
        self.assertEqual(issue.recreate_after, "7d")
        self.assertEqual(issue.url, "https://jira.example.com/browse/PROJ-101")
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

    def test_jira_issue_rank_field(self) -> None:
        """Verify JiraIssue rank field defaults to None and accepts LexoRank strings."""
        issue_no_rank = JiraIssue(
            id="10001",
            key="PROJ-101",
            summary="Setup test pipeline",
            issue_type=IssueType.TASK,
            priority=Priority.HIGH,
            status=self.todo_status,
            updated_at="2026-10-04T22:00:00Z",
        )
        self.assertIsNone(issue_no_rank.rank)

        issue_with_rank = JiraIssue(
            id="10002",
            key="PROJ-102",
            summary="Ranked issue",
            issue_type=IssueType.STORY,
            priority=Priority.HIGH,
            status=self.todo_status,
            rank="0|i00001:",
            updated_at="2026-10-04T22:00:00Z",
        )
        self.assertEqual(issue_with_rank.rank, "0|i00001:")

    def test_issue_links_model(self) -> None:
        """Verify JiraIssueLink and JiraLinkedIssue can be added to JiraIssue."""
        linked = JiraLinkedIssue(
            id="10002",
            key="PROJ-102",
            summary="Cloned issue summary",
            status=self.done_status,
            priority=Priority.HIGH,
            issue_type=IssueType.BUG,
            url="https://jira.example.com/browse/PROJ-102",
        )
        link = JiraIssueLink(
            id="link-1",
            relationship="clones",
            issue=linked,
            direction="outward",
        )
        issue = JiraIssue(
            id="10001",
            key="PROJ-101",
            summary="Main issue",
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=self.todo_status,
            updated_at="2026-10-04T22:00:00Z",
            issue_links=[link],
        )
        self.assertEqual(len(issue.issue_links), 1)
        self.assertEqual(issue.issue_links[0].relationship, "clones")
        self.assertEqual(issue.issue_links[0].issue.key, "PROJ-102")
        self.assertIsNotNone(issue.issue_links[0].issue.status)
        self.assertEqual(issue.issue_links[0].issue.status.name, "Done")

    def test_parse_iso_timestamp(self) -> None:
        """Verify parse_iso_timestamp handles Jira Cloud formats, offsets, Z, and bad inputs."""
        from jira_dashboard.domain import parse_iso_timestamp

        # 1. Jira Cloud offset without colon (+0200)
        t1 = parse_iso_timestamp("2026-10-08T16:25:43.045+0200")
        self.assertGreater(t1, 0.0)

        # 2. Jira Cloud UTC equivalent (+0000 or Z)
        t2 = parse_iso_timestamp("2026-10-08T14:25:43.045Z")
        self.assertAlmostEqual(t1, t2, places=3)

        # 3. Numeric offset with colon (+02:00)
        t3 = parse_iso_timestamp("2026-10-08T16:25:43.045+02:00")
        self.assertAlmostEqual(t1, t3, places=3)

        # 4. Negative offset (-0500)
        t4 = parse_iso_timestamp("2026-10-08T09:25:43.045-0500")
        self.assertAlmostEqual(t1, t4, places=3)

        # 5. Standard ISO with Z and without milliseconds
        t5 = parse_iso_timestamp("2026-10-08T14:25:43Z")
        self.assertAlmostEqual(t5, 1791469543.0, places=1)

        # 6. Lowercase z
        t6 = parse_iso_timestamp("2026-10-08T14:25:43z")
        self.assertEqual(t5, t6)

        # 7. Date only and naive
        t7 = parse_iso_timestamp("2026-10-08")
        self.assertGreater(t7, 0.0)

        # 8. Invalid or empty values return 0.0 safely
        self.assertEqual(parse_iso_timestamp(None), 0.0)
        self.assertEqual(parse_iso_timestamp(""), 0.0)
        self.assertEqual(parse_iso_timestamp("   "), 0.0)
        self.assertEqual(parse_iso_timestamp("not-a-timestamp"), 0.0)

    def test_issue_sort_key(self) -> None:
        """Verify issue_sort_key prioritizes LexoRank, then sorts unranked by updated_at desc."""
        from jira_dashboard.domain import issue_sort_key

        issue_ranked_top = JiraIssue(
            id="1",
            key="PROJ-1",
            summary="Ranked 1",
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=self.todo_status,
            rank="0|i00001:",
            updated_at="2026-10-08T10:00:00Z",
        )
        issue_ranked_second = JiraIssue(
            id="2",
            key="PROJ-2",
            summary="Ranked 2",
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=self.todo_status,
            rank="0|i00002:",
            updated_at="2026-10-08T18:00:00Z",
        )
        issue_unranked_new = JiraIssue(
            id="3",
            key="PROJ-3",
            summary="Unranked Newer",
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=self.todo_status,
            rank=None,
            updated_at="2026-10-08T16:25:43.045+0200",
        )
        issue_unranked_old = JiraIssue(
            id="4",
            key="PROJ-4",
            summary="Unranked Older",
            issue_type=IssueType.TASK,
            priority=Priority.MEDIUM,
            status=self.todo_status,
            rank=None,
            updated_at="2026-10-01T10:00:00Z",
        )

        issues = [issue_unranked_old, issue_ranked_second, issue_unranked_new, issue_ranked_top]
        issues.sort(key=issue_sort_key)

        expected_order = ["PROJ-1", "PROJ-2", "PROJ-3", "PROJ-4"]
        self.assertEqual([i.key for i in issues], expected_order)

    def test_rank_before_lexoranks(self) -> None:
        """Verify rank_before produces strictly smaller LexoRanks across varied formats."""
        from jira_dashboard.domain import rank_before

        test_ranks = [
            "0|i02akf:",
            "0|i02akm:",
            "0|i02al0:",
            "0|i000f3:000x",
            "0|i000f3:000xi",
            "0|00000:",
            "0|i00000:",
            "0|i00001:",
            "0|0:",
            "1|000000:",
        ]
        for r in test_ranks:
            bef = rank_before(r)
            self.assertTrue(bef < r, f"Expected {bef} < {r}")


if __name__ == "__main__":
    unittest.main()
