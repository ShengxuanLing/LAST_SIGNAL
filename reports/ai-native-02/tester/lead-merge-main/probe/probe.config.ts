import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 120000,
  use: { baseURL: 'http://localhost:' + (process.env.PORT ?? '5422') + '/', viewport: { width: 1280, height: 720 } }
});
