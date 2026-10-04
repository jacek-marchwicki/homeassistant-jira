"""Placeholder test to verify test harness setup."""

import unittest

import jira_dashboard


class TestPackageMetadata(unittest.TestCase):
    """Verify backend package metadata."""

    def test_package_metadata(self) -> None:
        """Verify package version is defined."""
        self.assertEqual(jira_dashboard.__version__, "0.1.0")


if __name__ == "__main__":
    unittest.main()
