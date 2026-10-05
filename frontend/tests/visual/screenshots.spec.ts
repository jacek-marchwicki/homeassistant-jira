import { test, expect } from '@playwright/test';

/**
 * Visual Screenshot & Regression Suite.
 *
 * Captures high-fidelity screenshots across all supported responsive viewports
 * (Desktop, Tablet, Mobile, Wallboard Kiosk) and color themes (Dark, Light, Kiosk).
 */

test.describe('Visual Screenshot Tests across Viewports & Themes', () => {
  test.beforeEach(async ({ page }) => {
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
});
