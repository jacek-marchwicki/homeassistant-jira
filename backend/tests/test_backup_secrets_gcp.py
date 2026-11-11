"""Unit tests for the GCP secrets backup & restore script (scripts/backup_secrets_gcp.py)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure scripts directory is in sys.path
SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import backup_secrets_gcp  # noqa: E402


def test_resolve_project_id_from_cli() -> None:
    """Explicit --project argument takes precedence over any file."""
    config = {"GCP_PROJECT_ID": "file-project"}
    project_id = backup_secrets_gcp.resolve_project_id(cli_project="cli-project-123", config=config)
    assert project_id == "cli-project-123"


def test_resolve_project_id_from_config() -> None:
    """Falls back to .env.gcp GCP_PROJECT_ID when CLI flag is not provided."""
    config = {"GCP_PROJECT_ID": "file-project-456"}
    project_id = backup_secrets_gcp.resolve_project_id(cli_project=None, config=config)
    assert project_id == "file-project-456"


def test_resolve_project_id_missing_exits_without_gcloud_fallback(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Fails immediately if no project ID is configured, without falling back to gcloud config."""
    with pytest.raises(SystemExit) as exc_info:
        backup_secrets_gcp.resolve_project_id(cli_project=None, config={})
    assert exc_info.value.code == 1
    captured = capsys.readouterr()
    assert (
        "GCP Project ID is required" in captured.out or "GCP Project ID is required" in captured.err
    )


def test_get_secret_specs_default_prefix() -> None:
    """Verifies default secret specifications mapping relative paths to secret IDs."""
    specs = backup_secrets_gcp.get_secret_specs(prefix="ha-jira-backup-")
    ids = {spec.secret_id: spec.relative_path for spec in specs}
    assert len(specs) == 3
    assert ids["ha-jira-backup-env-gcp"] == Path(".env.gcp")
    assert ids["ha-jira-backup-android-keystore-properties"] == Path("android/keystore.properties")
    assert ids["ha-jira-backup-android-release-jks"] == Path("android/app/release.jks")
    assert "ha-jira-backup-env" not in ids
    assert "ha-jira-backup-secrets-yaml" not in ids
    assert "ha-jira-backup-options-json" not in ids


def test_backup_creates_and_uploads_existing_files(tmp_path: Path) -> None:
    """Verifies backup uploads existing files and creates secrets in GCP Secret Manager."""
    # Create test files
    env_file = tmp_path / ".env.gcp"
    env_file.write_text("GCP_PROJECT_ID=test-proj\nSECRET=123", encoding="utf-8")
    jks_file = tmp_path / "android" / "app" / "release.jks"
    jks_file.parent.mkdir(parents=True)
    jks_file.write_bytes(b"\xfe\xed\xfe\xedBINARYDATA")

    with patch("backup_secrets_gcp.run_cmd") as mock_run:
        # Simulate secret doesn't exist on GCP initially
        def side_effect(cmd: list[str], **kwargs: object) -> MagicMock:
            res = MagicMock()
            if "describe" in cmd:
                import subprocess

                raise subprocess.CalledProcessError(1, cmd, stderr="NOT_FOUND")
            res.stdout = "OK"
            return res

        mock_run.side_effect = side_effect

        backup_secrets_gcp.execute_backup(
            repo_root=tmp_path,
            project_id="test-proj",
            prefix="ha-jira-backup-",
            dry_run=False,
        )

        # Check create and versions add were called
        calls = [c[0][0] for c in mock_run.call_args_list]
        describe_calls = [
            c for c in calls if len(c) > 2 and c[1] == "secrets" and c[2] == "describe"
        ]
        assert len(describe_calls) == 2

        created_secrets = [
            c[3] for c in calls if len(c) > 3 and c[1] == "secrets" and c[2] == "create"
        ]
        assert "ha-jira-backup-env-gcp" in created_secrets
        assert "ha-jira-backup-android-release-jks" in created_secrets

        version_adds = [
            c
            for c in calls
            if len(c) > 3 and c[1] == "secrets" and c[2] == "versions" and c[3] == "add"
        ]
        assert len(version_adds) >= 2


