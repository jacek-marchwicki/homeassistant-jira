"""Unit tests for Jira webhook secret verification."""

from __future__ import annotations

from fastapi.testclient import TestClient

from jira_dashboard.presentation import main
from jira_dashboard.presentation.main import app

SAMPLE_PAYLOAD = {
    "webhookEvent": "jira:issue_updated",
    "issue": {
        "id": "101",
        "key": "PROJ-101",
        "fields": {
            "summary": "Webhook secret test",
            "status": {
                "name": "Done",
                "statusCategory": {"id": 3, "key": "done", "name": "Done"},
            },
        },
    },
}


def test_webhook_no_secret_configured(monkeypatch) -> None:
    """Verify webhooks are accepted when no secret is configured."""
    monkeypatch.setattr(main.settings, "webhook_secret", None)
    client = TestClient(app)

    res = client.post("/api/webhooks/jira", json=SAMPLE_PAYLOAD)
    assert res.status_code == 200
    assert res.json()["status"] == "processed"


def test_webhook_secret_required_and_matches_header(monkeypatch) -> None:
    """Verify webhook succeeds when provided matching X-Webhook-Secret header."""
    monkeypatch.setattr(main.settings, "webhook_secret", "secret-token-xyz")
    client = TestClient(app)

    # 1. Matching X-Webhook-Secret header
    res = client.post(
        "/api/webhooks/jira",
        json=SAMPLE_PAYLOAD,
        headers={"X-Webhook-Secret": "secret-token-xyz"},
    )
    assert res.status_code == 200

    # 2. Matching X-Atlassian-Webhook-Secret header
    res2 = client.post(
        "/api/webhooks/jira",
        json=SAMPLE_PAYLOAD,
        headers={"X-Atlassian-Webhook-Secret": "secret-token-xyz"},
    )
    assert res2.status_code == 200

    # 3. Matching query parameter
    res3 = client.post(
        "/api/webhooks/jira?secret=secret-token-xyz",
        json=SAMPLE_PAYLOAD,
    )
    assert res3.status_code == 200


def test_webhook_secret_rejection_on_invalid_or_missing(monkeypatch) -> None:
    """Verify 401 is returned when secret is missing or invalid."""
    monkeypatch.setattr(main.settings, "webhook_secret", "secret-token-xyz")
    client = TestClient(app)

    # 1. Missing secret
    res = client.post("/api/webhooks/jira", json=SAMPLE_PAYLOAD)
    assert res.status_code == 401
    assert "Invalid webhook secret" in res.json().get("detail", "")

    # 2. Wrong secret
    res_wrong = client.post(
        "/api/webhooks/jira",
        json=SAMPLE_PAYLOAD,
        headers={"X-Webhook-Secret": "incorrect-token"},
    )
    assert res_wrong.status_code == 401
