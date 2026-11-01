# Import Android Kiosk App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the TestAppIntegrator Android application into this repository under the `android/` sub-directory, preserving full Git commit history, setting up an isolated Git worktree, verifying clean builds and tests, ensuring sensitive security keys are protected, and updating project documentation.

**Architecture:** Monorepo integration placing the Android Kiosk companion application in `android/` alongside `backend/` and `frontend/`. Git history is preserved using Git subtree import (`git subtree add --prefix=android ...`), which replays the entire commit chain while mapping files into the `android/` folder. Root `.gitignore` and CI integration ensure keystores and local SDK configs remain untracked.

**Tech Stack:** Kotlin, Jetpack Compose, Android SDK 36 (target/compile), Gradle 8+, Git Worktrees, Git Subtree.

## Global Constraints

- Must work in a dedicated isolated Git worktree under `.worktrees/feat-import-android-kiosk-app`.
- Must preserve 100% of the commit history from `TestAppIntegrator` (`600d1fe` through `677e4c8`).
- Must strictly prevent committing private keystores (`release.jks`, `*.jks`) or `keystore.properties` into git.
- Must verify that Android unit tests and debug assemble build cleanly within the new `android/` directory.
- Must pass the project's local CI verification (`./scripts/run_ci_locally.py`).

---

## Security Investigation Summary

Prior to execution, an audit of `/Users/jacek/Documents/apps/jacek-marchwicki/TestAppIntegrator` revealed:
1. **Keystore (`app/release.jks`)**: Present on disk; ignored by `.gitignore`; **NEVER committed to Git**.
2. **Keystore Properties (`keystore.properties`)**: Present on disk containing store/key passwords; ignored by `.gitignore`; **NEVER committed to Git**.
3. **Local Properties (`local.properties`)**: Contains local machine `sdk.dir`; ignored by `.gitignore`; **NEVER committed to Git**.
4. **Public Certificate (`upload_certificate.pem`)**: Committed in commit `b5761c5`. Verified via OpenSSL to be a standard X.509 RSA public key certificate (no private key material). Safe to keep or retain as part of history.
5. **Fallback Plaintext Passwords**: In `app/build.gradle.kts` and `README.md`, fallback password `"testapp123"` was committed in early commits. As part of post-import cleanup, we will remove fallback plaintext passwords from `android/app/build.gradle.kts` and clean up `android/README.md`.

---

## Tasks

### Task 1: Create Isolated Worktree
- [ ] Announce using `superpowers:using-git-worktrees` skill.
- [ ] Create branch `feat/import-android-kiosk-app` in worktree `.worktrees/feat-import-android-kiosk-app`:
  ```bash
  git worktree add .worktrees/feat-import-android-kiosk-app -b feat/import-android-kiosk-app
  ```
- [ ] Verify clean worktree environment and check git status.

### Task 2: Import TestAppIntegrator Preserving Git History
- [ ] In the worktree directory, import the `TestAppIntegrator` repository into sub-directory `android/` using `git subtree`:
  ```bash
  git subtree add --prefix=android /Users/jacek/Documents/apps/jacek-marchwicki/TestAppIntegrator main -m "feat(android): import Android Kiosk app preserving history"
  ```
- [ ] Verify that `git log --oneline android/` reflects the full history of 25 commits from `600d1fe` up to `677e4c8`.
- [ ] Copy non-tracked local development files needed for local building if present (`local.properties` with `sdk.dir` from local environment), ensuring they remain strictly untracked.

### Task 3: Configure Gitignore & Security Boundaries
- [ ] Update root `.gitignore` in `homeassistant-jira` to include standard Android ignore patterns:
  - `.gradle/`
  - `android/.gradle/`
  - `android/local.properties`
  - `android/**/build/`
  - `android/*.jks`
  - `android/**/*.jks`
  - `android/keystore.properties`
  - `android/.idea/`
- [ ] In `android/app/build.gradle.kts`, refactor signing configuration so it requires environment variables or `keystore.properties` rather than defaulting to hardcoded fallback passwords (`testapp123`).
- [ ] Verify `git status` confirms no `.jks`, `.gradle/`, or `keystore.properties` are staged or untracked.

### Task 4: Build & Test Verification in New Sub-directory
- [ ] Inside `android/`, execute:
  ```bash
  cd android && ./gradlew assembleDebug test
  ```
- [ ] Verify that all 44+ Gradle tasks execute cleanly, unit tests pass (`KioskPreferencesTest`, `WebErrorClassifierTest`, etc.), and `android/app/build/outputs/apk/debug/app-debug.apk` is generated.
- [ ] Verify project local CI pipeline passes:
  ```bash
  ./scripts/run_ci_locally.py
  ```

### Task 5: Documentation Update
- [ ] Update root `README.md` to add a new section introducing the **Android Kiosk Companion Application** (`android/`):
  - Purpose: Fullscreen lockscreen kiosk webview for wall-mounted Android tablets displaying the Home Assistant Jira Dashboard.
  - Key features: Auto wake/lock handling, display zoom scaling, theme auto-detection (light/dark), error overlay with auto-retry, cache management.
  - Quick-start build instructions (`cd android && ./gradlew assembleDebug`).
- [ ] Update `AGENTS.md` and/or architecture docs if appropriate to reference the `android/` companion subproject.
- [ ] Update `android/README.md` to reflect its place within the `homeassistant-jira` monorepo.

### Task 6: Final Verification & Commit
- [ ] Run full local CI suite `./scripts/run_ci_locally.py`.
- [ ] Review git diff and commit history.
- [ ] Commit all changes according to Conventional Commits: `docs: document Android Kiosk companion application in README`.
