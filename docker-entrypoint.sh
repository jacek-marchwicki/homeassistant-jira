#!/bin/sh
set -e

# Default database path in container
DB_PATH="${SQLITE_DB_PATH:-/data/jira_dashboard.sqlite3}"

# Ensure parent directory for SQLite database exists and is writable
mkdir -p "$(dirname "$DB_PATH")" 2>/dev/null || true

# If LITESTREAM_BUCKET is configured, restore and continuously replicate SQLite to GCS
if [ -n "$LITESTREAM_BUCKET" ]; then
    GCS_URL="gcs://${LITESTREAM_BUCKET}/db"

    echo "==> Litestream configured for replica: $GCS_URL"
    echo "==> Restoring SQLite database if replica exists and db does not exist..."
    litestream restore -if-db-not-exists -if-replica-exists -o "$DB_PATH" "$GCS_URL" || {
        echo "==> Warning: Litestream restore encountered an issue; proceeding with startup."
    }

    echo "==> Starting application with continuous Litestream replication to GCS..."
    exec litestream replicate -exec "python -m uvicorn jira_dashboard.presentation.main:app --host 0.0.0.0 --port ${PORT:-8000}" "$DB_PATH" "$GCS_URL"
else
    echo "==> LITESTREAM_BUCKET not set. Running standalone without Litestream replication."
    if [ "$#" -gt 0 ]; then
        exec "$@"
    else
        exec python -m uvicorn jira_dashboard.presentation.main:app --host 0.0.0.0 --port "${PORT:-8000}"
    fi
fi
