# Gemini AI Task Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide AI-generated kid-friendly visual backgrounds for individual tasks using `google-genai` and `gemini-3.1-flash-lite-image` with content-addressed caching, 5-minute debounce settling, a 100 images/day limit, 30-day retention pruning, and a high-contrast text overlay.

**Architecture:** Backend FastAPI endpoint `GET /api/issues/{key}/background` dynamically computes content hashes, checks a 5-minute debounce settling window, enforces daily generation limits, and streams cached `.webp` files from disk with SQLite metadata. The frontend renders cards and details modal with a gradient overlay that preserves WCAG text readability.

**Tech Stack:** Python 3.10+, FastAPI, SQLite3, `google-genai`, React 19, TypeScript, Tailwind CSS v4, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-10-gemini-task-backgrounds-design.md`](file:///Users/jacek/Documents/apps/jacek-marchwicki/homeassistant-jira/docs/superpowers/specs/2026-10-10-gemini-task-backgrounds-design.md)

## Global Constraints

- Default model is `gemini-3.1-flash-lite-image`, configurable via `GEMINI_MODEL`.
- Feature is optional: if `GEMINI_API_KEY` is unset or empty, endpoint returns `204 No Content` and frontend renders default background.
- Cache directory is fixed internally to `/data/background_cache` (production) or `backend/data/background_cache` (dev/testing).
- `GEMINI_DEBOUNCE_SECONDS` defaults to 300 (5 minutes).
- `GEMINI_CACHE_RETENTION_SECONDS` defaults to 2,592,000 (30 days).
- `GEMINI_DAILY_LIMIT` defaults to 100 images/day.
- Automated tests MUST use mocks and never make outbound Google API calls.
- Pre-commit verification `./scripts/run_ci_locally.py` must pass with 100% success.

## Review Focus

1. **Unconfigured API Key**: `GEMINI_API_KEY` is null or empty string; endpoint returns HTTP 204 No Content without logging errors or throwing exceptions.
2. **Debounce Fallback**: Task modified <5 minutes ago with a previous image serves the previous cached image, avoiding API calls while typing.
3. **Daily Limit Exhaustion**: When 100 images are generated in a single day, the 101st request serves an existing image if available, else 204 No Content.
4. **Content Deduplication**: Tasks with identical summaries and descriptions resolve to the same SHA-256 hash and hit the same cached file on disk.
5. **30-Day Expiration Pruning**: Images unrequested for >30 days are removed from SQLite and disk, preventing disk overflow.

---

### Task 1: Backend Configuration & Settings

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/src/jira_dashboard/config.py`
- Test: `backend/tests/test_gemini_config.py`

**Interfaces:**
- Consumes: Environment variables and `/data/options.json`
- Produces: `JiraDashboardSettings` fields:
  - `gemini_api_key: str | None`
  - `gemini_model: str` (default: `"gemini-3.1-flash-lite-image"`)
  - `gemini_prompt_template: str` (default: kid-friendly chore prompt)
  - `gemini_daily_limit: int` (default: 100)
  - `gemini_debounce_seconds: int` (default: 300)
  - `gemini_cache_retention_seconds: int` (default: 2592000)
  - Property `background_cache_dir: Path`

- [ ] **Step 1: Write failing tests for Gemini configuration**

```python
def test_gemini_config_defaults():
    settings = JiraDashboardSettings()
    assert settings.gemini_api_key is None
    assert settings.gemini_model == "gemini-3.1-flash-lite-image"
    assert "kid-friendly" in settings.gemini_prompt_template.lower()
    assert settings.gemini_daily_limit == 100
    assert settings.gemini_debounce_seconds == 300
    assert settings.gemini_cache_retention_seconds == 2592000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_gemini_config.py`
Expected: FAIL with AttributeError or missing fields.

- [ ] **Step 3: Update `backend/pyproject.toml` and `backend/src/jira_dashboard/config.py`**

