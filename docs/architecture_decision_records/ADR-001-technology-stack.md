# ADR-001: Technology Stack Selection & Architecture

- **Status**: Accepted
- **Date**: 2026-10-04
- **Deciders**: Engineering & Product Team
- **Consulted**: AGENTS.md, Business Requirements Specification

---

## 1. Context & Problem Statement

The **Home Assistant Jira Dashboard** requires a dual-deployment architecture:
1. Running as an embedded **Home Assistant Add-on** with Ingress reverse proxying.
2. Operating as a completely independent, **standalone web application** accessible via desktop, tablet, and mobile browsers.

The product demands:
- **Zero perceptual latency (Optimistic UI)**: UI responds $< 50\text{ms}$ to drag-and-drop and status transitions, then asynchronously syncs to Jira with rollback on failure.
- **Real-time event streaming**: Ingestion of Jira Cloud webhooks and immediate push to browsers via WebSockets ($< 200\text{ms}$).
- **Scalable responsive design**: Seamless operation across 4K wallboards, multi-monitor desktops, tablets, and smartphones.
- **High testability**: Clean architecture with 100% domain unit test coverage and complete integration testing.

We need to choose and standardize the backend framework, frontend framework, state management, bundling system, and tooling.

---

## 2. Decision

### 2.1 Backend Technology: FastAPI (Python 3.10+)

- **Framework**: **FastAPI** running on **Uvicorn** (ASGI).
- **Serialization & Validation**: **Pydantic v2** (Rust-accelerated).
- **HTTP Client**: **HTTPX** (Asynchronous HTTP for Jira Cloud REST API).
- **Tooling & Package Manager**: **uv** (high-speed dependency resolution & environment management) via standard `pyproject.toml`.
- **Testing & Quality**: **pytest**, **pytest-asyncio**, and **Ruff** (linting and formatting).

#### Rationale:
1. **Asynchronous WebSockets**: Native, high-concurrency WebSocket connection handling with room/broadcast management.
2. **High-Speed Deserialization**: Jira webhook payloads can be verbose (tens of kilobytes). Pydantic v2 parses and transforms webhook JSON into domain events with microsecond latency.
3. **Home Assistant Ingress Compatibility**: Native ASGI `root_path` handling allows FastAPI to function behind dynamic proxy prefixes (e.g. `/api/hassio_ingress/<token>/`) without rewriting application routes.
4. **Automatic API Documentation**: Built-in OpenAPI specification generation for standalone API consumers.

### 2.2 Frontend Technology: React 19 + TypeScript + Vite

- **Core Library**: **React 19** with strict **TypeScript**.
- **Build Tool & Bundler**: **Vite**.
- **Styling**: **Tailwind CSS v4** (with CSS custom properties for Home Assistant theme bridging).
- **State Management**: **Zustand** (with custom optimistic queue middleware).
- **Drag-and-Drop**: **@dnd-kit/core** & **@dnd-kit/sortable**.
- **Icons**: **Lucide React**.
- **Tooling & Package Manager**: **pnpm** (fast, deterministic disk-efficient package management).

#### Rationale:
1. **Dynamic Relative Base Path**: Home Assistant Ingress assigns arbitrary dynamic URLs. Vite provides first-class support for `base: './'`, generating relative asset links that work out of the box regardless of the proxy path.
2. **Synchronous Optimistic Mutations with Zustand**: Unlike complex asynchronous state managers, Zustand allows instant, synchronous state mutations with tiny overhead (< 1KB), making $< 50\text{ms}$ UI response trivial to achieve while cleanly managing optimistic rollback queues.
3. **Cross-Device Drag-and-Drop**: `@dnd-kit` is lightweight, touch-accessible, and modular, providing full pointer, mouse, and touch sensor abstractions across PC, tablet, and mobile.
4. **Direct Non-Drag Actions**: Cards also incorporate one-tap "Mark as Done" buttons and transition menus, ensuring users never struggle with dragging across columns on mobile screens or wall displays.
5. **Theme Bridging**: Tailwind CSS custom properties allow transparent fallback to Home Assistant's native CSS variables (`--card-background-color`, `--primary-text-color`, `--accent-color`).

---

## 3. Architecture Layers & Directory Layout

To preserve clean architecture and maintainability:

```
homeassistant-jira/
├── backend/
│   ├── pyproject.toml
│   └── src/
│       └── jira_dashboard/
│           ├── domain/            # Entities (Issue, Board, Transition) & pure business logic
│           ├── adapters/          # Jira API client, Webhook receiver, Event hub, In-memory cache
│           └── presentation/      # FastAPI application, Ingress router, WebSocket endpoints
├── frontend/
│   ├── package.json
│   ├── vite.config.ts             # Configured with base: './'
│   └── src/
│       ├── tokens/                # Design tokens & Home Assistant theme bridge
│       ├── types/                 # Issue, Board, and Sync Event TypeScript interfaces
│       ├── store/                 # Zustand store (optimistic state & WS subscriber)
│       └── components/            # UI components (Board, Column, Card, QuickActions)
└── docs/
    ├── business_requirements.md
    └── design_system.md
```

---

## 4. Alternatives Considered & Rejected

### Backend:
- **aiohttp.web**: Used internally by Home Assistant, but lacks automatic OpenAPI generation, modern dependency injection, and Pydantic v2 speed.
- **Litestar**: Excellent architecture, but smaller ecosystem and community reference architectures for Home Assistant Add-on Ingress integration.
- **Django / Flask**: Heavyweight, synchronous origins, unnecessarily complex for real-time WebSocket distribution.

### Frontend:
- **Svelte 5**: Extremely lightweight, but smaller ecosystem for accessible multi-device drag-and-drop libraries and Home Assistant web component integration.
- **Vue 3**: Very capable, but React's ecosystem for drag-and-drop (`@dnd-kit`) and optimistic state libraries offers stronger community patterns for real-time boards.
- **Redux Toolkit**: Unnecessary boilerplate and bundle weight for an application where Zustand provides smaller, faster, and more ergonomic optimistic state management.

---

## 5. Consequences & Tradeoffs

### Positive:
- Single-command dev workflows (`uv run`, `pnpm dev`).
- Robust type safety from backend Pydantic models through to TypeScript frontend interfaces.
- Zero-configuration deployment both in Home Assistant Ingress and standalone containers.
- Guaranteed $< 50\text{ms}$ interaction latency for users.

### Negative / Mitigations:
- Need to keep TypeScript frontend interfaces in sync with backend Pydantic schemas (can be automated via OpenAPI schema generation or shared type definitions in future phases).
