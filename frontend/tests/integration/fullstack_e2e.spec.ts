import { test, expect } from '@playwright/test';

/**
 * End-to-End Integration Suite.
 *
 * Tests the complete application stack (React Frontend <-> WebSocket Hub <-> FastAPI REST API <-> Fake Jira Engine).
 * Validates data loading, optimistic UI transitions, live webhook updates, and graceful rollback on simulated failure.
 */

test.describe('Full-Stack Dashboard Integration (Frontend <-> FastAPI <-> Fake Jira)', () => {
  test.beforeEach(async ({ page }) => {
    // Reset any simulated errors before each test
    await page.request.post('/api/test/simulate-error', {
      data: { enable: false },
    });
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
    // Verify PROJ-104 is initially in To Do column (not line-through)
    const proj104Article = page.locator('article', { hasText: 'PROJ-104' });
    await expect(proj104Article).toBeVisible();
    await expect(proj104Article.locator('p')).not.toHaveClass(/line-through/);

    // Simulate an external Jira Cloud webhook arriving at the FastAPI backend
    const webhookPayload = {
      webhookEvent: 'jira:issue_updated',
      issue: {
        id: '104',
        key: 'PROJ-104',
        fields: {
          summary: 'Setup WebSocket broadcast client for live browser pushes (Done via Jira Webhook)',
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
    await expect(proj104Article.locator('p')).toHaveText(
      'Setup WebSocket broadcast client for live browser pushes (Done via Jira Webhook)',
      { timeout: 5000 }
    );
    await expect(proj104Article.locator('p')).toHaveClass(/line-through/);
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
});
