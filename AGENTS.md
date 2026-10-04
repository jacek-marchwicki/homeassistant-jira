# AGENTS.md: AI Assistant & Contributor Guidelines

This document provides definitive instructions, architectural principles, and operational rules for AI agents and human contributors collaborating on the **Home Assistant Jira Dashboard** codebase.

---

## 1. Project Philosophy & Architectural Principles

1. **Dual Deployment First**:
   - The application MUST be designed to run cleanly both as a **Home Assistant Add-on** (with Ingress support) and as an independent **Standalone Web Application**.
   - Do NOT assume a static root path (`/`). Home Assistant Ingress dynamically proxies apps under arbitrary prefixes (e.g. `/api/hassio_ingress/<token>/`). All frontend routing and asset links must respect dynamic base paths.

2. **Zero Perceptual Latency (Optimistic UI)**:
   - When a user interacts with the UI (e.g., transitions an issue, reorders cards, edits fields), the UI state MUST update immediately ($< 50\text{ms}$).
   - Synchronization with the backend and Jira occurs asynchronously in the background.
   - If Jira rejects the operation, the UI must gracefully roll back to the previous state and present clear, non-blocking feedback.

3. **Real-Time Event-Driven Architecture**:
   - The Python backend receives incoming Jira webhooks and immediately relays state deltas to connected clients via WebSockets.
   - Clients must handle network drops and reconnect smoothly, reconciling state after reconnection.

4. **Clean Architecture & Separation of Concerns**:
   - **Domain Layer**: Pure business logic (Jira issue representations, sprint state, transition rules, conflict resolution). Independent of frameworks and transport mechanisms.
   - **Adapter / Infrastructure Layer**: Concrete implementations of Jira API clients (Jira Cloud primary, Jira Data Center pluggable), webhook parsers, storage/cache, and event dispatchers.
   - **Presentation / Delivery Layer**: HTTP/WebSocket controllers, Home Assistant Ingress adapters, and the frontend user interface.

---

## 2. Technology Stack & Architectural Decisions (ADR-001)

> [!NOTE]
> **Phase 2 Status**: Technology Selection & Design System have been formally completed and accepted in [`ADR-001`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/docs/architecture_decision_records/ADR-001-technology-stack.md).

All future implementations MUST strictly adhere to the standardized stack:
- **Backend**:
  - Python 3.10+ with **FastAPI**, **Uvicorn** (ASGI), **Pydantic v2**, and **HTTPX**.
  - Package manager: **uv** (with standard `pyproject.toml`).
  - Strict ASGI `root_path` compliance for Home Assistant Ingress dynamic proxying.
- **Frontend**:
  - **React 19** + **TypeScript** + **Vite** + **Tailwind CSS v4**.
  - Relative asset pathing (`base: './'`) in `vite.config.ts` is mandatory for Ingress compatibility.
  - State & Optimistic UI: **Zustand** (guaranteeing sub-50ms optimistic mutations with rollback queue).
  - Drag-and-Drop: **@dnd-kit** across mobile, tablet, and PC, complemented by direct non-drag quick actions (one-tap "Mark Done" and status transition menu).
  - Package manager: **pnpm**.
- **Design System**:
  - Follow tokens and component rules in [`docs/design_system.md`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/docs/design_system.md).
  - Dark-first default with Home Assistant CSS custom property bridge (`--ha-card-background`, `--primary-background-color`, `--primary-text-color`, `--accent-color`).

---

## 3. Testing & Verification Standards

Quality and reliability are first-class requirements. Every feature must be backed by automated tests:

1. **Unit Testing**:
   - All domain models, transition state machines, and reconciliation logic must have 100% unit test coverage.
   - Fast, dependency-free tests that run in milliseconds.

2. **Integration Testing**:
   - Webhook ingestion endpoints must be tested against simulated Jira webhook payloads.
   - WebSocket streaming and client state updates must be validated using mock client harnesses.
   - Jira client adapters must be verified against mock HTTP servers (e.g. simulating HTTP 200, 400 validation errors, 401 unauthorized, 429 rate limiting).

3. **Frontend Testing**:
   - Component tests for responsive layout rendering across viewports (mobile, tablet, desktop, wallboard).
   - Optimistic UI tests verifying state update $\rightarrow$ async sync confirmation $\rightarrow$ rollback on simulated error.

4. **Continuous Verification**:
   - Always run the relevant test suite before completing any feature or bug fix.
   - Never skip or delete failing tests without explicit rationale and user agreement.

---

## 4. Coding & Engineering Standards

### Python (Backend)
- Adhere strictly to **PEP 8**.
- Use strict type annotations throughout all modules.
- Use explicit docstrings for all public modules, classes, and functions.
- Favor asynchronous I/O (`asyncio`) to ensure high concurrency for WebSocket connections and webhook processing.
- Maintain robust error handling: never silently swallow exceptions.

### Frontend
- Responsive-first design: must support viewports from $320\text{px}$ up to 4K displays.
- Touch-friendly: minimum interactive target size of $44 \times 44\text{ px}$.
- Accessible: semantic HTML and appropriate ARIA attributes for screen readers and assistive tech.
- Strict typing (TypeScript when configuring the frontend project).

---

## 5. Git & Collaboration Workflow

### Commit Messages (Conventional Commits)
Use standard semantic prefixes:
- `feat:` New user-facing feature or capability
- `fix:` Bug fix
- `docs:` Documentation updates or additions
- `test:` Adding or updating tests
- `refactor:` Code refactoring without behavioral changes
- `chore:` Build, tooling, or dependency updates

### Communication Style
- Keep responses concise, structured, and actionable.
- Always provide clickable Markdown links to files and symbols (`file:///absolute/path/to/file` or `file:///path/to/file#L1-L20`).
- When planning multi-step changes, outline the design and obtain user alignment before proceeding.
