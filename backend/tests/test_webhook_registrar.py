"""Unit tests for automated Jira webhook registration module."""

from __future__ import annotations

import unittest

from jira_dashboard.adapters.jira_client import FakeJiraClient
from jira_dashboard.adapters.webhook_registrar import (
    build_webhook_url_with_secret,
    register_jira_webhook_if_needed,
)


class TestWebhookRegistrar(unittest.IsolatedAsyncioTestCase):
    """Test suite verifying idempotent webhook registration in Jira REST API."""

    def setUp(self) -> None:
        self.jira_client = FakeJiraClient()

    def test_build_webhook_url_with_secret(self) -> None:
        """Verify secret parameter appending to URLs."""
        # No secret
        self.assertEqual(
            build_webhook_url_with_secret("https://hooks.nabu.casa/hook1", None),
            "https://hooks.nabu.casa/hook1",
        )
        # Empty secret
        self.assertEqual(
            build_webhook_url_with_secret("https://hooks.nabu.casa/hook1", ""),
            "https://hooks.nabu.casa/hook1",
        )
        # Clean URL without query params
        self.assertEqual(
            build_webhook_url_with_secret("https://hooks.nabu.casa/hook1", "sec123"),
            "https://hooks.nabu.casa/hook1?secret=sec123",
        )
        # URL with existing query params
        self.assertEqual(
            build_webhook_url_with_secret("https://hooks.nabu.casa/hook1?format=json", "sec123"),
            "https://hooks.nabu.casa/hook1?format=json&secret=sec123",
        )
        # URL already having secret
        self.assertEqual(
            build_webhook_url_with_secret("https://hooks.nabu.casa/hook1?secret=sec123", "sec123"),
            "https://hooks.nabu.casa/hook1?secret=sec123",
        )

    async def test_register_jira_webhook_creates_new_webhook(self) -> None:
        """Verify webhook is registered when not previously present."""
        url = "https://hooks.nabu.casa/test-hook-abc"
        success = await register_jira_webhook_if_needed(
            jira_client=self.jira_client,
            webhook_url=url,
            secret="my-super-secret",
        )
        self.assertTrue(success)

        # Check registered in FakeJiraClient
        webhooks = await self.jira_client.get_webhooks()
        self.assertEqual(len(webhooks), 1)
        self.assertEqual(
            webhooks[0]["url"], "https://hooks.nabu.casa/test-hook-abc?secret=my-super-secret"
        )
        self.assertIn("jira:issue_updated", webhooks[0]["events"])

    async def test_register_jira_webhook_is_idempotent(self) -> None:
        """Verify already registered webhook is not duplicated."""
        url = "https://hooks.nabu.casa/test-hook-abc"
        # 1. First registration
        res1 = await register_jira_webhook_if_needed(
            jira_client=self.jira_client,
            webhook_url=url,
            secret="my-super-secret",
        )
        self.assertTrue(res1)
        self.assertEqual(len(await self.jira_client.get_webhooks()), 1)

        # 2. Second registration call
        res2 = await register_jira_webhook_if_needed(
            jira_client=self.jira_client,
            webhook_url=url,
            secret="my-super-secret",
        )
        self.assertTrue(res2)
        # Should still be exactly 1
        self.assertEqual(len(await self.jira_client.get_webhooks()), 1)

    async def test_register_jira_webhook_empty_url_returns_false(self) -> None:
        """Verify empty URL is rejected gracefully."""
        res = await register_jira_webhook_if_needed(
            jira_client=self.jira_client,
            webhook_url="",
        )
        self.assertFalse(res)

    async def test_register_jira_webhook_handles_failure_gracefully(self) -> None:
        """Verify Jira client API failures do not raise exceptions."""
        self.jira_client.set_simulate_failure(enable=True, status_code=500, message="Jira down")
        res = await register_jira_webhook_if_needed(
            jira_client=self.jira_client,
            webhook_url="https://hooks.nabu.casa/fail-test",
            secret="sec",
        )
        self.assertFalse(res)
