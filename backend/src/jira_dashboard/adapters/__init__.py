"""Adapter and infrastructure implementations (Jira API client, Webhooks, WebSocket hub)."""

from jira_dashboard.adapters.factory import create_jira_client
from jira_dashboard.adapters.jira_client import (
    FakeJiraClient,
    JiraAPIError,
    JiraClientProtocol,
)
from jira_dashboard.adapters.jira_cloud_client import JiraCloudClient

__all__ = [
    "FakeJiraClient",
    "JiraAPIError",
    "JiraClientProtocol",
    "JiraCloudClient",
    "create_jira_client",
]
