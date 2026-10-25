# Design Specification: Firestore & Cloud Storage Adapters

- **Date:** 2026-10-25
- **Status:** Approved
- **Scope:** Architectural (Dual deployment persistence: Local/Home Assistant vs GCP Cloud Run)

---

## 1. Overview & Goals

### 1.1 Context & Problem
Running SQLite continuous replication (Litestream) and Cloud Storage FUSE volume mounts on Google Cloud Run introduced severe cold-start penalties, file locking issues under CPU throttling (`--min-instances 0`), and high operational complexity. In response, Litestream and FUSE were removed.

However, GCP Cloud Run still requires persistent storage for:
1. Cached Jira issues, board metadata, and offline outbox transactions.
2. AI-generated background image assets (`.webp`).
3. OAuth 2.0 authorization codes and refresh tokens (for Gemini MCP integration).
4. Daily Gemini image generation quotas and account classifications.

Meanwhile, the application must preserve its primary deployment target: **Home Assistant Add-on** (and local standalone development), which must remain 100% local, self-contained, and free of any GCP or cloud dependencies.

### 1.2 Goals
1. **Zero FUSE, Zero Daemons**: Cloud Run container runs standard unprivileged Python/FastAPI without gcsfuse mounts or background replication daemons.
2. **Dual-Environment Pluggability**:
   - **Home Assistant / Local**: Uses `SQLiteStorage` (local disk) and `LocalDiskBlobStorage` (`/data/background_cache`).
   - **GCP Cloud Run**: Uses `FirestoreStorage` (Cloud Firestore native mode) and `GoogleCloudStorageBlobStorage` (GCS client API).
3. **Automatic Selection with Override**:
   - Defaults automatically to Firestore + GCS when `AUTH_MODE == "gcp_oauth"`.
   - Defaults automatically to SQLite + Local Disk when `AUTH_MODE == "homeassistant"` or `"none"`.
   - Explicit overrides via `STORAGE_BACKEND` (`"sqlite"` | `"firestore"`) and `IMAGE_STORAGE_BACKEND` (`"local"` | `"gcs"`).
4. **Behavioral Parity & Unified Test Suite**:
   - A single shared compliance test base (`BaseStorageComplianceTest` and `BaseBlobStorageComplianceTest`) validates identical semantics, return structures, and edge cases across both implementations.
5. **Strict Budget & Free Tier Compliance**:
   - Fully utilizes GCP's Always Free Tier (Firestore: 1 GiB storage, 50k reads/day, 20k writes/day; GCS: 5 GB-months, 5,000 Class A ops), resulting in $0.00 / month operational cost for personal/family usage.

### 1.3 Non-Goals
- Migrating Home Assistant Add-on to any cloud database.
- Replacing Jira Cloud as the authoritative source of truth for issues and boards.

---

## 2. Architecture & Components

```
                   +----------------------------------+
                   |       FastAPI Application        |
                   |   (main.py / sync_worker.py)     |
                   +----------------+-----------------+
                                    |
            +-----------------------+-----------------------+
            |                                               |
            v                                               v
+-----------------------+                       +-----------------------+
|    StorageProtocol    |                       |  BlobStorageProtocol  |
+-----------+-----------+                       +-----------+-----------+
            |                                               |
     +------+------+                                 +------+------+
     |             |                                 |             |
     v             v                                 v             v
+----------+ +-----------+                      +----------+ +-----------+
|  SQLite  | | Firestore |                      |  Local   | |    GCS    |
| Storage  | |  Storage  |                      |   Disk   | |   Client  |
+----------+ +-----------+                      +----------+ +-----------+
(HomeAssistant)   (GCP)                         (HomeAssistant)   (GCP)
```

### 2.1 Factory Resolution Logic
Located in `backend/src/jira_dashboard/adapters/factory.py`:
- `create_storage(settings: JiraDashboardSettings) -> StorageProtocol`:
  - If `settings.storage_backend == "firestore"` or (`settings.storage_backend is None` and `settings.auth_mode == "gcp_oauth"`):
    Instantiates `FirestoreStorage(project_id=settings.gcp_project_id, database_id=settings.firestore_database_id)`.
  - Else:
    Instantiates `SQLiteStorage(settings.sqlite_db_path)`.
