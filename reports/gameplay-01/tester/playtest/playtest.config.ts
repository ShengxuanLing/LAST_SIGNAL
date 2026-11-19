import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 300000,
  workers: 1,
  reporter: 'line',
  use: { baseURL: `http://localhost:${process.env.PORT ?? 5460}/`, viewport: { width: 1280, height: 720 } }
});
