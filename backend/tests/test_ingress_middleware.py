"""Unit tests for DynamicIngressMiddleware."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from jira_dashboard.presentation.main import DynamicIngressMiddleware


def test_ingress_middleware_sets_root_path() -> None:
    """Verify X-Ingress-Path header updates scope['root_path']."""
    test_app = FastAPI()
    test_app.add_middleware(DynamicIngressMiddleware)

    captured_root_path = {}

    @test_app.get("/test-ingress")
    def sample_endpoint(request: Request) -> dict[str, str]:
        captured_root_path["root_path"] = request.scope.get("root_path", "")
        return {"ok": "true"}

    client = TestClient(test_app)

    # 1. Without X-Ingress-Path
    client.get("/test-ingress")
    assert captured_root_path["root_path"] == ""

    # 2. With X-Ingress-Path
    client.get(
        "/test-ingress",
        headers={"X-Ingress-Path": "/api/hassio_ingress/token-abc-123/"},
    )
    assert captured_root_path["root_path"] == "/api/hassio_ingress/token-abc-123"
