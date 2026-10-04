#!/usr/bin/env bash
set -euo pipefail

# ANSI color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

show_help() {
    cat << EOF
Usage: ./scripts/run_ci_locally.sh [OPTIONS] [EXTRA_ACT_ARGS...]

Run the project's Continuous Integration checks locally.
Supports both fast native host execution and containerized GitHub Actions simulation via nektos/act.

MODES:
  (default)               Run fast native quality checks directly on your host (~1-2s).
                          Requires Python (with ruff, pytest) and Node/pnpm installed locally.
  --act, --docker         Run GitHub Actions workflow inside Docker containers via 'act'.
                          Matches GitHub Actions environment exactly (Ubuntu, multi-version matrix, etc.).
                          Requires Docker daemon and 'act' CLI installed.
  --native                Explicitly force native execution mode.

OPTIONS:
  -j, --job <NAME>        Run only a specific job when using --act (e.g. -j backend or -j frontend).
  -n, -d, --dry-run       Dry-run mode for 'act' (validates workflow graph and actions without running containers).
  -l, --list              List all available workflow jobs using 'act -l'.
  -h, --help              Show this help message and exit.

EXAMPLES:
  ./scripts/run_ci_locally.sh                     # Fast local check (recommended for TDD)
  ./scripts/run_ci_locally.sh --act               # Full GitHub Actions simulation in Docker
  ./scripts/run_ci_locally.sh --act -j backend    # Run only backend job (all Python matrix versions)
  ./scripts/run_ci_locally.sh --act --dry-run     # Validate workflow steps without running containers
EOF
}

# Mode selection: 'native' (default) or 'act'
MODE="native"
ACT_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            show_help
            exit 0
            ;;
        --act|--docker)
            MODE="act"
            shift
            ;;
        --native)
            MODE="native"
            shift
            ;;
        -j|--job)
            MODE="act"
            if [[ $# -lt 2 ]]; then
                echo -e "${RED}Error: --job requires a job name argument (e.g. -j backend).${NC}" >&2
                exit 1
            fi
            ACT_ARGS+=("-j" "$2")
            shift 2
            ;;
        -n|-d|--dry-run)
            MODE="act"
            ACT_ARGS+=("-n")
            shift
            ;;
        -l|--list)
            MODE="act"
            ACT_ARGS+=("-l")
            shift
            ;;
        *)
            # Forward any additional arguments directly to act if in act mode
            ACT_ARGS+=("$1")
            shift
            ;;
    esac
done

if [[ "$MODE" == "act" ]]; then
    echo -e "${BLUE}=== Running GitHub Actions Workflow with 'act' ===${NC}"

    # 1. Check if 'act' CLI is installed
    if ! command -v act >/dev/null 2>&1; then
        echo -e "${RED}Error: 'act' is not installed.${NC}" >&2
        echo -e "To install 'act' on macOS, run: ${BLUE}brew install act${NC}"
        echo -e "For other systems, see: https://github.com/nektos/act"
        exit 1
    fi

    # 2. Check if Docker daemon is running
    if ! docker info >/dev/null 2>&1; then
        echo -e "${RED}Error: Docker daemon is not running or not accessible.${NC}" >&2
        echo -e "Please start Docker Desktop (or your Docker engine) to run containerized GitHub Actions."
        exit 1
    fi

    # 3. Configure container architecture (Apple Silicon requires linux/amd64 for GH runner images)
    ACT_FLAGS=()
    if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
        ACT_FLAGS+=(--container-architecture linux/amd64)
    fi

    echo -e "${GREEN}✓ 'act' and Docker daemon detected.${NC}"
    if [[ ${#ACT_FLAGS[@]} -gt 0 ]]; then
        echo -e "${YELLOW}Notice: Using ${ACT_FLAGS[*]} for Apple Silicon compatibility.${NC}"
    fi

    echo -e "\n${BLUE}Executing: act ${ACT_FLAGS[*]} ${ACT_ARGS[*]}${NC}\n"
    exec act "${ACT_FLAGS[@]}" "${ACT_ARGS[@]}"
fi

# ==============================================================================
# Native Mode (Default) - Fast local verification loop (~1-2 seconds)
# ==============================================================================

echo -e "${BLUE}=== Starting Fast Local CI Pipeline Verification (Native Mode) ===${NC}"
echo -e "${YELLOW}(Tip: Run './scripts/run_ci_locally.sh --act' to simulate GitHub Actions in Docker)${NC}\n"

# Step 1: Validate GitHub Actions YAML syntax
echo -e "${BLUE}Step 1: Validating .github/workflows/ci.yml syntax...${NC}"
python3 -c "
import yaml, sys
with open('.github/workflows/ci.yml') as f:
    try:
        data = yaml.safe_load(f)
        assert 'jobs' in data, 'Missing jobs definition'
        assert 'backend' in data['jobs'], 'Missing backend job'
        assert 'frontend' in data['jobs'], 'Missing frontend job'
        print('  ✓ GitHub Actions workflow YAML is syntactically valid and well-structured.')
    except Exception as e:
        print(f'  ✗ Invalid workflow YAML: {e}', file=sys.stderr)
        sys.exit(1)
"
echo -e "${GREEN}✓ Workflow syntax validated.${NC}"

# Step 2: Ruff Linting & Formatting Check
echo -e "\n${BLUE}Step 2: Checking Backend code quality with Ruff...${NC}"
python3 -m ruff check backend/
python3 -m ruff format --check backend/
echo -e "${GREEN}✓ Ruff linting and formatting passed.${NC}"

# Step 3: Backend tests (pytest & unittest)
echo -e "\n${BLUE}Step 3: Running Backend tests (pytest & unittest)...${NC}"
PYTHONPATH=backend/src python3 -m pytest backend/tests
PYTHONPATH=backend/src python3 -m unittest discover -s backend/tests
echo -e "${GREEN}✓ Backend tests passed.${NC}"

# Step 4: Frontend unit tests (Vitest)
echo -e "\n${BLUE}Step 4: Running Frontend unit tests (Vitest)...${NC}"
npx pnpm --dir frontend test
echo -e "${GREEN}✓ Frontend tests passed.${NC}"

# Step 5: Frontend TypeScript check & production build
echo -e "\n${BLUE}Step 5: Running Frontend typecheck & production build (tsc -b && vite build)...${NC}"
npx pnpm --dir frontend build
echo -e "${GREEN}✓ Frontend build succeeded.${NC}"

echo -e "\n${GREEN}=============================================${NC}"
echo -e "${GREEN}🎉 All Local CI Verification Checks Passed! 🎉${NC}"
echo -e "${GREEN}=============================================${NC}"