Add `google-genai>=0.1.0` to dependencies and configure settings fields in `JiraDashboardSettings.load()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_gemini_config.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/pyproject.toml backend/src/jira_dashboard/config.py backend/tests/test_gemini_config.py
git commit -m "feat(config): add Gemini background configuration and settings"
```

---

### Task 2: SQLite Storage Schema & Operations for Backgrounds

**Files:**
- Modify: `backend/src/jira_dashboard/adapters/storage.py`
- Test: `backend/tests/test_storage_gemini.py`

**Interfaces:**
- Consumes: SQLite DB connection in `SQLiteStorage`
- Produces:
  - `get_background_image(content_hash: str) -> dict | None`
  - `save_background_image(content_hash: str, file_path: str, byte_size: int, issue_key: str | None = None) -> None`
  - `touch_background_image(content_hash: str) -> None`
  - `get_issue_last_background_hash(issue_key: str) -> str | None`
  - `get_daily_generation_count(date_str: str) -> int`
  - `increment_daily_generation_count(date_str: str) -> int`
  - `prune_expired_background_images(retention_seconds: int) -> list[str]`

- [ ] **Step 1: Write failing tests for background storage operations**

```python
def test_storage_background_image_lifecycle(tmp_path):
    storage = SQLiteStorage(str(tmp_path / "test.db"))
    storage.init_db()
    # verify save, get, touch, link, daily count, and pruning
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_storage_gemini.py`
Expected: FAIL with missing methods on `SQLiteStorage`.

- [ ] **Step 3: Implement tables and storage methods in `SQLiteStorage`**

Create `background_images`, `issue_background_links`, and `gemini_daily_usage` tables in `init_db()`. Implement query and pruning methods.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_storage_gemini.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/storage.py backend/tests/test_storage_gemini.py
git commit -m "feat(storage): add background images schema, tracking, and pruning operations"
```

---

### Task 3: Gemini Client Adapter & Mock Client

**Files:**
- Create: `backend/src/jira_dashboard/adapters/gemini_client.py`
- Modify: `backend/src/jira_dashboard/adapters/__init__.py`
- Test: `backend/tests/test_gemini_client.py`

**Interfaces:**
- Consumes: `JiraDashboardSettings`
- Produces:
  - `GeminiImageClient` (ABC)
  - `GoogleGenAIImageClient` (implements real calls via `from google import genai`)
  - `MockGeminiImageClient` (returns valid mock WebP/JPEG bytes with zero network calls)
  - `create_gemini_client(settings: JiraDashboardSettings) -> GeminiImageClient`

- [ ] **Step 1: Write failing tests for Gemini adapter and mock**

```python
@pytest.mark.asyncio
async def test_mock_gemini_client_generates_image():
    client = MockGeminiImageClient()
    img_bytes = await client.generate_image("Clean room", aspect_ratio="16:9")
    assert img_bytes is not None
    assert len(img_bytes) > 0
    assert client.call_count == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_gemini_client.py`
Expected: FAIL with ImportError.

- [ ] **Step 3: Implement `GeminiImageClient`, `GoogleGenAIImageClient`, and `MockGeminiImageClient`**

In `backend/src/jira_dashboard/adapters/gemini_client.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_gemini_client.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/adapters/gemini_client.py backend/src/jira_dashboard/adapters/__init__.py backend/tests/test_gemini_client.py
git commit -m "feat(gemini): implement Google GenAI client adapter and test mock"
```

---

### Task 4: API Endpoint `GET /api/issues/{key}/background` & Acceptance Tests

**Files:**
- Modify: `backend/src/jira_dashboard/presentation/main.py`
- Test: `backend/tests/test_gemini_acceptance.py`

**Interfaces:**
- Consumes: `SQLiteStorage`, `GeminiImageClient`, `JiraDashboardSettings`
- Produces:
  - Route `GET /api/issues/{key}/background` returning `Response(content=bytes, media_type="image/webp")` or `Response(status_code=204)`
  - Helper `compute_content_hash(model, template, summary, description)`

- [ ] **Step 1: Write acceptance criteria tests**

Verify:
1. Content deduplication: 2 issues with identical text share 1 Gemini call and 1 file.
2. Debounce window: issue updated <300s ago returns previous image or 204 without calling Gemini.
3. Daily cap: 101st request returns 204 or previous image.
4. Pruning: unrequested >30 days removes file and record.
5. Missing API key returns 204.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/test_gemini_acceptance.py`
Expected: FAIL with 404 Route Not Found.

