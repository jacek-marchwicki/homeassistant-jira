# Issue Rank Sorting, Drag & Drop Ranking, and Offline Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Jira issue sorting by "rank", drag & drop reordering that modifies rank without rolling back, and bidirectional offline mode and syncing for both backend and frontend.

**Architecture:** Extend domain `JiraIssue` with `rank`, update SQLite storage with schema migration and rank-first sorting, implement Jira Agile ranking protocol (`rank_issue`) in `FakeJiraClient` and `JiraCloudClient`, expose `PUT /api/issues/{key}/rank` backed by the transactional outbox (`sync_outbox`) and WebSocket broadcast, implement frontend LexoRank interpolation and optimistic updates in Zustand, integrate DnD-Kit reordering across Kanban and Backlog views, and add Playwright visual screenshot regression tests.

**Tech Stack:** Python 3.10+, FastAPI, Pydantic v2, SQLite3, React 19, TypeScript, Zustand, @dnd-kit, Vitest, Playwright, Tailwind CSS v4.

**Spec:** [`docs/superpowers/specs/2026-10-07-issue-rank-drag-drop-offline-sync-design.md`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/docs/superpowers/specs/2026-10-07-issue-rank-drag-drop-offline-sync-design.md)

## Global Constraints

- Backend must comply with PEP 8 and pass `ruff check` and `ruff format --check`.
- Frontend must comply with TypeScript strict mode and pass `tsc -b` and `vite build`.
- Relative asset paths (`base: './'`) and dynamic Ingress pathing must be maintained.
- Optimistic mutations must settle within $< 50\text{ms}$ with graceful rollback on permanent server rejection.
- All tests must pass locally via `./scripts/run_ci_locally.py`.

## Review Focus

1. **Reordering within the same column or list without moving to a new status:** must not revert or snap back to original position on drop; rank must be updated and cards must remain in new order.
2. **Offline reordering:** drag and drop while network is severed must persist rank order in `localStorage` and queue `rank_issue` in outbox, flushing seamlessly upon reconnection without losing placement.
3. **Existing database migration:** databases created prior to the `rank` column must migrate cleanly on startup via non-destructive `ALTER TABLE` without crashing or dropping data.
4. **Intermediate rank calculation:** dropping an issue between two adjacent cards with dense ranks must correctly interpolate a midpoint LexoRank string or fractional rank.
5. **Drag and drop across columns:** dropping into a target column at a specific vertical index must update both the column status and the relative rank among destination cards.

---

### Task 1: Domain Model & SQLite Storage Rank Schema & Migration

**Files:**
- Modify: `backend/src/jira_dashboard/domain/models.py:84-110`
- Modify: `backend/src/jira_dashboard/adapters/storage.py:79-125, 230-365`
- Test: `backend/tests/test_domain_models.py`
- Test: `backend/tests/test_storage.py`

**Interfaces:**
- Produces: `JiraIssue.rank: str | None = None`
- Produces: `SQLiteStorage.get_issues()` ordered by rank ascending (`CASE WHEN rank IS NOT NULL AND rank != '' THEN 0 ELSE 1 END, rank ASC, updated_at DESC`)
- Produces: `SQLiteStorage.init_db()` with automatic migration for `rank TEXT`

- [ ] **Step 1: Write failing tests for JiraIssue rank attribute and SQLite storage rank persistence & sorting**

In `backend/tests/test_domain_models.py`:
```python
def test_jira_issue_rank_field():
    issue = JiraIssue(
        id="1", key="PROJ-1", summary="Task 1", issue_type=IssueType.TASK,
        priority=Priority.HIGH, status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        rank="0|i00001:", updated_at="2026-10-01T00:00:00Z"
    )
    assert issue.rank == "0|i00001:"
```

In `backend/tests/test_storage.py`:
```python
def test_storage_rank_persistence_and_sorting(temp_storage):
    issue_b = JiraIssue(
        id="2", key="PROJ-2", summary="Second", issue_type=IssueType.TASK,
        priority=Priority.MEDIUM, status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        rank="0|i00002:", updated_at="2026-10-01T00:00:00Z"
    )
    issue_a = JiraIssue(
        id="1", key="PROJ-1", summary="First", issue_type=IssueType.TASK,
        priority=Priority.HIGH, status=JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
        rank="0|i00001:", updated_at="2026-10-01T00:00:00Z"
    )
    temp_storage.save_issues([issue_b, issue_a])
    issues = temp_storage.get_issues()
    assert [i.key for i in issues] == ["PROJ-1", "PROJ-2"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/tests/test_domain_models.py backend/tests/test_storage.py -k "rank"`
