"""Tests for Home Assistant Add-on packaging, Docker containers, and Ingress configuration.

Validates that container definitions (addon/config.yaml, addon/build.yaml, addon/Dockerfile,
root Dockerfile, docker-compose.yml, docker-compose.dev.yml, .env.example, .dockerignore)
are syntactically valid, complete, and aligned with Home Assistant and standalone standards.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from jira_dashboard.config import JiraDashboardSettings
from jira_dashboard.presentation.main import DynamicIngressMiddleware, app

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


def test_addon_config_yaml_is_valid_and_complete() -> None:
    """Validate addon/config.yaml structure, required metadata, and schema alignment."""
    config_path = PROJECT_ROOT / "addon" / "config.yaml"
    assert config_path.is_file(), "addon/config.yaml must exist"

    with open(config_path, encoding="utf-8") as f:
        config = yaml.safe_load(f)

    # Required Home Assistant Add-on top-level metadata
    assert config["name"] == "Jira Dashboard"
    assert config["version"] == "0.1.0"
    assert config["slug"] == "jira_dashboard"
    assert "description" in config and len(config["description"]) > 10
    assert config["url"] == "https://github.com/jacek-marchwicki/homeassistant-jira"
    assert config["image"] == "ghcr.io/jacek-marchwicki/homeassistant-jira-{arch}"
    assert "{arch}" in config["image"]

    # Multi-architecture support (modern 64-bit Home Assistant platforms)
    assert isinstance(config["arch"], list)
    expected_archs = ["aarch64", "amd64"]
    for arch in expected_archs:
        assert arch in config["arch"], f"Architecture {arch} must be supported"

    # Ingress & Startup configuration
    assert config["startup"] == "services"
    assert config["boot"] == "auto"
    assert config["ingress"] is True
    assert config["ingress_port"] == 8000
    assert config["panel_icon"] == "mdi:jira"
    assert config["panel_title"] == "Jira"

    # Options & Schema alignment
    options = config.get("options", {})
    schema = config.get("schema", {})
    assert "jira_url" in options and "jira_url" in schema
    assert "jira_email" in options and "jira_email" in schema
    assert "jira_api_token" in options and "jira_api_token" in schema
    assert "jira_pat" in options and "jira_pat" in schema
    assert "jira_board_id" in options and "jira_board_id" in schema
    assert "polling_interval_seconds" in options and "polling_interval_seconds" in schema
    assert "jira_jql" in options and "jira_jql" in schema


def test_addon_build_yaml_is_valid() -> None:
    """Validate addon/build.yaml multi-architecture base image mappings."""
    build_path = PROJECT_ROOT / "addon" / "build.yaml"
    assert build_path.is_file(), "addon/build.yaml must exist"

    with open(build_path, encoding="utf-8") as f:
        build_cfg = yaml.safe_load(f)

    assert "build_from" in build_cfg
    build_from = build_cfg["build_from"]
    expected_archs = ["aarch64", "amd64"]
    for arch in expected_archs:
        assert arch in build_from
        assert build_from[arch] == "python:3.11-alpine"


def test_addon_dockerfile_contents() -> None:
    """Validate addon/Dockerfile multi-stage structure, local copying, and Ingress port exposure."""
    dockerfile_path = PROJECT_ROOT / "addon" / "Dockerfile"
    assert dockerfile_path.is_file(), "addon/Dockerfile must exist"

    content = dockerfile_path.read_text(encoding="utf-8")
    assert "FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder" in content
    assert "pnpm build" in content
    assert "ARG BUILD_FROM=" in content
    assert "FROM ${BUILD_FROM} AS runner" in content
    assert "EXPOSE 8000" in content
    assert "HEALTHCHECK" in content
    assert "jira_dashboard.presentation.main:app" in content

    # Verify building from local source files without git repository dependency
    assert "COPY frontend/package.json" in content
    assert "COPY backend/ ./backend/" in content
    assert "git clone" not in content

    # Verify ARG BUILD_FROM appears before any FROM instruction for BuildKit compliance
    build_from_pos = content.find("ARG BUILD_FROM")
    first_from_pos = content.find("FROM ")
    assert build_from_pos != -1, "ARG BUILD_FROM must be declared"
    assert build_from_pos < first_from_pos, (
        "ARG BUILD_FROM must precede the first FROM instruction for Docker BuildKit"
    )


def test_root_dockerfile_contents() -> None:
    """Validate root Dockerfile multi-stage structure, copying, non-root user, and healthcheck."""
    dockerfile_path = PROJECT_ROOT / "Dockerfile"
    assert dockerfile_path.is_file(), "Root Dockerfile must exist"

    content = dockerfile_path.read_text(encoding="utf-8")
    assert "FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder" in content
    assert "pnpm build" in content
    assert "FROM python:3.11-alpine AS runner" in content
    assert "COPY backend/ ./backend/" in content
    assert "git clone" not in content
    assert "adduser" in content and "appuser" in content
    assert "USER appuser" in content
    assert "EXPOSE 8000" in content
    assert "HEALTHCHECK" in content
    assert "jira_dashboard.presentation.main:app" in content


def test_docker_compose_configurations() -> None:
    """Validate standalone and dev docker-compose.yml configurations."""
    compose_path = PROJECT_ROOT / "docker-compose.yml"
    assert compose_path.is_file(), "docker-compose.yml must exist"

    with open(compose_path, encoding="utf-8") as f:
        compose = yaml.safe_load(f)

    assert "services" in compose
    assert "jira-dashboard" in compose["services"]
    service = compose["services"]["jira-dashboard"]
    assert "${PORT:-8000}:8000" in service["ports"]
    assert "healthcheck" in service

    # Dev compose
    dev_compose_path = PROJECT_ROOT / "docker-compose.dev.yml"
    assert dev_compose_path.is_file(), "docker-compose.dev.yml must exist"

    with open(dev_compose_path, encoding="utf-8") as f:
        dev_compose = yaml.safe_load(f)

    assert "services" in dev_compose
    assert "jira-dashboard-dev" in dev_compose["services"]
    dev_service = dev_compose["services"]["jira-dashboard-dev"]
    assert "${PORT:-8000}:8000" in dev_service["ports"]
    assert "volumes" in dev_service


def test_env_example_and_dockerignore() -> None:
    """Validate .env.example template and .dockerignore file rules."""
    env_example = PROJECT_ROOT / ".env.example"
    assert env_example.is_file(), ".env.example must exist"
    env_content = env_example.read_text(encoding="utf-8")
    assert "JIRA_URL=" in env_content
    assert "JIRA_EMAIL=" in env_content
    assert "JIRA_API_TOKEN=" in env_content
    assert "JIRA_BOARD_ID=" in env_content
    assert "POLLING_INTERVAL_SECONDS=" in env_content

    dockerignore = PROJECT_ROOT / ".dockerignore"
    assert dockerignore.is_file(), ".dockerignore must exist"
    ignore_content = dockerignore.read_text(encoding="utf-8")
    assert "node_modules" in ignore_content
    assert ".git" in ignore_content
    assert "__pycache__" in ignore_content


def test_health_endpoints() -> None:
    """Validate /health and /api/health return HTTP 200 with ok status."""
    client = TestClient(app)

    res_root = client.get("/health")
    assert res_root.status_code == 200
    assert res_root.json()["status"] == "ok"
    assert res_root.json()["app"] == "homeassistant-jira"

    res_api = client.get("/api/health")
    assert res_api.status_code == 200
    assert res_api.json()["status"] == "ok"
    assert res_api.json()["app"] == "homeassistant-jira"


def test_dynamic_ingress_middleware() -> None:
    """Validate ASGI DynamicIngressMiddleware strips trailing slashes and updates root_path."""

    async def run_checks() -> None:
        captured_root_path: list[str] = []

        async def mock_app(scope, receive, send):
            captured_root_path.append(scope.get("root_path", ""))

        middleware = DynamicIngressMiddleware(mock_app)

        # 1. Request with X-Ingress-Path containing trailing slash
        scope1 = {
            "type": "http",
            "headers": [(b"x-ingress-path", b"/api/hassio_ingress/token123/")],
            "root_path": "",
        }
        await middleware(scope1, None, None)
        assert captured_root_path[-1] == "/api/hassio_ingress/token123"

        # 2. Request with X-Ingress-Path without trailing slash
        scope2 = {
            "type": "http",
            "headers": [(b"x-ingress-path", b"/api/hassio_ingress/token456")],
            "root_path": "",
        }
        await middleware(scope2, None, None)
        assert captured_root_path[-1] == "/api/hassio_ingress/token456"

        # 3. Request without X-Ingress-Path retains original root_path
        scope3 = {
            "type": "http",
            "headers": [],
            "root_path": "/default",
        }
        await middleware(scope3, None, None)
        assert captured_root_path[-1] == "/default"

    asyncio.run(run_checks())


def test_home_assistant_options_file_loading(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Validate loading settings from simulated Home Assistant /data/options.json file."""
    # Clear environment variables that might override options file
    for env_var in [
        "JIRA_URL",
        "JIRA_EMAIL",
        "JIRA_API_TOKEN",
        "JIRA_PAT",
        "JIRA_BOARD_ID",
        "JIRA_JQL",
        "POLLING_INTERVAL_SECONDS",
    ]:
        monkeypatch.delenv(env_var, raising=False)

    options_file = tmp_path / "options.json"
    options_data = {
        "jira_url": "https://ha-instance.atlassian.net",
        "jira_email": "ha-admin@example.com",
        "jira_api_token": "secret-token-12345",
        "jira_board_id": "ha-board-99",
        "polling_interval_seconds": 45,
        "jira_jql": "project = HA",
    }
    options_file.write_text(json.dumps(options_data), encoding="utf-8")

    loaded_settings = JiraDashboardSettings.load(options_path=options_file)
    assert loaded_settings.jira_url == "https://ha-instance.atlassian.net"
    assert loaded_settings.jira_email == "ha-admin@example.com"
    assert loaded_settings.jira_api_token == "secret-token-12345"
    assert loaded_settings.jira_board_id == "ha-board-99"
    assert loaded_settings.polling_interval_seconds == 45
    assert loaded_settings.jira_jql == "project = HA"
    assert loaded_settings.has_jira_credentials is True

    # Validate mapping of jira_pat from options.json
    pat_options_file = tmp_path / "pat_options.json"
    pat_options_data = {
        "jira_url": "https://ha-datacenter.internal",
        "jira_pat": "my-personal-access-token-999",
        "jira_board_id": "dc-board-1",
    }
    pat_options_file.write_text(json.dumps(pat_options_data), encoding="utf-8")
    pat_settings = JiraDashboardSettings.load(options_path=pat_options_file)
    assert pat_settings.jira_url == "https://ha-datacenter.internal"
    assert pat_settings.jira_personal_access_token == "my-personal-access-token-999"
    assert pat_settings.has_jira_credentials is True


