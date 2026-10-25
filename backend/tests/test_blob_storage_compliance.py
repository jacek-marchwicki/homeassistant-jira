"""Compliance test suite ensuring all BlobStorageProtocol implementations behave identically."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from jira_dashboard.adapters.blob_storage import BlobStorageProtocol, LocalDiskBlobStorage


class BaseBlobStorageComplianceTest:
    """Contract tests that must pass for any BlobStorageProtocol implementation."""

    def create_blob_storage(self) -> BlobStorageProtocol:
        raise NotImplementedError

    def test_save_get_exists_delete_lifecycle(self) -> None:
        storage = self.create_blob_storage()
        key = "sample-hash-abc"
        data = b"image-binary-data-12345"

        # Initially does not exist
        assert storage.exists(key) is False
        assert storage.get(key) is None

        # Save blob
        path_or_uri = storage.save(key, data, content_type="image/webp")
        assert isinstance(path_or_uri, str)
        assert len(path_or_uri) > 0

        # Now exists and get returns identical bytes
        assert storage.exists(key) is True
        assert storage.get(key) == data

        # Overwrite with new data
        new_data = b"updated-image-binary-data"
        storage.save(key, new_data, content_type="image/webp")
        assert storage.get(key) == new_data

        # Delete blob
        deleted = storage.delete(key)
        assert deleted is True
        assert storage.exists(key) is False
        assert storage.get(key) is None

        # Deleting non-existent blob returns False
        assert storage.delete("nonexistent-key") is False

    def test_get_nonexistent_returns_none(self) -> None:
        storage = self.create_blob_storage()
        assert storage.get("unknown-hash") is None
        assert storage.exists("unknown-hash") is False


class TestLocalDiskBlobStorage(BaseBlobStorageComplianceTest, unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = TemporaryDirectory()
        self.base_dir = Path(self.temp_dir.name)
        self.storage = LocalDiskBlobStorage(self.base_dir)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def create_blob_storage(self) -> BlobStorageProtocol:
        return self.storage
