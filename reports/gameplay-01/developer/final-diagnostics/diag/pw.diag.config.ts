import { defineConfig, devices } from '@playwright/test';

// Diagnostic-only config for the independent AI-disable drift probe.
// It never replaces the tester's config and only matches the diag copy.
export default defineConfig({
  testDir: './',
  testMatch: /\.diag\.p4v4\.spec\.ts$/,
  timeout: 240000,
  workers: 1,
  fullyParallel: false,
  outputDir: './pw-results',
  reporter: [['line']],
  use: {
    baseURL: `http://localhost:${process.env.PORT ?? 5471}/`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
