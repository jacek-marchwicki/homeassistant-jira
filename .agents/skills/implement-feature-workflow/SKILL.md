---
name: implement-feature-workflow
description: Use when requested to implement a new feature, bug fix, UI component, or enhancement on the Home Assistant Jira Dashboard requiring the full development and verification lifecycle.
---

# Feature Implementation Workflow

This skill guides the end-to-end implementation of features, bug fixes, and UI improvements within the Home Assistant Jira Dashboard project. It enforces Git worktree isolation, test-driven development (TDD), offline resilience, visual regression testing, documentation updates, and strict local CI verification.

---

## Required Sub-Skills

- **REQUIRED SUB-SKILL:** Use superpowers:using-git-worktrees
- **REQUIRED SUB-SKILL:** Use superpowers:test-driven-development
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch

---

## 1. Workflow Sequence

Every feature implementation MUST execute through the following 9-step sequence:

```
1. Set Up Isolated Worktree (superpowers:using-git-worktrees)
   ↓
2. Write Tests First (including Offline Mode) [RED]
   ↓
3. Implement Screenshot & Visual Regression Tests
   ↓
4. Implement Production Feature Code [GREEN]
   ↓
5. Verify All Automated Tests Pass
   ↓
6. Verify & Update Screenshot Tests
   ↓
7. Update "Roadmap & Phases" Documentation
   ↓
8. Local CI Verification & Git Commit in Worktree
   ↓
9. Finish Development Branch (superpowers:finishing-a-development-branch)
```

---

## 2. Step-by-Step Instructions

### Step 1: Set Up Isolated Git Worktree
Before modifying or creating any code, establish an isolated workspace:
1. **Detect Isolation**: Follow `superpowers:using-git-worktrees` Step 0:
   ```bash
   GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
   GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
   ```
   If `GIT_DIR != GIT_COMMON` (and not in a git submodule), you are already in an isolated worktree. Proceed to step 4 below.
2. **Select Directory**: Use `.worktrees/` at the repository root (pre-configured in `.gitignore`):
   ```bash
   git check-ignore -q .worktrees || echo ".worktrees/ not ignored!"
   ```
3. **Create Worktree & Re-use Shared Data**:
   ```bash
   BRANCH_NAME="feat/<feature-name>"  # or fix/<issue-name>
   git worktree add ".worktrees/${BRANCH_NAME#*/}" -b "$BRANCH_NAME"
   cd ".worktrees/${BRANCH_NAME#*/}"
   ```
   > [!NOTE]
   > The repository's Git `post-checkout` hook automatically links `data -> ../../data`, allowing the SQLite schema, cached Jira issues, and AI background pictures cache to be reused across all worktrees. If the worktree was generated without hooks, run `python3 scripts/setup_worktree_data.py` to establish the symlink.
4. **All Subsequent Work Happens Here**: Every file edit, test run, documentation change, and commit MUST occur within this isolated worktree directory.
5. **Verify Clean Baseline**:
   Run `./scripts/run_ci_locally.py` to ensure all tests and builds pass before making changes.

---

### Step 2: Implement Tests First (Including Offline Mode) [RED]
Follow Test-Driven Development (`superpowers:test-driven-development`). Write failing tests before writing any production code:
- **Domain & Utility Tests**:
  - Add unit tests in `frontend/src/utils/` or `backend/tests/`.
- **Component Tests**:
  - Add component rendering and interaction tests in `frontend/src/components/*.test.tsx`.
- **Offline Mode Tests**:
  - Always verify offline functionality in `frontend/src/store/offlineReactivity.test.ts` or backend storage outbox tests.
  - Test that the mutation applies optimistically in $< 50\text{ms}$ while offline (`fetch` mocked to reject).
  - Verify that mutations are enqueued into `offlineOutbox` in `localStorage` (`ha_jira_offline_outbox_v1`).
  - Verify that reconnecting (`flushOfflineQueue`) replays mutations in FIFO order and reconciles state with zero duplication.
- **Run to Confirm RED**:
  ```bash
  npx pnpm --dir frontend test
  ```
  Ensure tests fail specifically because the feature is not yet implemented.

---

### Step 3: Implement Screenshot & Visual Regression Tests
For any visual change, modal, component, or layout modification:
- Open `frontend/tests/visual/screenshots.spec.ts`.
- Add or update visual test scenarios covering:
  - Component in default/active state (`toHaveScreenshot('component-name.png')`).
  - Viewport variations if applicable (mobile 375px, tablet 768px, desktop 1920px).
  - Dark theme and Light theme / Home Assistant theme bridge.

---

