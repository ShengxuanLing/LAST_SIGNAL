import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './', testMatch: /.*\.echo\.spec\.ts$/, timeout: 300000, workers: 1,
  outputDir: './pw-results', reporter: [['line']],
  use: { baseURL: `http://localhost:${process.env.PORT ?? 5488}/`, viewport: { width: 1280, height: 720 }, launchOptions: { args: ['--no-sandbox'] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
