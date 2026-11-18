import { defineConfig, devices } from '@playwright/test';
import regression from './playwright.config';

// ART-RENAISSANCE visual baseline / comparison capture.
// Separate from playwright.config.ts on purpose: the default `npm run playwright`
// only matches *.spec.ts and never writes into reports/art/.
//
//   node node_modules/@playwright/test/cli.js test -c playwright.art.config.ts
//   ART_PHASE=before|after   (default before)  -> reports/art/<phase>/
//   PORT=5173                 Local server port.
export default defineConfig({
  webServer: regression.webServer,
  testDir: './tests/art',
  testMatch: /.*\.capture\.ts$/,
  timeout: 240000,
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  outputDir: './test-results/art',
  use: {
    baseURL: regression.use?.baseURL,
    channel: regression.use?.channel,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'] }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } }]
});
