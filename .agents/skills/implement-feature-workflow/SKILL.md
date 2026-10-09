---
name: implement-feature-workflow
description: Use when requested to implement a new feature, bug fix, UI component, or enhancement on the Home Assistant Jira Dashboard requiring the full development and verification lifecycle.
---

# Feature Implementation Workflow

This skill guides the end-to-end execution of features, bug fixes, and UI improvements within the Home Assistant Jira Dashboard project. It enforces test-driven development, offline resilience, visual regression testing, documentation updates, and strict local CI verification.

---

## 1. Workflow Overview

Every feature implementation MUST execute through the following 7-step sequence:

```
1. Write Tests (including Offline Mode) [RED]
   ↓
2. Implement Screenshot Tests
   ↓
3. Implement Feature Code [GREEN]
   ↓
4. Verify All Automated Tests Pass
   ↓
5. Verify & Update Screenshot Tests
   ↓
6. Update "Roadmap & Phases" Documentation
   ↓
7. Run Local CI & Commit Changes
```

---

## 2. Step-by-Step Instructions

### Step 1: Implement Tests First (Including Offline Mode)
Follow Test-Driven Development (TDD). Write failing tests before writing any production code:
- **Domain & Utility Tests**:
  - Add unit tests in `frontend/src/utils/` or `backend/tests/`.
- **Component Tests**:
  - Add component rendering and interaction tests in `frontend/src/components/*.test.tsx`.
- **Offline Mode Tests**:
  - Always verify offline functionality in `frontend/src/store/offlineReactivity.test.ts` or backend storage outbox tests.
  - Test that the mutation applies optimistically in $<50\text{ms}$ while offline (`fetch` mocked to reject).
  - Verify that mutations are enqueued into `offlineOutbox` in `localStorage` (`ha_jira_offline_outbox_v1`).
  - Verify that reconnecting (`flushOfflineQueue`) replays mutations in FIFO order and reconciles state with zero duplication.
- **Run to Confirm RED**:
  ```bash
  npx pnpm --dir frontend test
  ```
  Ensure tests fail specifically because the feature is not yet implemented.

---

### Step 2: Implement Screenshot & Visual Regression Tests
For any visual change, modal, component, or layout modification:
- Open `frontend/tests/visual/screenshots.spec.ts`.
- Add or update visual test scenarios covering:
  - Component in default/active state (`toHaveScreenshot('component-name.png')`).
  - Viewport variations if applicable (mobile 375px, tablet 768px, desktop 1920px).
  - Dark theme and Light theme / Home Assistant theme bridge.

---

### Step 3: Implement Production Code
Write the minimal code required to satisfy the failing tests:
- Adhere to the Design System (`docs/design_system.md`):
  - Use semantic CSS custom properties (`var(--jira-surface)`, `var(--jira-primary)`, etc.).
  - Minimum touch targets of $44 \times 44\text{px}$.
- Maintain zero perceptual latency (optimistic UI updates in Zustand stores before async API calls).
- Keep code clean, modular, and strictly typed (TypeScript / Python type annotations).

---

### Step 4: Verify All Automated Tests Pass
Run the automated test suite across frontend and backend:
```bash
# Frontend unit tests
npx pnpm --dir frontend test

# Full-stack E2E integration tests (with fake Jira mock)
npx pnpm --dir frontend test:e2e

# Backend tests
uv run pytest backend/tests
```
All unit and integration tests must pass cleanly with 0 failures.

---

### Step 5: Verify Screenshot Tests
Run Playwright screenshot tests against the fake Jira backend:
```bash
# Run screenshot tests
npx pnpm --dir frontend test:visual

# Update snapshots if visual changes are intentional
npx pnpm --dir frontend test:visual:update
```
Verify that all snapshots accurately reflect the intended UI state without regressions.

---

### Step 6: Update "Roadmap & Phases" Documentation
Document the completed work:
- Open `docs/roadmap_and_phases.md`.
- Add an entry under the active or new phase detailing:
  - Feature description and user-facing benefits.
  - Architecture decisions and domain models involved.
  - Offline resilience and optimistic latency guarantees.
  - Test coverage and visual screenshot artifacts produced.
- Verify `README.md` references `docs/roadmap_and_phases.md`.

---

### Step 7: Local CI Verification & Git Commit
Execute the mandatory local CI runner before committing:
```bash
./scripts/run_ci_locally.py
```
Or for full verification with visual and E2E suites:
```bash
./scripts/run_ci_locally.py --visual --e2e
```

Once all checks pass with 100% success, commit using Conventional Commits:
```bash
git add <files>
git commit -m "feat(<scope>): <short description>"
```
Valid prefixes: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
