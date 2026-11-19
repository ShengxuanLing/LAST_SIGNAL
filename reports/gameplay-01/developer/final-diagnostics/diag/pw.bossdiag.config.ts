import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  testMatch: /audit-boss-volley\.diag\.p4v4\.spec\.ts$/,
  timeout: 240000,
  workers: 1,
  fullyParallel: false,
  outputDir: './pw-results-boss',
  reporter: [['line']],
  use: {
    baseURL: `http://localhost:${process.env.PORT ?? 5471}/`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
