# Technical Design: Issue Rank Sorting, Drag & Drop Ranking, and Offline Synchronization

**Date:** 2026-10-07  
**Status:** Validated & Approved  
**Author:** Antigravity AI & Human Collaborator  

---

## 1. Problem Statement & User Need

In the current dashboard:
1. Issues in columns on the **Kanban Board** and in lists on the **Backlog View** are not explicitly sorted by Jira `rank`.
2. Dragging an issue within the same column or within the same backlog/sprint list immediately reverts to its original position upon drop, because drag-end logic only handled cross-column status transitions and lacked rank reordering logic.
3. Users need issues ordered according to Jira's rank (ascending LexoRank order).
4. Users need drag & drop to dynamically recalculate and persist an issue's rank—both when reordering within a column/list and across columns.
5. The system must support **offline mode** and **bidirectional syncing** with Jira across both backend and frontend:
   - When offline, reordering updates the UI optimistically ($< 50\text{ms}$) and queues rank mutations in the frontend local storage outbox and backend SQLite outbox.
   - When connection is restored, pending rank mutations are flushed to the backend and Jira Agile APIs without losing local rank placement.
6. The capability must be verified with backend unit/integration tests, frontend tests, and automated Playwright visual screenshot regression tests.

---

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Frontend ["Frontend (React 19 + Zustand)"]
        UI["Kanban Board / Backlog View (dnd-kit)"]
        Store["Zustand BoardStore (Optimistic State)"]
        OutboxLocal["localStorage Offline Outbox (ha_jira_offline_outbox_v1)"]
        CacheLocal["localStorage Board Cache (ha_jira_board_cache_v1)"]
    end

    subgraph Backend ["Backend (FastAPI + SQLite)"]
        API["REST API (/api/issues/{key}/rank)"]
        SQLiteCache["SQLite cached_issues (rank TEXT column)"]
        SQLiteOutbox["SQLite sync_outbox (action_type: rank_issue)"]
        SyncWorker["JiraSyncWorker (Background Drain)"]
        WS["WebSocket Broadcast Hub (/ws)"]
    end

    subgraph Jira ["Jira Software (Cloud / Data Center)"]
        JiraAPI["Agile API (PUT /rest/agile/1.0/issue/rank)"]
    end

    UI -->|Drag & Drop Card (<50ms)| Store
    Store -->|Optimistic Reorder & Cache| CacheLocal
    Store -->|If Online: PUT /api/issues/{key}/rank| API
    Store -->|If Offline: Queue rank_issue| OutboxLocal

    API -->|Persist New Rank| SQLiteCache
    API -->|If Jira Online: Push Direct| JiraAPI
    API -->|If Jira Offline: Queue Outbox| SQLiteOutbox
    API -->|Broadcast Delta| WS
    WS -->|WebSocket Push| Store

    SyncWorker -->|Drain Pending rank_issue| SQLiteOutbox
    SyncWorker -->|PUT /rest/agile/1.0/issue/rank| JiraAPI
    SyncWorker -->|Update Status to completed| SQLiteOutbox

    OutboxLocal -->|On Reconnect: flushOfflineQueue| API
