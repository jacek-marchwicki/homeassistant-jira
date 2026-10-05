import { test, expect } from '@playwright/test';

/**
 * Visual Screenshot & Regression Suite.
 *
 * Captures high-fidelity screenshots across all supported responsive viewports
 * (Desktop, Tablet, Mobile, Wallboard Kiosk) and color themes (Dark, Light, Kiosk).
 */

test.describe('Visual Screenshot Tests across Viewports & Themes', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.post('/api/test/reset');
    await page.goto('/');
    // Wait for the board title and issues to be fully rendered
    await expect(page.locator('h1')).toHaveText('Engineering Sprint Board');
    await expect(page.getByText('PROJ-101')).toBeVisible();
  });

  test('Capture Desktop Viewports (Dark, Light, Kiosk Themes)', async ({ page }) => {
    // 1. Desktop Dark Mode (Default)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: './tests/screenshots/desktop-dark.png',
      fullPage: true,
      animations: 'disabled',
    });

    // 2. Switch to Light Mode and Capture
    const lightButton = page.getByTitle('Light Mode');
    await lightButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(200); // Allow 150ms CSS color transition to fully settle
    await page.screenshot({
      path: './tests/screenshots/desktop-light.png',
      fullPage: true,
      animations: 'disabled',
    });

    // 3. Switch to Kiosk / Wallboard Mode and Capture
    const kioskButton = page.getByTitle('Kiosk / Wallboard Mode');
    await kioskButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'kiosk');
    await page.waitForTimeout(200); // Allow 150ms CSS color transition to fully settle
    await page.screenshot({
      path: './tests/screenshots/desktop-kiosk.png',
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('Capture Tablet Viewport (768x1024)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({
      path: './tests/screenshots/tablet-768x1024.png',
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('Capture Mobile Viewport (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: './tests/screenshots/mobile-375x667.png',
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('Capture 1080p Wallboard Viewport (1920x1080)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({
      path: './tests/screenshots/wallboard-1920x1080.png',
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('Capture Key Component Snapshots', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Navigation Header & Status Badge
    const header = page.locator('header');
    await header.screenshot({
      path: './tests/screenshots/component-header.png',
      animations: 'disabled',
    });

    // 2. Kanban Column & Issue Card with Quick Action
    const proj101 = page.locator('article', { hasText: 'PROJ-101' });
    await proj101.screenshot({
      path: './tests/screenshots/component-card.png',
      animations: 'disabled',
    });
  });

  test('Capture Workflow Columns Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const board = page.locator('main');
    await board.screenshot({
      path: './tests/screenshots/board-workflow-columns.png',
      animations: 'disabled',
    });
  });

  test('Capture Ready Column Sub-Sections (Overdue and Expedited) Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Mock /api/board with Ready column containing Overdue, Expedited, and Other issues
    await page.route('**/api/board', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          board_id: 'engineering-1',
          board_name: 'Engineering Sprint Board',
          sprint_name: 'Active Sprint 42',
          columns: [
            { id: 'col-ready', name: 'Ready', category: 'todo', status_ids: ['10003'] },
            { id: 'col-inprogress', name: 'In Progress', category: 'inprogress', status_ids: ['2'] },
            { id: 'col-done', name: 'Done', category: 'done', status_ids: ['4'] },
          ],
          issues: [
            {
              id: '101',
              key: 'PROJ-101',
              summary: 'Critical server outage remediation',
              issue_type: 'bug',
              priority: 'highest',
              status: { id: '10003', name: 'Ready', category: 'todo' },
              due_date: '2020-01-01',
              updated_at: '2026-10-05T00:00:00Z',
            },
            {
              id: '102',
              key: 'PROJ-102',
              summary: 'Zero-day vulnerability patch deployment',
              issue_type: 'task',
              priority: 'highest',
              status: { id: '10003', name: 'Ready', category: 'todo' },
              start_date: null,
              due_date: '2026-10-05',
              updated_at: '2026-10-05T00:00:00Z',
            },
            {
              id: '103',
              key: 'PROJ-103',
              summary: 'Quarterly roadmap documentation cleanup',
              issue_type: 'story',
              priority: 'medium',
              status: { id: '10003', name: 'Ready', category: 'todo' },
              due_date: '2028-06-01',
              updated_at: '2026-10-05T00:00:00Z',
            },
          ],
        }),
      });
    });

    await page.goto('/');

    const readyColumn = page.getByTestId('column-col-ready');
    await expect(readyColumn).toBeVisible();

    const overdueSection = page.getByTestId('ready-section-overdue');
    const expeditedSection = page.getByTestId('ready-section-expedited');
    const otherSection = page.getByTestId('ready-section-other');

    await expect(overdueSection).toBeVisible();
    await expect(expeditedSection).toBeVisible();
    await expect(otherSection).toBeVisible();

    // 1. Capture Overdue section snapshot
    await overdueSection.screenshot({
      path: './tests/screenshots/ready-section-overdue.png',
      animations: 'disabled',
    });

    // 2. Capture Expedited section snapshot
    await expeditedSection.screenshot({
      path: './tests/screenshots/ready-section-expedited.png',
      animations: 'disabled',
    });

    // 3. Capture full Ready column snapshot with all sub-sections
    await readyColumn.screenshot({
      path: './tests/screenshots/ready-column-sections.png',
      animations: 'disabled',
    });
  });

  test('Capture Create Issue Modal Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const createButton = page.getByRole('button', { name: 'Create Issue' });
    await createButton.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(page.locator('#create-issue-title')).toHaveText('Create Issue');

    // 1. Capture full screen modal snapshot
    await page.screenshot({
      path: './tests/screenshots/modal-create-issue.png',
      animations: 'disabled',
    });

    // 2. Capture isolated modal dialog container
    const dialogBox = modal.locator('> div');
    await dialogBox.screenshot({
      path: './tests/screenshots/component-modal-create.png',
      animations: 'disabled',
    });
  });

  test('Capture Edit Issue Modal Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const editButton = page.locator('button[aria-label="Edit PROJ-101"]').first();
    await editButton.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(page.locator('#edit-issue-title')).toContainText('Edit Issue');

    // 1. Capture full screen modal snapshot
    await page.screenshot({
      path: './tests/screenshots/modal-edit-issue.png',
      animations: 'disabled',
    });

    // 2. Capture isolated modal dialog container
    const dialogBox = modal.locator('> div');
    await dialogBox.screenshot({
      path: './tests/screenshots/component-modal-edit.png',
      animations: 'disabled',
    });
  });

  test('Capture Create Issue Modal with Assignee Picker Open Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const createButton = page.getByRole('button', { name: 'Create Issue' });
    await createButton.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    // Click assignee combobox to open the suggestions dropdown
    const assigneePicker = modal.locator('[role="combobox"][aria-label="Assignee"]');
    await assigneePicker.click();

    const listbox = modal.locator('[role="listbox"]');
    await expect(listbox).toBeVisible();

    // Capture the modal with open assignee suggestions dropdown
    await modal.locator('> div').screenshot({
      path: './tests/screenshots/component-modal-create-assignee-picker.png',
      animations: 'disabled',
    });
  });

  test('Capture Create Issue Modal with Description and Details Filled Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const createButton = page.getByRole('button', { name: 'Create Issue' });
    await createButton.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    await page.locator('#create-summary').fill('Investigate edge gateway telemetry latency');
    await page
      .locator('#create-description')
      .fill(
        'Detailed technical description:\n- Verify MQTT broker keepalive\n- Inspect bridge buffer utilisation\n- Measure roundtrip ACK latency'
      );

    const dialogBox = modal.locator('> div');
    await dialogBox.screenshot({
      path: './tests/screenshots/component-modal-create-description.png',
      animations: 'disabled',
    });
  });

  test('Capture Create Issue Modal with Status Selector Open Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const createButton = page.getByRole('button', { name: 'Create Issue' });
    await createButton.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    const statusPicker = modal.locator('[role="combobox"][aria-label="Status"]');
    await statusPicker.click();

    const listbox = modal.locator('[role="listbox"][aria-label="Status"]');
    await expect(listbox).toBeVisible();

    await modal.locator('> div').screenshot({
      path: './tests/screenshots/component-modal-create-status-picker.png',
      animations: 'disabled',
    });
  });

  test('Capture Issue Card with Status Selector Open Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const card = page.locator('article', { hasText: 'PROJ-101' });
    await expect(card).toBeVisible();

    const statusPicker = card.locator('[role="combobox"][aria-label="Change status for PROJ-101"]');
    await statusPicker.click();

    const listbox = card.locator('[role="listbox"][aria-label="Change status for PROJ-101"]');
    await expect(listbox).toBeVisible();

    await card.screenshot({
      path: './tests/screenshots/component-card-status-picker.png',
      animations: 'disabled',
    });
  });

  test('Capture Board Filtered by Search Query Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const searchInput = page.getByPlaceholder('Search key, summary, description...');
    await searchInput.fill('PROJ-101');
    await page.waitForTimeout(100);

    await page.screenshot({
      path: './tests/screenshots/board-search-filtered.png',
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('Capture Filter Bar with "Who is Me" Picker Open Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const mePickerBtn = page.getByRole('button', { name: 'Change who is Me' });
    await expect(mePickerBtn).toBeVisible();
    await mePickerBtn.click();

    const listbox = page.locator('[role="listbox"][aria-label="Choose who is Me"]');
    await expect(listbox).toBeVisible();

    await page.screenshot({
      path: './tests/screenshots/filter-who-is-me-picker.png',
      fullPage: true,
      animations: 'disabled',
    });
  });

  test('Capture Issue Card with Jira Link Hover Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const issueCard = page.locator('article', { hasText: 'PROJ-101' });
    await expect(issueCard).toBeVisible();

    const jiraLink = issueCard.locator('a[aria-label="Open PROJ-101 in Jira"]');
    await expect(jiraLink).toBeVisible();
    await expect(jiraLink).toHaveAttribute('target', '_blank');
    await expect(jiraLink).toHaveAttribute('href', /browse\/PROJ-101/);

    await jiraLink.hover();
    await page.waitForTimeout(100);

    await issueCard.screenshot({
      path: './tests/screenshots/component-card-jira-link-hover.png',
      animations: 'disabled',
    });
  });
});

