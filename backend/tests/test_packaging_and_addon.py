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

    # Multi-architecture support
    assert isinstance(config["arch"], list)
    expected_archs = ["aarch64", "amd64", "armhf", "armv7", "i386"]
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
    expected_archs = ["aarch64", "amd64", "armhf", "armv7", "i386"]
    for arch in expected_archs:
        assert arch in build_from
        assert "base-python" in build_from[arch]


def test_addon_dockerfile_contents() -> None:
    """Validate addon/Dockerfile multi-stage structure and Ingress port exposure."""
    dockerfile_path = PROJECT_ROOT / "addon" / "Dockerfile"
    assert dockerfile_path.is_file(), "addon/Dockerfile must exist"

    content = dockerfile_path.read_text(encoding="utf-8")
    assert "FROM node:22-alpine AS frontend-builder" in content
    assert "pnpm build" in content
    assert "ARG BUILD_FROM=" in content
    assert "FROM ${BUILD_FROM} AS runner" in content
    assert "EXPOSE 8000" in content
    assert "HEALTHCHECK" in content
    assert "jira_dashboard.presentation.main:app" in content


def test_root_dockerfile_contents() -> None:
    """Validate root Dockerfile multi-stage structure, non-root user, and healthcheck."""
    dockerfile_path = PROJECT_ROOT / "Dockerfile"
    assert dockerfile_path.is_file(), "Root Dockerfile must exist"

    content = dockerfile_path.read_text(encoding="utf-8")
    assert "FROM node:22-alpine AS frontend-builder" in content
    assert "pnpm build" in content
    assert "FROM python:3.11-alpine AS runner" in content
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
