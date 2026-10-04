"""FastAPI Presentation layer for Home Assistant Jira Dashboard.

Provides REST endpoints, WebSocket broadcasting for real-time state synchronization,
and optional static asset serving for Ingress/standalone deployment.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from jira_dashboard.domain import (
    IssueType,
    JiraIssue,
    JiraStatus,
    JiraUser,
    Priority,
    StatusCategory,
)

# ---------------------------------------------------------------------------
# In-Memory Board & Issue State (Domain Representation)
# ---------------------------------------------------------------------------

SAMPLE_USER_JM = JiraUser(
    account_id="usr-1",
    display_name="Jacek Marchwicki",
    avatar_url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=64&h=64&fit=crop&crop=faces",
)
SAMPLE_USER_AL = JiraUser(
    account_id="usr-2",
    display_name="Alex Lead",
    avatar_url="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=64&h=64&fit=crop&crop=faces",
)

STATUSES: dict[StatusCategory, JiraStatus] = {
    StatusCategory.TODO: JiraStatus(id="1", name="To Do", category=StatusCategory.TODO),
    StatusCategory.IN_PROGRESS: JiraStatus(
        id="2", name="In Progress", category=StatusCategory.IN_PROGRESS
    ),
    StatusCategory.IN_REVIEW: JiraStatus(
        id="3", name="In Review", category=StatusCategory.IN_REVIEW
    ),
    StatusCategory.DONE: JiraStatus(id="4", name="Done", category=StatusCategory.DONE),
    StatusCategory.BLOCKED: JiraStatus(id="5", name="Blocked", category=StatusCategory.BLOCKED),
}

INITIAL_ISSUES: list[JiraIssue] = [
    JiraIssue(
        id="101",
        key="PROJ-101",
        summary="Configure Home Assistant Ingress dynamic proxy support",
        issue_type=IssueType.TASK,
        priority=Priority.HIGH,
        status=STATUSES[StatusCategory.TODO],
        assignee=SAMPLE_USER_JM,
        story_points=5.0,
        updated_at="2026-10-04T22:30:00Z",
    ),
    JiraIssue(
        id="104",
        key="PROJ-104",
        summary="Setup WebSocket broadcast client for live browser pushes",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=STATUSES[StatusCategory.TODO],
        assignee=None,
        story_points=3.0,
        updated_at="2026-10-04T22:35:00Z",
    ),
    JiraIssue(
        id="98",
        key="PROJ-98",
        summary="Design system tokens with Home Assistant theme bridging",
        issue_type=IssueType.STORY,
        priority=Priority.HIGHEST,
        status=STATUSES[StatusCategory.IN_PROGRESS],
        assignee=SAMPLE_USER_AL,
        story_points=5.0,
        updated_at="2026-10-04T22:40:00Z",
    ),
    JiraIssue(
        id="85",
        key="PROJ-85",
        summary="Jira webhook ingestion & signature validation engine",
        issue_type=IssueType.TASK,
        priority=Priority.MEDIUM,
        status=STATUSES[StatusCategory.IN_REVIEW],
        assignee=None,
        story_points=8.0,
        updated_at="2026-10-04T22:45:00Z",
    ),
    JiraIssue(
        id="72",
        key="PROJ-72",
        summary="Project scaffold & business requirements definition",
        issue_type=IssueType.STORY,
        priority=Priority.LOW,
        status=STATUSES[StatusCategory.DONE],
        assignee=SAMPLE_USER_JM,
        story_points=2.0,
        updated_at="2026-10-04T22:50:00Z",
    ),
]

# Mutable store for the active session
CURRENT_ISSUES: dict[str, JiraIssue] = {issue.key: issue for issue in INITIAL_ISSUES}


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

    async def broadcast(self, message: dict) -> None:
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)


ws_hub = WebSocketHub()


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------


class TransitionRequest(BaseModel):
    """Payload to transition an issue to a new status category."""

    target_category: StatusCategory


class BoardResponse(BaseModel):
    """Response containing board metadata and issues grouped by status."""

    board_id: str
    board_name: str
    sprint_name: str | None = None
    issues: list[JiraIssue]


# ---------------------------------------------------------------------------
# FastAPI App Lifecycle & Creation
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan context."""
    yield


app = FastAPI(
    title="Home Assistant Jira Dashboard API",
    description="Real-time backend API and WebSocket hub for Jira dashboard",
    version="0.1.0",
    lifespan=lifespan,
)

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
def health() -> dict:
    """Health check endpoint for container orchestrators and Home Assistant supervision."""
    return {"status": "ok", "app": "homeassistant-jira", "version": "0.1.0"}


@app.get("/api/board", response_model=BoardResponse)
def get_board() -> BoardResponse:
    """Retrieve current board metadata and all active issues."""
    return BoardResponse(
        board_id="engineering-1",
        board_name="Engineering Sprint Board",
        sprint_name="Active Sprint 42",
        issues=list(CURRENT_ISSUES.values()),
    )


@app.post("/api/issues/{key}/transition", response_model=JiraIssue)
async def transition_issue(key: str, request: TransitionRequest) -> JiraIssue:
    """Transition an issue to a target status category and broadcast to all connected clients."""
    issue = CURRENT_ISSUES.get(key)
    if not issue:
        raise HTTPException(status_code=404, detail=f"Issue {key} not found")

    new_status = STATUSES.get(request.target_category)
    if not new_status:
        raise HTTPException(
            status_code=400, detail=f"Invalid target category: {request.target_category}"
        )

    # Update in-memory state
    issue.status = new_status
    CURRENT_ISSUES[key] = issue

    # Broadcast real-time delta via WebSockets
    await ws_hub.broadcast(
        {
            "event": "issue_transitioned",
            "issue_key": issue.key,
            "status_category": new_status.category.value,
            "status_name": new_status.name,
            "issue": issue.model_dump(),
        }
    )

    return issue


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

        # Keep connection open and handle incoming client messages/pings
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_hub.disconnect(websocket)
    except Exception:
        ws_hub.disconnect(websocket)


# ---------------------------------------------------------------------------
# Static Asset Serving (Frontend Ingress / Standalone Fallback)
# ---------------------------------------------------------------------------

FRONTEND_DIST_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../frontend/dist")
)

if os.path.exists(FRONTEND_DIST_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIST_DIR, html=True), name="static")
