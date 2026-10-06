ARG BUILD_FROM=python:3.11-alpine

# =============================================================================
# Stage 1: Build the React 19 Frontend
# =============================================================================
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

# Enable corepack and install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies and build static distribution
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm build

# =============================================================================
# Stage 2: Python Backend Runtime for Home Assistant Add-on
# =============================================================================
FROM ${BUILD_FROM} AS runner
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache curl bash

# Copy backend source code and dependencies
COPY backend/ ./backend/
RUN pip install --no-cache-dir "./backend"

# Copy built frontend assets to static directory for Ingress serving
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose Ingress port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:8000/health || exit 1

# Start Uvicorn ASGI server with dynamic root_path support for Ingress
CMD ["python", "-m", "uvicorn", "jira_dashboard.presentation.main:app", "--host", "0.0.0.0", "--port", "8000"]
