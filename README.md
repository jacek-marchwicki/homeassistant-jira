# Home Assistant Jira Dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Planning & Scaffolding](https://img.shields.io/badge/Status-Phase%201%20Planning-amber.svg)](#roadmap)

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

- [x] **Phase 1: Project Scaffolding & Requirements (Current)**
  - [x] Initialize Git repository
  - [x] Define business needs and architecture vision
  - [x] Establish developer & agent guidelines (`AGENTS.md`)
- [ ] **Phase 2: Technology Stack Selection**
  - [ ] Evaluate and select Python backend framework (e.g. FastAPI, Litestar, aiohttp)
  - [ ] Evaluate and select Frontend framework (e.g. Svelte, Vue, React)
  - [ ] Define project layout and tooling (package managers, linters, test runners)
- [ ] **Phase 3: Core Implementation**
  - [ ] Jira Cloud adapter and webhook parser
  - [ ] WebSocket hub and client state reconciliation
  - [ ] Responsive board and card components with optimistic UI
  - [ ] Comprehensive unit and integration test coverage
- [ ] **Phase 4: Home Assistant Integration & Packaging**
  - [ ] Home Assistant Add-on container configuration (`config.yaml`, `build.yaml`, Ingress)
  - [ ] Standalone Docker packaging and docker-compose configurations
