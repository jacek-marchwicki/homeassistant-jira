import { test, expect } from '@playwright/test';

/**
 * End-to-End Integration Suite.
 *
 * Tests the complete application stack (React Frontend <-> WebSocket Hub <-> FastAPI REST API <-> Fake Jira Engine).
 * Validates data loading, optimistic UI transitions, live webhook updates, and graceful rollback on simulated failure.
 */

test.describe('Full-Stack Dashboard Integration (Frontend <-> FastAPI <-> Fake Jira)', () => {
  test.beforeEach(async ({ page }) => {
    // Reset test state and wipe database cleanly before each test to guarantee test isolation
    await page.request.post('/api/test/reset');
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
  });

  test.afterEach(async ({ page }) => {
    // Clean SQLite database and in-memory Fake Jira state after each test
    try {
      await page.request.post('/api/test/reset');
    } catch {
      // Ignore if server or page context is already terminated
    }
  });

  test('1. Full-Stack Data Loading: renders board, sprint, and issues from backend', async ({ page }) => {
    // 1. Validate Board Header
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
    await expect(page.getByText('Active Sprint 42')).toBeVisible();

    // 2. Validate Live WebSocket Connection badge
    await expect(page.getByText('Live WebSocket')).toBeVisible();

    // 3. Validate Columns and Seed Issues (by default "Assigned to Me" and "Active" are selected)
    await expect(page.locator('article', { hasText: 'PROJ-101' }).first()).toBeVisible();
    await expect(page.getByText('Configure Home Assistant Ingress dynamic proxy support').first()).toBeVisible();
    await expect(page.locator('article', { hasText: 'PROJ-85' }).first()).toBeVisible();
    await expect(page.locator('article', { hasText: 'PROJ-72' }).first()).toBeVisible();
    // PROJ-98 is visible in Alex Lead's column on the People board
    await expect(page.locator('article', { hasText: 'PROJ-98' }).first()).toBeVisible();
  });

  test('2. User Interaction: one-tap "Done" triggers optimistic mutation and syncs with backend', async ({ page }) => {
    // Locate card PROJ-101 in To Do column
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' }).first();
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
    const proj85Article = page.locator('article', { hasText: 'PROJ-85' }).first();
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
    // 1. Enable simulated Jira failure on backend (target: 'reject' rejects the transition on the Python backend)
    await page.request.post('/api/test/simulate-error', {
      data: {
        enable: true,
        status_code: 503,
        message: 'Jira Cloud service unavailable',
        target: 'reject',
      },
    });

    // Make sure all issues are visible to access PROJ-98 (assigned to Alex)
    await page.getByRole('button', { name: /All Issues/ }).click();

    const proj98Article = page.locator('article', { hasText: 'PROJ-98' });
    await expect(proj98Article).toBeVisible();

    // Attempt to transition PROJ-98 to "Done" (backend will reject with 503)
    const doneButton = proj98Article.getByTitle('Quick Action: Mark as Done');
    await doneButton.click();

    // UI should display error rollback banner once delayed undo timer (5000ms) dispatches
    const alertBanner = page.getByText('Failed to transition PROJ-98. Reverting to previous status.');
    await expect(alertBanner).toBeVisible({ timeout: 10000 });

    // PROJ-98 should NOT be struck through (reverted back to In Progress)
    await expect(proj98Article.locator('p')).not.toHaveClass(/line-through/);

    // Reset error simulation
    await page.request.post('/api/test/simulate-error', {
      data: { enable: false },
    });
  });

  test('5. People Board Sub-Sections: renders In Progress, Expedited, and Done sections for assignees', async ({
    page,
  }) => {
    // Show all issues to inspect cards across all people columns
    await page.getByRole('button', { name: /All Issues/ }).click();

    // 1. Verify visible people columns are rendered
    await expect(page.locator('h2', { hasText: 'Jacek Marchwicki' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Alex Lead' })).toBeVisible();

    // 2. Verify In Progress section renders in-progress issues (PROJ-85)
    const inProgressSection = page.getByTestId('people-section-inprogress');
    await expect(inProgressSection.first().locator('article', { hasText: 'PROJ-85' })).toBeVisible();

    // 3. Verify Expedited section renders expedited issues (highest priority PROJ-98 in Alex Lead column)
    const expeditedSection = page.getByTestId('people-section-expedited');
    await expect(expeditedSection.locator('article', { hasText: 'PROJ-98' })).toBeVisible();

    // 4. Verify completed cards appear in Done section
    const doneSection = page.getByTestId('people-section-done');
    await expect(doneSection.first().locator('article', { hasText: 'PROJ-72' })).toBeVisible();
  });

  test('6. Status Dropdown Transition: Board & People columns have no status select, Backlog retains status dropdown', async ({
    page,
  }) => {
    // 0. Ensure all issues are visible (clear filters)
    await page.getByRole('button', { name: /All Issues/ }).click();

    // 1. Verify People column cards do NOT contain a status dropdown
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' }).first();
    await expect(proj101Article).toBeVisible();
    await expect(proj101Article.locator('select[id^="status-select"]')).toHaveCount(0);
    await expect(proj101Article.locator('[role="combobox"][aria-label^="Change status"]')).toHaveCount(0);

    // 2. Switch to Backlog View and verify status select dropdown is present and functional
    await page.locator('header [aria-label="Backlog View"]').click();
    const proj104Row = page.locator('[data-testid="backlog-row-PROJ-104"]');
    await expect(proj104Row).toBeVisible();

    const backlogStatusSelect = proj104Row.locator('select[id^="backlog-status-select-PROJ-104"]');
    await expect(backlogStatusSelect).toHaveValue('Backlog');

    // Intercept transition request
    const transitionPromise = page.waitForResponse(
      (res) => res.url().includes('/api/issues/PROJ-104/transition') && res.status() === 200
    );

    // Select "In Progress" column option
    await backlogStatusSelect.selectOption('In Progress');

    // Verify backend received transition call
    const res = await transitionPromise;
    expect(res.ok()).toBeTruthy();

    // Verify select value is now updated
    await expect(backlogStatusSelect).toHaveValue('In Progress');

    // 3. Return to People view and verify bottom Backlog panel also retains status dropdown
    await page.locator('header [aria-label="People View"]').click();
    const expandBacklogBtn = page.locator('button[aria-label="Expand Backlog list"]');
    await expect(expandBacklogBtn).toBeVisible();
    await expandBacklogBtn.click();

    const panelRow = page.locator('[data-testid="backlog-panel"]').locator('[data-testid^="backlog-row-"]').first();
    await expect(panelRow.locator('select[id^="backlog-status-select-"]')).toBeAttached();
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
    // Switch to Backlog View to test issue filtering by quick filters
    await page.locator('header [aria-label="Backlog View"]').click();

    // By default: "Assigned to Me" (current user avatar), "Active", and "Hide Epics" are selected
    const myBtn = page.getByRole('button', { name: /Filter by Jacek|Assigned to Me/i });
    const activeBtn = page.getByRole('button', { name: 'Active' });
    const hideEpicsBtn = page.getByRole('button', { name: 'Hide Epics' });
    const allBtn = page.getByRole('button', { name: /All Issues/ });

    await expect(myBtn).toHaveClass(/ring-\[var\(--jira-primary\)\]|bg-\[var\(--jira-primary\)\]/);
    await expect(activeBtn).toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(hideEpicsBtn).toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(allBtn).not.toHaveClass(/bg-\[var\(--jira-primary\)\]/);

    // PROJ-101 (Jacek) and PROJ-85 (unassigned) are visible; PROJ-98 (Alex) is hidden
    await expect(page.locator('div', { hasText: 'PROJ-101' }).first()).toBeVisible();
    await expect(page.locator('div', { hasText: 'PROJ-85' }).first()).toBeVisible();
    await expect(page.locator('div', { hasText: 'PROJ-98' })).not.toBeVisible();

    // Toggle "Assigned to Me" off -> PROJ-98 should become visible
    await myBtn.click();
    await expect(myBtn).not.toHaveClass(/ring-\[var\(--jira-primary\)\]|bg-\[var\(--jira-primary\)\]/);
    await expect(page.locator('div', { hasText: 'PROJ-98' }).first()).toBeVisible();

    // Toggle "Assigned to Me" back on -> PROJ-98 should be hidden again
    await myBtn.click();
    await expect(myBtn).toHaveClass(/ring-\[var\(--jira-primary\)\]|bg-\[var\(--jira-primary\)\]/);
    await expect(page.locator('div', { hasText: 'PROJ-98' })).not.toBeVisible();

    // Click "All Issues" -> all filters cleared, all issues visible
    await allBtn.click();
    await expect(allBtn).toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(myBtn).not.toHaveClass(/ring-\[var\(--jira-primary\)\]|bg-\[var\(--jira-primary\)\]/);
    await expect(activeBtn).not.toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(hideEpicsBtn).not.toHaveClass(/bg-\[var\(--jira-primary\)\]/);
    await expect(page.locator('div', { hasText: 'PROJ-98' }).first()).toBeVisible();
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
    expect(swContent).toMatch(/jira-dashboard-v\d+/);
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

    // Verify Edit button and direct Jira link are not present on board card
    await expect(proj101Article.getByRole('button', { name: 'Edit PROJ-101' })).toHaveCount(0);
    await expect(proj101Article.locator('a[aria-label="Open PROJ-101 in Jira"]')).toHaveCount(0);

    // Click the card to open details screen
    await proj101Article.click();

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
    await dialog.getByRole('button', { name: 'Save' }).click();

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
    await expect(page.locator('article', { hasText: 'Automated E2E Created Issue' }).first()).toBeVisible();
  });

  test('12. Done Column Filter: displays recently updated Done issues and hides Done issues older than 2 days', async ({
    page,
  }) => {
    // Wait for the board to be fully loaded and WebSocket connected
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
    await expect(page.getByText('Live WebSocket')).toBeVisible();
    await expect(page.locator('article', { hasText: 'PROJ-101' }).first()).toBeVisible();

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
    await expect(page.locator('article', { hasText: 'PROJ-991' }).first()).toBeVisible();

    // 5. Verify issue completed 5 days ago is NOT displayed in the Done column
    await expect(page.locator('article', { hasText: 'PROJ-990' })).not.toBeVisible();
  });

  test('13. Drag-and-Drop: dragging issue to another person column reassigns it', async ({
    page,
  }) => {
    // Wait for the board to be fully loaded and WebSocket connected
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
    await expect(page.getByText('Live WebSocket')).toBeVisible();

    // Show all issues so all people columns are visible
    await page.getByRole('button', { name: /All Issues/ }).click();

    // Locate card PROJ-101
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' }).first();
    await expect(proj101Article).toBeVisible();

    const box = await proj101Article.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Move 25px down to activate pointer sensor
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 25, { steps: 5 });
    }

    // Locate Alex Lead column
    const alexColumn = page.getByTestId('people-column-usr-2');
    await expect(alexColumn).toBeVisible();

    const targetBox = await alexColumn.boundingBox();
    expect(targetBox).not.toBeNull();
    if (targetBox) {
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 5 });
    }

    await page.waitForTimeout(100);

    const updatePromise = page.waitForResponse(
      (res) => res.url().includes('/api/issues/PROJ-101') && res.request().method() === 'PUT' && res.status() === 200
    );

    await page.mouse.up();

    const updateResponse = await updatePromise;
    expect(updateResponse.ok()).toBeTruthy();
    const responseJson = await updateResponse.json();
    expect(responseJson.assignee.display_name).toBe('Alex Lead');
  });

  test('14. DatePicker in Edit Modal: selects date via popover, enters date manually, clears date via clear button, and syncs to backend', async ({
    page,
  }) => {
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' });
    await expect(proj101Article).toBeVisible();

    // Click card to open details
    await proj101Article.click();

    const dialog = page.getByRole('dialog', { name: /Edit Issue PROJ-101/ });
    await expect(dialog).toBeVisible();

    const startDateInput = dialog.locator('#edit-start-date');
    const dueDateInput = dialog.locator('#edit-due-date');
    await expect(startDateInput).toBeVisible();
    await expect(dueDateInput).toBeVisible();

    // 1. Enter Due Date manually
    await dueDateInput.fill('2026-11-20');
    await expect(dueDateInput).toHaveValue('2026-11-20');

    // 2. Open Calendar popover on Start Date via calendar button
    const startWrapper = startDateInput.locator('xpath=ancestor::div[contains(@class, "relative")][1]');
    const openCalendarBtn = startWrapper.getByRole('button', { name: 'Open calendar' });
    await openCalendarBtn.click();

    // Popover is visible
    const popover = page.getByTestId('date-picker-popover');
    await expect(popover).toBeVisible();

    // Click "Today" in popover
    const todayBtn = popover.getByTestId('date-picker-today');
    await todayBtn.click();

    // Popover closes and start date has a value
    await expect(popover).not.toBeVisible();
    const todayVal = await startDateInput.inputValue();
    expect(todayVal).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 3. Clear Due Date via the input clear button ('X')
    const dueWrapper = dueDateInput.locator('xpath=ancestor::div[contains(@class, "relative")][1]');
    const clearDueBtn = dueWrapper.getByRole('button', { name: 'Clear date' });
    await expect(clearDueBtn).toBeVisible();
    await clearDueBtn.click();
    await expect(dueDateInput).toHaveValue('');

    // 4. Save and verify backend PATCH call
    const patchPromise = page.waitForResponse(
      (res) => res.url().includes('/api/issues/PROJ-101') && res.status() === 200
    );

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).not.toBeVisible();

    const patchRes = await patchPromise;
    expect(patchRes.ok()).toBeTruthy();
    const patchJson = await patchRes.json();
    expect(patchJson.start_date).toBe(todayVal);
    expect(patchJson.due_date).toBeNull();
  });

  test('15. Daily Tasks with recreate_after == "1d" are displayed in normal To Do section in People column', async ({
    page,
  }) => {
    // Show all issues
    await page.getByRole('button', { name: /All Issues/ }).click();

    // Post a webhook creating a daily routine task: Active (start_date in past) and recreate_after: '1d'
    const dailyWebhookRes = await page.request.post('/api/webhooks/jira', {
      data: {
        webhookEvent: 'jira:issue_created',
        issue: {
          id: '888',
          key: 'PROJ-888',
          fields: {
            summary: 'Daily Morning Checklist',
            status: {
              id: '1',
              name: 'To Do',
              statusCategory: { id: 2, key: 'new', name: 'To Do' },
            },
            priority: { id: '3', name: 'Medium' },
            issuetype: { id: '3', name: 'Task' },
            customfield_10015: '2026-10-01', // start_date: Active
            customfield_10027: '1d', // recreate_after: '1d'
          },
        },
      },
    });
    expect(dailyWebhookRes.ok()).toBeTruthy();

    // Verify "Home as Usual" sub-section does NOT exist
    await expect(page.getByTestId('people-section-home-as-usual')).toHaveCount(0);

    // Verify task is displayed in the normal To Do section
    const otherSection = page.getByTestId('people-section-other').first();
    await expect(otherSection).toBeVisible();
    await expect(otherSection.locator('article', { hasText: 'PROJ-888' })).toBeVisible();
  });

  test('16. Preferences & View Persistence: "Who is Me" shows all available users and view choice persists across reload', async ({
    page,
  }) => {
    // 1. Initially on People view
    await expect(page.getByRole('button', { name: 'People View' })).toBeVisible();

    // 2. Open "Who is Me" picker
    const meChevron = page.getByRole('button', { name: 'Change who is Me' });
    await expect(meChevron).toBeVisible();
    await meChevron.click();

    const listbox = page.locator('[role="listbox"][aria-label="Choose who is Me"]');
    await expect(listbox).toBeVisible();

    // Verify available users from backend /api/users are listed (e.g. Alex Lead)
    await expect(listbox.getByText('Alex Lead')).toBeVisible();

    // Click Alex Lead to change active identity
    await listbox.getByText('Alex Lead').click();

    // Verify localStorage has saved ha_jira_current_user
    const savedUser = await page.evaluate(() => localStorage.getItem('ha_jira_current_user'));
    expect(savedUser).toBe('Alex Lead');

    // 3. Switch to Backlog view
    const backlogBtn = page.locator('header [aria-label="Backlog View"]');
    await expect(backlogBtn).toBeVisible();
    await backlogBtn.click();
    await expect(page.locator('[data-testid^="backlog-row-"]').first()).toBeVisible();

    // Verify localStorage has saved ha_jira_current_view as 'backlog'
    const savedView = await page.evaluate(() => localStorage.getItem('ha_jira_current_view'));
    expect(savedView).toBe('backlog');

    // 4. Reload page (simulate opening browser next time)
    await page.reload();

    // 5. Verify user is still Alex Lead and view is still Backlog
    await expect(page.locator('[data-testid^="backlog-row-"]').first()).toBeVisible();
    const reloadedUser = await page.evaluate(() => localStorage.getItem('ha_jira_current_user'));
    expect(reloadedUser).toBe('Alex Lead');
    const reloadedView = await page.evaluate(() => localStorage.getItem('ha_jira_current_view'));
    expect(reloadedView).toBe('backlog');
  });

  test('Account types: saving a Child account succeeds, no error, and is stored on the backend', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const saved = page.waitForResponse(
      (res) =>
        res.url().includes('/api/account-types') &&
        res.request().method() === 'PUT' &&
        res.status() === 200
    );
    await page.getByRole('radio', { name: 'Alex Lead Child' }).click();
    await saved;
    await expect(page.getByText(/Could not save account type/)).toHaveCount(0);

    // Source of truth is the backend: wipe the local cache and reload.
    await page.evaluate(() => window.localStorage.removeItem('ha_jira_account_types'));
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Alex Lead Child' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    const res = await page.request.get('/api/account-types');
    expect((await res.json()).account_types).toEqual({ 'alex lead': 'child' });
  });

  test('18. Linked Issues: displays linked tasks and supports clicking to open linked task', async ({
    page,
  }) => {
    // 1. Open PROJ-101
    const card = page.getByText('PROJ-101').first();
    await card.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    // 2. Verify Linked tasks section
    const linkedSection = modal.getByTestId('linked-issues-section');
    await expect(linkedSection).toBeVisible();
    await expect(linkedSection.getByText(/Linked tasks/)).toBeVisible();

    // Verify relationships and linked tickets
    await expect(linkedSection.getByText('is cloned by')).toBeVisible();
    await expect(linkedSection.getByText('blocks')).toBeVisible();
    await expect(linkedSection.getByText('PROJ-98')).toBeVisible();
    await expect(linkedSection.getByText('PROJ-85')).toBeVisible();

    // 3. Click PROJ-98 to open linked issue
    const proj98Link = linkedSection.getByTestId('linked-issue-PROJ-98');
    await proj98Link.click();

    // Modal switches to PROJ-98
    await expect(modal.locator('#edit-summary')).toHaveValue(/Design system tokens/);
    await expect(page).toHaveURL(/\/task\/PROJ-98/);
  });

  test('19. Seeding Fake Jira: pre-seeds issues before page load and verifies user interactions are registered in Fake Jira', async ({
    page,
  }) => {
    // 1. Seed a brand new task directly into Fake Jira before loading page
    const seedRes = await page.request.post('/api/test/jira/issues', {
      data: {
        summary: 'Pre-seeded Task for Fake Jira Verification',
        status_name: 'To Do',
        status_category: 'todo',
        priority: 'high',
        assignee_name: 'Jacek Marchwicki',
        assignee_account_id: 'usr-1',
      },
      params: { trigger_webhook: 'false' },
    });
    expect(seedRes.ok()).toBeTruthy();
    const seeded = await seedRes.json();
    const seededKey = seeded.key;

    // 2. Open the page and verify the pre-seeded task is present
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');

    const card = page.locator('article', { hasText: seededKey }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText('Pre-seeded Task for Fake Jira Verification')).toBeVisible();

    // 3. User interaction 1: Quick Action: Mark as Done
    const doneBtn = card.getByTitle('Quick Action: Mark as Done');
    await doneBtn.click();
    await expect(card.locator('p')).toHaveClass(/line-through/);

    // Verify change is registered on the Fake Jira backend!
    await expect.poll(async () => {
      const res = await page.request.get(`/api/test/jira/issues/${seededKey}`);
      if (!res.ok()) return null;
      const jiraIssue = await res.json();
      return jiraIssue.status.name;
    }, { timeout: 10000 }).toBe('Done');

    // 4. User interaction 2: Edit issue summary in modal
    await card.click();
    const dialog = page.getByRole('dialog', { name: new RegExp(`Edit Issue ${seededKey}`) });
    await expect(dialog).toBeVisible();

    const summaryInput = dialog.locator('#edit-summary');
    await summaryInput.fill('Pre-seeded Task (Edited via UI)');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).not.toBeVisible();

    await expect(card.getByText('Pre-seeded Task (Edited via UI)')).toBeVisible();

    // Verify summary change is registered on Fake Jira backend!
    await expect.poll(async () => {
      const res = await page.request.get(`/api/test/jira/issues/${seededKey}`);
      if (!res.ok()) return null;
      const jiraIssue = await res.json();
      return jiraIssue.summary;
    }, { timeout: 10000 }).toBe('Pre-seeded Task (Edited via UI)');
  });

  test('20. Fake Jira Webhooks: adding and updating task in Fake Jira automatically syncs to browser UI via WebSockets', async ({
    page,
  }) => {
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
    await expect(page.getByText('Live WebSocket')).toBeVisible();

    // 1. Add a task to Fake Jira with webhook dispatch enabled (simulates external Jira webhook creation)
    const addRes = await page.request.post('/api/test/jira/issues', {
      data: {
        summary: 'Task Dispatched from Fake Jira Webhook Engine',
        status_name: 'To Do',
        status_category: 'todo',
        priority: 'medium',
        assignee_name: 'Jacek Marchwicki',
        assignee_account_id: 'usr-1',
      },
      params: { trigger_webhook: 'true' },
    });
    expect(addRes.ok()).toBeTruthy();
    const created = await addRes.json();
    const newKey = created.key;

    // 2. Without refreshing the page, verify new task appears in UI via WebSocket broadcast
    const newCard = page.locator('article', { hasText: newKey }).first();
    await expect(newCard).toBeVisible({ timeout: 10000 });
    await expect(newCard.getByText('Task Dispatched from Fake Jira Webhook Engine')).toBeVisible();

    // 3. Update this task in Fake Jira using simulated Jira webhook event
    await page.request.post('/api/test/jira/webhooks/dispatch', {
      data: {
        event: 'jira:issue_updated',
        issue_key: newKey,
        fields: {
          summary: 'Task Dispatched from Fake Jira (Updated externally)',
          status_name: 'Done',
          status_category: 'done',
        },
      },
    });

    // 4. Verify browser UI updates automatically without refresh
    await expect(newCard.getByText('Task Dispatched from Fake Jira (Updated externally)')).toBeVisible({ timeout: 10000 });
    await expect(newCard.locator('p')).toHaveClass(/line-through/);
  });

  test('21. Cross-Browser Synchronization: simultaneous browser contexts synchronize updates in real time', async ({
    browser,
  }) => {
    // Open two distinct browser contexts simulating two open browsers/devices simultaneously
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await pageA.goto('/');
      await pageB.goto('/');

      await expect(pageA.locator('h1')).toHaveText('Engineering Sprint Board');
      await expect(pageB.locator('h1')).toHaveText('Engineering Sprint Board');

      await expect(pageA.getByText('Live WebSocket')).toBeVisible();
      await expect(pageB.getByText('Live WebSocket')).toBeVisible();

      // Ensure both have PROJ-101 in To Do
      const cardA = pageA.locator('article', { hasText: 'PROJ-101' }).first();
      const cardB = pageB.locator('article', { hasText: 'PROJ-101' }).first();
      await expect(cardA).toBeVisible();
      await expect(cardB).toBeVisible();
      await expect(cardA.locator('p')).not.toHaveClass(/line-through/);
      await expect(cardB.locator('p')).not.toHaveClass(/line-through/);

      // In Browser A: user clicks "Done" on PROJ-101
      const doneBtnA = cardA.getByTitle('Quick Action: Mark as Done');
      await doneBtnA.click();
      await expect(cardA.locator('p')).toHaveClass(/line-through/);

      // In Browser B: WITHOUT ANY RELOAD, Browser B receives WebSocket broadcast and updates
      await expect(cardB.locator('p')).toHaveClass(/line-through/, { timeout: 10000 });

      // In Browser B: user edits summary of PROJ-85
      const cardB_85 = pageB.locator('article', { hasText: 'PROJ-85' }).first();
      await cardB_85.click();

      const dialogB = pageB.getByRole('dialog', { name: /Edit Issue PROJ-85/ });
      await expect(dialogB).toBeVisible();
      const summaryInputB = dialogB.locator('#edit-summary');
      await summaryInputB.fill('Jira webhook ingestion engine (Edited from Browser B)');
      await dialogB.getByRole('button', { name: 'Save' }).click();
      await expect(dialogB).not.toBeVisible();

      // In Browser A: verify the edited summary appears live via WebSockets
      const cardA_85 = pageA.locator('article', { hasText: 'PROJ-85' }).first();
      await expect(
        cardA_85.getByText('Jira webhook ingestion engine (Edited from Browser B)')
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('22. Connection Resilience: browser recovers when network connection to Python server drops and reconnects', async ({
    page,
    context,
  }) => {
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
    await expect(page.getByText('Live WebSocket')).toBeVisible();

    // 1. Simulate browser losing connection to Python server
    await context.setOffline(true);

    // Header badge indicates Reconnecting / offline
    await expect(page.getByText('Reconnecting')).toBeVisible({ timeout: 5000 });

    // 2. Perform an optimistic action while disconnected
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' }).first();
    const doneBtn = proj101Article.getByTitle('Quick Action: Mark as Done');
    await doneBtn.click();

    // UI updates optimistically locally
    await expect(proj101Article.locator('p')).toHaveClass(/line-through/);

    // 3. Restore network connection to Python server
    await context.setOffline(false);

    // WebSocket reconnects successfully
    await expect(page.getByText('Live WebSocket')).toBeVisible({ timeout: 10000 });

    // Queued outbox mutation is synced to Python server and applied in Fake Jira
    await expect.poll(async () => {
      const res = await page.request.get('/api/test/jira/issues/PROJ-101');
      if (!res.ok()) return null;
      const issue = await res.json();
      return issue.status.name;
    }, { timeout: 10000 }).toBe('Done');
  });

  test('23. Connection Resilience: Python server handles Jira connectivity outage gracefully via outbox queue', async ({
    page,
  }) => {
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
    await expect(page.getByText('Live WebSocket')).toBeVisible();

    // 1. Simulate Jira API becoming unreachable (503 Service Unavailable)
    await page.request.post('/api/test/simulate-error', {
      data: {
        enable: true,
        status_code: 503,
        message: 'Jira Cloud connection timeout',
        target: 'all',
      },
    });

    // 2. User transitions PROJ-101 to Done
    // Python server saves change locally to SQLite and queues it in sync_outbox
    const proj101Article = page.locator('article', { hasText: 'PROJ-101' }).first();
    const transitionPromise = page.waitForResponse(
      (res) => res.url().includes('/api/issues/PROJ-101/transition') && res.status() === 200
    );
    const doneBtn = proj101Article.getByTitle('Quick Action: Mark as Done');
    await doneBtn.click();

    // UI maintains optimistic Done state immediately
    await expect(proj101Article.locator('p')).toHaveClass(/line-through/);

    // Wait for transition sync request to reach the server
    await transitionPromise;

    // Verify backend outbox has the queued item
    await expect.poll(async () => {
      const res = await page.request.get('/api/test/outbox');
      if (!res.ok()) return [];
      return await res.json();
    }, { timeout: 5000 }).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issue_key: 'PROJ-101',
          action_type: 'transition_issue',
          status: 'pending',
        }),
      ])
    );

    // 3. Jira comes back online
    await page.request.post('/api/test/simulate-error', {
      data: { enable: false },
    });

    // Drain outbox queue
    await page.request.post('/api/test/sync-drain');

    // Verify outbox is drained
    await expect.poll(async () => {
      const res = await page.request.get('/api/test/outbox');
      if (!res.ok()) return [{}];
      return await res.json();
    }, { timeout: 10000 }).toHaveLength(0);

    // Verify Jira received and recorded the transition to Done
    const jiraRes = await page.request.get('/api/test/jira/issues/PROJ-101');
    expect(jiraRes.ok()).toBeTruthy();
    const jiraIssue = await jiraRes.json();
    expect(jiraIssue.status.name).toBe('Done');
  });
});



