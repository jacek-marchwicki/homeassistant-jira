# =============================================================================
# Stage 1: Build Frontend Assets (React 19 + TypeScript + Vite + Tailwind CSS)
# =============================================================================
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

# Enable corepack and activate modern pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies with frozen lockfile for deterministic builds
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy frontend source and build static distribution
COPY frontend/ ./
RUN pnpm build

# =============================================================================
# Stage 2: Python Backend Runtime (Standalone Web Application)
# =============================================================================
FROM python:3.11-alpine AS runner
WORKDIR /app

# Install runtime utilities (curl for healthcheck, bash)
RUN apk add --no-cache curl bash

# Create non-root application user for container security
RUN addgroup -g 10001 -S appuser && \
    adduser -u 10001 -S appuser -G appuser

# Copy backend dependencies and install
COPY backend/ ./backend/
RUN pip install --no-cache-dir "./backend"

# Copy pre-built frontend distribution from builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Ensure appuser owns the application directories
RUN chown -R appuser:appuser /app

# Switch to unprivileged user
USER appuser

# Expose standard web application port
EXPOSE 8000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:8000/health || exit 1

# Start FastAPI application via Uvicorn ASGI server
CMD ["python", "-m", "uvicorn", "jira_dashboard.presentation.main:app", "--host", "0.0.0.0", "--port", "8000"]
