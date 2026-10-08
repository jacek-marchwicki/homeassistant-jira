"""FastAPI Presentation layer for Home Assistant Jira Dashboard.

Provides REST endpoints, WebSocket broadcasting for real-time state synchronization,
Jira webhook ingestion, optional static asset serving for Ingress/standalone deployment,
dynamic Ingress root_path handling, and fallback background polling.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from jira_dashboard.adapters import (
    DEFAULT_COLUMNS,
    FakeJiraClient,
    JiraAPIError,
    JiraSyncWorker,
    SQLiteStorage,
    create_jira_client,
)
from jira_dashboard.config import JiraDashboardSettings
from jira_dashboard.domain import (
    BoardColumn,
    IssueType,
    JiraComment,
    JiraIssue,
    JiraStatus,
    JiraUser,
    Priority,
    StatusCategory,
    issue_sort_key,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration & Client Initialization
# ---------------------------------------------------------------------------

settings = JiraDashboardSettings.load()
jira_client = create_jira_client(settings)
storage = SQLiteStorage(settings.sqlite_db_path)
storage.init_db()

# Seed SQLite cache from FakeJiraClient only during testing/simulation mode
if (
    os.environ.get("JIRA_USE_FAKE") == "1"
    and not storage.get_issues()
    and isinstance(jira_client, FakeJiraClient)
):
    storage.save_issues(list(jira_client._issues.values()))
    storage.save_board_meta(
        board_id=settings.jira_board_id,
        board_name="Engineering Sprint Board",
        sprint_name="Active Sprint 42",
        jira_url=settings.jira_url or "https://jira.example.com",
        columns=list(DEFAULT_COLUMNS),
    )


# ---------------------------------------------------------------------------
# Dynamic Home Assistant Ingress ASGI Middleware
# ---------------------------------------------------------------------------


class DynamicIngressMiddleware:
    """ASGI Middleware to dynamically update scope['root_path'] based on X-Ingress-Path header.

    Home Assistant Ingress sends 'X-Ingress-Path: /api/hassio_ingress/<token>'.
    Updating root_path allows FastAPI routing, redirects, and OpenAPI docs
    to function seamlessly behind dynamic Ingress proxies.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] in ("http", "websocket"):
            headers = dict(scope.get("headers", []))
            ingress_path = headers.get(b"x-ingress-path")
            if ingress_path:
                scope["root_path"] = ingress_path.decode("utf-8").rstrip("/")
        await self.app(scope, receive, send)


# ---------------------------------------------------------------------------
# WebSocket Hub / Connection Manager
# ---------------------------------------------------------------------------


class WebSocketHub:
    """Manages active WebSocket connections and broadcasts state deltas."""

    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)


ws_hub = WebSocketHub()


async def _sync_broadcast(event_data: dict[str, Any]) -> None:
    global _cached_board_response
    if _cached_board_response is not None:
        temp_key = event_data.get("temp_key")
        real_issue_dict = event_data.get("issue")
        if temp_key and real_issue_dict:
            real_issue = JiraIssue.model_validate(real_issue_dict)
            _cached_issue_state.pop(temp_key, None)
            _cached_board_response.issues = [
                real_issue if x.key == temp_key else x for x in _cached_board_response.issues
            ]
            seen: set[str] = set()
            deduped: list[JiraIssue] = []
            for item in _cached_board_response.issues:
                if item.key not in seen:
                    seen.add(item.key)
                    deduped.append(item)
            _cached_board_response.issues = deduped
    await ws_hub.broadcast(event_data)


sync_worker = JiraSyncWorker(storage, jira_client, ws_broadcast_func=_sync_broadcast)


# ---------------------------------------------------------------------------
# Fallback Polling Background Task
# ---------------------------------------------------------------------------

_cached_issue_state: dict[str, str] = {}


async def poll_board_issues(board_id: str) -> None:
    """Fetch board issues and broadcast any detected deltas."""
    global _cached_board_response
    issues = await jira_client.get_board_issues(board_id)
    if _cached_board_response is not None:
        _cached_board_response.issues = issues
    for issue in issues:
        status_val = issue.status.category.value
        state_signature = f"{status_val}:{issue.summary}:{issue.updated_at}"
        prev_signature = _cached_issue_state.get(issue.key)
        if prev_signature is not None and prev_signature != state_signature:
            logger.info("Polling detected update on issue %s", issue.key)
            await ws_hub.broadcast(
                {
                    "event": "issue_transitioned",
                    "issue_key": issue.key,
                    "status_category": issue.status.category.value,
                    "status_name": issue.status.name,
                    "issue": issue.model_dump(),
                }
            )
        _cached_issue_state[issue.key] = state_signature


