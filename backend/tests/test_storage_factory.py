"""Unit tests for storage and blob storage factory resolution."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from jira_dashboard.adapters.blob_storage import GoogleCloudStorageBlobStorage, LocalDiskBlobStorage
from jira_dashboard.adapters.factory import create_blob_storage, create_storage
from jira_dashboard.adapters.firestore_storage import FirestoreStorage
from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.config import JiraDashboardSettings


def test_factory_defaults_to_sqlite_and_local_disk_under_homeassistant(tmp_path: Path) -> None:
    settings = JiraDashboardSettings(
        auth_mode="homeassistant",
        sqlite_db_path=tmp_path / "test.sqlite3",
    )
    storage = create_storage(settings)
    assert isinstance(storage, SQLiteStorage)

    blob_storage = create_blob_storage(settings)
    assert isinstance(blob_storage, LocalDiskBlobStorage)


def test_factory_defaults_to_sqlite_and_local_disk_under_none(tmp_path: Path) -> None:
    settings = JiraDashboardSettings(
        auth_mode="none",
        sqlite_db_path=tmp_path / "test.sqlite3",
    )
    storage = create_storage(settings)
    assert isinstance(storage, SQLiteStorage)

    blob_storage = create_blob_storage(settings)
    assert isinstance(blob_storage, LocalDiskBlobStorage)


def test_factory_defaults_to_firestore_and_gcs_under_gcp_oauth(monkeypatch) -> None:
    monkeypatch.setenv("GCP_PROJECT_ID", "my-gcp-project")
    settings = JiraDashboardSettings(
        auth_mode="gcp_oauth",
        gcp_project_id="my-gcp-project",
    )
    storage = create_storage(settings)
    assert isinstance(storage, FirestoreStorage)
    assert storage.project_id == "my-gcp-project"

    blob_storage = create_blob_storage(settings)
    assert isinstance(blob_storage, GoogleCloudStorageBlobStorage)
    assert blob_storage.bucket_name == "my-gcp-project-images"


def test_factory_respects_explicit_overrides(tmp_path: Path, monkeypatch) -> None:
    # Explicit SQLite & Local even with gcp_oauth
    settings = JiraDashboardSettings(
        auth_mode="gcp_oauth",
        storage_backend="sqlite",
        image_storage_backend="local",
        sqlite_db_path=tmp_path / "test.sqlite3",
    )
    storage = create_storage(settings)
    assert isinstance(storage, SQLiteStorage)

    blob_storage = create_blob_storage(settings)
    assert isinstance(blob_storage, LocalDiskBlobStorage)

    # Explicit Firestore & GCS with custom bucket
    settings2 = JiraDashboardSettings(
        auth_mode="none",
        storage_backend="firestore",
        image_storage_backend="gcs",
        gcp_project_id="custom-project",
        image_storage_bucket="custom-bucket",
    )
    storage2 = create_storage(settings2)
    assert isinstance(storage2, FirestoreStorage)

    blob_storage2 = create_blob_storage(settings2)
    assert isinstance(blob_storage2, GoogleCloudStorageBlobStorage)
    assert blob_storage2.bucket_name == "custom-bucket"
