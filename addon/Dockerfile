ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-python:3.11-alpine

# =============================================================================
# Stage 1: Build the React 19 Frontend
# =============================================================================
FROM node:22-alpine AS frontend-builder
WORKDIR /build

# Install git to fetch repository source code within add-on build context
RUN apk add --no-cache git

ARG REPO_URL=https://github.com/jacek-marchwicki/homeassistant-jira.git
ARG BUILD_VERSION=main

# Clone repository source (matching release tag, version, or default branch)
RUN git clone --depth 1 --branch "v${BUILD_VERSION}" "${REPO_URL}" /build/src 2>/dev/null || \
    git clone --depth 1 --branch "${BUILD_VERSION}" "${REPO_URL}" /build/src 2>/dev/null || \
    git clone --depth 1 "${REPO_URL}" /build/src

# Enable corepack and install pnpm
WORKDIR /build/src/frontend
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm build

# =============================================================================
# Stage 2: Python Backend Runtime for Home Assistant Add-on
# =============================================================================
FROM ${BUILD_FROM} AS runner
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache curl bash

# Copy backend source code and dependencies from builder stage
COPY --from=frontend-builder /build/src/backend ./backend
RUN pip install --no-cache-dir "./backend"

# Copy built frontend assets to static directory for Ingress serving
COPY --from=frontend-builder /build/src/frontend/dist ./frontend/dist

# Expose Ingress port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:8000/health || exit 1

# Start Uvicorn ASGI server with dynamic root_path support for Ingress
CMD ["python", "-m", "uvicorn", "jira_dashboard.presentation.main:app", "--host", "0.0.0.0", "--port", "8000"]
