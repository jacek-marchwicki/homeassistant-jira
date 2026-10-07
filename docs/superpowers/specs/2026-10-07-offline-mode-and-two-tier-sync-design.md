# Design Specification: Offline Mode & Two-Tier Synchronization

**Date:** 2026-10-07  
**Status:** Approved / In Review  
**Target Architecture:** Dual Deployment (Home Assistant Add-on & Standalone Web App)  

---

## 1. Overview & Objectives

The goal of this feature is to provide a complete, reliable **offline-first experience** with **two-tier synchronization** across the Home Assistant Jira Dashboard:

1. **Tier 1 (Backend ↔ Jira)**:
   - The backend maintains an authoritative local SQLite persistence store.
   - All mutations (creating issues, updating fields, transitioning status) update the backend state immediately (<5ms) and broadcast deltas over WebSockets without waiting for Jira.
   - A background outbox worker (`JiraSyncWorker`) asynchronously syncs queued mutations to Jira when Jira is reachable.
2. **Tier 2 (Web Client ↔ Backend)**:
   - The web UI maintains an optimistic local store (Zustand + `localStorage`) that updates immediately (<16ms) on user actions.
   - Offline actions are queued locally. When network/WebSocket connectivity is restored, the client flushes queued actions to the backend in FIFO order.
3. **Cross-View & Reactive Filtering**:
   - The Kanban board and Backlog views read from the same underlying reactive store.
   - If a ticket is marked "Done" or transitioned while viewing the "Backlog" in offline mode, it immediately reflects in the "Board" view and satisfies board filter queries ("Active", "Assigned to Me", "Hide Epics") with zero latency.
4. **Single-Field Granular Updates**:
   - When an issue edit modifies only one field (e.g. `assignee`), only that specific field is sent in the sync payload, leaving all other fields in Jira intact.
5. **Conflict Resolution (Remote-Wins)**:
   - If an issue is modified remotely on Jira/server while an offline modification is pending, the local conflicting change is skipped (`skipped_conflict`), and the remote state is adopted.
6. **Destructive Schema Migration Resilience**:
   - Database migrations use `PRAGMA user_version`. Because Jira is the ultimate source of truth, schema migrations safely preserve pending unsynced outbox actions while resetting/re-fetching cached issue snapshots if a schema incompatibility occurs across releases.

---

## 2. Architecture & Data Flow

```
[User Interaction]
   │
   ▼ (<16ms)
[Web Frontend Store (Zustand)] ──(Persisted)──> [localStorage Outbox Queue]
   │
   │ (When connected / on reconnect)
   ▼
[FastAPI Backend Endpoints]
   │
   ├───> 1. Write to SQLite `cached_issues` (<5ms)
   ├───> 2. Enqueue in SQLite `sync_outbox` (Field-level payload)
   ├───> 3. Broadcast to all WebSocket clients
   └───> 4. Return HTTP 200/201 to caller immediately
   
[SQLite Outbox]
   │
   ▼ (Async Background Worker)
[JiraSyncWorker]
   │
   ├── (Jira unreachable) ──> Pause & Exponential Backoff (Queue preserved)
   │
   ├── (Conflict: remote updated_at > base_updated_at)
   │     └──> Mark outbox 'skipped_conflict', overwrite local SQLite with Jira version
   │
   └── (No conflict)
         └──> Call Jira API with ONLY dirty fields, mark outbox 'completed'
```

---

## 3. Detailed Component Design

### 3.1 Backend Persistence & SQLite Schema (`backend/src/jira_dashboard/adapters/storage.py`)

A new module `storage.py` will manage the local SQLite database.

#### SQLite Tables