def test_backup_dry_run_does_not_mutate(tmp_path: Path) -> None:
    """Dry run should inspect local files without executing GCP mutation commands."""
    env_file = tmp_path / ".env.gcp"
    env_file.write_text("GCP_PROJECT_ID=test-proj\n", encoding="utf-8")

    with patch("backup_secrets_gcp.run_cmd") as mock_run:
        backup_secrets_gcp.execute_backup(
            repo_root=tmp_path,
            project_id="test-proj",
            prefix="ha-jira-backup-",
            dry_run=True,
        )
        assert mock_run.call_count == 0


def test_restore_writes_secret_payloads(tmp_path: Path) -> None:
    """Verifies restore downloads secret versions and writes them to the repo."""
    with patch("backup_secrets_gcp.run_cmd_bytes") as mock_run_bytes:
        mock_res = MagicMock()
        mock_res.stdout = b"GCP_PROJECT_ID=restored-proj\n"
        mock_run_bytes.return_value = mock_res

        backup_secrets_gcp.execute_restore(
            repo_root=tmp_path,
            project_id="test-proj",
            prefix="ha-jira-backup-",
            force=True,
            dry_run=False,
        )

        restored_file = tmp_path / ".env.gcp"
        assert restored_file.is_file()
        assert restored_file.read_text(encoding="utf-8") == "GCP_PROJECT_ID=restored-proj\n"


def test_restore_skips_existing_files_when_not_forced(tmp_path: Path) -> None:
    """Restore preserves existing local files when force=False."""
    existing_file = tmp_path / ".env.gcp"
    existing_file.write_text("ORIGINAL_CONTENT", encoding="utf-8")

    with patch("backup_secrets_gcp.run_cmd_bytes") as mock_run_bytes:
        mock_res = MagicMock()
        mock_res.stdout = b"NEW_REMOTE_CONTENT"
        mock_run_bytes.return_value = mock_res

        backup_secrets_gcp.execute_restore(
            repo_root=tmp_path,
            project_id="test-proj",
            prefix="ha-jira-backup-",
            force=False,
            dry_run=False,
        )

        assert existing_file.read_text(encoding="utf-8") == "ORIGINAL_CONTENT"


def test_restore_mirrors_keystore_properties(tmp_path: Path) -> None:
    """Restoring android/keystore.properties also updates android/app/keystore.properties."""
    with patch("backup_secrets_gcp.run_cmd_bytes") as mock_run_bytes:

        def side_effect(cmd: list[str], **kwargs: object) -> MagicMock:
            res = MagicMock()
            if any("ha-jira-backup-android-keystore-properties" in arg for arg in cmd):
                res.stdout = b"storePassword=pass123\nkeyAlias=myalias\n"
                return res
            import subprocess

            raise subprocess.CalledProcessError(1, cmd, stderr="NOT_FOUND")

        mock_run_bytes.side_effect = side_effect

        backup_secrets_gcp.execute_restore(
            repo_root=tmp_path,
            project_id="test-proj",
            prefix="ha-jira-backup-",
            force=True,
            dry_run=False,
        )

        root_prop = tmp_path / "android" / "keystore.properties"
        app_prop = tmp_path / "android" / "app" / "keystore.properties"
        assert root_prop.is_file()
        assert app_prop.is_file()
        assert root_prop.read_text(encoding="utf-8") == "storePassword=pass123\nkeyAlias=myalias\n"
        assert app_prop.read_text(encoding="utf-8") == "storePassword=pass123\nkeyAlias=myalias\n"


def test_status_reports_local_and_remote(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Status command checks local file status and GCP Secret Manager status."""
    env_file = tmp_path / ".env.gcp"
    env_file.write_text("GCP_PROJECT_ID=test-proj", encoding="utf-8")

    with patch("backup_secrets_gcp.run_cmd") as mock_run:
        mock_res = MagicMock()
        mock_res.stdout = "createTime: '2026-11-01T10:00:00Z'\n"
        mock_run.return_value = mock_res

        backup_secrets_gcp.execute_status(
            repo_root=tmp_path,
            project_id="test-proj",
            prefix="ha-jira-backup-",
        )

        captured = capsys.readouterr()
        assert ".env.gcp" in captured.out
        assert "ha-jira-backup-env-gcp" in captured.out