async def fallback_polling_loop(
    poll_interval: int, board_id: str, stop_event: asyncio.Event
) -> None:
    """Periodically poll Jira for board issues if webhook delivery is not directly accessible."""
    logger.info(
        "Starting background polling loop (interval=%ds, board=%s)", poll_interval, board_id
    )
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=float(poll_interval))
            break
        except asyncio.TimeoutError:
            pass

        try:
            await poll_board_issues(board_id)
        except Exception as exc:
            logger.warning("Error during periodic Jira polling: %s", exc)


# ---------------------------------------------------------------------------
# Request & Response Models
# ---------------------------------------------------------------------------


class TransitionRequest(BaseModel):
    """Payload to transition an issue to a new status category or status name/ID."""

    target_category: StatusCategory | None = None
    target_status: str | None = None


class RankIssueRequest(BaseModel):
    """Payload to rank an issue relative to other issues or set its rank."""

    rank_before_key: str | None = None
    rank_after_key: str | None = None
    rank: str | None = None
    target_rank: str | None = None


class IssueUpdateRequest(BaseModel):
    """Payload to update an existing issue."""

    summary: str | None = None
    description: str | None = None
    issue_type: IssueType | None = None
    priority: Priority | None = None
    status_id: str | None = None
    status_category: StatusCategory | None = None
    status_name: str | None = None
    assignee_name: str | None = None
    assignee_account_id: str | None = None
    story_points: float | None = None
    due_date: str | None = None
    start_date: str | None = None
    recreate_after: str | None = None
    rank: str | None = None
    target_rank: str | None = None


class IssueCreateRequest(BaseModel):
    """Payload to create a new issue."""

    summary: str
    description: str | None = None
    issue_type: IssueType = IssueType.TASK
    priority: Priority = Priority.MEDIUM
    status_id: str | None = None
    status_category: StatusCategory = StatusCategory.TODO
    status_name: str | None = None
    assignee_name: str | None = None
    assignee_account_id: str | None = None
    story_points: float | None = None
    due_date: str | None = None
    start_date: str | None = None
    recreate_after: str | None = None
    board_id: str | None = None
    project_key: str | None = None
    rank: str | None = None
    target_rank: str | None = None


class BoardResponse(BaseModel):
    """Response containing board metadata, workflow columns, and issues."""

    board_id: str
    board_name: str
    sprint_name: str | None = None
    jira_url: str | None = None
    columns: list[BoardColumn] = []
    issues: list[JiraIssue]


_cached_board_response: BoardResponse | None = None
_board_cache_timestamp: float = 0.0
_board_cache_lock = asyncio.Lock()
BOARD_CACHE_TTL_SECONDS: float = 30.0


