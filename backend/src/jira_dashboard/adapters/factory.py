"""Factory for creating Jira client adapters based on settings."""

from __future__ import annotations

import logging

from jira_dashboard.adapters.jira_client import (
    FakeJiraClient,
    JiraClientProtocol,
)
from jira_dashboard.adapters.jira_cloud_client import JiraCloudClient
from jira_dashboard.config import JiraDashboardSettings

logger = logging.getLogger(__name__)


def create_jira_client(settings: JiraDashboardSettings | None = None) -> JiraClientProtocol:
    """Create a configured JiraClientProtocol instance.

    Uses JiraCloudClient if real credentials exist, otherwise falls back
    to FakeJiraClient for local development and testing.
    """
    import os

    if os.environ.get("JIRA_USE_FAKE") == "1":
        logger.info("JIRA_USE_FAKE=1 set; using in-memory FakeJiraClient test double.")
        return FakeJiraClient()

    if settings is None:
        settings = JiraDashboardSettings.load()

    if settings.has_jira_credentials:
        logger.info(
            "Configuring real JiraCloudClient connecting to %s",
            settings.jira_url,
        )
        return JiraCloudClient(settings)

    logger.info("No Jira credentials configured. Using in-memory FakeJiraClient test double.")
    return FakeJiraClient()
