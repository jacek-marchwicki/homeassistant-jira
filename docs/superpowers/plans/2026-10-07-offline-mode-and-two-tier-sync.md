# Offline Mode & Two-Tier Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full offline-first functionality with two-tier synchronization (Backend ↔ Jira and Web Client ↔ Backend), immediate optimistic UI mutation, cross-view reactivity (Backlog ↔ Board), granular field-level updates, and remote-wins conflict resolution.

**Architecture:** A local SQLite database provides crash-resilient persistence on the backend with a transactional outbox queue (`sync_outbox`) drained by an asynchronous background worker (`JiraSyncWorker`). The frontend web client maintains local optimistic state in Zustand backed by a persistent localStorage queue (`ha_jira_offline_outbox_v1`) that automatically flushes when connection is restored, skipping local changes on conflict.

**Tech Stack:** Python 3.10+, FastAPI, SQLite (`sqlite3` stdlib), React 19, TypeScript, Zustand, Vite, Vitest, Pytest.

**Spec:** [`docs/superpowers/specs/2026-10-07-offline-mode-and-two-tier-sync-design.md`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/docs/superpowers/specs/2026-10-07-offline-mode-and-two-tier-sync-design.md)

## Global Constraints

- Backend must use Python standard library `sqlite3` (no external ORM or SQLite library dependencies).
- Default SQLite database path is `/data/jira_dashboard.sqlite3` with fallback to `./data/jira_dashboard.sqlite3` or in-memory `:memory:` for testing.
- Single-field updates must contain only modified fields in `payload_json` and Jira API calls.
- Conflict resolution is remote-wins: if remote Jira issue timestamp is newer than `base_updated_at`, outbox item is marked `skipped_conflict` and remote data is adopted.
- Cross-view reactivity: marking an issue as "Done" while in Backlog view offline immediately reflects it in Board view "Done" column.
- All code changes must pass `./scripts/run_ci_locally.py` cleanly.

## Review Focus

1. **Jira Unreachable During Boot**: Backend boots cleanly and serves `/api/board` and mutations from SQLite even when Jira credentials are invalid or Jira is down.
2. **Backlog to Done Status Mapping**: When a Backlog item is marked "Done" offline, `status.category` transitions from `todo` to `done`, moving the issue from backlog list to the board "Done" column without network calls.
3. **Partial Update Field Leakage**: Updating only `assignee` must not send `summary`, `description`, or other fields in Jira API calls or outbox payload.
4. **Outbox Preservation on Schema Upgrade**: Schema migration checks `user_version` and preserves pending outbox mutations even if cached issue tables are reset.
5. **Conflict Rollback on Web Client**: If server or Jira rejects a change due to newer remote edit, client silently adopts server issue state and clears outbox item.

---

### Task 1: Backend SQLite Persistence & Schema Management

**Files:**
- Create: `backend/src/jira_dashboard/adapters/storage.py`
- Test: `backend/tests/test_storage.py`

**Interfaces:**
- Produces:
  - `class SQLiteStorage`:
    - `__init__(self, db_path: Path | str = ":memory:")`
    - `init_db(self) -> None`
    - `save_board_meta(self, board_id: str, board_name: str, sprint_name: str | None, jira_url: str | None, columns: list[BoardColumn]) -> None`
    - `get_board_meta(self, board_id: str) -> BoardResponse | None`
    - `save_issues(self, issues: list[JiraIssue]) -> None`
    - `get_issues(self) -> list[JiraIssue]`
    - `get_issue(self, key: str) -> JiraIssue | None`
    - `upsert_issue(self, issue: JiraIssue) -> None`
    - `enqueue_outbox(self, client_mutation_id: str, action_type: str, issue_key: str, payload: dict[str, Any], base_updated_at: str | None) -> int`
    - `get_pending_outbox(self) -> list[dict[str, Any]]`
    - `update_outbox_status(self, outbox_id: int, status: str, error_message: str | None = None) -> None`

- [ ] **Step 1: Write failing unit tests for SQLiteStorage in `backend/tests/test_storage.py`**

