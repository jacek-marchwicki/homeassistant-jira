"""Tests for the single-page-app static file fallback."""

from __future__ import annotations

import asyncio
from pathlib import Path

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
        root_resp = await files.get_response("", _scope("/"))
        deep_resp = await files.get_response("task/HOME-1", _scope("/task/HOME-1"))
        sw_resp = await files.get_response("sw.js", _scope("/sw.js"))
        asset_resp = await files.get_response(
            "assets/bundle-123.js", _scope("/assets/bundle-123.js")
        )
        icon_resp = await files.get_response("favicon.svg", _scope("/favicon.svg"))

        return {
            "root": root_resp.headers.get("Cache-Control"),
            "deep": deep_resp.headers.get("Cache-Control"),
            "sw": sw_resp.headers.get("Cache-Control"),
            "asset": asset_resp.headers.get("Cache-Control"),
            "icon": icon_resp.headers.get("Cache-Control"),
        }

    headers = asyncio.run(run())

    assert headers["root"] == "no-cache, must-revalidate"
    assert headers["deep"] == "no-cache, must-revalidate"
    assert headers["sw"] == "no-cache, must-revalidate"
    assert headers["asset"] == "public, max-age=31536000, immutable"
    assert headers["icon"] == "public, max-age=86400"