- `create_blob_storage(settings: JiraDashboardSettings) -> BlobStorageProtocol`:
  - If `settings.image_storage_backend == "gcs"` or (`settings.image_storage_backend is None` and `settings.auth_mode == "gcp_oauth"`):
    Instantiates `GoogleCloudStorageBlobStorage(bucket_name=settings.image_storage_bucket or f"{settings.gcp_project_id}-images")`.
  - Else:
    Instantiates `LocalDiskBlobStorage(base_dir=settings.background_cache_dir)`.

---

## 3. Storage Interface & Firestore Schema

### 3.1 `StorageProtocol` Definition
Both `SQLiteStorage` and `FirestoreStorage` implement:
```python
class StorageProtocol(Protocol):
    def init_db(self) -> None: ...
    def close(self) -> None: ...
    def get_schema_version(self) -> int: ...

    # Board Meta
    def save_board_meta(
        self,
        board_id: str,
        board_name: str,
        sprint_name: str | None,
        jira_url: str,
        columns: list[BoardColumn],
    ) -> None: ...
    def get_board_meta(self, board_id: str) -> dict[str, Any] | None: ...

    # Issues
    def save_issues(self, issues: list[JiraIssue]) -> None: ...
    def get_issues(
        self,
        status_category: str | None = None,
        assignee_id: str | None = None,
    ) -> list[JiraIssue]: ...
    def get_issue(self, issue_key: str) -> JiraIssue | None: ...
    def upsert_issue(self, issue: JiraIssue) -> None: ...
    def delete_issue(self, issue_key: str) -> None: ...
    def replace_all_issues(self, issues: list[JiraIssue]) -> None: ...

    # Outbox
    def enqueue_outbox(
        self,
        mutation_type: str,
        issue_key: str,
        payload: dict[str, Any],
    ) -> int: ...
    def get_pending_outbox(self) -> list[dict[str, Any]]: ...
    def update_outbox_status(
        self,
        item_id: int,
        status: str,
        error_message: str | None = None,
    ) -> None: ...
    def get_outbox_item(self, item_id: int) -> dict[str, Any] | None: ...
    def clear_outbox(self) -> None: ...

    # Quotas & Usage
    def get_daily_generation_count(self, date_str: str) -> int: ...
    def increment_daily_generation_count(self, date_str: str) -> None: ...

    # Background Image Metadata
    def save_background_image(
        self,
        content_hash: str,
        file_path: str,
        byte_size: int,
        issue_key: str | None = None,
    ) -> None: ...
    def get_background_image(self, content_hash: str) -> dict[str, Any] | None: ...
    def touch_background_image(self, content_hash: str) -> None: ...
    def prune_expired_background_images(self, ttl_seconds: int) -> int: ...
    def get_issue_last_background_hash(self, issue_key: str) -> str | None: ...

    # OAuth Server
    def save_oauth_code(
        self,
        code: str,
        client_id: str,
        email: str,
        code_challenge: str,
        code_challenge_method: str,
        redirect_uri: str,
        expires_at: int,
    ) -> None: ...
    def consume_oauth_code(self, code: str) -> dict[str, Any] | None: ...
    def save_refresh_token(
        self,
        refresh_token: str,
        client_id: str,
        email: str,
        created_at: int,
    ) -> None: ...
    def get_refresh_token(self, refresh_token: str) -> dict[str, Any] | None: ...
    def revoke_refresh_token(self, refresh_token: str) -> None: ...

    # Account Types
    def get_account_types(self) -> dict[str, str]: ...
    def set_account_type(self, account_id: str, account_type: str) -> None: ...
    def clear_account_types(self) -> None: ...
```

