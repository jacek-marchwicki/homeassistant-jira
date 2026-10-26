"""Tests for the single-page-app static file fallback."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope

from jira_dashboard.presentation.main import SPAStaticFiles


def _scope(path: str) -> Scope:
    return {"type": "http", "method": "GET", "path": path, "headers": []}


def test_deep_link_falls_back_to_index_html(tmp_path: Path) -> None:
    """Unknown client routes such as /task/HOME-1 serve index.html."""
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "asset.js").write_text("console.log(1)")
    files = SPAStaticFiles(directory=str(tmp_path), html=True)

    async def run() -> tuple[int, int, int]:
        deep = await files.get_response("task/HOME-1", _scope("/task/HOME-1"))
        asset = await files.get_response("asset.js", _scope("/asset.js"))
        root = await files.get_response("", _scope("/"))
        return deep.status_code, asset.status_code, root.status_code

    assert asyncio.run(run()) == (200, 200, 200)


def test_cache_control_headers(tmp_path: Path) -> None:
    """HTML and sw.js require revalidation (no-cache); immutable assets are cached."""
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "sw.js").write_text("// sw")
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    (assets_dir / "bundle-123.js").write_text("console.log('bundle')")
    (tmp_path / "favicon.svg").write_text("<svg></svg>")

    files = SPAStaticFiles(directory=str(tmp_path), html=True)

    async def run() -> dict[str, str | None]:
        dot_resp = await files.get_response(".", _scope("/"))
        root_resp = await files.get_response("", _scope("/"))
        deep_resp = await files.get_response("task/HOME-1", _scope("/task/HOME-1"))
        sw_resp = await files.get_response("sw.js", _scope("/sw.js"))
        asset_resp = await files.get_response(
            "assets/bundle-123.js", _scope("/assets/bundle-123.js")
        )
        icon_resp = await files.get_response("favicon.svg", _scope("/favicon.svg"))

        return {
            "dot": dot_resp.headers.get("Cache-Control"),
            "root": root_resp.headers.get("Cache-Control"),
            "deep": deep_resp.headers.get("Cache-Control"),
            "sw": sw_resp.headers.get("Cache-Control"),
            "asset": asset_resp.headers.get("Cache-Control"),
            "icon": icon_resp.headers.get("Cache-Control"),
        }

    headers = asyncio.run(run())

    assert headers["dot"] == "no-cache, must-revalidate"
    assert headers["root"] == "no-cache, must-revalidate"
    assert headers["deep"] == "no-cache, must-revalidate"
    assert headers["sw"] == "no-cache, must-revalidate"
    assert headers["asset"] == "public, max-age=31536000, immutable"
    assert headers["icon"] == "public, max-age=86400"


def test_missing_assets_do_not_fallback_to_index_html(tmp_path: Path) -> None:
    """Missing assets under assets/ or with file extensions must 404, not return index.html."""
    (tmp_path / "index.html").write_text("<!doctype html><html>app</html>")
    files = SPAStaticFiles(directory=str(tmp_path), html=True)

    async def run() -> None:
        # 1. Missing file in assets/ directory
        with pytest.raises(StarletteHTTPException) as exc_info:
            await files.get_response(
                "assets/index-Co73Z1o6.css", _scope("/assets/index-Co73Z1o6.css")
            )
        assert exc_info.value.status_code == 404

        # 2. Missing js file with extension
        with pytest.raises(StarletteHTTPException) as exc_info:
            await files.get_response("assets/chunk-123.js", _scope("/assets/chunk-123.js"))
        assert exc_info.value.status_code == 404

        # 3. Missing static asset with extension in root
        with pytest.raises(StarletteHTTPException) as exc_info:
            await files.get_response("styles.css", _scope("/styles.css"))
        assert exc_info.value.status_code == 404

        # 4. Client route without file extension DOES fall back to index.html
        resp = await files.get_response("task/HOME-123", _scope("/task/HOME-123"))
        assert resp.status_code == 200

    asyncio.run(run())


def test_spa_testclient_asset_404_and_root_caching(tmp_path: Path) -> None:
    """Test full ASGI stack via TestClient ensuring 404 for missing CSS and no-cache for root."""
    (tmp_path / "index.html").write_text("<!doctype html><html>app</html>")
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir()
    (assets_dir / "index-actual.css").write_text("body { color: red; }")

    test_app = FastAPI()
    test_app.mount("/", SPAStaticFiles(directory=str(tmp_path), html=True), name="static")
    client = TestClient(test_app)

    # Root request receives no-cache, must-revalidate
    root_res = client.get("/")
    assert root_res.status_code == 200
    assert root_res.headers.get("Cache-Control") == "no-cache, must-revalidate"
    assert "app" in root_res.text

    # Existing asset succeeds with immutable cache
    existing_asset = client.get("/assets/index-actual.css")
    assert existing_asset.status_code == 200
    assert existing_asset.headers.get("Cache-Control") == "public, max-age=31536000, immutable"

    # Missing CSS asset must be HTTP 404, NEVER HTTP 200 returning index.html
    missing_asset = client.get("/assets/index-Co73Z1o6.css")
    assert missing_asset.status_code == 404
    assert missing_asset.headers.get("content-type") != "text/html; charset=utf-8"

    # Deep client route falls back to index.html with no-cache
    deep_route = client.get("/task/HOME-456")
    assert deep_route.status_code == 200
    assert deep_route.headers.get("Cache-Control") == "no-cache, must-revalidate"
    assert "app" in deep_route.text
