# Unified Modern WebSocket Outbox Sequences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate legacy unsequenced WebSocket broadcasts and enforce that all system updates assign a monotonic sequence number (`seq`) and stream exclusively through `AsyncioEventRouter` as `outbox_delta` messages, with a mandatory `last_seq` parameter on `/ws`.

**Architecture:** All mutations (REST endpoints, webhooks, comments, deletions, account types, stats, MCP tools, and polling) are piped through `broadcast_mutation_event`, which writes atomically to `board_streams` (incrementing sequence) and `outbox_events`. The `/ws` endpoint requires `last_seq`, rejects connections without it with WebSocket close code 1008, performs catch-up, and streams live `outbox_delta` envelopes from the event router queue. Legacy `WebSocketHub.broadcast()` is deleted.

**Tech Stack:** Python 3.12+, FastAPI, WebSockets, SQLite / Firestore Outbox Pattern, asyncio, pytest.

**Spec:** [`docs/superpowers/specs/2026-11-11-unified-modern-websocket-outbox-sequences-design.md`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/.worktrees/modern-ws-sequences/docs/superpowers/specs/2026-11-11-unified-modern-websocket-outbox-sequences-design.md)

## Global Constraints

- `/ws` connections missing `last_seq` or providing a non-integer / negative value MUST be rejected with WebSocket close code `1008 Policy Violation`.
- All events published to WebSocket clients MUST be wrapped in the standard `outbox_delta` envelope with monotonic `seq`, `board_id`, `type`, and `payload`.
- Zero message duplication and zero message loss across instances (handled via `append_board_event` and `EventBus.publish_wake_up`).
- Existing frontend Zustand store handler (`boardStore.handleWsMessage`) expects `outbox_delta` wrapping the underlying event payload.

## Review Focus

1. Missing `last_seq` on `/ws` connection closes connection immediately with code 1008 and descriptive reason.
2. Incoming webhook `/api/webhooks/jira` (`issue_deleted`, `issue_created`, `issue_transitioned`) increments board sequence and delivers `outbox_delta` with monotonic `seq`.
3. Task deletion (`DELETE /api/issues/{key}`) increments board sequence and delivers `outbox_delta` (`issue_deleted`).
4. Issue comments, account type updates, and Gemini stats updates increment sequence and deliver `outbox_delta`.
5. MCP tools (`MCPServerHandler`) produce sequenced `outbox_delta` events instead of unsequenced broadcasts.

---

### Task 1: Enforce Mandatory `last_seq` on `/ws`

**Files:**
- Modify: `backend/src/jira_dashboard/presentation/main.py:2640-2720`
- Test: `backend/tests/test_websocket_outbox_catchup.py`

- [ ] **Step 1: Write failing tests for mandatory `last_seq` parameter**
  In `backend/tests/test_websocket_outbox_catchup.py`, add tests:
  - Connecting without `last_seq` parameter raises WebSocket close error with code 1008.
  - Connecting with invalid `last_seq=abc` or `last_seq=-1` closes with code 1008.
- [ ] **Step 2: Run pytest to verify test failure**
  Run: `../homeassistant-jira/.venv/bin/pytest backend/tests/test_websocket_outbox_catchup.py`
- [ ] **Step 3: Implement `last_seq` validation in `/ws` endpoint**
  In `backend/src/jira_dashboard/presentation/main.py` in `websocket_endpoint`:
  - Check `last_seq_param = websocket.query_params.get("last_seq")`.
  - If `last_seq_param is None`:
    ```python
    await websocket.close(code=1008, reason="Missing required query parameter: last_seq")
    return
    ```
  - Parse `int(last_seq_param)`. If it fails or is $< 0$:
    ```python
    await websocket.close(code=1008, reason="Invalid query parameter: last_seq must be a non-negative integer")
    return
    ```
- [ ] **Step 4: Run pytest to verify test pass**
  Run: `../homeassistant-jira/.venv/bin/pytest backend/tests/test_websocket_outbox_catchup.py`
- [ ] **Step 5: Commit changes**
  Commit: `git commit -am "feat(backend): require valid last_seq on /ws and reject with WS 1008"`

---

### Task 2: Migrate `JiraWebhookProcessor` and `/api/webhooks/jira` to Sequenced Outbox

**Files:**
- Modify: `backend/src/jira_dashboard/adapters/webhook_processor.py:16-102`
- Modify: `backend/src/jira_dashboard/presentation/main.py:268-274`
- Test: `backend/tests/test_webhook_verification.py`

