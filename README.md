# Home Assistant Jira Dashboard

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Status: Phase 2 Complete](https://img.shields.io/badge/Status-Phase%202%20Complete-green.svg)](#roadmap)

A high-performance, real-time Jira dashboard built for **Home Assistant** and **standalone web environments**. Designed from the ground up for ambient wall displays, desk workflows, and mobile devices, providing instant UI feedback and live multi-client synchronization.

---

## 🌟 Highlights

- **Dual-Mode Deployment**:
  - **Home Assistant Add-on**: Native Ingress support for zero-config access inside Home Assistant OS, Lovelace panels, and the Home Assistant Companion mobile app.
  - **Standalone Web App**: Fully functional as an independent container or local service for desktop and mobile browsers.
- **Ultra-Responsive UI (Scalable Viewports)**:
  - Effortlessly scales from **large ambient wallboards / 4K displays** down to **compact mobile smartphones**.
  - Touch-optimized interfaces ($\ge 44 \times 44\text{ px}$ targets) with clear visual hierarchy.
- **Optimistic UI (Zero Perceptual Latency)**:
  - User actions (moving cards, transitioning statuses, changing assignments) update the interface immediately.
  - Asynchronous background synchronization to Jira with automatic rollback and visual notification if an operation is rejected.
- **Real-Time Bidirectional Event Streaming**:
  - Python backend listens for incoming **Jira Webhooks** to capture external updates instantly.
  - Connected browsers receive delta updates in real time via **WebSockets**.
- **Tested & Engineered for Evolution**:
  - Adherence to Clean Architecture, strict typing, and comprehensive unit and integration test suites.

---

## 🛠️ Technology Stack (Phase 2)

See [**ADR-001: Technology Stack Selection**](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/docs/architecture_decision_records/ADR-001-technology-stack.md) for full context and architectural tradeoffs.

- **Backend** ([`backend/`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/backend/)):
  - **Runtime & Framework**: Python 3.10+, **FastAPI**, **Uvicorn** (ASGI).
  - **Data Modeling & Validation**: **Pydantic v2** (Rust-accelerated serialization).
  - **Client**: **HTTPX** (Async HTTP for Jira Cloud REST API).
  - **Package Management & Tooling**: **uv**, **pyproject.toml**, **pytest**, **ruff**, **mypy**.
- **Frontend** ([`frontend/`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/frontend/)):
  - **Core**: **React 19**, **TypeScript**, **Vite** (configured with relative `base: './'` for Ingress dynamic proxying).
  - **Styling & Theming**: **Tailwind CSS v4** + Design Tokens with Home Assistant CSS variable bridge.
  - **State & Optimistic Mutations**: **Zustand** (sub-50ms optimistic state updates with rollback queues).
  - **Drag & Drop**: **@dnd-kit** (accessible touch and pointer sensors across mobile, tablet, and PC).
  - **Icons**: **Lucide React**.
  - **Package Manager**: **pnpm**.

---

## 🎨 Design System

The dashboard implements a versatile design system designed for ambient wallboards, desktop monitors, and handheld mobile phones.
👉 [**Complete Design System Specification**](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/docs/design_system.md)

- **Dark-First Default**: Slate palettes optimized for high-contrast visibility and low-glare wall displays.
- **Home Assistant Theme Bridge**: Seamlessly inherits `--card-background-color`, `--primary-text-color`, and `--accent-color` when hosted in Ingress.
- **Dual Action Modality**: Drag-and-drop across all screens, plus direct one-tap "Mark as Done" buttons and status transition menus so dragging is never strictly required.
- **Touch-Friendly & Accessible**: Minimum $44 \times 44\text{ px}$ targets and dual-coded priority indicators (color + unique icon glyph).

---

## 🏛️ Architecture Overview

The system consists of a Python-based backend service and a modern reactive frontend web application.

```mermaid
flowchart TD
    subgraph Atlassian ["Atlassian Jira"]
        JiraCloud["Jira Cloud / Data Center API"]
        JiraWebhook["Jira Webhook Dispatcher"]
    end

    subgraph Backend ["Python Backend Service"]
        WebhookReceiver["Webhook Receiver"]
        JiraClient["Jira REST Client / Adapter"]
        SyncEngine["State & Sync Manager"]
        WSHub["WebSocket Hub"]
    end

    subgraph Clients ["Frontend & Display Targets"]
        subgraph HA ["Home Assistant Environment"]
            HAAddon["Home Assistant Add-on (Ingress)"]
            HAMobile["HA Companion App / Lovelace"]
        end
        subgraph Standalone ["Standalone Web Clients"]
            WallDisplay["Wallboard / Office Kiosk"]
            DesktopWeb["Desktop Browser"]
            MobileWeb["Mobile Browser"]
        end
    end

    JiraWebhook -->|HTTP POST Webhook| WebhookReceiver
    WebhookReceiver --> SyncEngine
    SyncEngine --> WSHub

    JiraClient <-->|REST API| JiraCloud
    SyncEngine <--> JiraClient

    WSHub <-->|WebSockets (Live Push)| HAAddon
    WSHub <-->|WebSockets (Live Push)| WallDisplay
    WSHub <-->|WebSockets (Live Push)| DesktopWeb
    WSHub <-->|WebSockets (Live Push)| MobileWeb

    HAAddon --- HAMobile
```

---

## 📋 Business Requirements & User Scenarios

For the complete specification of personas, user stories, functional and non-functional requirements, see:
👉 [**Business Requirements Specification**](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/docs/business_requirements.md)

### Key Workflows:
1. **Ambient Kiosk**: Glancable sprint progress, visual blocker alerts, and touchless live updates for office displays.
2. **Focused Desk Worker**: Instant drag-and-drop issue transitions without the sluggishness of full Jira web pages.
3. **Mobile Triage**: Responsive single-column touch navigation resilient to intermittent connections.
4. **Team Standup**: Shared multi-client synchronization where moves made by any user or Jira automation reflect everywhere instantly.

---

---

## 🚀 Quick Start & Project Setup

### Prerequisites
- **Python**: 3.10 or higher (with [`uv`](https://github.com/astral-sh/uv) recommended, or `pip` / `venv`)
- **Node.js**: 20.x or 22.x
- **Package Manager**: [`pnpm`](https://pnpm.io/) (`corepack enable && corepack prepare pnpm@latest --activate` or `npx pnpm`)

### 1. Backend Setup
```bash
cd backend

# Option A: Using uv (Recommended)
uv sync

# Option B: Using standard Python venv
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e ".[dev]"
```

### 2. Frontend Setup
```bash
cd frontend

# Install dependencies using pnpm
pnpm install
```

---

## 🧪 Running Tests & Quality Checks

The codebase is tested across both the Python backend and TypeScript frontend.

### 1. Run Backend Tests
```bash
# Run with pytest
PYTHONPATH=backend/src pytest backend/tests

# Run with standard Python unittest runner
PYTHONPATH=backend/src python3 -m unittest discover -s backend/tests

# Lint and formatting check
ruff check backend/
```

### 2. Run Frontend Tests & Build
```bash
cd frontend

# Run unit tests via Vitest
pnpm test

# Run strict TypeScript typecheck and production build
pnpm build
```

### 3. Run Entire CI Pipeline Locally

The project includes a hybrid CI runner [`scripts/run_ci_locally.py`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/scripts/run_ci_locally.py) supporting both instant native execution and containerized GitHub Actions simulation:

#### Mode A: Fast Native Checks (Default, ~1-2 seconds)
Validates workflow YAML, runs Ruff linting/formatting, Pytest/unittest, Vitest, and TypeScript production build directly on your host with per-step timing:
```bash
./scripts/run_ci_locally.py
```

#### Mode B: Containerized GitHub Actions Simulation (`nektos/act`)
Simulates the exact GitHub Actions environment inside Docker Ubuntu containers (including Python 3.10/3.11/3.12 matrix jobs). Requires Docker daemon and [`act`](https://github.com/nektos/act) (`brew install act`):
```bash
# Run all CI jobs in Docker
./scripts/run_ci_locally.py --act

# Run only a specific job (e.g., backend matrix or frontend)
./scripts/run_ci_locally.py --act -j backend
./scripts/run_ci_locally.py --act -j frontend

# Dry-run workflow validation (does not spin up containers)
./scripts/run_ci_locally.py --act --dry-run

# View all options
./scripts/run_ci_locally.py --help
```


---

## 💻 Running the App Locally

### Development Mode (Concurrent Servers with Live Reload)

1. **Start the Python Backend Service**:
   ```bash
   # From root or backend directory:
   uv run uvicorn jira_dashboard.presentation.main:app --reload --port 8000
   # or with active virtualenv:
   python3 -m uvicorn jira_dashboard.presentation.main:app --reload --port 8000
   ```
   *The backend will listen on `http://127.0.0.1:8000`.*

2. **Start the Vite Frontend Dev Server**:
   ```bash
   cd frontend
   pnpm dev
   ```
   *The frontend starts at `http://localhost:3000`. Vite automatically proxies `/api` and `/ws` to `http://127.0.0.1:8000`, so API calls and WebSockets work out of the box.*

3. Open **`http://localhost:3000`** in your browser.

---

## 🏠 Installation in Home Assistant

The application is packaged as a **Home Assistant Add-on** with native **Ingress** support, meaning it integrates securely into the Home Assistant interface and Companion mobile apps without exposing external ports.

### Add-on Manifest & Packaging
The Add-on manifest is located at [`addon/config.yaml`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/addon/config.yaml) and uses the multi-stage [`addon/Dockerfile`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/addon/Dockerfile).

### Method 1: Installing via Home Assistant Add-on Store (Repository)
1. In Home Assistant, navigate to **Settings** > **Add-ons** > **Add-on Store**.
2. Click the three vertical dots (top right) and select **Repositories**.
3. Add this repository URL:
   ```
   https://github.com/jacek-marchwicki/homeassistant-jira
   ```
4. Find **Jira Dashboard** in the store, click **Install**, and wait for the image to build/download.

### Method 2: Local Development / Manual Installation
1. On your Home Assistant host (via Samba, SSH, or Samba Share), open the `/addons/` directory.
2. Copy or symlink the repository into `/addons/jira_dashboard/`.
3. In Home Assistant, go to **Settings** > **Add-ons** > **Add-on Store** > three dots > **Check for updates**.
4. The local **Jira Dashboard** add-on will appear under the "Local Add-ons" section. Click **Install**.

### Configuration Options
In the add-on's **Configuration** tab, enter your Jira connection settings:

| Option | Type | Required | Description | Example |
|---|---|---|---|---|
| `jira_url` | URL | Yes | Base URL of your Jira Cloud instance | `https://mycompany.atlassian.net` |
| `jira_email` | String | Yes | Your Atlassian account email | `alex@mycompany.com` |
| `jira_api_token` | Password | Yes | Jira API Token ([generate here](https://id.atlassian.com/manage-profile/security/api-tokens)) | `ATATT3xFfGF0...` |
| `jira_board_id` | String | No | Target Jira Board ID (optional, defaults to primary board) | `42` |
| `polling_interval_seconds` | Integer | No | Fallback polling interval in seconds | `60` |

### Launching the Dashboard
1. Go to the **Info** tab, toggle **Show in sidebar**, and click **Start**.
2. Click **Open Web UI** (or click **Jira** in the Home Assistant left sidebar).
3. The dashboard loads seamlessly inside Home Assistant through Ingress, automatically matching your Home Assistant theme!

---

## 🤖 AI Agent & Developer Guidelines

If you are an AI assistant or human contributor developing this project, please consult:
👉 [**AGENTS.md**](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/AGENTS.md)

This file defines coding standards, testing requirements, architectural boundaries, and branch/commit conventions.

---

## 🗺️ Roadmap & Phases

- [x] **Phase 1: Project Scaffolding & Requirements**
  - [x] Initialize Git repository
  - [x] Define business needs and architecture vision
  - [x] Establish developer & agent guidelines (`AGENTS.md`)
- [x] **Phase 2: Technology Stack Selection & Design System**
  - [x] Evaluate and select Python backend framework (FastAPI + Pydantic v2 + uv)
  - [x] Evaluate and select Frontend framework (React 19 + TypeScript + Vite + Tailwind CSS v4 + Zustand + @dnd-kit + pnpm)
  - [x] Publish Architecture Decision Record ([`ADR-001`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/docs/architecture_decision_records/ADR-001-technology-stack.md))
  - [x] Define comprehensive [Design System](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/docs/design_system.md) with Home Assistant theme bridge
  - [x] Scaffold initial backend and frontend directory structures
- [ ] **Phase 3: Core Implementation**
  - [ ] Jira Cloud adapter and webhook parser
  - [ ] WebSocket hub and client state reconciliation
  - [ ] Responsive board and card components with optimistic UI
  - [ ] Comprehensive unit and integration test coverage
- [ ] **Phase 4: Home Assistant Integration & Packaging**
  - [ ] Home Assistant Add-on container configuration (`config.yaml`, `build.yaml`, Ingress)
  - [ ] Standalone Docker packaging and docker-compose configurations

---

## 📄 License

This project is licensed under the **Apache License, Version 2.0**.
See the [LICENSE](LICENSE) file for the full license text and copyright notices.