Test initialization, `PRAGMA user_version`, issue upsert, granular outbox enqueueing, pending retrieval, and outbox status transitions.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_storage.py -v`  
Expected: FAIL with `ModuleNotFoundError: No module named 'jira_dashboard.adapters.storage'`

- [ ] **Step 3: Implement `SQLiteStorage` in `backend/src/jira_dashboard/adapters/storage.py`**

Implement connection handling, thread-safe sqlite3 operations, migrations, issue serialization, and outbox methods.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_storage.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/storage.py backend/tests/test_storage.py
git commit -m "feat(backend): add SQLite persistence and outbox storage"
```

---

### Task 2: Asynchronous Jira Outbox Worker & Conflict Resolution

**Files:**
- Create: `backend/src/jira_dashboard/adapters/sync_worker.py`
- Test: `backend/tests/test_sync_worker.py`

**Interfaces:**
- Consumes:
  - `SQLiteStorage` from `backend/src/jira_dashboard/adapters/storage.py`
  - `JiraClientProtocol` from `backend/src/jira_dashboard/adapters/jira_client.py`
- Produces:
  - `class JiraSyncWorker`:
    - `__init__(self, storage: SQLiteStorage, jira_client: JiraClientProtocol, ws_broadcast_func: Callable | None = None)`
    - `async process_next_pending(self) -> bool`
    - `async run_sync_loop(self, stop_event: asyncio.Event) -> None`

- [ ] **Step 1: Write failing unit tests for JiraSyncWorker in `backend/tests/test_sync_worker.py`**

Test:
- FIFO execution of outbox items against `FakeJiraClient`.
- Field-level partial updates (ensuring only dirty fields are sent).
- Offline handling / Jira 503 error backoff (leaves outbox pending).
- Conflict resolution (remote `updated_at` newer than `base_updated_at` marks outbox `skipped_conflict` and updates storage with remote issue).
- Temp key remapping for created issues.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_sync_worker.py -v`  
Expected: FAIL with `ModuleNotFoundError: No module named 'jira_dashboard.adapters.sync_worker'`

- [ ] **Step 3: Implement `JiraSyncWorker` in `backend/src/jira_dashboard/adapters/sync_worker.py`**

Implement outbox processing loop, error handling with backoff, conflict check against `issue.updated_at`, partial field forwarding, and WebSocket delta broadcast.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_sync_worker.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/sync_worker.py backend/tests/test_sync_worker.py
git commit -m "feat(backend): implement asynchronous Jira outbox sync worker and conflict resolution"
```

---

### Task 3: Backend API Integration with Immediate Storage & Outbox

**Files:**
- Modify: `backend/src/jira_dashboard/presentation/main.py`
- Modify: `backend/src/jira_dashboard/config.py`
- Create: `backend/tests/test_api_offline.py`

**Interfaces:**
- Consumes:
  - `SQLiteStorage` and `JiraSyncWorker`
- Produces:
  - Immediate response (<5ms) for `/api/issues/{key}/transition`, `/api/issues/{key}`, and `/api/issues` updating SQLite and queuing outbox without awaiting Jira API.
  - Startup lifespan initializes storage, seeds initial board cache if empty, and launches sync worker task.

- [ ] **Step 1: Write failing tests for offline API mutations in `backend/tests/test_api_offline.py`**

Test:
- When Jira client is failing (simulated 500/503), transition/update/create endpoints succeed immediately with 200/201.
- `/api/board` immediately serves persisted issues from SQLite.
- Mutation adds pending entry in SQLite `sync_outbox`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_api_offline.py -v`  
Expected: FAIL (currently API throws 500 when Jira client fails)

- [ ] **Step 3: Integrate `storage` and `sync_worker` into `main.py` and `config.py`**

Update `JiraDashboardSettings` with `sqlite_db_path`.
In `main.py`, wire up storage and worker during lifespan. Update `transition_issue`, `update_issue`, `create_issue` to write to SQLite, enqueue outbox, broadcast, and return immediately.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_api_offline.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/config.py backend/src/jira_dashboard/presentation/main.py backend/tests/test_api_offline.py
git commit -m "feat(backend): wire immediate SQLite persistence and outbox queuing into API endpoints"
```

---

### Task 4: Frontend Granular Outbox Queue & Reconnection Engine

**Files:**
- Modify: `frontend/src/store/boardStore.ts`
- Modify: `frontend/src/store/boardStore.test.ts`