Expected: FAIL

- [ ] **Step 3: Implement rank field in JiraIssue and SQLiteStorage schema & queries**

1. Update `JiraIssue` in `backend/src/jira_dashboard/domain/models.py` to add `rank: str | None = None`.
2. Update `cached_issues` table DDL in `backend/src/jira_dashboard/adapters/storage.py` to include `rank TEXT`.
3. In `init_db()`, add table introspection via `PRAGMA table_info(cached_issues)`: if `rank` column is not present, execute `ALTER TABLE cached_issues ADD COLUMN rank TEXT;`.
4. Update `_row_to_issue`, `_upsert_issue_unlocked`, and `get_issues()` in `storage.py` to store, restore, and sort by rank.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_domain_models.py backend/tests/test_storage.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/domain/models.py backend/src/jira_dashboard/adapters/storage.py backend/tests/test_domain_models.py backend/tests/test_storage.py
git commit -m "feat: add rank field to domain models and SQLite storage schema with auto-migration"
```

---

### Task 2: Jira Clients (FakeJiraClient & JiraCloudClient) Ranking Adapter

**Files:**
- Modify: `backend/src/jira_dashboard/adapters/jira_client.py:55-270, 338-410`
- Modify: `backend/src/jira_dashboard/adapters/jira_cloud_client.py:99-116, 264-350, 700-750`
- Test: `backend/tests/test_jira_client.py`
- Test: `backend/tests/test_jira_cloud_client.py`

**Interfaces:**
- Produces: `JiraClientProtocol.rank_issue(issue_key, rank_before_key, rank_after_key, target_rank) -> JiraIssue`
- Produces: `FakeJiraClient.rank_issue` reordering issues and calculating rank
- Produces: `JiraCloudClient.rank_issue` calling `PUT /rest/agile/1.0/issue/rank`

- [ ] **Step 1: Write failing tests for rank_issue in FakeJiraClient and JiraCloudClient**

In `backend/tests/test_jira_client.py`:
```python
@pytest.mark.asyncio
async def test_fake_jira_client_rank_issue():
    client = FakeJiraClient()
    # Move PROJ-101 after PROJ-98
    updated = await client.rank_issue("PROJ-101", rank_after_key="PROJ-98")
    assert updated.key == "PROJ-101"
    issues = await client.get_board_issues("engineering-1")
    keys = [i.key for i in issues]
    assert keys.index("PROJ-98") < keys.index("PROJ-101")
```

In `backend/tests/test_jira_cloud_client.py`:
```python
@pytest.mark.asyncio
async def test_jira_cloud_client_rank_issue(httpx_mock):
    httpx_mock.add_response(
        method="PUT",
        url="https://test.atlassian.net/rest/agile/1.0/issue/rank",
        status_code=204,
    )
    # mock get_issue return
    ...
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/tests/test_jira_client.py backend/tests/test_jira_cloud_client.py -k "rank"`
Expected: FAIL

- [ ] **Step 3: Implement rank_issue across protocol and clients**

1. In `jira_client.py`, add `DEFAULT_SEED_ISSUES` ranks (`"0|i00001:"`, `"0|i00002:"`, etc.).
2. Add `rank_issue` to `JiraClientProtocol` and `FakeJiraClient`.
3. In `jira_cloud_client.py`:
   - Add `"customfield_10019"`, `"rank"` to `JIRA_ISSUE_FIELDS`.
   - In `_parse_issue`: parse rank from `fields.get("customfield_10019") or fields.get("rank")`.
   - Implement `rank_issue(issue_key, rank_before_key, rank_after_key, target_rank)` issuing `PUT /rest/agile/1.0/issue/rank`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_jira_client.py backend/tests/test_jira_cloud_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/jira_client.py backend/src/jira_dashboard/adapters/jira_cloud_client.py backend/tests/test_jira_client.py backend/tests/test_jira_cloud_client.py
git commit -m "feat: implement rank_issue in JiraClientProtocol FakeJiraClient and JiraCloudClient"
```

---

### Task 3: Backend Outbox Sync Worker & REST API Endpoint `/api/issues/{key}/rank`

**Files:**
- Modify: `backend/src/jira_dashboard/adapters/sync_worker.py:65-110, 200-260`
- Modify: `backend/src/jira_dashboard/presentation/main.py:461-550`
- Test: `backend/tests/test_sync_worker.py`
- Test: `backend/tests/test_api.py`
- Test: `backend/tests/test_api_offline.py`

