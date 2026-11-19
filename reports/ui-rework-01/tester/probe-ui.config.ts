import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 120000,
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://localhost:5433/', viewport: { width: 1280, height: 720 } }
});
