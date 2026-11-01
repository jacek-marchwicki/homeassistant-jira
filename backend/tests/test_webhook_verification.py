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


def test_webhook_x_hub_signature_sha256_accepted(monkeypatch) -> None:
    """Verify webhook succeeds when provided matching Jira X-Hub-Signature HMAC-SHA256."""
    import hashlib
    import hmac
    import json

    secret = "secret-token-xyz"
    monkeypatch.setattr(main.settings, "webhook_secret", secret)
    client = TestClient(app)

    raw_body = json.dumps(SAMPLE_PAYLOAD).encode("utf-8")
    sig = "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()

    # 1. Standard Jira Cloud X-Hub-Signature header
    res = client.post(
        "/api/webhooks/jira",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Hub-Signature": sig},
    )
    assert res.status_code == 200
    assert res.json()["status"] == "processed"

    # 2. X-Hub-Signature with extra query params (as Jira sends ?triggeredByUser=...)
    res2 = client.post(
        "/api/webhooks/jira?triggeredByUser=5b5b396ce859072d9083c343",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Hub-Signature": sig},
    )
    assert res2.status_code == 200
    assert res2.json()["status"] == "processed"

    # 3. X-Hub-Signature-256 header alias
    res3 = client.post(
        "/api/webhooks/jira",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Hub-Signature-256": sig},
    )
    assert res3.status_code == 200
    assert res3.json()["status"] == "processed"


def test_webhook_x_hub_signature_invalid_or_tampered(monkeypatch) -> None:
    """Verify 401 is returned when X-Hub-Signature does not match payload."""
    import hashlib
    import hmac
    import json

    secret = "secret-token-xyz"
    monkeypatch.setattr(main.settings, "webhook_secret", secret)
    client = TestClient(app)

    raw_body = json.dumps(SAMPLE_PAYLOAD).encode("utf-8")

    # 1. Invalid signature hash
    fake_sig = "sha256=" + ("0123456789abcdef" * 4)
    res_bad_sig = client.post(
        "/api/webhooks/jira",
        content=raw_body,
        headers={
            "Content-Type": "application/json",
            "X-Hub-Signature": fake_sig,
        },
    )
    assert res_bad_sig.status_code == 401
    assert "Invalid webhook secret" in res_bad_sig.json().get("detail", "")

    # 2. Signature generated with different secret
    wrong_sig = "sha256=" + hmac.new(b"wrong-secret", raw_body, hashlib.sha256).hexdigest()
    res_wrong_secret = client.post(
        "/api/webhooks/jira",
        content=raw_body,
        headers={"Content-Type": "application/json", "X-Hub-Signature": wrong_sig},
    )
    assert res_wrong_secret.status_code == 401

    # 3. Tampered payload
    valid_sig = "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    tampered_data = {"webhookEvent": "jira:issue_updated", "tampered": True}
    tampered_body = json.dumps(tampered_data).encode("utf-8")
    res_tampered = client.post(
        "/api/webhooks/jira",
        content=tampered_body,
        headers={"Content-Type": "application/json", "X-Hub-Signature": valid_sig},
    )
    assert res_tampered.status_code == 401


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


def test_webhook_handles_issue_deleted(monkeypatch) -> None:
    """Verify POST /api/webhooks/jira processes jira:issue_deleted event."""
    monkeypatch.setattr(main.settings, "webhook_secret", None)
    client = TestClient(app)

    # First seed or ensure issue exists in storage
    from jira_dashboard.domain import IssueType, JiraIssue, JiraStatus, Priority, StatusCategory

    seeded = JiraIssue(
        id="101",
        key="PROJ-101",
        summary="Webhook test task",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        updated_at="2026-11-01T10:00:00Z",
    )
    main.storage.save_issues([seeded])
    assert main.storage.get_issue("PROJ-101") is not None

    delete_payload = {
        "webhookEvent": "jira:issue_deleted",
        "issue": {
            "id": "101",
            "key": "PROJ-101",
        },
    }

    res = client.post("/api/webhooks/jira", json=delete_payload)
    assert res.status_code == 200
    assert res.json()["status"] == "deleted"
    assert res.json()["issue_key"] == "PROJ-101"

    # Verify deleted from storage
    assert main.storage.get_issue("PROJ-101") is None


def test_jira_webhook_secret_alias_property() -> None:
    """Verify jira_webhook_secret property provides an alias to webhook_secret."""
    from jira_dashboard.config import JiraDashboardSettings

    cfg = JiraDashboardSettings(webhook_secret="token-123")
    assert cfg.jira_webhook_secret == "token-123"