### Step 4: Implement Production Code [GREEN]
Write the minimal code required to satisfy the failing tests:
- Adhere to the Design System (`docs/design_system.md`):
  - Use semantic CSS custom properties (`var(--jira-surface)`, `var(--jira-primary)`, etc.).
  - Minimum touch targets of $44 \times 44\text{px}$.
- Maintain zero perceptual latency (optimistic UI updates in Zustand stores before async API calls).
- Keep code clean, modular, and strictly typed (TypeScript / Python type annotations).

---

### Step 5: Verify All Automated Tests Pass
Run the automated test suite across frontend and backend from the worktree:
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

### Step 6: Verify Screenshot Tests
Run Playwright screenshot tests against the fake Jira backend:
```bash
# Run screenshot tests
npx pnpm --dir frontend test:visual

# Update snapshots if visual changes are intentional
npx pnpm --dir frontend test:visual:update
```
Verify that all snapshots accurately reflect the intended UI state without regressions.

---

### Step 7: Update "Roadmap & Phases" Documentation
Document the completed work:
- Open `docs/roadmap_and_phases.md`.
- Add an entry under the active or new phase detailing:
  - Feature description and user-facing benefits.
  - Architecture decisions and domain models involved.
  - Offline resilience and optimistic latency guarantees.
  - Test coverage and visual screenshot artifacts produced.
- Verify `README.md` references `docs/roadmap_and_phases.md`.

---

### Step 8: Local CI Verification & Git Commit in Worktree
Execute the mandatory local CI runner from the worktree root before committing:
```bash
./scripts/run_ci_locally.py
```
Or for full verification with visual and E2E suites:
```bash
./scripts/run_ci_locally.py --visual --e2e
```

Once all checks pass with 100% success, commit on the feature branch using Conventional Commits:
```bash
git add <files>
git commit -m "feat(<scope>): <short description>"
```
Valid prefixes: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

---

### Step 9: Finish Development Branch
Follow `superpowers:finishing-a-development-branch` to integrate the work:
1. Verify all tests pass on the branch.
2. Present integration options to the user:
   - Option 1: Merge back to `main` locally.
   - Option 2: Push and create a Pull Request.
   - Option 3: Keep the branch as-is in `.worktrees/<branch>`.
3. If Option 1 is chosen:
   - Switch to the main repository root.
   - Merge the feature branch into `main`.
   - Run verification tests on the merged result.
   - Clean up the worktree:
     ```bash
     git worktree remove ".worktrees/<branch-name>"
     git worktree prune
     git branch -d "$BRANCH_NAME"
     ```
4. If Option 2 or 3 is chosen: preserve the worktree for review iterations.

---

## 3. Quick Reference

| Stage | Action / Command | Required Outcome |
|---|---|---|
| **Worktree Setup** | `git worktree add .worktrees/<name> -b feat/<name>` | Clean isolated workspace; verified baseline |
| **TDD (RED)** | `npx pnpm --dir frontend test` | Tests fail specifically for missing feature |
| **Visual Tests** | `frontend/tests/visual/screenshots.spec.ts` | Test coverage for all viewport & theme states |
| **Implementation** | Minimal production code | Passes TDD assertions; adheres to Design System |
| **Automated Tests** | Unit + E2E + pytest suites | 100% passing tests across frontend and backend |
| **Visual Verify** | `npx pnpm --dir frontend test:visual` | Snapshot parity with zero unintended diffs |
| **Docs Update** | Update `docs/roadmap_and_phases.md` | Phases, architecture, and offline behavior documented |
| **Local CI Runner** | `./scripts/run_ci_locally.py` | 100% green CI pipeline |
| **Finish Branch** | `superpowers:finishing-a-development-branch` | User chooses merge, PR, or keep; clean workspace |

---

## 4. Common Mistakes & Red Flags

| Mistake / Excuse | Reality & Countermeasure |
|---|---|
| *"It's a small fix, I can edit directly on `main`"* | **STOP.** Always set up a worktree via `superpowers:using-git-worktrees`. Protects `main` and keeps untracked artifacts isolated. |
| *"I'll create the worktree in an arbitrary folder"* | Use `.worktrees/` at repository root. It is verified in `.gitignore` to prevent recursive repository commits. |
| *"Skip baseline tests to save time"* | Always verify a clean baseline. A dirty baseline makes it impossible to know if later failures are regressions. |
| *"I can write tests after the feature code"* | Violates TDD. Write failing tests first [RED], confirm failure reason, then write code [GREEN]. |
| *"I don't need to run `./scripts/run_ci_locally.py` before committing"* | Local CI is mandatory under `AGENTS.md`. Never bypass checks. |
| *"I'll delete or merge the worktree without asking"* | Integration choice belongs to the user. Present the options via `superpowers:finishing-a-development-branch` and wait for confirmation. |