async def fetch_and_cache_board(force: bool = False) -> BoardResponse:
    """Fetch board metadata and active issues from Jira, updating in-memory cache."""
    global _cached_board_response, _board_cache_timestamp

    now = time.time()
    if (
        not force
        and _cached_board_response is not None
        and (now - _board_cache_timestamp) < BOARD_CACHE_TTL_SECONDS
    ):
        return _cached_board_response

    async with _board_cache_lock:
        now = time.time()
        if (
            not force
            and _cached_board_response is not None
            and (now - _board_cache_timestamp) < BOARD_CACHE_TTL_SECONDS
        ):
            return _cached_board_response

        board_id = settings.jira_board_id
        issues: list[JiraIssue] = []
        columns: list[BoardColumn] = []
        try:
            issues, columns = await asyncio.gather(
                jira_client.get_board_issues(board_id),
                jira_client.get_board_columns(board_id),
            )
            storage.replace_all_issues(issues)
            is_fake_test = os.environ.get("JIRA_USE_FAKE") == "1"
            if is_fake_test:
                b_name = "Engineering Sprint Board"
                s_name = "Active Sprint 42"
            else:
                b_name = (
                    f"{board_id.upper()} Board"
                    if board_id and board_id != "engineering-1"
                    else "Jira Dashboard"
                )
                s_name = "Active Issues" if board_id and board_id != "engineering-1" else ""
            storage.save_board_meta(
                board_id=board_id,
                board_name=b_name,
                sprint_name=s_name,
                jira_url=settings.jira_url or "https://jira.example.com",
                columns=columns,
            )
        except Exception as exc:
            logger.warning("Could not fetch board from Jira (%s), falling back to SQLite", exc)
            stored_issues = storage.get_issues()
            stored_meta = storage.get_board_meta(board_id)
            if stored_issues or stored_meta:
                issues = stored_issues
                columns = stored_meta["columns"] if stored_meta else list(DEFAULT_COLUMNS)
            else:
                if isinstance(exc, JiraAPIError):
                    raise exc
                raise JiraAPIError(str(exc)) from exc

        # Seed cache for polling loop
        for issue in issues:
            _cached_issue_state[issue.key] = (
                f"{issue.status.category.value}:{issue.summary}:{issue.updated_at}"
            )

        is_fake_test = os.environ.get("JIRA_USE_FAKE") == "1"
        if is_fake_test:
            board_name = "Engineering Sprint Board"
            sprint_name = "Active Sprint 42"
        else:
            board_name = (
                f"{board_id.upper()} Board"
                if board_id and board_id != "engineering-1"
                else "Jira Dashboard"
            )
            sprint_name = "Active Issues" if board_id and board_id != "engineering-1" else ""

        jira_base_url = (settings.jira_url or "https://jira.example.com").strip().rstrip("/")
        if jira_base_url.endswith("/browse"):
            jira_base_url = jira_base_url[:-7].rstrip("/")

        cached = BoardResponse(
            board_id=board_id,
            board_name=board_name,
            sprint_name=sprint_name,
            jira_url=jira_base_url,
            columns=columns,
            issues=issues,
        )
        _cached_board_response = cached
        _board_cache_timestamp = time.time()
        return cached


class CommentCreateRequest(BaseModel):
    """Payload to create a new comment on an issue."""

    body: str
    author_name: str | None = None


class CommentUpdateRequest(BaseModel):
    """Payload to update an existing comment on an issue."""

    body: str


class SimulateErrorRequest(BaseModel):
    """Configuration to simulate Jira API errors for testing."""

    enable: bool
    status_code: int = 500
    message: str = "Simulated Jira API failure"
    target: str = "transition"