```sql
CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS cached_board_meta (
    board_id TEXT PRIMARY KEY,
    board_name TEXT NOT NULL,
    sprint_name TEXT,
    jira_url TEXT,
    columns_json TEXT NOT NULL,
    last_synced_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS cached_issues (
    key TEXT PRIMARY KEY,
    id TEXT,
    summary TEXT NOT NULL,
    description TEXT,
    issue_type TEXT NOT NULL,
    priority TEXT NOT NULL,
    status_id TEXT NOT NULL,
    status_name TEXT NOT NULL,
    status_category TEXT NOT NULL,
    assignee_account_id TEXT,
    assignee_display_name TEXT,
    assignee_avatar_url TEXT,
    story_points REAL,
    due_date TEXT,
    start_date TEXT,
    recreate_after TEXT,
    url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    raw_json TEXT
);

CREATE TABLE IF NOT EXISTS sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_mutation_id TEXT UNIQUE NOT NULL,
    action_type TEXT NOT NULL,  -- 'create_issue' | 'update_issue' | 'transition_issue'
    issue_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,  -- ONLY modified fields
    base_updated_at TEXT,        -- Issue timestamp when mutation was initiated
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'in_progress' | 'completed' | 'skipped_conflict' | 'failed'
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
```

#### Database Path Configuration
- Configured via `settings.sqlite_db_path`:
  - Default in Home Assistant: `/data/jira_dashboard.sqlite3`
  - Fallback in local development: `./data/jira_dashboard.sqlite3`
  - In-memory SQLite (`:memory:`) available for automated unit tests.

#### Safe Schema Migration Policy
- Uses `PRAGMA user_version`.
- If an incompatible schema migration is detected:
  1. Unsynced records in `sync_outbox` (status `'pending'`) are extracted and preserved.
  2. The table structure is upgraded.
  3. Preserved outbox items are re-inserted.
  4. Cached issues are refetched from Jira on next successful connection.

---

### 3.2 Immediate Backend API Handlers (`backend/src/jira_dashboard/presentation/main.py`)

The REST endpoints are modified to update SQLite immediately and enqueue outbox jobs:

1. **`POST /api/issues/{key}/transition`**:
   - Updates `status_category` and `status_name` in SQLite `cached_issues`.
   - Records `action_type='transition_issue'`, `payload_json={"target_category": ..., "target_status": ...}` into `sync_outbox`.
   - Broadcasts `issue_transitioned` event via `ws_hub`.
   - Returns updated `JiraIssue` immediately.

2. **`PATCH /api/issues/{key}`**:
   - Computes partial fields provided in `IssueUpdateRequest`.
   - Updates only the specified fields in `cached_issues`.
   - Enqueues `action_type='update_issue'` with only those dirty fields in `payload_json`.
   - Broadcasts `issue_updated` event via `ws_hub`.
   - Returns updated `JiraIssue` immediately.

3. **`POST /api/issues`**:
   - If no issue key is provided, generates a local optimistic key `TEMP-<timestamp>`.
   - Saves new issue in SQLite `cached_issues`.
   - Enqueues `action_type='create_issue'` with the full creation payload.
   - Broadcasts `issue_created` event via `ws_hub`.
   - Returns the created `JiraIssue` immediately (status 201).

4. **`GET /api/board`**:
   - Reads directly from SQLite `cached_issues` and `cached_board_meta`.
   - Response time is < 5ms without network calls.

---

### 3.3 Asynchronous Outbox Worker (`backend/src/jira_dashboard/adapters/sync_worker.py`)

A background service `JiraSyncWorker`:
- Managed by FastAPI lifespan task.
- Iterates over pending items in `sync_outbox` ordered by `id ASC`.
- **Connectivity Check & Backoff**:
  - If a network or 5xx error occurs while communicating with Jira, back off (e.g. 5s, 10s, max 60s).
