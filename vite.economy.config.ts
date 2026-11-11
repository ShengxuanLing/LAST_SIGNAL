import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import base from './vite.config';

export default defineConfig({
  ...base,
  build: {
    ...base.build,
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        economy: fileURLToPath(new URL('./economy.html', import.meta.url))
      }
    }
  }
});
