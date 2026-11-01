"""Adapter and infrastructure implementations (Jira API client, Webhooks, WebSocket hub)."""

from jira_dashboard.adapters.blob_storage import (
    BlobStorageProtocol,
    GoogleCloudStorageBlobStorage,
    LocalDiskBlobStorage,
)
from jira_dashboard.adapters.factory import (
    create_blob_storage,
    create_jira_client,
    create_storage,
)
from jira_dashboard.adapters.firestore_storage import FirestoreStorage
from jira_dashboard.adapters.gemini_client import (
    GeminiImageClient,
    GoogleGenAIImageClient,
    MockGeminiImageClient,
    compute_background_content_hash,
    create_gemini_client,
    extract_retry_after,
    is_rate_limit_error,
)
from jira_dashboard.adapters.ha_cloudhook import HomeAssistantCloudhookManager
from jira_dashboard.adapters.jira_client import (
    DEFAULT_COLUMNS,
    FakeJiraClient,
    JiraAPIError,
    JiraClientProtocol,
)
from jira_dashboard.adapters.jira_cloud_client import JiraCloudClient
from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.adapters.storage_protocol import StorageProtocol
from jira_dashboard.adapters.sync_worker import JiraSyncWorker
from jira_dashboard.adapters.webhook_processor import JiraWebhookProcessor
from jira_dashboard.adapters.webhook_registrar import (
    build_webhook_url_with_secret,
    register_jira_webhook_if_needed,
)

__all__ = [
    "BlobStorageProtocol",
    "DEFAULT_COLUMNS",
    "FakeJiraClient",
    "FirestoreStorage",
    "GeminiImageClient",
    "GoogleCloudStorageBlobStorage",
    "GoogleGenAIImageClient",
    "HomeAssistantCloudhookManager",
    "JiraAPIError",
    "JiraClientProtocol",
    "JiraCloudClient",
    "JiraSyncWorker",
    "JiraWebhookProcessor",
    "LocalDiskBlobStorage",
    "MockGeminiImageClient",
    "SQLiteStorage",
    "StorageProtocol",
    "build_webhook_url_with_secret",
    "compute_background_content_hash",
    "create_blob_storage",
    "create_gemini_client",
    "create_jira_client",
    "create_storage",
    "extract_retry_after",
    "is_rate_limit_error",
    "register_jira_webhook_if_needed",
]