- [ ] **Step 1: Write failing test verifying webhook generates outbox event and `outbox_delta`**
  In `backend/tests/test_webhook_verification.py`:
  - Add test connecting to `/ws?board_id=...&last_seq=0`, posting Jira webhook (`jira:issue_created`, `jira:issue_updated`, `jira:issue_deleted`), and asserting an `outbox_delta` message arrives with valid `seq > 0`.
- [ ] **Step 2: Run pytest to verify test failure**
  Run: `../homeassistant-jira/.venv/bin/pytest backend/tests/test_webhook_verification.py`
- [ ] **Step 3: Refactor `JiraWebhookProcessor` to use `broadcast_mutation_event`**
  In `backend/src/jira_dashboard/adapters/webhook_processor.py`:
  - Update `EventBroadcaster` protocol to `Callable[[str, dict[str, Any], str | None], Awaitable[None]]` (or `broadcast_func(event_type: str, message: dict[str, Any], board_id: str | None = None)`).
  - In `jira:issue_deleted`: Call `await self.broadcast_func("issue_deleted", {"event": "issue_deleted", "issue_key": del_key}, None)`.
  - In issue create/update: Call `await self.broadcast_func(event_type, {"event": event_type, "issue_key": issue.key, "status_category": issue.status.category.value, "status_name": issue.status.name, "issue": issue.model_dump()}, None)`.
  - In `backend/src/jira_dashboard/presentation/main.py`: Pass `broadcast_func=broadcast_mutation_event` to `JiraWebhookProcessor`.
- [ ] **Step 4: Run pytest to verify test pass**
  Run: `../homeassistant-jira/.venv/bin/pytest backend/tests/test_webhook_verification.py`
- [ ] **Step 5: Commit changes**
  Commit: `git commit -am "feat(backend): route Jira webhooks through monotonic outbox sequence"`

---

### Task 3: Migrate Remaining Mutations (`delete_issue`, Comments, Account Types, Gemini Stats, Polling)

**Files:**
- Modify: `backend/src/jira_dashboard/presentation/main.py:1830-2520, 303-325`
- Test: `backend/tests/test_websocket_outbox_catchup.py`
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: Write failing test for `DELETE /api/issues/{key}`, comments, and account types outbox events**
  In `backend/tests/test_websocket_outbox_catchup.py`:
  - Test that calling `DELETE /api/issues/{key}` emits `outbox_delta` with `type="issue_deleted"` and incremented `seq`.
  - Test that adding a comment emits `outbox_delta` with `type="comment_created"` and incremented `seq`.
  - Test that updating account type emits `outbox_delta` with `type="account_types_updated"` and incremented `seq`.
- [ ] **Step 2: Run pytest to verify test failure**
  Run: `../homeassistant-jira/.venv/bin/pytest backend/tests/test_websocket_outbox_catchup.py`
- [ ] **Step 3: Update endpoints to call `broadcast_mutation_event`**
  In `backend/src/jira_dashboard/presentation/main.py`:
  - In `delete_issue`: Call `await broadcast_mutation_event("issue_deleted", {"event": "issue_deleted", "issue_key": key})`.
  - In `add_issue_comment`: Call `await broadcast_mutation_event("comment_created", {"event": "comment_created", "issue_key": key, "comment": comment.model_dump()})`.
  - In `update_issue_comment`: Call `await broadcast_mutation_event("comment_updated", {"event": "comment_updated", "issue_key": key, "comment": comment.model_dump()})`.
  - In `delete_issue_comment`: Call `await broadcast_mutation_event("comment_deleted", {"event": "comment_deleted", "issue_key": key, "comment_id": comment_id})`.
  - In `set_account_type`: Call `await broadcast_mutation_event("account_types_updated", {"event": "account_types_updated", "account_types": updated})`.
  - In `get_issue_background_image`: Call `await broadcast_mutation_event("gemini_stats_updated", {"event": "gemini_stats_updated", "gemini_stats": get_gemini_stats().model_dump()})`.
  - In `poll_board_issues`: Call `await broadcast_mutation_event("issue_transitioned", {"event": "issue_transitioned", "issue_key": issue.key, "status_category": issue.status.category.value, "status_name": issue.status.name, "issue": issue.model_dump()})`.
- [ ] **Step 4: Run pytest to verify test pass**
  Run: `../homeassistant-jira/.venv/bin/pytest backend/tests/test_websocket_outbox_catchup.py`
