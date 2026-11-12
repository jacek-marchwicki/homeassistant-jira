import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const testPort = process.env.PLAYWRIGHT_PORT || '8001';
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL || `http://127.0.0.1:${testPort}`;

const venvPython = path.resolve(projectRoot, '.venv/bin/python3');
const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';
const testDbPath = process.env.SQLITE_DB_PATH || path.resolve(projectRoot, 'data/test_playwright_e2e.sqlite3');

/**
 * Playwright configuration for Jira Dashboard visual screenshot and integration tests.
 * Runs against the full-stack FastAPI backend serving the React SPA.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Run sequentially to avoid port/state conflicts during transition tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list']],
  snapshotDir: './tests/screenshots',
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  outputDir: './tests/screenshots/test-results',

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    },
  },

  use: {
    baseURL,
    serviceWorkers: 'block',
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
    command: `JIRA_USE_FAKE=1 JIRA_BOARD_ID=engineering-1 SQLITE_DB_PATH=${testDbPath} PLAYWRIGHT_PORT=${testPort} PYTHONPATH=backend/src ${pythonCmd} -m uvicorn jira_dashboard.presentation.main:app --port ${testPort}`,
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    cwd: projectRoot,
    timeout: 30000,
  },
});
