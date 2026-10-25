# Firestore and GCS Storage Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement pluggable storage and blob storage adapters supporting Cloud Firestore and Google Cloud Storage (without FUSE) for GCP Cloud Run, while keeping SQLite and local disk persistence intact for Home Assistant.

**Architecture:** Define `StorageProtocol` and `BlobStorageProtocol`. Implement `FirestoreStorage` alongside `SQLiteStorage`, and `GoogleCloudStorageBlobStorage` alongside `LocalDiskBlobStorage`. Wire both through adapter factories with automatic environment resolution (GCP vs Home Assistant). Verify behavioral parity via shared compliance test suites.

**Tech Stack:** Python 3.10+, FastAPI, google-cloud-firestore, google-cloud-storage, SQLite3, pytest/unittest.

**Spec:** `docs/superpowers/specs/2026-10-25-firestore-and-gcs-storage-adapters-design.md`

## Global Constraints

- Never use Cloud Storage FUSE or kernel volume mounts on Cloud Run.
- Never use Litestream continuous replication daemons.
- Home Assistant and local standalone mode must remain 100% local (SQLite + local disk, zero cloud dependencies).
- GCP Cloud Run must use standard Application Default Credentials (ADC) without hardcoded keys.
- All test suites must run completely offline in milliseconds using in-memory doubles, passing `./scripts/run_ci_locally.py` at 100%.

## Review Focus

1. **Firestore Single-Use OAuth Code Consumption:** Ensure `consume_oauth_code` atomically invalidates or deletes the code so it cannot be used twice.
2. **Missing Blob Lookup:** Ensure `blob_storage.get(key)` returns `None` instead of raising an unhandled exception when an image does not exist.
3. **Daily Generation Count Rollover:** Ensure daily quota counter accurately resets to 0 when date string advances to the next day.
4. **Issue Filtering Parity:** Ensure `get_issues(status_category=..., assignee_id=...)` in `FirestoreStorage` produces the exact same filtered subset as `SQLiteStorage`.
5. **Zero Cloud Leaks in Home Assistant:** Ensure factory instantiation under `AUTH_MODE=homeassistant` or `none` never imports or accesses Google Cloud services.

---

### Task 1: Storage Protocol & Unified Storage Compliance Test Suite

**Files:**
- Create: `backend/src/jira_dashboard/adapters/storage_protocol.py`
- Modify: `backend/src/jira_dashboard/adapters/__init__.py`
- Create: `backend/tests/test_storage_compliance.py`

**Interfaces:**
- Consumes: `JiraIssue`, `BoardColumn` from `jira_dashboard.domain.models`
- Produces: `StorageProtocol` (runtime checkable protocol for all storage backends), `BaseStorageComplianceTest` (reusable test suite)

- [ ] **Step 1: Write failing test with `BaseStorageComplianceTest` and `TestSQLiteStorage`**

```python
# backend/tests/test_storage_compliance.py
import pytest
from jira_dashboard.adapters.storage_protocol import StorageProtocol
from jira_dashboard.adapters.storage import SQLiteStorage
from jira_dashboard.domain.models import JiraIssue, BoardColumn

class BaseStorageComplianceTest:
    def create_storage(self) -> StorageProtocol:
        raise NotImplementedError

    def test_board_meta_roundtrip(self):
        storage = self.create_storage()
        cols = [BoardColumn(id="col-1", name="To Do", status_ids=["1"])]
        storage.save_board_meta("b1", "Board 1", "Sprint 1", "https://jira.example.com", cols)
        meta = storage.get_board_meta("b1")
        assert meta is not None
        assert meta["board_name"] == "Board 1"
        assert meta["columns"][0]["name"] == "To Do"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_storage_compliance.py`
Expected: FAIL (cannot import `StorageProtocol`)

- [ ] **Step 3: Implement `StorageProtocol` in `backend/src/jira_dashboard/adapters/storage_protocol.py`**

Define `@runtime_checkable class StorageProtocol(Protocol)` with all 18 methods matching `SQLiteStorage`. Ensure `backend/src/jira_dashboard/adapters/__init__.py` exports it. Expand `BaseStorageComplianceTest` with complete tests for:
- `test_issues_crud_and_filtering`
- `test_outbox_fifo_and_status`
- `test_daily_generation_quota`
- `test_background_image_metadata_and_pruning`
- `test_oauth_codes_and_tokens`
- `test_account_types`
And declare `class TestSQLiteStorage(BaseStorageComplianceTest, unittest.TestCase)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_storage_compliance.py`
Expected: PASS (all tests pass for `SQLiteStorage`)

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/storage_protocol.py backend/src/jira_dashboard/adapters/__init__.py backend/tests/test_storage_compliance.py
git commit -m "feat(storage): define StorageProtocol and BaseStorageComplianceTest suite"
```

---

### Task 2: Blob Storage Protocol & Local Disk Implementation

**Files:**
- Create: `backend/src/jira_dashboard/adapters/blob_storage.py`
- Modify: `backend/src/jira_dashboard/adapters/__init__.py`
- Create: `backend/tests/test_blob_storage_compliance.py`

**Interfaces:**
- Produces: `BlobStorageProtocol`, `LocalDiskBlobStorage`

- [ ] **Step 1: Write failing compliance test for blob storage**

```python
# backend/tests/test_blob_storage_compliance.py
import pytest
from jira_dashboard.adapters.blob_storage import BlobStorageProtocol, LocalDiskBlobStorage

