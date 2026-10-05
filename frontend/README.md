# Jira Dashboard Frontend

The modern, ultra-responsive web frontend for the **Home Assistant Jira Dashboard**.

## Technology Stack

- **Framework**: React 19 + TypeScript
- **Styling & Tokens**: Tailwind CSS v4 + Design Tokens with Home Assistant CSS variable bridge
- **State & Optimistic UI**: Zustand with instant sync queue
- **Drag & Drop**: @dnd-kit (accessible, cross-device touch & pointer sensors)
- **Icons**: Lucide React
- **Progressive Web App (PWA)**: Web App Manifest, Service Worker (`sw.js`), adaptive Android maskable icons (192x192 & 512x512), and in-app install prompt for Android and mobile browsers
- **Bundler**: Vite configured with relative base path (`base: './'`) for dynamic Home Assistant Ingress proxying

## Getting Started (pnpm)

```bash
# Install dependencies
pnpm install

# Run dev server with hot module reload
pnpm dev

# Typecheck and build for production
pnpm build

# Run component and unit tests
pnpm test
```