- [ ] **Step 5: Commit changes**
  Commit: `git commit -am "feat(backend): sequence task deletions, comments, account types, and polling via outbox"`

---

### Task 4: Migrate `MCPServerHandler` to Sequenced Outbox

**Files:**
- Modify: `backend/src/jira_dashboard/presentation/mcp.py:420-435, 825-1035`
- Modify: `backend/src/jira_dashboard/presentation/main.py:717-724`
- Test: `backend/tests/test_mcp.py`

- [ ] **Step 1: Write/adjust test in `test_mcp.py` to verify outbox event generation on MCP actions**
  Ensure tests connecting to `/ws` provide `?last_seq=0` and verify MCP transitions/edits emit `outbox_delta` envelopes.
- [ ] **Step 2: Update `MCPServerHandler` and `main.py`**
  - In `backend/src/jira_dashboard/presentation/main.py`: Pass `broadcast_func=broadcast_mutation_event` to `MCPServerHandler`.
  - In `backend/src/jira_dashboard/presentation/mcp.py`: Update calls to `self.broadcast_func` to pass `event_type` and `message` dictionary.
- [ ] **Step 3: Run pytest on `test_mcp.py`**
  Run: `../homeassistant-jira/.venv/bin/pytest backend/tests/test_mcp.py`
- [ ] **Step 4: Commit changes**
  Commit: `git commit -am "feat(backend): route MCP tool mutations through monotonic outbox sequence"`

---

### Task 5: Remove Legacy `WebSocketHub.broadcast()` and `subscribed_connections`

**Files:**
- Modify: `backend/src/jira_dashboard/presentation/main.py:156-205, 2630-2755`

- [ ] **Step 1: Remove legacy fields and methods in `WebSocketHub`**
  - Delete `self.subscribed_connections`
  - Delete `mark_router_subscribed()`
  - Delete `broadcast()`
  - In `broadcast_mutation_event`: Remove `await ws_hub.broadcast(message)` call. All connected clients receive events via their `event_router` queue.
- [ ] **Step 2: Streamline `websocket_endpoint` in `main.py`**
  - Always subscribe to `event_router.subscribe(board_id)`.
  - Remove conditionals checking if `queue is None` or `last_seq_param is not None`.
  - Connect socket $\rightarrow$ send `connected` greeting $\rightarrow$ run catch-up since `last_seq` $\rightarrow$ send `catchup_complete` $\rightarrow$ concurrently listen to queue and client ping.
- [ ] **Step 3: Run test suite to verify no syntax or runtime errors**
  Run: `../homeassistant-jira/.venv/bin/pytest backend/tests/test_websocket_outbox_catchup.py`
- [ ] **Step 4: Commit changes**
  Commit: `git commit -am "refactor(backend): remove legacy WebSocketHub broadcast and subscribed_connections"`

---

### Task 6: Update Remaining Backend Tests to Modern WebSocket Contract

**Files:**
- Modify: `backend/tests/test_auth.py`
- Modify: `backend/tests/test_integration.py`
- Modify: `backend/tests/test_api.py`

- [ ] **Step 1: Update WebSocket connection URLs in tests**
  Change all `/ws` connections to `/ws?board_id=HOME&last_seq=0` (or `last_seq=0`).
- [ ] **Step 2: Update message assertion helpers in tests**
  Unpack `outbox_delta` envelopes where tests expect mutation payloads.
- [ ] **Step 3: Run the full backend test suite**
  Run: `../homeassistant-jira/.venv/bin/pytest backend/tests/`
- [ ] **Step 4: Commit changes**
  Commit: `git commit -am "test(backend): update all WebSocket test clients to supply last_seq and expect outbox_delta"`

---

### Task 7: Frontend Verification & Clean Integration Check

**Files:**
- Verify: `frontend/src/App.tsx`
- Verify: `frontend/src/store/boardStore.ts`
- Test: `frontend/src/App.test.tsx`, `frontend/src/store/boardStore.test.ts`

- [ ] **Step 1: Run frontend tests in the worktree**
  Run: `cd frontend && npm test -- --watchAll=false`
- [ ] **Step 2: Confirm both backend and frontend builds cleanly**
  Run: `cd frontend && npm run build`
  Run: `cd backend && ../../.venv/bin/pytest`
- [ ] **Step 3: Final verification commit and summary**
  Commit if needed: `git status`
