import { defineConfig, devices } from '@playwright/test';

// GAMEPLAY-01 P1 final review — reviewer-owned harness (read-only w.r.t. src/tests).
export default defineConfig({
  testDir: './',
  testMatch: /.*\.reviewer\.spec\.ts$/,
  timeout: 300000,
  fullyParallel: false,
  workers: 1,
  outputDir: './pw-p1-results',
  reporter: [['line']],
  use: {
    baseURL: `http://localhost:${process.env.PORT ?? 5481}/`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