- [ ] **Step 3: Implement endpoint and hashing logic in `main.py`**

Register route and integrate hashing, debounce checking, daily limit checks, cache writing, and disk serving.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest backend/tests/test_gemini_acceptance.py`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/jira_dashboard/presentation/main.py backend/tests/test_gemini_acceptance.py
git commit -m "feat(api): implement GET /api/issues/{key}/background with acceptance tests"
```

---

### Task 5: Frontend Card & Details Background with Readability Overlay

**Files:**
- Modify: `frontend/src/components/IssueCard.tsx`
- Modify: `frontend/src/components/EditIssueModal.tsx`
- Test: `frontend/src/components/IssueCard.test.tsx`
- Test: `frontend/src/components/EditIssueModal.test.tsx`

**Interfaces:**
- Consumes: `/api/issues/${issue.key}/background`
- Produces:
  - Card background image CSS with gradient overlay for dark/light themes
  - Edit issue modal backdrop banner with matching overlay

- [ ] **Step 1: Write failing frontend tests for card background and overlay**

```typescript
it('renders card background with readability overlay when background image is available', async () => {
  // test that issue card includes background-image style with gradient overlay
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm --dir frontend test src/components/IssueCard.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement background styling in `IssueCard.tsx` and `EditIssueModal.tsx`**

Layer the gradient overlay (`linear-gradient(to bottom, rgba(17, 24, 39, 0.78), rgba(17, 24, 39, 0.90))`) over `/api/issues/{key}/background`. Handle 204 fallback gracefully.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm --dir frontend test src/components/IssueCard.test.tsx src/components/EditIssueModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/IssueCard.tsx frontend/src/components/EditIssueModal.tsx frontend/src/components/IssueCard.test.tsx frontend/src/components/EditIssueModal.test.tsx
git commit -m "feat(ui): add task card and modal background images with readability overlay"
```

---

### Task 6: Visual Regression & Offline Resilience Tests

**Files:**
- Modify: `frontend/tests/visual/screenshots.spec.ts`
- Modify: `frontend/src/store/offlineReactivity.test.ts`

**Interfaces:**
- Consumes: Playwright screenshot suite and Vitest offline reactivity suite
- Produces:
  - Visual snapshot coverage of card with background illustration
  - Verification that offline outbox mutations apply in $<50\text{ms}$ unaffected by background image loading

- [ ] **Step 1: Write test scenarios for visual snapshots and offline reactivity**

Add card background scenario to `screenshots.spec.ts` and test offline mutation speed in `offlineReactivity.test.ts`.

- [ ] **Step 2: Run offline tests to verify they pass**

Run: `npx pnpm --dir frontend test src/store/offlineReactivity.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/tests/visual/screenshots.spec.ts frontend/src/store/offlineReactivity.test.ts
git commit -m "test(visual): add card background visual test scenario and verify offline reactivity"
```

---

### Task 7: Documentation, Local CI Verification & Finalization

**Files:**
- Modify: `docs/roadmap_and_phases.md`
- Modify: `README.md`

- [ ] **Step 1: Update documentation**

Document the Gemini AI task background feature in `docs/roadmap_and_phases.md` and `README.md`.

- [ ] **Step 2: Execute mandatory local CI runner**

Run: `./scripts/run_ci_locally.py`
Expected: 100% SUCCESS across all steps (Ruff, pytest, vitest, tsc build).

- [ ] **Step 3: Commit documentation and CI verification**

```bash
git add docs/roadmap_and_phases.md README.md
git commit -m "docs: update roadmap and phases for Gemini AI task backgrounds"
```
