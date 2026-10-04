# Stage 1: Build the React 19 Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend

# Enable corepack and install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies and build
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm build

# Stage 2: Python Backend Runtime for Home Assistant Add-on
FROM python:3.11-alpine AS runner
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache curl bash

# Install backend dependencies
COPY backend/pyproject.toml ./backend/
RUN pip install --no-cache-dir -e "./backend"

# Copy backend source code
COPY backend/src ./backend/src

# Copy built frontend assets to static directory for Ingress serving
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose Ingress port
EXPOSE 8000

# Start Uvicorn ASGI server with dynamic root_path support for Ingress
CMD ["python", "-m", "uvicorn", "jira_dashboard.presentation.main:app", "--host", "0.0.0.0", "--port", "8000"]
