import { defineConfig, devices } from '@playwright/test';

// ART-02 evidence capture; kept out of the default `tests/` suite.
export default defineConfig({
  testDir: './scripts/art02',
  testMatch: '*.spec.ts',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${process.env.PORT ?? 5173}/`,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } }],
});
