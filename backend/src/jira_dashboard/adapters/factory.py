"""Factory for creating Jira client, storage, and blob storage adapters based on settings."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from jira_dashboard.adapters.jira_client import (
    FakeJiraClient,
    JiraClientProtocol,
)
from jira_dashboard.adapters.jira_cloud_client import JiraCloudClient
from jira_dashboard.config import JiraDashboardSettings

if TYPE_CHECKING:
    from jira_dashboard.adapters.blob_storage import BlobStorageProtocol
    from jira_dashboard.adapters.storage_protocol import StorageProtocol

logger = logging.getLogger(__name__)


def create_jira_client(settings: JiraDashboardSettings | None = None) -> JiraClientProtocol:
    """Create a configured JiraClientProtocol instance.

    Uses JiraCloudClient if real credentials exist, otherwise falls back
    to FakeJiraClient for local development and testing.
    """
    import os

    if os.environ.get("JIRA_USE_FAKE") == "1":
        logger.info("JIRA_USE_FAKE=1 set; using in-memory FakeJiraClient test double.")
        return FakeJiraClient()

    if settings is None:
        settings = JiraDashboardSettings.load()

    if settings.has_jira_credentials:
        logger.info(
            "Configuring real JiraCloudClient connecting to %s",
            settings.jira_url,
        )
        return JiraCloudClient(settings)

    logger.info("No Jira credentials configured. Using in-memory FakeJiraClient test double.")
    return FakeJiraClient()


def create_storage(settings: JiraDashboardSettings | None = None) -> StorageProtocol:
    """Create a configured StorageProtocol instance.

    Uses FirestoreStorage when storage_backend == 'firestore' or under GCP_OAUTH mode,
    falling back to SQLiteStorage for Home Assistant and local standalone mode.
    """
    if settings is None:
        settings = JiraDashboardSettings.load()

    use_firestore = settings.storage_backend == "firestore" or (
        settings.storage_backend is None and settings.auth_mode == "gcp_oauth"
    )

    if use_firestore:
        from jira_dashboard.adapters.firestore_storage import FirestoreStorage

        logger.info(
            "Configuring FirestoreStorage (project=%s, database=%s)",
            settings.gcp_project_id,
            settings.firestore_database_id,
        )
        return FirestoreStorage(
            project_id=settings.gcp_project_id,
            database_id=settings.firestore_database_id,
        )

    from jira_dashboard.adapters.storage import SQLiteStorage

    logger.info("Configuring SQLiteStorage at %s", settings.sqlite_db_path)
    return SQLiteStorage(settings.sqlite_db_path)


def create_blob_storage(settings: JiraDashboardSettings | None = None) -> BlobStorageProtocol:
    """Create a configured BlobStorageProtocol instance.

    Uses GoogleCloudStorageBlobStorage when image_storage_backend == 'gcs' or under GCP_OAUTH mode,
    falling back to LocalDiskBlobStorage for Home Assistant and local standalone mode.
    """
    if settings is None:
        settings = JiraDashboardSettings.load()

    use_gcs = settings.image_storage_backend == "gcs" or (
        settings.image_storage_backend is None and settings.auth_mode == "gcp_oauth"
    )

    if use_gcs:
        from jira_dashboard.adapters.blob_storage import GoogleCloudStorageBlobStorage

        bucket_name = (
            settings.image_storage_bucket or f"{settings.gcp_project_id or 'default'}-images"
        )
        logger.info("Configuring GoogleCloudStorageBlobStorage (bucket=%s)", bucket_name)
        return GoogleCloudStorageBlobStorage(bucket_name=bucket_name)

    from jira_dashboard.adapters.blob_storage import LocalDiskBlobStorage

    logger.info("Configuring LocalDiskBlobStorage at %s", settings.background_cache_dir)
    return LocalDiskBlobStorage(settings.background_cache_dir)