class BaseBlobStorageComplianceTest:
    def create_blob_storage(self) -> BlobStorageProtocol:
        raise NotImplementedError

    def test_save_get_exists_delete(self):
        storage = self.create_blob_storage()
        data = b"fake-webp-image-data"
        key = "sample-hash-123"
        assert not storage.exists(key)
        assert storage.get(key) is None

        path = storage.save(key, data, content_type="image/webp")
        assert storage.exists(key)
        assert storage.get(key) == data

        assert storage.delete(key) is True
        assert not storage.exists(key)
        assert storage.get(key) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_blob_storage_compliance.py`
Expected: FAIL (cannot import `BlobStorageProtocol`)

- [ ] **Step 3: Implement `BlobStorageProtocol` and `LocalDiskBlobStorage`**

In `backend/src/jira_dashboard/adapters/blob_storage.py`:
- `BlobStorageProtocol`: `save`, `get`, `exists`, `delete`.
- `LocalDiskBlobStorage(base_dir: Path)`: implements methods using standard atomic filesystem operations.
In `backend/tests/test_blob_storage_compliance.py`: add `class TestLocalDiskBlobStorage(BaseBlobStorageComplianceTest)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_blob_storage_compliance.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/blob_storage.py backend/src/jira_dashboard/adapters/__init__.py backend/tests/test_blob_storage_compliance.py
git commit -m "feat(storage): implement BlobStorageProtocol and LocalDiskBlobStorage"
```

---

### Task 3: In-Memory Firestore Double & `FirestoreStorage` Implementation

**Files:**
- Create: `backend/src/jira_dashboard/adapters/firestore_storage.py`
- Modify: `backend/tests/test_storage_compliance.py`
- Create: `backend/tests/mocks/fake_firestore.py`

**Interfaces:**
- Consumes: `StorageProtocol` from `storage_protocol.py`
- Produces: `FirestoreStorage`

- [ ] **Step 1: Write test case `TestFirestoreStorage` in `backend/tests/test_storage_compliance.py`**

```python
from backend.tests.mocks.fake_firestore import FakeFirestoreClient
from jira_dashboard.adapters.firestore_storage import FirestoreStorage

