# Changelog

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
