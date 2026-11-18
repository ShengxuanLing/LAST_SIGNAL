import { defineConfig } from '@playwright/test';
import regression from './playwright.config';

const economy = process.env.LS_PREVIEW_MODE === 'economy';
const port = Number(process.env.PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}/`;
const dir = economy ? 'dist-economy' : 'dist';

export default defineConfig({
  ...regression,
  workers: 1,
  testMatch: economy ? 'economy.spec.ts' : ['boss-room.spec.ts', 'whale-character.spec.ts', 'gameplay.spec.ts', 'vs01.spec.ts'],
  use: { ...regression.use, baseURL },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --outDir ${dir} --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false
  }
});
