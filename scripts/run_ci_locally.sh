#!/usr/bin/env bash
set -euo pipefail

# ANSI color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo -e "${BLUE}=== Starting Local CI Pipeline Verification ===${NC}"

# Step 1: Validate GitHub Actions YAML syntax
echo -e "\n${BLUE}Step 1: Validating .github/workflows/ci.yml syntax...${NC}"
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

# Step 2: Backend tests (pytest & unittest)
echo -e "\n${BLUE}Step 2: Running Backend tests (pytest & unittest)...${NC}"
PYTHONPATH=backend/src python3 -m pytest backend/tests
PYTHONPATH=backend/src python3 -m unittest discover -s backend/tests
echo -e "${GREEN}✓ Backend tests passed.${NC}"

# Step 3: Frontend unit tests (Vitest)
echo -e "\n${BLUE}Step 3: Running Frontend unit tests (Vitest)...${NC}"
npx pnpm --dir frontend test
echo -e "${GREEN}✓ Frontend tests passed.${NC}"

# Step 4: Frontend TypeScript check & production build
echo -e "\n${BLUE}Step 4: Running Frontend typecheck & production build (tsc -b && vite build)...${NC}"
npx pnpm --dir frontend build
echo -e "${GREEN}✓ Frontend build succeeded.${NC}"

echo -e "\n${GREEN}=============================================${NC}"
echo -e "${GREEN}🎉 All Local CI Verification Checks Passed! 🎉${NC}"
echo -e "${GREEN}=============================================${NC}"
