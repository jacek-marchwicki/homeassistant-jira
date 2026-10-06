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
    await expect(page).toHaveScreenshot('desktop-dark.png', {
      fullPage: true,
    });

    // 2. Switch to Light Mode and Capture
    const lightButton = page.getByTitle('Light Mode');
    await lightButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(200); // Allow 150ms CSS color transition to fully settle
    await expect(page).toHaveScreenshot('desktop-light.png', {
      fullPage: true,
    });

    // 3. Switch to Kiosk / Wallboard Mode and Capture
    const kioskButton = page.getByTitle('Kiosk / Wallboard Mode');
    await kioskButton.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'kiosk');
    await page.waitForTimeout(200); // Allow 150ms CSS color transition to fully settle
    await expect(page).toHaveScreenshot('desktop-kiosk.png', {
      fullPage: true,
    });
  });

  test('Capture Tablet Viewport (768x1024)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page).toHaveScreenshot('tablet-768x1024.png', {
      fullPage: true,
    });
  });

  test('Capture Mobile Viewport (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page).toHaveScreenshot('mobile-375x667.png', {
      fullPage: true,
    });
  });

  test('Capture Mobile Single-Line Top Header & Filter Bar Snapshots (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const header = page.locator('header');
    await expect(header).toBeVisible();
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    // Verify top header takes exactly 1 line (height around 44-54px, definitely not 2 lines of 88px+)
    if (headerBox) {
      expect(headerBox.height).toBeLessThan(65);
    }
    await expect(header).toHaveScreenshot('component-header-mobile.png');

    const filterBar = page.locator('section').filter({ hasText: 'All Issues' });
    await expect(filterBar).toBeVisible();
    const filterBox = await filterBar.boundingBox();
    expect(filterBox).not.toBeNull();
    // Verify filter bar takes exactly 1 line (height around 36-48px, definitely not 2 lines of 75px+)
    if (filterBox) {
      expect(filterBox.height).toBeLessThan(56);
    }
    await expect(filterBar).toHaveScreenshot('component-filterbar-mobile.png');
  });

  test('Capture Mobile Theme Selector Dropdown Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    const themeDropdownTrigger = page.locator('header button[aria-label="Theme Selection"]');
    await expect(themeDropdownTrigger).toBeVisible();
    await themeDropdownTrigger.click();

    const themeDropdown = page.locator('div[role="listbox"][aria-label="Select Theme"]');
    await expect(themeDropdown).toBeVisible();
    await page.waitForTimeout(100);

    await expect(page).toHaveScreenshot('mobile-theme-dropdown.png');
  });

  test('Capture Mobile Scrolled Content under Header Snapshot (verifying no overlap)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    // Scroll page down so filter bar and top issues slide under sticky header
    await page.evaluate(() => window.scrollTo(0, 150));
    await page.waitForTimeout(100);

    const header = page.locator('header');
    await expect(header).toBeVisible();

    await expect(page).toHaveScreenshot('mobile-scrolled-under-header.png');
  });

  test('Capture Compact Mobile Viewport (320x568 - iPhone SE)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page).toHaveScreenshot('mobile-320x568-compact.png', {
      fullPage: true,
    });
  });

  test('Capture 1080p Wallboard Viewport (1920x1080)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page).toHaveScreenshot('wallboard-1920x1080.png', {
      fullPage: true,
    });
  });

  test('Capture Key Component Snapshots', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 1. Navigation Header & Status Badge
    const header = page.locator('header');
    await expect(header).toHaveScreenshot('component-header.png');

    // 2. Kanban Column & Issue Card with Quick Action
    const proj101 = page.locator('article', { hasText: 'PROJ-101' });
    await expect(proj101).toHaveScreenshot('component-card.png');
  });

  test('Capture Workflow Columns Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const board = page.locator('main');
    await expect(board).toHaveScreenshot('board-workflow-columns.png');
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
    await expect(overdueSection).toHaveScreenshot('ready-section-overdue.png');

    // 2. Capture Expedited section snapshot
    await expect(expeditedSection).toHaveScreenshot('ready-section-expedited.png');

    // 3. Capture In Progress section snapshot
    await expect(inProgressSection).toHaveScreenshot('ready-section-inprogress.png');

    // 4. Capture full Ready column snapshot with all sub-sections
    await expect(readyColumn).toHaveScreenshot('ready-column-sections.png');
  });

  test('Capture Header-Integrated In Progress Drop Target during Drag Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const card = page.locator('article', { hasText: 'PROJ-101' });
    await expect(card).toBeVisible();

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Move 25px down to activate mouse sensor
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 25);
    }

    // Verify intermediate In Progress column is never rendered on the board
    await expect(page.getByTestId('column-col-inprogress')).not.toBeAttached();

    // Verify drop target is integrated into the Ready column header
    const dropTarget = page.getByTestId('ready-drop-target-inprogress');
    await expect(dropTarget).toBeVisible();
    await expect(dropTarget).toContainText('In Progress');
    await expect(dropTarget).toContainText('Drop target');

    const readyColumn = page.getByTestId('column-col-todo');
    await expect(readyColumn).toBeVisible();

    const readyHeader = readyColumn.locator('div.border-b').first();
    await expect(readyHeader.locator(dropTarget)).toBeAttached();

    await expect(readyHeader).toHaveScreenshot('ready-header-drop-target-inprogress.png');

    await expect(readyColumn).toHaveScreenshot('ready-drop-target-inprogress-column.png');

    await expect(dropTarget).toHaveScreenshot('ready-drop-target-inprogress.png');

    // Hover over drop target to capture active drag-over state
    const targetBox = await dropTarget.boundingBox();
    if (targetBox) {
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
    }
    await page.waitForTimeout(100);

    await expect(dropTarget).toHaveScreenshot('ready-drop-target-inprogress-hover.png');

    await page.mouse.up();
  });

  test('Capture Touch Device Viewport Drag and Zero Layout Shift Snapshot', async ({ page }) => {
    // 375x667 mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    const card1 = page.locator('article', { hasText: 'PROJ-85' });
    const card2 = page.locator('article', { hasText: 'PROJ-101' });
    await expect(card1).toBeVisible();
    await expect(card2).toBeVisible();

    await card1.scrollIntoViewIfNeeded();

    const readyColumn = page.getByTestId('column-col-todo');
    const colBoxBefore = await readyColumn.boundingBox();
    const initialBox2 = await card2.boundingBox();
    expect(colBoxBefore).not.toBeNull();
    expect(initialBox2).not.toBeNull();
    const initialRelativeY = (initialBox2?.y ?? 0) - (colBoxBefore?.y ?? 0);

    const headerBefore = await readyColumn.locator('div.border-b').first().boundingBox();

    // Initiate drag on first card (move 15px horizontally to activate drag without sortable collision on card2)
    const box1 = await card1.boundingBox();
    expect(box1).not.toBeNull();
    if (box1) {
      await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
      await page.mouse.down();
      await page.mouse.move(box1.x + box1.width / 2 + 15, box1.y + box1.height / 2, { steps: 5 });
    }

    // Verify drop target appears in header
    const dropTarget = page.getByTestId('ready-drop-target-inprogress');
    await expect(dropTarget).toBeVisible();

    // Verify secondary card has not shifted relative to the column header (layout shift <= 2px)
    const colBoxAfter = await readyColumn.boundingBox();
    const currentBox2 = await card2.boundingBox();
    expect(colBoxAfter).not.toBeNull();
    expect(currentBox2).not.toBeNull();
    const currentRelativeY = (currentBox2?.y ?? 0) - (colBoxAfter?.y ?? 0);

    expect(Math.abs(currentRelativeY - initialRelativeY)).toBeLessThanOrEqual(2);

    // Capture mobile screen with active drag and header drop target
    await expect(page).toHaveScreenshot('mobile-touch-dnd-zero-shift.png');

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
    await expect(page).toHaveScreenshot('modal-create-issue.png');

    // 2. Capture isolated modal dialog container
    const dialogBox = modal.locator('> div');
    await expect(dialogBox).toHaveScreenshot('component-modal-create.png');

    // 3. Switch to Preview in RichTextEditor and capture rich text preview snapshot
    const descTextarea = page.locator('#create-description');
    await descTextarea.fill('### Rich Text Formatting\n\n- Feature item 1\n- **Bold point**\n- `inline code`\n\n> Important quote');
    const previewBtn = page.getByRole('button', { name: 'Preview tab' });
    await previewBtn.click();
    const previewArea = page.getByTestId('rich-text-preview');
    await expect(previewArea).toBeVisible();
    await expect(previewArea).toHaveScreenshot('component-rich-text-preview.png');
  });

  test('Capture Mobile Create Issue Full-Screen Modal Snapshot (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const createButton = page.getByRole('button', { name: 'Create Issue' });
    await createButton.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(page.locator('#create-issue-title')).toHaveText('Create Issue');

    const dialogBox = modal.locator('> div');
    const box = await dialogBox.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // In mobile full-screen mode, the modal box spans full viewport width and height
      expect(box.width).toBe(375);
      expect(box.height).toBe(667);
      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
    }

    await expect(page).toHaveScreenshot('modal-create-issue-mobile.png');
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
    await expect(page).toHaveScreenshot('modal-edit-issue.png');

    // 4. Capture isolated modal dialog container
    const dialogBox = modal.locator('> div');
    await expect(dialogBox).toHaveScreenshot('component-modal-edit.png');

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
    await expect(datesBar).toHaveScreenshot('component-edit-dates.png');
  });

  test('Capture Mobile Edit Issue Full-Screen Modal Snapshot (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const editButton = page.locator('button[aria-label="Edit PROJ-101"]').first();
    await editButton.click();

    const modal = page.locator('div[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(page.locator('#edit-issue-title')).toContainText('Edit Issue');

    const dialogBox = modal.locator('> div');
    const box = await dialogBox.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // In mobile full-screen mode, the modal box spans full viewport width and height
      expect(box.width).toBe(375);
      expect(box.height).toBe(667);
      expect(box.x).toBe(0);
      expect(box.y).toBe(0);
    }

    await expect(page).toHaveScreenshot('modal-edit-issue-mobile.png');
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
    await expect(commentsSection).toHaveScreenshot('component-comments-section.png');
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
    await expect(modal.locator('> div')).toHaveScreenshot('component-modal-create-assignee-picker.png');
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
    await expect(dialogBox).toHaveScreenshot('component-modal-create-description.png');
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

    await expect(modal.locator('> div')).toHaveScreenshot('component-modal-create-status-picker.png');
  });

  test('Capture Issue Card with Status Selector Open Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const card = page.locator('article', { hasText: 'PROJ-101' });
    await expect(card).toBeVisible();

    const statusPicker = card.locator('[role="combobox"][aria-label="Change status for PROJ-101"]');
    await statusPicker.click();

    const listbox = card.locator('[role="listbox"][aria-label="Change status for PROJ-101"]');
    await expect(listbox).toBeVisible();

    await expect(card).toHaveScreenshot('component-card-status-picker.png');
  });

  test('Capture Board Filtered by Search Query Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const searchInput = page.getByPlaceholder('Search key, summary, description...');
    await searchInput.fill('PROJ-101');
    await page.waitForTimeout(100);

    await expect(page).toHaveScreenshot('board-search-filtered.png', {
      fullPage: true,
    });
  });

  test('Capture Filter Bar with "Who is Me" Picker Open Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const mePickerBtn = page.getByRole('button', { name: 'Change who is Me' });
    await expect(mePickerBtn).toBeVisible();
    await mePickerBtn.click();

    const listbox = page.locator('[role="listbox"][aria-label="Choose who is Me"]');
    await expect(listbox).toBeVisible();

    await expect(page).toHaveScreenshot('filter-who-is-me-picker.png', {
      fullPage: true,
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

    await expect(issueCard).toHaveScreenshot('component-card-jira-link-hover.png');
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
    await expect(header).toHaveScreenshot('component-modal-edit-jira-link-hover.png');
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

    await expect(page).toHaveScreenshot('board-high-volume-pagination.png');
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

    await expect(modal.locator('> div')).toHaveScreenshot('component-modal-create-type-picker.png');
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

    await expect(epicCard).toHaveScreenshot('component-card-epic.png');
  });

  test('Capture Filter Bar with "Hide Epics" Toggle Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const filterBar = page.locator('section').filter({ hasText: 'All Issues' });
    await expect(filterBar).toBeVisible();

    const hideEpicsBtn = filterBar.getByRole('button', { name: 'Hide Epics' });
    await expect(hideEpicsBtn).toBeVisible();

    await expect(filterBar).toHaveScreenshot('component-filterbar-hide-epics.png');
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

    await expect(page).toHaveScreenshot('home-assistant-ingress.png', {
      fullPage: true,
    });
  });

  test('Capture Home Assistant Ingress with Host Sidebar Navigation Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Inject Home Assistant UI host frame with sidebar and Ingress header bar
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--primary-background-color', '#101724');
      document.documentElement.style.setProperty('--card-background-color', '#1c2538');
      document.documentElement.style.setProperty('--ha-card-background', '#232e42');
      document.documentElement.style.setProperty('--primary-text-color', '#e1e7f0');
      document.documentElement.style.setProperty('--secondary-text-color', '#94a3b8');
      document.documentElement.style.setProperty('--accent-color', '#0284c7');
      document.documentElement.style.setProperty('--divider-color', '#2d3b55');

      const haContainer = document.createElement('div');
      haContainer.id = 'ha-host-simulation';
      haContainer.style.display = 'flex';
      haContainer.style.position = 'fixed';
      haContainer.style.inset = '0';
      haContainer.style.zIndex = '99999';
      haContainer.style.backgroundColor = '#101724';
      haContainer.style.fontFamily = 'system-ui, -apple-system, sans-serif';

      haContainer.innerHTML = `
        <div style="width: 256px; height: 100%; background: #111827; border-right: 1px solid #1f2937; display: flex; flex-direction: column; justify-content: space-between; padding: 16px 12px; box-sizing: border-box;">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin-bottom: 20px;">
              <div style="width: 28px; height: 28px; border-radius: 6px; background: #0284c7; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">HA</div>
              <span style="color: #f3f4f6; font-size: 16px; font-weight: 600;">Home Assistant</span>
            </div>
            <nav style="display: flex; flex-direction: column; gap: 4px;">
              <div style="padding: 10px 14px; border-radius: 8px; color: #9ca3af; font-size: 14px; display: flex; align-items: center; gap: 12px;">
                <span>🏠</span> Overview
              </div>
              <div style="padding: 10px 14px; border-radius: 8px; color: #9ca3af; font-size: 14px; display: flex; align-items: center; gap: 12px;">
                <span>⚡</span> Energy
              </div>
              <div style="padding: 10px 14px; border-radius: 8px; color: #9ca3af; font-size: 14px; display: flex; align-items: center; gap: 12px;">
                <span>🗺️</span> Map
              </div>
              <div style="padding: 10px 14px; border-radius: 8px; background: rgba(2, 132, 199, 0.15); color: #38bdf8; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 12px; border-left: 3px solid #0284c7;">
                <span>📋</span> Jira Dashboard
              </div>
              <div style="padding: 10px 14px; border-radius: 8px; color: #9ca3af; font-size: 14px; display: flex; align-items: center; gap: 12px;">
                <span>⚙️</span> Settings
              </div>
            </nav>
          </div>
          <div style="padding: 12px; border-top: 1px solid #1f2937; display: flex; align-items: center; gap: 10px;">
            <div style="width: 32px; height: 32px; border-radius: 50%; background: #374151; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #e5e7eb;">JM</div>
            <div style="display: flex; flex-direction: column;">
              <span style="font-size: 13px; color: #f3f4f6; font-weight: 500;">Admin</span>
              <span style="font-size: 11px; color: #9ca3af;">homeassistant.local</span>
            </div>
          </div>
        </div>
        <div id="ha-ingress-frame-container" style="flex: 1; height: 100%; display: flex; flex-direction: column; overflow: hidden; background: #0f172a;">
          <div style="height: 52px; background: #111827; border-bottom: 1px solid #1f2937; display: flex; align-items: center; justify-content: space-between; padding: 0 20px;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <span style="color: #9ca3af; font-size: 14px;">Add-on Ingress</span>
              <span style="color: #4b5563;">/</span>
              <span style="color: #f3f4f6; font-size: 14px; font-weight: 500;">Jira</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 11px; background: #1e293b; color: #38bdf8; padding: 3px 8px; border-radius: 4px; border: 1px solid #334155;">Ingress Active</span>
            </div>
          </div>
          <div id="ha-ingress-content-slot" style="flex: 1; overflow: auto;"></div>
        </div>
      `;

      document.body.appendChild(haContainer);
      const slot = document.getElementById('ha-ingress-content-slot');
      const root = document.getElementById('root');
      if (slot && root) {
        slot.appendChild(root);
      }
    });

    await page.waitForTimeout(200);

    await expect(page).toHaveScreenshot('home-assistant-ingress-embedded.png', {
      fullPage: true,
    });
  });

  test('Capture Home Assistant Ingress Mobile Companion App Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    // Inject Home Assistant Companion Mobile App navigation bar
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--primary-background-color', '#101724');
      document.documentElement.style.setProperty('--card-background-color', '#1c2538');
      document.documentElement.style.setProperty('--ha-card-background', '#232e42');
      document.documentElement.style.setProperty('--primary-text-color', '#e1e7f0');
      document.documentElement.style.setProperty('--secondary-text-color', '#94a3b8');
      document.documentElement.style.setProperty('--accent-color', '#0284c7');
      document.documentElement.style.setProperty('--divider-color', '#2d3b55');

      const mobileTopBar = document.createElement('div');
      mobileTopBar.id = 'ha-mobile-header';
      mobileTopBar.style.position = 'sticky';
      mobileTopBar.style.top = '0';
      mobileTopBar.style.left = '0';
      mobileTopBar.style.right = '0';
      mobileTopBar.style.height = '48px';
      mobileTopBar.style.background = '#111827';
      mobileTopBar.style.borderBottom = '1px solid #1f2937';
      mobileTopBar.style.display = 'flex';
      mobileTopBar.style.alignItems = 'center';
      mobileTopBar.style.padding = '0 16px';
      mobileTopBar.style.gap = '12px';
      mobileTopBar.style.zIndex = '50';
      mobileTopBar.innerHTML = `
        <span style="font-size: 18px; color: #9ca3af;">☰</span>
        <span style="font-size: 16px; font-weight: 600; color: #f3f4f6;">Jira</span>
      `;

      const root = document.getElementById('root');
      if (root && root.parentNode) {
        root.parentNode.insertBefore(mobileTopBar, root);
      }
    });

    await page.waitForTimeout(200);

    await expect(page).toHaveScreenshot('home-assistant-ingress-mobile.png', {
      fullPage: true,
    });
  });

  test('Capture Standalone Docker Packaging Web Application Snapshot', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const header = page.locator('header');
    await expect(header).toBeVisible();

    await expect(page).toHaveScreenshot('standalone-docker.png', {
      fullPage: true,
    });
  });
});

