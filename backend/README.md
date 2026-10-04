# Jira Dashboard Backend

The asynchronous Python backend for the **Home Assistant Jira Dashboard**.

## Architecture & Layers

- `src/jira_dashboard/domain/`: Pure domain models (Issues, Transitions, Boards, Sprints) and conflict resolution logic. Completely independent of HTTP or external APIs.
- `src/jira_dashboard/adapters/`: Concrete integrations:
  - Jira Cloud & Data Center REST API client (using HTTPX).
  - Jira Webhook payload parsers.
  - In-memory state cache & WebSocket event hub.
- `src/jira_dashboard/presentation/`: HTTP API & WebSocket endpoints powered by FastAPI. Supports Home Assistant dynamic Ingress reverse-proxy prefixes (`root_path`).

## Getting Started (uv)

```bash
# Install dependencies
uv sync

# Run development server with live reload
uv run uvicorn jira_dashboard.presentation.main:app --reload --port 8000

# Run tests
uv run pytest

# Run linter
uv run ruff check .
```