def test_repository_yaml_is_valid() -> None:
    """Validate repository.yaml exists and contains required HA Add-on repository keys."""
    repo_yaml_path = PROJECT_ROOT / "repository.yaml"
    assert repo_yaml_path.is_file(), "repository.yaml must exist at the project root"

    with open(repo_yaml_path, encoding="utf-8") as f:
        repo_data = yaml.safe_load(f)

    assert isinstance(repo_data, dict)
    assert "name" in repo_data and len(repo_data["name"]) > 0
    assert "url" in repo_data and repo_data["url"].startswith("http")
    assert "maintainer" in repo_data and "@" in repo_data["maintainer"]


def test_addon_documentation_and_assets() -> None:
    """Validate addon/DOCS.md, addon/CHANGELOG.md, addon/icon.png, and addon/logo.png exist."""
    addon_dir = PROJECT_ROOT / "addon"

    docs_file = addon_dir / "DOCS.md"
    assert docs_file.is_file(), "addon/DOCS.md must exist for Home Assistant UI documentation tab"
    docs_text = docs_file.read_text(encoding="utf-8")
    assert "Home Assistant Ingress" in docs_text
    assert "Configuration" in docs_text

    changelog_file = addon_dir / "CHANGELOG.md"
    assert changelog_file.is_file(), "addon/CHANGELOG.md must exist"
    changelog_text = changelog_file.read_text(encoding="utf-8")
    assert "0.1.0" in changelog_text

    icon_file = addon_dir / "icon.png"
    assert icon_file.is_file(), "addon/icon.png must exist for Add-on store icon"
    assert icon_file.stat().st_size > 0

    logo_file = addon_dir / "logo.png"
    assert logo_file.is_file(), "addon/logo.png must exist for Add-on store banner/logo"
    assert logo_file.stat().st_size > 0