### 3.2 Firestore Collection Mappings
1. **`issues`**: Doc ID = `issue.key`. Contains JSON representation with fields `key`, `summary`, `status_category`, `assignee_id`, etc.
2. **`board_meta`**: Doc ID = `board_id`. Contains `board_name`, `sprint_name`, `jira_url`, `columns`.
3. **`daily_usage`**: Doc ID = `date_str` (`YYYY-MM-DD`). Field: `count` (incremented atomically).
4. **`background_images`**: Doc ID = `content_hash`. Fields: `content_hash`, `file_path`, `byte_size`, `created_at`, `last_accessed_at`, `issue_key`.
5. **`oauth_codes`**: Doc ID = `code`. Fields: client metadata and expiration. `consume_oauth_code` deletes or marks consumed atomically in a transaction.
6. **`oauth_refresh_tokens`**: Doc ID = `refresh_token`. Fields: `client_id`, `email`, `created_at`, `revoked`.
7. **`outbox`**: Doc ID = auto-generated or numeric sequence. Fields: `id`, `mutation_type`, `issue_key`, `payload`, `status`, `retry_count`, `created_at`.
8. **`account_types`**: Doc ID = `account_id`. Field: `account_type`.

---

## 4. Blob Storage Interface & Implementation

### 4.1 `BlobStorageProtocol` Definition
```python
class BlobStorageProtocol(Protocol):
    def save(self, key: str, data: bytes, content_type: str = "image/webp") -> str:
        """Stores binary data under key and returns the locator path/URI."""
        ...

    def get(self, key: str) -> bytes | None:
        """Retrieves raw binary bytes or None if not found."""
        ...

    def exists(self, key: str) -> bool:
        """Checks existence of the blob."""
        ...

    def delete(self, key: str) -> bool:
        """Deletes blob if present. Returns True if deleted, False if not found."""
        ...
```

### 4.2 `GoogleCloudStorageBlobStorage`
- Client: `google.cloud.storage.Client()`.
- Bucket: Configured `IMAGE_STORAGE_BUCKET` or `{GCP_PROJECT_ID}-images`.
- Object path: `background_cache/{key}.webp`.
- Standard methods: `blob = bucket.blob(...)`, `blob.upload_from_string(data, content_type=...)`, `blob.download_as_bytes()`.
- Error handling: Catches `google.cloud.exceptions.NotFound` gracefully and returns `None` / `False`.

---

## 5. Unified Compliance Testing Strategy

### 5.1 Abstract Base Suites
1. **`BaseStorageComplianceTest`**:
   - Contains 15+ comprehensive test methods asserting full functional compliance across board meta, issues, outbox FIFO ordering, quotas, image metadata TTL pruning, single-use OAuth code consumption, and account types.
2. **`BaseBlobStorageComplianceTest`**:
   - Tests binary save, get, exists, delete, and non-existent lookups.

### 5.2 Concrete Test Classes
- **`TestSQLiteStorage(BaseStorageComplianceTest)`**:
  - Uses `tmp_path` SQLite database.
- **`TestFirestoreStorage(BaseStorageComplianceTest)`**:
  - Uses an in-memory Firestore Mock Client that implements `collection()`, `document()`, `get()`, `set()`, `update()`, `delete()`, and query filters without external network calls.
- **`TestLocalDiskBlobStorage(BaseBlobStorageComplianceTest)`**:
  - Uses `tmp_path` local directory.
- **`TestGoogleCloudStorageBlobStorage(BaseBlobStorageComplianceTest)`**:
  - Uses a mocked `google.cloud.storage.Client` with an in-memory bucket dictionary.

All tests run in milliseconds offline, guaranteeing 100% pass rate in `./scripts/run_ci_locally.py`.

---

## 6. Configuration Additions (`JiraDashboardSettings`)

- `storage_backend: str | None = None` (Env: `STORAGE_BACKEND`, `"sqlite"` | `"firestore"`)
- `firestore_database_id: str = "(default)"` (Env: `FIRESTORE_DATABASE_ID`)
- `image_storage_backend: str | None = None` (Env: `IMAGE_STORAGE_BACKEND`, `"local"` | `"gcs"`)
- `image_storage_bucket: str | None = None` (Env: `IMAGE_STORAGE_BUCKET`)

Default behaviors:
- When running under Home Assistant (`AUTH_MODE == "homeassistant"`) or Standalone (`AUTH_MODE == "none"`), defaults to SQLite + Local Disk.
- When running under GCP Cloud Run (`AUTH_MODE == "gcp_oauth"`), defaults to Firestore + GCS without FUSE.
