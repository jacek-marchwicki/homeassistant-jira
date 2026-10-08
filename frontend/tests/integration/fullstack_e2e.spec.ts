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

    // 3. Validate Columns and Seed Issues (by default "Assigned to Me" and "Active" are selected)
    await expect(page.getByText('PROJ-101')).toBeVisible();
    await expect(page.getByText('Configure Home Assistant Ingress dynamic proxy support')).toBeVisible();
    await expect(page.getByText('PROJ-85')).toBeVisible();
    await expect(page.getByText('PROJ-72')).toBeVisible();
    // PROJ-98 is assigned to Alex Lead, so it is filtered out under default "Assigned to Me"
    await expect(page.locator('article', { hasText: 'PROJ-98' })).not.toBeVisible();

    // Click "All Issues" to view all cards including other assignees
    await page.getByRole('button', { name: /All Issues/ }).click();
    await expect(page.getByText('PROJ-98')).toBeVisible();
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

    // Make sure all issues are visible to access PROJ-98 (assigned to Alex)
    await page.getByRole('button', { name: /All Issues/ }).click();

    const proj98Article = page.locator('article', { hasText: 'PROJ-98' });
    await expect(proj98Article).toBeVisible();

    // Intercept transition request to simulate Jira rejection
    await page.route('**/api/issues/PROJ-98/transition', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Jira Cloud service unavailable' }),
      });
    });

    // Attempt to transition PROJ-98 to "Done"
    const doneButton = proj98Article.getByTitle('Quick Action: Mark as Done');
    await doneButton.click();

    // UI should display error rollback banner
    const alertBanner = page.getByText('Failed to transition PROJ-98. Reverting to previous status.');
    await expect(alertBanner).toBeVisible({ timeout: 5000 });

    // PROJ-98 should NOT be struck through (reverted back to In Progress)
    await expect(proj98Article.locator('p')).not.toHaveClass(/line-through/);

    await page.unroute('**/api/issues/PROJ-98/transition');

    // Reset error simulation
    await page.request.post('/api/test/simulate-error', {
      data: { enable: false },
    });
  });

  test('5. Dynamic Workflow Columns: merges unfinished workflow cards into To Do and displays Done column', async ({
    page,
  }) => {
    // Show all issues to inspect cards across all dynamic columns
    await page.getByRole('button', { name: /All Issues/ }).click();

    // 1. Verify visible columns: To Do and Done are rendered; intermediate columns (In Progress, In Review) are merged into To Do and hidden by default
    await expect(page.locator('h2', { hasText: 'To Do' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Done' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'In Progress' })).not.toBeVisible();
    await expect(page.locator('h2', { hasText: 'In Review' })).not.toBeVisible();

    // 2. Verify that unfinished cards appear within the To Do column container
    const todoColumn = page.getByTestId('column-col-todo');
    await expect(todoColumn.locator('article', { hasText: 'PROJ-101' })).toBeVisible();
    await expect(todoColumn.locator('article', { hasText: 'PROJ-98' })).toBeVisible();
    await expect(todoColumn.locator('article', { hasText: 'PROJ-85' })).toBeVisible();

    // Verify In Progress sub-section inside To Do column renders in-progress issues (PROJ-85)
    const inProgressSection = page.getByTestId('ready-section-inprogress');
    await expect(inProgressSection.locator('article', { hasText: 'PROJ-85' })).toBeVisible();

    // Verify Expedited sub-section inside To Do column renders expedited issues (highest priority PROJ-98)
    const expeditedSection = page.getByTestId('ready-section-expedited');
    await expect(expeditedSection.locator('article', { hasText: 'PROJ-98' })).toBeVisible();

    // Verify completed cards appear in Done column
    const doneColumn = page.getByTestId('column-col-done');
    await expect(doneColumn.locator('article', { hasText: 'PROJ-72' })).toBeVisible();
  });

  test('6. Status Dropdown Transition: moving issue via select dropdown updates status and syncs', async ({
    page,
  }) => {
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' });
    await expect(proj101Article).toBeVisible();

    const statusSelect = proj101Article.locator('select[id^="status-select"]');
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
    // Show all issues before testing text search query
    await page.getByRole('button', { name: /All Issues/ }).click();

    const searchInput = page.getByPlaceholder('Search key, summary, description...');
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

  test('8. Quick Filters: "Assigned to Me", "Active", and "Hide Epics" toggle correctly and filter issues', async ({
    page,
  }) => {
    // By default: "Assigned to Me", "Active", and "Hide Epics" are selected
    const myBtn = page.getByRole('button', { name: 'Assigned to Me' });
    const activeBtn = page.getByRole('button', { name: 'Active' });
    const hideEpicsBtn = page.getByRole('button', { name: 'Hide Epics' });
    const allBtn = page.getByRole('button', { name: /All Issues/ });

    await expect(myBtn).toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(activeBtn).toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(hideEpicsBtn).toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(allBtn).not.toHaveClass(/bg-\[var\(--jira-primary\)\]/);

    // PROJ-101 (Jacek) and PROJ-85 (unassigned) are visible; PROJ-98 (Alex) is hidden
    await expect(page.locator('article', { hasText: 'PROJ-101' })).toBeVisible();
    await expect(page.locator('article', { hasText: 'PROJ-85' })).toBeVisible();
    await expect(page.locator('article', { hasText: 'PROJ-98' })).not.toBeVisible();

    // Toggle "Assigned to Me" off -> PROJ-98 should become visible
    await myBtn.click();
    await expect(myBtn).not.toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(page.locator('article', { hasText: 'PROJ-98' })).toBeVisible();

    // Toggle "Assigned to Me" back on -> PROJ-98 should be hidden again
    await myBtn.click();
    await expect(myBtn).toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(page.locator('article', { hasText: 'PROJ-98' })).not.toBeVisible();

    // Click "All Issues" -> all filters cleared, all issues visible
    await allBtn.click();
    await expect(allBtn).toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(myBtn).not.toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(activeBtn).not.toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(hideEpicsBtn).not.toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(page.locator('article', { hasText: 'PROJ-98' })).toBeVisible();
  });

  test('9. PWA Installability: serves valid manifest, icons, service worker, and mobile install prompt', async ({
    page,
    request,
  }) => {
    // 1. Verify Web App Manifest link in DOM
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', 'manifest.webmanifest');

    // 2. Fetch and validate Manifest JSON
    const manifestRes = await request.get('/manifest.webmanifest');
    expect(manifestRes.ok()).toBeTruthy();
    const manifest = await manifestRes.json();
    expect(manifest.name).toBe('Jira Dashboard');
    expect(manifest.short_name).toBe('Jira');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.theme_color).toBe('#0f172a');
    expect(manifest.background_color).toBe('#0f172a');

    // 3. Verify Android-required icons (192x192 and 512x512 including maskable)
    const icon192 = manifest.icons.find(
      (i: { sizes: string; purpose: string }) => i.sizes === '192x192' && i.purpose === 'any'
    );
    const icon512 = manifest.icons.find(
      (i: { sizes: string; purpose: string }) => i.sizes === '512x512' && i.purpose === 'any'
    );
    const iconMaskable192 = manifest.icons.find(
      (i: { sizes: string; purpose: string }) => i.sizes === '192x192' && i.purpose === 'maskable'
    );
    const iconMaskable512 = manifest.icons.find(
      (i: { sizes: string; purpose: string }) => i.sizes === '512x512' && i.purpose === 'maskable'
    );

    expect(icon192).toBeDefined();
    expect(icon512).toBeDefined();
    expect(iconMaskable192).toBeDefined();
    expect(iconMaskable512).toBeDefined();

    // 4. Verify icon assets exist on server
    const res192 = await request.get(`/${icon192.src}`);
    expect(res192.ok()).toBeTruthy();
    expect(res192.headers()['content-type']).toContain('image/png');

    const res512 = await request.get(`/${icon512.src}`);
    expect(res512.ok()).toBeTruthy();
    expect(res512.headers()['content-type']).toContain('image/png');

    // 5. Verify Service Worker asset is served
    const swRes = await request.get('/sw.js');
    expect(swRes.ok()).toBeTruthy();
    const swContent = await swRes.text();
    expect(swContent).toContain('jira-dashboard-v1');
    expect(swContent).toContain('skipWaiting');

    // 6. Verify Install Button in Header triggers Guidance Modal
    const installBtn = page.getByRole('button', { name: 'Install App' });
    await expect(installBtn).toBeVisible();
    await installBtn.click();

    // Modal appears
    await expect(page.getByRole('dialog', { name: 'Install Jira Dashboard' })).toBeVisible();
    await expect(page.getByText('Desktop Browser')).toBeVisible();

    // Close modal
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByRole('dialog', { name: 'Install Jira Dashboard' })).not.toBeVisible();
  });

  test('10. Issue Editing: opens modal, edits issue details, and saves to backend', async ({
    page,
  }) => {
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' });
    await expect(proj101Article).toBeVisible();

    // Click the Edit button on PROJ-101
    const editBtn = proj101Article.getByRole('button', { name: 'Edit PROJ-101' });
    await editBtn.click();

    // Modal dialog appears
    const dialog = page.getByRole('dialog', { name: /Edit Issue PROJ-101/ });
    await expect(dialog).toBeVisible();

    const summaryInput = dialog.locator('#edit-summary');
    await expect(summaryInput).toHaveValue(
      'Configure Home Assistant Ingress dynamic proxy support'
    );

    // Intercept PATCH request
    const patchPromise = page.waitForResponse(
      (res) => res.url().includes('/api/issues/PROJ-101') && res.status() === 200
    );

    // Edit summary
    await summaryInput.fill('Configure Home Assistant Ingress dynamic proxy support (Edited)');

    // Save changes
    await dialog.getByRole('button', { name: 'Save Changes' }).click();

    // Verify modal closes
    await expect(dialog).not.toBeVisible();

    // Verify backend received update
    const patchRes = await patchPromise;
    expect(patchRes.ok()).toBeTruthy();

    // Verify card summary updated on board
    await expect(
      proj101Article.getByText(
        'Configure Home Assistant Ingress dynamic proxy support (Edited)'
      )
    ).toBeVisible();
  });

  test('11. Issue Creation: opens create modal from header, creates issue, and displays on board', async ({
    page,
  }) => {
    // Click the Create button in the Header
    const createBtn = page.getByRole('button', { name: 'Create Issue' });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Verify modal dialog appears
    const dialog = page.getByRole('dialog', { name: 'Create Issue' });
    await expect(dialog).toBeVisible();

    const summaryInput = dialog.locator('#create-summary');
    await expect(summaryInput).toBeVisible();

    // Intercept POST request
    const postPromise = page.waitForResponse(
      (res) => res.url().includes('/api/issues') && res.request().method() === 'POST' && res.status() === 201
    );

    // Fill in summary
    await summaryInput.fill('Automated E2E Created Issue');

    // Submit form
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    // Verify modal closes
    await expect(dialog).not.toBeVisible();

    // Verify backend received POST and returned 201
    const postRes = await postPromise;
    expect(postRes.ok()).toBeTruthy();

    // Verify newly created issue appears on board
    await expect(page.locator('article', { hasText: 'Automated E2E Created Issue' })).toBeVisible();
  });

  test('12. Done Column Filter: displays recently updated Done issues and hides Done issues older than 2 days', async ({
    page,
  }) => {
    // Wait for the board to be fully loaded and WebSocket connected
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
    await expect(page.getByText('Live WebSocket')).toBeVisible();
    await expect(page.locator('article', { hasText: 'PROJ-101' })).toBeVisible();

    // 1. Post webhook with a Done issue completed 5 days ago
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const oldDoneRes = await page.request.post('/api/webhooks/jira', {
      data: {
        webhookEvent: 'jira:issue_created',
        issue: {
          id: '990',
          key: 'PROJ-990',
          fields: {
            summary: 'Done Issue Completed 5 Days Ago',
            status: {
              id: '4',
              name: 'Done',
              statusCategory: { id: 3, key: 'done', name: 'Done' },
            },
            updated: fiveDaysAgo,
          },
        },
      },
    });
    expect(oldDoneRes.ok()).toBeTruthy();

    // 2. Post webhook with a Done issue completed 1 hour ago
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentDoneRes = await page.request.post('/api/webhooks/jira', {
      data: {
        webhookEvent: 'jira:issue_created',
        issue: {
          id: '991',
          key: 'PROJ-991',
          fields: {
            summary: 'Done Issue Completed 1 Hour Ago',
            status: {
              id: '4',
              name: 'Done',
              statusCategory: { id: 3, key: 'done', name: 'Done' },
            },
            updated: oneHourAgo,
          },
        },
      },
    });
    expect(recentDoneRes.ok()).toBeTruthy();

    // 3. Clear quick filters to show all issues
    const allBtn = page.getByRole('button', { name: /All Issues/ });
    await allBtn.click();

    // 4. Verify recently completed issue is displayed in the Done column
    await expect(page.locator('article', { hasText: 'PROJ-991' })).toBeVisible();

    // 5. Verify issue completed 5 days ago is NOT displayed in the Done column
    await expect(page.locator('article', { hasText: 'PROJ-990' })).not.toBeVisible();
  });

  test('13. Drag-and-Drop: dragging issue to In Progress drop target at top of Ready transitions it to In Progress', async ({
    page,
  }) => {
    // Wait for the board to be fully loaded and WebSocket connected
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
    await expect(page.getByText('Live WebSocket')).toBeVisible();

    // Locate card PROJ-101 in Ready/To Do column
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' });
    await expect(proj101Article).toBeVisible();

    const box = await proj101Article.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Move 25px down to activate pointer sensor
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 25, { steps: 5 });
    }

    // In Progress column must never be rendered on the board
    await expect(page.getByTestId('column-col-inprogress')).not.toBeAttached();

    // Drop target must appear at top of Ready list
    const dropTarget = page.getByTestId('ready-drop-target-inprogress');
    await expect(dropTarget).toBeVisible();

    // Hover over drop target
    const targetBox = await dropTarget.boundingBox();
    expect(targetBox).not.toBeNull();
    if (targetBox) {
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
    }

    await page.waitForTimeout(100);

    // Re-target exact center after any DOM layout shift settles
    const settledBox = await dropTarget.boundingBox();
    if (settledBox) {
      await page.mouse.move(settledBox.x + settledBox.width / 2, settledBox.y + settledBox.height / 2, { steps: 2 });
    }

    const transitionPromise = page.waitForResponse(
      (res) => res.url().includes('/api/issues/PROJ-101/transition') && res.status() === 200
    );

    await page.mouse.up();

    const transitionResponse = await transitionPromise;
    expect(transitionResponse.ok()).toBeTruthy();
    const responseJson = await transitionResponse.json();
    expect(responseJson.status.name).toBe('In Progress');
  });
});



