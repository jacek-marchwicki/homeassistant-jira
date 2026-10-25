# Cache-Control Headers and PWA Automatic Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the Jira Dashboard is fully functional offline while automatically revalidating and refreshing entrypoints (`index.html`, `sw.js`) when online without stale bundle locking.

**Architecture:** Configure `SPAStaticFiles` in FastAPI to serve fine-grained `Cache-Control` headers (`no-cache, must-revalidate` on HTML and Service Worker scripts, `immutable` on hashed assets in `/assets/`). Update `sw.js` navigation caching to network-first with `cache: 'no-cache'`, register `sw.js` with `updateViaCache: 'none'`, and wire periodic update polling in `pwa.ts`.

**Tech Stack:** FastAPI / Starlette, Service Worker API, Vite, Vitest, Pytest.

## Global Constraints
- Do not use `no-store` on HTML or Service Worker scripts (to avoid breaking the Service Worker Cache Storage API offline fallback).
- Ingress dynamic subpaths must be preserved.
- All verification steps in `./scripts/run_ci_locally.py` must pass with 100% success.

---

### Task 1: Backend Cache-Control Headers on SPAStaticFiles

**Files:**
- Modify: `backend/src/jira_dashboard/presentation/main.py`
- Modify: `backend/tests/test_spa_fallback.py`

- [ ] **Step 1: Write the failing tests in `backend/tests/test_spa_fallback.py`**
  - Add test asserting `Cache-Control: no-cache, must-revalidate` is present on `GET /` and client routes (`/task/HOME-123`).
  - Add test asserting `Cache-Control: no-cache, must-revalidate` is present on `GET /sw.js`.
  - Add test asserting `Cache-Control: public, max-age=31536000, immutable` is present on `GET /assets/*`.
- [ ] **Step 2: Run pytest to verify tests fail**
- [ ] **Step 3: Implement `Cache-Control` header injection in `SPAStaticFiles.get_response` in `main.py`**
- [ ] **Step 4: Run pytest to verify tests pass**
- [ ] **Step 5: Commit changes with Conventional Commits**

---

### Task 2: Service Worker & PWA Lifecycle Updates

**Files:**
- Modify: `frontend/public/sw.js`
- Modify: `frontend/src/utils/pwa.ts`
- Modify: `frontend/src/utils/pwa.test.ts`

- [ ] **Step 1: Write unit tests in `frontend/src/utils/pwa.test.ts`**
  - Verify `registerServiceWorker` passes `{ scope: './', updateViaCache: 'none' }`.
  - Verify periodic update / visibility listener invokes `registration.update()`.
- [ ] **Step 2: Run vitest to verify tests fail**
- [ ] **Step 3: Update `frontend/public/sw.js` navigation handler**
  - Ensure `fetch(request, { cache: 'no-cache' })` is used on navigation and `./` requests with offline catch fallback.
  - Bump cache version to `jira-dashboard-v2`.
- [ ] **Step 4: Update `frontend/src/utils/pwa.ts`**
  - Set `updateViaCache: 'none'`.
  - Add `checkForServiceWorkerUpdates(registration)` triggered on `visibilitychange` and hourly interval.
- [ ] **Step 5: Run vitest to verify all tests pass**
- [ ] **Step 6: Commit changes with Conventional Commits**

---

### Task 3: Full-Stack Verification & CI

- [ ] **Step 1: Run full local CI runner `./scripts/run_ci_locally.py` in worktree**
- [ ] **Step 2: Verify zero errors across Ruff, Pytest, Vitest, and Vite production build**