**Interfaces:**
- Produces: `PUT /api/issues/{key}/rank` endpoint
- Produces: `sync_outbox` processing of `action_type == "rank_issue"` in `JiraSyncWorker`
- Produces: WebSocket broadcast `issue_ranked`

- [ ] **Step 1: Write failing tests for /api/issues/{key}/rank and sync_worker rank processing**

In `backend/tests/test_api.py`:
```python
def test_rank_issue_endpoint(client):
    res = client.put("/api/issues/PROJ-101/rank", json={"rank_after_key": "PROJ-98"})
    assert res.status_code == 200
    data = res.json()
    assert data["key"] == "PROJ-101"
    assert data["rank"] is not None
```

In `backend/tests/test_sync_worker.py`:
```python
@pytest.mark.asyncio
async def test_sync_worker_processes_rank_issue(worker_harness):
    ...
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest backend/tests/test_api.py backend/tests/test_sync_worker.py -k "rank"`
Expected: FAIL

- [ ] **Step 3: Implement rank endpoint in main.py and _process_rank in sync_worker.py**

1. Define `RankIssueRequest` in `main.py` with `rank_before_key`, `rank_after_key`, and `rank`.
2. Add `@app.put("/api/issues/{key}/rank", response_model=JiraIssue)`:
   - Updates local SQLite issue rank.
   - Enqueues to `sync_outbox` if Jira unreachable or offline.
   - Broadcasts `issue_ranked` WebSocket delta.
3. In `sync_worker.py`, handle `action_type == "rank_issue"`:
   - Calls `jira_client.rank_issue(...)`.
   - Updates SQLite cache and broadcasts WebSocket event.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest backend/tests/test_api.py backend/tests/test_sync_worker.py backend/tests/test_api_offline.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/sync_worker.py backend/src/jira_dashboard/presentation/main.py backend/tests/test_api.py backend/tests/test_sync_worker.py backend/tests/test_api_offline.py
git commit -m "feat: add rank issue API endpoint and outbox synchronization worker handler"
```

---

### Task 4: Frontend Types, LexoRank Utilities & Zustand Board Store Optimistic Rank Mutation

**Files:**
- Modify: `frontend/src/types/jira.ts:42-70, 97-125`
- Modify: `frontend/src/utils/boardUtils.ts:1-120`
- Modify: `frontend/src/store/boardStore.ts:36-45, 134-165, 430-740`
- Test: `frontend/src/utils/boardUtils.test.ts`
- Test: `frontend/src/store/boardStore.test.ts`
- Test: `frontend/src/store/offlineReactivity.test.ts`

**Interfaces:**
- Produces: `JiraIssue.rank?: string`
- Produces: `sortIssuesByRank(issues: JiraIssue[]): JiraIssue[]`
- Produces: `calculateRankBetween(prevRank?: string | null, nextRank?: string | null): string`
- Produces: `useBoardStore.getState().rankIssueOptimistic(issueKey, rankBeforeKey, rankAfterKey, targetRank)`
- Produces: `flushOfflineQueue()` draining `rank_issue` actions

- [ ] **Step 1: Write failing tests for sortIssuesByRank, calculateRankBetween, and rankIssueOptimistic**

In `frontend/src/utils/boardUtils.test.ts`:
```typescript
it('sorts issues ascending by rank', () => {
  const issues = [
    { key: 'B', rank: '0|i00002:' },
    { key: 'A', rank: '0|i00001:' },
    { key: 'C', rank: '0|i00003:' },
  ] as any;
  const sorted = sortIssuesByRank(issues);
  expect(sorted.map(i => i.key)).toEqual(['A', 'B', 'C']);
});

