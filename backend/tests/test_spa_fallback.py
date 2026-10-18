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
