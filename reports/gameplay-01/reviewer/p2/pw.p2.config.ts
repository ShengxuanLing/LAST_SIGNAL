import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './', testMatch: /.*\.p2\.spec\.ts$/, timeout: 180000, workers: 1,
  outputDir: './pw-results', reporter: [['line']],
  use: { baseURL: `http://localhost:${process.env.PORT ?? 5484}/`, viewport: { width: 1280, height: 720 }, launchOptions: { args: ['--no-sandbox'] } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
