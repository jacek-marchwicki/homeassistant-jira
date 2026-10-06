"""FastAPI Presentation layer for Home Assistant Jira Dashboard.

Provides REST endpoints, WebSocket broadcasting for real-time state synchronization,
Jira webhook ingestion, optional static asset serving for Ingress/standalone deployment,
dynamic Ingress root_path handling, and fallback background polling.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from jira_dashboard.adapters import (
    FakeJiraClient,
    JiraAPIError,
    create_jira_client,
)
from jira_dashboard.config import JiraDashboardSettings
from jira_dashboard.domain import (
    BoardColumn,
    IssueType,
    JiraComment,
    JiraIssue,
    Priority,
    StatusCategory,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration & Client Initialization
# ---------------------------------------------------------------------------

settings = JiraDashboardSettings.load()
jira_client = create_jira_client(settings)


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


class IssueUpdateRequest(BaseModel):
    """Payload to update an existing issue."""

    summary: str | None = None
    description: str | None = None
    issue_type: IssueType | None = None
    priority: Priority | None = None
    status_category: StatusCategory | None = None
    status_name: str | None = None
    assignee_name: str | None = None
    assignee_account_id: str | None = None
    story_points: float | None = None
    due_date: str | None = None
    start_date: str | None = None
    recreate_after: str | None = None


class IssueCreateRequest(BaseModel):
    """Payload to create a new issue."""

    summary: str
    description: str | None = None
    issue_type: IssueType = IssueType.TASK
    priority: Priority = Priority.MEDIUM
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
        issues, columns = await asyncio.gather(
            jira_client.get_board_issues(board_id),
            jira_client.get_board_columns(board_id),
        )

        # Seed cache for polling loop
        for issue in issues:
            _cached_issue_state[issue.key] = (
                f"{issue.status.category.value}:{issue.summary}:{issue.updated_at}"
            )

        if isinstance(jira_client, FakeJiraClient):
            board_name = "Engineering Sprint Board"
            sprint_name = "Active Sprint 42"
        else:
            board_name = (
                f"{board_id.upper()} Board"
                if board_id and board_id != "engineering-1"
                else "Engineering Sprint Board"
            )
            sprint_name = (
                "Active Issues" if board_id and board_id != "engineering-1" else "Active Sprint 42"
            )

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
    """Application lifespan context managing background polling and cache warming."""
    stop_event = asyncio.Event()
    polling_task: asyncio.Task[None] | None = None

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
    """Transition an issue to a target status category/name and broadcast to connected clients."""
    if not request.target_category and not request.target_status:
        raise HTTPException(
            status_code=400,
            detail="Either target_category or target_status must be provided.",
        )
    try:
        issue = await jira_client.transition_issue(
            key,
            target_category=request.target_category,
            target_status=request.target_status,
        )
    except JiraAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    # Update cache signature
    _cached_issue_state[issue.key] = (
        f"{issue.status.category.value}:{issue.summary}:{issue.updated_at}"
    )
    if _cached_board_response is not None:
        _cached_board_response.issues = [
            issue if x.key == issue.key else x for x in _cached_board_response.issues
        ]

    # Broadcast real-time delta via WebSockets
    await ws_hub.broadcast(
        {
            "event": "issue_transitioned",
            "issue_key": issue.key,
            "status_category": issue.status.category.value,
            "status_name": issue.status.name,
            "issue": issue.model_dump(),
        }
    )

    return issue


@app.patch("/api/issues/{key}", response_model=JiraIssue)
@app.put("/api/issues/{key}", response_model=JiraIssue)
async def update_issue(key: str, request: IssueUpdateRequest) -> JiraIssue:
    """Update issue details and broadcast delta to connected WebSocket clients."""
    try:
        issue = await jira_client.update_issue(
            key,
            summary=request.summary,
            description=request.description,
            issue_type=request.issue_type,
            priority=request.priority,
            status_category=request.status_category,
            status_name=request.status_name,
            assignee_name=request.assignee_name,
            assignee_account_id=request.assignee_account_id,
            story_points=request.story_points,
            due_date=request.due_date,
            start_date=request.start_date,
            recreate_after=request.recreate_after,
        )
    except JiraAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    # Update cache signature
    _cached_issue_state[issue.key] = (
        f"{issue.status.category.value}:{issue.summary}:{issue.updated_at}"
    )
    if _cached_board_response is not None:
        _cached_board_response.issues = [
            issue if x.key == issue.key else x for x in _cached_board_response.issues
        ]

    # Broadcast real-time delta via WebSockets
    await ws_hub.broadcast(
        {
            "event": "issue_updated",
            "issue_key": issue.key,
            "status_category": issue.status.category.value,
            "status_name": issue.status.name,
            "issue": issue.model_dump(),
        }
    )

    return issue


@app.post("/api/issues", response_model=JiraIssue, status_code=201)
async def create_issue(request: IssueCreateRequest) -> JiraIssue:
    """Create a new Jira issue and broadcast delta to connected WebSocket clients."""
    try:
        issue = await jira_client.create_issue(
            summary=request.summary,
            description=request.description,
            issue_type=request.issue_type,
            priority=request.priority,
            status_category=request.status_category,
            status_name=request.status_name,
            assignee_name=request.assignee_name,
            assignee_account_id=request.assignee_account_id,
            story_points=request.story_points,
            due_date=request.due_date,
            start_date=request.start_date,
            recreate_after=request.recreate_after,
            board_id=request.board_id,
            project_key=request.project_key,
        )
    except JiraAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    # Update cache signature
    _cached_issue_state[issue.key] = (
        f"{issue.status.category.value}:{issue.summary}:{issue.updated_at}"
    )
    if _cached_board_response is not None:
        _cached_board_response.issues = [issue] + [
            x for x in _cached_board_response.issues if x.key != issue.key
        ]

    # Broadcast real-time delta via WebSockets
    await ws_hub.broadcast(
        {
            "event": "issue_created",
            "issue_key": issue.key,
            "status_category": issue.status.category.value,
            "status_name": issue.status.name,
            "issue": issue.model_dump(),
        }
    )

    return issue


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