**Interfaces:**
- Produces:
  - `offlineOutbox: OfflineOutboxItem[]` in store state.
  - `syncStatus: 'synced' | 'syncing' | 'offline'` in store state.
  - `flushOfflineQueue: () => Promise<void>`
  - Persistence of outbox queue to `localStorage` (`ha_jira_offline_outbox_v1`).
  - Granular dirty-field extraction in `updateIssueOptimistic`.
  - Offline retry and flush on reconnection.

- [ ] **Step 1: Write failing tests in `frontend/src/store/boardStore.test.ts` for offline queue and field-level delta**

Test:
- Offline transition appends to `offlineOutbox` in `localStorage`.
- Updating only `assignee` queues only `{ assignee_name: ... }` in the outbox payload.
- `flushOfflineQueue` flushes items in FIFO order, updates issue state, and removes item from outbox.
- Conflict from server (e.g. status 409 or newer issue snapshot) skips local mutation and adopts server snapshot.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm --dir frontend test src/store/boardStore.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement outbox queuing and flush engine in `frontend/src/store/boardStore.ts`**

Update `useBoardStore` to manage `offlineOutbox`, save to `localStorage`, calculate dirty field deltas, handle `flushOfflineQueue()`, and update `syncStatus`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm --dir frontend test src/store/boardStore.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/boardStore.ts frontend/src/store/boardStore.test.ts
git commit -m "feat(frontend): add persistent offline outbox queue and reconnection engine"
```

---

### Task 5: Frontend Cross-View Offline Reactivity & Reactive Filtering Tests

**Files:**
- Create: `frontend/src/store/offlineReactivity.test.ts`
- Modify: `frontend/src/components/Header.tsx` (add offline/sync status badge)
- Test: `frontend/src/components/Header.test.tsx`

**Interfaces:**
- Produces:
  - Real-time cross-view reactivity: Backlog ticket marked "Done" offline immediately reflects in Board view and filter sets.
  - Header badge reflecting `synced`, `syncing`, or `offline (N pending)`.

- [ ] **Step 1: Write tests in `frontend/src/store/offlineReactivity.test.ts`**

Test:
- Issue in Backlog view transitioned to "Done" while offline (`fetch` throws network error):
  - Store updates `status.category` to `'done'` immediately.
  - Issue is excluded from backlog list.
  - Issue appears in Board columns under "Done".
  - Active filters ("Active", "Assigned to Me", "Hide Epics") filter correctly offline.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm --dir frontend test src/store/offlineReactivity.test.ts`  
Expected: Verify test fails or setup needed.

- [ ] **Step 3: Implement Header sync badge and verify reactive filtering**

Ensure `Header.tsx` displays the sync status indicator (Synced, Syncing, Offline with count). Ensure `offlineReactivity.test.ts` passes completely.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm --dir frontend test src/store/offlineReactivity.test.ts src/components/Header.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/offlineReactivity.test.ts frontend/src/components/Header.tsx frontend/src/components/Header.test.tsx
git commit -m "feat(frontend): verify cross-view offline reactivity and add sync status badge"
```

---

### Task 6: Full Verification with Mock API and CI Runner

**Files:**
- Modify/Extend: `backend/tests/test_integration.py`
- Execute: `./scripts/run_ci_locally.py`

**Interfaces:**
- End-to-end simulation of offline operations:
  1. Offline mode: Backend accepts edits without Jira, Frontend queues offline.
  2. Reconnect: Backend outbox worker syncs to Jira mock API.
  3. Conflict: Remote Jira edit supersedes local pending edit; local edit skipped.
  4. CI Verification: 100% pass across Ruff, Pytest, Unittest, Vitest, and TypeScript production build.

- [ ] **Step 1: Add integration tests in `backend/tests/test_integration.py`**

Add tests exercising full offline cycle: disconnect Jira mock, mutate issues via HTTP, verify local SQLite state, reconnect Jira mock, drain worker, verify Jira mock has updates. Add conflict test verifying local change skip.

- [ ] **Step 2: Run backend tests**

Run: `pytest backend/tests -v`  
Expected: PASS

- [ ] **Step 3: Run full local CI suite**

Run: `./scripts/run_ci_locally.py`  
Expected: 100% PASS across all verification steps.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_integration.py
git commit -m "test: add integration test suite for two-tier offline sync and conflict resolution"
```
