"""Adapter and infrastructure implementations (Jira API client, Webhooks, WebSocket hub)."""

from jira_dashboard.adapters.factory import create_jira_client
from jira_dashboard.adapters.jira_client import (
    FakeJiraClient,
    JiraAPIError,
    JiraClientProtocol,
)
from jira_dashboard.adapters.jira_cloud_client import JiraCloudClient
from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.adapters.sync_worker import JiraSyncWorker

__all__ = [
    "FakeJiraClient",
    "JiraAPIError",
    "JiraClientProtocol",
    "JiraCloudClient",
    "JiraSyncWorker",
    "SQLiteStorage",
    "create_jira_client",
]

