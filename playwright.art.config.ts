import { defineConfig, devices } from '@playwright/test';

// ART-RENAISSANCE visual baseline / comparison capture.
// Separate from playwright.config.ts on purpose: the default `npm run playwright`
// only matches *.spec.ts and never writes into reports/art/.
//
//   node node_modules/@playwright/test/cli.js test -c playwright.art.config.ts
//   ART_PHASE=before|after   (default before)  -> reports/art/<phase>/
//   PORT=5173                 Vite dev or preview server must already be running.
export default defineConfig({
  testDir: './tests/art',
  testMatch: /.*\.capture\.ts$/,
  timeout: 240000,
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  outputDir: './test-results/art',
  use: {
    baseURL: `http://localhost:${process.env.PORT ?? 5173}/`,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'] }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } }]
});