```

---

## 3. Detailed Component Design

### 3.1 Domain Model & Schema Migration
1. **Domain Model (`backend/src/jira_dashboard/domain/models.py`)**:
   - Add `rank: str | None = None` to `JiraIssue`.
2. **SQLite Storage (`backend/src/jira_dashboard/adapters/storage.py`)**:
   - Update `cached_issues` table schema to include `rank TEXT`.
   - Implement automatic non-destructive column migration in `init_db()`: check `PRAGMA table_info(cached_issues)` and execute `ALTER TABLE cached_issues ADD COLUMN rank TEXT;` if missing.
   - Update `_upsert_issue_unlocked()` to persist `issue.rank`.
   - Update `get_issues()` query:
     ```sql
     SELECT * FROM cached_issues 
     ORDER BY CASE WHEN rank IS NOT NULL AND rank != '' THEN 0 ELSE 1 END,
              rank ASC,
              updated_at DESC;
     ```
   - Support `action_type = "rank_issue"` in `sync_outbox`.

### 3.2 Jira Client Adapters
1. **Interface (`JiraClientProtocol`)**:
   - Define:
     ```python
     async def rank_issue(
         self,
         issue_key: str,
         rank_before_key: str | None = None,
         rank_after_key: str | None = None,
         target_rank: str | None = None,
     ) -> JiraIssue: ...
     ```
2. **`FakeJiraClient` (`backend/src/jira_dashboard/adapters/jira_client.py`)**:
   - Add default `rank` strings to `DEFAULT_SEED_ISSUES` (`"0|i00001:"`, `"0|i00002:"`, `"0|i00003:"`, `"0|i00004:"`, `"0|i00005:"`, `"0|i00006:"`).
   - Implement `rank_issue()`: reorders `self._issues` based on `rank_before_key` / `rank_after_key` and assigns an interpolated or synthetic LexoRank.
3. **`JiraCloudClient` (`backend/src/jira_dashboard/adapters/jira_cloud_client.py`)**:
   - In `_parse_issue()`: inspect fields for `customfield_10019`, `rank`, or `customfield_10009` and populate `issue.rank`.
   - In `rank_issue()`: execute `PUT /rest/agile/1.0/issue/rank` passing `{"issues": [issue_key], "rankBeforeIssue": rank_before_key}` or `{"rankAfterIssue": rank_after_key}`.

### 3.3 Backend API & Sync Worker
1. **Presentation API (`backend/src/jira_dashboard/presentation/main.py`)**:
   - Add endpoint `PUT /api/issues/{key}/rank` (and `POST /api/issues/{key}/rank` for compatibility):
     ```python
     class RankIssueRequest(BaseModel):
         rank_before_key: str | None = None
         rank_after_key: str | None = None
         rank: str | None = None
     ```
   - In handler:
     - Find issue in cache/storage.
     - Calculate or accept new rank, update SQLite `cached_issues`.
     - Try calling `jira_client.rank_issue(...)`.
     - If Jira fails (network/500), queue `rank_issue` into SQLite `sync_outbox`.
     - Broadcast WebSocket event `issue_ranked` with the updated issue payload.
2. **Background Sync Worker (`backend/src/jira_dashboard/adapters/sync_worker.py`)**:
   - In `process_next_pending()`: add branch for `action_type == "rank_issue"`.
   - In `_process_rank()`: call `jira_client.rank_issue(...)`, update SQLite, and broadcast `issue_ranked`.

### 3.4 Frontend Utilities & Zustand Store
1. **TypeScript Types (`frontend/src/types/jira.ts`)**:
   - Add `rank?: string` to `JiraIssue`.
   - Add `'rank_issue'` to `OfflineOutboxItem.action`.
2. **Rank Calculation Utilities (`frontend/src/utils/boardUtils.ts`)**:
   - `sortIssuesByRank(issues: JiraIssue[]): JiraIssue[]`:
     Sorts issues by `rank` ascending using standard lexicographical comparison (`localeCompare` or character comparison), falling back to `updated_at DESC` or `key`.
   - `calculateRankBetween(prevRank?: string | null, nextRank?: string | null): string`:
     Calculates an interpolated LexoRank string between two neighboring ranks (or generates appropriate prefix/suffix if at list boundaries).
3. **Zustand Board Store (`frontend/src/store/boardStore.ts`)**:
   - Add `rankIssueOptimistic(issueKey: string, rankBeforeKey?: string, rankAfterKey?: string, targetRank?: string): Promise<void>`.
   - Optimistic Update ($< 50\text{ms}$):
     - Compute new rank string.
     - Update issue in `state.issues` and re-sort array via `sortIssuesByRank`.
     - Save immediately to `localStorage` board cache.
   - Background API Sync:
     - If online: send `PUT /api/issues/${issueKey}/rank`.
     - If offline / fetch fails: append `OfflineOutboxItem` with action `'rank_issue'`, mark `syncStatus: 'offline'`, persist to `ha_jira_offline_outbox_v1`.
   - Offline Queue Drain (`flushOfflineQueue`):
     - When reconnected, dispatch `PUT /api/issues/${item.issueKey}/rank` for pending `'rank_issue'` items.
   - WebSocket Message Handling:
     - On `issue_ranked` or `issue_updated`, merge issue and sort issues by rank.

### 3.5 Drag & Drop Integration
1. **`KanbanBoard.tsx`**:
   - In `handleDragEnd`:
     - If dropped over an issue in the same column:
       - Find target index relative to `over.id`.
       - Compute `rankBeforeKey`, `rankAfterKey`, and new rank using `calculateRankBetween`.
       - Call `rankIssueOptimistic(activeKey, rankBeforeKey, rankAfterKey, newRank)`.
     - If dropped over an issue in a different column:
       - Call `transitionIssueOptimistic` to change column status.
       - Simultaneously update its rank relative to its new neighbor issues in the destination column!
2. **`BacklogView.tsx`**:
   - In `handleDragEnd`:
     - Reordering within Sprint List or Backlog List:
       - Determine new neighbor issues (`rankBeforeKey`, `rankAfterKey`).
       - Compute interpolated rank and invoke `rankIssueOptimistic`.
       - Prevent rolling back!

---

## 4. Verification & Testing Plan

1. **Backend Tests**:
   - Unit tests in `test_domain_models.py` verifying `rank` on `JiraIssue`.
   - Storage tests in `test_storage.py` verifying schema migration, storing `rank`, and querying `get_issues()` ordered by rank.
   - API tests in `test_api.py` and `test_api_offline.py` verifying `PUT /api/issues/{key}/rank`, outbox enqueuing, and offline drain.
   - Sync worker tests in `test_sync_worker.py` verifying `_process_rank` and conflict handling.
2. **Frontend Tests**:
   - Unit tests in `boardUtils.test.ts` for `sortIssuesByRank` and `calculateRankBetween`.
   - Store tests in `boardStore.test.ts` and `offlineReactivity.test.ts` for optimistic rank updates and offline queue flushing.
   - Integration / component tests in `KanbanBoard.test.tsx` and `BacklogView.test.tsx` verifying drag reordering triggers rank updates.
3. **Playwright Visual Screenshot Tests**:
   - In `frontend/tests/visual/screenshots.spec.ts`:
     - Add screenshot test capturing the board sorted by rank.
     - Add screenshot test capturing the board after a drag-and-drop card reordering, ensuring the new rank order persists visually.
4. **Local CI Verification**:
   - Run `./scripts/run_ci_locally.py` to ensure Ruff, Pytest, Unittest, Vitest, and TypeScript builds all pass with 100% success.
