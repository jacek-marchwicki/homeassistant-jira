"""FastAPI Presentation layer for Home Assistant Jira Dashboard.

Provides REST endpoints, WebSocket broadcasting for real-time state synchronization,
Jira webhook ingestion, and optional static asset serving for Ingress/standalone deployment.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from jira_dashboard.adapters import FakeJiraClient, JiraAPIError
from jira_dashboard.domain import (
    JiraIssue,
    StatusCategory,
)

# ---------------------------------------------------------------------------
# Jira Client Instance (Test double / Fake by default, pluggable for Jira Cloud)
# ---------------------------------------------------------------------------

jira_client = FakeJiraClient()


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
# Request & Response Models
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
def health() -> dict[str, str]:
    """Health check endpoint for container orchestrators and Home Assistant supervision."""
    return {"status": "ok", "app": "homeassistant-jira", "version": "0.1.0"}


@app.get("/api/board", response_model=BoardResponse)
async def get_board() -> BoardResponse:
    """Retrieve current board metadata and all active issues from Jira client."""
    try:
        issues = await jira_client.get_board_issues("engineering-1")
    except JiraAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return BoardResponse(
        board_id="engineering-1",
        board_name="Engineering Sprint Board",
        sprint_name="Active Sprint 42",
        issues=issues,
    )


@app.post("/api/issues/{key}/transition", response_model=JiraIssue)
async def transition_issue(key: str, request: TransitionRequest) -> JiraIssue:
    """Transition an issue to a target status category and broadcast to all connected clients."""
    try:
        issue = await jira_client.transition_issue(key, request.target_category)
    except JiraAPIError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

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


@app.post("/api/webhooks/jira")
async def handle_jira_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    """Ingest incoming Jira Cloud webhook, update domain state, and broadcast to clients."""
    issue = await jira_client.process_webhook(payload)
    if not issue:
        return {"status": "ignored", "message": "No actionable issue delta found in payload"}

    # Broadcast real-time delta via WebSockets to all connected browsers
    await ws_hub.broadcast(
        {
            "event": "issue_transitioned",
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
    jira_client.set_simulate_failure(
        enable=request.enable,
        status_code=request.status_code,
        message=request.message,
        target=request.target,
    )
    return {"status": "configured", "simulate_failure": request.enable}


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

CANDIDATE_DIST_DIRS = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../frontend/dist")),
    os.path.abspath(os.path.join(os.getcwd(), "frontend/dist")),
    "/app/frontend/dist",
]

for candidate in CANDIDATE_DIST_DIRS:
    if os.path.isdir(candidate):
        app.mount("/", StaticFiles(directory=candidate, html=True), name="static")
        break
