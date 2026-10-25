"""Unit tests for the GCP deployment script (scripts/deploy_gcp.py)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure scripts directory is in sys.path
SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import deploy_gcp  # noqa: E402


def test_load_env_file_parses_values(tmp_path: Path) -> None:
    """Verify load_env_file correctly extracts key=value pairs, ignoring comments."""
    env_file = tmp_path / ".env.test"
    env_file.write_text(
        """
        # Leading comment
        GCP_PROJECT_ID=my-project-123
        GCP_REGION="europe-west1"
        ALLOWED_EMAILS='user1@gmail.com,user2@gmail.com'
        EMPTY_LINE=
        # Trailing comment
        """,
        encoding="utf-8",
    )

    vals = deploy_gcp.load_env_file(env_file)
    assert vals["GCP_PROJECT_ID"] == "my-project-123"
    assert vals["GCP_REGION"] == "europe-west1"
    assert vals["ALLOWED_EMAILS"] == "user1@gmail.com,user2@gmail.com"
    assert "EMPTY_LINE" not in vals  # empty value ignored


def test_ensure_env_file_missing_exits(tmp_path: Path) -> None:
    """Verify ensure_env_file exits with code 1 if file does not exist."""
    missing = tmp_path / "nonexistent.env"
    with pytest.raises(SystemExit) as exc_info:
        deploy_gcp.ensure_env_file(tmp_path, custom_path=str(missing))
    assert exc_info.value.code == 1


def test_deploy_service_assembles_cloud_run_flags(tmp_path: Path) -> None:
    """Verify deploy_service constructs proper gcloud run deploy command with cost caps."""
    env_file = tmp_path / ".env.gcp"
    env_file.write_text(
        """
        GCP_PROJECT_ID=test-proj
        GCP_REGION=us-central1
        GCP_SERVICE_NAME=my-jira-srv
        ALLOWED_EMAILS=user@example.com
        GOOGLE_CLIENT_ID=client-id
        JIRA_API_TOKEN=token
        """,
        encoding="utf-8",
    )

    with patch("deploy_gcp.run_cmd") as mock_run:
        mock_res = MagicMock()
        mock_res.stdout = "https://my-jira-srv-xyz.a.run.app\n"
        mock_run.return_value = mock_res

        deploy_gcp.deploy_service(tmp_path, env_path=str(env_file), skip_ci=True)

        # Check call to gcloud run deploy
        deploy_calls = [
            call[0][0]
            for call in mock_run.call_args_list
            if len(call[0][0]) >= 3 and call[0][0][0:3] == ["gcloud", "run", "deploy"]
        ]
        assert len(deploy_calls) == 1, "Must execute exactly one 'gcloud run deploy' command"
        deploy_call = deploy_calls[0]
        assert "my-jira-srv" in deploy_call
        assert "--min-instances" in deploy_call
        assert deploy_call[deploy_call.index("--min-instances") + 1] == "0"
        assert "--max-instances" in deploy_call
        assert deploy_call[deploy_call.index("--max-instances") + 1] == "2"
        assert "--cpu-throttling" in deploy_call
        assert "--memory" in deploy_call
        assert deploy_call[deploy_call.index("--memory") + 1] == "512Mi"
        assert "--set-secrets" in deploy_call
        assert not any("--add-volume" in arg for arg in deploy_call)
        assert not any("--execution-environment" in arg for arg in deploy_call)
        assert not any("LITESTREAM" in arg for arg in deploy_call)


def test_build_deploy_command_clean_flags(tmp_path: Path) -> None:
    """Verify build_deploy_command does not include Litestream or FUSE volume mounts."""
    config = {
        "GCP_PROJECT_ID": "my-project",
        "GCP_REGION": "europe-west1",
        "GCP_SERVICE_NAME": "my-service",
        "ALLOWED_EMAILS": "test@example.com",
    }
    cmd = deploy_gcp.build_deploy_command(tmp_path, config)
    cmd_str = " ".join(cmd)

    assert "gcloud run deploy my-service" in cmd_str
    assert "--project my-project" in cmd_str
    assert "--region europe-west1" in cmd_str
    assert "--set-env-vars AUTH_MODE=gcp_oauth" in cmd_str
    assert "--execution-environment" not in cmd_str
    assert "--add-volume" not in cmd_str
    assert "--add-volume-mount" not in cmd_str
    assert "LITESTREAM" not in cmd_str


def test_dockerfile_clean_of_litestream_and_entrypoint() -> None:
    """Validate Dockerfile does not include Litestream or docker-entrypoint.sh."""
    project_root = SCRIPTS_DIR.parent
    dockerfile_path = project_root / "Dockerfile"
    assert dockerfile_path.is_file(), "Dockerfile must exist at repository root"
    content = dockerfile_path.read_text(encoding="utf-8")

    assert "litestream" not in content.lower()
    assert "docker-entrypoint" not in content
    assert "ENTRYPOINT" not in content
    assert not (project_root / "docker-entrypoint.sh").exists()