- **Execution & Conflict Resolution**:
  - For `update_issue` and `transition_issue`:
    - Checks remote Jira issue updated timestamp.
    - If remote timestamp > `base_updated_at`:
      - Marks outbox entry `status = 'skipped_conflict'`.
      - Updates SQLite `cached_issues` with remote Jira state.
      - Broadcasts update to clients over WebSockets.
    - If no conflict:
      - Calls Jira API with **only dirty fields** from `payload_json`.
      - On success: marks outbox entry `completed`.
  - For `create_issue`:
    - Calls Jira `create_issue`.
    - Once Jira returns the real key (e.g. `PROJ-108`), remaps `TEMP-...` to `PROJ-108` in SQLite and broadcasts the update.

---

### 3.4 Frontend Store & Offline Engine (`frontend/src/store/boardStore.ts`)

#### State Additions
```typescript
interface OfflineOutboxItem {
  id: string; // UUID / unique client mutation ID
  action: 'create_issue' | 'update_issue' | 'transition_issue';
  issueKey: string;
  payload: Record<string, unknown>; // Granular dirty fields only
  baseUpdatedAt?: string;
  createdAt: number;
}

interface BoardStoreState {
  // Existing state...
  offlineOutbox: OfflineOutboxItem[];
  syncStatus: 'synced' | 'syncing' | 'offline';
  pendingSyncCount: number;
  flushOfflineQueue: () => Promise<void>;
  // Actions...
}
```

#### Cross-View Reactivity & Filter Consistency
- Both `KanbanBoard` and `BacklogView` derive issues directly from `useBoardStore((s) => s.issues)`.
- When an issue in the Backlog is transitioned (e.g. marked "Done" or moved to "In Progress") while offline:
  1. The issue's `status.category` changes in local store immediately.
  2. Filter predicate `issue.status.name.toLowerCase() === 'backlog'` immediately becomes false.
  3. When viewing the Board, the issue is immediately visible in the "Done" column.
  4. Active filters ("Active", "Assigned to Me", "Hide Epics") recompute instantaneously.

#### Granular Update Detection
- In `updateIssueOptimistic(issueKey, updates)`:
  - Compares `updates` with existing issue to extract only modified fields.
  - Places only `{ assignee_name: updates.assignee_name }` in the queued outbox item if only the assignee changed.

#### Auto-Reconnection & Queue Flushing
- Listens to `window.addEventListener('online')` and WebSocket `onopen` events.
- Sequentially executes `flushOfflineQueue()`:
  - Pushes pending items to backend.
  - Handles `skipped_conflict` by adopting server response.
  - Updates `syncStatus` and clears `offlineOutbox`.

---

## 4. Verification & Testing Plan

### 4.1 Backend Automated Tests (`pytest` & `unittest`)
- **`test_storage.py`**:
  - Test SQLite table creation and `PRAGMA user_version` migrations.
  - Test safe schema upgrades preserving outbox records.
  - Test CRUD operations on `cached_issues` and `sync_outbox`.
- **`test_sync_worker.py`**:
  - Test outbox FIFO processing.
  - Test single-field update execution against mock Jira client.
  - Test simulated Jira outage: worker pauses, queue is preserved, resumes on recovery.
  - Test conflict resolution: local change with older `base_updated_at` is skipped; remote state is retained.
  - Test temp key remapping for created issues.
- **`test_api_offline.py`**:
  - Test `/api/issues/...` returns < 5ms with Jira offline.
  - Test WebSocket broadcasting of offline modifications.

### 4.2 Frontend Automated Tests (`Vitest`)
- **`boardStore.test.ts` & `offlineSync.test.ts`**:
  - Test offline transitions, updates, and creates queue to `localStorage`.
  - Test cross-view reactivity: mark backlog issue "Done" while offline $\rightarrow$ verify immediately present in board column.
  - Test single-field delta payload (only dirty fields included).
  - Test queue flushing upon reconnection.
  - Test remote conflict handling (server issue replaces local issue).

### 4.3 End-to-End Integration Verification
- Full pipeline execution via `./scripts/run_ci_locally.py` validating:
  - YAML workflow check
  - Ruff linting and formatting
  - Pytest and unittest suites
  - Vitest frontend test suite
  - TypeScript compilation and Vite production build
