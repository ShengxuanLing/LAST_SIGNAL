import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 5173);
const baseURL = `http://127.0.0.1:${port}/`;

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  fullyParallel: false,
  webServer: {
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI
  },
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
