import { defineConfig, devices } from '@playwright/test';

// Reviewer-only config: the UI-REWORK-01 reviewer's independent companion
// evidence lives under reports/ui-rework-01/reviewer/audit/ and must never
// touch tests/ (owned by the tester).
export default defineConfig({
  testDir: './',
  testMatch: /.*\.reviewer\.spec\.ts$/,
  timeout: 240000,
  fullyParallel: false,
  workers: 1,
  outputDir: './pw-results',
  reporter: [['line']],
  use: {
    baseURL: `http://localhost:${process.env.PORT ?? 5466}/`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
