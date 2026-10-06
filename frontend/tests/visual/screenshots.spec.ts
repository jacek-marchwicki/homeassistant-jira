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

  test('Capture Ready Column Sub-Sections (Overdue, Expedited, and In Progress) Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Mock /api/board with Ready column containing Overdue, Expedited, In Progress, and Other issues
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
              due_date: null,
              updated_at: '2026-10-05T00:00:00Z',
            },
            {
              id: '104',
              key: 'PROJ-104',
              summary: 'Real-time telemetry WebSocket streaming',
              issue_type: 'task',
              priority: 'high',
              status: { id: '2', name: 'In Progress', category: 'inprogress' },
              due_date: '2028-06-01',
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
    const inProgressSection = page.getByTestId('ready-section-inprogress');
    const otherSection = page.getByTestId('ready-section-other');

    await expect(overdueSection).toBeVisible();
    await expect(expeditedSection).toBeVisible();
    await expect(inProgressSection).toBeVisible();
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

    // 3. Capture In Progress section snapshot
    await inProgressSection.screenshot({
      path: './tests/screenshots/ready-section-inprogress.png',
      animations: 'disabled',
    });

    // 4. Capture full Ready column snapshot with all sub-sections
    await readyColumn.screenshot({
      path: './tests/screenshots/ready-column-sections.png',
      animations: 'disabled',
    });
  });

  test('Capture In Progress Drop Target at Top of Ready List during Drag Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const card = page.locator('article', { hasText: 'PROJ-101' });
    await expect(card).toBeVisible();

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Move 25px down to activate pointer sensor
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 25);
    }

    // Verify intermediate In Progress column is never rendered on the board
    await expect(page.getByTestId('column-col-inprogress')).not.toBeAttached();

    // Verify drop target is displayed at the top of the Ready list
    const dropTarget = page.getByTestId('ready-drop-target-inprogress');
    await expect(dropTarget).toBeVisible();
    await expect(dropTarget).toContainText('In Progress');
    await expect(dropTarget).toContainText('Drop target');

    const readyColumn = page.getByTestId('column-col-todo');
    await expect(readyColumn).toBeVisible();

    await readyColumn.screenshot({
      path: './tests/screenshots/ready-drop-target-inprogress-column.png',
      animations: 'disabled',
    });

    await dropTarget.screenshot({
      path: './tests/screenshots/ready-drop-target-inprogress.png',
      animations: 'disabled',
    });

    // Hover over drop target to capture active drag-over state
    const targetBox = await dropTarget.boundingBox();
    if (targetBox) {
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
    }
    await page.waitForTimeout(100);

    await dropTarget.screenshot({
      path: './tests/screenshots/ready-drop-target-inprogress-hover.png',
      animations: 'disabled',
    });

    await page.mouse.up();
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

    // 3. Switch to Preview in RichTextEditor and capture rich text preview snapshot
    const descTextarea = page.locator('#create-description');
    await descTextarea.fill('### Rich Text Formatting\n\n- Feature item 1\n- **Bold point**\n- `inline code`\n\n> Important quote');
    const previewBtn = page.getByRole('button', { name: 'Preview tab' });
    await previewBtn.click();
    const previewArea = page.getByTestId('rich-text-preview');
    await expect(previewArea).toBeVisible();
    await previewArea.screenshot({
      path: './tests/screenshots/component-rich-text-preview.png',
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

    // 1. Verify description defaults to Preview style when editing
    const previewArea = modal.getByTestId('rich-text-preview');
    await expect(previewArea).toBeVisible();

    // 2. Verify Recreate after hints are present
    const hint1d = modal.getByRole('button', { name: '1d' });
    const hint2y = modal.getByRole('button', { name: '2y!' });
    await expect(hint1d).toBeVisible();
    await expect(hint2y).toBeVisible();

    // 3. Capture full screen modal snapshot
    await page.screenshot({
      path: './tests/screenshots/modal-edit-issue.png',
      animations: 'disabled',
    });

    // 4. Capture isolated modal dialog container
    const dialogBox = modal.locator('> div');
    await dialogBox.screenshot({
      path: './tests/screenshots/component-modal-edit.png',
      animations: 'disabled',
    });

    // 5. Verify Jira browse link format
    const modalJiraLink = modal.locator('a[aria-label="Open PROJ-101 in Jira"]');
    await expect(modalJiraLink).toBeVisible();
    await expect(modalJiraLink).toHaveAttribute('target', '_blank');
    await expect(modalJiraLink).toHaveAttribute('href', /browse\/PROJ-101/);

    // 6. Verify and capture Created & Updated dates badge (above comments)
    const datesBar = modal.getByTestId('edit-issue-dates');
    await expect(datesBar).toBeVisible();
    await expect(datesBar).toContainText('Created:');
    await expect(datesBar).toContainText('Updated:');
    await datesBar.screenshot({
      path: './tests/screenshots/component-edit-dates.png',
      animations: 'disabled',
    });
  });

  test('Capture Edit Issue Modal with Comments Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const editButton = page.locator('button[aria-label="Edit PROJ-101"]').first();
    await editButton.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(page.locator('#edit-issue-title')).toContainText('Edit Issue');

    const commentsSection = modal.getByTestId('comments-section');
    await expect(commentsSection).toBeVisible();
    await expect(commentsSection.getByText(/Comments/)).toBeVisible();

    // Capture isolated comments section snapshot
    await commentsSection.screenshot({
      path: './tests/screenshots/component-comments-section.png',
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

  test('Capture Edit Issue Modal Jira Link Hover Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const editButton = page.locator('button[aria-label="Edit PROJ-101"]').first();
    await editButton.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    const modalJiraLink = modal.locator('a[aria-label="Open PROJ-101 in Jira"]');
    await expect(modalJiraLink).toBeVisible();
    await expect(modalJiraLink).toHaveAttribute('href', /browse\/PROJ-101/);

    await modalJiraLink.hover();
    await page.waitForTimeout(100);

    const header = modal.locator('div.flex.items-center.justify-between').first();
    await header.screenshot({
      path: './tests/screenshots/component-modal-edit-jira-link-hover.png',
      animations: 'disabled',
    });
  });

  test('Capture High Volume Multi-Page Issues Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const largeIssues = Array.from({ length: 125 }, (_, i) => ({
      id: `${1000 + i}`,
      key: `HOME-${1000 + i}`,
      summary: `Paginated Issue #${i + 1} - System optimization and monitoring`,
      issue_type: i % 4 === 0 ? 'bug' : i % 3 === 0 ? 'story' : 'task',
      priority: i % 5 === 0 ? 'highest' : i % 3 === 0 ? 'high' : 'medium',
      status: {
        id: i % 2 === 0 ? '1' : '2',
        name: i % 2 === 0 ? 'To Do' : 'In Progress',
        category: i % 2 === 0 ? 'todo' : 'inprogress',
      },
      assignee: {
        account_id: 'usr-1',
        display_name: 'Jacek Marchwicki',
      },
      updated_at: new Date().toISOString(),
    }));

    await page.route('**/api/board', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          board_id: 'HOME',
          board_name: 'Engineering Sprint Board (125 Issues)',
          sprint_name: 'Active Sprint 42',
          jira_url: 'https://marchwicki.atlassian.net',
          columns: [
            { id: 'col-todo', name: 'To Do', category: 'todo', status_ids: ['1'] },
            { id: 'col-inprogress', name: 'In Progress', category: 'inprogress', status_ids: ['2'] },
            { id: 'col-done', name: 'Done', category: 'done', status_ids: ['4'] },
          ],
          issues: largeIssues,
        }),
      });
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Select "All Issues" filter to ensure all paginated tickets are rendered
    const allIssuesButton = page.getByRole('button', { name: /All Issues/ });
    await allIssuesButton.click();

    const firstCard = page.locator('article', { hasText: 'HOME-1000' });
    await expect(firstCard).toBeVisible();

    await page.screenshot({
      path: './tests/screenshots/board-high-volume-pagination.png',
      animations: 'disabled',
    });
  });

  test('Capture Create Issue Modal with Issue Type Selector Open Snapshot (with Epic)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const createButton = page.getByRole('button', { name: 'Create Issue' });
    await createButton.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();

    const typePicker = modal.locator('[role="combobox"][aria-label="Issue Type"]');
    await typePicker.click();

    const listbox = modal.locator('[role="listbox"][aria-label="Issue Type Options"]');
    await expect(listbox).toBeVisible();
    const epicOption = listbox.locator('[role="option"]', { hasText: 'Epic' });
    await expect(epicOption).toBeVisible();

    await modal.locator('> div').screenshot({
      path: './tests/screenshots/component-modal-create-type-picker.png',
      animations: 'disabled',
    });
  });

  test('Capture Epic Issue Card Snapshot (HOME-2200)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.route('**/api/board', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          board_id: 'HOME',
          board_name: 'Home Sprint Board',
          sprint_name: 'Current Sprint',
          columns: [
            { id: 'col-todo', name: 'To Do', category: 'todo', status_ids: ['10003'] },
            { id: 'col-inprogress', name: 'In Progress', category: 'inprogress', status_ids: ['2'] },
            { id: 'col-done', name: 'Done', category: 'done', status_ids: ['4'] },
          ],
          issues: [
            {
              id: '12203',
              key: 'HOME-2200',
              summary: 'Wiara, spowiedź i Pismo Święte',
              issue_type: 'epic',
              priority: 'medium',
              status: { id: '10003', name: 'Ready', category: 'todo' },
              recreate_after: '!1y',
              updated_at: '2026-10-06T00:00:00Z',
            },
          ],
        }),
      });
    });

    await page.goto('/');

    // Toggle off "Hide Epics" to reveal the epic card on the board
    const hideEpicsBtn = page.getByRole('button', { name: 'Hide Epics' });
    await expect(hideEpicsBtn).toBeVisible();
    await hideEpicsBtn.click();

    const epicCard = page.locator('article', { hasText: 'HOME-2200' });
    await expect(epicCard).toBeVisible();
    const epicIcon = epicCard.locator('[aria-label="Epic"]');
    await expect(epicIcon).toBeVisible();

    await epicCard.screenshot({
      path: './tests/screenshots/component-card-epic.png',
      animations: 'disabled',
    });
  });

  test('Capture Filter Bar with "Hide Epics" Toggle Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const filterBar = page.locator('section').filter({ hasText: 'All Issues' });
    await expect(filterBar).toBeVisible();

    const hideEpicsBtn = filterBar.getByRole('button', { name: 'Hide Epics' });
    await expect(hideEpicsBtn).toBeVisible();

    await filterBar.screenshot({
      path: './tests/screenshots/component-filterbar-hide-epics.png',
      animations: 'disabled',
    });
  });

  test('Capture Home Assistant Ingress Viewport & Theme Bridge Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Inject Home Assistant design tokens to simulate Home Assistant Ingress host styling
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--primary-background-color', '#101724');
      document.documentElement.style.setProperty('--card-background-color', '#1c2538');
      document.documentElement.style.setProperty('--ha-card-background', '#232e42');
      document.documentElement.style.setProperty('--primary-text-color', '#e1e7f0');
      document.documentElement.style.setProperty('--secondary-text-color', '#94a3b8');
      document.documentElement.style.setProperty('--accent-color', '#0284c7');
      document.documentElement.style.setProperty('--divider-color', '#2d3b55');
    });

    await page.waitForTimeout(200);

    await page.screenshot({
      path: './tests/screenshots/home-assistant-ingress.png',
      fullPage: true,
      animations: 'disabled',
    });
  });
});

