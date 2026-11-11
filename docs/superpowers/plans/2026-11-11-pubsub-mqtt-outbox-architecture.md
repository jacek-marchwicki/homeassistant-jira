# GCP PubSub, Home Assistant MQTT & Outbox Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an Outbox event stream with board-level sequence control, multi-instance GCP Pub/Sub fan-out, Home Assistant Mosquitto MQTT eventing, and WebSocket catch-up for real-time synchronization.

**Architecture:** A persistent Outbox in SQLite and Firestore records monotonic board event sequences. An `EventBusProtocol` sends lightweight `WAKE_UP` signals over ephemeral GCP Pub/Sub subscriptions (Cloud Run) or Mosquitto MQTT (Home Assistant), waking an in-process `AsyncioEventRouter`. The WebSocket endpoint (`/ws`) provides initial sequence catch-up from the database before streaming live updates to clients.

**Tech Stack:** Python 3.10+, FastAPI, SQLite3, Google Cloud Pub/Sub, Paho-MQTT, Asyncio, React 19, TypeScript, Zustand, Vitest, Pytest.

**Spec:** [`docs/superpowers/specs/2026-11-11-pubsub-mqtt-outbox-architecture-design.md`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/.worktrees/home-15405-pubsub-mqtt-outbox/docs/superpowers/specs/2026-11-11-pubsub-mqtt-outbox-architecture-design.md)

## Global Constraints

- Backend must remain PEP 8 compliant, strictly typed, and formatted with Ruff.
- Zero perceptual latency: DB writes and outbox appends must be atomic and non-blocking to WebSocket/HTTP responses.
- Ephemeral Pub/Sub subscriptions must be cleanly unregistered/deleted on server shutdown.
- Frontend backward compatibility: WebSockets must seamlessly support both legacy clients (without `last_seq`) and new sequence-aware clients.
- All code, tests, and commits must reside in the isolated git worktree `.worktrees/home-15405-pubsub-mqtt-outbox`.

## Review Focus

1. **Race Condition in Sequence Allocation**: Concurrent writes to the same board must produce strictly sequential, non-colliding `seq` values with zero gaps or duplicates.
2. **Pub/Sub Subscription Leakage**: Cloud Run instances terminating unexpectedly or shutting down normally must not leave abandoned subscriptions accumulating in GCP Pub/Sub.
3. **MQTT Reconnection & Backoff**: Temporary Mosquitto broker outages in Home Assistant must not crash the FastAPI application or cause unhandled background task exceptions.
4. **WebSocket Catch-Up Flood**: A client connecting after prolonged disconnection requesting 500+ missed events must receive paginated or ordered chunks without dropping live stream events that occur during catch-up.
5. **Rollback / Outbox Integrity on Storage Schema Upgrade**: Existing `sync_outbox` and `outbox_events` tables must not lose data during database initialization or schema migration.

---

### Task 1: Outbox Event Storage & Sequence Control in SQLite and Firestore

**Files:**
- Modify: `backend/src/jira_dashboard/adapters/storage_protocol.py:1-120`
- Modify: `backend/src/jira_dashboard/adapters/storage.py:1-250`
- Modify: `backend/src/jira_dashboard/adapters/firestore_storage.py:1-250`
- Test: `backend/tests/test_board_outbox_storage.py`

**Interfaces:**
- Consumes: `StorageProtocol` base definition
- Produces:
  - `storage.append_board_event(board_id: str, event_type: str, payload: dict[str, Any]) -> int`
  - `storage.get_board_events_since(board_id: str, since_seq: int, limit: int = 100) -> list[dict[str, Any]]`
  - `storage.get_latest_board_seq(board_id: str) -> int`

- [ ] **Step 1: Write the failing tests for SQLite board event storage**

