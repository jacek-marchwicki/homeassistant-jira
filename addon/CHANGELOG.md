# Changelog

## 0.2.0

- **Resilient Offline Synchronization & Two-Tier Outbox**: Local SQLite storage persistence with background `SyncWorker` processing pending rank and issue updates, frontend resilient offline queue (`flushOfflineQueue`), and visual synchronization status header badge.
- **LexoRank Drag-and-Drop Reordering**: Alphanumeric LexoRank sorting and sub-50ms optimistic vertical card reordering in both Kanban Board and Backlog views without card snapback or rollback.
- **Top-Rank Placement & Issue Creation Fidelity**: Guaranteed 100% field preservation on issue creation, resolved backlog status classification, and automatic top-rank positioning for newly created tasks with Jira Cloud sync reconciliation.
- **Full-Fidelity Assignee Management**: Support for unassigning issues (`assignee = null`), keyboard-accessible assignee search filtering, and resilient Jira Cloud account ID resolution.
- **Portaled DatePicker Component**: Modern dependency-free React 19 `DatePicker` rendered via `createPortal` with dynamic viewport collision detection, multi-year jump navigation (`<<`, `>>`), native year/month dropdown selectors, and two-way date clearing.
- **"Home as Usual" Daily Tasks Section**: Dedicated sub-section in the Ready column grouping daily recurring tasks (`recreate_after == "1d"`).
- **Persistent PWA Install Banner Dismissal**: Upgraded mobile install prompt dismissal persistence to `localStorage` across browser restarts.
- **Backend Robustness**: ISO timestamp parsing with timezone offsets during issue sorting, Jira Cloud assignee resolution resilience, and startup race condition prevention.

## 0.1.1

- Display Create Issue and Edit Issue screens as full-screen modal overlays on mobile viewports for enhanced touch usability.
- Optimized mobile header navigation with right-pinned Create action, compact icon-only navigation tabs with counter badges, and theme selector dropdown (Dark, Light, Kiosk).
- Concealed board title and sprint text on small viewports (<640px) to maximize horizontal room for search and actions.
- Header-integrated In-Progress drop target within the Ready column header bar, eliminating layout shift during drag operations.
- Enhanced touch drag interactions with segregated mobile touch sensor (press-and-hold delay) and desktop mouse sensor, container edge auto-scrolling, and `touch-manipulation` optimization.
- Streamlined live WebSocket status indicator into a compact pulsing dot badge on mobile viewports.
- Streamlined Add-on configuration schema by standardizing on Jira Cloud API token and agile boards.
- Visual regression testing stabilization with Playwright `toHaveScreenshot` snapshot assertions.
- Improved CI build resilience against Docker Hub registry rate limiting.

## 0.1.0

- Initial release of the Home Assistant Jira Dashboard Add-on.
- Native Home Assistant Ingress support with dynamic proxy URL resolution (`X-Ingress-Path`).
- Automatic Home Assistant theme design token bridge (`--primary-background-color`, `--card-background-color`, `--ha-card-background`, `--accent-color`).
- Multi-architecture 64-bit Docker container support (`aarch64`, `amd64`).
- Full support for both Jira Cloud (API token) and Jira Data Center / Server (Personal Access Token).
- Real-time WebSocket synchronization across mobile, desktop, and wallboard kiosks.
- Sub-50ms optimistic UI mutations with automatic rollback.
