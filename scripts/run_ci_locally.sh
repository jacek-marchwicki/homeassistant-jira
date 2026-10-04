#!/usr/bin/env bash
set -euo pipefail

# Thin backward-compatible wrapper around run_ci_locally.py
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/run_ci_locally.py" "$@"