Create `backend/tests/test_board_outbox_storage.py` asserting:
1. `append_board_event` allocates monotonically increasing sequences per board (`1, 2, 3...`).
2. Distinct boards have isolated sequence numbers.
3. `get_board_events_since` retrieves events strictly greater than `since_seq` in ascending order.
4. `get_latest_board_seq` returns the current max sequence (or `0` when empty).

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_board_outbox_storage.py -v`
Expected: FAIL with `AttributeError: 'SQLiteStorage' object has no attribute 'append_board_event'`

- [ ] **Step 3: Implement methods in `storage_protocol.py`, `storage.py`, and `firestore_storage.py`**

- In `storage_protocol.py`, add abstract methods: `append_board_event`, `get_board_events_since`, `get_latest_board_seq`.
- In `storage.py`:
  - Add schema creation for `board_streams` and `outbox_events` in `init_db`.
  - In `append_board_event`: use an atomic SQLite transaction with `INSERT INTO board_streams ... ON CONFLICT(board_id) DO UPDATE SET current_seq = current_seq + 1` followed by `INSERT INTO outbox_events`.
  - In `get_board_events_since`: `SELECT seq, event_type, payload, created_at FROM outbox_events WHERE board_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`.
  - In `get_latest_board_seq`: `SELECT current_seq FROM board_streams WHERE board_id = ?`.
- In `firestore_storage.py`:
  - Implement using a Firestore transaction on document `board_streams/{board_id}` and subcollection `board_streams/{board_id}/events/{seq}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_board_outbox_storage.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/storage_protocol.py backend/src/jira_dashboard/adapters/storage.py backend/src/jira_dashboard/adapters/firestore_storage.py backend/tests/test_board_outbox_storage.py
git commit -m "feat(backend): add board outbox event storage and monotonic sequence control"
```

---

### Task 2: Pluggable Event Bus Abstraction (`EventBusProtocol`, `InMemoryEventBus`, `GCPPubSubEventBus`, `MosquittoMQTTEventBus`)

**Files:**
- Create: `backend/src/jira_dashboard/adapters/event_bus.py`
- Modify: `backend/src/jira_dashboard/config.py:75-150`
- Modify: `backend/src/jira_dashboard/adapters/factory.py:1-105`
- Test: `backend/tests/test_event_bus.py`

**Interfaces:**
- Consumes: `JiraDashboardSettings` (configuration flags `event_bus_backend`, `gcp_pubsub_topic`, `mqtt_broker_url`)
- Produces:
  - `class EventBusProtocol(Protocol)`
  - `class InMemoryEventBus(EventBusProtocol)`
  - `class GCPPubSubEventBus(EventBusProtocol)`
  - `class MosquittoMQTTEventBus(EventBusProtocol)`
  - `create_event_bus(settings: JiraDashboardSettings) -> EventBusProtocol`

- [ ] **Step 1: Write the failing tests for EventBus implementations**

Create `backend/tests/test_event_bus.py`:
1. `test_in_memory_event_bus_publish_and_listen`: verifies `publish_wake_up(board_id, seq)` invokes registered callbacks with correct arguments.
2. `test_gcp_pubsub_event_bus_lifecycle`: using mock Google PubSub client, verifies topic publishing and ephemeral subscription creation with 24h expiration and cleanup on stop.
3. `test_mqtt_event_bus_lifecycle`: using mock MQTT client, verifies publish and subscription to topic `homeassistant/jira_dashboard/events/wake_up`.
4. `test_create_event_bus_factory`: verifies factory creates correct instance based on settings.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_event_bus.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jira_dashboard.adapters.event_bus'`

- [ ] **Step 3: Implement `event_bus.py`, update `config.py`, and `factory.py`**

- In `config.py`: Add settings fields `event_bus_backend: str | None = None`, `gcp_pubsub_topic: str | None = None`, `mqtt_broker_url: str | None = None`.
- In `event_bus.py`:
  - Implement `EventBusProtocol` with `publish_wake_up`, `start_listening`, and `stop_listening`.
  - Implement `InMemoryEventBus` using in-process callback registry.
  - Implement `GCPPubSubEventBus` with ephemeral subscription creation (random UUID suffix, 1 hour message retention, 24h expiration) and asynchronous publisher.
  - Implement `MosquittoMQTTEventBus` connecting to broker, publishing to `homeassistant/jira_dashboard/events/wake_up`, and dispatching received messages.
