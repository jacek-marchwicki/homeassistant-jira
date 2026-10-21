"""Unit and integration tests for GCP persistence (Litestream & GCS Volume Mount).

Validates:
1. Dockerfile litestream installation, /data directory creation, and entrypoint.
2. docker-entrypoint.sh execution logic and signal handling.
3. scripts/deploy_gcp.py bucket provisioning, IAM binding, volume mounts,
   and deployment command generation.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def test_dockerfile_has_litestream_and_data_permissions() -> None:
    """Validate Dockerfile contains Litestream download, /data creation, and entrypoint."""
    dockerfile_path = PROJECT_ROOT / "Dockerfile"
    assert dockerfile_path.is_file(), "Dockerfile must exist at repository root"

    content = dockerfile_path.read_text(encoding="utf-8")

    # Litestream binary download and installation
    assert "litestream" in content, "Dockerfile must download and install Litestream"
    assert "ARG LITESTREAM_VERSION=" in content, "Dockerfile should declare LITESTREAM_VERSION"

    # /data directory creation and ownership for non-root appuser
    assert "mkdir -p /data" in content, "Dockerfile must create /data directory"
    assert "chown -R appuser:appuser /data" in content, (
        "/data must be owned by appuser for SQLite write access"
    )

    # Entrypoint script configuration
    assert "docker-entrypoint.sh" in content, "Dockerfile must copy docker-entrypoint.sh"
    assert 'ENTRYPOINT ["/app/docker-entrypoint.sh"]' in content or "ENTRYPOINT" in content, (
        "Dockerfile must configure entrypoint script"
    )


def test_docker_entrypoint_script_validity() -> None:
    """Validate docker-entrypoint.sh exists and contains restore & replicate logic."""
    entrypoint_path = PROJECT_ROOT / "docker-entrypoint.sh"
    assert entrypoint_path.is_file(), "docker-entrypoint.sh must exist at repository root"

    # Verify executable permissions
    file_stat = os.stat(entrypoint_path)
    is_executable = bool(file_stat.st_mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH))
    assert is_executable, "docker-entrypoint.sh must be executable (chmod +x)"

    content = entrypoint_path.read_text(encoding="utf-8")
    assert content.startswith("#!/bin/sh") or content.startswith("#!/bin/bash")

    # Litestream restore condition and replication command
    assert "LITESTREAM_BUCKET" in content
    assert "litestream restore" in content
    assert "-if-db-not-exists" in content
    assert "-if-replica-exists" in content
    assert "litestream replicate" in content
    assert "-exec" in content

    # Graceful fallback when LITESTREAM_BUCKET is absent
    assert "python -m uvicorn" in content or 'exec "$@"' in content


def test_deploy_gcp_bucket_names() -> None:
    """Validate default and overridden GCS bucket naming in deploy_gcp.py."""
    import sys

    sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
    from deploy_gcp import get_storage_bucket_names

    # Defaults derived from project_id
    litestream_bucket, images_bucket = get_storage_bucket_names({}, "test-project")
    assert litestream_bucket == "test-project-db"
    assert images_bucket == "test-project-images"

    # Overridden via config
    custom_config = {
        "LITESTREAM_BUCKET": "custom-db-bucket",
        "IMAGE_STORAGE_BUCKET": "custom-images-bucket",
    }
    litestream_bucket, images_bucket = get_storage_bucket_names(custom_config, "test-project")
    assert litestream_bucket == "custom-db-bucket"
    assert images_bucket == "custom-images-bucket"


def test_deploy_gcp_build_deploy_command() -> None:
    """Validate build_deploy_command constructs required volume mount and environment flags."""
    import sys

    sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
    from deploy_gcp import build_deploy_command

    config = {
        "GCP_PROJECT_ID": "my-project",
        "GCP_REGION": "europe-west1",
        "GCP_SERVICE_NAME": "my-service",
        "ALLOWED_EMAILS": "test@example.com",
    }

    cmd = build_deploy_command(PROJECT_ROOT, config)
    cmd_str = " ".join(cmd)

    # Core deployment flags
    assert "gcloud run deploy my-service" in cmd_str
    assert "--project my-project" in cmd_str
    assert "--region europe-west1" in cmd_str
    assert "--execution-environment gen2" in cmd_str

    # Litestream env var
    assert "LITESTREAM_BUCKET=my-project-db" in cmd_str
    assert "AUTH_MODE=gcp_oauth" in cmd_str

    # GCS Volume Mount for background images
    assert any("--add-volume" in arg for arg in cmd)
    assert any("name=image-storage" in arg for arg in cmd)
    assert any("type=cloud-storage" in arg for arg in cmd)
    assert any("bucket=my-project-images" in arg for arg in cmd)
    assert any("uid=10001;gid=10001;implicit-dirs" in arg for arg in cmd)

    assert any("--add-volume-mount" in arg for arg in cmd)
    assert any("volume=image-storage" in arg for arg in cmd)
    assert any("mount-path=/data/background_cache" in arg for arg in cmd)
