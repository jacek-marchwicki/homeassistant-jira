"""Adapter and infrastructure implementations (Jira API client, Webhooks, WebSocket hub)."""

from jira_dashboard.adapters.jira_client import (
    FakeJiraClient,
    JiraAPIError,
    JiraClientProtocol,
)

__all__ = ["FakeJiraClient", "JiraAPIError", "JiraClientProtocol"]
