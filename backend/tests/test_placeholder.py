"""Placeholder test to verify test harness setup."""

import jira_dashboard


def test_package_metadata() -> None:
    """Verify package version is defined."""
    assert jira_dashboard.__version__ == "0.1.0"