it('calculates intermediate rank between two ranks', () => {
  const rank = calculateRankBetween('0|i00001:', '0|i00003:');
  expect(rank > '0|i00001:').toBe(true);
  expect(rank < '0|i00003:').toBe(true);
});
```

In `frontend/src/store/boardStore.test.ts`:
```typescript
it('rankIssueOptimistic updates issue rank instantly and re-sorts issues', async () => {
  // test optimistic state update
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm --dir frontend test src/utils/boardUtils.test.ts src/store/boardStore.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement rank types, utilities, and Zustand optimistic store actions**

1. In `types/jira.ts`, add `rank?: string` to `JiraIssue`, and `'rank_issue'` to `OfflineOutboxItem.action`.
2. In `boardUtils.ts`, implement `sortIssuesByRank` and `calculateRankBetween`.
3. In `boardStore.ts`:
   - Implement `rankIssueOptimistic`.
   - Update `loadCachedBoard` and `loadBoard` to apply `sortIssuesByRank`.
   - Queue `rank_issue` into `ha_jira_offline_outbox_v1` if offline.
   - Update `flushOfflineQueue` to handle `item.action === 'rank_issue'`.
   - Handle WebSocket `issue_ranked` in `handleWsMessage`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --dir frontend test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/jira.ts frontend/src/utils/boardUtils.ts frontend/src/store/boardStore.ts frontend/src/utils/boardUtils.test.ts frontend/src/store/boardStore.test.ts frontend/src/store/offlineReactivity.test.ts
git commit -m "feat: implement frontend rank sorting utilities and Zustand optimistic ranking actions"
```

---

### Task 5: Drag-and-Drop Rank Reordering in KanbanBoard and BacklogView

**Files:**
- Modify: `frontend/src/components/KanbanBoard.tsx:170-220`
- Modify: `frontend/src/components/BacklogView.tsx:100-145`
- Test: `frontend/src/components/KanbanBoard.test.tsx`
- Test: `frontend/src/components/BacklogView.test.tsx`

**Interfaces:**
- Produces: `KanbanBoard` reordering items within same column or across columns with calculated rank
- Produces: `BacklogView` reordering items within sprint or backlog with calculated rank

- [ ] **Step 1: Write failing tests verifying drag and drop reordering updates rank and does not snap back**

In `frontend/src/components/KanbanBoard.test.tsx`:
- Test that dropping an issue onto another issue in the same column triggers `rankIssueOptimistic`.

In `frontend/src/components/BacklogView.test.tsx`:
- Test that dropping an issue onto another issue in the sprint list or backlog list triggers `rankIssueOptimistic`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm --dir frontend test src/components/KanbanBoard.test.tsx src/components/BacklogView.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement drag-and-drop rank reordering handlers**

1. In `KanbanBoard.tsx`:
   - Detect if dropped `over` another issue card within the same column or another column.
   - Calculate target neighbor issues (`rankBeforeKey`, `rankAfterKey`) and intermediate rank.
   - Call `rankIssueOptimistic(activeKey, rankBeforeKey, rankAfterKey, newRank)` (and `transitionIssueOptimistic` if column changed).
2. In `BacklogView.tsx`:
   - Detect if dropped `over` another row in the same sprint or backlog section.
   - Calculate neighbor issues and call `rankIssueOptimistic`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm --dir frontend test src/components/KanbanBoard.test.tsx src/components/BacklogView.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/KanbanBoard.tsx frontend/src/components/BacklogView.tsx frontend/src/components/KanbanBoard.test.tsx frontend/src/components/BacklogView.test.tsx
git commit -m "feat: enable drag and drop rank reordering in Kanban board and Backlog views"
```

---

### Task 6: Visual Screenshot Tests (Playwright)

**Files:**
- Modify: `frontend/tests/visual/screenshots.spec.ts`
- Test: `frontend/tests/visual/screenshots.spec.ts`

**Interfaces:**
- Produces: Playwright screenshot test capturing ranked board state and post-drag reordered board state.

- [ ] **Step 1: Write Playwright visual test for ranked board and card drag-and-drop reordering**

In `frontend/tests/visual/screenshots.spec.ts`:
```typescript
test('Capture Board Ranked Order and Drag-and-Drop Reordering Snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Verify initial sorted rank order
  // Perform drag and drop reorder of PROJ-101
  // Verify new order remains without rolling back
  // Capture screenshot: 'board-rank-reordered.png'
});
```

- [ ] **Step 2: Run screenshot tests to capture and verify baseline**

Run: `npx pnpm --dir frontend test:visual -g "Ranked Order"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/visual/screenshots.spec.ts frontend/tests/screenshots/
git commit -m "test: add visual screenshot test for issue rank sorting and drag-drop reordering"
```

---

### Task 7: Documentation & Roadmap Update in README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README.md Roadmap & Phases and polish writing of the completed feature**

- Document Phase 7 / ranking capabilities in `README.md`:
  - Issues sorted by Jira LexoRank.
  - Drag & drop rank modification within columns and backlog.
  - Offline queueing and bidirectional synchronization.
- Polish and improve the writing and presentation of the completed topic.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document issue rank sorting drag-drop and offline sync in README roadmap"
```

---

### Task 8: Full CI Verification & Final Commit

- [ ] **Step 1: Run local CI suite**

Run: `./scripts/run_ci_locally.py --visual`
Expected: 100% PASS across all verification steps.

- [ ] **Step 2: Commit any remaining adjustments**