# ---------------------------------------------------------------------------
# FastAPI App Lifecycle & Creation
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan context managing background polling, sync worker, and cache warming."""
    stop_event = asyncio.Event()
    polling_task: asyncio.Task[None] | None = None
    sync_worker_task = asyncio.create_task(sync_worker.run_sync_loop(stop_event))

    # Pre-warm board cache asynchronously on startup so initial requests are instant
    cache_warm_task = asyncio.create_task(fetch_and_cache_board(force=True))

    if settings.polling_interval_seconds > 0 and settings.has_jira_credentials:
        polling_task = asyncio.create_task(
            fallback_polling_loop(
                settings.polling_interval_seconds,
                settings.jira_board_id,
                stop_event,
            )
        )

    yield

    stop_event.set()
    sync_worker_task.cancel()
    try:
        await sync_worker_task
    except asyncio.CancelledError:
        pass
    if polling_task is not None:
        polling_task.cancel()
        try:
            await polling_task
        except asyncio.CancelledError:
            pass
    if not cache_warm_task.done():
        cache_warm_task.cancel()


app = FastAPI(
    title="Home Assistant Jira Dashboard API",
    description="Real-time backend API and WebSocket hub for Jira dashboard",
    version="0.1.1",
    lifespan=lifespan,
)

# Dynamic Ingress Middleware for Home Assistant dynamic URL prefixes
app.add_middleware(DynamicIngressMiddleware)

# Enable CORS for local dev server (port 3000) and Home Assistant Ingress
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# REST Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
@app.get("/api/health")
def health() -> dict[str, str]:
    """Health check endpoint for container orchestrators and Home Assistant supervision."""
    return {"status": "ok", "app": "homeassistant-jira", "version": "0.1.1"}


@app.get("/api/board", response_model=BoardResponse)
async def get_board(refresh: bool = Query(default=False)) -> BoardResponse:
    """Retrieve current board metadata and active issues.

    Returns instantly (< 5ms) from in-memory cache if available,
    triggering asynchronous background refresh if cache is older than TTL.
    """
    global _cached_board_response, _board_cache_timestamp
    if refresh:
        try:
            return await fetch_and_cache_board(force=True)
        except JiraAPIError as exc:
            logger.error("Failed to refresh board issues from Jira: %s", exc)
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    if _cached_board_response is not None:
        if (time.time() - _board_cache_timestamp) >= BOARD_CACHE_TTL_SECONDS:
            asyncio.create_task(fetch_and_cache_board(force=True))
        return _cached_board_response

    try:
        return await fetch_and_cache_board(force=True)
    except JiraAPIError as exc:
        logger.error("Failed to fetch board issues from Jira: %s", exc)
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@app.post("/api/issues/{key}/transition", response_model=JiraIssue)
async def transition_issue(key: str, request: TransitionRequest) -> JiraIssue:
    """Transition an issue locally immediately, enqueue outbox sync to Jira, and broadcast delta."""
    if not request.target_category and not request.target_status:
        raise HTTPException(
            status_code=400,
            detail="Either target_category or target_status must be provided.",
        )

    current_issue = storage.get_issue(key)
    if current_issue is None and _cached_board_response is not None:
        current_issue = next((i for i in _cached_board_response.issues if i.key == key), None)
    if current_issue is None and isinstance(jira_client, FakeJiraClient):
        current_issue = jira_client._issues.get(key)
    if current_issue is None:
        raise HTTPException(status_code=404, detail=f"Issue {key} not found")

    orig_updated_at = current_issue.updated_at
    target_cat = request.target_category
    target_name = request.target_status

    if target_name and not target_cat:
        lowered = target_name.lower()
        if "done" in lowered:
            target_cat = StatusCategory.DONE
        elif "review" in lowered:
            target_cat = StatusCategory.IN_REVIEW
        elif "progress" in lowered:
            target_cat = StatusCategory.IN_PROGRESS
        else:
            target_cat = StatusCategory.TODO
    elif target_cat and not target_name:
        target_name = target_cat.value.replace("_", " ").title()

    new_status = JiraStatus(
        id=target_name or "status-1",
        name=target_name or "Unknown",
        category=target_cat or StatusCategory.TODO,
    )

    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    updated_issue = current_issue.model_copy(update={"status": new_status, "updated_at": now_iso})

    # 1. Immediate local persistence
    storage.upsert_issue(updated_issue)
    _cached_issue_state[updated_issue.key] = (
        f"{updated_issue.status.category.value}:{updated_issue.summary}:{updated_issue.updated_at}"
    )
    if _cached_board_response is not None:
        _cached_board_response.issues = [
            updated_issue if x.key == updated_issue.key else x
            for x in _cached_board_response.issues
        ]

    # 2. Enqueue outbox action
    mutation_id = str(uuid.uuid4())
    storage.enqueue_outbox(
        client_mutation_id=mutation_id,
        action_type="transition_issue",
        issue_key=key,
        payload={
            "target_category": target_cat.value if target_cat else None,
            "target_status": target_name,
        },
        base_updated_at=orig_updated_at,
    )

    # 3. Broadcast real-time delta via WebSockets
    await ws_hub.broadcast(
        {
            "event": "issue_transitioned",
            "issue_key": updated_issue.key,
            "status_category": updated_issue.status.category.value,
            "status_name": updated_issue.status.name,
            "issue": updated_issue.model_dump(),
        }
    )

    # 4. Trigger async outbox processing without blocking response
    asyncio.create_task(sync_worker.process_next_pending())

    return updated_issue


@app.put("/api/issues/{key}/rank", response_model=JiraIssue)
@app.post("/api/issues/{key}/rank", response_model=JiraIssue)
async def rank_issue(key: str, request: RankIssueRequest) -> JiraIssue:
    """Rank an issue locally immediately, enqueue outbox sync to Jira, and broadcast delta."""
    current_issue = storage.get_issue(key)
    if current_issue is None and _cached_board_response is not None:
        current_issue = next((i for i in _cached_board_response.issues if i.key == key), None)
    if current_issue is None and isinstance(jira_client, FakeJiraClient):
        current_issue = jira_client._issues.get(key)
    if current_issue is None:
        raise HTTPException(status_code=404, detail=f"Issue {key} not found")

    orig_updated_at = current_issue.updated_at

    new_rank = request.rank or request.target_rank
    if not new_rank:
        if request.rank_after_key:
            after_issue = storage.get_issue(request.rank_after_key) or (
                jira_client._issues.get(request.rank_after_key)
                if isinstance(jira_client, FakeJiraClient)
                else None
            )
            base_r = after_issue.rank if after_issue and after_issue.rank else "0|i00001:"
            new_rank = f"{base_r}m"
        elif request.rank_before_key:
            before_issue = storage.get_issue(request.rank_before_key) or (
                jira_client._issues.get(request.rank_before_key)
                if isinstance(jira_client, FakeJiraClient)
                else None
            )
            base_r = before_issue.rank if before_issue and before_issue.rank else "0|i00002:"
            match = re.match(r"^(.*?)(\d+)(:*)$", base_r)
            if match:
                num = int(match.group(2))
                if num > 0:
                    new_rank = f"{match.group(1)}{num - 1:05d}{match.group(3)}"
                else:
                    new_rank = f"{base_r[:-1]}0:"
            else:
                new_rank = "0|00000:"
        else:
            new_rank = f"0|i{int(time.time()) % 100000:05d}:"

    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    updated_issue = current_issue.model_copy(update={"rank": new_rank, "updated_at": now_iso})

    # 1. Immediate local persistence
    storage.upsert_issue(updated_issue)
    _cached_issue_state[updated_issue.key] = (
        f"{updated_issue.status.category.value}:{updated_issue.summary}:{updated_issue.updated_at}"
    )
    if _cached_board_response is not None:
        updated_list = [
            updated_issue if x.key == updated_issue.key else x
            for x in _cached_board_response.issues
        ]
        updated_list.sort(key=issue_sort_key)
        _cached_board_response.issues = updated_list

    # 2. Enqueue outbox action
    mutation_id = str(uuid.uuid4())
    storage.enqueue_outbox(
        client_mutation_id=mutation_id,
        action_type="rank_issue",
        issue_key=key,
        payload={
            "rank_before_key": request.rank_before_key,
            "rank_after_key": request.rank_after_key,
            "rank": new_rank,
        },
        base_updated_at=orig_updated_at,
    )

    # 3. Broadcast real-time delta via WebSockets
    await ws_hub.broadcast(
        {
            "event": "issue_ranked",
            "issue_key": updated_issue.key,
            "rank": updated_issue.rank,
            "issue": updated_issue.model_dump(),
        }
    )

    # 4. Trigger async outbox processing without blocking response
    asyncio.create_task(sync_worker.process_next_pending())

    return updated_issue


@app.patch("/api/issues/{key}", response_model=JiraIssue)
@app.put("/api/issues/{key}", response_model=JiraIssue)
async def update_issue(key: str, request: IssueUpdateRequest) -> JiraIssue:
    """Update issue details locally, enqueue outbox sync to Jira, and broadcast delta."""
    current_issue = storage.get_issue(key)
    if current_issue is None and _cached_board_response is not None:
        current_issue = next((i for i in _cached_board_response.issues if i.key == key), None)
    if current_issue is None and isinstance(jira_client, FakeJiraClient):
        current_issue = jira_client._issues.get(key)
    if current_issue is None:
        raise HTTPException(status_code=404, detail=f"Issue {key} not found")

    orig_updated_at = current_issue.updated_at
    payload = request.model_dump(exclude_unset=True)

    new_summary = request.summary if request.summary is not None else current_issue.summary
    new_description = (
        request.description if request.description is not None else current_issue.description
    )
    new_type = request.issue_type if request.issue_type is not None else current_issue.issue_type
    new_priority = request.priority if request.priority is not None else current_issue.priority

    new_status = current_issue.status
    if request.status_name or request.status_category or request.status_id:
        target_cat = request.status_category or current_issue.status.category
        target_name = request.status_name or current_issue.status.name
        target_id = request.status_id or current_issue.status.id
        new_status = JiraStatus(id=target_id, name=target_name, category=target_cat)

    new_assignee = current_issue.assignee
    if request.assignee_name is not None:
        if request.assignee_name.strip() == "":
            new_assignee = None
        else:
            new_assignee = JiraUser(
                account_id=request.assignee_account_id
                or (current_issue.assignee.account_id if current_issue.assignee else "usr-1"),
                display_name=request.assignee_name.strip(),
            )
    elif request.assignee_account_id is not None and current_issue.assignee:
        new_assignee = JiraUser(
            account_id=request.assignee_account_id,
            display_name=current_issue.assignee.display_name,
            avatar_url=current_issue.assignee.avatar_url,
        )

    new_story_points = (
        request.story_points if request.story_points is not None else current_issue.story_points
    )
    new_due_date = request.due_date if request.due_date is not None else current_issue.due_date
    new_start_date = (
        request.start_date if request.start_date is not None else current_issue.start_date
    )
    new_recreate_after = (
        request.recreate_after
        if request.recreate_after is not None
        else current_issue.recreate_after
    )

    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    updated_issue = JiraIssue(
        id=current_issue.id,
        key=current_issue.key,
        summary=new_summary,
        description=new_description,
        issue_type=new_type,
        priority=new_priority,
        status=new_status,
        assignee=new_assignee,
        story_points=new_story_points,
        due_date=new_due_date,
        start_date=new_start_date,
        recreate_after=new_recreate_after,
        url=current_issue.url,
        created_at=current_issue.created_at,
        updated_at=now_iso,
    )

    # 1. Immediate local persistence
    storage.upsert_issue(updated_issue)
    _cached_issue_state[updated_issue.key] = (
        f"{updated_issue.status.category.value}:{updated_issue.summary}:{updated_issue.updated_at}"
    )
    if _cached_board_response is not None:
        _cached_board_response.issues = [
            updated_issue if x.key == updated_issue.key else x
            for x in _cached_board_response.issues
        ]

    # 2. Enqueue outbox action with ONLY modified fields
    mutation_id = str(uuid.uuid4())
    storage.enqueue_outbox(
        client_mutation_id=mutation_id,
        action_type="update_issue",
        issue_key=key,
        payload=payload,
        base_updated_at=orig_updated_at,
    )

    # 3. Broadcast real-time delta via WebSockets
    await ws_hub.broadcast(
        {
            "event": "issue_updated",
            "issue_key": updated_issue.key,
            "status_category": updated_issue.status.category.value,
            "status_name": updated_issue.status.name,
            "issue": updated_issue.model_dump(),
        }
    )

    # 4. Trigger async outbox processing without blocking response
    asyncio.create_task(sync_worker.process_next_pending())

    return updated_issue


@app.post("/api/issues", response_model=JiraIssue, status_code=201)
async def create_issue(request: IssueCreateRequest) -> JiraIssue:
    """Create a new issue locally immediately, enqueue outbox sync to Jira, and broadcast delta."""
    proj_prefix = request.project_key
    if not proj_prefix and request.board_id and not request.board_id.isdigit():
        proj_prefix = request.board_id.split("-")[0].upper()
    if not proj_prefix:
        proj_prefix = "PROJ"
    temp_key = f"{proj_prefix}-TEMP-{int(time.time() * 1000)}"
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    target_cat = request.status_category or StatusCategory.TODO
    target_name = request.status_name or target_cat.value.replace("_", " ").title()
    target_id = request.status_id or target_name
    status = JiraStatus(id=target_id, name=target_name, category=target_cat)

    assignee = None
    if request.assignee_name and request.assignee_name.strip():
        assignee = JiraUser(
            account_id=request.assignee_account_id or "usr-1",
            display_name=request.assignee_name.strip(),
        )

    # Compute highest rank so new task appears at the top of the list
    new_rank = request.rank or request.target_rank
    if not new_rank:
        existing = storage.get_issues()
        if not existing and _cached_board_response:
            existing = _cached_board_response.issues
        if not existing and isinstance(jira_client, FakeJiraClient):
            existing = list(jira_client._issues.values())
        ranked = [i.rank for i in existing if i.rank]
        if ranked:
            ranked.sort()
            base_r = ranked[0]
            match = re.match(r"^(.*?)(\d+)(:*)$", base_r)
            if match:
                num = int(match.group(2))
                if num > 0:
                    new_rank = f"{match.group(1)}{num - 1:05d}{match.group(3)}"
                else:
                    new_rank = f"{base_r[:-1]}0:"
            else:
                new_rank = "0|00000:"
        else:
            new_rank = "0|i00001:"

    jira_base_url = (settings.jira_url or "https://jira.example.com").strip().rstrip("/")
    created_issue = JiraIssue(
        id=temp_key,
        key=temp_key,
        summary=request.summary,
        description=request.description,
        issue_type=request.issue_type,
        priority=request.priority,
        status=status,
        assignee=assignee,
        story_points=request.story_points,
        due_date=request.due_date,
        start_date=request.start_date,
        recreate_after=request.recreate_after,
        rank=new_rank,
        url=f"{jira_base_url}/browse/{temp_key}",
        created_at=now_iso,
        updated_at=now_iso,
    )

    # 1. Immediate local persistence
    storage.upsert_issue(created_issue)
    _cached_issue_state[created_issue.key] = (
        f"{created_issue.status.category.value}:{created_issue.summary}:{created_issue.updated_at}"
    )
    if _cached_board_response is not None:
        _cached_board_response.issues = [created_issue] + [
            x for x in _cached_board_response.issues if x.key != created_issue.key
        ]
        _cached_board_response.issues.sort(key=issue_sort_key)

    # 2. Enqueue outbox action
    mutation_id = str(uuid.uuid4())
    payload = request.model_dump(exclude_unset=True)
    payload["rank"] = new_rank
    payload["target_rank"] = new_rank
    payload["status_id"] = target_id
    if assignee:
        payload["assignee_name"] = assignee.display_name
        payload["assignee_account_id"] = assignee.account_id

    storage.enqueue_outbox(
        client_mutation_id=mutation_id,
        action_type="create_issue",
        issue_key=temp_key,
        payload=payload,
        base_updated_at=None,
    )

    # 3. Broadcast delta
    await ws_hub.broadcast(
        {
            "event": "issue_created",
            "issue_key": created_issue.key,
            "status_category": created_issue.status.category.value,
            "status_name": created_issue.status.name,
            "issue": created_issue.model_dump(),
        }
    )

    # 4. Trigger async outbox processing without blocking response
    asyncio.create_task(sync_worker.process_next_pending())

    return created_issue


@app.get("/api/issues/{key}/comments", response_model=list[JiraComment])
async def get_issue_comments(key: str) -> list[JiraComment]:
    """Retrieve all comments for a specific issue."""
    try:
        return await jira_client.get_comments(key)
    except JiraAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@app.post("/api/issues/{key}/comments", response_model=JiraComment, status_code=201)
async def add_issue_comment(key: str, request: CommentCreateRequest) -> JiraComment:
    """Add a new comment to an issue."""
    if not request.body.strip():
        raise HTTPException(status_code=400, detail="Comment body cannot be empty.")
    try:
        comment = await jira_client.add_comment(
            key, body=request.body, author_name=request.author_name
        )
    except JiraAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    # Broadcast real-time delta via WebSockets
    await ws_hub.broadcast(
        {
            "event": "comment_created",
            "issue_key": key,
            "comment": comment.model_dump(),
        }
    )

    return comment


@app.put("/api/issues/{key}/comments/{comment_id}", response_model=JiraComment)
async def update_issue_comment(
    key: str, comment_id: str, request: CommentUpdateRequest
) -> JiraComment:
    """Update an existing comment on an issue."""
    if not request.body.strip():
        raise HTTPException(status_code=400, detail="Comment body cannot be empty.")
    try:
        comment = await jira_client.update_comment(key, comment_id=comment_id, body=request.body)
    except JiraAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    # Broadcast real-time delta via WebSockets
    await ws_hub.broadcast(
        {
            "event": "comment_updated",
            "issue_key": key,
            "comment": comment.model_dump(),
        }
    )

    return comment


@app.delete("/api/issues/{key}/comments/{comment_id}")
async def delete_issue_comment(key: str, comment_id: str) -> dict[str, Any]:
    """Delete a comment from an issue."""
    try:
        await jira_client.delete_comment(key, comment_id=comment_id)
    except JiraAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    # Broadcast real-time delta via WebSockets
    await ws_hub.broadcast(
        {
            "event": "comment_deleted",
            "issue_key": key,
            "comment_id": comment_id,
        }
    )

    return {"status": "deleted", "comment_id": comment_id}


@app.post("/api/webhooks/jira")
async def handle_jira_webhook(
    request: Request,
    payload: dict[str, Any],
    secret: str | None = Query(default=None),
    x_webhook_secret: str | None = Header(default=None, alias="X-Webhook-Secret"),
    x_atlassian_webhook_secret: str | None = Header(
        default=None, alias="X-Atlassian-Webhook-Secret"
    ),
) -> dict[str, Any]:
    """Ingest incoming Jira Cloud webhook, update domain state, and broadcast to clients."""
    # Webhook Secret Authentication
    if settings.webhook_secret:
        provided_secret = x_atlassian_webhook_secret or x_webhook_secret or secret
        if provided_secret != settings.webhook_secret:
            raise HTTPException(status_code=401, detail="Invalid webhook secret")

    issue = await jira_client.process_webhook(payload)
    if not issue:
        return {"status": "ignored", "message": "No actionable issue delta found in payload"}

    _cached_issue_state[issue.key] = (
        f"{issue.status.category.value}:{issue.summary}:{issue.updated_at}"
    )
    if _cached_board_response is not None:
        idx = next(
            (i for i, x in enumerate(_cached_board_response.issues) if x.key == issue.key),
            None,
        )
        if idx is not None:
            _cached_board_response.issues[idx] = issue
        else:
            _cached_board_response.issues.insert(0, issue)

    # Broadcast real-time delta via WebSockets to all connected browsers
    webhook_event = payload.get("webhookEvent")
    event_type = "issue_created" if webhook_event == "jira:issue_created" else "issue_transitioned"
    await ws_hub.broadcast(
        {
            "event": event_type,
            "issue_key": issue.key,
            "status_category": issue.status.category.value,
            "status_name": issue.status.name,
            "issue": issue.model_dump(),
        }
    )

    return {
        "status": "processed",
        "issue_key": issue.key,
        "status_category": issue.status.category.value,
    }


@app.post("/api/test/simulate-error")
def simulate_error(request: SimulateErrorRequest) -> dict[str, Any]:
    """Configure FakeJiraClient to simulate failures for testing optimistic UI rollback."""
    if isinstance(jira_client, FakeJiraClient):
        jira_client.set_simulate_failure(
            enable=request.enable,
            status_code=request.status_code,
            message=request.message,
            target=request.target,
        )
        return {"status": "configured", "simulate_failure": request.enable}
    return {"status": "ignored", "message": "Client is not FakeJiraClient"}


@app.post("/api/test/reset")
def reset_test_state() -> dict[str, Any]:
    """Reset FakeJiraClient state back to initial seed issues and clear caches."""
    global _cached_board_response, _board_cache_timestamp
    if isinstance(jira_client, FakeJiraClient):
        jira_client.reset()
        _cached_issue_state.clear()
        _cached_board_response = None
        _board_cache_timestamp = 0.0
        storage.rebuild_schema_preserving_outbox()
        storage.clear_outbox()
        storage.save_issues(list(jira_client._issues.values()))
        storage.save_board_meta(
            board_id=settings.jira_board_id,
            board_name="Engineering Sprint Board",
            sprint_name="Active Sprint 42",
            jira_url=settings.jira_url or "https://jira.example.com",
            columns=list(DEFAULT_COLUMNS),
        )
        return {"status": "reset", "message": "Test state reset to initial seed"}
    return {"status": "ignored", "message": "Client is not FakeJiraClient"}


# ---------------------------------------------------------------------------
# WebSocket Endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time client state updates and heartbeat."""
    await ws_hub.connect(websocket)
    try:
        # Send initial connection acknowledgment
        await websocket.send_json(
            {
                "event": "connected",
                "message": "Connected to Home Assistant Jira Dashboard WebSocket Hub",
                "active_clients": len(ws_hub.active_connections),
            }
        )

        # Keep connection open and handle incoming client messages/pings/sync requests
        while True:
            raw_text = await websocket.receive_text()
            if raw_text == "ping":
                await websocket.send_text("pong")
            elif "sync_request" in raw_text:
                try:
                    issues = await jira_client.get_board_issues(settings.jira_board_id)
                    await websocket.send_json(
                        {
                            "event": "board_synced",
                            "board_id": settings.jira_board_id,
                            "issues": [issue.model_dump() for issue in issues],
                        }
                    )
                except Exception as exc:
                    logger.error("Failed to sync board for websocket: %s", exc)
    except WebSocketDisconnect:
        ws_hub.disconnect(websocket)
    except Exception:
        ws_hub.disconnect(websocket)


# ---------------------------------------------------------------------------
# Static Asset Serving (Frontend Ingress / Standalone Fallback)
# ---------------------------------------------------------------------------

CANDIDATE_DIST_DIRS = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../frontend/dist")),
    os.path.abspath(os.path.join(os.getcwd(), "frontend/dist")),
    "/app/frontend/dist",
]

for candidate in CANDIDATE_DIST_DIRS:
    if os.path.isdir(candidate):
        app.mount("/", StaticFiles(directory=candidate, html=True), name="static")
        break
