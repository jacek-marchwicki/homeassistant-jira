---
name: release-app-workflow
description: Use when requested to release, publish, deploy, or bump the version of the Home Assistant Jira Dashboard for Home Assistant Add-on, standalone Docker container, or GCP Cloud Run.
---

# Release Automation & Deployment Workflow

This skill guides contributors and AI agents through releasing a new version of the **Home Assistant Jira Dashboard** for both the **Home Assistant Add-on / Standalone Container (GHCR)** and **Google Cloud Platform (GCP Cloud Run)**.

---

## 1. Overview & Dual Deployment Model

Releases synchronize across two distinct deployment targets:

1. **Home Assistant Add-on & Standalone Container**:
   - Built as multi-architecture Docker container images (`linux/amd64`, `linux/arm64`/`aarch64`).
   - Triggered automatically by GitHub Actions when an annotated Git tag `vX.Y.Z` or a GitHub Release is published.
   - Pushed to GitHub Container Registry (`ghcr.io/jacek-marchwicki/homeassistant-jira-{arch}:X.Y.Z` and `ghcr.io/jacek-marchwicki/homeassistant-jira:X.Y.Z`).

2. **Google Cloud Platform (Cloud Run)**:
   - Deployed directly via `scripts/deploy_gcp.py deploy`.
   - Provisions and synchronizes Cloud Run revisions, Google Cloud Secret Manager credentials, Firestore databases, and GCS image storage buckets.

All release steps are fully automated via the unified CLI script:
[`scripts/release.py`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/scripts/release.py).

---

## 2. Fast Release Commands

Run the automation script from the repository root:

```bash
# 1. Preview changes and release notes without making any modifications (safe check)
python3 scripts/release.py --dry-run

# 2. Release next patch version (e.g. 0.9.0 -> 0.9.1) with full CI, Git tag, GH release, and GCP deploy
python3 scripts/release.py

# 3. Release next minor version (e.g. 0.9.0 -> 0.10.0)
python3 scripts/release.py --bump minor

# 4. Release next major version (e.g. 0.9.0 -> 1.0.0)
python3 scripts/release.py --bump major

# 5. Release an explicit target version
python3 scripts/release.py --version 0.10.0

# 6. Provide custom release notes
python3 scripts/release.py --notes "- Added feature X\n- Resolved issue Y"

# 7. Release only Home Assistant add-on (skips GCP deployment)
python3 scripts/release.py --home-assistant-only

# 8. Deploy current code only to GCP Cloud Run (skips version bump and Git tag)
python3 scripts/release.py --gcp-only
```

---

## 3. The 13 Version Manifest Files

`scripts/release.py` automatically keeps all 13 repository version files synchronized in lockstep:

| # | File Path | Field / Pattern |
|---|-----------|-----------------|
| 1 | `addon/config.yaml` | `version: "X.Y.Z"` |
| 2 | `addon/build.yaml` | `BUILD_VERSION: "X.Y.Z"` |
| 3 | `addon/CHANGELOG.md` | Prepend `## X.Y.Z` section |
| 4 | `backend/pyproject.toml` | `version = "X.Y.Z"` |
| 5 | `backend/src/jira_dashboard/__init__.py` | `__version__ = "X.Y.Z"` |
| 6 | `backend/src/jira_dashboard/adapters/jira_cloud_client.py` | `User-Agent: "HomeAssistant-JiraDashboard/X.Y.Z"` |
| 7 | `backend/src/jira_dashboard/presentation/main.py` | `version="X.Y.Z"` |
| 8 | `backend/tests/test_packaging_and_addon.py` | `assert config["version"] == "X.Y.Z"` & changelog check |
| 9 | `backend/tests/test_placeholder.py` | `self.assertEqual(jira_dashboard.__version__, "X.Y.Z")` |
| 10 | `frontend/package.json` | `"version": "X.Y.Z"` |
| 11 | `frontend/src/utils/version.ts` | Fallback default version `'X.Y.Z'` |
| 12 | `frontend/src/utils/version.test.ts` | Unit test assertion matching `'X.Y.Z'` |
| 13 | `frontend/src/components/SettingsView.test.tsx` | Settings view version badge assertions |

---

## 4. End-to-End Release Sequence

When executing a release, follow this disciplined procedure:

```
1. Ensure Clean Working Tree on main branch
   ↓
2. Preview with Dry Run
   python3 scripts/release.py --dry-run
   ↓
3. Execute Release
   python3 scripts/release.py [--bump minor|patch|major]
   ↓
4. Verify GitHub Actions GHCR Image Builds
   gh run list --workflow=publish-images.yml
   ↓
5. Verify Live GCP Health Endpoint
   curl -s https://<gcp-cloud-run-domain>/api/health
```

### Step 1: Ensure Clean Branch State
Make sure local `main` has all desired commits and the working tree is clean:
```bash
git checkout main
git pull origin main
git status
```

### Step 2: Execute Release Script
Execute `scripts/release.py`. The script will:
1. Parse the current version.
2. Calculate target version (or use `--version`).
3. Extract git commits since last tag to compose release notes.
4. Update all 13 version manifests and changelog.
5. Run [`scripts/run_ci_locally.py`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/scripts/run_ci_locally.py) (all backend tests, frontend tests, linting, formatting, typechecking, and production builds).
6. Create commit `chore(release): bump version to X.Y.Z`.
7. Create annotated tag `vX.Y.Z`.
8. Push commits and tags to GitHub.
9. Publish GitHub Release via `gh release create`.
10. Trigger `scripts/deploy_gcp.py deploy` to deploy the new revision to Cloud Run.

### Step 3: Monitor GitHub Container Image Build
Check that GitHub Actions has built and published the multi-arch images to GHCR:
```bash
gh run list --workflow=publish-images.yml -L 1
gh run view <run-id>
```

### Step 4: Verify Live Endpoints
Verify that the live GCP Cloud Run service is serving the newly released version:
```bash
curl -s https://home-taskmanager-4ln37ygzvq-ew.a.run.app/api/health
# Expected: {"status":"ok","app":"homeassistant-jira","version":"X.Y.Z"}
```

---

## 5. Troubleshooting & Edge Cases

### Skipped or Failed Local CI Checks
If tests fail during pre-release verification, the script aborts immediately before any commits, tags, or pushes occur. Fix the failing test, run `./scripts/run_ci_locally.py` to verify, then re-run `python3 scripts/release.py`.

### Emergency Hotfix Deploy to GCP Only
To push a critical bugfix to Cloud Run without cutting an Add-on version tag:
```bash
python3 scripts/release.py --gcp-only
```

### GitHub CLI Not Authenticated
If `gh` is not installed or authenticated, `scripts/release.py` will push the Git tag to `origin` (which still triggers GHCR container image builds via GitHub Actions), and print instructions to create the GitHub release manually if desired.
