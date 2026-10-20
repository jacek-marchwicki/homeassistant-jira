ARG BUILDPLATFORM=linux/amd64

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

# Install runtime utilities (curl for healthcheck, bash, ca-certificates)
RUN apk add --no-cache curl bash ca-certificates

# Install Litestream for SQLite continuous replication to Google Cloud Storage
ARG LITESTREAM_VERSION=0.3.13
ADD https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && rm /tmp/litestream.tar.gz

# Create non-root application user for container security
RUN addgroup -g 10001 -S appuser && \
    adduser -u 10001 -S appuser -G appuser

# Ensure /data directory exists and is writable by appuser
RUN mkdir -p /data && chown -R appuser:appuser /data

# Copy backend dependencies and install
COPY backend/ ./backend/
RUN pip install --no-cache-dir "./backend"

# Copy pre-built frontend distribution from builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Copy entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Ensure appuser owns the application and data directories
RUN chown -R appuser:appuser /app /data

# Switch to unprivileged user
USER appuser

# Expose standard web application port
EXPOSE 8000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:8000/health || exit 1

# Start FastAPI application via entrypoint (which supports Litestream replication or direct Uvicorn)
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["python", "-m", "uvicorn", "jira_dashboard.presentation.main:app", "--host", "0.0.0.0", "--port", "8000"]
