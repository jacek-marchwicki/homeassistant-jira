import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

/**
 * Playwright configuration for Jira Dashboard visual screenshot and integration tests.
 * Runs against the full-stack FastAPI backend serving the React SPA on port 8000.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run sequentially to avoid port/state conflicts during transition tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  snapshotDir: './tests/screenshots/snapshots',
  outputDir: './tests/screenshots/test-results',

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    },
  },

  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  webServer: {
    command: 'PYTHONPATH=backend/src python3 -m uvicorn jira_dashboard.presentation.main:app --port 8000',
    url: 'http://127.0.0.1:8000/health',
    reuseExistingServer: !process.env.CI,
    cwd: projectRoot,
    timeout: 30000,
  },
});
