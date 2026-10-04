# Home Assistant Jira Dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
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
