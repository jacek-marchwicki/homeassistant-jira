"""Unit tests for configuration loader."""

from __future__ import annotations

import json
from pathlib import Path

from jira_dashboard.config import JiraDashboardSettings


def test_default_config_empty(monkeypatch) -> None:
    """Verify default configuration values when no file or env vars are set."""
    monkeypatch.delenv("JIRA_URL", raising=False)
    monkeypatch.delenv("JIRA_EMAIL", raising=False)
    monkeypatch.delenv("JIRA_API_TOKEN", raising=False)
    monkeypatch.delenv("JIRA_PAT", raising=False)
    monkeypatch.delenv("JIRA_BOARD_ID", raising=False)
    monkeypatch.delenv("JIRA_WEBHOOK_SECRET", raising=False)
    monkeypatch.delenv("POLLING_INTERVAL_SECONDS", raising=False)
    monkeypatch.setenv("HA_OPTIONS_PATH", "/nonexistent/options.json")

    settings = JiraDashboardSettings.load()
    assert settings.jira_url is None
    assert settings.has_jira_credentials is False
    assert settings.jira_board_id == "engineering-1"
    assert settings.polling_interval_seconds == 60


def test_load_from_options_file(tmp_path: Path, monkeypatch) -> None:
    """Verify loading from Home Assistant /data/options.json file."""
    options_file = tmp_path / "options.json"
    data = {
        "jira_url": "https://example.atlassian.net",
        "jira_email": "ha-user@example.com",
        "jira_api_token": "secret-token-123",
        "jira_board_id": "board-42",
        "polling_interval_seconds": 120,
    }
    options_file.write_text(json.dumps(data), encoding="utf-8")

    monkeypatch.delenv("JIRA_URL", raising=False)
    monkeypatch.delenv("JIRA_EMAIL", raising=False)
    monkeypatch.delenv("JIRA_API_TOKEN", raising=False)

    settings = JiraDashboardSettings.load(options_path=options_file)
    assert settings.jira_url == "https://example.atlassian.net"
    assert settings.jira_email == "ha-user@example.com"
    assert settings.jira_api_token == "secret-token-123"
    assert settings.jira_board_id == "board-42"
    assert settings.polling_interval_seconds == 120
    assert settings.has_jira_credentials is True


def test_env_var_overlay(monkeypatch) -> None:
    """Verify environment variables take precedence over defaults."""
    monkeypatch.setenv("JIRA_URL", "https://env.atlassian.net")
    monkeypatch.setenv("JIRA_PAT", "pat-bearer-token")
    monkeypatch.setenv("JIRA_BOARD_ID", "sprint-board-99")
    monkeypatch.setenv("JIRA_WEBHOOK_SECRET", "super-secret-wh")
    monkeypatch.setenv("POLLING_INTERVAL_SECONDS", "30")
    monkeypatch.setenv("HA_OPTIONS_PATH", "/nonexistent/options.json")

    settings = JiraDashboardSettings.load()
    assert settings.jira_url == "https://env.atlassian.net"
    assert settings.jira_personal_access_token == "pat-bearer-token"
    assert settings.jira_board_id == "sprint-board-99"
    assert settings.webhook_secret == "super-secret-wh"
    assert settings.polling_interval_seconds == 30
    assert settings.has_jira_credentials is True
