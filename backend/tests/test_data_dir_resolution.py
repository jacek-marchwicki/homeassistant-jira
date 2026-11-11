"""Unit tests for unified DATA_DIR environment variable and deterministic path resolution.

Tests HOME-15483 requirements:
1. Explicit DATA_DIR environment variable takes highest priority.
2. Active Home Assistant Environment (/data) only if SUPERVISOR_TOKEN or options.json
   exists AND /data is writable.
3. Local Development fallback (./data via ensure_local_data_dir).
4. JiraDashboardSettings default_factory, effective_sqlite_db_path, and background_cache_dir.
5. SQLiteStorage deterministic initialization without brittle OSError handling.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.config import (
    JiraDashboardSettings,
    resolve_data_dir,
)


def test_resolve_data_dir_explicit_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Explicit DATA_DIR environment variable is the single source of truth."""
    custom_dir = tmp_path / "custom_data"
    monkeypatch.setenv("DATA_DIR", str(custom_dir))
    monkeypatch.delenv("SUPERVISOR_TOKEN", raising=False)

    resolved = resolve_data_dir()
    assert resolved == custom_dir.resolve()
    assert resolved.is_dir()
    assert (resolved / "background_cache").is_dir()


def test_resolve_data_dir_ha_environment_writable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When in HA environment (SUPERVISOR_TOKEN set) and /data is writable, resolves to /data."""
    fake_ha_data = tmp_path / "data"
    fake_ha_data.mkdir()

    monkeypatch.delenv("DATA_DIR", raising=False)
    monkeypatch.setenv("SUPERVISOR_TOKEN", "mock-supervisor-token")

    with patch("jira_dashboard.config.Path") as mock_path_cls:
        # We patch Path("/data") to return our fake writable directory
        real_path = Path

        def side_effect(arg, *args, **kwargs):
            if str(arg) == "/data":
                return fake_ha_data
            if str(arg) == "/data/options.json":
                return fake_ha_data / "options.json"
            return real_path(arg, *args, **kwargs)

        mock_path_cls.side_effect = side_effect
        mock_path_cls.cwd = real_path.cwd

        resolved = resolve_data_dir()
        assert resolved == fake_ha_data
        assert (fake_ha_data / "background_cache").is_dir()


def test_resolve_data_dir_ha_environment_not_writable_falls_back_to_local(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When SUPERVISOR_TOKEN is set but /data is not writable (e.g. Termux), falls back to local."""
    monkeypatch.delenv("DATA_DIR", raising=False)
    monkeypatch.setenv("SUPERVISOR_TOKEN", "mock-supervisor-token")

    local_dev = tmp_path / "local_repo"
    local_dev.mkdir()

    # Simulate /data not being writable
    with (
        patch("jira_dashboard.config._is_writable_directory", return_value=False),
        patch("jira_dashboard.config.Path.is_file", return_value=False),
    ):
        resolved = resolve_data_dir(base_dir=local_dev)
        assert resolved == (local_dev / "data").resolve()
        assert resolved.is_dir()


def test_resolve_data_dir_local_dev_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When no DATA_DIR and no HA environment, falls back to ensure_local_data_dir."""
    monkeypatch.delenv("DATA_DIR", raising=False)
    monkeypatch.delenv("SUPERVISOR_TOKEN", raising=False)

    local_dev = tmp_path / "my_project"
    local_dev.mkdir()

    with patch("jira_dashboard.config.Path.is_file", return_value=False):
        resolved = resolve_data_dir(base_dir=local_dev)
        assert resolved == (local_dev / "data").resolve()
        assert resolved.is_dir()
        assert (resolved / "background_cache").is_dir()


def test_settings_data_dir_default_factory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """JiraDashboardSettings data_dir defaults using default_factory=resolve_data_dir."""
    custom_dir = tmp_path / "settings_data"
    monkeypatch.setenv("DATA_DIR", str(custom_dir))

    settings = JiraDashboardSettings()
    assert settings.data_dir == custom_dir.resolve()
    assert settings.effective_sqlite_db_path == (custom_dir / "jira_dashboard.sqlite3").resolve()
    assert settings.background_cache_dir == (custom_dir / "background_cache").resolve()


def test_settings_effective_sqlite_db_path_explicit_custom(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Custom sqlite_db_path (absolute, relative, or memory) is correctly resolved."""
    custom_dir = tmp_path / "settings_data"
    monkeypatch.setenv("DATA_DIR", str(custom_dir))

    # Absolute path
    abs_db = tmp_path / "other" / "custom.db"
    s1 = JiraDashboardSettings(sqlite_db_path=abs_db)
    assert s1.effective_sqlite_db_path == abs_db

    # In-memory
    s2 = JiraDashboardSettings(sqlite_db_path=":memory:")
    assert s2.effective_sqlite_db_path == ":memory:"

    # Relative path
    s3 = JiraDashboardSettings(sqlite_db_path="relative.sqlite3")
    assert s3.effective_sqlite_db_path == (custom_dir / "relative.sqlite3").resolve()


def test_settings_load_with_data_dir_options_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """DATA_DIR acts as single source of truth for options.json when HA_OPTIONS_PATH not set."""
    custom_dir = tmp_path / "unified_data"
    custom_dir.mkdir()
    options_file = custom_dir / "options.json"
    options_file.write_text(
        json.dumps(
            {
                "jira_url": "https://data-dir-options.atlassian.net",
                "jira_board_id": "unified-1",
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("DATA_DIR", str(custom_dir))
    monkeypatch.delenv("HA_OPTIONS_PATH", raising=False)
    monkeypatch.delenv("JIRA_URL", raising=False)
    monkeypatch.delenv("JIRA_BOARD_ID", raising=False)

    settings = JiraDashboardSettings.load()
    assert settings.data_dir == custom_dir.resolve()
    assert settings.jira_url == "https://data-dir-options.atlassian.net"
    assert settings.jira_board_id == "unified-1"


def test_sqlite_storage_deterministic_init(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """SQLiteStorage resolves paths deterministically without brittle OSError handling."""
    custom_dir = tmp_path / "storage_data"
    monkeypatch.setenv("DATA_DIR", str(custom_dir))

    # None / Default path
    s_default = SQLiteStorage()
    assert s_default.db_path == str((custom_dir / "jira_dashboard.sqlite3").resolve())
    assert (custom_dir / "jira_dashboard.sqlite3").parent.is_dir()

    # Relative path
    s_rel = SQLiteStorage("custom.sqlite3")
    assert s_rel.db_path == str((custom_dir / "custom.sqlite3").resolve())

    # In-memory
    s_mem = SQLiteStorage(":memory:")
    assert s_mem.db_path == ":memory:"

    # Absolute path
    abs_path = tmp_path / "direct" / "db.sqlite3"
    s_abs = SQLiteStorage(abs_path)
    assert s_abs.db_path == str(abs_path.resolve())
    assert abs_path.parent.is_dir()
