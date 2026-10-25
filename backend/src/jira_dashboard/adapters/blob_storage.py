"""Blob storage abstraction and implementations for image assets."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@runtime_checkable
class BlobStorageProtocol(Protocol):
    """Abstract interface for persisting and retrieving binary image assets."""

    def save(self, key: str, data: bytes, content_type: str = "image/webp") -> str:
        """Store binary data under key. Returns path or URI locator."""
        ...

    def get(self, key: str) -> bytes | None:
        """Retrieve binary bytes or None if not found."""
        ...

    def exists(self, key: str) -> bool:
        """Return True if the blob exists, False otherwise."""
        ...

    def delete(self, key: str) -> bool:
        """Delete blob under key. Returns True if deleted, False if not found."""
        ...


class LocalDiskBlobStorage:
    """Stores binary image assets on the local filesystem (for Home Assistant / local)."""

    def __init__(self, base_dir: Path | str) -> None:
        self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _file_path(self, key: str) -> Path:
        filename = f"{key}.webp" if not key.endswith(".webp") else key
        return self.base_dir / filename

    def save(self, key: str, data: bytes, content_type: str = "image/webp") -> str:
        file_path = self._file_path(key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(data)
        return str(file_path)

    def get(self, key: str) -> bytes | None:
        file_path = self._file_path(key)
        if not file_path.is_file():
            return None
        try:
            return file_path.read_bytes()
        except OSError as exc:
            logger.warning("Failed to read local blob %s: %s", file_path, exc)
            return None

    def exists(self, key: str) -> bool:
        return self._file_path(key).is_file()

    def delete(self, key: str) -> bool:
        file_path = self._file_path(key)
        if not file_path.is_file():
            return False
        try:
            file_path.unlink()
            return True
        except OSError as exc:
            logger.warning("Failed to delete local blob %s: %s", file_path, exc)
            return False
