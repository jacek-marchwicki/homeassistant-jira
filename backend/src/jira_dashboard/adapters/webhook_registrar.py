"""Automated idempotent webhook registration with Jira REST API."""

from __future__ import annotations

import logging
from urllib.parse import parse_qs, quote, urlparse

from jira_dashboard.adapters.jira_client import JiraClientProtocol

logger = logging.getLogger(__name__)


def build_webhook_url_with_secret(base_url: str, secret: str | None) -> str:
    """Append secret token to webhook URL query parameters if not already present."""
    if not secret:
        return base_url

    parsed = urlparse(base_url)
    params = parse_qs(parsed.query)
    if "secret" in params:
        return base_url

    delimiter = "&" if parsed.query else "?"
    return f"{base_url}{delimiter}secret={quote(secret)}"


async def register_jira_webhook_if_needed(
    jira_client: JiraClientProtocol,
    webhook_url: str,
    secret: str | None = None,
    events: list[str] | None = None,
    jql_filter: str | None = None,
) -> bool:
    """Idempotently register or verify a dynamic webhook in Jira REST API.

    Returns True if the webhook is registered (either newly created or already existing).
    """
    if not webhook_url:
        logger.warning("Cannot register Jira webhook: empty webhook URL provided.")
        return False

    target_url = build_webhook_url_with_secret(webhook_url, secret)

    try:
        # Check existing webhooks for idempotency
        existing_webhooks = await jira_client.get_webhooks()
        for wh in existing_webhooks:
            wh_url = wh.get("url", "")
            if wh_url == target_url:
                logger.info("Jira webhook already registered for URL: %s", target_url)
                return True

        logger.info("Registering dynamic Jira webhook for URL: %s", target_url)
        res = await jira_client.register_webhook(
            url=target_url,
            events=events
            or [
                "jira:issue_created",
                "jira:issue_updated",
                "jira:issue_deleted",
            ],
            jql_filter=jql_filter or "",
        )
        logger.info("Successfully registered Jira webhook: %s", res)
        return True
    except Exception as exc:
        logger.warning("Could not register Jira webhook (%s): %s", target_url, exc)
        return False