class TestFirestoreStorage(BaseStorageComplianceTest, unittest.TestCase):
    def create_storage(self) -> StorageProtocol:
        fake_client = FakeFirestoreClient()
        storage = FirestoreStorage(client=fake_client)
        storage.init_db()
        return storage
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_storage_compliance.py::TestFirestoreStorage`
Expected: FAIL (missing `fake_firestore.py` and `firestore_storage.py`)

- [ ] **Step 3: Implement `FakeFirestoreClient` and `FirestoreStorage`**

- In `backend/tests/mocks/fake_firestore.py`: Implement lightweight in-memory Firestore client emulating `collection()`, `document()`, `get()`, `set()`, `update()`, `delete()`, `where()`, and `Increment`.
- In `backend/src/jira_dashboard/adapters/firestore_storage.py`: Implement `FirestoreStorage` implementing all 18 methods of `StorageProtocol`. Ensure `consume_oauth_code` deletes code atomically, `increment_daily_generation_count` updates atomically, and queries map to collections.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_storage_compliance.py`
Expected: PASS (both `TestSQLiteStorage` and `TestFirestoreStorage` pass 100% of the identical assertions)

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/firestore_storage.py backend/tests/mocks/fake_firestore.py backend/tests/test_storage_compliance.py
git commit -m "feat(storage): implement FirestoreStorage with compliance test coverage"
```

---

### Task 4: Google Cloud Storage Blob Implementation

**Files:**
- Modify: `backend/src/jira_dashboard/adapters/blob_storage.py`
- Modify: `backend/tests/test_blob_storage_compliance.py`

**Interfaces:**
- Produces: `GoogleCloudStorageBlobStorage`

- [ ] **Step 1: Add `TestGoogleCloudStorageBlobStorage` in `test_blob_storage_compliance.py`**

```python
class TestGoogleCloudStorageBlobStorage(BaseBlobStorageComplianceTest, unittest.TestCase):
    def create_blob_storage(self) -> BlobStorageProtocol:
        fake_client = FakeGCSClient()
        return GoogleCloudStorageBlobStorage(bucket_name="test-bucket", client=fake_client)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_blob_storage_compliance.py::TestGoogleCloudStorageBlobStorage`
Expected: FAIL (`GoogleCloudStorageBlobStorage` not implemented)

- [ ] **Step 3: Implement `GoogleCloudStorageBlobStorage` and `FakeGCSClient`**

In `backend/src/jira_dashboard/adapters/blob_storage.py`:
- `GoogleCloudStorageBlobStorage(bucket_name: str, client: Any = None)`:
  - Uses `client or google.cloud.storage.Client()`.
  - Implements `save`, `get`, `exists`, `delete` on `background_cache/{key}.webp`.
  - Catches `google.cloud.exceptions.NotFound` gracefully.
In `backend/tests/test_blob_storage_compliance.py`: add in-memory `FakeGCSClient` and run tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_blob_storage_compliance.py`
Expected: PASS (both `TestLocalDiskBlobStorage` and `TestGoogleCloudStorageBlobStorage` pass)

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/blob_storage.py backend/tests/test_blob_storage_compliance.py
git commit -m "feat(storage): implement GoogleCloudStorageBlobStorage with compliance test coverage"
```

---

### Task 5: Configuration, Adapter Factories & Application Integration

**Files:**
- Modify: `backend/src/jira_dashboard/config.py`
- Modify: `backend/src/jira_dashboard/adapters/factory.py`
- Modify: `backend/src/jira_dashboard/presentation/main.py`
- Modify: `backend/src/jira_dashboard/adapters/sync_worker.py`
- Modify: `backend/tests/test_config.py`
- Create: `backend/tests/test_storage_factory.py`

**Interfaces:**
- Consumes: `create_storage(settings)`, `create_blob_storage(settings)`
- Produces: Pluggable storage in FastAPI and background sync worker

- [ ] **Step 1: Write tests for settings and factory resolution**

In `backend/tests/test_storage_factory.py`:
- `test_factory_defaults_to_sqlite_and_local_disk_under_homeassistant`
- `test_factory_defaults_to_firestore_and_gcs_under_gcp_oauth`
- `test_factory_respects_explicit_overrides`

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_storage_factory.py`
Expected: FAIL

- [ ] **Step 3: Implement configuration fields and factory functions**

- In `backend/src/jira_dashboard/config.py`: Add `storage_backend`, `firestore_database_id`, `image_storage_backend`, `image_storage_bucket`.
- In `backend/src/jira_dashboard/adapters/factory.py`: Add `create_storage(settings)` and `create_blob_storage(settings)`.
- In `backend/src/jira_dashboard/presentation/main.py`:
  - Replace direct `SQLiteStorage(settings.sqlite_db_path)` with `create_storage(settings)`.
  - Initialize `blob_storage = create_blob_storage(settings)`.
  - In background image endpoints, use `blob_storage.get(hash)` and `blob_storage.save(hash, image_bytes)`.
- In `backend/src/jira_dashboard/adapters/sync_worker.py`: Type `storage` as `StorageProtocol`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_storage_factory.py backend/tests/test_config.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/config.py backend/src/jira_dashboard/adapters/factory.py backend/src/jira_dashboard/presentation/main.py backend/src/jira_dashboard/adapters/sync_worker.py backend/tests/test_config.py backend/tests/test_storage_factory.py
git commit -m "feat(storage): wire storage and blob storage factories into FastAPI application"
```

---

### Task 6: GCP Deployment Integration & Full Verification

**Files:**
- Modify: `scripts/deploy_gcp.py`
- Modify: `backend/tests/test_deploy_gcp.py`
- Modify: `docs/roadmap_and_phases.md`

- [ ] **Step 1: Update deployment script and tests**

- In `scripts/deploy_gcp.py`: Add `"firestore.googleapis.com"` and `"storage.googleapis.com"` to `REQUIRED_APIS` (enables APIs in GCP without FUSE mounts or Litestream).
- In `deploy_service`: Ensure image bucket is created via `gcloud storage buckets create` if it doesn't exist, granting `roles/storage.objectAdmin` to Cloud Run service account, with zero volume mounts.
- In `backend/tests/test_deploy_gcp.py`: Verify deployment commands and API requirements.

- [ ] **Step 2: Update roadmap documentation**

Update Phase 5.24 in `docs/roadmap_and_phases.md` documenting the Firestore + GCS API serverless architecture.

- [ ] **Step 3: Run full local CI runner**

Run: `./scripts/run_ci_locally.py`
Expected: 100% PASS across syntax, ruff lint, ruff format, backend pytest/unittest, frontend vitest, and build.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy_gcp.py backend/tests/test_deploy_gcp.py docs/roadmap_and_phases.md
git commit -m "feat(gcp): integrate Firestore and GCS bucket provisioning in deploy_gcp.py"
```
