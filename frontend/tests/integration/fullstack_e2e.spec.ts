import { test, expect } from '@playwright/test';

/**
 * End-to-End Integration Suite.
 *
 * Tests the complete application stack (React Frontend <-> WebSocket Hub <-> FastAPI REST API <-> Fake Jira Engine).
 * Validates data loading, optimistic UI transitions, live webhook updates, and graceful rollback on simulated failure.
 */

test.describe('Full-Stack Dashboard Integration (Frontend <-> FastAPI <-> Fake Jira)', () => {
  test.beforeEach(async ({ page }) => {
    // Reset test state and errors before each test to guarantee determinism
    await page.request.post('/api/test/reset');
    await page.goto('/');
  });

  test('1. Full-Stack Data Loading: renders board, sprint, and issues from backend', async ({ page }) => {
    // 1. Validate Board Header
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
    await expect(page.getByText('Active Sprint 42')).toBeVisible();

    // 2. Validate Live WebSocket Connection badge
    await expect(page.getByText('Live WebSocket')).toBeVisible();

    // 3. Validate Columns and Seed Issues
    await expect(page.getByText('PROJ-101')).toBeVisible();
    await expect(page.getByText('Configure Home Assistant Ingress dynamic proxy support')).toBeVisible();
    await expect(page.getByText('PROJ-98')).toBeVisible();
    await expect(page.getByText('PROJ-72')).toBeVisible();
  });

  test('2. User Interaction: one-tap "Done" triggers optimistic mutation and syncs with backend', async ({ page }) => {
    // Locate card PROJ-101 in To Do column
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' });
    await expect(proj101Article).toBeVisible();

    // Intercept transition request to verify backend communication
    const transitionPromise = page.waitForResponse(
      (res) => res.url().includes('/api/issues/PROJ-101/transition') && res.status() === 200
    );

    // Click the "Done" quick action button
    const doneButton = proj101Article.getByTitle('Quick Action: Mark as Done');
    await doneButton.click();

    // Await API confirmation
    const transitionResponse = await transitionPromise;
    expect(transitionResponse.ok()).toBeTruthy();

    // Card should now be marked as done (line-through summary text)
    await expect(proj101Article.locator('p')).toHaveClass(/line-through/);
  });

  test('3. Real-Time Webhook Push: incoming Jira webhook updates UI automatically via WebSocket', async ({ page }) => {
    // Verify PROJ-85 is initially on board (not line-through)
    const proj85Article = page.locator('article', { hasText: 'PROJ-85' });
    await expect(proj85Article).toBeVisible();
    await expect(proj85Article.locator('p')).not.toHaveClass(/line-through/);

    // Simulate an external Jira Cloud webhook arriving at the FastAPI backend
    const webhookPayload = {
      webhookEvent: 'jira:issue_updated',
      issue: {
        id: '85',
        key: 'PROJ-85',
        fields: {
          summary: 'Jira webhook ingestion & signature validation engine (Done via Jira Webhook)',
          status: {
            name: 'Done',
            statusCategory: { id: 3, key: 'done', name: 'Done' },
          },
        },
      },
    };

    const webhookRes = await page.request.post('/api/webhooks/jira', {
      data: webhookPayload,
    });
    expect(webhookRes.ok()).toBeTruthy();

    // Verify UI updates live over WebSocket without page refresh!
    await expect(proj85Article.locator('p')).toHaveText(
      'Jira webhook ingestion & signature validation engine (Done via Jira Webhook)',
      { timeout: 5000 }
    );
    await expect(proj85Article.locator('p')).toHaveClass(/line-through/);
  });

  test('4. Optimistic Rollback: simulated Jira API rejection gracefully reverts UI and shows error banner', async ({
    page,
  }) => {
    // 1. Enable simulated Jira failure on backend
    await page.request.post('/api/test/simulate-error', {
      data: {
        enable: true,
        status_code: 503,
        message: 'Jira Cloud service unavailable',
      },
    });

    const proj98Article = page.locator('article', { hasText: 'PROJ-98' });
    await expect(proj98Article).toBeVisible();

    // Attempt to transition PROJ-98 to "Done"
    const doneButton = proj98Article.getByTitle('Quick Action: Mark as Done');
    await doneButton.click();

    // UI should display error rollback banner
    const alertBanner = page.getByText('Failed to transition PROJ-98. Reverting to previous status.');
    await expect(alertBanner).toBeVisible({ timeout: 5000 });

    // PROJ-98 should NOT be struck through (reverted back to In Progress)
    await expect(proj98Article.locator('p')).not.toHaveClass(/line-through/);

    // Reset error simulation
    await page.request.post('/api/test/simulate-error', {
      data: { enable: false },
    });
  });

  test('5. Dynamic Workflow Columns: renders workflow columns from backend and distributes cards', async ({
    page,
  }) => {
    // 1. Verify all 4 column headings are rendered with proper uppercase titles
    await expect(page.locator('h2', { hasText: 'To Do' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'In Progress' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'In Review' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Done' })).toBeVisible();

    // 2. Verify that cards appear within their respective column containers
    const todoColumn = page.getByTestId('column-col-todo');
    await expect(todoColumn.locator('article', { hasText: 'PROJ-101' })).toBeVisible();

    const inProgressColumn = page.getByTestId('column-col-inprogress');
    await expect(inProgressColumn.locator('article', { hasText: 'PROJ-98' })).toBeVisible();

    const inReviewColumn = page.getByTestId('column-col-inreview');
    await expect(inReviewColumn.locator('article', { hasText: 'PROJ-85' })).toBeVisible();

    const doneColumn = page.getByTestId('column-col-done');
    await expect(doneColumn.locator('article', { hasText: 'PROJ-72' })).toBeVisible();
  });

  test('6. Status Dropdown Transition: moving issue via select dropdown updates status and syncs', async ({
    page,
  }) => {
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' });
    await expect(proj101Article).toBeVisible();

    const statusSelect = proj101Article.getByLabel('Change status for PROJ-101');
    await expect(statusSelect).toHaveValue('To Do');

    // Intercept transition request
    const transitionPromise = page.waitForResponse(
      (res) => res.url().includes('/api/issues/PROJ-101/transition') && res.status() === 200
    );

    // Select "In Progress" column option
    await statusSelect.selectOption('In Progress');

    // Verify backend received transition call
    const res = await transitionPromise;
    expect(res.ok()).toBeTruthy();

    // Verify select value is now updated
    await expect(statusSelect).toHaveValue('In Progress');
  });

  test('7. Filter and Search: instant search query filters displayed cards', async ({
    page,
  }) => {
    const searchInput = page.getByPlaceholder('Filter issues...');
    await expect(searchInput).toBeVisible();

    // Filter by specific keyword
    await searchInput.fill('dynamic proxy');

    // PROJ-101 matches summary
    await expect(page.locator('article', { hasText: 'PROJ-101' })).toBeVisible();
    // PROJ-98 does not match
    await expect(page.locator('article', { hasText: 'PROJ-98' })).not.toBeVisible();

    // Clear search
    await searchInput.clear();
    await expect(page.locator('article', { hasText: 'PROJ-98' })).toBeVisible();
  });
});