def test_publish_images_workflow_is_valid() -> None:
    """Validate .github/workflows/publish-images.yml structure and multi-arch packaging targets."""
    workflow_path = PROJECT_ROOT / ".github" / "workflows" / "publish-images.yml"
    assert workflow_path.is_file(), "publish-images.yml workflow must exist"

    with open(workflow_path, encoding="utf-8") as f:
        workflow = yaml.safe_load(f)

    assert "jobs" in workflow
    jobs = workflow["jobs"]
    assert "build-addon-images" in jobs
    assert "build-standalone-image" in jobs

    # Validate add-on matrix architectures cover all supported platforms
    addon_job = jobs["build-addon-images"]
    matrix = addon_job["strategy"]["matrix"]["include"]
    matrix_archs = [entry["arch"] for entry in matrix]
    for required_arch in ["aarch64", "amd64"]:
        assert required_arch in matrix_archs

    # Verify GHCR registry references and permissions
    assert addon_job["permissions"]["packages"] == "write"
    assert jobs["build-standalone-image"]["permissions"]["packages"] == "write"


def test_docker_base_images_exist_and_are_resolvable() -> None:
    """Ensure all base images in build.yaml and publish-images.yml exist and resolve."""
    import shutil
    import subprocess

    build_path = PROJECT_ROOT / "addon" / "build.yaml"
    with open(build_path, encoding="utf-8") as f:
        build_cfg = yaml.safe_load(f)

    build_from_images = list(build_cfg.get("build_from", {}).values())

    workflow_path = PROJECT_ROOT / ".github" / "workflows" / "publish-images.yml"
    with open(workflow_path, encoding="utf-8") as f:
        workflow = yaml.safe_load(f)

    matrix = (
        workflow.get("jobs", {})
        .get("build-addon-images", {})
        .get("strategy", {})
        .get("matrix", {})
        .get("include", [])
    )
    workflow_base_images = [entry.get("base") for entry in matrix if "base" in entry]

    all_base_images = set(build_from_images + workflow_base_images)

    # Base images must not use deprecated, removed ghcr.io/home-assistant/*-base-python images
    for image in all_base_images:
        assert "ghcr.io/home-assistant/" not in image or "base-python:" not in image, (
            f"Image '{image}' uses deprecated or non-existent Home Assistant base-python image. "
            "Use official multi-arch python:3.11-alpine instead."
        )

    # If docker is available, verify every base image manifest resolves on the registry
    docker_bin = shutil.which("docker")
    if docker_bin:
        for image in all_base_images:
            res = subprocess.run(
                [docker_bin, "manifest", "inspect", image],
                capture_output=True,
                text=True,
                check=False,
            )
            assert res.returncode == 0, (
                f"Docker failed to resolve base image metadata for '{image}':\n"
                f"STDOUT: {res.stdout}\nSTDERR: {res.stderr}"
            )
