"""Unit tests for Gemini AI backgrounds configuration."""

from __future__ import annotations

import json
from pathlib import Path

from jira_dashboard.config import JiraDashboardSettings


def test_gemini_config_defaults(monkeypatch) -> None:
    """Verify default Gemini settings when no env or options are set."""
    for var in (
        "GEMINI_API_KEY",
        "GEMINI_MODEL",
        "GEMINI_PROMPT_TEMPLATE",
        "GEMINI_DAILY_LIMIT",
        "GEMINI_DEBOUNCE_SECONDS",
        "GEMINI_CACHE_RETENTION_SECONDS",
    ):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("HA_OPTIONS_PATH", "/nonexistent/options.json")

    settings = JiraDashboardSettings.load()
    assert settings.gemini_api_key is None
    assert settings.gemini_model == "gemini-3.1-flash-lite-image"
    assert "chore" in settings.gemini_prompt_template.lower()
    assert settings.gemini_daily_limit == 100
    assert settings.gemini_debounce_seconds == 300
    assert settings.gemini_cache_retention_seconds == 2592000
    assert isinstance(settings.background_cache_dir, Path)


def test_gemini_config_options_file(tmp_path: Path, monkeypatch) -> None:
    """Verify loading Gemini options from /data/options.json."""
    options_file = tmp_path / "options.json"
    data = {
        "gemini_api_key": "ai-key-secret-123",
        "gemini_model": "custom-model-id",
        "gemini_prompt_template": "Custom prompt {summary}",
        "gemini_daily_limit": 50,
        "gemini_debounce_seconds": 600,
        "gemini_cache_retention_seconds": 86400,
    }
    options_file.write_text(json.dumps(data), encoding="utf-8")

    for var in (
        "GEMINI_API_KEY",
        "GEMINI_MODEL",
        "GEMINI_PROMPT_TEMPLATE",
        "GEMINI_DAILY_LIMIT",
        "GEMINI_DEBOUNCE_SECONDS",
        "GEMINI_CACHE_RETENTION_SECONDS",
    ):
        monkeypatch.delenv(var, raising=False)

    settings = JiraDashboardSettings.load(options_path=options_file)
    assert settings.gemini_api_key == "ai-key-secret-123"
    assert settings.gemini_model == "custom-model-id"
    assert settings.gemini_prompt_template == "Custom prompt {summary}"
    assert settings.gemini_daily_limit == 50
    assert settings.gemini_debounce_seconds == 600
    assert settings.gemini_cache_retention_seconds == 86400


def test_gemini_config_env_overlay(monkeypatch) -> None:
    """Verify environment variables override defaults."""
    monkeypatch.setenv("GEMINI_API_KEY", "env-api-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-test-model")
    monkeypatch.setenv("GEMINI_PROMPT_TEMPLATE", "Env template {summary}")
    monkeypatch.setenv("GEMINI_DAILY_LIMIT", "25")
    monkeypatch.setenv("GEMINI_DEBOUNCE_SECONDS", "120")
    monkeypatch.setenv("GEMINI_CACHE_RETENTION_SECONDS", "7200")
    monkeypatch.setenv("HA_OPTIONS_PATH", "/nonexistent/options.json")

    settings = JiraDashboardSettings.load()
    assert settings.gemini_api_key == "env-api-key"
    assert settings.gemini_model == "gemini-test-model"
    assert settings.gemini_prompt_template == "Env template {summary}"
    assert settings.gemini_daily_limit == 25
    assert settings.gemini_debounce_seconds == 120
    assert settings.gemini_cache_retention_seconds == 7200