- In `factory.py`: Add `create_event_bus(settings: JiraDashboardSettings | None = None) -> EventBusProtocol`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_event_bus.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/config.py backend/src/jira_dashboard/adapters/event_bus.py backend/src/jira_dashboard/adapters/factory.py backend/tests/test_event_bus.py
git commit -m "feat(backend): implement unified event bus with GCP PubSub and Mosquitto MQTT adapters"
```

---

### Task 3: Asyncio In-Memory Event Router & Mutation Notification

**Files:**
- Create: `backend/src/jira_dashboard/presentation/event_router.py`
- Modify: `backend/src/jira_dashboard/presentation/main.py:100-260`
- Test: `backend/tests/test_event_router.py`

**Interfaces:**
- Consumes: `StorageProtocol`, `EventBusProtocol`
- Produces:
  - `class AsyncioEventRouter`:
    - `subscribe(board_id: str) -> asyncio.Queue[dict[str, Any]]`
    - `unsubscribe(board_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None`
    - `async handle_wake_up(board_id: str, seq: int) -> None`
    - `async record_and_publish_event(board_id: str, event_type: str, payload: dict[str, Any]) -> int`

- [ ] **Step 1: Write the failing tests for `AsyncioEventRouter`**

Create `backend/tests/test_event_router.py`:
1. `test_event_router_subscribe_and_dispatch`: Subscriber receives events dispatched when `handle_wake_up` is called.
2. `test_event_router_ignores_duplicate_or_older_seq`: Calling `handle_wake_up` with a sequence already seen does not re-fetch from DB or duplicate messages.
3. `test_record_and_publish_event`: Appends to storage, publishes `WAKE_UP` to the event bus, and dispatches to local subscribers.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_event_router.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'jira_dashboard.presentation.event_router'`

- [ ] **Step 3: Implement `event_router.py` and integrate into `main.py` lifespan**

- In `event_router.py`:
  - Implement `AsyncioEventRouter` managing `dict[str, set[asyncio.Queue[dict[str, Any]]]]` and `_last_dispatched_seq: dict[str, int]`.
  - In `handle_wake_up`: fetch new events `seq > last_seq` from `storage.get_board_events_since(board_id, last_seq)`, put on each queue, advance `last_seq`.
  - In `record_and_publish_event`: call `seq = storage.append_board_event(board_id, event_type, payload)` then `await event_bus.publish_wake_up(board_id, seq)` and `await handle_wake_up(board_id, seq)`.
- In `main.py`:
  - Initialize `event_bus = create_event_bus(settings)` and `event_router = AsyncioEventRouter(storage, event_bus)`.
  - In FastAPI `lifespan`: start `event_bus.start_listening(event_router.handle_wake_up)` on startup, and `await event_bus.stop_listening()` on shutdown.
  - Update mutation endpoints (`transition_issue`, `update_issue`, `create_issue`, `rank_issue`, webhook updates) to call `record_and_publish_event`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_event_router.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/presentation/event_router.py backend/src/jira_dashboard/presentation/main.py backend/tests/test_event_router.py
git commit -m "feat(backend): implement AsyncioEventRouter and lifespan event bus wiring"
```

---

### Task 4: WebSocket `/ws` Catch-Up & Live Outbox Delta Streaming

**Files:**
- Modify: `backend/src/jira_dashboard/presentation/main.py:2580-2630`
- Test: `backend/tests/test_websocket_outbox_catchup.py`

**Interfaces:**
- Consumes: `AsyncioEventRouter`, `StorageProtocol`
- Produces:
  - WebSocket `/ws?board_id=...&last_seq=...` protocol delivering `outbox_delta` catch-up and live streaming.

- [ ] **Step 1: Write failing WebSocket catch-up and streaming tests**

Create `backend/tests/test_websocket_outbox_catchup.py`:
1. `test_websocket_initial_catchup`: Connecting with `last_seq=0` when DB has events `seq=1, 2` delivers both events in order with type `outbox_delta`, followed by `catchup_complete`.
2. `test_websocket_live_stream_after_catchup`: After catch-up, new mutations published via `record_and_publish_event` stream to the active WebSocket in real time.
3. `test_websocket_disconnect_cleans_up_queue`: Disconnecting unregisters the queue from the router cleanly without memory leak.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_websocket_outbox_catchup.py -v`
Expected: FAIL with missing `outbox_delta` / `catchup_complete` handling.

- [ ] **Step 3: Update `/ws` endpoint in `main.py`**

- In `main.py` (`websocket_endpoint`):
  - Parse query parameters: `board_id: str | None = None` (fallback to `settings.jira_board_id`), `last_seq: int | None = None`.
  - In Catch-Up phase:
    - If `last_seq is not None`: fetch `events = storage.get_board_events_since(board_id, since_seq=last_seq)`.
    - Loop and `await websocket.send_json({"event": "outbox_delta", "board_id": board_id, "seq": ev["seq"], "type": ev["event_type"], "payload": ev["payload"]})`.
    - Send `{"event": "catchup_complete", "board_id": board_id, "synced_seq": latest_seq}`.
  - In Live Streaming phase:
    - Queue subscription: `queue = event_router.subscribe(board_id)`.
    - Concurrently run queue listener and client incoming message reader.
    - On disconnect: `event_router.unsubscribe(board_id, queue)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_websocket_outbox_catchup.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/presentation/main.py backend/tests/test_websocket_outbox_catchup.py
git commit -m "feat(backend): add WebSocket outbox sequence catch-up and live streaming"
```

---

### Task 5: Frontend Outbox Delta & Sequence Tracking (`boardStore.ts`)

**Files:**
- Modify: `frontend/src/store/boardStore.ts:1-250`
- Test: `frontend/src/store/boardStore.test.ts`
- Test: `frontend/src/store/offlineReactivity.test.ts`

**Interfaces:**
- Consumes: WebSocket `/ws?board_id=...&last_seq=...`
- Produces:
  - `lastSeenSeq: number | null` in Zustand board store
  - Handler for `"outbox_delta"` and `"catchup_complete"` events

- [ ] **Step 1: Write failing frontend tests for sequence tracking and delta application**

In `frontend/src/store/boardStore.test.ts`:
1. `test_records_and_updates_last_seen_seq`: Incoming `outbox_delta` updates `lastSeenSeq`.
2. `test_includes_last_seq_in_ws_url`: WebSocket connection connects with `?last_seq=X` when `lastSeenSeq` is set.
3. `test_applies_outbox_delta_issue_update`: Applying `outbox_delta` updates issue status/fields optimistically and reconciles.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm --dir frontend test frontend/src/store/boardStore.test.ts`
Expected: FAIL with `lastSeenSeq` not recognized.

- [ ] **Step 3: Implement `lastSeenSeq` tracking and delta handling in `boardStore.ts`**

- Add `lastSeenSeq: number | null` to `BoardStoreState`.
- When constructing WebSocket URL in `connectWebSocket()`, append `last_seq=${get().lastSeenSeq ?? 0}&board_id=${get().boardMeta?.id ?? ''}`.
- In WebSocket message listener:
  - If message `event === "outbox_delta"`:
    - Parse payload and update issue in state.
    - Set `lastSeenSeq = Math.max(get().lastSeenSeq ?? 0, message.seq)`.
  - If message `event === "catchup_complete"`:
    - Set `lastSeenSeq = Math.max(get().lastSeenSeq ?? 0, message.synced_seq)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm --dir frontend test frontend/src/store/boardStore.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/boardStore.ts frontend/src/store/boardStore.test.ts
git commit -m "feat(frontend): track lastSeenSeq and process WebSocket outbox_delta catchup"
```

---

### Task 6: Documentation & Local CI Full Verification

**Files:**
- Modify: `docs/roadmap_and_phases.md`
- Run: `./scripts/run_ci_locally.py`

**Interfaces:**
- Consumes: All completed tasks
- Produces: Updated documentation, clean CI pass

- [ ] **Step 1: Update `docs/roadmap_and_phases.md`**

Add an entry under Phase 8 / Event Architecture detailing:
- GCP Pub/Sub and Mosquitto MQTT event bus adapters.
- Outbox monotonic sequence tracking per board in SQLite and Firestore.
- WebSocket catch-up and in-memory `AsyncioEventRouter`.

- [ ] **Step 2: Run full local CI runner**

Run: `./scripts/run_ci_locally.py`
Expected: 100% checks passing (Ruff, Pytest, Unittest, Vitest, TypeScript build, Android test).

- [ ] **Step 3: Commit**

```bash
git add docs/roadmap_and_phases.md
git commit -m "docs: update roadmap and phases for GCP PubSub and MQTT outbox architecture"
```
